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
import {resolveFotosApiTarget} from './src/lib/fotosApiTarget.js';

interface PendingRequest {
    resolve: (value: any) => void;
    timer: ReturnType<typeof setTimeout>;
    targetClientId: string | null;
}

interface BrowserClientInfo {
    clientId: string;
    location: string | null;
    operations: string[];
    lastReadyAt: string;
}

interface QaReadyWaiter {
    expectedPersonId: string;
    resolve: (value: any) => void;
    timer: ReturnType<typeof setTimeout>;
}

export function fotosApiPlugin(): Plugin {
    const CLIENT_STALE_AFTER_MS = 45_000;
    const pending = new Map<string, PendingRequest>();
    let discoveryPayload: { handlers: Array<{ name: string }> } | null = null;
    let activeClientId: string | null = null;
    const clients = new Map<string, BrowserClientInfo>();
    const qaReadyWaiters = new Map<string, QaReadyWaiter>();
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

    function isPreferredClientLocation(location: string | null | undefined): boolean {
        return location === 'http://localhost:5173/'
            || location === 'http://127.0.0.1:5173/';
    }

    function pruneStaleClients(): void {
        const now = Date.now();
        for (const [clientId, client] of clients.entries()) {
            const lastReadyAt = Date.parse(client.lastReadyAt);
            if (Number.isNaN(lastReadyAt) || (now - lastReadyAt) > CLIENT_STALE_AFTER_MS) {
                clients.delete(clientId);
                if (activeClientId === clientId) {
                    activeClientId = null;
                }
            }
        }
    }

    function listClients(): BrowserClientInfo[] {
        pruneStaleClients();
        return Array.from(clients.values()).sort((left, right) =>
            right.lastReadyAt.localeCompare(left.lastReadyAt)
            || left.clientId.localeCompare(right.clientId),
        );
    }

    function resolveTargetClient(explicitClientId?: string | null) {
        const preferredClient = listClients().find((client) => isPreferredClientLocation(client.location));
        const [fallbackClient] = preferredClient ? [] : listClients();
        const resolution = resolveFotosApiTarget({
            explicitClientId,
            activeClientId,
            clientIds: Array.from(clients.keys()),
            fallbackClientId: preferredClient?.clientId ?? fallbackClient?.clientId ?? null,
        });
        if (!explicitClientId && resolution.clientId) {
            activeClientId = resolution.clientId;
        }
        return resolution;
    }

    function resolveTargetClientId(explicitClientId?: string | null): string | null {
        return resolveTargetClient(explicitClientId).clientId;
    }

    return {
        name: 'fotos-api',
        configureServer(server: ViteDevServer) {
            // Listen for responses from browser via HMR
            server.hot.on('fotos:api-response', (data: any) => {
                const { id, clientId, ...result } = data;
                const entry = pending.get(id);
                if (!entry) {
                    return;
                }
                if (entry.targetClientId && entry.targetClientId !== clientId) {
                    return;
                }
                resolvePending(id, result);
            });

            server.hot.on('fotos:api-discovery-response', (data: any) => {
                const { id, clientId, payload } = data;
                const entry = pending.get(id);
                if (!entry) {
                    return;
                }
                if (entry.targetClientId && entry.targetClientId !== clientId) {
                    return;
                }
                if (payload) {
                    discoveryPayload = payload;
                }
                resolvePending(id, payload ?? { handlers: [] });
            });

            server.hot.on('fotos:ready', (data: any) => {
                const clientId = typeof data.clientId === 'string' ? data.clientId : null;
                if (clientId) {
                    clients.set(clientId, {
                        clientId,
                        location: typeof data.location === 'string' ? data.location : null,
                        operations: Array.isArray(data.operations)
                            ? data.operations.filter((operation): operation is string => typeof operation === 'string')
                            : [],
                        lastReadyAt: new Date().toISOString(),
                    });

                    if (
                        activeClientId === null
                        || isPreferredClientLocation(data.location)
                        || activeClientId === clientId
                    ) {
                        activeClientId = clientId;
                    }
                }

                if (data.payload) {
                    discoveryPayload = data.payload;
                }
                const operationNames =
                    data.operations ??
                    discoveryPayload?.handlers?.map((handler) => handler.name) ??
                    [];
                console.log(`[fotos-api] Browser ready (${activeClientId ?? 'unknown client'}): ${operationNames.join(', ')}`);
            });

            server.hot.on('fotos:qa-ready', (data: any) => {
                const clientId = typeof data.clientId === 'string' ? data.clientId : '';
                const waiter = qaReadyWaiters.get(clientId);
                if (!waiter || data.publicationIdentity !== waiter.expectedPersonId) {
                    return;
                }
                clearTimeout(waiter.timer);
                qaReadyWaiters.delete(clientId);
                waiter.resolve({
                    success: true,
                    data: {
                        clientId,
                        publicationIdentity: data.publicationIdentity,
                        location: typeof data.location === 'string' ? data.location : null,
                        reloaded: true,
                    },
                });
            });

            async function requestBrowser(
                event: string,
                payload: Record<string, unknown>,
                timeoutMessage: string,
                explicitClientId?: string | null,
            ): Promise<any> {
                const id = nextId();
                const target = resolveTargetClient(explicitClientId);
                if (target.explicitClientMissing) {
                    return {
                        success: false,
                        error: {
                            code: 'CLIENT_NOT_FOUND',
                            message: `Fotos browser client '${explicitClientId}' is not connected`,
                        },
                    };
                }
                const targetClientId = target.clientId;
                if (!targetClientId) {
                    return {
                        success: false,
                        error: {
                            code: 'NO_BROWSER_CLIENT',
                            message: 'No Fotos browser client is connected',
                        },
                    };
                }
                return new Promise<any>((resolve) => {
                    const timer = setTimeout(() => {
                        pending.delete(id);
                        resolve({
                            success: false,
                            error: { code: 'TIMEOUT', message: timeoutMessage },
                        });
                    }, 120_000);
                    pending.set(id, { resolve, timer, targetClientId });
                    server.hot.send(event, { id, targetClientId, ...payload });
                });
            }

            function reloadBrowserClient(
                clientId: string,
                expectedPersonId: string,
            ): Promise<any> {
                const existing = qaReadyWaiters.get(clientId);
                if (existing) {
                    clearTimeout(existing.timer);
                    existing.resolve({
                        success: false,
                        error: {
                            code: 'RELOAD_REPLACED',
                            message: `A newer reload replaced the pending reload for ${clientId}`,
                        },
                    });
                }

                return new Promise(resolve => {
                    const timer = setTimeout(() => {
                        qaReadyWaiters.delete(clientId);
                        resolve({
                            success: false,
                            error: {
                                code: 'RELOAD_TIMEOUT',
                                message: `Fotos browser client '${clientId}' did not reload with identity '${expectedPersonId}' within 120s`,
                            },
                        });
                    }, 120_000);
                    qaReadyWaiters.set(clientId, {expectedPersonId, resolve, timer});
                    server.hot.send('fotos:reload-client', {targetClientId: clientId});
                });
            }

            // HTTP middleware: GET /api and POST /api/:operation/:method
            server.middlewares.use('/api', async (req, res, next) => {
                const url = req.url ?? '';
                const requestUrl = new URL(url, 'http://localhost');
                const path = requestUrl.pathname ?? '';
                const explicitClientId = requestUrl.searchParams.get('clientId');

                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Cache-Control', 'no-store');

                if (req.method === 'OPTIONS') {
                    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
                    res.statusCode = 204;
                    res.end();
                    return;
                }

                if (req.method === 'GET' && path === '/clients') {
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({
                        activeClientId: resolveTargetClientId(explicitClientId),
                        clients: listClients(),
                    }, null, 2));
                    return;
                }

                if (req.method === 'GET' && (path === '' || path === '/')) {
                    const payload =
                        discoveryPayload ??
                        await requestBrowser(
                            'fotos:api-discovery-request',
                            {},
                            'GET /api timed out waiting for browser discovery payload (120s)',
                            explicitClientId,
                        );

                    res.setHeader('Content-Type', 'application/json');
                    if (payload?.success === false && payload?.error) {
                        res.statusCode = 503;
                        res.end(JSON.stringify(payload, null, 2));
                        return;
                    }

                    res.end(JSON.stringify({
                        ...(payload ?? { handlers: [] }),
                        activeClientId: resolveTargetClientId(explicitClientId),
                        clients: listClients(),
                    }, null, 2));
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
                let result = await requestBrowser(
                    'fotos:api-request',
                    { operation, method, params },
                    `${operation}.${method} timed out (120s)`,
                    explicitClientId,
                );
                if (operation === 'fotos-qa' && method === 'reloadPreparedIdentity' && result?.success) {
                    const target = resolveTargetClient(explicitClientId);
                    const expectedPersonId = typeof params?.expectedPersonId === 'string'
                        ? params.expectedPersonId.trim()
                        : '';
                    if (!explicitClientId || !target.clientId || !expectedPersonId) {
                        result = {
                            success: false,
                            error: {
                                code: 'INVALID_RELOAD_REQUEST',
                                message: 'reloadPreparedIdentity requires an exact clientId and expectedPersonId',
                            },
                        };
                    } else {
                        result = await reloadBrowserClient(target.clientId, expectedPersonId);
                    }
                }

                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(result, null, 2));
            });
        },
    };
}
