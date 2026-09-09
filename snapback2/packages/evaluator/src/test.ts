// @ts-ignore
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const manifest = JSON.parse(readFileSync(process.env.SNAPBACK2_CORPUS ? resolve(process.env.SNAPBACK2_CORPUS, "manifest.json") : new URL("../../../corpus/manifest.json", import.meta.url), "utf8"));
// Build prerequisite also runs for the documented direct `bun src/test.ts` entry point.
// @ts-ignore — build-only JS implementation has no runtime evaluator dependency.
import { generateUnicodeTables } from '../unicode-build.mjs';
generateUnicodeTables();
await import('./test-search-foundation');
await import('./test-indexed');
await import('./test-rule-hash-memo');
await import('./test-maintained-address');
await import('./test-merge');
import {
  ClientStore,
  canonicalValue,
  compareExpected,
  evaluateCase,
  hydrateCase,
  rowDigest,
  scopedRuleHash,
  sha256,
  wireJson,
  type ClosureReceipt,
  type Context,
  type CorpusCase,
  type Value,
} from "./evaluator";
import { canonicalProgramJson, canonicalSchemaJson } from "./certificate-identity";
import { EvalError } from "./errors";
import { queryState } from "./runner";

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

const serverOnly = (manifest as unknown as CorpusCase[]).filter((item) => item.serverOnly);
const cases = (manifest as unknown as CorpusCase[]).filter((item) => !item.serverOnly);
for (const item of serverOnly) {
  let refused = false;
  try { evaluateCase(item); } catch (error) { refused = error instanceof EvalError && error.message.includes("server-only"); }
  assert(refused, `${item.name}: server-only case was evaluated`);
}
const unbackedCap = serverOnly.find((item) => item.name === "cap-1000-49-inserts-unbacked-refused");
assert(
  unbackedCap?.certificationRewrite?.includes(
    "maintain membershipsCounts: count memberships by principal\n  read <- deny",
  ) && unbackedCap.certificationRewrite.includes("prices at one row per write"),
  "the unbacked cap refusal lost its exact count-maintain rewrite",
);
for (const testCase of cases) {
  const hydration = hydrateCase(testCase);
  assert(hydration.planState === "ready", hydration.diagnostic ?? testCase.name);
  const differences = compareExpected(hydration.actual, testCase.expected);
  assert(differences.length === 0, `${testCase.name}: ${differences.join("; ")}`);
}

// Every merge corpus replay must stay under the same certified meters as the engine.
for (const testCase of cases.filter((c) => c.expected.errorCode === null && JSON.stringify(c.program).includes('"Merge"'))) {
  const certificate = testCase.certificate as any;
  const replay = new ClientStore(testCase.schema, testCase.receipt, { program: testCase.program })
    .reexecute(testCase.program, testCase.context, certificate);
  assert((replay.execution.trace.examined ?? 0) <= certificate.max_examined, `${testCase.name}: merge examined bound`);
  assert((replay.execution.trace.examined ?? 0) <= certificate.max_index_entries, `${testCase.name}: merge index bound`);
  assert((replay.execution.trace.steps ?? 0) <= certificate.max_steps, `${testCase.name}: heap steps bound`);
  assert((replay.execution.trace.rule_probes ?? 0) <= certificate.max_rule_probes, `${testCase.name}: merge rule-probe bound`);
}


const enrichedPage = cases.find((item) => item.name === "enriched-capped-page-hidden-point-null");
assert(enrichedPage !== undefined, "enriched capped page case is absent from the corpus");
const enrichedReplay = new ClientStore(enrichedPage.schema, enrichedPage.receipt)
  .reexecute(enrichedPage.program, enrichedPage.context, enrichedPage.certificate);
assert(queryState(enrichedPage.certificate, enrichedReplay.execution.trace) === "capped",
  "nested point-read shaping changed the non-uniform page's read state");
assert(canonicalValue(enrichedReplay.execution.result) === enrichedPage.expected.canonicalResult,
  "enriched capped page did not preserve the authorized shape and hidden point null");

{
  const fixture = cases.find((item) => item.name === "decided-or-unheld-other-arm");
  assert(fixture, "decided Or fixture is absent");
  assert(fixture.receipt.verdicts.length === 0 && fixture.receipt.rows.every((row) => row.table === "memberships"),
    "the unused arm must have neither held rows nor authority");
  const store = new ClientStore(fixture.schema, fixture.receipt);
  const withDecision = store.reexecute(fixture.program, fixture.context, fixture.certificate);
  assert(withDecision.state === "fresh" && withDecision.partialSites.length === 0,
    `decided arm requested unused authority: ${JSON.stringify(withDecision)}`);
  assert(canonicalValue(withDecision.execution.result) === canonicalValue(fixture.expected.localResult!), "decided arm lost its rows");
  const certificate = structuredClone(fixture.certificate);
  for (const site of certificate.read_sites) delete site.decided_true;
  const withoutDecision = store.reexecute(fixture.program, fixture.context, certificate);
  assert(withoutDecision.state === "partial" && JSON.stringify(withoutDecision.partialSites) === '["missing-authority"]',
    `undecided arm failed to request authority: ${JSON.stringify(withoutDecision)}`);
}

{
  const fixture = cases.find((item) => item.name === "self-probe-enriched-membership-page");
  assert(fixture, "self-probe fixture is absent");
  const program = structuredClone(fixture.program);
  const scan = program.body[1].For.domain.Page;
  scan.prefix = [{ Scalar: { Literal: { Id: "u1" } } }];
  program.body = [{ Return: { Scan: scan } }];
  const context = { ...fixture.context, viewer: "outsider" };
  const receipt = structuredClone(fixture.receipt);
  for (const conversation of ["c1", "c2"]) {
    receipt.absences.push(["memberships", "byConversationPrincipal", [{ Id: conversation }, { Id: "outsider" }]]);
  }
  const certificate = structuredClone(fixture.certificate);
  certificate.completeness = "Capped";
  certificate.read_sites = certificate.read_sites.filter((site: any) => site.site === scan.site);
  const site = certificate.read_sites[0];
  site.decided_true = true;
  for (const hoist of [false, undefined]) {
    site.hoist = hoist;
    const store = new ClientStore(fixture.schema, receipt);
    let probes = 0;
    const lookup = store.lookup.bind(store);
    store.lookup = (table, index, key) => {
      if (table === "memberships" && index === "byConversationPrincipal") probes += 1;
      return lookup(table, index, key);
    };
    const result = store.reexecute(program, context, certificate);
    assert(result.state === "fresh" && canonicalValue(result.execution.result) === canonicalValue({ Array: [] }),
      `decided_true without hoist disclosed a hidden row: ${JSON.stringify(result)}`);
    // The twin has no rule-probe budget counter; count the actual authority lookups.
    assert(probes === 2, `decided_true without hoist skipped rule probes: ${probes}`);
  }
}
console.log(JSON.stringify({ visibilityChecks: 2, passed: 2, failed: 0 }));

