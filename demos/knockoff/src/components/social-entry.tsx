import { useEffect, useMemo, useState, type ReactNode } from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';
import {
  AuthRequest,
  fetchDiscoveryAsync,
  makeRedirectUri,
  ResponseType,
} from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';
import * as WebBrowser from 'expo-web-browser';
import {
  useSnapbackAuth,
  useSnapbackCurrentPrincipal,
  useSnapbackMutation,
} from '@knockoff/snapback-react';
import { Storage } from 'expo-sqlite/kv-store';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import {
  postIdentityBroker,
  redeemSharedBrokerEntry,
  sharedAuthorizationUrl,
  startSharedBrokerEntry,
  type BrokerResponse,
} from '@/lib/auth-broker';
import {
  AUTH_PROFILE_STORAGE_KEY,
  createAuthEntryController,
  resolveProviderEntry,
  type ClientPlatform,
  type DeploymentProfile,
  type IdentityProvider,
  type RequestedCredentialProfile,
  type ResolvedProviderEntry,
} from '@/lib/auth-profile';
import { api } from '@/lib/snapback';
import { colors } from '@/theme/colors';

WebBrowser.maybeCompleteAuthSession();

const brokerOrigin = process.env.EXPO_PUBLIC_KNOCKOFF_AUTH_ORIGIN ?? 'http://127.0.0.1:3777';
const fetchImpl = expoFetch as unknown as typeof fetch;

type NativeBuildReadiness = Readonly<{ apple: boolean; google: boolean; receipt: string }>;
type StoredProfile = Readonly<{
  provider: IdentityProvider;
  authProfileGeneration: string;
  identityRealm: 'rehearsal' | 'application';
}>;

