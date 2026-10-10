// @vitest-environment node
// The API port is fixed by package.json, so a second backend — a leftover `bun run dev`, a second
// build — has to be told the port is taken. It used to surface as an unhandled 'error' event: the
// backend never came up and the window waited for a server that was never going to listen.
import { describe, expect, it } from 'vitest';
import { createBrowserOnlyDevServer, describeApiListenError } from '../../../electronUtils/browserOnlyHelpers';

function listen(port: number) {
    // The methods and the app DB are not what this spec is about: it only takes the port.
    return createBrowserOnlyDevServer({} as never, [], { configureDatabase: () => undefined }, { port });
}

describe('the backend API port', () => {
    it('reports a busy port instead of leaving the caller waiting', async () => {
        const port = 43_000 + Math.floor(Math.random() * 1_000);
        const listening = await listen(port);

        try {
            await expect(listen(port)).rejects.toThrow(`Port ${port} is already in use: another Danevan window (or "bun run dev") is running. Close it and start again.`);
        } finally {
            await new Promise<void>((resolve) => {
                listening.close(() => resolve());
            });
        }
    });

    it('describes any other reason the port cannot be taken', () => {
        expect(describeApiListenError(4321, { code: 'EACCES', message: 'permission denied' } as NodeJS.ErrnoException)).toBe(
            'The backend API could not listen on port 4321: permission denied'
        );
    });
});
