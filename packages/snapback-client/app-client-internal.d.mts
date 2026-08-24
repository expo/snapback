import type {
  AuthBootstrapSnapshot,
  SnapbackAppBindingV1,
  SnapbackAppClient,
  SnapbackAppClientDebugEvent,
  SnapbackAppClientPlatform,
  SnapbackApplicationDescriptorV1,
  SnapbackSha256DigestAdapter,
} from './app-client.mjs';
import type {
  DeclaredDevCapability,
  SnapbackDeploymentIdentity,
} from './internal/declared-dev-mint.mjs';

export function canonicalDeclaredDevOrigin(value: unknown):
  | Readonly<{ ok: true; origin: string }>
  | Readonly<{ ok: false; rule: string }>;
export function declaredDevCapabilityFromApp(app: unknown): DeclaredDevCapability | null;
export function stampedDeclaredDevIdentity(capability: unknown): Readonly<SnapbackDeploymentIdentity> | null;
export function normalizeDeploymentIdentity(value: unknown): Readonly<SnapbackDeploymentIdentity> | null;
export function deploymentIdentitiesEqual(left: unknown, right: unknown): boolean;

export function authStoragePartitionIdentityHash(
  appId: string,
  storagePartition: string,
  platform: SnapbackAppClientPlatform,
): Promise<`sha256:${string}`>;

export function classifyHostedDevelopmentHostname(
  hostname: string,
): 'loopback' | 'private-ip-literal' | 'unspecified-address' | null;

export function createSnapbackAppClientWithBootstrapObserver(
  input: Readonly<{
    app: SnapbackApplicationDescriptorV1;
    binding?: SnapbackAppBindingV1;
    url?: string;
    streamless?: boolean;
    platform: SnapbackAppClientPlatform;
    storagePartition?: string;
    now?: () => number;
    signal?: AbortSignal;
    rqsStore?: unknown;
    onDiagnostic?: (diagnostic: import('./index.mjs').SnapbackDiagnostic | SnapbackAppClientDebugEvent) => void;
  }>,
  observer: (snapshot: AuthBootstrapSnapshot) => void,
): Promise<SnapbackAppClient>;

export function createProviderValidatedExpoNativePlatform(input: Readonly<{
  authCustodyStorage: Extract<SnapbackAppClientPlatform, { kind: 'expo-native' }>['authCustodyStorage'];
  authCustodyGrade: Readonly<{
    os: 'android' | 'ios';
    grade: 'single-runtime';
    mechanism: unknown;
    readonly [key: string]: unknown;
  }>;
  cryptoObject?: unknown;
  digestAdapter?: SnapbackSha256DigestAdapter;
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
