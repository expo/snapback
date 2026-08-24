// Hand-authored declarations for index.mjs — the package-owned Snapback
// developer loop, release builder, and native server launcher.

import type { RuntimeBinaryInspection, RuntimeRecoveryRecord } from './runtime-recovery.mjs';
import type { DevPortPlan } from './port-plan.mjs';

export {
  DEFAULT_DEV_PORT_RANGE,
  DEV_PORT_ENVIRONMENT,
  devPortPlanOwner,
  materializeDevPortPlan,
  resolveDevPortPlan,
} from './port-plan.mjs';
export type {
  DevPortPlan,
  DevPortPlanOwner,
  DevPortPlanOwnerName,
  DevPortPlanOwnerProvenance,
  DevPortPlanProfile,
  DevPortPlanRange,
} from './port-plan.mjs';

export {
  addTarget,
  applyBackupPlan,
  applyDeployPlan,
  applyRestoreActivationPlan,
  applyRestorePlan,
  applyRollbackPlan,
  createDeployPlan,
  createBackupPlan,
  createHostedAuthDrillReceipt,
  createAdapterQualificationManifest,
  createPreparedReleaseManifest,
  createRemoteDrillPlan,
  createRestoreActivationPlan,
  createRestorePlan,
  createRollbackPlan,
  doctorTarget,
  inspectTargetAdmin,
  inspectTarget,
  listBackups,
  queryControlLogs,
  sealHostedAdmissionEnvelope,
  showTarget,
  validateTargetDescriptor,
  verifyBackupManifest,
  verifyControlAuditLedger,
  verifyPreparedReleaseArtifacts,
  verifyRemoteDrillPlan,
  verifyRestoreReceipt,
} from './deployment-control.mjs';
export type {
  AdapterDiagnostic,
  AdapterEvidenceRef,
  AdapterQualificationManifest,
  AuthenticatedInspection,
  AuthenticatedInspectionResult,
  BackupManifest,
  BackupPlan,
  ControlLogPage,
  ControlLogsResult,
  ControlPlaneGap,
  ControlPlaneOptions,
  DeployPlan,
  DeployReceipt,
  HostedAdmission,
  HostedAdmissionEnvelope,
  HostedAuthDrillReceipt,
  MaintenanceReceipt,
  PreparedReleaseManifest,
  ReleaseVerifier,
  RemoteDrillPlan,
  RestorePlan,
  RollbackPlan,
  TargetDescriptor,
  TargetObservation,
} from './deployment-control.mjs';
export {
  createExternalReplayFloorAdvanceReceipt,
  prepareHostedAdmissionBoot,
  refreshHostedAdmissionProjection,
} from './hosted-admission-producer.mjs';
export {
  COMPARATOR_CHECKS,
  COMPARATOR_PROFILE_SCHEMA_VERSION,
  COMPARATOR_RECEIPT_SCHEMA_VERSION,
  defineComparatorProfile,
  loadComparatorProfile,
  readComparatorReceipt,
  runComparatorAcceptance,
  validateComparatorReceipt,
  writeComparatorReceipt,
} from './comparator-profile.mjs';
export {
  CLOUDFLARE_ACCEPTANCE_SCHEMA_VERSION,
  VERIFY_CONFIG_SCHEMA_VERSION,
  VERIFY_RECEIPT_SCHEMA_VERSION,
  VERIFY_STAGE_IDS,
  aggregateConformance,
  defaultVerifyConfig,
  defineCloudflareVerifyProfile,
  defineRepositoryVerifyProfiles,
  defineStarterVerifyProfile,
  defineVerifyConfig,
  loadVerifyConfig,
  probeAdmission,
  probeArtifactFreshness,
  probeCapabilities,
  probeServedTarget,
  runVerify,
  validateVerifyReceipt,
  writeVerifyReceipt,
} from './verify.mjs';
export type {
  CloudflareVerifyProfileOptions,
  StarterVerifyProfileOptions,
  VerifyConfig,
  VerifyConformanceReport,
  VerifyIdentityContext,
  VerifyPathKind,
} from './verify.mjs';
export type {
  ComparatorProfile,
  ComparatorProfileInput,
  ComparatorReceipt,
  ComparatorStartTarget,
  ComparatorTarget,
  ComparatorTargetClient,
} from './comparator-profile.mjs';
export {
  HOSTED_ASSETS,
  HOSTED_COMMAND_REGISTRY,
  HOSTED_LIFECYCLE_VERBS,
  createHostedPlan,
  invokeHostedLifecycle,
  resolveHostedAssets,
  runHostedRead,
  submitHostedOperatorRequest,
} from './hosted-control.mjs';

