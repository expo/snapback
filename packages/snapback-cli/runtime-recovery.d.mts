// Hand-authored declarations for runtime-recovery.mjs — runtime binary
// selection, identity, and handler-VM qualification records.

export const RUNTIME_RECOVERY_SCHEMA_VERSION: 'snapback.runtime-recovery.v1';
export const IBEX_CARGO_NOT_FOUND_CODE: 'SNAPBACK_IBEX_CARGO_NOT_FOUND';

/** Independent build-identity stamp reported by (or read for) a runtime. */
export interface RuntimeStamp {
  gitCommit: string | null;
  gitDirty: boolean | null;
  crateVersion: string | null;
  buildProfile: string | null;
}

export interface RuntimeRecoveryRecord {
  schemaVersion: 'snapback.runtime-recovery.v1';
  selectedBinary: string | null;
  selectionRung: string;
  expected: RuntimeStamp | null;
  actualStamp: RuntimeStamp | null;
  currentCheckout: {
    buildable: boolean | null;
    runnable: boolean | null;
  };
  qualification: unknown;
  reuse: {
    allowed: boolean;
    reason: string | null;
  };
  diagnostic: unknown;
  producerInputs: unknown;
  recovery: {
    repairCommand: string | null;
    overrideCommand: string | null;
  };
}

export function createRuntimeRecoveryRecord(options?: {
  readonly selectedBinary?: string | null;
  readonly selectionRung?: string;
  readonly expected?: Readonly<Partial<RuntimeStamp>> | null;
  readonly actualStamp?: Readonly<Partial<RuntimeStamp>> | null;
  readonly buildable?: boolean | null;
  readonly runnable?: boolean | null;
  readonly qualification?: unknown;
  readonly reuseAllowed?: boolean;
  readonly reuseReason?: string | null;
  readonly diagnostic?: unknown;
  readonly producerInputs?: unknown;
  readonly repairCommand?: string | null;
  readonly overrideCommand?: string | null;
}): RuntimeRecoveryRecord;

/** Read the git/Cargo runtime identity facts of a source checkout root. */
export function readCheckoutRuntimeIdentity(root: string): RuntimeStamp;

export interface RuntimeQualificationResult {
  ok: boolean;
  /** Parsed `runtime-qualify` JSON verdict, or null when unavailable. */
  report: unknown;
  reason: string | null;
  stderr?: string;
}

/**
 * Ask the binary itself to create and destroy the same restricted handler VM
 * every JS handler uses, with dynamic-loader overrides scrubbed.
 */
export function qualifyRuntimeBinary(
  binary: string | null | undefined,
  environment?: Readonly<Record<string, string | undefined>>,
): RuntimeQualificationResult;

export interface RuntimeBinaryInspection {
  runnable: boolean;
  stamp: RuntimeStamp | null;
  reason: string | null;
}

/** Launch the binary (`build-identity`, falling back to `--help`) and report
 * whether it runs and which build stamp it carries. */
export function inspectRuntimeBinary(
  binary: string | null | undefined,
  environment?: Readonly<Record<string, string | undefined>>,
): RuntimeBinaryInspection;