const cursorPageTwo = cases.find((testCase) => testCase.name === "opaque-cursor-page-two-no-overlap");
assert(cursorPageTwo !== undefined, "opaque cursor page-two case is absent from the corpus");
const boundCursor = JSON.parse(JSON.stringify(cursorPageTwo)) as CorpusCase;
const returnedScan = (boundCursor.program.body[0] as any).Return.Scan;
returnedScan.after = { Variable: "position" };
boundCursor.program.body.unshift({ Const: { name: "position", value: { Variable: "c" } } } as any);
const boundCursorReplay = new ClientStore(boundCursor.schema, boundCursor.receipt)
  .reexecute(boundCursor.program, boundCursor.context);
assert(
  JSON.stringify(boundCursorReplay.execution.result) === JSON.stringify(boundCursor.expected.localResult),
  "evaluator did not preflight and execute a cursor expression bound from the operation argument",
);

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
          byId: { components: [{ Column: "id" }], unique: true },
          byPrincipal: { components: [{ Column: "principal" }], unique: true },
        },
        rules: { read: targetRead, insert: "Deny", update: "Deny", delete: "Deny" },
        constraints: [],
      },
      docs: {
        columns: { id: "Id" },
        indexes: { byId: { components: [{ Column: "id" }], unique: true } },
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
      pinned_inputs_digest: sha256(JSON.stringify(["grants", "byPrincipal", ["viewer"]])),
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
        byId: { components: [{ Column: "id" }], unique: true },
        byPrincipal: { components: [{ Column: "principal" }], unique: true },
      },
      rules: { read: protectedRead, insert: publicRule, update: publicRule, delete: publicRule },
      constraints: [],
    },
    staged: {
      columns: { id: "Id" },
      indexes: { byId: { components: [{ Column: "id" }], unique: true } },
      rules: { read: publicRule, insert: publicRule, update: publicRule, delete: publicRule },
      constraints: [],
    },
    docs: {
      columns: { id: "Id" },
      indexes: { byId: { components: [{ Column: "id" }], unique: true } },
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
predecessor.certificate.schema_hash = sha256(JSON.stringify(predecessor.schema));
const outerRule = predecessor.schema.tables.secretDocs.rules.read;
const predecessorHash = scopedRuleHash(predecessor.schema, outerRule);
predecessor.receipt.verdicts = [{
  rule_hash: predecessorHash,
  pinned_inputs_digest: sha256(JSON.stringify(["entitlements", "byUser", ["u1"]])),
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
successor.certificate.schema_hash = sha256(JSON.stringify(successor.schema));
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

const emptyReceipt = (): ClosureReceipt => ({ rows: [], ranges: [], absences: [], verdicts: [] });
const context = (args: Record<string, Value> = {}, newIds: string[] = []): Context => ({
  viewer: "viewer",
  principal_kind: "user",
  auth_epoch: 1,
  args,
  now: 0,
  new_ids: newIds,
  read_time: null,
});
const publicRules = {
  read: { Public: { reason: "regression" } },
  insert: "Allow",
  update: "Allow",
  delete: "Allow",
};
const table = (columns: Record<string, unknown>, rules: any = publicRules) => ({
  columns,
  indexes: { byId: { components: [{ Column: "id" }], unique: true } },
  rules,
  constraints: [],
});
const query = (expression: any, args: Record<string, unknown> = {}) => ({
  name: "regression.query",
  kind: "Query",
  args,
  read_time_granularity_ms: null,
  body: [{ Return: expression }],
});
const mutation = (body: any[], args: Record<string, unknown> = {}) => ({
  name: "regression.mutation",
  kind: "Mutation",
  args,
  read_time_granularity_ms: null,
  body,
});
const literal = (value: Value) => ({ Literal: value });
const builtin = (name: any, args: any[]) => ({ Builtin: { builtin: name, args } });
const expectCode = (run: () => unknown, code: string, label: string) => {
  let message = "";
  try {
    run();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert(message.startsWith(`${code}:`), `${label}: expected ${code}, got ${message || "success"}`);
};

{
  const schema = { tables: { users: table({ id: "Id" }) }, maintains: [] };
  const store = new ClientStore(schema, emptyReceipt());
  const duplicateShare = builtin("DeterministicShare", [
    literal({ Int: 1 }),
    literal({ Array: [{ Id: "u1" }, { Id: "u1" }] }),
    literal({ Id: "u1" }),
  ]);
  const writeThenReject = mutation([
    { Insert: { table: "users", row: literal({ Row: { id: { Id: "ghost" } } }) } },
    { Return: duplicateShare },
  ]);
  expectCode(
    () => store.applyMutation(writeThenReject, context()),
    "E_INPUT",
    "duplicate deterministic share",
  );
  assert(store.byId("users", "ghost") === null, "rejected mutation leaked its staged insert");
}

{
  const schema = { tables: {}, maintains: [] };
  const store = new ClientStore(schema, emptyReceipt());
  for (const [descriptor, value, code, label] of [
    [{ List: { of: "Int", max: 1 } }, { Array: [{ Int: 1 }, { Int: 2 }] }, "E_FANOUT", "list max"],
    ["Id", { String: "not-id" }, "E_INPUT", "id kind"],
    [{ Text: { max: 1 } }, { String: "ab" }, "E_INPUT", "text max"],
    ["Int", { Int: 9_007_199_254_740_992 }, "E_INPUT", "i53 bound"],
    ["Bool", { Int: 1 }, "E_INPUT", "bool kind"],
    [{ Bytes: { max: 1 } }, { Bytes: "0001" }, "E_INPUT", "bytes max"],
    [{ Enum: { variants: ["open"] } }, { String: "closed" }, "E_INPUT", "enum member"],
    [{ Json: { max_bytes: 4 } }, { Row: { key: { Int: 1 } } }, "E_INPUT", "JSON max"],
    ["Scalar", { Array: [{ Id: "system" }] }, "E_INPUT", "reserved principal"],
  ] as [any, Value, string, string][]) {
    expectCode(
      () => store.reexecute(query(literal("Null"), { value: descriptor }), context({ value })),
      code,
      label,
    );
  }
  for (const character of ["\t", "\n", "\r", '"', "\\", "\u{10ffff}"]) {
    const value = { String: character } as Value;
    store.reexecute(query(literal("Null"), { body: { Text: { max: 1 } } }), context({ body: value }));
  }
  let controlMessage = "";
  try {
    store.reexecute(
      query(literal("Null"), { body: { Text: { max: 1 } } }),
      context({ body: { String: "\u0001" } }),
    );
  } catch (error) {
    controlMessage = error instanceof Error ? error.message : String(error);
  }
  assert(controlMessage === "E_INPUT: arg body contains disallowed control character U+0001",
    `text argument control refusal changed: ${controlMessage}`);
}

{
  const schema = {
    tables: {
      items: table({ id: "Id", values: { List: { of: "Int", max: 1 } }, note: { Optional: { Text: { max: 8 } } } }),
    },
    maintains: [],
  };
  for (const [row, label] of [
    [{ Row: { id: { Id: "missing" } } }, "missing required field"],
    [{ Row: { id: { Id: "unknown" }, values: { Array: [] }, extra: { Int: 1 } } }, "unknown field"],
    [{ Row: { id: { Id: "long" }, values: { Array: [{ Int: 1 }, { Int: 2 }] } } }, "row list max"],
    [{ Row: { id: { Id: "kind" }, values: { Array: [{ String: "wrong" }] } } }, "row nested kind"],
  ] as [Value, string][]) {
    const program = mutation([{ Insert: { table: "items", row: literal(row) } }]);
    expectCode(
      () => new ClientStore(schema, emptyReceipt()).applyMutation(program, context()),
      "E_INPUT",
      label,
    );
  }
  for (const [index, character] of ["\t", "\n", "\r", '"', "\\", "\u{10ffff}"].entries()) {
    const row = { Row: { id: { Id: `accepted-${index}` }, values: { Array: [] }, note: { String: character } } } as Value;
    new ClientStore(schema, emptyReceipt()).applyMutation(
      mutation([{ Insert: { table: "items", row: literal(row) } }]),
      context(),
    );
  }
  let controlMessage = "";
  try {
    const row = { Row: { id: { Id: "control" }, values: { Array: [] }, note: { String: "\u0001" } } } as Value;
    new ClientStore(schema, emptyReceipt()).applyMutation(
      mutation([{ Insert: { table: "items", row: literal(row) } }]),
      context(),
    );
  } catch (error) {
    controlMessage = error instanceof Error ? error.message : String(error);
  }
  assert(controlMessage === "E_INPUT: items.note contains disallowed control character U+0001",
    `text column control refusal changed: ${controlMessage}`);
}

{
  const targetId = '[{"Id":"g"}]';
  const source = table({ id: "Id", group: "Id" });
  const deniedTarget = table(
    { id: "Id", group: "Id", value: "Int" },
    { read: { Public: { reason: "regression" } }, insert: "Deny", update: "Deny", delete: "Deny" },
  );
  const schema = {
    tables: { source, counts: deniedTarget },
    maintains: [{ kind: "Count", source: "source", by: ["group"], target: "counts", readable: null }],
  };
  const heldTarget: ClosureReceipt = {
    ...emptyReceipt(),
    rows: [{ table: "counts", id: targetId, row: { Row: { id: { Id: targetId }, group: { Id: "g" }, value: { Int: 0 } } } }],
  };
  const store = new ClientStore(schema, heldTarget);
  const applied = store.applyMutation(
    mutation([{ Insert: { table: "source", row: literal({ Row: { id: { Id: "s1" }, group: { Id: "g" } } }) } }]),
    context(),
  );
  assert(applied.state === "predicted", "engine-owned aggregate was blocked by target rules");
  assert(
    canonicalValue(store.byId("counts", targetId)!) ===
      canonicalValue({ Row: { group: { Id: "g" }, id: { Id: targetId }, value: { Int: 1 } } }),
    "engine-owned aggregate did not update the held target",
  );

  const unheld: ClosureReceipt = {
    ...emptyReceipt(),
    rows: [{ table: "source", id: "s1", row: { Row: { id: { Id: "s1" }, group: { Id: "g" } } } }],
  };
  const partialStore = new ClientStore(schema, unheld);
  const partial = partialStore.applyMutation(
    mutation([{ Delete: { table: "source", key: literal({ Id: "s1" }) } }]),
    context(),
  );
  assert(partial.state === "partial", "unheld maintained target was initialized from zero");
  assert(partialStore.byId("source", "s1") !== null, "partial aggregate prediction leaked source deletion");
  assert(partialStore.byId("counts", targetId) === null, "partial aggregate prediction manufactured a target");
}

{
  const schema = {
    tables: { items: table({ id: "Id", note: { Optional: { Text: { max: 8 } } } }) },
    maintains: [],
  };
  const hydrated = new ClientStore(schema, {
    ...emptyReceipt(),
    rows: [{ table: "items", id: "held", row: { Row: { id: { Id: "held" } } } }],
  });
  assert(
    canonicalValue(hydrated.byId("items", "held")!) === canonicalValue({ Row: { id: { Id: "held" }, note: "Null" } }),
    "receipt hydration did not materialize an absent optional field",
  );
  hydrated.applyMutation(
    mutation([{ Insert: { table: "items", row: literal({ Row: { id: { Id: "new" } } }) } }]),
    context(),
  );
  const read = hydrated.reexecute(
    query({ Field: { base: { Get: { site: "items.get", table: "items", index: "byId", key: [literal({ Id: "new" })], provenance: "Const" } }, name: "note" } }),
    context(),
  );
  assert(read.execution.result === "Null", "point read did not observe materialized optional Null");
}

{
  const posts = table(
    { id: "Id", authorId: "Id", secret: { Text: { max: 32 } } },
    {
      ...publicRules,
      read: { Not: { Exists: { table: "blocks", index: "byPair", key: ["Viewer", { Field: "authorId" }], provenance: "Shape" } } },
    },
  );
  const blocks = {
    ...table({ id: "Id", viewerId: "Id", authorId: "Id" }),
    indexes: {
      byId: { components: [{ Column: "id" }], unique: true },
      byPair: { components: [{ Column: "viewerId" }, { Column: "authorId" }], unique: true },
    },
  };
  const schema = { tables: { posts, blocks }, maintains: [] };
  const receipt: ClosureReceipt = {
    ...emptyReceipt(),
    rows: [{ table: "posts", id: "p1", row: { Row: { id: { Id: "p1" }, authorId: { Id: "author" }, secret: { String: "held secret" } } } }],
  };
  const readPost = query({ Get: { site: "posts.get", table: "posts", index: "byId", key: [literal({ Id: "p1" })], provenance: "Const" } });
  const missingProof = new ClientStore(schema, receipt).reexecute(readPost, context());
  assert(missingProof.state === "partial", "missing rule Exists proof was treated as authority");
  assert(missingProof.execution.result === "Null", "partial authorization probe exposed the held secret row");
  receipt.absences.push(["blocks", "byPair", [{ Id: "viewer" }, { Id: "author" }]]);
  receipt.schema_hash = sha256(canonicalSchemaJson(schema));
  const provedAbsent = new ClientStore(schema, receipt).reexecute(readPost, context());
  assert(provedAbsent.state === "fresh", "authority-issued rule absence did not close coverage");
  assert(provedAbsent.execution.result !== "Null", "proved rule absence did not admit the post");
}

{
  const store = new ClientStore({ tables: {}, maintains: [] }, emptyReceipt());
  const collisionPairs = query({
    Array: [
      builtin("Concat", [literal({ Id: "a:b" }), literal({ Id: "c" })]),
      builtin("Concat", [literal({ Id: "a" }), literal({ Id: "b:c" })]),
    ],
  });
  const result = store.reexecute(collisionPairs, context()).execution.result;
  assert(result !== "Null" && "Array" in result, "Id concat did not return an array");
  assert(canonicalValue(result.Array[0]) !== canonicalValue(result.Array[1]), "Id tuple encoding still collides");
}

{
  const store = new ClientStore({ tables: {}, maintains: [] }, emptyReceipt());
  const mentions = store.reexecute(
    query(builtin("MentionTokens", [literal({ String: "@a\u0085@b\u00a0@c\u2028@d\u2029@e\t@f" })])),
    context(),
  ).execution.result;
  assert(
    canonicalValue(mentions) === canonicalValue({ Array: ["a", "b", "c", "d", "e", "f"].map((value) => ({ String: value })) }),
    "mention whitespace set diverged",
  );
  expectCode(
    () => store.reexecute(
      query(builtin({ Sort: { keys: [{ field: "key", order: "Asc" }] } }, [
        literal({ Array: [{ Row: { other: { Int: 1 } } }] }),
      ])),
      context(),
    ),
    "E_FIELD",
    "sort missing key",
  );
}

{
  const planMismatch = JSON.parse(JSON.stringify(original)) as CorpusCase;
  planMismatch.program.body = [{ Return: { Literal: "Null" } }];
  expectCode(() => evaluateCase(planMismatch), "E_TRACE_SUBSET", "certificate plan hash");
  const schemaMismatch = JSON.parse(JSON.stringify(original)) as CorpusCase;
  schemaMismatch.schema.auth = { password: false, guests: true };
  expectCode(() => evaluateCase(schemaMismatch), "E_TRACE_SUBSET", "certificate schema hash");

  const missingRange = JSON.parse(JSON.stringify(original)) as CorpusCase;
  missingRange.receipt.ranges = [];
  const coverageMismatch = hydrateCase(missingRange);
  assert(coverageMismatch.planState === "replay-mismatch", "partial replay was reported ready");
  assert(coverageMismatch.actual.localState === "partial", "missing range did not remain visible in hydration diagnostics");

  for (const kind of ["Query", "Mutation"] as const) {
    const requireCase = JSON.parse(JSON.stringify(original)) as CorpusCase;
    requireCase.program = {
      name: `require.${kind}`,
      kind,
      args: {},
      read_time_granularity_ms: null,
      body: [
        { Require: { condition: { Literal: { Bool: false } }, code: "NOT_MEMBER" } },
        { Return: { Literal: "Null" } },
      ],
    };
    requireCase.certificate.plan_hash = sha256(JSON.stringify(requireCase.program));
    requireCase.context = context();
    requireCase.receipt = emptyReceipt();
    const outcome = evaluateCase(requireCase);
    assert(outcome.errorCode === "NOT_MEMBER", `${kind} erased the authored Require code`);
    assert(
      outcome.localState === (kind === "Query" ? "denied" : "rejected"),
      `${kind} Require used ${outcome.localState}`,
    );
  }
}


// @ref LLP 1012#6-reads-offline — the twin's coverage rule: a drained uniform
// prefix covers every named query over that prefix on any index of the table.
{
  const viewer = { Id: "viewer" } as Value;
  const logSchema = {
    tables: {
      deliveries: {
        columns: { id: "Id", recipient: "Principal", conversationId: "Id", messageId: "Id", at: "Time" },
        indexes: {
          byId: { components: [{ Column: "id" }], unique: true },
          byRecipientAt: { components: [{ Column: "recipient" }, { Column: "at" }, { Column: "id" }], unique: false },
          byRecipientConversationAt: { components: [{ Column: "recipient" }, { Column: "conversationId" }, { Column: "at" }, { Column: "id" }], unique: false },
        },
        rules: { read: { Eq: [{ Field: "recipient" }, "Viewer"] }, insert: "Deny", update: "Deny", delete: "Deny" },
        constraints: [],
      },
      messages: {
        columns: { id: "Id", conversationId: "Id", body: { Text: { max: 100 } } },
        indexes: { byId: { components: [{ Column: "id" }], unique: true } },
        rules: {
          read: { Exists: { table: "memberships", index: "byConversationPrincipal", key: [{ Field: "conversationId" }, "Viewer"], provenance: "Shape" } },
          insert: "Deny", update: "Deny", delete: "Deny",
        },
        constraints: [],
      },
      memberships: {
        columns: { id: "Id", conversationId: "Id", principal: "Principal" },
        indexes: { byId: { components: [{ Column: "id" }], unique: true }, byConversationPrincipal: { components: [{ Column: "conversationId" }, { Column: "principal" }], unique: true } },
        rules: {
          read: { Exists: { table: "memberships", index: "byConversationPrincipal", key: [{ Field: "conversationId" }, "Viewer"], provenance: "Shape" } },
          insert: "Deny", update: "Deny", delete: "Deny",
        },
        constraints: [],
      },
    },
    maintains: [],
  };
  const delivery = (id: string, conversation: string, message: string, at: number): Value =>
    ({ Row: { id: { Id: id }, recipient: viewer, conversationId: { Id: conversation }, messageId: { Id: message }, at: { Int: at } } });
  const readRule = scopedRuleHash(logSchema, logSchema.tables.deliveries.rules.read);
  const page = (site: string, index: string, prefix: Value[], order: "Asc" | "Desc", after: Value | null, rowIds: string[], stop: "Limit" | "Exhausted") => ({
    site, table: "deliveries", index, prefix: prefix.map(Scalar => ({ Scalar })), order, take: 2, after, before: null, gt: null, gte: null, lt: null, lte: null,
    rule_hash: readRule, row_ids: rowIds, stop, absence: false, halo: null, n2_suffix: null,
  });
  const rows = [
    { table: "deliveries", id: "d1", row: delivery("d1", "c1", "m1", 1) },
    { table: "deliveries", id: "d2", row: delivery("d2", "c2", "m2", 2) },
    { table: "deliveries", id: "d3", row: delivery("d3", "c1", "m3", 3) },
    { table: "messages", id: "m1", row: { Row: { id: { Id: "m1" }, conversationId: { Id: "c1" }, body: { String: "one" } } } as Value },
    { table: "messages", id: "m3", row: { Row: { id: { Id: "m3" }, conversationId: { Id: "c1" }, body: { String: "three" } } } as Value },
    { table: "memberships", id: "mem1", row: { Row: { id: { Id: "mem1" }, conversationId: { Id: "c1" }, principal: viewer } } as Value },
  ];
  const drainedReceipt = (secondAfter: Value | null): ClosureReceipt => ({
    schema_hash: sha256(canonicalSchemaJson(logSchema)),
    rows,
    ranges: [
      page("inbox.0", "byRecipientAt", [viewer], "Asc", null, ["d1", "d2"], "Limit"),
      page("inbox.0", "byRecipientAt", [viewer], "Asc", secondAfter, ["d3"], "Exhausted"),
    ],
    absences: [],
    verdicts: [],
  });
  const thread = {
    name: "thread", kind: "Query", args: { conversationId: "Id" }, read_time_granularity_ms: null,
    body: [
      { Require: { code: "MEMBERSHIP_REQUIRED", condition: { Exists: { site: "thread.0", table: "memberships", index: "byConversationPrincipal", key: [{ Variable: "conversationId" }, { Input: "Viewer" }], provenance: "Shape" } } } },
      { Const: { name: "page", value: { Scan: { site: "thread.1", table: "deliveries", index: "byRecipientConversationAt", prefix: [{ Scalar: { Input: "Viewer" } }, { Scalar: { Variable: "conversationId" } }], order: "Desc", take: { Literal: 50 }, after: null, before: null, range: null, merge_site: null, opaque_cursor: false, provenance: "Shape" } } } },
      { Const: { name: "rows", value: { Array: [] } } },
      { For: { binding: "row", domain: { DerivedArray: { value: { Variable: "page" }, max: 50 } }, body: [
        { Push: { target: "rows", value: { Object: { id: { Field: { base: { Variable: "row" }, name: "id" } }, message: { Get: { site: "thread.2", table: "messages", index: "byId", key: [{ Field: { base: { Variable: "row" }, name: "messageId" } }], provenance: "Shape" } } } } } },
      ] } },
      { Return: { Variable: "rows" } },
    ],
  };
  const threadContext = (conversation: string): Context => ({
    viewer: "viewer", principal_kind: "user", auth_epoch: 1, args: { conversationId: { Id: conversation } }, now: null, new_ids: [], read_time: null,
  });
  // The chain: page two's `after` is page one's last returned suffix.
  const chained = new ClientStore(logSchema, drainedReceipt({ Array: [{ Int: 2 }, { Id: "d2" }] }));
  const replay = chained.reexecute(thread, threadContext("c1"));
  assert(replay.state === "fresh", `drained prefix did not cover the thread: ${replay.partialSites.join(",")}`);
  assert(
    canonicalValue(replay.execution.result) === canonicalValue({ Array: [
      { Row: { id: { Id: "d3" }, message: rows[4]!.row } },
      { Row: { id: { Id: "d1" }, message: rows[3]!.row } },
    ] }),
    `drained thread replayed ${canonicalValue(replay.execution.result)}`,
  );
  let neverHeld: unknown;
  try { chained.reexecute(thread, threadContext("c3")); } catch (error) { neverHeld = error; }
  assert(
    neverHeld instanceof Error && neverHeld.message.startsWith("E_REQUIRE:")
      && JSON.stringify((neverHeld as { partialSites?: string[] }).partialSites) === JSON.stringify(["thread.0"]),
    "a require over a membership never held did not name the uncovered site on the refusal",
  );
  // A broken chain (page two names a cursor page one never returned) covers nothing beyond its own pages.
  const broken = new ClientStore(logSchema, drainedReceipt({ Array: [{ Int: 9 }, { Id: "d9" }] }));
  const uncovered = broken.reexecute(thread, threadContext("c1"));
  assert(uncovered.state === "partial" && uncovered.partialSites.includes("thread.1"), "a broken drain chain covered a thread");
  // Interior eviction (Muse M1): a page that lost a member since it was recorded is no link — the thread is partial, not fresh.
  const holed = drainedReceipt({ Array: [{ Int: 2 }, { Id: "d2" }] });
  holed.ranges[0] = { ...holed.ranges[0]!, row_ids: ["d1", "d2"], evicted_ids: ["d0"] };
  const holedReplay = new ClientStore(logSchema, holed).reexecute(thread, threadContext("c1"));
  assert(holedReplay.state === "partial" && holedReplay.partialSites.includes("thread.1"), "a drained page with an interior eviction still covered the thread");
  // A viewed view-once row as the last row of a Limit page (grok 3a): absent to the twin, the chain still links by the recorded id.
  const viewedLast = new ClientStore(logSchema, drainedReceipt({ Array: [{ Int: 2 }, { Id: "d2" }] }));
  viewedLast.remove("deliveries", "d2");
  const viewedReplay = viewedLast.reexecute(thread, threadContext("c1"));
  assert(viewedReplay.state === "fresh", `a viewed last row broke the drain chain: ${viewedReplay.partialSites.join(",")}`);
  assert(
    canonicalValue(viewedReplay.execution.result) === canonicalValue({ Array: [
      { Row: { id: { Id: "d3" }, message: rows[4]!.row } },
      { Row: { id: { Id: "d1" }, message: rows[3]!.row } },
    ] }),
    "the viewed row rendered, or the drained thread lost a row",
  );
  // A middle page re-marked Exhausted (grok 3b): a later page of the group holding a row the chain does not is refused;
  // one whose rows the chain already holds adds nothing and is tolerated.
  const d4 = { table: "deliveries", id: "d4", row: delivery("d4", "c1", "m1", 4) };
  const remarked = (tailIds: string[]): ClosureReceipt => ({
    ...drainedReceipt({ Array: [{ Int: 2 }, { Id: "d2" }] }),
    rows: [...rows, d4],
    ranges: [
      page("inbox.0", "byRecipientAt", [viewer], "Asc", null, ["d1", "d2"], "Limit"),
      page("inbox.0", "byRecipientAt", [viewer], "Asc", { Array: [{ Int: 2 }, { Id: "d2" }] }, ["d3"], "Exhausted"),
      page("inbox.0", "byRecipientAt", [viewer], "Asc", { Array: [{ Int: 3 }, { Id: "d3" }] }, tailIds, "Exhausted"),
    ],
  });
  const overClaim = new ClientStore(logSchema, remarked(["d4"])).reexecute(thread, threadContext("c1"));
  assert(overClaim.state === "partial" && overClaim.partialSites.includes("thread.1"), "a page past a re-marked Exhausted page still holding a row was counted as drained");
  const subset = new ClientStore(logSchema, remarked(["d3"])).reexecute(thread, threadContext("c1"));
  assert(subset.state === "fresh", `a page adding no row to the chain broke the drain: ${subset.partialSites.join(",")}`);
  // An exact page with a hole covers nothing whole either (the store calls its answer partial/evicted).
  const exactHoled: ClosureReceipt = { ...drainedReceipt(null), ranges: [{ ...page("thread.1", "byRecipientConversationAt", [viewer, { Id: "c1" }], "Desc", null, ["d3", "d1"], "Exhausted"), take: 50, evicted_ids: ["d5"] }] };
  const exactReplay = new ClientStore(logSchema, exactHoled).reexecute(thread, threadContext("c1"));
  assert(exactReplay.state === "partial" && exactReplay.partialSites.includes("thread.1"), "an exact page with an interior eviction still covered its site");
  // The trace: every point read carries its index, key, and the wire digest it saw; a hidden hit reads as an absence.
  const points = replay.execution.trace.points;
  const membershipPoint = points.find((point) => point.site === "thread.0");
  assert(membershipPoint !== undefined && membershipPoint.index === "byConversationPrincipal", "point trace lacks the index");
  assert(canonicalValue({ Array: membershipPoint.key }) === canonicalValue({ Array: [{ Id: "c1" }, viewer] }), "point trace lacks the key");
  assert(membershipPoint.digest === rowDigest(rows[5]!.row), "point digest is not the canonical wire row digest");
  assert(rowDigest(rows[5]!.row) === sha256(JSON.stringify(wireJson(rows[5]!.row))), "rowDigest is not sha256 of the wire row");
  const messagePoints = points.filter((point) => point.site === "thread.2");
  assert(messagePoints.length === 2 && messagePoints.every((point) => point.digest !== null), "message points lack digests");
  const messageRule = scopedRuleHash(logSchema, logSchema.tables.messages.rules.read);
  const inputsDigest = sha256(JSON.stringify(["memberships", "byConversationPrincipal", ["c1", "viewer"]]));
  assert(
    replay.execution.trace.verdicts.some((verdict) => verdict.rule_hash === messageRule && verdict.inputs_digest === inputsDigest && verdict.result === true),
    "the disclosed read rule's verdict was not traced",
  );
  // The memberships read rule is the same expression, so its verdict is the same (rule, inputs) fact, traced once.
  assert(replay.execution.trace.verdicts.length === 1, `traced verdicts: ${JSON.stringify(replay.execution.trace.verdicts)}`);
  // Hidden: without the membership the message read is an absence-shaped point and no verdict is traced.
  const hiddenStore = new ClientStore(logSchema, { ...drainedReceipt({ Array: [{ Int: 2 }, { Id: "d2" }] }), rows: rows.filter((row) => row.table !== "memberships") });
  const read = { name: "read", kind: "Query", args: {}, read_time_granularity_ms: null, body: [{ Return: { Get: { site: "read.0", table: "messages", index: "byId", key: [{ Literal: { Id: "m1" } }], provenance: "Const" } } }] };
  const hidden = hiddenStore.reexecute(read, threadContext("c1"));
  assert(hidden.execution.result === "Null" && hidden.execution.trace.points[0]!.digest === null, "a hidden hit did not trace as an absence");
  assert(hidden.execution.trace.verdicts.length === 0, "a failed rule check left verdicts on the trace");
  // `retain delivered-history`: a held row of a readable table renders without its rule.
  const retained = new ClientStore(logSchema, { ...drainedReceipt(null), rows: rows.filter((row) => row.table !== "memberships") }, { readable: ["messages"] });
  const kept = retained.reexecute(read, threadContext("c1"));
  assert(canonicalValue(kept.execution.result) === canonicalValue(rows[3]!.row), "a retained row did not render under local evaluation");
  // Writes: a mutation's final row images, deletes as null.
  const writerSchema = { tables: { notes: table({ id: "Id", body: { Text: { max: 10 } } }) }, maintains: [] };
  const writer = new ClientStore(writerSchema, emptyReceipt());
  const written = writer.applyMutation(mutation([
    { Insert: { table: "notes", row: literal({ Row: { id: { Id: "n1" }, body: { String: "a" } } }) } },
    { Insert: { table: "notes", row: literal({ Row: { id: { Id: "n2" }, body: { String: "b" } } }) } },
    { Delete: { table: "notes", key: literal({ Id: "n2" }) } },
  ]), context());
  assert(written.state === "predicted", "write set mutation was not predicted");
  assert(
    JSON.stringify(written.execution.writes.map((write) => [write.table, write.id, write.row === null ? null : canonicalValue(write.row)]))
      === JSON.stringify([["notes", "n1", canonicalValue({ Row: { id: { Id: "n1" }, body: { String: "a" } } })], ["notes", "n2", null]]),
    `write set was ${JSON.stringify(written.execution.writes)}`,
  );
}

// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — an unseen
// schema shape never hashes equal to a known one: a field the serde struct does
// not carry is refused, an unknown variant hashes deep-sorted and unlike anything known.
{
  const known = { tables: { notes: table({ id: "Id", body: { Text: { max: 10 } } }) }, maintains: [] };
  const knownHash = sha256(canonicalSchemaJson(known));
  const withIndexField = structuredClone(known) as any;
  withIndexField.tables.notes.indexes.byId.shard = 3;
  let refused: unknown;
  try { canonicalSchemaJson(withIndexField); } catch (error) { refused = error; }
  assert(refused instanceof EvalError && refused.code === "E_SCHEMA" && /index field shard/.test(refused.message), "a novel index field was hashed instead of refused");
  const withColumnField = structuredClone(known) as any;
  withColumnField.tables.notes.columns.body = { Text: { max: 10, collation: "und" } };
  refused = undefined;
  try { canonicalSchemaJson(withColumnField); } catch (error) { refused = error; }
  assert(refused instanceof EvalError && /column.Text field collation/.test(refused.message), "a novel column payload was hashed instead of refused");
  const withTableField = structuredClone(known) as any;
  withTableField.tables.notes.ttl = 5;
  refused = undefined;
  try { canonicalSchemaJson(withTableField); } catch (error) { refused = error; }
  assert(refused instanceof EvalError && /table field ttl/.test(refused.message), "a novel table field was hashed instead of refused");
  // An unknown rule variant is kept whole, deep-sorted: the same shape in another key order hashes the same, and never as the known schema.
  const novelRule = structuredClone(known) as any;
  novelRule.tables.notes.rules.read = { Within: { until: 5, since: 1, of: { b: 1, a: 2 } } };
  const reordered = structuredClone(known) as any;
  reordered.tables.notes.rules.read = { Within: { of: { a: 2, b: 1 }, since: 1, until: 5 } };
  const novelHash = sha256(canonicalSchemaJson(novelRule));
  assert(novelHash === sha256(canonicalSchemaJson(reordered)), "an unknown rule variant did not hash deterministically across key orders");
  assert(novelHash !== knownHash, "an unknown rule variant hashed as the known schema");
  assert(canonicalSchemaJson(novelRule).includes('{"Within":{"of":{"a":2,"b":1},"since":1,"until":5}}'), `unknown variant payload was not deep-sorted: ${canonicalSchemaJson(novelRule)}`);
  const novelConstraint = structuredClone(known) as any;
  novelConstraint.tables.notes.constraints = [{ Monotone: { field: "at", zzz: 1, aaa: 2 } }];
  assert(canonicalSchemaJson(novelConstraint).includes('{"Monotone":{"aaa":2,"field":"at","zzz":1}}'), "unknown constraint payload was not deep-sorted");
  assert(sha256(canonicalSchemaJson(novelConstraint)) !== knownHash);
  const novelColumn = structuredClone(known) as any;
  novelColumn.tables.notes.columns.body = { Geo: { srid: 4326, dims: 2 } };
  assert(canonicalSchemaJson(novelColumn).includes('{"Geo":{"dims":2,"srid":4326}}'), "unknown column kind payload was not deep-sorted");
  // `List` payloads are structs too: a novel field on a column list or on a channel argument list is refused, never dropped.
  const withListColumnField = structuredClone(known) as any;
  withListColumnField.tables.notes.columns.tags = { List: { of: { Text: { max: 4 } }, max: 3, shard: 1 } };
  refused = undefined;
  try { canonicalSchemaJson(withListColumnField); } catch (error) { refused = error; }
  assert(refused instanceof EvalError && refused.code === "E_SCHEMA" && /column\.List field shard/.test(refused.message), "a novel column List field was hashed instead of refused");
  const withChannel = structuredClone(known) as any;
  withChannel.channels = { typing: { args: { ids: { List: { of: "Id", max: 4 } } },
    value: { typing: "Bool", note: { Optional: { Text: { max: 20 } } } }, publish: "Allow", subscribe: "Allow", ttl_ms: 1_000 } };
  const channelHash = sha256(canonicalSchemaJson(withChannel));
  assert(channelHash !== knownHash && canonicalSchemaJson(withChannel).includes('"ids":{"List":{"of":"Id","max":4}}'), "the channel List argument did not hash in serde order");
  const withListArgField = structuredClone(withChannel) as any;
  withListArgField.channels.typing.args.ids.List.shard = 1;
  refused = undefined;
  try { canonicalSchemaJson(withListArgField); } catch (error) { refused = error; }
  assert(refused instanceof EvalError && refused.code === "E_SCHEMA" && /arg\.List field shard/.test(refused.message), "a novel channel-argument List field was hashed instead of refused");
  const withValue = structuredClone(withChannel);
  withValue.channels.typing.value.typing = "Int";
  assert(sha256(canonicalSchemaJson(withValue)) !== channelHash, "a changed channel value descriptor reused its schema hash");
  const sortedValue = structuredClone(withChannel);
  sortedValue.channels.typing.value = { note: { Optional: { Text: { max: 20 } } }, typing: "Bool" };
  assert(sha256(canonicalSchemaJson(sortedValue)) === channelHash, "channel value field order changed its schema hash");
  const novelValue = structuredClone(withChannel);
  novelValue.channels.typing.value.note.Optional.Text.novel = true;
  refused = undefined;
  try { canonicalSchemaJson(novelValue); } catch (error) { refused = error; }
  assert(refused instanceof EvalError && refused.code === "E_SCHEMA", "a novel channel-value descriptor field was silently dropped");
  for (const value of [undefined, null, [], {}]) {
    const invalid = structuredClone(withChannel);
    invalid.channels.typing.value = value;
    refused = undefined;
    try { canonicalSchemaJson(invalid); } catch (error) { refused = error; }
    assert(refused instanceof EvalError && refused.code === "E_SCHEMA", "missing or empty channel value declaration was admitted");
  }
  assert(channelHash === sha256(canonicalSchemaJson(structuredClone(withChannel))), "the known channel hash moved");
  // The known schema itself still hashes as before the strictness landed.
  assert(knownHash === sha256(canonicalSchemaJson(structuredClone(known))), "the known hash moved");
}

// @ref LLP 1001#unicode-search-foundation — unknown future loop domains keep
// their external tag while known domains continue through canonical v5 custody.
{
  const program = (domain: unknown) => ({ name: "q", kind: "Query", args: {}, read_time_granularity_ms: null,
    body: [{ For: { binding: "item", domain, body: [] } }, { Return: { Literal: "Null" } }] });
  const controls = [
    ["x", { "0": "x" }],
    [[{ Literal: "Null" }], { "0": { Literal: "Null" } }],
    [{ FutureDomain: { z: 1, a: 2 } }, { FutureDomain: { z: 1, a: 2 } }],
    [{ LiteralRange: { end_exclusive: 1, start: 0 } }, { LiteralRange: { start: 0, end_exclusive: 1 } }],
  ] as const;
  for (const [domain, expected] of controls) {
    const canonical = JSON.parse(canonicalProgramJson(program(domain)));
    assert(JSON.stringify(canonical.body[0].For.domain) === JSON.stringify(expected),
      `canonical domain tag/payload changed for ${JSON.stringify(domain)}`);
  }
  for (const kind of ["constructor", "toString", "__proto__"]) {
    const statement = { [kind]: { future: true } };
    const canonical = JSON.parse(canonicalProgramJson({ ...program("items"), body: [statement] }));
    assert(canonical.body[0][kind].future === true, `statement tag ${kind} inherited a known-variant descriptor`);
  }
  expectCode(() => canonicalProgramJson(program({})), "E_TRACE_SUBSET", "empty loop-domain tag");
}

// @ref LLP 1012#5-retention-revocation-and-the-fence — `tombstones` joins schema
// identity only when declared: absent and empty hash alike, a declaration hashes in
// serde's field order after `retain` with `when` in the rule encoding, and the
// corpus golden proves the form equals Rust's `Schema::hash()`.
{
  const log = table({ id: "Id", messageId: { Ref: { table: "messages" } }, kind: { Enum: { variants: ["message", "removed", "expired"] } } });
  const bare = { tables: { messages: table({ id: "Id", body: { Text: { max: 10 } } }), deliveries: log }, maintains: [] };
  const bareHash = sha256(canonicalSchemaJson(bare));
  const empty = structuredClone(bare) as any;
  empty.tables.deliveries.tombstones = [];
  assert(sha256(canonicalSchemaJson(empty)) === bareHash, "an empty tombstones list moved a hash serde would not");
  for (const value of [{}, null, "removed"]) {
    const malformed = structuredClone(bare) as any;
    malformed.tables.deliveries.tombstones = value;
    let refusedContainer: unknown;
    try { canonicalSchemaJson(malformed); } catch (error) { refusedContainer = error; }
    assert(refusedContainer instanceof EvalError && refusedContainer.code === "E_SCHEMA" && /table tombstones must be an array/.test(refusedContainer.message),
      `malformed present tombstones ${JSON.stringify(value)} was omitted from the hash or threw an untyped error`);
  }
  const when = { Or: [{ Eq: [{ Field: "kind" }, { Literal: { String: "removed" } }] }, { Eq: [{ Field: "kind" }, { Literal: { String: "expired" } }] }] };
  const declared = structuredClone(bare) as any;
  declared.tables.deliveries.tombstones = [{ when, column: "messageId", table: "messages" }];
  const declaredJson = canonicalSchemaJson(declared);
  assert(declaredJson.includes('"retain":"until-revoked","tombstones":[{"table":"messages","column":"messageId","when":{"Or":[{"Eq":[{"Field":"kind"},{"Literal":{"String":"removed"}}]},{"Eq":[{"Field":"kind"},{"Literal":{"String":"expired"}}]}]}}]}'),
    `tombstones did not canonicalize in serde order: ${declaredJson}`);
  assert(sha256(declaredJson) !== bareHash, "a tombstones declaration is not part of schema identity");
  const golden = (manifest as any[]).find((item) => item.name === "tombstones-log-schema-identity");
  assert(golden, "the tombstones corpus golden is missing; run export_corpus");
  assert(golden.schema.tables.deliveries.tombstones.length === 1, "the golden lost its declaration");
  assert(golden.certificate.schema_hash === sha256(canonicalSchemaJson(golden.schema)), "the evaluator's tombstones hash differs from Rust's Schema::hash()");
  const novel = structuredClone(declared) as any;
  novel.tables.deliveries.tombstones[0].shard = 1;
  let refusedTombstone: unknown;
  try { canonicalSchemaJson(novel); } catch (error) { refusedTombstone = error; }
  assert(refusedTombstone instanceof EvalError && refusedTombstone.code === "E_SCHEMA" && /tombstone field shard/.test(refusedTombstone.message), "a novel tombstone field was hashed instead of refused");
}

console.log(
  JSON.stringify({
    cases: cases.length,
    passed: cases.length,
    serverOnly: serverOnly.length,
    failed: 0,
    corruptionPath: "replay-mismatch",
  }),
);
