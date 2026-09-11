import { deepStrictEqual } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalValue, ClientStore, scopedRuleHash, type ClosureReceipt, type Context, type Value } from "../../evaluator/src/evaluator";
import type { Execution } from "../../evaluator/src/types";
import type { Program, SchemaJson } from "./ir";
import { lowerProject, lowerSeed } from "./project";
import { rustCheck, type RustCheckResult } from "./rust-check";
import { bindQuarryProgram } from "./quarry/bound";
import { lowerBoundQuarryProgram } from "./quarry/direct";
import { prepareQuarry, type QuarryInput } from "./quarry/index";
import { parseDocument } from "./quarry/parser";
import {
  assert,
  compileInline,
  deepKey,
  diagnosticsText,
  occurrences,
  operation,
  type Test,
  withProject,
} from "./quarry-check-helpers";
import ts from "typescript";

export function registerQuarryDirectCoreChecks(test: Test, frontend: string): void {
  const fixtures = resolve(frontend, "fixtures");
  const packageRoot = resolve(frontend, "../snapback2");
  test("direct Quarry binds and certifies one indexed existence query identically to the parity oracle", async () => {
    const root = join(fixtures, "quarry-surface");
    const inputs: QuarryInput[] = ["schema", "surface"].map((stem) => {
      const path = join(root, "snapback", `${stem}.q`);
      return { path, fileName: `snapback/${stem}.q`, source: readFileSync(path, "utf8") };
    });
    const prepared = prepareQuarry(inputs);
    assert(prepared.ok, `direct Quarry preparation failed: ${JSON.stringify(prepared.ok ? [] : prepared.diagnostics)}`);
    assert(prepared.prepared.diagnostics.length === 0,
      `direct Quarry preparation retained diagnostics: ${JSON.stringify(prepared.prepared.diagnostics)}`);
    const declaration = prepared.prepared.documents
      .flatMap((document) => document.programs)
      .find((program) => program.name === "hasMembership");
    assert(declaration, "quarry-surface has no hasMembership declaration");

    const bound = bindQuarryProgram(declaration, prepared.prepared.catalog);
    const direct = lowerBoundQuarryProgram(bound);
    const oracle = await lowerProject(root);
    assert(oracle.ok, `generated-TypeScript parity oracle failed: ${oracle.ok ? "" : diagnosticsText(oracle.diagnostics)}`);
    const legacy = operation(oracle.project.programs, "surface.hasMembership");
    deepStrictEqual(direct, legacy);
    deepStrictEqual(bound.result.type, { kind: "bool", optional: false });
    assert(bound.source.definition.file === "snapback/surface.q"
      && bound.source.definition.line === 11 && bound.source.definition.col === 1,
    `direct source stack lost the authored operation site: ${JSON.stringify(bound.source)}`);

    const directCheck = rustCheck([direct], "synthetic", oracle.project.schema)[0]!;
    const legacyCheck = rustCheck([legacy], "synthetic", oracle.project.schema)[0]!;
    assert(!directCheck.error && directCheck.certificate,
      `direct indexed existence query did not certify: ${JSON.stringify(directCheck)}`);
    deepStrictEqual(directCheck, legacyCheck);
  });

  test("direct Quarry value and bounded-read core matches public fixture programs", async () => {
    const cases = [
      { fixture: "quarry-surface", operations: ["surface.keyedRow", "surface.wordTokens", "surface.counterTotal", "surface.postsAfter"] },
      { fixture: "quarry-todos", operations: ["todos.list"] },
      { fixture: "quarry-money", operations: ["money.atMost"] },
      { fixture: "quarry-assets", operations: ["assets.echo", "assets.echoNested"] },
    ];
    for (const fixture of cases) {
      const root = join(fixtures, fixture.fixture);
      const inputs: QuarryInput[] = readdirSync(join(root, "snapback"))
        .filter((file) => file.endsWith(".q"))
        .map((file) => {
          const path = join(root, "snapback", file);
          return { path, fileName: `snapback/${file}`, source: readFileSync(path, "utf8") };
        });
      const prepared = prepareQuarry(inputs);
      assert(prepared.ok, `${fixture.fixture} direct preparation failed: ${JSON.stringify(prepared.ok ? [] : prepared.diagnostics)}`);
      const oracle = await lowerProject(root);
      assert(oracle.ok, `${fixture.fixture} parity oracle failed: ${oracle.ok ? "" : diagnosticsText(oracle.diagnostics)}`);
      for (const name of fixture.operations) {
        const [moduleName, operationName] = name.split(".");
        const declaration = prepared.prepared.documents
          .find((document) => document.file === `snapback/${moduleName}.q`)
          ?.programs.find((program) => program.name === operationName);
        assert(declaration, `${fixture.fixture} has no ${name} declaration`);
        const bound = bindQuarryProgram(declaration, prepared.prepared.catalog);
        const direct = lowerBoundQuarryProgram(bound);
        const legacy = operation(oracle.project.programs, name);
        const directCheck: RustCheckResult = rustCheck([direct], "synthetic", oracle.project.schema)[0]!;
        const legacyCheck: RustCheckResult = rustCheck([legacy], "synthetic", oracle.project.schema)[0]!;
        assert(!directCheck.error && directCheck.certificate, `${name} direct program did not certify: ${JSON.stringify(directCheck)}`);
        assert(!legacyCheck.error && legacyCheck.certificate, `${name} oracle program did not certify: ${JSON.stringify(legacyCheck)}`);
        if (name === "surface.counterTotal") {
          deepStrictEqual(directCheck.certificate.bounds, legacyCheck.certificate.bounds);
        } else if (name === "surface.postsAfter") {
          deepStrictEqual(directCheck.certificate.read_sites, legacyCheck.certificate.read_sites);
          deepStrictEqual(directCheck.certificate.result_pages, legacyCheck.certificate.result_pages);
        } else {
          deepStrictEqual(direct, legacy);
          deepStrictEqual(directCheck, legacyCheck);
        }
      }
    }
  });

  test("direct Quarry value lowering preserves authored order and bound facts", async () => {
    const schema = `table rows:
  public

table groups:
  public

table memberships:
  group: groups
  principal: principal
  unique byGroupPrincipal: group, principal
  public
`;
    const values = `query values(photo: image <=5000000, a: int, b: int):
  return { pair: [a, b], negative: -a, inverted: not false, sum: a + b, maximum: max(a, b), width: photo.width, owner: viewer, missing: null }

query ordered(group: groups, left: principal, right: principal):
  return exists memberships[group, left] or exists memberships[group, right]

query skippedRead(group: groups, principal: principal):
  return false and exists memberships[group, principal]

query reachedRead(group: groups, principal: principal):
  return true and exists memberships[group, principal]

query fieldOrder(group: groups, left: principal, right: principal):
  return memberships[group, left].principal = memberships[group, right].principal

query refusalOrder(group: groups, n: int, zero: int):
  return divmod(n, zero).quotient = count(memberships[group] first 1 by byGroupPrincipal)

mutation skippedNew():
  return false and new = new
`;
    await withProject({ "snapback/schema.q": schema, "snapback/values.q": values }, async (root) => {
      const paths = ["schema", "values"].map((stem) => join(root, "snapback", `${stem}.q`));
      const prepared = prepareQuarry(paths.map((path, index) => ({
        path, fileName: `snapback/${["schema", "values"][index]}.q`, source: readFileSync(path, "utf8"),
      })));
      assert(prepared.ok, `direct value preparation failed: ${JSON.stringify(prepared.ok ? [] : prepared.diagnostics)}`);
      const declaration = prepared.prepared.documents[1]?.programs[0];
      assert(declaration, "direct value fixture has no operation");
      const bound = bindQuarryProgram(declaration, prepared.prepared.catalog);
      const direct = lowerBoundQuarryProgram(bound);
      const oracle = await lowerProject(root);
      assert(oracle.ok, `direct value parity oracle failed: ${oracle.ok ? "" : diagnosticsText(oracle.diagnostics)}`);
      deepStrictEqual(direct, operation(oracle.project.programs, "values.values"));
      assert(bound.result.type.kind === "object" && bound.result.presence === "required",
        `direct object result lost presence: ${JSON.stringify(bound.result)}`);
      const pair = bound.result.type.fields.get("pair");
      assert(pair?.max === 2 && pair.presence === "required", `direct array result lost bound facts: ${JSON.stringify(pair)}`);

      const orderedDeclaration = prepared.prepared.documents[1]?.programs[1];
      assert(orderedDeclaration, "direct value fixture has no ordered-read operation");
      const ordered = lowerBoundQuarryProgram(bindQuarryProgram(orderedDeclaration, prepared.prepared.catalog));
      const orderedBody = JSON.stringify(ordered.body);
      assert(orderedBody.includes('"If"')
        && orderedBody.indexOf('"values.ordered.0"') < orderedBody.indexOf('"values.ordered.1"'),
      `ordered direct reads lost short circuiting or lexical site order: ${orderedBody}`);
      const orderedCheck = rustCheck([ordered], "synthetic", oracle.project.schema)[0]!;
      const orderedOracle = rustCheck([operation(oracle.project.programs, "values.ordered")], "synthetic", oracle.project.schema)[0]!;
      assert(!orderedCheck.error && orderedCheck.certificate, `ordered direct program did not certify: ${JSON.stringify(orderedCheck)}`);
      assert(!orderedOracle.error && orderedOracle.certificate, `ordered oracle program did not certify: ${JSON.stringify(orderedOracle)}`);
      deepStrictEqual(orderedCheck.certificate.read_sites, orderedOracle.certificate.read_sites);

      const directProgram = (name: string): Program => {
        const declaration = prepared.prepared.documents[1]?.programs.find((program) => program.name === name);
        assert(declaration, `direct value fixture has no ${name} operation`);
        return lowerBoundQuarryProgram(bindQuarryProgram(declaration, prepared.prepared.catalog));
      };
      const checkedProgram = (program: Program): RustCheckResult => {
        const checked = rustCheck([program], "synthetic", oracle.project.schema)[0]!;
        assert(!checked.error && checked.certificate, `${program.name} did not certify: ${JSON.stringify(checked)}`);
        return checked;
      };
      const context = (args: Context["args"] = {}): Context => ({
        viewer: "viewer-1", principal_kind: "user", auth_epoch: 1,
        args, now: 1, new_ids: [], read_time: 1,
      });
      const readArgs = { group: { Id: "group-1" }, principal: { Id: "principal-1" } } satisfies Context["args"];
      for (const [name, points] of [["skippedRead", 0], ["reachedRead", 1]] as const) {
        const program = directProgram(name);
        const checked = checkedProgram(program);
        const execution = new ClientStore(oracle.project.schema).reexecute(program, context(readArgs), checked.certificate).execution;
        assert(execution.trace.points.length === points,
          `${name} executed ${execution.trace.points.length} point reads, expected ${points}: ${JSON.stringify(execution.trace)}`);
      }
      const skippedNew = directProgram("skippedNew");
      const skippedNewCheck = checkedProgram(skippedNew);
      const skippedNewExecution = new ClientStore(oracle.project.schema)
        .applyMutation(skippedNew, context(), false, skippedNewCheck.certificate).execution;
      deepStrictEqual(skippedNewExecution.result, { Bool: false });

      const fieldOrder = directProgram("fieldOrder");
      const fieldOrderOracle = operation(oracle.project.programs, "values.fieldOrder");
      const fieldCertificate = checkedProgram(fieldOrder).certificate!;
      const fieldOracleCertificate = checkedProgram(fieldOrderOracle).certificate!;
      const receipt: ClosureReceipt = {
        schema_hash: fieldCertificate.schema_hash as string,
        rows: [], ranges: [], verdicts: [],
        absences: [["memberships", "byGroupPrincipal", [{ Id: "group-1" }, { Id: "left-1" }]]],
      };
      const fieldArgs = { group: { Id: "group-1" }, left: { Id: "left-1" }, right: { Id: "right-1" } };
      const fieldExecution = new ClientStore(oracle.project.schema, receipt)
        .reexecute(fieldOrder, context(fieldArgs), fieldCertificate).execution;
      const fieldOracleExecution = new ClientStore(oracle.project.schema, receipt)
        .reexecute(fieldOrderOracle, context(fieldArgs), fieldOracleCertificate).execution;
      deepStrictEqual(fieldExecution.result, fieldOracleExecution.result);
      deepStrictEqual(fieldExecution.trace.points.map((point) => point.site), ["values.fieldOrder.0", "values.fieldOrder.1"]);

      const refusalOrder = directProgram("refusalOrder");
      const refusalOrderOracle = operation(oracle.project.programs, "values.refusalOrder");
      const refusalCertificate = checkedProgram(refusalOrder).certificate!;
      const refusalOracleCertificate = checkedProgram(refusalOrderOracle).certificate!;
      const refusalArgs = { group: { Id: "group-1" }, n: { Int: 1 }, zero: { Int: 0 } };
      const outcome = (program: Program, certificate: Record<string, unknown>) => {
        try {
          new ClientStore(oracle.project.schema).reexecute(program, context(refusalArgs), certificate);
          return { code: undefined, points: [] as string[], ranges: [] as string[] };
        } catch (error) {
          const refusal = error as { code?: string; trace?: { points: Array<{ site: string }>; ranges: Array<{ site: string }> } };
          return { code: refusal.code,
            points: refusal.trace?.points.map((point) => point.site) ?? [],
            ranges: refusal.trace?.ranges.map((range) => range.site) ?? [] };
        }
      };
      const directRefusal = outcome(refusalOrder, refusalCertificate);
      deepStrictEqual(directRefusal, outcome(refusalOrderOracle, refusalOracleCertificate));
      assert(directRefusal.code !== undefined && directRefusal.points.length === 0 && directRefusal.ranges.length === 0,
        `later read ran before the left refusal: ${JSON.stringify(directRefusal)}`);
    });
  });

  test("direct Quarry locals, requirements, assertions, and control flow preserve parity", async () => {
    const schema = `table conversations:
  title: text <=80
  public

table memberships:
  conversation: conversations
  principal: principal
  unique byConversationPrincipal: conversation, principal
  public
`;
    const operations = `query guarded(conversationId: conversations, principal: principal, flag: bool):
  row = conversations[conversationId] ! else CONVERSATION_REQUIRED
  require exists memberships[row.id, principal] else MEMBERSHIP_REQUIRED
  if flag:
    title = row.title
    return { title, branch: 'then' }
  else:
    title = row.title
    return { title, branch: 'else' }

query looped(ids: [conversations] <=3):
  for item in ids:
    require exists conversations[item] else CONVERSATION_REQUIRED

query loopedPage():
  page = conversations[] first 3 by byId
  for item in page:
    require item.title != '' else TITLE_REQUIRED

query matched(id: conversations):
  row = conversations[id]
  if row != null:
    return row.title
  else:
    return null

query narrowed(id: conversations):
  existing = conversations[id]
  if existing != null:
    return existing.title
  return 'missing'

query shadowed(value: int, branch: bool):
  if branch:
    value = value + 1
    return value
  return value

query partialPage(flag: bool):
  if flag:
    return conversations[] first 3 by byId

mutation sortedNew():
  (first, second) = sorted(new, new)
  return [first, second, new]

query sortedPrincipals(a: principal, b: principal):
  (first, second) = sorted(a, b)
  return [first, second]

query sortedReadOrder(left: conversations, right: conversations):
  (first, second) = sorted((conversations[left]! else LEFT_MISSING).title, (conversations[right]! else RIGHT_MISSING).title)
  return [first, second]
`;
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": operations }, async (root) => {
      const paths = ["schema", "ops"].map((stem) => join(root, "snapback", `${stem}.q`));
      const prepared = prepareQuarry(paths.map((path, index) => ({
        path, fileName: `snapback/${["schema", "ops"][index]}.q`, source: readFileSync(path, "utf8"),
      })));
      assert(prepared.ok, `direct statement preparation failed: ${JSON.stringify(prepared.ok ? [] : prepared.diagnostics)}`);
      const declaration = prepared.prepared.documents[1]?.programs[0];
      assert(declaration, "direct statement fixture has no operation");
      const bound = bindQuarryProgram(declaration, prepared.prepared.catalog, prepared.prepared.documents);
      assert(bound.body[0]?.kind === "bind" && bound.body[1]?.kind === "require" && bound.body[2]?.kind === "if"
        && bound.result.type.kind === "object" && bound.result.presence === "required",
      `statement binder lost control or result facts: ${JSON.stringify(bound)}`);
      const direct = lowerBoundQuarryProgram(bound);
      const oracle = await lowerProject(root);
      assert(oracle.ok, `direct statement parity oracle failed: ${oracle.ok ? "" : diagnosticsText(oracle.diagnostics)}`);
      const legacy = operation(oracle.project.programs, "ops.guarded");
      const directCheck = rustCheck([direct], "synthetic", oracle.project.schema)[0]!;
      const legacyCheck = rustCheck([legacy], "synthetic", oracle.project.schema)[0]!;
      assert(!directCheck.error && directCheck.certificate, `direct statement program did not certify: ${JSON.stringify(directCheck)}`);
      assert(!legacyCheck.error && legacyCheck.certificate, `statement oracle did not certify: ${JSON.stringify(legacyCheck)}`);
      deepStrictEqual(directCheck.certificate.read_sites, legacyCheck.certificate.read_sites);
      const receipt: ClosureReceipt = {
        schema_hash: directCheck.certificate.schema_hash as string,
        rows: [
          { table: "conversations", id: "conversation-1", row: { Row: {
            id: { Id: "conversation-1" }, title: { String: "General" },
          } } },
          { table: "memberships", id: "membership-1", row: { Row: {
            id: { Id: "membership-1" }, conversation: { Id: "conversation-1" }, principal: { Id: "principal-1" },
          } } },
        ],
        ranges: [], absences: [], verdicts: [],
      };
      const context = (flag: boolean): Context => ({
        viewer: "viewer-1", principal_kind: "user", auth_epoch: 1,
        args: { conversationId: { Id: "conversation-1" }, principal: { Id: "principal-1" }, flag: { Bool: flag } },
        now: 1, new_ids: [], read_time: 1,
      });
      for (const flag of [true, false]) {
        const directExecution: Execution = new ClientStore(oracle.project.schema, receipt)
          .reexecute(direct, context(flag), directCheck.certificate).execution;
        const legacyExecution: Execution = new ClientStore(oracle.project.schema, receipt)
          .reexecute(legacy, context(flag), legacyCheck.certificate).execution;
        assert(canonicalValue(directExecution.result) === canonicalValue(legacyExecution.result),
          `direct branch ${flag} changed its result: ${canonicalValue(directExecution.result)}`);
        deepStrictEqual(directExecution.trace.points, legacyExecution.trace.points);
      }
      const absent: ClosureReceipt = {
        schema_hash: directCheck.certificate.schema_hash as string,
        rows: [], ranges: [], verdicts: [],
        absences: [["conversations", "byId", [{ Id: "missing" }]]],
      };
      const missingContext: Context = { ...context(true), args: {
        conversationId: { Id: "missing" }, principal: { Id: "principal-1" }, flag: { Bool: true },
      } };
      const outcome = (program: Program, certificate: Record<string, unknown>) => {
        try {
          new ClientStore(oracle.project.schema, absent).reexecute(program, missingContext, certificate);
          return { code: undefined, message: undefined, points: [] as string[] };
        } catch (error) {
          const refusal = error as { code?: string; message?: string; trace?: { points: Array<{ site: string }> } };
          return { code: refusal.code, message: refusal.message,
            points: refusal.trace?.points.map((point) => point.site) ?? [] };
        }
      };
      const directRefusal = outcome(direct, directCheck.certificate);
      deepStrictEqual(directRefusal, outcome(legacy, legacyCheck.certificate));
      assert(directRefusal.code === "E_REQUIRE" && directRefusal.points.length === 1
        && JSON.stringify(direct.body).includes('"code":"CONVERSATION_REQUIRED"'),
        `assertion did not stop before the later membership read: ${JSON.stringify(directRefusal)}`);

      const directProgram = (name: string): Program => {
        const programDeclaration = prepared.prepared.documents[1]?.programs.find((program) => program.name === name);
        assert(programDeclaration, `direct statement fixture has no ${name} operation`);
        return lowerBoundQuarryProgram(bindQuarryProgram(
          programDeclaration, prepared.prepared.catalog, prepared.prepared.documents,
        ));
      };
      const looped = directProgram("looped");
      const loopedLegacy = operation(oracle.project.programs, "ops.looped");
      const loopedCheck = rustCheck([looped], "synthetic", oracle.project.schema)[0]!;
      const loopedLegacyCheck = rustCheck([loopedLegacy], "synthetic", oracle.project.schema)[0]!;
      assert(!loopedCheck.error && loopedCheck.certificate, `direct loop did not certify: ${JSON.stringify(loopedCheck)}`);
      assert(!loopedLegacyCheck.error && loopedLegacyCheck.certificate, `loop oracle did not certify: ${JSON.stringify(loopedLegacyCheck)}`);
      deepStrictEqual(loopedCheck.certificate.read_sites, loopedLegacyCheck.certificate.read_sites);
      const loopContext: Context = { ...context(true), args: { ids: { Array: [{ Id: "conversation-1" }] } } };
      const loopExecution = new ClientStore(oracle.project.schema, receipt)
        .reexecute(looped, loopContext, loopedCheck.certificate).execution;
      const loopLegacyExecution = new ClientStore(oracle.project.schema, receipt)
        .reexecute(loopedLegacy, loopContext, loopedLegacyCheck.certificate).execution;
      assert(canonicalValue(loopExecution.result) === canonicalValue(loopLegacyExecution.result),
        `direct loop changed its implicit result: ${canonicalValue(loopExecution.result)}`);
      deepStrictEqual(loopExecution.trace.points, loopLegacyExecution.trace.points);
      const loopedPage = directProgram("loopedPage");
      const loopedPageLegacy = operation(oracle.project.programs, "ops.loopedPage");
      const loopedPageCheck = rustCheck([loopedPage], "synthetic", oracle.project.schema)[0]!;
      const loopedPageLegacyCheck = rustCheck([loopedPageLegacy], "synthetic", oracle.project.schema)[0]!;
      assert(!loopedPageCheck.error && loopedPageCheck.certificate,
        `direct bound-page loop did not certify: ${JSON.stringify(loopedPageCheck)}`);
      assert(!loopedPageLegacyCheck.error && loopedPageLegacyCheck.certificate,
        `bound-page loop oracle did not certify: ${JSON.stringify(loopedPageLegacyCheck)}`);
      deepStrictEqual(loopedPageCheck.certificate.read_sites, loopedPageLegacyCheck.certificate.read_sites);
      deepStrictEqual(loopedPageCheck.certificate.result_pages, loopedPageLegacyCheck.certificate.result_pages);
      assert(JSON.stringify(loopedPage.body).includes('"DerivedArray"'),
        `captured page loop did not retain its static bound: ${JSON.stringify(loopedPage.body)}`);

      const matched = directProgram("matched");
      const matchedLegacy = operation(oracle.project.programs, "ops.matched");
      const matchedCheck = rustCheck([matched], "synthetic", oracle.project.schema)[0]!;
      const matchedLegacyCheck = rustCheck([matchedLegacy], "synthetic", oracle.project.schema)[0]!;
      assert(!matchedCheck.error && matchedCheck.certificate, `direct match did not certify: ${JSON.stringify(matchedCheck)}`);
      assert(!matchedLegacyCheck.error && matchedLegacyCheck.certificate, `match oracle did not certify: ${JSON.stringify(matchedLegacyCheck)}`);
      deepStrictEqual(matchedCheck.certificate.read_sites, matchedLegacyCheck.certificate.read_sites);
      for (const storeReceipt of [receipt, absent]) {
        const matchContext: Context = { ...context(true), args: {
          id: { Id: storeReceipt === receipt ? "conversation-1" : "missing" },
        } };
        const matchExecution: Execution = new ClientStore(oracle.project.schema, storeReceipt)
          .reexecute(matched, matchContext, matchedCheck.certificate).execution;
        const matchLegacyExecution: Execution = new ClientStore(oracle.project.schema, storeReceipt)
          .reexecute(matchedLegacy, matchContext, matchedLegacyCheck.certificate).execution;
        assert(canonicalValue(matchExecution.result) === canonicalValue(matchLegacyExecution.result),
          `direct match changed its result: ${canonicalValue(matchExecution.result)}`);
        deepStrictEqual(matchExecution.trace.points, matchLegacyExecution.trace.points);
      }

      const narrowedDeclaration = prepared.prepared.documents[1]?.programs.find((program) => program.name === "narrowed");
      assert(narrowedDeclaration, "direct statement fixture has no narrowed operation");
      const narrowedBound = bindQuarryProgram(narrowedDeclaration, prepared.prepared.catalog, prepared.prepared.documents);
      assert(narrowedBound.result.type.kind === "text" && narrowedBound.result.presence === "required",
        `nonnull branch refinement did not reach the result join: ${JSON.stringify(narrowedBound.result)}`);
      const narrowed = lowerBoundQuarryProgram(narrowedBound);
      const narrowedLegacy = operation(oracle.project.programs, "ops.narrowed");
      const narrowedCheck = rustCheck([narrowed], "synthetic", oracle.project.schema)[0]!;
      const narrowedLegacyCheck = rustCheck([narrowedLegacy], "synthetic", oracle.project.schema)[0]!;
      assert(!narrowedCheck.error && narrowedCheck.certificate, `direct narrowed branch did not certify: ${JSON.stringify(narrowedCheck)}`);
      assert(!narrowedLegacyCheck.error && narrowedLegacyCheck.certificate,
        `narrowed branch oracle did not certify: ${JSON.stringify(narrowedLegacyCheck)}`);
      for (const [storeReceipt, id] of [[receipt, "conversation-1"], [absent, "missing"]] as const) {
        const narrowedContext: Context = { ...context(true), args: { id: { Id: id } } };
        const narrowedExecution: Execution = new ClientStore(oracle.project.schema, storeReceipt)
          .reexecute(narrowed, narrowedContext, narrowedCheck.certificate).execution;
        const narrowedLegacyExecution: Execution = new ClientStore(oracle.project.schema, storeReceipt)
          .reexecute(narrowedLegacy, narrowedContext, narrowedLegacyCheck.certificate).execution;
        assert(canonicalValue(narrowedExecution.result) === canonicalValue(narrowedLegacyExecution.result),
          `direct narrowed branch changed its result: ${canonicalValue(narrowedExecution.result)}`);
        deepStrictEqual(narrowedExecution.trace.points, narrowedLegacyExecution.trace.points);
      }

      const shadowed = directProgram("shadowed");
      const shadowedLegacy = operation(oracle.project.programs, "ops.shadowed");
      const shadowedCheck = rustCheck([shadowed], "synthetic", oracle.project.schema)[0]!;
      const shadowedLegacyCheck = rustCheck([shadowedLegacy], "synthetic", oracle.project.schema)[0]!;
      assert(!shadowedCheck.error && shadowedCheck.certificate, `direct shadowed branch did not certify: ${JSON.stringify(shadowedCheck)}`);
      assert(!shadowedLegacyCheck.error && shadowedLegacyCheck.certificate,
        `shadowed branch oracle did not certify: ${JSON.stringify(shadowedLegacyCheck)}`);
      for (const branch of [true, false]) {
        const shadowContext: Context = { ...context(true), args: { value: { Int: 4 }, branch: { Bool: branch } } };
        const shadowExecution = new ClientStore(oracle.project.schema)
          .reexecute(shadowed, shadowContext, shadowedCheck.certificate).execution;
        const shadowLegacyExecution = new ClientStore(oracle.project.schema)
          .reexecute(shadowedLegacy, shadowContext, shadowedLegacyCheck.certificate).execution;
        assert(canonicalValue(shadowExecution.result) === canonicalValue(shadowLegacyExecution.result),
          `inner local shadow changed branch ${branch}: ${canonicalValue(shadowExecution.result)}`);
      }

      const partialPageDeclaration = prepared.prepared.documents[1]?.programs.find((program) => program.name === "partialPage");
      assert(partialPageDeclaration, "direct statement fixture has no partialPage operation");
      const partialPageBound = bindQuarryProgram(partialPageDeclaration, prepared.prepared.catalog, prepared.prepared.documents);
      assert(partialPageBound.result.type.kind === "page" && partialPageBound.result.presence === "optional"
        && partialPageBound.result.tableOrigin?.name === "conversations" && partialPageBound.result.readOrigin,
        `conditional page lost independent presence: ${JSON.stringify(partialPageBound.result)}`);
      const partialPage = lowerBoundQuarryProgram(partialPageBound);
      const partialPageLegacy = operation(oracle.project.programs, "ops.partialPage");
      const partialPageCheck = rustCheck([partialPage], "synthetic", oracle.project.schema)[0]!;
      const partialPageLegacyCheck = rustCheck([partialPageLegacy], "synthetic", oracle.project.schema)[0]!;
      assert(!partialPageCheck.error && partialPageCheck.certificate,
        `direct conditional page did not certify: ${JSON.stringify(partialPageCheck)}`);
      assert(!partialPageLegacyCheck.error && partialPageLegacyCheck.certificate,
        `conditional page oracle did not certify: ${JSON.stringify(partialPageLegacyCheck)}`);
      deepStrictEqual(partialPageCheck.certificate.result_pages, partialPageLegacyCheck.certificate.result_pages);
      assert(JSON.stringify(partialPage.body.at(-1)) === '{"Return":{"Literal":"Null"}}',
        `conditional page lost its null completion: ${JSON.stringify(partialPage.body)}`);

      const sortedNew = directProgram("sortedNew");
      const sortedNewLegacy = operation(oracle.project.programs, "ops.sortedNew");
      const sortedNewCheck = rustCheck([sortedNew], "synthetic", oracle.project.schema)[0]!;
      const sortedNewLegacyCheck = rustCheck([sortedNewLegacy], "synthetic", oracle.project.schema)[0]!;
      assert(!sortedNewCheck.error && sortedNewCheck.certificate, `direct sorted tuple did not certify: ${JSON.stringify(sortedNewCheck)}`);
      assert(!sortedNewLegacyCheck.error && sortedNewLegacyCheck.certificate,
        `sorted tuple oracle did not certify: ${JSON.stringify(sortedNewLegacyCheck)}`);
      const sortedContext = (): Context => ({ viewer: "viewer-1", principal_kind: "user", auth_epoch: 1,
        args: {}, now: 1, new_ids: ["z-id", "a-id", "tail-id"], read_time: 1 });
      const sortedExecution = new ClientStore(oracle.project.schema)
        .applyMutation(sortedNew, sortedContext(), false, sortedNewCheck.certificate).execution;
      const sortedLegacyExecution = new ClientStore(oracle.project.schema)
        .applyMutation(sortedNewLegacy, sortedContext(), false, sortedNewLegacyCheck.certificate).execution;
      assert(canonicalValue(sortedExecution.result) === canonicalValue(sortedLegacyExecution.result)
        && canonicalValue(sortedExecution.result) === canonicalValue({ Array: [{ Id: "a-id" }, { Id: "z-id" }, { Id: "tail-id" }] }),
      `sorted tuple did not evaluate its actuals once left-to-right: ${canonicalValue(sortedExecution.result)}`);

      const sortedPrincipals = directProgram("sortedPrincipals");
      const sortedPrincipalsCheck = rustCheck([sortedPrincipals], "synthetic", oracle.project.schema)[0]!;
      assert(!sortedPrincipalsCheck.error && sortedPrincipalsCheck.certificate,
        `direct sorted principals did not certify: ${JSON.stringify(sortedPrincipalsCheck)}`);
      for (const [a, b, expected] of [["z", "a", ["a", "z"]], ["same", "same", ["same", "same"]]] as const) {
        const execution: Execution = new ClientStore(oracle.project.schema).reexecute(sortedPrincipals, {
          viewer: "viewer-1", principal_kind: "user", auth_epoch: 1,
          args: { a: { Id: a }, b: { Id: b } }, now: 1, new_ids: [], read_time: 1,
        }, sortedPrincipalsCheck.certificate).execution;
        deepStrictEqual(execution.result, { Array: expected.map((value) => ({ Id: value })) });
      }

      const sortedReadOrder = directProgram("sortedReadOrder");
      const sortedReadCheck = rustCheck([sortedReadOrder], "synthetic", oracle.project.schema)[0]!;
      assert(!sortedReadCheck.error && sortedReadCheck.certificate,
        `direct sorted read order did not certify: ${JSON.stringify(sortedReadCheck)}`);
      const sortedRows: ClosureReceipt = { schema_hash: sortedReadCheck.certificate.schema_hash as string,
        rows: [
          { table: "conversations", id: "left", row: { Row: { id: { Id: "left" }, title: { String: "z" } } } },
          { table: "conversations", id: "right", row: { Row: { id: { Id: "right" }, title: { String: "a" } } } },
        ], ranges: [], absences: [], verdicts: [] };
      const sortedReadContext: Context = { viewer: "viewer-1", principal_kind: "user", auth_epoch: 1,
        args: { left: { Id: "left" }, right: { Id: "right" } }, now: 1, new_ids: [], read_time: 1 };
      const sortedReadExecution = new ClientStore(oracle.project.schema, sortedRows)
        .reexecute(sortedReadOrder, sortedReadContext, sortedReadCheck.certificate).execution;
      deepStrictEqual(sortedReadExecution.result, { Array: [{ String: "a" }, { String: "z" }] });
      deepStrictEqual(sortedReadExecution.trace.points.map((point) => point.key[0]), [{ Id: "left" }, { Id: "right" }]);
      const sortedAbsences: ClosureReceipt = { schema_hash: sortedReadCheck.certificate.schema_hash as string,
        rows: [], ranges: [], absences: [
          ["conversations", "byId", [{ Id: "left" }]], ["conversations", "byId", [{ Id: "right" }]],
        ], verdicts: [] };
      let sortedFailure: { code?: string; authoredCode?: string; trace?: { points: Array<{ key: Value[] }> } } | undefined;
      try {
        new ClientStore(oracle.project.schema, sortedAbsences)
          .reexecute(sortedReadOrder, sortedReadContext, sortedReadCheck.certificate);
      } catch (error) {
        sortedFailure = error as typeof sortedFailure;
      }
      assert(sortedFailure?.code === "E_REQUIRE" && sortedFailure.authoredCode === "LEFT_MISSING",
        `sorted evaluated its right actual before the left refusal: ${JSON.stringify(sortedFailure)}`);
      deepStrictEqual(sortedFailure.trace?.points.map((point) => point.key[0]), [{ Id: "left" }]);
    });

    const incompatibleSorted = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: `query invalid(a: principal, b: int):
  (first, second) = sorted(a, b)
  return first
` },
    ]);
    assert(!incompatibleSorted.ok && diagnosticsText(incompatibleSorted.diagnostics).includes("compatible ordered operands"),
      `sorted admitted incompatible nominal operands: ${incompatibleSorted.ok ? "compiled" : diagnosticsText(incompatibleSorted.diagnostics)}`);

    const joinInputs: QuarryInput[] = [
      { path: "/virtual/snapback/schema.q", fileName: "snapback/schema.q", source: schema },
      { path: "/virtual/snapback/joins.q", fileName: "snapback/joins.q", source: `query joined(flag: bool, narrowText: text 2..20 format handle, wideText: text <=80, narrowBytes: bytes <=10, wideBytes: bytes <=100, narrowImage: image <=20, wideImage: image <=200, narrowVideo: video <=30, wideVideo: video <=300, narrowJson: json <=40, wideJson: json <=400):
  if flag:
    return { text: narrowText, bytes: narrowBytes, image: narrowImage, video: narrowVideo, json: narrowJson }
  return { text: wideText, bytes: wideBytes, image: wideImage, video: wideVideo, json: wideJson }
` },
    ];
    const joinsPrepared = prepareQuarry(joinInputs);
    assert(joinsPrepared.ok, `join refinement fixture did not prepare: ${JSON.stringify(joinsPrepared.ok ? [] : joinsPrepared.diagnostics)}`);
    const joinsDeclaration = joinsPrepared.prepared.documents[1]?.programs[0];
    assert(joinsDeclaration, "join refinement fixture has no operation");
    const joinedResult = bindQuarryProgram(
      joinsDeclaration, joinsPrepared.prepared.catalog, joinsPrepared.prepared.documents,
    ).result.type;
    assert(joinedResult.kind === "object", `join refinement result is not an object: ${JSON.stringify(joinedResult)}`);
    const joinedText = joinedResult.fields.get("text")?.type;
    assert(joinedText?.kind === "text" && joinedText.max === 80 && joinedText.min === undefined && joinedText.format === undefined,
      `text join retained a one-branch refinement: ${JSON.stringify(joinedText)}`);
    for (const [name, max] of [["bytes", 100], ["image", 200], ["video", 300], ["json", 400]] as const) {
      const type = joinedResult.fields.get(name)?.type;
      assert(type?.kind === name && type.max === max, `${name} join kept the left maximum: ${JSON.stringify(type)}`);
    }

    const nameInputs: QuarryInput[] = [
      { path: "/virtual/snapback/schema.q", fileName: "snapback/schema.q", source: schema },
      { path: "/virtual/snapback/names.q", fileName: "snapback/names.q", source: `query names(value: int):
  __operand0 = value + 1
  __bound_localValue_0 = __operand0 * 2
  return __bound_localValue_0

query loopNames(values: [int] <=3):
  for __bound_loopItem_0 in values:
    require __bound_loopItem_0 >= 0 else NONNEGATIVE

query matchNames(id: conversations):
  __bound_matchRow_0 = conversations[id]
  if __bound_matchRow_0 != null:
    return __bound_matchRow_0.title
  else:
    return null
` },
    ];
    const namesPrepared = prepareQuarry(nameInputs);
    assert(namesPrepared.ok, `direct local-name preparation failed: ${JSON.stringify(namesPrepared.ok ? [] : namesPrepared.diagnostics)}`);
    const namePrograms = namesPrepared.prepared.documents[1]?.programs ?? [];
    assert(namePrograms.length === 3, "direct local-name fixture lost an operation");
    const loweredNamePrograms = namePrograms.map((nameProgram) => lowerBoundQuarryProgram(bindQuarryProgram(
      nameProgram, namesPrepared.prepared.catalog, namesPrepared.prepared.documents,
    )));
    const namesIr = JSON.stringify(loweredNamePrograms.find((program) => program.name === "names.names")?.body);
    const loopNamesIr = JSON.stringify(loweredNamePrograms.find((program) => program.name === "names.loopNames")?.body);
    const matchNamesIr = JSON.stringify(loweredNamePrograms.find((program) => program.name === "names.matchNames")?.body);
    assert(!namesIr.includes('"Variable":"__operand0"') && !namesIr.includes('"Variable":"__bound_localValue_0"')
      && !namesIr.includes('"name":"__operand0"') && !namesIr.includes('"name":"__bound_localValue_0"'),
    `authored local names escaped their bound symbol identities: ${namesIr}`);
    assert(!loopNamesIr.includes('"Variable":"__bound_loopItem_0"') && !loopNamesIr.includes('"binding":"__bound_loopItem_0"'),
      `authored loop name escaped its bound symbol identity: ${loopNamesIr}`);
    assert(!matchNamesIr.includes('"Variable":"__bound_matchRow_0"') && !matchNamesIr.includes('"name":"__bound_matchRow_0"'),
      `authored match name escaped its bound symbol identity: ${matchNamesIr}`);

    const partial = prepareQuarry([
      { path: "/virtual/snapback/schema.q", fileName: "snapback/schema.q", source: schema },
      { path: "/virtual/snapback/partial.q", fileName: "snapback/partial.q", source: `query partial(flag: bool):
  if flag:
    return 1
` },
    ]);
    assert(partial.ok, `partial-return fixture did not prepare: ${JSON.stringify(partial.ok ? [] : partial.diagnostics)}`);
    const partialDeclaration = partial.prepared.documents[1]?.programs[0];
    assert(partialDeclaration, "partial-return fixture has no operation");
    const partialBound = bindQuarryProgram(partialDeclaration, partial.prepared.catalog, partial.prepared.documents);
    const partialDirect = lowerBoundQuarryProgram(partialBound);
    assert(partialBound.result.type.kind === "int" && partialBound.result.presence === "optional"
      && JSON.stringify(partialDirect.body.at(-1)) === '{"Return":{"Literal":"Null"}}',
    `partial conditional did not retain its implicit null completion: ${JSON.stringify({ result: partialBound.result, body: partialDirect.body })}`);
  });

  test("direct Quarry names do not inherit generated TypeScript restrictions", () => {
    const inputs: QuarryInput[] = [
      { path: "/virtual/snapback/schema.q", fileName: "snapback/schema.q", source: "table rows:\n  public\n" },
      { path: "/virtual/snapback/names.q", fileName: "snapback/names.q", source: "query class(default: int):\n  return default\n" },
    ];
    const prepared = prepareQuarry(inputs);
    assert(prepared.ok, `direct Quarry retained emitter name restrictions: ${JSON.stringify(prepared.ok ? [] : prepared.diagnostics)}`);
    const declaration = prepared.prepared.documents[1]?.programs[0];
    assert(declaration, "direct name fixture has no operation");
    const direct = lowerBoundQuarryProgram(bindQuarryProgram(declaration, prepared.prepared.catalog));
    deepStrictEqual(direct, {
      name: "names.class", kind: "Query", args: { default: "Int" }, read_time_granularity_ms: null,
      body: [{ Return: { Variable: "default" } }],
    });
    for (const name of ["words", "tokens", "range", "min", "max", "count", "divmod", "share"]) {
      const builtinNamed = prepareQuarry([
        { path: "/virtual/snapback/schema.q", fileName: "snapback/schema.q", source: `table ${name}:\n  public\n` },
        { path: "/virtual/snapback/names.q", fileName: "snapback/names.q", source: `query one():\n  return ${name}[] first 1 by byId\n` },
      ]);
      assert(builtinNamed.ok, `${name} retained a deleted generated-TypeScript collision: ${JSON.stringify(builtinNamed.ok ? [] : builtinNamed.diagnostics)}`);
    }
  });

  test("direct Quarry elaborates an imported named row shape with definition and use sites", async () => {
    const schema = `table profiles:
  principal: principal
  displayName: text <=80
  handle: text <=40
  unique byPrincipal: principal
  public
`;
    const cards = "shape authorCard = { displayName, handle }\n";
    const profile = `shape authorCard from cards

query byPrincipal(principal: principal):
  return profiles[principal] authorCard
`;
    await withProject({
      "snapback/schema.q": schema,
      "snapback/cards.q": cards,
      "snapback/profile.q": profile,
    }, async (root) => {
      const inputs: QuarryInput[] = ["schema", "cards", "profile"].map((stem) => {
        const path = join(root, "snapback", `${stem}.q`);
        return { path, fileName: `snapback/${stem}.q`, source: readFileSync(path, "utf8") };
      });
      const prepared = prepareQuarry(inputs);
      assert(prepared.ok, `direct named-shape preparation failed: ${JSON.stringify(prepared.ok ? [] : prepared.diagnostics)}`);
      const declaration = prepared.prepared.documents[2]?.programs[0];
      assert(declaration, "direct named-shape fixture has no operation");
      const bound = bindQuarryProgram(declaration, prepared.prepared.catalog, prepared.prepared.documents);
      const statement = bound.body[0];
      assert(statement?.kind === "return", `named-shape operation did not bind its return: ${JSON.stringify(statement)}`);
      const shape = statement.value;
      assert(shape.kind === "shape" && shape.fields.length === 2, `named shape did not elaborate once: ${JSON.stringify(shape)}`);
      assert(shape.fields.every((field) => field.source.definition.file === "snapback/cards.q"
        && field.source.use?.file === "snapback/profile.q" && field.source.use.line === 4),
      `named shape lost definition/use source stacks: ${JSON.stringify(shape.fields.map((field) => field.source))}`);

      const direct = lowerBoundQuarryProgram(bound);
      const oracle = await lowerProject(root);
      assert(oracle.ok, `named-shape oracle failed: ${oracle.ok ? "" : diagnosticsText(oracle.diagnostics)}`);
      const legacy = operation(oracle.project.programs, "profile.byPrincipal");
      const directCheck = rustCheck([direct], "synthetic", oracle.project.schema)[0]!;
      const legacyCheck = rustCheck([legacy], "synthetic", oracle.project.schema)[0]!;
      assert(!directCheck.error && directCheck.certificate, `direct named shape did not certify: ${JSON.stringify(directCheck)}`);
      assert(!legacyCheck.error && legacyCheck.certificate, `named-shape oracle did not certify: ${JSON.stringify(legacyCheck)}`);
      const receipt: ClosureReceipt = {
        schema_hash: directCheck.certificate.schema_hash as string,
        rows: [{ table: "profiles", id: "profile-1", row: { Row: {
          id: { Id: "profile-1" }, principal: { Id: "principal-1" },
          displayName: { String: "Ada" }, handle: { String: "ada" },
        } } }],
        ranges: [], absences: [], verdicts: [],
      };
      const context: Context = { viewer: "viewer-1", principal_kind: "user", auth_epoch: 1,
        args: { principal: { Id: "principal-1" } }, now: 1, new_ids: [], read_time: 1 };
      const directExecution = new ClientStore(oracle.project.schema, receipt)
        .reexecute(direct, context, directCheck.certificate).execution;
      const legacyExecution = new ClientStore(oracle.project.schema, receipt)
        .reexecute(legacy, context, legacyCheck.certificate).execution;
      deepStrictEqual(directExecution.result, legacyExecution.result);
      const observableTrace = (trace: typeof directExecution.trace) => ({
        points: trace.points, ranges: trace.ranges, absences: trace.absences,
        merges: trace.merges, verdicts: trace.verdicts, examined: trace.examined, rows: trace.rows,
      });
      deepStrictEqual(observableTrace(directExecution.trace), observableTrace(legacyExecution.trace));
    });
  });

  test("direct Quarry expression fn calls preserve call-by-value, provenance, and source stacks", async () => {
    const schema = `table conversations:
  public

table memberships:
  conversation: conversations
  principal: principal
  unique byConversationPrincipal: conversation, principal
  public
`;
    const access = `fn isMember(c: conversations, p: principal): exists memberships[c, p]
fn choose(p: principal, ignored: id): p
`;
    const operations = `fn isMember from access
fn choose from access
query member(c: conversations, p: principal):
  return isMember(c, p)
mutation consumeOnce(p: principal):
  return choose(p, new)
`;
    await withProject({
      "snapback/schema.q": schema,
      "snapback/access.q": access,
      "snapback/ops.q": operations,
    }, async (root) => {
      const inputs: QuarryInput[] = ["schema", "access", "ops"].map((stem) => {
        const path = join(root, "snapback", `${stem}.q`);
        return { path, fileName: `snapback/${stem}.q`, source: readFileSync(path, "utf8") };
      });
      const prepared = prepareQuarry(inputs);
      assert(prepared.ok, `direct fn preparation failed: ${JSON.stringify(prepared.ok ? [] : prepared.diagnostics)}`);
      const declaration = prepared.prepared.documents[2]?.programs.find((program) => program.name === "member");
      assert(declaration, "direct fn fixture has no member operation");
      const bound = bindQuarryProgram(declaration, prepared.prepared.catalog, prepared.prepared.documents);
      const statement = bound.body[0];
      assert(statement?.kind === "return", `fn operation did not bind its return: ${JSON.stringify(statement)}`);
      const invocation = statement.value;
      assert(invocation.kind === "invoke" && invocation.body.source.definition.file === "snapback/access.q"
        && invocation.body.source.use?.file === "snapback/ops.q" && invocation.bindings.length === 2,
      `direct fn lost its imported definition/use stack or parameters: ${JSON.stringify(invocation)}`);
      const direct = lowerBoundQuarryProgram(bound);

      await withProject({
        "snapback/schema.q": schema,
        "snapback/ops.q": `query member(c: conversations, p: principal):
  return exists memberships[c, p]
`,
      }, async (inlineRoot) => {
        const oracle = await lowerProject(inlineRoot);
        assert(oracle.ok, `inlined fn oracle failed: ${oracle.ok ? "" : diagnosticsText(oracle.diagnostics)}`);
        const legacy = operation(oracle.project.programs, "ops.member");
        const checked = rustCheck([direct], "synthetic", oracle.project.schema)[0]!;
        const legacyCheck = rustCheck([legacy], "synthetic", oracle.project.schema)[0]!;
        assert(!checked.error && checked.certificate, `direct fn did not certify: ${JSON.stringify(checked)}`);
        assert(!legacyCheck.error && legacyCheck.certificate, `inlined fn oracle did not certify: ${JSON.stringify(legacyCheck)}`);
        deepStrictEqual(checked.certificate.read_sites, legacyCheck.certificate.read_sites);
        const receipt: ClosureReceipt = {
          schema_hash: checked.certificate.schema_hash as string,
          rows: [], ranges: [], verdicts: [],
          absences: [["memberships", "byConversationPrincipal", [{ Id: "conversation-1" }, { Id: "principal-1" }]]],
        };
        const context: Context = { viewer: "viewer-1", principal_kind: "user", auth_epoch: 1,
          args: { c: { Id: "conversation-1" }, p: { Id: "principal-1" } }, now: 1, new_ids: [], read_time: 1 };
        const actual = new ClientStore(oracle.project.schema, receipt).reexecute(direct, context, checked.certificate).execution;
        const expected = new ClientStore(oracle.project.schema, receipt).reexecute(legacy, context, legacyCheck.certificate).execution;
        deepStrictEqual(actual.result, expected.result);
        deepStrictEqual(actual.trace.points, expected.trace.points);

        const mutationDeclaration = prepared.prepared.documents[2]?.programs.find((program) => program.name === "consumeOnce");
        assert(mutationDeclaration, "direct fn fixture has no consumeOnce operation");
        const mutation = lowerBoundQuarryProgram(bindQuarryProgram(
          mutationDeclaration, prepared.prepared.catalog, prepared.prepared.documents,
        ));
        const mutationCheck = rustCheck([mutation], "synthetic", oracle.project.schema)[0]!;
        assert(!mutationCheck.error && mutationCheck.certificate, `direct call-by-value fn did not certify: ${JSON.stringify(mutationCheck)}`);
        const mutationContext = (newIds: string[]): Context => ({
          viewer: "viewer-1", principal_kind: "user", auth_epoch: 1,
          args: { p: { Id: "principal-1" } }, now: 1, new_ids: newIds, read_time: 1,
        });
        const consumed = new ClientStore(oracle.project.schema)
          .applyMutation(mutation, mutationContext(["fresh-1"]), false, mutationCheck.certificate).execution;
        deepStrictEqual(consumed.result, { Id: "principal-1" });
        let refusal: { code?: string } | undefined;
        try {
          new ClientStore(oracle.project.schema)
            .applyMutation(mutation, mutationContext([]), false, mutationCheck.certificate);
        } catch (error) { refusal = error as { code?: string }; }
        assert(refusal?.code === "E_INPUT", `unused fn argument did not evaluate exactly once: ${JSON.stringify(refusal)}`);
      });
    });
  });

  test("direct Quarry fn scopes are hygienic, module-local, pure, and row-ref typed", async () => {
    const ambientNamedParameters = compileInline([
      { fileName: "snapback/schema.q", source: "table rows:\n  value: int\n  public\n" },
      { fileName: "snapback/ops.q", source: `fn echoNow(now: int): now
fn echoCommit(commit: int): commit
fn echoNew(new: int): new
fn echoViewer(viewer: int): viewer
mutation explicitAmbientNames():
  return { now: echoNow(1), commit: echoCommit(2), new: echoNew(3), viewer: echoViewer(4) }
` },
    ]);
    assert(ambientNamedParameters.ok,
      `explicit fn parameters were mistaken for ambient inputs: ${ambientNamedParameters.ok ? "" : diagnosticsText(ambientNamedParameters.diagnostics)}`);
    if (ambientNamedParameters.ok) {
      const body = JSON.stringify(ambientNamedParameters.project.programs[0]?.body);
      assert(body.includes('"Int":1') && body.includes('"Int":4')
        && !body.includes('"input":"Now"') && !body.includes('"input":"NewId"'),
      `explicit ambient-named fn parameters did not lower from their actuals: ${body}`);
    }
    const nestedContext = compileInline([
      { fileName: "snapback/schema.q", source: "table nodes:\n  value: int\n  public\n" },
      { fileName: "snapback/ops.q", source: `shape card = { who: viewer }
fn direct(viewer: principal): viewer
fn shaped(node: nodes, viewer: principal): node card
query context(id: nodes, supplied: principal):
  return { direct: direct(supplied), nested: shaped(id, supplied) }
` },
    ]);
    assert(nestedContext.ok,
      `named-shape ambient viewer control refused: ${nestedContext.ok ? "" : diagnosticsText(nestedContext.diagnostics)}`);
    if (nestedContext.ok) {
      const program = operation(nestedContext.project.programs, "ops.context");
      const checked = rustCheck([program], "synthetic", nestedContext.project.schema)[0]!;
      assert(!checked.error && checked.certificate,
        `named-shape ambient viewer control did not certify: ${JSON.stringify(checked)}`);
      const receipt: ClosureReceipt = { rows: [{ table: "nodes", id: "node-1", row: {
        Row: { id: { Id: "node-1" }, value: { Int: 1 } },
      } }], ranges: [], absences: [], verdicts: [] };
      const context: Context = { viewer: "viewer-1", principal_kind: "user", auth_epoch: 1,
        args: { id: { Id: "node-1" }, supplied: { Id: "supplied-1" } }, now: 1, new_ids: [], read_time: 1 };
      const execution = new ClientStore(nestedContext.project.schema, receipt)
        .reexecute(program, context, checked.certificate).execution;
      deepStrictEqual(canonicalValue(execution.result), canonicalValue({ Row: {
        direct: { Id: "supplied-1" }, nested: { Row: { who: { Id: "viewer-1" } } },
      } }));
    }
    const schema = `table nodes:
  label: text <=40
  public
`;
    const cards = `fn isKnown(node: nodes): exists nodes[node]
shape card = { id, label, known: isKnown(.) }
`;
    const operations = `shape card from cards

query node(id: nodes):
  return nodes[id] card

fn add(left: int, right: int): left + right
query hygienic(__operand0: int, __bound_fnArgument_0: int):
  return { sum: add(__operand0, __bound_fnArgument_0) }
`;
    await withProject({
      "snapback/schema.q": schema,
      "snapback/cards.q": cards,
      "snapback/ops.q": operations,
    }, async (root) => {
      const inputs: QuarryInput[] = ["schema", "cards", "ops"].map((stem) => {
        const path = join(root, "snapback", `${stem}.q`);
        return { path, fileName: `snapback/${stem}.q`, source: readFileSync(path, "utf8") };
      });
      const prepared = prepareQuarry(inputs);
      assert(prepared.ok, `direct fn hygiene preparation failed: ${JSON.stringify(prepared.ok ? [] : prepared.diagnostics)}`);
      const nodeDeclaration = prepared.prepared.documents[2]?.programs.find((program) => program.name === "node");
      assert(nodeDeclaration, "direct fn hygiene fixture has no node operation");
      const nodeBound = bindQuarryProgram(nodeDeclaration, prepared.prepared.catalog, prepared.prepared.documents);
      const statement = nodeBound.body[0];
      assert(statement?.kind === "return", `fn hygiene operation did not bind its return: ${JSON.stringify(statement)}`);
      const nodeShape = statement.value;
      assert(nodeShape.kind === "shape", `imported card did not bind as a shape: ${JSON.stringify(nodeShape)}`);
      const known = nodeShape.fields.find((field) => field.name === "known")?.value;
      assert(known?.kind === "invoke" && known.bindings[0]?.coercion === "row-id"
        && known.body.kind === "exists" && known.body.source.definition.file === "snapback/cards.q",
      `shape-local fn did not resolve in its defining module or coerce the focal row once: ${JSON.stringify(known)}`);
      const direct = lowerBoundQuarryProgram(nodeBound);
      let runtimeSchema: SchemaJson | undefined;

      await withProject({
        "snapback/schema.q": schema,
        "snapback/cards.q": "shape card = { id, label, known: exists nodes[.id] }\n",
        "snapback/ops.q": `shape card from cards

query node(id: nodes):
  return nodes[id] card
`,
      }, async (inlineRoot) => {
        const oracle = await lowerProject(inlineRoot);
        assert(oracle.ok, `inlined row-ref fn oracle failed: ${oracle.ok ? "" : diagnosticsText(oracle.diagnostics)}`);
        runtimeSchema = oracle.project.schema;
        const legacy = operation(oracle.project.programs, "ops.node");
        const directCheck = rustCheck([direct], "synthetic", oracle.project.schema)[0]!;
        const legacyCheck = rustCheck([legacy], "synthetic", oracle.project.schema)[0]!;
        assert(!directCheck.error && directCheck.certificate, `row-ref fn did not certify: ${JSON.stringify(directCheck)}`);
        assert(!legacyCheck.error && legacyCheck.certificate, `row-ref oracle did not certify: ${JSON.stringify(legacyCheck)}`);
        deepStrictEqual(directCheck.certificate.read_sites, legacyCheck.certificate.read_sites);
        const receipt: ClosureReceipt = {
          schema_hash: directCheck.certificate.schema_hash as string,
          rows: [{ table: "nodes", id: "node-1", row: { Row: {
            id: { Id: "node-1" }, label: { String: "first" },
          } } }],
          ranges: [], absences: [], verdicts: [],
        };
        const context: Context = { viewer: "viewer-1", principal_kind: "user", auth_epoch: 1,
          args: { id: { Id: "node-1" } }, now: 1, new_ids: [], read_time: 1 };
        const actual = new ClientStore(oracle.project.schema, receipt)
          .reexecute(direct, context, directCheck.certificate).execution;
        const expected = new ClientStore(oracle.project.schema, receipt)
          .reexecute(legacy, context, legacyCheck.certificate).execution;
        deepStrictEqual(actual.result, expected.result);
        deepStrictEqual(actual.trace.points, expected.trace.points);
      });

      const hygieneDeclaration = prepared.prepared.documents[2]?.programs.find((program) => program.name === "hygienic");
      assert(hygieneDeclaration, "direct fn hygiene fixture has no hygienic operation");
      const hygienic = lowerBoundQuarryProgram(bindQuarryProgram(
        hygieneDeclaration, prepared.prepared.catalog, prepared.prepared.documents,
      ));
      const declaredNames = (value: unknown): string[] => {
        if (Array.isArray(value)) return value.flatMap(declaredNames);
        if (!value || typeof value !== "object") return [];
        const record = value as Record<string, unknown>;
        const own = ["Const", "Let", "For"].flatMap((kind) => {
          const declaration = record[kind];
          return declaration && typeof declaration === "object" && "name" in declaration
            ? [String((declaration as { name: unknown }).name)]
            : declaration && typeof declaration === "object" && kind === "For" && "binding" in declaration
              ? [String((declaration as { binding: unknown }).binding)] : [];
        });
        return [...own, ...Object.values(record).flatMap(declaredNames)];
      };
      const generatedNames = declaredNames(hygienic.body);
      assert(!generatedNames.includes("__operand0") && !generatedNames.includes("__bound_fnArgument_0"),
        `direct temps collided with legal authored args: ${JSON.stringify(generatedNames)}`);
      assert(runtimeSchema, "row-ref oracle did not expose its compiled schema");
      const checked = rustCheck([hygienic], "synthetic", runtimeSchema)[0]!;
      assert(!checked.error && checked.certificate, `hygienic fn did not certify: ${JSON.stringify(checked)}`);
      const context: Context = { viewer: "viewer-1", principal_kind: "user", auth_epoch: 1,
        args: { __operand0: { Int: 2 }, __bound_fnArgument_0: { Int: 3 } }, now: 1, new_ids: [], read_time: 1 };
      const execution = new ClientStore(runtimeSchema).reexecute(hygienic, context, checked.certificate).execution;
      assert(canonicalValue(execution.result) === canonicalValue({ Row: { sum: { Int: 5 } } }),
        `hygienic fn evaluated through a shadowed temp: ${canonicalValue(execution.result)}`);
    });

    const refusal = (cardsSource: string, operationSource: string) => {
      const prepared = prepareQuarry([
        { path: "/virtual/snapback/schema.q", fileName: "snapback/schema.q", source: schema },
        { path: "/virtual/snapback/cards.q", fileName: "snapback/cards.q", source: cardsSource },
        { path: "/virtual/snapback/ops.q", fileName: "snapback/ops.q", source: operationSource },
      ]);
      assert(prepared.ok, `fn scope refusal did not prepare: ${JSON.stringify(prepared.ok ? [] : prepared.diagnostics)}`);
      const declaration = prepared.prepared.documents[2]?.programs[0];
      assert(declaration, "fn scope refusal has no operation");
      try {
        bindQuarryProgram(declaration, prepared.prepared.catalog, prepared.prepared.documents);
      } catch (error) {
        return (error as { diagnostic?: { code: string; message: string; file: string; line: number;
          expandedFrom?: { file: string; line: number } } }).diagnostic;
      }
      return undefined;
    };
    const focalCapture = refusal(
      "fn leak(): .id\nshape card = { leaked: leak() }\n",
      "shape card from cards\nquery node(id: nodes):\n  return nodes[id] card\n",
    );
    assert(focalCapture?.code === "E_QUARRY_UNKNOWN" && focalCapture.message.includes("focal ."),
      `fn captured its caller shape focal: ${JSON.stringify(focalCapture)}`);
    const callerNew = refusal(
      "shape leaking = { generated: new }\nfn leak(node: nodes): node leaking\n",
      "fn leak from cards\nmutation node(id: nodes):\n  return leak(id)\n",
    );
    assert(callerNew?.code === "E_QUARRY_UNSUPPORTED" && callerNew.message.includes("new is mutation-only caller state"),
      `fn acquired caller new through a named shape: ${JSON.stringify(callerNew)}`);
    for (const clock of ["now", "commit"] as const) {
      const mutationTime = refusal(
        `fn clock(): ${clock}\n`,
        "fn clock from cards\nmutation node(id: nodes):\n  return clock()\n",
      );
      assert(mutationTime?.code === "E_QUARRY_UNSUPPORTED" && mutationTime.message.includes("read-pure"),
        `fn acquired caller ${clock} time through a mutation: ${JSON.stringify(mutationTime)}`);
    }
    const jobTime = refusal(
      "fn clock(): now\n",
      "fn clock from cards\njob node():\n  chunk row in nodes first 1 by byId:\n    update nodes[row.id] { label: clock() }\n",
    );
    assert(jobTime?.code === "E_QUARRY_UNSUPPORTED" && jobTime.message.includes("read-pure"),
      `fn acquired job commit time: ${JSON.stringify(jobTime)}`);
    const queryTime = refusal(
      "fn clock(): now\n",
      "fn clock from cards\nquery node(id: nodes):\n  return clock()\n",
    );
    assert(queryTime === undefined, `fn could not use query read time: ${JSON.stringify(queryTime)}`);

    const callerAssertion = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: `fn find(node: nodes): nodes[node]
query required(id: nodes):
  return find(id)! else NOT_FOUND
` },
    ]);
    assert(callerAssertion.ok,
      `caller-side assertion of a helper result was refused: ${callerAssertion.ok ? "" : diagnosticsText(callerAssertion.diagnostics)}`);
    if (callerAssertion.ok) {
      const required = operation(callerAssertion.project.programs, "ops.required");
      assert(JSON.stringify(required.body).includes('"code":"NOT_FOUND"'),
        `caller-side assertion did not lower a requirement: ${JSON.stringify(required.body)}`);
      const requiredCheck = rustCheck([required], "synthetic", callerAssertion.project.schema)[0]!;
      assert(!requiredCheck.error && requiredCheck.certificate,
        `caller-side helper assertion did not certify: ${JSON.stringify(requiredCheck)}`);
    }
    const helperAssertion = refusal(
      "fn find(node: nodes): nodes[node]! else NOT_FOUND\n",
      "fn find from cards\nquery node(id: nodes):\n  return find(id)\n",
    );
    assert(helperAssertion?.code === "E_QUARRY_UNSUPPORTED" && helperAssertion.message.includes("cannot assert authorization")
      && helperAssertion.file === "snapback/cards.q" && helperAssertion.line === 1
      && helperAssertion.expandedFrom?.file === "snapback/ops.q" && helperAssertion.expandedFrom.line === 3,
    `fn assertion lost its definition/use provenance or escaped purity: ${JSON.stringify(helperAssertion)}`);
  });

  test("direct Quarry shares shape recursion and depth guards with nested field uses", () => {
    const schema = `table nodes:
  parent: nodes ?
  public
`;
    const refusal = (source: string) => {
      const prepared = prepareQuarry([
        { path: "/virtual/snapback/schema.q", fileName: "snapback/schema.q", source: schema },
        { path: "/virtual/snapback/shapes.q", fileName: "snapback/shapes.q", source },
      ]);
      assert(prepared.ok, `shape guard fixture did not prepare: ${JSON.stringify(prepared.ok ? [] : prepared.diagnostics)}`);
      const declaration = prepared.prepared.documents[1]?.programs[0];
      assert(declaration, "shape guard fixture has no operation");
      try {
        bindQuarryProgram(declaration, prepared.prepared.catalog, prepared.prepared.documents);
      } catch (error) {
        return (error as { diagnostic?: { code: string; message: string } }).diagnostic;
      }
      return undefined;
    };
    const nestedCycle = refusal(`shape recursive = { parent: .parent recursive }
query node(seed: nodes):
  return seed recursive
`);
    assert(nestedCycle?.code === "E_QUARRY_UNSUPPORTED" && nestedCycle.message.includes("shape cycle"),
      `nested field shape cycle escaped the expansion guard: ${JSON.stringify(nestedCycle)}`);
    const spreadCycle = refusal(`shape recursive = { ...recursive }
query node(seed: nodes):
  return seed recursive
`);
    assert(spreadCycle?.code === "E_QUARRY_UNSUPPORTED" && spreadCycle.message.includes("shape cycle"),
      `named spread cycle escaped the expansion guard: ${JSON.stringify(spreadCycle)}`);
    const chain = Array.from({ length: 9 }, (_, index) => {
      const number = index + 1;
      return number === 9 ? `shape s${number} = { parent }` : `shape s${number} = { parent: .parent s${number + 1} }`;
    }).join("\n");
    const depth = refusal(`${chain}
query node(seed: nodes):
  return seed s1
`);
    assert(depth?.code === "E_QUARRY_UNSUPPORTED" && depth.message.includes("exceeds depth 8"),
      `nested field shape depth escaped the shared expansion guard: ${JSON.stringify(depth)}`);
    const crossCycle = refusal(`shape recursive = { parent: bounce(.) }
fn bounce(node: nodes): node recursive
query node(seed: nodes):
  return seed recursive
`);
    assert(crossCycle?.code === "E_QUARRY_UNSUPPORTED" && crossCycle.message.includes("shape cycle"),
      `cross fn/shape cycle escaped the shared expansion guard: ${JSON.stringify(crossCycle)}`);
    const functions = Array.from({ length: 9 }, (_, index) => {
      const number = index + 1;
      return number === 9 ? `fn f${number}(n: int): n` : `fn f${number}(n: int): f${number + 1}(n)`;
    }).join("\n");
    const functionDepth = refusal(`${functions}
query node(n: int):
  return f1(n)
`);
    assert(functionDepth?.code === "E_QUARRY_UNSUPPORTED" && functionDepth.message.includes("exceeds depth 8"),
      `fn depth escaped the shared expansion guard: ${JSON.stringify(functionDepth)}`);
  });

}
