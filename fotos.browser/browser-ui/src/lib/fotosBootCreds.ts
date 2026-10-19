import { createBrowserCredentialVault } from '@glueone/auth.core';

export const PERSISTENT_KEY = 'fotos_creds';
export const SESSION_KEY = 'fotos_creds_session';
export const ACCOUNTS_KEY = 'fotos_accounts';
export const ACTIVE_ACCOUNT_KEY = 'fotos_active_account';
export const SESSION_ACTIVE_ACCOUNT_KEY = 'fotos_active_account_session';
export const SESSION_PENDING_ACCOUNT_KEY = 'fotos_pending_account_session';
export const DEFAULT_VISITOR_INSTANCE_NAME = 'fotos-visitor';
export const LEGACY_ACCOUNT_ID = 'legacy';
export const DEFAULT_STORAGE_DIRECTORY = 'fotos.one.storage';
export const FOTOS_CREDENTIAL_ISSUER = 'https://fotos.one';

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
export type FotosCredentialVault = Pick<ReturnType<typeof createBrowserCredentialVault>, 'read' | 'import'>;
interface StoredFotosAccount {
  id: string;
  /** Only present while reading the old plaintext index. Never written. */
  creds?: FotosBootCreds;
  localIdentity?: Omit<FotosBootCreds, 'secret'>;
  glueSubject?: string;
  /** Public creation journal; removed before this identity can open ONE. */
  pendingCreation?: 'persistent' | 'session';
  storageDirectory: string;
  createdAt: string;
  updatedAt: string;
}
interface StoredFotosAccountIndex { version: 1; accounts: StoredFotosAccount[] }
let defaultVault: FotosCredentialVault | undefined;
function getVault(): FotosCredentialVault { return defaultVault ??= createBrowserCredentialVault(); }

async function withAccountLock<T>(transaction: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!globalThis.navigator?.locks) throw new Error('Fotos account storage requires browser Web Locks');
  return navigator.locks.request('fotos.accounts', { ...(signal ? { signal } : {}) }, async () => {
    signal?.throwIfAborted();
    return transaction();
  });
}

function normalizeCreds(value: unknown): FotosBootCreds {
  const candidate = value as Partial<FotosBootCreds> | null;
  if (!candidate || typeof candidate.email !== 'string' || !candidate.email
    || typeof candidate.secret !== 'string' || !candidate.secret
    || (candidate.instanceName !== undefined && typeof candidate.instanceName !== 'string')) {
    throw new Error('Invalid saved Fotos credentials');
  }
  return { email: candidate.email, secret: candidate.secret, instanceName: candidate.instanceName ?? DEFAULT_VISITOR_INSTANCE_NAME };
}
function storageDirectoryForAccount(id: string): string {
  return id === LEGACY_ACCOUNT_ID ? DEFAULT_STORAGE_DIRECTORY : `${DEFAULT_STORAGE_DIRECTORY}.${id}`;
}
function readAccountIndex(): StoredFotosAccountIndex {
  const raw = localStorage.getItem(ACCOUNTS_KEY);
  if (raw === null) return { version: 1, accounts: [] };
  const parsed = JSON.parse(raw);
  if (parsed?.version !== 1 || !Array.isArray(parsed.accounts)) throw new Error('Invalid saved Fotos account index');
  const ids = new Set<string>();
  const accounts = parsed.accounts.map((value: StoredFotosAccount) => {
    if (!value || typeof value.id !== 'string' || !value.id || ids.has(value.id)) throw new Error('Invalid saved Fotos account');
    ids.add(value.id);
    if (value.pendingCreation !== undefined && value.pendingCreation !== 'persistent' && value.pendingCreation !== 'session') throw new Error('Invalid pending Fotos account');
    const now = new Date().toISOString();
    const base = {
      id: value.id,
      storageDirectory: typeof value.storageDirectory === 'string' && value.storageDirectory ? value.storageDirectory : storageDirectoryForAccount(value.id),
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
      ...(value.pendingCreation ? { pendingCreation: value.pendingCreation } : {}),
    };
    if (value.glueSubject !== undefined) {
      if (typeof value.glueSubject !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value.glueSubject)
        || value.pendingCreation !== undefined || value.id !== `glue-${value.glueSubject}` || value.creds !== undefined || value.localIdentity !== undefined) throw new Error('Invalid saved Glue account');
      return { ...base, glueSubject: value.glueSubject, storageDirectory: storageDirectoryForAccount(value.id) };
    }
    if (value.creds !== undefined) return { ...base, creds: normalizeCreds(value.creds) };
    const identity = value.localIdentity;
    if (!identity || typeof identity.email !== 'string' || !identity.email || typeof identity.instanceName !== 'string'
      || 'secret' in identity) throw new Error('Invalid saved Fotos account identity');
    return { ...base, localIdentity: { email: identity.email, instanceName: identity.instanceName } };
  });
  return { version: 1, accounts };
}
function writeAccountIndex(index: StoredFotosAccountIndex): void {
  if (index.accounts.some(account => account.creds)) throw new Error('Cannot write plaintext Fotos credentials');
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(index));
}
function metadata(id: string, creds: Omit<FotosBootCreds, 'secret'>, storageDirectory = storageDirectoryForAccount(id)): StoredFotosAccount {
  const now = new Date().toISOString();
  return { id, localIdentity: { email: creds.email, instanceName: creds.instanceName }, storageDirectory, createdAt: now, updatedAt: now };
}
async function requireLocalCreds(account: StoredFotosAccount, vault: FotosCredentialVault): Promise<FotosBootCreds> {
  if (!account.localIdentity || account.glueSubject) throw new Error('Invalid saved local account');
  const secret = await vault.read(FOTOS_CREDENTIAL_ISSUER, account.id);
  if (!secret) throw new Error('The saved Fotos account credential is unavailable on this device');
  return { ...account.localIdentity, secret };
}