import type { ComparatorStartTarget } from './comparator-profile.mjs';

export type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

/**
 * Structured CLI diagnostic. Diagnostics that originate in codegen may carry
 * additional top-level facts, hence the open index signature.
 */
export interface CliDiagnostic {
  readonly code: string;
  readonly severity: string;
  readonly subsystem: string;
  readonly message: string;
  readonly details?: unknown;
  readonly [key: string]: unknown;
}

export interface DiagnosticError extends Error {
  code: string;
  diagnostic: CliDiagnostic;
}

export function diagnosticError(code: string, message: string, details?: unknown): DiagnosticError;

/** Data-only help metadata for one package-owned top-level command. */
export interface PackagedCliCommandHelp {
  readonly name: string;
  readonly usage: string;
  readonly description: string;
  readonly lifecycle: string;
  readonly output: string;
  readonly exits: string;
  readonly recovery: string;
  readonly details?: readonly string[];
}

/** Data-only help metadata for one exact positional subcommand path. */
export interface PackagedCliSubcommandHelp extends PackagedCliCommandHelp {
  readonly path: readonly string[];
  readonly details: readonly string[];
}

export const PACKAGED_CLI_COMMANDS: readonly PackagedCliCommandHelp[];
export const PACKAGED_CLI_SUBCOMMANDS: readonly PackagedCliSubcommandHelp[];

/** Copy the environment with `DYLD_*` and `LD_LIBRARY_PATH` removed. */
export function scrubDynamicLoaderEnvironment(
  environment?: EnvironmentVariables,
): Record<string, string | undefined>;

/** Add an adjacent packaged-store receipt unless the caller already set one. */
export function runtimeSpawnEnvironment(
  binary: string,
  environment?: EnvironmentVariables,
): Record<string, string | undefined>;

// ---------------------------------------------------------------------------
// Runtime selection and doctor
// ---------------------------------------------------------------------------

export interface ResolvedRuntime {
  binary: string;
  /** `'override'` or the platform runtime package name. */
  source: string;
  platform: string;
}

export interface RuntimeSelectionOptions {
  readonly runtimeBinary?: string;
  readonly platform?: string;
}

export function resolveRuntimeBinary(options?: RuntimeSelectionOptions): ResolvedRuntime;

export interface PackagedRuntimeReadinessOptions extends RuntimeSelectionOptions {
  readonly projectRoot?: string;
  readonly receiptPath?: string;
  readonly verify?: boolean;
  readonly env?: EnvironmentVariables;
}

/** Live-qualify and persist, or re-verify, app-custodied runtime readiness. */
export function packagedRuntimeReadiness(options?: PackagedRuntimeReadinessOptions): Readonly<{
  schemaVersion: 'snapback.runtime-readiness-verification.v1';
  operation: 'persist' | 'verify';
  ok: boolean;
  reason: string;
  receiptPath: string;
  receipt: unknown;
  diagnostic: CliDiagnostic | null;
}>;

export interface DoctorReport {
  schemaVersion: 'snapback.cli-doctor.v2';
  ok: boolean;
  checks: readonly CliDiagnostic[];
  runtimeRecovery: RuntimeRecoveryRecord;
  runtime?: ResolvedRuntime;
  probe?: 'launch-only' | 'vertical-slice';
}

/** Prove a disposable VM/bundle/query/mutation/live/shutdown vertical slice. */
export function doctor(options?: RuntimeSelectionOptions & {
  readonly env?: EnvironmentVariables;
  readonly verticalSlice?: boolean;
  readonly readyTimeoutMs?: number;
}): Promise<DoctorReport>;

