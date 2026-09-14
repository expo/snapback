import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containsPath, prepareVerificationLane } from "../../../loopbar/run.mjs";
import { correctionLoops, measureSchema } from "../../../loopbar/ceremony-metrics.mjs";
import { aliceInsights, ANCHOR, unwrap } from "../../../loopbar/ceremony-probes.mjs";
import { command } from "../../../loopbar/ceremony-process.mjs";

test("reverification owns a fresh copy and does not touch sibling or live stores", () => {
  const root = mkdtempSync(join(tmpdir(), "sb4-loopbar-ownership-"));
  const lane = join(root, "run-1"), sibling = join(root, "run-10");
  let directory;
  const signals = [];
  const kill = process.kill;
  process.kill = (...args) => { signals.push(args); return true; };
  try {
    for (const path of [lane, sibling]) {
      mkdirSync(join(path, ".snapback4"), { recursive: true });
      writeFileSync(join(path, ".snapback4/live.db"), "live data");
    }
    mkdirSync(join(lane, "node_modules"));
    writeFileSync(join(lane, "node_modules/dependency.txt"), "dependency");
    mkdirSync(join(lane, "app/.snapback4"), { recursive: true });
    writeFileSync(join(lane, "app/.snapback4/live.db"), "nested live data");
    writeFileSync(join(lane, "app/program.q"), "query q(): return 1");
    assert.equal(containsPath(lane, lane), true);
    assert.equal(containsPath(lane, join(lane, "app")), true);
    assert.equal(containsPath(lane, sibling), false);
    assert.equal(containsPath(lane, join(lane, "../run-10")), false);
    directory = prepareVerificationLane(lane);
    assert.equal(existsSync(join(directory, ".snapback4")), false);
    assert.equal(existsSync(join(directory, "app/.snapback4")), false);
    assert.equal(readFileSync(join(directory, "app/program.q"), "utf8"), "query q(): return 1");
    assert.equal(realpathSync(join(directory, "node_modules")), realpathSync(join(lane, "node_modules")));
    mkdirSync(join(directory, ".snapback4"));
    writeFileSync(join(directory, ".snapback4/live.db"), "independent data");
    for (const path of [lane, sibling]) assert.equal(readFileSync(join(path, ".snapback4/live.db"), "utf8"), "live data");
    assert.equal(readFileSync(join(lane, "app/.snapback4/live.db"), "utf8"), "nested live data");
    assert.deepEqual(signals, [], "copying/reverification never signals a discovered process");
  } finally {
    process.kill = kill;
    if (directory) rmSync(directory, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("ceremony counts final loop attributions, docs aliases and retractions once", () => {
  const result = correctionLoops(`start=1
2 loop=1 attribution=snapback4-defect failed check
3 loop=1 attribution=agent-error read the documented form
4 loop=2 attribution=docs-gap missing spelling
5 loop=3 attribution=environment port conflict
6 loop=4 attribution=ambiguous unresolved
7 loop=5 attribution=snapback4-defect initial suspicion
8 loop=5 retracted
schema discussion mentioning docs and agent-error is not a correction loop
green=9`);
  assert.deepEqual(result.byAttribution, { "snapback4-defect": 0, docs: 1, "agent-error": 1, environment: 1, ambiguous: 1 });
  assert.equal(result.snapbackAttributed, 1);
  assert.equal(result.total, 4);
  assert.deepEqual(result.malformed, []);
  assert.equal(correctionLoops("loop=1 attribution=unknown").malformed.length, 1);
});

test("ceremony measures declared tables and maintains separately, exposing heuristic disagreements", () => {
  const source = `-- table falsePositive:
table digestWork:
  ownerId: principal
  total: int
  public 'query fake(): read <- allow'
table accounts:
  principal: principal
  read <- .principal = viewer
table buffer:
  ownerId: principal
  count: int
  read <- allow
maintain userCounts: count accounts by principal
  read <- allow
query insights():
  return 1
mutation send():
  return null
job digest():
  chunk a in accounts first 1 by byId:
    return null
`;
  const result = measureSchema([{ path: "snapback/schema.q", source }], 'schema-shape={"workTables":["buffer"],"perPrincipalCounterTables":["buffer","userCounts"],"auxiliaryOperations":["digest"]}');
  assert.equal(result.tables, 3); assert.equal(result.maintains, 1); assert.equal(result.tablesIncludingMaintains, 4);
  assert.deepEqual(result.workTablesHeuristic, { count: 1, names: ["digestWork"] });
  assert.deepEqual(result.workTablesReported, { count: 1, names: ["buffer"] });
  assert.equal(result.publicPerPrincipalCounterLines.count, 3);
  assert.equal(result.quarryLines, 21); assert.equal(result.quarryCodeLines, 20);
  assert.equal(result.operations, 3); assert.deepEqual(result.operationsByKind, { query: 1, mutation: 1, job: 1 });
  assert.equal(result.reportingError, null);
  const malformed = measureSchema([{ path: "schema.q", source }], 'schema-shape={"workTables":["nonexistent"],"perPrincipalCounterTables":[],"auxiliaryOperations":[]}');
  assert.match(malformed.reportingError, /does not exist/);
});

test("ceremony unwraps native pages while refusing incomplete plausible answers", () => {
  assert.equal(new Date(ANCHOR).toISOString(), "2026-09-13T18:00:00.000Z");
  const expected = aliceInsights();
  assert.equal(expected.likesReceived, 21);
  assert.deepEqual(expected.days.map((day) => day.posts), [0, 0, 0, 0, 1, 0, 4]);
  assert.deepEqual(unwrap({ rows: [{ chatKey: "alpha", messages: { rows: [{ key: "a01" }], complete: true } }], complete: true }),
    [{ chatKey: "alpha", messages: [{ key: "a01" }] }]);
  assert.throws(() => unwrap({ rows: [{ key: "a01" }], complete: false }), /complete/);
});

test("ceremony process execution succeeds and a stuck owned process times out", async () => {
  const good = await command(process.execPath, ["-e", "process.stdout.write('finished')"], { limitMs: 10_000 });
  assert.equal(good.status, 0); assert.equal(good.out, "finished"); assert.equal(good.timedOut, false);
  const stuck = await command(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { limitMs: 100 });
  assert.equal(stuck.timedOut, true); assert.equal(stuck.signal, "SIGTERM");
});
