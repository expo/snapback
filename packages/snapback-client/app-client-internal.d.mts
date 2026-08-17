import type {
  AuthBootstrapSnapshot,
  SnapbackAppBindingV1,
  SnapbackAppClient,
  SnapbackAppClientPlatform,
  SnapbackApplicationDescriptorV1,
} from './app-client.mjs';

export function classifyHostedDevelopmentHostname(
  hostname: string,
): 'loopback' | 'private-ip-literal' | 'unspecified-address' | null;

export function createSnapbackAppClientWithBootstrapObserver(
  input: Readonly<{
    app: SnapbackApplicationDescriptorV1;
    binding: SnapbackAppBindingV1;
    platform: SnapbackAppClientPlatform;
    storagePartition?: string;
    now?: () => number;
    signal?: AbortSignal;
    rqsStore?: unknown;
  }>,
  observer: (snapshot: AuthBootstrapSnapshot) => void,
): Promise<SnapbackAppClient>;

export function createProviderValidatedExpoNativePlatform(input: Readonly<{
  authCustodyStorage: Extract<SnapbackAppClientPlatform, { kind: 'expo-native' }>['authCustodyStorage'];
  authCustodyGrade: Readonly<{
    os: 'android';
    grade: 'single-runtime';
    mechanism: unknown;
    readonly [key: string]: unknown;
  }>;
  cryptoObject?: unknown;
}>): Extract<SnapbackAppClientPlatform, { kind: 'expo-native' }>;

export function applicationDescriptorForAppClient(
  appClient: SnapbackAppClient,
): SnapbackApplicationDescriptorV1;

export function adoptSupervisedBootstrapAuthority(
  appClient: SnapbackAppClient,
  input: Readonly<{
    bearer: string;
    binding: SnapbackAppBindingV1;
    clientOptions?: Readonly<{ devIdentityCapability?: string | null }>;
    refreshAfterMs?: number;
  }>,
): Promise<Readonly<{
  status: 'adopted' | 'rebound' | 'conflict' | 'dropped';
}>>;
