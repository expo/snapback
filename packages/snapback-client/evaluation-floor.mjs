// The pre-admission floor for local evaluation. This module intentionally
// contains no TransformPlanV1 parser, evaluator, pipeline, or plan corpus.
// Registration here turns LLP 0166's placeholder spelling into a shipped
// client diagnostic while keeping every plan on opaque-snapshot semantics.

// @ref LLP 0166#current-law-restated — retained fragments remain owner-shaped
// opaque snapshots and every local-evaluation request refuses until admitted.
export const SNAPBACK_LOCAL_EVALUATION_UNADMITTED =
  'SNAPBACK_LOCAL_EVALUATION_UNADMITTED';

export const SNAPBACK_LOCAL_EVALUATION_DIAGNOSTICS = Object.freeze({
  [SNAPBACK_LOCAL_EVALUATION_UNADMITTED]: Object.freeze({
    code: SNAPBACK_LOCAL_EVALUATION_UNADMITTED,
    severity: 'error',
    subsystem: 'client-store',
    message: 'local evaluation over retained fragments is not admitted',
  }),
});

export function localEvaluationUnadmittedError() {
  const registered = SNAPBACK_LOCAL_EVALUATION_DIAGNOSTICS[
    SNAPBACK_LOCAL_EVALUATION_UNADMITTED
  ];
  const diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    ...registered,
    details: Object.freeze({
      fallback: 'opaque-snapshot',
      evaluationProfile: 'unadmitted',
    }),
  });
  const error = new Error(`${diagnostic.code}: ${diagnostic.message}`);
  error.code = diagnostic.code;
  error.diagnostic = diagnostic;
  return error;
}

// Deliberately do not inspect the request. Unknown/future transform shapes,
// forged admission facts, and source-row evaluation requests all hit the same
// closed floor before any evaluation path can run.
export function refuseLocalEvaluation(_request) {
  throw localEvaluationUnadmittedError();
}
