import type { SnapbackDiagnosticCode } from './diagnostic-codes.d.mts';

export interface SnapbackDiagnosticOccurrence {
  readonly firstAtMs: number;
  readonly lastAtMs: number;
  readonly count: number;
}

export interface SnapbackDiagnosticEventV2 {
  readonly schemaVersion: 'snapback.client-diagnostic.v2';
  readonly code: SnapbackDiagnosticCode;
  readonly severity: 'error' | 'warning';
  readonly subsystem: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly occurrence: SnapbackDiagnosticOccurrence;
  readonly site?: string;
}

export type SnapbackDiagnosticEventInput = Readonly<{
  readonly schemaVersion?: 'snapback.client-diagnostic.v2';
  readonly code: SnapbackDiagnosticCode;
  readonly severity: 'error' | 'warning';
  readonly subsystem: string;
  readonly message: string;
  readonly details?: unknown;
  readonly site?: string;
}>;

export interface SnapbackDiagnosticV1Projection {
  readonly schemaVersion: 'snapback.client-diagnostic.v1';
  readonly code: SnapbackDiagnosticCode;
  readonly severity: 'error';
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface SnapbackClientDiagnosticsSnapshot {
  readonly events: readonly SnapbackDiagnosticEventV2[];
  readonly activeConditions: Readonly<Record<string, SnapbackDiagnosticEventV2>>;
  readonly counters: Readonly<{
    readonly emitted: number;
    readonly coalesced: number;
    readonly dropped: number;
  }>;
}

export interface SnapbackClientDiagnosticsChannel {
  emit(event: SnapbackDiagnosticEventInput): SnapbackDiagnosticEventV2 | null;
  subscribe(listener: (event: SnapbackDiagnosticEventV2 | null) => void): () => void;
  snapshot(): SnapbackClientDiagnosticsSnapshot;
  setActiveCondition(
    key: string,
    event: SnapbackDiagnosticEventInput,
  ): SnapbackDiagnosticEventV2 | null;
  clearActiveCondition(key: string): boolean;
  /** Re-arm the channel's one deadline handle, or cancel it with `null`. */
  scheduleDeadline(atMs: number | null, fn?: (() => void) | null): void;
  dispose(): void;
}

export interface SnapbackClientDiagnosticsOptions<
  DeadlineHandle = ReturnType<typeof globalThis.setTimeout>,
> {
  readonly historyLimit?: number;
  readonly activeConditionLimit?: number;
  readonly cooldownMs?: number;
  readonly cooldownFor?: ((code: SnapbackDiagnosticCode, site?: string) => number) | null;
  readonly now?: () => number;
  readonly setTimeout?: (fn: () => void, delayMs: number) => DeadlineHandle;
  readonly clearTimeout?: (handle: DeadlineHandle) => void;
}

export function createClientDiagnosticsChannel<
  DeadlineHandle = ReturnType<typeof globalThis.setTimeout>,
>(
  options?: SnapbackClientDiagnosticsOptions<DeadlineHandle>,
): SnapbackClientDiagnosticsChannel;

export function projectDiagnosticV1(
  event: SnapbackDiagnosticEventV2 | null | undefined,
): SnapbackDiagnosticV1Projection | null;

export const DEFAULT_QUEUED_MUTATION_WEDGE_WARNING_MS: 30000;

/** True only when the host affirmatively identifies a development build. */
export function positiveDevelopmentEnvironment(): boolean;

export interface SnapbackDevDiagnosticsConsole {
  warn(message: string): void;
  error(message: string): void;
}

export interface SnapbackClientDiagnosticsDisposable {
  dispose(): void;
}

export function createClientDevConsoleReporter(
  channel: SnapbackClientDiagnosticsChannel,
  options?: Readonly<{ readonly console?: SnapbackDevDiagnosticsConsole }>,
): SnapbackClientDiagnosticsDisposable;

export interface SnapbackOutboxDiagnosticHeadFact {
  readonly head: null | Readonly<{
    readonly clientMutationId: string;
    readonly sequence: number;
    readonly status: string;
    readonly function: string;
    readonly enqueuedAtMs?: number;
    readonly transportProvenance?: unknown;
  }>;
  readonly pending: number;
  readonly oldestPendingAtMs: number | null;
  readonly blockedReason: 'not-writer' | 'custody-unsettled' | null;
  readonly drainPhase: 'idle' | 'replaying';
  readonly nextRetryAtMs: null;
}

export function attachOutboxDiagnosticsProducer(input: Readonly<{
  readonly channel: SnapbackClientDiagnosticsChannel;
  readonly subscribeOutbox: (listener: () => void) => () => void;
  readonly readHeadFact: () => Promise<SnapbackOutboxDiagnosticHeadFact | null>;
  readonly queuedMutationWedgeWarningMs?: number;
  readonly now?: () => number;
}>): SnapbackClientDiagnosticsDisposable;
