// @ref LLP 3000.000.000.000.000#5-verification-and-reviews — passing fixtures may not produce false signature drift.
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const binary = resolve(process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4'));
const apps = process.argv[2];
if (!apps) throw Error('usage: node scripts/qualify-fixtures.mjs <read-only app census directory> [report.json]');
const cases = [], failures = [];
for (const name of readdirSync(apps).sort()) {
  const app = join(apps, name), scratch = mkdtempSync(join(tmpdir(), 'sb4-fixture-census-'));
  try {
    const schema = join(app, 'snapback'), fixtures = join(app, 'fixtures');
    let names;
    try { names = readdirSync(schema).filter(file => file.endsWith('.q')); readdirSync(fixtures); }
    catch { continue; }
    mkdirSync(join(scratch, 'snapback'));
    for (const file of names) writeFileSync(join(scratch, 'snapback', file), readFileSync(join(schema, file)));
    cpSync(fixtures, join(scratch, 'fixtures'), { recursive: true });
    const invoke = args => spawnSync(binary, args, { cwd: scratch, encoding: 'utf8', timeout: 60_000 });
    const tested = invoke(['test']);
    if (tested.status !== 0) { cases.push({ app: name, state: 'test-red', output: tested.stdout + tested.stderr }); continue; }
    const checked = invoke(['check', '--json']);
    const output = checked.stdout + checked.stderr;
    const drift = output.includes('N_FIXTURE_ARGUMENT_DRIFT');
    cases.push({ app: name, state: drift ? 'drift' : 'agree', checkStatus: checked.status, ...(drift ? { output } : {}) });
    if (drift) failures.push(name);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
const report = { binary, total: cases.length, passingTests: cases.filter(c => c.state !== 'test-red').length, drift: failures, cases };
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ total: report.total, passingTests: report.passingTests, drift: failures }));
if (report.passingTests === 0 || failures.length) process.exitCode = 1;
