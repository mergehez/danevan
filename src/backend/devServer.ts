/**
 * HTTP server that exposes backend app methods as API endpoints.
 *
 * Two modes (controlled by STANDALONE env var):
 *   - Dev mode (default): API only, with CORS for Vite dev server.
 *   - Standalone mode: serves the built frontend + API in one process.
 *
 * Run (dev):  bun run src/backend/devServer.ts
 * Build:      STANDALONE=true bun build --compile src/backend/devServer.ts
 */
import { app } from './app.ts';
import { useAppDb } from './db-app.ts';
import { apiMethods } from '../shared/utils/apiMethods';
import { createBrowserOnlyDevServer } from '../electronUtils/browserOnlyHelpers';

// const PORT = parseInt(process.env.API_PORT || '3264', 10);
// const IS_STANDALONE = process.env.STANDALONE === 'true';
export const ready = createBrowserOnlyDevServer(app, apiMethods, useAppDb());

// const methodMap: Record<string, (ps?: unknown) => unknown> = {
//     ...(apiMethods.reduce(
//         (acc, methodName) => {
//             acc[methodName] = (app as unknown as Record<string, (ps?: unknown) => unknown>)[methodName];
//             return acc;
//         },
//         {} as Record<string, (ps?: unknown) => unknown>
//     ) as Record<string, (ps?: unknown) => unknown>),
//     pickDatabaseFile: async () => undefined,
// };

// const REQUEST_TIMEOUT_MS = 65_000;

// function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
//     let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
//     const timeoutPromise = new Promise<never>((_, reject) => {
//         timeoutHandle = setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
//     });
//     return Promise.race([promise, timeoutPromise]).finally(() => {
//         if (timeoutHandle) clearTimeout(timeoutHandle);
//     });
// }

// const __filename = fileURLToPath(import.meta.url);
// const FRONTEND_DIST = join(dirname(__filename), '..', 'mainview', 'dist');

// const server = express();

// // CORS preflight (dev mode only — standalone serves from the same origin)
// if (!IS_STANDALONE) {
//     server.use((req, res, next) => {
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

// server.post('/api/:method', async (req, res) => {
//     const method = req.params.method;
//     const handler = methodMap[method];

//     if (!handler) {
//         res.status(404).json({ error: `Unknown method: ${method}` });
//         return;
//     }

//     try {
//         const params = req.body ?? undefined;
//         const result = await runWithTimeout(Promise.resolve(handler(params)), REQUEST_TIMEOUT_MS);
//         if (!IS_STANDALONE) res.set('Access-Control-Allow-Origin', '*');
//         res.json(result);
//     } catch (error) {
//         const message = error instanceof Error ? error.message : String(error);
//         console.error(`[server] ${method}:`, message);
//         res.status(500).json({ error: message });
//     }
// });

// // Standalone mode: serve the built frontend
// if (IS_STANDALONE) {
//     server.use(express.static(FRONTEND_DIST));

//     // SPA fallback — serve index.html for any unmatched route (non-API)
//     server.use((_req, res) => {
//         const indexPath = join(FRONTEND_DIST, 'index.html');
//         if (existsSync(indexPath)) {
//             const content = readFileSync(indexPath);
//             res.type('html').send(content);
//         } else {
//             res.status(404).send('Not found');
//         }
//     });
// }

// server.listen(PORT, '127.0.0.1', () => {
//     const label = IS_STANDALONE ? 'standalone' : 'devServer';
//     console.log(`[${label}] Danevan running at http://127.0.0.1:${PORT}`);
// });