// ---------------------------------------------------------------------------
// Release build and verification
// ---------------------------------------------------------------------------

export interface ReleaseGap {
  readonly id: string;
  readonly reason: string;
  readonly blocking: true;
}

export interface ReleaseVerification {
  schemaVersion: 'snapback.release-verification.v1';
  ok: true;
  releaseId: string;
  manifestPath: string;
  manifestSha256: string;
  componentCount: number;
  totalBytes: number;
  activationEligible: false;
  gaps: readonly ReleaseGap[];
}

/** Verify a retained content-addressed release closure on disk. */
export function verifyRelease(releaseDirectory: string): ReleaseVerification;

export interface ReleaseBuildResult extends Omit<ReleaseVerification, 'schemaVersion'> {
  schemaVersion: 'snapback.deploy-build.v1';
  state: 'built' | 'reused';
  releaseDirectory: string;
  sourceDirty: boolean;
  targetProfileId: string;
}

/** Build and retain the target-neutral, content-addressed release closure. */
export function buildRelease(options?: {
  readonly backendDirectory?: string;
  readonly projectRoot?: string;
  readonly outputDirectory?: string;
  readonly webDirectory?: string;
  readonly targetProfile?: string;
  readonly allowDirty?: boolean;
  readonly runtimeArtifactDirectory?: string;
  readonly runtimePlatform?: string;
  readonly hermesBundleIdentity?: string;
}): Promise<ReleaseBuildResult>;

// ---------------------------------------------------------------------------
// Scaffolding and generation
// ---------------------------------------------------------------------------

export interface ScaffoldResult {
  schemaVersion: 'snapback.scaffold.v1';
  ok: true;
  template: string;
  target: string;
  readonly lifecycle: ScaffoldLifecycle;
  readonly skillFiles: readonly string[];
}

export interface ScaffoldLifecycle {
  readonly schemaVersion: 'snapback.scaffold-lifecycle.v1';
  readonly stages: readonly ['scaffold', 'install', 'generate', 'dev', 'prove'];
  readonly scripts: Readonly<Record<'generate' | 'dev' | 'prove', string>>;
}

export function listTemplates(): string[];

export function renderScaffoldAuthoringSkill(canonicalContent: string): string;

export function validateScaffoldLifecycleManifest(
  manifest: Readonly<{ scripts?: Readonly<Record<string, string>> }>,
  options?: { readonly template?: string },
): ScaffoldLifecycle;

export function scaffoldApp(target: string, options?: {
  readonly template?: string;
}): ScaffoldResult;

export interface InitAppResult {
  readonly schemaVersion: 'snapback.init.v1';
  readonly ok: true;
  readonly state: 'initialized' | 'already-initialized';
  readonly root: string;
  readonly appKind: 'create-expo-app' | 'packaged-react-scaffold';
  readonly packageManager: 'bun' | 'npm' | 'pnpm' | 'yarn';
  readonly lockfiles: readonly string[];
  readonly packageManagerSource: 'default' | 'local' | 'packageManager' | 'workspace';
  readonly snapbackVersion: string;
  readonly dependenciesAdded: readonly string[];
  readonly filesCreated: readonly string[];
  readonly filesUpdated: readonly string[];
  readonly filesUnchanged: readonly string[];
  readonly install: Readonly<{
    requested: boolean;
    ran: boolean;
    command: readonly string[];
    lockfileEffects: 'not-run' | 'package-manager-controlled';
  }>;
  readonly next: readonly string[];
}

/** Adopt Snapback into one recognized existing Expo or React app root. */
export function initApp(target?: string, options?: {
  readonly install?: boolean;
  readonly env?: EnvironmentVariables;
  readonly installRunner?: (
    executable: string,
    args: readonly string[],
    options: Readonly<Record<string, unknown>>,
  ) => Readonly<{ error?: Error; status?: number | null; stderr?: string }>;
}): InitAppResult;

