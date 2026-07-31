// Type declarations for index.mjs — the deterministic hosted-supervisor core:
// fail-closed single-writer state, provider-effect journal, spend/cleanup
// ledgers, and the TLS certificate-transfer envelope helpers.

export class SupervisorRefusal extends Error {
  constructor(code: string, message: string);
  name: 'SupervisorRefusal';
  code: string;
}

export function canonicalJson(value: unknown): string;
export function sha256(value: string | Uint8Array): `sha256:${string}`;

export function plannedBindingDigest(options: Readonly<{
  journeyId: string;
  planDigest: string;
  logicalResourceNames: readonly string[];
  provider: string;
  region: string;
  ownershipSentinel: string;
}>): `sha256:${string}`;

/**
 * Digest over the closed lifecycle request minus its self-referential
 * members (`transportBearer`, `requestSha256`, and the intent's own
 * `requestSha256`).
 */
export function lifecycleRequestDigest(request: Readonly<{
  readonly effectIntent?: Readonly<Record<string, unknown>> | null;
  readonly [member: string]: unknown;
}>): `sha256:${string}`;

/** base64url SHA-256 over the canonical semantic-effect identity tuple. */
export function semanticEffectId(options: Readonly<{
  operationId: string;
  operation: string;
  targetBindingDigest: string;
  planDigest: string;
  effectKind: string;
  logicalResourceName: string;
  desiredProviderStateSha256: string;
}>): string;

export interface FlyMachineService {
  readonly processes?: readonly string[];
  readonly autostop?: boolean | 'stop' | 'suspend';
  readonly autostart?: boolean;
  readonly [fact: string]: unknown;
}

export interface FlyMachine {
  readonly id: string;
  readonly state?: string;
  readonly region?: string;
  readonly config?: Readonly<{
    readonly services?: readonly FlyMachineService[];
    readonly containers?: ReadonlyArray<Readonly<{
      readonly services?: readonly FlyMachineService[];
      readonly [fact: string]: unknown;
    }>>;
    readonly mounts?: ReadonlyArray<Readonly<{
      readonly volume: string;
      readonly [fact: string]: unknown;
    }>>;
    readonly image?: string;
    readonly [fact: string]: unknown;
  }>;
  readonly [fact: string]: unknown;
}

export function machineIsProductionRouted(
  machine: FlyMachine,
  serviceProcessGroups: readonly string[],
): boolean;

export interface FlyTargetBindingCredential {
  readonly role: string;
  readonly credentialRef: string;
  readonly fingerprint: string;
  readonly allowedVerbs: readonly string[];
  readonly resourcePrefixes: readonly string[];
}

/** The closed `snapback.fly-target-binding.v2` shape (exact field set). */
export interface FlyTargetBinding {
  readonly schemaVersion: 'snapback.fly-target-binding.v2';
  readonly targetId: string;
  readonly bindingGeneration: number;
  readonly predecessorBindingSha256: string | null;
  readonly organizationId: string;
  readonly appId: string;
  readonly region: string;
  readonly publicOrigin: string;
  readonly activeMachineId: string;
  readonly machineRoster: readonly string[];
  readonly routedMachineIds: readonly string[];
  readonly serviceProcessGroups: readonly string[];
  readonly autostopEnabled: boolean;
  readonly autostartEnabled: boolean;
  readonly autoscaleEnabled: boolean;
  readonly volumeId: string;
  readonly ociRepository: string;
  readonly ociDigest: string;
  readonly tigrisBucket: string;
  readonly artifactPrefix: string;
  readonly backupPrefix: string;
  readonly controlStatePrefix: string;
  readonly auditPrefix: string;
  readonly logPrefix: string;
  readonly cleanupPrefix: string;
  readonly tlsIssuer: string;
  readonly certificatePosture: unknown;
  readonly externalHeadKey: string;
  readonly ownershipSentinel: string;
  readonly supervisorInstallationId: string;
  readonly supervisorOciDigest: string;
  readonly credentials: readonly FlyTargetBindingCredential[];
  readonly observedAtMs: number;
  readonly expiresAtMs: number;
}

