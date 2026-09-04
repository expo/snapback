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
  type Context,
  type CorpusCase,
  type Value,
} from "./evaluator";
import { canonicalSchemaJson } from "./certificate-identity";

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
  indexes: { byId: { columns: ["id"], unique: true } },
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
      byId: { columns: ["id"], unique: true },
      byPair: { columns: ["viewerId", "authorId"], unique: true },
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

console.log(
  JSON.stringify({
    cases: cases.length,
    passed: cases.length,
    failed: 0,
    corruptionPath: "replay-mismatch",
  }),
);
