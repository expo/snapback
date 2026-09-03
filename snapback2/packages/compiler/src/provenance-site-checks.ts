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
      byKey: { columns: ["key"], unique: true },
      byKeyId: { columns: ["key", "id"], unique: true },
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

  test("loop and orderedPair bindings retain mutable-origin ambiguity", () => {
    const loop = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args, ctx }) => {
  let mystery = args.key;
  mystery = ctx.viewer;
  const found = [];
  for (const key of [mystery]) found.push(db.get(items.byKey, [key]));
  return found;
});`, "loop-binding.ts", undefined, { tables });
    assert(!loop.ok && loop.diagnostics.some((item) => item.code === "E_PROVENANCE_AMBIGUOUS"),
      `loop binding laundered a mutable origin: ${loop.ok ? "lowered" : JSON.stringify(loop.diagnostics)}`);

    const pair = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args, ctx }) => {
  let mystery = args.key;
  mystery = ctx.viewer;
  const [first, second] = orderedPair(mystery, args.key);
  return db.scan(items.byKey, [first], { take: 10 });
});`, "pair-binding.ts", undefined, { tables });
    assert(!pair.ok && pair.diagnostics.some((item) => item.code === "E_PROVENANCE_AMBIGUOUS"),
      `orderedPair binding laundered a mutable origin: ${pair.ok ? "lowered" : JSON.stringify(pair.diagnostics)}`);
  });

  test("later object spreads resolve required args and refuse optional overrides", () => {
    const required = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args, ctx }) =>
  db.scan(items.byKey, [({ key: ctx.viewer, ...args }).key], { take: 10 }));`, "spread-required.ts");
    assert(readMap(required) === "spread-required.lookup.0:items:Arg",
      `known required spread did not override the earlier member: ${readMap(required)}`);

    const optional = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ key: t.optional(t.text(40)) }, ({ db, args, ctx }) =>
  db.scan(items.byKey, [({ key: ctx.viewer, ...args }).key], { take: 10 }));`, "spread-optional.ts", undefined, { tables });
    assert(!optional.ok && optional.diagnostics.some((item) => item.code === "E_PROVENANCE_AMBIGUOUS"),
      `optional spread silently chose one override origin: ${optional.ok ? "lowered" : JSON.stringify(optional.diagnostics)}`);

    const nullableRow = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args }) => {
  const row = db.get(beta.byKey, [args.key]);
  return db.scan(items.byKey, [({ key: args.key, ...row }).key], { take: 10 });
});`, "spread-nullable-row.ts", undefined, { tables });
    assert(!nullableRow.ok && nullableRow.diagnostics.some((item) => item.code === "E_OPAQUE"
      && item.message.includes("nullable db.get result")),
    `nullable row spread silently overrode an earlier member: ${nullableRow.ok ? "lowered" : JSON.stringify(nullableRow.diagnostics)}`);
  });

  test("args and ctx are composites through unwrap, helpers, aliases, and spreads", () => {
    const source = `import { query, t } from "snapback2";