/**
 * Refuses (throws SupervisorRefusal) unless the observed roster exactly
 * matches the generation-fenced binding; returns the active machine.
 */
export function verifyBoundFlyMachineRoster(
  binding: FlyTargetBinding,
  machines: readonly FlyMachine[],
): FlyMachine;

export interface SupervisorInstallationReceipt {
  readonly installationId: string;
  readonly standingRootAuthorizationSha256: string;
  readonly [fact: string]: unknown;
}

export interface ProviderEffectIntent {
  readonly semanticEffectId: string;
  readonly requestDigest: string;
  readonly planSha256: string;
  readonly [fact: string]: unknown;
}

export interface ProviderEffectTerminal {
  readonly outcome: 'notApplied' | 'applied' | 'commitUncertain';
  readonly consumedMicros?: number;
  readonly [fact: string]: unknown;
}

export interface ProviderEffectRecord {
  intent: ProviderEffectIntent;
  observations: Array<Record<string, unknown>>;
  terminal: ProviderEffectTerminal | null;
  retainedResponse?: unknown;
}

export interface SpendGrant {
  grantId: string;
  journeyId: string;
  planDigest: string;
  targetOrPlannedBindingDigest: string;
  confirmationDigest: string | null;
  semanticEffectIds: string[];
  maximumMicros: number;
  heldMicros: number;
  state: 'reserved' | 'effecting' | 'released' | 'consumed' | 'commitUncertain';
}

export interface SpendLedger {
  schemaVersion: 'snapback.hosted-spend-ledger.v1';
  journeyId: string;
  currency: string;
  tariffSource: string;
  tariffObservedAtMs: number;
  maximumMicros: number;
  remainingMicros: number;
  cleanupReserveMicros: number;
  grants: SpendGrant[];
}

export interface PlannedBindingPromotion {
  schemaVersion: 'snapback.planned-binding-promotion.v1';
  journeyId: string;
  plannedBindingSha256: string;
  provider: string;
  region: string;
  ownershipSentinel: string;
  logicalResourceIds: Array<Readonly<{ logicalName: string; [fact: string]: unknown }>>;
  targetBindingSha256: string;
}

export interface HostedTargetHead {
  schemaVersion: 'snapback.hosted-target-head.v1';
  binding: FlyTargetBinding;
  bindingSha256: string;
}

/** The closed `snapback.hosted-control-head.v2` shape (exact field set). */
export interface HostedControlHead {
  readonly schemaVersion: 'snapback.hosted-control-head.v2';
  readonly targetId: string;
  readonly generation: number;
  readonly predecessorSha256: string | null;
  readonly bindingSha256: string;
  readonly activationGeneration: number;
  readonly activeReleaseId: string;
  readonly admissionGeneration: number;
  readonly journalRootSha256: string;
  readonly committedAtMs: number;
  readonly spendFloor: number;
  readonly cleanupFloor: number;
  readonly replayFloor: number;
  readonly supervisorIncarnation: string;
}

/** The closed `snapback.hosted-target-enrollment.v1` shape. */
export interface HostedTargetEnrollment {
  readonly schemaVersion: 'snapback.hosted-target-enrollment.v1';
  readonly targetId: string;
  readonly deploymentId: string;
  readonly publicOrigin: string;
  readonly firstContactTransport: string;
  readonly admissionPublicKey: string;
  readonly supportSha256: string;
  readonly signingSeedCredentialRef: string;
  readonly clientCertificateSha256: string;
}

export interface TargetBootAdmission {
  machineId: string;
  processBootId: string;
  admissionEpoch: number;
  senderReplayEpochFloor: number;
  lastIssuedAtMs: number;
  providerFactsSha256: string;
}

export interface CleanupResource {
  readonly ownershipSentinel: string;
  readonly providerId: string;
  readonly disposition?: string;
  readonly [fact: string]: unknown;
}

export interface CleanupPlan {
  schemaVersion: 'snapback.vm-adapter-cleanup-plan.v1';
  cleanupPlanId: string;
  journeyId: string;
  targetOrPlannedBindingSha256: string;
  ownershipSentinel: string;
  resources: CleanupResource[];
  cleanupReserveMicros: number;
  inventorySha256: string;
  confirmationSha256: string;
  confirmed: boolean;
  applied: boolean;
  absenceProofSha256?: string;
}

