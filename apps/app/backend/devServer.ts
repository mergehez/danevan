/**
 * Browser-only dev server that exposes backend app methods as HTTP endpoints.
 * Run with: bun run apps/app/backend/devServer.ts
 */
import { app } from '@backend/app.ts';
import { useAppDb } from '@backend/db-app.ts';
import { apiMethods } from '@utils/apiMethods';
import { homedir, platform } from 'os';
import { join } from 'path';

const PORT = parseInt(process.env.API_PORT || '3264', 10);

function resolveAppDataDir(): string {
    const envDir = process.env.DANEVAN_DATA_DIR;
    if (envDir) {
        return envDir;
    }

    if (platform() === 'win32') {
        const appData = process.env.APPDATA;
        if (appData) {
            return join(appData, 'danevan');
        }
    }

    if (platform() === 'darwin') {
        return join(homedir(), 'Library', 'Application Support', 'danevan');
    }

    // Linux / default
    return join(homedir(), '.local', 'share', 'danevan');
}

// Initialize database (normally done by the Electrobun entrypoint)
const userDataDir = resolveAppDataDir();
useAppDb().configureDatabase(userDataDir);

const methodMap: Record<string, (ps?: unknown) => unknown> = {
    ...(apiMethods.reduce(
        (acc, methodName) => {
            acc[methodName] = (app as unknown as Record<string, (ps?: unknown) => unknown>)[methodName];
            return acc;
        },
        {} as Record<string, (ps?: unknown) => unknown>
    ) as Record<string, (ps?: unknown) => unknown>),

    // Native-only methods that can't work in browser mode — return safe stubs.
    pickEditorApplication: async () => undefined,
    pickDatabaseFile: async () => undefined,
    revealPathInFileManager: async () => undefined,
    openPathWithDefaultProgram: async () => undefined,
    openFileInEditor: async () => {
        throw new Error('openFileInEditor is not available in browser dev mode.');
    },
};

const REQUEST_TIMEOUT_MS = 65_000;

function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutHandle: Timer | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error(`Request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    });
}

Bun.serve({
    port: PORT,
    async fetch(req) {
        // CORS for Vite dev server
        if (req.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                },
            });
        }

        const url = new URL(req.url);

        // Health check
        if (url.pathname === '/health') {
            return Response.json({ ok: true });
        }

        // API endpoint: POST /api/:method
        if (url.pathname.startsWith('/api/') && req.method === 'POST') {
            const method = url.pathname.slice('/api/'.length);
            const handler = methodMap[method];

            if (!handler) {
                return new Response(JSON.stringify({ error: `Unknown method: ${method}` }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            try {
                let params: unknown = undefined;
                const contentType = req.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    const text = await runWithTimeout(req.text(), REQUEST_TIMEOUT_MS);
                    if (text.trim()) {
                        params = JSON.parse(text);
                    }
                }

                const result = await runWithTimeout(handler(params), REQUEST_TIMEOUT_MS);
                return Response.json(result, {
                    headers: { 'Access-Control-Allow-Origin': '*' },
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`[devServer] ${method}:`, message);
                return new Response(JSON.stringify({ error: message }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                });
            }
        }

        return new Response('Not found', { status: 404 });
    },
});

console.log(`[devServer] Backend API running at http://localhost:${PORT}`);
