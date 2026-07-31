export type SnapbackProviderDiagnosticSeverity = 'error' | 'warning' | 'info';
export type SnapbackProviderDiagnosticOwner =
  | 'contract'
  | 'provider'
  | 'vite'
  | 'schema'
  | 'handler'
  | 'generated';

export interface SnapbackProviderDiagnosticSource {
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly generatedFrom?: string;
}

export interface SnapbackProviderDiagnostic {
  readonly code: string;
  readonly severity: SnapbackProviderDiagnosticSeverity;
  readonly subsystem: 'contract-integration';
  readonly message: string;
  readonly provider: string;
  readonly owner: SnapbackProviderDiagnosticOwner;
  readonly source?: SnapbackProviderDiagnosticSource;
  readonly queryName?: string;
  readonly mutationName?: string;
  readonly table?: string;
  readonly suggestedFix?: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface SnapbackProviderDiagnosticOptions {
  severity?: SnapbackProviderDiagnosticSeverity;
  provider?: string;
  owner?: SnapbackProviderDiagnosticOwner;
  source?: SnapbackProviderDiagnosticSource | undefined;
  queryName?: string | undefined;
  mutationName?: string | undefined;
  table?: string | undefined;
  suggestedFix?: string | undefined;
  targetSurface?: string;
  details?: Readonly<Record<string, unknown>>;
}

export interface SnapbackProviderDiagnosticError extends Error {
  code: string;
  diagnostic: SnapbackProviderDiagnostic;
  source?: SnapbackProviderDiagnosticSource;
}

/** One collapsed report per (root, instance, cause); `occurrences` increments on repeats. */
export interface SnapbackProviderDiagnosticReport extends SnapbackProviderDiagnostic {
  occurrences: number;
  readonly diagnosticInstanceId: string;
  readonly diagnosticCauseCode: string;
  readonly diagnosticDedupeKey: string;
}

export interface SnapbackProviderDiagnosticCollector {
  record(
    value: unknown,
    identity?: Readonly<{ instanceId?: string; causeCode?: string }>,
  ): SnapbackProviderDiagnosticReport | null;
  diagnostics(): SnapbackProviderDiagnosticReport[];
  reset(): void;
}

export function createSnapbackProviderDiagnostic(
  code: string,
  message: string,
  options?: SnapbackProviderDiagnosticOptions,
): SnapbackProviderDiagnostic;

export function createSnapbackProviderDiagnosticError(
  code: string,
  message: string,
  options?: SnapbackProviderDiagnosticOptions,
): SnapbackProviderDiagnosticError;

export function createSnapbackProviderDiagnosticCollector(
  options?: Readonly<{ rootId?: string }>,
): SnapbackProviderDiagnosticCollector;
