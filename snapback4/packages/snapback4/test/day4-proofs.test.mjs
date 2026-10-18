// DAY4: saved-source proof results are application business-case evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testSource } from "../dist/proof.js";

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "sb4-day4-proof-"));
  const binary = join(cwd, "snapback4-fixture.mjs");
  writeFileSync(binary, `#!${process.execPath}
const source=process.argv[process.argv.indexOf('--source')+1];
if(source==='failure'){console.log('business failure detail from stdout');console.error('test refused');process.exit(1)}
const counts=source==='cases'?{run:2,skipped:0}:source==='skipped'?{run:0,skipped:3}:{run:0,skipped:0};
console.log('query sweep: 99 complete');
console.log('SNAPBACK4_TEST_CASES '+JSON.stringify(counts));
`, { mode: 0o755 });
  const prior = process.env.SNAPBACK4_BIN;
  process.env.SNAPBACK4_BIN = binary;
  t.after(() => { if (prior === undefined) delete process.env.SNAPBACK4_BIN; else process.env.SNAPBACK4_BIN = prior; rmSync(cwd, { recursive: true, force: true }); });
  return cwd;
}

test("testSource returns business case counts and does not treat the query sweep as cases", async t => {
  const cwd = fixture(t);
  assert.deepEqual(await testSource("cases", { cwd }).then(({ casesRun, casesSkipped }) => ({ casesRun, casesSkipped })), { casesRun: 2, casesSkipped: 0 });
  await assert.rejects(testSource("none", { cwd }), /ran no business cases \(0 skipped\)/);
  await assert.rejects(testSource("skipped", { cwd }), /ran no business cases \(3 skipped\)/);
  assert.deepEqual(await testSource("none", { cwd, fixtureOnly: true }).then(({ casesRun, casesSkipped }) => ({ casesRun, casesSkipped })), { casesRun: 0, casesSkipped: 0 });
});

test("testSource preserves synchronous usage validation and includes failed stdout", async t => {
  const cwd = fixture(t);
  assert.throws(() => testSource(null), /got null/);
  await assert.rejects(testSource("failure", { cwd }), /stdout tail: business failure detail from stdout/);
});


test('numeric starter flags are checked as complete flag names', async () => {
  const { changelogFlags, assertChangelogHelp } = await import('../../../scripts/check-verb-help.mjs');
  assert.deepEqual(changelogFlags('- init --day2 opts in'), [['init', '--day2']]);
  assert.doesNotThrow(() => assertChangelogHelp('- init --day2 opts in', () => 'init --day2'));
  assert.throws(() => assertChangelogHelp('- init --day2 opts in', () => 'init --day20'), /omits announced --day2/);
});
