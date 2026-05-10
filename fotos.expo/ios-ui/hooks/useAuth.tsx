/**
 * Authentication hook for VGER iOS
 *
 * Uses Model.one (MultiUser) for authentication.
 * Follows one.leute pattern - direct model access.
 * Supports automatic user creation via loginOrRegister().
 */

import { useState, useEffect, useCallback } from 'react';
import { useModel } from './ModelContext';

export interface UseAuthReturn {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  error: Error | null;
}

/**
 * Hook for authentication state and operations
 *
 * Automatically creates users if they don't exist when logging in.
 *
 * @example
 * ```tsx
 * function SettingsScreen() {
 *   const { isAuthenticated, logout, error } = useAuth();
 *
 *   const handleLogout = async () => {
 *     await logout();
 *   };
 *
 *   return <View>...</View>;
 * }
 * ```
 */
export function useAuth(): UseAuthReturn {
  const model = useModel();
  const [isAuthenticated, setIsAuthenticated] = useState(model.initialized);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Sync state with model initialization
    setIsAuthenticated(model.initialized);

    // Listen for ready events
    const handleReady = () => {
      console.log('[useAuth] Model ready event received');
      setIsAuthenticated(true);
      setError(null);
    };

    const disconnect = model.onOneModelsReady(handleReady);

    return () => disconnect();
  }, [model]);

  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);

    try {
      console.log('[useAuth] Logging in or registering user...');
      // Use loginOrRegister for automatic user creation
      // instanceName uses email for uniqueness
      await model.one.loginOrRegister(email, password, email);
      // isAuthenticated will be set by Model.init() completing
      setIsLoading(false);
    } catch (e) {
      console.error('[useAuth] Login/register failed:', e);
      setError(e instanceof Error ? e : new Error(String(e)));
      setIsLoading(false);
      throw e;
    }
  }, [model]);

  const logout = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      console.log('[useAuth] Logging out...');
      await model.one.logout();
      setIsAuthenticated(false);
      setIsLoading(false);
    } catch (e) {
      console.error('[useAuth] Logout failed:', e);
      setError(e instanceof Error ? e : new Error(String(e)));
      setIsLoading(false);
      throw e;
    }
  }, [model]);

  return {
    isAuthenticated,
    isLoading,
    login,
    logout,
    error
  };
}
