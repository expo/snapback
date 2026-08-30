// @ts-ignore
import manifest from "../../../corpus/manifest.json";
import {
  ClientStore,
  compareExpected,
  hydrateCase,
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

const cases = manifest as unknown as CorpusCase[];
for (const testCase of cases) {
  const hydration = hydrateCase(testCase);
  assert(hydration.planState === "ready", hydration.diagnostic ?? testCase.name);
  const differences = compareExpected(hydration.actual, testCase.expected);
  assert(differences.length === 0, `${testCase.name}: ${differences.join("; ")}`);
}

function derivedRuleInputResult(targetRead: unknown): unknown {
  const schema = {
    tables: {
      grants: {
        columns: { id: "Id", principal: "Id" },
        indexes: {
          byId: { columns: ["id"], unique: true },
          byPrincipal: { columns: ["principal"], unique: true },
        },
        rules: { read: targetRead, insert: "Deny", update: "Deny", delete: "Deny" },
        constraints: [],
      },
      docs: {
        columns: { id: "Id" },
        indexes: { byId: { columns: ["id"], unique: true } },
        rules: {
          read: {
            Exists: {
              table: "grants",
              index: "byPrincipal",
              key: ["Viewer"],
              provenance: "Viewer",
            },
          },
          insert: "Deny",
          update: "Deny",
          delete: "Deny",
        },
        constraints: [],
      },
    },
    maintains: [],
  };
  const receipt = {
    rows: [
      { table: "grants", id: "grant", row: { Row: { id: { Id: "grant" }, principal: { Id: "viewer" } } } },
      { table: "docs", id: "doc", row: { Row: { id: { Id: "doc" } } } },
    ],
    ranges: [],
    absences: [],
    verdicts: [],
  };
  const context = {
    viewer: "viewer",
    principal_kind: "non_authoritative_metadata",
    auth_epoch: 1,
    args: {},
    now: null,
    new_ids: [],
    read_time: null,
  };
  const program = {
    name: "docs.get",
    kind: "Query",
    args: {},
    read_time_granularity_ms: null,
    body: [{
      Return: {
        Get: {
          site: "docs.get",
          table: "docs",
          index: "byId",
          key: [{ Literal: { Id: "doc" } }],
          provenance: "Const",
        },
      },
    }],
  };
  return new ClientStore(schema, receipt).reexecute(program, context).execution.result;
}

const readableDoc = { Row: { id: { Id: "doc" } } };
assert(
  JSON.stringify(derivedRuleInputResult({ Public: { reason: "fixture grants are public" } })) === JSON.stringify(readableDoc),
  "public rule input was not derived readable",
);
assert(
  JSON.stringify(derivedRuleInputResult({
    Exists: { table: "grants", index: "byPrincipal", key: ["Viewer"], provenance: "Viewer" },
  })) === JSON.stringify(readableDoc),
  "exact self-readable indexed rule input was not derived readable",
);
assert(
  derivedRuleInputResult({ Eq: [{ Field: "principal" }, { Literal: { Id: "someone-else" } }] }) === "Null",
  "protected near-miss rule input did not fail closed without a verdict",
);

const original = cases.find((testCase) => testCase.name === "scenario-hydrate");
assert(original !== undefined, "scenario-hydrate is absent from the corpus");
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

console.log(
  JSON.stringify({
    cases: cases.length,
    passed: cases.length,
    failed: 0,
    corruptionPath: "replay-mismatch",
  }),
);
