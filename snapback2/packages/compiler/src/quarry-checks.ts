import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { FrontendDiagnostic, Program, ProjectJson } from "./ir";
import { lowerProject, lowerSeed } from "./project";
import { rustCheck } from "./rust-check";
import { compileQuarry, type QuarryInput } from "./quarry/index";
import { parseDocument } from "./quarry/parser";

type Test = (name: string, run: () => void | Promise<void>) => void;

export function registerQuarryChecks(test: Test, frontend: string): void {
  const fixtures = resolve(frontend, "fixtures");
  const packageRoot = resolve(frontend, "../snapback2");

  test("Quarry todos and full surface lower in memory and certify", async () => {
    for (const [name, count] of [["quarry-todos", 2], ["quarry-surface", 20]] as const) {
      const lowered = await lowerProject(resolve(fixtures, name));
      assert(lowered.ok, `${name} refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      assert(lowered.project.programs.length === count, `${name} program count changed to ${lowered.project.programs.length}`);
      const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).filter((item) => item.error);
      assert(failures.length === 0, `${name} did not certify: ${JSON.stringify(failures)}`);
      assert(!existsSync(resolve(fixtures, name, "snapback/schema.ts")), `${name} wrote generated schema.ts into the authored tree`);
      assert(!existsSync(resolve(fixtures, name, "snapback/surface.q.ts")), `${name} wrote generated .q.ts into the authored tree`);
    }

    const compiled = compileFixture(fixtures, "quarry-surface", ["schema", "surface"]);
    assert(compiled.ok, `surface front end refused: ${compiled.ok ? "" : diagnosticsText(compiled.diagnostics)}`);
    const text = `${compiled.schema.source}\n${compiled.modules[0]!.source}`;
    for (const spelling of [
      "rule.and(", "rule.or(", "rule.not(", "rule.exists(", "channel({", "t.optional(", "t.enum(",
      "t.principal()", "t.id()", "t.json(2048)", "t.bytes(1024)", "db.upsert(", "orderedPair(",
      "mentionTokens(", "recurse(", 'order: "desc"', "after:", "__q_matchResult", "db.get(users",
    ]) assert(text.includes(spelling), `Quarry full-surface lowering lost ${spelling}`);
    for (const line of text.split("\n").filter((line) => line.trim())) {
      assert(/\/\/ q:.+:\d+:\d+$/.test(line), `generated Quarry line lacks file:line:column provenance: ${line}`);
    }
  });

  test("Quarry chat matches the TypeScript schema and full-project certification", async () => {
    const quarry = await lowerProject(resolve(fixtures, "quarry-chat"));
    const typescript = await lowerProject(resolve(fixtures, "chat"));
    assert(quarry.ok, `Quarry chat refused: ${quarry.ok ? "" : diagnosticsText(quarry.diagnostics)}`);
    assert(typescript.ok, `TypeScript chat refused: ${typescript.ok ? "" : diagnosticsText(typescript.diagnostics)}`);
    assert(quarry.project.programs.length === typescript.project.programs.length,
      `chat program counts differ: Quarry ${quarry.project.programs.length}, TS ${typescript.project.programs.length}`);
    assert(canonical(normalizeSchema(quarry.project)) === canonical(normalizeSchema(typescript.project)),
      "Quarry chat tables/rules/constraints/maintains/channels/effects differ from the TypeScript rendering");
    assert(fullProjectErrors(quarry.project).length === 0, `Quarry chat full project did not certify: ${JSON.stringify(fullProjectErrors(quarry.project))}`);
    assert(fullProjectErrors(typescript.project).length === 0, `TypeScript chat full project did not certify: ${JSON.stringify(fullProjectErrors(typescript.project))}`);
    assert(!quarry.apiDts.includes(".q") && /messages:\s*\{/.test(quarry.apiDts), "api.d.ts leaked a .q namespace or lost messages");

    const seeded = await lowerSeed(resolve(packageRoot, "templates/chat"));
    assert(seeded.ok && seeded.seed.rows.messages?.length === 2, `Quarry chat seed did not lower: ${seeded.ok ? "wrong rows" : diagnosticsText(seeded.diagnostics)}`);
  });

  test("Quarry effects, maintains, aggregate sugar, where, returns, objects, and count reach IR", async () => {
    const chat = await lowerProject(resolve(fixtures, "quarry-chat"));
    const surface = await lowerProject(resolve(fixtures, "quarry-surface"));
    assert(chat.ok && surface.ok, "Quarry feature fixtures refused");
    const send = operation(chat.project.programs, "messages.send");
    assert(deepKey(send.body, "Emit") && JSON.stringify(send.body).includes('"effect":"notifications.notify"'), "effect/emit did not lower with its qualified effect");
    const countMaintain = chat.project.schema.maintains[0] as any;
    assert(countMaintain.kind === "Count" && countMaintain.source === "messages" && countMaintain.target === "messageCounts", "count maintain changed");
    const sumMaintain = surface.project.schema.maintains[0] as any;
    assert(sumMaintain.kind?.Sum?.of === "value" && sumMaintain.readable, "sum/readable maintain changed");
    assert(deepKey(operation(surface.project.programs, "surface.counterTotal").body, "Get"), "#maintain did not lower to a target-table get");
    assert(deepKey(operation(surface.project.programs, "surface.visiblePosts").body, "For")
      && deepKey(operation(surface.project.programs, "surface.visiblePosts").body, "Push"), "where did not lower to a bounded filter loop");
    assert(deepKey(operation(surface.project.programs, "surface.visiblePosts").body, "Object"), "object literal did not reach IR");
    assert(deepKey(operation(surface.project.programs, "surface.visiblePosts").body, "Builtin")
      && JSON.stringify(operation(surface.project.programs, "surface.visiblePosts")).includes('"builtin":"Len"'), "count(page) did not lower through bounded Len policy");
    for (const name of ["surface.postsAfter", "surface.ensureUser", "surface.firstPositive"]) {
      assert(deepKey(operation(surface.project.programs, name).body, "Return"), `${name} lost a nested explicit return`);
    }
  });

  test("Quarry maps platform refusals and operation source sites back to .q", async () => {
    const qSchema = readFileSync(resolve(fixtures, "quarry-chat/snapback/schema.q"), "utf8");
    const effect = readFileSync(resolve(fixtures, "quarry-chat/snapback/notifications.ts"), "utf8");
    const bad = `effect notify from notifications\n\nquery bad():\n  emit notify { to: 'somebody', body: 'hello' }\n  return null\n`;
    await withProject({
      "snapback/schema.q": qSchema,
      "snapback/notifications.ts": effect,
      "snapback/bad.q": bad,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(!lowered.ok, "emit in a Quarry query unexpectedly lowered");
      const refusal = lowered.diagnostics.find((item) => item.code === "E_EMIT_IN_QUERY");
      assert(refusal?.site === "snapback/bad.q:4:3", `generated refusal site was not mapped to the emit: ${refusal?.site}`);
      assert(refusal.rewrite === bad, "generated refusal rewrite was not Quarry source");
    });

    const chat = await lowerProject(resolve(fixtures, "quarry-chat"));
    assert(chat.ok && chat.sources["messages.send"]?.file === "snapback/messages.q", "certification source map did not point at messages.q");
    assert((chat.sources["messages.send"]?.col ?? 0) > 0, "certification source map lost the Quarry column");
  });

  test("Quarry parser recovers and every refusal envelope is complete", () => {
    const syntax = compileFixture(fixtures, "quarry-invalid", ["schema", "syntax"]);
    assert(!syntax.ok, "invalid syntax fixture unexpectedly compiled");
    assert(syntax.diagnostics.filter((item) => item.code === "E_QUARRY_SYNTAX").length >= 3,
      `parser stopped before reporting all syntax defects: ${diagnosticsText(syntax.diagnostics)}`);

    const cases: Array<[string, string]> = [
      ["syntax", "E_QUARRY_SYNTAX"],
      ["unknown", "E_QUARRY_UNKNOWN"],
      ["ambiguous", "E_QUARRY_AMBIGUOUS"],
      ["unsupported", "E_QUARRY_UNSUPPORTED"],
      ["placement", "E_QUARRY_PLACEMENT"],
    ];
    for (const [file, code] of cases) {
      const result = compileFixture(fixtures, "quarry-invalid", ["schema", file]);
      assert(!result.ok, `${file} unexpectedly compiled`);
      const matching = result.diagnostics.filter((diagnostic) => diagnostic.code === code);
      const item = matching[0];
      assert(item, `${file} did not report ${code}: ${diagnosticsText(result.diagnostics)}`);
      assert(matching.length >= 2, `${file} stopped at its first ${code}: ${diagnosticsText(result.diagnostics)}`);
      assert(item.family === "quarry" && item.site.includes(`/${file}.q:`), `${code} lost Quarry family/site`);
      assert(item.rewrite.startsWith("-- ") && item.guide.startsWith("quarry/"), `${code} lost Quarry rewrite/guide`);
      if (code === "E_QUARRY_UNSUPPORTED") assert(item.message.includes("not part of the Snapback 2 platform"), "unsupported wording drifted back to subset language");
    }
  });

  test("every Quarry diagnostic family rewrite is fenced parseable Quarry", () => {
    const families = JSON.parse(readFileSync(resolve(packageRoot, "guide/families.source.json"), "utf8")) as Array<Record<string, string>>;
    const quarry = families.filter((item) => item.family === "quarry");
    const expected = new Set(["E_QUARRY_SYNTAX", "E_QUARRY_UNKNOWN", "E_QUARRY_AMBIGUOUS", "E_QUARRY_UNSUPPORTED", "E_QUARRY_PLACEMENT"]);
    assert(quarry.length === expected.size, `Quarry family entry count changed: ${quarry.length}`);
    for (const item of quarry) {
      assert(expected.delete(item.code), `unexpected/duplicate Quarry family code ${item.code}`);
      const match = item.right.match(/^```q\n([\s\S]+)\n```$/);
      assert(match, `${item.code} right rewrite is not fenced Quarry`);
      const parsed = parseDocument("right.q", match[1]!);
      assert(parsed.diagnostics.length === 0, `${item.code} right rewrite does not parse: ${parsed.diagnostics.map((entry) => entry.message).join("; ")}`);
    }
    assert(expected.size === 0, `missing Quarry family entries: ${[...expected].join(", ")}`);
  });

  test("principal remains nominal in Quarry rules and program values", () => {
    const source = `use identity\n\ntable users:\n  name: text <=40\n  public\n\ntable items:\n  owner: users\n  read r <- r.owner = viewer\n`;
    const compiled = compileQuarry([{ path: "/virtual/schema.q", fileName: "snapback/schema.q", source }]);
    assert(!compiled.ok, "a table ref compared with viewer was accepted");
    const refusal = compiled.diagnostics[0]!;
    assert(refusal.code === "E_QUARRY_UNKNOWN" && refusal.family === "quarry" && refusal.site === "snapback/schema.q:9:21",
      `nominal refusal was not a sited Quarry diagnostic: ${JSON.stringify(refusal)}`);
    assert(refusal.message.includes("fields compared with viewer must be principal"), `nominal refusal message changed: ${refusal.message}`);
  });

  test("db.insert row expressions are bound once and share the returned variable", async () => {
    await withProject({
      "snapback/schema.ts": `import { rule, schema, table, t } from "snapback2";\nexport const items = table({ columns: { owner: t.principal() }, rules: { read: rule.allow(), insert: rule.allow() } });\nexport default schema({ auth: { password: true, guests: true }, tables: { items } });\n`,
      "snapback/items.ts": `import { mutation } from "snapback2";\nimport { items } from "./schema";\nexport const add = mutation({}, ({ db, ctx }) => {\n  return db.insert(items, { id: ctx.newId(), owner: ctx.viewer });\n});\n`,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `inline insert fixture refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const body = operation(lowered.project.programs, "items.add").body as any[];
      const letStmt = body.find((item) => item.Let?.name?.startsWith("__insertRow"));
      const insert = body.find((item) => item.Insert);
      const returned = body.find((item) => item.Return);
      assert(letStmt && insert?.Insert?.row?.Variable === letStmt.Let.name && returned?.Return?.Variable === letStmt.Let.name,
        `insert/storage/return do not share one temporary: ${JSON.stringify(body)}`);
      assert(rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).every((item) => !item.error), "single-evaluation insert IR did not certify");
    });
  });

  test("Quarry mutually exclusive branch writes share the certifier/runtime bound", async () => {
    const lowered = await lowerProject(resolve(fixtures, "quarry-surface"));
    assert(lowered.ok, "Quarry branch-write fixture refused");
    const program = operation(lowered.project.programs, "surface.branchWrite");
    const checked = rustCheck([program], "synthetic", lowered.project.schema)[0]!;
    assert(!checked.error, `branch write did not certify: ${JSON.stringify(checked.error)}`);
    const sites = checked.certificate?.write_sites as Array<{ table: string; max_rows: number }>;
    assert(sites?.some((site) => site.table === "counters" && site.max_rows === 1), `branch write bound is not one: ${JSON.stringify(sites)}`);
  });

  test("Quarry and TypeScript project placement is exact", async () => {
    await withProject({
      "snapback/schema.q": "table items:\n  value: int\n  public\n",
      "snapback/schema.ts": "export default {};\n",
      "snapback/items.q": "query list():\n  return null\n",
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics[0]?.code === "E_QUARRY_PLACEMENT" && result.diagnostics[0].site === "snapback/schema.q:1:1",
        "dual schema placement did not point at schema.q");
    });
    await withProject({
      "snapback/schema.ts": "export default {};\n",
      "snapback/items.q": "query list():\n  return null\n",
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics[0]?.code === "E_QUARRY_PLACEMENT", ".q beside schema.ts was not refused");
    });
    await withProject({
      "snapback/schema.q": "table items:\n  value: int\n  public\n",
      "snapback/items.q": "query fromQuarry():\n  return null\n",
      "snapback/items.ts": "import { query } from 'snapback2'; export const fromTs = query({}, () => null);\n",
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics.some((item) => item.code === "E_OP_MODULE_BASENAME"), "same-stem .q/.ts modules were not refused");
    });
  });
}

