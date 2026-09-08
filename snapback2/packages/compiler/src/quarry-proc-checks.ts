import { deepStrictEqual } from "node:assert";
import { resolve } from "node:path";
import { ClientStore, type ClosureReceipt, type Context } from "../../evaluator/src/evaluator";
import { lowerProject } from "./project";
import { rustCheck } from "./rust-check";
import { assert, compileInline, diagnosticsText, operation, withProject } from "./quarry-check-helpers";
import type { Test } from "./quarry-check-helpers";

// @ref LLP 1018.005#6-checks — proc: a statement block elaborated at each call
// under the caller's context; fn stays expression-only.

const schema = `table conversations:
  public

table memberships:
  conversation: conversations
  principal: principal
  unique byConversationPrincipal: conversation, principal
  cap 50 by conversation
  public
  insert <- allow

table messages:
  conversation: conversations
  body: text <=100
  public
  insert <- allow

table deliveries:
  recipient: principal
  conversation: conversations
  messageId: messages
  kind: enum('message', 'removed')
  public
  insert <- allow
`;

const access = `fn conversationMembers(c: conversations) = memberships[c] first 50 by byConversationPrincipal
proc deliver(c: conversations, messageId: messages, kind: enum('message', 'removed')):
  require exists conversations[c] else NO_CONVERSATION
  for m in conversationMembers(c):
    insert deliveries { recipient: m.principal, conversation: c, messageId, kind }
`;

const hand = `mutation post(c: conversations, body: text <=100):
  row = insert messages { conversation: c, body }
  require exists conversations[c] else NO_CONVERSATION
  for m in memberships[c] first 50 by byConversationPrincipal:
    insert deliveries { recipient: m.principal, conversation: c, messageId: row.id, kind: 'message' }
  return { id: row.id }
`;

const conversationRow = { table: "conversations", id: "c-1", row: { Row: { id: { Id: "c-1" } } } };

const viaProc = `proc deliver from access
mutation post(c: conversations, body: text <=100):
  row = insert messages { conversation: c, body }
  deliver(c, row.id, 'message')
  return { id: row.id }
`;

