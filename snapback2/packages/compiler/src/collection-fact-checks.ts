import { lowerSource, type TableInfo } from "./compiler";
import type { FrontendDiagnostic, Program, Provenance } from "./ir";
import { rustCheck } from "./rust-check";
import { ClientStore } from "../../evaluator/src/evaluator";

type Test = (name: string, run: () => void | Promise<void>) => void;
type ReadFact = { site: string; table: string; provenance: Provenance };

const tables = new Map<string, TableInfo>([
  ["items", table("items")],
  ["source", table("source")],
]);

const schema = {
  tables: Object.fromEntries([...tables.values()].map((item) => [item.name, {
    columns: { id: "Id", key: { Text: { max: 40 } } },
    indexes: {
      byId: { columns: ["id"], unique: true },
      byKey: { columns: ["key"], unique: true },
    },
    rules: { read: "Allow", insert: "Allow", update: "Allow", delete: "Allow" },
    constraints: [],
  }])),
  maintains: [],
  channels: {},
  auth: { password: false, guests: false },
  effects: [],
      };

export function registerCollectionFactChecks(test: Test): void {
  test("loop-bound pushes retain every real candidate and paste a refusal", () => {
    const refused = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ keys: t.list(t.text(40), { max: 3 }) }, ({ db, args, ctx }) => {
  const selected = [ctx.viewer];
  for (const k of args.keys) selected.push(k);
  const found = [];
  for (const key of selected) found.push(db.get(items.byKey, [key]));
  return found;
});`, "loop-push-candidates.ts", undefined, { tables });
    const diagnostic = provenanceDiagnostic(refused);
    assert(diagnostic.message.includes("ctx.viewer") && diagnostic.message.includes("args.keys"),
      `loop-bound push omitted a real origin: ${JSON.stringify(diagnostic)}`);
    assert(diagnostic.rewrite.includes("ctx.viewer") && diagnostic.rewrite.includes("args.keys")
      && diagnostic.rewrite.includes("choose one direct origin"),
    `loop-bound push rewrite was incomplete or compiling: ${diagnostic.rewrite}`);
    const paste = lowerSource(diagnostic.rewrite, "loop-push-candidates.ts", undefined, { tables });
    assert(!paste.ok, "loop-bound multi-origin refusal had paste.ok !== false");
  });

  test("ternary members over loop bindings retain complete candidate origins", () => {
    const refused = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ keys: t.list(t.text(40), { max: 3 }), choose: t.bool() }, ({ db, args, ctx }) => {
  const selected = [ctx.viewer];
  for (const k of args.keys) {
    const choice = args.choose ? { key: k } : { key: ctx.viewer };
    selected.push(choice.key);
  }
  const found = [];
  for (const key of selected) found.push(db.get(items.byKey, [key]));
  return found;
});`, "ternary-loop-member-probe.ts", undefined, { tables });
    const diagnostic = provenanceDiagnostic(refused);
    assert(diagnostic.message.includes("ctx.viewer") && diagnostic.message.includes("args.keys")
      && !diagnostic.message.includes("<unknown origin>"),
    `ternary loop-member candidates were incomplete: ${JSON.stringify(diagnostic)}`);
    const paste = lowerSource(diagnostic.rewrite, "ternary-loop-member-probe.ts", undefined, { tables });
    assert(!paste.ok, "ternary loop-member multi-origin refusal had paste.ok !== false");
  });

  test("conditional members retain real candidates without an argument-name guess", () => {
    const refused = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40), choose: t.bool() }, ({ db, args, ctx }) => {
  const row = db.get(source.byKey, [args.key]);
  db.require(row !== null, "ROW_REQUIRED");
  const selected = args.choose ? { key: ctx.viewer } : { key: row.key };
  return db.get(items.byKey, [selected.key]);
});`, "conditional-member-candidates.ts", undefined, { tables });
    const diagnostic = provenanceDiagnostic(refused);
    assert(diagnostic.message.includes("ctx.viewer") && diagnostic.message.includes("row.key")
      && !diagnostic.message.includes("candidate direct origins: args.key"),
    `conditional member candidates were guessed or incomplete: ${JSON.stringify(diagnostic)}`);
    assert(diagnostic.rewrite.includes("ctx.viewer") && diagnostic.rewrite.includes("row.key")
      && !diagnostic.rewrite.includes("return db.get(items.byKey, [args.key])"),
    `conditional member rewrite guessed an argument name: ${diagnostic.rewrite}`);
    const paste = lowerSource(diagnostic.rewrite, "conditional-member-candidates.ts", undefined, { tables });
    assert(!paste.ok, "conditional multi-origin refusal had paste.ok !== false");

    const incomplete = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40), choose: t.bool() }, ({ db, args, ctx }) => {
  const mystery = unknownValue;
  const selected = args.choose ? { key: ctx.viewer } : { key: mystery.external };
  return db.get(items.byKey, [selected.key]);
});`, "conditional-member-unknown.ts", undefined, { tables });
    const incompleteDiagnostic = provenanceDiagnostic(incomplete);
    assert(incompleteDiagnostic.message.includes("ctx.viewer")
      && incompleteDiagnostic.message.includes("<unknown origin>"),
    `conditional incomplete discovery omitted knowns or the unknown marker: ${JSON.stringify(incompleteDiagnostic)}`);
    const incompletePaste = lowerSource(
      incompleteDiagnostic.rewrite,
      "conditional-member-unknown.ts",
      undefined,
      { tables },
    );
    assert(!incompletePaste.ok, "conditional unknown-origin refusal had paste.ok !== false");
  });

  test("push never widens a bounded argument collection without element origins", () => {
    for (const fixture of [
      {
        name: "argument-alias",
        setup: "const selected = args.keys; selected.push(ctx.viewer);",
        domain: "selected",
      },
      {
        name: "spread-copy",
        setup: "const selected = [...args.keys]; selected.push(ctx.viewer);",
        domain: "selected",
      },
      {
        name: "implicit-argument",
        setup: "keys.push(ctx.viewer);",
        domain: "keys",
      },
    ]) {
      const refused = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ keys: t.list(t.text(40), { max: 3 }) }, ({ db, args, ctx }) => {
  ${fixture.setup}
  const found = [];
  for (const key of ${fixture.domain}) found.push(db.get(items.byKey, [key]));
  return found;
});`, `push-${fixture.name}.ts`, undefined, { tables });
      assert(!refused.ok, `${fixture.name} push widened a blind bound and compiled`);
      assert(refused.diagnostics.some((item) => ["E_PROVENANCE_AMBIGUOUS", "E_UNBOUND_LOOP", "E_OPAQUE"].includes(item.code)),
        `${fixture.name} push refused for the wrong reason: ${JSON.stringify(refused.diagnostics)}`);
      const diagnostic = refused.diagnostics.find((item) => item.code === "E_PROVENANCE_AMBIGUOUS");
      if (diagnostic) {
        const original = fixture.name === "implicit-argument" ? "keys" : "args.keys";
        assert(diagnostic.message.includes(original) && diagnostic.message.includes("ctx.viewer"),
          `${fixture.name} push omitted a real origin: ${JSON.stringify(diagnostic)}`);
      }
    }
  });

  test("collection mutation refuses both alias copy-semantics divergence directions", () => {
    const aliasMutation = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args, ctx }) => {
  const box = { keys: [args.key] };
  const alias = box.keys;
  alias.push(ctx.viewer);
  const found = [];
  for (const key of box.keys) found.push(db.get(items.byKey, [key]));
  return found;
});`, "mutate-alias-read-original.ts", undefined, { tables });
    const aliasDiagnostic = mutationDiagnostic(aliasMutation);
    assert(aliasDiagnostic.site.startsWith("mutate-alias-read-original.ts:5:")
      && aliasDiagnostic.rewrite.includes("const alias = [...box.keys]"),
    `selected-owner mutation refusal was not sited with a copy rewrite: ${JSON.stringify(aliasDiagnostic)}`);
    const aliasPaste = lowerSource(aliasDiagnostic.rewrite, "mutate-alias-read-original.ts", undefined, { tables });
    assert(aliasPaste.ok, `selected-owner copy rewrite did not compile: ${JSON.stringify(aliasPaste)}`);

    const ownerMutation = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ first: t.text(40), second: t.text(40) }, ({ db, args }) => {
  const keys = [args.first];
  keys.push(args.second);
  const alias = keys;
  const found = [];
  for (const key of alias) found.push(db.get(items.byKey, [key]));
  return found;
});`, "mutate-original-read-alias.ts", undefined, { tables });
    const ownerDiagnostic = mutationDiagnostic(ownerMutation);
    assert(ownerDiagnostic.site.startsWith("mutate-original-read-alias.ts:4:")
      && ownerDiagnostic.rewrite.includes("const alias = [...keys]"),
    `later-alias mutation refusal was not sited with a copy rewrite: ${JSON.stringify(ownerDiagnostic)}`);
    const ownerPaste = lowerSource(ownerDiagnostic.rewrite, "mutate-original-read-alias.ts", undefined, { tables });
    assert(ownerPaste.ok, `later-alias copy rewrite did not compile: ${JSON.stringify(ownerPaste)}`);
  });

  test("unaliased literal accumulators compile while alias-of-copy mutation refuses", () => {
    const accumulator = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args }) => {
  const keys = [];
  keys.push(args.key);
  const found = [];
  for (const key of keys) found.push(db.get(items.byKey, [key]));
  return found;
});`, "unaliased-accumulator.ts");
    assert(lastDerivedArrayBound(accumulator) === 1 && lastRead(accumulator)?.provenance === "Arg",
      `unaliased literal accumulator lost its bound or provenance: ${canonical(accumulator)}`);
    certify(accumulator);

    const aliasOfCopy = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ keys: t.list(t.text(40), { max: 3 }), extra: t.text(40) }, ({ db, args }) => {
  const copy = [...args.keys];
  const alias = copy;
  copy.push(args.extra);
  const found = [];
  for (const key of alias) found.push(db.get(items.byKey, [key]));
  return found;
});`, "alias-of-copy-mutation.ts", undefined, { tables });
    const diagnostic = mutationDiagnostic(aliasOfCopy);
    assert(diagnostic.rewrite.includes("const alias = [...copy]"),
      `alias-of-copy refusal did not break the alias explicitly: ${JSON.stringify(diagnostic)}`);
  });

  test("helper-return, object-wrapper, and ternary escapes refuse later mutation", () => {
    const fixtures = [
      {
        name: "helper-return",
        setup: "const alias = wrap(keys);",
        domain: "alias",
        helper: "function wrap(xs) { return xs; }",
      },
      {
        name: "object-wrapper",
        setup: "const box = { keys };",
        domain: "box.keys",
        helper: "",
      },
      {
        name: "ternary",
        setup: "const other = [args.seed]; const alias = args.choose ? keys : other;",
        domain: "alias",
        helper: "",
      },
    ];
    for (const fixture of fixtures) {
      const refused = lowerSource(`import { query, t } from "snapback2";
