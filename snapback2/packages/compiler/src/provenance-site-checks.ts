import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { lowerProject, lowerSource, type TableInfo } from "./compiler";
import type { Program, Provenance } from "./ir";
import { rustCheck } from "./rust-check";

type Test = (name: string, run: () => void | Promise<void>) => void;
type ReadFact = { site: string; table: string; provenance: Provenance };

const tables = new Map<string, TableInfo>([
  ["alpha", table("alpha")],
  ["beta", table("beta")],
  ["cards", table("cards")],
  ["items", table("items")],
  ["memberships", table("memberships")],
  ["owed", table("owed")],
  ["users", table("users")],
]);

const schema = {
  tables: Object.fromEntries([...tables.values()].map((item) => [item.name, {
    columns: { id: "Id", key: { Text: { max: 40 } } },
    indexes: {
      byId: { columns: ["id"], unique: true },
      byKey: { columns: ["key", "id"], unique: false },
    },
    rules: { read: "Allow", insert: "Allow", update: "Allow", delete: "Allow" },
    constraints: [],
  }])),
  maintains: [],
  channels: {},
  auth: { password: false, guests: false },
  effects: [],
};

export function registerProvenanceSiteChecks(test: Test, s1Fixture: string): void {
  test("ambiguous provenance refuses with a complete envelope and compiling direct-origin rewrite", () => {
    const source = `import { query, t } from "snapback2";
function normalize(value: string) { return value + ""; }
export const lookup = query({ handle: t.text(40), normalize: t.bool() }, ({ db, args }) => {
  let key = normalize(args.handle);
  if (args.normalize) key = args.handle;
  return db.scan(users.byKey, [key], { take: 10 });
});`;
    const refused = lowerSource(source, "ambiguity.ts", undefined, { tables });
    assert(!refused.ok, "mutable key origin unexpectedly lowered");
    const diagnostic = refused.diagnostics.find((item) => item.code === "E_PROVENANCE_AMBIGUOUS");
    assert(diagnostic, `missing provenance refusal: ${refused.diagnostics.map((item) => item.code).join(", ")}`);
    assert(diagnostic.family === "opaque" && diagnostic.site.startsWith("ambiguity.ts:")
      && diagnostic.rule === "read keys have one unambiguous origin" && diagnostic.guide === "opaque/provenance",
    `provenance refusal envelope is incomplete: ${JSON.stringify(diagnostic)}`);
    assert(diagnostic.rewrite.includes("[args.handle]"), "provenance rewrite did not pass the argument directly");
    assert(!diagnostic.rewrite.includes("[args.normalize]"), "provenance rewrite walked the helper callee before its arguments");
    const fixed = lowerSource(diagnostic.rewrite, "ambiguity.ts", undefined, { tables });
    assert(fixed.ok, `pasted provenance rewrite did not compile: ${fixed.ok ? "" : JSON.stringify(fixed.diagnostics)}`);
    certify(fixed.programs[0]!);
  });

  test("the real LLP 0329.017 C4 trio is body-derived and reproducible", async () => {
    const lowered = await lowerProject(s1Fixture);
    assert(lowered.ok, `S1 C4 fixture refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    const outcomes = ["helperWrappedScan", "ledger", "mentionScan"].map((name) => {
      const program = lowered.project.programs.find((candidate) => candidate.name === `programs.${name}`);
      assert(program, `S1 C4 fixture omitted ${name}`);
      return reads(program)[0]?.provenance;
    });
    // The first two helpers pass their argument through; mentionScan's `${value}` helper body
    // is an explicit transform. The helper names never participate in classification.
    assert(canonical(outcomes) === canonical(["Arg", "Arg", "Computed"]),
      `real C4 body-derived outcomes changed: ${outcomes.join(", ")}`);
  });

  test("identical helper bodies classify identically regardless of helper name", () => {
    const source = `import { query, t } from "snapback2";
function loadCards(db: any, value: string) { return db.scan(cards.byKey, [value], { take: 10 }); }
function fetchCards(db: any, value: string) { return db.scan(cards.byKey, [value], { take: 10 }); }
function readCards(db: any, value: string) { return db.scan(cards.byKey, [value], { take: 10 }); }
export const first = query({ key: t.text(40) }, ({ db, args }) => loadCards(db, args.key));
export const second = query({ key: t.text(40) }, ({ db, args }) => fetchCards(db, args.key));
export const third = query({ key: t.text(40) }, ({ db, args }) => readCards(db, args.key));`;
    const lowered = lowerSource(source, "c4.ts", undefined, { tables });
    assert(lowered.ok, `identical-body trio refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    const outcomes = lowered.programs.map((program) => reads(program)[0]?.provenance);
    assert(outcomes.length === 3 && outcomes.every((item) => item === "Arg"),
      `identical helper bodies disagreed: ${outcomes.join(", ")}`);
  });

  test("unknown origins stay ambiguous through immutable aliases and composite properties", () => {
    for (const key of ["k", "packed.key"]) {
      const setup = key === "k" ? "const k = mystery;" : "const packed = mystery;";
      const refused = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args }) => {
  ${setup}
  return db.scan(items.byKey, [${key}], { take: 10 });
});`, `unknown-${key.replace(".", "-")}.ts`, undefined, { tables });
      assert(!refused.ok && refused.diagnostics.some((item) => item.code === "E_PROVENANCE_AMBIGUOUS"),
        `unknown origin laundered through ${key}: ${refused.ok ? "lowered" : JSON.stringify(refused.diagnostics)}`);
    }
  });

  test("property provenance follows composite members while proven row fields stay Shape", () => {
    const source = `import { query, t } from "snapback2";
function conversationShape(value: string) { return ({ value }).value; }
export const wrapped = query({ key: t.text(40) }, ({ db, args }) =>
  db.scan(items.byKey, [conversationShape(args.key)], { take: 10 }));
export const packed = query({ key: t.text(40) }, ({ db, args }) => {
  const packed = { key: args.key };
  return db.scan(items.byKey, [packed.key], { take: 10 });
});
export const rowField = query({ key: t.text(40) }, ({ db, args }) =>
  db.scan(alpha.byKey, [args.key], { take: 10 }).map(row =>
    db.get(beta.byKey, [row.key])));`;
    const lowered = lowerSource(source, "properties.ts", undefined, { tables });
    assert(lowered.ok, `property provenance fixture refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    const maps = new Map(lowered.programs.map((program) => [program.name, readMap(program)]));
    assert(maps.get("wrapped") === "properties.wrapped.0:items:Arg", `identity wrapper lost Arg: ${maps.get("wrapped")}`);
    assert(maps.get("packed") === "properties.packed.0:items:Arg", `packed member lost Arg: ${maps.get("packed")}`);
    assert(maps.get("rowField") === "properties.rowField.0:alpha:Arg|properties.rowField.1:beta:Shape",
      `row field was not reserved to a proven row binding: ${maps.get("rowField")}`);
  });

  test("memberOf combines its actual members so explicit transforms dominate", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const membership = query({ id: t.text(40) }, ({ args }) => memberOf(args.id + ""));`, "member-of.ts");
    assert(readMap(program) === "member-of.membership.0:memberships:Computed",
      `memberOf ignored its computed member: ${readMap(program)}`);
  });

  test("site and certificate identity survive helper rename, extraction, inline, and reformat", () => {
    const inline = `import { query, t } from "snapback2";
export const list = query({ key: t.text(40) }, ({ db, args }) => db.scan(items.byKey, [args.key], { take: 10 }));`;
    const extracted = (helper: string) => `import { query, t, type Db } from "snapback2";
function ${helper}(db: Db, key: string) { return db.scan(items.byKey, [key], { take: 10 }); }
export const list = query({ key: t.text(40) }, ({ db, args }) => ${helper}(db, args.key));`;
    const reformatted = `import { query, t } from "snapback2";

export const list = query(
  { key: t.text(40) },
  ({ db, args }) =>
    db.scan(
      items.byKey,
      [args.key],
      { take: 10 },
    ),
);`;
    const variants = [inline, extracted("loadRows"), extracted("renamedRows"), reformatted]
      .map((source) => lowerOne(source, "activity.ts"));
    const encoded = variants.map(canonical);
    assert(encoded.every((item) => item === encoded[0]), "site or emitted program changed across a refactor");
    assert(reads(variants[0]!)[0]?.site === "activity.list.0", `site is not module.export.ordinal: ${encoded[0]}`);
    const certificates = variants.map((program) => certify(program));
    assert(certificates.every((item) => canonical(item) === canonical(certificates[0])),
      "certificate changed across helper rename/extract/inline/reformat");
  });

  test("read ordinals follow source order and carry each read's provenance into its certificate", () => {
    const operation = (betaFirst: boolean) => `import { query, t } from "snapback2";
export const compare = query({ key: t.text(40) }, ({ db, args }) => {
  ${betaFirst
    ? "const betaRows = db.scan(beta.byKey, [args.key + \"\"], { take: 10 });\n  const alphaRows = db.scan(alpha.byKey, [args.key], { take: 10 });"
    : "const alphaRows = db.scan(alpha.byKey, [args.key], { take: 10 });\n  const betaRows = db.scan(beta.byKey, [args.key + \"\"], { take: 10 });"}
  return { alphaRows, betaRows };
});`;
    const alphaFirst = lowerOne(operation(false), "ordering.ts");
    const betaFirst = lowerOne(operation(true), "ordering.ts");
    assert(readMap(alphaFirst) === "ordering.compare.0:alpha:Arg|ordering.compare.1:beta:Computed",
      `alpha-first ordinals are wrong: ${readMap(alphaFirst)}`);
    assert(readMap(betaFirst) === "ordering.compare.0:beta:Computed|ordering.compare.1:alpha:Arg",
      `beta-first ordinals are wrong: ${readMap(betaFirst)}`);
    const firstCertificate = certify(alphaFirst);
    const secondCertificate = certify(betaFirst);
    assert(canonical(firstCertificate) !== canonical(secondCertificate), "read reorder was invisible to certification");
    assert(certificateReadMap(firstCertificate) === "ordering.compare.0:alpha:Arg|ordering.compare.1:beta:Computed",
      `alpha-first certificate lost site provenance: ${canonical(firstCertificate)}`);
    assert(certificateReadMap(secondCertificate) === "ordering.compare.0:beta:Computed|ordering.compare.1:alpha:Arg",
      `beta-first certificate lost site provenance: ${canonical(secondCertificate)}`);
  });

  test("nested nullish reads allocate ordinals left to right", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const fallback = query({ key: t.text(40) }, ({ db, args }) =>
  db.get(alpha.byKey, [args.key]) ?? db.get(beta.byKey, [args.key]));`, "nested.ts");
    assert(readMap(program) === "nested.fallback.0:alpha:Arg|nested.fallback.1:beta:Arg",
      `nullish reads did not retain source order: ${readMap(program)}`);
  });

  test("site ordinals count writes in the export's source order", () => {
    const program = lowerOne(`import { mutation, t } from "snapback2";
export const touch = mutation({ key: t.text(40) }, ({ db, ctx, args }) => {
  db.insert(items, { id: ctx.newId(), key: args.key });
  return db.scan(items.byKey, [args.key], { take: 10 });
});`, "access.ts");
    assert(readMap(program) === "access.touch.1:items:Arg", `write did not reserve ordinal zero: ${readMap(program)}`);
    assert(certificateReadMap(certify(program)) === "access.touch.1:items:Arg",
      "certificate did not retain the read/write source ordinal");

    for (const method of ["update", "upsert"] as const) {
      const callback = lowerOne(`import { mutation, t } from "snapback2";
export const touch = mutation({ key: t.text(40) }, ({ db, args }) => {
  db.${method}(items, args.key, row => ({ id: args.key, key: row.key }));
  return db.scan(items.byKey, [args.key], { take: 10 });
});`, `callback-${method}.ts`);
      assert(readMap(callback) === `callback-${method}.touch.0:items:Arg|callback-${method}.touch.2:items:Arg`,
        `${method} callback write did not reserve ordinal one: ${readMap(callback)}`);
    }
  });

  test("project lowering refuses duplicate module basenames before site identities can collide", async () => {
    await withProject({
      "snapback/schema.ts": `import { schema } from "snapback2"; export default schema({ tables: {} });`,
      "snapback/activity.ts": `import { query } from "snapback2"; export const first = query({}, () => null);`,
      "snapback/nested/activity.ts": `import { query } from "snapback2"; export const second = query({}, () => null);`,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(!lowered.ok, "duplicate module basenames unexpectedly lowered");
      const collisions = lowered.diagnostics.filter((item) => item.code === "E_OP_RESERVED"
        && item.message.includes("module basename activity is duplicated"));
      assert(collisions.length === 2 && collisions.every((item) => item.family === "op" && item.site.endsWith(":1:1")),
        `duplicate basename refusal was not complete and sited: ${JSON.stringify(collisions)}`);
    });
  });
}

