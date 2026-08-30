// S1 equality harness: lower programs.contract and compare each program's IR
// to the committed corpus, by canonical-JSON structural equality.
//
// This is the same bar the TypeScript front end reports as "17/17 S1 equality".

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lower, LowerError } from './lower.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const corpusDir = join(here, '..', 'corpus');

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((a, k) => { a[k] = canon(v[k]); return a; }, {});
  }
  return v;
}
const j = (v) => JSON.stringify(canon(v));

const expected = new Map();
for (const f of readdirSync(corpusDir).filter((f) => f.startsWith('named-') && f.endsWith('.json'))) {
  const d = JSON.parse(readFileSync(join(corpusDir, f), 'utf8'));
  expected.set(d.program.name, d.program);
}

let got;
try {
  got = lower(readFileSync(join(here, 'programs.contract'), 'utf8'));
} catch (e) {
  if (e instanceof LowerError) { console.error(`LOWER FAILED: ${e.message}`); process.exit(1); }
  throw e;
}

const gotByName = new Map(got.map((p) => [p.name, p]));
let pass = 0;
const fails = [];

for (const [name, want] of [...expected].sort()) {
  const have = gotByName.get(name);
  if (!have) { fails.push([name, 'not authored in programs.contract', null, null]); continue; }
  if (j(have) === j(want)) { pass += 1; continue; }
  // locate first differing path for a useful message
  const diff = firstDiff(canon(have), canon(want), '');
  fails.push([name, `IR mismatch at ${diff.path}`, diff.got, diff.want]);
}

console.log(`\nS1 equality: ${pass}/${expected.size} programs lower to identical IR\n`);
for (const [name, why, g, w] of fails) {
  console.log(`  FAIL ${name}: ${why}`);
  if (g !== undefined && g !== null) {
    console.log(`       got : ${JSON.stringify(g).slice(0, 200)}`);
    console.log(`       want: ${JSON.stringify(w).slice(0, 200)}`);
  }
}
const extra = [...gotByName.keys()].filter((n) => !expected.has(n));
if (extra.length) console.log(`\n  (authored but not in corpus: ${extra.join(', ')})`);
process.exit(fails.length ? 1 : 0);

function firstDiff(a, b, path) {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object'
      || Array.isArray(a) !== Array.isArray(b)) {
    return { path: path || '(root)', got: a, want: b };
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const k of keys) {
    const d = firstDiff(a[k], b[k], `${path}.${k}`);
    if (d) return d;
  }
  return { path: path || '(root)', got: a, want: b };
}
