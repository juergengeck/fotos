export const PERSISTENT_KEY = 'fotos_creds';
export const SESSION_KEY = 'fotos_creds_session';
export const ACCOUNTS_KEY = 'fotos_accounts';
export const ACTIVE_ACCOUNT_KEY = 'fotos_active_account';
export const SESSION_ACTIVE_ACCOUNT_KEY = 'fotos_active_account_session';
export const DEFAULT_VISITOR_INSTANCE_NAME = 'fotos-visitor';
export const LEGACY_ACCOUNT_ID = 'legacy';
export const DEFAULT_STORAGE_DIRECTORY = 'fotos.one.storage';

export interface FotosBootCreds {
  email: string;
  secret: string;
  instanceName: string;
}

export interface FotosBootCredResolution {
  creds: FotosBootCreds;
  accountId: string;
  persistent: boolean;
  sessionScoped: boolean;
  source: 'persistent' | 'migrated-session' | 'visitor-created';
  storageDirectory: string;
}

interface StoredFotosAccount {
  id: string;
  creds?: FotosBootCreds;
  glueSubject?: string;
  storageDirectory?: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredFotosAccountIndex {
  version: 1;
  accounts: StoredFotosAccount[];
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

function createAccountId(): string {
  const idBytes = new Uint8Array(6);
  crypto.getRandomValues(idBytes);
  return `acct-${Array.from(idBytes, b => b.toString(16).padStart(2, '0')).join('')}`;
}

function storageDirectoryForAccount(accountId: string): string {
  return accountId === LEGACY_ACCOUNT_ID
    ? DEFAULT_STORAGE_DIRECTORY
    : `${DEFAULT_STORAGE_DIRECTORY}.${accountId}`;
}

function normalizeAccount(value: unknown): StoredFotosAccount | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<StoredFotosAccount>;
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  const creds = normalizeCreds(candidate.creds);
  const glueSubject = typeof candidate.glueSubject === 'string'
    && /^[a-fA-F0-9]{64}$/.test(candidate.glueSubject) ? candidate.glueSubject : undefined;
  const createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString();
  const updatedAt = typeof candidate.updatedAt === 'string' ? candidate.updatedAt : createdAt;
  const storageDirectory = typeof candidate.storageDirectory === 'string'
    ? candidate.storageDirectory.trim()
    : '';

  if (!id || (!creds && !glueSubject) || (glueSubject && id !== `glue-${glueSubject}`)) {
    return null;
  }

  return {
    id,
    ...(glueSubject ? { glueSubject } : { creds: creds! }),
    storageDirectory: glueSubject ? storageDirectoryForAccount(id) : storageDirectory || storageDirectoryForAccount(id),
    createdAt,
    updatedAt,
  };
}

function readAccountIndex(): StoredFotosAccountIndex {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) {
      return { version: 1, accounts: [] };
    }

    const parsed = JSON.parse(raw) as Partial<StoredFotosAccountIndex>;
    const accounts = Array.isArray(parsed.accounts)
      ? parsed.accounts
          .map(normalizeAccount)
          .filter((account): account is StoredFotosAccount => account !== null)
      : [];

    return { version: 1, accounts };
  } catch {
    return { version: 1, accounts: [] };
  }
}

function writeAccountIndex(index: StoredFotosAccountIndex): boolean {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(index));
    return true;
  } catch {
    return false;
  }
}

function findAccount(accountId: string): StoredFotosAccount | null {
  return readAccountIndex().accounts.find(account => account.id === accountId) ?? null;
}