function compileFixture(fixtures: string, name: string, stems: string[]) {
  const directory = resolve(fixtures, name, "snapback");
  const inputs: QuarryInput[] = stems.map((stem) => {
    const path = resolve(directory, `${stem}.q`);
    return { path, fileName: `snapback/${stem}.q`, source: readFileSync(path, "utf8") };
  });
  return compileQuarry(inputs);
}

async function withProject<T>(files: Record<string, string>, run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "snapback2-quarry-check-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      const target = resolve(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source);
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function fullProjectErrors(project: ProjectJson): unknown[] {
  const crate = resolve(decodeURIComponent(new URL("../../../", import.meta.url).pathname));
  const process = Bun.spawnSync({
    cmd: [resolve(crate, "target/debug/snapback2"), "check", "--ir", "--json"],
    cwd: crate,
    stdin: new TextEncoder().encode(JSON.stringify(project)),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (process.exitCode !== 0 && process.exitCode !== 1) throw new Error(new TextDecoder().decode(process.stderr));
  const output = JSON.parse(new TextDecoder().decode(process.stdout)) as { results?: Array<{ error?: unknown }> };
  return (output.results ?? []).filter((item) => item.error);
}

function normalizeSchema(project: ProjectJson): unknown {
  const schema = project.schema as any;
  const tables = schema.tables as Record<string, any>;
  const signature = (table: string, index: string) => {
    const descriptor = tables[table]?.indexes?.[index];
    return descriptor ? JSON.stringify({ columns: descriptor.columns, unique: descriptor.unique }) : index;
  };
  const rewriteIndexes = (value: any): any => {
    if (Array.isArray(value)) return value.map(rewriteIndexes);
    if (!value || typeof value !== "object") return value;
    if (value.Exists || value.Created) {
      const key = value.Exists ? "Exists" : "Created";
      const item = value[key];
      return { [key]: { ...rewriteIndexes(item), index: signature(item.table, item.index) } };
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteIndexes(item)]));
  };
  const normalizedTables = Object.fromEntries(Object.entries(tables).map(([name, table]) => {
    const indexes = Object.values(table.indexes).map((index: any) => ({ columns: index.columns, unique: index.unique })).sort(byJson);
    const constraints = table.constraints.map((constraint: any) => {
      if (constraint.Unique) return { Unique: { index: signature(name, constraint.Unique.index) } };
      if (constraint.FinalExistsOnInsert) {
        const item = constraint.FinalExistsOnInsert;
        return { FinalExistsOnInsert: { ...item, index: signature(item.table, item.index) } };
      }
      return constraint;
    }).map(rewriteIndexes).sort(byJson);
    return [name, { columns: table.columns, indexes, rules: rewriteIndexes(table.rules), constraints }];
  }));
  return {
    auth: schema.auth,
    tables: normalizedTables,
    maintains: rewriteIndexes(schema.maintains),
    channels: rewriteIndexes(schema.channels),
    effects: [...schema.effects].sort(),
    projectEffects: project.effects.map((effect) => effect.name).sort(),
  };
}

function byJson(left: unknown, right: unknown): number { return JSON.stringify(left).localeCompare(JSON.stringify(right)); }
function canonical(value: unknown): string {
  const normalize = (item: any): any => Array.isArray(item)
    ? item.map(normalize)
    : item && typeof item === "object"
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]))
      : item;
  return JSON.stringify(normalize(value));
}
function operation(programs: Program[], name: string): Program {
  const program = programs.find((item) => item.name === name);
  assert(program, `missing operation ${name}`);
  return program;
}
function deepKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => deepKey(item, key));
  if (!value || typeof value !== "object") return false;
  return key in value || Object.values(value).some((item) => deepKey(item, key));
}
function diagnosticsText(diagnostics: FrontendDiagnostic[]): string {
  return diagnostics.map((item) => `${item.code}@${item.site}: ${item.message}`).join("; ");
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