export interface HostedSupervisorDatabase {
  generation: number;
  journal: Array<Record<string, unknown>>;
  effects: Record<string, ProviderEffectRecord>;
  reconciliations: Array<Record<string, unknown>>;
  promotions: Record<string, PlannedBindingPromotion>;
  spendLedgers: Record<string, SpendLedger>;
  cleanupPlans: Record<string, CleanupPlan>;
  heads: Record<string, HostedTargetHead>;
  controlHeads: Record<string, HostedControlHead>;
  targetEnrollments: Record<string, HostedTargetEnrollment>;
  targetBootAdmissions: Record<string, TargetBootAdmission>;
  floors: { spend: number; cleanup: number; replay: number };
  /** Adapter-owned extensions (e.g. `operatorAuthority`). */
  [state: string]: unknown;
}

export interface HostedSupervisorMirror {
  generation: number;
  database: HostedSupervisorDatabase;
  journalDigest: string;
}

export interface HostedSupervisorAnchor {
  incarnation: string;
  generation: number;
  journalDigest: string;
  spendFloor: number;
  cleanupFloor: number;
  replayFloor: number;
  controlHeadDigest: string;
}

/** Crash-boundary hook used only by the deterministic crash corpus. */
export type SupervisorCommitOptions = Readonly<{
  interruptAt?: 'afterSqlite' | 'afterMirror' | 'afterAnchor' | null;
}>;

export class HostedSupervisor {
  constructor(options: {
    installationReceipt: SupervisorInstallationReceipt;
    incarnation?: string;
    database?: HostedSupervisorDatabase | null;
    mirror?: HostedSupervisorMirror | null;
    anchor?: HostedSupervisorAnchor | null;
  });

  installationReceipt: SupervisorInstallationReceipt;
  incarnation: string;
  database: HostedSupervisorDatabase;
  mirror: HostedSupervisorMirror | null;
  anchor: HostedSupervisorAnchor;

  assertRecovered(): void;
  assertEffectAuthority(): void;
  /** Commit ordering: SQLite -> encrypted mirror -> external CAS. */
  commit(
    mutator: (database: HostedSupervisorDatabase) => void,
    options?: SupervisorCommitOptions,
  ): HostedSupervisorDatabase;

  createSpendLedger(options: Readonly<{
    journeyId: string;
    currency: string;
    tariffSource: string;
    tariffObservedAtMs: number;
    maximumMicros: number;
    cleanupReserveMicros: number;
  }>): SpendLedger;

  reserveSpend(options: Readonly<{
    journeyId: string;
    grantId: string;
    planDigest: string;
    targetOrPlannedBindingDigest: string;
    confirmationDigest?: string | null;
    semanticEffectIds: readonly string[];
    maximumMicros: number;
  }>): SpendLedger;

  appendIntent(intent: ProviderEffectIntent, options?: Readonly<{
    journeyId?: string;
    grantId?: string;
    targetOrPlannedBindingDigest?: string;
    confirmationDigest?: string | null;
    interruptAt?: 'afterSqlite' | 'afterMirror' | 'afterAnchor' | null;
  }>): ProviderEffectRecord;

  markEffecting(
    semanticEffectId: string,
    observation: Readonly<Record<string, unknown>>,
    options?: SupervisorCommitOptions,
  ): ProviderEffectRecord;

  appendTerminal(semanticEffectId: string, terminal: ProviderEffectTerminal, options?: Readonly<{
    journeyId?: string;
    grantId?: string;
    retainedResponse?: unknown;
    interruptAt?: 'afterSqlite' | 'afterMirror' | 'afterAnchor' | null;
  }>): ProviderEffectRecord;

  reconcileEffect(
    semanticEffectId: string,
    reconciliation: Readonly<{
      reconciliationId: string;
      resolvedOutcome: 'notApplied' | 'applied';
      [fact: string]: unknown;
    }>,
    options?: SupervisorCommitOptions,
  ): Record<string, unknown> | undefined;

