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

/**
 * The shared app-data result core (LLP 0024 amendment; Rust-owned shape at
 * schemas/app-data.result-core.schema.json) and the frozen exit taxonomy
 * (LLP 0062 §2). Projections consume these; they never re-derive semantics.
 */
export type AppDataCallKind = 'query' | 'mutation' | 'action' | 'live-snapshot';
export type AppDataOutcome =
  | 'ok'
  | 'app-refusal'
  | 'refused'
  | 'failed'
  | 'transport-failed'
  | 'timeout'
  | 'unknown'
  | 'not-dispatched';
export type DiagnosticLocus = 'request' | 'result' | 'live' | 'broker' | 'engine';

export interface AppDataDiagnostic {
  readonly code: string;
  readonly severity?: string;
  readonly subsystem?: string;
  readonly locus: DiagnosticLocus;
  readonly httpStatus?: number;
  readonly unrecognized?: true;
  readonly fields?: Readonly<Record<string, unknown>>;
}

export interface AppRefusal {
  readonly appCode: string;
  readonly details?: unknown;
}

export interface AppDataMutationFacts {
  readonly clientMutationId?: string;
  readonly underlying?: AppDataOutcome;
}

export interface AppDataResultCore {
  readonly artifactKind: 'appDataResultCore';
  readonly formatVersion: 'snapback.app-data-result.v1';
  readonly kind: AppDataCallKind;
  readonly outcome: AppDataOutcome;
  readonly value?: unknown;
  readonly facts?: Readonly<Record<string, unknown>>;
  readonly appRefusal?: AppRefusal;
  readonly diagnostics: readonly AppDataDiagnostic[];
  readonly attribution?: unknown;
  readonly mutation?: AppDataMutationFacts;
}

export interface AppCliCallResult {
  readonly artifactKind: 'appCliCallResult';
  readonly formatVersion: 'snapback.app-cli-call-result.v1';
  readonly engine: { readonly name: string; readonly version: string };
  readonly envelope?: Readonly<Record<string, unknown>>;
  readonly core: AppDataResultCore;
}

export const EXIT: Readonly<{
  OK: 0; USAGE: 2; AUTH_REFUSED: 3; FUNCTION_NOT_FOUND: 4; FUNCTION_ERROR: 5;
  TRANSPORT_FAILED: 6; ARTIFACT_IDENTITY_MISMATCH: 7; VERSION_MISMATCH: 8;
  TIMEOUT: 9; SCRIPT_ERROR: 10; RESOURCE_EXCEEDED: 11;
}>;
export const RESULT_CORE_ARTIFACT_KIND: 'appDataResultCore';
export const RESULT_CORE_FORMAT_VERSION: 'snapback.app-data-result.v1';
export const CALL_RESULT_ARTIFACT_KIND: 'appCliCallResult';
export const CALL_RESULT_FORMAT_VERSION: 'snapback.app-cli-call-result.v1';

export function diagnosticRecord(input: {
  readonly code: string;
  readonly severity?: string;
  readonly subsystem?: string;
  readonly locus: DiagnosticLocus;
  readonly httpStatus?: number;
  readonly fields?: Readonly<Record<string, unknown>>;
}): AppDataDiagnostic;
export function classifyDiagnosticExit(record: AppDataDiagnostic): number;
export function buildResultCore(input: {
  readonly kind: AppDataCallKind;
  readonly outcome: AppDataOutcome;
  readonly value?: unknown;
  readonly facts?: Readonly<Record<string, unknown>>;
  readonly appRefusal?: AppRefusal;
  readonly diagnostics?: readonly AppDataDiagnostic[];
  readonly attribution?: unknown;
  readonly mutation?: AppDataMutationFacts;
}): AppDataResultCore;
export function resultExitCode(core: AppDataResultCore): number;
export function wrapCallResult(core: AppDataResultCore, presentation: {
  readonly engine: { readonly name: string; readonly version: string };
  readonly envelope?: Readonly<Record<string, unknown>>;
}): AppCliCallResult;

// --- Served-envelope ingestion (LLP 0062 §5; ticket 0062-02 step 4) --------

export interface ServedFunctionDescriptor {
  readonly id: string;
  readonly name: string;
  readonly kind: AppFunctionKind;
  readonly authRequirement: unknown;
  readonly argsSchema: unknown;
}

export interface ServedAppSurface {
  readonly source: 'served';
  readonly offline: boolean;
  readonly appId: string;
  readonly envelopeSha256: string;
  readonly bundleHash: string | null;
  readonly generation: Readonly<Record<string, string>> | null;
  readonly functions: readonly ServedFunctionDescriptor[];
}

export interface ServedUnavailable {
  readonly status: 'unavailable';
  readonly reason: 'dev-target' | 'route-absent';
  readonly diagnostic: Readonly<Record<string, unknown>> | null;
}

export interface VerifiedEnvelope {
  readonly envelope: Readonly<Record<string, unknown>>;
  readonly sha256: string;
  readonly canonical: string;
}

/** RFC 8785 canonical serialization for round-tripped JSON values. */
export function jcsCanonical(value: unknown): string;
export function memberDigest(canonical: string): string;
export function envelopeDigest(canonical: string): string;

/** Full client-side verification of received envelope bytes. */
export function verifyEnvelopeBytes(bytes: Uint8Array, options?: {
  readonly expectedSha256?: string | null;
  readonly expectedAppId?: string | null;
}): VerifiedEnvelope;

export function discoverServedApp(baseUrl: string): Promise<
  | { readonly status: 'current'; readonly discovery: Readonly<Record<string, unknown>>; readonly sha256: string }
  | { readonly status: 'envelope-absent'; readonly discovery: Readonly<Record<string, unknown>> }
  | ServedUnavailable
>;

export function fetchServedEnvelope(baseUrl: string, sha256: string, options?: {
  readonly expectedAppId?: string | null;
}): Promise<VerifiedEnvelope>;

export function loadServedApp(baseUrl: string, options?: {
  readonly cacheDir?: string;
  readonly offline?: boolean;
  readonly appId?: string | null;
}): Promise<ServedAppSurface | ServedUnavailable>;

export function readCachedEnvelope(cacheDir: string, baseUrl: string, appId: string): Promise<VerifiedEnvelope | null>;
export function storeCachedEnvelope(cacheDir: string, baseUrl: string, verified: VerifiedEnvelope, options?: {
  readonly limits?: { readonly perOriginEnvelopes: number; readonly globalBytes: number };
}): Promise<void>;
export function defaultCacheDir(): string;
