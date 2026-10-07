import { fixtureCommand } from './helpers/fixture-command.mjs';
import { fixtureTestMs, fixtureWorkMs } from '../../../scripts/test-work-bounds.mjs';
import { signalTargetAlive } from '../../../scripts/test-signals.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inventory } from '../../../crates/snapback4/src/verbs/witness/payload.mjs';
const pkg = new URL('../', import.meta.url).pathname;
const binary = new URL('../../../target/debug/snapback4', import.meta.url).pathname;
const wrapper = new URL('../../snapback4-expo/export-ios.mjs', import.meta.url).href;
const payload = new URL('../../../crates/snapback4/src/verbs/witness/payload.mjs', import.meta.url).href;
function install(root) {
  const installed = path.join(root, 'node_modules/snapback4');
  fs.mkdirSync(path.join(installed, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(installed, 'dist'));
  fs.copyFileSync(path.join(pkg, 'bin/snapback4.js'), path.join(installed, 'bin/snapback4.js'));
  fs.copyFileSync(path.join(pkg, 'dist/resolve-binary.js'), path.join(installed, 'dist/resolve-binary.js'));
  fs.writeFileSync(path.join(installed, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(root, 'node_modules/.bin'));
  fs.symlinkSync('../snapback4/bin/snapback4.js', path.join(root, 'node_modules/.bin/snapback4'));
  fs.chmodSync(path.join(installed, 'bin/snapback4.js'), 0o755);
  return path.join(installed, 'bin/snapback4.js');
}
test('installed CLI shim preserves each forwarded child termination signal', { timeout: fixtureTestMs(3) }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-shim-signals-'));
  try {
    const shim = install(root), child = path.join(root, 'child.mjs');
    fs.writeFileSync(child, `#!${process.execPath}\nimport {signalSelf} from ${JSON.stringify(new URL('../../../scripts/test-owned-command.mjs', import.meta.url).href)};signalSelf(process.argv[2]); setTimeout(()=>process.exit(99),1000);`); fs.chmodSync(child, 0o755);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const result = await fixtureCommand(process.execPath, [shim, signal], { label: `installed CLI shim ${signal}`, env: { ...process.env, SNAPBACK4_BIN: child } });
      assert.ok(result.signal === signal || result.status === 128 + os.constants.signals[signal], JSON.stringify({ signal, status: result.status, actualSignal: result.signal, stderr: result.stderr }));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Successful publication schedules detached maintenance even when its native
// handoff fails. Keep this fixture's custody records until those owners exit.
async function maintenanceExited(root) {
  const live = name => {
    let record;
    try { record=JSON.parse(fs.readFileSync(path.join(root,'artifacts/native-smoke',name),'utf8')).process; } catch { return false; }
    return record ? signalTargetAlive(record) : false;
  };
  const deadline=Date.now()+45000;
  while(['maintenance-next.json','maintenance-active.json'].some(live)) {
    assert.ok(Date.now()<deadline,'fixture maintenance exited before deleting its custody records');
    await new Promise(resolve=>setTimeout(resolve,25));
  }
}
test('real wrapper finally preserves the previous export across interrupted and rejected publication through installed shim', { timeout: fixtureTestMs(12) }, async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-wrapper-fault-')));
  try {
    install(root);
    const library = path.join(root, 'interposer.' + (process.platform === 'darwin' ? 'dylib' : 'so'));
    const compile = spawnSync('cc', [...(process.platform === 'darwin' ? ['-dynamiclib'] : ['-shared', '-fPIC']), new URL('./publication-interposer.c', import.meta.url).pathname, '-o', library], { encoding: 'utf8' });
    assert.equal(compile.status, 0, compile.stderr);
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    fs.mkdirSync(path.join(root, 'node_modules/expo/bin'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules/expo/bin/cli'), `const fs=require('fs'),p=require('path');const out=process.argv[process.argv.indexOf('--output-dir')+1];fs.mkdirSync(out,{recursive:true});fs.writeFileSync(p.join(out,'bundle'),'proved bytes');fs.writeFileSync(p.join(out,'metadata.json'),JSON.stringify({fileMetadata:{ios:{bundle:'bundle'}}}));`);
    const dispatcher = path.join(root, 'dispatch.mjs');
    fs.writeFileSync(dispatcher, `#!${process.execPath}
import {signalSelf} from ${JSON.stringify(new URL('../../../scripts/test-owned-command.mjs', import.meta.url).href)};
import fs from 'node:fs'; import path from 'node:path'; import {spawnSync} from 'node:child_process'; import {inventory,hash} from ${JSON.stringify(payload)};
const args=process.argv.slice(2);
if(args[1]==='ios') {
 const dir=args[args.indexOf('--artifacts')+1], source=args[args.indexOf('--export')+1];
 const proof=JSON.stringify({exported:{inventory:inventory(source)}});
 fs.writeFileSync(path.join(dir,'proof.json'),proof);
 const skipped=process.env.SB4_FAULT.startsWith('skip-');
 fs.writeFileSync(path.join(dir,'smoke-ios-run.json'),JSON.stringify(skipped?{exitStatus:1,phase:'environment',environmentCondition:'missing-runtime',error:'E_WITNESS_SIMULATOR: runtime unavailable'}:{exitStatus:0,proof:{sha256:hash(proof)}}));
 if(skipped)process.exit(1);
} else if(args[1]==='export-publish' && ['missing','mismatch','skip-missing','skip-mismatch'].includes(process.env.SB4_FAULT)) {
 if(process.env.SB4_FAULT.endsWith('mismatch'))fs.writeFileSync(path.join(path.dirname(args[2]),'publication.json'),JSON.stringify({verifiedAt:Date.now(),source:args[2],target:args[3],proofSha256:'wrong',files:[]}));
} else {
 const env={...process.env};
 // A valid export reaches publication. Refuse only its downstream latest
 // handoff, so this publication-fault fixture never launches real native tools.
 if(args[1]==='export-publish')fs.mkdirSync(path.join(path.dirname(path.dirname(args[2])),'latest.json.tmp'),{recursive:true});
 if(args[1]==='export-publish')env[process.platform==='darwin'?'DYLD_INSERT_LIBRARIES':'LD_PRELOAD']=${JSON.stringify(library)};
 const r=spawnSync(${JSON.stringify(binary)},args,{env,stdio:args[1]==='export-publish'||args[1]==='export-lease'?['inherit','inherit','inherit',3]:'inherit'});
 if(r.signal){signalSelf(r.signal);setTimeout(()=>process.exit(128+15),100);}else process.exit(r.status??1);
}
`); fs.chmodSync(dispatcher, 0o755);
    const env = { ...process.env, SNAPBACK4_BIN: dispatcher, PATH: path.join(root, 'node_modules/.bin') + ':' + process.env.PATH, SB4_FAULT_TARGET: path.join(root, 'dist') };
    delete env.SNAPBACK4_NATIVE_SMOKE;
    const run = fault => { const result = spawnSync(process.execPath, ['--input-type=module', '-e', `Object.defineProperty(process,'platform',{value:'darwin'});const {main}=await import(${JSON.stringify(wrapper)});try{process.exitCode=await main()}catch(e){console.error(e);process.exitCode=1}`], { cwd: root, env: { ...env, SB4_FAULT: fault }, encoding: 'utf8', timeout: fixtureWorkMs, killSignal: 'SIGKILL' }); assert.equal(result.error, undefined, `publication fixture ${fault}: ${result.error?.message}`); return result; };
    for (const fault of ['missing', 'mismatch', 'skip-missing', 'skip-mismatch', 'before', 'after', 'tamper']) {
      await maintenanceExited(root);
      fs.rmSync(path.join(root, 'artifacts'), { recursive: true, force: true });
      fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
      fs.mkdirSync(path.join(root, 'dist')); fs.writeFileSync(path.join(root, 'dist/old'), 'last good export');
      const previous = inventory(path.join(root, 'dist')).files;
      const result = run(fault);
      assert.notEqual(result.status, 0, fault + result.stdout + result.stderr);
      assert.match(result.stdout, /export output publication failed: .*publication.json/, fault + result.stdout + result.stderr);
      const runs = fs.readdirSync(path.join(root, 'artifacts/native-smoke')).filter(n => /^\d+-\d+$/.test(n));
      assert.equal(runs.length, 1);
      const dir = path.join(root, 'artifacts/native-smoke', runs[0]);
      const oldAt = fault === 'after' ? path.join(dir, 'publication-export') : path.join(root, 'dist');
      assert.deepEqual(inventory(oldAt).files, previous, fault);
      if (fault === 'after' || fault === 'before') {
        assert.equal(fs.existsSync(path.join(dir, 'publication-pending.json')), true);
        // Even a premature completion marker plus retention pressure preserves custody.
        fs.writeFileSync(path.join(dir, 'finished.json'), '{}');
        for(let i=1;i<=6;i++){const newer=path.join(root,'artifacts/native-smoke',`${Date.now()+i}-123`);fs.mkdirSync(newer);fs.writeFileSync(path.join(newer,'finished.json'),'{}');}
        const cleanup=spawnSync(binary,['witness','export-cleanup',path.join(root,'artifacts/native-smoke')],{encoding:'utf8'});
        assert.equal(cleanup.status,0,cleanup.stderr);
        assert.deepEqual(inventory(path.join(root,'dist')).files,previous,'retention itself restores the previous publication');
        assert.equal(fs.existsSync(path.join(dir,'publication-pending.json')),false);
        const restored = run('tamper'); assert.notEqual(restored.status,0,restored.stdout+restored.stderr);
        assert.deepEqual(inventory(path.join(root,'dist')).files,previous,'recovery and failed retry restore last good export');
        const next = run(''); assert.equal(next.status, 0, next.stdout + next.stderr);
        assert.equal(fs.readFileSync(path.join(root, 'dist/bundle'), 'utf8'), 'proved bytes');
        assert.equal(fs.existsSync(path.join(dir, 'publication-pending.json')), false);
      }
    }
    const skip = run('skip-valid'); assert.equal(skip.status, 0, skip.stdout + skip.stderr);
    // A blocked latest-pointer write fails native scheduling loudly downstream
    // of the successful publication, without ever launching a real simulator.
    assert.match(skip.stderr, /native smoke failed to start/);
    assert.equal(fs.readFileSync(path.join(root, 'dist/bundle'), 'utf8'), 'proved bytes');
  } finally { await maintenanceExited(root); fs.rmSync(root, { recursive: true, force: true }); }
});
