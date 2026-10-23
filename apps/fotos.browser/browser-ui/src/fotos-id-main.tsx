/**
 * Fotos id popup entry point — lightweight, does NOT boot full fotos model.
 *
 * Only loads ONE.core browser platform (for crypto/key derivation) and renders
 * the FotosIdPopup component which handles the postMessage protocol.
 */

// Polyfills
if (typeof globalThis.setImmediate === 'undefined') {
  (globalThis as any).setImmediate = (fn: (...args: any[]) => void, ...args: any[]) => setTimeout(fn, 0, ...args);
  (globalThis as any).clearImmediate = (id: number) => clearTimeout(id);
}

import ReactDOM from 'react-dom/client';
import { FotosIdPopup } from './FotosIdPopup.js';

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<FotosIdPopup />);
}
