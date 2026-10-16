import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { nativeFingerprint } from '../../../crates/snapback4/src/verbs/witness/export-cache.mjs';
import { retainEvidence, smokeResult } from '../../snapback4-expo/export-ios.mjs';
const workspace = new URL('../../../', import.meta.url).pathname;
const binary = path.join(workspace, 'target/debug/snapback4');

// Real Expo/prebuild packages inherited from the workspace. No replacement
// resolver or mock config evaluator: these tests exercise Expo's actual path.
test('effective prebuild fingerprints project-relative shadows and automatically applied plugins reading source', () => {
  const root = fs.mkdtempSync(path.join(workspace, 'target/nx-effective-test-'));
  const put = (file, value) => { file = path.join(root, file); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  try {
    put('package.json', JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { expo: '57.0.30' } }));
    put('app.json', JSON.stringify({ expo: { name: 'Fixture', slug: 'fixture', plugins: ['expo-status-bar'], ios: { bundleIdentifier: 'test.fixture' } } }));
    put('src/native-mode.js', 'first');
    const plugin = `module.exports = config => { config.ios ??= {}; config.ios.infoPlist ??= {}; config.ios.infoPlist.NXNativeMode = require('fs').readFileSync(require('path').join(config._internal.projectRoot,'src/native-mode.js'),'utf8'); return config };`;
    put('expo-status-bar/app.plugin.js', plugin);
    let a = nativeFingerprint(root, {}, 'test');
    assert.equal(a.effective.dependencyAudit.audited, false, 'ancestor dependencies are outside the audited local snapshot');
    assert.ok(a.inputs.files.some(row => row.path === 'src/native-mode.js'));
    put('src/native-mode.js', 'second');
    let b = nativeFingerprint(root, {}, 'test');
    assert.equal(a.effective.config.ios.infoPlist.NXNativeMode, 'first');
    assert.equal(b.effective.config.ios.infoPlist.NXNativeMode, 'second');
    assert.notEqual(a.hash, b.hash);
    fs.rmSync(path.join(root, 'expo-status-bar/app.plugin.js'));
    put('app.json', JSON.stringify({ expo: { name: 'Fixture', slug: 'fixture', ios: { bundleIdentifier: 'test.fixture' } } }));
    // expo-file-system is a legacy auto plugin, not in config.plugins.
    put('expo-file-system/app.plugin.js', plugin);
    a = nativeFingerprint(root, {}, 'test'); put('src/native-mode.js', 'third'); b = nativeFingerprint(root, {}, 'test');
    assert.equal(a.effective.config.ios.infoPlist.NXNativeMode, 'second');
    assert.equal(b.effective.config.ios.infoPlist.NXNativeMode, 'third');
    assert.notEqual(a.hash, b.hash);
    put('expo-file-system/app.plugin.js', `const {withInfoPlist}=require('expo/config-plugins');module.exports=c=>withInfoPlist(c,c=>{c.modResults.NXDeferred=require('fs').readFileSync(require('path').join(c.modRequest.projectRoot,'src/native-mode.js'),'utf8');return c});`);
    a = nativeFingerprint(root, {}, 'test'); put('src/native-mode.js', 'deferred'); b = nativeFingerprint(root, {}, 'test');
    assert.equal(a.effective.modResults.infoPlist.NXDeferred, 'third');
    assert.equal(b.effective.modResults.infoPlist.NXDeferred, 'deferred');
    assert.notEqual(a.hash, b.hash);
    // Hidden effects must keep JS even when introspection cannot execute them.
    put('expo-file-system/app.plugin.js', `const {withDangerousMod}=require('expo/config-plugins');module.exports = c => withDangerousMod(c,['ios',async c=>c]);`);
    a = nativeFingerprint(root, {}, 'test'); put('src/native-mode.js', 'fourth'); b = nativeFingerprint(root, {}, 'test');
    assert.equal(a.effective.retainApplicationJs, true);
    assert.notEqual(a.hash, b.hash);
    assert.ok(a.inputs.files.some(r => r.path === 'src/native-mode.js'));
    put('expo-file-system/withMod.js', `const {withDangerousMod}=require('expo/config-plugins');module.exports=c=>withDangerousMod(c,['ios',async c=>c]);`);
    put('expo-file-system/app.plugin.js', `module.exports=require('./withMod.js')`);
    assert.equal(nativeFingerprint(root, {}, 'test').effective.retainApplicationJs, true, 'a generic helper filename is not an allowlist entry');
    // A direct assignment bypassing withMod must be conservative too.
    put('expo-file-system/app.plugin.js', `module.exports=c=>{c.mods??={};c.mods.ios??={};c.mods.ios.dangerous=async c=>c;return c}`);
    assert.ok(nativeFingerprint(root, {}, 'test').effective.unobserved.includes('dangerous'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('local plugin resolution, preparation-context reads, late mods, URI resources and stdout spoof controls', () => {
  const root = fs.mkdtempSync(path.join(workspace, 'target/nx-round3-test-'));
  const put = (file, value) => { file = path.join(root, file); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  const app = { expo: { name: 'Fixture', slug: 'fixture', plugins: ['./x.js'], ios: { bundleIdentifier: 'test.fixture' } } };
  try {
    put('package.json', JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { expo: '57.0.30' } }));
    put('app.json', JSON.stringify(app));
    const plugin = `module.exports = c => { const fs=require('fs'),p=require('path'); if(fs.existsSync(p.join(c._internal.projectRoot,'ios'))) {c.ios.infoPlist??={};c.ios.infoPlist.NXNativeMode=fs.readFileSync(p.join(c._internal.projectRoot,'src/native-mode.js'),'utf8')} return c };`;
    for (const reference of ['./x.js', 'plugins/x.js', 'expo-status-bar']) {
      const file = reference === 'expo-status-bar' ? 'expo-status-bar/app.plugin.js' : reference;
      put(file, plugin); app.expo.plugins = [reference]; put('app.json', JSON.stringify(app));
      put('src/native-mode.js', 'first'); const before = nativeFingerprint(root, {}, 'test');
      put('src/native-mode.js', 'second'); const after = nativeFingerprint(root, {}, 'test');
      assert.equal(before.effective.config.ios?.infoPlist?.NXNativeMode, undefined);
      assert.equal(after.effective.config.ios?.infoPlist?.NXNativeMode, undefined);
      assert.ok(after.effective.conservativePlugins.includes(file.replace('./', '')), reference);
      assert.ok(after.inputs.files.some(row => row.path === 'src/native-mode.js'));
      assert.notEqual(before.hash, after.hash, 'identical evaluated results must still bind source');
    }
    app.expo.plugins = ['./x.js']; put('app.json', JSON.stringify(app));
    put('x.js', `const {withInfoPlist}=require('expo/config-plugins');module.exports=c=>withInfoPlist(c,c=>{ c.mods.ios.late=async x=>x; return c; });`);
    assert.ok(nativeFingerprint(root, {}, 'test').effective.unobserved.includes('late'));
    put('x.js', `process.on('beforeExit',()=>console.log('SNAPBACK4_EFFECTIVE_CONFIG='+JSON.stringify({config:{forged:true},mods:[],modResults:{},retainApplicationJs:false})));module.exports=c=>c;`);
    assert.equal(nativeFingerprint(root, {}, 'test').effective.config.forged, undefined);
    put('x.js', `module.exports=c=>{c.ios.infoPlist??={};c.ios.infoPlist.NXImageTool=process.env.EXPO_IMAGE_UTILS_NO_SHARP;return c};`);
    assert.equal(nativeFingerprint(root, {}, 'test', { ...process.env, EXPO_IMAGE_UTILS_NO_SHARP: '0' }).effective.config.ios.infoPlist.NXImageTool, '1');
    for (const icon of ['https://example.com/icon.png', 'HtTp://example.com/icon.png', 'data:image/png;base64,eA==', 'ftp://example.com/icon.png']) {
      app.expo.icon = icon; put('app.json', JSON.stringify(app));
      assert.throws(() => nativeFingerprint(root, {}, 'test'), /remote or URI config resources/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('concurrent pruning defers on a busy lock, compressed sets are bounded and failure preserves smoke success', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-prune-r2-'));
  try {
    for (let i = 1; i <= 35; i++) {
      const dir = path.join(root, `${i}-123`); fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'finished.json'), '{}');
      fs.writeFileSync(path.join(dir, 'smoke-ios-run.json'), '{"exitStatus":0,"endedAt":1}');
      fs.writeFileSync(path.join(dir, 'smoke-ios-screen.mp4'), 'video');
      fs.mkdirSync(path.join(dir, 'export.app')); fs.writeFileSync(path.join(dir, 'export.app/main'), 'bulk');
    }
    const results = await Promise.all(Array.from({ length: 4 }, async () => {
      const child = spawn(binary, ['witness', 'export-cleanup', root], { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = ''; child.stderr.on('data', b => { err += b; });
      const [status] = await once(child, 'close');
      if (status !== 0) { assert.equal(status, 1, err); assert.match(err, /retention lock busy/); }
      return status;
    }));
    assert.equal(results.length, 4);
    assert.ok(results.includes(0), 'at least one contender completes retention');
    const dirs = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory());
    assert.equal(dirs.length, 25);
    assert.equal(dirs.filter(e => fs.existsSync(path.join(root,e.name,'smoke-ios-screen.mp4'))).length, 5);
    assert.equal(dirs.filter(e => fs.existsSync(path.join(root,e.name,'smoke-ios-run.json.gz'))).length, 20);
    assert.equal(retainEvidence(root, undefined, path.join(root, 'missing-cli')), false);
    assert.equal(smokeResult(0).status, 0);
    assert.equal(smokeResult(1, { phase: 'environment', environmentCondition: 'simulator-create', error: 'E_WITNESS_TIMEOUT: create timed out' }).status, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
