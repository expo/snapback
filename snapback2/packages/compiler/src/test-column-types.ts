import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { lowerSource } from "./compiler";
import { lowerSchema } from "./lower/schema";
import { lowerProject } from "./project";

const frontend = decodeURIComponent(new URL("../", import.meta.url).pathname);
const crate = decodeURIComponent(new URL("../../../", import.meta.url).pathname);

type RegisterTest = (name: string, run: () => void | Promise<void>) => void;

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
