import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { lowerSource, typecheckSource, type TableInfo } from "./compiler";
import { assessGauntlet } from "./gauntlet";
import type { Program, ProjectJson } from "./ir";
import { listJourneys, lowerProject, lowerSeed } from "./project";
import { lowerSchema } from "./lower/schema";
import { rustCheck } from "./rust-check";
import { decimal } from "../../snapback2/src/index";
import * as clientStub from "../../snapback2/src/client";
import * as reactStub from "../../snapback2/src/react";
import * as journeyStub from "../../snapback2/src/test";

const frontend = decodeURIComponent(new URL("../", import.meta.url).pathname);
const crate = decodeURIComponent(new URL("../../../", import.meta.url).pathname);
const repo = decodeURIComponent(new URL("../../../../", import.meta.url).pathname);
const libText = `${await Bun.file(`${frontend}subset-lib.d.ts`).text()}\n${await Bun.file(`${frontend}lib.d.ts`).text()}`;
const legacyLib = `${libText}\n${await Bun.file(`${frontend}gauntlet.d.ts`).text()}`;

type Check = { name: string; run: () => void | Promise<void> };
const checks: Check[] = [];
const test = (name: string, run: Check["run"]) => checks.push({ name, run });

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

function dequalify(value: unknown): any {
  if (Array.isArray(value)) return value.map(dequalify);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, dequalify(item)]));
  }
  return typeof value === "string" && value.startsWith("programs.") ? value.slice("programs.".length) : value;
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

const corpusFiles = [
  "named-thread",
  "named-send",
  "named-send-maintained-unread",
  "named-mark-read",
  "named-inbox-count-capped",
  "named-inbox-maintained",
  "named-start-dm",
  "named-board-view",
  "named-board-summary",
  "named-ledger",
  "named-add-expense",
  "named-ancestors",
  "named-mention-scan",
  "named-helper-wrapped-scan",
  "named-maintained-waitlist",
  "named-hidden-rule",
  "named-delete-message",
];