function pick(value: any) { return value.key; }
function identity(value: string) { return ({ value }).value; }
export const direct = query({ key: t.text(40) }, ({ db, args }) => db.scan(items.byKey, [args.key], { take: 10 }));
export const asserted = query({ key: t.text(40) }, ({ db, args }) => db.scan(items.byKey, [(args as any).key], { take: 10 }));
export const helper = query({ key: t.text(40) }, ({ db, args }) => db.scan(items.byKey, [pick(args)], { take: 10 }));
export const alias = query({ key: t.text(40) }, ({ db, args }) => { const packed = args; return db.scan(items.byKey, [packed.key], { take: 10 }); });
export const spread = query({ key: t.text(40) }, ({ db, args }) => db.scan(items.byKey, [({ ...args }).key], { take: 10 }));
export const context = query({ key: t.text(40) }, ({ db, ctx }) => { const c = ctx; return db.scan(items.byKey, [c.viewer], { take: 10 }); });
export const wrapped = query({ key: t.text(40) }, ({ db, args }) => db.scan(items.byKey, [identity(args.key)], { take: 10 }));
export const object = query({ key: t.text(40) }, ({ db, args }) => db.scan(items.byKey, [({ key: args.key }).key], { take: 10 }));
export const helperObject = query({ key: t.text(40) }, ({ db, args }) => db.scan(items.byKey, [pick({ key: args.key })], { take: 10 }));`;
    const lowered = lowerSource(source, "composites.ts", undefined, { tables });
    assert(lowered.ok, `composite controls refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    const outcomes = new Map(lowered.programs.map((program) => [program.name, readMap(program)]));
    for (const name of ["direct", "asserted", "helper", "alias", "spread", "wrapped", "object", "helperObject"]) {
      assert(outcomes.get(name) === `composites.${name}.0:items:Arg`, `${name} lost Arg: ${outcomes.get(name)}`);
    }
    assert(outcomes.get("context") === "composites.context.0:items:Viewer", `ctx alias lost Viewer: ${outcomes.get("context")}`);
    for (const program of lowered.programs) certify(program);
  });

  test("nested immutable composites follow the selected leaf", () => {
    const source = `import { query, t } from "snapback2";
export const argument = query({ key: t.text(40) }, ({ db, args, ctx }) => {
  const packed = { inner: { key: args.key, viewer: ctx.viewer } };
  return db.scan(items.byKey, [packed.inner.key], { take: 10 });
});
export const viewer = query({ key: t.text(40) }, ({ db, args, ctx }) => {
  const packed = { inner: { key: ctx.viewer } };
  return db.scan(items.byKey, [packed.inner.key], { take: 10 });
});`;
    const lowered = lowerSource(source, "nested-composites.ts", undefined, { tables });
    assert(lowered.ok, `nested composite refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    assert(readMap(lowered.programs[0]!) === "nested-composites.argument.0:items:Arg", "nested Arg leaf was not selected");
    assert(readMap(lowered.programs[1]!) === "nested-composites.viewer.0:items:Viewer", "nested Viewer leaf was not selected");
    lowered.programs.forEach(certify);
  });

  test("collection elements are classified as alternatives at the selected path", () => {
    const cases = [
      { name: "arg-literal", values: "args.key, \"literal\"" },
      { name: "viewer-literal", values: "ctx.viewer, \"literal\"" },
      { name: "arg-viewer", values: "args.key, ctx.viewer" },
    ];
    for (const item of cases) {
      const refused = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args, ctx }) => {
  const found = [];
  for (const key of [${item.values}]) found.push(db.get(items.byKey, [key]));
  return found;
});`, `elements-${item.name}.ts`, undefined, { tables });
      assert(!refused.ok && refused.diagnostics.some((diagnostic) => diagnostic.code === "E_PROVENANCE_AMBIGUOUS"),
        `${item.name} collection alternatives silently agreed: ${refused.ok ? "lowered" : JSON.stringify(refused.diagnostics)}`);
    }

    const literalLeaf = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args }) => {
  const found = [];
  for (const item of [{ inner: { key: "literal" }, other: args.key }]) {
    found.push(db.get(items.byKey, [item.inner.key]));
  }
  return found;
});`, "element-path.ts");
    assert(readMap(literalLeaf) === "element-path.lookup.0:items:Const",
      `element member path inherited its composite provenance: ${readMap(literalLeaf)}`);
    assert(canonical(literalLeaf).includes('"String":"literal"'), "element member IR did not read the selected literal");
  });

  test("stable let bindings, lexical shadowing, and renamed handler composites are spelling-independent", () => {
    const templates = lowerSource(`import { query, t } from "snapback2";
