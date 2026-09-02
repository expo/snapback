import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
import { compileApp as compileQuarryApp } from "../../quarry/src/compiler";
import type { TableInfo } from "./compiler";
import { lowerSource } from "./compiler";
import type { Program } from "./ir";
import { lowerSchema } from "./lower/schema";
import { compileJourneys, lowerProject, lowerSeed } from "./project";

type Register = (name: string, run: () => void | Promise<void>) => void;

const frontend = decodeURIComponent(new URL("../", import.meta.url).pathname);
const emptyReceipt: ClosureReceipt = { rows: [], ranges: [], absences: [], verdicts: [] };

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
  test("F11 Quarry refuses reserved table and channel bindings", async () => {
    const schemas = [
      `table delete:\n  value: int\n  public\n`,
      `table rows:\n  value: int\n  public\n\nchannel delete():\n  publish <- public\n  subscribe <- public\n  ttl 1s\n`,
    ];
    for (const schema of schemas) {
      await withProject({ "snapback-quarry/schema.q": schema }, async (root) => {
        const result = await compileQuarryApp(root);
        assert(!result.ok && result.diagnostics[0]?.message.includes("reserved"),
          `reserved schema binding compiled: ${JSON.stringify(result)}`);
        assert(result.diagnostics[0]?.line === 1 || result.diagnostics[0]?.line === 5,
          `reserved schema binding refusal lost its declaration site: ${JSON.stringify(result)}`);
      });
    }
  });

  test("F12 Quarry finds focal values nested inside point reads", async () => {
    await withProject({
      "snapback-quarry/schema.q": `table users:\n  name: text <=50\n  public\n\ntable posts:\n  author: users\n  authorName: text <=50\n  public\n`,
      "snapback-quarry/ops.q": `mutation refresh(id: posts):\n  ~posts[id] { authorName: users[.author].name }\n`,
    }, async (root) => {
      const result = await compileQuarryApp(root);
      assert(result.ok, `nested focal read was refused: ${result.ok ? "" : JSON.stringify(result.diagnostics)}`);
      const generated = await readFile(join(root, "snapback", "ops.ts"), "utf8");
      const callback = generated.indexOf("(__q_old_");
      const dereference = generated.indexOf("db.get(users");
      assert(callback >= 0 && dereference > callback, `nested focal read escaped its callback:\n${generated}`);
    });
  });

  test("F13 Quarry keeps shaped page field types through later dereferences", async () => {
    await withProject({
      "snapback-quarry/schema.q": `table authors:\n  name: text <=50\n  public\n\ntable posts:\n  author: authors\n  public\n  by author\n\ntable copies:\n  name: text <=50\n  public\n`,
      "snapback-quarry/ops.q": `mutation copy():\n  for post in posts[] first 5 by byAuthor { * }:\n    +copies { name: post.author.name }\n  null\n`,
    }, async (root) => {
      const result = await compileQuarryApp(root);
      assert(result.ok, `shaped page fixture was refused: ${result.ok ? "" : JSON.stringify(result.diagnostics)}`);
      const generated = await readFile(join(root, "snapback", "ops.ts"), "utf8");
      assert(generated.includes("db.get(authors"), `shaped reference field was not dereferenced:\n${generated}`);
      const unsafe = await lowerProject(root);
      assert(!unsafe.ok && unsafe.diagnostics.some((item) => item.message.includes("undefined") && item.message.includes("string")),
        `possibly absent shaped dereference was not refused before runtime: ${JSON.stringify(unsafe)}`);

      await writeFile(join(root, "snapback-quarry", "ops.q"), `mutation copy():\n  for post in posts[] first 5 by byAuthor { * }:\n    +copies { name: post.author.name! else AUTHOR_MISSING }\n  null\n`);
      const asserted = await compileQuarryApp(root);
      assert(asserted.ok, `asserted shaped dereference was refused: ${asserted.ok ? "" : JSON.stringify(asserted.diagnostics)}`);
      const lowered = await lowerProject(root);
      assert(lowered.ok, `asserted shaped reference fixture did not certify: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
      assert(JSON.stringify(lowered.project.programs).includes('"table":"authors"'),
        "certified shaped-page operation has no authors read site");
    });
  });

  test("F1 Quarry refuses cross-table reference index keys", async () => {
    const schema = `table users:\n  public\n\ntable posts:\n  public\n\ntable todos:\n  owner: users\n  public\n  unique owner\n`;
    const operations = [
      `query named(post: posts):\n  todos[owner = post]\n`,
      `query inferred(post: posts):\n  todos[post]\n`,
      `query explicit(post: posts):\n  todos[post] first 5 by byOwner\n`,
    ];
    for (const operation of operations) {
      await withProject({
        "snapback-quarry/schema.q": schema,
        "snapback-quarry/ops.q": operation,
      }, async (root) => {
        const result = await compileQuarryApp(root);
        assert(!result.ok && (result.diagnostics[0]?.message.includes("expects reference to users")
          || result.diagnostics[0]?.message.includes("no unique index")),
        `cross-table reference key compiled: ${JSON.stringify(result)}`);
        assert(result.diagnostics[0]?.message.includes("reference to posts")
          || result.diagnostics[0]?.message.includes("no unique index"),
        `cross-table reference refusal lost its actual type: ${JSON.stringify(result)}`);
      });
    }
  });

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

  test("F7 maintained-target taint makes range reads partial", () => {
    const rules = { read: "Allow", insert: "Allow", update: "Allow", delete: "Allow" };
    const source = evaluatorTable({ group: "Id" });
    const counts = {
      ...evaluatorTable({ group: "Id", value: "Int" }),
      rules,
    };
    const schema = {
      tables: { counts, source },
      maintains: [{ kind: "Count", source: "source", by: ["group"], target: "counts", readable: null }],
    };
    const countId = '[{"Id":"g"}]';
    const countRow: Value = { Row: { id: { Id: countId }, group: { Id: "g" }, value: { Int: 1 } } };
    const receipt: ClosureReceipt = {
      rows: [{ table: "counts", id: countId, row: countRow }],
      ranges: [{
        site: "counts.scan",
        table: "counts",
        index: "byId",
        prefix: [],
        order: "Asc",
        take: 10,
        after: null,
        before: null,
        gt: null,
        gte: null,
        lt: null,
        lte: null,
        rule_hash: scopedRuleHash(schema, counts.rules.read),
        row_ids: [countId],
        stop: "Exhausted",
        absence: false,
        halo: null,
        n2_key: null,
      }],
      absences: [],
      verdicts: [],
    };
    const store = new ClientStore(schema, receipt);
    const deleted = store.applyMutation(
      evaluatorProgram("Mutation", [{ Delete: { table: "source", key: literal({ Id: "s1" }) } }]),
      context(),
    );
    assert(deleted.state === "predicted", `missing source delete used ${deleted.state}`);

    const scan = evaluatorProgram("Query", [{ Return: { Scan: {
      site: "counts.scan",
      table: "counts",
      index: "byId",
      prefix: [],
      order: "Asc",
      take: { Literal: 10 },
      after: null,
      before: null,
      range: null,
      provenance: "Const",
    } } }]);
    const replay = store.reexecute(scan, context());
    assert(replay.state === "partial", `tainted range replay used ${replay.state}`);
    assert(replay.partialSites.includes("counts.scan"), "tainted range site was not named partial");
  });

  test("F8 predecessor absence cannot initialize a successor maintained target", () => {
    const predecessor = { tables: {
      counts: evaluatorTable({ group: "Id", value: "Int" }),
      source: evaluatorTable({ group: "Id" }),
    }, maintains: [] };
    const successor = {
      ...predecessor,
      maintains: [{ kind: "Count", source: "source", by: ["group"], target: "counts", readable: null }],
    };
    const countId = '[{"Id":"g"}]';
    const predecessorReceipt: ClosureReceipt = {
      rows: [],
      ranges: [],
      absences: [["counts", "byId", [{ Id: countId }]]],
      verdicts: [],
    };
    const store = new ClientStore(successor, predecessorReceipt);
    const predicted = store.applyMutation(evaluatorProgram("Mutation", [{ Insert: {
      table: "source",
      row: literal({ Row: { id: { Id: "s2" }, group: { Id: "g" } } }),
    } }]), context());
    assert(predicted.state === "partial", `successor trusted predecessor absence as ${predicted.state}`);
    assert(store.byId("source", "s2") === null, "partial successor prediction leaked its source insert");
    assert(store.byId("counts", countId) === null, "predecessor absence manufactured a successor aggregate");
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
    const schemaCase = JSON.parse(JSON.stringify(scenarioHydrate)) as CorpusCase;
    schemaCase.schema.tables = Object.fromEntries(Object.entries(schemaCase.schema.tables).reverse());
    assert(evaluateCase(schemaCase).localState === "fresh", "scenario-hydrate table order changed certificate identity");

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
    for (const text of ["one of", "integer minor units", "list max", "unknown column", "JSON numbers must be integers"]) {
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
}
