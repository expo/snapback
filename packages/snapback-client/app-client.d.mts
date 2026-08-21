import type {
  CurrentPrincipalSnapshot,
  SnapbackAuthRemediation,
  SnapbackClient,
  SnapbackDiagnostic,
} from './index.mjs';
import type { SnapbackAuthCustodyStorage } from '@expo/snapback-contract/auth-coordinator';

export { DEFAULT_AUTH_STORAGE_PARTITION } from './app-client-defaults.mjs';

export type ApplicationAuthBootstrapV1 = Readonly<{
  format: 'snapback.application-auth-bootstrap.v1';
  appId: string;
  mode: 'sessions';
  custody: 'durable-required' | 'volatile-explicit';
  entryMechanisms: readonly (
    | 'password-v1'
    | 'email-code-v1'
    | 'external-session-explicit-v1'
  )[];
  anonymousPublic: 'allowed' | 'refused';
  lifecycleProtocol: 1;
}>;

export type SnapbackApplicationDescriptorV1 = Readonly<{
  format: 'snapback.app.v1';
  identity: Readonly<{
    app: string;
    schema: string;
    functions: string;
    descriptor: string;
  }>;
  authBootstrap: ApplicationAuthBootstrapV1;
}>;

export type SnapbackAppBindingV1 = Readonly<{
  format: 'snapback.app-binding.v1';
  descriptorIdentity: string;
  capabilities: Readonly<{ offered: readonly string[] }>;
}> & (
  /** A supervised binding is admitted only while unexpired. Within one live
   * owner, issuedAt is a non-rewinding watermark; generated identities and
   * the opaque supervisor generation are the currently available successor
   * facts, pending the full LLP 0241 activation receipt. */
  | Readonly<{
      source: 'supervised-dev';
      target: Readonly<{
        app: string;
        schema: string;
        functions: string;
        origin: string;
        routing: 'loopback' | 'port-forward';
      }>;
      provenance: Readonly<{
        supervisorGeneration: string;
        issuedAt: string;
        expiresAt: string;
      }>;
      integrity: Readonly<{ channel: 'local-supervised-ipc' }>;
    }>
  | Readonly<{
      /** Runtime use requires the exact object admitted through the app export
       * hydrated by the generated binding module; a hand-built or cloned
       * receipt-bearing value is shape-compatible but is refused before
       * transport I/O. */
      source: 'hosted-development';
      target: Readonly<{
        app: string;
        schema: string;
        functions: string;
        origin: string;
        routing: 'https';
      }>;
      provenance: Readonly<{ hostedTargetReceipt: string }>;
      integrity: Readonly<{ channel: 'hosted-target-admission' }>;
    }>
  | Readonly<{
      source: 'release';
      target: Readonly<{
        app: string;
        schema: string;
        functions: string;
        origin: string;
        routing: 'https';
      }>;
      provenance: Readonly<{
        environment: string;
        releaseChannel: string;
        buildReceipt: string;
      }>;
      integrity:
        | Readonly<{ channel: 'signed-artifact'; signature: string }>
        | Readonly<{ channel: 'embedded-at-build' }>;
    }>
);

/** SHA-256 only. This capability carries no secure-randomness authority. */
export type SnapbackSha256DigestAdapter = Readonly<{
  format: 'snapback.sha256-digest.v1';
  digest(input: Uint8Array): Promise<ArrayBuffer | Uint8Array>;
}>;

