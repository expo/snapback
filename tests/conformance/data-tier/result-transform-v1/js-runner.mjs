// JavaScript consumer for the LLP 0051 D5 result-transform extension.

import { canonicalizeClientValueV1 } from '../../../../packages/snapback-client/canonical-client-value.mjs';
import {
  RESULT_TRANSFORM_V1_JAVASCRIPT_EVALUATOR_ID,
  evaluateResultTransformReferenceV1,
  transformHashV1,
} from '../../../../packages/snapback-client/result-transform.mjs';

export async function runResultTransformCaseInJs(testCase) {
  let transformHash = null;
  try {
    transformHash = await transformHashV1(testCase.plan);
  } catch {
    // Structurally invalid plans have no TransformHashV1 identity. Their
    // exact typed evaluation refusal is still checked below.
  }

  let outcome;
  try {
    const rows = evaluateResultTransformReferenceV1({
      plan: testCase.plan,
      executingMaterializationKey: testCase.executingMaterializationKey,
      projectedFields: testCase.projectedFields,
      base: testCase.base,
      ...(Object.prototype.hasOwnProperty.call(testCase, 'clientOverlayRows')
        ? { clientOverlayRows: testCase.clientOverlayRows }
        : {}),
    });
    outcome = { status: 'ok', rows };
  } catch (error) {
    outcome = {
      status: 'refused',
      code: error?.code ?? 'SNAPBACK_RESULT_TRANSFORM_UNTYPED_FAILURE',
      reason: error?.reason ?? 'untyped-failure',
    };
  }

  return Object.freeze({
    name: testCase.name,
    evaluatorIdentity: RESULT_TRANSFORM_V1_JAVASCRIPT_EVALUATOR_ID,
    transformHash,
    outcome,
    outcomeJcs: canonicalizeClientValueV1(outcome),
  });
}
