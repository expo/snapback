// @ts-ignore
import manifest from "../../../corpus/manifest.json";
import {
  ClientStore,
  canonicalValue,
  compareExpected,
  evaluateCase,
  hydrateCase,
  scopedRuleHash,
  sha256,
  type ClosureReceipt,
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

type AuthorityFixture = "none" | "matching" | "hash" | "digest" | "principal" | "epoch";

function derivedRuleInput(
  targetRead: unknown,
  authority: AuthorityFixture = "none",
  negated = false,
) {
  const hiddenExists = {
    Exists: {
      table: "grants",
      index: "byPrincipal",
      key: ["Viewer"],
      provenance: "Viewer",
    },
  };
  const docsRead = negated ? { Not: hiddenExists } : hiddenExists;
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
          read: docsRead,
          insert: "Deny",
          update: "Deny",
          delete: "Deny",
        },
        constraints: [],
      },
    },
    maintains: [],
  };
  const receipt: ClosureReceipt = {
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
  if (authority !== "none") {
    const verdict = {
      rule_hash: scopedRuleHash(schema, docsRead),
      pinned_inputs_digest: sha256(JSON.stringify(["grants", "byPrincipal", [{ Id: "viewer" }]])),
      principal: "viewer",
      auth_epoch: 1,
      result: true,
    };
    if (authority === "hash") verdict.rule_hash = "stale-rule";
    if (authority === "digest") verdict.pinned_inputs_digest = "stale-input";
    if (authority === "principal") verdict.principal = "someone-else";
    if (authority === "epoch") verdict.auth_epoch += 1;
    receipt.verdicts.push(verdict);
  }
  return new ClientStore(schema, receipt).reexecute(program, context);
}

