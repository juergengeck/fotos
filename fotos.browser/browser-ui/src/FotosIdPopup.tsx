/**
 * Fotos id popup — handles photo-based identity creation for external apps.
 *
 * Protocol (mirrors AuthPopup.tsx in glue.browser):
 * 1. Popup sends { type: 'fotos-id-ready' } to window.opener
 * 2. Opener sends { type: 'fotos-id-request', requestId } (no extra data needed)
 * 3. Popup walks user through photo key derivation + name entry
 * 4. Popup registers identity on glue.one API (self-signed cert → counter-signed)
 * 5. Popup sends { type: 'fotos-id-result', requestId, success, data?, error? } back
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// Allowed origins that may open this popup
const ALLOWED_ORIGINS = [
  'https://glue.one',
  'https://vger.one',
  'https://fotos.one',
  'https://seller.glue.one',
];

function isOriginAllowed(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Dev: localhost and LAN
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  if (/^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin)) return true;
  return false;
}

type PopupPhase = 'waiting' | 'setup' | 'creating' | 'done' | 'error';

interface PopupRequest {
  requestId: string;
}

export function FotosIdPopup() {
  const [phase, setPhase] = useState<PopupPhase>('waiting');
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<PopupRequest | null>(null);
  const openerOriginRef = useRef<string>('');

  // Signal readiness to opener
  useEffect(() => {
    if (!window.opener) {
      setPhase('error');
      setError('This page must be opened as a popup');
      return;
    }

    function handleMessage(event: MessageEvent) {
      if (!isOriginAllowed(event.origin)) return;
      if (window.opener && event.source !== window.opener) return;

      const data = event.data;
      if (!data?.requestId) return;

      if (data.type === 'fotos-id-request') {
        openerOriginRef.current = event.origin;
        requestRef.current = { requestId: data.requestId };
        setPhase('setup');
      }
    }

    window.addEventListener('message', handleMessage);
    // Tell opener we're ready
    window.opener.postMessage({ type: 'fotos-id-ready' }, '*');

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Send result back to opener and close
  const sendResult = useCallback((result: { success: boolean; data?: unknown; error?: string }) => {
    if (!window.opener || !requestRef.current) return;
    window.opener.postMessage(
      { type: 'fotos-id-result', requestId: requestRef.current.requestId, ...result },
      openerOriginRef.current,
    );
    if (result.success) {
      setTimeout(() => window.close(), 500);
    }
  }, []);

  // Handle successful identity creation
  const handleIdentityCreated = useCallback((data: {
    identity: string;
    displayName: string;
    cert: unknown;
    publicKey: string;
  }) => {
    setPhase('done');
    sendResult({ success: true, data });
  }, [sendResult]);

  // Handle error
  const handleError = useCallback((err: string) => {
    setPhase('error');
    setError(err);
    sendResult({ success: false, error: err });
  }, [sendResult]);

  return (
    <div style={{ padding: '1.5rem', maxWidth: 420, margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem', textAlign: 'center' }}>
        Create fotos id
      </h2>

      {phase === 'waiting' && (
        <p style={{ color: '#aaa', textAlign: 'center' }}>Connecting...</p>
      )}

      {phase === 'setup' && (
        <FotosIdSetupForm
          onCreated={handleIdentityCreated}
          onError={handleError}
          onPhaseChange={setPhase}
        />
      )}

      {phase === 'creating' && (
        <p style={{ color: '#aaa', textAlign: 'center' }}>Creating identity...</p>
      )}

      {phase === 'done' && (
        <p style={{ color: '#4ade80', textAlign: 'center' }}>Identity created! Closing...</p>
      )}

      {phase === 'error' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#ff6b6b' }}>{error}</p>
          <button
            onClick={() => window.close()}
            style={{
              marginTop: '1rem', padding: '8px 16px', background: '#333',
              border: 'none', borderRadius: 6, color: '#eee', cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

// ── Setup form — name + photo selection + PIN + derivation ────────────

// This component will be implemented in Task 3.
// Placeholder for now:
function FotosIdSetupForm(_props: {
  onCreated: (data: { identity: string; displayName: string; cert: unknown; publicKey: string }) => void;
  onError: (err: string) => void;
  onPhaseChange: (phase: PopupPhase) => void;
}) {
  return <p style={{ color: '#aaa', textAlign: 'center' }}>Setup form placeholder</p>;
}
