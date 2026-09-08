import { deepStrictEqual, throws } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
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
  test("one spelling: significant Quarry words are frozen", () => {
    // One pin, derived on the other side from the actual lexer/parser/binder decisions.
    const expected = `
after allow and at before bool by byId byPrincipal bytes cap channel channels chunk commit connected
count created cursor d decimal delete delivered-history deny depth device divmod duration effect
else emit enum every exists false first fn for format from guests h handle height id identity if
image immutable in index insert int job json last length m maintain max merge min money mutation new
not now null oblivious of on once op or password principal proc public publish query quotient range
read readable remainder require retain return s schedule shape share sorted subscribe sum system
table text then time toJSON tokens tombstones true ttl unique until-revoked up update upsert url use
value video viewer walk where while width wordPrefixes words
`.split(/\s+/).filter(Boolean);
    deepStrictEqual(recognizedQuarryWords(frontend), expected);
  });
  // @ref LLP 1011#one-spelling — the commissioned spelling changes and their refusal repairs.
  test("one spelling: indexes require explicit names and pasteable inferred-name repairs", () => {
    for (const [authored, rewrite] of [
      ["by author", "by byAuthor: author"],
      ["unique author, at", "unique byAuthorAt: author, at"],
      ["by author, wordPrefixes(body), at", "by byAuthorWordPrefixesBodyAt: author, wordPrefixes(body), at"],
    ]) {
      const declarations = `table rows:\n  author: principal\n  body: text <=100\n  at: time\n  ${authored}\n  public\n`;
      const result = compile("query probe():\n  return true\n", declarations);
      assert(!result.ok, `${authored} admitted an unnamed index`);
      const diagnostic = result.diagnostics.find(d => d.message === "index declarations require an explicit name");
      assert(diagnostic?.code === "E_QUARRY_SYNTAX" && diagnostic.site === "snapback/schema.q:5:3"
        && diagnostic.family === "quarry" && diagnostic.guide === "quarry/grammar", JSON.stringify(result));
      deepStrictEqual(diagnostic.rewrite, rewrite);
      assert(compile("query probe():\n  return true\n", declarations.replace(authored!, rewrite!)).ok, `${rewrite} did not compile`);
    }
  });
  test("one spelling: bare assertions, match and hash reads refuse", () => {
    for (const source of [
      "query probe():\n  return posts['p']!\n",
      "query probe():\n  match posts['p']:\n    some p:\n      return p\n    none:\n      return null\n",
      "query probe():\n  return #replyCounts[null]\n",
      "query probe():\n  return #connected[viewer]\n",
    ]) {
      const result = compile(source);
      assert(!result.ok && result.diagnostics.some(d => d.code === "E_QUARRY_SYNTAX"), JSON.stringify(result));
      if (source.includes("!")) {
        const assertion = result.diagnostics.find(d => d.message === "presence assertions require a refusal code");
        assert(assertion?.rewrite === "! else CODE", JSON.stringify(result));
        assert(compile(source.replace("!", "! else MISSING_POST")).ok, "named assertion refused");
      }
    }
  });
  test("one spelling: if-null else narrows names and one-hop fields", async () => {
    await project(`query scalar(x: int ?):
  if x = null:
    return false
  else:
    return x > 0
query field(p: posts):
  x = posts[p] ! else MISSING
  if x.parent = null:
    return false
  else:
    return exists posts[x.parent]
`, lowered => {
      for (const [x, expected] of [["Null", false], [{ Int: 2 }, true]] as const) {
        const result = new ClientStore(lowered.project.schema, empty).reexecute(
          operation(lowered.project.programs, "probe.scalar"), { ...context, args: { x } }).execution;
        equal(result.result, { Bool: expected });
      }
    });
  });
  test("one spelling: and narrows the right operand and skips its reads and assertion preludes", async () => {
    await project(`query probe(x: int ?, p: posts):
  return x != null and x > 0 and (posts[p] ! else MISSING_POST).at > now
query field(p: posts):
  x = posts[p] ! else MISSING
  return x.parent != null and exists posts[x.parent]
query body(p: posts):
  x = posts[p]
  return x != null and x.at > now
`, lowered => {
      const program = operation(lowered.project.programs, "probe.probe");
      const receipt = { ...empty, absences: [["posts", "byId", [id("missing")]]] } as any;
      for (const x of ["Null", { Int: -1 }] as Value[]) {
        const result = new ClientStore(lowered.project.schema, receipt).reexecute(program, {
          ...context, args: { x, p: id("missing") },
        }).execution;
        equal(result.result, { Bool: false });
        assert(result.trace.points.length === 0 && result.trace.absences.length === 0, "unreached right-hand point read was evaluated");
      }
      throws(() => new ClientStore(lowered.project.schema, receipt).reexecute(program, {
        ...context, args: { x: { Int: 1 }, p: id("missing") },
      }), (error: any) => error.authoredCode === "MISSING_POST");
    });
  });
  test("one spelling: require narrows the rest of its block without leaking to siblings or shadows", async () => {
    await project(`query scalar(x: int ?):
  require x != null else MISSING
  return x > 0
query field(p: posts):
  x = posts[p] ! else MISSING
  require x.parent != null else ROOT
  return exists posts[x.parent]
`, lowered => {
      for (const [x, code] of [["Null", "MISSING"], [{ Int: 2 }, undefined]] as const) {
        const execute = () => new ClientStore(lowered.project.schema, empty).reexecute(
          operation(lowered.project.programs, "probe.scalar"), { ...context, args: { x } }).execution;
        if (code) throws(execute, (error: any) => error.authoredCode === code);
        else equal(execute().result, { Bool: true });
      }
    });
    for (const body of [
      "  return x > 0\n",
      "  return x != null or x > 0\n",
      "  if x != null:\n    return true\n  else:\n    return x > 0\n",
      "  if flag:\n    require x != null else MISSING\n  return x > 0\n",
      "  require x != null else MISSING\n  if flag:\n    x = y\n    return x > 0\n  return false\n",
    ]) refusal(`query probe(x: int ?, y: int ?, flag: bool):\n${body}`, "ordered comparison > requires present operands");
  });
  test("one spelling: maintain point reads type as values and keep numeric brands", async () => {
    const declarations = `table ledger:
  owner: principal
  amount: money USD 2
  decimal: decimal 3
  value: int
  public
  insert <- allow
maintain counts = count ledger by owner:
  read <- allow
maintain balances = sum ledger of amount by owner:
  read <- allow
maintain decimals = sum ledger of decimal by owner:
  read <- allow
`;
    await project(`query values():
  return { count: counts[viewer], money: balances[viewer], decimal: decimals[viewer] }
query online():
  return connected[viewer]
query ordinary(p: ledger):
  return ledger[p]
mutation afterWrite():
  before = counts[viewer]
  insert ledger { owner: viewer, amount: 2.50, decimal: 1.125, value: 9 }
  return { before, after: counts[viewer], money: balances[viewer], decimal: decimals[viewer] }
`, lowered => {
      assert(lowered.apiDts.includes('count: number; money: Money<"USD", 2>; decimal: Decimal<3>'), lowered.apiDts);
      assert(lowered.apiDts.includes('online: Op<{}, number>'), lowered.apiDts);
      assert(lowered.apiDts.includes('LedgerRow | null'), "ordinary row with a value column became an aggregate");
      assert(!/Op<[^\n]*CountsRow/.test(lowered.apiDts), lowered.apiDts);
      const receipt = { ...empty, absences: [
        ["counts", "byOwner", [id("alice")]], ["balances", "byOwner", [id("alice")]],
        ["decimals", "byOwner", [id("alice")]], ["_connected", "byPrincipal", [id("alice")]],
      ] } as any;
      const value = new ClientStore(lowered.project.schema, receipt).reexecute(
        operation(lowered.project.programs, "probe.values"), context).execution;
      equal(value.result, row({ count: { Int: 0 }, money: { Int: 0 }, decimal: { Int: 0 } }));
    }, declarations);
  });
  test("one spelling: compiler maintain query and mutation agree with engine and twin corpus values", async () => {
    const declarations = `table ledger:
  owner: principal
  public 'maintain value corpus'
  insert <- allow
maintain counts = count ledger by owner:
  read <- allow
`;
    await project(`query values(other: counts):
  return { present: counts[viewer], absent: counts[other] }
mutation afterWrite(other: counts):
  insert ledger { id: new, owner: viewer }
  return { present: counts[viewer], absent: counts[other] }
`, lowered => {
      for (const [caseName, op] of [["maintain-value-query", "values"], ["maintain-value-after-write", "afterWrite"]]) {
        const corpus = JSON.parse(readFileSync(join(frontend, "../../corpus", `${caseName}.json`), "utf8"));
        const store = new ClientStore(lowered.project.schema, corpus.receipt);
        const program = operation(lowered.project.programs, `probe.${op}`);
        const result = op === "afterWrite" ? store.applyMutation(program, corpus.context) : store.reexecute(program, corpus.context);
        deepStrictEqual(result.state, corpus.expected.localState);
        equal(result.execution.result, corpus.expected.localResult);
      }
    }, declarations);
  });
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
    await project("query count(p: principal):\n  return connected[p]\nquery online():\n  return exists connected[viewer]\nmutation gate(p: principal):\n  require exists connected[p] else OFFLINE\n  return connected[p]\n", result => {
      assert(!("connected" in result.project.schema.tables) && !("_connected" in result.project.schema.tables), "virtual table leaked into durable schema");
      const checked = rustCheck(result.project.programs, "synthetic", result.project.schema);
      for (const item of checked) {
        const certificate = item.certificate as any;
        assert(certificate.max_rule_probes === (certificate.program.endsWith("gate") ? 2 : 1), JSON.stringify(item));
        assert(certificate.read_sites.every((site: any) => site.table === "_connected" && site.index === "byPrincipal"), JSON.stringify(item));
      }
    });
    for (const key of ["'alice'", "1", "null", "", "viewer, viewer"]) {
      const result = compile(`query bad():\n  return connected[${key}]\n`);
      assert(!result.ok, `connected admitted key ${key}`);
    }
    for (const arg of ["p: id", "p: posts", "p: principal ?"]) {
      assert(!compile(`query bad(${arg}):\n  return exists connected[p]\n`).ok, `connected admitted ${arg}`);
    }
    for (const source of [
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
  return { literal: replyCounts[null], typed: replyCounts[parent], named: replyCounts[parent = null],
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
  p = posts[id]! else NOT_FOUND
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
      const source = `query probe(id: posts):\n  p = posts[id]! else NOT_FOUND\n  alias = p.tags\n  for t in ${domain}:\n    require t != '' else EMPTY\n  return true\n`;
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
  p = posts[id]! else NOT_FOUND
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
  p = posts[id]! else NOT_FOUND
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
  p = posts[id]! else NOT_FOUND
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
      "snapback/probe.q": "query probe(id: posts):\n  p = posts[id]! else NOT_FOUND\n  for tag in p.payload.tags:\n    value = tag\n  return true\n" }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics.some((d) => d.code === "E_UNBOUND_LOOP"), JSON.stringify(result));
    });
  });
}

