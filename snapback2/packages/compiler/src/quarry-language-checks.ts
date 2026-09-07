import { deepStrictEqual, throws } from "node:assert";
import { canonicalValue, ClientStore, type Context, type Value } from "../../evaluator/src/evaluator";
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
async function project(source: string, run: (result: Extract<Awaited<ReturnType<typeof lowerProject>>, { ok: true }>, checked: ReturnType<typeof rustCheck>) => void, declarations = schema) {
  await withProject({ "snapback/schema.q": declarations, "snapback/probe.q": source }, async (root) => {
    const lowered = await lowerProject(root);
    assert(lowered.ok, lowered.ok ? "" : diagnosticsText(lowered.diagnostics));
    const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema);
    assert(checked.every((item) => !item.error), JSON.stringify(checked));
    run(lowered, checked);
  });
}
function refusal(source: string, text: string, declarations = schema) {
  const result = compile(source, declarations);
  assert(!result.ok && result.diagnostics.some((d) => `${d.message} ${d.rewrite}`.includes(text)), JSON.stringify(result));
}

export function registerQuarryLanguageChecks(test: Test, frontend: string): void {
  test("connected refuses Quarry maintains and table rules with a site and rewrite", () => {
    for (const declarations of [
      schema + "\nmaintain counts = count connected by principal:\n  read <- allow\n",
      "use identity\ntable notes:\n  body: text <=100\n  read <- exists connected[viewer]\n",
    ]) {
      const result = compile("query ok():\n  return true\n", declarations);
      assert(!result.ok, "connected admitted a nonprogram surface");
      if (!result.ok) assert(result.diagnostics.some(item =>
        /^snapback\/schema\.q:[1-9][0-9]*:[1-9][0-9]*$/.test(item.site ?? "")
        && item.rewrite?.includes("query") && !!item.family && !!item.guide), diagnosticsText(result.diagnostics));
    }
  });
  for (const probe of ["exists connected[viewer]", "created connected[viewer]", "exists connected[.owner]", "created connected[principal = .owner]"]) {
    test(`connected rule refusal preserves ${probe}`, () => {
      const result = compile("query ok():\n  return true\n",
        `use identity\ntable notes:\n  owner: principal\n  read <- ${probe}\n`);
      assert(!result.ok, "connected admitted a table rule");
      const refusal = result.diagnostics.find(item => item.message === "connected is only readable in queries and mutations, not rules");
      assert(refusal?.site === "snapback/schema.q:4:11" && refusal.family === "quarry" && refusal.guide === "quarry/names",
        JSON.stringify(result.diagnostics));
      deepStrictEqual(refusal.rewrite, `-- move ${probe} into a query or mutation; keep table rules based on durable facts`);
    });
  }
  test("connected certifies one probe per principal read and refuses nonprogram surfaces", async () => {
    await project("query count(p: principal):\n  return #connected[p]\nquery online():\n  return exists connected[viewer]\nmutation gate(p: principal):\n  require exists connected[p] else OFFLINE\n  return #connected[p]\n", result => {
      assert(!("connected" in result.project.schema.tables) && !("_connected" in result.project.schema.tables), "virtual table leaked into durable schema");
      const checked = rustCheck(result.project.programs, "synthetic", result.project.schema);
      for (const item of checked) {
        const certificate = item.certificate as any;
        assert(certificate.max_rule_probes === (certificate.program.endsWith("gate") ? 2 : 1), JSON.stringify(item));
        assert(certificate.read_sites.every((site: any) => site.table === "_connected" && site.index === "byPrincipal"), JSON.stringify(item));
      }
    });
    for (const key of ["'alice'", "1", "null", "", "viewer, viewer"]) {
      const result = compile(`query bad():\n  return #connected[${key}]\n`);
      assert(!result.ok, `connected admitted key ${key}`);
    }
    for (const arg of ["p: id", "p: posts", "p: principal ?"]) {
      assert(!compile(`query bad(${arg}):\n  return exists connected[p]\n`).ok, `connected admitted ${arg}`);
    }
    for (const source of [
      "query bad():\n  return connected[viewer]\n",
      "query bad():\n  return connected[] first 10\n",
      "mutation bad():\n  insert connected { principal: viewer, value: 1 }\n",
    ]) assert(!compile(source).ok, `connected admitted ${source}`);
    assert(!compile("query ok():\n  return true\n", schema + "\ntable connected:\n  value: int\n").ok, "connected was redeclared");
  });
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
    for (const expr of ["divmod(1, now)", "divmod(now, now)"]) {
      refusal(`query probe():\n  return ${expr}\n`, "divmod's divisor must be an int");
    }
    refusal("query probe(t: time ?):\n  return divmod(t, 1)\n", "use a present int, time, decimal, or money numerator");
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
  test("Quarry null cap probes remain true after the twin refuses a third omitted-parent row", async () => {
    const declarations = schema + `
table buckets:
  parent: posts ?
  by byParent: parent
  cap 2 by parent
  public
  insert <- allow
`;
    await project(`mutation insertBucket():
  insert buckets { id: new }
  return true
query probe():
  return exists buckets[null]
`, (lowered) => {
      const store = new ClientStore(lowered.project.schema, { ...empty, rows: ["one", "two"].map(value =>
        ({ table: "buckets", id: value, row: row({ id: id(value) }) })) });
      throws(() => store.reexecute(operation(lowered.project.programs, "probe.insertBucket"), { ...context, new_ids: ["three"] }),
        /E_CONSTRAINT: buckets cap 2 reached for group \(parent\) = \{"Array":\["Null"\]\}/);
      equal(store.reexecute(operation(lowered.project.programs, "probe.probe"), context).execution.result, { Bool: true });
    }, declarations);
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
    await project(`mutation probe(id: posts, copy: posts):
  p = posts[id]!
  update posts[p] { parentAuthor: posts[p.parent].author ?? viewer }
  upsert posts[copy] { author: viewer, at: now, parentAuthor: posts[p.parent].author ?? viewer }
  return true
`, (lowered) => {
      for (const present of [false, true]) {
        const receipt = { ...empty, rows: [
          { table: "posts", id: "p", row: row({ id: id("p"), author: id("alice"), at: { Int: 0 }, ...(present ? { parent: id("parent") } : {}) }) },
          { table: "posts", id: "parent", row: row({ id: id("parent"), author: id("bob"), at: { Int: 0 } }) },
          { table: "posts", id: "copy", row: row({ id: id("copy"), author: id("alice"), at: { Int: 0 } }) },
        ] };
        const result = new ClientStore(lowered.project.schema, receipt).reexecute(lowered.project.programs[0]!, { ...context, args: { id: id("p"), copy: id("copy") } }).execution;
        equal(result.result, { Bool: true });
        assert(result.writes.length === 2, JSON.stringify(result));
        for (const write of result.writes) {
          assert(write.row && typeof write.row === "object" && "Row" in write.row, JSON.stringify(write));
          equal(write.row.Row.parentAuthor!, id(present ? "bob" : "alice"));
        }
      }
    }, schema.replace("  at: time", "  parentAuthor: principal ?\n  at: time").replace(/\nmaintain replyCounts[^]*$/, "\n"));
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
    const tuple = compile("query probe(a: int, b: int):\n  (q, r, extra) = divmod(a, b)\n  return q\n");
    assert(!tuple.ok && tuple.diagnostics[0]!.rewrite === "(q, r) = divmod(a, b)", JSON.stringify(tuple));
    await project(`query probe(a: int, b: int):\n  ${tuple.diagnostics[0]!.rewrite}\n  return q\n`, () => {});
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
    assert(guidance.startsWith("-- "), guidance);
    assert(guidance.includes("settings.byId (id: reference to settings)") && guidance.includes("settings.byKey (key: text <=20)"), guidance);
    const wrong = compile("query probe(p: posts):\n  return settings[id = p]\n");
    assert(!wrong.ok && wrong.diagnostics[0]!.rewrite.includes("reference to settings; received reference to posts"), JSON.stringify(wrong));
    assert(wrong.diagnostics[0]!.rewrite.startsWith("-- "), JSON.stringify(wrong));
    const repair = compile("query probe(key: text <=20):\n  return settings[id = key]\n");
    assert(!repair.ok && repair.diagnostics[0]!.rewrite === "settings[key = key]", JSON.stringify(repair));
    assert(JSON.stringify(repair.diagnostics[0]) === '{"code":"E_QUARRY_UNKNOWN","family":"quarry","message":"settings.byId expects reference to settings for id, got text <=20","site":"snapback/probe.q:2:24","rewrite":"settings[key = key]","guide":"quarry/names"}', JSON.stringify(repair));
    await project(`query probe(key: text <=20):\n  return ${repair.diagnostics[0]!.rewrite}\n`, () => {});
    // Non-empty strings are legal Id literals (F6-C); this spelling cannot truthfully refuse.
    await project("query probe():\n  return settings[id = 'windows']\n", () => {});
    const literal = compile("query probe():\n  return settings[id = '']\n");
    assert(!literal.ok && literal.diagnostics[0]!.rewrite === 'settings[key = ""]', JSON.stringify(literal));
    await project(`query probe():\n  return ${literal.diagnostics[0]!.rewrite}\n`, () => {});
  });
  test("Unexpected Quarry failures preserve the caught message as guidance", () => {
    const stringify = JSON.stringify;
    for (const failure of [new Error("cannot print fixture literal"), "cannot print fixture literal"]) {
      let result: ReturnType<typeof compile>;
      try {
        JSON.stringify = ((value: unknown, ...rest: any[]) => {
          if (value === "caught-path") throw failure;
          return (stringify as any)(value, ...rest);
        }) as typeof JSON.stringify;
        result = compile("query probe():\n  return 'caught-path'\n");
      } finally { JSON.stringify = stringify; }
      assert(!result.ok && result.diagnostics[0]!.message === "cannot print fixture literal"
        && result.diagnostics[0]!.rewrite === "-- cannot print fixture literal", JSON.stringify(result));
    }
  });
  test("Schedule arguments preserve generic ids while rejecting a different nominal table", async () => {
    const declarations = schema.replace("  at: time", "  other: settings\n  expiresAt: time ?\n  at: time");
    await project(`mutation receive(post: id, other: id):
  return true
schedule expire on posts at .expiresAt: receive(.id, .other)
`, () => {}, declarations);
    refusal(`mutation receive(post: posts):
  return true
schedule expire on posts at .expiresAt: receive(.other)
`, "does not satisfy target ref", declarations);
  });
  test("Quarry merge Id literal prefixes accept positional and named keys, refusing computed text", async () => {
    const declarations = schema.replace("  by byAuthor:", "  by byParent: parent, id\n  by byAuthor:");
    for (const prefix of ["'post'", "parent = 'post'"]) {
      await project(`query probe():\n  return merge posts first 10 by byParent:\n    [${prefix}]\n`, (lowered, checked) => {
        const post = row({ id: id("reply"), author: id("alice"), at: { Int: 0 }, parent: id("post"), tags: "Null" });
        const result = new ClientStore(lowered.project.schema, { ...empty, rows: [{ table: "posts", id: "reply", row: post }] })
          .reexecute(lowered.project.programs[0]!, context, checked[0]!.certificate).execution;
        equal(result.result, { Array: [post] });
      }, declarations);
    }
    for (const prefix of ["text", "parent = text"]) {
      refusal(`query probe(text: text <=20):\n  return merge posts first 10 by byParent:\n    [${prefix}]\n`, "posts.byParent.parent", declarations);
    }
    refusal("query probe():\n  return merge posts first 10 by byParent:\n    [author = 'post']\n", "expects parent", declarations);
    refusal("query probe():\n  return merge posts first 10 by byAuthor:\n    [author = viewer, now]\n", "cannot mix named and positional", declarations);
  });
  test("Quarry optional list domains refuse before an omitted column can reach array execution", async () => {
    for (const domain of ["p.tags", "alias"]) {
      const source = `query probe(id: posts):\n  p = posts[id]!\n  alias = p.tags\n  for t in ${domain}:\n    require t != '' else EMPTY\n  return true\n`;
      const refused = compile(source);
      assert(!refused.ok, "unguarded optional list compiled");
      const diagnostic = refused.diagnostics[0]!;
      assert(diagnostic.message.includes("optional list") && diagnostic.rewrite.endsWith(" ?? []") && !diagnostic.rewrite.startsWith("-- "), JSON.stringify(diagnostic));
      await project(source.replace(`in ${domain}:`, `in ${diagnostic.rewrite}:`), (lowered) => {
        const post = row({ id: id("p"), author: id("alice"), at: { Int: 0 } });
        const result = new ClientStore(lowered.project.schema, { ...empty, rows: [{ table: "posts", id: "p", row: post }] })
          .reexecute(lowered.project.programs[0]!, { ...context, args: { id: id("p") } }).execution;
        equal(result.result, { Bool: true });
      });
    }
  });
  test("Argument list domains retain ArgList identity while column defaults carry max 8", async () => {
    await project(`query probe(tags: [text 1..32] <=8, id: posts):
  for t in tags:
    require t != '' else EMPTY
  p = posts[id]!
  for t in p.tags ?? []:
    require t != '' else EMPTY
  return true
`, (lowered) => {
      const domains = lowered.project.programs[0]!.body.flatMap(stmt => typeof stmt === "object" && "For" in stmt ? [stmt.For.domain] : []);
      deepStrictEqual(domains[0], { ArgList: { name: "tags", max: 8 } });
      assert(domains[1] && "DerivedArray" in domains[1] && domains[1].DerivedArray.max === 8, JSON.stringify(domains));
    });
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
