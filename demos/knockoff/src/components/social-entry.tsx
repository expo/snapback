import { useMemo, useState, type ReactNode } from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';
import {
  makeRedirectUri,
  ResponseType,
  useAuthRequest,
  useAutoDiscovery,
} from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import {
  useSnapbackAuth,
  useSnapbackCurrentPrincipal,
  useSnapbackMutation,
} from '@knockoff/snapback-react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { api } from '@/lib/snapback';
import {
  postIdentityBroker,
  type BrokerResponse,
  type IdentityProvider as Provider,
} from '@/lib/auth-broker';
import { colors } from '@/theme/colors';

WebBrowser.maybeCompleteAuthSession();

const authMode = process.env.EXPO_PUBLIC_KNOCKOFF_AUTH_MODE === 'real' ? 'real' : 'fixture';
const brokerOrigin = process.env.EXPO_PUBLIC_KNOCKOFF_AUTH_ORIGIN ?? 'http://127.0.0.1:3777';
const appleNativeConfigured = process.env.EXPO_PUBLIC_KNOCKOFF_APPLE_NATIVE_CONFIGURED === '1';
const googleClientId = process.env.EXPO_PUBLIC_KNOCKOFF_GOOGLE_CLIENT_ID;

const brokerPost = (path: string, body: object) => postIdentityBroker(brokerOrigin, path, body);

function SocialButton({
  label,
  logo,
  onPress,
  disabled,
  dark = false,
}: Readonly<{
  label: string;
  logo: string;
  onPress: () => void;
  disabled: boolean;
  dark?: boolean;
}>) {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    disabled={disabled}
    onPress={onPress}
    style={{
      alignItems: 'center',
      backgroundColor: dark ? '#000000' : colors.elevated,
      borderColor: dark ? '#000000' : colors.separator,
      borderCurve: 'continuous',
      borderRadius: 14,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'center',
      minHeight: 54,
      opacity: disabled ? 0.5 : 1,
      paddingHorizontal: 18,
    }}
  >
    <Text style={{ color: dark ? '#ffffff' : colors.label, fontSize: 20, fontWeight: '800' }}>{logo}</Text>
    <Text style={{ color: dark ? '#ffffff' : colors.label, fontSize: 17, fontWeight: '700' }}>{label}</Text>
  </Pressable>;
}

function GoogleRealButton({
  clientId,
  disabled,
  run,
  finish,
}: Readonly<{
  clientId: string;
  disabled: boolean;
  run: (provider: Provider, operation: () => Promise<void>) => void;
  finish: (result: BrokerResponse) => Promise<void>;
}>) {
  const discovery = useAutoDiscovery('https://accounts.google.com');
  const redirectUri = useMemo(() => makeRedirectUri({ scheme: 'knockoff', path: 'auth/google' }), []);
  const [request, , prompt] = useAuthRequest({
    clientId,
    redirectUri,
    responseType: ResponseType.Code,
    scopes: ['openid', 'profile', 'email'],
    usePKCE: true,
  }, discovery);
  const signIn = async () => {
    if (!request?.codeVerifier) throw new Error('Google login is not ready');
    const response = await prompt();
    if (response.type !== 'success' || typeof response.params.code !== 'string') {
      if (response.type === 'cancel' || response.type === 'dismiss') return;
      throw new Error('Google login did not return an authorization code');
    }
    await finish(await brokerPost('/v1/google/code', {
      code: response.params.code,
      codeVerifier: request.codeVerifier,
      redirectUri,
    }));
  };
  return <SocialButton
    label="Continue with Google"
    logo="G"
    disabled={disabled || request === null}
    onPress={() => run('google', signIn)}
  />;
}