/** Read the literal word decisions in the front end, including contextual
 * comparisons, lookup tables and intrinsic field declarations. This is not
 * a second vocabulary list: a new word in a decision changes this result. */
export function recognizedQuarryWords(frontend: string): string[] {
  const words = new Set<string>();
  const directory = join(frontend, "src/quarry");
  for (const file of readdirSync(directory).filter(file => file.endsWith(".ts"))) {
    const source = ts.createSourceFile(file, readFileSync(join(directory, file), "utf8"), ts.ScriptTarget.Latest, true);
    const declarations = new Map<string, ts.Expression[]>();
    const visit = (node: ts.Node, fn: (node: ts.Node) => void): void => { fn(node); node.forEachChild(child => visit(child, fn)); };
    visit(source, node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        declarations.set(node.name.text, [...declarations.get(node.name.text) ?? [], node.initializer]);
      }
    });
    const examined = new Set<ts.Node>();
    const literals = (node: ts.Node): void => {
      if (examined.has(node)) return;
      examined.add(node);
      if (ts.isStringLiteralLike(node)) {
        if (/^[a-z][a-zA-Z0-9-]*$/.test(node.text)) words.add(node.text);
      } else if (ts.isIdentifier(node)) {
        for (const value of declarations.get(node.text) ?? []) literals(value);
      } else if (ts.isArrayLiteralExpression(node)) node.elements.forEach(item => literals(item));
      else if (ts.isNewExpression(node) && ["Set", "Map"].includes(node.expression.getText(source))) {
        node.arguments?.forEach(item => literals(item));
      } else if (ts.isConditionalExpression(node)) {
        literals(node.whenTrue); literals(node.whenFalse);
      } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "map") literals(node.expression.expression);
    };
    const wordOperand = (node: ts.Node): boolean => {
      if (ts.isPropertyAccessExpression(node)) return ["value", "name", "table", "column"].includes(node.name.text);
      if (!ts.isIdentifier(node) || !["name", "unit", "policy"].includes(node.text)) return false;
      // Object serialization's destructured property labels aren't authored word decisions.
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (ts.isArrowFunction(parent)) return !parent.parameters.some(p => ts.isArrayBindingPattern(p.name));
        if (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) break;
      }
      return true;
    };
    visit(source, node => {
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)) {
        if (wordOperand(node.left) && ts.isStringLiteralLike(node.right)) literals(node.right);
        if (wordOperand(node.right) && ts.isStringLiteralLike(node.left)) literals(node.left);
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const call = node.expression;
        if (call.expression.kind === ts.SyntaxKind.ThisKeyword && ["at", "take", "maybe"].includes(call.name.text)) {
          node.arguments.forEach(arg => literals(arg));
        } else if (["includes", "has", "get"].includes(call.name.text) && node.arguments.some(wordOperand)) {
          literals(call.expression);
        }
      }
      // Intrinsic rows/indexes and result fields, rather than arbitrary authored names.
      if (["catalog.ts", "index.ts"].includes(file) && ts.isPropertyAssignment(node)
        && node.name.getText(source) === "name" && ts.isStringLiteralLike(node.initializer)) {
        literals(node.initializer);
      }
      if (file === "lexer.ts" && ts.isVariableDeclaration(node) && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
        literals(node.initializer);
      }
      if (file === "bound-builtins.ts" && ts.isNewExpression(node) && node.expression.getText(source) === "Map") {
        node.arguments?.forEach(arg => literals(arg));
      }
    });
  }
  return [...words].sort();
}
