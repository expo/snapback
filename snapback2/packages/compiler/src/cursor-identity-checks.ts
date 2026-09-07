import { ClientStore, type ClosureReceipt, type Context, type Value } from "../../evaluator/src/evaluator";
import type { TableInfo } from "./authored-types";
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
    owner: { kind: "string", id: true },
    at: { kind: "int" },
    flag: { kind: "bool" },
    price: { kind: "decimal", scale: 2 },
    label: { kind: "string", max: 80 },
  },
  indexes: {
    byId: { components: ["id"].map(Column => ({ Column })), types: [{ kind: "string", id: true }], unique: true },
    byOwnerAt: {
      components: ["owner", "at", "id"].map(Column => ({ Column })),
      types: [{ kind: "string", id: true }, { kind: "int" }, { kind: "string", id: true }],
    },
    byAt: {
      components: ["at", "id"].map(Column => ({ Column })),
      types: [{ kind: "int" }, { kind: "string", id: true }],
    },
    byFlag: {
      components: ["flag", "id"].map(Column => ({ Column })),
      types: [{ kind: "bool" }, { kind: "string", id: true }],
    },
  },
};
const tables = new Map([["items", items]]);
const schema = {
  tables: {
    items: {
      columns: {
        id: "Id", owner: "Id", at: "Int", flag: "Bool",
        price: { Decimal: { scale: 2 } }, label: { Text: { max: 80 } },
      },
      indexes: {
        byId: { components: [{ Column: "id" }], unique: true },
        byOwnerAt: { components: [{ Column: "owner" }, { Column: "at" }, { Column: "id" }], unique: false },
        byAt: { components: [{ Column: "at" }, { Column: "id" }], unique: false },
        byFlag: { components: [{ Column: "flag" }, { Column: "id" }], unique: false },
      },
      rules: {
        read: { Public: { reason: "cursor identity regression" } },
        insert: { Public: { reason: "cursor identity regression" } },
        update: { Public: { reason: "cursor identity regression" } },
        delete: { Public: { reason: "cursor identity regression" } },
      },
      constraints: [],
    },
  },
  maintains: [],
  channels: {},
  auth: { password: false, guests: false },
  effects: [],
};
const sourceHeader = `import { query, t } from "snapback2";
declare const items: any;`;
const emptyReceipt: ClosureReceipt = { rows: [], ranges: [], absences: [], verdicts: [] };

