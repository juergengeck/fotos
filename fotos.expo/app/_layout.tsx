import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Model, ModelProvider, getModel, setGlobalModel } from '../ios-ui';
import { installCommServerGuard } from '../src/install-commserver-guard';
import { palette } from '../src/theme';
import {useFotosShareInboxAutoDrain} from '../ios-ui/hooks/useFotosShareInboxAutoDrain';
import {useGlueLogin} from '../ios-ui/hooks/useGlueLogin';
import {GlueLoginField} from '../ios-ui/components/GlueLoginField';
import {
  clearGlueSession,
  forgetGlueSubject,
  restoreGlueSession,
  type MobileGlueAuthOutcome,
} from '../ios-ui/services/glue-login';

const COMM_SERVER_URL = 'wss://api.glue.one/comm';

installCommServerGuard();

interface LoginProps {
  busy: boolean;
  notice?: string | null;
  onLogin: (username: string, password: string) => Promise<void>;
  onGlueAuth: (outcome: MobileGlueAuthOutcome) => Promise<void>;
  hasLocalInstance: (instanceName: string, email: string) => Promise<boolean>;
}

function LoginScreen({ busy: localBusy, notice, onLogin, onGlueAuth, hasLocalInstance }: LoginProps) {
  const glue = useGlueLogin(onGlueAuth, hasLocalInstance);
  const busy = localBusy || glue.busy;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canLoginLocally = username.trim().length > 0 && password.length > 0;

  const submit = useCallback(async () => {
    if (!username.trim() || !password) return;
    setError(null);
    try {
      await onLogin(username.trim(), password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    }
  }, [onLogin, password, username]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.surface }}
      behavior="padding"
    >
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          paddingHorizontal: 24,
          gap: 20,
        }}
      >
        <View style={{ alignItems: 'center', gap: 10 }}>
          <Image
            source={require('../assets/login-logo.png')}
            accessibilityLabel="fotos.one"
            accessibilityRole="image"
            style={{ width: 96, height: 96 }}
            resizeMode="contain"
          />
          <Text style={{ fontSize: 32, fontWeight: '700', color: palette.text }}>
            fotos.one
          </Text>
          <Text style={{ fontSize: 15, color: palette.textMuted, textAlign: 'center' }}>
            ONE-powered mobile client for fotos, built on the same Refino runtime spine as vger.expo.
          </Text>
        </View>

        <View style={{ gap: 14 }}>
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: palette.textMuted }}>
              Identity
            </Text>
            <GlueLoginField busy={glue.busy} disabled={busy} onPress={() => { setError(null); void glue.signIn(username); }}>
              <TextInput
                testID="expo-login-identity"
                accessibilityLabel="Identity"
                value={username}
                onChangeText={setUsername}
                editable={!busy}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                placeholder="handle@glue.one"
                style={{
                  borderWidth: 1,
                  borderColor: palette.border,
                  borderRadius: 16,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  fontSize: 16,
                  color: palette.text,
                  backgroundColor: palette.surfaceMuted,
                }}
              />
            </GlueLoginField>
          </View>
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: palette.textMuted }}>
              Secret
            </Text>
            <TextInput
              testID="expo-login-secret"
              accessibilityLabel="Secret"
              value={password}
              onChangeText={setPassword}
              editable={!busy}
              secureTextEntry
              placeholder="Local account secret"
              style={{
                borderWidth: 1,
                borderColor: palette.border,
                borderRadius: 16,
                paddingHorizontal: 16,
                paddingVertical: 14,
                fontSize: 16,
                color: palette.text,
                backgroundColor: palette.surfaceMuted,
              }}
            />
          </View>
        </View>

        {notice && !error && !glue.error ? (
          <View
            style={{
              borderRadius: 16,
              borderWidth: 1,
              borderColor: palette.border,
              backgroundColor: palette.surfaceMuted,
              padding: 14,
            }}
          >
            <Text style={{ color: palette.textMuted, fontSize: 14 }}>{notice}</Text>
          </View>
        ) : null}

        {error || glue.error ? (
          <View
            style={{
              borderRadius: 16,
              borderWidth: 1,
              borderColor: '#efc1b3',
              backgroundColor: '#fff4ef',
              padding: 14,
            }}
          >
            <Text style={{ color: palette.danger, fontSize: 14 }}>{error || glue.error}</Text>
          </View>
        ) : null}

        {glue.canCancel && <Pressable testID="expo-glue-cancel" onPress={glue.cancel}><Text style={{color: palette.text}}>Cancel Glue sign-in</Text></Pressable>}

        <Pressable
          testID="expo-local-login"
          accessibilityRole="button"
          onPress={submit}
          disabled={busy || !canLoginLocally}
          accessibilityState={{disabled: busy || !canLoginLocally}}
          style={{
            borderRadius: 16,
            backgroundColor: palette.accent,
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 52,
            opacity: busy || !canLoginLocally ? 0.6 : 1,
          }}
        >
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700' }}>
              Sign in locally
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function isMissingLocalUserError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /user does not exist/i.test(message);
}

