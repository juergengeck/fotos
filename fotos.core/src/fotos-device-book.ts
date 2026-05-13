import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type {
    FotosAuthenticityAttestation,
    FotosEntry,
} from './recipes/FotosRecipes.js';
import type {
    FotosDeviceBook,
    FotosDeviceBookRole,
} from './recipes/FotosDeviceBookRecipes.js';
import { isFotosDeviceBookRole } from './recipes/FotosDeviceBookRecipes.js';
import type {
    FotosMediaLocator,
    FotosMediaVariant,
} from './recipes/FotosMediaRecipes.js';

const DEFAULT_FOTOS_DEVICE_BOOK_ID = 'default';

function normalizeRequiredString(value: string | null | undefined, field: string): string {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
        throw new Error(`[fotos.device-book] ${field} must be a non-empty string`);
    }
    return normalized;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }

    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : undefined;
}

function normalizeTimestamp(value: number, field: string): number {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`[fotos.device-book] ${field} must be a non-negative finite number`);
    }
    return value;
}

function normalizeRole(value: string | undefined): FotosDeviceBookRole {
    const normalized = normalizeRequiredString(value ?? 'headless', 'role');
    if (!isFotosDeviceBookRole(normalized)) {
        throw new Error(`[fotos.device-book] Unsupported role '${normalized}'`);
    }
    return normalized;
}

function normalizeHashSet(
    values: Iterable<string> | undefined,
    field: string,
): Set<string> | undefined {
    if (!values) {
        return undefined;
    }

    const normalized = new Set<string>();
    for (const value of values) {
        normalized.add(normalizeRequiredString(value, field));
    }

    return normalized.size > 0 ? normalized : undefined;
}

function mergeHashSets(
    current: Iterable<string> | undefined,
    additions: Iterable<string> | undefined,
): { changed: boolean; value?: Set<string> } {
    const next = new Set<string>(current ?? []);
    let changed = false;

    for (const value of additions ?? []) {
        if (!next.has(value)) {
            next.add(value);
            changed = true;
        }
    }

    return next.size > 0 ? { changed, value: next } : { changed, value: undefined };
}

export function makeFotosDeviceBookId(deviceId?: string | null): string {
    const normalizedDeviceId = normalizeOptionalString(deviceId) ?? DEFAULT_FOTOS_DEVICE_BOOK_ID;
    return `fotos-device-book:${encodeURIComponent(normalizedDeviceId)}`;
}

export function buildFotosDeviceBookTitle(deviceId?: string | null): string {
    const normalizedDeviceId = normalizeOptionalString(deviceId) ?? DEFAULT_FOTOS_DEVICE_BOOK_ID;
    return `Fotos Device Book (${normalizedDeviceId})`;
}

export interface CreateFotosDeviceBookParams {
    deviceId?: string | null;
    role?: FotosDeviceBookRole;
    title?: string;
    entries?: Iterable<SHA256Hash<FotosEntry>>;
    sourceIdHashes?: Iterable<string>;
    entryIdHashes?: Iterable<string>;
    variants?: Iterable<SHA256Hash<FotosMediaVariant>>;
    locators?: Iterable<SHA256Hash<FotosMediaLocator>>;
    authenticityAttestations?: Iterable<SHA256Hash<FotosAuthenticityAttestation>>;
    createdAt?: number;
    updatedAt?: number;
}

