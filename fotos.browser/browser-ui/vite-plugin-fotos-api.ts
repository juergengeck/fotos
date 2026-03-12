/**
 * Vite plugin: HTTP → HMR bridge for fotos PlanRegistry.
 *
 * Exposes browser-side PlanRegistry plans via HTTP in dev mode:
 *   curl -X POST http://localhost:5188/api/fotos/status
 *   curl -X POST http://localhost:5188/api/fotos/init
 *   curl -X POST http://localhost:5188/api/introspection/listPlans
 */

import type { Plugin, ViteDevServer } from 'vite';

interface PendingRequest {
    resolve: (value: any) => void;
    timer: ReturnType<typeof setTimeout>;
}

export function fotosApiPlugin(): Plugin {
    const pending = new Map<string, PendingRequest>();
    let counter = 0;

    function nextId(): string {
        return `req-${++counter}-${Date.now()}`;
    }

    return {
        name: 'fotos-api',
        configureServer(server: ViteDevServer) {
            // Listen for responses from browser via HMR
            server.hot.on('fotos:api-response', (data: any) => {
                const { id, ...result } = data;
                const entry = pending.get(id);
                if (entry) {
                    clearTimeout(entry.timer);
                    pending.delete(id);
                    entry.resolve(result);
                }
            });

            server.hot.on('fotos:ready', (data: any) => {
                console.log(`[fotos-api] Browser ready, plans: ${data.plans?.join(', ')}`);
            });

            // HTTP middleware: POST /api/:handler/:method
            server.middlewares.use('/api', async (req, res, next) => {
                if (req.method !== 'POST' && req.method !== 'GET') return next();

                const url = req.url ?? '';
                const parts = url.split('/').filter(Boolean);
                if (parts.length < 2) return next();

                const [handler, method] = parts;

                // Read body for POST
                let params: any = {};
                if (req.method === 'POST') {
                    const chunks: Buffer[] = [];
                    for await (const chunk of req) chunks.push(chunk as Buffer);
                    const body = Buffer.concat(chunks).toString();
                    if (body) {
                        try { params = JSON.parse(body); } catch { /* empty */ }
                    }
                }

                // Send to browser via HMR
                const id = nextId();
                const result = await new Promise<any>((resolve) => {
                    const timer = setTimeout(() => {
                        pending.delete(id);
                        resolve({ success: false, error: { code: 'TIMEOUT', message: `${handler}.${method} timed out (120s)` } });
                    }, 120_000);
                    pending.set(id, { resolve, timer });
                    server.hot.send('fotos:api-request', { id, handler, method, params });
                });

                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(JSON.stringify(result, null, 2));
            });
        },
    };
}
