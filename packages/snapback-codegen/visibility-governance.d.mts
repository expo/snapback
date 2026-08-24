export const GOVERNANCE_SCHEMA_VERSIONS: Readonly<{
  overrideDeclaration: 'snapback.visibility-override-declaration.v1';
  approvalRecord: 'snapback.visibility-override-approval.v1';
  transitionRecord: 'snapback.table-visibility-policy-transition.v2';
  ownerMap: 'snapback.visibility-override-owner-map.v1';
  ownerBaseline: 'snapback.visibility-override-owner-baseline.v1';
  overrideBaseline: 'snapback.visibility-override-baseline.v1';
  policyBaseline: 'snapback.table-visibility-policy-baseline.v2';
  transitionLedger: 'snapback.table-visibility-policy-transition-ledger.v2';
  quarantineLedger: 'snapback.visibility-governance-quarantine-ledger.v1';
  quarantineVerdict: 'snapback.visibility-governance-quarantine-verdict.v1';
  observerKeys: 'snapback.visibility-governance-observer-keys.v1';
  separationReceipt: 'snapback.visibility-governance-separation-receipt.v1';
  governedUpdateVerdict: 'snapback.visibility-governance-update-verdict.v1';
  targetConfig: 'snapback.visibility-governance-target-config.v1';
  fixtureProfile: 'snapback.visibility-fixture-profile.v1';
  activation: 'snapback.visibility-governance-activation.v1';
  g1Closure: 'snapback.visibility-governance-g1-closure.v1';
}>;

export const GOVERNANCE_FILES: Readonly<{
  ownerMap: 'visibility-override-owners.json';
  ownerBaseline: 'generated/visibility-override-owner-baseline.json';
  overrideBaseline: 'generated/visibility-override-baseline.json';
  policyBaseline: 'generated/table-visibility-policy-baseline.json';
  transitionLedger: 'generated/table-visibility-policy-transition-ledger.json';
  quarantineLedger: 'generated/visibility-governance-quarantine-ledger.json';
  elevatedReadBaseline: 'generated/elevated-read-site-baseline.json';
  observerKeys: 'visibility-governance-observer-keys.json';
  g1Closure: 'visibility-governance-g1-closure.json';
}>;

export const GOVERNED_REFS_DEFAULT: readonly ['refs/heads/main'];
export const GOVERNANCE_COMPARATOR_VERSION: 'snapback.visibility-governance-comparator.v2';
export const GOVERNANCE_SCOPE_DIGEST_VERSION: 'snapback.visibility-scope.v1';
export const GOVERNANCE_DIGEST_ALGORITHM: 'sha256';

export type GovernanceRecord = Readonly<Record<string, unknown>>;

export class VisibilityGovernanceError extends Error {
  readonly code: string;
  readonly details: GovernanceRecord;
  constructor(code: string, message: string, details?: GovernanceRecord);
}

export type PublicReadVisibilityPolicy = Readonly<{ kind: 'public-read' }>;
export type OwnerVisibilityPolicy = Readonly<{ kind: 'owner'; field: string }>;
export type MembershipVisibilityPolicy = Readonly<{
  kind: 'membership';
  declaration: string;
  resourceField: string;
  roles?: readonly string[];
}>;
export type VisibilityPolicyLeaf =
  | PublicReadVisibilityPolicy
  | OwnerVisibilityPolicy
  | MembershipVisibilityPolicy;
export type RestrictedVisibilityPolicyLeaf = OwnerVisibilityPolicy | MembershipVisibilityPolicy;
export type CanonicalVisibilityPolicy = VisibilityPolicyLeaf | Readonly<{
  kind: 'any-of';
  arms: readonly RestrictedVisibilityPolicyLeaf[];
}>;

export interface MembershipAudienceDeclaration {
  readonly id: string;
  readonly membershipTable: string;
  readonly resourceTable: string | null;
  readonly principalField: string;
  readonly resourceField: string;
  readonly roleField?: string;
  readonly policyResourceField: string;
  readonly roles: readonly string[];
}

export type WriteForm = 'insert' | 'insert-each' | 'patch' | 'delete' | 'delete-where';
export type WriteDisposition =
  | 'refused'
  | 'owner-host-stamped'
  | 'owner-old-row-checked'
  | 'owner-filtered';

export interface GlobalUniqueDisclosure {
  readonly table: string;
  readonly writeForm: WriteForm;
  readonly constraint: string;
  readonly operations: readonly string[];
}

export interface CanonicalWritePosture {
  readonly semanticVersion: 'snapback.owner-write.v1';
  readonly dispositions: Readonly<Record<WriteForm, WriteDisposition>>;
  readonly ownerField: string | null;
  readonly authorityTableClass: 'ordinary' | 'membership' | 'permission-backing';
  readonly globalUniqueDisclosures: readonly GlobalUniqueDisclosure[];
}

