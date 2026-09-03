import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
// @ts-ignore generated corpus JSON has no declaration file
import scenarioHydrate from "../../../corpus/scenario-hydrate.json";
import {
  CURRENT_VALUE_MODEL_VERSION,
  ClientStore,
  canonicalValue,
  evaluateCase,
  scopedRuleHash,
  sha256,
  type ClosureReceipt,
  type Context,
  type CorpusCase,
  type Value,
} from "../../evaluator/src/evaluator";
import { canonicalSchemaJson } from "../../evaluator/src/certificate-identity";
import type { TableInfo } from "./compiler";
import { lowerSource } from "./compiler";
import type { Program } from "./ir";
import { lowerSchema } from "./lower/schema";
import { compileJourneys, lowerProject as lowerAuthoredProject, lowerSeed } from "./project";
import { rustCheck } from "./rust-check";

type Register = (name: string, run: () => void | Promise<void>) => void;

const frontend = decodeURIComponent(new URL("../", import.meta.url).pathname);
const snapback2Root = resolve(frontend, "../..");
const emptyReceipt: ClosureReceipt = { rows: [], ranges: [], absences: [], verdicts: [] };
const lowerProject = (root: string) => lowerAuthoredProject(root, { authoring: "any" });

function context(args: Record<string, Value> = {}, newIds: string[] = []): Context {
  return { viewer: "viewer", principal_kind: "user", auth_epoch: 1, args, now: 1, new_ids: newIds, read_time: 1 };
}

function runProgram(
  program: Program,
  args: Record<string, Value> = {},
  newIds: string[] = [],
  schema: any = { tables: {} },
  receipt: ClosureReceipt = emptyReceipt,
): { result: Value; store: ClientStore } {
  const store = new ClientStore(schema, receipt);
  const execution = program.kind === "Mutation"
    ? store.applyMutation(program, context(args, newIds))
    : store.reexecute(program, context(args, newIds));
  return { result: execution.execution.result, store };
}