export function registerQuarryProcChecks(test: Test, frontend: string): void {
  test("proc: a fan-out block declared once, imported, and elaborated at each call, certifies like its hand-inlined twin", async () => {
    await withProject({ "snapback/schema.q": schema, "snapback/access.q": access, "snapback/ops.q": viaProc }, async (root) => {
      const project = await lowerProject(root);
      assert(project.ok, `proc project refused: ${project.ok ? "" : diagnosticsText(project.diagnostics)}`);
      const program = operation(project.project.programs, "ops.post");
      const checked = rustCheck([program], "synthetic", project.project.schema)[0]!;
      assert(!checked.error && checked.certificate, `proc-using mutation did not certify: ${JSON.stringify(checked)}`);
      await withProject({ "snapback/schema.q": schema, "snapback/ops.q": hand }, async (handRoot) => {
        const twin = await lowerProject(handRoot);
        assert(twin.ok, `hand-inlined twin refused: ${twin.ok ? "" : diagnosticsText(twin.diagnostics)}`);
        const handProgram = operation(twin.project.programs, "ops.post");
        const handChecked = rustCheck([handProgram], "synthetic", twin.project.schema)[0]!;
        assert(!handChecked.error && handChecked.certificate, `twin did not certify: ${JSON.stringify(handChecked)}`);
        // Parity as LLP 1018.005 §3 states it: read sites, write bounds, result, writes, and traced points agree; step and heap cost need not.
        const certificate = checked.certificate!, handCertificate = handChecked.certificate!;
        deepStrictEqual(certificate.read_sites, handCertificate.read_sites);
        deepStrictEqual(certificate.write_sites, handCertificate.write_sites);
        deepStrictEqual(certificate.mutation_targets, handCertificate.mutation_targets,
          "proc expansion preserves the certified semantic targets of its inlined body");
        deepStrictEqual(certificate.mutation_targets, { targets: [
          { table: "deliveries", kind: "create", unresolved: "repeated" },
          { table: "messages", kind: "create", source: { newId: 0 } },
        ], complete: false });
        assert(project.apiDts.includes('deliveries: "create"') && project.apiDts.includes('messages: "create"'),
          "the generated operation types target tables written inside its proc");
        assert((certificate.write_sites as any[]).some((site) => site.table === "deliveries" && site.max_rows === 50), `the fan-out write bound was not priced: ${JSON.stringify(certificate.write_sites)}`);
        const receipt: ClosureReceipt = {
          schema_hash: certificate.schema_hash as string, rows: [
            conversationRow,
            { table: "memberships", id: "m-1", row: { Row: { id: { Id: "m-1" }, conversation: { Id: "c-1" }, principal: { Id: "p-1" } } } },
            { table: "memberships", id: "m-2", row: { Row: { id: { Id: "m-2" }, conversation: { Id: "c-1" }, principal: { Id: "p-2" } } } },
          ], ranges: [], verdicts: [], absences: [],
        };
        const context = (ids: string[]): Context => ({ viewer: "p-1", principal_kind: "user", auth_epoch: 1,
          args: { c: { Id: "c-1" }, body: { String: "hi" } }, now: 1, new_ids: ids, read_time: 1 });
        const ids = ["id-0", "id-1", "id-2", "id-3"];
        const actual = new ClientStore(project.project.schema, receipt).applyMutation(program, context(ids), false, checked.certificate).execution;
        const expected = new ClientStore(twin.project.schema, receipt).applyMutation(handProgram, context(ids), false, handChecked.certificate).execution;
        deepStrictEqual(actual.result, expected.result);
        deepStrictEqual(actual.writes, expected.writes);
        deepStrictEqual(actual.trace.points, expected.trace.points);
        assert(actual.trace.points.length > 0 && actual.writes.length === 3, `the twin traced ${actual.trace.points.length} points and ${actual.writes.length} writes`);
      });
    });
  });

  test("proc: arguments bind once by value, a proc calls fns and procs, and the caller's context reaches the body", () => {
    const result = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/access.q", source: access + `proc deliverTwice(c: conversations, messageId: messages):
  deliver(c, messageId, 'message')
  deliver(c, messageId, 'removed')
` },
      { fileName: "snapback/ops.q", source: `proc deliverTwice from access
mutation post(c: conversations, body: text <=100):
  row = insert messages { conversation: c, body }
  deliverTwice(c, row.id)
  return { id: row.id }
` },
    ]);
    assert(result.ok, `nested proc refused: ${result.ok ? "" : diagnosticsText(result.diagnostics)}`);
    const body = JSON.stringify(result.project.programs[0]?.body);
    assert((body.match(/"Insert"/g) ?? []).length === 3, `deliverTwice did not elaborate to the message insert and two fan-out inserts: ${body.slice(0, 300)}`);
  });

  test("proc: arguments evaluate once in call order, a row coerces to its id, new allocates in an argument, and viewer reaches the body", async () => {
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": `proc mark(c: conversations, joined: bool, id: messages):
  if joined:
    insert deliveries { recipient: viewer, conversation: c, messageId: id, kind: 'removed' }
  else:
    insert deliveries { recipient: viewer, conversation: c, messageId: id, kind: 'message' }
    insert memberships { conversation: c, principal: viewer }

mutation post(c: conversations, body: text <=100):
  row = insert messages { conversation: c, body }
  mark(c, exists memberships[c, viewer], row)
  mark(c, exists memberships[c, viewer], new)
  return null
` }, async (root) => {
      const project = await lowerProject(root);
      assert(project.ok, `argument proc refused: ${project.ok ? "" : diagnosticsText(project.diagnostics)}`);
      const program = operation(project.project.programs, "ops.post");
      const checked = rustCheck([program], "synthetic", project.project.schema)[0]!;
      assert(!checked.error && checked.certificate, `argument proc did not certify: ${JSON.stringify(checked)}`);
      const store = new ClientStore(project.project.schema, { schema_hash: checked.certificate.schema_hash as string, rows: [conversationRow], ranges: [], verdicts: [], absences: [] });
      const execution = store.applyMutation(program, { viewer: "p-1", principal_kind: "user", auth_epoch: 1,
        args: { c: { Id: "c-1" }, body: { String: "hi" } }, now: 1, new_ids: ["id-0", "id-1", "id-2", "id-3", "id-4"], read_time: 1 }, false, checked.certificate).execution;
      const rows = execution.writes.map((write) => [write.table, JSON.stringify(write.row)] as const);
      deepStrictEqual(rows.map(([table]) => table), ["messages", "deliveries", "memberships", "deliveries"]);
      const [, first, membership, second] = rows;
      assert(first![1].includes('"message"') && first![1].includes('{"Id":"id-0"}'), `the first call did not see a non-member and the row's id: ${first![1]}`);
      assert(membership![1].includes('{"Id":"p-1"}'), `viewer did not reach the body: ${membership![1]}`);
      assert(second![1].includes('"removed"') && !second![1].includes('{"Id":"id-0"}') && /"messageId":\{"Id":"id-\d"\}/.test(second![1]),
        `the second call did not observe the first call's write with a fresh new id: ${second![1]}`);
    });
  });

  test("proc: procs and fns share one expansion depth; eight frames elaborate and nine refuse", () => {
    const chain = (procs: number, fns: number) => {
      const lines: string[] = [];
      for (let i = 0; i < procs; i += 1) lines.push(`proc p${i}(c: conversations):\n  ${i + 1 < procs ? `p${i + 1}(c)` : "require f0(c) else TOO_DEEP"}\n`);
      for (let i = 0; i < fns; i += 1) lines.push(`fn f${i}(c: conversations) = ${i + 1 < fns ? `f${i + 1}(c)` : "exists conversations[c]"}\n`);
      lines.push("mutation post(c: conversations):\n  p0(c)\n  return null\n");
      return lines.join("\n");
    };
    const eight = compileInline([{ fileName: "snapback/schema.q", source: schema }, { fileName: "snapback/ops.q", source: chain(4, 4) }]);
    assert(eight.ok, `eight mixed frames refused: ${eight.ok ? "" : diagnosticsText(eight.diagnostics)}`);
    const nine = compileInline([{ fileName: "snapback/schema.q", source: schema }, { fileName: "snapback/ops.q", source: chain(4, 5) }]);
    assert(!nine.ok && diagnosticsText(nine.diagnostics).includes("expansion exceeds depth 8"), `nine mixed frames did not refuse on depth: ${nine.ok ? "ok" : diagnosticsText(nine.diagnostics)}`);
  });

  test("proc: a binder refusal inside a body is authored in the proc and names the call site", () => {
    for (const body of ["  require 1 else BAD\n", "  if 1:\n    require true else BAD\n", "  require missing else BAD\n"]) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/helpers.q", source: `proc check(c: conversations):\n${body}` },
        { fileName: "snapback/ops.q", source: "proc check from helpers\nmutation post(c: conversations):\n  check(c)\n  return null\n" },
      ]);
      assert(!result.ok, `a body refusal compiled: ${body}`);
      const text = diagnosticsText(result.diagnostics);
      assert(text.includes("snapback/helpers.q:2:") && text.includes("used at snapback/ops.q:3:"), `the refusal lost its authored site or the call site: ${text}`);
    }
  });

  test("proc: a return inside a body refuses at the authored site, and a proc in expression position refuses", () => {
    const returned = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: `proc finish(c: conversations):
  if exists memberships[c, viewer]:
    return true
mutation post(c: conversations):
  finish(c)
  return null
` },
    ]);
    assert(!returned.ok && returned.diagnostics.some((d) => d.code === "E_QUARRY_PLACEMENT" && d.message.includes("cannot return")
      && d.site.startsWith("snapback/ops.q:3")), `proc return was not refused at its site: ${JSON.stringify(returned.ok ? [] : returned.diagnostics)}`);
    const expressionUse = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/access.q", source: access },
      { fileName: "snapback/ops.q", source: `proc deliver from access
mutation post(c: conversations, body: text <=100):
  row = insert messages { conversation: c, body }
  return deliver(c, row.id, 'message')
` },
    ]);
    assert(!expressionUse.ok && expressionUse.diagnostics.some((d) => d.code === "E_QUARRY_TYPE" && d.message.includes("is a statement")),
      `proc in expression position was not refused: ${JSON.stringify(expressionUse.ok ? [] : expressionUse.diagnostics)}`);
  });

  test("proc: hygiene in both directions, a parameter named like a context builtin, and a duplicate parameter refusing", () => {
    const hygienic = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: `proc mark(now: int, c: conversations):
  scratch = now
  insert messages { conversation: c, body: 'x' }
mutation post(c: conversations):
  scratch = 5
  mark(1, c)
  return scratch
` },
    ]);
    assert(hygienic.ok, `proc hygiene refused: ${hygienic.ok ? "" : diagnosticsText(hygienic.diagnostics)}`);
    const capture = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: `proc leak(c: conversations):
  insert messages { conversation: c, body: outer }
mutation post(c: conversations):
  outer = 'x'
  leak(c)
  return null
` },
    ]);
    assert(!capture.ok && capture.diagnostics.some((d) => d.code === "E_QUARRY_UNKNOWN" && d.message.includes("outer")),
      `a proc captured a caller local: ${JSON.stringify(capture.ok ? [] : capture.diagnostics)}`);
    const escape = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: `proc name(c: conversations):
  inner = 'x'
  insert messages { conversation: c, body: inner }
mutation post(c: conversations):
  name(c)
  return inner
` },
    ]);
    assert(!escape.ok && escape.diagnostics.some((d) => d.code === "E_QUARRY_UNKNOWN" && d.message.includes("inner")),
      `a proc local escaped into its caller: ${JSON.stringify(escape.ok ? [] : escape.diagnostics)}`);
    const duplicate = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: `proc twice(c: conversations, c: conversations):
  insert messages { conversation: c, body: 'x' }
mutation post(c: conversations):
  twice(c, c)
  return null
` },
    ]);
    assert(!duplicate.ok && duplicate.diagnostics.some((d) => d.message.includes("duplicate argument c")),
      `a duplicate proc parameter compiled: ${JSON.stringify(duplicate.ok ? [] : duplicate.diagnostics)}`);
  });

  test("proc: a query caller refuses at the body's write naming both sites; a cycle refuses; a require inside owns its code", () => {
    const query = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/access.q", source: access },
      { fileName: "snapback/ops.q", source: `proc deliver from access
query peek(c: conversations, m: messages):
  deliver(c, m, 'message')
  return null
` },
    ]);
    assert(!query.ok && query.diagnostics.some((d) => d.site.startsWith("snapback/access.q") && d.message.includes("used at snapback/ops.q")),
      `a query caller's write was not refused at the proc's site with the use site: ${JSON.stringify(query.ok ? [] : query.diagnostics)}`);
    const cycle = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: `proc a(c: conversations):
  b(c)
proc b(c: conversations):
  a(c)
mutation post(c: conversations):
  a(c)
  return null
` },
    ]);
    assert(!cycle.ok && cycle.diagnostics.some((d) => d.code === "E_QUARRY_UNSUPPORTED" && d.message.includes("cycle")),
      `a proc cycle compiled: ${JSON.stringify(cycle.ok ? [] : cycle.diagnostics)}`);
    const guarded = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: `proc guard(c: conversations):
  require exists memberships[c, viewer] else NOT_MEMBER
mutation post(c: conversations):
  guard(c)
  insert messages { conversation: c, body: 'x' }
  return null
` },
    ]);
    assert(guarded.ok && JSON.stringify(guarded.project.programs[0]?.body).includes('"NOT_MEMBER"'),
      `a require inside a proc did not reach the caller with its code: ${guarded.ok ? JSON.stringify(guarded.project.programs[0]?.body).slice(0, 200) : diagnosticsText(guarded.diagnostics)}`);
  });

  test("proc: an emit inside an imported proc resolves the proc module's effect, and a where inside a helper reaches the repair pass", async () => {
    await withProject({
      "snapback/schema.q": schema,
      "snapback/delivery.ts": `import { effect } from "snapback2";\nexport const notify = effect({ grants: ["https://api.example.com"], run: async (_payload: { c: string; body: string }) => null });\n`,
      "snapback/fanout.q": `effect notify from delivery
proc announce(c: conversations, body: text <=100):
  emit notify { c, body }
`,
      "snapback/ops.q": `proc announce from fanout
mutation post(c: conversations, body: text <=100):
  announce(c, body)
  return null
`,
    }, async (root) => {
      const project = await lowerProject(root);
      assert(project.ok, `imported proc emit refused: ${project.ok ? "" : diagnosticsText(project.diagnostics)}`);
      const body = JSON.stringify(operation(project.project.programs, "ops.post").body);
      assert(body.includes("delivery.notify"), `the proc module's effect was not resolved lexically: ${body.slice(0, 300)}`);
    });
    const where = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: `proc scan(c: conversations):
  for m in memberships[c] first 50 by byConversationPrincipal where .principal = viewer:
    insert messages { conversation: c, body: 'x' }
mutation post(c: conversations):
  scan(c)
  return null
` },
    ]);
    assert(!where.ok && where.diagnostics.some((d) => d.message.includes("where")),
      `a where inside a proc body was silently discarded: ${JSON.stringify(where.ok ? [] : where.diagnostics)}`);
  });

  test("proc: a list parameter loops over its captured actual; inside a branch the caller keeps the fan-out analysis's existing limit", async () => {
    const listSchema = schema + `
table notes:
  body: text <=100
  public
  insert <- allow
`;
    const listProc = `proc fanOut(bodies: [text <=100] <=5):
  for body in bodies:
    insert notes { body }
`;
    await withProject({ "snapback/schema.q": listSchema, "snapback/ops.q": listProc + `mutation post(bodies: [text <=100] <=5):
  fanOut(bodies)
  return null
` }, async (root) => {
      const project = await lowerProject(root);
      assert(project.ok, `list-parameter proc refused: ${project.ok ? "" : diagnosticsText(project.diagnostics)}`);
      const program = operation(project.project.programs, "ops.post");
      const body = JSON.stringify(program.body);
      assert(!body.includes('"ArgList"'), `a proc's list parameter lowered as the program's own argument: ${body.slice(0, 300)}`);
      const checked = rustCheck([program], "synthetic", project.project.schema)[0]!;
      assert(!checked.error && checked.certificate, `operation-scope list fan-out did not certify: ${JSON.stringify(checked)}`);
      const store = new ClientStore(project.project.schema, { schema_hash: checked.certificate.schema_hash as string, rows: [], ranges: [], verdicts: [], absences: [] });
      const execution = store.applyMutation(program, { viewer: "p-1", principal_kind: "user", auth_epoch: 1,
        args: { bodies: { Array: [{ String: "a" }, { String: "b" }] } }, now: 1, new_ids: ["n-1", "n-2", "n-3", "n-4", "n-5"], read_time: 1 }, false, checked.certificate).execution;
      assert(JSON.stringify(execution).includes('"a"') && JSON.stringify(execution).includes('"b"'), `the captured list did not drive the loop: ${JSON.stringify(execution).slice(0, 300)}`);
    });
    await withProject({ "snapback/schema.q": listSchema, "snapback/ops.q": listProc + `mutation post(bodies: [text <=100] <=5, flag: bool):
  if flag:
    fanOut(bodies)
  return null
` }, async (root) => {
      const project = await lowerProject(root);
      assert(project.ok, `branch caller refused at compile: ${project.ok ? "" : diagnosticsText(project.diagnostics)}`);
      const checked = rustCheck([operation(project.project.programs, "ops.post")], "synthetic", project.project.schema)[0]!;
      assert(checked.error?.code === "E_STRUCTURAL_FANOUT",
        `a captured list looped inside a branch did not meet the existing fan-out limit: ${JSON.stringify(checked).slice(0, 300)}`);
    });
  });

  test("proc: a final call falls through, and the media mutations of the chat recipe fan out through deliver", async () => {
    const final = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/access.q", source: access },
      { fileName: "snapback/ops.q", source: `proc deliver from access
mutation post(c: conversations, body: text <=100):
  row = insert messages { conversation: c, body }
  deliver(c, row.id, 'message')
` },
    ]);
    assert(final.ok, `a final proc call refused: ${final.ok ? "" : diagnosticsText(final.diagnostics)}`);
    const program = final.ok ? final.project.programs[0] : undefined;
    const tail = JSON.stringify(program?.body.at(-1));
    assert(!tail.includes('"Return"') || tail.includes('"Null"'), `a final proc call completed the mutation with a value: ${tail.slice(0, 200)}`);

    const chat = await lowerProject(resolve(frontend, "fixtures/quarry-chat"));
    assert(chat.ok, `the chat fixture refused: ${chat.ok ? "" : diagnosticsText(chat.diagnostics)}`);
    const checked = rustCheck(chat.project.programs, "synthetic", chat.project.schema, undefined, chat.project.effects);
    const fanOut = (name: string) => {
      const item = checked.find((entry) => entry.program === name)!;
      assert(!item.error && item.certificate, `${name} did not certify: ${JSON.stringify(item.error)}`);
      return (item.certificate.write_sites as any[]).filter((site) => site.table === "deliveries");
    };
    const send = fanOut("messages.send");
    assert(send.length === 1 && send[0].max_rows === 50, `send's fan-out bound is not one cap-50 write site: ${JSON.stringify(send)}`);
    for (const name of ["messages.sendPhoto", "messages.sendClip", "messages.sendOncePhoto"]) deepStrictEqual(fanOut(name), send, `${name} does not fan out like send`);
  });
}
