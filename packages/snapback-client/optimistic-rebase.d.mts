import type {
  BrowserIrAdmissionClass,
  BrowserIrLocalOutcomeV1,
  BrowserIrPrivateLayerV1,
  BrowserIrRow,
} from './ir-evaluator.mjs';
import type {
  LocalReadAdmissionOutcomeV1,
  LocalReadAnswerV1,
  LocalReadOperationV1,
} from './local-read-admission.mjs';

export const OPTIMISTIC_REBASE_SNAPSHOT_FORMAT_V1:
  'snapback.optimistic-rebase-snapshot.v1';
export const OPTIMISTIC_REBASE_OUTCOME_FORMAT_V1:
  'snapback.optimistic-rebase-outcome.v1';
export const OPTIMISTIC_REBASE_OUTCOME_CAP: 64;

export interface OptimisticReplayEntryV1 {
  readonly clientMutationId: string;
  readonly layerId: string;
  readonly sequence: number;
  readonly outboxStatus: 'pending' | 'settled';
  readonly layerStatus: 'pending' | 'bridging' | null;
  readonly disposition: 'layered' | 'queued-only';
  readonly classification: BrowserIrAdmissionClass;
  readonly code: string;
  readonly predictionChanged: boolean;
  readonly admission: LocalReadAdmissionOutcomeV1;
  readonly prediction: BrowserIrLocalOutcomeV1 | null;
}

export interface OptimisticLayerEntryV1 extends OptimisticReplayEntryV1 {
  readonly disposition: 'layered';
  readonly layer: BrowserIrPrivateLayerV1;
}

export interface OptimisticRebaseOutcomeV1 {
  readonly format: typeof OPTIMISTIC_REBASE_OUTCOME_FORMAT_V1;
  readonly revision: number;
  readonly cause: string;
  readonly retiredIdentities: readonly Readonly<{
    readonly settlementIdentity: string;
    readonly sequence: number;
    readonly reason: 'authoritative-delivery' | 'failed';
  }>[];
  readonly replayedOperations: readonly OptimisticReplayEntryV1[];
  readonly changedPredictions: readonly OptimisticReplayEntryV1[];
  readonly refusals: readonly OptimisticReplayEntryV1[];
  readonly degradations: readonly OptimisticReplayEntryV1[];
}

export interface OptimisticRebaseSnapshotV1 {
  readonly format: typeof OPTIMISTIC_REBASE_SNAPSHOT_FORMAT_V1;
  readonly revision: number;
  readonly authoritativeRows: Readonly<Record<string, readonly BrowserIrRow[]>>;
  readonly visibleRows: Readonly<Record<string, readonly BrowserIrRow[]>>;
  readonly layers: readonly OptimisticLayerEntryV1[];
  readonly queuedOnly: readonly OptimisticReplayEntryV1[];
  readonly lastRebase: OptimisticRebaseOutcomeV1 | null;
}

export interface OptimisticRebaseInputV1 {
  readonly authoritativeRows?: Readonly<Record<string, readonly BrowserIrRow[]>>;
  readonly retiredSettlementIdentities?: readonly string[];
  readonly cause?: string;
}

export interface OptimisticRebaseEngineV1 {
  rebase(input?: OptimisticRebaseInputV1): Promise<OptimisticRebaseOutcomeV1>;
  reload(input?: OptimisticRebaseInputV1): Promise<OptimisticRebaseOutcomeV1>;
  refresh(input?: OptimisticRebaseInputV1): Promise<OptimisticRebaseOutcomeV1>;
  getSnapshot(): OptimisticRebaseSnapshotV1;
  inspection(): Readonly<{
    revision: number;
    layerCount: number;
    queuedOnlyCount: number;
    reflectedSettlementIdentities: readonly string[];
    rebaseOutcomes: readonly OptimisticRebaseOutcomeV1[];
    closed: boolean;
  }>;
  subscribe(listener: () => void): () => void;
  close(): void;
}

export function applyPrivateOptimisticLayerV1(
  baseRows: Readonly<Record<string, readonly BrowserIrRow[]>>,
  layer: BrowserIrPrivateLayerV1,
): Readonly<Record<string, readonly BrowserIrRow[]>>;

export function applyPrivateOptimisticLayersV1(
  baseRows: Readonly<Record<string, readonly BrowserIrRow[]>>,
  layers: readonly BrowserIrPrivateLayerV1[],
): Readonly<Record<string, readonly BrowserIrRow[]>>;

export function createOptimisticRebaseEngineV1(input: Readonly<{
  outboxStore: Readonly<{
    outboxRecords(): Promise<readonly Readonly<{
      id: string;
      sequence: number;
      status: 'pending' | 'settled' | 'failed';
      settlementLane: 'replay-accept' | 're-derive';
      args: unknown;
      ctxLedger: unknown;
      optimisticOperation?: LocalReadOperationV1 | null;
    }>[]>;
  }>;
  registrationLedger: Readonly<{
    demandedMaterializations(): readonly unknown[];
  }>;
  readMaterializationAnswer(input: Readonly<{
    address: readonly string[];
    materializationKey: string;
  }>): LocalReadAnswerV1 | Promise<LocalReadAnswerV1>;
  initialAuthoritativeRows?: Readonly<Record<string, readonly BrowserIrRow[]>>;
}>): OptimisticRebaseEngineV1;