async function withProject<T>(files: Record<string, string>, run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "snapback2-verified-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source);
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function tableInfo(name: string, columns: TableInfo["columns"] = {}): Map<string, TableInfo> {
  return new Map([[name, {
    name,
    private: false,
    columns,
    indexes: { byId: { columns: ["id"], types: [{ kind: "string" }] } },
  }]]);
}

function evaluatorTable(columns: Record<string, unknown> = {}): any {
  return {
    columns: { id: "Id", ...columns },
    indexes: { byId: { columns: ["id"], unique: true } },
    rules: { read: "Allow", insert: "Allow", update: "Allow", delete: "Allow" },
    constraints: [],
  };
}

function evaluatorProgram(kind: "Query" | "Mutation", body: any[], args: Record<string, unknown> = {}): any {
  return { name: "verified.program", kind, args, read_time_granularity_ms: null, body };
}

function literal(value: Value): any {
  return { Literal: value };
}

function evaluatorCase(schema: any, program: any): CorpusCase {
  return {
    corpusVersion: 1,
    name: "verified-case",
    category: "verified-regression",
    randomSeed: null,
    schema,
    program,
    certificate: {
      value_model_version: CURRENT_VALUE_MODEL_VERSION,
      plan_hash: sha256(JSON.stringify(program)),
      schema_hash: sha256(JSON.stringify(schema)),
    },
    context: context(),
    receipt: emptyReceipt,
    prelude: [],
    replacementReceipt: null,
    expected: {
      localResult: "Null",
      errorCode: null,
      localState: "fresh",
      partialSites: [],
      canonicalResult: '"Null"',
      digest: sha256('"Null"'),
      rangeStops: {},
      evictedRows: null,
    },
  };
}

export function registerVerifiedRegressionTests(
  test: Register,
  assert: (condition: unknown, message: string) => asserts condition,
): void {
  test("F21 evaluator preserves colons in authored require codes", () => {
    const schema = { tables: {}, maintains: [] };
    const lowered = lowerSource(`import { query } from "snapback2";
      export const denied = query({}, ({ db }) => {
        db.require(false, "AUTH:DENIED");
        return null;
      });`, "require-colon.ts");
    assert(lowered.ok, `colon Require fixture refused: ${lowered.ok ? "" : lowered.diagnostics[0]?.message}`);
    const program = lowered.programs[0]!;
    const outcome = evaluateCase(evaluatorCase(schema, program));
    assert(outcome.localState === "denied", `Require query used ${outcome.localState}`);
    assert(outcome.errorCode === "AUTH:DENIED", `Require code became ${outcome.errorCode}`);
  });

  test("F8 only an exact authority-issued byId absence initializes a maintained target", () => {
    const schema = { tables: {
      counts: evaluatorTable({ group: "Id", value: "Int" }),
      source: evaluatorTable({ group: "Id" }),
    },
      maintains: [{ kind: "Count", source: "source", by: ["group"], target: "counts", readable: null }],
    };
    const countId = '[{"Id":"g"}]';
    const inexactReceipt: ClosureReceipt = {
      schema_hash: sha256(canonicalSchemaJson(schema)),
      rows: [],
      ranges: [],
      absences: [["counts", "byId", [{ Id: "some-other-group" }]]],
      verdicts: [],
    };
    const inexactStore = new ClientStore(schema, inexactReceipt);
    const inexact = inexactStore.applyMutation(evaluatorProgram("Mutation", [{ Insert: {
      table: "source",
      row: literal({ Row: { id: { Id: "s1" }, group: { Id: "g" } } }),
    } }]), context());
    assert(inexact.state === "partial", `inexact maintained-target absence used ${inexact.state}`);
    assert(inexactStore.byId("source", "s1") === null, "partial prediction leaked its source insert");

    const exactReceipt: ClosureReceipt = {
      schema_hash: sha256(canonicalSchemaJson(schema)),
      rows: [],
      ranges: [],
      absences: [["counts", "byId", [{ Id: countId }]]],
      verdicts: [],
    };
    const store = new ClientStore(schema, exactReceipt);
    const predicted = store.applyMutation(evaluatorProgram("Mutation", [{ Insert: {
      table: "source",
      row: literal({ Row: { id: { Id: "s2" }, group: { Id: "g" } } }),
    } }]), context());
    assert(predicted.state === "predicted", `exact maintained-target absence used ${predicted.state}`);
    assert(store.byId("source", "s2") !== null, "predicted source insert was discarded");
    assert(
      canonicalValue(store.byId("counts", countId)!) === canonicalValue({
        Row: { group: { Id: "g" }, id: { Id: countId }, value: { Int: 1 } },
      }),
      "exact maintained-target absence did not initialize the aggregate",
    );

    const predecessorReceipt: ClosureReceipt = {
      ...exactReceipt,
      schema_hash: sha256(canonicalSchemaJson({ ...schema, maintains: [] })),
    };
    const successorStore = new ClientStore(schema, predecessorReceipt);
    const successor = successorStore.applyMutation(evaluatorProgram("Mutation", [{ Insert: {
      table: "source",
      row: literal({ Row: { id: { Id: "s3" }, group: { Id: "g" } } }),
    } }]), context());
    assert(successor.state === "partial", `predecessor absence used ${successor.state}`);
    assert(
      JSON.stringify(successor.partialSites) === JSON.stringify(["missing-authority"]),
      `predecessor absence named ${JSON.stringify(successor.partialSites)}`,
    );
    assert(successorStore.byId("source", "s3") === null, "successor prediction leaked its source insert");
  });

  test("F6 Cap checks updates entering full single- and multi-field groups", () => {
    const cards = {
      ...evaluatorTable({ boardId: "Id", laneId: "Id", title: { Text: { max: 20 } } }),
      indexes: {
        byId: { columns: ["id"], unique: true },
        byBoard: { columns: ["boardId", "id"], unique: false },
        byBoardLane: { columns: ["boardId", "laneId", "id"], unique: false },
      },
      constraints: [{ Cap: { by: ["boardId"], max: 2 } }],
    };
    const schema = { tables: { cards }, maintains: [] };
    const rows: Array<[string, string, string]> = [
      ["a1", "A", "1"],
      ["b1", "B", "1"],
      ["b2", "B", "1"],
    ];
    const receipt: ClosureReceipt = {
      rows: rows.map(([id, boardId, laneId]) => ({ table: "cards", id, row: {
        Row: { id: { Id: id }, boardId: { Id: boardId }, laneId: { Id: laneId }, title: { String: id } },
      } })),
      ranges: [{
        site: "cap.coverage",
        table: "cards",
        index: "byBoard",
        prefix: [{ Id: "B" }],
        order: "Asc",
        take: 2,
        after: null,
        before: null,
        gt: null,
        gte: null,
        lt: null,
        lte: null,
        rule_hash: scopedRuleHash(schema, cards.rules.read),
        row_ids: ["b1", "b2"],
        stop: "Exhausted",
        absence: false,
        halo: null,
        n2_key: null,
      }],
      absences: [],
      verdicts: [],
    };
    const store = new ClientStore(schema, receipt);
    let code = "";
    try {
      store.applyMutation(evaluatorProgram("Mutation", [{ Update: {
        table: "cards",
        key: literal({ Id: "a1" }),
        patch: literal({ Row: { boardId: { Id: "B" } } }),
      } }]), context());
    } catch (error) {
      code = error instanceof Error ? error.message : String(error);
    }
    assert(code.startsWith("E_CONSTRAINT:"), `update into full Cap group produced ${code || "predicted"}`);
    assert(canonicalValue(store.byId("cards", "a1")!) === canonicalValue(receipt.rows[0]!.row), "refused Cap move changed the row");

    const sameGroup = store.applyMutation(evaluatorProgram("Mutation", [{ Update: {
      table: "cards",
      key: literal({ Id: "a1" }),
      patch: literal({ Row: { title: { String: "renamed" } } }),
    } }]), context());
    assert(sameGroup.state === "predicted", "same-prefix Cap update was refused");

    const multiCards = { ...cards, constraints: [{ Cap: { by: ["boardId", "laneId"], max: 2 } }] };
    const multiSchema = { tables: { cards: multiCards }, maintains: [] };
    const multiReceipt: ClosureReceipt = {
      ...receipt,
      ranges: [{ ...receipt.ranges[0]!, index: "byBoardLane", prefix: [{ Id: "B" }, { Id: "1" }] }],
    };
    const multiStore = new ClientStore(multiSchema, multiReceipt);
    let multiCode = "";
    try {
      multiStore.applyMutation(evaluatorProgram("Mutation", [{ Update: {
        table: "cards",
        key: literal({ Id: "a1" }),
        patch: literal({ Row: { boardId: { Id: "B" } } }),
      } }]), context());
    } catch (error) {
      multiCode = error instanceof Error ? error.message : String(error);
    }
    assert(multiCode.startsWith("E_CONSTRAINT:"), `multi-field Cap move produced ${multiCode || "predicted"}`);
  });

  test("F15 certificate identity canonicalizes Rust BTreeMap fields", () => {
    const baseline = evaluateCase(JSON.parse(JSON.stringify(scenarioHydrate)) as CorpusCase);
    const schemaCase = JSON.parse(JSON.stringify(scenarioHydrate)) as CorpusCase;
    schemaCase.schema.tables = Object.fromEntries(Object.entries(schemaCase.schema.tables).reverse());
    const reordered = evaluateCase(schemaCase);
    assert(
      reordered.localState === baseline.localState &&
        JSON.stringify(reordered.partialSites) === JSON.stringify(baseline.partialSites) &&
        reordered.canonicalResult === baseline.canonicalResult &&
        reordered.digest === baseline.digest,
      "scenario-hydrate table order changed certificate identity or replay state",
    );

    const a = evaluatorTable({ value: "Int" });
    const z = evaluatorTable({ value: "Int" });
    const canonicalSchema = { tables: { a, z }, maintains: [] };
    const canonicalProgram = evaluatorProgram("Query", [{ Return: literal("Null") }], { a: "Int", z: "Int" });
    const reorderedProgram = { ...canonicalProgram, args: { z: "Int", a: "Int" } };
    const programCase = evaluatorCase(canonicalSchema, reorderedProgram);
    programCase.certificate.plan_hash = sha256(JSON.stringify(canonicalProgram));
    programCase.context = context({ a: { Int: 1 }, z: { Int: 2 } });
    assert(evaluateCase(programCase).localState === "fresh", "program arg order changed certificate identity");
  });

  test("schema index width is refused before storage", () => {
    const columns = Array.from({ length: 9 }, (_, index) => `c${index}: t.int()`).join(", ");
    const names = (count: number) => Array.from({ length: count }, (_, index) => `'c${index}'`).join(", ");
    const source = `import { schema, table, t } from "snapback2";
      export const rows = table({ columns: { ${columns} }, indexes: {
        empty: { columns: [] }, supported: { columns: [${names(8)}] }, tooWide: { columns: [${names(9)}] },
      } }); export default schema({ tables: { rows } });`;
    const lowered = lowerSchema(source, "snapback/schema.ts");
    const messages = lowered.diagnostics.filter((item) => item.code === "E_SCHEMA_INDEX_COLUMN").map((item) => item.message);
    assert(messages.some((message) => message.includes("non-empty")), "empty index was admitted");
    assert(messages.some((message) => message.includes("at most 8")), "nine-column index was admitted");
    assert(!messages.some((message) => message.includes("supported")), "eight-column index was refused");
  });

  test("authored update patches cannot carry id", () => {
    const tables = new Map<string, TableInfo>([["items", {
      name: "items", private: false, columns: { id: { kind: "string" }, label: { kind: "string", max: 32 } },
    }]]);
    const source = `import { mutation } from "snapback2";
      export const bad = mutation({}, ({ db }) => db.update(items, "a", { id: "b", label: "new" }));`;
    const lowered = lowerSource(source, "identity.ts", undefined, { tables });
    assert(!lowered.ok && lowered.diagnostics.some((item) => item.code === "E_SCHEMA_ID_RESERVED"),
      "compiler admitted an id-changing update patch");
  });

  test("F14 upsert certification distinguishes separately consuming identities", () => {
    const tables = new Map<string, TableInfo>([["items", {
      name: "items",
      private: false,
      columns: { id: { kind: "string" }, label: { kind: "string", max: 32 } },
      indexes: { byId: { columns: ["id"], types: [{ kind: "string" }] } },
    }]]);
    const refused = lowerSource(`import { mutation } from "snapback2";
      export const bad = mutation({}, ({ db, ctx }) =>
        db.upsert(items, ctx.newId(), { id: ctx.newId(), label: "x" }));`,
    "upsert-identity.ts", undefined, { tables });
    assert(!refused.ok && refused.diagnostics.some((item) =>
      item.code === "E_SCHEMA_ID_RESERVED" && item.rewrite.includes("const rowId = ctx.newId()")),
    `separately consuming upsert identities compiled: ${JSON.stringify(refused)}`);

    const aliased = lowerSource(`import { mutation } from "snapback2";
      export const bad = mutation({}, ({ db, ctx }) => {
        const keyId = ctx.newId();
        const row = { id: ctx.newId(), label: "x" };
        db.upsert(items, keyId, row);
      });`, "upsert-identity-alias.ts", undefined, { tables });
    assert(!aliased.ok && aliased.diagnostics.some((item) => item.code === "E_SCHEMA_ID_RESERVED"),
      `an aliased separately consuming upsert identity compiled: ${JSON.stringify(aliased)}`);

    const lowered = lowerSource(`import { mutation } from "snapback2";
      export const good = mutation({}, ({ db, ctx }) => {
        const itemId = ctx.newId();
        const row = { id: itemId, label: "x" };
        db.upsert(items, itemId, row);
      });`, "upsert-identity.ts", undefined, { tables });
    assert(lowered.ok, `upsert identity fixture did not lower: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    const schema = {
      tables: { items: evaluatorTable({ label: { Text: { max: 32 } } }) },
      maintains: [], channels: {}, auth: { password: false, guests: false }, effects: [],
    };
    const checked = rustCheck(lowered.programs, "synthetic", schema);
    const good = checked.find((item) => item.program === "good");
    assert(good?.error === null && good.certificate,
      `an identity bound once did not certify: ${JSON.stringify(good)}`);
  });

  test("F14 evaluator rejects upsert identity divergence atomically", () => {
    const schema = { tables: { items: evaluatorTable({ label: { Text: { max: 32 } } }) }, maintains: [] };
    const store = new ClientStore(schema, emptyReceipt);
    const program = evaluatorProgram("Mutation", [{ Upsert: {
      table: "items",
      key: { Input: "NewId" },
      row: { Object: { id: { Input: "NewId" }, label: literal({ String: "x" }) } },
    } }]);
    let refusal = "";
    try {
      store.applyMutation(program, context({}, ["key-id", "row-id"]));
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    assert(refusal.includes("E_INPUT") && refusal.includes("does not match row id"),
      `evaluator predicted an insert for divergent upsert identities: ${refusal || canonicalValue(store.byId("items", "row-id")!)}`);
    assert(store.byId("items", "key-id") === null && store.byId("items", "row-id") === null,
      "a rejected upsert changed the client store");
  });

  test("collection operands lower once and Map/Set preserve JavaScript uniqueness", () => {
    const lowered = lowerSource(`import { mutation } from "snapback2";
      export const collections = mutation({}, ({ ctx }) => {
        const map = new Map([["x", 1], ["x", 2]]);
        map.set("x", 3);
        const set = new Set(["x", "x"]);
        set.add("x");
        const lookup = new Map([["a", 1], ["b", 2]]);
        const lookedUp = lookup.get(ctx.newId());
        const dynamic = new Set(["existing"]);
        dynamic.add(ctx.newId());
        const [lo, hi] = orderedPair(ctx.newId(), ctx.newId());
        return [map.size, map.get("x"), set.size, lookedUp, dynamic.size, lo, hi, ctx.newId()];
      });`, "collections.ts");
    assert(lowered.ok, `collections refused: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
    const result = runProgram(lowered.programs[0]!, {}, ["needle", "added", "a", "b", "after"]).result;
    assert(canonicalValue(result) === canonicalValue({ Array: [
      { Int: 1 }, { Int: 3 }, { Int: 1 }, "Null", { Int: 2 },
      { Id: "a" }, { Id: "b" }, { Id: "after" },
    ] }), `collection semantics or operand evaluation diverged: ${canonicalValue(result)}`);
  });

  test("Map.set evaluates key before setup-bearing value", () => {
    const lowered = lowerSource(`import { mutation } from "snapback2";
      export const ordered = mutation({}, ({ ctx }) => {
        const map = new Map();
        map.set(ctx.newId(), true ? ctx.newId() : "x");
        return [map.get(ctx.newId()), ctx.newId()];
      });
      export const constructed = mutation({}, ({ ctx }) => {
        const map = new Map([[ctx.newId(), true ? ctx.newId() : "x"]]);
        return [map.get(ctx.newId()), ctx.newId()];
      });`, "map-set-order.ts");
    assert(lowered.ok, `Map.set order fixture refused: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
    for (const program of lowered.programs) {
      const result = runProgram(program, {}, ["first", "second", "second", "after"]).result;
      assert(canonicalValue(result) === canonicalValue({ Array: ["Null", { Id: "after" }] }),
        `${program.name} reversed authored operand evaluation: ${canonicalValue(result)}`);
    }
  });

  test("Map and Set use JavaScript SameValueZero for primitive authored values", () => {
    const lowered = lowerSource(`import { mutation } from "snapback2";
      export const unique = mutation({}, ({ ctx }) => {
        const set = new Set(["same"]);
        set.add(ctx.newId());
        const map = new Map([["same", 1]]);
        map.set(ctx.newId(), 2);
        const values = new Map([["object", { value: 3 }]]);
        return [set.size, map.size, map.get("same"), values.get("object").value];
      });`, "collection-same-value-zero.ts");
    assert(lowered.ok, `primitive collection fixture refused: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
    const result = runProgram(lowered.programs[0]!, {}, ["same", "same"]).result;
    assert(canonicalValue(result) === canonicalValue({ Array: [{ Int: 1 }, { Int: 1 }, { Int: 2 }, { Int: 3 }] }),
      `primitive collection uniqueness diverged: ${canonicalValue(result)}`);
  });

  test("composite Map keys and Set values refuse before identity is lost", () => {
    const lowered = lowerSource(`import { query } from "snapback2";
      export const constructors = query({}, () => {
        const first = { value: 1 };
        const second = { value: 1 };
        const set = new Set([first, second]);
        const map = new Map([[first, 1], [second, 2]]);
        return [set.size, map.size];
      });
      export const setAdd = query({}, () => { const set = new Set(); set.add({ value: 1 }); return set.size; });
      export const setHas = query({}, () => { const set = new Set(); return set.has({ value: 1 }); });
      export const mapSet = query({}, () => { const map = new Map(); map.set({ value: 1 }, 1); return map.size; });
      export const mapGet = query({}, () => { const map = new Map(); return map.get({ value: 1 }); });
      export const mapHas = query({}, () => { const map = new Map(); return map.has({ value: 1 }); });`, "collection-identity.ts");
    assert(!lowered.ok && lowered.diagnostics.length >= 6
      && lowered.diagnostics.every((item) => item.code === "E_OPAQUE" && item.message.includes("primitive")),
      "composite collection identity was represented structurally");
  });

  test("builtin arities are enforced and variadic min/max lower without truncation", () => {
    const invalid = lowerSource(`import { concat, max, query } from "snapback2";
      export const emptyMax = query({}, () => max());
      export const emptyConcat = query({}, () => concat());
      export const shortSlice = query({}, () => "hello".slice(1));`, "arity-invalid.ts");
    assert(!invalid.ok && invalid.diagnostics.filter((item) => item.message.includes("requires")).length === 3,
      "unsupported builtin arities were admitted");
    const variadic = lowerSource(`import { max, min, query } from "snapback2";
      export const values = query({}, () => [max(1, 2, 100), min(3, 2, -10)]);`, "arity-valid.ts");
    assert(variadic.ok, `variadic min/max refused: ${variadic.ok ? "" : variadic.diagnostics.map((item) => item.message).join("; ")}`);
    const result = runProgram(variadic.programs[0]!).result;
    assert(canonicalValue(result) === canonicalValue({ Array: [{ Int: 100 }, { Int: -10 }] }), "variadic min/max truncated operands");
  });

  test("Quarry-shaped Id composites certify and execute without scalar false positives", () => {
    const id = { kind: "string", id: true } as const;
    const tables = new Map<string, TableInfo>([
      ["items", { name: "items", private: false,
        columns: { id, at: { kind: "int" }, label: { kind: "string", max: 80 } },
        indexes: { byId: { columns: ["id"], types: [id] }, byAt: { columns: ["at", "id"], types: [{ kind: "int" }, id] } } }],
      ["pairs", { name: "pairs", private: false,
        columns: { id, lo: id, hi: id },
        indexes: { byId: { columns: ["id"], types: [id] }, byPair: { columns: ["lo", "hi"], types: [id, id] } } }],
      ["nodes", { name: "nodes", private: false,
        columns: { id, parent: { kind: "optional", of: id }, name: { kind: "string", max: 80 } },
        indexes: { byId: { columns: ["id"], types: [id] } } }],
    ]);
    const source = lowerSource(`import { concat, mutation, query, t } from "snapback2";
declare const items: any, pairs: any, nodes: any;
function orderedPair(l: any, r: any) { return [l, r]; }
export const addPair = mutation({ a: t.id(), b: t.id() }, ({ db, ctx, args }) => {
  const [lo, hi] = orderedPair(args.a, args.b);
  db.insert(pairs, { id: ctx.newId(), lo, hi });
  return null;
});
export const parent = query({ seed: t.id() }, ({ db, args }) => {
  const node = db.get(nodes, args.seed)!;
  const key = node.parent ?? null;
  let parent = null;
  if (key !== null) parent = db.get(nodes, key);
  return parent;
});
export const pair = query({ a: t.id(), b: t.id() }, ({ db, args }) => {
  const key = [args.a, args.b];
  return db.get(pairs.byPair, key);
});
export const page = query({}, ({ db }) => {
  let next: any[] = [];
  for (const row of db.scan(items.byAt, [], { take: 1 })) {
    next = db.scan(items.byAt, [], { take: 2, after: [row.at, row.id] });
  }
  return next;
});
export const enumText = mutation({ kind: t.enum(["a", "b"]) }, ({ db, ctx, args }) => {
  db.insert(items, { id: ctx.newId(), at: 1, label: args.kind });
  return null;
});
export const compositeId = mutation({ a: t.id(), b: t.id() }, ({ db, args }) => {
  db.insert(items, { id: concat(args.a, args.b), at: 2, label: "pair" });
  return null;
});`, "quarry-id-shapes.ts", undefined, { tables });
    assert(source.ok, `Quarry-shaped Id constructs refused: ${source.ok ? "" : JSON.stringify(source.diagnostics)}`);
    const schema = { tables: {
      items: { ...evaluatorTable({ at: "Int", label: { Text: { max: 80 } } }), indexes: {
        byId: { columns: ["id"], unique: true }, byAt: { columns: ["at", "id"], unique: false },
      } },
      pairs: { ...evaluatorTable({ lo: "Id", hi: "Id" }), indexes: {
        byId: { columns: ["id"], unique: true }, byPair: { columns: ["lo", "hi"], unique: true },
      } },
      nodes: evaluatorTable({ parent: { Optional: "Id" }, name: { Text: { max: 80 } } }),
    }, maintains: [], channels: {}, auth: { password: false, guests: false }, effects: [] };
    const checked = rustCheck(source.programs, "synthetic", schema);
    assert(checked.every((item) => item.error === null), `Quarry-shaped Id constructs failed raw certification: ${JSON.stringify(checked)}`);
    const programs = new Map(source.programs.map((program) => [program.name, program]));

    runProgram(programs.get("addPair")!, { a: { Id: "a" }, b: { Id: "b" } }, ["pair-row"], schema);
    runProgram(programs.get("enumText")!, { kind: { String: "a" } }, ["enum-row"], schema);
    runProgram(programs.get("compositeId")!, { a: { Id: "a" }, b: { Id: "b" } }, [], schema);

    const held: ClosureReceipt = { ...emptyReceipt, rows: [
      { table: "nodes", id: "seed", row: { Row: { id: { Id: "seed" }, parent: { Id: "parent" }, name: { String: "seed" } } } },
      { table: "nodes", id: "parent", row: { Row: { id: { Id: "parent" }, parent: "Null", name: { String: "parent" } } } },
      { table: "pairs", id: "held-pair", row: { Row: { id: { Id: "held-pair" }, lo: { Id: "a" }, hi: { Id: "b" } } } },
      { table: "items", id: "row-a", row: { Row: { id: { Id: "row-a" }, at: { Int: 1 }, label: { String: "a" } } } },
      { table: "items", id: "row-b", row: { Row: { id: { Id: "row-b" }, at: { Int: 2 }, label: { String: "b" } } } },
    ] };
    const parent = runProgram(programs.get("parent")!, { seed: { Id: "seed" } }, [], schema, held).result;
    assert(canonicalValue(parent).includes('"parent"'), `guarded optional parent did not execute: ${canonicalValue(parent)}`);
    const pair = runProgram(programs.get("pair")!, { a: { Id: "a" }, b: { Id: "b" } }, [], schema, held).result;
    assert(canonicalValue(pair).includes('"held-pair"'), `composite key did not execute: ${canonicalValue(pair)}`);
    const page = runProgram(programs.get("page")!, {}, [], schema, held).result;
    assert(canonicalValue(page).includes('"row-b"'), `loop-row tuple cursor did not execute: ${canonicalValue(page)}`);
  });

  test("the evaluator refuses a sliced short tuple cursor exactly like the engine", () => {
    const schema = { tables: { items: {
      ...evaluatorTable({ at: "Int" }),
      indexes: { byId: { columns: ["id"], unique: true }, byAt: { columns: ["at", "id"], unique: false } },
    } } };
    const program: Program = {
      name: "sliceCursor", kind: "Query", args: {}, read_time_granularity_ms: null,
      body: [{ Return: { Scan: {
        site: "sliceCursor.0", table: "items", index: "byAt", prefix: [], order: "Asc", take: { Literal: 1 },
        after: { Builtin: { builtin: "Slice", args: [
          { Array: [{ Literal: { Int: 5 } }, { Literal: { Id: "row-a" } }] },
          { Literal: { Int: 0 } }, { Literal: { Int: 1 } },
        ] } }, before: null, range: null, provenance: "Const",
      } } }],
    };
    let message = "";
    try {
      runProgram(program, {}, [], schema, { ...emptyReceipt, rows: [
        { table: "items", id: "row-a", row: { Row: { id: { Id: "row-a" }, at: { Int: 5 } } } },
      ] });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert(message.includes("cursor supplied 1 of 2 remaining index columns"),
      `evaluator accepted or differently classified a short sliced cursor: ${message}`);
  });

  test("cursor and viewer parity accepts valid values and rejects known wrong domains", () => {
    const idType = { kind: "string", id: true } as const;
    const itemsInfo: TableInfo = {
      name: "items", private: false,
      columns: { id: idType, at: { kind: "int" }, label: { kind: "string", max: 80 }, owner: idType },
      indexes: {
        byId: { columns: ["id"], types: [idType] },
        byAt: { columns: ["at", "id"], types: [{ kind: "int" }, idType] },
        byOwnerOnly: { columns: ["owner"], types: [idType] },
        byLabel: { columns: ["label", "id"], types: [{ kind: "string", max: 80 }, idType] },
        byUnsafe: { columns: ["id", "at"], types: [idType, { kind: "int" }] },
      },
    };
    const usersInfo: TableInfo = {
      name: "users", private: false,
      columns: { id: idType, name: { kind: "string", max: 80 } },
      indexes: { byId: { columns: ["id"], types: [idType] } },
    };
    const tables = new Map([["items", itemsInfo], ["users", usersInfo]]);
    const schema = { tables: {
      items: {
        ...evaluatorTable({ at: "Int", label: { Text: { max: 80 } }, owner: { Ref: { table: "users" } } }),
        indexes: {
          byId: { columns: ["id"], unique: true },
          byAt: { columns: ["at", "id"], unique: false },
          byOwnerOnly: { columns: ["owner"], unique: false },
          byLabel: { columns: ["label", "id"], unique: false },
          byUnsafe: { columns: ["id", "at"], unique: false },
        },
      },
      users: evaluatorTable({ name: { Text: { max: 80 } } }),
    }, maintains: [], channels: {}, auth: { password: false, guests: false }, effects: [] };
    const source = lowerSource(`import { mutation, query, t } from "snapback2";
declare const items: any, users: any;
function cursorOf(row: any) { return [row.at, row.id]; }
export const loopCarry = query({ seedAt: t.time(), seedId: t.id() }, ({ db, args }) => {
  let lastAt = args.seedAt;
  let lastId = args.seedId;
  for (const row of db.scan(items.byAt, [], { take: 1, after: [args.seedAt, args.seedId] })) {
    lastAt = row.at;
    lastId = row.id;
  }
  return db.scan(items.byAt, [], { take: 2, after: [lastAt, lastId] });
});
export const branchCarry = query({ a: t.id(), b: t.id(), flag: t.bool() }, ({ db, args }) => {
  let anchor = db.get(items, args.a)!;
  if (args.flag) anchor = db.get(items, args.b)!;
  return db.scan(items.byAt, [], { take: 2, after: [anchor.at, anchor.id] });
});
export const helperPage = query({ previousId: t.id() }, ({ db, args }) => {
  const previous = db.get(items, args.previousId)!;
  return db.scan(items.byAt, [], { take: 2, after: cursorOf(previous) });
});
export const literalPage = query({}, ({ db }) => db.scan(items.byAt, [], { take: 2, after: [5, "row-a"] }));
export const unsafePage = query({ seedId: t.id(), seedAt: t.time() }, ({ db, args }) =>
  db.scan(items.byAt, [], { take: 2, after: [args.seedAt, args.seedId] }));
export const viewerReads = query({}, ({ db, ctx }) => [
  db.get(users, ctx.viewer), db.get(items.byOwnerOnly, [ctx.viewer]),
  db.scan(items.byOwnerOnly, [ctx.viewer], { take: 2 }), db.exists(items.byOwnerOnly, [ctx.viewer]),
]);
export const viewerInsert = mutation({}, ({ db, ctx }) => {
  const me = ctx.viewer;
  return db.insert(items, { id: ctx.newId(), at: 40, label: "mine", owner: me });
});
export const assignedInsert = mutation({ given: t.id() }, ({ db, args }) => {
  let id = "";
  id = args.given;
  return db.insert(items, { id, at: 50, label: "assigned", owner: args.given });
});
export const jsonInsert = mutation({ given: t.json(1024) }, ({ db, args }) => {
  return db.insert(items, { id: args.given, at: 60, label: "json", owner: args.given });
});
export const coalescedInsert = mutation({ given: t.json(1024) }, ({ db, args }) => {
  const id = args.given ?? null;
  return db.insert(items, { id, at: 65, label: "coalesced", owner: id });
});
export const textInsert = mutation({ owner: t.ref(users) }, ({ db, ctx, args }) =>
  db.insert(items, { id: ctx.newId(), at: 70, label: \`owner \${args.owner}\`, owner: args.owner }));
export const concatInsert = mutation({ owner: t.ref(users) }, ({ db, ctx, args }) =>
  db.insert(items, { id: ctx.newId(), at: 75, label: concat("hello ", args.owner), owner: args.owner }));`, "parity.ts", undefined, { tables });
    assert(source.ok, `runtime-green parity scenarios were refused: ${source.ok ? "" : JSON.stringify(source.diagnostics)}`);
    const checked = rustCheck(source.programs, "synthetic", schema);
    assert(checked.every((item) => item.error === null), `runtime-green parity scenarios failed raw certification: ${JSON.stringify(checked)}`);
    const programs = new Map(source.programs.map((program) => [program.name, program]));
    const receipt: ClosureReceipt = { ...emptyReceipt, rows: [
      { table: "users", id: "viewer", row: { Row: { id: { Id: "viewer" }, name: { String: "Viewer" } } } },
      ...[["row-a", 10], ["row-b", 20], ["row-c", 30]].map(([rowId, at]) => ({
        table: "items", id: rowId as string, row: { Row: {
          id: { Id: rowId as string }, at: { Int: at as number }, label: { String: "x" }, owner: { Id: "viewer" },
        } } as Value,
      })),
    ] };
    const rows = (value: Value): string[] => value !== "Null" && "Array" in value
      ? value.Array.map((row) => row !== "Null" && "Row" in row ? (row.Row.id as { Id: string }).Id : "")
      : [];
    const loop = runProgram(programs.get("loopCarry")!, { seedAt: { Int: 0 }, seedId: { Id: "seed" } }, [], schema, receipt).result;
    assert(JSON.stringify(rows(loop)) === JSON.stringify(["row-b", "row-c"]), `loop cursor returned ${canonicalValue(loop)}`);
    const branch = runProgram(programs.get("branchCarry")!, {
      a: { Id: "row-a" }, b: { Id: "row-b" }, flag: { Bool: true },
    }, [], schema, receipt).result;
    assert(JSON.stringify(rows(branch)) === JSON.stringify(["row-c"]), `branch cursor returned ${canonicalValue(branch)}`);
    for (const name of ["helperPage", "literalPage"]) {
      const args: Record<string, Value> = name === "helperPage" ? { previousId: { Id: "row-a" } } : {};
      const result = runProgram(programs.get(name)!, args, [], schema, receipt).result;
      const expected = name === "helperPage" ? ["row-b", "row-c"] : ["row-a", "row-b"];
      assert(JSON.stringify(rows(result)) === JSON.stringify(expected), `${name} returned ${canonicalValue(result)}`);
    }
    assert(JSON.stringify(programs.get("literalPage")).includes('"Id":"row-a"'), "Id cursor literal lost its target type");
    const unsafe = runProgram(programs.get("unsafePage")!, {
      seedId: { Id: "row-a" }, seedAt: { Int: 10 },
    }, [], schema, receipt).result;
    assert(rows(unsafe).includes("row-b"), `argument tuple cursor did not execute: ${canonicalValue(unsafe)}`);
    const viewer = runProgram(programs.get("viewerReads")!, {}, [], schema, receipt).result;
    assert(canonicalValue(viewer).includes('"viewer"'), `viewer reads did not execute: ${canonicalValue(viewer)}`);
    const inserted = runProgram(programs.get("viewerInsert")!, {}, ["viewer-row"], schema, receipt);
    const viewerRow = inserted.store.byId("items", "viewer-row");
    assert(viewerRow !== null && canonicalValue(viewerRow).includes('"viewer"'), "viewer alias changed authority");
    for (const [name, minted, expectedLabel] of [["textInsert", "text-row", "owner viewer"], ["concatInsert", "concat-row", "hello viewer"]] as const) {
      const written = runProgram(programs.get(name)!, { owner: { Id: "viewer" } }, [minted], schema, receipt);
      const row = written.store.byId("items", minted);
      assert(row !== null && canonicalValue(row).includes(JSON.stringify(expectedLabel)), `${name}: Id-derived text did not reach a Text column: ${row === null ? "null" : canonicalValue(row)}`);
    }
    const assigned = runProgram(programs.get("assignedInsert")!, { given: { Id: "assigned-row" } }, [], schema, receipt);
    assert(assigned.store.byId("items", "assigned-row") !== null, "assigned Id did not reach runtime");
    const json = runProgram(programs.get("jsonInsert")!, { given: { Id: "json-row" } }, [], schema, receipt);
    assert(json.store.byId("items", "json-row") !== null, "Json-carried Id did not reach runtime");
    const coalesced = runProgram(programs.get("coalescedInsert")!, { given: { Id: "coalesced-row" } }, [], schema, receipt);
    assert(coalesced.store.byId("items", "coalesced-row") !== null, "coalesced unknown Id did not reach runtime");

    const scalarCursor: Program = {
      name: "raw.scalarCursor", kind: "Query", args: { cursor: "Scalar" }, read_time_granularity_ms: null,
      body: [{ Return: { Scan: {
        site: "raw.scalarCursor.0", table: "items", index: "byLabel", prefix: [{ Literal: { String: "x" } }],
        order: "Asc", take: { Literal: 2 }, after: { Variable: "cursor" }, before: null, range: null, provenance: "Arg",
      } } }],
    };
    assert(rustCheck([scalarCursor], "synthetic", schema)[0]!.error === null, "ArgType::Scalar cursor was refused");
    const scalarResult = runProgram(scalarCursor, { cursor: { Id: "row-a" } }, [], schema, receipt).result;
    assert(JSON.stringify(rows(scalarResult)) === JSON.stringify(["row-b", "row-c"]), `scalar raw cursor returned ${canonicalValue(scalarResult)}`);

    const domainCursor: Program = {
      name: "raw.domainCursor", kind: "Query", args: {}, read_time_granularity_ms: null,
      body: [{ Return: { Scan: {
        site: "raw.domainCursor.0", table: "items", index: "byAt", prefix: [], order: "Asc", take: { Literal: 2 },
        after: { Array: [{ Literal: { Id: "row-a" } }, { Literal: { Int: 10 } }] },
        before: null, range: null, provenance: "Const",
      } } }],
    };
    const domainRefusal = rustCheck([domainCursor], "synthetic", schema)[0]!.error;
    assert(domainRefusal?.code === "E_ARGS_TYPE", `wrong-domain cursor got ${domainRefusal?.code ?? "green"}`);
    let domainRuntime = "";
    try { runProgram(domainCursor, {}, [], schema, receipt); } catch (error) { domainRuntime = String(error); }
    assert(domainRuntime.includes("E_TYPE: cursor component for items.byAt column at must be Int, got id"),
      `wrong-domain cursor stayed twin-green: ${domainRuntime}`);

    const jsonWrite: Program = {
      name: "raw.jsonWrite", kind: "Mutation", args: { id: { Json: { max_bytes: 1024 } } }, read_time_granularity_ms: null,
      body: [{ Insert: { table: "items", row: { Object: {
        id: { Variable: "id" }, at: { Literal: { Int: 70 } }, label: { Literal: { String: "json" } },
        owner: { Variable: "id" },
      } } } }, { Return: { Literal: "Null" } }],
    };
    assert(rustCheck([jsonWrite], "synthetic", schema)[0]!.error === null, "ArgType::Json Id write was refused");
    const jsonWritten = runProgram(jsonWrite, { id: { Id: "raw-json-row" } }, [], schema, receipt);
    assert(jsonWritten.store.byId("items", "raw-json-row") !== null, "raw Json-carried Id did not reach runtime");

    const identitySchema = { tables: { identities: evaluatorTable({
      owner: { Ref: { table: "users" } }, actor: "Principal",
    }) } };
    const crossIdentity: Program = {
      name: "raw.crossIdentity", kind: "Mutation",
      args: { id: { Ref: { table: "elsewhere" } } }, read_time_granularity_ms: null,
      body: [{ Insert: { table: "identities", row: { Object: {
        id: { Variable: "id" }, owner: { Variable: "id" }, actor: { Variable: "id" },
      } } } }, { Return: { Literal: "Null" } }],
    };
    assert(rustCheck([crossIdentity], "synthetic", identitySchema)[0]!.error === null,
      "runtime-equivalent Ref/Id/Principal write axes were refused");
    const crossWritten = runProgram(crossIdentity, { id: { Id: "cross-row" } }, [], identitySchema);
    assert(crossWritten.store.byId("identities", "cross-row") !== null,
      "cross-axis runtime Id did not reach the write");

    const dynamicUpsert: Program = {
      name: "raw.dynamicUpsert", kind: "Mutation", args: { key: "Id", rowId: "Id" }, read_time_granularity_ms: null,
      body: [{ Upsert: { table: "items", key: { Variable: "key" }, row: { Object: {
        id: { Variable: "rowId" }, at: { Literal: { Int: 80 } }, label: { Literal: { String: "upsert" } },
        owner: { Variable: "rowId" },
      } } } }, { Return: { Literal: "Null" } }],
    };
    assert(rustCheck([dynamicUpsert], "synthetic", schema)[0]!.error === null,
      "runtime-dependent upsert identity equality was refused");
    const upserted = runProgram(dynamicUpsert, {
      key: { Id: "upsert-row" }, rowId: { Id: "upsert-row" },
    }, [], schema, receipt);
    assert(upserted.store.byId("items", "upsert-row") !== null,
      "equal runtime upsert identities did not commit");
  });

  test("every remaining args refusal predicate is also runtime-red", () => {
    const schema = { tables: { items: {
      ...evaluatorTable({ at: "Int", label: { Text: { max: 80 } } }),
      indexes: { byId: { columns: ["id"], unique: true }, byAt: { columns: ["at", "id"], unique: false } },
    } } };
    const wrongCursor: Program = {
      name: "red.cursor", kind: "Query", args: {}, read_time_granularity_ms: null,
      body: [{ Return: { Scan: { site: "red.cursor.0", table: "items", index: "byAt", prefix: [], order: "Asc",
        take: { Literal: 1 }, after: { Literal: { Int: 1 } }, before: null, range: null, provenance: "Const" } } }],
    };
    const wrongCursorArray: Program = {
      ...wrongCursor, name: "red.cursorArray",
      body: [{ Return: { Scan: { site: "red.cursorArray.0", table: "items", index: "byAt", prefix: [], order: "Asc",
        take: { Literal: 1 }, after: { Array: [{ Literal: { Int: 1 } }] }, before: null, range: null, provenance: "Const" } } }],
    };
    const wrongCursorObject: Program = {
      ...wrongCursor, name: "red.cursorObject",
      body: [{ Return: { Scan: { site: "red.cursorObject.0", table: "items", index: "byId", prefix: [], order: "Asc",
        take: { Literal: 1 }, after: { Object: {} }, before: null, range: null, provenance: "Const" } } }],
    };
    const wrongId: Program = {
      name: "red.id", kind: "Mutation", args: {}, read_time_granularity_ms: null,
      body: [{ Insert: { table: "items", row: { Object: {
        id: { Literal: { String: "" } }, at: { Literal: { Int: 1 } }, label: { Literal: { String: "bad" } },
      } } } }, { Return: { Literal: "Null" } }],
    };
    const wrongRow: Program = {
      ...wrongId, name: "red.row",
      body: [{ Insert: { table: "items", row: { Literal: { Int: 1 } } } }, { Return: { Literal: "Null" } }],
    };
    const wrongField: Program = {
      ...wrongId, name: "red.field",
      body: [{ Insert: { table: "items", row: { Object: {
        id: { Literal: { Id: "field-row" } }, at: { Literal: { String: "bad" } }, label: { Literal: { String: "bad" } },
      } } } }, { Return: { Literal: "Null" } }],
    };
    const wrongLiteralRow: Program = {
      ...wrongId, name: "red.literalRow",
      body: [{ Insert: { table: "items", row: { Literal: { Map: {
        id: { String: "" }, at: { Int: 1 }, label: { String: "bad" },
      } } } } }, { Return: { Literal: "Null" } }],
    };
    const idAdd: Program = {
      name: "red.idAdd", kind: "Mutation", args: { id: "Id" }, read_time_granularity_ms: null,
      body: [{ Insert: { table: "items", row: { Object: {
        id: { Binary: { op: "Add", left: { Variable: "id" }, right: { Literal: { String: ":suffix" } } } },
        at: { Literal: { Int: 1 } }, label: { Literal: { String: "bad" } },
      } } } }, { Return: { Literal: "Null" } }],
    };
    for (const [program, code, args] of [
      [wrongCursor, "E_ARGS_CURSOR_SHAPE", {}],
      [wrongCursorArray, "E_ARGS_CURSOR_SHAPE", {}],
      [wrongCursorObject, "E_ARGS_CURSOR_SHAPE", {}],
      [wrongId, "E_ARGS_ID_SCALAR", {}],
      [wrongRow, "E_ARGS_TYPE", {}],
      [wrongField, "E_ARGS_TYPE", {}],
      [wrongLiteralRow, "E_ARGS_ID_SCALAR", {}],
      [idAdd, "E_ARGS_ID_TEXT", { id: { Id: "row" } }],
    ] as Array<[Program, string, Record<string, Value>]>) {
      const refusal = rustCheck([program], "synthetic", schema)[0]!.error;
      assert(refusal?.code === code && refusal.family === "args" && refusal.site && refusal.rewrite && refusal.guide === "programs/types",
        `${program.name} lost its complete ${code} refusal: ${JSON.stringify(refusal)}`);
      let runtimeRed = false;
      const receipt: ClosureReceipt = { ...emptyReceipt, rows: [{
        table: "items", id: "row", row: { Row: {
          id: { Id: "row" }, at: { Int: 1 }, label: { String: "held" },
        } },
      }] };
      try { runProgram(program, args, [], schema, receipt); } catch { runtimeRed = true; }
      assert(runtimeRed, `${program.name} was certify-red but runtime-green`);
    }
    let objectRuntime = "";
    try {
      runProgram(wrongCursorObject, {}, [], schema, { ...emptyReceipt, rows: [{
        table: "items", id: "row", row: { Row: {
          id: { Id: "row" }, at: { Int: 1 }, label: { String: "held" },
        } },
      }] });
    } catch (error) { objectRuntime = String(error); }
    assert(objectRuntime.includes("E_TYPE: row is not an indexable scalar (cursor component for items.byId column id)"),
      `one-column object cursor stayed twin-green: ${objectRuntime}`);
  });

  test("cursor-index and Id-text guide right forms type-check, lower, and certify", async () => {
    const families = await Bun.file(resolve(snapback2Root, "packages/snapback2/guide/families.source.json")).json() as Array<{ code: string; right: string }>;
    const cursor = families.find((item) => item.code === "E_ARGS_CURSOR_INDEX")?.right;
    const identity = families.find((item) => item.code === "E_ARGS_ID_TEXT")?.right;
    assert(cursor === 'indexes: { byConvTime: { columns: ["conversationId", "at", "id"] } }',
      `cursor-index guide right form drifted: ${cursor}`);
    assert(identity === "db.get(dmPairs.byPair, [leftId, rightId])", `Id-text guide right form drifted: ${identity}`);
    await withProject({
      "snapback/schema.ts": `import { schema, table, t } from "snapback2";
export const messages = table({ columns: { conversationId: t.id(), at: t.time() }, ${cursor} });
export const dmPairs = table({ columns: { lo: t.id(), hi: t.id() }, indexes: { byPair: { columns: ["lo", "hi"], unique: true } } });
export default schema({ tables: { messages, dmPairs } });`,
      "snapback/pairs.ts": `import { query, t } from "snapback2"; import { dmPairs } from "./schema";
export const pair = query({ leftId: t.id(), rightId: t.id() }, ({ db, args }) => {
  const leftId = args.leftId;
  const rightId = args.rightId;
  return ${identity};
});`,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `guide right forms did not type-check/lower: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
      const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema);
      assert(checked.every((item) => item.error === null), `guide right forms did not certify: ${JSON.stringify(checked)}`);
    });
  });

  test("Decimal and Money rule literals use their schema scale", () => {
    const lowered = lowerSchema(`import { rule, schema, table, t } from "snapback2";
      export const prices = table({ columns: { price: t.decimal(2), cost: t.money("USD") },
        indexes: { byPrice: { columns: ["price"] } }, rules: { read: rule.and(
          rule.eq(rule.field("price"), rule.literal(2)),
          rule.eq(rule.literal(2.50), rule.field("cost")),
          rule.exists(prices, "byPrice", [rule.literal(2e0)]),
        ) } }); export default schema({ tables: { prices } });`, "snapback/schema.ts");
    assert(lowered.diagnostics.length === 0, `scaled rule literals refused: ${lowered.diagnostics.map((item) => item.message).join("; ")}`);
    const rule = (lowered.schema.tables.prices as any).rules.read.And;
    assert(JSON.stringify(rule).includes('"Int":200') && JSON.stringify(rule).includes('"Int":250'), "rule literals remained whole-unit integers");
    const excess = lowerSchema(`import { rule, schema, table, t } from "snapback2";
      export const prices = table({ columns: { price: t.decimal(2) }, rules: {
        read: rule.eq(rule.field("price"), rule.literal(1.234)),
      } }); export default schema({ tables: { prices } });`, "snapback/schema.ts");
    assert(excess.diagnostics.some((item) => item.code === "E_DECIMAL_SCALE"), "inexact Decimal rule literal was admitted");
  });

  test("journey output cleanup refuses symlinked project components", async () => {
    const outside = await mkdtemp(join(tmpdir(), "snapback2-outside-"));
    try {
      await mkdir(join(outside, "build", "tests"), { recursive: true });
      const sentinel = join(outside, "build", "tests", "keep.txt");
      await writeFile(sentinel, "keep");
      await withProject({}, async (root) => {
        await mkdir(join(root, "snapback"), { recursive: true });
        await symlink(outside, join(root, ".snapback"));
        const result = await compileJourneys(root, "");
        assert(!result.ok && result.diagnostics.some((item) => item.message.includes("symlink")), "symlinked journey output was accepted");
        assert(await readFile(sentinel, "utf8") === "keep", "journey cleanup followed the output symlink");
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("optional row access returns null instead of dereferencing absence", () => {
    const tables = tableInfo("items", { parent: { kind: "string" } });
    const lowered = lowerSource(`import { query, t } from "snapback2";
      export const parent = query({ id: t.id() }, ({ db, args }) => db.get(items, args.id)?.parent);`, "optional.ts", undefined, { tables });
    assert(lowered.ok, `optional access refused: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
    const result = runProgram(lowered.programs[0]!, { id: { Id: "missing" } }, [], { tables: { items: evaluatorTable({ parent: "Id" }) } }).result;
    assert(result === "Null", `optional access returned ${canonicalValue(result)}`);
  });

  test("optional row access guards the remainder of its property chain", () => {
    const tables = tableInfo("items", { parent: { kind: "optional", of: { kind: "string" } } });
    const lowered = lowerSource(`import { query, t } from "snapback2";
      export const parentLength = query({ id: t.id() }, ({ db, args }) => db.get(items, args.id)?.parent.length);
      export const optionalParentLength = query({ id: t.id() }, ({ db, args }) => db.get(items, args.id)?.parent?.length);
      export const parenthesized = query({ id: t.id() }, ({ db, args }) => (db.get(items, args.id)?.parent).length);`,
    "optional-chain.ts", undefined, { tables });
    assert(lowered.ok, `optional chain refused: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
    const schema = { tables: { items: evaluatorTable({ parent: { Optional: "Id" } }) } };
    const result = runProgram(lowered.programs[0]!, { id: { Id: "missing" } }, [], schema).result;
    assert(result === "Null", `optional chain returned ${canonicalValue(result)}`);
    const receipt: ClosureReceipt = { ...emptyReceipt, rows: [{ table: "items", id: "one", row: { Row: {
      id: { Id: "one" }, parent: "Null",
    } } }] };
    const optional = runProgram(lowered.programs[1]!, { id: { Id: "one" } }, [], schema, receipt).result;
    assert(optional === "Null", `second optional guard returned ${canonicalValue(optional)}`);
    for (const program of [lowered.programs[0]!, lowered.programs[2]!]) {
      let refused = false;
      try {
        runProgram(program, { id: { Id: "one" } }, [], schema, receipt);
      } catch (error) {
        refused = error instanceof Error && error.message.includes("E_TYPE");
      }
      assert(refused, `${program.name} hid a null reached after the optional guard`);
    }
  });

  test("authored __proto__, constructor, and prototype keys survive every lowering boundary", async () => {
    const schema = lowerSchema(`import { schema, table, t } from "snapback2";
      export const constructor = table({ columns: { "__proto__": t.text(20), constructor: t.text(20), prototype: t.text(20) } });
      export default schema({ tables: { constructor } });`, "snapback/schema.ts");
    assert(schema.diagnostics.length === 0, `prototype-named schema refused: ${schema.diagnostics.map((item) => item.message).join("; ")}`);
    const tables = schema.schema.tables as Record<string, any>;
    assert(Object.hasOwn(tables, "constructor") && Object.hasOwn(tables["constructor"].columns, "__proto__"), "schema lost a prototype-named key");

    const source = lowerSource(`import { query, t } from "snapback2";
      export const keys = query({ value: t.text(20) }, ({ args }) => ({
        "__proto__": args.value, constructor: args.value, prototype: args.value,
      }));`, "keys.ts");
    assert(source.ok, `prototype-named object refused: ${source.ok ? "" : source.diagnostics.map((item) => item.message).join("; ")}`);
    const result = runProgram(source.programs[0]!, { value: { String: "held" } }).result;
    assert(result !== "Null" && "Row" in result && ["__proto__", "constructor", "prototype"].every((key) => Object.hasOwn(result.Row, key)),
      `evaluator lost authored keys: ${canonicalValue(result)}`);

    await withProject({
      "snapback/schema.ts": `import { schema, table, t } from "snapback2";
        export const constructor = table({ columns: { "__proto__": t.text(20) } }); export default schema({ tables: { constructor } });`,
      "snapback/seed.ts": `import { seed } from "snapback2"; export default seed({ personas: [], rows: {
        constructor: [{ id: "one", "__proto__": "held" }],
      } });`,
    }, async (root) => {
      const seed = await lowerSeed(root);
      assert(seed.ok && Object.hasOwn((seed.seed.rows["constructor"] as unknown as any[])[0], "__proto__"), "seed lowering lost __proto__");
    });

    const receiptRow = JSON.parse('{"Row":{"id":{"Id":"one"},"__proto__":{"String":"held"},"constructor":{"String":"held"},"prototype":{"String":"held"}}}') as Value;
    const prototypeColumns = JSON.parse('{"__proto__":{"Text":{"max":20}},"constructor":{"Text":{"max":20}},"prototype":{"Text":{"max":20}}}');
    const store = new ClientStore({ tables: { rows: evaluatorTable(prototypeColumns) } }, {
      ...emptyReceipt,
      rows: [{ table: "rows", id: "one", row: receiptRow }],
    });
    const normalized = store.rows("rows")[0]!;
    assert(normalized !== "Null" && "Row" in normalized && Object.hasOwn(normalized.Row, "__proto__"), "ClientStore normalization lost __proto__");
  });

  test("recurse accepts only the bound row and the operation db binding", () => {
    const tables = tableInfo("items", { parent: { kind: "string" } });
    const cases = [
      `(row) => db.get(items, anchor.parent)`,
      `(row) => other.get(items, row.parent)`,
      `(row) => { if (row.parent) return db.get(items, row.parent); return null; }`,
    ];
    for (const step of cases) {
      const lowered = lowerSource(`import { query, recurse, t } from "snapback2";
        export const walk = query({ id: t.id() }, ({ db, args }) => {
          const anchor = db.get(items, args.id);
          for (const row of recurse(args.id, ${step}, { depth: 4, fanout: 1 })) return row;
          return null;
        });`, "recurse-invalid.ts", undefined, { tables });
      assert(!lowered.ok, `recurse admitted unrelated callback ${step}`);
    }
    const valid = lowerSource(`import { query, recurse, t } from "snapback2";
      export const walk = query({ id: t.id() }, ({ db, args }) => {
        for (const row of recurse(args.id, item => db.get(items, item.parent), { depth: 4, fanout: 1 })) return row;
        return null;
      });`, "recurse-valid.ts", undefined, { tables });
    assert(valid.ok, `canonical recurse refused: ${valid.ok ? "" : valid.diagnostics.map((item) => item.message).join("; ")}`);
  });

  test("row fields named length lower as fields", () => {
    const tables = tableInfo("items", { length: { kind: "int" }, value: { kind: "string" } });
    const lowered = lowerSource(`import { query, t } from "snapback2";
      export const length = query({ id: t.id() }, ({ db, args }) => {
        const row = db.get(items, args.id); return row.length;
      });`, "row-length.ts", undefined, { tables });
    assert(lowered.ok, `row length refused: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
    const receipt: ClosureReceipt = { ...emptyReceipt, rows: [{ table: "items", id: "one", row: { Row: {
      id: { Id: "one" }, length: { Int: 99 }, value: { String: "x" },
    } } }] };
    const result = runProgram(lowered.programs[0]!, { id: { Id: "one" } }, [], {
      tables: { items: evaluatorTable({ length: "Int", value: { Text: { max: 20 } } }) },
    }, receipt).result;
    assert(canonicalValue(result) === canonicalValue({ Int: 99 }), `row.length became collection length: ${canonicalValue(result)}`);
  });

  test("nested known object fields named length lower as fields", () => {
    const lowered = lowerSource(`import { query } from "snapback2";
      export const nestedLength = query({}, () => {
        const wrapper = { value: { length: 99, other: 1 } };
        const nested = wrapper.value;
        const spread = { ...wrapper };
        return [wrapper.value.length, nested.length, spread.value.length];
      });`, "nested-object-length.ts");
    assert(lowered.ok, `nested object length refused: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
    const result = runProgram(lowered.programs[0]!).result;
    assert(canonicalValue(result) === canonicalValue({ Array: [{ Int: 99 }, { Int: 99 }, { Int: 99 }] }),
      `nested object length became collection length: ${canonicalValue(result)}`);
  });

  test("logical and nullish expressions guard all right-hand work", () => {
    const tables = tableInfo("logs", { value: { kind: "string" } });
    const lowered = lowerSource(`import { mutation, t } from "snapback2";
      export const guarded = mutation({ go: t.bool(), existing: t.optional(t.id()) }, ({ db, ctx, args }) => {
        const skipped = args.go && db.insert(logs, { id: ctx.newId(), value: "written" });
        return [skipped, args.existing ?? ctx.newId(), ctx.newId()];
      });`, "short-circuit.ts", undefined, { tables });
    assert(lowered.ok, `short circuit refused: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
    const execution = runProgram(lowered.programs[0]!, { go: { Bool: false }, existing: { Id: "held" } }, ["first", "second"], {
      tables: { logs: evaluatorTable({ value: { Text: { max: 20 } } }) },
    });
    assert(execution.store.rows("logs").length === 0, "false && executed its insert");
    assert(canonicalValue(execution.result) === canonicalValue({ Array: [{ Bool: false }, { Id: "held" }, { Id: "first" }] }),
      `nullish RHS consumed a modeled input: ${canonicalValue(execution.result)}`);
  });

  test("single-interpolation templates always return strings", () => {
    const lowered = lowerSource('import { query, t } from "snapback2"; export const label = query({ n: t.int() }, ({ args }) => `${args.n}`);', "template.ts");
    assert(lowered.ok, `template refused: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
    const result = runProgram(lowered.programs[0]!, { n: { Int: 42 } }).result;
    assert(canonicalValue(result) === canonicalValue({ String: "42" }), `template returned ${canonicalValue(result)}`);
  });

  test("sort comparators must use opposite parameters and one field", () => {
    for (const comparator of ["(a, b) => a.score - a.score", "(a, b) => a.score - b.rank", "(a, b) => b.score - b.score"]) {
      const lowered = lowerSource(`import { query } from "snapback2";
        export const sorted = query({}, () => [{ score: 2, rank: 1 }].sort(${comparator}));`, "sort-invalid.ts");
      assert(!lowered.ok, `sort admitted ${comparator}`);
    }
    const valid = lowerSource(`import { query } from "snapback2";
      export const asc = query({}, () => [{ score: 2 }, { score: 1 }].sort((a, b) => a.score - b.score));
      export const desc = query({}, () => [{ score: 2 }, { score: 1 }].sort((a, b) => b.score - a.score));`, "sort-valid.ts");
    assert(valid.ok, `valid sort refused: ${valid.ok ? "" : valid.diagnostics.map((item) => item.message).join("; ")}`);
  });

  test("unsafe authored integer literals are refused before Number rounding", () => {
    const unsafe = lowerSource(`import { query } from "snapback2";
      export const high = query({}, () => 9007199254740993);
      export const low = query({}, () => -9007199254740992);`, "unsafe-int.ts");
    assert(!unsafe.ok && unsafe.diagnostics.filter((item) => item.message.includes("safe integer")).length === 2,
      "unsafe integer literals were rounded into valid IR");
    const edge = lowerSource(`import { query } from "snapback2";
      export const high = query({}, () => 9007199254740991);
      export const low = query({}, () => -9007199254740991);`, "safe-int.ts");
    assert(edge.ok, "i53 boundary literals were refused");
  });

  test("unsupported array callback index parameters refuse at compile time", () => {
    for (const expression of ["[10, 20].map((value, index) => index)", "[10, 20].filter((value, index) => index === 0)"]) {
      const lowered = lowerSource(`import { query } from "snapback2"; export const values = query({}, () => ${expression});`, "callback-index.ts");
      assert(!lowered.ok && lowered.diagnostics.some((item) => item.message.includes("one parameter")), `callback index compiled in ${expression}`);
    }
  });

  test("filter executes lowered predicate setup inside each iteration", () => {
    const lowered = lowerSource(`import { query, t } from "snapback2";
      export const active = query({ go: t.bool() }, ({ args }) =>
        [{ active: true }, { active: false }].filter(row => args.go ? row.active : false));`, "filter-statements.ts");
    assert(lowered.ok, `filter refused: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
    const result = runProgram(lowered.programs[0]!, { go: { Bool: true } }).result;
    assert(result !== "Null" && "Array" in result && result.Array.length === 1, `filter predicate setup was discarded: ${canonicalValue(result)}`);
  });

  test("generated row aliases reject normalized collisions", async () => {
    await withProject({
      "snapback/schema.ts": `import { schema, table } from "snapback2";
        export const foo_bar = table({ columns: {} }); export const fooBar = table({ columns: {} });
        export default schema({ tables: { foo_bar, fooBar } });`,
      "snapback/ops.ts": `import { query } from "snapback2"; export const ok = query({}, () => true);`,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(!lowered.ok && lowered.diagnostics.some((item) => item.message.includes("foo_bar") && item.message.includes("fooBar")),
        "row alias collision reached api.d.ts");
    });
  });

  test("journey import rewriting touches only module specifiers", async () => {
    await withProject({
      "snapback/tests/imports.test.ts": `import { createClient } from "snapback2/client";
        import { journey } from "snapback2/test";
        export const payload = "snapback2/client";
        journey("imports", ({ url }) => { createClient({ url }); if (payload !== "snapback2/client") throw new Error(payload); });`,
    }, async (root) => {
      const result = await compileJourneys(root, "");
      assert(result.ok, `journey compile refused: ${result.ok ? "" : result.diagnostics.map((item) => item.message).join("; ")}`);
      const built = await readFile(join(root, result.files[0]!), "utf8");
      assert((built.match(/snapback2\/client/g) ?? []).length === 2, `ordinary journey strings were rewritten: ${built}`);
      assert(built.includes("file:") && !built.includes('from "snapback2/client"'), "client module specifier was not rewritten");
    });
  });

  test("F18 journey checking does not publish a successor API before owner admission", async () => {
    await withProject({
      ".snapback/build/api.d.ts": "// predecessor API\n",
      "snapback/tests/cache.test.ts": `import { journey } from "snapback2/test";
        journey("cache", () => {});`,
    }, async (root) => {
      const result = await compileJourneys(root, "// successor API\n");
      assert(result.ok, `journey compile refused: ${result.ok ? "" : result.diagnostics.map((item) => item.message).join("; ")}`);
      const active = await readFile(join(root, ".snapback/build/api.d.ts"), "utf8");
      assert(active === "// predecessor API\n", `journey checking prematurely published ${JSON.stringify(active)}`);
    });
  });

  test("nested operation modules are diagnosed instead of omitted", async () => {
    await withProject({
      "snapback/schema.ts": `import { schema } from "snapback2"; export default schema({ tables: {} });`,
      "snapback/top.ts": `import { query } from "snapback2"; export const top = query({}, () => true);`,
      "snapback/admin/users.ts": `import { query } from "snapback2"; export const list = query({}, () => true);`,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(!lowered.ok && lowered.diagnostics.some((item) => item.site.includes("admin/users.ts") && item.message.includes("nested")),
        "nested operation passed while disappearing from the API");
    });
  });

  test("unknown scan order strings are refused", () => {
    const tables = tableInfo("items");
    const invalid = lowerSource(`import { query } from "snapback2";
      export const list = query({}, ({ db }) => db.scan(items.byId, [], { order: "descending", take: 10 }));`, "scan-order.ts", undefined, { tables });
    assert(!invalid.ok && invalid.diagnostics.some((item) => item.message.includes('"asc" or "desc"')), "unknown scan order became ascending");
    for (const order of ["asc", "desc"]) {
      const valid = lowerSource(`import { query } from "snapback2";
        export const list = query({}, ({ db }) => db.scan(items.byId, [], { order: "${order}", take: 10 }));`, "scan-order-valid.ts", undefined, { tables });
      assert(valid.ok, `${order} scan order was refused`);
    }
  });

  test("seed validation checks personas, tables, rows, and every schema value shape", async () => {
    const invalid = await lowerSeed(`${frontend}fixtures/seed-invalid`);
    assert(!invalid.ok, "invalid seed unexpectedly lowered");
    const codes = new Set(invalid.diagnostics.map((item) => item.code));
    for (const code of ["E_SEED_PERSONA", "E_SEED_TABLE", "E_SEED_ROW", "E_SEED_VALUE"]) {
      assert(codes.has(code as any), `seed validation omitted ${code}`);
    }
    const messages = invalid.diagnostics.map((item) => item.message).join("\n");
    for (const text of ["one of", "3 fractional digits, scale 2", "list max", "unknown column", "JSON numbers must be integers"]) {
      assert(messages.includes(text), `seed value validation omitted ${text}`);
    }
    assert(invalid.diagnostics.every((item) => item.site.startsWith("snapback/seed.ts:")), "seed refusal site is not seed.ts");

    await withProject({
      "snapback/schema.ts": `import { schema, table, t } from "snapback2";
        export const rows = table({ columns: { ownerId: t.ref(rows) } });
        export default schema({ tables: { rows } });`,
      "snapback/seed.ts": `import { seed } from "snapback2";
        export default seed({ personas: ["system"], rows: { rows: [
          { id: "system", ownerId: "row-1" },
          { id: "row-1", ownerId: "system" },
        ] } });`,
    }, async (root) => {
      const reserved = await lowerSeed(root);
      assert(!reserved.ok, "seed minted or referenced the reserved system principal");
      assert(
        reserved.diagnostics.filter((item) => item.message.includes("reserved system principal")).length === 2,
        "seed did not reject both reserved Id and Ref values",
      );
      assert(
        !reserved.diagnostics.some((item) => item.code === "E_SEED_PERSONA"),
        "the prefix-safe persona name system should remain valid",
      );
    });
  });

  test("decimal and money seeds normalize whole-unit numbers and strings recursively", async () => {
    const schema = `import { schema, table, t } from "snapback2";
      export const prices = table({ columns: {
        amount: t.decimal(2),
        quoted: t.money("USD"),
        discount: t.optional(t.decimal(2)),
        rates: t.list(t.decimal(3), { max: 3 }),
      } });
      export default schema({ tables: { prices } });`;
    await withProject({
      "snapback/schema.ts": schema,
      "snapback/seed.ts": `import { seed } from "snapback2";
        export default seed({ personas: [], rows: { prices: [{
          id: "p1", amount: 9.99, quoted: "12.50", discount: "0.25", rates: [1, "2.345"]
        }] } });`,
    }, async (root) => {
      const lowered = await lowerSeed(root);
      assert(lowered.ok, `whole-unit seed refused: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
      const row = lowered.seed.rows.prices![0] as Record<string, unknown>;
      assert(row.amount === 999 && row.quoted === 1250 && row.discount === 25
        && JSON.stringify(row.rates) === JSON.stringify([1000, 2345]),
      `whole-unit seed was not normalized recursively: ${JSON.stringify(row)}`);
    });

    for (const [name, amount, message] of [
      ["precision", "1.234", "3 fractional digits, scale 2"],
      ["exponent", "1e2", "exponent notation"],
    ] as const) {
      await withProject({
        "snapback/schema.ts": schema,
        "snapback/seed.ts": `import { seed } from "snapback2";
          export default seed({ personas: [], rows: { prices: [{
            id: "p1", amount: ${amount}, quoted: 1, discount: null, rates: []
          }] } });`,
      }, async (root) => {
        const lowered = await lowerSeed(root);
        assert(!lowered.ok && lowered.diagnostics.some((item) => item.code === "E_SEED_VALUE" && item.message.includes(message)),
          `${name} seed value compiled: ${JSON.stringify(lowered)}`);
      });
    }
  });

  test("seed Bytes values require one exact externally tagged key", async () => {
    await withProject({
      "snapback/schema.ts": `import { schema, table, t } from "snapback2";
        export const blobs = table({ columns: { payload: t.bytes(4) } });
        export default schema({ tables: { blobs } });`,
      "snapback/seed.ts": `import { seed } from "snapback2";
        export default seed({ personas: [], rows: { blobs: [
          { id: "blob-1", payload: { Bytes: "00ff", extra: 1 } },
        ] } });`,
    }, async (root) => {
      const invalid = await lowerSeed(root);
      assert(!invalid.ok && invalid.diagnostics.some((item) => item.code === "E_SEED_VALUE" && item.message.includes("canonical lowercase base16")),
        "seed check admitted a Bytes value with an extra externally tagged key");
    });
  });

  test("seed object spreads preserve authored rows and text maxima count Unicode scalars", async () => {
    await withProject({
      "snapback/schema.ts": `import { schema, table, t } from "snapback2";
        export const rows = table({ columns: { label: t.text(1) } });
        export default schema({ tables: { rows } });`,
      "snapback/ops.ts": `import { mutation, query, t } from "snapback2"; import { rows } from "./schema";
        export const add = mutation({}, ({ db, ctx }) => db.insert(rows, { id: ctx.newId(), label: "😀" }));
        export const fallback = query({ label: t.optional(t.text(1)) }, ({ args }) => args.label ?? "😀");`,
      "snapback/seed.ts": `import { seed } from "snapback2";
        const base = { id: "row-1", label: "old" };
        export default seed({ personas: [], rows: { rows: [{ ...base, label: "😀" }] } });`,
    }, async (root) => {
      const project = await lowerProject(root);
      assert(project.ok, `single-scalar text literal refused: ${project.ok ? "" : project.diagnostics.map((item) => item.message).join("; ")}`);
      const seed = await lowerSeed(root);
      assert(seed.ok && (seed.seed.rows.rows?.[0] as any).id === "row-1" && (seed.seed.rows.rows?.[0] as any).label === "😀",
        "seed spread was dropped or a single Unicode scalar exceeded text(1)");
    });

    await withProject({
      "snapback/schema.ts": `import { schema, table, t } from "snapback2";
        export const rows = table({ columns: { label: t.text(1) } }); export default schema({ tables: { rows } });`,
      "snapback/seed.ts": `import { seed } from "snapback2"; const make = () => ({ id: "row-1", label: "x" });
        export default seed({ personas: [], rows: { rows: [{ ...make }] } });`,
    }, async (root) => {
      const seed = await lowerSeed(root);
      const refusal = seed.ok ? undefined : seed.diagnostics.find((item) => item.code === "E_SEED_SHAPE");
      assert(refusal?.message.includes("spread make"), "non-static seed spread was silently dropped or generically refused");
    });

    const tables = new Map<string, TableInfo>([["rows", { name: "rows", private: false, columns: { label: { kind: "string", max: 1 } } }]]);
    const tooLong = lowerSource(`import { mutation, query, t } from "snapback2";
      export const add = mutation({}, ({ db, ctx }) => db.insert(rows, { id: ctx.newId(), label: "😀😀" }));
      export const fallback = query({ label: t.optional(t.text(1)) }, ({ args }) => args.label ?? "😀😀");`,
    "text-codepoints.ts", undefined, { tables });
    assert(!tooLong.ok && tooLong.diagnostics.filter((item) => item.code === "E_ARGS_TYPE").length === 2,
      "text maxima did not reject over-limit literals and arg defaults by Unicode scalar count");
  });

  test("F9 Rust package fixtures reclaim a dead package-build owner", async () => {
    const lock = join(snapback2Root, "target/b2-package-build.lock");
    const marker = join(snapback2Root, "target/b2-package-build.marker");
    await rm(lock, { force: true });
    await rm(marker, { force: true });
    await writeFile(lock, `${JSON.stringify({ pid: 2_147_483_647, token: "verified-f9-dead-owner" })}\n`);
    try {
      const started = performance.now();
      const result = Bun.spawnSync({
        cmd: [
          "cargo", "test", "-p", "snapback2", "--test", "guide",
          "package_consumers_and_isolated_compiler_use_complete_private_snapshots",
          "--", "--exact",
        ],
        cwd: snapback2Root,
        stdout: "pipe",
        stderr: "pipe",
      });
      const elapsed = performance.now() - started;
      assert(result.exitCode === 0,
        `Rust package fixture did not reclaim the dead owner: ${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`);
      assert(elapsed < 10_000, `Rust package fixture spent ${Math.round(elapsed)}ms waiting on a dead owner`);
    } finally {
      await rm(lock, { force: true });
    }
  });

  test("F10 concurrent stale reclaimers cannot remove the winner's live lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "snapback2-f10-"));
    const lock = join(snapback2Root, "target/b2-package-build.lock");
    const preload = join(directory, "barrier.mjs");
    const waitSource = `
      import fs from "node:fs/promises";
      import { syncBuiltinESMExports } from "node:module";
      const role = process.env.F10_ROLE;
      const lock = process.env.F10_LOCK;
      const barrier = process.env.F10_BARRIER;
      const original = {
        link: fs.link.bind(fs), stat: fs.stat.bind(fs), unlink: fs.unlink.bind(fs),
        writeFile: fs.writeFile.bind(fs), readFile: fs.readFile.bind(fs),
      };
      const pause = () => new Promise((resolve) => setTimeout(resolve, 5));
      async function exists(path) { try { await original.stat(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } }
      async function waitFor(path, timeout = 5_000) {
        const deadline = Date.now() + timeout;
        while (!(await exists(path))) { if (Date.now() >= deadline) throw new Error("F10 barrier timeout: " + path); await pause(); }
      }
      fs.link = async (from, to) => {
        const result = await original.link(from, to);
        if (from === lock && String(to).includes(".stale-")) {
          await original.writeFile(barrier + "/" + role + "-claimed", "ready");
          await waitFor(barrier + "/A-claimed");
          await waitFor(barrier + "/B-claimed");
        }
        return result;
      };
      fs.stat = async (path, ...args) => {
        if (path === lock && role === "B") await waitFor(barrier + "/A-live");
        return original.stat(path, ...args);
      };
      fs.unlink = async (path) => {
        if (path === lock && role === "B") await waitFor(barrier + "/A-live");
        const result = await original.unlink(path);
        if (path === lock && role === "B") await original.writeFile(barrier + "/B-unlinked", "lost");
        return result;
      };
      fs.writeFile = async (path, data, options) => {
        const result = await original.writeFile(path, data, options);
        if (path === lock && role === "A" && options?.flag === "wx") {
          await original.writeFile(barrier + "/A-live", "ready");
          const deadline = Date.now() + 500;
          while (!(await exists(barrier + "/B-unlinked")) && Date.now() < deadline) await pause();
          if (await exists(barrier + "/B-unlinked")) {
            let current = "<missing>";
            try { current = await original.readFile(lock, "utf8"); } catch {}
            if (current !== data) throw new Error("F10_LIVE_LOCK_REMOVED");
          }
        }
        return result;
      };
      syncBuiltinESMExports();
    `;
    try {
      await writeFile(preload, waitSource);
      await rm(lock, { force: true });
      await writeFile(lock, `${JSON.stringify({ pid: 2_147_483_647, token: "verified-f10-dead-owner" })}\n`);
      const spawn = (role: "A" | "B") => Bun.spawn({
        cmd: ["node", "--import", preload, "build.mjs"],
        cwd: join(snapback2Root, "packages/snapback2"),
        env: { ...process.env, F10_ROLE: role, F10_LOCK: lock, F10_BARRIER: directory },
        stdout: "pipe",
        stderr: "pipe",
      });
      const contenders = [spawn("A"), spawn("B")];
      const exits = await Promise.all(contenders.map((child) => child.exited));
      const diagnostics = await Promise.all(contenders.map(async (child) =>
        `${await new Response(child.stdout).text()}${await new Response(child.stderr).text()}`));
      assert(exits.every((code) => code === 0),
        `stale reclaimers lost mutual exclusion: exits=${JSON.stringify(exits)} ${diagnostics.join("\n")}`);
    } finally {
      await rm(lock, { force: true });
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("F19 blocking self-test uses a GNU-portable nonempty mktemp fixture", async () => {
    const directory = await mkdtemp(join(tmpdir(), "snapback2-f19-"));
    const fakeMktemp = join(directory, "mktemp");
    try {
      await writeFile(fakeMktemp, `#!/bin/sh
template=""
for argument in "$@"; do template="$argument"; done
case "$template" in
  *XXX*) exec /usr/bin/mktemp -d "\${TMPDIR:-/tmp}/$template" ;;
  *) printf '%s\n' "mktemp: too few X's in template '$template'" >&2; exit 1 ;;
esac
`);
      await chmod(fakeMktemp, 0o755);
      const result = Bun.spawnSync({
        cmd: ["bash", "scripts/test.sh", "--self-test"],
        cwd: snapback2Root,
        env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ""}` },
        stdout: "pipe",
        stderr: "pipe",
      });
      assert(result.exitCode === 0,
        `GNU mktemp mode broke the blocking self-test: ${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("F20 publish self-test preserves a durable resume across dry-run staging", () => {
    const checked = Bun.spawnSync({
      cmd: ["node", "scripts/publish.mjs", "--self-test"],
      cwd: snapback2Root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = `${new TextDecoder().decode(checked.stdout)}${new TextDecoder().decode(checked.stderr)}`;
    assert(checked.exitCode === 0 && output.includes("durable dry-run resume preserved"),
      `publish self-test did not cover durable dry-run resume preservation: ${output}`);
  });
}
