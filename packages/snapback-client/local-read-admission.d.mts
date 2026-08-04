import type {
  BrowserIrAdmissionClass,
  BrowserIrLocalInputV1,
  BrowserIrLocalOutcomeV1,
  BrowserIrRow,
} from './ir-evaluator.mjs';

export const LOCAL_READ_COVERAGE_FORMAT_V1:
  'snapback.local-read-materialization-coverage.v1';
export const LOCAL_READ_ADMISSION_FORMAT_V1: 'snapback.local-read-admission.v1';
export const LOCAL_MUTATION_PREDICTION_FORMAT_V1:
  'snapback.local-mutation-prediction.v1';

export interface LocalReadMaterializationCoverageV1 {
  readonly format: typeof LOCAL_READ_COVERAGE_FORMAT_V1;
  readonly materializationKey: string;
  readonly planHash: `sha256:${string}`;
  readonly resultContractHash: `sha256:${string}`;
  readonly table: string;
  readonly projectedFields: readonly string[];
  readonly absence: 'table-complete' | 'unproven';
}

export interface LocalPointReadRequirementV1 {
  readonly kind: 'point';
  readonly table: string;
  readonly idArg: string;
  readonly binding: string | null;
  readonly requiredFields: readonly string[];
}

export interface LocalReadOperationV1 extends BrowserIrLocalInputV1 {
  readonly declaredReads: readonly string[];
  readonly localReadRequirements: readonly LocalPointReadRequirementV1[];
}

export interface LocalReadMaterializationIdentityV1 {
  readonly materializationKey: string;
  readonly queryInstanceId: number;
  readonly planHash: `sha256:${string}`;
  readonly resultContractHash: string | null;
  readonly authorityPartitionDigest: `sha256:${string}`;
}

export interface LiveLocalReadMaterializationIdentityV1 {
  readonly materializationKey: string;
  readonly queryInstanceId: number | null;
  readonly planHash: `sha256:${string}`;
  readonly resultContractHash: string | null;
  readonly authorityPartitionDigest: `sha256:${string}`;
}

export interface LocalReadAnswerV1 {
  readonly answerClass:
    | 'authoritative'
    | 'lease-authorized-retained'
    | 'labeled-retained'
    | 'unknown'
    | 'refused';
  readonly freshness: 'current' | 'retained' | null;
  readonly value: Uint8Array | readonly Uint8Array[] | null;
  readonly materialization: LocalReadMaterializationIdentityV1 | null;
}

export interface DemandedMaterializationV1 {
  readonly family: 'qmk1' | 'legacy-resume';
  readonly address: readonly string[] | null;
  readonly addressKey: string;
  readonly demandState: 'demanded-active' | 'demanded-idle';
  readonly effectiveScope: unknown;
  readonly registrations: readonly Readonly<{
    readonly registration: Readonly<{
      readonly registrationId: string;
      readonly functionReference: Readonly<Record<string, unknown>>;
    }>;
    readonly resolution: Readonly<Record<string, unknown>>;
    readonly liveAnswer?: Readonly<{
      readonly answerClass: 'authoritative';
      readonly freshness: 'current';
      readonly rows: readonly BrowserIrRow[];
      readonly version: number;
      readonly subscriptionId: string;
      readonly materialization: LiveLocalReadMaterializationIdentityV1;
    }> | null;
  }>[];
}

export interface LocalReadAdmissionSourceV1 {
  readonly sourceClass: 'live-registration' | 'durable-store';
  readonly address: readonly string[];
  readonly materializationKey: string;
  readonly answerClass: LocalReadAnswerV1['answerClass'];
  readonly freshness: LocalReadAnswerV1['freshness'];
  readonly coverage: LocalReadMaterializationCoverageV1;
  readonly queryInstanceId: number | null;
  readonly authorityPartitionDigest: string | null;
  readonly registrationId: string | null;
  readonly subscriptionId: string | null;
  readonly version: number | null;
  readonly code: string | null;
}

export interface LocalReadAdmissionPointV1 {
  readonly id: string;
  readonly state: 'present' | 'absent' | 'missing';
  readonly sourceMaterializationKeys: readonly string[];
  readonly sourceClasses: readonly ('live-registration' | 'durable-store')[];
}

export interface LocalReadAdmissionTableV1 {
  readonly table: string;
  readonly state: 'admitted' | 'missing';
  readonly rows: readonly BrowserIrRow[] | null;
  readonly points: readonly LocalReadAdmissionPointV1[];
  readonly sources: readonly Readonly<LocalReadAdmissionSourceV1>[];
  readonly admittedSourceClasses: readonly ('live-registration' | 'durable-store')[];
  readonly code: string;
}

export interface LocalReadAdmissionOutcomeV1 {
  readonly format: typeof LOCAL_READ_ADMISSION_FORMAT_V1;
  readonly classification: BrowserIrAdmissionClass;
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly declaredReads: readonly string[];
  readonly reads: readonly LocalReadAdmissionTableV1[];
  readonly failures: readonly Readonly<Record<string, unknown>>[];
  readonly admittedRows: Readonly<Record<string, readonly BrowserIrRow[]>> | null;
}

export interface LocalReadAdmissionInputV1 {
  readonly operation: LocalReadOperationV1;
  readonly registrationLedger: Readonly<{
    demandedMaterializations(): readonly DemandedMaterializationV1[];
  }>;
  readonly readMaterializationAnswer: (input: Readonly<{
    address: readonly string[];
    materializationKey: string;
  }>) => LocalReadAnswerV1 | Promise<LocalReadAnswerV1>;
}

export interface LocalMutationPredictionV1 {
  readonly format: typeof LOCAL_MUTATION_PREDICTION_FORMAT_V1;
  readonly admission: LocalReadAdmissionOutcomeV1;
  readonly prediction: BrowserIrLocalOutcomeV1;
}

export function deriveGeneratedLocalReadCoverageV1(input: Readonly<{
  ref: Readonly<Record<string, unknown>>;
  materializationKey: string;
}>): LocalReadMaterializationCoverageV1 | null;
export function prepareLocalReadCoverageV1(
  value: unknown,
): LocalReadMaterializationCoverageV1 | null;
export function admitLocalMutationReadsV1(
  input: LocalReadAdmissionInputV1,
): Promise<LocalReadAdmissionOutcomeV1>;
export function evaluateLocalMutationWithReadAdmissionV1(
  input: LocalReadAdmissionInputV1,
): Promise<LocalMutationPredictionV1>;