function enumValue<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function urlSafeBase64(value: string): string {
  return value.replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

async function probeScheme(scheme: string): Promise<boolean> {
  try {
    return await Linking.canOpenURL(`${scheme}://receipt`);
  } catch {
    return false;
  }
}

async function probeNativeBuild(): Promise<NativeBuildReadiness> {
  const platform = Platform.OS;
  if (platform === 'web') return Object.freeze({ apple: false, google: false, receipt: 'web' });
  const apple = platform === 'ios'
    && await AppleAuthentication.isAvailableAsync()
    && await probeScheme('knockoff-apple-native-v1');
  const googleReceipt = await probeScheme('knockoff-google-native-v1');
  const googleIosScheme = process.env.EXPO_PUBLIC_KNOCKOFF_GOOGLE_IOS_URL_SCHEME;
  const google = platform === 'ios'
    ? Boolean(googleIosScheme) && googleReceipt && await probeScheme(googleIosScheme as string)
    : googleReceipt;
  return Object.freeze({
    apple,
    google,
    receipt: `knockoff-native:${platform}:apple-${apple ? 'ready' : 'missing'}:google-${google ? 'ready' : 'missing'}`,
  });
}

function requested(provider: IdentityProvider): RequestedCredentialProfile {
  const value = provider === 'apple'
    ? process.env.EXPO_PUBLIC_KNOCKOFF_APPLE_CREDENTIALS
    : process.env.EXPO_PUBLIC_KNOCKOFF_GOOGLE_CREDENTIALS;
  return enumValue(value, ['auto', 'shared', 'app-owned'] as const, 'auto');
}

function platformKind(): ClientPlatform {
  return Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
}

function deploymentProfile(): DeploymentProfile {
  return enumValue(
    process.env.EXPO_PUBLIC_KNOCKOFF_DEPLOYMENT_PROFILE,
    ['test', 'development', 'preview', 'staging', 'production'] as const,
    'development',
  );
}

function resolveEntries(appId: string, build: NativeBuildReadiness) {
  const deployment = deploymentProfile();
  const platform = platformKind();
  const preview = deployment === 'preview'
    ? {
        ownerAuthenticated: process.env.EXPO_PUBLIC_KNOCKOFF_PREVIEW_AUTHORIZED === '1',
        expiresAt: process.env.EXPO_PUBLIC_KNOCKOFF_PREVIEW_EXPIRES_AT,
      }
    : undefined;
  const appleConfigReady = process.env.EXPO_PUBLIC_KNOCKOFF_APPLE_NATIVE_CONFIGURED === '1';
  const googleServerClientId = process.env.EXPO_PUBLIC_KNOCKOFF_GOOGLE_SERVER_CLIENT_ID;
  const googlePlatformClientId = platform === 'ios'
    ? process.env.EXPO_PUBLIC_KNOCKOFF_GOOGLE_IOS_CLIENT_ID
    : platform === 'android'
      ? process.env.EXPO_PUBLIC_KNOCKOFF_GOOGLE_ANDROID_CONFIGURED
      : process.env.EXPO_PUBLIC_KNOCKOFF_GOOGLE_WEB_CLIENT_ID;
  const googleConfigReady = Boolean(googleServerClientId && googlePlatformClientId);

  return Object.freeze({
    apple: resolveProviderEntry({
      appId,
      provider: 'apple',
      deployment,
      requested: requested('apple'),
      platform,
      sharedAvailable: Boolean(brokerOrigin),
      appOwned: {
        configReady: appleConfigReady,
        browserReady: false,
        configGeneration: appleConfigReady ? 'apple-config-v1' : undefined,
        installationId: `app-owned:${appId}:apple:v1`,
      },
      nativeBuild: { ready: build.apple, receipt: build.receipt },
      preview,
    }),
    google: resolveProviderEntry({
      appId,
      provider: 'google',
      deployment,
      requested: requested('google'),
      platform,
      sharedAvailable: Boolean(brokerOrigin),
      appOwned: {
        configReady: googleConfigReady,
        browserReady: platform === 'web' && Boolean(process.env.EXPO_PUBLIC_KNOCKOFF_GOOGLE_WEB_CLIENT_ID),
        configGeneration: googleServerClientId ?? undefined,
        installationId: `app-owned:${appId}:google:v1`,
      },
      nativeBuild: { ready: build.google, receipt: build.receipt },
      preview,
    }),
  });
}

async function sharedBrowserEntry(appId: string, entry: ResolvedProviderEntry): Promise<BrokerResponse | null> {
  const verifier = base64Url(await Crypto.getRandomBytesAsync(32));
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  const returnTo = makeRedirectUri({ scheme: 'knockoff', path: 'auth/shared' });
  const start = await startSharedBrokerEntry(brokerOrigin, {
    appId,
    provider: entry.provider,
    returnTo,
    codeChallenge: urlSafeBase64(digest),
  }, { fetchImpl });
  let resolveCallback: (url: string) => void = () => {};
  const callbackPromise = new Promise<string>((resolve) => { resolveCallback = resolve; });
  const subscription = Linking.addEventListener('url', ({ url }) => {
    const callback = new URL(url);
    if (callback.protocol === 'knockoff:' && callback.host === 'auth' && callback.pathname === '/shared') {
      resolveCallback(url);
    }
  });
  const browserPromise = WebBrowser.openBrowserAsync(sharedAuthorizationUrl(brokerOrigin, start))
    .then(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return null;
    });
  let callbackUrl: string | null;
  try {
    callbackUrl = await Promise.race([callbackPromise, browserPromise]);
  } finally {
    subscription.remove();
  }
  if (!callbackUrl) return null;
  try { await WebBrowser.dismissBrowser(); } catch { /* browser already closed */ }
  const callback = new URL(callbackUrl);
  if (callback.searchParams.get('state') !== start.state) throw new Error('Shared auth state does not match');
  const code = callback.searchParams.get('code');
  if (!code) throw new Error('Shared auth returned no completion code');
  return redeemSharedBrokerEntry(brokerOrigin, { appId, code, verifier }, { fetchImpl });
}

