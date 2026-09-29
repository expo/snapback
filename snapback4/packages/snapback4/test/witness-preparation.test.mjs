import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { inventory, hbc, nativeFiles, differences, seal, installedInventory, shellQuote, repackAssets } from '../../../crates/snapback4/src/verbs/witness/payload.mjs';

test('Xcode shell environment keeps executable paths literal', () => {
  const value = "/a path/with'quotes/$HOME/$(printf wrong)/`printf wrong`/node";
  const result = spawnSync('/bin/sh', ['-c', `printf %s ${shellQuote(value)}`], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, value);
});

test('installation accepts only the measured framework execute-bit normalization', () => {
  const file = { path: 'Frameworks/Hermes.framework/Hermes', type: 'file', mode: 0o755, bytes: 100, sha256: 'same' };
  const base = { files: [file] }, installed = { files: [{ ...file, mode: 0o644 }] };
  assert.equal(installedInventory(base, installed, [file]), installed);
  for (const change of [{ sha256: 'changed' }, { bytes: 101 }, { mode: 0o600 }, { type: 'symlink' }]) {
    assert.throws(() => installedInventory(base, { files: [{ ...installed.files[0], ...change }] }, [file]), /E_WITNESS_PROOF/);
  }
  assert.throws(() => installedInventory(base, installed, []), /E_WITNESS_PROOF/);
  assert.throws(() => installedInventory({ files: [{ ...file, path: 'App' }] }, { files: [{ ...file, path: 'App', mode: 0o644 }] }, [{ ...file, path: 'App' }]), /E_WITNESS_PROOF/);
});

