import {
  SettingsRegistry,
  defineField,
  defineSection,
  type SectionValues,
} from '@refinio/settings.core';

export const FOTOS_HISTORY_MODULE_ID = 'fotos-history';

export interface FotosBreadcrumbSnapshot {
  version: 1;
  folderName?: string;
  galleryMode: 'images' | 'clusters';
  activeTag?: string;
  activeClusterId?: string;
  searchQuery?: string;
  searchFace?: number[];
}

export interface FotosBreadcrumbEntry {
  eventId: string;
  parentEventId?: string;
  branchPath: string[];
  breadcrumbs: string[];
  folderName?: string;
  state: FotosBreadcrumbSnapshot;
  createdAt: number;
}

export interface FotosBreadcrumbTrieNode {
  children: Record<string, FotosBreadcrumbTrieNode>;
}

export interface FotosBreadcrumbHistory {
  root: FotosBreadcrumbTrieNode;
  entriesById: Record<string, FotosBreadcrumbEntry>;
}

export interface FotosHistorySectionValues extends SectionValues {
  enabled: boolean;
  currentEventId?: string;
  deletedEventIds?: string[];
  history?: FotosBreadcrumbHistory;
}

export interface FotosHistoryBranchNode {
  entry: FotosBreadcrumbEntry;
  children: FotosHistoryBranchNode[];
}

function createEmptyTrieNode(): FotosBreadcrumbTrieNode {
  return { children: {} };
}

export function createEmptyBreadcrumbHistory(): FotosBreadcrumbHistory {
  return {
    root: createEmptyTrieNode(),
    entriesById: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeSearchFace(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const numbers = value
    .map(item => (typeof item === 'number' && Number.isFinite(item) ? item : null))
    .filter((item): item is number => item !== null);

  return numbers.length > 0 ? numbers : undefined;
}

export function normalizeBreadcrumbSnapshot(
  snapshot: FotosBreadcrumbSnapshot,
): FotosBreadcrumbSnapshot {
  return {
    version: 1,
    ...(normalizeOptionalString(snapshot.folderName) ? { folderName: normalizeOptionalString(snapshot.folderName) } : {}),
    galleryMode: snapshot.galleryMode === 'clusters' ? 'clusters' : 'images',
    ...(normalizeOptionalString(snapshot.activeTag) ? { activeTag: normalizeOptionalString(snapshot.activeTag) } : {}),
    ...(normalizeOptionalString(snapshot.activeClusterId)
      ? { activeClusterId: normalizeOptionalString(snapshot.activeClusterId) }
      : {}),
    ...(normalizeOptionalString(snapshot.searchQuery)
      ? { searchQuery: normalizeOptionalString(snapshot.searchQuery) }
      : {}),
    ...(normalizeSearchFace(snapshot.searchFace) ? { searchFace: normalizeSearchFace(snapshot.searchFace) } : {}),
  };
}

function deserializeBreadcrumbSnapshot(value: unknown): FotosBreadcrumbSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  return normalizeBreadcrumbSnapshot({
    version: 1,
    folderName: typeof value.folderName === 'string' ? value.folderName : undefined,
    galleryMode: value.galleryMode === 'clusters' ? 'clusters' : 'images',
    activeTag: typeof value.activeTag === 'string' ? value.activeTag : undefined,
    activeClusterId: typeof value.activeClusterId === 'string' ? value.activeClusterId : undefined,
    searchQuery: typeof value.searchQuery === 'string' ? value.searchQuery : undefined,
    searchFace: Array.isArray(value.searchFace) ? value.searchFace : undefined,
  });
}

function deserializeBreadcrumbEntry(value: unknown): FotosBreadcrumbEntry | null {
  if (!isRecord(value) || typeof value.eventId !== 'string' || value.eventId.length === 0) {
    return null;
  }

  const snapshot = deserializeBreadcrumbSnapshot(value.state);
  if (!snapshot) {
    return null;
  }

  const branchPath = Array.isArray(value.branchPath)
    ? value.branchPath.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];

  const breadcrumbs = Array.isArray(value.breadcrumbs)
    ? value.breadcrumbs.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

  return {
    eventId: value.eventId,
    ...(typeof value.parentEventId === 'string' && value.parentEventId.length > 0
      ? { parentEventId: value.parentEventId }
      : {}),
    branchPath: branchPath.length > 0 ? branchPath : [value.eventId],
    breadcrumbs,
    ...(typeof value.folderName === 'string' && value.folderName.trim().length > 0
      ? { folderName: value.folderName.trim() }
      : {}),
    state: snapshot,
    createdAt: typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
      ? value.createdAt
      : Date.now(),
  };
}