export const immutable = query({ key: t.text(40) }, ({ db, args }) => {
  const normalized = \`${"${args.key}"}\`;
  return db.get(items.byKey, [normalized]);
});
export const stableLet = query({ key: t.text(40) }, ({ db, args }) => {
  let normalized = \`${"${args.key}"}\`;
  return db.get(items.byKey, [normalized]);
});`, "binding-form.ts", undefined, { tables });
    assert(templates.ok, `stable binding forms refused: ${templates.ok ? "" : JSON.stringify(templates.diagnostics)}`);
    assert(templates.programs.every((program) => reads(program)[0]?.provenance === "Computed"),
      `let and const template bindings disagreed: ${templates.programs.map(readMap).join(" | ")}`);

    const lexical = lowerSource(`import { query, t } from "snapback2";
export const renamed = query({ key: t.text(40) }, ({ db, args: packed, ctx: identity }) =>
  db.get(items.byKeyId, [packed.key, identity.viewer]));
export const shadowed = query({ key: t.text(40) }, ({ db, args }) =>
  db.scan(alpha.byKey, [args.key], { take: 10 }).map(args => db.get(beta.byKey, [args.key])));`,
    "lexical-bindings.ts", undefined, { tables });
    assert(lexical.ok, `lexical binding fixture refused: ${lexical.ok ? "" : JSON.stringify(lexical.diagnostics)}`);
    assert(readMap(lexical.programs[0]!) === "lexical-bindings.renamed.0:items:Shape",
      `renamed handler composites were not recognized: ${readMap(lexical.programs[0]!)}`);
    assert(readMap(lexical.programs[1]!) === "lexical-bindings.shadowed.0:alpha:Arg|lexical-bindings.shadowed.1:beta:Shape",
      `callback parameter spelling captured operation args: ${readMap(lexical.programs[1]!)}`);
  });

  test("block-local shadowing ends at the block boundary", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const probe = query({ key: t.text(40) }, ({ db, args }) => {
  const first = db.get(alpha.byKey, [args.key]);
  { const args = { key: "literal" }; const second = db.get(beta.byKey, [args.key]); }
  return db.get(items.byKey, [args.key]);
});`, "block-scope-shadow.ts");
    const readSites = certificateReadMap(certify(program));
    assert(readSites === "block-scope-shadow.probe.0:alpha:Arg|block-scope-shadow.probe.1:beta:Const|block-scope-shadow.probe.2:items:Arg",
      `block-local args changed post-block provenance: ${readSites}`);
  });

  test("block-local declarations are unavailable after the block", () => {
    const source = (setup: string) => `import { query, t } from "snapback2";
export const probe = query({ key: t.text(40) }, ({ db, args }) => {
  ${setup}
  return db.get(items.byKey, [localKey]);
});`;
    const leaked = lowerSource(source('{ const localKey = "literal"; }'), "block-scope-local.ts", undefined, { tables });
    const undeclared = lowerSource(source(""), "undeclared-local.ts", undefined, { tables });
    assert(!leaked.ok && !undeclared.ok, "block-local or undeclared key silently lowered");
    const leakedDiagnostic = leaked.diagnostics.find((item) => item.code === "E_PROVENANCE_AMBIGUOUS");
    const undeclaredDiagnostic = undeclared.diagnostics.find((item) => item.code === "E_PROVENANCE_AMBIGUOUS");
    assert(leakedDiagnostic && undeclaredDiagnostic, "block-local key did not refuse like an undeclared name");
    const envelope = (item: typeof leakedDiagnostic) => item && ({
      code: item.code,
      family: item.family,
      message: item.message,
      rule: item.rule,
      guide: item.guide,
    });
    assert(canonical(envelope(leakedDiagnostic)) === canonical(envelope(undeclaredDiagnostic)),
      `block-local refusal differs from undeclared-name behavior: ${JSON.stringify(leakedDiagnostic)}`);
  });

  test("reads inside a block use the block-local initializer", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const probe = query({}, ({ db }) => {
  { const local = { key: "literal" }; const found = db.get(beta.byKey, [local.key]); }
  return null;
});`, "block-scope-inside.ts");
    const readSites = certificateReadMap(certify(program));
    assert(readSites === "block-scope-inside.probe.0:beta:Const",
      `block-local initializer did not classify the inside read: ${readSites}`);
  });

  test("if-branch shadowing ends at the branch boundary", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const probe = query({ key: t.text(40) }, ({ db, args }) => {
  const first = db.get(alpha.byKey, [args.key]);
  if (args.key === "branch") {
    const args = { key: "literal" };
    const second = db.get(beta.byKey, [args.key]);
  }
  return db.get(items.byKey, [args.key]);
});`, "if-scope-shadow.ts");
    const readSites = certificateReadMap(certify(program));
    assert(readSites === "if-scope-shadow.probe.0:alpha:Arg|if-scope-shadow.probe.1:beta:Const|if-scope-shadow.probe.2:items:Arg",
      `if-local args changed post-branch provenance: ${readSites}`);
  });

  test("block updates preserve collection bounds on outer bindings", () => {
    const program = lowerOne(`import { query } from "snapback2";
export const probe = query({}, () => {
  const values = new Set<string>();
  { values.add("x"); }
  return values.has("x");
});`, "block-scope-set-update.ts");
    assert(lastDerivedArrayBound(program, "values") === 1,
      `block-local Set.add did not update the outer bound: ${canonical(program.body)}`);
    certify(program);
  });

  test("block updates preserve db.require narrowing on outer bindings", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const probe = query({ key: t.text(40) }, ({ db, args }) => {
  const row = db.get(items.byKey, [args.key]);
  { db.require(row !== null); }
  return { ...row };
});`, "block-scope-require-update.ts");
    certify(program);
  });

  test("if-branch updates preserve conservative collection bounds on outer bindings", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const probe = query({ add: t.bool() }, ({ args }) => {
  const values = new Set<string>();
  if (args.add) { values.add("x"); }
  return values.has("x");
});`, "if-scope-set-update.ts");
    assert(lastDerivedArrayBound(program, "values") === 1,
      `if-branch Set.add did not update the conservative outer bound: ${canonical(program.body)}`);
    certify(program);
  });

  test("if-branch updates preserve db.require narrowing on outer bindings", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const probe = query({ key: t.text(40), requireRow: t.bool() }, ({ db, args }) => {
  const row = db.get(items.byKey, [args.key]);
  if (args.requireRow) { db.require(row !== null); }
  return { ...row };
});`, "if-scope-require-update.ts");
    certify(program);
  });

  test("orderedPair defaults refuse instead of disappearing from IR", () => {
    const refused = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ key: t.optional(t.text(40)) }, ({ db, args, ctx }) => {
  const [first = ctx.viewer, second] = orderedPair(args.key, "literal");
  return db.get(items.byKey, [first, second]);
});`, "ordered-default.ts", undefined, { tables });
    assert(!refused.ok && refused.diagnostics.some((item) => item.code === "E_OPAQUE"
      && item.message.includes("defaults have authored runtime semantics")),
    `orderedPair default was dropped or crashed: ${refused.ok ? "lowered" : JSON.stringify(refused.diagnostics)}`);
  });

  test("recursive provenance expansion refuses with an envelope and finite depth", () => {
    const relay = lowerOne(`import { query, t } from "snapback2";
