type ApiErrorEnvelope = { error?: unknown };

function readEnvelopeMessage(body: string) {
    try {
        const envelope = JSON.parse(body) as ApiErrorEnvelope;
        const message = envelope?.error;

        if (typeof message === 'string' && message.trim()) {
            return message;
        }
    } catch {
        // Not the JSON envelope: the raw body is all there is to report.
    }

    return undefined;
}

/**
 * A failed request carries the API's `{ "error": "..." }` envelope; the user should read the
 * message inside it, not the JSON (and escaped quotes) that wrap it.
 */
export function readApiErrorMessage(status: number, body: string) {
    return readEnvelopeMessage(body) ?? `Backend error (${status}): ${body.trim()}`;
}

/**
 * Electron rejects `ipcRenderer.invoke` with the channel and re-wraps the handler's error
 * (`Error invoking remote method 'x': Error: <message>`), and a handler that failed in another
 * wrapped call keeps that wrapper too. Peel them off so only the failure is left.
 */
export function toDisplayErrorMessage(error: unknown) {
    let message = error instanceof Error ? error.message : String(error);

    for (;;) {
        const unwrapped = message.replace(/Error invoking remote method '[^']*':\s*/g, '').replace(/^Error:\s*/, '');

        if (unwrapped === message) {
            return message;
        }

        message = unwrapped;
    }
}
