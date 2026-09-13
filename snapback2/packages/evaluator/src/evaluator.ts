import { EvalError } from "./errors";
import { sha256 } from "./hash";
import { validateCertificate } from "./runner";
import { ClientStore } from "./store";
import { canonicalValue, clone, rangeStops } from "./value-runtime";
import type { ActualResult, CorpusCase, CorpusExpected, HydrationResult, RowRecord } from "./types";

export { sha256 } from "./hash";
export { canonicalValue, rowDigest, scopedRuleHash, wireJson } from "./value-runtime";
export { ClientStore } from "./store";
export { executeQuery, readQueryAuthority } from './query';
export type { QueryHost, QueryCursor, QueryDirectory, Awaitable } from './query';
export { CURRENT_VALUE_MODEL_VERSION } from "./runner";
export type {
  ActualResult,
  ClosureReceipt,
  Context,
  CorpusCase,
  CorpusExpected,
  HydrationResult,
  LocalExecution,
  PreludeStep,
  ReceiptRange,
  RowRecord,
  Trace,
  TraceAbsence,
  TracePoint,
  TraceRange,
  Value,
  Verdict,
} from "./types";

function indexableColumn(descriptor: any): boolean {
  if (descriptor?.Optional !== undefined) return indexableColumn(descriptor.Optional);
  return descriptor?.Image === undefined
    && descriptor?.Video === undefined
    && descriptor?.List === undefined;
}

function schemaCertificationError(schema: any): string | null {
  for (const table of Object.values(schema.tables ?? {}) as any[]) {
    for (const index of Object.values(table.indexes ?? {}) as any[]) {
      const columns = index.components ?? [];
      if (columns.length < 1 || columns.length > 8) return "E_SCHEMA_INDEX_COLUMN";
      for (const component of columns) {
        if (component.WordPrefixes) continue;
        const column = component.Column;
        if (table.columns?.[column] === undefined || !indexableColumn(table.columns[column])) {
          return "E_SCHEMA_INDEX_COLUMN";
        }
      }
    }
  }
  return null;
}

export function evaluateCase(testCase: CorpusCase): ActualResult {
  if (testCase.corpusVersion !== 1) throw new EvalError("E_CORPUS", "unsupported corpus version");
  if (testCase.certificate === null) {
    if (testCase.serverOnly) throw new EvalError("E_CORPUS", "server-only certification case must be checked by Rust");
    const errorCode = schemaCertificationError(testCase.schema) ?? "E_CORPUS";
    const canonicalResult = JSON.stringify({ Error: errorCode });
    return {
      localResult: null,
      errorCode,
      localState: "certification-refused",
      partialSites: [],
      canonicalResult,
      digest: sha256(canonicalResult),
      rangeStops: {},
      evictedRows: null,
      next: null,
    };
  }
  validateCertificate(testCase.schema, testCase.program, testCase.certificate);
  const store = new ClientStore(testCase.schema, testCase.receipt, { program: testCase.program });
  for (const step of testCase.prelude) {
    const prelude = store.applyMutation(step.program, step.context, false, step.certificate);
    if (prelude.state !== step.expectedState)
      throw new EvalError("E_CORPUS", `prelude state ${prelude.state} != ${step.expectedState}`);
  }
  const evictedRows =
    testCase.replacementReceipt === null ? null : store.rehydrate(testCase.replacementReceipt);
  try {
    const local =
      testCase.program.kind === "Mutation"
        ? store.applyMutation(testCase.program, testCase.context, true, testCase.certificate, testCase.predictDelivery === true)
        : store.reexecute(testCase.program, testCase.context, testCase.certificate);
    const canonicalResult = canonicalValue(local.execution.result);
    return {
      localResult: local.execution.result,
      errorCode: null,
      localState: local.state,
      partialSites: local.partialSites,
      canonicalResult,
      digest: sha256(canonicalResult),
      rangeStops: rangeStops(local.execution.trace.ranges),
      evictedRows,
      next: local.execution.next,
      ...(testCase.predictDelivery ? { deliveryWrites: local.execution.writes.filter((w): w is RowRecord => w.row !== null
        && Object.values<any>(testCase.schema.tables).some(t => t.deliver?.log === w.table)) } : {}),
    };
  } catch (error) {
    const internalCode = error instanceof EvalError ? error.code : "E_UNKNOWN";
    const code = internalCode;
    const authoredCode = error instanceof EvalError ? error.authoredCode : null;
    const typedState =
      code === "E_REQUIRE"
        ? testCase.program.kind === "Mutation"
          ? "rejected"
          : "denied"
        : "refused";
    const publicCode = authoredCode ?? code;
    if (typedState !== "refused") {
      const canonicalResult = canonicalValue("Null");
      return {
        localResult: "Null",
        errorCode: publicCode,
        localState: typedState,
        partialSites: [],
        canonicalResult,
        digest: sha256(canonicalResult),
        rangeStops: {},
        evictedRows,
        next: null,
      };
    }
    const canonicalResult = JSON.stringify({ Error: code });
    return {
      localResult: null,
      errorCode: publicCode,
      localState: "refused",
      partialSites: [],
      canonicalResult,
      digest: sha256(canonicalResult),
      rangeStops: {},
      evictedRows,
      next: null,
    };
  }
}

export function hydrateCase(testCase: CorpusCase): HydrationResult {
  const actual = evaluateCase(testCase);
  const differences = compareExpected(actual, testCase.expected);
  if (differences.length > 0) {
    return {
      planState: "replay-mismatch",
      servedResult: clone(testCase.expected.localResult),
      actual,
      diagnostic: `hydration replay mismatch for ${testCase.name}: ${differences.join("; ")}`,
    };
  }
  return {
    planState: "ready",
    servedResult: clone(actual.localResult),
    actual,
    diagnostic: null,
  };
}

export function compareExpected(actual: ActualResult, expected: CorpusExpected): string[] {
  const differences: string[] = [];
  if (expected.deliveryWrites !== undefined && JSON.stringify(actual.deliveryWrites) !== JSON.stringify(expected.deliveryWrites))
    differences.push(`deliveryWrites: ${JSON.stringify(actual.deliveryWrites)} != ${JSON.stringify(expected.deliveryWrites)}`);
  for (const key of [
    "canonicalResult",
    "digest",
    "errorCode",
    "localState",
    "evictedRows",
  ] as const) {
    if (actual[key] !== expected[key])
      differences.push(`${key}: ${String(actual[key])} != ${String(expected[key])}`);
  }
  if (Object.prototype.hasOwnProperty.call(expected, "next") && actual.next !== expected.next)
    differences.push(`next: ${String(actual.next)} != ${String(expected.next)}`);
  if (JSON.stringify(actual.partialSites) !== JSON.stringify(expected.partialSites))
    differences.push(
      `partialSites: ${JSON.stringify(actual.partialSites)} != ${JSON.stringify(expected.partialSites)}`,
    );
  if (JSON.stringify(actual.rangeStops) !== JSON.stringify(expected.rangeStops))
    differences.push(
      `rangeStops: ${JSON.stringify(actual.rangeStops)} != ${JSON.stringify(expected.rangeStops)}`,
    );
  return differences;
}