export interface GenerateAppSuccess {
  schemaVersion: 'snapback.generate.v1';
  targetProfile: string;
  ok: true;
  diagnostics: readonly CliDiagnostic[];
  inputsHash: string;
  outDir: string;
  schemaManifest: unknown;
  functionManifest: unknown;
  handlerRuntimeProfile: unknown;
  capabilityManifest: unknown;
  providerIntrospection: unknown;
  providerBindingMetadata: unknown;
  contractManifest: unknown;
  artifactIndex: unknown;
  summary: unknown;
  check: boolean;
  checked: boolean;
  emitted: boolean;
  cacheGraphRoot: string | null;
}

export interface GenerateAppFailure {
  schemaVersion: 'snapback.generate.v1';
  targetProfile: string;
  check: boolean;
  ok: false;
  diagnostics: readonly CliDiagnostic[];
}

export type GenerateAppResult = GenerateAppSuccess | GenerateAppFailure;

/** Run codegen for a backend directory in a fresh worker process. */
export function generateApp(backendDirectory: string, options?: {
  readonly targetProfile?: string;
  readonly check?: boolean;
}): Promise<GenerateAppResult>;

// Re-declared from @expo/snapback-codegen/review-surface (re-exported at runtime).
export interface GeneratedGraphVerification {
  readonly layout: 'legacy' | 'review-cache';
  readonly graphRoot: string;
  readonly materializedRoot: string;
  readonly reviewPath: string;
  readonly manifest: unknown;
}

/** Verify the generated graph (committed materialization plus cache). */
export function verifyGeneratedGraph(generatedRoot: string): GeneratedGraphVerification;

/** Resolve a generated artifact path through the verified review manifest. */
export function resolveGeneratedArtifact(generatedRoot: string, artifactPath: string): string;

// ---------------------------------------------------------------------------
// Managed dev server plumbing
// ---------------------------------------------------------------------------

export interface ReadyDescriptor {
  readonly schemaVersion: 'snapback.v0';
  readonly descriptorKind: 'snapbackHostReady';
  readonly ready: true;
  readonly pid: number;
  readonly serverUrl: string;
  readonly database?: Readonly<{ path?: string; [key: string]: unknown }>;
  readonly adminTokenFile?: string;
  readonly startupNonce?: string;
  readonly impersonationCapabilityFile?: string;
  readonly devIdentityCapabilityFile?: string;
  readonly [key: string]: unknown;
}

export function readReadyDescriptor(path: string): ReadyDescriptor;

/** Refuse a readiness descriptor naming a different database target. */
export function validateDevTarget(
  descriptor: ReadyDescriptor,
  context: { readonly readyFile: string; readonly database?: string | null },
): ReadyDescriptor;

export interface NativeProcessResult {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  pid?: number;
  output?: readonly (string | null)[];
  error?: Error;
}

/** Run the native binary synchronously with the loader environment scrubbed. */
export function native(binary: string, args: readonly string[], options?: {
  readonly cwd?: string;
  readonly env?: EnvironmentVariables;
  readonly timeout?: number;
}): NativeProcessResult;

/** Read the owner-only admin token the managed server minted beside its
 * database; null when the descriptor declares no carrier. */
export function managedAdminToken(descriptor: ReadyDescriptor, database: string): string | null;

/** Resolve the owner-only dev-identity capability on the admin-token anchor ladder. */
export function managedDevIdentityCapability(
  descriptor: ReadyDescriptor,
  context: { readonly readyFile: string; readonly database?: string | null },
): string | null;

/** Observable slice of the managed server child process. */
export interface ManagedChildProcess {
  readonly pid?: number | undefined;
  readonly exitCode: number | null;
  readonly signalCode?: string | null;
  kill(signal?: string | number): boolean;
  once(event: string, listener: (...args: never[]) => void): unknown;
}

/** Spawn the packaged runtime with bounded startup-output capture and the
 * CLI's dynamic-loader environment policy. Lifecycle owners still perform
 * readiness validation and nonce-verified stop themselves. */
