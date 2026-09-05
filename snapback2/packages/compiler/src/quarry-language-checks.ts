import { deepStrictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalValue, ClientStore, type Context, type Value } from "../../evaluator/src/evaluator";
import { lowerSource } from "./compiler";
import { lowerProject } from "./project";
import { rustCheck } from "./rust-check";
import { assert, compileInline, diagnosticsText, operation, withProject, type Test } from "./quarry-check-helpers";

const schema = `use identity password

table settings:
  key: text <=20
  n: int
  unique byKey: key
  read <- allow
  insert <- deny
  update <- deny
  delete <- deny

table posts:
  author: principal
  parent: posts ?
  tags: [text 1..32] <=8 ?
  at: time
  by byAuthor: author, at, id
  public
  insert <- .author = viewer
  update <- .author = viewer
  delete <- deny

maintain replyCounts = count posts by parent:
  read <- allow
`;
const context: Context = { viewer: "alice", principal_kind: "user", auth_epoch: 1,
  args: {}, now: 172800007, read_time: 172800007, new_ids: [] };
const empty = { rows: [], ranges: [], absences: [], verdicts: [] };
const row = (fields: Record<string, Value>): Value => ({ Row: fields });
const equal = (a: Value, b: Value) => deepStrictEqual(canonicalValue(a), canonicalValue(b));
const id = (value: string): Value => ({ Id: value });

function compile(source: string, declarations = schema) {
  return compileInline([{ fileName: "snapback/schema.q", source: declarations }, { fileName: "snapback/probe.q", source }]);
}
async function project(source: string, run: (result: Extract<Awaited<ReturnType<typeof lowerProject>>, { ok: true }>) => void, declarations = schema) {
  await withProject({ "snapback/schema.q": declarations, "snapback/probe.q": source }, async (root) => {
    const lowered = await lowerProject(root);
    assert(lowered.ok, lowered.ok ? "" : diagnosticsText(lowered.diagnostics));
    const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema);
    assert(checked.every((item) => !item.error), JSON.stringify(checked));
    run(lowered);
  });
}
function refusal(source: string, text: string, declarations = schema) {
  const result = compile(source, declarations);
  assert(!result.ok && result.diagnostics.some((d) => `${d.message} ${d.rewrite}`.includes(text)), JSON.stringify(result));
}