/** Seal every legacy entry before publishing metadata or removing plaintext keys.
 * Failed writes leave the legacy inputs available for an exact, immutable retry. */
async function migrateAccounts(vault: FotosCredentialVault): Promise<{ index: StoredFotosAccountIndex; sessionMigrated: boolean }> {
  const index = readAccountIndex();
  let changed = false;
  let sessionMigrated = false;
  for (const account of index.accounts) {
    if (!account.creds) continue;
    await vault.import(FOTOS_CREDENTIAL_ISSUER, account.id, account.creds.secret);
    const { email, instanceName } = account.creds;
    account.localIdentity = { email, instanceName };
    delete account.creds;
    changed = true;
  }
  const legacyKeys = [[localStorage, PERSISTENT_KEY, 'legacy-persistent'], [sessionStorage, SESSION_KEY, 'legacy-session']] as const;
  const present: (readonly [Storage, string])[] = [];
  for (const [storage, key, alternateId] of legacyKeys) {
    const raw = storage.getItem(key);
    if (raw === null) continue;
    const creds = normalizeCreds(JSON.parse(raw));
    let matching: StoredFotosAccount | undefined;
    for (const account of index.accounts) {
      if (account.localIdentity?.email === creds.email && account.localIdentity.instanceName === creds.instanceName
        && (await requireLocalCreds(account, vault)).secret === creds.secret) { matching = account; break; }
    }
    if (!matching) {
      const id = index.accounts.some(account => account.id === LEGACY_ACCOUNT_ID) ? alternateId : LEGACY_ACCOUNT_ID;
      if (index.accounts.some(account => account.id === id)) throw new Error('Legacy Fotos credentials conflict with a saved account');
      await vault.import(FOTOS_CREDENTIAL_ISSUER, id, creds.secret);
      index.accounts.push(metadata(id, creds, DEFAULT_STORAGE_DIRECTORY));
      changed = true;
      sessionMigrated ||= key === SESSION_KEY && id === LEGACY_ACCOUNT_ID;
    }
    present.push([storage, key]);
  }
  if (changed) writeAccountIndex(index);
  for (const [storage, key] of present) storage.removeItem(key);
  return { index, sessionMigrated };
}
function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Public metadata only. Verification/sealing must finish before selecting Glue. */
export async function selectFotosGlueAccount(subject: string, vault: FotosCredentialVault = getVault(), options: { signal?: AbortSignal; preservePendingCreation?: boolean } = {}): Promise<string> {
  return withAccountLock(() => selectGlueAccount(subject, vault, options), options.signal);
}