function deserializeTrieNode(value: unknown): FotosBreadcrumbTrieNode {
  if (!isRecord(value) || !isRecord(value.children)) {
    return createEmptyTrieNode();
  }

  const children: Record<string, FotosBreadcrumbTrieNode> = {};
  for (const [key, child] of Object.entries(value.children)) {
    if (key.length === 0) {
      continue;
    }
    children[key] = deserializeTrieNode(child);
  }

  return { children };
}

function normalizeEntryBranchPath(entry: FotosBreadcrumbEntry): FotosBreadcrumbEntry {
  const normalizedParent = entry.parentEventId;
  const fallbackBranchPath = normalizedParent
    ? [...entry.branchPath.filter(Boolean).slice(0, -1), entry.eventId]
    : [entry.eventId];
  const branchPath = entry.branchPath.length > 0 ? entry.branchPath : fallbackBranchPath;

  return {
    ...entry,
    branchPath: branchPath[branchPath.length - 1] === entry.eventId
      ? branchPath
      : [...branchPath, entry.eventId],
    state: normalizeBreadcrumbSnapshot(entry.state),
  };
}

export function deserializeBreadcrumbHistory(value: unknown): FotosBreadcrumbHistory {
  if (!isRecord(value)) {
    return createEmptyBreadcrumbHistory();
  }

  const rawEntries = isRecord(value.entriesById) ? value.entriesById : {};
  const entriesById: Record<string, FotosBreadcrumbEntry> = {};

  for (const [eventId, rawEntry] of Object.entries(rawEntries)) {
    const entry = deserializeBreadcrumbEntry(rawEntry);
    if (!entry || entry.eventId !== eventId) {
      continue;
    }
    entriesById[eventId] = normalizeEntryBranchPath(entry);
  }

  return {
    root: deserializeTrieNode(value.root),
    entriesById,
  };
}

export function insertBreadcrumbEntry(
  history: FotosBreadcrumbHistory,
  entry: FotosBreadcrumbEntry,
): FotosBreadcrumbHistory {
  const normalizedEntry = normalizeEntryBranchPath(entry);

  const insertPath = (
    node: FotosBreadcrumbTrieNode,
    branchPath: string[],
    depth = 0,
  ): FotosBreadcrumbTrieNode => {
    if (depth >= branchPath.length) {
      return {
        children: { ...node.children },
      };
    }

    const eventId = branchPath[depth]!;
    const currentChild = node.children[eventId] ?? createEmptyTrieNode();

    return {
      children: {
        ...node.children,
        [eventId]: insertPath(currentChild, branchPath, depth + 1),
      },
    };
  };

  return {
    root: insertPath(history.root, normalizedEntry.branchPath),
    entriesById: {
      ...history.entriesById,
      [normalizedEntry.eventId]: normalizedEntry,
    },
  };
}

export function isSnapshotEqual(
  left: FotosBreadcrumbSnapshot,
  right: FotosBreadcrumbSnapshot,
): boolean {
  return JSON.stringify(normalizeBreadcrumbSnapshot(left))
    === JSON.stringify(normalizeBreadcrumbSnapshot(right));
}