function derivedRuleInputResult(targetRead: unknown): unknown {
  return derivedRuleInput(targetRead).execution.result;
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
const protectedRead = { Eq: [{ Field: "principal" }, { Literal: { Id: "someone-else" } }] };
const missingAuthority = derivedRuleInput(protectedRead);
assert(missingAuthority.execution.result === "Null", "protected input used a held row without a verdict");
assert(
  missingAuthority.state === "partial" &&
    JSON.stringify(missingAuthority.partialSites) === JSON.stringify(["missing-authority"]),
  "missing authority did not produce deterministic partial state",
);
const matchingAuthority = derivedRuleInput(protectedRead, "matching");
assert(
  JSON.stringify(matchingAuthority.execution.result) === JSON.stringify(readableDoc) &&
    matchingAuthority.state === "fresh",
  "exact authority verdict did not admit the held rule input",
);
for (const stale of ["hash", "digest", "principal", "epoch"] as const) {
  const replay = derivedRuleInput(protectedRead, stale);
  assert(
    replay.execution.result === "Null" && replay.state === "partial" &&
      JSON.stringify(replay.partialSites) === JSON.stringify(["missing-authority"]),
    `stale ${stale} authority admitted a held rule input`,
  );
}
const negatedMissingAuthority = derivedRuleInput(protectedRead, "none", true);
assert(
  negatedMissingAuthority.execution.result === "Null" && negatedMissingAuthority.state === "partial",
  "negation turned missing authority into access",
);
const publicRule = { Public: { reason: "fixture" } };
const mutationSchema = {
  tables: {
    grants: {
      columns: { id: "Id", principal: "Id" },
      indexes: {
        byId: { columns: ["id"], unique: true },
        byPrincipal: { columns: ["principal"], unique: true },
      },
      rules: { read: protectedRead, insert: publicRule, update: publicRule, delete: publicRule },
      constraints: [],
    },
    staged: {
      columns: { id: "Id" },
      indexes: { byId: { columns: ["id"], unique: true } },
      rules: { read: publicRule, insert: publicRule, update: publicRule, delete: publicRule },
      constraints: [],
    },
    docs: {
      columns: { id: "Id" },
      indexes: { byId: { columns: ["id"], unique: true } },
      rules: { read: publicRule, insert: {
        Exists: { table: "grants", index: "byPrincipal", key: ["Viewer"], provenance: "Viewer" },
      }, update: publicRule, delete: publicRule },
      constraints: [],
    },
  },
  maintains: [],
};
const mutationReceipt: ClosureReceipt = {
  rows: [{
    table: "grants",
    id: "grant",
    row: { Row: { id: { Id: "grant" }, principal: { Id: "viewer" } } },
  }],
  ranges: [], absences: [], verdicts: [],
};
const mutationStore = new ClientStore(mutationSchema, mutationReceipt);
const mutationPartial = mutationStore.applyMutation({
  name: "stageThenRequireAuthority",
  kind: "Mutation",
  args: {},
  read_time_granularity_ms: null,
  body: [
    { Insert: { table: "staged", row: { Literal: { Row: { id: { Id: "staged" } } } } } },
    { Insert: { table: "docs", row: { Literal: { Row: { id: { Id: "doc" } } } } } },
    { Return: { Literal: { Bool: true } } },
  ],
}, {
  viewer: "viewer", principal_kind: "non_authoritative_metadata", auth_epoch: 1,
  args: {}, now: 1, new_ids: [], read_time: null,
});
assert(
  mutationPartial.state === "partial" && mutationPartial.execution.result === "Null" &&
    JSON.stringify(mutationPartial.partialSites) === JSON.stringify(["missing-authority"]),
  "missing write authority did not return deterministic partial state",
);
assert(
  mutationStore.byId("staged", "staged") === null && mutationStore.byId("docs", "doc") === null,
  "missing write authority did not roll back the whole local mutation",
);
assert(
  JSON.stringify(derivedRuleInputResult({
    Eq: [
      { Literal: { Map: { a: { Int: 1 }, b: { Int: 2 } } } },
      { Literal: { Map: { b: { Int: 2 }, a: { Int: 1 } } } },
    ],
  })) === JSON.stringify(readableDoc),
  "structurally equal rule terms depended on JavaScript object insertion order",
);
for (const rowImage of ["OldField", "NextField"] as const) {
  assert(
    derivedRuleInputResult({ Eq: [{ [rowImage]: "principal" }, { [rowImage]: "principal" }] }) === "Null",
    `${rowImage} in an uncertified read rule did not fail structural disclosure closed`,
  );
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
predecessor.receipt.verdicts = [{
  rule_hash: predecessorHash,
  pinned_inputs_digest: sha256(JSON.stringify(["entitlements", "byUser", [{ Id: "u1" }]])),
  principal: "u1",
  auth_epoch: 1,
  result: true,
}];
const predecessorReplay = hydrateCase(predecessor);
assert(predecessorReplay.planState === "ready", predecessorReplay.diagnostic ?? "predecessor replay");

const successor = JSON.parse(JSON.stringify(predecessor)) as CorpusCase;
successor.schema.tables.entitlements.rules.read = {
  Eq: [{ Field: "userId" }, { Literal: { Id: "u3" } }],
};
const successorHash = scopedRuleHash(successor.schema, successor.schema.tables.secretDocs.rules.read);
assert(successorHash !== predecessorHash, "referenced read-policy replacement did not change the enclosing rule hash");
const carriedVerdict = hydrateCase(successor);
assert(carriedVerdict.planState === "replay-mismatch", "successor accepted a predecessor scoped verdict");
assert(
  carriedVerdict.actual.localResult === "Null" && carriedVerdict.actual.localState === "partial" &&
    JSON.stringify(carriedVerdict.actual.partialSites) === JSON.stringify(["missing-authority"]),
  "successor did not fail closed after refusing the predecessor scoped verdict",
);

const bootstrap = cases.find(
  (testCase) => testCase.name === "named-rbac-created-bootstrap",
);
assert(bootstrap !== undefined, "named-rbac-created-bootstrap is absent from the corpus");
const atomicProgram = JSON.parse(JSON.stringify(bootstrap.program));
atomicProgram.name = "groups.bootstrapThenRekey";
atomicProgram.body.splice(-1, 0, {
  Update: {
    table: "memberships",
    key: { Literal: { Id: "seat-new" } },
    patch: { Object: { id: { Literal: { Id: "seat-stolen" } } } },
  },
});
const atomicStore = new ClientStore(bootstrap.schema, bootstrap.receipt);
let atomicError = "";
try {
  atomicStore.applyMutation(atomicProgram, bootstrap.context);
} catch (error) {
  atomicError = String(error);
}
assert(atomicError.startsWith("Error: E_INPUT:"), `unexpected rekey error: ${atomicError}`);
assert(
  atomicStore.rows("groups").length === 0 &&
    atomicStore.rows("memberships").length === 0,
  "a refused local mutation retained writes from before the refusal",
);

console.log(
  JSON.stringify({
    cases: cases.length,
    passed: cases.length,
    failed: 0,
    corruptionPath: "replay-mismatch",
  }),
);