export function createFotosDeviceBook(params: CreateFotosDeviceBookParams = {}): FotosDeviceBook {
    const normalizedDeviceId = normalizeOptionalString(params.deviceId) ?? DEFAULT_FOTOS_DEVICE_BOOK_ID;
    const createdAt = normalizeTimestamp(params.createdAt ?? params.updatedAt ?? Date.now(), 'createdAt');
    const updatedAt = normalizeTimestamp(params.updatedAt ?? createdAt, 'updatedAt');
    if (updatedAt < createdAt) {
        throw new Error('[fotos.device-book] updatedAt must be greater than or equal to createdAt');
    }

    const entries = normalizeHashSet(params.entries, 'entries[]') ?? new Set<SHA256Hash<FotosEntry>>();
    const sourceIdHashes = normalizeHashSet(params.sourceIdHashes, 'sourceIdHashes[]');
    const entryIdHashes = normalizeHashSet(params.entryIdHashes, 'entryIdHashes[]');
    const variants = normalizeHashSet(params.variants, 'variants[]');
    const locators = normalizeHashSet(params.locators, 'locators[]');
    const authenticityAttestations = normalizeHashSet(
        params.authenticityAttestations,
        'authenticityAttestations[]',
    );

    return {
        $type$: 'FotosDeviceBook',
        id: makeFotosDeviceBookId(normalizedDeviceId),
        deviceId: normalizedDeviceId,
        title: normalizeOptionalString(params.title) ?? buildFotosDeviceBookTitle(normalizedDeviceId),
        role: normalizeRole(params.role),
        entries: entries as Set<SHA256Hash<FotosEntry>>,
        ...(sourceIdHashes ? { sourceIdHashes } : {}),
        ...(entryIdHashes ? { entryIdHashes } : {}),
        ...(variants ? { variants: variants as Set<SHA256Hash<FotosMediaVariant>> } : {}),
        ...(locators ? { locators: locators as Set<SHA256Hash<FotosMediaLocator>> } : {}),
        ...(authenticityAttestations
            ? { authenticityAttestations: authenticityAttestations as Set<SHA256Hash<FotosAuthenticityAttestation>> }
            : {}),
        createdAt,
        updatedAt,
    };
}

export interface UpdateFotosDeviceBookContentParams {
    entries?: Iterable<SHA256Hash<FotosEntry>>;
    sourceIdHashes?: Iterable<string>;
    entryIdHashes?: Iterable<string>;
    variants?: Iterable<SHA256Hash<FotosMediaVariant>>;
    locators?: Iterable<SHA256Hash<FotosMediaLocator>>;
    authenticityAttestations?: Iterable<SHA256Hash<FotosAuthenticityAttestation>>;
    title?: string;
    role?: FotosDeviceBookRole;
    updatedAt?: number;
}

export function updateFotosDeviceBookContent(
    existing: FotosDeviceBook,
    params: UpdateFotosDeviceBookContentParams = {},
): { changed: boolean; book: FotosDeviceBook } {
    const updatedAt = normalizeTimestamp(params.updatedAt ?? Date.now(), 'updatedAt');
    if (updatedAt < existing.createdAt) {
        throw new Error('[fotos.device-book] updatedAt must be greater than or equal to createdAt');
    }

    const mergedEntries = mergeHashSets(existing.entries, normalizeHashSet(params.entries, 'entries[]'));
    const mergedSourceIds = mergeHashSets(existing.sourceIdHashes, normalizeHashSet(params.sourceIdHashes, 'sourceIdHashes[]'));
    const mergedEntryIds = mergeHashSets(existing.entryIdHashes, normalizeHashSet(params.entryIdHashes, 'entryIdHashes[]'));
    const mergedVariants = mergeHashSets(existing.variants, normalizeHashSet(params.variants, 'variants[]'));
    const mergedLocators = mergeHashSets(existing.locators, normalizeHashSet(params.locators, 'locators[]'));
    const mergedAuthenticity = mergeHashSets(
        existing.authenticityAttestations,
        normalizeHashSet(params.authenticityAttestations, 'authenticityAttestations[]'),
    );
    const nextTitle = normalizeOptionalString(params.title) ?? existing.title;
    const nextRole = params.role ? normalizeRole(params.role) : existing.role;

    const changed = mergedEntries.changed
        || mergedSourceIds.changed
        || mergedEntryIds.changed
        || mergedVariants.changed
        || mergedLocators.changed
        || mergedAuthenticity.changed
        || nextTitle !== existing.title
        || nextRole !== existing.role;

    return {
        changed,
        book: {
            ...existing,
            title: nextTitle,
            role: nextRole,
            entries: (mergedEntries.value ?? new Set<string>()) as Set<SHA256Hash<FotosEntry>>,
            ...(mergedSourceIds.value ? { sourceIdHashes: mergedSourceIds.value } : {}),
            ...(mergedEntryIds.value ? { entryIdHashes: mergedEntryIds.value } : {}),
            ...(mergedVariants.value
                ? { variants: mergedVariants.value as Set<SHA256Hash<FotosMediaVariant>> }
                : {}),
            ...(mergedLocators.value
                ? { locators: mergedLocators.value as Set<SHA256Hash<FotosMediaLocator>> }
                : {}),
            ...(mergedAuthenticity.value
                ? { authenticityAttestations: mergedAuthenticity.value as Set<SHA256Hash<FotosAuthenticityAttestation>> }
                : {}),
            updatedAt: changed ? updatedAt : existing.updatedAt,
        },
    };
}

