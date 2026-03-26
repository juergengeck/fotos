/**
 * Fotos id popup — handles photo-based identity creation and recovery for external apps.
 *
 * Protocol (mirrors AuthPopup.tsx in glue.browser):
 * 1. Popup sends { type: 'fotos-id-ready' } to window.opener
 * 2. Opener sends { type: 'fotos-id-request', requestId, mode, ... }
 * 3. Popup walks user through photo key derivation + name entry
 * 4. Create mode registers identity on glue.one API (authority-signed cert → counter-signed)
 * 5. Recover mode derives the recovery key and returns it to the opener
 * 6. Popup sends { type: 'fotos-id-result', requestId, success, data?, error? } back
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { deriveKeyFromPhotos, deriveRecoveryKeyCandidatesFromPhotos } from '@/lib/photo-key-derivation.js';
import { sign, ensureSecretSignKey } from '@refinio/one.core/lib/crypto/sign.js';
import { uint8arrayToHexString } from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import { serializeRecoveryPrivateKey, selectRegistrarVerifiedRecoveryCandidate } from '@/lib/fotos-recovery.js';
import { API_BASE } from '@/config.js';

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

/** Normalize display name → glue.one identity (e.g. "Alice" → "alice@glue.one"). */
function nameToIdentity(displayName: string): string {
  return displayName.toLowerCase().replace(/[^a-z0-9]/g, '') + '@glue.one';
}

type PopupPhase = 'waiting' | 'setup' | 'done' | 'error';
type FotosIdMode = 'create' | 'recover';

function getQueryMode(): FotosIdMode {
  const mode = new URLSearchParams(window.location.search).get('mode');
  return mode === 'recover' ? 'recover' : 'create';
}

function getQueryDisplayName(): string {
  return new URLSearchParams(window.location.search).get('displayName') ?? '';
}

interface PopupRequest {
  requestId: string;
  mode: FotosIdMode;
  displayName?: string;
  personPublicKey?: string;
}