async function selectGlueAccount(subject: string, vault: FotosCredentialVault, options: { signal?: AbortSignal; preservePendingCreation?: boolean }): Promise<string> {
  if (!/^[a-fA-F0-9]{64}$/.test(subject)) throw new Error('Invalid Glue account subject');
  const { index } = await migrateAccounts(vault);
  const id = `glue-${subject}`;
  const previous = index.accounts.find(account => account.id === id);
  if (previous && previous.glueSubject !== subject) throw new Error('Glue account conflicts with an existing local account');
  const now = new Date().toISOString();
  const account = { id, glueSubject: subject, storageDirectory: storageDirectoryForAccount(id), createdAt: previous?.createdAt ?? now, updatedAt: now };
  const next = { version: 1 as const, accounts: [...index.accounts.filter(entry => entry.id !== id), account] };
  const oldIndex = localStorage.getItem(ACCOUNTS_KEY);
  const oldActive = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
  const oldSession = sessionStorage.getItem(SESSION_ACTIVE_ACCOUNT_KEY);
  const oldPending = sessionStorage.getItem(SESSION_PENDING_ACCOUNT_KEY);
  options.signal?.throwIfAborted();
  try {
    writeAccountIndex(next);
    localStorage.setItem(ACTIVE_ACCOUNT_KEY, id);
    sessionStorage.setItem(SESSION_ACTIVE_ACCOUNT_KEY, id);
    if (!options.preservePendingCreation) sessionStorage.removeItem(SESSION_PENDING_ACCOUNT_KEY);
  } catch (error) {
    for (const [storage, key, value] of [
      [localStorage, ACCOUNTS_KEY, oldIndex], [localStorage, ACTIVE_ACCOUNT_KEY, oldActive],
      [sessionStorage, SESSION_ACTIVE_ACCOUNT_KEY, oldSession], [sessionStorage, SESSION_PENDING_ACCOUNT_KEY, oldPending],
    ] as const) {
      try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch {}
    }
    throw error;
  }
  return id;
}

export async function resolveFotosBootAccount(options: {
  accountSelector?: string | null;
  vault?: FotosCredentialVault;
} = {}): Promise<FotosBootCredResolution> {
  return withAccountLock(() => resolveBootAccount(options));
}

async function finishAccountCreation(index: StoredFotosAccountIndex, account: StoredFotosAccount, vault: FotosCredentialVault): Promise<FotosBootCredResolution> {
  if (!account.localIdentity || !account.pendingCreation) throw new Error('Invalid pending Fotos account');
  let secret = await vault.read(FOTOS_CREDENTIAL_ISSUER, account.id);
  // Only an account that has never opened ONE may create its missing secret.
  if (!secret) secret = await vault.import(FOTOS_CREDENTIAL_ISSUER, account.id, randomHex(32));
  if ((await vault.read(FOTOS_CREDENTIAL_ISSUER, account.id)) !== secret) throw new Error('Unable to verify the new Fotos credential');
  const sessionScoped = account.pendingCreation === 'session';
  if (sessionScoped) {
    sessionStorage.setItem(SESSION_ACTIVE_ACCOUNT_KEY, account.id);
    sessionStorage.removeItem(SESSION_PENDING_ACCOUNT_KEY);
  } else localStorage.setItem(ACTIVE_ACCOUNT_KEY, account.id);
  const { pendingCreation: _pending, ...ready } = account;
  // This is the final commit. Until it succeeds, retries keep the exact public
  // identity and may complete the never-opened account's credential creation.
  writeAccountIndex({ version: 1, accounts: index.accounts.map(entry => entry.id === ready.id ? ready : entry) });
  return { creds: { ...account.localIdentity, secret }, accountId: account.id, persistent: true, sessionScoped, source: 'visitor-created', storageDirectory: account.storageDirectory };
}