async function nativeAppleEntry(entry: ResolvedProviderEntry): Promise<BrokerResponse | null> {
  try {
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
    return postIdentityBroker(brokerOrigin, '/v1/apple/native', {
      identityToken: credential.identityToken,
      authorizationCode: credential.authorizationCode,
      nonce,
      displayName,
      providerInstallationId: entry.providerInstallationId,
    }, { fetchImpl });
  } catch (cause) {
    if ((cause as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return null;
    throw cause;
  }
}

async function nativeGoogleEntry(): Promise<BrokerResponse | null> {
  const google = await import('@react-native-google-signin/google-signin');
  const serverClientId = process.env.EXPO_PUBLIC_KNOCKOFF_GOOGLE_SERVER_CLIENT_ID;
  const iosClientId = process.env.EXPO_PUBLIC_KNOCKOFF_GOOGLE_IOS_CLIENT_ID;
  if (!serverClientId) throw new Error('Google native auth requires the server client ID');
  google.GoogleSignin.configure({
    webClientId: serverClientId,
    ...(Platform.OS === 'ios' && iosClientId ? { iosClientId } : {}),
    offlineAccess: false,
  });
  if (Platform.OS === 'android') {
    await google.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  }
  const result = await google.GoogleSignin.signIn();
  if (!google.isSuccessResponse(result)) return null;
  if (!result.data.idToken) throw new Error('Google returned no identity token');
  return postIdentityBroker(brokerOrigin, '/v1/google/native', {
    idToken: result.data.idToken,
  }, { fetchImpl });
}

async function browserGoogleEntry(): Promise<BrokerResponse | null> {
  const clientId = process.env.EXPO_PUBLIC_KNOCKOFF_GOOGLE_WEB_CLIENT_ID;
  if (!clientId) throw new Error('Google browser auth requires the web client ID');
  const discovery = await fetchDiscoveryAsync('https://accounts.google.com');
  const redirectUri = makeRedirectUri({ scheme: 'knockoff', path: 'auth/google' });
  const request = new AuthRequest({
    clientId,
    redirectUri,
    responseType: ResponseType.Code,
    scopes: ['openid', 'profile', 'email'],
    usePKCE: true,
  });
  await request.makeAuthUrlAsync(discovery);
  const result = await request.promptAsync(discovery);
  if (result.type !== 'success' || typeof result.params.code !== 'string') return null;
  if (!request.codeVerifier) throw new Error('Google browser auth produced no PKCE verifier');
  return postIdentityBroker(brokerOrigin, '/v1/google/code', {
    code: result.params.code,
    codeVerifier: request.codeVerifier,
    redirectUri,
  }, { fetchImpl });
}

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

function profileLabel(entry: ResolvedProviderEntry) {
  if (entry.readiness === 'blocked') return entry.nextAction ?? 'Configuration required';
  if (entry.adapter === 'snapback-shared-browser') {
    return entry.nextAction ? `Shared development profile. ${entry.nextAction}` : 'Snapback shared development profile';
  }
  if (entry.adapter === 'app-owned-native') return 'App-owned native profile';
  if (entry.adapter === 'app-owned-browser') return 'App-owned browser profile';
  return 'Synthetic test profile';
}

export function SocialEntry({ appId, children }: Readonly<{ appId: string; children: ReactNode }>) {
  const auth = useSnapbackAuth();
  const principal = useSnapbackCurrentPrincipal();
  const ensureProfile = useSnapbackMutation(api.ensureProfile);
  const [active, setActive] = useState<IdentityProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nativeBuild, setNativeBuild] = useState<NativeBuildReadiness | null>(null);
  const [custodyChecked, setCustodyChecked] = useState(false);

  useEffect(() => {
    let current = true;
    void probeNativeBuild().then((result) => { if (current) setNativeBuild(result); });
    return () => { current = false; };
  }, []);

  const entries = useMemo(
    () => nativeBuild ? resolveEntries(appId, nativeBuild) : null,
    [appId, nativeBuild],
  );

  useEffect(() => {
    if (!entries || principal.status === 'loading' || principal.status === 'refreshing') return;
    let current = true;
    void (async () => {
      if (principal.status === 'authenticated') {
        const raw = await Storage.getItem(AUTH_PROFILE_STORAGE_KEY);
        let stored: StoredProfile | null = null;
        try { stored = raw ? JSON.parse(raw) as StoredProfile : null; } catch { stored = null; }
        const expected = stored ? entries[stored.provider] : null;
        if (!stored || !expected || stored.authProfileGeneration !== expected.authProfileGeneration) {
          await auth.signOut();
          await Storage.removeItem(AUTH_PROFILE_STORAGE_KEY);
        }
      }
      if (current) setCustodyChecked(true);
    })().catch((cause) => {
      if (current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setCustodyChecked(true);
      }
    });
    return () => { current = false; };
  }, [auth, entries, principal.status]);

  if (!entries || !custodyChecked || ['loading', 'refreshing'].includes(principal.status)) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.accent} />
      <Text selectable style={{ color: colors.secondary, paddingTop: 12 }}>Preparing sign-in…</Text>
    </View>;
  }

  if (principal.status === 'authenticated') return children;
  if (principal.status !== 'anonymous') {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.accent} />
      <Text selectable style={{ color: colors.secondary, paddingTop: 12 }}>Opening Knockoff…</Text>
    </View>;
  }

  const adapters = {
    synthetic: async (entry: ResolvedProviderEntry) => postIdentityBroker<BrokerResponse>(
      brokerOrigin,
      '/v1/fixture/login',
      { provider: entry.provider },
      { fetchImpl },
    ),
    'snapback-shared-browser': (entry: ResolvedProviderEntry) => sharedBrowserEntry(appId, entry),
    'app-owned-browser': (entry: ResolvedProviderEntry) => entry.provider === 'google'
      ? browserGoogleEntry()
      : Promise.reject(new Error('Apple app-owned browser auth is not configured in Knockoff')),
    'app-owned-native': (entry: ResolvedProviderEntry) => entry.provider === 'apple'
      ? nativeAppleEntry(entry)
      : nativeGoogleEntry(),
  } as const;
  const controller = createAuthEntryController(entries, adapters);

  const finish = async (result: BrokerResponse, entry: ResolvedProviderEntry) => {
    if (
      result.entry.adapter !== entry.adapter
      || result.entry.identityRealm !== entry.identityRealm
      || result.entry.providerInstallationId !== entry.providerInstallationId
    ) throw new Error('Identity broker returned a different auth profile than the resolved entry');
    const previous = await Storage.getItem(AUTH_PROFILE_STORAGE_KEY);
    await Storage.setItem(AUTH_PROFILE_STORAGE_KEY, JSON.stringify({
      provider: entry.provider,
      authProfileGeneration: entry.authProfileGeneration,
      identityRealm: entry.identityRealm,
    } satisfies StoredProfile));
    try {
      await auth.signInWithExternalCode(result.exchange);
      await ensureProfile({
        handle: result.profile.handle,
        displayName: result.profile.displayName,
        avatarUrl: result.profile.avatarUrl,
      });
    } catch (cause) {
      if (previous === null) await Storage.removeItem(AUTH_PROFILE_STORAGE_KEY);
      else await Storage.setItem(AUTH_PROFILE_STORAGE_KEY, previous);
      throw cause;
    }
  };

  const run = (provider: IdentityProvider) => {
    const entry = controller.entry(provider);
    setActive(provider);
    setError(null);
    void controller.signIn(provider)
      .then((result) => result ? finish(result, entry) : undefined)
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setActive(null));
  };

  const apple = entries.apple;
  const google = entries.google;
  const blocked = apple.readiness === 'blocked' && google.readiness === 'blocked';

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
        {apple.adapter === 'app-owned-native' && Platform.OS === 'ios' && apple.readiness === 'ready'
          ? <AppleAuthentication.AppleAuthenticationButton
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              cornerRadius={14}
              onPress={() => run('apple')}
              style={{ height: 54, width: '100%', opacity: active ? 0.5 : 1 }}
            />
          : <SocialButton
              label={apple.readiness === 'ready' ? 'Continue with Apple' : 'Apple setup required'}
              logo="●"
              dark
              disabled={active !== null || apple.readiness !== 'ready'}
              onPress={() => run('apple')}
            />}
        <Text selectable style={{ color: colors.tertiary, fontSize: 12, textAlign: 'center' }}>{profileLabel(apple)}</Text>

        <SocialButton
          label={google.readiness === 'ready' ? 'Continue with Google' : 'Google setup required'}
          logo="G"
          disabled={active !== null || google.readiness !== 'ready'}
          onPress={() => run('google')}
        />
        <Text selectable style={{ color: colors.tertiary, fontSize: 12, textAlign: 'center' }}>{profileLabel(google)}</Text>

        {active ? <View style={{ alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'center', paddingTop: 4 }}>
          <ActivityIndicator color={colors.accent} />
          <Text selectable style={{ color: colors.secondary }}>Checking {active}…</Text>
        </View> : null}
        {error ? <Text selectable style={{ color: colors.danger, lineHeight: 20, textAlign: 'center' }}>{error}</Text> : null}
      </View>
      <Text selectable style={{ color: colors.tertiary, fontSize: 12, lineHeight: 17, textAlign: 'center' }}>
        {blocked
          ? 'This deployment requires app-owned provider credentials.'
          : 'Shared profiles are development-only. Configured native profiles never fall back after an error.'}
      </Text>
    </View>
  </ScrollView>;
}
