import type { TableInfo } from "./authored-types";
import { ClientStore, canonicalValue, type ClosureReceipt, type Context, type Value } from "../../evaluator/src/evaluator";
import { lowerSource, typecheckSource } from "./compiler";
import type { FrontendDiagnostic, Program } from "./ir";
import { rustCheck } from "./rust-check";

type RegisterTest = (name: string, run: () => void | Promise<void>) => void;
type Assert = (condition: unknown, message: string) => asserts condition;

const items: TableInfo = {
  name: "items",
  private: false,
  columns: {
    id: { kind: "string", id: true },
    at: { kind: "int" },
    label: { kind: "string", max: 80 },
    tags: { kind: "optional", of: { kind: "optional", of: { kind: "list", of: { kind: "int" }, max: 2 } } },
  },
  indexes: {
    byId: { columns: ["id"], types: [{ kind: "string", id: true }] },
    byAt: { columns: ["at", "id"], types: [{ kind: "int" }, { kind: "string", id: true }] },
    byAtUnsafe: { columns: ["id", "at"], types: [{ kind: "string", id: true }, { kind: "int" }] },
    byLabel: { columns: ["label"], types: [{ kind: "string", max: 80 }], unique: true },
  },
};
const tables = new Map([["items", items]]);
const schema = {
  tables: {
    items: {
      columns: {
        id: "Id",
        at: "Int",
        label: { Text: { max: 80 } },
        tags: { Optional: { Optional: { List: { of: "Int", max: 2 } } } },
      },
      indexes: {
        byId: { columns: ["id"], unique: true },
        byAt: { columns: ["at", "id"], unique: false },
        byAtUnsafe: { columns: ["id", "at"], unique: false },
        byLabel: { columns: ["label"], unique: true },
      },
      rules: {
        read: { Public: { reason: "runtime-red regression" } },
        insert: { Public: { reason: "runtime-red regression" } },
        update: { Public: { reason: "runtime-red regression" } },
        delete: { Public: { reason: "runtime-red regression" } },
      },
      constraints: [],
    },
  },
  maintains: [],
  channels: {},
  auth: { password: false, guests: false },
  effects: [],
};

const sourceHeader = `import { concat, mutation, query, t } from "snapback2";
declare const items: any;`;

function emptyReceipt(): ClosureReceipt {
  return { rows: [], ranges: [], absences: [], verdicts: [] };
}

function twinContext(args: Record<string, Value> = {}): Context {
  return {
    viewer: "viewer-1",
    principal_kind: "user",
    auth_epoch: 1,
    args,
    now: 1,
    new_ids: [],
    read_time: 1,
  };
}

