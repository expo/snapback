// Restore only the old create-before-write publication in a private C copy.
// The unchanged regression must reject both pause points without PID signalling.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { runFile } from '../../../../scripts/run-client-tests.mjs';
const root = process.cwd(), evidence = path.join(root, 'reports/20261007-fl-dry-run-flakes/round-5/evidence');
const interposer = fs.readFileSync('packages/snapback4/test/publication-interposer.c', 'utf8');
const start = interposer.indexOf('        char temporary[4096]'), end = interposer.indexOf('        // The private barrier', start);
assert.ok(start > 0 && end > start);
const mutant = path.join(root, 'target/fl-verification/r5-publication-interposer.c');
fs.writeFileSync(mutant, interposer.slice(0, start) + `        char request[4096]; snprintf(request, sizeof(request), "%s.kill", barrier);
        FILE *out = barrier ? fopen(barrier, "w") : NULL;
        if (out) { fprintf(out, "%d", getpid()); fclose(out); }
` + interposer.slice(end));
const test = path.join(root, 'packages/snapback4/test/.fl-r5-barrier-negative.test.mjs');
let source = fs.readFileSync('packages/snapback4/test/export-publication.test.mjs', 'utf8');
const include = "new URL('./publication-interposer.c', import.meta.url).pathname";
assert.equal(source.split(include).length, 2);
source = source.replace(include, JSON.stringify(mutant));
fs.writeFileSync(test, source);
let output = '';
try {
  const result = await runFile(test, { nodeArgs: ['--test-name-pattern=publisher (before|after) barrier'], onOutput: text => { output += text; process.stdout.write(text); } });
  fs.writeFileSync(path.join(evidence, 'barrier-negative-summary.json'), JSON.stringify(result, null, 2) + '\n');
  assert.equal(result.passed, false); assert.equal(result.reason, undefined); assert.equal(result.inspectionFailure, undefined);
  assert.equal(result.counts.fail, 2);
  assert.match(output, /incomplete PID record must not be published/);
  console.log('EXPECTED FAILURE: both original barrier windows rejected; cleanup uses only direct child handles; no group leak');
} finally { fs.rmSync(test, { force: true }); }
