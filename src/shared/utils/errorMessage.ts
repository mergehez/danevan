// The envelope is the API's contract, so the reader lives with the code that posts to it and stays
// copyable between apps; this module only re-exports it for the renderer's callers.
export { readApiErrorMessage } from '../../electronUtils/apiErrorMessage.ts';

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
