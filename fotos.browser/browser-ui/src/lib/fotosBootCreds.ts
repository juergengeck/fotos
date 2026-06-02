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
  creds: FotosBootCreds;
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
  const createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString();
  const updatedAt = typeof candidate.updatedAt === 'string' ? candidate.updatedAt : createdAt;
  const storageDirectory = typeof candidate.storageDirectory === 'string'
    ? candidate.storageDirectory.trim()
    : '';

  if (!id || !creds) {
    return null;
  }

  return {
    id,
    creds,
    storageDirectory: storageDirectory || storageDirectoryForAccount(id),
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

function createStoredAccount(accountId = createAccountId()): StoredFotosAccount {
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
    setSessionActiveAccountId(requested.id);
    return {
      creds: requested.creds,
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
        creds: sessionAccount.creds,
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
        creds: activeAccount.creds,
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
      creds: indexedLegacy.creds,
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