function pick(value: any) { return ({ ...value }).key; }
function relay(value: any) { return pick({ ...value }); }
export const lookup = query({ key: t.text(40) }, ({ db, args }) => db.get(items.byKey, [relay(args)]));`,
    "same-param-relay.ts");
    assert(readMap(relay) === "same-param-relay.lookup.0:items:Arg", `same-name substitutions lost their caller: ${readMap(relay)}`);

    const helpers = Array.from({ length: 140 }, (_, index) =>
      `function h${index}(value: any): any { return ${index === 139 ? "value" : `h${index + 1}(value)`}; }`).join("\n");
    const deep = lowerSource(`import { query, t } from "snapback2";
${helpers}
export const lookup = query({ key: t.text(40) }, ({ db, args }) => db.get(items.byKey, [h0(args.key)]));`,
    "deep-expansion.ts", undefined, { tables });
    assert(!deep.ok && deep.diagnostics.some((item) => item.code === "E_PROVENANCE_AMBIGUOUS"
      && item.rule === "read keys have one unambiguous origin" && item.guide === "opaque/provenance"),
    `deep expansion did not return a provenance envelope: ${deep.ok ? "lowered" : JSON.stringify(deep.diagnostics)}`);

    const cycle = lowerSource(`import { query, t } from "snapback2";
