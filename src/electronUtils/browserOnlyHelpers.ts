import express from 'express';
import type { Server } from 'node:http';
import { appConfig } from './helpers.ts';
import type { RendererDiagnosticPayload } from './mainProloadHelpers.ts';

export type DevServerRequestScope = <T>(signal: AbortSignal, task: () => Promise<T>) => Promise<T>;

/**
 * A method only the native host can run: browser dev mode has nothing to run it in. The distinct
 * code keeps that boundary a handled outcome for the specs instead of an internal fault.
 */
export class BrowserUnavailableError extends Error {
    readonly code = 'not-available-in-browser';

    constructor(methodName: string) {
        super(`Method ${methodName} is not implemented in browser dev mode.`);
    }
}

export type BrowserDevServerOptions = {
    port?: number;
    /** Runs a request's work inside its abort scope, so work it spawns dies with the request. */
    runInRequestScope?: DevServerRequestScope;
    /** Answers for the native methods a browser run has to keep working, keyed by method name. */
    nativeStandins?: Record<string, (params: any) => Promise<unknown>>;
    /** Classifies a handler failure for `/health`; anything unclassified counts as internal. */
    classifyError?: (error: unknown, message: string) => string | undefined;
};

/**
 * Browser-only dev server that exposes backend app methods as HTTP endpoints.
 * Run with: tsx src/backend/devServer.ts
 */
/** Why the API could not take its port, in the words the person starting the app needs. */
export function describeApiListenError(port: number, error: NodeJS.ErrnoException) {
    if (error.code === 'EADDRINUSE') {
        return `Port ${port} is already in use: another ${appConfig.appName} window (or "bun run dev") is running. Close it and start again.`;
    }

    return `The backend API could not listen on port ${port}: ${error.message}`;
}

export function createBrowserOnlyDevServer<GitClientRequestApi extends object>(
    app: GitClientRequestApi,
    apiMethods: readonly string[],
    db: { configureDatabase: () => void },
    options: BrowserDevServerOptions = {}
) {
    const port = options.port ?? appConfig.apiPort;
    const nativeStandins = options.nativeStandins ?? {};

    // Initialize database (normally done by the Electron entrypoint)
    db.configureDatabase();

    const methodMap: GitClientRequestApi = apiMethods.reduce((acc, methodName) => {
        if (methodName in app) {
            acc[methodName] = app[methodName as keyof typeof app] as any;
        } else if (methodName in nativeStandins) {
            acc[methodName] = nativeStandins[methodName] as any;
        } else {
            acc[methodName] = async () => {
                throw new BrowserUnavailableError(methodName);
            };
        }
        return acc;
    }, {} as any);

    const REQUEST_TIMEOUT_MS = 65_000;
    const serverApp = express();

    // Handler failures are reported on /health so a browser spec can prove the app ran without
    // erroring, instead of a green run hiding a backend that threw all the way through.
    const handlerErrors: Array<{ seq: number; method: string; message: string; code: string }> = [];
    const maxTrackedHandlerErrors = 25;
    let handlerErrorCount = 0;

    function recordHandlerError(method: string, message: string, code: string) {
        handlerErrorCount++;
        handlerErrors.push({ seq: handlerErrorCount, method, message, code });

        if (handlerErrors.length > maxTrackedHandlerErrors) {
            handlerErrors.splice(0, handlerErrors.length - maxTrackedHandlerErrors);
        }
    }

    /** A cancelled request is the client walking away from work it no longer needs. */
    function isCancellation(message: string) {
        return /cancelled|canceled|aborted/i.test(message);
    }

    serverApp.use(express.text({ type: '*/*', limit: '10mb' }));
    serverApp.use((_req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (_req.method === 'OPTIONS') {
            res.status(204).end();
            return;
        }

        next();
    });

    function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, controller: AbortController): Promise<T> {
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
                const error = new Error(`Request timed out after ${timeoutMs}ms`);
                controller.abort(error);
                reject(error);
            }, timeoutMs);
        });
        return Promise.race([promise, timeoutPromise]).finally(() => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
        });
    }

    serverApp.get('/health', (_req, res) => {
        res.json({ ok: true, handlerErrorCount, handlerErrors });
    });

    serverApp.post('/api/:method', async (req, res) => {
        const method = req.params.method;
        const handler: any = method ? methodMap[method as keyof GitClientRequestApi] : undefined;

        if (!handler) {
            res.status(404).json({ error: `Unknown method: ${method}` });
            return;
        }

        // Aborting when the response closes without finishing is what kills the work the request
        // started; otherwise the client gives up and the work keeps running.
        const controller = new AbortController();
        const onResponseClosed = () => {
            if (!res.writableEnded) {
                controller.abort(new Error('The request was cancelled.'));
            }
        };
        res.on('close', onResponseClosed);

        const runHandler = async () => {
            try {
                let params: any = undefined;
                const contentType = req.header('content-type') || '';
                const text = typeof req.body === 'string' ? req.body : '';
                if (contentType.includes('application/json') && text.trim()) {
                    params = JSON.parse(text);
                }

                const result = await runWithTimeout(Promise.resolve(handler(params)), REQUEST_TIMEOUT_MS, controller);
                // The renderer parses every answer as JSON, so a method that returns nothing answers
                // `null` rather than an empty body.
                res.json(result ?? null);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);

                if (!isCancellation(message)) {
                    const code = error instanceof BrowserUnavailableError ? error.code : (options.classifyError?.(error, message) ?? 'internal');

                    recordHandlerError(method ?? 'unknown', message, code);

                    if (code === 'internal') {
                        console.error(`[devServer] ${method}:`, message);
                    }
                }

                if (!res.writableEnded && !res.headersSent) {
                    res.status(500).json({ error: message });
                }
            } finally {
                res.off('close', onResponseClosed);
            }
        };

        await (options.runInRequestScope ? options.runInRequestScope(controller.signal, runHandler) : runHandler());
    });

    serverApp.use((_req, res) => {
        res.status(404).send('Not found');
    });

    return new Promise<Server>((resolve, reject) => {
        const server = serverApp.listen(port, () => {
            // A bind that fails reports this callback first and the error right after it, so the
            // address — not the callback — is what says the API is really listening.
            if (server.address()) {
                console.log(`[devServer] Backend API running at http://localhost:${port}`);
                resolve(server);
            }
        });

        // A busy port used to surface as an unhandled 'error' event: the backend never came up and
        // the window waited forever, so the reason is reported instead.
        server.on('error', (error: NodeJS.ErrnoException) => {
            reject(new Error(describeApiListenError(port, error)));
        });
    });
}