function upsertAccount(account: StoredFotosAccount): boolean {
  const index = readAccountIndex();
  const existingIndex = index.accounts.findIndex(entry => entry.id === account.id);
  const nextAccounts = [...index.accounts];
  if (existingIndex >= 0) {
    nextAccounts[existingIndex] = account;
  } else {
    nextAccounts.push(account);
  }

  return writeAccountIndex({
    version: 1,
    accounts: nextAccounts,
  });
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

function createStoredAccount(accountId = createAccountId()): StoredFotosAccount & { creds: FotosBootCreds } {
  const now = new Date().toISOString();
  return {
    id: accountId,
    creds: createVisitorCreds(),
    storageDirectory: storageDirectoryForAccount(accountId),
    createdAt: now,
    updatedAt: now,
  };
}

function getSessionActiveAccountId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_ACTIVE_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

function setSessionActiveAccountId(accountId: string): void {
  try {
    sessionStorage.setItem(SESSION_ACTIVE_ACCOUNT_KEY, accountId);
  } catch {}
}

function getPersistedActiveAccountId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

function setPersistedActiveAccountId(accountId: string): boolean {
  try {
    localStorage.setItem(ACTIVE_ACCOUNT_KEY, accountId);
    return true;
  } catch {
    return false;
  }
}

export function resolveFotosBootCreds(options: {
  accountSelector?: string | null;
} = {}): FotosBootCredResolution {
  const requestedAccount = options.accountSelector?.trim() ?? '';
  if (requestedAccount === 'new') {
    const account = createStoredAccount();
    const persistent = upsertAccount(account);
    setSessionActiveAccountId(account.id);
    return {
      creds: account.creds,
      accountId: account.id,
      persistent,
      sessionScoped: true,
      source: 'visitor-created',
      storageDirectory: account.storageDirectory ?? storageDirectoryForAccount(account.id),
    };
  }

  if (requestedAccount) {
    const requested = findAccount(requestedAccount);
    if (!requested) {
      throw new Error(`Unknown fotos account selector: ${requestedAccount}`);
    }
    const creds = requireLocalCreds(requested);
    setSessionActiveAccountId(requested.id);
    return {
      creds,
      accountId: requested.id,
      persistent: true,
      sessionScoped: true,
      source: 'persistent',
      storageDirectory: requested.storageDirectory ?? storageDirectoryForAccount(requested.id),
    };
  }

  const sessionAccountId = getSessionActiveAccountId();
  if (sessionAccountId) {
    const sessionAccount = findAccount(sessionAccountId);
    if (sessionAccount) {
      return {
        creds: requireLocalCreds(sessionAccount),
        accountId: sessionAccount.id,
        persistent: true,
        sessionScoped: true,
        source: 'persistent',
        storageDirectory: sessionAccount.storageDirectory ?? storageDirectoryForAccount(sessionAccount.id),
      };
    }
  }

  const activeAccountId = getPersistedActiveAccountId();
  if (activeAccountId) {
    const activeAccount = findAccount(activeAccountId);
    if (activeAccount) {
      return {
        creds: requireLocalCreds(activeAccount),
        accountId: activeAccount.id,
        persistent: true,
        sessionScoped: false,
        source: 'persistent',
        storageDirectory: activeAccount.storageDirectory ?? storageDirectoryForAccount(activeAccount.id),
      };
    }
  }

  const indexedLegacy = findAccount(LEGACY_ACCOUNT_ID);
  if (indexedLegacy) {
    setPersistedActiveAccountId(indexedLegacy.id);
    return {
      creds: requireLocalCreds(indexedLegacy),
      accountId: indexedLegacy.id,
      persistent: true,
      sessionScoped: false,
      source: 'persistent',
      storageDirectory: indexedLegacy.storageDirectory ?? DEFAULT_STORAGE_DIRECTORY,
    };
  }

  const persisted = getPersistedCreds();
  if (persisted) {
    const account: StoredFotosAccount = {
      id: LEGACY_ACCOUNT_ID,
      creds: persisted,
      storageDirectory: DEFAULT_STORAGE_DIRECTORY,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    upsertAccount(account);
    setPersistedActiveAccountId(account.id);
    return {
      creds: persisted,
      accountId: account.id,
      persistent: true,
      sessionScoped: false,
      source: 'persistent',
      storageDirectory: DEFAULT_STORAGE_DIRECTORY,
    };
  }

  const session = getSessionCreds();
  if (session) {
    const account = createStoredAccount(LEGACY_ACCOUNT_ID);
    account.creds = session;
    account.storageDirectory = DEFAULT_STORAGE_DIRECTORY;
    const persistent = upsertAccount(account) && persistCreds(session);
    setPersistedActiveAccountId(account.id);
    return {
      creds: session,
      accountId: account.id,
      persistent,
      sessionScoped: false,
      source: 'migrated-session',
      storageDirectory: DEFAULT_STORAGE_DIRECTORY,
    };
  }

  const account = createStoredAccount(LEGACY_ACCOUNT_ID);
  const persistent = upsertAccount(account) && persistCreds(account.creds);
  setPersistedActiveAccountId(account.id);
  return {
    creds: account.creds,
    accountId: account.id,
    persistent,
    sessionScoped: false,
    source: 'visitor-created',
    storageDirectory: DEFAULT_STORAGE_DIRECTORY,
  };
}

function requireLocalCreds(account: StoredFotosAccount): FotosBootCreds {
  if (account.glueSubject || !account.creds) {
    throw new Error('Glue accounts must be opened with the browser credential vault');
  }
  return account.creds;
}

/** Public metadata only. The credential remains sealed in auth.core's IndexedDB vault. */
export function selectFotosGlueAccount(subject: string): string {
  if (!/^[a-fA-F0-9]{64}$/.test(subject)) throw new Error('Invalid Glue account subject');
  const id = `glue-${subject}`;
  const previous = findAccount(id);
  if (previous && previous.glueSubject !== subject) throw new Error('Glue account conflicts with an existing local account');
  const now = new Date().toISOString();
  const account: StoredFotosAccount = {
    id, glueSubject: subject, storageDirectory: storageDirectoryForAccount(id),
    createdAt: previous?.createdAt ?? now, updatedAt: now,
  };
  // Keep selection atomic from the caller's point of view if Web Storage fails.
  const oldIndex = localStorage.getItem(ACCOUNTS_KEY);
  const oldActive = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
  const oldSession = sessionStorage.getItem(SESSION_ACTIVE_ACCOUNT_KEY);
  try {
    if (!upsertAccount(account)) throw new Error('Unable to save Glue account');
    localStorage.setItem(ACTIVE_ACCOUNT_KEY, id);
    sessionStorage.setItem(SESSION_ACTIVE_ACCOUNT_KEY, id);
  } catch (error) {
    for (const [storage, key, value] of [
      [localStorage, ACCOUNTS_KEY, oldIndex],
      [localStorage, ACTIVE_ACCOUNT_KEY, oldActive],
      [sessionStorage, SESSION_ACTIVE_ACCOUNT_KEY, oldSession],
    ] as const) {
      try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch {}
    }
    throw error;
  }
  return id;
}

/** Local startup never contacts Glue; existing Glue accounts only unlock their local vault. */
export async function resolveFotosBootAccount(options: {
  accountSelector?: string | null;
  vault: { read(issuer: string, subject: string): Promise<string | undefined> };
}): Promise<FotosBootCredResolution> {
  const requested = options.accountSelector?.trim();
  const sessionAccountId = getSessionActiveAccountId();
  const persistedAccountId = getPersistedActiveAccountId();
  const account = requested ? findAccount(requested)
    : (sessionAccountId ? findAccount(sessionAccountId) : null)
      ?? (persistedAccountId ? findAccount(persistedAccountId) : null);
  if (account?.glueSubject) {
    const secret = await options.vault.read('https://glue.one', account.glueSubject);
    if (!secret) throw new Error('The saved Glue account credential is unavailable on this device');
    if (requested) setSessionActiveAccountId(account.id);
    return {
      creds: { email: `glue:${account.glueSubject}`, secret, instanceName: 'fotos-glue' },
      accountId: account.id, persistent: true,
      sessionScoped: Boolean(requested || (sessionAccountId === account.id)), source: 'persistent',
      storageDirectory: storageDirectoryForAccount(account.id),
    };
  }
  return resolveFotosBootCreds({ accountSelector: options.accountSelector });
}
