import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FotosModel } from '@/lib/onecore-boot';
import {
    DEFAULT_FOTOS_HISTORY_SECTION_VALUES,
    FOTOS_HISTORY_MODULE_ID,
    buildHistoryBranchTree,
    createEmptyBreadcrumbHistory,
    deserializeFotosHistorySection,
    findVisibleAncestorEventId,
    insertBreadcrumbEntry,
    isEntryHidden,
    isSnapshotEqual,
    normalizeBreadcrumbSnapshot,
    serializeFotosHistorySection,
    type FotosBreadcrumbEntry,
    type FotosBreadcrumbSnapshot,
    type FotosHistoryBranchNode,
    type FotosHistorySectionValues,
} from '@/lib/fotosHistorySettings';

interface UseBreadcrumbHistoryOptions {
    model: FotosModel | null;
    snapshot: FotosBreadcrumbSnapshot | null;
    breadcrumbs: string[];
}

interface UseBreadcrumbHistoryResult {
    ready: boolean;
    enabled: boolean;
    currentEventId: string;
    currentEntry: FotosBreadcrumbEntry | null;
    restoreEntry: FotosBreadcrumbEntry | null;
    branchTree: FotosHistoryBranchNode[];
    visibleEntryCount: number;
    branchCount: number;
    setEnabled: (enabled: boolean) => void;
    navigateTo: (eventId: string) => void;
    deleteEntry: (eventId: string) => void;
}

function normalizeBreadcrumbs(breadcrumbs: string[]): string[] {
    return breadcrumbs
        .map(item => item.trim())
        .filter(item => item.length > 0);
}

function sameFolder(
    left: string | undefined,
    right: string | undefined,
): boolean {
    return (left ?? '') === (right ?? '');
}

function countVisibleEntries(nodes: FotosHistoryBranchNode[]): number {
    return nodes.reduce((count, node) => count + 1 + countVisibleEntries(node.children), 0);
}

function findMatchingEntryId(
    parentEventId: string | undefined,
    snapshot: FotosBreadcrumbSnapshot,
    entriesById: Record<string, FotosBreadcrumbEntry>,
    deletedEventIds: ReadonlySet<string>,
): string {
    const candidates = Object.values(entriesById)
        .filter(entry => (entry.parentEventId ?? '') === (parentEventId ?? ''))
        .filter(entry => !isEntryHidden(entry.eventId, deletedEventIds, entriesById))
        .sort((left, right) => right.createdAt - left.createdAt);

    const match = candidates.find(entry =>
        sameFolder(entry.folderName, snapshot.folderName)
        && isSnapshotEqual(entry.state, snapshot),
    );

    return match?.eventId ?? '';
}