async function withProject(files: Record<string, string>, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "snapback2-provenance-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function table(name: string): TableInfo {
  return { name, private: false, columns: { id: { kind: "string" }, key: { kind: "string", max: 40 } } };
}

function lowerOne(source: string, fileName: string): Program {
  const lowered = lowerSource(source, fileName, undefined, { tables });
  assert(lowered.ok, `${fileName} refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
  assert(lowered.programs.length === 1, `${fileName} emitted ${lowered.programs.length} programs`);
  return lowered.programs[0]!;
}

function reads(program: Program): ReadFact[] {
  const found: ReadFact[] = [];
  visit(program.body, (value) => {
    for (const kind of ["Get", "Exists", "Scan", "Recurse"] as const) {
      const read = value[kind] as ReadFact | undefined;
      if (read?.site && read.table && read.provenance) found.push(read);
    }
    const page = value.Page as ReadFact | undefined;
    if (page?.site && page.table && page.provenance) found.push(page);
  });
  return found;
}

function visit(value: unknown, callback: (value: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, callback);
    return;
  }
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  callback(object);
  for (const item of Object.values(object)) visit(item, callback);
}

function readMap(program: Program): string {
  return reads(program).map((item) => `${item.site}:${item.table}:${item.provenance}`).join("|");
}

function certify(program: Program): Record<string, unknown> {
  const result = rustCheck([program], "synthetic", schema)[0];
  assert(result?.error === null && result.certificate, `program did not certify: ${JSON.stringify(result)}`);
  return result.certificate;
}

function certificateReadMap(certificate: Record<string, unknown>): string {
  const sites = certificate.read_sites as Array<{ site: string; table: string; prefix_template: Provenance }>;
  return sites.map((item) => `${item.site}:${item.table}:${item.prefix_template}`).join("|");
}

function canonical(value: unknown): string {
  const normalize = (item: any): any => Array.isArray(item)
    ? item.map(normalize)
    : item && typeof item === "object"
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]))
      : item;
  return JSON.stringify(normalize(value));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