function first(value: any): any { return second({ ...value }); }
function second(value: any): any { return third({ ...value }); }
function third(value: any): any { return first({ ...value }); }
export const lookup = query({ key: t.text(40) }, ({ db, args }) => db.get(items.byKey, [first(args)]));`,
    "helper-cycle.ts", undefined, { tables });
    assert(!cycle.ok && cycle.diagnostics.some((item) => item.code === "E_OPAQUE"
      && item.family === "opaque" && item.guide === "opaque/subset"),
    `helper cycle did not return a finite refusal envelope: ${cycle.ok ? "lowered" : JSON.stringify(cycle.diagnostics)}`);
  });

  test("identity maps and filters preserve rows while transformed maps classify their return elements", () => {
    const preserved = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args }) => {
  const rows = db.scan(items.byKey, [args.key], { take: 10 }).map(row => row).filter(row => row.id !== "");
  const aliased = rows;
  const found = [];
  for (const row of aliased) found.push(db.get(beta.byKey, [row.key]));
  return found;
});`, "mapped-filtered-rows.ts");
    assert(readMap(preserved) === "mapped-filtered-rows.lookup.0:items:Arg|mapped-filtered-rows.lookup.1:beta:Shape",
      `identity-map chain lost row proof: ${readMap(preserved)}`);

    const inline = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args }) => {
  const found = [];
  for (const row of db.scan(items.byKey, [args.key], { take: 10 }).map(row => row)) {
    found.push(db.get(beta.byKey, [row.key]));
  }
  return found;
});`, "inline-identity-map.ts");
    assert(readMap(inline) === "inline-identity-map.lookup.0:items:Arg|inline-identity-map.lookup.1:beta:Shape",
      `inline identity map was unbound or lost row proof: ${readMap(inline)}`);

    const transformed = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args }) => {
  const projected = db.scan(items.byKey, [args.key], { take: 10 }).map(row => ({ inner: { key: row.key } }));
  const found = [];
  for (const item of projected) found.push(db.get(beta.byKey, [item.inner.key]));
  return found;
});`, "mapped-projection.ts");
    assert(readMap(transformed) === "mapped-projection.lookup.0:items:Arg|mapped-projection.lookup.1:beta:Shape",
      `mapped return element was not classified at its selected path: ${readMap(transformed)}`);
  });

  test("slice, sort, and flatMap retain row and transformed-element origins", () => {
    const lowered = lowerSource(`import { query, t } from "snapback2";
export const projectedSlice = query({ key: t.text(40) }, ({ db, args }) => {
  const found = [];
  for (const item of db.scan(items.byKey, [args.key], { take: 10 })
    .map(row => ({ inner: { key: row.key } })).slice(0, 5)) {
    found.push(db.get(beta.byKey, [item.inner.key]));
  }
  return found;
});
export const sortedIdentitySlice = query({ key: t.text(40) }, ({ db, args }) => {
  const found = [];
  for (const row of db.scan(items.byKey, [args.key], { take: 10 })
    .map(row => row).sort((left, right) => left.key - right.key).slice(0, 5)) {
    found.push(db.get(beta.byKey, [row.key]));
  }
  return found;
});
export const flatMappedSlice = query({ key: t.text(40) }, ({ db, args }) => {
  const found = [];
  for (const row of db.scan(items.byKey, [args.key], { take: 10 })
    .flatMap(row => [row]).slice(0, 5)) found.push(db.get(beta.byKey, [row.key]));
  return found;
});`, "collection-tails.ts", undefined, { tables });
    assert(lowered.ok, `collection transform tail refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    for (const program of lowered.programs) {
      assert(readMap(program) === `collection-tails.${program.name}.0:items:Arg|collection-tails.${program.name}.1:beta:Shape`,
        `${program.name} lost its row/element origin: ${readMap(program)}`);
      certify(program);
    }
  });

  test("ordinary elements and directly mapped spreads classify each alternative", () => {
    const sameOrigin = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ first: t.text(40), second: t.text(40) }, ({ db, args }) => {
  const found = [];
  for (const key of [args.first, ...[{ key: args.second }].map(item => item.key)]) {
    found.push(db.get(items.byKey, [key]));
  }
  return found;
});`, "mapped-spread.ts");
    assert(readMap(sameOrigin) === "mapped-spread.lookup.0:items:Arg",
      `mapped spread inherited its aggregate origin: ${readMap(sameOrigin)}`);
    certify(sameOrigin);

    const disagreement = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args, ctx }) => {
  const found = [];
  for (const key of [args.key, ...[ctx.viewer].map(viewer => viewer)]) {
    found.push(db.get(items.byKey, [key]));
  }
  return found;
});`, "mapped-spread-mixed.ts", undefined, { tables });
    assert(!disagreement.ok && disagreement.diagnostics.some((item) => item.code === "E_PROVENANCE_AMBIGUOUS"),
      `genuinely mixed mapped spread did not refuse: ${disagreement.ok ? "lowered" : JSON.stringify(disagreement.diagnostics)}`);
  });

  test("renamed args list domains retain their declared ArgList bound", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ keys: t.list(t.text(40), { max: 3 }) }, ({ db, args: packed }) => {
  const found = [];
  for (const key of packed.keys) found.push(db.get(items.byKey, [key]));
  return found;
});`, "renamed-args-list.ts");
    assert(canonical(program).includes('"ArgList":{"max":3,"name":"keys"}'),
      `renamed operation list lost ArgList identity: ${canonical(program)}`);
    assert(readMap(program) === "renamed-args-list.lookup.0:items:Arg",
      `renamed operation list lost Arg provenance: ${readMap(program)}`);
    certify(program);
  });

  test("nested literal and immutable object collection bounds compose", () => {
    const nested = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ a: t.text(40), b: t.text(40), c: t.text(40) }, ({ db, args }) => {
  const found = [];
  for (const group of [[args.a], [args.b, args.c]]) {
    for (const key of group) found.push(db.get(items.byKey, [key]));
  }
  return found;
});`, "nested-bounds.ts");
    assert(canonical(derivedArrayMaxima(nested)) === canonical([2, 2]),
      `nested bounds did not retain outer count and inner maximum: ${canonical(nested)}`);
    assert(readMap(nested) === "nested-bounds.lookup.0:items:Arg", `nested alternatives lost Arg: ${readMap(nested)}`);

    const packed = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args }) => {
  const packed = { keys: [args.key] };
  const found = [];
  for (const key of packed.keys) found.push(db.get(items.byKey, [key]));
  return found;
});`, "packed-bound.ts");
    assert(derivedArrayMaxima(packed).includes(1), `immutable object member lost its array bound: ${canonical(packed)}`);
    assert(readMap(packed) === "packed-bound.lookup.0:items:Arg", `packed member lost Arg: ${readMap(packed)}`);

    const deep = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ a: t.text(40), b: t.text(40), c: t.text(40) }, ({ db, args }) => {
  const found = [];
  for (const groups of [[[args.a]], [[args.b, args.c]]]) {
    for (const group of groups) for (const key of group) found.push(db.get(items.byKey, [key]));
  }
  return found;
});`, "three-deep-bounds.ts");
    assert(canonical(derivedArrayMaxima(deep)) === canonical([2, 1, 2]),
      `three-deep bounds did not compose: ${canonical(deep)}`);
    certify(deep);
  });

  test("mutable rewrite candidates include every assigned direct origin", () => {
    const source = (assignment: string) => `import { query, t } from "snapback2";
