import type { SnapbackClient, SnapbackClientOptions } from './index.mjs';

/** Options for the app-data façade. `adminToken` is structurally absent:
 * the façade is app-data-only and refuses the member at runtime too. */
export type SnapbackAppDataClientOptions = Omit<SnapbackClientOptions, 'adminToken'>;

export const DEFAULT_INGRESS_LIMIT_BYTES: Readonly<{
  appCall: number;
  authLifecycle: number;
  discovery: number;
  artifact: number;
  liveFrame: number;
}>;

export const APP_DATA_CLIENT_METHODS: readonly string[];

/** The typed subset of the full client the façade delegates (declaration
 * subset of the runtime list; the runtime surface is APP_DATA_CLIENT_METHODS). */
export type SnapbackAppDataSurface = Pick<
  SnapbackClient,
  | 'health'
  | 'inspect'
  | 'localResourceInspection'
  | 'authSession'
  | 'authRequestCode'
  | 'authExchange'
  | 'authPasswordSignup'
  | 'authPasswordSignIn'
  | 'authPasswordChange'
  | 'authPasswordSet'
  | 'authPasswordReset'
  | 'authRecoveryConsume'
  | 'authRecoveryRotate'
  | 'authRefresh'
  | 'authLogout'
  | 'currentAuthorityDescriptor'
  | 'currentAuthorizationScope'
  | 'setBearerToken'
  | 'replaceBearerToken'
  | 'clearAuthSession'
  | 'captureAuthority'
  | 'isAuthorityCaptureCurrent'
  | 'allocateLiveQueryNamespace'
  | 'releaseConnection'
  | 'fetchBundle'
  | 'query'
  | 'search'
  | 'mutate'
  | 'action'
  | 'run'
  // The LLP 0043 settlement lifecycle, whole (see app-data.mjs).
  | 'settledMutations'
  | 'markMutationSettlementsConsumed'
  | 'acknowledgeMutations'
  | 'replayQueuedMutations'
  | 'quarantinedMutations'
  | 'reenterQuarantinedMutations'
  | 'outboxStatus'
  | 'liveQuery'
  | 'startLiveQuery'
  | 'subscribeLive'
  | 'unsubscribeLive'
  | 'subscribeEphemeral'
  | 'registerEphemeralRepublisher'
  | 'publishEphemeral'
  | 'deleteEphemeral'
  | 'disconnect'
  | 'startEphemeralRoom'
>;

// Class + interface declaration merging (no separate base class: a
// top-level `declare class` in a .d.mts is importable by consumers even
// without `export`, which would claim a value the runtime does not have).
export class SnapbackAppDataClient {
  constructor(baseUrl: string, options?: SnapbackAppDataClientOptions);
  readonly baseUrl: string;
  readonly authProtocols: Readonly<Record<string, number | null>>;
  readonly agentAuthority: unknown;
  readonly ingressLimits: Readonly<Record<string, number>>;
  readonly wireVersionDiagnostics: readonly unknown[];
  /** The resolved store's implementation/durability facts (LLP 0043). */
  readonly rqsStoreInfo: SnapbackClient['rqsStoreInfo'];
}
export interface SnapbackAppDataClient extends SnapbackAppDataSurface {}

export function createAppDataClient(
  baseUrl: string,
  options?: SnapbackAppDataClientOptions,
): SnapbackAppDataClient;

export function createExternalSessionAppDataClient(
  baseUrl: string,
  options: SnapbackAppDataClientOptions & { readonly bearerToken: string },
): SnapbackAppDataClient;

export interface PublicArtifactResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Headers;
  readonly bytes: Uint8Array;
  bodyText(): string;
}

export function fetchPublicArtifact(
  baseUrl: string,
  path: string,
  options?: {
    readonly ingressClass?: 'artifact' | 'discovery';
    readonly limitBytes?: number | null;
    readonly signal?: AbortSignal;
  },
): Promise<PublicArtifactResponse>;
