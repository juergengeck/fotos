import { useState, useEffect, useCallback } from 'react';
import { useModel } from './ModelContext';
import type { InstanceEntry } from '@vger/vger.core/plans/InstanceRegistryPlan.js';

export type { InstanceEntry };

export interface UseInstancesReturn {
  /** User's own devices (IoM - Internet of Me) */
  myInstances: InstanceEntry[];
  /** Contact devices grouped by personId (IoP - Internet of People) */
  contactInstances: Map<string, InstanceEntry[]>;
  /** This device */
  localInstance: InstanceEntry | null;
  /** Loading state */
  isLoading: boolean;
  /** Error if any */
  error: Error | null;
  /** Refresh all instance data */
  refresh: () => Promise<void>;
}

/**
 * Hook for accessing Instance Management data (IoM/IoP)
 *
 * Provides unified view of:
 * - IoM (Internet of Me): User's own devices (trustLevel === 'me')
 * - IoP (Internet of People): Contact devices grouped by person
 */
export function useInstances(): UseInstancesReturn {
  const model = useModel();
  const [myInstances, setMyInstances] = useState<InstanceEntry[]>([]);
  const [contactInstances, setContactInstances] = useState<Map<string, InstanceEntry[]>>(new Map());
  const [localInstance, setLocalInstance] = useState<InstanceEntry | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadInstances = useCallback(async () => {
    if (!model.initialized) {
      setIsLoading(true);
      return;
    }

    try {
      const plan = model.instanceRegistryPlan;
      if (!plan) {
        console.warn('[useInstances] InstanceRegistryPlan not available');
        setIsLoading(false);
        return;
      }

      // Load all instance data in parallel
      const [myResponse, contactResponse, localResponse] = await Promise.all([
        plan.getMyInstances(),
        plan.getContactInstances(),
        plan.getLocalInstance()
      ]);

      setMyInstances(myResponse.instances);
      setContactInstances(new Map(Object.entries(contactResponse.instancesByPerson)));
      setLocalInstance(localResponse.instance);
      setError(null);
    } catch (err) {
      console.error('[useInstances] Error loading instances:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
      // Reset to empty state on error
      setMyInstances([]);
      setContactInstances(new Map());
      setLocalInstance(null);
    } finally {
      setIsLoading(false);
    }
  }, [model]);

  useEffect(() => {
    loadInstances();

    // Subscribe to connection changes (instance state depends on connections)
    const unsubscribe = model.onConnectionsChanged(async () => {
      await loadInstances();
    });

    return () => unsubscribe();
  }, [model, loadInstances]);

  return {
    myInstances,
    contactInstances,
    localInstance,
    isLoading,
    error,
    refresh: loadInstances
  };
}
