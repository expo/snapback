import { deepStrictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalValue, ClientStore, type ClosureReceipt, type Context, type Value } from "../../evaluator/src/evaluator";
import type { Execution } from "../../evaluator/src/types";
import type { Program } from "./ir";
import { lowerProject } from "./project";
import { rustCheck, type RustCheckResult } from "./rust-check";
import { bindQuarryProgram } from "./quarry/bound";
import { lowerBoundQuarryProgram } from "./quarry/direct";
import { prepareQuarry, type QuarryInput } from "./quarry/index";
import { assert, diagnosticsText, operation, type Test, withProject } from "./quarry-check-helpers";

export function registerQuarryDirectMutationChecks(test: Test, frontend: string): void {
  test("direct Quarry mutations preserve write results, focal reads, and discarded-write authority", async () => {
    const schema = `table owners:
  label: text <=40
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny

table rows:
  owner: principal
  related: owners ?
  sibling: rows ?
  label: text <=40
  count: int
  unique byOwner: owner
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
`;
    const operations = `mutation add(owner: principal):
  insert rows { owner, label: 'made', count: 0 }

mutation allocated(owner: principal, secondOwner: principal):
  first = insert rows { owner, sibling: new, label: 'first', count: 0 }
  second = insert rows { owner: secondOwner, sibling: first.id, label: 'second', count: 0 }
  return { firstId: first.id, fieldId: first.sibling, secondId: second.id }

mutation explicit(id: id, owner: principal):
  row = insert rows { id, owner, sibling: new, label: 'explicit', count: 0 }
  return { rowId: row.id, fieldId: row.sibling }

mutation joined(ids: [rows] <=2 ?):
  chosen = ids ?? [new, new]
  return { chosen, next: new }

mutation blind(id: rows):
  update rows[id] { label: 'blind' }
  return true

mutation direct(id: rows):
  return update rows[id] { label: 'direct' }

mutation focal(id: rows):
  update rows[id] { count: .count + 1 }

mutation indexed(owner: principal):
  return update rows[owner] { label: 'indexed' }

mutation ensure(id: rows, owner: principal):
  return upsert rows[id] { owner, label: 'ensured', count: (.count ?? 0) + 1 }

mutation ensureIndexed(owner: principal):
  return upsert rows[owner] { label: 'ensured', count: (.count ?? 0) + 1 }

mutation focalNested(id: rows):
  return update rows[id] { label: owners[.related! else RELATED_REQUIRED]! else OWNER_REQUIRED .label }

mutation snapshots(id: rows):
  return { first: update rows[id] { count: 1 }, second: update rows[id] { count: 2 } }

mutation remove(id: rows):
  delete rows[id]
  return true

mutation afterLoop(id: rows):
  alias = id
  for ordinal in range(0, 1):
    require ordinal >= 0 else NEGATIVE
  delete rows[alias]

mutation branch(owner: principal, flag: bool):
  if flag:
    insert rows { owner, label: 'left', count: 1 }
  else:
    insert rows { owner, label: 'right', count: 2 }
`;
    await withProject({ "snapback/schema.q": schema, "snapback/writes.q": operations }, async (root) => {
      const inputs: QuarryInput[] = ["schema", "writes"].map((stem) => {
        const path = join(root, "snapback", `${stem}.q`);
        return { path, fileName: `snapback/${stem}.q`, source: readFileSync(path, "utf8") };
      });
      const prepared = prepareQuarry(inputs);
      assert(prepared.ok, `direct mutation preparation failed: ${JSON.stringify(prepared.ok ? [] : prepared.diagnostics)}`);
      const oracle = await lowerProject(root);
      assert(oracle.ok, `mutation parity oracle failed: ${oracle.ok ? "" : diagnosticsText(oracle.diagnostics)}`);
      const declarations = prepared.prepared.documents.find((document) => document.file === "snapback/writes.q")!.programs;
      const direct = new Map(declarations.map((declaration) => [declaration.name,
        lowerBoundQuarryProgram(bindQuarryProgram(declaration, prepared.prepared.catalog, prepared.prepared.documents))]));
      const checks = new Map([...direct].map(([name, program]) => {
        const checked = rustCheck([program], "synthetic", oracle.project.schema)[0]!;
        assert(!checked.error && checked.certificate, `${name} direct mutation did not certify: ${JSON.stringify(checked)}`);
        assert(String(checked.certificate.evaluator_version).endsWith("-5"),
          `${name} direct mutation used a pre-v5 native checker: ${JSON.stringify(checked.certificate.evaluator_version)}`);
        return [name, checked.certificate] as const;
      }));
      const serializedBlind = JSON.stringify(direct.get("blind")!.body);
      const targets = (name: string) => (checks.get(name)!.mutation_targets as { targets: unknown[]; complete: boolean });
      deepStrictEqual(targets("add"), { targets: [{ table: "rows", kind: "create", source: { newId: 0 } }], complete: true });
      deepStrictEqual(targets("blind"), { targets: [{ table: "rows", kind: "update", source: { argument: "id" } }], complete: true });
      deepStrictEqual(targets("remove"), { targets: [{ table: "rows", kind: "remove", source: { argument: "id" } }], complete: true });
      deepStrictEqual(targets("afterLoop"), { targets: [{ table: "rows", kind: "remove", source: { argument: "id" } }], complete: true });
      assert(JSON.stringify(targets("allocated")).includes('"unresolved":"ambiguous"'), "two inserts into one table acquired a guessed target");
      assert(JSON.stringify(targets("indexed")).includes('"unresolved":"computed"'), "an index lookup guessed a row ID from an argument");
      assert(serializedBlind.includes('"Update"') && !serializedBlind.includes('"Get"'),
        `discarded direct update gained read authority: ${serializedBlind}`);
      const serializedFocal = JSON.stringify(direct.get("focal")!.body);
      assert(serializedFocal.includes('"Get"') && serializedFocal.indexOf('"Get"') < serializedFocal.indexOf('"Update"'),
        `focal update did not read its old image before the write: ${serializedFocal}`);

      const row: Value = { Row: {
        id: { Id: "row-1" }, owner: { Id: "owner-1" }, related: { Id: "related-1" },
        sibling: "Null", label: { String: "original" }, count: { Int: 7 },
      } };
      const receipt = (certificate: Record<string, unknown>): ClosureReceipt => ({
        schema_hash: certificate.schema_hash as string,
        rows: [
          { table: "rows", id: "row-1", row },
          { table: "owners", id: "related-1", row: { Row: { id: { Id: "related-1" }, label: { String: "private" } } } },
        ], ranges: [], verdicts: [],
        absences: [
          ["rows", "byOwner", [{ Id: "owner-2" }]],
          ["rows", "byOwner", [{ Id: "owner-3" }]],
          ["rows", "byOwner", [{ Id: "owner-4" }]],
          ["rows", "byOwner", [{ Id: "owner-5" }]],
          ["rows", "byOwner", [{ Id: "owner-6" }]],
          ["rows", "byId", [{ Id: "row-2" }]],
        ],
      });
      const context = (name: string): Context => ({
        viewer: "viewer-1", principal_kind: "user", auth_epoch: 1,
        args: name === "indexed" ? { owner: { Id: "owner-1" } } : { id: { Id: "row-1" } },
        now: 23, read_time: 19, new_ids: [],
      });
      for (const name of ["blind", "direct", "focal", "indexed", "snapshots", "remove"]) {
        const program = direct.get(name)!;
        const certificate = checks.get(name)!;
        const legacy = operation(oracle.project.programs, `writes.${name}`);
        const legacyCheck = rustCheck([legacy], "synthetic", oracle.project.schema)[0]!;
        assert(!legacyCheck.error && legacyCheck.certificate, `${name} oracle mutation did not certify: ${JSON.stringify(legacyCheck)}`);
        const directStore: ClientStore = new ClientStore(oracle.project.schema, receipt(certificate));
        const oracleStore: ClientStore = new ClientStore(oracle.project.schema, receipt(legacyCheck.certificate));
        const directExecution: Execution = directStore.applyMutation(program, context(name)).execution;
        const oracleExecution: Execution = oracleStore.applyMutation(legacy, context(name)).execution;
        assert(canonicalValue(directExecution.result) === canonicalValue(oracleExecution.result),
          `${name} direct result changed: ${canonicalValue(directExecution.result)} / ${canonicalValue(oracleExecution.result)}`);
        deepStrictEqual(directExecution.trace.points.map((point: { table: string }) => point.table),
          oracleExecution.trace.points.map((point: { table: string }) => point.table));
        deepStrictEqual(directStore.rows("rows"), oracleStore.rows("rows"));
        if (name === "snapshots") {
          const result = directExecution.result;
          assert(result !== "Null" && "Row" in result
            && canonicalValue(result.Row.first) === canonicalValue({ Row: { ...row.Row, count: { Int: 1 } } })
            && canonicalValue(result.Row.second) === canonicalValue({ Row: { ...row.Row, count: { Int: 2 } } }),
          `later write changed an earlier direct result snapshot: ${JSON.stringify(result)}`);
        }
      }

      for (const [name, args, newIds] of [
        ["add", { owner: { Id: "owner-2" } }, ["row-2"]],
        ["branch", { owner: { Id: "owner-3" }, flag: { Bool: true } }, ["row-3"]],
      ] as const) {
        const program = direct.get(name)!;
        const certificate = checks.get(name)!;
        const applied = new ClientStore(oracle.project.schema, receipt(certificate))
          .applyMutation(program, { ...context(name), args, new_ids: [...newIds] });
        const execution = applied.execution;
        assert(execution.result !== "Null" && "Row" in execution.result
          && canonicalValue(execution.result.Row.id) === canonicalValue({ Id: newIds[0] }),
        `${name} did not return the once-evaluated inserted row: ${JSON.stringify({ applied, program })}`);
      }

      const allocated = direct.get("allocated")!;
      const allocatedStore = new ClientStore(oracle.project.schema, receipt(checks.get("allocated")!));
      const allocatedApply = allocatedStore.applyMutation(allocated, { ...context("allocated"),
        args: { owner: { Id: "owner-4" }, secondOwner: { Id: "owner-6" } },
        new_ids: ["row-first", "field-first", "row-second"] });
      const allocatedResult = allocatedApply.execution.result;
      assert(canonicalValue(allocatedResult) === canonicalValue({ Row: {
        firstId: { Id: "row-first" }, fieldId: { Id: "field-first" }, secondId: { Id: "row-second" },
      } }), `implicit insert id did not allocate before authored field values: ${canonicalValue(allocatedResult)} ${JSON.stringify({ allocated, allocatedApply, rows: allocatedStore.rows("rows") })}`);
      const allocatedOracle = operation(oracle.project.programs, "writes.allocated");
      const allocatedOracleCheck = rustCheck([allocatedOracle], "synthetic", oracle.project.schema)[0]!;
      assert(!allocatedOracleCheck.error && allocatedOracleCheck.certificate,
        `allocated oracle did not certify: ${JSON.stringify(allocatedOracleCheck)}`);
      const allocatedOracleResult = new ClientStore(oracle.project.schema, receipt(allocatedOracleCheck.certificate))
        .applyMutation(allocatedOracle, { ...context("allocated"),
          args: { owner: { Id: "owner-4" }, secondOwner: { Id: "owner-6" } },
          new_ids: ["row-first", "field-first", "row-second"] }).execution.result;
      assert(canonicalValue(allocatedOracleResult) === canonicalValue(allocatedResult),
        `direct insert allocation order diverged from the authored oracle: ${canonicalValue(allocatedOracleResult)}`);
      let exhausted: { code?: string } | undefined;
      try {
        new ClientStore(oracle.project.schema, receipt(checks.get("allocated")!)).applyMutation(allocated, {
          ...context("allocated"), args: { owner: { Id: "owner-4" }, secondOwner: { Id: "owner-6" } },
          new_ids: ["row-first", "field-first"],
        });
      } catch (error) { exhausted = error as { code?: string }; }
      assert(exhausted?.code === "E_INPUT", `three once-only allocations did not exhaust two ids: ${JSON.stringify(exhausted)}`);

      const explicit = direct.get("explicit")!;
      const explicitResult = new ClientStore(oracle.project.schema, receipt(checks.get("explicit")!))
        .applyMutation(explicit, { ...context("explicit"),
          args: { id: { Id: "authored-row" }, owner: { Id: "owner-5" } }, new_ids: ["field-only"] }).execution.result;
      assert(canonicalValue(explicitResult) === canonicalValue({ Row: {
        rowId: { Id: "authored-row" }, fieldId: { Id: "field-only" },
      } }), `explicit insert id acquired an implicit allocation: ${canonicalValue(explicitResult)}`);

      const joined = direct.get("joined")!;
      const joinedCertificate = checks.get("joined")!;
      const joinedOracle = operation(oracle.project.programs, "writes.joined");
      const joinedOracleCheck = rustCheck([joinedOracle], "synthetic", oracle.project.schema)[0]!;
      assert(!joinedOracleCheck.error && joinedOracleCheck.certificate,
        `joined oracle did not certify: ${JSON.stringify(joinedOracleCheck)}`);
      const joinedOracleCertificate = joinedOracleCheck.certificate;
      const joinedResult = (ids: Value, newIds: string[]) => {
        const directResult = new ClientStore(oracle.project.schema, receipt(joinedCertificate))
          .applyMutation(joined, { ...context("joined"), args: { ids }, new_ids: [...newIds] }).execution.result;
        const oracleResult = new ClientStore(oracle.project.schema, receipt(joinedOracleCertificate))
          .applyMutation(joinedOracle, { ...context("joined"), args: { ids }, new_ids: [...newIds] }).execution.result;
        assert(canonicalValue(directResult) === canonicalValue(oracleResult),
          `effectful list fallback diverged from the authored oracle: ${canonicalValue(directResult)} / ${canonicalValue(oracleResult)}`);
        return directResult;
      };
      assert(canonicalValue(joinedResult("Null", ["fallback-1", "fallback-2", "after-fallback"])) === canonicalValue({ Row: {
        chosen: { Array: [{ Id: "fallback-1" }, { Id: "fallback-2" }] }, next: { Id: "after-fallback" },
      } }), "effectful list fallback lost left-to-right allocation order");
      assert(canonicalValue(joinedResult({ Array: [] }, ["after-empty"])) === canonicalValue({ Row: {
        chosen: { Array: [] }, next: { Id: "after-empty" },
      } }), "present empty list evaluated the effectful fallback");
      assert(canonicalValue(joinedResult({ Array: [{ Id: "provided" }] }, ["after-provided"])) === canonicalValue({ Row: {
        chosen: { Array: [{ Id: "provided" }] }, next: { Id: "after-provided" },
      } }), "present nonempty list evaluated the effectful fallback");
      let joinedExhausted: { code?: string } | undefined;
      try { joinedResult("Null", ["fallback-1", "fallback-2"]); } catch (error) { joinedExhausted = error as { code?: string }; }
      assert(joinedExhausted?.code === "E_INPUT",
        `effectful fallback did not consume exactly two ids before the following expression: ${JSON.stringify(joinedExhausted)}`);

      for (const [name, args, newIds] of [
        ["ensure", { id: { Id: "row-1" }, owner: { Id: "owner-1" } }, []],
        ["ensure", { id: { Id: "row-2" }, owner: { Id: "owner-2" } }, []],
        ["ensureIndexed", { owner: { Id: "owner-1" } }, []],
        ["ensureIndexed", { owner: { Id: "owner-2" } }, ["row-2"]],
      ] as const) {
        const program = direct.get(name)!;
        const certificate = checks.get(name)!;
        const legacy = operation(oracle.project.programs, `writes.${name}`);
        const legacyCheck = rustCheck([legacy], "synthetic", oracle.project.schema)[0]!;
        assert(!legacyCheck.error && legacyCheck.certificate, `${name} oracle upsert did not certify: ${JSON.stringify(legacyCheck)}`);
        const directStore: ClientStore = new ClientStore(oracle.project.schema, receipt(certificate));
        const oracleStore: ClientStore = new ClientStore(oracle.project.schema, receipt(legacyCheck.certificate));
        const directExecution = directStore.applyMutation(program, {
          ...context(name), args, new_ids: [...newIds],
        }).execution;
        const oracleExecution = oracleStore.applyMutation(legacy, {
          ...context(name), args, new_ids: [...newIds],
        }).execution;
        assert(canonicalValue(directExecution.result) === canonicalValue(oracleExecution.result),
          `${name} upsert result changed: ${canonicalValue(directExecution.result)} / ${canonicalValue(oracleExecution.result)}`);
        deepStrictEqual(directStore.rows("rows"), oracleStore.rows("rows"));
      }

      const focalNested = direct.get("focalNested")!;
      const focalNestedCheck = checks.get("focalNested")!;
      const focalNestedOracle = operation(oracle.project.programs, "writes.focalNested");
      const focalNestedOracleCheck = rustCheck([focalNestedOracle], "synthetic", oracle.project.schema)[0]!;
      assert(!focalNestedOracleCheck.error && focalNestedOracleCheck.certificate,
        `focalNested oracle did not certify: ${JSON.stringify(focalNestedOracleCheck)}`);
      const refused = (program: Program, certificate: Record<string, unknown>) => {
        try {
          new ClientStore(oracle.project.schema, receipt(certificate)).applyMutation(program, context("focalNested"));
          return { code: undefined, tables: [] as string[] };
        } catch (error) {
          const failure = error as { code?: string; authoredCode?: string; trace?: { points: Array<{ table: string }> } };
          return { code: failure.authoredCode ?? failure.code,
            tables: failure.trace?.points.map((point) => point.table) ?? [] };
        }
      };
      const directRefusal = refused(focalNested, focalNestedCheck);
      deepStrictEqual(directRefusal, refused(focalNestedOracle, focalNestedOracleCheck.certificate));
      assert(directRefusal.code === "OWNER_REQUIRED"
        && JSON.stringify(directRefusal.tables) === JSON.stringify(["rows", "owners"]),
      `nested focal read lost its authority/refusal order: ${JSON.stringify(directRefusal)}`);
    });
  });

  test("direct Quarry jobs remain chunk-only and preserve certified sweep bounds", async () => {
    const root = join(frontend, "fixtures/quarry-jobs");
    const inputs: QuarryInput[] = ["schema", "admin", "narrowing"].map((stem) => {
      const path = join(root, "snapback", `${stem}.q`);
      return { path, fileName: `snapback/${stem}.q`, source: readFileSync(path, "utf8") };
    });
    const prepared = prepareQuarry(inputs);
    assert(prepared.ok, `direct job preparation failed: ${JSON.stringify(prepared.ok ? [] : prepared.diagnostics)}`);
    const oracle = await lowerProject(root);
    assert(oracle.ok, `job parity oracle failed: ${oracle.ok ? "" : diagnosticsText(oracle.diagnostics)}`);
    for (const document of prepared.prepared.documents.filter((document) => document.file !== "snapback/schema.q")) {
      for (const declaration of document.programs) {
        const direct = lowerBoundQuarryProgram(bindQuarryProgram(
          declaration, prepared.prepared.catalog, prepared.prepared.documents,
        ));
        assert(direct.kind === "job" && direct.body.length > 0
          && direct.body.every((statement) => typeof statement === "object" && "For" in statement),
          `${direct.name} gained a non-chunk job statement(): ${JSON.stringify(direct.body)}`);
        const legacy = operation(oracle.project.programs, direct.name);
        const directCheck: RustCheckResult = rustCheck([direct], "synthetic", oracle.project.schema)[0]!;
        const legacyCheck: RustCheckResult = rustCheck([legacy], "synthetic", oracle.project.schema)[0]!;
        assert(!directCheck.error && directCheck.certificate, `${direct.name} direct job did not certify: ${JSON.stringify(directCheck)}`);
        assert(!legacyCheck.error && legacyCheck.certificate, `${direct.name} oracle job did not certify: ${JSON.stringify(legacyCheck)}`);
        assert(String(directCheck.certificate.evaluator_version).endsWith("-5"),
          `${direct.name} job used a pre-v5 native checker`);
        for (const field of ["kind", "chunks", "sweeps", "perChunk", "engineWrites"]) {
          deepStrictEqual(withoutIdentityHashes(directCheck.certificate[field]), withoutIdentityHashes(legacyCheck.certificate[field]),
            `${direct.name} changed certified ${field}`);
        }
      }
    }
  });

  test("direct Quarry schedule bindings retain focal row arguments and pure results", async () => {
    const schema = readFileSync(join(frontend, "fixtures/quarry-schedules/snapback/schema.q"), "utf8");
    const admin = `job digestSweep():
  chunk p in profiles first 100 by byId:
    update profiles[p.id] { newFollowers: p.newFollowers }

schedule dailyDigest every 24h: digestSweep()

mutation purgeMessage(id: messages):
  update messages[id] { body: null, expiresAt: null }
  return null

schedule expireMessage on messages at .expiresAt: purgeMessage(.id)
`;
    await withProject({ "snapback/schema.q": schema, "snapback/admin.q": admin }, async (root) => {
      const inputs: QuarryInput[] = ["schema", "admin"].map((stem) => {
        const path = join(root, "snapback", `${stem}.q`);
        return { path, fileName: `snapback/${stem}.q`, source: readFileSync(path, "utf8") };
      });
      const prepared = prepareQuarry(inputs);
      assert(prepared.ok, `direct schedule preparation failed: ${JSON.stringify(prepared.ok ? [] : prepared.diagnostics)}`);
      const oracle = await lowerProject(root);
      assert(oracle.ok, `schedule parity oracle failed: ${oracle.ok ? "" : diagnosticsText(oracle.diagnostics)}`);
      const directPrograms = prepared.prepared.documents.flatMap((document) => document.programs)
        .map((program) => lowerBoundQuarryProgram(bindQuarryProgram(
          program, prepared.prepared.catalog, prepared.prepared.documents,
        )));
      const directChecks = rustCheck(directPrograms, "synthetic", oracle.project.schema);
      const legacyChecks = rustCheck(oracle.project.programs, "synthetic", oracle.project.schema);
      for (const schedule of prepared.prepared.schedules) {
        const declaration = prepared.prepared.documents.flatMap((document) => document.programs)
          .find((program) => `${program.site.file.split("/").pop()!.slice(0, -2)}.${program.name}` === schedule.bindingName);
        assert(declaration, `missing prepared binding ${schedule.bindingName}`);
        const bound = bindQuarryProgram(declaration, prepared.prepared.catalog, prepared.prepared.documents);
        assert(("row" in schedule.trigger) === !!bound.focal,
          `${schedule.name} direct binding focal did not match its trigger`);
        const direct = directPrograms.find((program) => program.name === schedule.bindingName)!;
        const legacy = operation(oracle.project.programs, schedule.bindingName);
        const directCheck: RustCheckResult = directChecks.find((checked) => checked.program === schedule.bindingName)!;
        const legacyCheck: RustCheckResult = legacyChecks.find((checked) => checked.program === schedule.bindingName)!;
        assert(!directCheck.error && directCheck.certificate, `${schedule.name} direct binding did not certify: ${JSON.stringify(directCheck)}`);
        assert(!legacyCheck.error && legacyCheck.certificate, `${schedule.name} oracle binding did not certify: ${JSON.stringify(legacyCheck)}`);
        assert(String(directCheck.certificate.evaluator_version).endsWith("-5"),
          `${schedule.name} binding used a pre-v5 native checker`);
        const args: Record<string, Value> = "row" in schedule.trigger ? { id: { Id: "message-1" } } : {};
        const context: Context = { viewer: "system", principal_kind: "system", auth_epoch: 1,
          args, now: 23, read_time: 19, new_ids: [] };
        const directExecution: Execution = new ClientStore(oracle.project.schema).reexecute(direct, context, directCheck.certificate).execution;
        const oracleExecution: Execution = new ClientStore(oracle.project.schema).reexecute(legacy, context, legacyCheck.certificate).execution;
        assert(canonicalValue(directExecution.result) === canonicalValue(oracleExecution.result),
          `${schedule.name} direct binding result changed: ${canonicalValue(directExecution.result)}`);
      }
    });
  });

  test("direct Quarry fn expansion cannot smuggle writes through a mutation caller or named shape", () => {
    const schema = `table rows:
  owner: principal
  label: text <=40
  count: int
  public
  insert <- allow
`;
    const refusal = (operations: string) => {
      const prepared = prepareQuarry([
        { path: "/virtual/schema.q", fileName: "snapback/schema.q", source: schema },
        { path: "/virtual/ops.q", fileName: "snapback/ops.q", source: operations },
      ]);
      assert(prepared.ok, `fn write refusal did not prepare: ${JSON.stringify(prepared.ok ? [] : prepared.diagnostics)}`);
      const declaration = prepared.prepared.documents[1]!.programs[0]!;
      try {
        bindQuarryProgram(declaration, prepared.prepared.catalog, prepared.prepared.documents);
      } catch (error) {
        return (error as { diagnostic?: { code: string; message: string } }).diagnostic;
      }
      return undefined;
    };
    const direct = refusal(`fn add(owner: principal): insert rows { owner, label: 'x', count: 0 }
mutation invoke(owner: principal):
  return add(owner)
`);
    assert(direct?.code === "E_QUARRY_UNSUPPORTED" && direct.message.includes("read-pure"),
      `fn body write escaped through a mutation caller: ${JSON.stringify(direct)}`);
    const shaped = refusal(`shape illicit = { made: insert rows { owner: viewer, label: 'x', count: 0 } }
fn project(row: rows): row illicit
mutation invoke(id: rows):
  return project(id)
`);
    assert(shaped?.code === "E_QUARRY_UNSUPPORTED" && shaped.message.includes("read-pure"),
      `fn named shape write escaped through a mutation caller: ${JSON.stringify(shaped)}`);
  });
}

function withoutIdentityHashes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIdentityHashes);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([name]) => !["plan_hash", "program_hash", "schema_hash"].includes(name))
    .map(([name, child]) => [name, withoutIdentityHashes(child)]));
}