${fixture.helper}
export const lookup = query({ seed: t.text(40), choose: t.bool() }, ({ db, args, ctx }) => {
  const keys = [args.seed];
  ${fixture.setup}
  keys.push(ctx.viewer);
  const found = [];
  for (const key of ${fixture.domain}) found.push(db.get(items.byKey, [key]));
  return found;
});`, `escape-${fixture.name}.ts`, undefined, { tables });
      const diagnostic = mutationDiagnostic(refused);
      assert(diagnostic.message.includes("shared by an escape before this mutation")
        && diagnostic.site.startsWith(`escape-${fixture.name}.ts:`),
      `${fixture.name} escape did not refuse at the push: ${JSON.stringify(diagnostic)}`);
      const pasted = lowerSource(diagnostic.rewrite, `escape-${fixture.name}.ts`, undefined, { tables });
      assert(pasted.ok, `${fixture.name} spread-copy rewrite did not compile: ${JSON.stringify(pasted)}`);
    }
  });

  test("mutation before a final helper escape and return stays green", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
function wrap(xs) { return xs; }
export const collect = query({ seed: t.text(40) }, ({ args }) => {
  const out = [];
  out.push(args.seed);
  return wrap(out);
});`, "post-mutation-escape.ts");
    certify(program);
    assert(runArrayLength(program, { seed: { String: "value" } }) === 1,
      "post-mutation escape-and-return changed the accumulator result");
  });

  test("later escapes in a loop body poison earlier mutations in the same cyclic body", () => {
    for (const fixture of [
      {
        name: "object",
        helper: "",
        setup: "const snapshots = [];",
        escape: "snapshots.push({ keys });",
        rewrite: "snapshots.push({ keys: [...keys] });",
        result: "snapshots",
      },
      {
        name: "helper",
        helper: "function wrap(xs) { return xs; }",
        setup: "",
        escape: "const alias = wrap(keys);",
        rewrite: "const alias = wrap([...keys]);",
        result: "keys",
      },
    ]) {
      const refused = lowerSource(`import { query, t } from "snapback2";
${fixture.helper}
export const collect = query({ seed: t.text(40) }, ({ args }) => {
  const keys = [];
  ${fixture.setup}
  for (const item of range(0, 2)) {
    keys.push(args.seed);
    ${fixture.escape}
  }
  return ${fixture.result};
});`, `loop-later-escape-${fixture.name}.ts`, undefined, { tables });
      const diagnostic = mutationDiagnostic(refused);
      assert(diagnostic.message.includes("shared by an escape in the same cyclic loop body")
        && diagnostic.rewrite.includes(fixture.rewrite),
        `${fixture.name} loop escape did not receive a spread-copy rewrite: ${JSON.stringify(diagnostic)}`);
      const pasted = lowerSource(diagnostic.rewrite, `loop-later-escape-${fixture.name}.ts`, undefined, { tables });
      assert(pasted.ok, `${fixture.name} loop escape rewrite did not compile: ${JSON.stringify(pasted)}`);
    }
  });

  test("escape-only loops and accumulators returned after a loop stay green", () => {
    const escapeOnly = lowerOne(`import { query, t } from "snapback2";
export const collect = query({ seed: t.text(40) }, ({ args }) => {
  const keys = [args.seed];
  const snapshots = [];
  for (const item of range(0, 2)) snapshots.push({ keys });
  return snapshots;
});`, "loop-escape-only.ts");
    certify(escapeOnly);
    assert(runArrayLength(escapeOnly, { seed: { String: "value" } }) === 2,
      "escape-only loop changed its result length");

    const accumulator = lowerOne(`import { query, t } from "snapback2";
export const collect = query({ seed: t.text(40) }, ({ args }) => {
  const values = [];
  for (const item of range(0, 2)) values.push(args.seed);
  return values;
});`, "loop-accumulator-return.ts");
    certify(accumulator);
    assert(runArrayLength(accumulator, { seed: { String: "value" } }) === 2,
      "loop accumulator returned after the loop changed its result length");
  });

  test("escape-only reads stay green while two-helper and branch escapes close mutation", () => {
    const read = lowerOne(`import { query, t } from "snapback2";
function wrap(xs) { return xs; }
export const lookup = query({ seed: t.text(40) }, ({ db, args }) => {
  const keys = [args.seed];
  const alias = wrap(keys);
  const found = [];
  for (const key of alias) found.push(db.get(items.byKey, [key]));
  return found;
});`, "escape-read-only.ts");
    assert(lastDerivedArrayBound(read) === 1 && lastRead(read)?.provenance === "Arg",
      `escape-only read lost its static facts: ${canonical(read)}`);
    certify(read);

    for (const fixture of [
      {
        name: "two-helpers",
        helpers: "function first(xs) { return xs; } function second(xs) { return xs; }",
        escape: "const alias = second(first(keys));",
      },
      {
        name: "branch-arm",
        helpers: "function wrap(xs) { return xs; }",
        escape: "if (args.choose) { const alias = wrap(keys); }",
      },
    ]) {
      const refused = lowerSource(`import { query, t } from "snapback2";
${fixture.helpers}
export const collect = query({ seed: t.text(40), choose: t.bool() }, ({ args }) => {
  const keys = [args.seed];
  ${fixture.escape}
  keys.push(args.seed);
  return keys;
});`, `escape-${fixture.name}.ts`, undefined, { tables });
      const diagnostic = mutationDiagnostic(refused);
      assert(diagnostic.message.includes("shared by an escape before this mutation"),
        `${fixture.name} did not close the later mutation: ${JSON.stringify(diagnostic)}`);
    }
  });

  test("push after an ordered spread override keeps both actual element origins", () => {
    const refused = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args, ctx }) => {
  const packed = { keys: [args.key], ...{ keys: [ctx.viewer] } };
  const selected = [...packed.keys];
  selected.push(args.key);
  const found = [];
  for (const key of selected) found.push(db.get(items.byKey, [key]));
  return found;
});`, "push-after-override.ts", undefined, { tables });
    const diagnostic = provenanceDiagnostic(refused);
    assert(diagnostic.message.includes("ctx.viewer") && diagnostic.message.includes("args.key"),
      `post-override push omitted an actual origin: ${JSON.stringify(diagnostic)}`);
  });

  test("collection facts use the same ordered spread override as lowering", () => {
    const viewer = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ first: t.text(40), second: t.text(40) }, ({ db, args, ctx }) => {
  const packed = { keys: [args.first, args.second], ...{ keys: [ctx.viewer] } };
  const found = [];
  for (const key of packed.keys) found.push(db.get(items.byKey, [key]));
  return found;
});`, "spread-override-viewer.ts");
    assert(lastDerivedArrayBound(viewer) === 1 && lastRead(viewer)?.provenance === "Viewer",
      `last spread did not win in facts: ${canonical(viewer)}`);
    assert(boundObjectFieldLength(viewer, "packed", "keys") === 1,
      `viewer override IR did not contain one runtime element: ${canonical(viewer)}`);
    certify(viewer);

    const args = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ first: t.text(40), second: t.text(40) }, ({ db, args, ctx }) => {
  const packed = { keys: [ctx.viewer], ...{ keys: [args.first, args.second] } };
  const found = [];
  for (const key of packed.keys) found.push(db.get(items.byKey, [key]));
  return found;
});`, "spread-override-args.ts");
    assert(lastDerivedArrayBound(args) === 2 && lastRead(args)?.provenance === "Arg",
      `spread override undercounted or kept the overwritten origin: ${canonical(args)}`);
    assert(boundObjectFieldLength(args, "packed", "keys") === 2,
      `argument override IR did not contain two runtime elements: ${canonical(args)}`);
    certify(args);
  });

  test("mutable collection reassignment merges origins and refuses disagreement", () => {
    for (const fixture of [
      {
        name: "same-cardinality",
        branch: "if (args.choose) keys = [ctx.viewer];",
        candidates: ["args.a", "ctx.viewer"],
      },
      {
        name: "two-branches",
        branch: "if (args.choose) keys = [ctx.viewer]; else keys = [args.b];",
        candidates: ["args.a", "ctx.viewer", "args.b"],
      },
    ]) {
      const refused = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ a: t.text(40), b: t.text(40), choose: t.bool() }, ({ db, args, ctx }) => {
  let keys = [args.a];
  ${fixture.branch}
  const found = [];
  for (const key of keys) found.push(db.get(items.byKey, [key]));
  return found;
});`, `reassign-${fixture.name}.ts`, undefined, { tables });
      const diagnostic = provenanceDiagnostic(refused);
      assert(fixture.candidates.every((candidate) => diagnostic.message.includes(candidate)),
        `${fixture.name} reassignment omitted candidates: ${JSON.stringify(diagnostic)}`);
      assert(!lowerSource(diagnostic.rewrite, `reassign-${fixture.name}.ts`, undefined, { tables }).ok,
        `${fixture.name} reassignment pasted a compiling single origin`);
    }
  });

  test("array literal element origins snapshot their bind-time environment", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args }) => {
  const keys = [args.key];
  const args = { key: "literal" };
  const found = [];
  for (const key of keys) found.push(db.get(items.byKey, [key]));
  return found;
});`, "element-bind-time.ts");
    assert(lastRead(program)?.provenance === "Arg", `live element environment changed Arg to ${lastRead(program)?.provenance}`);
    certify(program);
  });

  test("mixed collection rewrites name every real origin and stay non-lowerable", () => {
    const mixed = (includeViewer: boolean) => lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ key: t.text(40) }, ({ db, args, ctx }) => {
  const row = db.get(source.byKey, [args.key]);
  db.require(row !== null, "ROW_REQUIRED");
  const keys = [args.key, ${includeViewer ? "ctx.viewer, " : ""}row.key];
  const found = [];
  for (const key of keys) found.push(db.get(items.byKey, [key]));
  return found;
});`, includeViewer ? "mixed-three-origins.ts" : "mixed-arg-shape.ts", undefined, { tables });

    for (const [refused, candidates] of [
      [mixed(false), ["args.key", "row.key"]],
      [mixed(true), ["args.key", "ctx.viewer", "row.key"]],
    ] as const) {
      const diagnostic = provenanceDiagnostic(refused);
      assert(candidates.every((candidate) => diagnostic.message.includes(candidate)
        && diagnostic.rewrite.includes(candidate)),
      `mixed-origin refusal omitted a real candidate: ${JSON.stringify(diagnostic)}`);
      assert(diagnostic.rewrite.includes("choose one direct origin"),
        `mixed-origin refusal pasted a compiling guess: ${diagnostic.rewrite}`);
      assert(!lowerSource(diagnostic.rewrite, "mixed-origin-paste.ts", undefined, { tables }).ok,
        "mixed-origin sentinel unexpectedly compiled");
    }
  });

  test("mutually exclusive push arms contribute their maximum delta", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ first: t.text(40), second: t.text(40), third: t.text(40), choose: t.bool() }, ({ db, args }) => {
  const keys = [args.first];
  if (args.choose) keys.push(args.second); else keys.push(args.third);
  const found = [];
  for (const key of keys) found.push(db.get(items.byKey, [key]));
  return found;
});`, "branch-push-max.ts");
    assert(lastDerivedArrayBound(program) === 2,
      `branch pushes were summed instead of maxed: ${canonical(program)}`);
    assert(lastRead(program)?.provenance === "Arg", "same-origin branch pushes lost Arg provenance");
    certify(program);
  });

  test("branch ambiguity names origins from both ambiguous and known arms", () => {
    const refused = lowerSource(`import { query, t } from "snapback2";
