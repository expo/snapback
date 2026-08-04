export type BrowserIrAdmissionClass =
  | 'ready'
  | 'predictable-with-partial-input'
  | 'server-only'
  | 'refused';

export const BROWSER_IR_ADMISSION_CLASSES: readonly [
  'ready',
  'predictable-with-partial-input',
  'server-only',
  'refused',
];
export const BROWSER_IR_LOCAL_EFFECT_CLASS:
  'snapback.browser-ir.insert-get-guard-patch.v1';
export const BROWSER_IR_CTX_CLAIM_LABEL: 'labeled-client-claim';

export interface BrowserIrCtxLedgerV1 {
  readonly version: 1;
  readonly ids: readonly string[];
  readonly now: number;
}

export type BrowserIrRow = Readonly<Record<string, unknown>>;

export interface BrowserIrSchemaV1 {
  readonly tables: readonly Readonly<{
    readonly name: string;
    readonly fields?: readonly Readonly<{ readonly name: string }>[];
  }>[];
}

export interface BrowserIrExecutionInputV1 {
  readonly name: string;
  readonly schema: BrowserIrSchemaV1;
  readonly initialRows?: Readonly<Record<string, readonly BrowserIrRow[]>>;
  readonly plan: Readonly<Record<string, unknown>>;
  readonly args?: unknown;
  readonly ctxLedger: BrowserIrCtxLedgerV1;
  readonly authUserId?: string | null;
}

export interface BrowserIrExecutionOutcomeV1 {
  readonly name: string;
  readonly status: 'committed' | 'rejected';
  readonly result: unknown;
  readonly changedCount: number | null;
  readonly inputCtxLedger: BrowserIrCtxLedgerV1 | null;
  readonly outputCtxLedger: BrowserIrCtxLedgerV1 | null;
  readonly rejectionCode: string | null;
  readonly rows: Readonly<Record<string, readonly BrowserIrRow[]>>;
}

export interface BrowserIrClassificationV1 {
  readonly classification: BrowserIrAdmissionClass;
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface BrowserIrLocalInputV1 extends BrowserIrExecutionInputV1 {
  readonly layerId: string;
  readonly declaredEffectClass?: typeof BROWSER_IR_LOCAL_EFFECT_CLASS;
  readonly readAdmission?: BrowserIrAdmissionClass;
}

export interface BrowserIrLedgerClaimV1 {
  readonly label: typeof BROWSER_IR_CTX_CLAIM_LABEL;
  readonly authority: 'never-authority';
  readonly inputCtxLedger: BrowserIrCtxLedgerV1 | null;
  readonly outputCtxLedger: BrowserIrCtxLedgerV1 | null;
}

export interface BrowserIrPrivateLayerV1 {
  readonly format: 'snapback.private-optimistic-layer.v1';
  readonly visibility: 'private';
  readonly layerId: string;
  readonly operationName: string;
  readonly writes: readonly Readonly<Record<string, unknown>>[];
  readonly declaredTableRows: Readonly<Record<string, readonly BrowserIrRow[]>>;
}

export interface BrowserIrLocalOutcomeV1 extends BrowserIrClassificationV1 {
  readonly execution: BrowserIrExecutionOutcomeV1 | null;
  readonly ledgerClaim: BrowserIrLedgerClaimV1 | null;
  readonly layer: BrowserIrPrivateLayerV1 | null;
}

export function evaluateBrowserIrPlanV1(
  input: BrowserIrExecutionInputV1,
): BrowserIrExecutionOutcomeV1;
export function classifyLocalMutationIrV1(
  input: Pick<BrowserIrLocalInputV1, 'plan' | 'declaredEffectClass' | 'readAdmission'>,
): BrowserIrClassificationV1;
export function evaluateLocalMutationIrV1(
  input: BrowserIrLocalInputV1,
): BrowserIrLocalOutcomeV1;