  promotePlannedBinding(options: Readonly<{
    journeyId: string;
    plannedBindingDigest: string;
    logicalResourceNames: readonly string[];
    provider: string;
    region: string;
    ownershipSentinel: string;
    logicalResourceIds: ReadonlyArray<Readonly<{ logicalName: string; [fact: string]: unknown }>>;
    targetBindingDigest: string;
  }>): PlannedBindingPromotion;

  registerTargetBinding(binding: FlyTargetBinding): HostedTargetHead;
  registerControlHead(head: HostedControlHead): HostedControlHead;
  registerHostedTargetEnrollment(enrollment: HostedTargetEnrollment): HostedTargetEnrollment;

  reserveOnlineAdmission(options: Readonly<{
    targetId: string;
    machineId: string;
    processBootId: string;
    providerFactsSha256: string;
    issuedAtMs: number;
  }>): TargetBootAdmission;

  admitRoster(options: Readonly<{
    targetId: string;
    expectedMachineId: string;
    machines: ReadonlyArray<Readonly<{
      id?: string;
      productionRouted?: boolean;
      [fact: string]: unknown;
    }>>;
    autoscaleEnabled: boolean;
    observedAtMs: number;
    expiresAtMs: number;
  }>): Readonly<{
    targetId: string;
    machineId: string;
    exactRosterSha256: `sha256:${string}`;
    observedAtMs: number;
    expiresAtMs: number;
    allProtectedServingAdmitted: true;
  }>;

  planCleanup(options: Readonly<{
    cleanupPlanId: string;
    journeyId: string;
    targetOrPlannedBindingDigest: string;
    ownershipSentinel: string;
    inventory: readonly CleanupResource[];
    cleanupReserveMicros: number;
    confirmationSha256: string;
  }>): CleanupPlan;

  confirmCleanup(
    cleanupPlanId: string,
    confirmation: Readonly<{ inventorySha256: string; confirmationSha256: string }>,
  ): CleanupPlan;

  applyCleanup(
    cleanupPlanId: string,
    absenceObservations: ReadonlyArray<Readonly<{
      providerId: string;
      absent: boolean;
      [fact: string]: unknown;
    }>>,
  ): CleanupPlan;
}

export interface CertificateRecipientAttestation {
  readonly schemaVersion: 'snapback.tls-certificate-recipient.v1';
  readonly journeyId: string;
  readonly plannedBindingSha256: string;
  readonly successorMachineId: string;
  readonly successorVolumeId: string;
  readonly bindingGeneration: number;
  readonly expiresAtMs: number;
  readonly publicKey: string;
}

export function createCertificateRecipient(options: Readonly<{
  journeyId: string;
  plannedBindingDigest: string;
  successorMachineId: string;
  successorVolumeId: string;
  bindingGeneration: number;
  expiresAtMs: number;
}>): Readonly<{
  attestation: CertificateRecipientAttestation;
  /** Keep only in successor process memory. */
  privateKey: string;
}>;

export interface CertificateTransfer {
  readonly schemaVersion: 'snapback.tls-certificate-transfer.v1';
  readonly attestation: CertificateRecipientAttestation;
  readonly predecessorMachineId: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly wrappingPublicKey: string;
  readonly ciphertext: string;
  readonly ciphertextNonce: string;
  readonly ciphertextTag: string;
  readonly wrappedKey: string;
  readonly wrappedKeyNonce: string;
  readonly wrappedKeyTag: string;
  readonly ciphertextSha256: `sha256:${string}`;
}

export function sealCertificateTransfer(options: Readonly<{
  attestation: CertificateRecipientAttestation;
  manifest: Readonly<Record<string, unknown>>;
  plaintextBundle: string | Uint8Array;
  nowMs: number;
  predecessorMachineId: string;
  expected: Readonly<{
    successorMachineId: string;
    successorVolumeId: string;
    bindingGeneration: number;
    successorRouted: boolean;
  }>;
}>): CertificateTransfer;

export function openCertificateTransfer(options: Readonly<{
  transfer: CertificateTransfer;
  successorPrivateKey: string;
  nowMs: number;
}>): Uint8Array;