export const lookup = query({ first: t.text(40), second: t.text(40), choose: t.bool() }, ({ db, args }) => {
  let selected = args.first;
  if (args.choose) selected = ${assignment};
  return db.get(items.byKey, [selected]);
});`;
    const mixed = lowerSource(source("args.second"), "mutable-origins.ts", undefined, { tables });
    assert(!mixed.ok, "multi-origin mutable binding unexpectedly lowered");
    const diagnostic = mixed.diagnostics.find((item) => item.code === "E_PROVENANCE_AMBIGUOUS");
    assert(diagnostic, `multi-origin mutable refusal missing: ${JSON.stringify(mixed.diagnostics)}`);
    assert(diagnostic.rewrite.includes("args.first | args.second")
      && diagnostic.message.includes("args.first") && diagnostic.message.includes("args.second")
      && !diagnostic.rewrite.includes("[args.first]"),
    `mutable rewrite omitted an assignment origin: ${JSON.stringify(diagnostic)}`);
    assert(!lowerSource(diagnostic.rewrite, "mutable-origins.ts", undefined, { tables }).ok,
      "multi-origin sentinel unexpectedly compiled");

    const looped = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ first: t.text(40), second: t.text(40) }, ({ db, args }) => {
  let selected = args.first;
  for (const ignored of [0]) selected = args.second;
  return db.get(items.byKey, [selected]);
});`, "mutable-loop-origin.ts", undefined, { tables });
    assert(!looped.ok, "loop-assigned mutable binding unexpectedly lowered");
    const loopDiagnostic = looped.diagnostics.find((item) => item.code === "E_PROVENANCE_AMBIGUOUS");
    assert(loopDiagnostic?.message.includes("args.first") && loopDiagnostic.message.includes("args.second"),
      `loop assignment origin did not reach the outer binding: ${JSON.stringify(loopDiagnostic)}`);

    const same = lowerSource(source("args.first"), "mutable-one-origin.ts", undefined, { tables });
    assert(!same.ok, "mutable binding with one origin unexpectedly lowered");
    const sameDiagnostic = same.diagnostics.find((item) => item.code === "E_PROVENANCE_AMBIGUOUS");
    assert(sameDiagnostic, `single-origin mutable refusal missing: ${JSON.stringify(same.diagnostics)}`);
    assert(sameDiagnostic.rewrite.includes("[args.first]") && !sameDiagnostic.rewrite.includes("choose one direct origin"),
      `single-origin mutable rewrite was not direct: ${JSON.stringify(sameDiagnostic)}`);
    assert(lowerSource(sameDiagnostic.rewrite, "mutable-one-origin.ts", undefined, { tables }).ok,
      "single-origin mutable rewrite did not compile");
  });

  test("immutable aliases classify in their bind-time lexical environment", () => {
    const lowered = lowerSource(`import { query, t } from "snapback2";
export const block = query({ key: t.text(40) }, ({ db, args }) => {
  const packed = args;
  { const args = { key: "literal" }; return db.get(beta.byKey, [packed.key]); }
});
export const sameScope = query({ key: t.text(40) }, ({ db, args }) => {
  const packed = args;
  const args = { key: "literal" };
  return db.get(beta.byKey, [packed.key]);
});
export const aliasChain = query({ key: t.text(40) }, ({ db, args }) => {
  const first = args;
  const second = first;
  { const args = { key: "literal" }; return db.get(beta.byKey, [second.key]); }
});`, "bind-time-alias.ts", undefined, { tables });
    assert(lowered.ok, `bind-time aliases refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    assert(lowered.programs.every((program) => reads(program)[0]?.provenance === "Arg"),
      `use-time shadow changed alias provenance: ${lowered.programs.map(readMap).join(" | ")}`);
    lowered.programs.forEach(certify);
  });

  test("mutation and db recognition follow lexical binding identity", () => {
    const shadowSafe = lowerOne(`import { query, t } from "snapback2";
function load(database: any, key: string) { return database.get(items.byKey, [key]); }
export const lookup = query({ key: t.text(40) }, ({ db: store, args }) => {
  const key = args.key;
  { let key = "first"; { let key = "second"; key = "third"; } key = "fourth"; }
  { const db = { get: 1 }; }
  return load(store, key);
});`, "binding-identity.ts");
    assert(readMap(shadowSafe) === "binding-identity.lookup.0:items:Arg",
      `nested shadow mutation poisoned the outer key or renamed db: ${readMap(shadowSafe)}`);
    certify(shadowSafe);

    const shadowedDb = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db: store, args }) => {
  { const store = unknownStore; return store.get(items.byKey, [args.key]); }
});`, "db-shadow.ts", undefined, { tables });
    assert(!shadowedDb.ok && shadowedDb.diagnostics.some((item) => item.code === "E_OPAQUE"),
      `shadowed local store was mistaken for the handler db: ${shadowedDb.ok ? "lowered" : JSON.stringify(shadowedDb.diagnostics)}`);
  });

  test("push couples static bounds and per-element provenance", () => {
    const sameOrigin = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ first: t.text(40), second: t.text(40), third: t.text(40) }, ({ db, args }) => {
  const keys = [args.first];
  keys.push(args.second, args.third);
  const found = [];
  for (const key of [...keys]) found.push(db.get(items.byKey, [key]));
  return found;
});`, "push-origin.ts");
    assert(lastDerivedArrayBound(sameOrigin, "keys") === 3,
      `push did not update the statically countable bound: ${canonical(sameOrigin)}`);
    assert(readMap(sameOrigin) === "push-origin.lookup.0:items:Arg",
      `same-origin push lost Arg: ${readMap(sameOrigin)}`);
    certify(sameOrigin);

    const mixed = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args, ctx }) => {
  const keys = [args.key];
  keys.push(ctx.viewer);
  const found = [];
  for (const key of [...keys]) found.push(db.get(items.byKey, [key]));
  return found;
});`, "push-origin-mixed.ts", undefined, { tables });
    assert(!mixed.ok, "mixed-origin push unexpectedly lowered");
    const diagnostic = mixed.diagnostics.find((item) => item.code === "E_PROVENANCE_AMBIGUOUS");
    assert(diagnostic?.message.includes("args.key") && diagnostic.message.includes("ctx.viewer"),
      `mixed push did not retain both origins: ${JSON.stringify(diagnostic)}`);
  });

  test("ambiguous rewrites never guess an argument from a selected member name", () => {
    const matching = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ first: t.text(40), second: t.text(40) }, ({ db, args }) => {
  const mystery = unknownValue;
  return db.get(items.byKey, [mystery.second]);
});`, "honest-matching.ts", undefined, { tables });
    assert(!matching.ok, "unknown selected member unexpectedly lowered");
    const matched = matching.diagnostics.find((item) => item.code === "E_PROVENANCE_AMBIGUOUS");
    assert(matched, `matching refusal omitted provenance envelope: ${JSON.stringify(matching.diagnostics)}`);
    assert(matched.rewrite.includes("<unknown origin>") && !matched.rewrite.includes("[args.second]")
      && !matched.rewrite.includes("[args.first]"),
    `rewrite guessed an undiscovered argument: ${matched?.rewrite}`);
    const matchingPaste = lowerSource(matched.rewrite, "honest-matching.ts", undefined, { tables });
    assert(!matchingPaste.ok, "unknown selected-member refusal had paste.ok !== false");

    const unmatched = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ first: t.text(40), second: t.text(40) }, ({ db, args }) => {
  const mystery = unknownValue;
  return db.get(items.byKey, [mystery.external]);
});`, "honest-unmatched.ts", undefined, { tables });
    assert(!unmatched.ok, "unknown unmatched member unexpectedly lowered");
    const unresolved = unmatched.diagnostics.find((item) => item.code === "E_PROVENANCE_AMBIGUOUS");
    assert(unresolved, `unmatched refusal omitted provenance envelope: ${JSON.stringify(unmatched.diagnostics)}`);
    assert(unresolved.rewrite.includes("E_PROVENANCE_AMBIGUOUS: choose one direct origin")
      && unresolved.rewrite.includes("<unknown origin>")
      && unresolved.message.includes("candidate direct origins: <unknown origin>"),
    `unmatched rewrite guessed undiscovered origins: ${JSON.stringify(unresolved)}`);
    const stillRefused = lowerSource(unresolved.rewrite, "honest-unmatched.ts", undefined, { tables });
    assert(!stillRefused.ok, "unmatched sentinel refusal had paste.ok !== false");
  });

  test("deep operation-argument paths deliberately retain Arg origin", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ payload: t.json<{ inner: { key: string } }>(100) }, ({ db, args }) =>
  db.get(items.byKey, [args.payload.inner.key]));`, "deep-argument.ts");
    assert(readMap(program) === "deep-argument.lookup.0:items:Arg", `deep argument path changed origin: ${readMap(program)}`);
    assert(canonical(program).includes('"name":"inner"') && canonical(program).includes('"name":"key"'),
      "deep argument path did not survive in IR");
  });

  test("filter preserves row proof through aliases and a second filtering layer", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args }) => {
  const selected = db.scan(items.byKey, [args.key], { take: 10 }).filter(row => row.key === args.key);
  const refined = selected.filter(row => row.id !== "");
  const aliased = refined;
  const found = [];
  for (const row of aliased) found.push(db.get(beta.byKey, [row.key]));
  return found;
});`, "filtered-rows.ts");
    assert(readMap(program) === "filtered-rows.lookup.0:items:Arg|filtered-rows.lookup.1:beta:Shape",
      `row-preserving filter lost row proof: ${readMap(program)}`);
    certify(program);
  });

  test("update operands allocate sites in source order and callback keys lower once", () => {
    const direct = lowerOne(`import { mutation, t } from "snapback2";
export const touch = mutation({ key: t.text(40) }, ({ db, args }) => {
  db.update(items, db.get(alpha.byKey, [args.key])!.id, { key: db.get(beta.byKey, [args.key])!.key });
  return null;
});`, "update-operands.ts");
    assert(readMap(direct) === "update-operands.touch.1:alpha:Arg|update-operands.touch.2:beta:Arg",
      `update operands did not lower left-to-right: ${readMap(direct)}`);

    const callback = lowerOne(`import { mutation, t } from "snapback2";
export const touch = mutation({ key: t.text(40) }, ({ db, args }) => {
  db.update(items, db.get(alpha.byKey, [args.key])!.id, row => ({ key: db.get(beta.byKey, [args.key])!.key }));
  return null;
});`, "update-callback.ts");
    const facts = reads(callback);
    const sites = facts.map((item) => item.site);
    assert(new Set(sites).size === sites.length && facts.length === 3,
      `callback key read was duplicated: ${readMap(callback)}`);
    assert(sites.includes("update-callback.touch.0") && sites.includes("update-callback.touch.2")
      && sites.includes("update-callback.touch.3") && !sites.includes("update-callback.touch.4"),
    `callback operand ordinals are not source ordered: ${readMap(callback)}`);
    certify(callback);
  });

  test("ambiguous helper rewrites are scoped to the authored scan key", () => {
    const source = `import { query, t } from "snapback2";
function pick(value: any) { return value.key; }
export const broken = query({ key: t.text(40) }, ({ db, args }) => {
  const mystery = unknownValue;
  return db.scan(items.byKey, [pick(mystery)], { take: 10 });
});
export const intact = query({ key: t.text(40) }, ({ db, args }) =>
  db.scan(items.byKey, [pick({ key: args.key })], { take: 10 }));`;
    const refused = lowerSource(source, "rewrite-scope.ts", undefined, { tables });
    assert(!refused.ok, "ambiguous helper unexpectedly lowered");
    const diagnostic = refused.diagnostics.find((item) => item.code === "E_PROVENANCE_AMBIGUOUS");
    assert(diagnostic, `missing helper provenance refusal: ${JSON.stringify(refused.diagnostics)}`);
    assert(diagnostic.rewrite.includes("function pick(value: any) { return value.key; }")
      && diagnostic.rewrite.includes("<unknown origin>")
      && diagnostic.rewrite.includes("pick({ key: args.key })"),
    `helper rewrite escaped the authored scan key: ${diagnostic.rewrite}`);
    const fixed = lowerSource(diagnostic.rewrite, "rewrite-scope.ts", undefined, { tables });
    assert(!fixed.ok, "origin-less helper sentinel unexpectedly compiled");
  });

  test("adversarial extra alias, helper, spread, and specialization layers stay uniform", () => {
    const deep = lowerOne(`import { query, t } from "snapback2";
function nest(value: any) { return { outer: { inner: { ...value } } }; }
export const lookup = query({ key: t.text(40) }, ({ db, args }) => {
  const first = args;
  const second = first;
  const packed = nest(second);
  return db.scan(items.byKey, [packed.outer.inner.key], { take: 10 });
});`, "deep-wrappers.ts");
    assert(readMap(deep) === "deep-wrappers.lookup.0:items:Arg", `deep wrappers lost Arg: ${readMap(deep)}`);
    certify(deep);

    const sameOrigin = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ key: t.optional(t.text(40)) }, ({ db, args }) =>
  db.scan(items.byKey, [({ key: args.key, ...args }).key], { take: 10 }));`, "same-origin-spread.ts");
    assert(readMap(sameOrigin) === "same-origin-spread.lookup.0:items:Arg",
      `same-origin optional alternatives became ambiguous: ${readMap(sameOrigin)}`);

    const specialized = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args, ctx }) => {
  let mystery = args.key;
  mystery = ctx.viewer;
  const packed = [mystery].map(value => ({ inner: { key: value } }));
  const aliased = packed;
  const found = [];
  for (const item of aliased) found.push(db.get(items.byKey, [item.inner.key]));
  return found;
});`, "specialized-wrappers.ts", undefined, { tables });
    assert(!specialized.ok && specialized.diagnostics.some((item) => item.code === "E_PROVENANCE_AMBIGUOUS"),
      `map specialization laundered ambiguity: ${specialized.ok ? "lowered" : JSON.stringify(specialized.diagnostics)}`);
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
      const identity = method === "upsert" ? "id: args.key, " : "";
      const callback = lowerOne(`import { mutation, t } from "snapback2";
export const touch = mutation({ key: t.text(40) }, ({ db, args }) => {
  db.${method}(items, args.key, row => ({ ${identity}key: row.key }));
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
      const collisions = lowered.diagnostics.filter((item) => item.code === "E_OP_MODULE_BASENAME"
        && item.message.includes("module basename activity is duplicated"));
      assert(collisions.length === 2 && collisions.every((item) => item.family === "op"
        && item.rule === "module basenames are unique"
        && item.guide === "programs/module-basename" && item.site.endsWith(":1:1")),
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

function lastDerivedArrayBound(program: Program, variable: string): number | undefined {
  const bounds: number[] = [];
  visit(program.body, (value) => {
    const domain = value.DerivedArray as { value?: { Variable?: string }; max?: number } | undefined;
    if (domain?.value?.Variable === variable && typeof domain.max === "number") bounds.push(domain.max);
  });
  return bounds.at(-1);
}

function derivedArrayMaxima(program: Program): number[] {
  const maxima: number[] = [];
  visit(program.body, (value) => {
    const domain = value.DerivedArray as { max?: number } | undefined;
    if (typeof domain?.max === "number") maxima.push(domain.max);
  });
  return maxima;
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