export function useBreadcrumbHistory({
    model,
    snapshot,
    breadcrumbs,
}: UseBreadcrumbHistoryOptions): UseBreadcrumbHistoryResult {
    const [section, setSection] = useState<FotosHistorySectionValues>(DEFAULT_FOTOS_HISTORY_SECTION_VALUES);
    const [ready, setReady] = useState<boolean>(model?.settingsPlan ? false : true);
    const [restoreEventId, setRestoreEventId] = useState<string | null>(null);
    const sectionRef = useRef(section);
    const previousCurrentEventIdRef = useRef('');

    useEffect(() => {
        sectionRef.current = section;
    }, [section]);

    useEffect(() => {
        if (!model?.settingsPlan) {
            setReady(true);
            return;
        }

        let cancelled = false;
        setReady(false);

        const applySection = (values: Partial<FotosHistorySectionValues> | null | undefined) => {
            if (cancelled) {
                return;
            }
            const next = deserializeFotosHistorySection(values);
            sectionRef.current = next;
            setSection(next);
            setReady(true);
        };

        void model.settingsPlan.getSection({
            moduleId: FOTOS_HISTORY_MODULE_ID,
        }).then(({ values }) => {
            applySection(values as Partial<FotosHistorySectionValues>);
        }).catch((error: unknown) => {
            console.warn('[fotos.history] Failed to load history settings:', error);
            setReady(true);
        });

        const unsubscribe = model.settingsPlan.subscribe((allSettings: Record<string, unknown>) => {
            const values = allSettings[FOTOS_HISTORY_MODULE_ID] as Partial<FotosHistorySectionValues> | undefined;
            applySection(values);
        });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [model?.settingsPlan]);

    const commitSection = useCallback((recipe: (current: FotosHistorySectionValues) => FotosHistorySectionValues) => {
        setSection(current => {
            const next = serializeFotosHistorySection(recipe(current));
            sectionRef.current = next;

            if (model?.settingsPlan) {
                void model.settingsPlan.updateSection({
                    moduleId: FOTOS_HISTORY_MODULE_ID,
                    values: next,
                }).catch((error: unknown) => {
                    console.warn('[fotos.history] Failed to persist history settings:', error);
                });
            }

            return next;
        });
    }, [model?.settingsPlan]);

    const deletedEventIds = useMemo(
        () => new Set(section.deletedEventIds ?? []),
        [section.deletedEventIds],
    );
    const history = section.history ?? createEmptyBreadcrumbHistory();
    const currentEntry = useMemo(() => {
        const currentEventId = section.currentEventId ?? '';
        return currentEventId ? history.entriesById[currentEventId] ?? null : null;
    }, [history.entriesById, section.currentEventId]);

    const branchTree = useMemo(
        () => buildHistoryBranchTree(history, deletedEventIds),
        [deletedEventIds, history],
    );
    const visibleEntryCount = useMemo(
        () => countVisibleEntries(branchTree),
        [branchTree],
    );

    useEffect(() => {
        const nextCurrentEventId = section.currentEventId ?? '';

        if (nextCurrentEventId !== previousCurrentEventIdRef.current) {
            previousCurrentEventIdRef.current = nextCurrentEventId;
            setRestoreEventId(nextCurrentEventId || null);
        }
    }, [section.currentEventId]);

    useEffect(() => {
        const currentEventId = section.currentEventId ?? '';
        if (!currentEventId) {
            return;
        }

        if (!history.entriesById[currentEventId] || isEntryHidden(currentEventId, deletedEventIds, history.entriesById)) {
            const fallbackEventId = findVisibleAncestorEventId(currentEventId, deletedEventIds, history.entriesById);
            if (fallbackEventId !== currentEventId) {
                commitSection(current => ({
                    ...current,
                    currentEventId: fallbackEventId,
                }));
            }
        }
    }, [commitSection, deletedEventIds, history.entriesById, section.currentEventId]);

    const normalizedSnapshot = useMemo(
        () => (snapshot ? normalizeBreadcrumbSnapshot(snapshot) : null),
        [snapshot],
    );
    const normalizedBreadcrumbs = useMemo(
        () => normalizeBreadcrumbs(breadcrumbs),
        [breadcrumbs],
    );

    const restoreEntry = useMemo(() => {
        if (!restoreEventId) {
            return null;
        }
        return history.entriesById[restoreEventId] ?? null;
    }, [history.entriesById, restoreEventId]);

    useEffect(() => {
        if (!restoreEntry || !normalizedSnapshot) {
            return;
        }

        if (!sameFolder(restoreEntry.folderName, normalizedSnapshot.folderName)) {
            return;
        }

        if (isSnapshotEqual(restoreEntry.state, normalizedSnapshot)) {
            setRestoreEventId(current => (current === restoreEntry.eventId ? null : current));
        }
    }, [normalizedSnapshot, restoreEntry]);

    useEffect(() => {
        if (!ready || !section.enabled || !normalizedSnapshot) {
            return;
        }

        if (restoreEntry && sameFolder(restoreEntry.folderName, normalizedSnapshot.folderName)) {
            return;
        }

        const timeoutId = globalThis.setTimeout(() => {
            const latest = sectionRef.current;
            const latestHistory = latest.history ?? createEmptyBreadcrumbHistory();
            const latestDeletedEventIds = new Set(latest.deletedEventIds ?? []);
            const latestEntries = latestHistory.entriesById;
            const latestCurrentEventId = latest.currentEventId ?? '';
            const latestCurrentEntry = latestCurrentEventId
                ? latestEntries[latestCurrentEventId] ?? null
                : null;

            const currentParentEventId = latestCurrentEntry && sameFolder(latestCurrentEntry.folderName, normalizedSnapshot.folderName)
                ? findVisibleAncestorEventId(latestCurrentEntry.eventId, latestDeletedEventIds, latestEntries)
                : '';
            const currentParentEntry = currentParentEventId
                ? latestEntries[currentParentEventId] ?? null
                : null;

            if (currentParentEntry && isSnapshotEqual(currentParentEntry.state, normalizedSnapshot)) {
                return;
            }

            const matchingEventId = findMatchingEntryId(
                currentParentEntry?.eventId,
                normalizedSnapshot,
                latestEntries,
                latestDeletedEventIds,
            );

            if (matchingEventId) {
                if (matchingEventId !== latestCurrentEventId) {
                    commitSection(current => ({
                        ...current,
                        currentEventId: matchingEventId,
                    }));
                }
                return;
            }

            const eventId = globalThis.crypto.randomUUID();
            const entry: FotosBreadcrumbEntry = {
                eventId,
                ...(currentParentEntry ? { parentEventId: currentParentEntry.eventId } : {}),
                branchPath: currentParentEntry
                    ? [...currentParentEntry.branchPath, eventId]
                    : [eventId],
                breadcrumbs: normalizedBreadcrumbs,
                ...(normalizedSnapshot.folderName ? { folderName: normalizedSnapshot.folderName } : {}),
                state: normalizedSnapshot,
                createdAt: Date.now(),
            };

            commitSection(current => ({
                ...current,
                currentEventId: eventId,
                history: insertBreadcrumbEntry(
                    current.history ?? createEmptyBreadcrumbHistory(),
                    entry,
                ),
            }));
        }, 300);

        return () => {
            globalThis.clearTimeout(timeoutId);
        };
    }, [commitSection, normalizedBreadcrumbs, normalizedSnapshot, ready, restoreEntry, section.enabled]);

    const setEnabled = useCallback((enabled: boolean) => {
        commitSection(current => ({
            ...current,
            enabled,
        }));
    }, [commitSection]);

    const navigateTo = useCallback((eventId: string) => {
        if (!history.entriesById[eventId]) {
            return;
        }

        commitSection(current => ({
            ...current,
            currentEventId: eventId,
        }));
    }, [commitSection, history.entriesById]);

    const deleteEntry = useCallback((eventId: string) => {
        if (!history.entriesById[eventId]) {
            return;
        }

        commitSection(current => {
            const nextDeletedEventIds = new Set(current.deletedEventIds ?? []);
            nextDeletedEventIds.add(eventId);

            const entriesById = (current.history ?? createEmptyBreadcrumbHistory()).entriesById;
            const currentEventId = current.currentEventId ?? '';
            const nextCurrentEventId = findVisibleAncestorEventId(
                currentEventId,
                nextDeletedEventIds,
                entriesById,
            );

            return {
                ...current,
                currentEventId: nextCurrentEventId,
                deletedEventIds: [...nextDeletedEventIds],
            };
        });
    }, [commitSection, history.entriesById]);

    return {
        ready,
        enabled: section.enabled,
        currentEventId: section.currentEventId ?? '',
        currentEntry,
        restoreEntry,
        branchTree,
        visibleEntryCount,
        branchCount: branchTree.length,
        setEnabled,
        navigateTo,
        deleteEntry,
    };
}
