import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '../../..'), report = resolve(import.meta.dirname, '..');
const mutations = [
  { name: 'lost-child-dependency', file: 'local.js', from: 'watch.tables = tables;', to: 'watch.tables = new Set([...tables].filter(table => table !== "reactions"));', test: 'live-propagation', pattern: 'wasm: child-add keep=undefined expire=false' },
  { name: 'lost-disjoint-resumption', file: 'local-reads.js', from: 'ready.push(watch);', to: '/* deliberately lose the wake */', test: 'live-propagation', pattern: 'wasm: unknown-footprint' },
  { name: 'media-misses-authorization', file: 'local-assets.js', from: '!tables.some(table => touched.includes(table))', to: '!touched.includes(entry.home.table)', test: 'media-dependencies', pattern: 'retained media: authorization' },
];
const outcomes = [];
for (const mutation of mutations) {
  const path = join(root, 'packages/snapback4/dist', mutation.file), original = readFileSync(path, 'utf8');
  assert.ok(original.includes(mutation.from), mutation.name + ': exact mutation site');
  try {
    writeFileSync(path, original.replaceAll(mutation.from, mutation.to));
    const run = spawnSync(process.execPath, ['--test', '--test-name-pattern=' + mutation.pattern, 'packages/snapback4/test/' + mutation.test + '.test.mjs'], { cwd: root, encoding: 'utf8', timeout: 30000 });
    writeFileSync(join(report, 'negative-' + mutation.name + '.log'), run.stdout + run.stderr);
    outcomes.push({ name: mutation.name, status: run.status, signal: run.signal });
    assert.notEqual(run.status, 0, mutation.name + ' must be detected');
    assert.equal(run.signal, null, mutation.name + ' must fail an assertion rather than the harness timeout');
  } finally { writeFileSync(path, original); }
}
writeFileSync(join(report, 'negative-controls.json'), JSON.stringify(outcomes, null, 2) + '\n');
console.log(outcomes);
