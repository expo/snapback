import { lowerSource, type TableInfo } from "./compiler";
import type { Program, Provenance } from "./ir";
import { rustCheck } from "./rust-check";

type Test = (name: string, run: () => void | Promise<void>) => void;
type ReadFact = { site: string; table: string; provenance: Provenance };

const tables = new Map<string, TableInfo>([
  ["alpha", table("alpha")],
  ["beta", table("beta")],
  ["cards", table("cards")],
  ["items", table("items")],
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

export function registerProvenanceSiteChecks(test: Test): void {
  test("ambiguous provenance refuses with a complete envelope and compiling direct-origin rewrite", () => {
    const source = `import { query, t } from "snapback2";
function normalize(value: string) { return value + ""; }
export const lookup = query({ handle: t.text(40), normalize: t.bool() }, ({ db, args }) => {
  let key = args.handle;
  if (args.normalize) key = normalize(args.handle);
  return db.scan(users.byKey, [key], { take: 10 });
});`;
    const refused = lowerSource(source, "ambiguity.ts", undefined, { tables });
    assert(!refused.ok, "mutable key origin unexpectedly lowered");
    const diagnostic = refused.diagnostics.find((item) => item.code === "E_PROVENANCE_AMBIGUOUS");
    assert(diagnostic, `missing provenance refusal: ${refused.diagnostics.map((item) => item.code).join(", ")}`);
    assert(diagnostic.family === "opaque" && diagnostic.site.startsWith("ambiguity.ts:")
      && diagnostic.rule === "read keys have one unambiguous origin" && diagnostic.guide.length > 0,
    `provenance refusal envelope is incomplete: ${JSON.stringify(diagnostic)}`);
    assert(diagnostic.rewrite.includes("[args.handle]"), "provenance rewrite did not pass the argument directly");
    const fixed = lowerSource(diagnostic.rewrite, "ambiguity.ts", undefined, { tables });
    assert(fixed.ok, `pasted provenance rewrite did not compile: ${fixed.ok ? "" : JSON.stringify(fixed.diagnostics)}`);
    certify(fixed.programs[0]!);
  });

  test("the LLP 0329.017 C4 direct-argument trio has one provenance outcome", () => {
    const source = `import { query, t } from "snapback2";
export const helperWrappedScan = query({ key: t.text(40) }, ({ db, args }) =>
  db.scan(cards.byKey, [args.key], { take: 10 }));
export const ledger = query({ key: t.text(40) }, ({ db, args }) =>
  db.scan(owed.byKey, [args.key], { take: 10 }));
export const mentionScan = query({ key: t.text(40) }, ({ db, args }) =>
  db.scan(users.byKey, [args.key], { take: 10 }));`;
    const lowered = lowerSource(source, "c4.ts", undefined, { tables });
    assert(lowered.ok, `C4 trio refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    const outcomes = lowered.programs.map((program) => reads(program)[0]?.provenance);
    assert(outcomes.length === 3 && outcomes.every((item) => item === "Arg"),
      `identical direct-argument scans disagreed: ${outcomes.join(", ")}`);
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

  test("site ordinals count writes in the export's source order", () => {
    const program = lowerOne(`import { mutation, t } from "snapback2";
export const touch = mutation({ key: t.text(40) }, ({ db, ctx, args }) => {
  db.insert(items, { id: ctx.newId(), key: args.key });
  return db.scan(items.byKey, [args.key], { take: 10 });
});`, "access.ts");
    assert(readMap(program) === "access.touch.1:items:Arg", `write did not reserve ordinal zero: ${readMap(program)}`);
    assert(certificateReadMap(certify(program)) === "access.touch.1:items:Arg",
      "certificate did not retain the read/write source ordinal");
  });
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
