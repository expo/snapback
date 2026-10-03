// Run after all builds/tests drain, against the final CLI and wrapper.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
const starter = process.argv[2];
const report = path.resolve('reports/20261001-nx-export-proves-native/round1');
const project = path.resolve('target/nx', starter);
const source = path.join(project, starter === 'plain' ? 'App.tsx' : 'app/_layout.tsx');
const original = fs.readFileSync(path.join(report, starter + '-original.txt'), 'utf8');
fs.mkdirSync(path.join(project, 'src'), { recursive: true });
fs.writeFileSync(path.join(project, 'src/retired.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64'));
const requireAsset = `\nconsole.log('NX asset', require('${starter === 'plain' ? './src' : '../src'}/retired.png'));\n`;
const durations = [], hashes = new Set();
try {
  fs.writeFileSync(source, original + requireAsset);
  fs.rmSync(path.join(project, '.snapback4-witness'), { recursive: true, force: true });
  const cold = spawnSync(process.execPath, [path.join(report, 'run.mjs'), starter, 'confirmed-cold'], { stdio: 'inherit' });
  assert.equal(cold.status, 0);
  const coldRow = JSON.parse(fs.readFileSync(path.join(report, `${starter}-confirmed-cold.json`)));
  assert.equal(coldRow.status, 0); assert.equal(coldRow.receiptExit, 0); assert.equal(coldRow.cache.hit, false);
  assert.deepEqual(Object.values(coldRow.segments), ['passed', 'passed', 'passed']);
  assert.equal(coldRow.bundleHash, coldRow.loadedHash);
  for (let i = 1; i <= 5; i++) {
    fs.writeFileSync(source, original + requireAsset + `\nconsole.log('NX round1 final ${starter} JS ${i}');\n`);
    const label = 'confirmed-warm' + i;
    const child = spawnSync(process.execPath, [path.join(report, 'run.mjs'), starter, label], { stdio: 'inherit' });
    assert.equal(child.status, 0);
    const row = JSON.parse(fs.readFileSync(path.join(report, `${starter}-${label}.json`)));
    assert.equal(row.status, 0);
    assert.equal(row.receiptExit, 0);
    assert.equal(row.cache.hit, true);
    assert.deepEqual(Object.values(row.segments), ['passed', 'passed', 'passed']);
    assert.equal(row.bundleHash, row.loadedHash);
    hashes.add(row.bundleHash); durations.push(row.durationMs);
  }
  fs.writeFileSync(source, original + `\nconsole.log('NX final ${starter} asset removed');\n`);
  const removedRun = spawnSync(process.execPath, [path.join(report, 'run.mjs'), starter, 'final-asset-removed'], { stdio: 'inherit' });
  assert.equal(removedRun.status, 0);
  const removed = JSON.parse(fs.readFileSync(path.join(report, `${starter}-final-asset-removed.json`)));
  assert.equal(removed.cache.hit, true);
  assert.equal(removed.metroResources.some(row => row.path.endsWith('/retired.png')), false);
  fs.rmSync(path.join(project, '.snapback4-witness'), { recursive: true, force: true });
  const freshRun = spawnSync(process.execPath, [path.join(report, 'run.mjs'), starter, 'final-asset-fresh'], { stdio: 'inherit' });
  assert.equal(freshRun.status, 0);
  const fresh = JSON.parse(fs.readFileSync(path.join(report, `${starter}-final-asset-fresh.json`)));
  assert.equal(fresh.status, 0); assert.equal(fresh.receiptExit, 0); assert.equal(fresh.cache.hit, false);
  assert.equal(fresh.bundleHash, removed.bundleHash);
  const base = JSON.parse(fs.readFileSync(path.join(project, '.snapback4-witness/export-base.json')));
  const removedBuild = JSON.parse(gunzipSync(fs.readFileSync(path.join(report, 'evidence', `${starter}-final-asset-removed`, 'build.json.gz'))));
  const topology = inv => inv.files.map(({ path, type }) => ({ path, type }));
  assert.deepEqual(base.metroResources, removed.metroResources);
  assert.deepEqual(topology(base.executedApp.inventory), topology(removedBuild.executedApp.inventory));
  fs.writeFileSync(path.join(report, `${starter}-final-resource-comparison.json`), JSON.stringify({
    equal: true, exactExport: fresh.bundleHash, completeAppTopologyEqual: true,
    cachedAppTopology: topology(removedBuild.executedApp.inventory), freshAppTopology: topology(base.executedApp.inventory),
    cachedOverlay: removed.metroResources, freshXcodeProduct: base.metroResources,
  }, null, 2));
} finally { fs.writeFileSync(source, original); }
assert.equal(hashes.size, 5);
console.log('FINAL WARM MEDIAN', starter, durations.sort((a, b) => a - b)[2]);
