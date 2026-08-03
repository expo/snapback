export const SNAPBACK_LOCAL_EVALUATION_UNADMITTED: 'SNAPBACK_LOCAL_EVALUATION_UNADMITTED';

export interface LocalEvaluationDiagnosticRegistration {
  readonly code: typeof SNAPBACK_LOCAL_EVALUATION_UNADMITTED;
  readonly severity: 'error';
  readonly subsystem: 'client-store';
  readonly message: string;
}

export const SNAPBACK_LOCAL_EVALUATION_DIAGNOSTICS: Readonly<Record<
  typeof SNAPBACK_LOCAL_EVALUATION_UNADMITTED,
  LocalEvaluationDiagnosticRegistration
>>;

export interface LocalEvaluationUnadmittedError extends Error {
  readonly code: typeof SNAPBACK_LOCAL_EVALUATION_UNADMITTED;
  readonly diagnostic: Readonly<{
    schemaVersion: 'snapback.client-diagnostic.v1';
    code: typeof SNAPBACK_LOCAL_EVALUATION_UNADMITTED;
    severity: 'error';
    subsystem: 'client-store';
    message: string;
    details: Readonly<{
      fallback: 'opaque-snapshot';
      evaluationProfile: 'unadmitted';
    }>;
  }>;
}

export function localEvaluationUnadmittedError(): LocalEvaluationUnadmittedError;
export function refuseLocalEvaluation(request?: unknown): never;