async function resolveBootAccount(options: { accountSelector?: string | null; vault?: FotosCredentialVault }): Promise<FotosBootCredResolution> {
  const vault = options.vault ?? getVault();
  const { index, sessionMigrated } = await migrateAccounts(vault);
  const requested = options.accountSelector?.trim() ?? '';
  const sessionId = sessionStorage.getItem(SESSION_ACTIVE_ACCOUNT_KEY);
  const persistedId = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
  const rawSessionJournal = sessionStorage.getItem(SESSION_PENDING_ACCOUNT_KEY);
  if (rawSessionJournal !== null) {
    const journal = JSON.parse(rawSessionJournal) as StoredFotosAccount;
    if (!journal || journal.pendingCreation !== 'session' || typeof journal.id !== 'string' || !/^acct-[a-f0-9]{12}$/.test(journal.id)
      || journal.creds !== undefined || journal.glueSubject !== undefined || !journal.localIdentity
      || typeof journal.localIdentity.email !== 'string' || !journal.localIdentity.email
      || typeof journal.localIdentity.instanceName !== 'string' || 'secret' in journal.localIdentity
      || journal.storageDirectory !== storageDirectoryForAccount(journal.id)
      || typeof journal.createdAt !== 'string' || typeof journal.updatedAt !== 'string') throw new Error('Invalid pending Fotos session account');
    if (!requested || requested === 'new' || requested === journal.id) {
      const existing = index.accounts.find(entry => entry.id === journal.id);
      if (existing && (existing.localIdentity?.email !== journal.localIdentity.email
        || existing.localIdentity.instanceName !== journal.localIdentity.instanceName || existing.storageDirectory !== journal.storageDirectory)) throw new Error('Pending Fotos account conflicts with a saved account');
      if (!existing) {
        index.accounts.push(journal);
        writeAccountIndex(index);
      }
      if (!existing || existing.pendingCreation) return finishAccountCreation(index, existing ?? journal, vault);
      // A ready saved account always requires its existing secret, even if a stale
      // tab journal remains. Never treat it as permission to recreate a secret.
      const creds = await requireLocalCreds(existing, vault);
      sessionStorage.setItem(SESSION_ACTIVE_ACCOUNT_KEY, existing.id);
      sessionStorage.removeItem(SESSION_PENDING_ACCOUNT_KEY);
      return { creds, accountId: existing.id, persistent: true, sessionScoped: true, source: 'persistent', storageDirectory: existing.storageDirectory };
    }
  }
  // Pending accounts in other tabs do not participate in ordinary selection.
  const selectedId = requested === 'new'
    ? (index.accounts.find(entry => entry.id === sessionId)?.pendingCreation === 'session' ? sessionId : null)
    : requested || sessionId || persistedId;
  let account = selectedId ? index.accounts.find(entry => entry.id === selectedId) : undefined;
  if (selectedId && !account) throw new Error(`Unknown fotos account selector: ${selectedId}`);
  const source: FotosBootCredResolution['source'] = sessionMigrated ? 'migrated-session' : 'persistent';
  if (!account && requested !== 'new') account = index.accounts.find(entry => entry.id === LEGACY_ACCOUNT_ID && entry.pendingCreation !== 'session')
    ?? index.accounts.find(entry => !entry.pendingCreation);
  if (account?.pendingCreation) return finishAccountCreation(index, account, vault);
  let creds: FotosBootCreds;
  if (!account) {
    const id = requested === 'new' ? `acct-${randomHex(6)}` : LEGACY_ACCOUNT_ID;
    account = metadata(id, { email: `fotos-visitor-${randomHex(5)}@fotos.one`, instanceName: DEFAULT_VISITOR_INSTANCE_NAME });
    account.pendingCreation = requested === 'new' ? 'session' : 'persistent';
    const pendingIndex = { version: 1 as const, accounts: [...index.accounts, account] };
    // A tab owns its session request before publishing the origin-wide journal.
    // If the index write fails, it can retry the exact public identity.
    if (account.pendingCreation === 'session') sessionStorage.setItem(SESSION_PENDING_ACCOUNT_KEY, JSON.stringify(account));
    // Journal public metadata before creating the immutable vault record.
    writeAccountIndex(pendingIndex);
    return finishAccountCreation(pendingIndex, account, vault);
  } else if (account.glueSubject) {
    const secret = await vault.read('https://glue.one', account.glueSubject);
    if (!secret) throw new Error('The saved Glue account credential is unavailable on this device');
    creds = { email: `glue:${account.glueSubject}`, secret, instanceName: 'fotos-glue' };
  } else {
    creds = await requireLocalCreds(account, vault);
  }
  const sessionScoped = Boolean(requested || sessionId === account.id);
  // Selection only follows successful credential access and metadata persistence.
  if (requested) {
    sessionStorage.setItem(SESSION_ACTIVE_ACCOUNT_KEY, account.id);
    if (rawSessionJournal !== null) sessionStorage.removeItem(SESSION_PENDING_ACCOUNT_KEY);
  } else if (!sessionScoped) localStorage.setItem(ACTIVE_ACCOUNT_KEY, account.id);
  return { creds, accountId: account.id, persistent: true, sessionScoped, source, storageDirectory: account.storageDirectory };
}

export const resolveFotosBootCreds = resolveFotosBootAccount;
