import { lowerSource, type TableInfo } from "./compiler";
import type { FrontendDiagnostic, Program, Provenance } from "./ir";
import { rustCheck } from "./rust-check";

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

export function registerCollectionFactChecks(test: Test): void {
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
      assert(refused.diagnostics.some((item) => item.code === "E_PROVENANCE_AMBIGUOUS" || item.code === "E_UNBOUND_LOOP"),
        `${fixture.name} push refused for the wrong reason: ${JSON.stringify(refused.diagnostics)}`);
      const diagnostic = refused.diagnostics.find((item) => item.code === "E_PROVENANCE_AMBIGUOUS");
      if (diagnostic) {
        const original = fixture.name === "implicit-argument" ? "keys" : "args.keys";
        assert(diagnostic.message.includes(original) && diagnostic.message.includes("ctx.viewer"),
          `${fixture.name} push omitted a real origin: ${JSON.stringify(diagnostic)}`);
      }
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
