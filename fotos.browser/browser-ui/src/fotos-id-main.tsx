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

// Placeholder until FotosIdPopup.tsx is created in Task 2
function FotosIdPopup() {
  return (
    <div style={{ padding: '1.5rem', maxWidth: 420, margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem', textAlign: 'center' }}>
        Create fotos id
      </h2>
      <p style={{ color: '#aaa', textAlign: 'center' }}>Loading...</p>
    </div>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<FotosIdPopup />);
}
