import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nativeFingerprint } from '../../../crates/snapback4/src/verbs/witness/export-cache.mjs';
import { skipReason, smokeResult } from '../../snapback4-expo/export-ios.mjs';

function mockExpo(root) {
  const put = (file, text) => { const p = path.join(root, 'node_modules', file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  put('expo/package.json', '{"name":"expo"}');
  put('@expo/config-plugins/package.json', '{"name":"@expo/config-plugins","main":"index.js"}');
  put('@expo/config-plugins/index.js', 'exports.compileModsAsync=async config=>config');
  put('@expo/config-plugins/build/utils/plugin-resolver.js', 'exports.resolveConfigPluginFunction=()=>{}');
  put('@expo/config-plugins/build/plugins/withMod.js', 'exports.withMod=exports.withBaseMod=config=>config');
  put('@expo/prebuild-config/index.js', 'exports.getPrebuildConfigAsync=async root=>({exp:JSON.parse(require("fs").readFileSync(require("path").join(root,"app.json"))).expo})');
}
const binary = new URL('../../../target/debug/snapback4', import.meta.url).pathname;

test('native fingerprint binds native, config, lock, plugin, SDK and package inputs, but not application JS', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-export-key-'));
  try {
    const put = (p, data = 'first') => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), data); };
    put('package.json', JSON.stringify({ dependencies: { 'snapback4-expo': '0.4.10', snapback4: '0.4.10' } }));
    mockExpo(root);
    put('package-lock.json'); put('app.json', JSON.stringify({ expo: { plugins: [] } })); put('src/App.tsx');
    put('node_modules/plugin/index.js'); put('node_modules/native/ios/module.swift');
    for (const name of ['snapback4', 'snapback4-expo']) put(`node_modules/${name}/package.json`, '{"version":"0.4.10"}');
    const key = (toolchain = { xcode: '27', sdk: '27' }, adapter = 'adapter') => nativeFingerprint(root, toolchain, adapter).hash;
    const before = key();
    assert.equal(nativeFingerprint(root, {}, 'adapter', { origin: 'one' }).hash, nativeFingerprint(root, {}, 'adapter', { origin: 'two' }).hash);
    put('src/App.tsx', 'different JS'); assert.equal(key(), before);
    for (const p of ['package.json', 'package-lock.json', 'app.json', 'node_modules/plugin/index.js', 'node_modules/native/ios/module.swift', 'node_modules/snapback4/package.json', 'node_modules/snapback4-expo/package.json']) {
      const old = fs.readFileSync(path.join(root, p));
      put(p, p.endsWith('/package.json') ? '{"version":"0.4.11"}' : p === 'package.json' ? JSON.stringify({ dependencies: { 'snapback4-expo': '0.4.11', snapback4: '0.4.11' } }) : p === 'app.json' ? '{"expo": {"name": "changed"}}' : 'changed');
      assert.notEqual(key(), before, p); put(p, old); assert.equal(key(), before);
    }
    for (const p of ['bun.lock', 'yarn.lock', 'Podfile.lock', 'app.config.ts', 'app.config.mjs', 'app.config.cjs', 'ios/Podfile.lock', 'ios/App/AppDelegate.swift', 'plugins/custom.js', 'assets/icon.png']) {
      const previous = key(); put(p); assert.notEqual(key(), previous, p); fs.rmSync(path.join(root, p));
      if (p.startsWith('ios/')) fs.rmSync(path.join(root, 'ios'), { recursive: true });
    }
    const toolsBefore = key();
    assert.notEqual(key({ xcode: '28', sdk: '27' }), toolsBefore);
    assert.notEqual(key({ xcode: '27', sdk: '28' }), toolsBefore);
    assert.notEqual(key(undefined, 'new-adapter'), toolsBefore);
    put('app.config.js', 'config');
    assert.notEqual(nativeFingerprint(root, {}, 'adapter', { origin: 'one' }).hash, nativeFingerprint(root, {}, 'adapter', { origin: 'two' }).hash);
    const config = key(); put('src/App.tsx', 'config could import this'); assert.notEqual(key(), config);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('only opt-out and unavailable environments skip; product failures remain failures', () => {
  assert.equal(skipReason('darwin', {}), null);
  assert.equal(skipReason('linux', {}), 'macOS is required');
  assert.equal(skipReason('darwin', { SNAPBACK4_NATIVE_SMOKE: 'off' }), 'SNAPBACK4_NATIVE_SMOKE=off');
  assert.equal(skipReason('darwin', { SNAPBACK4_NATIVE_SMOKE: 'false' }), null);
  for (const environmentCondition of ['simulator-list', 'missing-runtime', 'simulator-create', 'simulator-boot']) {
    assert.equal(smokeResult(1, { phase: 'environment', environmentCondition, error: 'E_WITNESS_PLATFORM: unavailable' }).status, 0);
  }
  for (const error of ['E_WITNESS_PROCESS: app died', 'E_WITNESS_ORIGIN', 'E_WITNESS_STEP', 'E_WITNESS_PROOF', 'E_WITNESS_SIMULATOR: install failed']) {
    assert.equal(smokeResult(1, { phase: 'preparation', error }).status, 1);
    assert.equal(smokeResult(1, { phase: 'environment', error }).status, 1);
    assert.equal(smokeResult(1, { phase: 'environment', environmentCondition: 'missing-runtime', error: 'E_WITNESS_INTERRUPTED: cancelled' }).status, 1);
  }
  assert.equal(smokeResult(null).status, 1);
  assert.equal(smokeResult(1).status, 1);
  assert.equal(smokeResult(0).status, 0);
});

test('npm bin symlink really exports, preserves export failure and honors opt-out', async () => {
  const { spawnSync } = await import('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-export-command-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    const expo = path.join(root, 'node_modules/expo/bin'); fs.mkdirSync(expo, { recursive: true });
    fs.writeFileSync(path.join(expo, 'cli'), `const fs=require('node:fs'),path=require('node:path');fs.writeFileSync('export-ran',JSON.stringify(process.argv.slice(2)));if(process.env.EXPORT_STATUS!=='0')process.exit(Number(process.env.EXPORT_STATUS));const out=process.argv[process.argv.indexOf('--output-dir')+1];fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'bundle.hbc'),'fixture');fs.writeFileSync(path.join(out,'metadata.json'),JSON.stringify({fileMetadata:{ios:{bundle:'bundle.hbc'}}}));`);
    const tools=path.join(root,'bin');fs.mkdirSync(tools);
    fs.symlinkSync(new URL('../bin/snapback4.js',import.meta.url).pathname,path.join(tools,'snapback4'));
    const bin = path.join(root, 'export-bin'); fs.symlinkSync(new URL('../../snapback4-expo/export-ios.mjs', import.meta.url).pathname, bin);
    const invoke = code => spawnSync(process.execPath, [bin], { cwd: root, encoding: 'utf8', env: { ...process.env, SNAPBACK4_BIN: binary, PATH: tools+':'+process.env.PATH, SNAPBACK4_NATIVE_SMOKE: 'off', EXPORT_STATUS: String(code) } });
    const success = invoke(0); assert.equal(success.status, 0, success.stderr);
    assert.match(success.stdout, /native smoke skipped: SNAPBACK4_NATIVE_SMOKE=off/);
    const args=JSON.parse(fs.readFileSync(path.join(root,'export-ran')));
    assert.deepEqual(args.slice(0,5),['export','--platform','ios','--dump-assetmap','--output-dir']);
    assert.ok(args[5].endsWith('/export')&&!args[5].endsWith('/dist'));
    const marker=fs.readFileSync(path.join(root,'dist/.snapback4-publication.json'),'utf8');
    assert.equal(JSON.parse(marker).mode,'skipped');
    const failed = invoke(7); assert.equal(failed.status, 7); assert.match(failed.stdout, /native smoke skipped/);
    assert.equal(fs.readFileSync(path.join(root,'dist/.snapback4-publication.json'),'utf8'),marker,'failed private export preserves current publication');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('export overlay binds exact HBC/assets, preserves native bytes, and rejects missing or incompatible exports', async () => {
  const { overlayExport } = await import('../../../crates/snapback4/src/verbs/witness/export-cache.mjs');
  const { inventory, hbc, nativeFiles } = await import('../../../crates/snapback4/src/verbs/witness/payload.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-overlay-'));
  try {
    const put = (p, bytes) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), bytes); };
    put('package.json', '{}'); put('node_modules/expo/package.json', '{}');
    put('node_modules/@expo/cli/build/src/export/metroAssetLocalPath.js', 'exports.getAssetLocalPath = (a, {scale}) => "assets/" + a.name + (scale === 1 ? "" : "@" + scale + "x") + ".png"');
    put('node_modules/@expo/cli/build/src/export/persistMetroAssets.js', 'exports.filterPlatformAssetScales = (platform, scales) => scales.filter(s => [1,2,3].includes(s))');
    const bytecode = Buffer.alloc(128); Buffer.from('c61fbc03c103191f', 'hex').copy(bytecode); bytecode.writeUInt32LE(98, 8);
    put('base/main.jsbundle', bytecode); put('base/App', Buffer.from('cffaedfe00112233', 'hex')); put('base/Info.plist', 'identity');
    const basePath = path.join(root, 'base'), inv = inventory(basePath);
    const base = { metroResources: [], executedApp: { path: basePath, inventory: inv, javascript: hbc(path.join(basePath, 'main.jsbundle')), native: nativeFiles(basePath, inv) } };
    bytecode[127] = 99; put('dist/_expo/static/js/ios/new.hbc', bytecode); put('dist/assets/abc', 'fresh pixels');
    put('dist/metadata.json', JSON.stringify({ fileMetadata: { ios: { bundle: '_expo/static/js/ios/new.hbc', assets: [{ path: 'assets/abc', ext: 'png' }] } } }));
    put('dist/assetmap.json', JSON.stringify({ image: { name: 'picture', type: 'png', fileHashes: ['unused-first-1x', 'abc', 'unused-4x'], scales: [1, 1, 4] } }));
    const copy = (label, exe, args) => fs.cpSync(args[1], args[2], { recursive: true, verbatimSymlinks: true });
    const result = overlayExport(root, path.join(root, 'dist'), base, path.join(root, 'output'), copy);
    assert.equal(result.executedApp.javascript.sha256, hbc(path.join(root, 'dist/_expo/static/js/ios/new.hbc')).sha256);
    assert.notEqual(result.executedApp.javascript.sha256, base.executedApp.javascript.sha256);
    assert.deepEqual(result.executedApp.native, base.executedApp.native);
    assert.equal(fs.readFileSync(path.join(root, 'output/assets/picture.png'), 'utf8'), 'fresh pixels');
    put('empty/_expo/static/js/ios/new.hbc', bytecode);
    put('empty/_expo/static/js/ios/web-worker-entry.hbc', bytecode);
    put('empty/metadata.json', JSON.stringify({ fileMetadata: { ios: { bundle: '_expo/static/js/ios/new.hbc', assets: [] } } }));
    put('empty/assetmap.json', '{}');
    const removed = overlayExport(root, path.join(root, 'empty'), result, path.join(root, 'removed'), copy);
    const fresh = overlayExport(root, path.join(root, 'empty'), base, path.join(root, 'fresh'), copy);
    assert.deepEqual(removed.executedApp.inventory, fresh.executedApp.inventory, 'removal matches a fresh base, including directories');
    assert.equal(fs.existsSync(path.join(root, 'removed/assets/picture.png')), false);
    assert.deepEqual(removed.metroResources, []);
    assert.equal(fs.existsSync(path.join(root, 'removed/_expo')), false, 'export-only worker chunks are absent from native embed');
    assert.throws(() => overlayExport(root, path.join(root, 'dist'), base, path.join(root, 'removed-config'), (...args) => { copy(...args); fs.unlinkSync(path.join(root, 'removed-config/Info.plist')); }), /unexpected native change/);
    assert.throws(() => overlayExport(root, path.join(root, 'dist'), base, path.join(root, 'raced'), (...args) => { copy(...args); put('dist/assets/abc', 'changed mid-copy'); }), /export changed/);
    fs.rmSync(path.join(root, 'dist/assets/abc'));
    assert.throws(() => overlayExport(root, path.join(root, 'dist'), base, path.join(root, 'missing'), copy));
    bytecode.writeUInt32LE(99, 8); put('dist/_expo/static/js/ios/new.hbc', bytecode);
    assert.throws(() => overlayExport(root, path.join(root, 'dist'), base, path.join(root, 'bad'), copy), /HBC version/);
    assert.equal(fs.existsSync(path.join(root, 'bad')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cache rechecks consumed producer/toolchain bytes and generated native additions', async () => {
  const { readBase } = await import('../../../crates/snapback4/src/verbs/witness/export-cache.mjs');
  const { inventory, hash } = await import('../../../crates/snapback4/src/verbs/witness/payload.mjs');
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-native-base-'));
  try {
    const ios = path.join(cache, 'snapshot/ios'); fs.mkdirSync(path.join(ios, 'build/generated'), { recursive: true });
    const dependencies = path.join(cache, 'snapshot/node_modules'); fs.mkdirSync(dependencies);
    const tool = path.join(cache, 'same-version-tool'); fs.writeFileSync(tool, 'original');
    const app = path.join(cache, 'base.app'); fs.mkdirSync(app);
    const base = { executedApp: { path: app, inventory: inventory(app) }, exportFingerprint: { hash: 'key' }, preparedInputs: { dependencies: inventory(dependencies) }, nativeClosure: { compiler: { inputs: [{ path: tool, kind: 'toolchain', sha256: hash('original') }] } }, generatedNative: inventory(path.join(cache, 'snapshot'), p => p !== 'ios' && !p.startsWith('ios/')) };
    fs.writeFileSync(path.join(cache, 'export-base.json'), JSON.stringify(base));
    assert.ok(await readBase(cache, { hash: 'key' }));
    fs.writeFileSync(path.join(dependencies, 'new-generated-header.h'), 'not in a positive .d record');
    assert.equal(await readBase(cache, { hash: 'key' }), null); fs.rmSync(path.join(dependencies, 'new-generated-header.h'));
    assert.ok(await readBase(cache, { hash: 'key' }));
    assert.equal(await readBase(cache, { hash: 'other' }), null);
    fs.writeFileSync(path.join(app, 'tampered'), 'tampered native base'); assert.equal(await readBase(cache, { hash: 'key' }), null); fs.rmSync(path.join(app, 'tampered'));
    fs.writeFileSync(tool, 'changed, version string unchanged'); assert.equal(await readBase(cache, { hash: 'key' }), null);
    fs.writeFileSync(tool, 'original');
    fs.writeFileSync(path.join(ios, 'build/generated/previously-missing.h'), 'new header'); assert.equal(await readBase(cache, { hash: 'key' }), null);
  } finally { fs.rmSync(cache, { recursive: true, force: true }); }
});

test('negative header topology follows SDK root aliases', async () => {
  const { lookupTopology } = await import('../../../crates/snapback4/src/verbs/witness/export-cache.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-sdk-'));
  try {
    fs.mkdirSync(path.join(root, 'sdk')); fs.symlinkSync('sdk', path.join(root, 'alias'));
    const before = lookupTopology([path.join(root, 'alias')]);
    fs.writeFileSync(path.join(root, 'sdk/new.h'), 'new previously absent header');
    assert.notEqual(lookupTopology(before.roots).sha256, before.sha256);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('config file references bind excluded source bytes and refuse external paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-config-file-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    mockExpo(root);
    fs.mkdirSync(path.join(root, 'src')); fs.writeFileSync(path.join(root, 'src/native.js'), 'first');
    const config = value => fs.writeFileSync(path.join(root, 'app.json'), JSON.stringify({ expo: { ios: { googleServicesFile: value } } }));
    config('src/native.js'); const before = nativeFingerprint(root, {}, '').hash;
    fs.writeFileSync(path.join(root, 'src/native.js'), 'second'); assert.notEqual(nativeFingerprint(root, {}, '').hash, before);
    for (const value of ['/tmp/external.plist', '../external.plist', 'file:///tmp/external.plist', 'FILE:///tmp/external.plist', 'File:///tmp/external.plist', 'src/link/../native.js']) {
      config(value); assert.throws(() => nativeFingerprint(root, {}, ''), /out-of-tree config paths/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('retention keeps five completed runs, compresses older receipts and leaves active runs alone', async () => {
  const { retainEvidence } = await import('../../snapback4-expo/export-ios.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-retention-'));
  try {
    for (let i = 1; i <= 8; i++) {
      const dir = path.join(root, `${i}-123`); fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'smoke-ios-run.json'), JSON.stringify({ exitStatus: 1, ...(i !== 2 ? { endedAt: 1 } : {}) }));
      fs.writeFileSync(path.join(dir, 'smoke-ios-screen.mp4'), 'video');
      if (i === 1) fs.writeFileSync(path.join(dir, 'proof.json.gz'), 'already archived before interruption');
      if (i !== 2) retainEvidence(root, dir, binary);
    }
    assert.equal(fs.existsSync(path.join(root, '1-123/smoke-ios-run.json.gz')), true);
    assert.equal(fs.existsSync(path.join(root, '1-123/smoke-ios-screen.mp4')), false);
    assert.equal(fs.readFileSync(path.join(root, '1-123/proof.json.gz'), 'utf8'), 'already archived before interruption');
    assert.equal(fs.existsSync(path.join(root, '2-123/smoke-ios-screen.mp4')), true);
    assert.equal(fs.existsSync(path.join(root, '4-123/smoke-ios-screen.mp4')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('wrapper forwards both signals and waits for child cleanup before returning signal status', async () => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-export-interrupt-'));
  try {
    const helper = path.join(root, 'parent.mjs');
    const module = new URL('../../snapback4-expo/export-ios.mjs', import.meta.url).href;
    fs.writeFileSync(helper, `import {runChild} from ${JSON.stringify(module)}; const result = await runChild(process.execPath, ['-e', process.argv[2]]); process.exitCode = result.status;`);
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const code = `const fs=require('fs'); process.on('${signal}',()=>setTimeout(()=>{fs.writeFileSync(${JSON.stringify(path.join(root, signal))},'cleaned');process.exit(1)},150)); console.log('ready'); setInterval(()=>{},1000);`;
      const child = spawn(process.execPath, [helper, code], { stdio: ['ignore', 'pipe', 'pipe'] });
      await once(child.stdout, 'data'); child.kill(signal);
      const [status] = await once(child, 'close');
      assert.equal(status, signal === 'SIGINT' ? 130 : 143);
      assert.equal(fs.readFileSync(path.join(root, signal), 'utf8'), 'cleaned');
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('react-native.config.mjs refuses through the real static preparation adapter', { skip: process.platform !== 'darwin' }, async () => {
  const { spawnSync } = await import('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb4-native-config-'));
  try {
    fs.writeFileSync(path.join(root, 'react-native.config.mjs'), 'export default {}');
    const out = path.join(root, 'out'); fs.mkdirSync(out);
    const helper = new URL('../../../crates/snapback4/src/verbs/witness/prepare.mjs', import.meta.url).pathname;
    const result = spawnSync(process.execPath, [helper, 'build', root, out, 'no-device', 'http://127.0.0.1:4400', 'dist'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /E_WITNESS_NATIVE_COMPAT: react-native.config.mjs/);
    assert.equal(fs.existsSync(path.join(root, '.snapback4-witness/DerivedData')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