function useAppInit() {
  const [model, setModel] = useState<Model | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const loginInFlight = useRef(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const mountedRef = useRef(true);


  const modelRef = useRef<Model | null>(null);
  modelRef.current = model;

  const ensureModel = useCallback(() => {
    const existingModel = modelRef.current ?? getModel();
    if (existingModel) return existingModel;

    const nextModel = new Model(COMM_SERVER_URL);
    nextModel.onOneModelsReady(() => {
      if (mountedRef.current) {
        setAuthenticated(true);
      }
    });
    nextModel.one.onLogout(() => {
      if (mountedRef.current) {
        setAuthenticated(false);
      }
    });

    modelRef.current = nextModel;
    if (mountedRef.current) {
      setGlobalModel(nextModel);
      setModel(nextModel);
    }

    return nextModel;
  }, []);

  const startupRestore = useRef<Promise<void> | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    installCommServerGuard();
    if (!startupRestore.current) {
      startupRestore.current = (async () => {
        const existingModel = getModel();
        if (existingModel?.initialized) {
          setModel(existingModel);
          setAuthenticated(true);
          return;
        }
        if (existingModel) setModel(existingModel);
        await restoreGlueSession(async saved => {
          if (!mountedRef.current) return;
          const activeModel = ensureModel();
          // Reopening must never create a new account when local data is missing.
          try {
            await activeModel.one.login(saved.email, saved.secret, saved.instanceName);
          } catch (loginErr) {
            if (isMissingLocalUserError(loginErr)) {
              // iOS Keychain survives app reinstall while local ONE storage was wiped.
              // Forget the stale saved subject and return cleanly to sign-in.
              await forgetGlueSubject(saved.personId).catch(() => {});
              if (mountedRef.current) {
                setLoginNotice('Local storage was reset after reinstall. Sign in again to continue.');
              }
              return;
            }
            throw loginErr;
          }
        });
      })();
    }
    void startupRestore.current.catch(err => {
      if (mountedRef.current) setError(err instanceof Error ? err.message : String(err));
    }).finally(() => {
      if (mountedRef.current) setInitializing(false);
    });
    return () => { mountedRef.current = false; };
  }, [ensureModel]);

  const login = useCallback(async (username: string, password: string) => {
    if (loginInFlight.current) {
      return;
    }

    loginInFlight.current = true;
    setLoginBusy(true);
    try {
      const activeModel = ensureModel();
      const email = username.includes('@') ? username : `${username}@fotos.one`;
      await activeModel.one.loginOrRegister(email, password, email);
      await clearGlueSession();
    } finally {
      loginInFlight.current = false;
      setLoginBusy(false);
    }
  }, [ensureModel]);

  const glueAuth = useCallback(async (outcome: MobileGlueAuthOutcome) => {
    const activeModel = ensureModel();
    if (outcome.kind === 'enrolled') {
      await activeModel.loginWithGlueEnrollment(outcome.receipt);
    } else {
      await activeModel.one.login(
        outcome.credentials.email,
        outcome.credentials.secret,
        outcome.credentials.instanceName,
      );
    }
  }, [ensureModel]);

  const hasLocalInstance = useCallback(
    async (instanceName: string, email: string) => {
      const activeModel = ensureModel();
      return activeModel.one.isRegistered(email, instanceName);
    },
    [ensureModel],
  );

  const resetStartupError = useCallback(async () => {
    await clearGlueSession().catch(() => {});
    if (mountedRef.current) {
      setError(null);
      setLoginNotice(null);
    }
  }, []);

  return {
    glueAuth,
    hasLocalInstance,
    model,
    initializing,
    authenticated,
    error,
    loginNotice,
    resetStartupError,
    login,
    loginInFlight: loginBusy,
  };
}

export default function RootLayout() {
  const {
    model,
    initializing,
    authenticated,
    error,
    loginNotice,
    resetStartupError,
    login,
    glueAuth,
    hasLocalInstance,
    loginInFlight,
  } = useAppInit();

  useFotosShareInboxAutoDrain(model, authenticated && !initializing && !error);

  if (error) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.surface,
          padding: 24,
          gap: 16,
        }}
      >
        <Text style={{ fontSize: 22, fontWeight: '700', color: palette.danger }}>
          Startup Failed
        </Text>
        <Text style={{ color: palette.textMuted, textAlign: 'center' }}>
          {error}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void resetStartupError()}
          style={{
            borderRadius: 14,
            backgroundColor: palette.accent,
            paddingHorizontal: 20,
            paddingVertical: 12,
          }}
        >
          <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: '700' }}>
            Return to Sign In
          </Text>
        </Pressable>
      </View>
    );
  }

  if (initializing) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.surface,
          gap: 16,
        }}
      >
        <ActivityIndicator size="large" color={palette.accent} />
        <Text style={{ color: palette.textMuted, fontSize: 15 }}>
          Starting fotos runtime...
        </Text>
      </View>
    );
  }

  if (!authenticated || !model) {
    return (
      <>
        <StatusBar style="dark" />
        <LoginScreen
          busy={loginInFlight}
          notice={loginNotice}
          onLogin={login}
          onGlueAuth={glueAuth}
          hasLocalInstance={hasLocalInstance}
        />
      </>
    );
  }

  return (
    <ModelProvider model={model}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </ModelProvider>
  );
}