export function createBrowserOnlyAppClientPpc(timeoutMs: number = 75_000) {
    function trimTrailingSlash(value: string) {
        return value.replace(/\/+$/u, '');
    }

    function resolveDev2ApiBase() {
        const configuredBase = import.meta.env.VITE_DEV2_API_BASE?.trim();
        if (configuredBase) {
            return trimTrailingSlash(configuredBase);
        }

        const hostname = window.location.hostname || '127.0.0.1';
        return `http://${hostname}:${appConfig.apiPort}/api`;
    }

    async function invoke(method: string, params?: unknown): Promise<any> {
        const controller = new AbortController();
        const timeoutHandle = window.setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
        const requestUrl = `${resolveDev2ApiBase()}/${method}`;

        try {
            const response = await fetch(requestUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: params !== undefined ? JSON.stringify(params) : undefined,
                signal: controller.signal,
                cache: 'no-store',
            });

            const responseText = await response.text();
            const responseBody = responseText.trim() ? JSON.parse(responseText) : undefined;

            if (!response.ok) {
                throw new Error(responseBody?.error || response.statusText || `HTTP ${response.status}`);
            }

            return responseBody;
        } catch (error) {
            if (controller.signal.aborted) {
                throw new Error(`Backend request "${method}" timed out after ${timeoutMs}ms.`);
            }

            throw error;
        } finally {
            window.clearTimeout(timeoutHandle);
        }
    }

    function installDev2AppClientBridge() {
        installRendererDiagnostics();
        // Minimal stub of the Electron preload bridge shape
        window.electronAPI = {
            invoke,
            onNativeCommand: () => () => {},
            sendDiagnostic: () => undefined,
        };
    }

    return {
        resolveDev2ApiBase,
        invoke,
        installDev2AppClientBridge,
    };
}

let rendererDiagnosticsInstalled = false;
function installRendererDiagnostics() {
    function toMessage(value: unknown): string {
        if (value instanceof Error) return value.stack || value.message || String(value);
        if (typeof value === 'string') return value;
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    function formatConsoleArgs(args: unknown[]): { message: string; details?: string } {
        const error = args.find((a): a is Error => a instanceof Error);
        if (error) {
            const prefix = args
                .filter((a) => a !== error)
                .map(toMessage)
                .filter(Boolean)
                .join(' ');
            return {
                message: prefix ? `${prefix} ${error.message}` : error.message,
                details: error.stack,
            };
        }
        return { message: args.map(toMessage).join(' ') };
    }

    function install(): void {
        if (rendererDiagnosticsInstalled) return;
        rendererDiagnosticsInstalled = true;

        const originalConsoleError = window.console.error.bind(window.console);

        const send = (payload: RendererDiagnosticPayload) => {
            try {
                window.electronAPI?.sendDiagnostic?.(payload);
            } catch {
                /* ignore */
            }
        };

        window.console.error = (...args: unknown[]) => {
            originalConsoleError(...args);
            const { message, details } = formatConsoleArgs(args);
            send({ type: 'console-error', message, details });
        };

        window.addEventListener('error', (event) => {
            send({
                type: 'window-error',
                message: event.message || 'Uncaught window error',
                details: event.error instanceof Error ? event.error.stack || event.error.message : undefined,
            });
        });

        window.addEventListener('unhandledrejection', (event) => {
            const msg = event.reason instanceof Error ? event.reason.message : toMessage(event.reason);
            const stk = event.reason instanceof Error ? event.reason.stack : undefined;
            send({ type: 'unhandled-rejection', message: msg || 'Unhandled promise rejection', details: stk });
        });
    }

    install();
}
