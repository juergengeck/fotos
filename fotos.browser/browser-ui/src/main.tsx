// Load ONE.core browser platform (must be first — side-effect imports)
import '@refinio/one.core/lib/system/load-browser.js';
import '@refinio/one.core/lib/system/browser/crypto-helpers.js';
import '@refinio/one.core/lib/system/browser/crypto-scrypt.js';
import '@refinio/one.core/lib/system/browser/settings-store.js';
import '@refinio/one.core/lib/system/browser/storage-base.js';
import '@refinio/one.core/lib/system/browser/storage-base-delete-file.js';
import '@refinio/one.core/lib/system/browser/storage-streams.js';

import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { initGlueCore } from '@glueone/glue.core';
import { createPlanRegistry, createPublicOperationCatalogPayload } from '@/lib/PlanRegistry';
import { FotosPlan } from '@/lib/FotosPlan';
import { fotosLLMPlan } from '@/lib/FotosLLMPlan';
import { bootFotosModel } from './lib/onecore-boot';
import { installHangTrace, traceHang } from './lib/hangTrace';
import { getRuntimeBrowserCryptoSupport } from './lib/browserCryptoSupport';
import {
    SERVICE_WORKER_RELOAD_PARAM,
    startServiceWorkerUpdates,
} from './lib/serviceWorkerUpdates';
import { API_BASE } from './config';
import { App } from './App';
import './index.css';

// ── PlanRegistry ────────────────────────────────────────────────────
const planRegistry = createPlanRegistry();
const fotosPlan = new FotosPlan();
planRegistry.register('fotos', fotosPlan, {category: 'analytics', description: 'Face detection and image analytics'});
planRegistry.register('fotosAI', fotosLLMPlan, { category: 'analytics', description: 'Local LLM comparison and analytics auditing' });

// Debugging: window.__api('fotos', 'status') or window.__api('fotos', 'init')
(window as any).__planRegistry = planRegistry;
(window as any).__operationRegistry = planRegistry;
(window as any).__api = async (operation: string, method: string, params?: any) => {
    const result = await planRegistry.call(operation, method, params);
    if (!result.success) throw new Error(result.error?.message);
    return result.data;
};

initGlueCore({
    apiBase: API_BASE,
});

const startupUrl = new URL(window.location.href);
if (startupUrl.searchParams.has(SERVICE_WORKER_RELOAD_PARAM)) {
    startupUrl.searchParams.delete(SERVICE_WORKER_RELOAD_PARAM);
    window.history.replaceState({}, '', startupUrl.toString());
}

startServiceWorkerUpdates();

// ── HMR bridge (dev only) — canonical GET /api + POST /api/:operation/:method ──
if (import.meta.hot) {
    const browserApiClientId = typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `fotos-browser-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const READY_HEARTBEAT_MS = 15_000;

    const announceReady = () => {
        import.meta.hot!.send('fotos:ready', {
            clientId: browserApiClientId,
            location: window.location.href,
            operations: planRegistry.listOperations(),
            payload: createPublicOperationCatalogPayload(planRegistry),
        });
    };

    import.meta.hot.on('fotos:api-request', async (msg: {
        id: string;
        targetClientId?: string;
        operation?: string;
        handler?: string;
        method: string;
        params?: any;
    }) => {
        if (msg.targetClientId && msg.targetClientId !== browserApiClientId) {
            return;
        }
        try {
            const operation = msg.operation ?? msg.handler;
            if (!operation) {
                throw new Error('Missing operation name');
            }
            const result = await planRegistry.call(operation, msg.method, msg.params);
            import.meta.hot!.send('fotos:api-response', { id: msg.id, clientId: browserApiClientId, ...result });
        } catch (err) {
            import.meta.hot!.send('fotos:api-response', {
                id: msg.id,
                clientId: browserApiClientId,
                success: false,
                error: { code: 'BRIDGE_ERROR', message: String(err) },
            });
        }
    });

    import.meta.hot.on('fotos:api-discovery-request', (msg: { id: string; targetClientId?: string }) => {
        if (msg.targetClientId && msg.targetClientId !== browserApiClientId) {
            return;
        }
        import.meta.hot!.send('fotos:api-discovery-response', {
            id: msg.id,
            clientId: browserApiClientId,
            payload: createPublicOperationCatalogPayload(planRegistry),
        });
    });

    announceReady();

    const readyHeartbeat = window.setInterval(() => {
        announceReady();
    }, READY_HEARTBEAT_MS);

    import.meta.hot.dispose(() => {
        window.clearInterval(readyHeartbeat);
    });
}

// ── Boot ONE.core, then render ──────────────────────────────────────
const rootElement = document.getElementById('root')!;
installHangTrace('fotos.browser');

const statusEl = document.createElement('div');
statusEl.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#111;color:#666;font:14px system-ui;padding:24px;text-align:center;white-space:pre-wrap';
rootElement.appendChild(statusEl);
const cryptoSupport = getRuntimeBrowserCryptoSupport();
(window as any).__fotosCryptoSupport = cryptoSupport;

if (!cryptoSupport.supported) {
    statusEl.textContent = cryptoSupport.message ?? 'Boot blocked: browser crypto support is unavailable.';
    traceHang('boot-blocked-crypto', {
        message: cryptoSupport.message,
        origin: globalThis.location?.origin ?? null,
        secureContext: globalThis.isSecureContext ?? null,
    });
    console.error('[fotos] boot blocked:', cryptoSupport.message);
} else {
    bootFotosModel((msg) => {
        statusEl.textContent = msg;
        traceHang('boot-status', { msg });
    })
        .then((model) => {
            traceHang('boot-complete', {
                ownerId: model.ownerId,
                publicationIdentity: model.publicationIdentity,
            });
            rootElement.removeChild(statusEl);
            ReactDOM.createRoot(rootElement).render(
                <StrictMode>
                    <App fotosModel={model} />
                </StrictMode>
            );
        })
        .catch((err) => {
            statusEl.textContent = `Boot failed: ${err.message}`;
            traceHang('boot-failed', { message: err.message });
            console.error('[fotos] boot failed:', err);
        });
}