export interface NormalizedPolicyBody {
  readonly policy: CanonicalVisibilityPolicy;
  readonly audienceDeclarationClosure: readonly MembershipAudienceDeclaration[];
  readonly audienceDeclarationClosureDigest: string;
  readonly writePosture?: CanonicalWritePosture;
}

export function canonicalGovernanceJson(value: unknown): string;
export function governanceDigest(domain: string, value: unknown): string;
export function canonicalVisibilityPolicy(
  policy: unknown,
  label?: string,
  code?: string,
): CanonicalVisibilityPolicy;
export function normalizePolicyBody(
  policy: unknown,
  tables?: Readonly<Record<string, GovernanceRecord>>,
  writePosture?: unknown,
): NormalizedPolicyBody;
export function compareVisibilityPolicies(
  predecessorBody: NormalizedPolicyBody | null,
  successorBody: NormalizedPolicyBody,
): 'equal' | 'new-restricted' | 'growth' | 'narrowing' | 'incomparable';

export type CanonicalOverrideAuthority =
  | Readonly<{
      mode: 'principal';
      operations: readonly string[];
      admissionPolicy: CanonicalVisibilityPolicy;
      admissionMembershipAudienceClosure: readonly MembershipAudienceDeclaration[];
      admissionMembershipAudienceClosureDigest: string;
    }>
  | Readonly<{ mode: 'system'; entrypoint: string; calls: readonly string[] }>
  | Readonly<{
      mode: 'capturedGrant';
      issuanceProfile: string;
      operations: readonly string[];
      maximumTtlMs: number;
    }>;

export type CanonicalRowScope =
  | CanonicalVisibilityPolicy
  | Readonly<{ allRows: true }>
  | Readonly<{ kind: 'argument-equality'; field: string; value: unknown }>;

export interface CanonicalGovernedRead {
  readonly table: string;
  readonly scope: CanonicalRowScope;
  readonly rowScopeDigest: string;
  readonly audienceDeclarationClosure: readonly MembershipAudienceDeclaration[];
  readonly audienceDeclarationClosureDigest: string;
}

export interface VisibilityFixtureProfile {
  readonly schemaVersion: 'snapback.visibility-fixture-profile.v1';
  readonly id: string;
  readonly digest: string;
  readonly targetClassCeiling: string;
  readonly principalClass: 'synthetic';
  readonly dataClassification: 'fixture-owned';
}

export interface OverridePatternDerivation {
  readonly patternId: string;
  readonly constructorVersion: string;
  readonly constructorDigest: string;
  readonly derivationDigest?: string;
}

export interface CanonicalOverride {
  readonly schemaVersion: 'snapback.visibility-override-declaration.v1';
  readonly id: string;
  readonly owner: string;
  readonly authority: CanonicalOverrideAuthority;
  readonly reads: readonly CanonicalGovernedRead[];
  readonly operations: readonly string[];
  readonly justificationDigest: string;
  readonly lifecycleClass: 'production' | 'fixture';
  readonly acceptance: Readonly<{ id: string; path: string; resultDigest: string }>;
  readonly issuedOn?: string;
  readonly expiresOn?: string;
  readonly fixtureProfile?: VisibilityFixtureProfile;
  readonly patternDerivation?: Omit<OverridePatternDerivation, 'derivationDigest'>;
}

export interface CanonicalOverrideResult {
  readonly canonical: CanonicalOverride;
  readonly approvalPath: string;
  readonly separationReceiptPath: string;
  readonly patternDerivation?: Required<OverridePatternDerivation>;
}

export function canonicalOverrideDeclaration(
  declaration: unknown,
  tables?: Readonly<Record<string, GovernanceRecord>>,
): CanonicalOverrideResult;
export function overrideScopeDigest(canonical: CanonicalOverride): string;

export interface VisibilityOwnerMapEntry {
  readonly path?: string;
  readonly patternId?: string;
  readonly implementationOwner: string;
  readonly approvalOwner: string;
  readonly authorRuling: string;
  readonly delegationRecord: GovernanceRecord;
}

export interface VisibilityOwnerMap {
  readonly schemaVersion: 'snapback.visibility-override-owner-map.v1';
  readonly fallbackApprovalOwner: string;
  readonly entries: readonly VisibilityOwnerMapEntry[];
}

export function canonicalOwnerMap(ownerMap: unknown): VisibilityOwnerMap;
export function patternApprovalScopeDigest(approval: GovernanceRecord, patternCeiling: unknown): string;
export function validateProductionOverrideTime(
  declaration: CanonicalOverride & Readonly<{ issuedOn: string; expiresOn: string }>,
  observedAt: string,
  now: number,
): boolean;

