// @ts-ignore
import manifest from "../../../corpus/manifest.json";
import {
  canonicalValue,
  compareExpected,
  evaluateCase,
  hydrateCase,
  scopedRuleHash,
  sha256,
  type CorpusCase,
} from "./evaluator";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  sha256("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  "pure TypeScript SHA-256 does not match the standard vector",
);

for (const value of [
  { Bytes: "00ff", extra: { Int: 1 } },
  { Bytes: "00FF" },
  { Bytes: "0" },
  { Bytes: "0g" },
] as unknown[]) {
  let refused = false;
  try {
    canonicalValue(value as any);
  } catch (error) {
    refused = error instanceof Error && error.message.startsWith("E_INPUT:");
  }
  assert(refused, `twin accepted non-canonical Bytes ${JSON.stringify(value)}`);
}

const cases = manifest as unknown as CorpusCase[];
for (const testCase of cases) {
  const hydration = hydrateCase(testCase);
  assert(hydration.planState === "ready", hydration.diagnostic ?? testCase.name);
  const differences = compareExpected(hydration.actual, testCase.expected);
  assert(differences.length === 0, `${testCase.name}: ${differences.join("; ")}`);
}

const original = cases.find((testCase) => testCase.name === "scenario-hydrate");
assert(original !== undefined, "scenario-hydrate is absent from the corpus");
const staleValueModel = JSON.parse(JSON.stringify(original)) as CorpusCase;
staleValueModel.certificate.value_model_version = "i53-codepoint-v1";
let staleValueModelRefused = false;
try {
  evaluateCase(staleValueModel);
} catch (error) {
  staleValueModelRefused = error instanceof Error && error.message.startsWith("E_TRACE_SUBSET:");
}
assert(staleValueModelRefused, "twin accepted a stale certificate value-model version");
const corrupted = JSON.parse(JSON.stringify(original)) as CorpusCase;
const message = corrupted.receipt.rows.find((row) => row.table === "messages");
assert(message !== undefined && message.row !== "Null" && "Row" in message.row, "message receipt row missing");
message.row.Row.body = { String: "deliberately corrupted after shipment" };
const mismatch = hydrateCase(corrupted);
assert(mismatch.planState === "replay-mismatch", "corrupted receipt did not trip replay-mismatch");
assert(
  JSON.stringify(mismatch.servedResult) === JSON.stringify(original.expected.localResult),
  "replay mismatch did not serve the shipped result",
);

const hidden = cases.find((testCase) => testCase.name === "named-hidden-rule");
assert(hidden !== undefined, "named-hidden-rule is absent from the corpus");
const predecessor = JSON.parse(JSON.stringify(hidden)) as CorpusCase;
predecessor.schema.tables.entitlements.rules.read = {
  Eq: [{ Field: "userId" }, { Literal: { Id: "u2" } }],
};
const outerRule = predecessor.schema.tables.secretDocs.rules.read;
const predecessorHash = scopedRuleHash(predecessor.schema, outerRule);
for (const verdict of predecessor.receipt.verdicts) verdict.rule_hash = predecessorHash;
const predecessorReplay = hydrateCase(predecessor);
assert(predecessorReplay.planState === "ready", predecessorReplay.diagnostic ?? "predecessor replay");

const successor = JSON.parse(JSON.stringify(predecessor)) as CorpusCase;
successor.schema.tables.entitlements.rules.read = {
  Eq: [{ Field: "userId" }, "Viewer"],
};
const successorHash = scopedRuleHash(successor.schema, successor.schema.tables.secretDocs.rules.read);
assert(successorHash !== predecessorHash, "referenced read-policy replacement did not change the enclosing rule hash");
const carriedVerdict = hydrateCase(successor);
assert(carriedVerdict.planState === "replay-mismatch", "successor accepted a predecessor scoped verdict");
assert(
  carriedVerdict.actual.localResult === "Null",
  "successor did not recompute after refusing the predecessor scoped verdict",
);

console.log(
  JSON.stringify({
    cases: cases.length,
    passed: cases.length,
    failed: 0,
    corruptionPath: "replay-mismatch",
  }),
);
