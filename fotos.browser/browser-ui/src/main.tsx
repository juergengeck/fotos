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
import { createPlanRegistry } from '@/lib/PlanRegistry';
import { FotosPlan } from '@/lib/FotosPlan';
import { bootFotosModel } from './lib/onecore-boot';
import { installHangTrace, traceHang } from './lib/hangTrace';
import { App } from './App';
import './index.css';

// ── PlanRegistry ────────────────────────────────────────────────────
const planRegistry = createPlanRegistry();
const fotosPlan = new FotosPlan();
planRegistry.register('fotos', fotosPlan, {category: 'analytics', description: 'Face detection and image analytics'});

// Debugging: window.__api('fotos', 'status') or window.__api('fotos', 'init')
(window as any).__planRegistry = planRegistry;
(window as any).__api = async (handler: string, method: string, params?: any) => {
    const result = await planRegistry.call(handler, method, params);
    if (!result.success) throw new Error(result.error?.message);
    return result.data;
};

// ── HMR bridge (dev only) — HTTP /api/:plan/:method → browser PlanRegistry ──
if (import.meta.hot) {
    import.meta.hot.on('fotos:api-request', async (msg: { id: string; handler: string; method: string; params?: any }) => {
        try {
            const result = await planRegistry.call(msg.handler, msg.method, msg.params);
            import.meta.hot!.send('fotos:api-response', { id: msg.id, ...result });
        } catch (err) {
            import.meta.hot!.send('fotos:api-response', {
                id: msg.id,
                success: false,
                error: { code: 'BRIDGE_ERROR', message: String(err) },
            });
        }
    });

    import.meta.hot.send('fotos:ready', { plans: planRegistry.listPlans() });
}

// ── Boot ONE.core, then render ──────────────────────────────────────
const rootElement = document.getElementById('root')!;
installHangTrace('fotos.browser');

const statusEl = document.createElement('div');
statusEl.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#111;color:#666;font:14px system-ui';
rootElement.appendChild(statusEl);

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
