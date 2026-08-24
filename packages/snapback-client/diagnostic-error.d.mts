export interface SnapbackDiagnosticLike {
  readonly code: string;
  readonly message?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly [member: string]: unknown;
}

export type SnapbackDiagnosticOperation = string;

export interface SnapbackDiagnosticErrorFacts {
  readonly message?: string;
  readonly operation?: string | null;
  readonly refKind?: string | null;
  readonly retryable?: boolean | null;
  readonly retryStrategy?: string | null;
  readonly effectCommitted?: boolean | null;
  readonly effectMayHaveCommitted?: boolean | null;
  readonly cause?: unknown;
  readonly status?: number;
}

/** Caller-visible projection of one host-admitted application refusal. */
export type SnapbackAppRefusal =
  | Readonly<{
    readonly code: 'SNAPBACK_APP_REFUSAL';
    readonly appCode: string;
    readonly appDetails: unknown;
    readonly detailsDropped: false;
  }>
  | Readonly<{
    readonly code: 'SNAPBACK_APP_REFUSAL';
    readonly appCode: string;
    readonly appDetails: null;
    readonly detailsDropped: true;
  }>;

export class SnapbackDiagnosticError extends Error {
  constructor(diagnostic: SnapbackDiagnosticLike, facts?: SnapbackDiagnosticErrorFacts);
  readonly name: 'SnapbackDiagnosticError';
  readonly code: string;
  readonly diagnostic: SnapbackDiagnosticLike;
  readonly operation: string | null;
  readonly refKind: string | null;
  readonly retryable: boolean | null;
  readonly retryStrategy: string | null;
  readonly effectCommitted: boolean | null;
  readonly effectMayHaveCommitted: boolean | null;
  readonly status?: number;
  readonly receipt?: unknown;
  readonly attribution?: unknown;
  readonly authorityDisposition?: unknown;
  readonly clientMutationId?: string;
  readonly reason?: string;
  readonly outcome?: string;
}

export function isSnapbackDiagnosticError(value: unknown): value is SnapbackDiagnosticError;
export function projectAppRefusal(error: unknown): SnapbackAppRefusal | null;
export function asSnapbackDiagnosticError(
  error: unknown,
  facts?: SnapbackDiagnosticErrorFacts & { readonly fallbackCode?: string },
): SnapbackDiagnosticError;
export function snapbackDiagnosticError(
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
  facts?: SnapbackDiagnosticErrorFacts,
): SnapbackDiagnosticError;