export interface VisibilityOverrideBaselineEntry extends GovernanceRecord {
  readonly id: string;
  readonly scopeDigestVersion: 'snapback.visibility-scope.v1';
  readonly scopeDigest: string;
  readonly normalizedDeclaration: CanonicalOverride;
  readonly approvalKind: 'custom' | 'pattern';
  readonly normalizedPatternCeiling: VisibilityOverridePatternCeiling | null;
  readonly patternId: string | null;
  readonly constructorVersion: string | null;
  readonly constructorDigest: string | null;
  readonly derivationDigest: string | null;
  readonly lifecycleClass: 'production' | 'fixture';
  readonly authorityMode: CanonicalOverrideAuthority['mode'];
  readonly authorityAdmissionPolicy: CanonicalVisibilityPolicy | null;
  readonly authorityAdmissionPolicyDigest: string | null;
  readonly authorityAdmissionMembershipAudienceClosure: readonly MembershipAudienceDeclaration[];
  readonly authorityAdmissionMembershipAudienceClosureDigest: string;
  readonly operations: readonly string[];
  readonly tables: readonly string[];
  readonly rowScopeDigests: readonly string[];
  readonly audienceDeclarationClosureDigests: readonly string[];
  readonly owner: string;
  readonly approvalRecord: string;
  readonly approvalClosureDigest: string;
  readonly serverSeparationReceipt: string;
  readonly serverSeparationReceiptDigest: string;
  readonly fixtureProfileId: string | null;
  readonly fixtureProfileDigest: string | null;
  readonly fixtureTargetClassCeiling: string | null;
  readonly fixturePrincipalClass: 'synthetic' | null;
  readonly fixtureDataClassification: 'fixture-owned' | null;
  readonly expiresOn: string | null;
  readonly acceptanceId: string;
}

export interface VisibilityOverridePatternCeiling {
  readonly authority: CanonicalOverrideAuthority;
  readonly reads: readonly CanonicalGovernedRead[];
  readonly operations: readonly string[];
  readonly lifecycleClass: 'production' | 'fixture';
  readonly fixtureProfile?: VisibilityFixtureProfile;
}

export function visibilityOverrideBaselineEntry(input: Readonly<{
  declaration: CanonicalOverride;
  scopeDigest: string;
  approvalPath: string;
  separationReceiptPath: string;
  approvalClosureDigest: string;
  receiptDigest: string;
  approvalKind?: string;
  patternDerivation?: Required<OverridePatternDerivation> | null;
  normalizedPatternCeiling?: unknown;
}>): VisibilityOverrideBaselineEntry;

export interface ExactSetBaseline<T> {
  readonly schemaVersion: string;
  readonly entries: readonly T[];
  readonly exactSetDigest: string;
}

export function exactSetBaseline<T extends Readonly<{ id?: string; tableId?: string }>>(
  entries: readonly T[],
  schemaVersion: string,
): ExactSetBaseline<T>;
export function transitionNodeDigest(node: unknown): string;
export function transitionLedgerDigest(nodes: readonly unknown[], heads: GovernanceRecord): string;
export function transitionApprovalScopeDigest(node: GovernanceRecord, approval: GovernanceRecord): string;

export interface TablePolicyBaselineEntry {
  readonly tableId: string;
  readonly normalizedPolicyBody: NormalizedPolicyBody;
  readonly policyDigest: string;
  readonly provenanceHeadId: string | null;
}

export function currentTablePolicyBaseline(
  tables: Readonly<Record<string, GovernanceRecord>>,
  transitionLedger: Readonly<{ heads: Readonly<Record<string, string>> }>,
  writeDisclosures?: readonly GovernanceRecord[],
): ExactSetBaseline<TablePolicyBaselineEntry>;

export interface VisibilityGovernanceActivation {
  readonly schemaVersion: 'snapback.visibility-governance-activation.v1';
  readonly required: boolean;
  readonly generationInputsHash: string;
  readonly visibilityAuthorizationProgramDigest: string;
  readonly overrideBaselineDigest: string;
  readonly tablePolicyBaselineDigest: string;
  readonly quarantineHeadDigest: string;
  readonly fixtureProfiles: readonly Readonly<{
    overrideId: string;
    id: string;
    digest: string;
    targetClassCeiling: string;
    principalClass: 'synthetic';
    dataClassification: 'fixture-owned';
  }>[];
  readonly productionWindows: readonly Readonly<{
    overrideId: string;
    issuedOn: string;
    expiresOn: string;
  }>[];
}

