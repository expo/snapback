// Hand-authored declarations for index.mjs — the artifact-driven local
// Snapback application engine for agent journeys (discover from inert
// generated JSON, pair, mint a scoped token, call app functions).

export type AppFunctionKind = 'query' | 'liveQuery' | 'mutation' | 'action';

export interface AppFunctionDescriptor {
  readonly id: string;
  readonly name: string;
  readonly kind: AppFunctionKind;
  readonly authRequirement: unknown;
  readonly argsSchema: string;
}

export interface AppArtifacts {
  readonly root: string;
  readonly appId: string;
  readonly bundleHash: string | null;
  readonly functions: readonly AppFunctionDescriptor[];
}

/** Discover the app surface from the generated artifact directory without
 * importing generated program source. */
export function loadAppArtifacts(directory: string): Promise<AppArtifacts>;

/** POST /auth/agents/pair; resolves to the server's JSON response. */
export function pairAgent(baseUrl: string, options: {
  readonly credential: string;
  readonly pairingRequestId: string;
  readonly pairingCode: string;
  readonly requestedScopes: readonly Readonly<Record<string, unknown>>[];
}): Promise<unknown>;

/** POST /auth/agents/token; resolves to the server's JSON response. */
export function mintAgentToken(baseUrl: string, options: {
  readonly credential: string;
  readonly pairingRequestId: string;
  readonly ttlMs?: number;
}): Promise<unknown>;

/** Structural slice of the app-data client the engine calls for ordinary
 * (non-live) function invocation. */
export interface AppFunctionCallClient {
  query(
    name: string,
    options: { readonly args: Readonly<Record<string, unknown>> },
  ): Promise<unknown>;
  mutate(
    name: string,
    options: { readonly args: Readonly<Record<string, unknown>> },
  ): Promise<unknown>;
  action(
    name: string,
    options: { readonly args: Readonly<Record<string, unknown>> },
  ): Promise<unknown>;
}

/** Invoke a manifest-declared query, mutation, or action by name. */
export function invokeAppFunction(
  client: AppFunctionCallClient,
  artifacts: AppArtifacts,
  name: string,
  args?: Readonly<Record<string, unknown>>,
): Promise<unknown>;

/** Structural slice of the app-data client the engine calls for live
 * subscriptions. */
export interface AppLiveSubscribeClient {
  subscribeLive(
    name: string,
    options: {
      readonly args: Readonly<Record<string, unknown>>;
      readonly connectionId: string;
    },
  ): Promise<unknown>;
}

/** Subscribe to a manifest-declared live query by name. */
export function subscribeAppFunction(
  client: AppLiveSubscribeClient,
  artifacts: AppArtifacts,
  name: string,
  options?: {
    readonly args?: Readonly<Record<string, unknown>>;
    readonly connectionId?: string;
  },
): Promise<unknown>;

export interface PackagedAgentJourneyResult {
  readonly appId: string;
  readonly discoveredFunctions: number;
  readonly pairingRequestId: unknown;
  readonly grantId: unknown;
  readonly scopes: unknown;
  readonly mutated: unknown;
  readonly subscribed: unknown;
  readonly verified: unknown;
}

/**
 * The packaged acceptance seam: discovery -> pairing -> scoped token ->
 * mutation -> subscription -> verification. The minted token stays
 * process-local and is never returned.
 */
export function runPackagedAgentJourney(options: {
  readonly baseUrl: string;
  readonly artifactsDirectory: string;
  readonly credential: string;
  readonly pairingRequestId: string;
  readonly pairingCode: string;
  readonly requestedScopes: readonly Readonly<Record<string, unknown>>[];
  readonly actorUserId: string;
  readonly mutation: { readonly name: string; readonly args?: Readonly<Record<string, unknown>> };
  readonly liveQuery: { readonly name: string; readonly args?: Readonly<Record<string, unknown>> };
  readonly verifyQuery: {
    readonly name: string;
    readonly args?: Readonly<Record<string, unknown>>;
  };
}): Promise<PackagedAgentJourneyResult>;
