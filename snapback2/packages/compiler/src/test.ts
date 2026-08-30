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

test("S1 project preserves all 17 bodies and certificate bounds with native argument types", async () => {
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
    const reference = references.get(program.name)!;
    assert(JSON.stringify({ ...program, args: reference.args }) === JSON.stringify(reference), `${program.name} IR body differs from S1`);
  }
  const candidateCertificates = rustCheck(candidatePrograms, "spike");
  const referenceCertificates = new Map(rustCheck(referencePrograms, "spike").map((item) => [item.program, item]));
  for (const candidate of candidateCertificates) {
    assert(candidate.error === null, `${candidate.program} candidate did not certify`);
    const reference = referenceCertificates.get(candidate.program);
    assert(reference?.error === null, `${candidate.program} reference did not certify`);
    assert(
      JSON.stringify({ ...candidate.certificate, plan_hash: reference.certificate!.plan_hash }) === JSON.stringify(reference.certificate),
      `${candidate.program} certificate bounds differ from S1`,
    );
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

test("one operation reports every lowering refusal and marks diagnostic truncation", () => {
  const two = lowerSource(`import { query } from "snapback2";
    export const bad = query({}, () => ({ ...first, ...second }));`, "two-spreads.ts");
  assert(!two.ok, "two opaque spreads unexpectedly lowered");
  const spreads = two.diagnostics.filter((item) => item.code === "E_OPAQUE" && item.message.includes("object spread"));
  assert(spreads.length === 2, `expected both opaque spread refusals, got ${spreads.length}`);

  const authoredSpreads = Array.from({ length: 25 }, (_, index) => `...value${index}`).join(", ");
  const many = lowerSource(`import { query } from "snapback2";
    export const bad = query({}, () => ({ ${authoredSpreads} }));`, "many-spreads.ts");
  assert(!many.ok && many.diagnostics.length === 20, `per-operation diagnostic bound differs: ${many.ok ? 0 : many.diagnostics.length}`);
  const truncated = many.diagnostics.find((item) => item.code === "E_DIAG_TRUNCATED");
  assert(truncated?.message.includes("…and 6 more"), `per-operation truncation was silent or miscounted: ${truncated?.message}`);
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
    const source = `import { mutation, query, table } from "snapback2";\n${await Bun.file(`${frontend}fixtures/first-attempts/${file}`).text()}`;
    const refused = lowerSource(source, file);
    assert(!refused.ok, `${file} unexpectedly lowered`);
    const item = refused.diagnostics.find((diagnostic) => diagnostic.code === expected);
    assert(item, `${file}: expected ${expected}, got ${refused.diagnostics.map((diagnostic) => diagnostic.code).join(", ")}`);
    assert(/:\d+:\d+$/.test(item.site), `${file}: invalid site`);
    assert(item.family.length > 0 && item.guide.length > 0 && item.rewrite.length > 0, `${file}: incomplete refusal envelope`);
    assert(item.rewrite !== source || expected === "E_OPAQUE", `${file}: rewrite did not change source`);
    if (item.rewrite !== source) {
      const fixed = lowerSource(item.rewrite, `fixed-${file}`);
      assert(fixed.ok, `${file}: verbatim rewrite did not lower`);
      assert(rustCheck(fixed.programs, "synthetic").every((result) => result.error === null), `${file}: rewrite did not certify`);
    }
  }
});

test("bound and collection callback fixtures still certify", async () => {
  const boundSource = `import { query, table } from "snapback2";\n${await Bun.file(`${frontend}fixtures/bound.ts`).text()}`;
  const bound = lowerSource(boundSource, "bound.ts");
  assert(!bound.ok && bound.diagnostics[0]?.code === "E_BOUND", "bound fixture did not emit E_BOUND");
  const boundFixed = lowerSource(bound.diagnostics[0]!.rewrite, "fixed-bound.ts");
  assert(boundFixed.ok, "E_BOUND rewrite did not lower");
  assert(rustCheck(boundFixed.programs, "synthetic").every((result) => result.error === null), "E_BOUND rewrite did not certify");

  const subsetSource = `import { mutation, query, table } from "snapback2";\n${await Bun.file(`${frontend}fixtures/subset-surface.ts`).text()}`;
  const subset = lowerSource(subsetSource, "fixtures/subset-surface.ts");
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
      db.require(current !== null, "TODO_REQUIRED");
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

  const nullable = lowerSource(`import { mutation, t } from "snapback2";
    export const bad = mutation({ id: t.id() }, ({ db, args }) => {
      const current = db.get(todos, args.id);
      return { ...current };
    });`, "nullable-object-spread.ts", undefined, { tables });
  const refusal = !nullable.ok && nullable.diagnostics.find((item) => item.code === "E_OPAQUE");
  assert(refusal && refusal.message.includes("nullable db.get")
    && refusal.rewrite.includes("db.require(current !== null"), "nullable db.get spread was not refused with a narrowing rewrite");

  const guarded = lowerSource(`import { mutation, t } from "snapback2";
    export const guarded = mutation({ id: t.id() }, ({ db, args }) => {
      const current = db.get(todos, args.id);
      if (current !== null) return { ...current };
      return null;
    });`, "guarded-object-spread.ts", undefined, { tables });
  assert(guarded.ok, `explicitly guarded db.get spread was refused: ${guarded.ok ? "" : guarded.diagnostics.map((item) => item.message).join("; ")}`);
});

test("argument spreads expand module constants or refuse without dropping fields", () => {
  const expanded = lowerSource(`import { mutation, t } from "snapback2";
    const shared = { title: t.text(100), done: t.bool() };
    const inherited = { ...shared, ownerId: t.id() };
    export const add = mutation({ ...inherited, title: t.text(200) }, ({ args }) => args);`, "arg-spread.ts");
  assert(expanded.ok, `static argument spread refused: ${expanded.ok ? "" : expanded.diagnostics.map((item) => item.message).join("; ")}`);
  const args = expanded.programs[0]?.args ?? {};
  assert(Object.keys(args).sort().join(",") === "done,ownerId,title", "static argument spread dropped a field");
  assert(canonical(args.title) === canonical({ Text: { max: 200 } }), "later explicit argument did not override a spread field with its native descriptor");

  const refused = lowerSource(`import { mutation, t } from "snapback2";
    const makeArgs = () => ({ title: t.text(100) });
    export const add = mutation({ ...makeArgs() }, ({ args }) => args);`, "opaque-arg-spread.ts");
  const diagnostic = refused.ok ? undefined : refused.diagnostics.find((item) => item.code === "E_ARGS_SPREAD");
  assert(diagnostic?.site.startsWith("opaque-arg-spread.ts:3:")
    && diagnostic.rewrite.includes("field: makeArgs().field"), "opaque argument spread was dropped or lacked an explicit-field rewrite");
});

test("non-static table and index references are sited opaque refusals, never thrown errors", () => {
  const source = `import { query } from "snapback2";
    export const dynamicTable = query({}, ({ db }) => db.scan(selectTable(), [], { take: 5 }));
    export const dynamicIndex = query({}, ({ db }) => db.scan(todos[chooseIndex()], [], { take: 5 }));`;
  let lowered: ReturnType<typeof lowerSource> | undefined;
  try {
    lowered = lowerSource(source, "dynamic-reference.ts");
  } catch (error) {
    assert(false, `lowerSource threw authored input: ${String(error)}`);
  }
  assert(lowered && !lowered.ok, "dynamic table/index references unexpectedly lowered");
  const opaque = lowered.diagnostics.filter((item) => item.code === "E_OPAQUE" && item.message.includes("static table/index"));
  assert(opaque.length === 2 && opaque.every((item) => item.site.startsWith("dynamic-reference.ts:")
    && item.rewrite.includes("table.index")), "dynamic table/index refusal lost its authored site or static rewrite");
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

  const shadowed = lowerSource(`function query(_args: unknown, handler: () => unknown) { return handler(); }
    export const ordinary = query({}, () => 1);`, "shadowed-query.ts");
  assert(!shadowed.ok && shadowed.diagnostics[0]?.code === "E_OP_NONE"
    && shadowed.diagnostics[0].message.includes("local declaration query shadows")
    && shadowed.diagnostics[0].site.startsWith("shadowed-query.ts:1:"), "local query declaration was mistaken for the Snapback constructor");
  await withProject({
    "snapback/schema.ts": `import { schema } from "snapback2"; export default schema({ tables: {} });`,
  }, async (root) => {
    const emptyProject = await lowerProject(root);
    assert(!emptyProject.ok && emptyProject.diagnostics.some((item) => item.code === "E_OP_NONE"), "schema-only project silently succeeded");
  });
});

test("schema and program namespace imports resolve table, index, emit, and then references", async () => {
  await withProject({
    "snapback/schema.ts": `import { schema, table, t } from "snapback2";
      export const todos = table({ columns: { value: t.text(100) } });
      export default schema({ tables: { todos } });`,
    "snapback/callbacks.ts": `import { mutation, t } from "snapback2";
      export const record = mutation({ outboxId: t.id(), effect: t.text(100), result: t.json<{ delivered: true }>(100) }, ({ args }) => args.result);`,
    "snapback/effects.ts": `import { effect } from "snapback2";
      import * as callbacks from "./callbacks";
      export const notify = effect({ grants: ["https://api.example.com"], run: async (_payload: { value: string }) => ({ delivered: true }), then: callbacks.record });`,
    "snapback/ops.ts": `import { emit, mutation, query, t } from "snapback2";
      import * as schema from "./schema";
      import * as effects from "./effects";
      export const list = query({}, ({ db }) => db.scan(schema.todos.byId, [], { take: 5 }));
      export const add = mutation({ value: t.text(100) }, ({ db, ctx, args }) => {
        db.insert(schema.todos, { id: ctx.newId(), value: args.value });
        emit(effects.notify, { value: args.value });
        return true;
      });`,
  }, async (root) => {
    const project = await lowerProject(root);
    assert(project.ok, `namespace references refused: ${project.ok ? "" : project.diagnostics.map((item) => `${item.code} ${item.message}`).join("; ")}`);
    const list = project.project.programs.find((item) => item.name === "ops.list") as any;
    const add = project.project.programs.find((item) => item.name === "ops.add") as any;
    assert(list?.body[0]?.Return?.Scan?.table === "todos" && list.body[0].Return.Scan.index === "byId"
      && add?.body[0]?.Insert?.table === "todos",
      "schema namespace lowered to the namespace or export name instead of todos/byId");
    const encoded = canonical(project.project.programs);
    assert(encoded.includes('"effect":"effects.notify"'), "program namespace effect reference did not resolve");
    assert(project.project.effects[0]?.then === "callbacks.record", "program namespace then reference did not resolve");
    assert(project.apiDts.includes("list: Op<{}, Page<TodosRow>>"), "schema namespace scan lost its authored API row type");
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
    const checkerMessages = ["Expected 0 arguments", "Cannot find name", "not assignable to type"];
    for (const item of project.diagnostics.filter((diagnostic) => checkerMessages.some((message) => diagnostic.message.includes(message)))) {
      assert(!item.rewrite.includes("export const badArgs") || !item.rewrite.includes("export const badBody"), `${item.code} rewrite still contains the whole source file`);
      assert(item.rewrite.includes("Fix the TypeScript error") || item.code !== "E_ARGS_TYPE" && item.code !== "E_OPAQUE" && item.code !== "E_EFFECT_TYPE" && item.code !== "E_SCHEMA_INVALID",
        `${item.code} TypeScript rewrite omitted its one-line fix hint`);
    }
  });
});

test("single-file type diagnostics choose the same family from the authored site", () => {
  const source = `import { effect, query, t } from "snapback2";
    export const badArgs = query({ value: t.int(1) }, () => 0);
    export const badBody = query({}, () => missingValue);
    export const badEffect = effect({ grants: [123], run: async (_payload: null) => null });`;
  const lowered = lowerSource(source, "single-site.ts", libText);
  assert(!lowered.ok, "single-file type-family fixture unexpectedly compiled");
  const has = (code: string, family: string) => lowered.diagnostics.some((item) => item.code === code && item.family === family);
  assert(has("E_ARGS_TYPE", "args"), "single-file argument type error did not use the args family");
  assert(has("E_OPAQUE", "opaque"), "single-file body type error did not use the opaque family");
  assert(has("E_EFFECT_TYPE", "effect"), "single-file effect type error did not use the effect family");
});

test("placeholder declarations export every not-built client, React, and journey symbol", async () => {
  const declarations = await readFile(`${crate}packages/snapback2/types/placeholder.d.ts`, "utf8");
  for (const name of ["createClient", "useQuery", "useMutation", "useAuth", "useChannel", "SnapbackProvider", "DevOverlay", "journey"]) {
    assert(new RegExp(`export declare const ${name}\\b`).test(declarations), `placeholder declarations omit ${name}`);
  }
  assert((declarations.match(/=> never/g) ?? []).length === 8, "placeholder exports are not typed as never-returning callables");
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

test("Decimal insert multiplication keeps literal and argument multipliers as Int", () => {
  const tables = new Map<string, TableInfo>([["products", {
    name: "products", private: false, columns: { price: { kind: "decimal", scale: 2 } },
  }]]);
  const valid = lowerSource(`import { mutation, t } from "snapback2";
    export const byLiteral = mutation({ price: t.decimal(2) }, ({ db, ctx, args }) =>
      db.insert(products, { id: ctx.newId(), price: args.price * 2 }));
    export const byArgument = mutation({ price: t.decimal(2), multiplier: t.int() }, ({ db, ctx, args }) =>
      db.insert(products, { id: ctx.newId(), price: args.price * args.multiplier }));`, "decimal-multiply.ts", undefined, { tables });
  assert(valid.ok, `Decimal by Int insert refused: ${valid.ok ? "" : valid.diagnostics.map((item) => item.message).join("; ")}`);
  const insertedPrice = (name: string) => {
    const program = valid.programs.find((item) => item.name === name)!;
    const insert = program.body.find((statement): statement is Extract<typeof statement, { Insert: unknown }> => typeof statement === "object" && "Insert" in statement);
    assert(insert && "Object" in insert.Insert.row, `${name} did not lower an inserted row object`);
    return insert.Insert.row.Object.price;
  };
  assert(canonical(insertedPrice("byLiteral")) === canonical({ Binary: {
    op: "Mul", left: { Variable: "price" }, right: { Literal: { Int: 2 } },
  } }), "Decimal × literal did not lower to Mul(price, 2)");
  assert(canonical(insertedPrice("byArgument")) === canonical({ Binary: {
    op: "Mul", left: { Variable: "price" }, right: { Variable: "multiplier" },
  } }), "Decimal × int arg did not lower to Mul(price, multiplier)");

  const invalid = lowerSource(`import { query, t } from "snapback2";
    export const bad = query({ left: t.decimal(2), right: t.decimal(2) }, ({ args }) => args.left * args.right);`, "decimal-by-decimal.ts");
  const refusal = invalid.ok ? undefined : invalid.diagnostics.find((item) => item.code === "E_DECIMAL_SCALE");
  assert(refusal?.message.includes("Decimal<2> and Decimal<2>"), "Decimal × Decimal no longer refuses with both scales");
});

test("Decimal scaling requires a verified target and exponential literals classify by numeric value", () => {
  const tables = new Map<string, TableInfo>([["products", {
    name: "products", private: false, columns: { price: { kind: "decimal", scale: 2 } },
  }]]);
  const bare = lowerSource(`import { query } from "snapback2";
    export const price = query({}, () => ({ price: 9.99 }));`, "bare-price.ts", undefined, { tables });
  const bareRefusal = bare.ok ? undefined : bare.diagnostics.find((item) => item.code === "E_DECIMAL_SCALE");
  assert(bareRefusal?.rewrite.includes("decimal(9.99, 2)"), "bare result literal inherited Decimal typing by field name");

  const valid = lowerSource(`import { decimal, query } from "snapback2";
    export const tiny = query({}, () => decimal(1e-7, 7));
    export const wholeForms = query({}, () => [decimal(2, 2), decimal(2.00, 2), decimal(2e0, 2), decimal(1.5e1, 2)]);
    export const thousand = query({}, () => 1e3);`, "exponents.ts");
  assert(valid.ok, `valid exponential literals refused: ${valid.ok ? "" : valid.diagnostics.map((item) => item.message).join("; ")}`);
  assert(canonical(valid.programs.find((item) => item.name === "tiny")).includes('"Int":1'), "decimal(1e-7, 7) did not lower to Int 1");
  const wholeForms = canonical(valid.programs.find((item) => item.name === "wholeForms"));
  assert((wholeForms.match(/"Int":200/g) ?? []).length === 3 && wholeForms.includes('"Int":1500'),
    "decimal whole-unit literal spellings did not scale exactly");
  assert(canonical(valid.programs.find((item) => item.name === "thousand")).includes('"Int":1000'), "1e3 did not lower to Int 1000");

  const writes = lowerSource(`import { mutation } from "snapback2";
    export const add = mutation({}, ({ db, ctx }) => {
      db.insert(products, { id: ctx.newId(), price: 2 });
      db.insert(products, { id: ctx.newId(), price: 2.00 });
      db.insert(products, { id: ctx.newId(), price: 2e0 });
      db.insert(products, { id: ctx.newId(), price: 1.5e1 });
      return true;
    });`, "whole-unit-writes.ts", undefined, { tables });
  assert(writes.ok, `whole-unit Decimal writes refused: ${writes.ok ? "" : writes.diagnostics.map((item) => item.message).join("; ")}`);
  const writeIr = canonical(writes.programs[0]);
  assert((writeIr.match(/"Int":200/g) ?? []).length === 3 && writeIr.includes('"Int":1500'),
    "Decimal-targeted integer/exponent literals were treated as minor units");

  const excess = lowerSource(`import { decimal, query } from "snapback2";
    export const bad = query({}, () => decimal(1.23e-1, 2));`, "excess-expanded-scale.ts");
  assert(!excess.ok && excess.diagnostics.some((item) => item.code === "E_DECIMAL_SCALE" && item.message.includes("3 fractional digits, scale 2")),
    "exponential literal with excess expanded precision was admitted");
  const fractional = lowerSource(`import { query } from "snapback2";
    export const bad = query({}, () => 1.5e0);`, "fractional-exponent.ts");
  assert(!fractional.ok && fractional.diagnostics.some((item) => item.code === "E_DECIMAL_SCALE"), "1.5e0 was classified as an integer");
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

test("Decimal authoring JSDoc states that numeric literals are whole units", async () => {
  const implementation = await readFile(`${crate}packages/snapback2/src/index.ts`, "utf8");
  const declarations = await readFile(`${frontend}lib.d.ts`, "utf8");
  for (const symbol of ["t.decimal", "t.money", "decimal(value, scale)"]) {
    assert(implementation.includes(symbol) && declarations.includes(symbol), `${symbol} JSDoc does not state whole-unit scaling on both module surfaces`);
  }
  assert((implementation.match(/whole units/g) ?? []).length >= 3 && (declarations.match(/whole units/g) ?? []).length >= 3,
    "Decimal authoring JSDoc omits the whole-unit ruling");
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

test("project diagnostic cap ends with an explicit truncation refusal", async () => {
  const spreads = Array.from({ length: 20 }, (_, index) => `...missing${index}`).join(", ");
  await withProject({
    "snapback/schema.ts": `import { schema } from "snapback2"; export default schema({ tables: {} });`,
    "snapback/a.ts": `import { query } from "snapback2"; export const bad = query({}, () => ({ ${spreads} }));`,
    "snapback/b.ts": `import { query } from "snapback2"; export const bad = query({}, () => ({ ${spreads} }));`,
    "snapback/c.ts": `import { query } from "snapback2"; export const bad = query({}, () => ({ ${spreads} }));`,
  }, async (root) => {
    const project = await lowerProject(root);
    assert(!project.ok && project.diagnostics.length === 50, `project diagnostic bound differs: ${project.ok ? 0 : project.diagnostics.length}`);
    const truncated = project.diagnostics.find((item) => item.code === "E_DIAG_TRUNCATED" && item.message.includes("…and "));
    assert(truncated, "project diagnostic cap silently sliced the remaining refusals");
    const firstOperation = project.diagnostics.filter((item) => item.site.startsWith("snapback/a.ts:"));
    assert(firstOperation.length <= 20 && firstOperation.some((item) => item.code === "E_DIAG_TRUNCATED"),
      "project aggregation bypassed the per-operation diagnostic bound");
  });
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

test("effect source expands JSON constant spreads and scopes every nested function and catch binding", async () => {
  const chat = await lowerProject(`${frontend}fixtures/chat`);
  assert(chat.ok, "chat effect with nested bindings was refused");
  const source = chat.project.effects.find((item) => item.name === "notifications.notify")?.source ?? "";
  assert(source.startsWith("(() => {") && source.includes('const requestDefaults = {"method":"POST"'), "effect JSON constant was not embedded in its IIFE");
  assert(source.includes('"headers":{"accept":"application/json","content-type":"application/json"}'), "effect JSON spread was dropped or override order changed");
  assert(source.includes("function identity") && source.includes("function keep") && source.includes("format(value)")
    && source.includes("catch (error)"), "nested function/method/catch bindings were not retained in emitted source");

  await withProject({
    "snapback/schema.ts": `import { schema } from "snapback2"; export default schema({ tables: {} });`,
    "snapback/effects.ts": `import { effect } from "snapback2";
      const nonJson = () => 1;
      const settings = { ...nonJson, method: "POST" };
      export const broken = effect({ grants: ["https://api.example.com"], run: async () => settings });`,
  }, async (root) => {
    const invalid = await lowerProject(root);
    const spread = !invalid.ok && invalid.diagnostics.find((item) => item.code === "E_EFFECT_CLOSURE" && item.message.includes("spread nonJson"));
    assert(spread, "non-JSON effect constant spread was not refused at the spread");
  });
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

test("npm pack from a clean dist builds every exported module and declaration", async () => {
  const packageRoot = `${crate}packages/snapback2`;
  await rm(`${packageRoot}/dist`, { recursive: true, force: true });
  const packed = Bun.spawnSync({ cmd: ["npm", "pack", "--dry-run", "--json"], cwd: packageRoot, stdout: "pipe", stderr: "pipe" });
  assert(packed.exitCode === 0, `npm pack --dry-run failed: ${new TextDecoder().decode(packed.stderr)}`);
  const report = JSON.parse(new TextDecoder().decode(packed.stdout));
  const files = new Set((report[0]?.files ?? []).map((item: { path: string }) => item.path));
  for (const path of [
    "dist/compiler.mjs", "dist/index.mjs", "dist/client.mjs", "dist/react.mjs", "dist/test.mjs",
    "dist/index.d.ts", "dist/client.d.ts", "dist/placeholder.d.ts", "dist/compiler-lib.d.ts",
  ]) assert(files.has(path), `npm pack omitted ${path}`);
});

test("binary check certifies every compiler program and reads IR only from stdin or --ir", async () => {
  const built = Bun.spawnSync({ cmd: ["cargo", "build", "-p", "snapback2"], cwd: crate, stdout: "pipe", stderr: "pipe" });
  assert(built.exitCode === 0, `cargo build failed: ${new TextDecoder().decode(built.stderr)}`);
  const chat = await lowerProject(`${frontend}fixtures/chat`);
  assert(chat.ok, "chat did not compile for binary check");
  const buildDir = `${frontend}fixtures/chat/.snapback/build`;
  await mkdir(buildDir, { recursive: true });
  const projectPath = `${buildDir}/project.json`;
  await Bun.write(projectPath, JSON.stringify(chat.project));
  const checked = runBinaryCheck(["--json", "--ir", projectPath]);
  const checkedRefusals = checked.results.filter((item: any) => item.error);
  assert(checked.exitCode === 0 && checkedRefusals.length === 0, `chat compiler output was refused: ${checked.stderr}`);
  assert(checked.results.length === chat.project.programs.length, "project check omitted programs");
  assert(checked.results.every((item: any) => (item.certificate === null) !== (item.error === null)), "project check omitted a certificate/refusal outcome");
  assert(checkedRefusals.every((item: any) => fullCheckEnvelope(item.error)), "checker refusal envelope is incomplete");
  for (const fixture of ["todos", "s1"]) {
    const lowered = await lowerProject(`${frontend}fixtures/${fixture}`);
    assert(lowered.ok, `${fixture} did not compile for binary compatibility`);
    const result = runBinaryCheck(["--json", "--ir"], lowered.project);
    const refusals = result.results.filter((item: any) => item.error);
    assert(result.exitCode === 0 && refusals.length === 0, `${fixture} compiler output had ${refusals.length} binary refusals: ${result.stderr}`);
    assert(result.results.length === lowered.project.programs.length, `${fixture} binary check omitted programs`);
  }
  const collided = runBinaryCheck(["--project", projectPath]);
  assert(collided.exitCode === 2 && collided.stderr.includes("--ir"), "--project still selects the IR-file checker form");

  const unsupportedProgram = runBinaryCheck(["--json", "--ir"], {
    schemaMode: "synthetic",
    programs: [{ name: "future", kind: "Query", args: {}, read_time_granularity_ms: null, body: [{ Future: {} }] }],
  });
  assert(unsupportedProgram.exitCode === 1 && unsupportedProgram.results[0]?.error?.code === "E_CHECK_IR_UNSUPPORTED", "unknown program IR was not a typed refusal with exit 1");
  assert(unsupportedProgram.results[0]?.error?.message.includes("Future") && fullCheckEnvelope(unsupportedProgram.results[0]?.error), "unknown program refusal omitted its variant/envelope");

  const explicit = runBinaryCheck(["--json", "--ir"], {
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
