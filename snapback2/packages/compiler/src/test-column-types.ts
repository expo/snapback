import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { lowerSource } from "./compiler";
import { lowerSchema } from "./lower/schema";
import { lowerProject as lowerAuthoredProject } from "./project";

const frontend = decodeURIComponent(new URL("../", import.meta.url).pathname);
const crate = decodeURIComponent(new URL("../../../", import.meta.url).pathname);

type RegisterTest = (name: string, run: () => void | Promise<void>) => void;
const lowerProject = (root: string) => lowerAuthoredProject(root, { authoring: "any" });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function canonical(value: unknown): string {
  const normalize = (item: any): any => Array.isArray(item)
    ? item.map(normalize)
    : item && typeof item === "object"
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]))
      : item;
  return JSON.stringify(normalize(value));
}

function integerLiterals(value: unknown): number[] {
  if (Array.isArray(value)) return value.flatMap(integerLiterals);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const literal = record.Literal;
  if (literal && typeof literal === "object" && "Int" in literal) {
    return [Number((literal as { Int: unknown }).Int)];
  }
  return Object.values(record).flatMap(integerLiterals);
}

async function withProject<T>(files: Record<string, string>, run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "snapback2-compiler-"));
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

function runBinaryCheck(args: string[], input?: unknown): { exitCode: number } {
  const process = Bun.spawnSync({
    cmd: [`${crate}target/debug/snapback2`, "check", ...args],
    cwd: crate,
    stdin: input === undefined ? undefined : new TextEncoder().encode(JSON.stringify(input)),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: process.exitCode };
}

export function registerColumnTypeChecks(test: RegisterTest): void {
  test("Decimal, Money, and Enum descriptors type APIs and lower fractional literals to integer wire values", async () => {
    const todos = await lowerProject(`${frontend}fixtures/todos`);
    assert(todos.ok, `typed todos refused: ${todos.ok ? "" : todos.diagnostics.map((item) => item.message).join("; ")}`);
    const table = (todos.project.schema.tables.todos as any).columns;
    assert(canonical(table.price) === canonical({ Decimal: { scale: 2 } }), "Decimal schema JSON differs");
    assert(canonical(table.status) === canonical({ Enum: { variants: ["open", "done"] } }), "Enum schema JSON differs");
    assert(canonical(table.budget) === canonical({ Optional: { Money: { currency: "USD", scale: 2 } } }), "Money schema JSON differs");
    assert(todos.apiDts.includes("price: Decimal<2>") && todos.apiDts.includes('status: "open" | "done"') && todos.apiDts.includes('Money<"USD", 2>'), "branded/enum API types are missing");
    for (const field of ["unchanged", "doubled", "minimum"]) {
      assert(todos.apiDts.includes(`${field}: Decimal<2>`), `Decimal expression result ${field} lost its brand in api.d.ts`);
    }
    const add = todos.project.programs.find((item) => item.name === "todos.add")!;
    assert(canonical(add.args.price) === canonical({ Decimal: { scale: 2 } }), "Decimal arg did not use the engine ArgType variant");
    assert(canonical(add.args.budget) === canonical({ Money: { currency: "USD", scale: 2 } }), "Money arg did not use the engine ArgType variant");
    assert(canonical(add.args.status) === canonical({ Enum: { variants: ["open", "done"] } }), "Enum arg did not use the engine ArgType variant");
    for (const name of ["todos.addLiteral", "todos.decimalMath", "todos.argDefaults"]) {
      const program = todos.project.programs.find((item) => item.name === name)!;
      assert(canonical(program).includes('"Int":999'), `${name} did not scale 9.99 to integer 999`);
      if (name === "todos.addLiteral") {
        assert((canonical(program).match(/"Int":999/g) ?? []).length === 2, "Decimal return field was not target-scaled alongside the inserted column");
      }
    }
    assert(canonical(todos.project.programs.find((item) => item.name === "todos.reprice")).includes('"Int":125'), "update Decimal literal was not scaled");
    assert(canonical(todos.project.programs.find((item) => item.name === "todos.upsertLiteral")).includes('"Int":250'), "upsert Decimal literal was not scaled/padded");
    assert(canonical(todos.project.programs.find((item) => item.name === "todos.encoded")).includes('"Int":999'), "authoring decimal() helper did not lower to minor units");
  });

  test("Decimal type facts follow lexical args and ctx bindings instead of identifier spelling", () => {
    const tables = new Map([["products", {
      name: "products",
      private: false,
      columns: { price: { kind: "decimal" as const, scale: 2 } },
    }]]);
    const lower = (source: string, fileName: string) => lowerSource(
      `import { mutation, query, t } from "snapback2"; ${source}`,
      fileName,
      undefined,
      { tables },
    );

    const control = lower(
      "export const price = query({ price: t.decimal(2) }, ({ args }) => args.price + 1);",
      "plain-args.ts",
    );
    assert(control.ok, `plain args spelling refused: ${control.ok ? "" : control.diagnostics.map((item) => item.message).join("; ")}`);
    assert(canonical(integerLiterals(control.programs[0])).includes("[100]"), "plain args.price + 1 did not scale 1 to 100");

    const renamed = lower(
      "export const price = query({ price: t.decimal(2) }, ({ args: packed }) => packed.price + 1);",
      "renamed-args.ts",
    );
    assert(renamed.ok, `renamed args binding refused: ${renamed.ok ? "" : renamed.diagnostics.map((item) => item.message).join("; ")}`);
    assert(canonical(integerLiterals(renamed.programs[0])).includes("[100]"), "renamed args binding did not scale 1 to 100");

    const shadowed = lower(`export const price = mutation({ price: t.decimal(3) }, ({ db, args }) =>
      db.update(products, "product", (args) => ({ price: args.price + 1 })));`, "shadowed-args.ts");
    assert(shadowed.ok, `row callback args shadow refused: ${shadowed.ok ? "" : shadowed.diagnostics.map((item) => item.message).join("; ")}`);
    assert(canonical(integerLiterals(shadowed.programs[0])).includes("[100]"), "row callback args shadow used the operation scale instead of scale 2");

    const sequence = lower(`export const price = mutation({ price: t.decimal(3) }, ({ db, args }) => {
      db.update(products, "product", (args) => ({ price: args.price + 1 }));
      return args.price + 1;
    });`, "scoped-args.ts");
    assert(sequence.ok, `scoped args sequence refused: ${sequence.ok ? "" : sequence.diagnostics.map((item) => item.message).join("; ")}`);
    assert(canonical(integerLiterals(sequence.programs[0])).includes("[100,1000]"),
      `args shadow escaped its callback scope: ${canonical(integerLiterals(sequence.programs[0]))}`);

    const renamedCtx = lower(`export const price = mutation({}, ({ db, ctx: context }) => {
      db.update(products, "product", (ctx) => ({ price: ctx.price + 1 }));
      return context.viewer;
    });`, "renamed-ctx.ts");
    assert(renamedCtx.ok, `renamed ctx binding refused: ${renamedCtx.ok ? "" : renamedCtx.diagnostics.map((item) => item.message).join("; ")}`);
    assert(canonical(integerLiterals(renamedCtx.programs[0])).includes("[100]"), "row callback ctx shadow lost its scale 2 fact");
    assert(canonical(renamedCtx.programs[0]).includes('"Input":"Viewer"'), "renamed ctx binding did not lower context.viewer");
  });

  test("nested handler destructuring refuses with an explicit-access rewrite", () => {
    const source = `import { query, t } from "snapback2";
      export const price = query({ price: t.decimal(2) },
        ({ args: { price: renamed = 1 } }) => renamed + 1);`;
    const lowered = lowerSource(source, "nested-handler.ts");
    const refusal = lowered.ok ? undefined : lowered.diagnostics.find((item) =>
      item.code === "E_OPAQUE" && item.message.includes("nested handler destructuring"));
    assert(refusal?.family === "opaque" && refusal.site.startsWith("nested-handler.ts:"),
      "nested handler pattern did not produce a sited refusal envelope");
    assert(refusal.rewrite.includes("args: packed")
      && refusal.rewrite.includes("const renamed = (packed.price ?? 1);"),
    `nested handler rewrite did not bind/access the composite explicitly: ${refusal.rewrite}`);
    const rewritten = lowerSource(refusal.rewrite, "nested-handler-rewritten.ts");
    assert(rewritten.ok, `nested handler rewrite did not compile: ${rewritten.ok ? "" : rewritten.diagnostics.map((item) => item.message).join("; ")}`);
    assert(canonical(integerLiterals(rewritten.programs[0])).includes("[100,100]"),
      "nested handler rewrite did not preserve Decimal scaling for the default and addition");
  });

  test("duplicate operation composite bindings refuse in both orders with a single-binding rewrite", () => {
    for (const [label, bindings] of [
      ["canonical-first", "args, args: packed"],
      ["renamed-first", "args: packed, args"],
    ] as const) {
      const source = `import { query, t } from "snapback2";
        export const price = query({ price: t.decimal(2) }, ({ ${bindings} }) => [
          (args).price + 1,
          (packed).price + 1,
        ]);`;
      const lowered = lowerSource(source, `duplicate-handler-${label}.ts`);
      const refusal = lowered.ok ? undefined : lowered.diagnostics.find((item) =>
        item.code === "E_OPAQUE" && item.message.includes("handler property args is destructured more than once"));
      assert(refusal?.family === "opaque" && refusal.site.startsWith(`duplicate-handler-${label}.ts:`),
        `${label} duplicate handler binding did not produce a sited refusal envelope`);
      const rewritten = lowerSource(refusal.rewrite, `duplicate-handler-${label}-rewritten.ts`);
      assert(rewritten.ok,
        `${label} duplicate handler rewrite did not compile: ${rewritten.ok ? "" : rewritten.diagnostics.map((item) => item.message).join("; ")}`);
      assert(canonical(integerLiterals(rewritten.programs[0])).includes("[100,100]"),
        `${label} duplicate handler rewrite did not preserve the operation argument scale`);
    }
  });

  test("parenthesized and asserted operation composites preserve Decimal scales", () => {
    const lowered = lowerSource(`import { query, t } from "snapback2";
      export const price = query({ price: t.decimal(2) }, ({ args: packed }) => [
        (packed).price + 1,
        (packed as any).price + 1,
      ]);`, "wrapped-composite.ts");
    assert(lowered.ok, `wrapped composite refused: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
    assert(canonical(integerLiterals(lowered.programs[0])).includes("[100,100]"),
      `wrapped composite literals were not both scale 2: ${canonical(integerLiterals(lowered.programs[0]))}`);
  });

  test("helper literals are scaled per expansion context in both call orders", () => {
    const lowerCalls = (calls: string) => lowerSource(`import { query, t } from "snapback2";
      const addOne = (value: number) => value + 1;
      export const prices = query({ a: t.decimal(2), b: t.decimal(3) }, ({ args }) => [${calls}]);`,
    `helper-${calls.startsWith("addOne(args.a)") ? "forward" : "reverse"}.ts`);
    for (const [label, calls] of [
      ["forward", "addOne(args.a), addOne(args.b)"],
      ["reverse", "addOne(args.b), addOne(args.a)"],
    ] as const) {
      const lowered = lowerCalls(calls);
      assert(lowered.ok, `${label} helper order refused: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
      const scales = integerLiterals(lowered.programs[0]).filter((value) => value === 100 || value === 1000).sort((a, b) => a - b);
      assert(canonical(scales) === "[100,1000]", `${label} helper order used shared literal scale facts: ${canonical(scales)}`);
    }
  });

  test("loop domains distinguish shadowed locals from the operation args composite", () => {
    for (const [label, binding, domain] of [
      ["canonical", "args", "args.items"],
      ["renamed", "args: packed", "packed.items"],
    ] as const) {
      const explicit = lowerSource(`import { query, t } from "snapback2";
        export const total = query({ items: t.list(t.int(), { max: 4 }) }, ({ ${binding} }) => {
          const items = [10, 20];
          let total = 0;
          for (const item of ${domain}) total = total + item;
          return total + items.length;
        });`, `explicit-${label}-loop-args.ts`);
      assert(explicit.ok,
        `${label} explicit args loop refused: ${explicit.ok ? "" : explicit.diagnostics.map((item) => item.message).join("; ")}`);
      const explicitIr = canonical(explicit.programs[0]);
      assert(explicitIr.includes('"ArgList":{"max":4,"name":"items"}') && !explicitIr.includes('"DerivedArray"'),
        `${label} explicit args loop resolved through the same-named local: ${explicitIr}`);
    }

    const lowered = lowerSource(`import { query, t } from "snapback2";
      export const total = query({ items: t.list(t.int(), { max: 3 }) }, ({ args: packed }) => {
        const args = { items: [10, 20, 30] };
        let total = 0;
        for (const item of args.items) total = total + item;
        return total + packed.items.length;
      });`, "shadowed-loop-args.ts");
    assert(lowered.ok, `shadowed local loop refused: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
    const ir = canonical(lowered.programs[0]);
    assert(ir.includes('"DerivedArray"') && !ir.includes('"ArgList"'),
      `shadowed local loop lowered as an operation argument: ${ir}`);

    const callback = lowerSource(`import { query, t } from "snapback2";
      export const flatten = query({ items: t.list(t.int(), { max: 3 }) }, ({ args: packed }) =>
        [{ items: [1, 2] }].flatMap((args) => args.items));`, "shadowed-loop-callback.ts");
    assert(callback.ok, `shadowed callback loop refused: ${callback.ok ? "" : callback.diagnostics.map((item) => item.message).join("; ")}`);
    const callbackIr = canonical(callback.programs[0]);
    assert(callbackIr.includes('"max":2') && !callbackIr.includes('"ArgList"'),
      `shadowed callback loop lost its local member bound: ${callbackIr}`);
  });

  test("API result inference honors lexical args shadowing", async () => {
    await withProject({
      "snapback/schema.ts": `import { schema, table, t } from "snapback2";
        export const products = table({ columns: { price: t.decimal(2) } });
        export default schema({ tables: { products } });`,
      "snapback/prices.ts": `import { query, t } from "snapback2";
        import { products } from "./schema";
        export const localPrice = query({ price: t.decimal(3) }, ({ db, args: packed }) => {
          const args = db.get(products, "product")!;
          return args.price + 1;
        });`,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `lexical API project refused: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
      assert(lowered.apiDts.includes("localPrice: Op<{ /** decimal 3 — minor units */ price: number }, Decimal<2>>"),
        `API result inference used operation args by spelling: ${lowered.apiDts}`);
      assert(canonical(integerLiterals(lowered.project.programs[0])).includes("[100]"),
        "local Decimal<2> row did not lower its whole-unit literal at scale 2");
    });
  });

  test("long binary chains are linear-time, preserve Decimal scaling, and stop at the analysis guard", () => {
    const chain = (terms: number) => ["args.price", ...Array.from({ length: terms - 1 }, () => "1")].join(" + ");
    const lowerChain = (terms: number, descriptor: string) => lowerSource(
      `import { query, t } from "snapback2";
       export const chain = query({ price: ${descriptor} }, ({ args }) => ${chain(terms)});`,
      `chain-${terms}.ts`,
    );

    const started = performance.now();
    const integers = lowerChain(128, "t.int()");
    const elapsedMs = performance.now() - started;
    assert(integers.ok, `128-term integer chain refused: ${integers.ok ? "" : integers.diagnostics.map((item) => item.message).join("; ")}`);
    assert(elapsedMs < 500, `128-term integer chain took ${elapsedMs.toFixed(1)} ms (budget: 500 ms)`);
    const integerIr = canonical(integers.programs[0]);
    assert((integerIr.match(/\"op\":\"Add\"/g) ?? []).length === 127, "128-term integer chain lost an addition");
    assert(integerLiterals(integers.programs[0]).filter((value) => value === 1).length === 127,
      "128-term integer chain changed a literal");

    const decimals = lowerChain(128, "t.decimal(2)");
    assert(decimals.ok, `128-term Decimal chain refused: ${decimals.ok ? "" : decimals.diagnostics.map((item) => item.message).join("; ")}`);
    assert(integerLiterals(decimals.programs[0]).filter((value) => value === 100).length === 127,
      "mixed Decimal/int chain did not scale every whole-unit literal to 100");

    const absurd = lowerChain(600, "t.int()");
    const refusal = absurd.ok ? undefined : absurd.diagnostics.find((item) =>
      item.code === "E_OPAQUE" && item.message.includes("type analysis is limited"));
    assert(refusal, "absurd expression did not fire the type-analysis totality guard");
    assert(refusal.family === "opaque" && refusal.site.startsWith("chain-600.ts:")
      && refusal.rewrite.includes("__snapback2_type_analysis_limit_512_depth_8192_visits_per_operation__")
      && refusal.guide === "opaque/subset",
    "type-analysis guard refusal omitted its family, site, rewrite, or guide");
    assert(refusal.message.includes("512 nested expressions") && refusal.message.includes("8192 contextual expression visits")
      && refusal.message.includes("naming values inside the same operation does not reset"),
      "type-analysis guard refusal did not document both bounds");
    assert(!lowerSource(refusal.rewrite, "chain-600-rewrite.ts").ok,
      "type-analysis guard rewrite compiled instead of remaining an explicit non-lowerable sentinel");
  });

  test("helper DAG expansion is bounded by contextual visits", () => {
    const helpers = ["const h0 = (value: number) => value + 1;"];
    for (let depth = 1; depth <= 12; depth += 1) {
      helpers.push(`const h${depth} = (value: number) => h${depth - 1}(value) + h${depth - 1}(value);`);
    }
    const started = performance.now();
    const lowered = lowerSource(`import { query, t } from "snapback2";
      ${helpers.join("\n")}
      export const dag = query({ price: t.decimal(2) }, ({ args }) => h12(args.price));`, "helper-dag-12.ts");
    const elapsedMs = performance.now() - started;
    const guard = lowered.ok ? undefined : lowered.diagnostics.find((item) =>
      item.code === "E_OPAQUE" && item.message.includes("contextual expression visits"));
    assert(lowered.ok || guard, `depth-12 helper DAG failed without the totality envelope: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
    assert(elapsedMs < 500, `depth-12 helper DAG took ${elapsedMs.toFixed(1)} ms (budget: 500 ms)`);
  });

  test("Bytes descriptors lower for columns and args with the existing schema refusal family", async () => {
    await withProject({
      "snapback/schema.ts": `import { schema, table, t } from "snapback2";
        export const blobs = table({
          columns: { payload: t.bytes(4) },
          indexes: { byPayload: { columns: ["payload", "id"] } },
        });
        export default schema({ tables: { blobs } });`,
      "snapback/blobs.ts": `import { mutation, t } from "snapback2";
        import { blobs } from "./schema";
        export const add = mutation({ payload: t.bytes(4) }, ({ db, ctx, args }) =>
          db.insert(blobs, { id: ctx.newId(), payload: args.payload }));`,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `Bytes project refused: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
      assert(canonical(lowered.project.schema).includes('"Bytes":{"max":4}'), "Bytes column did not lower");
      assert(canonical(lowered.project.programs[0]?.args).includes('"Bytes":{"max":4}'), "Bytes arg did not lower");
      assert(lowered.apiDts.includes("payload: Bytes"), "Bytes API type is missing");
    });

    const invalid = lowerSchema(`import { schema, table, t } from "snapback2";
      export const blobs = table({ columns: { zero: t.bytes(0), fractional: t.bytes(1.5) } });
      export default schema({ tables: { blobs } });`, "snapback/schema.ts");
    const refusals = invalid.diagnostics.filter((item) => item.code === "E_SCHEMA_COLUMN");
    assert(refusals.length === 2, `expected two Bytes schema refusals, got ${refusals.length}`);
    assert(refusals.every((item) => item.family === "schema" && item.rewrite.includes("t.bytes(100)")), "Bytes refusal did not reuse schema with a mechanical rewrite");
  });

  test("rule literals encode Bytes only at Bytes schema positions", () => {
    const lowered = lowerSchema(`import { channel, rule, schema, table, t } from "snapback2";
      export const blobs = table({
        columns: { payload: t.bytes(4), optionalPayload: t.optional(t.bytes(4)), metadata: t.json(100) },
        indexes: { byPayload: { columns: ["payload"] } },
        rules: { read: rule.and(
          rule.eq(rule.field("metadata"), rule.literal({ Bytes: "00ff" })),
          rule.eq(rule.field("payload"), rule.literal({ Bytes: "00ff" })),
          rule.eq(rule.field("optionalPayload"), rule.literal(null)),
          rule.eq(rule.field("optionalPayload"), rule.literal({ Bytes: "00ff" })),
        ), insert: rule.exists(blobs, "byPayload", [rule.literal({ Bytes: "00ff" })]) },
      });
      export const bytes = channel({ args: { payload: t.bytes(4) },
        publish: rule.eq(rule.field("payload"), rule.literal({ Bytes: "00ff" })), subscribe: rule.allow(), ttlMs: 1000 });
      export default schema({ tables: { blobs }, channels: { bytes } });`, "snapback/schema.ts");
    assert(lowered.diagnostics.length === 0, `typed Bytes rule literals refused: ${lowered.diagnostics.map((item) => item.message).join("; ")}`);
    const terms = (lowered.schema.tables.blobs as any).rules.read.And;
    assert(canonical(terms[0].Eq[1]) === canonical({ Literal: { Map: { Bytes: { String: "00ff" } } } }),
      "Json-column {Bytes: ...} literal did not stay a map compatible with the owner JSON path");
    assert(canonical(terms[1].Eq[1]) === canonical({ Literal: { Bytes: "00ff" } }),
      "Bytes-column literal did not lower to Value::Bytes");
    assert(canonical(terms[2].Eq[1]) === canonical({ Literal: "Null" }), "Optional Bytes null did not lower to Literal Null");
    assert(canonical(terms[3].Eq[1]) === canonical({ Literal: { Bytes: "00ff" } }), "Optional Bytes literal lost its wrapper type");
    assert(canonical((lowered.schema.tables.blobs as any).rules.insert.Exists.key[0]) === canonical({ Literal: { Bytes: "00ff" } }),
      "Bytes exists key did not use its index-column type");
    assert(canonical((lowered.schema.channels.bytes as any).publish.Eq[1]) === canonical({ Literal: { Bytes: "00ff" } }),
      "Bytes channel rule literal did not use its argument type");
    assert(runBinaryCheck(["--json", "--ir"], { schema: lowered.schema, programs: [], effects: [] }).exitCode === 0, "typed Bytes rules did not certify");

    const ambiguous = lowerSchema(`import { rule, schema, table } from "snapback2";
      export const rows = table({ columns: {}, rules: {
        read: rule.eq(rule.literal({ Bytes: "00ff" }), rule.literal({ Bytes: "00ff" })),
      } });
      export default schema({ tables: { rows } });`, "snapback/schema.ts");
    assert(ambiguous.diagnostics.some((item) => item.code === "E_RULE_INVALID" && item.message.includes("Bytes schema position")),
      "untyped {Bytes: ...} rule literal was inferred instead of refused");

    const invalidExists = lowerSchema(`import { rule, schema, table, t } from "snapback2";
      export const rows = table({ columns: { payload: t.bytes(4) }, indexes: { byPayload: { columns: ["payload"] } },
        rules: { read: rule.exists(rows, "byPayload", [rule.literal({ Bytes: "FF" })]) } });
      export default schema({ tables: { rows } });`, "snapback/schema.ts");
    assert((invalidExists.schema.tables.rows as any).rules.read === "Deny", "failed exists key emitted truncated Exists IR");
    assert(invalidExists.diagnostics.length === 1 && !invalidExists.diagnostics[0]!.message.includes("unsupported"), "failed exists key emitted an imprecise duplicate refusal");
    const invalidEq = lowerSchema(`import { rule, schema, table, t } from "snapback2";
      export const rows = table({ columns: { payload: t.bytes(4) }, rules: { read: rule.eq(rule.field("payload"), rule.literal({ Bytes: "FF" })) } });
      export default schema({ tables: { rows } });`, "snapback/schema.ts");
    assert(invalidEq.diagnostics.length === 1 && !invalidEq.diagnostics[0]!.message.includes("unsupported"), "failed Bytes eq emitted a generic duplicate refusal");
  });

  test("schema descriptor maxima stop at the Rust u32 representation", () => {
    const invalid = lowerSchema(`import { schema, table, t } from "snapback2";
      export const blobs = table({ columns: { payload: t.bytes(4294967296) } });
      export default schema({ tables: { blobs } });`, "snapback/schema.ts");
    assert(invalid.diagnostics.some((item) => item.code === "E_SCHEMA_COLUMN"),
      "schema compiler admitted a max above u32::MAX");
  });

  test("invalid Decimal, Money, and Enum descriptors refuse with sited descriptor rewrites", () => {
    const cases = [
      { descriptor: "t.decimal(19)", rewrite: "t.decimal(12)" },
      { descriptor: 't.money("usd")', rewrite: 't.money("USD")' },
      { descriptor: 't.enum(["open", "open"])', rewrite: 't.enum(["open"])' },
      { descriptor: "t.enum([])", rewrite: 't.enum(["value"])' },
    ];
    for (const [index, item] of cases.entries()) {
      const lowered = lowerSource(`import { query, t } from "snapback2";
        export const bad = query({ value: ${item.descriptor} }, () => ${index});`, `invalid-arg-${index}.ts`);
      const refusal = lowered.ok ? undefined : lowered.diagnostics.find((diagnostic) => diagnostic.code === "E_ARGS_DESCRIPTOR");
      assert(refusal?.family === "args" && refusal.site.startsWith(`invalid-arg-${index}.ts:`), `${item.descriptor} did not produce a sited args descriptor refusal`);
      assert(refusal.rewrite === item.rewrite, `${item.descriptor} rewrite differs: ${refusal.rewrite}`);
    }

    const schema = lowerSchema(`import { schema, table, t } from "snapback2";
      export const rows = table({ columns: {
        decimal: t.decimal(19), money: t.money("usd"), duplicate: t.enum(["open", "open"]), empty: t.enum([]), blank: t.enum([""])
      } });
      export default schema({ tables: { rows } });`, "snapback/schema.ts");
    const refusals = schema.diagnostics.filter((diagnostic) => diagnostic.code === "E_SCHEMA_COLUMN");
    assert(refusals.length === 5 && refusals.every((diagnostic) => diagnostic.family === "schema"
      && diagnostic.site.startsWith("snapback/schema.ts:")), "invalid schema descriptors did not each produce a sited column refusal");
    for (const rewrite of ['t.decimal(12)', 't.money("USD")', 't.enum(["open"])', 't.enum(["value"])']) {
      assert(refusals.some((diagnostic) => diagnostic.rewrite === rewrite), `schema descriptor rewrite omitted ${rewrite}`);
    }
  });

}