export const lookup = query({ a: t.text(40), b: t.text(40), choose: t.bool() }, ({ db, args, ctx }) => {
  const keys = [args.a];
  if (args.choose) keys.push(ctx.viewer); else keys.push(args.b);
  const found = [];
  for (const key of keys) found.push(db.get(items.byKey, [key]));
  return found;
});`, "branch-origin-completeness.ts", undefined, { tables });
    const diagnostic = provenanceDiagnostic(refused);
    for (const candidate of ["args.a", "ctx.viewer", "args.b"]) {
      assert(diagnostic.message.includes(candidate) && diagnostic.rewrite.includes(candidate),
        `branch ambiguity omitted ${candidate}: ${JSON.stringify(diagnostic)}`);
    }
    assert(!lowerSource(diagnostic.rewrite, "branch-origin-completeness.ts", undefined, { tables }).ok,
      "complete branch-origin sentinel unexpectedly lowered");
  });

  test("conditional-expression push arms merge like if branches", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ first: t.text(40), second: t.text(40), third: t.text(40), choose: t.bool() }, ({ db, args }) => {
  const keys = [args.first];
  args.choose ? keys.push(args.second) : keys.push(args.third);
  const found = [];
  for (const key of keys) found.push(db.get(items.byKey, [key]));
  return found;
});`, "conditional-push-max.ts");
    assert(lastDerivedArrayBound(program) === 2,
      `conditional push arms were applied sequentially: ${canonical(program)}`);
    assert(lastRead(program)?.provenance === "Arg", "conditional push arms lost Arg provenance");
    certify(program);
  });

  test("an inner loop sees the enclosing loop's proven end bound", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const expand = query({ seed: t.text(40) }, ({ args }) => {
  const keys = [args.seed];
  const observed = [];
  for (const outer of range(0, 3)) {
    keys.push(args.seed);
    for (const key of keys) observed.push(key);
  }
  return observed;
});`, "mutate-then-iterate-in-loop.ts");
    assert(lastDerivedArrayBound(program) === 4,
      `inner loop retained a stale pre-loop bound: ${canonical(program)}`);
    certify(program);
    assert(runArrayLength(program, { seed: { String: "value" } }) === 9,
      "2 + 3 + 4 inner iterations did not execute under the certified max 4");
  });

  test("a collection mutated in a loop keeps its end bound after the loop", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const expand = query({ seed: t.text(40) }, ({ args }) => {
  const keys = [args.seed];
  for (const outer of range(0, 3)) keys.push(args.seed);
  const observed = [];
  for (const key of keys) observed.push(key);
  return observed;
});`, "mutate-then-iterate-after-loop.ts");
    assert(lastDerivedArrayBound(program) === 4,
      `post-loop domain lost the proven end bound: ${canonical(program)}`);
    certify(program);
    assert(runArrayLength(program, { seed: { String: "value" } }) === 4,
      "post-loop iteration did not return all four values");
  });

  test("nested loops see body-local spread copies and literal batches", () => {
    const copy = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ source: t.list(t.text(40), { max: 2 }) }, ({ db, args }) => {
  const found = [];
  for (const outer of range(0, 3)) {
    const copy = [...args.source];
    for (const key of copy) found.push(db.get(items.byKey, [key]));
  }
  return found;
});`, "nested-body-copy.ts");
    assert(lastDerivedArrayBound(copy) === 2 && lastRead(copy)?.provenance === "Arg",
      `body-local spread copy lost its bound or origin: ${canonical(copy)}`);
    certify(copy);

    const batch = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ a: t.text(40), b: t.text(40) }, ({ db, args }) => {
  const found = [];
  for (const outer of range(0, 3)) {
    const batch = [args.a, args.b];
    for (const key of batch) found.push(db.get(items.byKey, [key]));
  }
  return found;
});`, "nested-body-batch.ts");
    assert(lastDerivedArrayBound(batch) === 2 && lastRead(batch)?.provenance === "Arg",
      `body-local literal batch lost its bound or origin: ${canonical(batch)}`);
    certify(batch);
  });

  test("two-deep mutation products reserve a later in-loop domain", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const expand = query({ seed: t.text(40) }, ({ args }) => {
  const keys = [args.seed];
  const observed = [];
  for (const outer of range(0, 2)) {
    for (const inner of range(0, 3)) keys.push(args.seed);
    for (const key of keys) observed.push(key);
  }
  return observed;
});`, "two-deep-mutate-iterate.ts");
    assert(lastDerivedArrayBound(program) === 7,
      `two-deep mutation product did not reserve max 7: ${canonical(program)}`);
    certify(program);
    assert(runArrayLength(program, { seed: { String: "value" } }) === 11,
      "4 + 7 inner iterations did not execute under the certified max 7");
  });

  test("branch mutation reserves the later in-loop domain", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const expand = query({ seed: t.text(40), choose: t.bool() }, ({ args }) => {
  const keys = [args.seed];
  const observed = [];
  for (const outer of range(0, 3)) {
    if (args.choose) keys.push(args.seed);
    for (const key of keys) observed.push(key);
  }
  return observed;
});`, "branch-mutate-iterate.ts");
    assert(lastDerivedArrayBound(program) === 4,
      `branch mutation did not reserve max 4: ${canonical(program)}`);
    certify(program);
    assert(runArrayLength(program, { seed: { String: "value" }, choose: { Bool: true } }) === 9,
      "branch-mutated collection did not execute its 2 + 3 + 4 iterations");
  });

  test("a collection mutated by its own growing iteration domain refuses", () => {
    const refused = lowerSource(`import { query, t } from "snapback2";
export const expand = query({ seed: t.text(40) }, ({ args }) => {
  const keys = [args.seed];
  for (const outer of range(0, 3)) {
    for (const key of keys) keys.push(key);
  }
  return keys;
});`, "self-growing-mutation-loop.ts", undefined, { tables });
    assert(!refused.ok && refused.diagnostics.some((item) => item.code === "E_UNBOUND_LOOP"),
      `self-growing loop certified instead of refusing: ${JSON.stringify(refused)}`);
  });

  test("a top-level self-growing domain refuses while a different accumulator stays bounded", () => {
    const refused = lowerSource(`import { query, t } from "snapback2";
export const expand = query({ seed: t.text(40) }, ({ args }) => {
  const keys = [args.seed];
  for (const key of keys) keys.push(key);
  return keys;
});`, "top-level-self-growing-loop.ts", undefined, { tables });
    assert(!refused.ok && refused.diagnostics.some((item) => item.code === "E_UNBOUND_LOOP"),
      `top-level self-growing loop certified instead of refusing: ${JSON.stringify(refused)}`);

    const different = lowerOne(`import { query, t } from "snapback2";
export const collect = query({ seed: t.text(40) }, ({ args }) => {
  const keys = [args.seed];
  const observed = [];
  for (const key of keys) observed.push(key);
  return observed;
});`, "different-collection-mutation-loop.ts");
    assert(lastDerivedArrayBound(different) === 1,
      `different-collection mutation changed the loop domain bound: ${canonical(different)}`);
    certify(different);
    assert(runArrayLength(different, { seed: { String: "value" } }) === 1,
      "different-collection loop changed its result length");
  });

  test("nested loop mutation deltas multiply and the certified program runs", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const expand = query({ seed: t.text(40) }, ({ args }) => {
  const keys = [args.seed];
  for (const outer of range(0, 3)) {
    for (const inner of range(0, 4)) keys.push(args.seed);
  }
  const observed = [];
  for (const key of keys) observed.push(key);
  return observed;
});`, "nested-push-product.ts");
    assert(lastDerivedArrayBound(program) === 13,
      `3 × 4 pushes plus the seed did not certify max 13: ${canonical(program)}`);
    certify(program);
    assert(runArrayLength(program, { seed: { String: "value" } }) === 13,
      "3 × 4 pushes plus the seed failed at execution or returned the wrong length");
  });

  test("three-deep nested loop mutation deltas remain multiplicative", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const expand = query({ seed: t.text(40) }, ({ args }) => {
  const keys = [args.seed];
  for (const outer of range(0, 2)) {
    for (const middle of range(0, 3)) {
      for (const inner of range(0, 4)) keys.push(args.seed);
    }
  }
  const observed = [];
  for (const key of keys) observed.push(key);
  return observed;
});`, "three-deep-push-product.ts");
    assert(lastDerivedArrayBound(program) === 25,
      `2 × 3 × 4 pushes plus the seed did not certify max 25: ${canonical(program)}`);
    certify(program);
    assert(runArrayLength(program, { seed: { String: "value" } }) === 25,
      "three-deep nested pushes failed at execution or returned the wrong length");
  });

  test("an immutable scalar alias captures provenance before later reassignment", () => {
    const program = lowerOne(`import { query, t } from "snapback2";
export const lookup = query({ a: t.text(40) }, ({ db, args, ctx }) => {
  let selected = args.a;
  const frozen = selected;
  selected = ctx.viewer;
  return db.get(items.byKey, [frozen]);
});`, "frozen-before-reassign.ts");
    assert(lastRead(program)?.provenance === "Arg", `bind-time scalar alias was not Arg: ${canonical(program)}`);
    certify(program);
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

function provenanceDiagnostic(result: ReturnType<typeof lowerSource>): FrontendDiagnostic {
  assert(!result.ok, "mixed-origin fixture unexpectedly lowered");
  const diagnostic = result.diagnostics.find((item) => item.code === "E_PROVENANCE_AMBIGUOUS");
  assert(diagnostic, `missing provenance refusal: ${JSON.stringify(result.diagnostics)}`);
  return diagnostic;
}

function mutationDiagnostic(result: ReturnType<typeof lowerSource>): FrontendDiagnostic {
  assert(!result.ok, "aliased collection mutation unexpectedly lowered");
  const diagnostic = result.diagnostics.find((item) => item.code === "E_OPAQUE"
    && item.message.includes("collection mutation requires an unaliased local collection"));
  assert(diagnostic?.family === "opaque" && diagnostic.rewrite,
    `missing aliased collection mutation envelope: ${JSON.stringify(result.diagnostics)}`);
  return diagnostic;
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

function lastRead(program: Program): ReadFact | undefined {
  return reads(program).at(-1);
}

function lastDerivedArrayBound(program: Program): number | undefined {
  const maxima: number[] = [];
  visit(program.body, (value) => {
    const domain = value.DerivedArray as { max?: number } | undefined;
    if (typeof domain?.max === "number") maxima.push(domain.max);
  });
  return maxima.at(-1);
}

function boundObjectFieldLength(program: Program, variable: string, field: string): number | undefined {
  let length: number | undefined;
  visit(program.body, (value) => {
    const bound = (value.Const ?? value.Let) as { name?: string; value?: { Object?: Record<string, { Array?: unknown[] }> } } | undefined;
    const items = bound?.name === variable ? bound.value?.Object?.[field]?.Array : undefined;
    if (items) length = items.length;
  });
  return length;
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

function certify(program: Program): Record<string, unknown> {
  const result = rustCheck([program], "synthetic", schema)[0];
  assert(result?.error === null && result.certificate, `program did not certify: ${JSON.stringify(result)}`);
  return result.certificate;
}

function runArrayLength(program: Program, args: Record<string, any>): number | undefined {
  const store = new ClientStore(schema, { rows: [], ranges: [], absences: [], verdicts: [] });
  const execution = store.reexecute(program, {
    viewer: "viewer",
    principal_kind: "user",
    auth_epoch: 1,
    args,
    now: null,
    new_ids: [],
    read_time: null,
  });
  const result = execution.execution.result;
  return typeof result === "object" && "Array" in result ? result.Array.length : undefined;
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
