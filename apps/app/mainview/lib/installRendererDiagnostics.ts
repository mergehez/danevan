let diagnosticsInstalled = false;

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

export function installRendererDiagnostics(): void {
    if (diagnosticsInstalled) return;
    diagnosticsInstalled = true;

    const originalConsoleError = window.console.error.bind(window.console);

    const send = (payload: { type: string; message: string; details?: string }) => {
        try {
            window.appClient?.diagnostic?.(payload);
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
