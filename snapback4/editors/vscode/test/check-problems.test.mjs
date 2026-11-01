import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { check } from '../scripts/check-problems.mjs';

function replay(report, status = 1) {
  const dir = mkdtempSync(join(tmpdir(), 'quarry-diagnostics-'));
  mkdirSync(join(dir, 'snapback'));
  writeFileSync(join(dir, 'snapback/schema.q'), '-- fixture replay\n');
  const binary = join(dir, 'compiler');
  writeFileSync(binary, `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(report))}); process.exitCode = ${status};\n`);
  chmodSync(binary, 0o755);
  const stdout = [], stderr = [];
  const { log, error } = console;
  console.log = line => stdout.push(line); console.error = line => stderr.push(line);
  try { return { status: check({ workspace: dir, binary }), stdout, stderr }; }
  finally { console.log = log; console.error = error; rmSync(dir, { recursive: true, force: true }); }
}
const captured = name => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url)));
test('captured synthetic refutation is accepted without an invariant error', () => {
  const report = captured('security-synthetic');
  assert.equal(report.ok, true);
  const verdict = report.security.invariants.find(v => v.status === 'refuted');
  assert.equal(verdict.counterexample.reachability, 'synthetic-operation');
  assert.deepEqual(verdict.invariant.site, { file: 'schema.q', line: 8, col: 1 });
  const result = replay(report, 0);
  assert.equal(result.status, 0);
  assert(!result.stdout.some(line => line.includes('E_SECURITY_INVARIANT')), result.stdout.join('\n'));
});
test('only authored and generated fixture refutations become invariant errors', () => {
  for (const reachability of ['authored-fixture-trace', 'generated-fixture-trace', 'synthetic-operation', 'trusted-seed-only', undefined]) {
    const report = captured('security-synthetic');
    const verdict = report.security.invariants.find(v => v.status === 'refuted');
    if (reachability) verdict.counterexample.reachability = reachability;
    else delete verdict.counterexample;
    const failing = ['authored-fixture-trace', 'generated-fixture-trace'].includes(reachability);
    report.ok = !failing;
    const result = replay(report, failing ? 1 : 0);
    assert.equal(result.stdout.some(line => line.includes('E_SECURITY_INVARIANT')), failing, `${reachability}: ${result.stdout.join('\n')}`);
  }
});
test('acknowledged security notes are hidden by disposition index; absent reviews retain notes', () => {
  const note = { code: 'N_BROAD_READ', site: { file: 'schema.q', line: 3, col: 3 }, message: 'broad read', rewrite: 'review intent' };
  const review = { code: note.code, site: 'schema.q:3:3', gated: true, acknowledged: true };
  const report = { ok: true, security: { notes: [note] }, securityReviews: [review] };
  assert.deepEqual(replay(report, 0).stdout, []);
  delete report.securityReviews;
  assert.equal(replay(report, 0).stdout.length, 1);
  report.security.notes.push({ ...note, site: { ...note.site, line: 4 } });
  report.securityReviews = [review, { ...review, acknowledged: false, gated: false }];
  const lines = replay(report, 0).stdout;
  assert.equal(lines.length, 1);
  assert(lines[0].includes('schema.q:4:3: N_BROAD_READ'));
});
for (const name of ['security-loosened', 'security-notes-error']) test(`${name}: captured security refutation reaches Problems`, () => {
  const report = captured(name);
  assert.equal(report.ok, false);
  const refuted = report.security.invariants.find(v => v.status === 'refuted');
  assert(refuted);
  const result = replay(report, name === 'security-notes-error' ? 2 : 1);
  const { line, col } = refuted.invariant.site;
  assert(result.stdout.some(s => s.includes(`schema.q:${line}:${col}: E_SECURITY_INVARIANT `) && s.includes('refuted') && s.includes(' | ')), result.stdout.join('\n'));
  for (const note of report.security.notes.filter(n => n.site?.file)) {
    assert(result.stdout.some(s => s.includes(`:${note.site.line}:${note.site.col}: ${note.code} `)), note.code);
  }
  assert.equal(result.status, name === 'security-notes-error' ? 2 : 1);
  if (name === 'security-notes-error') assert(result.stderr.some(s => s.startsWith('E_SECURITY_NOTES ')));
});
test('pending security reviews keep their site and review instruction; acknowledged reviews are not pending', () => {
  const review = { code: 'N_POLICY', site: 'schema.q:4:3', gated: true, acknowledged: false, id: 'review-id', scope: 'notes read' };
  const report = { ok: false, securityReviews: [review] };
  const result = replay(report);
  assert(result.stdout.some(s => s.includes('schema.q:4:3: N_POLICY ') && s.includes('review-id') && s.includes(' | ')), JSON.stringify(result));
  assert.equal(replay({ ok: true, securityReviews: [{ ...review, acknowledged: true }] }, 0).stdout.length, 0);
  const unlocated = replay({ ...report, securityReviews: [{ ...review, site: '' }] });
  assert.equal(unlocated.stdout.length, 0);
  assert(unlocated.stderr.some(s => s.startsWith('N_POLICY ')));
});
