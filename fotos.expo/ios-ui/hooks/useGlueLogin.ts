import {useCallback, useEffect, useRef, useState} from 'react';
import {loginWithGlue, prepareGlueSession} from '../services/glue-login';

export function useGlueLogin(onLogin: (localName: string, secret: string) => Promise<void>) {
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canCancel, setCanCancel] = useState(false);
  useEffect(() => () => controller.current?.abort(), []);
  const cancel = useCallback(() => controller.current?.abort(), []);
  const signIn = useCallback(async (loginHint: string) => {
    if (controller.current) return;
    const operation = new AbortController();
    controller.current = operation;
    setBusy(true);
    setCanCancel(true);
    setError(null);
    try {
      const credentials = await loginWithGlue({signal: operation.signal, loginHint});
      if (credentials && !operation.signal.aborted) {
        setCanCancel(false);
        const rememberSession = prepareGlueSession();
        await onLogin(credentials.localName, credentials.secret);
        await rememberSession(credentials.identity.personId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Glue sign-in failed');
    } finally {
      controller.current = null;
      setBusy(false);
      setCanCancel(false);
    }
  }, [onLogin]);
  return {signIn, cancel, busy, canCancel, error};
}