test('payload inventory binds bytes, paths, modes and safe relative links', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'np-inventory-'));
  try {
    fs.writeFileSync(path.join(dir, 'exe'), Buffer.from('cffaedfe00000000', 'hex'));
    fs.writeFileSync(path.join(dir, 'asset'), 'A');
    fs.symlinkSync('asset', path.join(dir, 'alias'));
    const a = inventory(dir);
    assert.equal(nativeFiles(dir, a)[0].path, 'exe');
    fs.writeFileSync(path.join(dir, 'asset'), 'B');
    const b = inventory(dir);
    assert.notEqual(a.sha256, b.sha256);
    assert.deepEqual(differences(a.files, b.files).map(x => x.path), ['asset']);
    fs.chmodSync(path.join(dir, 'exe'), 0o700);
    assert.notEqual(inventory(dir).sha256, b.sha256);
    fs.symlinkSync('../', path.join(dir, 'escape'));
    assert.throws(() => inventory(dir), /E_WITNESS_PROOF.*escaping/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('source, truncated and wrong magic bundles cannot masquerade as HBC', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'np-hbc-')), file = path.join(dir, 'main.jsbundle');
  try {
    for (const bytes of [Buffer.from('console.log("hello")'), Buffer.alloc(128), Buffer.from('c61fbc03c103191f62000000', 'hex')]) {
      fs.writeFileSync(file, bytes); assert.throws(() => hbc(file), /E_WITNESS_HERMES/);
    }
    const bytes = Buffer.alloc(128); Buffer.from('c61fbc03c103191f', 'hex').copy(bytes); bytes.writeUInt32LE(98, 8);
    fs.writeFileSync(file, bytes); assert.equal(hbc(file).version, 98);
    seal(path.join(dir, 'build.json'), { result: 'A' });
    assert.throws(() => seal(path.join(dir, 'build.json'), { result: 'B' }), /EEXIST/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('repack assets must be exactly the new bundle export resource graph', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'np-assets-'));
  try {
    for (const side of ['app', 'export']) {
      fs.mkdirSync(path.join(dir, side, 'assets'), { recursive: true });
      fs.writeFileSync(path.join(dir, side, 'assets/image.png'), 'B');
    }
    assert.ok(repackAssets(path.join(dir, 'app'), path.join(dir, 'export')).sha256);
    fs.writeFileSync(path.join(dir, 'app/assets/image.png'), 'A');
    assert.throws(() => repackAssets(path.join(dir, 'app'), path.join(dir, 'export')), /E_WITNESS_REPACK/);
    fs.writeFileSync(path.join(dir, 'app/assets/image.png'), 'B');
    fs.writeFileSync(path.join(dir, 'app/assets/unreferenced.png'), 'extra');
    assert.throws(() => repackAssets(path.join(dir, 'app'), path.join(dir, 'export')), /E_WITNESS_REPACK/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('native Xcode sources, resources and build inputs outside covered roots refuse', async () => {
  const { nativeReferences } = await import('../../../crates/snapback4/src/verbs/witness/native-inputs.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'np-native-inputs-'));
  fs.mkdirSync(path.join(dir, 'ios'));
  fs.mkdirSync(path.join(dir, 'SharedNative'));
  fs.writeFileSync(path.join(dir, 'SharedNative/Foo.swift'), 'before');
  try {
    const ref = value => ({ objects: { root: { isa: 'PBXGroup', children: ['file'] },
      file: { isa: 'PBXFileReference', path: value, sourceTree: '<group>' } } });
    assert.ok(nativeReferences(dir, ref('App.swift'), 'App'));
    for (const value of ['../SharedNative/Foo.swift', '../SharedNative/image.png', '../SharedNative/config.xcconfig', '/other/native.swift', 'App.xcodeproj/xcuserdata-extra/Foo.swift']) {
      assert.throws(() => nativeReferences(dir, ref(value), 'App'), /E_WITNESS_NATIVE_COMPAT/);
    }
    fs.writeFileSync(path.join(dir, 'SharedNative/Foo.swift'), 'after');
    assert.throws(() => nativeReferences(dir, ref('../SharedNative/Foo.swift'), 'App'), /E_WITNESS_NATIVE_COMPAT/);
    // A group path, search path, file list and custom shell phase each bypassed a directory hash.
    for (const objects of [
      { g: { isa: 'PBXGroup', path: '../SharedNative', children: ['f'] }, f: { isa: 'PBXFileReference', path: 'Foo.swift' } },
      { c: { buildSettings: { HEADER_SEARCH_PATHS: '$(SRCROOT)/../SharedNative' } } },
      { c: { buildSettings: { 'HEADER_SEARCH_PATHS[sdk=iphonesimulator*]': '/opt/shared-native' } } },
      { c: { buildSettings: { OTHER_SWIFT_FLAGS: '-I/opt/shared-native' } } },
      { c: { buildSettings: { OTHER_LDFLAGS: '@/opt/shared-native/response' } } },
      { c: { buildSettings: { CC: '/opt/shared-native/compiler' } } },
      { c: { buildSettings: { REACT_NATIVE_PATH: '/opt/shared-native' } } },
      { c: { settings: { COMPILER_FLAGS: '-include /opt/shared-native/header.h' } } },
      { c: { isa: 'PBXProject', projectDirPath: '../SharedNative' } },
      { c: { isa: 'XCRemoteSwiftPackageReference', repositoryURL: 'https://example.test/native' } },
      { p: { inputPaths: ['$(SRCROOT)/../SharedNative/Foo.swift'] } },
      { p: { inputFileListPaths: ['$(SRCROOT)/../SharedNative/inputs.xcfilelist'] } },
      { p: { isa: 'PBXShellScriptBuildPhase', shellPath: '/bin/sh', shellScript: 'cat ../SharedNative/Foo.swift' } },
    ]) assert.throws(() => nativeReferences(dir, { objects }, 'App'), /E_WITNESS_NATIVE_COMPAT/);
    fs.writeFileSync(path.join(dir, 'ios/inputs.xcfilelist'), '$(SRCROOT)/../SharedNative/Foo.swift\n');
    assert.throws(() => nativeReferences(dir, { objects: { p: { inputFileListPaths: ['$(SRCROOT)/inputs.xcfilelist'] } } }, 'App'), /E_WITNESS_NATIVE_COMPAT/);
    fs.writeFileSync(path.join(dir, 'ios/inputs.list'), '$(SRCROOT)/../SharedNative/Foo.swift\n');
    assert.throws(() => nativeReferences(dir, { objects: { p: { inputFileListPaths: ['$(SRCROOT)/inputs.list'] } } }, 'App'), /E_WITNESS_NATIVE_COMPAT/);
    fs.writeFileSync(path.join(dir, 'ios/build.config'), '#include "../SharedNative/config.xcconfig"\n');
    assert.throws(() => nativeReferences(dir, { objects: {
      f: { isa: 'PBXFileReference', path: 'build.config' }, c: { baseConfigurationReference: 'f' },
    } }, 'App'), /E_WITNESS_NATIVE_COMPAT/);
    fs.writeFileSync(path.join(dir, 'ios/import.h'), '#include </opt/shared-native/header.h>\n');
    assert.throws(() => nativeReferences(dir, { objects: {} }, 'App'), /E_WITNESS_NATIVE_COMPAT/);
    fs.unlinkSync(path.join(dir, 'ios/import.h'));
    fs.mkdirSync(path.join(dir, 'ios/Images.xcassets'));
    fs.writeFileSync(path.join(dir, 'ios/Images.xcassets/Contents.json'), JSON.stringify({ images: [{ filename: '../../SharedNative/image.png' }] }));
    assert.throws(() => nativeReferences(dir, { objects: {} }, 'App'), /E_WITNESS_NATIVE_COMPAT/);
    fs.rmSync(path.join(dir, 'ios/Images.xcassets'), { recursive: true });
    fs.symlinkSync('../SharedNative', path.join(dir, 'ios/alias'));
    assert.throws(() => nativeReferences(dir, ref('alias/Foo.swift'), 'App'), /E_WITNESS_NATIVE_COMPAT/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('preparation rejects wrong HBC versions on own-build and repack before issuing a receipt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'np-prepare-hbc-'));
  const project = path.join(root, 'project'), app = path.join(root, 'fixture.app');
  const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value); };
  try {
    write(path.join(project, 'package.json'), {});
    write(path.join(project, 'app.json'), { expo: { newArchEnabled: true } });
    write(path.join(project, 'package-lock.json'), { packages: { 'node_modules/@expo/repack-app': { integrity: 'test' } } });
    for (const [name, version] of Object.entries({ expo: '57.0.22', 'react-native': '0.86.3', '@expo/fingerprint': '0.20.13', '@expo/repack-app': '0.10.3', 'hermes-compiler': 'test' })) {
      write(path.join(project, 'node_modules', name, 'package.json'), { version, bin: 'cli.js' });
    }
    write(path.join(project, 'node_modules/hermes-compiler/hermesc/osx-bin/hermesc'), 'compiler');
    write(path.join(project, 'ios/Pods/hermes-engine/destroot/bin/hermesc'), 'compiler');
    write(path.join(project, 'ios/Podfile.lock'), 'lock');
    write(path.join(project, 'ios/Podfile.properties.json'), {});
    write(path.join(project, 'ios/App.xcodeproj/project.pbxproj'), { objects: {} });
    fs.mkdirSync(path.join(project, 'ios/App.xcworkspace'));
    write(path.join(app, 'Info.plist'), { CFBundleExecutable: 'App', CFBundleIdentifier: 'test.app', UIApplicationSceneManifest: {} });
    write(path.join(app, 'Expo.plist'), {});
    write(path.join(app, 'EXConstants.bundle/app.config'), {});
    write(path.join(app, 'App'), Buffer.from('cffaedfe00000000', 'hex'));
    const bytes = Buffer.alloc(128); Buffer.from('c61fbc03c103191f', 'hex').copy(bytes); bytes.writeUInt32LE(98, 8);
    write(path.join(app, 'main.jsbundle'), bytes);
    fs.mkdirSync(path.join(app, 'assets'));
    const prepare = new URL('../../../crates/snapback4/src/verbs/witness/prepare.mjs', import.meta.url);
    const run = (mode, name, fault = '', receipt = '') => {
      const out = path.join(root, name); fs.mkdirSync(out);
      const result = spawnSync(process.execPath, ['--import', new URL('./witness-preparation-fixture.mjs', import.meta.url).href,
        prepare.pathname, mode, project, out, 'udid', 'http://127.0.0.1:4400', receipt], {
        env: { ...process.env, NP_FIXTURE_ROOT: root, NP_FIXTURE_FAULT: fault }, encoding: 'utf8', timeout: 20000,
      });
      return { ...result, out };
    };
    const badBuild = run('build', 'bad-build', 'build-hbc');
    assert.equal(badBuild.status, 1, badBuild.stderr);
    assert.match(badBuild.stderr, /E_WITNESS_HERMES: bundle and installed compiler HBC versions differ/);
    assert.equal(fs.existsSync(path.join(badBuild.out, 'build.json')), false);
    const base = run('build', 'base');
    assert.equal(base.status, 0, base.stderr);
    const receipt = path.join(base.out, 'build.json');
    const good = run('repack', 'good', '', receipt); assert.equal(good.status, 0, good.stderr);
    const bad = run('repack', 'bad-repack', 'repack-hbc', receipt);
    assert.equal(bad.status, 1, bad.stderr);
    assert.match(bad.stderr, /E_WITNESS_HERMES: bundle and installed compiler HBC versions differ/);
    assert.equal(fs.existsSync(path.join(bad.out, 'repack.json')), false);
    const podSource = path.join(project, 'ios/Pods/hermes-engine/destroot/bin/hermesc');
    fs.writeFileSync(podSource, 'patched native pod bytes');
    const changedPod = run('repack', 'changed-pod', '', receipt);
    assert.equal(changedPod.status, 1, changedPod.stderr);
    assert.match(changedPod.stderr, /E_WITNESS_NATIVE_COMPAT: input differences in pods/);
    assert.equal(fs.existsSync(path.join(changedPod.out, 'repack.log')), false);
    fs.writeFileSync(podSource, 'compiler');
    write(path.join(project, 'SharedNative/Foo.h'), 'external native input');
    const podLink = path.join(project, 'ios/Pods/external.h');
    fs.symlinkSync('../../SharedNative/Foo.h', podLink);
    const outsidePod = run('build', 'external-pod');
    assert.equal(outsidePod.status, 1, outsidePod.stderr);
    assert.match(outsidePod.stderr, /E_WITNESS_NATIVE_COMPAT: Pods input outside covered roots/);
    assert.equal(fs.existsSync(path.join(outsidePod.out, 'build.json')), false);
    fs.unlinkSync(podLink);
    const generatedHeader = path.join(project, 'ios/build/generated/ios/Foo.h');
    write(generatedHeader, 'generated header');
    fs.symlinkSync('../build/generated/ios/Foo.h', podLink);
    const generatedBase = run('build', 'generated-base');
    assert.equal(generatedBase.status, 0, generatedBase.stderr);
    write(generatedHeader, 'changed generated native input');
    const changedGenerated = run('repack', 'changed-generated', '', path.join(generatedBase.out, 'build.json'));
    assert.equal(changedGenerated.status, 1, changedGenerated.stderr);
    assert.match(changedGenerated.stderr, /E_WITNESS_NATIVE_COMPAT: input differences in podsGenerated/);
    fs.unlinkSync(podLink);
    fs.rmSync(path.join(project, 'ios/build'), { recursive: true });
    // Independently kill the base/repack version comparison mutation too.
    const value = JSON.parse(fs.readFileSync(receipt)); value.executedApp.javascript.version = 97;
    const stale = path.join(base.out, 'stale-build.json'); write(stale, value);
    const mismatch = run('repack', 'base-hbc', '', stale);
    assert.equal(mismatch.status, 1, mismatch.stderr);
    assert.match(mismatch.stderr, /E_WITNESS_HERMES: base\/repack Hermes compiler or bytecode changed/);
    assert.equal(fs.existsSync(path.join(mismatch.out, 'repack.json')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
