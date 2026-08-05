export type ResultTransformScalarV1 = null | boolean | number | string;
export type ResultTransformRowV1 = Readonly<Record<string, unknown>>;

export interface TransformPlanV1 {
  readonly format: 'snapback.result-transform.v1';
  readonly materializationKey: string;
  readonly overlay: 'none' | 'apply';
  readonly filterGrammar: 'basic-v1';
  readonly filter: readonly Readonly<{
    readonly field: string;
    readonly op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'in';
    readonly value: ResultTransformScalarV1 | readonly ResultTransformScalarV1[];
  }>[];
  readonly order: readonly Readonly<{
    readonly field: string;
    readonly direction: 'asc' | 'desc';
  }>[];
  readonly limit: number | null;
}

export interface ResultTransformBaseV1 {
  readonly shape: 'row-sequence';
  readonly mode: 'single-page' | 'complete-page-set';
  readonly pages: readonly Readonly<{
    readonly version: string;
    readonly terminal: boolean;
    readonly rows: readonly ResultTransformRowV1[];
  }>[];
}

export interface ResultTransformRequestV1 {
  readonly plan: TransformPlanV1;
  readonly executingMaterializationKey: string;
  readonly projectedFields: readonly string[];
  readonly base: ResultTransformBaseV1;
  readonly clientOverlayRows?: readonly ResultTransformRowV1[];
  readonly overlayLayers?: readonly ((
    rows: readonly ResultTransformRowV1[],
  ) => readonly ResultTransformRowV1[])[];
}

export interface ResultTransformAdmissionV1 {
  readonly retentionClass: string;
  readonly carrier: Readonly<{
    readonly implementation: string | null;
    readonly durable: boolean | null;
  }>;
}

export const RESULT_TRANSFORM_V1_FORMAT: 'snapback.result-transform.v1';
export const RESULT_TRANSFORM_V1_HASH_DOMAIN: 'snapback:result-transform:v1:';
export const RESULT_TRANSFORM_V1_JAVASCRIPT_EVALUATOR_ID:
  'snapback.result-transform.javascript.v1';
export const RESULT_TRANSFORM_V1_RUST_EVALUATOR_ID:
  'snapback.result-transform.rust.v1';
export const RESULT_TRANSFORM_V1_RETENTION_CLASS: 'result-transform-snapshot-v1';
export const RESULT_TRANSFORM_V1_SHIP_GATE: Readonly<{
  firedOn: '2026-08-04';
  corpus: 'snapback-data-tier.result-transform-v1';
  corpusCases: 56;
  corpusFormatVersion: 1;
  profileVersion: 1;
  transformHash: 'TransformHashV1';
  evaluatorIdentities: Readonly<{
    javascript: typeof RESULT_TRANSFORM_V1_JAVASCRIPT_EVALUATOR_ID;
    rust: typeof RESULT_TRANSFORM_V1_RUST_EVALUATOR_ID;
  }>;
  claimingCarrierContexts: readonly ['browser-indexeddb', 'file-node'];
}>;

export const RESULT_TRANSFORM_V1_REFUSAL_CODES: Readonly<Record<string, string>>;
export function resultTransformCarrierContextV1(
  carrier: ResultTransformAdmissionV1['carrier'] | null | undefined,
): 'browser-indexeddb' | 'file-node' | null;
export function validateTransformPlanV1(
  plan: TransformPlanV1,
  options: Readonly<{
    executingMaterializationKey: string;
    projectedFields: readonly string[];
  }>,
): TransformPlanV1;
export function assembleResultTransformBaseV1(
  base: ResultTransformBaseV1,
): readonly ResultTransformRowV1[];
export function materializeClientOverlayRowsV1(
  baseRows: readonly ResultTransformRowV1[],
  overlayLayers: readonly ((
    rows: readonly ResultTransformRowV1[],
  ) => readonly ResultTransformRowV1[])[],
): readonly ResultTransformRowV1[];
export function compareResultTransformScalarsV1(
  left: ResultTransformScalarV1,
  right: ResultTransformScalarV1,
): -1 | 0 | 1;
export function evaluateResultTransformReferenceV1(
  request: ResultTransformRequestV1,
): readonly ResultTransformRowV1[];
export function evaluateResultTransformWithClientLayersV1(
  request: ResultTransformRequestV1,
): readonly ResultTransformRowV1[];
export function evaluateAdmittedResultTransformV1(
  admission: ResultTransformAdmissionV1,
  request: ResultTransformRequestV1,
): readonly ResultTransformRowV1[];
export function transformHashV1(plan: TransformPlanV1): Promise<`sha256:${string}`>;