export interface FotosDeviceBookLookup<T> {
    obj: T;
    hash?: string;
}

export interface FotosDeviceBookStoredObject<T> {
    obj?: T;
    idHash: string;
    hash?: string;
}

export interface FotosDeviceBookPersistenceDeps {
    calculateIdHashOfObj(obj: object): Promise<string>;
    getObjectByIdHash(idHash: string): Promise<FotosDeviceBookLookup<unknown>>;
    storeVersionedObject(obj: object): Promise<FotosDeviceBookStoredObject<unknown>>;
}

function isMissingObjectError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const message = error.message.toLowerCase();
    return error.name === 'FileNotFoundError'
        || message.includes('not found')
        || message.includes('file not found')
        || message.includes('sb-read2');
}

function requireFotosDeviceBook(value: unknown): FotosDeviceBook {
    if (!value || typeof value !== 'object' || (value as { $type$?: unknown }).$type$ !== 'FotosDeviceBook') {
        throw new Error('[fotos.device-book] Expected FotosDeviceBook object');
    }
    return value as FotosDeviceBook;
}

export async function getFotosDeviceBookIdHash(
    deps: Pick<FotosDeviceBookPersistenceDeps, 'calculateIdHashOfObj'>,
    deviceId?: string | null,
): Promise<SHA256IdHash<FotosDeviceBook>> {
    return await deps.calculateIdHashOfObj(createFotosDeviceBook({
        deviceId,
        createdAt: 0,
        updatedAt: 0,
    })) as SHA256IdHash<FotosDeviceBook>;
}

export async function readFotosDeviceBook(
    deps: FotosDeviceBookPersistenceDeps,
    deviceId?: string | null,
): Promise<FotosDeviceBookStoredObject<FotosDeviceBook> | null> {
    const idHash = await getFotosDeviceBookIdHash(deps, deviceId);
    try {
        const existing = await deps.getObjectByIdHash(idHash);
        return {
            obj: requireFotosDeviceBook(existing.obj),
            idHash,
            ...(existing.hash ? { hash: existing.hash } : {}),
        };
    } catch (error) {
        if (isMissingObjectError(error)) {
            return null;
        }
        throw error;
    }
}

export interface EnsureFotosDeviceBookParams extends CreateFotosDeviceBookParams {}

export async function ensureFotosDeviceBook(
    deps: FotosDeviceBookPersistenceDeps,
    params: EnsureFotosDeviceBookParams = {},
): Promise<{ created: boolean; stored: FotosDeviceBookStoredObject<FotosDeviceBook> }> {
    const existing = await readFotosDeviceBook(deps, params.deviceId);
    if (existing) {
        return {
            created: false,
            stored: existing,
        };
    }

    const createdBook = createFotosDeviceBook(params);
    const stored = await deps.storeVersionedObject(createdBook);
    return {
        created: true,
        stored: {
            ...(stored as FotosDeviceBookStoredObject<FotosDeviceBook>),
            obj: createdBook,
        },
    };
}

export interface AppendFotosDeviceBookContentParams extends UpdateFotosDeviceBookContentParams {
    deviceId?: string | null;
}

export async function appendFotosDeviceBookContent(
    deps: FotosDeviceBookPersistenceDeps,
    params: AppendFotosDeviceBookContentParams = {},
): Promise<{ created: boolean; updated: boolean; stored: FotosDeviceBookStoredObject<FotosDeviceBook> }> {
    const ensured = await ensureFotosDeviceBook(deps, params);
    const currentBook = ensured.stored.obj ?? createFotosDeviceBook(params);
    const { changed, book } = updateFotosDeviceBookContent(currentBook, params);

    if (!changed) {
        return {
            created: ensured.created,
            updated: false,
            stored: ensured.stored,
        };
    }

    const stored = await deps.storeVersionedObject(book);
    return {
        created: ensured.created,
        updated: true,
        stored: {
            ...(stored as FotosDeviceBookStoredObject<FotosDeviceBook>),
            obj: book,
        },
    };
}
