import { deepStrictEqual } from "node:assert/strict";
import { ClientStore, type ClosureReceipt, type Context } from "../../evaluator/src/evaluator";
import type { Program } from "./ir";
import { lowerProject } from "./project";
import { rustCheck } from "./rust-check";
import { assert, compileInline, diagnosticsText, operation, withProject, type Test } from "./quarry-check-helpers";

/** Public contracts retained while deleting the generated-TypeScript oracle. */
export function registerQuarryDirectContractChecks(test: Test): void {
  test("direct Quarry reserves E_AUTH refusal codes with sited rewrites", () => {
    for (const [name, statement] of [
      ["require", "  require true else E_AUTH_REQUIRED\n  return null"],
      ["assert", "  return rows[id]! else E_AUTH_SESSION"],
    ] as const) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: "table rows:\n  value: int\n  public\n" },
        { fileName: `snapback/${name}.q`, source: `query bad(id: rows):\n${statement}\n` },
      ]);
      const refusal = result.ok ? undefined : result.diagnostics.find((entry) => entry.code === "E_OP_RESERVED");
      assert(refusal?.family === "op" && refusal.site.startsWith(`snapback/${name}.q:`)
        && refusal.message.includes("reserved E_AUTH_* namespace") && refusal.rewrite === "ACCESS_DENIED"
        && refusal.guide === "programs/refusals",
      `${name} reserved-code contract changed: ${JSON.stringify(result)}`);
      const repaired = compileInline([
        { fileName: "snapback/schema.q", source: "table rows:\n  value: int\n  public\n" },
        { fileName: `snapback/${name}.q`, source: `query bad(id: rows):\n${statement.replace(/E_AUTH_[A-Z]+/, refusal!.rewrite)}\n` },
      ]);
      assert(repaired.ok, `${name} token rewrite did not recompile: ${JSON.stringify(repaired)}`);
    }
  });

  test("direct project aggregation retains every source until its explicit truncation refusal", async () => {
    const files: Record<string, string> = {
      "snapback/schema.q": "table rows:\n  value: int\n  public\n",
    };
    for (let index = 0; index < 55; index += 1) {
      const suffix = String(index).padStart(2, "0");
      files[`snapback/bad${suffix}.q`] = `query bad${suffix}():\n  return missing${suffix}\n`;
    }
    await withProject(files, async root => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics.length === 50,
        `project diagnostic bound changed: ${JSON.stringify(result)}`);
      assert(result.diagnostics[0]?.site === "snapback/bad00.q:2:10"
        && result.diagnostics.at(-1)?.site === "snapback/bad49.q:2:10",
      `project diagnostics lost stable source ordering: ${JSON.stringify(result.diagnostics)}`);
      const truncated = result.diagnostics.at(-1);
      assert(truncated?.code === "E_DIAG_TRUNCATED" && truncated.family === "opaque"
        && truncated.message === "…and 6 more project refusals"
        && truncated.rewrite.includes("Fix the remaining diagnostics")
        && truncated.guide === "opaque/subset",
      `project diagnostic truncation lost its count or envelope: ${JSON.stringify(truncated)}`);
    });
  });

  test("direct Quarry range modifiers refuse noncanonical order and before with executable rewrites", () => {
    const schema = "table posts:\n  author: principal\n  at: time\n  by byAuthorAt: author, at, id\n  public\n";
    for (const item of [
      { source: "query page(author: principal, c: cursor):\n  return posts[author] by byAuthorAt after c first 3\n",
        rewrite: "-- posts[author] after c first 3 by byAuthorAt" },
      { source: "query page(author: principal):\n  return posts[author] first 3 by byAuthorAt by byId\n",
        rewrite: "-- posts[author] first 3 by byAuthorAt" },
    ]) {
      const refused = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: item.source },
      ]);
      const diagnostic = refused.ok ? undefined : refused.diagnostics.find((entry) => entry.code === "E_QUARRY_SYNTAX");
      assert(diagnostic?.rewrite === item.rewrite, `range modifier rewrite changed: ${JSON.stringify(refused)}`);
      const repaired = item.source.replace(item.source.split("\n")[1]!.trim().slice("return ".length), item.rewrite.slice(3));
      const accepted = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: repaired },
      ]);
      assert(accepted.ok, `range modifier rewrite did not bind directly: ${JSON.stringify(accepted)}`);
    }
    const before = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: "query page(author: principal, c: cursor ?):\n  return posts[author] before c last 3 by byAuthorAt\n" },
    ]);
    const diagnostic = before.ok ? undefined : before.diagnostics.find((entry) => entry.code === "E_QUARRY_UNSUPPORTED");
    assert(diagnostic?.site.startsWith("snapback/ops.q:2:") && diagnostic.rewrite.includes("use after c"),
      `before refusal lost its forward rewrite: ${JSON.stringify(before)}`);
  });

  test("direct Quarry cursor indexes and pageable merges require a total id suffix", () => {
    const operations = "query page(c: cursor ?):\n  return posts[] after c first 3 by byAuthorAt\n";
    const schema = "table posts:\n  author: principal\n  at: time\n  by byAuthorAt: author, at\n  public\n";
    const refused = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: operations },
    ]);
    const diagnostic = refused.ok ? undefined : refused.diagnostics.find((entry) => entry.code === "E_QUARRY_TYPE");
    assert(diagnostic?.site.startsWith("snapback/schema.q:") && diagnostic.message.includes("snapback/ops.q:2:")
      && diagnostic.rewrite === "-- by byAuthorAt: author, at, id",
    `cursor total-index refusal changed: ${JSON.stringify(refused)}`);
    if (!diagnostic) throw new Error("cursor total-index refusal had no diagnostic");
    assert(compileInline([
      { fileName: "snapback/schema.q", source: schema.replace("by byAuthorAt: author, at", diagnostic.rewrite.slice(3)) },
      { fileName: "snapback/ops.q", source: operations },
    ]).ok, "total-index cursor rewrite did not bind");

    const merge = compileInline([
      { fileName: "snapback/schema.q", source: "table posts:\n  author: principal\n  kind: text <=20\n  unique byActorKind: author, kind\n  public\n" },
      { fileName: "snapback/ops.q", source: "query feed(c: cursor ?):\n  return merge posts after c first 3 by byActorKind:\n    [viewer]\n" },
    ]);
    const mergeDiagnostic = merge.ok ? undefined : merge.diagnostics.find((entry) => entry.code === "E_QUARRY_TYPE");
    assert(mergeDiagnostic?.site.startsWith("snapback/schema.q:") && mergeDiagnostic.rewrite.includes("author, kind, id"),
      `pageable merge total-index refusal changed: ${JSON.stringify(merge)}`);
  });

  test("direct Quarry alternate-key unreadable updates are NOT_FOUND while direct-id updates are E_RULE", async () => {
    const schema = `table secrets:
  owner: principal
  label: text <=40
  unique byOwner: owner
  read <- .owner = viewer
  insert <- allow
  update <- .owner = viewer
`;
    const operations = `mutation alternate(owner: principal, label: text <=40):
  update secrets[owner] { label }
  return true

mutation direct(id: secrets, label: text <=40):
  update secrets[id] { label }
  return true
`;
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": operations }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `unreadable update pair refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema);
      assert(checked.every((entry) => !entry.error && entry.certificate), `unreadable update pair did not certify: ${JSON.stringify(checked)}`);
      const receipt: ClosureReceipt = {
        rows: [{ table: "secrets", id: "secret-1", row: { Row: {
          id: { Id: "secret-1" }, owner: { Id: "owner-1" }, label: { String: "hidden" },
        } } }], ranges: [], absences: [], verdicts: [],
      };
      const executeCode = (program: Program, args: Context["args"]): string => {
        const context: Context = { viewer: "viewer-1", principal_kind: "user", auth_epoch: 1,
          args, now: 1, new_ids: [], read_time: 1 };
        try {
          new ClientStore(lowered.project.schema, receipt).applyMutation(program, context);
          return "green";
        } catch (error) {
          const refusal = error as { code?: string; authoredCode?: string | null };
          return refusal.authoredCode ? `${refusal.code}:${refusal.authoredCode}` : refusal.code ?? "unknown";
        }
      };
      assert(executeCode(operation(lowered.project.programs, "ops.alternate"), {
        owner: { Id: "owner-1" }, label: { String: "changed" },
      }) === "E_REQUIRE:NOT_FOUND", "alternate-key unreadable update did not return NOT_FOUND");
      assert(executeCode(operation(lowered.project.programs, "ops.direct"), {
        id: { Id: "secret-1" }, label: { String: "changed" },
      }) === "E_RULE", "direct-id unreadable update did not preserve E_RULE");
    });
  });

  test("direct Quarry one-hop ref narrowing is branch-only and symbol-scoped", () => {
    const schema = "table nodes:\n  parent: nodes ?\n  public\n";
    const accepted = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: `fn present(value: nodes) = exists nodes[value]
query good(id: nodes):
  row = nodes[id]! else MISSING
  if row.parent != null:
    return present(row.parent)
  return false
` },
    ]);
    assert(accepted.ok, `one-hop ref did not narrow in its then branch: ${JSON.stringify(accepted)}`);
    for (const [name, body] of [
      ["else", "  if row.parent != null:\n    return true\n  else:\n    return present(row.parent)\n"],
      ["and", "  return row.parent != null and present(row.parent)\n"],
      ["shadow", "  if row.parent != null:\n    row = nodes[other]! else OTHER\n    return present(row.parent)\n  return false\n"],
    ] as const) {
      const args = name === "shadow" ? "id: nodes, other: nodes" : "id: nodes";
      const refused = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: `snapback/${name}.q`, source: `fn present(value: nodes) = exists nodes[value]\nquery bad(${args}):\n  row = nodes[id]! else MISSING\n${body}` },
      ]);
      assert(!refused.ok && refused.diagnostics.some((entry) => entry.code === "E_QUARRY_TYPE"),
        `${name} incorrectly inherited ref narrowing: ${JSON.stringify(refused)}`);
    }
  });

  test("direct Quarry channels bind a typed record and bounded lifetime", () => {
    const result = compileInline([{ fileName: "snapback/schema.q", source: `table rooms:
  public

channel typing(room: rooms, segment: text <=10 ?):
  value: { typing: bool, note: text 1..20 ?, owner: principal, room: rooms, modes: [enum('typing', 'idle')] <=2, amount: decimal 2, extra: json <=100 }
  publish <- allow
  subscribe <- allow
  ttl 30s
` }]);
    assert(result.ok, `typed channel declaration refused: ${JSON.stringify(result)}`);
    deepStrictEqual(JSON.parse(JSON.stringify(result.project.schema.channels.typing)), {
      args: { room: { Ref: { table: "rooms" } }, segment: { Optional: { Text: { max: 10 } } } },
      value: {
        typing: "Bool", note: { Optional: { Text: { max: 20, min: 1 } } }, owner: "Principal",
        room: { Ref: { table: "rooms" } }, modes: { List: { of: { Enum: { variants: ["typing", "idle"] } }, max: 2 } },
        amount: { Decimal: { scale: 2 } }, extra: { Json: { max_bytes: 100 } },
      },
      publish: "Allow", subscribe: "Allow", ttl_ms: 30_000,
    });
    assert(result.project.sources["schema.channels.typing.value.typing"]?.line === 5
      && result.project.sources["schema.channels.typing.publish"]?.line === 6,
    "channel value/rule diagnostics lost their authored source lines");
  });

  test("direct Quarry channels reject missing, duplicate and invalid value declarations", () => {
    const declaration = "table rooms:\n  public\n\nchannel typing():\n  value: { typing: bool }\n  publish <- allow\n  subscribe <- allow\n  ttl 4s\n";
    const variants: Array<[string, string, string]> = [
      ["missing value", declaration.replace("  value: { typing: bool }\n", ""), "requires value"],
      ["empty value", declaration.replace("{ typing: bool }", "{}"), "nonempty record"],
      ["duplicate field", declaration.replace("{ typing: bool }", "{ typing: bool, typing: int }"), "duplicate channel value field"],
      ["empty enum", declaration.replace("typing: bool", "typing: enum()"), "enum variants"],
      ["duplicate enum", declaration.replace("typing: bool", "typing: enum('a', 'a')"), "enum variants"],
      ["unknown ref", declaration.replace("typing: bool", "typing: absent"), "unknown table"],
      ["oversized bound", declaration.replace("typing: bool", "typing: text <=4294967296"), "bounds must"],
      ["empty text bound", declaration.replace("typing: bool", "typing: text <=0"), "bounds must"],
      ["text minimum", declaration.replace("typing: bool", "typing: text 5..4"), "text minimum"],
      ["empty list bound", declaration.replace("typing: bool", "typing: [bool] <=0"), "bounds must"],
      ["empty json bound", declaration.replace("typing: bool", "typing: json <=0"), "bounds must"],
    ];
    for (const property of ["value: { typing: bool }", "publish <- allow", "subscribe <- allow", "ttl 4s"]) {
      variants.push([`duplicate ${property}`, declaration.replace(`  ${property}\n`, `  ${property}\n  ${property}\n`), "duplicate channel property"]);
    }
    for (const kind of ["bytes <=10", "image <=10", "video <=10", "cursor"]) {
      for (const type of [kind, `${kind} ?`, `[${kind}] <=2`, `[[${kind}] <=2] <=2 ?`]) {
        variants.push([type, declaration.replace("typing: bool", `typing: ${type}`), "channel values do not support"]);
      }
    }
    for (const ttl of ["0s", "31s", "999999999999999999s", "1.5s", "1", "1m"]) {
      variants.push([`ttl ${ttl}`, declaration.replace("ttl 4s", `ttl ${ttl}`), ""]);
    }
    variants.push(["missing ttl", declaration.replace("  ttl 4s\n", ""), "requires ttl"]);
    for (const [name, source, message] of variants) {
      const result = compileInline([{ fileName: "snapback/schema.q", source }]);
      assert(!result.ok && result.diagnostics.some(entry => entry.site.startsWith("snapback/schema.q:")
        && entry.message.includes(message) && entry.rewrite.length > 0),
      `${name} was not refused with an authored site and repair: ${JSON.stringify(result)}`);
    }
    const minimum = compileInline([{ fileName: "snapback/schema.q", source: declaration.replace("ttl 4s", "ttl 1s") }]);
    assert(minimum.ok, `minimum channel ttl refused: ${JSON.stringify(minimum)}`);
  });

  test("direct Quarry recovers channel properties per line", () => {
    const result = compileInline([{ fileName: "snapback/schema.q", source: `table rows:
  value: int
  public

channel updates():
  value: { typing: bool }
  broken one
  alsoBroken two
  publish <- public
  subscribe <- public
  ttl 1s
` }]);
    assert(!result.ok && result.diagnostics.filter((entry) => entry.code === "E_QUARRY_SYNTAX"
      && entry.message.includes("unknown channel property")).length === 2,
    `channel recovery stopped before both defects: ${JSON.stringify(result)}`);
  });

  test("direct Quarry where repairs paste into an indexed certified query", async () => {
    const schema = "table posts:\n  author: principal\n  visible: bool\n  at: time\n  by byAuthorAt: author, at, id\n  public\n";
    const read = "posts[author = viewer] after c first 2 by byAuthorAt where true = .visible";
    const source = `query page(c: cursor ?):\n  return ${read}\n`;
    const refused = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/feed.q", source },
    ]);
    const diagnostics = !refused.ok ? refused.diagnostics.filter((entry) => entry.code === "E_QUARRY_UNSUPPORTED") : [];
    const schemaRepair = diagnostics.find((entry) => entry.site.startsWith("snapback/schema.q:"));
    const readRepair = diagnostics.find((entry) => entry.site.startsWith("snapback/feed.q:"));
    assert(schemaRepair?.rewrite === "-- by byAuthorVisibleAt: author, visible, at, id"
      && readRepair?.rewrite === "-- posts[author = viewer, visible = true] after c first 2 by byAuthorVisibleAt",
    `where repairs changed: ${JSON.stringify(refused)}`);
    const repairedSchema = schema.replace("by byAuthorAt: author, at, id", `by byAuthorAt: author, at, id\n  ${schemaRepair.rewrite.slice(3)}`);
    const repairedSource = source.replace(read, readRepair.rewrite.slice(3));
    await withProject({ "snapback/schema.q": repairedSchema, "snapback/feed.q": repairedSource }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `where repairs did not bind: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      assert(rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).every((entry) => !entry.error),
        "where repairs did not certify");
    });
  });

  test("direct Quarry mutually exclusive writes retain a one-row certified bound", async () => {
    await withProject({
      "snapback/schema.q": "table counters:\n  owner: principal\n  value: int\n  insert <- .owner = viewer\n",
      "snapback/counters.q": `mutation branchWrite(useFirst: bool):
  if useFirst:
    insert counters { owner: viewer, value: 1 }
  else:
    insert counters { owner: viewer, value: 2 }
  return null
`,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, "branch-write fixture refused");
      const checked = rustCheck([operation(lowered.project.programs, "counters.branchWrite")], "synthetic", lowered.project.schema)[0]!;
      const sites = checked.certificate?.write_sites as Array<{ table: string; max_rows: number }> | undefined;
      assert(!checked.error && sites?.some((site) => site.table === "counters" && site.max_rows === 1),
        `mutually exclusive branch bound changed: ${JSON.stringify(checked)}`);
    });
  });
}