export interface VisibilityGovernanceResult {
  readonly ownerMap: VisibilityOwnerMap;
  readonly ownerBaseline: GovernanceRecord;
  readonly overrideBaseline: ExactSetBaseline<VisibilityOverrideBaselineEntry>;
  readonly policyBaseline: ExactSetBaseline<TablePolicyBaselineEntry>;
  readonly transitionLedger: GovernanceRecord & Readonly<{ nodes: readonly GovernanceRecord[]; heads: GovernanceRecord }>;
  readonly quarantine: GovernanceRecord & Readonly<{ records: readonly GovernanceRecord[]; retiredIds: readonly string[]; headDigest: string }>;
  readonly visibilityOverrides: readonly GovernanceRecord[];
  readonly tablePolicyTransitions: readonly GovernanceRecord[];
  readonly warnings: readonly Readonly<{
    code: 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRING';
    severity: 'warning';
    subsystem: 'auth';
    message: string;
    details: GovernanceRecord;
  }>[];
  readonly generationInputsHash: string;
  readonly visibilityAuthorizationProgramDigest: string;
  readonly activation: VisibilityGovernanceActivation;
}

export interface GovernanceChildProcessAdapter {
  execFileSync(
    file: string,
    args: readonly string[],
    options: Readonly<{
      cwd: string;
      encoding: 'utf8';
      stdio?: readonly ['ignore', 'pipe', 'pipe'];
    }>,
  ): string;
}

export function validateVisibilityGovernance(input: Readonly<{
  backendRoot: string;
  schemaDef: GovernanceRecord & Readonly<{ visibilityOverrides?: readonly unknown[] }>;
  tables: Readonly<Record<string, GovernanceRecord>>;
  writeDisclosures?: readonly GovernanceRecord[];
  now?: number;
  targetObserverPin?: Readonly<{ epoch: string; keyDigest: string }> | null;
}>): VisibilityGovernanceResult | null;

export function installGovernanceNodeChildProcess(
  value: GovernanceChildProcessAdapter,
): void;

export interface ApprovalClosure {
  readonly approval: GovernanceRecord;
  readonly ownerMap: VisibilityOwnerMap;
  readonly ownerMapDigest: string;
  readonly approvalClosureDigest: string;
}

export function approvalClosureAtRevision(input: Readonly<{
  root: string;
  revision: string;
  backendPath: string;
  approvalPath: string;
}>): ApprovalClosure;
export function g1ClosureSourceRevisionDigest(receipt: GovernanceRecord): string;
export function g1ClosureReceiptDigest(receipt: GovernanceRecord): string;

export interface GovernanceSnapshotComparison {
  readonly growth: readonly string[];
  readonly policyGrowth: readonly string[];
  readonly backends: readonly Readonly<{
    backendPath: string;
    growth: readonly string[];
    policyGrowth: readonly string[];
  }>[];
}

export function compareGovernanceSnapshots(input: Readonly<{
  root: string;
  beforeOid: string;
  afterOid: string;
  backendPaths?: readonly string[];
}>): GovernanceSnapshotComparison;
export function isGovernedRef(ref: string, governedRefs?: readonly string[]): boolean;

export interface GovernedPushCommand {
  readonly ref: string;
  readonly beforeOid: string;
  readonly afterOid: string;
  readonly creationService?: string;
  readonly mergeBaseOid?: string;
}

export interface GovernedPushAnchorWitness extends GovernanceRecord {
  readonly anchorOid: string;
}

export function validateGovernedPushEnvelope(input: Readonly<{
  commands: readonly GovernedPushCommand[];
  governedRefs?: readonly string[];
  providerProfile: 'github-push-v1' | 'atomic-push-envelope-v1' | string;
  anchorWitness?: GovernedPushAnchorWitness | null;
  verifyAnchorWitness?: ((witness: GovernedPushAnchorWitness, command: GovernedPushCommand) => boolean) | null;
  eventId?: string | null;
}>): readonly GovernedPushCommand[];

export interface GovernanceDeploymentIdentity {
  readonly schemaHash: string;
  readonly functionBundleHash: string;
  readonly generationInputsHash: string;
  readonly visibilityAuthorizationProgramDigest: string;
  readonly visibilityGovernanceActivationDigest: string;
}

export function deploymentIdentityFromGenerated(input: Readonly<{
  schemaManifest: Readonly<{ schemaHash: string }>;
  functionManifest: Readonly<{ bundleHash: string }>;
  governance: GovernanceRecord & Readonly<{
    generationInputsHash: string;
    visibilityAuthorizationProgramDigest: string;
  }>;
}>): GovernanceDeploymentIdentity;

export function deepMatchGovernedVerdict(
  verdict: GovernanceRecord | null | undefined,
  expected: GovernanceDeploymentIdentity & Readonly<{ backend?: string; appId?: string }>,
  source: Readonly<{ sourceOid: string; quarantineHeadDigest: string }>,
): true;
export function relativeGovernancePath(root: string, path: string): string;
