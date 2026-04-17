export const PERSISTENT_KEY = 'fotos_creds';
export const SESSION_KEY = 'fotos_creds_session';
export const DEFAULT_VISITOR_INSTANCE_NAME = 'fotos-visitor';

export interface FotosBootCreds {
  email: string;
  secret: string;
  instanceName: string;
}

export interface FotosBootCredResolution {
  creds: FotosBootCreds;
  persistent: boolean;
  source: 'persistent' | 'migrated-session' | 'visitor-created';
}

function normalizeCreds(
  parsed: unknown,
  defaultInstanceName = DEFAULT_VISITOR_INSTANCE_NAME,
): FotosBootCreds | null {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const email = typeof (parsed as { email?: unknown }).email === 'string'
    ? (parsed as { email: string }).email
    : null;
  const secret = typeof (parsed as { secret?: unknown }).secret === 'string'
    ? (parsed as { secret: string }).secret
    : null;
  const instanceName = typeof (parsed as { instanceName?: unknown }).instanceName === 'string'
    ? (parsed as { instanceName: string }).instanceName
    : defaultInstanceName;

  if (!email || !secret) {
    return null;
  }

  return { email, secret, instanceName };
}

function parseStoredCreds(raw: string | null, defaultInstanceName?: string): FotosBootCreds | null {
  if (!raw) {
    return null;
  }

  try {
    return normalizeCreds(JSON.parse(raw), defaultInstanceName);
  } catch {
    return null;
  }
}

function createVisitorCreds(): FotosBootCreds {
  const idBytes = new Uint8Array(5);
  crypto.getRandomValues(idBytes);
  const id = Array.from(idBytes, b => b.toString(16).padStart(2, '0')).join('');

  const secretBytes = new Uint8Array(32);
  crypto.getRandomValues(secretBytes);
  const secret = Array.from(secretBytes, b => b.toString(16).padStart(2, '0')).join('');

  return {
    email: `fotos-visitor-${id}@fotos.one`,
    secret,
    instanceName: DEFAULT_VISITOR_INSTANCE_NAME,
  };
}

function getPersistedCreds(): FotosBootCreds | null {
  try {
    return parseStoredCreds(localStorage.getItem(PERSISTENT_KEY));
  } catch {
    return null;
  }
}

function getSessionCreds(): FotosBootCreds | null {
  try {
    return parseStoredCreds(sessionStorage.getItem(SESSION_KEY), DEFAULT_VISITOR_INSTANCE_NAME);
  } catch {
    return null;
  }
}

function persistCreds(creds: FotosBootCreds): boolean {
  try {
    localStorage.setItem(PERSISTENT_KEY, JSON.stringify(creds));
    sessionStorage.removeItem(SESSION_KEY);
    return true;
  } catch {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(creds));
    } catch {}
    return false;
  }
}

export function resolveFotosBootCreds(): FotosBootCredResolution {
  const persisted = getPersistedCreds();
  if (persisted) {
    return {
      creds: persisted,
      persistent: true,
      source: 'persistent',
    };
  }

  const session = getSessionCreds();
  if (session) {
    return {
      creds: session,
      persistent: persistCreds(session),
      source: 'migrated-session',
    };
  }

  const visitorCreds = createVisitorCreds();
  return {
    creds: visitorCreds,
    persistent: persistCreds(visitorCreds),
    source: 'visitor-created',
  };
}