export function SocialEntry({ children }: Readonly<{ children: ReactNode }>) {
  const auth = useSnapbackAuth();
  const principal = useSnapbackCurrentPrincipal();
  const ensureProfile = useSnapbackMutation(api.ensureProfile);
  const [active, setActive] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finish = async (result: BrokerResponse) => {
    await auth.signInWithExternalCode(result.exchange);
    await ensureProfile({
      handle: result.profile.handle,
      displayName: result.profile.displayName,
      avatarUrl: result.profile.avatarUrl,
    });
    setError(null);
    setActive(null);
  };

  const signInFixture = async (provider: Provider) => {
    await finish(await brokerPost('/v1/fixture/login', { provider }));
  };

  const signInApple = async () => {
    if (authMode === 'fixture') return signInFixture('apple');
    if (process.env.EXPO_OS !== 'ios') throw new Error('Native Apple login is available on iOS');
    if (!appleNativeConfigured) throw new Error('Apple login requires an app-owned Sign in with Apple registration');
    const nonce = Crypto.randomUUID();
    const credential = await AppleAuthentication.signInAsync({
      nonce,
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) throw new Error('Apple returned no identity token');
    const displayName = [credential.fullName?.givenName, credential.fullName?.familyName]
      .filter(Boolean)
      .join(' ');
    await finish(await brokerPost('/v1/apple/native', {
      identityToken: credential.identityToken,
      authorizationCode: credential.authorizationCode,
      nonce,
      displayName,
    }));
  };

  const run = (provider: Provider, operation: () => Promise<void>) => {
    setActive(provider);
    setError(null);
    void operation().catch((cause) => {
      setActive(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  if (principal.status === 'authenticated') return children;
  if (principal.status !== 'anonymous') {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.accent} />
      <Text selectable style={{ color: colors.secondary, paddingTop: 12 }}>Opening Knockoff…</Text>
    </View>;
  }

  return <ScrollView
    contentInsetAdjustmentBehavior="automatic"
    contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 28 }}
    style={{ backgroundColor: colors.background }}
  >
    <View style={{ alignSelf: 'center', gap: 28, maxWidth: 430, width: '100%' }}>
      <View style={{ alignItems: 'center', gap: 14 }}>
        <View style={{
          alignItems: 'center',
          backgroundColor: colors.accent,
          borderCurve: 'continuous',
          borderRadius: 28,
          height: 88,
          justifyContent: 'center',
          transform: [{ rotate: '-5deg' }],
          width: 88,
        }}>
          <Text style={{ color: '#ffffff', fontSize: 48, fontWeight: '900' }}>K</Text>
        </View>
        <Text selectable style={{ color: colors.label, fontSize: 38, fontWeight: '900', letterSpacing: -1.4 }}>Knockoff</Text>
        <Text selectable style={{ color: colors.secondary, fontSize: 17, lineHeight: 24, textAlign: 'center' }}>
          The social app where every idea looks vaguely familiar.
        </Text>
      </View>
      <View style={{ gap: 12 }}>
        {process.env.EXPO_OS === 'ios' && authMode === 'real' && appleNativeConfigured
          ? <AppleAuthentication.AppleAuthenticationButton
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              cornerRadius={14}
              onPress={() => run('apple', signInApple)}
              style={{ height: 54, width: '100%', opacity: active ? 0.5 : 1 }}
            />
          : authMode === 'real'
            ? <SocialButton label="Apple setup required" logo="●" dark disabled onPress={() => {}} />
          : <SocialButton label="Continue with Apple" logo="●" dark disabled={active !== null} onPress={() => run('apple', signInApple)} />}
        {authMode === 'fixture'
          ? <SocialButton label="Continue with Google" logo="G" disabled={active !== null} onPress={() => run('google', () => signInFixture('google'))} />
          : googleClientId
            ? <GoogleRealButton clientId={googleClientId} disabled={active !== null} run={run} finish={finish} />
            : <SocialButton label="Google setup required" logo="G" disabled onPress={() => {}} />}
        {active ? <View style={{ alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'center', paddingTop: 4 }}>
          <ActivityIndicator color={colors.accent} />
          <Text selectable style={{ color: colors.secondary }}>Checking {active}…</Text>
        </View> : null}
        {error ? <Text selectable style={{ color: colors.danger, lineHeight: 20, textAlign: 'center' }}>{error}</Text> : null}
      </View>
      <Text selectable style={{ color: colors.tertiary, fontSize: 12, lineHeight: 17, textAlign: 'center' }}>
        {authMode === 'fixture'
          ? 'Local fixture mode. Provider assertions stay in the broker process.'
          : appleNativeConfigured && googleClientId
            ? 'Apple and Google verify with the Knockoff broker. Provider tokens never enter Snapback rows.'
            : 'App-owned Apple and Google registrations are required until Snapback shared development profiles ship.'}
      </Text>
    </View>
  </ScrollView>;
}