export function spawnManagedRuntime(
  binary: string,
  args: readonly string[],
  options?: {
    readonly cwd?: string;
    readonly env?: EnvironmentVariables;
    readonly stdio?: unknown;
  },
): ManagedChildProcess;

export function waitForReady(
  path: string,
  child: ManagedChildProcess,
  timeoutMs?: number,
): Promise<ReadyDescriptor>;

/** Load the generated schema/functions (and seed/routes/sessions artifacts)
 * into the server behind a readiness descriptor. */
export function loadGenerated(
  binary: string,
  projectRoot: string,
  backendRoot: string,
  readyFile: string,
  adminToken: string | null,
  options?: {
    readonly seed?: boolean;
    readonly database?: string | null;
    readonly skipSchemaFunctions?: boolean;
    readonly runtime?: ResolvedRuntime | null;
    readonly runtimeIdentity?: RuntimeBinaryInspection | null;
  },
): Promise<void>;

// ---------------------------------------------------------------------------
// The dev loop
// ---------------------------------------------------------------------------

export type DevEventState =
  | 'generated-and-loaded'
  | 'generated-but-not-loaded'
  | 'generation-failed'
  | 'watch-failed'
  | 'server-exited'
  | 'server-restarted'
  | 'restart-failed'
  | 'database-refreshed'
  | 'dev-fresh-failed'
  | 'client-started'
  | 'client-output'
  | 'client-exited'
  | 'status'
  | 'command-error'
  | 'control-ready';

/** One entry in the machine-readable `snapback.dev.v1` JSON-line stream. */
export interface DevEvent {
  readonly schemaVersion: 'snapback.dev.v1';
  readonly ok: boolean;
  readonly state: DevEventState;
  readonly verb?: string;
  readonly requestId?: string;
  readonly changed?: string | null;
  readonly applicationReadyFile?: string;
  readonly snapbackUrl?: string;
  readonly androidEmulatorUrl?: string;
  readonly admissionPosture?: 'loopback-any' | 'explicit-list';
  readonly environmentFile?: DevEnvironmentWriteResult | null;
  readonly portPlan?: DevPortPlan | null;
  readonly diagnostics?: readonly CliDiagnostic[];
  readonly [key: string]: unknown;
}

export interface DevVerbContext {
  readonly requestId?: string;
}

/** The dev-loop verb slice; every verb resolves to the event it emitted. */
export type DevVerbs = {
  status(context?: DevVerbContext): Promise<DevEvent | null>;
  reload(context?: DevVerbContext): Promise<DevEvent | null>;
  restart(context?: DevVerbContext): Promise<DevEvent | null>;
  'dev-fresh'(context?: DevVerbContext): Promise<DevEvent | null>;
};

export type DevClientArmSpec =
  | string
  | Readonly<{ directory?: string; command?: string }>
  | null
  | false;

export type DevServerStdioTarget =
  | 'ignore'
  | 'inherit'
  | number
  | Readonly<{ write(chunk: unknown): unknown }>;

export interface RunDevOptions extends RuntimeSelectionOptions {
  readonly backendDirectory?: string;
  readonly projectRoot?: string;
  readonly readyFile?: string;
  readonly applicationReadyFile?: string;
  readonly database?: string;
  /** Opt-in marker-block environment writer target. */
  readonly writeEnvFile?: string;
  readonly env?: EnvironmentVariables;
  readonly client?: DevClientArmSpec;
  /** Fixed backend listener port for externally-owned client lifecycles. */
  readonly port?: number;
  /** Inclusive range used by an unpinned backend listener. */
  readonly portRange?: string;
  /** Pre-resolved plan supplied by the owning supervisor/CLI. Attached
   * backends are returned with owner source `attached` and no declaration. */
  readonly portPlan?: DevPortPlan;
  /** Exact HTTP(S) origin admitted by the backend. Requires a backend
   * pin from `port` or `SNAPBACK_DEV_PORT`. */
  readonly externalClientOrigin?: string;
  /** Exact HTTP(S) origins admitted by the backend. Requires a
   * backend pin from `port` or `SNAPBACK_DEV_PORT`. */
  readonly externalClientOrigins?: readonly string[];
  /** Provider-owned loopback aliases admitted before a supervised client starts. */
  readonly supervisedClientOrigins?: readonly string[];
  /** Already-qualified runtime whose identity is carried by client bindings. */
  readonly qualifiedRuntimeBinary?: string;
  readonly attach?: boolean;
  readonly watch?: boolean;
  readonly bootstrapGeneratedAtStart?: boolean;
  readonly serverStdio?: DevServerStdioTarget | readonly DevServerStdioTarget[];
  readonly onEvent?: (event: DevEvent) => void;
  readonly onServerExit?: (code: number | null, signal: string | null) => void;
  /** Test-only managed-runtime spawn seam. */
  readonly spawnManagedRuntime?: typeof spawnManagedRuntime;
}

