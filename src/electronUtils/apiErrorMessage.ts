type ApiErrorEnvelope = { error?: unknown; message?: unknown };

function readEnvelopeMessage(body: string) {
    try {
        const envelope = JSON.parse(body) as ApiErrorEnvelope;
        const message = envelope?.error ?? envelope?.message;

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