test("S1 project preserves all 17 IR programs and certificates", async () => {
  const lowered = await lowerProject(`${frontend}fixtures/s1`);
  assert(lowered.ok, `S1 project refused: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
  assert(lowered.project.programs.length === 17, `expected 17 S1 programs, got ${lowered.project.programs.length}`);
  const candidatePrograms = lowered.project.programs.map((program) => dequalify(program) as Program);

  const referencePrograms: Program[] = [];
  for (const file of corpusFiles) {
    const fixture = await Bun.file(`${crate}corpus/${file}.json`).json();
    referencePrograms.push(fixture.program as Program);
  }
  const references = new Map(referencePrograms.map((program) => [program.name, program]));
  for (const program of candidatePrograms) {
    assert(JSON.stringify(program) === JSON.stringify(references.get(program.name)), `${program.name} IR differs byte-for-byte from S1`);
  }
  const candidateCertificates = rustCheck(candidatePrograms, "spike");
  const referenceCertificates = new Map(rustCheck(referencePrograms, "spike").map((item) => [item.program, item]));
  for (const candidate of candidateCertificates) {
    assert(candidate.error === null, `${candidate.program} candidate did not certify`);
    const reference = referenceCertificates.get(candidate.program);
    assert(reference?.error === null, `${candidate.program} reference did not certify`);
    assert(JSON.stringify(candidate.certificate) === JSON.stringify(reference.certificate), `${candidate.program} certificate differs byte-for-byte from S1`);
  }
});

test("the authored module requires imports and keeps the deterministic subset", () => {
  const oldGlobal = typecheckSource("const users = table({ columns: {} });", "old-global.ts", libText);
  assert(oldGlobal.length > 0, "old global table() unexpectedly compiled");
  for (const forbidden of ["Date.now()", "Math.random()", "fetch('x')", "setTimeout(() => 0, 1)", "eval('1')"]) {
    const source = `import { query } from 'snapback2'; export const bad = query({}, () => ${forbidden});`;
    const lowered = lowerSource(source, "forbidden.ts", libText);
    assert(!lowered.ok, `${forbidden} was admitted into a data program`);
  }
});

test("one module reports every policy refusal instead of failing fast", () => {
  const source = `import { query } from 'snapback2';
    export const bad = query({}, () => { let i = 0; while (i < 2) i++; return Date.now(); });`;
  const lowered = lowerSource(source, "both-policy.ts", libText);
  assert(!lowered.ok, "multi-policy module unexpectedly lowered");
  assert(lowered.diagnostics.some((item) => item.code === "E_OPAQUE" && item.message.includes("while")), "while refusal missing");
  assert(lowered.diagnostics.some((item) => item.code === "E_AMBIENT_TIME"), "ambient-time refusal missing");
});

test("all first-attempt refusals carry complete envelopes and mechanical rewrites", async () => {
  const firstAttempts: Record<string, string> = {
    "unbound-scan.ts": "E_UNBOUND_SCAN",
    "unbound-count.ts": "E_UNBOUND_COUNT",
    "structural-loop-tally.ts": "E_STRUCTURAL_COUNT",
    "ambient-time.ts": "E_AMBIENT_TIME",
    "while-loop.ts": "E_OPAQUE",
    "structural-rank.ts": "E_STRUCTURAL_COUNT",
    "helper-scan.ts": "E_UNBOUND_SCAN",
    "split-loop.ts": "E_UNBOUND_LOOP",
  };
  for (const [file, expected] of Object.entries(firstAttempts)) {
    const source = await Bun.file(`${frontend}fixtures/first-attempts/${file}`).text();
    const refused = lowerSource(source, file, legacyLib);
    assert(!refused.ok, `${file} unexpectedly lowered`);
    const item = refused.diagnostics[0]!;
    assert(item.code === expected, `${file}: expected ${expected}, got ${item.code}`);
    assert(/:\d+:\d+$/.test(item.site), `${file}: invalid site`);
    assert(item.family.length > 0 && item.guide.length > 0 && item.rewrite.length > 0, `${file}: incomplete refusal envelope`);
    assert(item.rewrite !== source || expected === "E_OPAQUE", `${file}: rewrite did not change source`);
    if (item.rewrite !== source) {
      const fixed = lowerSource(item.rewrite, `fixed-${file}`, legacyLib);
      assert(fixed.ok, `${file}: verbatim rewrite did not lower`);
      assert(rustCheck(fixed.programs, "synthetic").every((result) => result.error === null), `${file}: rewrite did not certify`);
    }
  }
});

test("bound and collection callback fixtures still certify", async () => {
  const boundSource = await Bun.file(`${frontend}fixtures/bound.ts`).text();
  const bound = lowerSource(boundSource, "bound.ts", legacyLib);
  assert(!bound.ok && bound.diagnostics[0]?.code === "E_BOUND", "bound fixture did not emit E_BOUND");
  const boundFixed = lowerSource(bound.diagnostics[0]!.rewrite, "fixed-bound.ts", legacyLib);
  assert(boundFixed.ok, "E_BOUND rewrite did not lower");
  assert(rustCheck(boundFixed.programs, "synthetic").every((result) => result.error === null), "E_BOUND rewrite did not certify");

  const subsetSource = await Bun.file(`${frontend}fixtures/subset-surface.ts`).text();
  const subset = lowerSource(subsetSource, "fixtures/subset-surface.ts", legacyLib);
  assert(subset.ok, `collection/write-callback surface refused: ${subset.ok ? "" : subset.diagnostics[0]?.message}`);
  assert(subset.programs.length === 3, `expected three subset-surface programs, got ${subset.programs.length}`);
  assert(rustCheck(subset.programs, "synthetic").every((result) => result.error === null), "collection/write-callback surface did not certify");
});

test("object and array spreads lower only from static shapes and preserve override order", () => {
  const tables = new Map<string, TableInfo>([["todos", {
    name: "todos",
    private: false,
    columns: {
      id: { kind: "string" }, title: { kind: "string" }, note: { kind: "string" },
      ownerId: { kind: "string" }, done: { kind: "bool" },
    },
  }]]);
  const objectSource = `import { mutation, t } from "snapback2";
    export const add = mutation({ id: t.id(), title: t.text(100) }, ({ db, ctx, args }) => {
      const defaults = { title: "default", done: true };
      const current = db.get(todos, args.id);
      return db.insert(todos, { ...defaults, ...current, ...args, id: ctx.newId(), ownerId: ctx.viewer, done: false });
    });`;
  const object = lowerSource(objectSource, "spread-object.ts", undefined, { tables });
  assert(object.ok, `static object spreads refused: ${object.ok ? "" : object.diagnostics[0]?.message}`);
  const encoded = canonical(object.programs[0]);
  assert(encoded.includes('"title":{"Variable":"title"}'), "later args spread did not override earlier title fields");
  assert(encoded.includes('"note":{"Field":{"base":{"Variable":"current"},"name":"note"}}'), "row-read spread did not expand its schema fields");
  assert(encoded.includes('"done":{"Literal":{"Bool":false}}'), "later explicit field did not override spread fields");

  const arraySource = `import { query, t } from "snapback2";
    export const list = query({ values: t.list(t.text(20), { max: 3 }) }, ({ args }) => {
      const prefix = ["first"];
      return [...prefix, ...args.values, "last"];
    });`;
  const array = lowerSource(arraySource, "spread-array.ts");
  assert(array.ok && canonical(array.programs[0]).includes('"Concat"'), "bounded array spreads did not lower in order");

  const opaqueObject = lowerSource(`import { mutation, t } from "snapback2";
    export const bad = mutation({ title: t.text(20) }, ({ db, args }) => {
      const value = args.title;
      return db.insert(todos, { ...value });
    });`, "opaque-object-spread.ts", undefined, { tables });
  assert(!opaqueObject.ok && opaqueObject.diagnostics[0]?.code === "E_OPAQUE"
    && opaqueObject.diagnostics[0].rewrite.includes("value.field"), "opaque object spread was not refused with an explicit-field rewrite");

  const opaqueArray = lowerSource(`import { query, t } from "snapback2";
    export const bad = query({ value: t.text(20) }, ({ args }) => [...args.value]);`, "opaque-array-spread.ts");
  assert(!opaqueArray.ok && opaqueArray.diagnostics[0]?.code === "E_OPAQUE"
    && opaqueArray.diagnostics[0].rewrite.includes("args.value[0]"), "opaque array spread was not refused with an explicit-element rewrite");
});

test("snapback2 constructors resolve through named aliases and namespace imports, while empty modules refuse", async () => {
  await withProject({
    "snapback/schema.ts": `import * as sb from "snapback2";
      export const todos = sb.table({ columns: { value: sb.t.text(100) } });
      export const typing = sb.channel({ args: {}, publish: sb.rule.allow(), subscribe: sb.rule.allow(), ttlMs: 4000 });
      export default sb.schema({ tables: { todos }, channels: { typing } });`,
    "snapback/ops.ts": `import * as sb from "snapback2";
      import { mutation as mutate, effect as fx, emit as send } from "snapback2";
      import { todos } from "./schema";
      export const list = sb.query({}, ({ db }) => db.scan(todos.byId, [], { take: 5 }));
      export const notify = fx({ grants: ["https://api.example.com"], run: async (payload: { value: string }) => payload });
      export const add = mutate({ value: sb.t.text(100) }, ({ db, ctx, args }) => {
        db.insert(todos, { id: ctx.newId(), value: args.value });
        send(notify, { value: args.value });
        return true;
      });`,
    "snapback/seed.ts": `import * as sb from "snapback2";
      export default sb.seed({ personas: ["alice"], rows: { todos: [] } });`,
  }, async (root) => {
    const project = await lowerProject(root);
    assert(project.ok, `aliased project refused: ${project.ok ? "" : project.diagnostics.map((item) => `${item.code} ${item.message}`).join("; ")}`);
    assert(project.project.programs.length === 2 && project.project.effects[0]?.name === "ops.notify", "aliased/namespace operation or effect was omitted");
    assert(canonical(project.project.programs).includes('"effect":"ops.notify"'), "aliased emit did not resolve the qualified effect");
    assert("typing" in project.project.schema.channels, "namespace channel/schema/table constructors were not recognized");
    const seed = await lowerSeed(root);
    assert(seed.ok && seed.seed.personas[0] === "alice", "namespace seed constructor was not recognized");
  });

  const empty = lowerSource("export const helper = 1;", "empty.ts");
  assert(!empty.ok && empty.diagnostics[0]?.code === "E_OP_NONE"
    && empty.diagnostics[0]?.message === "module exports no query/mutation/effect", "empty program module silently succeeded");
  await withProject({
    "snapback/schema.ts": `import { schema } from "snapback2"; export default schema({ tables: {} });`,
  }, async (root) => {
    const emptyProject = await lowerProject(root);
    assert(!emptyProject.ok && emptyProject.diagnostics.some((item) => item.code === "E_OP_NONE"), "schema-only project silently succeeded");
  });
});

test("effect globals are available with the one-parameter run form", async () => {
  await withProject({
    "snapback/schema.ts": `import { schema } from "snapback2"; export default schema({ tables: {} });`,
    "snapback/notify.ts": `import { effect } from "snapback2";
      export const notify = effect({ grants: ["https://api.example.com"], run: async (payload: { value: string }) => {
        const response = await fetch("https://api.example.com/send");
        console.log(JSON.stringify(payload), Math.max(1, 2), Date.now(), new URL("https://api.example.com").origin,
          new TextEncoder().encode(payload.value), new TextDecoder().decode(), btoa("x"), atob("eA=="),
          Promise.resolve(1), new Error("x").message, crypto.randomUUID());
        setTimeout(() => {}, 0);
        return { ok: response.ok, id: meta.id };
      } });`,
  }, async (root) => {
    const project = await lowerProject(root);
    assert(project.ok, `one-parameter effect globals refused: ${project.ok ? "" : project.diagnostics.map((item) => `${item.code} ${item.message}`).join("; ")}`);
    assert(project.project.effects.length === 1, "one-parameter effect did not lower");
  });
});

test("compiler lowering is split below the one-thousand-line source budget", async () => {
  const compilerLines = (await readFile(`${frontend}src/compiler.ts`, "utf8")).split("\n").length - 1;
  const expressionLines = (await readFile(`${frontend}src/lower/expr.ts`, "utf8")).split("\n").length - 1;
  assert(compilerLines <= 1000 && expressionLines <= 1000, `compiler split regressed: compiler=${compilerLines}, expr=${expressionLines}`);
});

test("project type diagnostics choose schema, args, opaque, and effect families by site", async () => {
  await withProject({
    "snapback/schema.ts": `import { schema, table, t } from "snapback2";
      export const rows = table({ columns: { parentId: t.ref("rows") } });
      export default schema({ tables: { rows } });`,
    "snapback/ops.ts": `import { query, t } from "snapback2";
      export const badArgs = query({ value: t.int(1) }, () => 0);
      export const badBody = query({}, () => missingValue);`,
    "snapback/effects.ts": `import { effect } from "snapback2";
      export const badEffect = effect({ grants: [123], run: async (_payload: null) => null });`,
  }, async (root) => {
    const project = await lowerProject(root);
    assert(!project.ok, "type-family fixture unexpectedly compiled");
    const has = (file: string, code: string, family: string) => project.diagnostics.some((item) =>
      item.site.startsWith(`snapback/${file}:`) && item.code === code && item.family === family);
    assert(has("schema.ts", "E_SCHEMA_INVALID", "schema"), "schema type error did not use the schema family");
    assert(has("ops.ts", "E_ARGS_TYPE", "args"), "operation argument error did not use the args family");
    assert(has("ops.ts", "E_OPAQUE", "opaque"), "program body type error did not use the opaque family");
    assert(has("effects.ts", "E_EFFECT_TYPE", "effect"), "effect declaration type error did not use the effect family");
  });
});

test("client, React, and test placeholders import safely and refuse only when called", () => {
  for (const [surface, module] of [["client", clientStub], ["react", reactStub], ["test", journeyStub]] as const) {
    const exports = Object.entries(module);
    assert(exports.length > 0, `${surface} placeholder has no callable exports`);
    for (const [name, value] of exports) {
      assert(typeof value === "function", `${surface}.${name} is not a callable placeholder`);
      let code: unknown;
      try {
        value();
      } catch (error) {
        code = (error as { code?: unknown }).code;
      }
      assert(code === "E_NOT_BUILT", `${surface}.${name} did not refuse with E_NOT_BUILT when called`);
    }
  }
});

test("schema and effect refusals rewrite only the failing declaration", async () => {
  const schemaSource = `import { schema, table, t } from "snapback2";
    export const unrelated = table({ columns: { value: t.text(20) } });
    export const broken = table({ columns: { value: t.text(20) }, constraints: [{ mystery: true }] });
    export default schema({ tables: { unrelated, broken } });`;
  const schema = lowerSchema(schemaSource, "snapback/schema.ts");
  const schemaRefusal = schema.diagnostics.find((item) => item.code === "E_SCHEMA_CONSTRAINT");
  assert(schemaRefusal && schemaRefusal.rewrite !== schemaSource && !schemaRefusal.rewrite.includes("unrelated"), "schema rewrite included the whole file");

  await withProject({
    "snapback/schema.ts": `import { schema } from "snapback2"; export default schema({ tables: {} });`,
    "snapback/effects.ts": `import { effect } from "snapback2";
      export const unrelated = effect({ grants: ["https://api.example.com"], run: async (_payload: null) => null });
      export const broken = effect({ grants: [], run: async (_payload: null) => null });`,
  }, async (root) => {
    const project = await lowerProject(root);
    assert(!project.ok, "invalid effect fixture unexpectedly compiled");
    const effectRefusal = project.diagnostics.find((item) => item.code === "E_EFFECT_GRANT");
    assert(effectRefusal && effectRefusal.rewrite.includes("export const broken = effect")
      && !effectRefusal.rewrite.includes("unrelated"), "effect rewrite included the whole file");
  });
});

test("chat and todos lower schema, channels, effects, emit, API types, seed, and journeys", async () => {
  const chat = await lowerProject(`${frontend}fixtures/chat`);
  assert(chat.ok, `chat refused: ${chat.ok ? "" : chat.diagnostics.map((item) => `${item.code} ${item.message}`).join("; ")}`);
  assert(chat.project.programs.length === 3, "chat operation count differs");
  assert(chat.project.effects[0]?.name === "notifications.notify", "chat effect was not qualified");
  assert(chat.project.schema.effects[0] === "notifications.notify", "schema effect list differs");
  assert("typing" in chat.project.schema.channels, "typing channel missing");
  assert(chat.apiDts.includes("type ProfilesRow = {") && chat.apiDts.includes("Page<MessagesRow>"), "API declaration omitted named table rows/Page scan results");
  const send = chat.project.programs.find((program) => program.name === "messages.send")!;
  assert(canonical(send).includes('"Emit"'), "emit did not lower into the mutation IR");
  assert(chat.apiDts.includes("messages") && chat.apiDts.includes("Op<{ conversationId: string"), "chat API declaration missing inferred types");

  const todos = await lowerProject(`${frontend}fixtures/todos`);
  assert(todos.ok, `todos refused: ${todos.ok ? "" : todos.diagnostics.map((item) => item.message).join("; ")}`);
  assert(todos.apiDts.startsWith("import type { Decimal, Json, Money, Page } from 'snapback2'"), "API declaration is not a module augmentation");
  assert(todos.apiDts.includes("note?: string") && todos.apiDts.includes("labels: string[]"), "optional/list API inference differs");
  assert(todos.apiDts.includes("type TodosRow = {") && todos.apiDts.includes("Page<TodosRow>"), "scan API did not use named row/Page types");
  assert(canonical(todos.project.schema.tables).includes('"Optional":{"List"'), "optional/list schema columns did not lower");
  const seed = await lowerSeed(`${frontend}fixtures/chat`);
  assert(seed.ok && seed.seed.personas.length === 2 && seed.seed.rows.profiles?.length === 2, "chat seed did not lower");
  const journeys = await listJourneys(`${frontend}fixtures/chat`);
  assert(canonical(journeys) === canonical(["snapback/tests/chat.test.ts"]), "chat journey list differs");
});

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
  assert(add.args.price === "Scalar" && add.args.status === "Scalar", "pre-lane-A Decimal/Enum args must remain Scalar in IR");
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

test("Decimal scale rules and Enum membership refuse every unsupported expression form", async () => {
  const invalid = await lowerProject(`${frontend}fixtures/types-invalid`);
  assert(!invalid.ok, "invalid Decimal/Enum project unexpectedly lowered");
  const decimalMessages = invalid.diagnostics.filter((item) => item.code === "E_DECIMAL_SCALE").map((item) => item.message);
  for (const text of [
    "3 fractional digits, scale 2",
    "no Decimal scale",
    "Decimal<2> and Decimal<3>",
    "/ requires",
    "% requires",
    "* requires",
    "Decimal<2> and Int",
    "max requires",
  ]) assert(decimalMessages.some((message) => message.includes(text)), `Decimal refusals omitted ${text}`);
  const enumRefusal = invalid.diagnostics.find((item) => item.code === "E_ENUM_VARIANT");
  assert(enumRefusal?.message.includes('"open", "closed"') && enumRefusal.rewrite.includes('"open"'), "Enum refusal omitted variants/rewrite");
  assert(invalid.diagnostics.filter((item) => item.code === "E_ENUM_VARIANT").length >= 3, "Enum comparison/default/assignment were not all refused");
});

test("decimal helper scales from the number string and refuses excess precision", () => {
  assert(decimal(9.99, 2) === 999, "decimal(9.99, 2) differs");
  assert(decimal(1.2, 2) === 120 && decimal(-1.2, 2) === -120, "decimal padding/sign differs");
  assert(decimal(1e-7, 7) === 1, "decimal exponent string scaling differs");
  let refused = false;
  try {
    decimal(9.999, 2);
  } catch (error) {
    refused = error instanceof RangeError && error.message.includes("3 fractional digits, scale 2");
  }
  assert(refused, "decimal helper admitted excess fractional digits");
});

test("project compilation aggregates refusals across every failing module", async () => {
  const invalid = await lowerProject(`${frontend}fixtures/invalid`);
  assert(!invalid.ok, "invalid multi-module project compiled");
  const codes = new Set(invalid.diagnostics.map((item) => item.code));
  for (const code of ["E_UNBOUND_SCAN", "E_OPAQUE", "E_SCHEMA_RESERVED", "E_SCHEMA_INDEX_COLUMN"]) {
    assert(codes.has(code as any), `aggregate diagnostics omitted ${code}`);
  }
  assert(invalid.diagnostics.some((item) => item.site.startsWith("snapback/a.ts")), "module a refusal missing");
  assert(invalid.diagnostics.some((item) => item.site.startsWith("snapback/b.ts")), "module b refusal missing");
});

test("schema lowering refuses malformed constraints and every skipped authored shape", () => {
  const source = `import { schema, table, t, rule } from 'snapback2';
    export const source = table({ columns: { ownerId: t.id() },
      indexes: { byOwner: { columns: ['ownerId'], mystery: true } },
      rules: { read: rule.mystery() },
      constraints: [{ cap: { by: ['ownerId'], max: '2' } }, { mystery: true }] });
    export const target = table({ columns: { count: t.int() } });
    export default schema({ tables: { source, target }, maintains: [{ mystery: 'source', by: ['ownerId'], into: 'target' }] });`;
  const lowered = lowerSchema(source, "snapback/schema.ts");
  const codes = new Set(lowered.diagnostics.map((item) => item.code));
  for (const code of ["E_SCHEMA_CONSTRAINT", "E_SCHEMA_INDEX_OPTION", "E_RULE_INVALID", "E_SCHEMA_MAINTAIN"]) {
    assert(codes.has(code as any), `strict schema diagnostics omitted ${code}`);
  }
  assert(lowered.diagnostics.every((item) => item.site.startsWith("snapback/schema.ts:") && item.rewrite.length > 0), "schema refusal envelope is incomplete");
});

test("implicit id and byId cannot be overwritten", () => {
  const source = `import { schema, table, t } from 'snapback2';
    export const rows = table({ columns: { id: t.int(), value: t.int() }, indexes: { byId: { columns: ['value'] } } });
    export default schema({ tables: { rows } });`;
  const lowered = lowerSchema(source, "snapback/schema.ts");
  const reserved = lowered.diagnostics.filter((item) => item.code === "E_SCHEMA_ID_RESERVED");
  assert(reserved.length === 2, `expected reserved id and byId refusals, got ${reserved.length}`);
  assert((lowered.schema.tables.rows as any).columns.id === "Id", "authored id replaced the implicit Id column");
  assert(canonical((lowered.schema.tables.rows as any).indexes.byId) === canonical({ columns: ["id"], unique: true }), "authored byId replaced the implicit index");
});

test("effect authoring reports grants, closure, imports, and then arguments together", async () => {
  const invalid = await lowerProject(`${frontend}fixtures/effects-invalid`);
  assert(!invalid.ok, "invalid effects project compiled");
  const codes = new Set(invalid.diagnostics.map((item) => item.code));
  for (const code of ["E_EFFECT_GRANT", "E_EFFECT_CLOSURE", "E_EFFECT_IMPORT", "E_EFFECT_THEN_ARGS", "E_EFFECT_UNKNOWN", "E_EMIT_IN_QUERY"]) {
    assert(codes.has(code as any), `effect diagnostics omitted ${code}`);
  }
});

test("effect source embeds JSON constants and scopes nested parameters and catch bindings", async () => {
  const chat = await lowerProject(`${frontend}fixtures/chat`);
  assert(chat.ok, "chat effect with nested bindings was refused");
  const source = chat.project.effects.find((item) => item.name === "notifications.notify")?.source ?? "";
  assert(source.startsWith("(() => {") && source.includes('const requestDefaults = {"method":"POST"'), "effect JSON constant was not embedded in its IIFE");
  assert(source.includes(".map((value) => value)") && source.includes("catch (error)"), "nested effect bindings were not retained in emitted source");
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
});

test("worker survives a refused compile and serves the next request under Node", async () => {
  const built = Bun.spawnSync({ cmd: ["node", "build.mjs"], cwd: `${crate}packages/snapback2`, stdout: "pipe", stderr: "pipe" });
  assert(built.exitCode === 0, `package build failed: ${new TextDecoder().decode(built.stderr)}`);
  const bundle = `${crate}packages/snapback2/dist/compiler.mjs`;
  const shipped = await Bun.file(bundle).text();
  assert(!shipped.includes("Bun."), "shipped compiler contains Bun.*");
  const worker = Bun.spawn({ cmd: ["node", bundle, "--worker"], stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  worker.stdin.write(`${JSON.stringify({ id: 1, op: "compile", root: resolve(frontend, "fixtures/invalid") })}\n`);
  worker.stdin.write(`${JSON.stringify({ id: 2, op: "compile", root: resolve(frontend, "fixtures/todos") })}\n`);
  worker.stdin.write(`${JSON.stringify({ id: 3, op: "compile", root: "fixtures/todos" })}\n`);
  worker.stdin.end();
  const output = await new Response(worker.stdout).text();
  const stderr = await new Response(worker.stderr).text();
  const status = await worker.exited;
  assert(status === 0, `worker exited nonzero: ${stderr}`);
  const responses = output.trim().split("\n").map((line) => JSON.parse(line));
  assert(responses[0]?.id === 1 && responses[0]?.ok === false, "worker did not return the refused compile");
  assert(responses[1]?.id === 2 && responses[1]?.ok === true, "worker did not survive for the next compile");
  assert(responses[2]?.id === 3 && responses[2]?.ok === false
    && responses[2]?.diagnostics?.[0]?.code === "E_OP_INVALID", "worker admitted a relative project root");
});

test("binary check reads IR only from stdin or --ir, never --project", async () => {
  const built = Bun.spawnSync({ cmd: ["cargo", "build", "-p", "snapback2"], cwd: crate, stdout: "pipe", stderr: "pipe" });
  assert(built.exitCode === 0, `cargo build failed: ${new TextDecoder().decode(built.stderr)}`);
  const chat = await lowerProject(`${frontend}fixtures/chat`);
  assert(chat.ok, "chat did not compile for binary check");
  const buildDir = `${frontend}fixtures/chat/.snapback/build`;
  await mkdir(buildDir, { recursive: true });
  const projectPath = `${buildDir}/project.json`;
  await Bun.write(projectPath, JSON.stringify(chat.project));
  const checked = runBinaryCheck(["--ir", projectPath]);
  const checkedRefusals = checked.results.filter((item: any) => item.error);
  assert(checked.exitCode === (checkedRefusals.length > 0 ? 1 : 0), `project check exit did not match its refusals: ${checked.stderr}`);
  assert(checked.results.length === chat.project.programs.length, "project check omitted programs");
  assert(checked.results.every((item: any) => (item.certificate === null) !== (item.error === null)), "project check omitted a certificate/refusal outcome");
  assert(checkedRefusals.every((item: any) => fullCheckEnvelope(item.error)), "checker refusal envelope is incomplete");
  const collided = runBinaryCheck(["--project", projectPath]);
  assert(collided.exitCode === 2 && collided.stderr.includes("--ir"), "--project still selects the IR-file checker form");

  const unsupportedProgram = runBinaryCheck([], {
    schemaMode: "synthetic",
    programs: [{ name: "future", kind: "Query", args: {}, read_time_granularity_ms: null, body: [{ Future: {} }] }],
  });
  assert(unsupportedProgram.exitCode === 1 && unsupportedProgram.results[0]?.error?.code === "E_CHECK_IR_UNSUPPORTED", "unknown program IR was not a typed refusal with exit 1");
  assert(unsupportedProgram.results[0]?.error?.message.includes("Future") && fullCheckEnvelope(unsupportedProgram.results[0]?.error), "unknown program refusal omitted its variant/envelope");

  const explicit = runBinaryCheck([], {
    schema: {
      tables: { rows: { columns: { id: "Id", values: { Optional: { List: { of: "Int", max: 2 } } } }, indexes: {}, rules: { read: "Allow", insert: "Allow", update: "Allow", delete: "Allow" }, constraints: [] } },
      maintains: [],
      channels: {},
      auth: { password: false, guests: false },
      effects: [],
    },
    programs: [],
    effects: [],
  } as ProjectJson);
  assert([0, 1].includes(explicit.exitCode), `explicit-schema check panicked/exited as usage: ${explicit.exitCode}`);
  if (explicit.exitCode === 1) {
    assert(explicit.results[0]?.error?.code === "E_CHECK_IR_UNSUPPORTED" && fullCheckEnvelope(explicit.results[0]?.error), "unsupported Optional/List schema was not a typed refusal");
    assert(/Optional|List/.test(explicit.results[0]?.error?.message ?? ""), "schema refusal did not name Optional/List");
  }
});

test("the 30-shape gauntlet remains measured", async () => {
  const codexReview = await Bun.file(`${repo}llp/reviews/0329.014-bounded-data-programs.codex.r3.md`).text();
  const fableReview = await Bun.file(`${repo}llp/reviews/0329.014-bounded-data-programs.fable.r3.md`).text();
  const gauntlet = [
    ...assessGauntlet("codex", codexReview, legacyLib),
    ...assessGauntlet("fable", fableReview, legacyLib),
  ];
  assert(gauntlet.length === 30, `expected 30 numbered gauntlet shapes, got ${gauntlet.length}`);
  const coded = gauntlet.filter((item) => item.source.trim());
  assert(coded.length === 27, `expected 27 shapes with code, got ${coded.length}`);
});

function fullCheckEnvelope(error: any): boolean {
  return typeof error?.code === "string" && typeof error?.family === "string"
    && typeof error?.message === "string" && typeof error?.site === "string"
    && typeof error?.rewrite === "string" && typeof error?.guide === "string";
}

function runBinaryCheck(args: string[], input?: unknown): { exitCode: number; stderr: string; results: any[] } {
  const process = Bun.spawnSync({
    cmd: [`${crate}target/debug/snapback2`, "check", ...args],
    cwd: crate,
    stdin: input === undefined ? undefined : new TextEncoder().encode(JSON.stringify(input)),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new TextDecoder().decode(process.stdout);
  return {
    exitCode: process.exitCode,
    stderr: new TextDecoder().decode(process.stderr),
    results: stdout.trim() ? JSON.parse(stdout).results : [],
  };
}

const failures: Array<{ name: string; error: unknown }> = [];
const passes: string[] = [];
for (const check of checks) {
  try {
    await check.run();
    passes.push(check.name);
  } catch (error) {
    failures.push({ name: check.name, error });
  }
}

console.log(JSON.stringify({ checks: checks.length, passed: passes.length, failed: failures.length, names: passes }));
for (const failure of failures) {
  console.error(`FAIL ${failure.name}: ${failure.error instanceof Error ? failure.error.stack ?? failure.error.message : String(failure.error)}`);
}
if (failures.length > 0) process.exitCode = 1;
