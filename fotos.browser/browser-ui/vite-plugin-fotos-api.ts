/**
 * Vite plugin: HTTP → HMR bridge for the browser-side OperationRegistry.
 *
 * Exposes the canonical refinio.api contract in dev mode:
 *   curl http://localhost:5188/api
 *   curl -X POST http://localhost:5188/api/fotos/status
 *   curl -X POST http://localhost:5188/api/fotos/init
 *   curl -X POST http://localhost:5188/api/introspection/listOperations
 */

import type { Plugin, ViteDevServer } from 'vite';

interface PendingRequest {
    resolve: (value: any) => void;
    timer: ReturnType<typeof setTimeout>;
}

export function fotosApiPlugin(): Plugin {
    const pending = new Map<string, PendingRequest>();
    let discoveryPayload: { handlers: Array<{ name: string }> } | null = null;
    let counter = 0;

    function nextId(): string {
        return `req-${++counter}-${Date.now()}`;
    }

    function resolvePending(id: string, value: any): void {
        const entry = pending.get(id);
        if (!entry) {
            return;
        }

        clearTimeout(entry.timer);
        pending.delete(id);
        entry.resolve(value);
    }

    return {
        name: 'fotos-api',
        configureServer(server: ViteDevServer) {
            // Listen for responses from browser via HMR
            server.hot.on('fotos:api-response', (data: any) => {
                const { id, ...result } = data;
                resolvePending(id, result);
            });

            server.hot.on('fotos:api-discovery-response', (data: any) => {
                const { id, payload } = data;
                if (payload) {
                    discoveryPayload = payload;
                }
                resolvePending(id, payload ?? { handlers: [] });
            });

            server.hot.on('fotos:ready', (data: any) => {
                if (data.payload) {
                    discoveryPayload = data.payload;
                }
                const operationNames =
                    data.operations ??
                    discoveryPayload?.handlers?.map((handler) => handler.name) ??
                    [];
                console.log(`[fotos-api] Browser ready, operations: ${operationNames.join(', ')}`);
            });

            async function requestBrowser(event: string, payload: Record<string, unknown>, timeoutMessage: string): Promise<any> {
                const id = nextId();
                return new Promise<any>((resolve) => {
                    const timer = setTimeout(() => {
                        pending.delete(id);
                        resolve({
                            success: false,
                            error: { code: 'TIMEOUT', message: timeoutMessage },
                        });
                    }, 120_000);
                    pending.set(id, { resolve, timer });
                    server.hot.send(event, { id, ...payload });
                });
            }

            // HTTP middleware: GET /api and POST /api/:operation/:method
            server.middlewares.use('/api', async (req, res, next) => {
                const url = req.url ?? '';
                const path = url.split('?')[0] ?? '';

                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Cache-Control', 'no-store');

                if (req.method === 'OPTIONS') {
                    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
                    res.statusCode = 204;
                    res.end();
                    return;
                }

                if (req.method === 'GET' && (path === '' || path === '/')) {
                    const payload =
                        discoveryPayload ??
                        await requestBrowser(
                            'fotos:api-discovery-request',
                            {},
                            'GET /api timed out waiting for browser discovery payload (120s)',
                        );

                    res.setHeader('Content-Type', 'application/json');
                    if (payload?.success === false && payload?.error) {
                        res.statusCode = 503;
                        res.end(JSON.stringify(payload, null, 2));
                        return;
                    }

                    res.end(JSON.stringify(payload ?? { handlers: [] }, null, 2));
                    return;
                }

                if (req.method !== 'POST') {
                    return next();
                }

                const parts = path.split('/').filter(Boolean);
                if (parts.length < 2) return next();

                const [operation, method] = parts;

                // Read body for POST
                let params: any = {};
                const chunks: Buffer[] = [];
                for await (const chunk of req) chunks.push(chunk as Buffer);
                const body = Buffer.concat(chunks).toString();
                if (body) {
                    try { params = JSON.parse(body); } catch { /* ignore invalid JSON */ }
                }

                // Send to browser via HMR
                const result = await requestBrowser(
                    'fotos:api-request',
                    { operation, method, params },
                    `${operation}.${method} timed out (120s)`,
                );

                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(result, null, 2));
            });
        },
    };
}