export function isEntryHidden(
  eventId: string,
  deletedEventIds: ReadonlySet<string>,
  entriesById: Record<string, FotosBreadcrumbEntry>,
): boolean {
  let cursor: FotosBreadcrumbEntry | undefined = entriesById[eventId];

  while (cursor) {
    if (deletedEventIds.has(cursor.eventId)) {
      return true;
    }
    cursor = cursor.parentEventId ? entriesById[cursor.parentEventId] : undefined;
  }

  return false;
}

export function buildHistoryBranchTree(
  history: FotosBreadcrumbHistory,
  deletedEventIds: ReadonlySet<string>,
): FotosHistoryBranchNode[] {
  const sortEventIds = (eventIds: string[]): string[] => {
    return [...eventIds].sort((left, right) => {
      const leftEntry = history.entriesById[left];
      const rightEntry = history.entriesById[right];
      return (leftEntry?.createdAt ?? 0) - (rightEntry?.createdAt ?? 0);
    });
  };

  const buildNodes = (node: FotosBreadcrumbTrieNode, hiddenAncestor: boolean): FotosHistoryBranchNode[] => {
    const rows: FotosHistoryBranchNode[] = [];

    for (const eventId of sortEventIds(Object.keys(node.children))) {
      const entry = history.entriesById[eventId];
      const childNode = node.children[eventId] ?? createEmptyTrieNode();
      const hidden = hiddenAncestor || deletedEventIds.has(eventId) || !entry;

      if (hidden) {
        rows.push(...buildNodes(childNode, true));
        continue;
      }

      rows.push({
        entry,
        children: buildNodes(childNode, false),
      });
    }

    return rows;
  };

  return buildNodes(history.root, false);
}

export function findVisibleAncestorEventId(
  eventId: string | undefined,
  deletedEventIds: ReadonlySet<string>,
  entriesById: Record<string, FotosBreadcrumbEntry>,
): string {
  let cursor: FotosBreadcrumbEntry | undefined = eventId ? entriesById[eventId] : undefined;

  while (cursor) {
    if (!isEntryHidden(cursor.eventId, deletedEventIds, entriesById)) {
      return cursor.eventId;
    }
    cursor = cursor.parentEventId ? entriesById[cursor.parentEventId] : undefined;
  }

  return '';
}

export const DEFAULT_FOTOS_HISTORY_SECTION_VALUES: FotosHistorySectionValues = {
  enabled: false,
  currentEventId: '',
  deletedEventIds: [],
  history: createEmptyBreadcrumbHistory(),
};

export const FotosHistorySettingsSection = defineSection({
  id: FOTOS_HISTORY_MODULE_ID,
  name: 'History',
  module: 'fotos.browser',
  order: 41,
  fields: [
    defineField({
      key: 'enabled',
      type: 'boolean',
      label: 'Record Breadcrumb History',
      description: 'Store breadcrumb navigation as branchable ONE objects.',
      default: DEFAULT_FOTOS_HISTORY_SECTION_VALUES.enabled,
    }),
  ],
});

export function registerFotosHistorySettings(): void {
  if (!SettingsRegistry.hasSection(FOTOS_HISTORY_MODULE_ID)) {
    SettingsRegistry.registerSection(FotosHistorySettingsSection);
  }
}

export function deserializeFotosHistorySection(
  values: Partial<FotosHistorySectionValues> | null | undefined,
): FotosHistorySectionValues {
  return {
    enabled: values?.enabled === true,
    currentEventId: typeof values?.currentEventId === 'string' ? values.currentEventId : '',
    deletedEventIds: Array.isArray(values?.deletedEventIds)
      ? values.deletedEventIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [],
    history: deserializeBreadcrumbHistory(values?.history),
  };
}

export function serializeFotosHistorySection(
  values: Partial<FotosHistorySectionValues> | null | undefined,
): FotosHistorySectionValues {
  return deserializeFotosHistorySection(values);
}