export function FotosIdPopup() {
  const [phase, setPhase] = useState<PopupPhase>('waiting');
  const [mode, setMode] = useState<FotosIdMode>(() => getQueryMode());
  const [initialDisplayName, setInitialDisplayName] = useState(() => getQueryDisplayName());
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<PopupRequest | null>(null);
  const openerOriginRef = useRef<string>('');
  const handledRef = useRef(false);

  useEffect(() => {
    document.title = mode === 'recover'
      ? 'fotos.one — Recover fotos id'
      : 'fotos.one — Create fotos id';
  }, [mode]);

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
        if (handledRef.current) return;
        handledRef.current = true;
        openerOriginRef.current = event.origin;
        const nextMode: FotosIdMode = data.mode === 'recover' ? 'recover' : 'create';
        setMode(nextMode);
        setInitialDisplayName(typeof data.displayName === 'string' ? data.displayName : '');
        requestRef.current = {
          requestId: data.requestId,
          mode: nextMode,
          displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
          personPublicKey: data.personPublicKey,
        };
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

  const handleCompleted = useCallback((data: {
    mode: FotosIdMode;
    identity: string;
    displayName: string;
    publicKey: string;
    cert?: unknown;
    privateKey?: string;
    candidatePrivateKeys?: string[];
  }) => {
    setPhase('done');
    sendResult({ success: true, data });
  }, [sendResult]);

  return (
    <div style={{ padding: '1.5rem', maxWidth: 420, margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem', textAlign: 'center' }}>
        {mode === 'recover' ? 'Recover fotos id' : 'Create fotos id'}
      </h2>

      {phase === 'waiting' && (
        <p style={{ color: '#aaa', textAlign: 'center' }}>Connecting...</p>
      )}

      {phase === 'setup' && (
        <FotosIdSetupForm
          mode={mode}
          initialDisplayName={initialDisplayName}
          personPublicKey={requestRef.current?.personPublicKey}
          onCreated={handleCompleted}
        />
      )}

      {phase === 'done' && (
        <p style={{ color: '#4ade80', textAlign: 'center' }}>
          {mode === 'recover' ? 'Identity recovered! Closing...' : 'Identity created! Closing...'}
        </p>
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

// ── Setup form — name + photo selection + PIN + derivation + registration ──

type SetupStep = 'name' | 'photos' | 'creating';

interface SelectedImage {
  file: File;
  thumbnailUrl: string;
}

// Shared inline styles
const styles = {
  input: {
    width: '100%',
    padding: '8px 10px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: '#eee',
    fontSize: '13px',
    outline: 'none',
  } as React.CSSProperties,
  button: {
    width: '100%',
    padding: '10px',
    border: 'none',
    borderRadius: 6,
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.15s',
  } as React.CSSProperties,
  primaryButton: {
    background: '#e94560',
    color: '#fff',
  } as React.CSSProperties,
  secondaryButton: {
    background: 'rgba(255,255,255,0.05)',
    color: 'rgba(255,255,255,0.5)',
  } as React.CSSProperties,
  disabledButton: {
    opacity: 0.4,
    cursor: 'not-allowed',
  } as React.CSSProperties,
  label: {
    display: 'block',
    fontSize: '10px',
    color: 'rgba(255,255,255,0.3)',
    marginBottom: 4,
  } as React.CSSProperties,
  hint: {
    fontSize: '10px',
    lineHeight: '1.5',
    color: 'rgba(255,255,255,0.3)',
    marginBottom: 8,
  } as React.CSSProperties,
  error: {
    fontSize: '11px',
    color: '#ff6b6b',
    marginTop: 6,
  } as React.CSSProperties,
  section: {
    marginBottom: 12,
  } as React.CSSProperties,
} as const;

function FotosIdSetupForm(props: {
  mode: FotosIdMode;
  initialDisplayName?: string;
  personPublicKey?: string;
  onCreated: (data: {
    mode: FotosIdMode;
    identity: string;
    displayName: string;
    publicKey: string;
    cert?: unknown;
    privateKey?: string;
    candidatePrivateKeys?: string[];
  }) => void;
}) {
  const { mode, initialDisplayName = '', personPublicKey, onCreated } = props;

  const [step, setStep] = useState<SetupStep>('name');

  // Name state
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [nameStatus, setNameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'error'>('idle');
  const [nameError, setNameError] = useState<string | null>(null);
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Photo state
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [pin, setPin] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragIndexRef = useRef<number | null>(null);

  // Creation state
  const [progress, setProgress] = useState('');
  const [creationError, setCreationError] = useState<string | null>(null);

  // ── Name availability check (debounced) ──────────────────────────────

  const checkNameAvailability = useCallback(async (name: string) => {
    const localPart = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (localPart.length < 2) {
      setNameStatus('idle');
      return;
    }

    setNameStatus('checking');
    setNameError(null);

    try {
      const identity = nameToIdentity(name);
      const res = await fetch(
        `${API_BASE}/api/registration/check/${encodeURIComponent(identity)}`,
      );

      if (!res.ok) {
        setNameStatus('error');
        setNameError(mode === 'recover' ? 'Could not check whether this identity exists' : 'Could not check availability');
        return;
      }

      const result = await res.json();
      const available = result.available ?? result.data?.available ?? true;
      setNameStatus(available ? 'available' : 'taken');
    } catch {
      setNameStatus('error');
      setNameError(mode === 'recover' ? 'Network error checking identity' : 'Network error checking name');
    }
  }, [mode]);

  const handleNameChange = useCallback((value: string) => {
    setDisplayName(value);
    setNameStatus('idle');
    setNameError(null);

    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);

    const localPart = value.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (localPart.length >= 2) {
      checkTimerRef.current = setTimeout(() => checkNameAvailability(value), 400);
    }
  }, [checkNameAvailability]);

  useEffect(() => {
    setDisplayName(initialDisplayName);
    setNameStatus('idle');
    setNameError(null);

    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);

    const localPart = initialDisplayName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (localPart.length >= 2) {
      checkTimerRef.current = setTimeout(() => checkNameAvailability(initialDisplayName), 0);
    }
  }, [checkNameAvailability, initialDisplayName]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    };
  }, []);

  const canProceedToPhotos =
    displayName.trim().length >= 2 &&
    (mode === 'recover' ? nameStatus === 'taken' : nameStatus === 'available');

  // ── Photo handling ───────────────────────────────────────────────────

  const handlePickPhotos = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFilesSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newImages: SelectedImage[] = [];
    for (const file of files) {
      newImages.push({ file, thumbnailUrl: URL.createObjectURL(file) });
    }
    setImages(prev => [...prev, ...newImages]);
    e.target.value = '';
  }, []);

  const handleRemoveImage = useCallback((index: number) => {
    setImages(prev => {
      const next = [...prev];
      URL.revokeObjectURL(next[index]!.thumbnailUrl);
      next.splice(index, 1);
      return next;
    });
  }, []);

  const handleDragStart = useCallback((index: number) => {
    dragIndexRef.current = index;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndexRef.current === null || dragIndexRef.current === index) return;
    setImages(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIndexRef.current!, 1);
      next.splice(index, 0, moved!);
      dragIndexRef.current = index;
      return next;
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    dragIndexRef.current = null;
  }, []);

  // ── Create or recover identity ───────────────────────────────────────

  const canCreate = images.length > 0 && pin.length === 8;

  const handleCreate = useCallback(async () => {
    if (!canCreate) return;

    setStep('creating');
    setCreationError(null);

    try {
      // 1. Read photo bytes
      setProgress('Reading photos...');
      const imageBytes: Uint8Array[] = [];
      for (const img of images) {
        const buf = await img.file.arrayBuffer();
        imageBytes.push(new Uint8Array(buf));
      }

      // 2. Derive fotos ID root keypair from photos + PIN
      setProgress('Deriving key (this takes a few seconds)...');
      const identity = nameToIdentity(displayName);
      if (mode === 'recover') {
        const recoveryCandidates = await deriveRecoveryKeyCandidatesFromPhotos({ images: imageBytes, pin });
        const verifiedCandidate = await selectRegistrarVerifiedRecoveryCandidate(identity, recoveryCandidates);

        for (const img of images) {
          URL.revokeObjectURL(img.thumbnailUrl);
        }

        onCreated({
          mode,
          identity,
          displayName: displayName.trim(),
          publicKey: verifiedCandidate.publicKey,
          privateKey: verifiedCandidate.privateKey,
        });
        return;
      }

      const derived = await deriveKeyFromPhotos({ images: imageBytes, pin });
      const fotosRootPublicKeyHex = uint8arrayToHexString(derived.publicKey);
      const localPart = displayName.toLowerCase().replace(/[^a-z0-9]/g, '');

      // 3. Build cert: fotos root (L1) signs the browser's person key
      // Subject = browser's existing person public sign key
      // Issuer = fotos root public key (derived from photos+PIN)
      setProgress('Building certificate...');
      if (!personPublicKey) {
        throw new Error('No person public key received from opener');
      }
      const now = Date.now();

      const certPayload = {
        $type$: 'SubscriptionCertificate' as const,
        id: identity,
        certificateType: 'identity' as const,
        status: 'valid',
        subject: personPublicKey,
        subjectPublicKey: personPublicKey,
        issuer: fotosRootPublicKeyHex,
        issuerPublicKey: fotosRootPublicKeyHex,
        validFrom: now,
        validUntil: now + 7 * 24 * 60 * 60 * 1000,
        chainDepth: 0,
        claims: {
          identity,
          domain: 'glue.one',
          localPart,
          tier: 'user',
          priceEur: 0,
          subscriptionStatus: 'preliminary' as const,
          paymentId: '',
          depositAmount: 0,
          autoRenew: false,
          service: 'Identity attestation and verification',
        },
        issuedAt: now,
        serialNumber: `fotosid-${now}`,
      };

      const payload = JSON.stringify(certPayload);
      const signatureBytes = sign(
        new TextEncoder().encode(payload),
        ensureSecretSignKey(derived.secretKey),
      );
      const cert = { ...certPayload, signature: uint8arrayToHexString(signatureBytes) };

      // 4. Register on glue.one API
      setProgress('Registering identity...');
      const res = await fetch(`${API_BASE}/api/registration/registerName`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cert, instanceEncryptionKey: '' }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => 'Unknown error');
        if (res.status === 409) {
          throw new Error('Name is already taken');
        }
        throw new Error(`Registration failed: ${res.status} ${text}`);
      }

      // 5. Clean up thumbnails
      for (const img of images) {
        URL.revokeObjectURL(img.thumbnailUrl);
      }

      // 6. Return result to opener
      onCreated({
        mode,
        identity,
        displayName: displayName.trim(),
        cert,
        publicKey: fotosRootPublicKeyHex,
        privateKey: serializeRecoveryPrivateKey(derived.secretKey),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : mode === 'recover' ? 'Identity recovery failed' : 'Identity creation failed';
      setCreationError(msg);
      setStep('photos');
      // Don't call onError — let user retry. onError sends a terminal failure to opener.
    }
  }, [canCreate, displayName, images, mode, onCreated, pin]);

  // ── Render ───────────────────────────────────────────────────────────

  if (step === 'creating') {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 24, height: 24, border: '2px solid rgba(255,255,255,0.15)',
          borderTopColor: '#e94560', borderRadius: '50%',
          margin: '0 auto 12px', animation: 'spin 0.8s linear infinite',
        }} />
        <p style={{ color: '#aaa', fontSize: '12px' }}>{progress}</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div>
      {/* ── Step 1: Display name ──────────────────────────────────────── */}
      {step === 'name' && (
        <div>
          <div style={styles.hint}>
            {mode === 'recover'
              ? 'Enter the glue.one name you want to recover. We will re-derive the same key from your photos and PIN.'
              : 'Choose a display name for your fotos id. This will be your identity on glue.one.'}
          </div>

          <div style={styles.section}>
            <label style={styles.label}>Display name</label>
            <input
              type="text"
              placeholder="e.g. Alice"
              value={displayName}
              onChange={e => handleNameChange(e.target.value)}
              style={styles.input}
              autoFocus
            />

            {/* Identity preview */}
            {displayName.trim().length >= 2 && (
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
                {nameToIdentity(displayName)}
              </div>
            )}

            {/* Availability indicator */}
            {nameStatus === 'checking' && (
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
                Checking availability...
              </div>
            )}
            {nameStatus === 'available' && (
              <div style={{ fontSize: '11px', color: mode === 'recover' ? '#ff6b6b' : '#4ade80', marginTop: 4 }}>
                {mode === 'recover' ? 'No registered identity found for this name' : 'Available'}
              </div>
            )}
            {nameStatus === 'taken' && (
              <div style={{ fontSize: '11px', color: mode === 'recover' ? '#4ade80' : '#ff6b6b', marginTop: 4 }}>
                {mode === 'recover' ? 'Registered identity found' : 'Name is already taken'}
              </div>
            )}
            {nameStatus === 'error' && nameError && (
              <div style={styles.error}>{nameError}</div>
            )}
          </div>

          <button
            onClick={() => setStep('photos')}
            disabled={!canProceedToPhotos}
            style={{
              ...styles.button,
              ...styles.primaryButton,
              ...(!canProceedToPhotos ? styles.disabledButton : {}),
            }}
          >
            Next
          </button>
        </div>
      )}

      {/* ── Step 2: Photos + PIN ──────────────────────────────────────── */}
      {step === 'photos' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <button
              onClick={() => setStep('name')}
              style={{
                background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
                cursor: 'pointer', fontSize: '12px', padding: '4px 8px 4px 0',
              }}
            >
              &larr; Back
            </button>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>
              {nameToIdentity(displayName)}
            </span>
          </div>

          <div style={styles.hint}>
            {mode === 'recover'
              ? 'Pick the same photos in the same order, then enter the same 8-digit PIN. This re-derives the private key for your existing fotos id.'
              : 'Pick photos you will remember and arrange them in order. Then enter a date as your 8-digit PIN. Together these derive your identity key.'}
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleFilesSelected}
          />

          {/* Photo thumbnails with drag-to-reorder */}
          {images.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              {images.map((img, i) => (
                <div
                  key={img.thumbnailUrl}
                  draggable
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={e => handleDragOver(e, i)}
                  onDragEnd={handleDragEnd}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 6px', marginBottom: 2,
                    background: 'rgba(255,255,255,0.03)', borderRadius: 6,
                    cursor: 'grab',
                  }}
                >
                  {/* Drag handle */}
                  <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: '12px', userSelect: 'none' }}>
                    &#x2630;
                  </span>
                  {/* Order number */}
                  <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', width: 14, textAlign: 'right' }}>
                    {i + 1}
                  </span>
                  {/* Thumbnail */}
                  <img
                    src={img.thumbnailUrl}
                    alt=""
                    style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover' }}
                  />
                  {/* File name */}
                  <span style={{
                    fontSize: '10px', color: 'rgba(255,255,255,0.4)',
                    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {img.file.name}
                  </span>
                  {/* Remove button */}
                  <button
                    onClick={() => handleRemoveImage(i)}
                    style={{
                      background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)',
                      cursor: 'pointer', fontSize: '14px', padding: '2px 4px',
                    }}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add photos button */}
          <button
            onClick={handlePickPhotos}
            style={{ ...styles.button, ...styles.secondaryButton, marginBottom: 10 }}
          >
            {images.length === 0 ? 'Pick photos' : 'Add more photos'}
          </button>

          {/* PIN input */}
          {images.length > 0 && (
            <div style={styles.section}>
              <label style={styles.label}>Date PIN (DDMMYYYY)</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={8}
                placeholder="DDMMYYYY"
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                style={{ ...styles.input, fontFamily: 'monospace', letterSpacing: 2 }}
              />
            </div>
          )}

          {/* Error from creation attempt */}
          {creationError && (
            <div style={styles.error}>{creationError}</div>
          )}

          {/* Create / recover button */}
          {canCreate && (
            <button
              onClick={handleCreate}
              style={{ ...styles.button, ...styles.primaryButton, marginTop: 4 }}
            >
              {mode === 'recover' ? 'Recover fotos id' : 'Create fotos id'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
