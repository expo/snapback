import type { RqsResumeStore } from './rqs-store.mjs';

export type DigestV1 = `sha256:${string}`;
export type QueryMaterializationKeyV1 = `qmk1.${string}`;
export type ClientMaterializationAddressV1 = readonly [
  'snapback:client-materialization-address:v1', string, QueryMaterializationKeyV1,
];

export interface MaterializationFenceV1 {
  readonly queryInstanceId: number;
  readonly authorityGeneration: number;
  readonly queryGeneration: number;
}

export type RequestedCompletenessScopeV1 =
  | Readonly<{ kind: 'page'; input: Readonly<Record<string, unknown>> }>
  | Readonly<{ kind: 'page-set'; from: 'first'; through: 'terminal' }>;

export interface CompletenessProofV1 extends Readonly<Record<string, unknown>> {
  readonly format: 'snapback.completeness-proof.v1';
  readonly materializationKey: QueryMaterializationKeyV1;
  readonly queryInstanceId: number;
  readonly activationHash: DigestV1;
  readonly planHash: DigestV1;
  readonly resultDigest: DigestV1;
  readonly signature: string;
}

export interface PageSetManifestV1 {
  readonly identity: DigestV1;
  readonly orderedProofDigests: readonly DigestV1[];
}

export interface MaterializationRecordV1 extends Readonly<Record<string, unknown>> {
  readonly format: 'snapback.materialization-record.v1';
  readonly address: ClientMaterializationAddressV1;
  readonly queryInstanceId: number;
  readonly planHash: DigestV1;
  readonly activationHash: DigestV1;
  readonly argsDigest: DigestV1;
  readonly authorityPartitionDigest: DigestV1;
  readonly storageProfile: 'volatile-online-v1' | 'durable-fragments-v1';
  readonly productState: Readonly<Record<string, unknown>>;
  readonly authorityState: Readonly<Record<string, unknown>>;
  readonly fragments: readonly Readonly<Record<string, unknown>>[];
  readonly pageSets: readonly PageSetManifestV1[];
  readonly memberships: readonly Readonly<Record<string, unknown>>[];
}

export interface MaterializationObservationV1 {
  readonly format: 'snapback.materialization-observation.v1';
  readonly present: boolean;
  readonly generation: MaterializationFenceV1 | null;
  readonly status: 'unknown' | 'complete' | 'refused' | null;
  readonly materialization: Readonly<{
    readonly materializationKey: QueryMaterializationKeyV1;
    readonly queryInstanceId: number;
    readonly planHash: DigestV1;
    readonly activationHash: DigestV1;
    readonly resultContractHash: string | null;
    readonly authorityPartitionDigest: DigestV1;
  }> | null;
}

export interface MaterializationStoreV1 {
  initialize(address: ClientMaterializationAddressV1, identities: Readonly<Record<string, unknown>>, authorityBarrierReceipt?: Readonly<Record<string, unknown>> | null): Promise<MaterializationRecordV1>;
  beginEstablishment(address: ClientMaterializationAddressV1, requestedScope: RequestedCompletenessScopeV1, expectedFence: MaterializationFenceV1): Promise<MaterializationRecordV1>;
  commitPage(address: ClientMaterializationAddressV1, fragment: Readonly<Record<string, unknown>>, proof: CompletenessProofV1, resolutionBundle: Readonly<Record<string, unknown>> | null, expectedFence: MaterializationFenceV1): Promise<MaterializationRecordV1>;
  commitLegacyAdoption(address: ClientMaterializationAddressV1, legacyKey: string, expectedLegacyRecord: Readonly<Record<string, unknown>>, fragment: Readonly<Record<string, unknown>>, proof: CompletenessProofV1, resolutionBundle: Readonly<Record<string, unknown>> | null, expectedFence: MaterializationFenceV1): Promise<MaterializationRecordV1>;
  commitPageSet(address: ClientMaterializationAddressV1, set: PageSetManifestV1, expectedFence: MaterializationFenceV1): Promise<MaterializationRecordV1>;
  recordAttemptOutcome(address: ClientMaterializationAddressV1, outcome: Readonly<Record<string, unknown>>, expectedFence: MaterializationFenceV1): Promise<MaterializationRecordV1>;
  applyAuthorizationTransition(address: ClientMaterializationAddressV1, ownerTransition: Readonly<Record<string, unknown>>): Promise<MaterializationRecordV1>;
  applyStoreAuthorityBarrier(clientStoreId: string, predecessor: DigestV1, successor: DigestV1, transition: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>;
  readRenderable(address: ClientMaterializationAddressV1, expectedFence: MaterializationFenceV1): Promise<Uint8Array | readonly Uint8Array[] | null>;
  /** Exact owner-produced fragment bytes; no local transform is applied. */
  readOpaqueSnapshot(address: ClientMaterializationAddressV1, expectedFence: MaterializationFenceV1): Promise<Uint8Array | readonly Uint8Array[] | null>;
  /** Pre-admission floor: always rejects with SNAPBACK_LOCAL_EVALUATION_UNADMITTED. */
  evaluateLocal(address: ClientMaterializationAddressV1, request?: unknown): Promise<never>;
  observeMaterialization(address: ClientMaterializationAddressV1, listener: (snapshot: MaterializationObservationV1) => void): () => void;
  retire(address: ClientMaterializationAddressV1): Promise<boolean>;
  compactPayload(address: ClientMaterializationAddressV1, expectedFence: MaterializationFenceV1): Promise<MaterializationRecordV1>;
}

export function materializationAddressKey(address: ClientMaterializationAddressV1): string;
export function prepareCompletenessProofV1(value: unknown): CompletenessProofV1 | null;
export function preparePageSetManifestV1(value: unknown): PageSetManifestV1 | null;
export function prepareMaterializationRecordV1(value: unknown): MaterializationRecordV1 | null;
export function encodeMaterializationRecordV1(value: MaterializationRecordV1): unknown;
export function decodeMaterializationRecordV1(value: unknown): MaterializationRecordV1 | null;
export function completenessProofDigestV1(proof: CompletenessProofV1): DigestV1;
export function pageIdentityDigestV1(page: Readonly<Record<string, unknown>>): DigestV1;
export function resultDigestV1(bytes: Uint8Array): DigestV1;
export function deriveCompletenessStatusV1(record: MaterializationRecordV1): 'unknown' | 'complete' | 'refused';

export function createMaterializationStore(storeHandle: RqsResumeStore, options?: Readonly<{
  resolveValidationContext?: ((input: Readonly<Record<string, unknown>>) => unknown) | null;
  resolveRetirementTransition?: ((input: Readonly<Record<string, unknown>>) => unknown) | null;
}>): Promise<MaterializationStoreV1>;
