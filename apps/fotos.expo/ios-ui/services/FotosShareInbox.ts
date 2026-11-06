import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

const CURRENT_PLATFORM = Platform.OS;
export const FOTOS_SHARE_APP_GROUP_ID = 'group.fotos.ios';
const FOTOS_SHARE_INBOX_ROOT = 'fotos-share-inbox';
const FOTOS_SHARE_INBOX_QUEUE = 'queue';
const FOTOS_SHARE_BATCH_MANIFEST = 'manifest.json';

export interface FotosShareInboxManifestItem {
  id: string;
  relativePath: string;
  originalName: string;
  mimeType?: string;
  createdAt?: string;
  sourceApp?: string;
}

export interface FotosShareInboxManifest {
  batchId: string;
  createdAt: string;
  sourceApp?: string;
  items: FotosShareInboxManifestItem[];
}

export interface FotosShareInboxQueuedItem extends FotosShareInboxManifestItem {
  batchId: string;
  fileUri: string;
}

export interface FotosShareInboxBatch {
  directory: Directory;
  manifestFile: File;
  manifest: FotosShareInboxManifest;
  items: FotosShareInboxQueuedItem[];
}

export interface FotosShareInboxStatus {
  available: boolean;
  batchCount: number;
  itemCount: number;
  appGroupId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeManifestItem(batchId: string, batchDirectory: Directory, value: unknown): FotosShareInboxQueuedItem | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.id !== 'string' || typeof value.relativePath !== 'string' || typeof value.originalName !== 'string') {
    return null;
  }

  const sharedFile = new File(batchDirectory, value.relativePath);

  return {
    batchId,
    id: value.id,
    relativePath: value.relativePath,
    originalName: value.originalName,
    fileUri: sharedFile.uri,
    ...(typeof value.mimeType === 'string' ? { mimeType: value.mimeType } : {}),
    ...(typeof value.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
    ...(typeof value.sourceApp === 'string' ? { sourceApp: value.sourceApp } : {}),
  };
}

function normalizeManifest(batchDirectory: Directory, raw: unknown): FotosShareInboxBatch | null {
  if (!isRecord(raw)) {
    return null;
  }

  if (typeof raw.batchId !== 'string' || typeof raw.createdAt !== 'string' || !Array.isArray(raw.items)) {
    return null;
  }

  const batchId = raw.batchId;
  const manifestFile = new File(batchDirectory, FOTOS_SHARE_BATCH_MANIFEST);
  const items = raw.items
    .map((item) => normalizeManifestItem(batchId, batchDirectory, item))
    .filter((item): item is FotosShareInboxQueuedItem => item !== null);

  return {
    directory: batchDirectory,
    manifestFile,
    manifest: {
      batchId,
      createdAt: raw.createdAt,
      ...(typeof raw.sourceApp === 'string' ? { sourceApp: raw.sourceApp } : {}),
      items: items.map((item) => ({
        id: item.id,
        relativePath: item.relativePath,
        originalName: item.originalName,
        ...(item.mimeType ? { mimeType: item.mimeType } : {}),
        ...(item.createdAt ? { createdAt: item.createdAt } : {}),
        ...(item.sourceApp ? { sourceApp: item.sourceApp } : {}),
      })),
    },
    items,
  };
}

function getShareInboxQueueDirectory(): Directory | null {
  if (CURRENT_PLATFORM !== 'ios') {
    return null;
  }

  const container = Paths.appleSharedContainers[FOTOS_SHARE_APP_GROUP_ID];
  if (!container) {
    return null;
  }

  const root = new Directory(container, FOTOS_SHARE_INBOX_ROOT);
  root.create({ intermediates: true, idempotent: true });
  const queue = new Directory(root, FOTOS_SHARE_INBOX_QUEUE);
  queue.create({ intermediates: true, idempotent: true });
  return queue;
}

export async function getFotosShareInboxStatus(): Promise<FotosShareInboxStatus> {
  const queue = getShareInboxQueueDirectory();
  if (!queue || !queue.exists) {
    return {
      available: false,
      batchCount: 0,
      itemCount: 0,
      appGroupId: FOTOS_SHARE_APP_GROUP_ID,
    };
  }

  const batches = await readFotosShareInboxBatches();
  return {
    available: true,
    batchCount: batches.length,
    itemCount: batches.reduce((sum, batch) => sum + batch.items.length, 0),
    appGroupId: FOTOS_SHARE_APP_GROUP_ID,
  };
}

export async function readFotosShareInboxBatches(): Promise<FotosShareInboxBatch[]> {
  const queue = getShareInboxQueueDirectory();
  if (!queue || !queue.exists) {
    return [];
  }

  const records = queue.list().filter((entry): entry is Directory => entry instanceof Directory);
  const batches: FotosShareInboxBatch[] = [];

  for (const batchDirectory of records) {
    const manifestFile = new File(batchDirectory, FOTOS_SHARE_BATCH_MANIFEST);
    if (!manifestFile.exists) {
      continue;
    }

    try {
      const raw = JSON.parse(await manifestFile.text()) as unknown;
      const batch = normalizeManifest(batchDirectory, raw);
      if (batch) {
        batches.push(batch);
      }
    } catch (error) {
      console.warn('[FotosShareInbox] Failed to read batch manifest:', error);
    }
  }

  return batches;
}

export function deleteFotosShareInboxBatch(batch: FotosShareInboxBatch): void {
  if (batch.directory.exists) {
    batch.directory.delete();
  }
}