export function registerQuarryLanguageChecks(test: Test, frontend: string): void {
  test("Quarry time difference and epoch divmod have integer parts", async () => {
    await project(`query probe(t: time):
  elapsed = divmod(now - t, 86400000)
  epoch = divmod(0 + now, 86400000)
  return { elapsed, epoch, later: now + 10, earlier: now - 10, symmetric: 10 + now, ordered: now >= t }
`, (lowered) => {
      const result = new ClientStore(lowered.project.schema, empty).reexecute(lowered.project.programs[0]!, {
        ...context, args: { t: { Int: 86400000 } },
      }).execution;
      equal(result.result, row({ elapsed: row({ quotient: { Int: 1 }, remainder: { Int: 7 }, sink: { String: "lexicographic-id" } }),
        epoch: row({ quotient: { Int: 2 }, remainder: { Int: 7 }, sink: { String: "lexicographic-id" } }), later: { Int: 172800017 }, earlier: { Int: 172799997 },
        symmetric: { Int: 172800017 }, ordered: { Bool: true } }));
    });
  });
  test("Quarry time arithmetic refuses undefined and absent operands with the rule", () => {
    for (const expr of ["now + now", "now * now", "now / 2", "now % 2", "2 / now", "2 - now", "now * 2", "now + 0.5", "maybe - now"]) {
      refusal(`query probe(maybe: time ?):\n  return ${expr}\n`, "time - time yields int milliseconds");
    }
    // The old 0 + time result must no longer masquerade as int.
    refusal("query probe():\n  return divmod(10, 0 + now)\n", "divmod's divisor must be an int");
  });
  test("Quarry null selects optional maintained, point, exists, rule and cap keys", async () => {
    const declarations = schema + `
table buckets:
  parent: posts ?
  unique byParent: parent
  cap 2 by parent
  public
  insert <- exists replyCounts[null]
`;
    await project(`query probe(parent: posts ?):
  return { literal: #replyCounts[null], typed: #replyCounts[parent], named: #replyCounts[parent = null],
    found: exists buckets[null], bucket: buckets[parent = null] }
`, (lowered) => {
      const program = lowered.project.programs[0]!;
      assert(JSON.stringify(program).includes('"Literal":"Null"'), "null did not reach the IR key");
      const receipt = { ...empty, rows: [
        { table: "replyCounts", id: "[null]", row: row({ id: id("[null]"), parent: "Null", value: { Int: 2 } }) },
        { table: "buckets", id: "b", row: row({ id: id("b"), parent: "Null" }) },
      ] };
      const result = new ClientStore(lowered.project.schema, receipt).reexecute(program, { ...context, args: { parent: "Null" } }).execution;
      equal(result.result, row({ literal: { Int: 2 }, typed: { Int: 2 }, named: { Int: 2 }, found: { Bool: true }, bucket: receipt.rows[1]!.row }));
    }, declarations);
    for (const expr of ["settings[id = null]", "settings[null]", "exists settings[key = null]"]) {
      refusal(`query probe():\n  return ${expr}\n`, "required");
    }
  });
  test("Quarry null equality in write objects is not a required Id sink", async () => {
    await project(`mutation probe(parent: posts ?):
  insert posts { id: new, author: viewer, parent, at: now, original: parent = null }
  return true
`, () => {}, schema.replace("  at: time", "  original: bool\n  at: time"));
  });
  test("Quarry optional access lowers in nested objects, comparisons, defaults and calls", async () => {
    await project(`query probe():
  return { nested: { n: max(settings[key = 'windows'].n ?? 0, 1), same: settings[key = 'windows'].n = 3 } }
`, (lowered) => {
      const result = new ClientStore(lowered.project.schema, { ...empty, rows: [
        { table: "settings", id: "s", row: row({ id: id("s"), key: { String: "windows" }, n: { Int: 3 } }) },
      ] }).reexecute(lowered.project.programs[0]!, context).execution;
      equal(result.result, row({ nested: row({ n: { Int: 3 }, same: { Bool: true } }) }));
    });
  });
  test("Quarry optional access lowers in update patches without a coalesce workaround", async () => {
    await project(`mutation probe(p: posts):
  update posts[p] { parentAuthor: posts[p].author }
  return true
`, (lowered) => {
      const receipt = { ...empty, rows: [{ table: "posts", id: "p", row: row({ id: id("p"), author: id("alice"), at: { Int: 0 } }) }] };
      const store = new ClientStore(lowered.project.schema, receipt);
      const result = store.reexecute(lowered.project.programs[0]!, { ...context, args: { p: id("p") } }).execution;
      assert(result.writes.some((write) => write.row && typeof write.row === "object" && "Row" in write.row && JSON.stringify(write.row.Row.parentAuthor) === JSON.stringify(id("alice"))), JSON.stringify(result));
    }, schema.replace("  at: time", "  parentAuthor: principal ?\n  at: time"));
  });
  test("Optional call operands evaluate a clock base once inside the original branch", () => {
    const lib = readFileSync(resolve(frontend, "subset-lib.d.ts"), "utf8") + readFileSync(resolve(frontend, "lib.d.ts"), "utf8");
    const source = `import { query, max, t } from "snapback2";
export const probe = query({ yes: t.bool() }, ({ ctx, args }) => {
  return args.yes ? { nested: { at: max(({ at: ctx.now() })?.at ?? 0, 1) } } : null;
});`;
    const lowered = lowerSource(source, "probe.ts", lib);
    assert(lowered.ok, JSON.stringify(lowered));
    const program = lowered.programs[0]!;
    const ir = JSON.stringify(program.body);
    assert(ir.split('"Input":"ReadTime"').length - 1 === 1, ir);
    const store = new ClientStore({ tables: {}, maintains: [] }, empty);
    const skipped = store.reexecute(program, { ...context, args: { yes: { Bool: false } }, read_time: null }).execution;
    equal(skipped.result, "Null");
    equal(store.reexecute(program, { ...context, args: { yes: { Bool: true } } }).execution.result,
      row({ nested: row({ at: { Int: 172800007 } }) }));
  });
  test("Quarry divmod tuple binds once and preserves decimal and money parts", async () => {
    await project(`query probe(amount: money USD, dec: decimal 2):
  (q, r) = divmod(now, 86400000)
  (mq, mr) = divmod(amount, 2)
  (dq, dr) = divmod(dec, 3)
  return { q, r, money: mq + mr, decimal: dq + dr }
`, (lowered) => {
      const result = new ClientStore(lowered.project.schema, empty).reexecute(lowered.project.programs[0]!, {
        ...context, args: { amount: { Int: 501 }, dec: { Int: 100 } },
      }).execution;
      equal(result.result, row({ q: { Int: 2 }, r: { Int: 7 }, money: { Int: 251 }, decimal: { Int: 34 } }));
      assert(JSON.stringify(lowered.project.programs[0]).split('"Divmod"').length - 1 === 3, "tuple duplicated divmod");
    });
    refusal("query probe():\n  (a, b) = min(1, 2)\n  return a\n", "sorted(a, b) or divmod(a, b)");
    refusal("query probe():\n  (a, b, c) = divmod(1, 2)\n  return a\n", "exactly two names");
  });
  test("Quarry non-empty Id literals work in named and positional keys, equality and fallback", async () => {
    await project(`query probe(p: posts ?):
  fallback = p ?? 'post'
  return { named: posts[id = 'post'], positional: posts['post'], exists: exists posts[id = 'post'], equal: p = 'post', reverse: 'post' = p, fallback }
`, (lowered) => {
      const post = row({ id: id("post"), author: id("alice"), at: { Int: 1 }, parent: "Null", tags: "Null" });
      const store = new ClientStore(lowered.project.schema, { ...empty, rows: [{ table: "posts", id: "post", row: post }] });
      equal(store.reexecute(lowered.project.programs[0]!, { ...context, args: { p: id("post") } }).execution.result,
        row({ named: post, positional: post, exists: { Bool: true }, equal: { Bool: true }, reverse: { Bool: true }, fallback: id("post") }));
      equal(store.reexecute(lowered.project.programs[0]!, { ...context, args: { p: "Null" } }).execution.result,
        row({ named: post, positional: post, exists: { Bool: true }, equal: { Bool: false }, reverse: { Bool: false }, fallback: id("post") }));
    });
  });
  test("Quarry Id positions refuse empty literals, computed text and other-table references", () => {
    for (const expression of ["posts[id = '']", "posts[id = text]", "posts[id = other]", "p = text", "p = other", "p = ''", "p ?? text", "p ?? other", "p ?? ''"]) {
      const result = compile(`query probe(p: posts ?, other: settings, text: text <=20):\n  return ${expression}\n`);
      assert(!result.ok, `${expression} unexpectedly compiled`);
    }
    // Opaque cursors replaced tuple cursors in LLP 1011; a plain Id literal is not a token.
    refusal("query probe():\n  return posts[] after 'post' first 1 by byAuthor\n", "after expects a cursor");
  });
  test("Quarry naming rewrites contain catalog types and preserve a concrete repair", async () => {
    const noMatch = compile("query probe():\n  return settings[viewer]\n");
    assert(!noMatch.ok, "missing index accepted");
    const guidance = noMatch.diagnostics[0]!.rewrite;
    assert(guidance.includes("settings.byId (id: reference to settings)") && guidance.includes("settings.byKey (key: text <=20)"), guidance);
    const wrong = compile("query probe(p: posts):\n  return settings[id = p]\n");
    assert(!wrong.ok && wrong.diagnostics[0]!.rewrite.includes("reference to settings; received reference to posts"), JSON.stringify(wrong));
    const repair = compile("query probe(key: text <=20):\n  return settings[id = key]\n");
    assert(!repair.ok && repair.diagnostics[0]!.rewrite === "settings[key = key]", JSON.stringify(repair));
    await project(`query probe(key: text <=20):\n  return ${repair.diagnostics[0]!.rewrite}\n`, () => {});
  });
  test("Quarry bounded list columns survive aliases, optional narrowing, coalescing and nested shapes", async () => {
    await project(`shape tagsCard = { nested: { tags: .tags } }
query optional(id: posts):
  p = posts[id]!
  alias = p.tags
  for tag in alias ?? []:
    require tag != '' else EMPTY
  if p.tags != null:
    for tag in p.tags:
      require tag != '' else EMPTY
  shaped = p tagsCard
  for tag in shaped.nested.tags ?? []:
    require tag != '' else EMPTY
  return true
query required(id: posts):
  p = posts[id]!
  for tag in p.requiredTags:
    require tag != '' else EMPTY
  return true
`, (lowered) => {
      for (const present of [false, true]) {
        const post = row({ id: id("p"), author: id("alice"), at: { Int: 0 }, requiredTags: { Array: [{ String: "one" }] },
          ...(present ? { tags: { Array: [{ String: "two" }] } as Value } : {}) });
        const store = new ClientStore(lowered.project.schema, { ...empty, rows: [{ table: "posts", id: "p", row: post }] });
        for (const program of lowered.project.programs) {
          const execution = store.reexecute(program, { ...context, args: { id: id("p") } }).execution;
          equal(execution.result, { Bool: true });
        }
      }
      const ir = JSON.stringify(lowered.project.programs);
      assert(ir.split('"max":8').length - 1 >= 4, ir);
    }, schema.replace("  at: time", "  requiredTags: [text 1..32] <=8\n  at: time"));
  });
  test("Quarry json lists still lack a static cardinality", async () => {
    await withProject({ "snapback/schema.q": schema.replace("  at: time", "  payload: json <=1000\n  at: time"),
      "snapback/probe.q": "query probe(id: posts):\n  p = posts[id]!\n  for tag in p.payload.tags:\n    value = tag\n  return true\n" }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics.some((d) => d.code === "E_UNBOUND_LOOP"), JSON.stringify(result));
    });
  });
}