export function registerCursorIdentityChecks(
  test: RegisterTest,
  assert: Assert,
  libText: string,
): void {
  const assertRewrite = (diagnostic: FrontendDiagnostic, name: string): Program[] => {
    const typeErrors = typecheckSource(diagnostic.rewrite, `fixed-${name}.ts`, libText);
    assert(typeErrors.length === 0, `${name} rewrite did not type-check: ${typeErrors.map((item) => String(item.messageText)).join("; ")}`);
    const lowered = lowerSource(diagnostic.rewrite, `fixed-${name}.ts`, undefined, { tables });
    assert(lowered.ok, `${name} rewrite did not lower: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    const checked = rustCheck(lowered.programs, "synthetic", schema);
    assert(checked.every((result) => result.error === null), `${name} rewrite did not certify: ${JSON.stringify(checked)}`);
    return lowered.programs;
  };

  test("stable let, helper, and inline array prefixes lower the same Id cursor and page", () => {
    const source = `${sourceHeader}
function keyOf(owner: any) { return [owner, 5]; }
export const identifierPrefix = query({ owner: t.id() }, ({ db, args }) => {
  let key = [args.owner, 5];
  return db.scan(items.byOwnerAt, key, { take: 2, after: "row-1" });
});
export const helperPrefix = query({ owner: t.id() }, ({ db, args }) =>
  db.scan(items.byOwnerAt, keyOf(args.owner), { take: 2, after: "row-1" }));
export const inlinePrefix = query({ owner: t.id() }, ({ db, args }) =>
  db.scan(items.byOwnerAt, [args.owner, 5], { take: 2, after: "row-1" }));`;
    const lowered = lowerSource(source, "identifier-prefix.ts", undefined, { tables });
    assert(lowered.ok, `identifier prefix refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    const identifierScan = findVariants(lowered.programs[0], "Scan")[0];
    const helperScan = findVariants(lowered.programs[1], "Scan")[0];
    const inlineScan = findVariants(lowered.programs[2], "Scan")[0];
    assert(identifierScan?.after?.Literal?.Id === "row-1", `identifier cursor was not Id: ${JSON.stringify(identifierScan)}`);
    assert(helperScan?.after?.Literal?.Id === "row-1", `helper cursor was not Id: ${JSON.stringify(helperScan)}`);
    assert(inlineScan?.after?.Literal?.Id === "row-1", `inline cursor was not Id: ${JSON.stringify(inlineScan)}`);
    const normalized = [identifierScan, helperScan, inlineScan]
      .map((scan) => JSON.stringify({ ...scan, site: "same" }));
    assert(normalized.every((value) => value === normalized[0]),
      `stable-let, helper, and inline prefix scans differ: ${JSON.stringify([identifierScan, helperScan, inlineScan])}`);
    for (const program of lowered.programs) {
      const result = run(program, { owner: { Id: "owner-1" } }, twoRows()).result;
      assert(arrayRowIds(result).join(",") === "row-2", `${program.name} restarted instead of paging: ${JSON.stringify(result)}`);
    }
  });

  test("a reassigned let prefix keeps unknown arity silent", () => {
    const source = `${sourceHeader}
export const page = query({ owner: t.id(), cursor: t.json(256) }, ({ db, args }) => {
  let key = [args.owner, 5];
  key = [args.owner, 6];
  return db.scan(items.byOwnerAt, key, { take: 2, after: args.cursor });
});`;
    const lowered = lowerSource(source, "reassigned-prefix.ts", undefined, { tables });
    assert(lowered.ok || lowered.diagnostics.every((item) => item.code !== "E_ARGS_TYPE"),
      `reassigned prefix produced a wrong-domain refusal: ${JSON.stringify(lowered)}`);
  });

  test("a full-prefix cursor rewrite removes both bounds and both twins reject the raw IR", () => {
    const source = `${sourceHeader}
export const page = query({ owner: t.id() }, ({ db, args }) =>
  db.scan(items.byOwnerAt, [args.owner, 5, "row-1"], { take: 2, after: ("row-1" as any), before: "row-2" }));`;
    const lowered = lowerSource(source, "full-prefix-cursor.ts", undefined, { tables });
    assert(!lowered.ok, "full-prefix cursor unexpectedly lowered");
    const refusals = lowered.diagnostics.filter((item) => item.code === "E_ARGS_CURSOR_SHAPE");
    assert(refusals.length === 2, `full-prefix cursor did not refuse both bounds: ${JSON.stringify(lowered.diagnostics)}`);
    for (const [offset, refusal] of refusals.entries()) {
      assert(!refusal.rewrite.includes("after:") && !refusal.rewrite.includes("before:"),
        `full-prefix rewrite retained a cursor bound: ${refusal.rewrite}`);
      const rewritten = assertRewrite(refusal, `full-prefix-cursor-${offset}`);
      run(rewritten[0]!, { owner: { Id: "owner-1" } }, twoRows());
    }

    const raw = rawScan("raw.fullPrefix", [id("owner-1"), int(5), id("row-1")], id("row-1"), "byOwnerAt", id("row-2"));
    const checked = rustCheck([raw], "synthetic", schema)[0]!;
    assert(checked.error?.code === "E_ARGS_CURSOR_SHAPE", `raw full prefix got ${checked.error?.code ?? "green"}`);
    let runtime = "";
    try { run(raw); } catch (error) { runtime = String(error); }
    assert(
      runtime.includes("E_TYPE: scan items.byOwnerAt prefix names every index column, so a cursor has no position to compare; remove after/before or shorten the prefix"),
      `twin accepted full-prefix cursor: ${runtime}`,
    );
  });

  test("overlong scan prefixes and point keys refuse before cursor analysis in the twin and certifier", () => {
    const source = `${sourceHeader}
export const page = query({}, ({ db }) =>
  db.scan(items.byId, ["a", "b"], { take: 1, after: "c" }));`;
    const lowered = lowerSource(source, "overlong-prefix.ts", undefined, { tables });
    assert(!lowered.ok, "overlong prefix unexpectedly lowered");
    const refusals = lowered.diagnostics.filter((item) => item.code === "E_ARGS_TYPE");
    assert(refusals.length === 1
      && refusals[0]!.message.includes("prefix supplies 2 components but items.byId has 1 columns")
      && lowered.diagnostics.every((item) => item.code !== "E_ARGS_CURSOR_SHAPE"),
    `overlong prefix was misdiagnosed: ${JSON.stringify(lowered.diagnostics)}`);
    const rewritten = assertRewrite(refusals[0]!, "overlong-prefix");
    run(rewritten[0]!);

    const rawScanProgram = rawScan("raw.overlong", [id("a"), id("b")], id("c"), "byId");
    const rawScanCheck = rustCheck([rawScanProgram], "synthetic", schema)[0]!;
    assert(rawScanCheck.error?.code === "E_ARGS_TYPE"
      && rawScanCheck.error.message.includes("prefix supplies 2 components")
      && !rawScanCheck.error.message.includes("cursor has no position"),
    `raw overlong prefix was misdiagnosed: ${JSON.stringify(rawScanCheck)}`);
    let scanRuntime = "";
    try { run(rawScanProgram); } catch (error) { scanRuntime = String(error); }
    assert(scanRuntime === "Error: E_TYPE: scan items.byId prefix has too many columns",
      `twin overlong-prefix refusal changed: ${scanRuntime}`);

    const point: Program = {
      name: "raw.overlongPoint", kind: "Query", args: {}, read_time_granularity_ms: null,
      body: [{ Return: { Get: {
        site: "raw.overlongPoint.0", table: "items", index: "byId",
        key: [id("a"), id("b")], provenance: "Const",
      } } }],
    };
    const pointCheck = rustCheck([point], "synthetic", schema)[0]!;
    assert(pointCheck.error?.code === "E_ARGS_TYPE"
      && pointCheck.error.message.includes("key supplies 2 components"),
    `raw point-key arity was not certified: ${JSON.stringify(pointCheck)}`);
    let pointRuntime = "";
    try { run(point); } catch (error) { pointRuntime = String(error); }
    assert(pointRuntime === "Error: E_TYPE: point read items.byId supplied 2 of 1 key columns",
      `twin point-key refusal changed: ${pointRuntime}`);
  });

  test("one-column wrong-domain cursor repair is typed and not a no-op", () => {
    const source = `${sourceHeader}
export const page = query({}, ({ db }) => db.scan(items.byId, [], { take: 1, after: 5 }));`;
    const lowered = lowerSource(source, "one-column-domain.ts", undefined, { tables });
    assert(!lowered.ok, "one-column wrong-domain cursor lowered");
    const refusal = lowered.diagnostics.find((item) => item.code === "E_ARGS_TYPE");
    assert(refusal && refusal.rewrite !== source && refusal.rewrite.includes("afterId: t.id()"),
      `one-column repair remained a no-op: ${JSON.stringify(lowered.diagnostics)}`);
    assertRewrite(refusal, "one-column-domain");
  });

  test("IndexableScalar declarations admit Json while lowering refuses known object cursors", () => {
    const source = `import { query, t, type Json } from "snapback2";
declare const items: any;
export const scalar = query({ cursor: t.id() }, ({ db, args }) => db.scan(items.byId, [], { take: 1, after: args.cursor }));
export const tuple = query({ at: t.int(), id: t.id() }, ({ db, args }) => db.scan(items.byAt, [], { take: 1, after: [args.at, args.id] }));
export const sentinel = query({}, ({ db }) => db.scan(items.byId, [], { take: 1, after: null }));
export const json = query({ cursor: t.json<Json>(256) }, ({ db, args }) => db.scan(items.byId, [], { take: 1, after: args.cursor }));`;
    const types = typecheckSource(source, "indexable-scalar.ts", libText);
    assert(types.length === 0, `IndexableScalar rejected a supported declaration: ${types.map((item) => String(item.messageText)).join("; ")}`);
    const lowered = lowerSource(source, "indexable-scalar.ts", undefined, { tables });
    assert(lowered.ok, `Json-typed cursor was not deferred to runtime: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);

    const objectSource = `${sourceHeader}
export const objectCursor = query({}, ({ db }) => db.scan(items.byId, [], { take: 1, after: {} }));`;
    assert(typecheckSource(objectSource, "object-cursor.ts", libText).length === 0,
      "Json-compatible object literal should reach lowering");
    const object = lowerSource(objectSource, "object-cursor.ts", undefined, { tables });
    const refusal = !object.ok && object.diagnostics.find((item) => item.code === "E_ARGS_CURSOR_SHAPE");
    assert(refusal && refusal.message.includes("cursor must be an indexable scalar"),
      `known object cursor was not refused at lowering: ${JSON.stringify(object)}`);
  });

  test("identity retargeting cannot overwrite a parent Bool cursor component", () => {
    const source = `${sourceHeader}
export const page = query({ previousId: t.id(), afterId: t.id() }, ({ db, args }) => {
  const row = db.get(items.byId, args.previousId)!;
  return db.scan(items.byFlag, [], { take: 1, after: ["user-1" === row.owner, args.afterId] });
});`;
    const lowered = lowerSource(source, "bool-cursor.ts", undefined, { tables });
    assert(lowered.ok, `Bool equality cursor was refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    const scan = findVariants(lowered.programs[0], "Scan")[0];
    assert(scan.after?.Array?.[0]?.Binary?.op === "Eq",
      `Bool equality cursor did not lower as equality: ${JSON.stringify(scan.after)}`);
    assert(rustCheck(lowered.programs, "synthetic", schema).every((result) => result.error === null),
      "Bool equality cursor failed Rust certification");
    const result = run(lowered.programs[0]!, {
      previousId: { Id: "row-a" }, afterId: { Id: "row-a" },
    }, booleanRows()).result;
    assert(arrayRowIds(result).join(",") === "row-b", `Bool equality cursor did not execute in the twin: ${JSON.stringify(result)}`);
  });

  test("Decimal cursor components structurally match Int index columns", () => {
    const source = `${sourceHeader}
export const page = query({ previousId: t.id() }, ({ db, args }) => {
  const previous = db.get(items.byId, args.previousId)!;
  return db.scan(items.byAt, [], { take: 2, after: [previous.price, previous.id] });
});`;
    const lowered = lowerSource(source, "decimal-int-cursor.ts", undefined, { tables });
    assert(lowered.ok, `Decimal/Int cursor was refused in TypeScript: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    assert(rustCheck(lowered.programs, "synthetic", schema).every((result) => result.error === null),
      "Rust certifier nominally refused a runtime-valid Decimal/Int cursor");
    const result = run(lowered.programs[0]!, { previousId: { Id: "row-a" } }, decimalRows()).result;
    assert(arrayRowIds(result).includes("row-b"), `Decimal/Int cursor did not execute in the twin: ${JSON.stringify(result)}`);
  });

  test("raw page field access is certify-red and twin-red", () => {
    const source = `${sourceHeader}
export const bad = query({}, ({ db }) => (db.scan(items.byOwnerAt, [], { take: 2 }) as any).hasMore);`;
    const lowered = lowerSource(source, "raw-page-field.ts", undefined, { tables });
    assert(lowered.ok, `raw page field did not lower: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    const checked = rustCheck(lowered.programs, "synthetic", schema)[0]!;
    assert(checked.error?.code === "E_ARGS_TYPE", `page field got ${checked.error?.code ?? "green"}`);
    assert(checked.error.message.includes(".hasMore is read from a list"),
      `page field lost the specific refusal: ${JSON.stringify(checked)}`);
    let runtime = "";
    try { run(lowered.programs[0]!); } catch (error) { runtime = String(error); }
    assert(runtime.includes("E_TYPE"), `twin accepted page.hasMore: ${runtime}`);
  });

  test("identity equality retargets text literals in every operand position", () => {
    const source = `${sourceHeader}
export const equality = query({}, ({ db, ctx }) => {
  const row = db.get(items.byId, "row-1")!;
  return [
    row.owner === "user-1",
    row.owner !== "user-2",
    "user-1" === row.owner,
    ctx.viewer === "user-1",
  ];
});`;
    const lowered = lowerSource(source, "identity-equality.ts", undefined, { tables });
    assert(lowered.ok, `identity equality refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    const body = JSON.stringify(lowered.programs[0]!.body);
    assert(body.includes('"Id":"user-1"') && body.includes('"Id":"user-2"'), `equality literals were not Id values: ${body}`);
    assert(!body.includes('"String":"user-1"') && !body.includes('"String":"user-2"'), `equality retained text literals: ${body}`);
    const result = run(lowered.programs[0]!, {}, oneRow()).result;
    assert(JSON.stringify(result) === JSON.stringify({ Array: [{ Bool: true }, { Bool: true }, { Bool: true }, { Bool: true }] }),
      `identity comparisons were not true in the twin: ${JSON.stringify(result)}`);
  });

  test("an optional Id nullish fallback lowers as an Id value", () => {
    const source = `${sourceHeader}
export const fallback = query({ maybe: t.optional(t.id()) }, ({ args }) => args.maybe ?? "anonymous");`;
    const lowered = lowerSource(source, "identity-fallback.ts", undefined, { tables });
    assert(lowered.ok, `Id fallback refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    assert(JSON.stringify(lowered.programs[0]!.body).includes('"Literal":{"Id":"anonymous"}'),
      `?? fallback was not an Id literal: ${JSON.stringify(lowered.programs[0]!.body)}`);
  });
}

function run(program: Program, args: Record<string, Value> = {}, receipt: ClosureReceipt = emptyReceipt): { result: Value } {
  const context: Context = {
    viewer: "user-1", principal_kind: "user", auth_epoch: 1, args, now: 1, new_ids: [], read_time: 1,
  };
  const store = new ClientStore(schema, receipt);
  const execution = store.reexecute(program, context);
  return { result: execution.execution.result };
}

function rawScan(name: string, prefix: any[], after: any, index = "byOwnerAt", before: any = null): Program {
  return {
    name,
    kind: "Query",
    args: {},
    read_time_granularity_ms: null,
    body: [{ Return: { Scan: {
      site: `${name}.0`, table: "items", index, prefix: prefix.map(Scalar => ({ Scalar })), order: "Asc",
      take: { Literal: 2 }, after, before, range: null, provenance: "Const",
    } } }],
  };
}

function id(value: string): any {
  return { Literal: { Id: value } };
}

function int(value: number): any {
  return { Literal: { Int: value } };
}

function oneRow(): ClosureReceipt {
  return {
    ...emptyReceipt,
    rows: [{ table: "items", id: "row-1", row: { Row: {
      id: { Id: "row-1" }, owner: { Id: "user-1" }, at: { Int: 5 }, flag: { Bool: false },
      price: { Int: 5 }, label: { String: "one" },
    } } }],
  };
}

function twoRows(): ClosureReceipt {
  return {
    ...emptyReceipt,
    rows: [
      { table: "items", id: "row-1", row: { Row: {
        id: { Id: "row-1" }, owner: { Id: "owner-1" }, at: { Int: 5 }, flag: { Bool: false },
        price: { Int: 5 }, label: { String: "one" },
      } } },
      { table: "items", id: "row-2", row: { Row: {
        id: { Id: "row-2" }, owner: { Id: "owner-1" }, at: { Int: 5 }, flag: { Bool: true },
        price: { Int: 6 }, label: { String: "two" },
      } } },
    ],
  };
}

function booleanRows(): ClosureReceipt {
  return {
    ...emptyReceipt,
    rows: [
      { table: "items", id: "row-a", row: { Row: {
        id: { Id: "row-a" }, owner: { Id: "user-1" }, at: { Int: 1 }, flag: { Bool: false },
        price: { Int: 1 }, label: { String: "context" },
      } } },
      { table: "items", id: "row-b", row: { Row: {
        id: { Id: "row-b" }, owner: { Id: "user-2" }, at: { Int: 2 }, flag: { Bool: true },
        price: { Int: 2 }, label: { String: "after" },
      } } },
    ],
  };
}

function decimalRows(): ClosureReceipt {
  return booleanRows();
}

function findVariants(value: unknown, name: string, found: any[] = []): any[] {
  if (Array.isArray(value)) {
    value.forEach((item) => findVariants(item, name, found));
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (name in record) found.push(record[name]);
    Object.values(record).forEach((item) => findVariants(item, name, found));
  }
  return found;
}

function arrayRowIds(value: Value): string[] {
  if (value === "Null" || !("Array" in value)) return [];
  return value.Array.flatMap((entry) => entry !== "Null" && "Row" in entry && entry.Row.id !== "Null" && "Id" in entry.Row.id
    ? [entry.Row.id.Id]
    : []);
}
