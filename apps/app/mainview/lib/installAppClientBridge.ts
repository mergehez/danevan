import type { AppBridge, AppRequestMap, DanevanElectrobunRpc, RendererDiagnosticPayload } from '@electrobun';
import type { NativeCommand } from '@utils/appClient';
import { Electroview } from 'electrobun/view';

let installPromise: Promise<void> | undefined;
const APP_RPC_MAX_REQUEST_TIME = 120_000;
let diagnosticsInstalled = false;

type DiagnosticParts = {
    message: string;
    details?: string;
};

function createListenerSubscription<TListener>(listeners: Set<TListener>, listener: TListener) {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

function toDiagnosticMessage(value: unknown, seen = new WeakSet<object>()): string {
    if (value instanceof Error) {
        return value.stack || value.message || String(value);
    }

    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || value == null) {
        return String(value);
    }

    if (typeof value === 'object') {
        if (seen.has(value)) {
            return '[circular]';
        }

        seen.add(value);

        try {
            return JSON.stringify(value);
        } catch {
            return Object.prototype.toString.call(value);
        }
    }

    return Object.prototype.toString.call(value);
}

function extractDiagnosticParts(value: unknown): DiagnosticParts {
    if (value instanceof Error) {
        return {
            message: value.message || String(value),
            details: value.stack || value.message || String(value),
        };
    }

    if (typeof value === 'string') {
        return {
            message: value,
            details: value,
        };
    }

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || value == null) {
        return {
            message: String(value),
            details: String(value),
        };
    }

    if (typeof value === 'object') {
        const maybeErrorLike = value as { message?: unknown; stack?: unknown };
        const message = typeof maybeErrorLike.message === 'string' && maybeErrorLike.message ? maybeErrorLike.message : Object.prototype.toString.call(value);
        const details = typeof maybeErrorLike.stack === 'string' && maybeErrorLike.stack ? maybeErrorLike.stack : toDiagnosticMessage(value);

        return {
            message,
            details,
        };
    }

    return {
        message: toDiagnosticMessage(value),
        details: toDiagnosticMessage(value),
    };
}

function extractConsoleDiagnosticParts(args: unknown[]): DiagnosticParts {
    if (args.length === 0) {
        return {
            message: 'console called with no arguments',
        };
    }

    const [firstArg, ...restArgs] = args;
    const firstPart = extractDiagnosticParts(firstArg);
    const detailParts = [firstPart.details, ...restArgs.map((arg) => extractDiagnosticParts(arg).details)].filter((value): value is string => Boolean(value));

    return {
        message: firstPart.message,
        details: detailParts.length > 0 ? detailParts.join('\n\n') : undefined,
    };
}

function installRendererDiagnostics(rpc: { send: { rendererDiagnostic: (payload: RendererDiagnosticPayload) => void } }) {
    if (diagnosticsInstalled) {
        return;
    }

    const isIgnoredWindowError = (message: string | undefined) => {
        if (!message) {
            return false;
        }

        return message === 'ResizeObserver loop completed with undelivered notifications.';
    };

    diagnosticsInstalled = true;

    const sendDiagnostic = (payload: RendererDiagnosticPayload) => {
        try {
            rpc.send.rendererDiagnostic(payload);
        } catch {
            // Ignore recursive transport issues.
        }
    };

    const consoleMethods = [
        ['debug', 'console-debug'],
        ['info', 'console-info'],
        ['log', 'console-log'],
        ['warn', 'console-warn'],
        ['error', 'console-error'],
    ] as const satisfies ReadonlyArray<readonly [keyof Console, RendererDiagnosticPayload['type']]>;

    for (const [methodName, diagnosticType] of consoleMethods) {
        const originalMethod = window.console[methodName].bind(window.console) as (...args: unknown[]) => void;

        window.console[methodName] = ((...args: unknown[]) => {
            originalMethod(...args);

            const diagnostic = extractConsoleDiagnosticParts(args);

            sendDiagnostic({
                type: diagnosticType,
                message: diagnostic.message,
                details: diagnostic.details,
            });
        }) as Console[typeof methodName];
    }

    window.addEventListener('error', (event) => {
        if (isIgnoredWindowError(event.message)) {
            return;
        }

        const diagnostic = event.error ? extractDiagnosticParts(event.error) : { message: event.message || 'Uncaught window error', details: undefined };
        const metadata = JSON.stringify({
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
        });

        sendDiagnostic({
            type: 'window-error',
            message: diagnostic.message || event.message || 'Uncaught window error',
            details: [diagnostic.details, metadata].filter((value): value is string => Boolean(value)).join('\n\n') || undefined,
        });
    });

    window.addEventListener('unhandledrejection', (event) => {
        const diagnostic = extractDiagnosticParts(event.reason);

        sendDiagnostic({
            type: 'unhandled-rejection',
            message: diagnostic.message,
            details: diagnostic.details,
        });
    });
}

export function ensureAppClientBridge() {
    if (window.appClient) {
        return Promise.resolve();
    }

    if (installPromise) {
        return installPromise;
    }

    installPromise = (async () => {
        const nativeCommandListeners = new Set<(command: NativeCommand) => void>();

        const electroview = new Electroview({
            rpc: Electroview.defineRPC<DanevanElectrobunRpc>({
                maxRequestTime: APP_RPC_MAX_REQUEST_TIME,
                handlers: {
                    requests: {},
                    messages: {
                        nativeCommand(command) {
                            nativeCommandListeners.forEach((listener) => listener(command));
                        },
                    },
                },
            }),
        });

        installRendererDiagnostics(
            electroview.rpc as {
                send: { rendererDiagnostic: (payload: RendererDiagnosticPayload) => void };
            }
        );

        const appClient: AppBridge<AppRequestMap> = {
            invoke(name, params) {
                return (electroview.rpc!.request[name] as (params: AppRequestMap[typeof name]['params']) => Promise<AppRequestMap[typeof name]['response']>)(params);
            },
            onNativeCommand(listener) {
                return createListenerSubscription(nativeCommandListeners, listener);
            },
        };

        window.appClient = appClient;
    })();

    return installPromise;
}
