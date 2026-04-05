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

// Debugging: window.__api('fotos', 'status') or window.__api('fotos', 'init')
(window as any).__planRegistry = planRegistry;
(window as any).__operationRegistry = planRegistry;
(window as any).__api = async (operation: string, method: string, params?: any) => {
    const result = await planRegistry.call(operation, method, params);
    if (!result.success) throw new Error(result.error?.message);
    return result.data;
};

// Keep glue.core aligned with fotos.browser runtime config.
initGlueCore({ apiBase: API_BASE });

const startupUrl = new URL(window.location.href);
if (startupUrl.searchParams.has(SERVICE_WORKER_RELOAD_PARAM)) {
    startupUrl.searchParams.delete(SERVICE_WORKER_RELOAD_PARAM);
    window.history.replaceState({}, '', startupUrl.toString());
}

startServiceWorkerUpdates();

// ── HMR bridge (dev only) — canonical GET /api + POST /api/:operation/:method ──
if (import.meta.hot) {
    import.meta.hot.on('fotos:api-request', async (msg: { id: string; operation?: string; handler?: string; method: string; params?: any }) => {
        try {
            const operation = msg.operation ?? msg.handler;
            if (!operation) {
                throw new Error('Missing operation name');
            }
            const result = await planRegistry.call(operation, msg.method, msg.params);
            import.meta.hot!.send('fotos:api-response', { id: msg.id, ...result });
        } catch (err) {
            import.meta.hot!.send('fotos:api-response', {
                id: msg.id,
                success: false,
                error: { code: 'BRIDGE_ERROR', message: String(err) },
            });
        }
    });

    import.meta.hot.on('fotos:api-discovery-request', (msg: { id: string }) => {
        import.meta.hot!.send('fotos:api-discovery-response', {
            id: msg.id,
            payload: createPublicOperationCatalogPayload(planRegistry),
        });
    });

    import.meta.hot.send('fotos:ready', {
        operations: planRegistry.listOperations(),
        payload: createPublicOperationCatalogPayload(planRegistry),
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
