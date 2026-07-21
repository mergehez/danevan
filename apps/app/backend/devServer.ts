/**
 * Browser-only dev server that exposes backend app methods as HTTP endpoints.
 * Run with: bun run apps/app/backend/devServer.ts
 */
import { app } from '@backend/app.ts';
import { useAppDb } from '@backend/db-app.ts';
import { apiMethods } from '@utils/apiMethods';
import express from 'express';
import { homedir, platform } from 'os';
import { join } from 'path';

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
        throw new Error('openFileInEditor is not available in browser dev mode.');
    },
};

const REQUEST_TIMEOUT_MS = 65_000;

function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
    });
}

const server = express();

server.use(express.json());

server.options('*', (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.sendStatus(204);
});

server.get('/health', (_req, res) => {
    res.json({ ok: true });
});

server.post('/api/:method', async (req, res) => {
    const method = req.params.method;
    const handler = methodMap[method];

    if (!handler) {
        res.status(404).json({ error: `Unknown method: ${method}` });
        return;
    }

    try {
        const params = req.body ?? undefined;
        const result = await runWithTimeout(Promise.resolve(handler(params)), REQUEST_TIMEOUT_MS);
        res.set('Access-Control-Allow-Origin', '*');
        res.json(result);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[devServer] ${method}:`, message);
        res.status(500).json({ error: message });
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[devServer] Backend API running at http://127.0.0.1:${PORT}`);
});
