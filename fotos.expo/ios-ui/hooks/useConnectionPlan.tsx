import { useState, useEffect, useCallback } from 'react';
import { useModel } from './ModelContext';

export interface DeviceConnection {
  id: string;
  name: string;
  status: 'connected' | 'disconnected' | 'pairing';
  lastSeen?: number;
}

export interface UseConnectionPlanReturn {
  connections: DeviceConnection[];
  pairingCode: string | null;
  isLoading: boolean;
  generatePairingCode: (displayName: string) => Promise<string>;
  enterPairingCode: (code: string) => Promise<void>;
  refreshConnections: () => Promise<void>;
}

export function useConnectionPlan(): UseConnectionPlanReturn {
  const model = useModel();
  const [connections, setConnections] = useState<DeviceConnection[]>([]);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadConnections = useCallback(async () => {
    if (!model.initialized) {
      setIsLoading(true);
      return;
    }

    try {
      if (!model.connectionPlan) {
        console.warn('[useConnectionPlan] ConnectionPlan not available');
        setIsLoading(false);
        return;
      }

      // Get active connections
      const activeConnections = await model.connectionPlan.getConnections();
      setConnections(activeConnections);
    } catch (error) {
      console.error('[useConnectionPlan] Error loading connections:', error);
      // Set empty array on error to avoid breaking UI
      setConnections([]);
    } finally {
      setIsLoading(false);
    }
  }, [model]);

  useEffect(() => {
    loadConnections();

    // Subscribe to connection changes
    const disconnectHandler = model.onConnectionsChanged(async () => {
      await loadConnections();
    });

    return () => disconnectHandler();
  }, [model, loadConnections]);

  const generatePairingCode = useCallback(async (displayName: string): Promise<string> => {
    if (!model.connectionPlan) {
      throw new Error('ConnectionPlan not available');
    }

    const code = await model.connectionPlan.generatePairingCode(displayName);
    setPairingCode(code);
    return code;
  }, [model]);

  const enterPairingCode = useCallback(async (code: string) => {
    if (!model.connectionPlan) {
      throw new Error('ConnectionPlan not available');
    }

    await model.connectionPlan.enterPairingCode(code);
    await loadConnections();
    setPairingCode(null);
  }, [model, loadConnections]);

  return {
    connections,
    pairingCode,
    isLoading,
    generatePairingCode,
    enterPairingCode,
    refreshConnections: loadConnections
  };
}
