// packages/vger.expo/ios-ui/hooks/useJournal.ts
/**
 * useJournal Hook - React hook for journal/activity feed access
 *
 * Provides access to the Assembly-based journal via JournalPlan.
 * Follows the pattern from vger.cube's JournalViewWrapper.
 */

import { useState, useEffect, useCallback } from 'react';
import { useModel } from './ModelContext';
import type { AssemblyQueryOptions, AssemblyWithStory } from '@refinio/assembly.core';

export interface UseJournalReturn {
  /** Journal entries (Assembly + Story pairs) */
  entries: AssemblyWithStory[];
  /** Whether entries are currently loading */
  isLoading: boolean;
  /** Error message if query failed */
  error: string | null;
  /** Currently selected plan types for filtering */
  selectedPlanTypes: Set<string>;
  /** Toggle a plan type filter on/off */
  togglePlanType: (type: string) => void;
  /** Set all selected plan types at once */
  setSelectedPlanTypes: (types: Set<string>) => void;
  /** Manually refresh journal entries */
  refresh: () => Promise<void>;
  /** Query assemblies with custom options */
  queryAssemblies: (options: AssemblyQueryOptions) => Promise<AssemblyWithStory[]>;
  /** Get journal statistics */
  getStats: () => { totalAssemblies: number } | null;
}

const DEFAULT_PLAN_TYPES = [
  'SomeonePlan',      // Contacts
  'OneInstancePlan',  // Device instances
  'ChatPlan',         // Messages
  'GroupPlan',        // Groups
  'AIPlan',           // AI assistants
  'CAPlan',           // Certificates
  'ConnectionPlan'    // Connections
];

export function useJournal(initialPlanTypes: string[] = DEFAULT_PLAN_TYPES): UseJournalReturn {
  const model = useModel();
  const [entries, setEntries] = useState<AssemblyWithStory[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlanTypes, setSelectedPlanTypes] = useState<Set<string>>(
    new Set(initialPlanTypes)
  );

  const queryAssemblies = useCallback(async (options: AssemblyQueryOptions): Promise<AssemblyWithStory[]> => {
    if (!model?.initialized || !model.journalPlan) {
      console.warn('[useJournal] Model not initialized or journalPlan not available');
      return [];
    }

    try {
      const results = await model.journalPlan.queryAssemblies(options);
      return results;
    } catch (err: any) {
      console.error('[useJournal] Query failed:', err);
      throw err;
    }
  }, [model]);

  const loadEntries = useCallback(async () => {
    if (!model?.initialized || !model.journalPlan) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const results = await queryAssemblies({
        planTypes: Array.from(selectedPlanTypes),
        sortBy: 'created',
        order: 'desc',
        limit: 500
      });
      setEntries(results);
      console.log(`[useJournal] Loaded ${results.length} journal entries`);
    } catch (err: any) {
      console.error('[useJournal] Failed to load entries:', err);
      setError(err.message || 'Failed to load journal entries');
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [model, selectedPlanTypes, queryAssemblies]);

  const togglePlanType = useCallback((type: string) => {
    setSelectedPlanTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const getStats = useCallback(() => {
    if (!model?.initialized || !model.journalPlan) {
      return null;
    }
    return model.journalPlan.getStats();
  }, [model]);

  // Load entries when model is ready or filters change
  useEffect(() => {
    if (model?.initialized) {
      loadEntries();
    }
  }, [model?.initialized, loadEntries]);

  return {
    entries,
    isLoading,
    error,
    selectedPlanTypes,
    togglePlanType,
    setSelectedPlanTypes,
    refresh: loadEntries,
    queryAssemblies,
    getStats
  };
}
