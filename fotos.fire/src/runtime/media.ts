import type {FotosEntry, FotosMediaVariant} from '@refinio/fotos.core';
import type {ReceivedFotosShareScope} from '@refinio/fotos.core/received-shares';
import type {FirePhoto} from '../ui/types';

export function isMissingObject(error: unknown): boolean {
  const value = error as {name?: string; code?: string} | null;
  return value?.name === 'FileNotFoundError' || value?.code === 'SB-READ2';
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/heic': 'heic', 'image/avif': 'avif',
};

export function blobCacheName(hash: string, mime: string): string {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid Fotos media blob hash');
  return `${hash}.${EXTENSIONS[mime.toLowerCase()] ?? 'bin'}`;
}

export interface BlobCacheStorage {
  exists(name: string): boolean;
  write(name: string, bytes: Uint8Array): void;
  uri(name: string): string;
}

/** Only successful materializations are cached. Missing bytes await an arrival event. */
export class BlobMediaCache {
  constructor(
    private readonly storage: BlobCacheStorage,
    private readonly readBlob: (hash: string) => Promise<ArrayBuffer>,
  ) {}

  async resolve(hash: string, mime: string): Promise<string | undefined> {
    const name = blobCacheName(hash, mime);
    if (!this.storage.exists(name)) {
      let bytes: ArrayBuffer;
      try {
        bytes = await this.readBlob(hash);
      } catch (error) {
        if (isMissingObject(error)) return undefined;
        throw error;
      }
      this.storage.write(name, new Uint8Array(bytes));
    }
    return this.storage.uri(name);
  }
}

export interface PhotoProjectionDependencies {
  entryId(entry: FotosEntry): Promise<string>;
  getVariant(hash: string): Promise<FotosMediaVariant>;
  mediaUri(hash: string, mime: string): Promise<string | undefined>;
}

export async function projectVerifiedPhotos(
  scopes: ReceivedFotosShareScope[],
  deps: PhotoProjectionDependencies,
): Promise<FirePhoto[]> {
  const entries = new Map<string, FotosEntry>();
  for (const scope of scopes) {
    if (scope.status !== 'active' || !scope.verified) continue;
    for (const entry of scope.entries) {
      if (entry.mime.startsWith('image/')) entries.set(entry.contentHash, entry);
    }
  }
  const photos: FirePhoto[] = [];
  // Bound native memory to one photo's encoded bytes during materialization.
  for (const entry of entries.values()) {
    const id = await deps.entryId(entry);
    const variants: FotosMediaVariant[] = [];
    for (const hash of entry.variants ?? []) {
      try {
        const variant = await deps.getVariant(String(hash));
        if (variant.$type$ === 'FotosMediaVariant' && String(variant.family) === id
          && variant.mime.startsWith('image/')) variants.push(variant);
      } catch (error) {
        if (!isMissingObject(error)) throw error;
      }
    }
    let thumbnailUri = entry.thumb
      ? await deps.mediaUri(String(entry.thumb), 'image/jpeg') : undefined;
    if (!thumbnailUri) {
      const thumbnail = variants.find(variant => variant.role === 'thumbnail' && variant.blob);
      if (thumbnail?.blob) thumbnailUri = await deps.mediaUri(String(thumbnail.blob), thumbnail.mime);
    }
    let mediaUri: string | undefined;
    for (const role of ['preview', 'original'] as const) {
      for (const variant of variants.filter(value => value.role === role && value.blob)) {
        mediaUri = await deps.mediaUri(String(variant.blob), variant.mime);
        if (mediaUri) break;
      }
      if (mediaUri) break;
    }
    const name = entry.sourcePath?.split(/[\\/]/).pop() || `Photo ${entry.contentHash.slice(0, 8)}`;
    photos.push({id, name, thumbnailUri, mediaUri, mimeType: entry.mime,
      takenAt: entry.capturedAt ?? entry.exifDate});
  }
  return photos.sort((left, right) => (right.takenAt ?? '').localeCompare(left.takenAt ?? '')
    || left.id.localeCompare(right.id));
}