export type SnapbackAppClientPlatform =
  | 'browser'
  | 'expo-web'
  | 'memory'
  | Readonly<{
      kind: 'browser' | 'expo-web' | 'memory';
      /** Cross-context auth wakeup channel. Browser/web defaults to the host
       * BroadcastChannel; memory contexts default to disabled. */
      broadcastChannelFactory?: ((name: string) => unknown) | null;
      /** Secret-free auth wakeup hint storage. Browser/web defaults to the
       * host localStorage; memory contexts default to disabled. */
      hintStorage?: unknown;
      indexedDB?: unknown;
      lockManager?: unknown;
      cryptoObject?: unknown;
      digestAdapter?: SnapbackSha256DigestAdapter;
      databaseName?: string;
    }>
  | Readonly<{
      kind: 'expo-native';
      /** Advanced evidence seam only. Ordinary provider resolution does not
       * construct this shape until the per-OS Phase 2 capability flips. */
      authCustodyStorage: SnapbackAuthCustodyStorage & Readonly<{
        ownerKeyCapability: 'owner-key-v1';
        platformGrade(): Promise<Readonly<{
          grade: 'single-runtime' | 'durable';
          mechanism: unknown;
          carrier?: string;
          readonly [key: string]: unknown;
        }>>;
      }>;
      cryptoObject?: unknown;
      /** Hashing-only adapter; never interpreted as a secure RNG. */
      digestAdapter?: SnapbackSha256DigestAdapter;
    }>;

export type PublicAuthCustodyFacts = Readonly<{
  carrier:
    | 'indexeddb-web-locks'
    | 'indexeddb-fenced-lease'
    | 'expo-native-injected'
    | 'memory';
  grade: 'single-runtime' | 'durable' | 'volatile';
  /** Present for injected native custody and copied from the adapter's grade report. */
  mechanism?: unknown;
  storagePartitionIdentityHash: `sha256:${string}`;
  formatVersion: number;
  recoveryAvailable: boolean;
}>;

export type AuthBootstrapAuthoritySource =
  | 'fresh-anonymous'
  | 'durable-restored'
  | 'supervised-development'
  | 'application-entry'
  | 'external-transition';

export type AuthBootstrapAdvisory = Readonly<{
  diagnostic: SnapbackDiagnostic;
  remediations: readonly SnapbackAuthRemediation[];
}>;

export type AuthBootstrapSnapshot =
  | Readonly<{
      status: 'starting';
      stage: 'binding' | 'custody' | 'authority' | 'client';
    }>
  | Readonly<{
      status: 'ready';
      custody: PublicAuthCustodyFacts;
      authoritySource: AuthBootstrapAuthoritySource;
      advisories: readonly AuthBootstrapAdvisory[];
    }>
  | Readonly<{
      status: 'authority-required';
      diagnostic: SnapbackDiagnostic;
      remediations: readonly SnapbackAuthRemediation[];
    }>
  | Readonly<{
      status: 'blocked' | 'unsupported' | 'error';
      diagnostic: SnapbackDiagnostic;
      remediations: readonly SnapbackAuthRemediation[];
    }>;

export interface SnapbackAuthFacade {
  currentPrincipal(): CurrentPrincipalSnapshot;
  subscribeCurrentPrincipal(listener: () => void): () => void;
  readonly signUpWithPassword: SnapbackClient['authPasswordSignup'];
  readonly signInWithPassword: SnapbackClient['authPasswordSignIn'];
  readonly signInWithExternalCode: SnapbackClient['authExchange'];
  readonly consumeRecoveryCode: SnapbackClient['authRecoveryConsume'];
  readonly rotateRecoveryCodes: SnapbackClient['authRecoveryRotate'];
  readonly changePassword: SnapbackClient['authPasswordChange'];
  readonly signOut: SnapbackClient['authLogout'];
}

export interface SnapbackAppClient {
  readonly client: SnapbackClient;
  readonly auth: SnapbackAuthFacade;
  bootstrapState(): AuthBootstrapSnapshot;
  subscribeBootstrap(listener: () => void): () => void;
  dispose(): Promise<void>;
}

export function createSnapbackAppClient(input: Readonly<{
  app: SnapbackApplicationDescriptorV1;
  binding: SnapbackAppBindingV1;
  platform: SnapbackAppClientPlatform;
  storagePartition?: string;
  /** Injected clock for binding-expiry admission (epoch milliseconds);
   * defaults to Date.now. Supervised hosts with a controlled clock (the
   * Expo boot) pass theirs so admission and boot agree on time. */
  now?: () => number;
  /** Cancels in-flight bootstrap construction and disposes any partially
   * constructed custody/coordinator/client owners. */
  signal?: AbortSignal;
  /** Provider-resolved RQS store/default-resolution. */
  rqsStore?: unknown;
}>): Promise<SnapbackAppClient>;
