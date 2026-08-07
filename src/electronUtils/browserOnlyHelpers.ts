import express from 'express';
import { appConfig } from './helpers.ts';
import type { RendererDiagnosticPayload } from './mainProloadHelpers.ts';
/**
 * Browser-only dev server that exposes backend app methods as HTTP endpoints.
 * Run with: tsx src/backend/devServer.ts
 */
export function createBrowserOnlyDevServer<GitClientRequestApi extends object>(app: GitClientRequestApi, apiMethods: readonly string[], db: { configureDatabase: () => void }) {
    // Initialize database (normally done by the Electrobun entrypoint)
    db.configureDatabase();

    const methodMap: GitClientRequestApi = apiMethods.reduce((acc, methodName) => {
        if (methodName in app) {
            acc[methodName] = app[methodName as keyof typeof app] as any;
        } else {
            acc[methodName] = async () => {
                throw new Error(`Method ${methodName} is not implemented in browser dev mode.`);
            };
        }
        return acc;
    }, {} as any);

    const REQUEST_TIMEOUT_MS = 65_000;
    const serverApp = express();

    // // CORS preflight (dev mode only — standalone serves from the same origin)
    // if (!IS_STANDALONE) {
    //     serverApp.use((req, res, next) => {
    //         if (req.method === 'OPTIONS') {
    //             res.set('Access-Control-Allow-Origin', '*');
    //             res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    //             res.set('Access-Control-Allow-Headers', 'Content-Type');
    //             res.sendStatus(204);
    //             return;
    //         }
    //         next();
    //     });
    // }

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

    function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
        });
        return Promise.race([promise, timeoutPromise]).finally(() => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
        });
    }

    serverApp.get('/health', (_req, res) => {
        res.json({ ok: true });
    });

    serverApp.post('/api/:method', async (req, res) => {
        const method = req.params.method;
        const handler: any = method ? methodMap[method as keyof GitClientRequestApi] : undefined;

        if (!handler) {
            res.status(404).json({ error: `Unknown method: ${method}` });
            return;
        }

        try {
            let params: any = undefined;
            const contentType = req.header('content-type') || '';
            const text = typeof req.body === 'string' ? req.body : '';
            if (contentType.includes('application/json') && text.trim()) {
                params = JSON.parse(text);
            }

            const result = await runWithTimeout(Promise.resolve(handler(params)), REQUEST_TIMEOUT_MS);
            res.json(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[devServer] ${method}:`, message);
            res.status(500).json({ error: message });
        }
    });

    serverApp.use((_req, res) => {
        res.status(404).send('Not found');
    });

    return new Promise<void>((resolve) => {
        serverApp.listen(appConfig.apiPort, () => {
            console.log(`[devServer] Backend API running at http://localhost:${appConfig.apiPort}`);
            resolve();
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
        // Minimal stub of the Electrobun bridge shape
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
