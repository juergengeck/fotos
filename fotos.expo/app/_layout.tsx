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
import { palette } from '../src/theme';

const COMM_SERVER_URL = 'wss://api.glue.one/comm';

interface LoginProps {
  busy: boolean;
  onLogin: (username: string, password: string) => Promise<void>;
}

function LoginScreen({ busy, onLogin }: LoginProps) {
  const [username, setUsername] = useState('demo');
  const [password, setPassword] = useState('demo');
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
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
            source={require('../assets/icon.png')}
            style={{ width: 96, height: 96, borderRadius: 24 }}
            resizeMode="cover"
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
            <TextInput
              value={username}
              onChangeText={setUsername}
              editable={!busy}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="demo"
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
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: palette.textMuted }}>
              Secret
            </Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              editable={!busy}
              secureTextEntry
              placeholder="demo"
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

        {error ? (
          <View
            style={{
              borderRadius: 16,
              borderWidth: 1,
              borderColor: '#efc1b3',
              backgroundColor: '#fff4ef',
              padding: 14,
            }}
          >
            <Text style={{ color: palette.danger, fontSize: 14 }}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={busy}
          style={{
            borderRadius: 16,
            backgroundColor: palette.accent,
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 52,
          }}
        >
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700' }}>
              Sign In
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function useAppInit() {
  const [model, setModel] = useState<Model | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loginInFlight = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    const existingModel = getModel();
    if (existingModel) {
      setModel(existingModel);
      setAuthenticated(existingModel.initialized);
      setInitializing(false);
      return () => {
        mountedRef.current = false;
      };
    }
    setInitializing(false);

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const ensureModel = useCallback(() => {
    if (model) {
      return model;
    }

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

    if (mountedRef.current) {
      setGlobalModel(nextModel);
      setModel(nextModel);
    }

    return nextModel;
  }, [model]);

  const login = useCallback(async (username: string, password: string) => {
    if (loginInFlight.current) {
      return;
    }

    loginInFlight.current = true;
    try {
      const activeModel = ensureModel();
      const email = username.includes('@') ? username : `${username}@fotos.one`;
      await activeModel.one.loginOrRegister(email, password, email);
    } finally {
      loginInFlight.current = false;
    }
  }, [ensureModel]);

  return {
    model,
    initializing,
    authenticated,
    error,
    login,
    loginInFlight: loginInFlight.current,
  };
}

export default function RootLayout() {
  const { model, initializing, authenticated, error, login, loginInFlight } = useAppInit();

  if (error) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.surface,
          padding: 24,
        }}
      >
        <Text style={{ fontSize: 22, fontWeight: '700', color: palette.danger }}>
          Startup Failed
        </Text>
        <Text style={{ marginTop: 10, color: palette.textMuted, textAlign: 'center' }}>
          {error}
        </Text>
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
        <LoginScreen busy={loginInFlight} onLogin={login} />
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