export function registerRuntimeRedChecks(test: RegisterTest, assert: Assert, libText: string): void {
  const assertRewrite = (
    diagnostic: FrontendDiagnostic,
    name: string,
    rewriteTables = tables,
    rewriteSchema: any = schema,
  ): void => {
    const types = typecheckSource(diagnostic.rewrite, `fixed-${name}.ts`, libText);
    assert(types.length === 0, `${name} rewrite did not type-check: ${types.map((item) => String(item.messageText)).join("; ")}`);
    const lowered = lowerSource(diagnostic.rewrite, `fixed-${name}.ts`, undefined, { tables: rewriteTables });
    assert(lowered.ok, `${name} rewrite did not lower: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    const checked = rustCheck(lowered.programs, "synthetic", rewriteSchema);
    assert(checked.every((result) => result.error === null), `${name} rewrite did not certify: ${JSON.stringify(checked)}`);
  };

  test("Page has no certify-time hasMore property", () => {
    const source = `${sourceHeader}
export const bad = query({}, ({ db }) => db.scan(items.byAt, [], { take: 2 }).hasMore);`;
    const diagnostics = typecheckSource(source, "page-has-more.ts", libText);
    assert(
      diagnostics.some((item) => String(item.messageText).includes("hasMore")),
      "Page.hasMore remained readable to the TypeScript checker",
    );
  });

  test("tuple cursors refuse only statically known runtime-invalid arity", () => {
    const cases = [
      {
        name: "scalar",
        cursor: "previous.at",
        expected: "[previous.at, previous.id]",
      },
      {
        name: "short-tuple",
        cursor: "[previous.at]",
        expected: "[previous.at, previous.id]",
      },
    ];
    for (const item of cases) {
      const source = `${sourceHeader}
export const page = query({ previousId: t.id() }, ({ db, args }) => {
  const previous = db.get(items.byId, args.previousId)!;
  return db.scan(items.byAt, [], { take: 2, after: ${item.cursor} });
});`;
      const lowered = lowerSource(source, `${item.name}.ts`, undefined, { tables });
      assert(!lowered.ok, `${item.name} cursor unexpectedly certified`);
      const refusal = lowered.diagnostics.find((diagnostic) => diagnostic.code === "E_ARGS_CURSOR_SHAPE");
      assert(refusal, `${item.name} cursor did not emit E_ARGS_CURSOR_SHAPE: ${JSON.stringify(lowered.diagnostics)}`);
      assert(refusal.family === "args" && refusal.guide === "programs/types", `${item.name} cursor lost family or guide`);
      assert(refusal.site.startsWith(`${item.name}.ts:`) && refusal.rewrite.includes(item.expected), `${item.name} cursor lost site or full tuple rewrite`);
      assertRewrite(refusal, item.name);
    }

    const optionalArg = `${sourceHeader}
export const page = query({ cursor: t.optional(t.optional(t.list(t.int(), { max: 2 }))) }, ({ db, args }) =>
  db.scan(items.byAt, [], { take: 2, after: args.cursor }));`;
    const optional = lowerSource(optionalArg, "optional-list-cursor.ts", undefined, { tables });
    assert(optional.ok, `unknown optional-list cursor shape was refused: ${optional.ok ? "" : JSON.stringify(optional.diagnostics)}`);
    assert(rustCheck(optional.programs, "synthetic", schema).every((result) => result.error === null),
      "raw certification refused an optional-list cursor whose runtime length is unknown");

    const unsafe = `${sourceHeader}
export const page = query({ id: t.id(), at: t.int() }, ({ db, args }) =>
  db.scan(items.byAtUnsafe, [], { take: 2, after: [args.id, args.at] }));`;
    const unsafeLowered = lowerSource(unsafe, "unsafe-cursor-index.ts", undefined, { tables });
    assert(!unsafeLowered.ok, "cursor on a non-unique index without trailing id certified (tied keys would be skipped between pages)");
    const indexRefusal = unsafeLowered.diagnostics.find((item) => item.code === "E_ARGS_CURSOR_INDEX");
    assert(indexRefusal?.rewrite.includes('"at", "id"') && !indexRefusal.rewrite.includes('"id", "at", "id"'),
      `cursor index rewrite did not move id to the end: ${JSON.stringify(unsafeLowered.diagnostics)}`);

    const uniqueIndex = `${sourceHeader}
export const page = query({ label: t.text(80) }, ({ db, args }) =>
  db.scan(items.byLabel, [], { take: 2, after: args.label }));`;
    const uniqueLowered = lowerSource(uniqueIndex, "unique-cursor-index.ts", undefined, { tables });
    assert(uniqueLowered.ok, `scalar cursor on a unique index (a total order without id) was refused: ${uniqueLowered.ok ? "" : JSON.stringify(uniqueLowered.diagnostics)}`);
    assert(rustCheck(uniqueLowered.programs, "synthetic", schema).every((result) => result.error === null),
      "raw certification refused a cursor on a unique index");

    const wrongDomains = `${sourceHeader}
export const page = query({ previousId: t.id() }, ({ db, args }) => {
  const previous = db.get(items.byId, args.previousId)!;
  return db.scan(items.byAt, [], { take: 2, after: [previous.id, previous.at] });
});`;
    const domainLowered = lowerSource(wrongDomains, "wrong-domains.ts", undefined, { tables });
    assert(!domainLowered.ok, "wrong-domain tuple cursor unexpectedly lowered");
    const domainRefusals = domainLowered.diagnostics.filter((item) => item.code === "E_ARGS_TYPE");
    assert(domainRefusals.length === 2 && domainRefusals.every((item) => item.rewrite.includes("[previous.at, previous.id]")),
      `wrong-domain tuple lost its typed reorder rewrite: ${JSON.stringify(domainLowered.diagnostics)}`);
    assertRewrite(domainRefusals[0]!, "wrong-domains");

    for (const [name, cursor] of [
      ["unknown-list-field", "previous.tags"],
    ]) {
      const source = `${sourceHeader}
export const page = query({ previousId: t.id() }, ({ db, args }) => {
  const previous = db.get(items.byId, args.previousId)!;
  return db.scan(items.byAt, [], { take: 2, after: ${cursor} });
});`;
      const lowered = lowerSource(source, `${name}.ts`, undefined, { tables });
      assert(lowered.ok, `${name} cursor was refused despite runtime authority: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
      assert(rustCheck(lowered.programs, "synthetic", schema).every((result) => result.error === null), `${name} failed raw certification`);
    }
  });

  test("missing point-read cursors stay runtime-authoritative while objects refuse", () => {
    for (const [name, assertion] of [["plain", ""], ["asserted", "!"]] as const) {
      const source = `${sourceHeader}
export const page = query({}, ({ db }) =>
  db.scan(items.byId, [], { take: 2, after: db.get(items.byId, "missing")${assertion} }));`;
      const lowered = lowerSource(source, `${name}-point-cursor.ts`, undefined, { tables });
      assert(lowered.ok, `${name} point-read cursor was refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
      assert(rustCheck(lowered.programs, "synthetic", schema).every((result) => result.error === null),
        `${name} point-read cursor failed raw certification`);
      const execution = new ClientStore(schema, emptyReceipt()).reexecute(lowered.programs[0]!, twinContext());
      assert(canonicalValue(execution.execution.result) === canonicalValue({ Array: [] }),
        `${name} missing point-read cursor did not execute as Null`);
    }

    for (const [name, declaration, cursor] of [
      ["literal", "", "{}"],
      ["typed", "const cursor = { invalid: true };", "cursor"],
    ]) {
      const source = `${sourceHeader}
export const page = query({}, ({ db }) => {
  ${declaration}
  return db.scan(items.byId, [], { take: 2, after: ${cursor} });
});`;
      const lowered = lowerSource(source, `${name}-object-cursor.ts`, undefined, { tables });
      assert(!lowered.ok && lowered.diagnostics.some((item) => item.code === "E_ARGS_CURSOR_SHAPE"),
        `${name} object cursor was not refused by shape: ${JSON.stringify(lowered)}`);
    }
  });

  test("twin rejects every non-indexable index ingress with engine wording", () => {
    const expectNonIndexable = (run: () => unknown, label: string): void => {
      let message = "green";
      try {
        run();
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assert(message.startsWith("E_TYPE: row is not an indexable scalar") && message.includes(label),
        `${label} produced ${message}`);
    };
    const queryProgram = (name: string, expression: any): Program => ({
      name,
      kind: "Query",
      args: {},
      read_time_granularity_ms: null,
      body: [{ Return: expression }],
    });
    const runQuery = (program: Program): unknown =>
      new ClientStore(schema, emptyReceipt()).reexecute(program, twinContext());

    expectNonIndexable(() => runQuery(queryProgram("indexable.point", { Get: {
      site: "indexable.point.0", table: "items", index: "byId",
      key: [{ Object: {} }], provenance: "Const",
    } })), "point read items.byId key component 1");
    expectNonIndexable(() => runQuery(queryProgram("indexable.prefix", { Scan: {
      site: "indexable.prefix.0", table: "items", index: "byId",
      prefix: [{ Object: {} }], order: "Asc", take: { Literal: 1 },
      after: null, before: null, range: null, provenance: "Const",
    } })), "scan items.byId prefix component 1");
    expectNonIndexable(() => runQuery(queryProgram("indexable.range", { Scan: {
      site: "indexable.range.0", table: "items", index: "byId",
      prefix: [], order: "Asc", take: { Literal: 1 }, after: null, before: null,
      range: { gt: { Object: {} }, gte: null, lt: null, lte: null }, provenance: "Const",
    } })), "scan items.byId range.gt");

    const indexedJsonSchema = JSON.parse(JSON.stringify(schema));
    indexedJsonSchema.tables.items.columns.payload = { Json: { max_bytes: 256 } };
    indexedJsonSchema.tables.items.indexes.byPayload = { columns: ["payload", "id"], unique: false };
    const row: Value = { Row: {
      id: { Id: "row-1" }, at: { Int: 1 }, label: { String: "row" }, tags: "Null",
      payload: { Row: { x: { Int: 1 } } },
    } };
    const receipt: ClosureReceipt = { ...emptyReceipt(), rows: [{ table: "items", id: "row-1", row }] };
    expectNonIndexable(() => new ClientStore(indexedJsonSchema, receipt), "indexed column items.byPayload.payload");

    const insert: Program = {
      name: "indexable.insert",
      kind: "Mutation",
      args: {},
      read_time_granularity_ms: null,
      body: [{ Insert: { table: "items", row: { Object: {
        id: { Literal: { Id: "row-1" } }, at: { Literal: { Int: 1 } },
        label: { Literal: { String: "row" } }, tags: { Literal: "Null" },
        payload: { Object: { x: { Literal: { Int: 1 } } } },
      } } } }, { Return: { Literal: "Null" } }],
    };
    expectNonIndexable(
      () => new ClientStore(indexedJsonSchema, emptyReceipt()).applyMutation(insert, twinContext()),
      "indexed column items.byPayload.payload",
    );
  });

  test("valid tuple cursors lower and certify", () => {
    const source = `${sourceHeader}
export const page = query({ previousId: t.id() }, ({ db, args }) => {
  const previous = db.get(items.byId, args.previousId)!;
  return db.scan(items.byAt, [], { take: 2, after: [previous.at, previous.id] });
});`;
    const lowered = lowerSource(source, "valid-tuple-cursor.ts", undefined, { tables });
    assert(lowered.ok, `valid tuple cursor refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    assert(rustCheck(lowered.programs, "synthetic", schema).every((result) => result.error === null), "valid tuple cursor failed raw certification");
  });

  test("module-helper tuple cursors use a structural return shape", () => {
    const source = `${sourceHeader}
function cursorOf(row: any) { return [row.at, row.id]; }
export const page = query({ previousId: t.id() }, ({ db, args }) => {
  const previous = db.get(items.byId, args.previousId)!;
  return db.scan(items.byAt, [], { take: 2, after: cursorOf(previous) });
});`;
    const lowered = lowerSource(source, "helper-tuple-cursor.ts", undefined, { tables });
    assert(lowered.ok, `helper cursor did not lower: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    assert(rustCheck(lowered.programs, "synthetic", schema).every((result) => result.error === null),
      "helper cursor failed raw certification");
  });

  test("loop-bound rows retain their table fact for tuple cursors", () => {
    const source = `${sourceHeader}
export const page = query({}, ({ db }) => {
  let next: any[] = [];
  for (const row of db.scan(items.byAt, [], { take: 1 })) {
    next = db.scan(items.byAt, [], { take: 2, after: [row.at, row.id] });
  }
  return next;
});`;
    const lowered = lowerSource(source, "loop-row-cursor.ts", undefined, { tables });
    assert(lowered.ok, `loop-row cursor did not lower: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    assert(rustCheck(lowered.programs, "synthetic", schema).every((result) => result.error === null),
      "loop-row cursor was refused by raw certification");
  });

  test("raw IR refuses known cursor arity and domains while staying silent on unknown shapes", () => {
    const cursorProgram = (name: string, after: any): Program => ({
      name,
      kind: "Query",
      args: {},
      read_time_granularity_ms: null,
      body: [{ Return: { Scan: {
        site: `${name}.0`, table: "items", index: "byAt",
        prefix: [], order: "Asc", take: { Literal: 1 },
        after, before: null, range: null, provenance: "Const",
      } } }],
    });
    const wrong = [
      cursorProgram("cursor.rawScalar", { Literal: { Int: 5 } }),
      cursorProgram("cursor.rawShort", { Array: [{ Literal: { Int: 5 } }] }),
    ];
    for (const program of wrong) {
      const checked = rustCheck([program], "synthetic", schema)[0]!;
      assert(checked.error?.code === "E_ARGS_CURSOR_SHAPE", `${program.name} got ${checked.error?.code ?? "green"}`);
      assert(checked.error.family === "args" && checked.error.guide === "programs/types" && checked.error.site.length > 0 && checked.error.rewrite.length > 0,
        `${program.name} cursor refusal lost envelope fields`);
    }

    const listField = cursorProgram("cursor.rawListField", {
      Field: {
        base: { Get: {
          site: "cursor.rawListField.1", table: "items", index: "byId",
          key: [{ Literal: { Id: "row-a" } }], provenance: "Const",
        } },
        name: "tags",
      },
    });
    const listChecked = rustCheck([listField], "synthetic", schema)[0]!;
    assert(listChecked.error === null, `runtime-sized List field got ${listChecked.error?.code}`);

    const unsafe = cursorProgram("cursor.rawUnsafe", { Array: [
      { Literal: { Id: "row-a" } }, { Literal: { Int: 5 } },
    ] });
    (unsafe.body[0] as any).Return.Scan.index = "byAtUnsafe";
    const unsafeChecked = rustCheck([unsafe], "synthetic", schema)[0]!;
    assert(unsafeChecked.error?.code === "E_ARGS_CURSOR_INDEX", `raw cursor on a non-total index got ${unsafeChecked.error?.code ?? "green"}`);

    const uniqueRaw = cursorProgram("cursor.rawUnique", { Literal: { String: "m" } });
    (uniqueRaw.body[0] as any).Return.Scan.index = "byLabel";
    const uniqueChecked = rustCheck([uniqueRaw], "synthetic", schema)[0]!;
    assert(uniqueChecked.error === null, `raw cursor on a unique index got ${uniqueChecked.error?.code}`);

    const sliced = cursorProgram("cursor.rawSlice", { Builtin: { builtin: "Slice", args: [
      { Array: [{ Literal: { Int: 5 } }, { Literal: { Id: "row-a" } }] },
      { Literal: { Int: 0 } },
      { Literal: { Int: 1 } },
    ] } });
    const slicedChecked = rustCheck([sliced], "synthetic", schema)[0]!;
    assert(slicedChecked.error === null, `runtime-sized sliced cursor got ${slicedChecked.error?.code}`);

    const domains = cursorProgram("cursor.rawDomains", { Array: [
      { Literal: { Id: "row-a" } }, { Literal: { Int: 5 } },
    ] });
    const domainsChecked = rustCheck([domains], "synthetic", schema)[0]!;
    assert(domainsChecked.error?.code === "E_ARGS_TYPE",
      `wrong-domain raw cursor got ${domainsChecked.error?.code ?? "green"}`);
    assert(domainsChecked.error.rewrite.includes("lastRow.at") && domainsChecked.error.rewrite.includes("lastRow.id"),
      `wrong-domain raw cursor lost its tuple rewrite: ${JSON.stringify(domainsChecked.error)}`);
  });

  test("cursor rewrites ignore rows from other tables and add typed cursor arguments", () => {
    const users: TableInfo = {
      name: "users", private: false,
      columns: { id: { kind: "string", id: true }, name: { kind: "string", max: 80 } },
      indexes: { byId: { columns: ["id"], types: [{ kind: "string", id: true }] } },
    };
    const source = `${sourceHeader}
declare const users: any;
export const page = query({ userId: t.id(), cursor: t.text(80) }, ({ db, args }) => {
  const user = db.get(users.byId, args.userId)!;
  return db.scan(items.byAt, [], { take: 2, after: args.cursor });
});`;
    const lowered = lowerSource(source, "other-table-cursor.ts", undefined, { tables: new Map([...tables, ["users", users]]) });
    assert(!lowered.ok, "wrong cursor unexpectedly lowered");
    const refusal = lowered.diagnostics.find((item) => item.code === "E_ARGS_CURSOR_SHAPE");
    assert(refusal && !refusal.rewrite.includes("user.at") && !refusal.rewrite.includes("user.id")
      && refusal.rewrite.includes("afterAt: t.int()") && refusal.rewrite.includes("afterId: t.id()")
      && refusal.rewrite.includes("after: [args.afterAt, args.afterId]"),
    `cursor rewrite guessed an unrelated row or omitted typed args: ${JSON.stringify(lowered.diagnostics)}`);
    const rewriteTables = new Map([...tables, ["users", users]]);
    const rewriteSchema = { ...schema, tables: { ...schema.tables, users: {
      columns: { id: "Id", name: { Text: { max: 80 } } },
      indexes: { byId: { columns: ["id"], unique: true } },
      rules: { read: { Public: { reason: "runtime-red regression" } }, insert: "Allow", update: "Allow", delete: "Allow" },
      constraints: [],
    } } };
    assertRewrite(refusal, "other-table-cursor", rewriteTables, rewriteSchema);
  });

  test("shared string literals lower per Id and Text sink in either property order", () => {
    for (const fields of [
      'id: both, at: 1, label: both',
      'label: both, at: 1, id: both',
    ]) {
      const source = `${sourceHeader}
export const put = mutation({}, ({ db }) => {
  const both = "fixed";
  db.insert(items, { ${fields} });
  return null;
});`;
      const lowered = lowerSource(source, "shared-id-text.ts", undefined, { tables });
      assert(lowered.ok, `shared literal refused for ${fields}: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
      const row = ((lowered.programs[0]!.body.find((statement: any) => statement.Insert) as any).Insert.row.Object);
      assert(row.id?.Literal?.Id === "fixed", `Id sink did not lower nominally for ${fields}: ${JSON.stringify(row)}`);
      assert(JSON.stringify(row.label).includes("both"), `Text sink stopped using the Text binding for ${fields}: ${JSON.stringify(row)}`);
      assert(rustCheck(lowered.programs, "synthetic", schema).every((result) => result.error === null), `shared literal did not certify for ${fields}`);
    }
  });

  test("Id arithmetic refuses while runtime-valid Id textualization stays silent outside an Id sink", () => {
    const expressions = [
      { name: "plus", expression: 'args.left + ":" + args.right' },
      { name: "concat", expression: 'concat(args.left, ":", args.right)' },
      { name: "template", expression: '`${args.left}:${args.right}`' },
      { name: "String", expression: "String(args.left)" },
    ];
    for (const item of expressions) {
      const source = `${sourceHeader}
export const bad = query({ left: t.id(), right: t.id() }, ({ args }) => ${item.expression});`;
      const lowered = lowerSource(source, `id-text-${item.name}.ts`, undefined, { tables });
      if (item.name === "plus") {
        assert(!lowered.ok, "Id numeric addition unexpectedly certified");
        const refusals = lowered.diagnostics.filter((diagnostic) => diagnostic.code === "E_ARGS_ID_TEXT");
        assert(refusals.length === 1, `Id addition emitted ${refusals.length} Id-text refusals`);
        const refusal = refusals[0]!;
        assert(refusal.family === "args" && refusal.guide === "programs/types" && refusal.rewrite !== source,
          "Id addition refusal lost envelope or rewrite");
        assertRewrite(refusal, "id-text-plus");
      } else {
        if (item.name === "String") {
          assert(!lowered.ok && lowered.diagnostics.every((diagnostic) => diagnostic.code !== "E_ARGS_ID_TEXT"),
            `String() should remain an opaque-subset refusal, not an Id-text refusal: ${JSON.stringify(lowered)}`);
        } else {
          assert(lowered.ok, `${item.name} textualization was refused although the runtime accepts it: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
          assert(rustCheck(lowered.programs, "synthetic", schema).every((result) => result.error === null),
            `${item.name} textualization failed raw certification`);
        }
      }
    }

    for (const item of [
      { name: "concat", expression: 'concat("prefix", args.left)' },
      { name: "template", expression: '`prefix:${args.left}`' },
      { name: "String", expression: "String(args.left)" },
    ]) {
      const idSink = `${sourceHeader}
export const bad = mutation({ left: t.id() }, ({ db, args }) => {
  db.insert(items, { id: ${item.expression}, at: 1, label: "bad" });
  return null;
});`;
      const lowered = lowerSource(idSink, `id-${item.name}-sink.ts`, undefined, { tables });
      assert(!lowered.ok, `${item.name} into an Id sink unexpectedly certified`);
      const refusal = lowered.diagnostics.find((diagnostic) => diagnostic.code === "E_ARGS_ID_TEXT");
      assert(refusal, `Id ${item.name} sink missed E_ARGS_ID_TEXT: ${JSON.stringify(lowered.diagnostics)}`);
      assertRewrite(refusal, `id-${item.name}-sink`);
    }
  });

  test("Id scalar rewrites bind the actual context and paste cleanly", () => {
    const source = `${sourceHeader}
export const bad = mutation({}, ({ db }) => {
  db.insert(items, { id: "", at: 1, label: "bad" });
  return null;
});`;
    const lowered = lowerSource(source, "id-scalar-context.ts", undefined, { tables });
    assert(!lowered.ok, "empty Id literal unexpectedly certified");
    const refusal = lowered.diagnostics.find((diagnostic) => diagnostic.code === "E_ARGS_ID_SCALAR");
    assert(refusal, `Id scalar refusal was absent: ${JSON.stringify(lowered.diagnostics)}`);
    assert(refusal.rewrite.includes("ctx: snapbackCtx") && refusal.rewrite.includes("snapbackCtx.newId()"),
      `Id scalar rewrite did not bind its context: ${JSON.stringify(lowered.diagnostics)}`);
    assertRewrite(refusal, "id-scalar-context");
  });

  test("shorthand insert Id rewrites to a property and assigned Id bindings stay runtime-authoritative", () => {
    const shorthand = `${sourceHeader}
export const bad = mutation({}, ({ db }) => {
  const id = "";
  db.insert(items, { id, at: 1, label: "bad" });
  return null;
});`;
    const lowered = lowerSource(shorthand, "id-scalar-shorthand.ts", undefined, { tables });
    assert(!lowered.ok, "invalid shorthand Id unexpectedly certified");
    const refusal = lowered.diagnostics.find((diagnostic) => diagnostic.code === "E_ARGS_ID_SCALAR");
    assert(refusal, `shorthand Id refusal was absent: ${JSON.stringify(lowered.diagnostics)}`);
    assert(refusal.rewrite.includes("id: snapbackCtx.newId()") && !refusal.rewrite.includes("{ snapbackCtx.newId()"),
      `shorthand rewrite was not a property assignment: ${JSON.stringify(lowered.diagnostics)}`);
    assertRewrite(refusal, "id-scalar-shorthand");

    const assigned = `${sourceHeader}
export const put = mutation({ given: t.id() }, ({ db, args }) => {
  let id = "";
  id = args.given;
  db.insert(items, { id, at: 1, label: "ok" });
  return null;
});`;
    const accepted = lowerSource(assigned, "id-scalar-assigned.ts", undefined, { tables });
    assert(accepted.ok, `assigned Id binding was refused: ${accepted.ok ? "" : JSON.stringify(accepted.diagnostics)}`);
    assert(rustCheck(accepted.programs, "synthetic", schema).every((result) => result.error === null),
      "assigned Id binding failed raw certification");
  });

  test("array-destructuring types follow helper structure rather than helper spelling", () => {
    const source = `${sourceHeader}
function identityTuple(left: any, right: any) { return [left, right]; }
export const put = mutation({ left: t.id(), right: t.id() }, ({ db, ctx, args }) => {
  const [lo, hi] = identityTuple(args.left, args.right);
  db.insert(items, { id: lo, at: 1, label: "pair" });
  return hi;
});`;
    const lowered = lowerSource(source, "structural-destructuring.ts", undefined, { tables });
    assert(!lowered.ok && lowered.diagnostics.some((diagnostic) => diagnostic.code === "E_OPAQUE"),
      "general destructuring unexpectedly crossed the lowering subset fence");
    assert(lowered.diagnostics.every((diagnostic) => diagnostic.code !== "E_ARGS_ID_SCALAR"),
      `helper spelling produced a false Id refusal: ${JSON.stringify(lowered.diagnostics)}`);
  });

  test("viewer aliases inhabit every runtime Id and Ref position", () => {
    const users: TableInfo = {
      name: "users", private: false,
      columns: { id: { kind: "string", id: true } },
      indexes: { byId: { columns: ["id"], types: [{ kind: "string", id: true }] } },
    };
    const ownedItems: TableInfo = {
      ...items,
      columns: { ...items.columns, owner: { kind: "string", id: true } },
      indexes: { ...items.indexes, byOwnerOnly: { columns: ["owner"], types: [{ kind: "string", id: true }] } },
    };
    const viewerTables = new Map([["items", ownedItems], ["users", users]]);
    const source = `${sourceHeader}
declare const users: any;
export const put = mutation({}, ({ db, ctx }) => {
  const me = ctx.viewer;
  db.insert(items, { id: ctx.newId(), at: 1, label: "mine", owner: me });
  return db.get(items.byOwnerOnly, [ctx.viewer]);
});
export const reads = query({}, ({ db, ctx }) => [
  db.get(users, ctx.viewer),
  db.get(items.byOwnerOnly, [ctx.viewer]),
  db.scan(items.byOwnerOnly, [ctx.viewer], { take: 1 }),
  db.exists(items.byOwnerOnly, [ctx.viewer]),
]);`;
    const lowered = lowerSource(source, "viewer-id-positions.ts", undefined, { tables: viewerTables });
    assert(lowered.ok, `viewer Id/Ref positions were refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
  });

  test("runtime-accepted read-key scalars and viewer authority are never rewritten", () => {
    for (const item of [
      {
        name: "text-arg",
        source: `${sourceHeader}\nexport const bad = query({ name: t.text(80) }, ({ db, args }) => db.get(items.byId, args.name));`,
      },
      {
        name: "viewer",
        source: `${sourceHeader}\nexport const bad = query({}, ({ db, ctx }) => db.get(items.byId, ctx.viewer));`,
      },
      {
        name: "mutation-read",
        source: `${sourceHeader}\nexport const bad = mutation({ name: t.text(80) }, ({ db, args }) => db.get(items.byId, args.name));`,
      },
    ]) {
      const lowered = lowerSource(item.source, `id-read-${item.name}.ts`, undefined, { tables });
      assert(lowered.ok, `${item.name} runtime-accepted read key was refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
      assert(rustCheck(lowered.programs, "synthetic", schema).every((result) => result.error === null),
        `${item.name} read key failed raw certification`);
    }
  });

  test("raw IR write certification rejects invalid Id literals and Id concatenation", () => {
    const invalidLiteral: Program = {
      name: "raw.invalidLiteral",
      kind: "Mutation",
      args: {},
      read_time_granularity_ms: null,
      body: [{ Insert: { table: "items", row: { Object: {
        id: { Literal: { String: "" } },
        at: { Literal: { Int: 1 } },
        label: { Literal: { String: "bad" } },
      } } } }, { Return: { Literal: "Null" } }],
    };
    const literalChecked = rustCheck([invalidLiteral], "synthetic", schema)[0]!;
    assert(literalChecked.error?.code === "E_ARGS_ID_SCALAR", `raw invalid Id literal got ${literalChecked.error?.code ?? "green"}`);

    const concatenated: Program = {
      ...invalidLiteral,
      name: "raw.idConcat",
      args: { id: "Id" },
      body: [{ Insert: { table: "items", row: { Object: {
        id: { Builtin: { builtin: "Concat", args: [
          { Literal: { String: "prefix" } },
          { Variable: "id" },
        ] } },
        at: { Literal: { Int: 1 } },
        label: { Literal: { String: "bad" } },
      } } } }, { Return: { Literal: "Null" } }],
    };
    const concatChecked = rustCheck([concatenated], "synthetic", schema)[0]!;
    assert(concatChecked.error?.code === "E_ARGS_ID_SCALAR", `raw textual Id concat got ${concatChecked.error?.code ?? "green"}`);

    const added: Program = {
      ...invalidLiteral,
      name: "raw.idAdd",
      args: { id: "Id" },
      body: [{ Insert: { table: "items", row: { Object: {
        id: { Binary: { op: "Add", left: { Variable: "id" }, right: { Literal: { String: ":suffix" } } } },
        at: { Literal: { Int: 1 } },
        label: { Literal: { String: "bad" } },
      } } } }, { Return: { Literal: "Null" } }],
    };
    const addChecked = rustCheck([added], "synthetic", schema)[0]!;
    assert(addChecked.error?.code === "E_ARGS_ID_TEXT", `raw Id addition got ${addChecked.error?.code ?? "green"}`);
  });
}
