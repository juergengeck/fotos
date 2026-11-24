import { useCallback, useEffect, useRef, useState } from 'react';
import {
  prepareGlueSession,
  signInWithGlueCanonical,
  type MobileGlueAuthOutcome,
} from '../services/glue-login';

export function useGlueLogin(
  onGlueAuth: (outcome: MobileGlueAuthOutcome) => Promise<void>,
  hasLocalInstance: (instanceName: string, email: string) => Promise<boolean>,
) {
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canCancel, setCanCancel] = useState(false);

  useEffect(() => () => controller.current?.abort(), []);

  const cancel = useCallback(() => {
    controller.current?.abort();
  }, []);

  const signIn = useCallback(
    async (loginHint: string) => {
      if (controller.current) return;
      const operation = new AbortController();
      controller.current = operation;
      setBusy(true);
      setCanCancel(true);
      setError(null);
      try {
        const outcome = await signInWithGlueCanonical({
          loginHint,
          signal: operation.signal,
          hasLocalInstance,
        });
        if (outcome && !operation.signal.aborted) {
          setCanCancel(false);
          const rememberSession = prepareGlueSession();
          await onGlueAuth(outcome);
          await rememberSession(outcome.credentials);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Glue sign-in failed');
      } finally {
        controller.current = null;
        setBusy(false);
        setCanCancel(false);
      }
    },
    [hasLocalInstance, onGlueAuth],
  );

  return { signIn, cancel, busy, canCancel, error };
}