export interface DevLoopHandle {
  schemaVersion: 'snapback.dev.v1';
  ok: true;
  state: 'generated-and-loaded';
  managed: boolean;
  readyFile: string;
  applicationReadyFile: string;
  serverUrl: string;
  snapbackUrl: string;
  androidEmulatorUrl: string;
  lifecycleProfile: 'selected-port' | 'fixed-port';
  readonly portPlan: DevPortPlan;
  admissionPosture: 'loopback-any' | 'explicit-list';
  clientOrigins: readonly string[];
  environmentFile: DevEnvironmentWriteResult | null;
  runtime: ResolvedRuntime;
  runtimeRecovery: RuntimeRecoveryRecord;
  child: ManagedChildProcess | null;
  close: () => Promise<void>;
  /** Present only in watch mode. */
  verbs?: DevVerbs;
}

export interface DevGenerationFailure extends GenerateAppFailure {
  state: 'generation-failed';
}

/** Generate, start or attach to the managed server, load, and (by default)
 * watch the backend for hot regenerate-and-load passes. */
export function runDev(options?: RunDevOptions): Promise<DevLoopHandle | DevGenerationFailure>;

export interface OperationalReadinessV1 {
  readonly formatVersion: 'snapback.operational-readiness.v1';
  readonly ready: boolean;
  readonly startupNonce: string;
  readonly evaluatedAtMs: number;
  readonly target: Readonly<Record<string, unknown>>;
  readonly artifacts: Readonly<Record<string, unknown>>;
  readonly auth: Readonly<Record<string, unknown>>;
  readonly clientOrigins: readonly string[];
  readonly admissionPosture?: 'loopback-any' | 'explicit-list' | null;
  readonly capabilityManifestDigest: string;
  readonly networkProfile: string;
  readonly unsatisfied: readonly unknown[];
  readonly [key: string]: unknown;
}

export interface ApplicationReadyReceiptV1 {
  readonly formatVersion: 'snapback.application-ready.v1';
  readonly admissionPosture: 'loopback-any' | 'explicit-list';
  readonly startupNonce: string;
  readonly hostReadyDescriptorDigest: string;
  readonly application: Readonly<Record<string, unknown>>;
  readonly targetProfile: string;
  readonly artifacts: Readonly<Record<string, unknown>>;
  readonly auth: Readonly<Record<string, unknown>>;
  readonly binding: Readonly<Record<string, unknown>>;
  readonly clientOrigins: readonly string[];
  readonly runtimeIdentity: Readonly<Record<string, unknown>>;
  readonly capabilityManifestDigest: string;
  readonly networkProfile: string;
  readonly settledAtMs: number;
}

/** Read and validate the closed application-ready receipt schema. */
export function readApplicationReadyReceipt(path: string): ApplicationReadyReceiptV1;

/** Read the server-owned operational-readiness fact without changing it. */
export function readOperationalReadiness(
  descriptor: ReadyDescriptor,
  adminToken: string | null,
): Promise<OperationalReadinessV1>;

/**
 * Verify the canonical read-only attach cut. Optional expected facts let a
 * projection require only the origin(s) it owns; `runDev` supplies the full
 * origin and runtime identities before it performs any attach-side mutation.
 */
