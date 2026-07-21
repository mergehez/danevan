/**
 * Standalone server that serves both the API and the built frontend.
 * Compile with: bun build --compile ./apps/app/backend/standaloneServer.ts --outfile danevan
 *
 * The frontend HTML import tells Bun to bundle all referenced <script> and
 * <link> tags and expose them as static routes automatically.
 */
import { app } from '@backend/app.ts';
import { useAppDb } from '@backend/db-app.ts';
import { apiMethods } from '@utils/apiMethods';
import { homedir, platform } from 'os';
import { join } from 'path';

// Import frontend — Bun bundles referenced <script>/<link> tags as static routes
import frontendEntry from '../mainview/dist/index.html';

const PORT = parseInt(process.env.API_PORT || '3264', 10);

function resolveAppDataDir(): string {
    const envDir = process.env.DANEVAN_DATA_DIR;
    if (envDir) return envDir;

    if (platform() === 'win32') {
        const appData = process.env.APPDATA;
        if (appData) return join(appData, 'danevan');
    }

    if (platform() === 'darwin') {
        return join(homedir(), 'Library', 'Application Support', 'danevan');
    }

    return join(homedir(), '.local', 'share', 'danevan');
}

const userDataDir = resolveAppDataDir();
useAppDb().configureDatabase(userDataDir);

// Build API method map (same as devServer.ts)
const methodMap: Record<string, (ps?: unknown) => unknown> = {
    ...(apiMethods.reduce(
        (acc, methodName) => {
            acc[methodName] = (app as unknown as Record<string, (ps?: unknown) => unknown>)[methodName];
            return acc;
        },
        {} as Record<string, (ps?: unknown) => unknown>
    ) as Record<string, (ps?: unknown) => unknown>),

    pickEditorApplication: async () => undefined,
    pickDatabaseFile: async () => undefined,
    revealPathInFileManager: async () => undefined,
    openPathWithDefaultProgram: async () => undefined,
    openFileInEditor: async () => {
        throw new Error('openFileInEditor is not available in this mode.');
    },
};

const REQUEST_TIMEOUT_MS = 65_000;

function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutHandle: Timer | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
    });
}

// Build API route config for routes
const apiRouteConfig: Record<string, { POST: (req: Request) => Response | Promise<Response> }> = {};
for (const methodName of apiMethods) {
    apiRouteConfig[`/api/${methodName}`] = {
        POST: async (req: Request) => {
            const handler = methodMap[methodName];
            if (!handler) {
                return Response.json({ error: `Unknown method: ${methodName}` }, { status: 404 });
            }

            try {
                let params: unknown = undefined;
                const contentType = req.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    const text = await runWithTimeout(req.text(), REQUEST_TIMEOUT_MS);
                    if (text.trim()) params = JSON.parse(text);
                }

                const result = await runWithTimeout(handler(params), REQUEST_TIMEOUT_MS);
                return Response.json(result);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`[api] ${methodName}:`, message);
                return Response.json({ error: message }, { status: 500 });
            }
        },
    };
}

const server = Bun.serve({
    port: PORT,
    routes: {
        // Frontend — Bun bundles <script>/<link> refs and serves them as static routes
        '/': frontendEntry,

        // Health check
        '/health': { GET: () => Response.json({ ok: true }) },

        // API endpoints
        ...apiRouteConfig,
    },
    // SPA fallback — anything else serves the frontend
    fetch() {
        return frontendEntry;
    },
});

console.log(`[standalone] Danevan running at http://localhost:${PORT}`);
