import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ClientStore, canonicalValue, type ClosureReceipt, type Context, type Value } from "../../evaluator/src/evaluator";
import type { TableInfo } from "./compiler";
import { lowerSource } from "./compiler";
import type { Program } from "./ir";
import { lowerSchema } from "./lower/schema";
import { compileJourneys, lowerProject, lowerSeed } from "./project";

type Register = (name: string, run: () => void | Promise<void>) => void;

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

export function registerVerifiedRegressionTests(
  test: Register,
  assert: (condition: unknown, message: string) => asserts condition,
): void {
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
    const store = new ClientStore({ tables: { rows: evaluatorTable() } }, {
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
}