export function verifyDevAttach(options: {
  readonly descriptor: ReadyDescriptor;
  readonly readyFile: string;
  readonly applicationReadyFile: string;
  readonly adminToken: string | null;
  readonly generatedRoot: string;
  readonly clientOrigins?: readonly string[] | null;
  readonly admissionPosture?: 'loopback-any' | 'explicit-list' | null;
  readonly requiredClientOrigins?: readonly string[];
  readonly runtimeIdentity?: Readonly<Record<string, unknown>> | null;
  readonly fixedPort?: number | null;
  readonly portPlan?: DevPortPlan | null;
}): Promise<ApplicationReadyReceiptV1>;

/** Refuse a receipt whose complete bind-set differs from live readiness. */
export function verifyApplicationReadyReceiptAgainstReadiness(
  receipt: ApplicationReadyReceiptV1,
  readiness: OperationalReadinessV1,
): ApplicationReadyReceiptV1;

export interface DevEnvironmentWriteResult {
  readonly path: string;
  readonly state: 'inserted' | 'rewritten' | 'unchanged';
  readonly changed: boolean;
  readonly gitignored: boolean;
  readonly snapbackUrl: string;
  readonly androidEmulatorUrl: string;
}

export function writeDevEnvironmentFile(path: string, options: Readonly<{
  snapbackUrl: string;
  androidEmulatorUrl: string;
  projectRoot?: string;
}>): DevEnvironmentWriteResult;

export interface DevSessionResult {
  readonly formatVersion: 'snapback.dev-session.v1';
  readonly email: string;
  readonly bearer: string;
  readonly expiresAt: number;
}

export function mintDevSession(options?: Readonly<{
  readyFile?: string | null;
  email?: string;
  cwd?: string;
  env?: EnvironmentVariables;
  runtimeBinary?: string | null;
}>): Promise<DevSessionResult>;

/** Minimal stdin surface the dev control channel drives (process.stdin fits). */
export interface DevControlStdin {
  readonly isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  resume(): unknown;
  pause(): unknown;
  setEncoding(encoding: string): unknown;
  on(event: string, listener: (chunk: string) => void): unknown;
  off(event: string, listener: (chunk: string) => void): unknown;
}

/**
 * Attach the TTY single-key or newline-delimited-JSON dev command channel.
 * Returns a detach function.
 */
export function attachDevControlChannel(options: {
  readonly verbs: Readonly<Record<string, (context: DevVerbContext) => unknown>>;
  readonly stop: () => void;
  readonly onEvent?: (event: DevEvent) => void;
  readonly stdin?: DevControlStdin;
}): () => void;

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

export interface RunCliOptions {
  readonly runtimeBinary?: string;
  readonly platform?: string;
  readonly env?: EnvironmentVariables;
  readonly stdin?: DevControlStdin;
  readonly verticalSlice?: boolean;
  readonly readyTimeoutMs?: number;
  readonly auditActorId?: string;
  readonly controlRoot?: string;
  readonly comparatorStartTarget?: ComparatorStartTarget;
  readonly [key: string]: unknown;
}

/** Run one CLI command; resolves to the process exit code. */
export function runCli(argv: readonly string[], options?: RunCliOptions): Promise<number>;

export const __test: {
  assertDevAdmissionContractMatches(
    requested: Readonly<Record<string, unknown>>,
    recorded: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>>;
  canonicalDevClientOrigin(value: string): string | null;
  loadGenerated: typeof loadGenerated;
  readReadyDescriptor: typeof readReadyDescriptor;
  runtimePackages: Record<string, string>;
  scrubDynamicLoaderEnvironment: typeof scrubDynamicLoaderEnvironment;
  runtimeSpawnEnvironment: typeof runtimeSpawnEnvironment;
};

export declare function genericClientCommandAdvisory(command: unknown): Readonly<{
  code: 'SNAPBACK_DEV_EXPO_SUPERVISOR_BYPASSED';
  severity: 'warning';
  subsystem: 'cli';
  message: string;
  details: Readonly<{
    command: string;
    genericArm: string;
    supervisedAlternative: string;
  }>;
}> | null;
