import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const starter = process.argv[2], report = path.resolve('reports/20261001-nx-export-proves-native');
const project = path.resolve('target/nx', starter);
const source = path.join(project, starter === 'plain' ? 'App.tsx' : 'app/_layout.tsx');
const original = fs.readFileSync(source, 'utf8'), configPath = path.join(project, 'app.json'), config = fs.readFileSync(configPath, 'utf8');
function run(label) {
  spawnSync(process.execPath, [path.join(report, 'run.mjs'), starter, label], { stdio: 'inherit' });
  return JSON.parse(fs.readFileSync(path.join(report, `${starter}-${label}.json`)));
}
function pass(r, hit) {
  assert.equal(r.status, 0, JSON.stringify(r)); assert.equal(r.receiptExit, 0); assert.equal(r.cache.hit, hit);
  assert.deepEqual(Object.values(r.segments), ['passed', 'passed', 'passed']); assert.equal(r.loadedHash, r.bundleHash);
}
try {
  const cold = run('cold'); pass(cold, false);
  let previous = cold.bundleHash; const warms = [];
  for (let i = 1; i <= 5; i++) {
    fs.writeFileSync(source, `${original}\nconsole.log("NX ${starter} JS-only ${i}");\n`);
    const r = run(`warm${i}`); pass(r, true); assert.notEqual(r.bundleHash, previous); previous = r.bundleHash; warms.push(r.durationMs);
  }
  console.log(`WARM MEDIAN ${starter}: ${warms.sort((a,b)=>a-b)[2]} ms`);
  const native = JSON.parse(config); native.expo.ios.infoPlist = { ...native.expo.ios.infoPlist, NXNativeMarker: 'native-change' };
  fs.writeFileSync(configPath, JSON.stringify(native, null, 2));
  const changed = run('native-change'); pass(changed, false);
  const built = JSON.parse(fs.readFileSync(path.join(path.dirname(changed.receiptPath), 'build.json')));
  assert.equal(built.executedApp.info.NXNativeMarker, 'native-change');
  assert.ok(built.phases.some(p => p.label === 'xcode-build'));

  fs.writeFileSync(source, `${original}\nthrow new Error("NX_STARTUP_THROW");\n`);
  const thrown = run('startup-throw'); assert.notEqual(thrown.status, 0); assert.equal(thrown.receiptExit, 1); assert.notEqual(thrown.phase, 'environment');
  fs.writeFileSync(source, original);
  const absent = run('missing-runtime'); assert.equal(absent.status, 0); assert.equal(absent.phase, 'environment');
  const off = run('opt-out'); assert.equal(off.status, 0); assert.equal(off.receiptPath, undefined);
} finally { fs.writeFileSync(source, original); fs.writeFileSync(configPath, config); }
