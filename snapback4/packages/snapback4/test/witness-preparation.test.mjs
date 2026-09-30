import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { inventory, hbc, nativeFiles, differences, seal, installedInventory, shellQuote } from '../../../crates/snapback4/src/verbs/witness/payload.mjs';

const siblingOutputs = ['PER_ARCH_MODULE_FILE_DIR', 'PRECOMP_DESTINATION_DIR', 'GENERATED_MODULEMAP_DIR',
  'CLANG_MODULES_BUILD_SESSION_FILE', 'LINK_FILE_LIST_normal_arm64', 'SWIFT_RESPONSE_FILE_PATH_normal_arm64',
  'LM_AUX_CONST_METADATA_LIST_PATH_normal_arm64', 'PRELINK_DEPENDENCY_INFO_FILE',
  'TEMP_FILES_DIR', 'TEMP_FILE_DIR', 'PER_VARIANT_OBJECT_FILE_DIR', 'METAL_LIBRARY_OUTPUT_DIR'];

test('sibling Xcode output settings refuse raw overrides and resolved outside destinations', async () => {
  const { nativeReferences } = await import('../../../crates/snapback4/src/verbs/witness/native-inputs.mjs');
  const { validateOutputs } = await import('../../../crates/snapback4/src/verbs/witness/native-closure.mjs');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'np-output-siblings-')));
  const cache = path.join(root, 'cache'); fs.mkdirSync(cache); fs.mkdirSync(path.join(root, 'ios'));
  const settings = { TARGET_BUILD_DIR: cache, TARGET_TEMP_DIR: cache, OBJROOT: cache, SYMROOT: cache };
  try {
    for (const key of [...siblingOutputs, 'INFOPLIST_PATH', 'DWARF_DSYM_FILE_NAME']) {
      assert.throws(() => nativeReferences(root, { objects: { c: { buildSettings: { [key + '[sdk=iphonesimulator*]']: '/outside' } } } }, 'App'), /custom output/);
      assert.throws(() => validateOutputs([{ target: 'Pod', buildSettings: { ...settings, [key]: '/outside' } }], cache), /output .* escapes private workspace/);
      assert.doesNotThrow(() => validateOutputs([{ target: 'Pod', buildSettings: { ...settings, [key]: path.join(cache, 'new-output') } }], cache));
    }
    for (const key of ['INFOPLIST_PATH', 'DWARF_DSYM_FILE_NAME']) {
      assert.throws(() => validateOutputs([{ target: 'Pod', buildSettings: { ...settings, [key]: '../../outside' } }], cache), /output .* escapes private workspace/);
      assert.doesNotThrow(() => validateOutputs([{ target: 'Pod', buildSettings: { ...settings, [key]: 'App/output' } }], cache));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('dangling final and ancestor output links refuse before an outside file can be created', async () => {
  const { validateOutputs, canonical } = await import('../../../crates/snapback4/src/verbs/witness/native-closure.mjs');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'np-output-dangling-')));
  const cache = path.join(root, 'cache'); fs.mkdirSync(cache);
  const outside = path.join(root, 'not-created');
  fs.symlinkSync(outside, path.join(cache, 'dangling'));
  const settings = { TARGET_BUILD_DIR: cache, TARGET_TEMP_DIR: cache, OBJROOT: cache, SYMROOT: cache };
  try {
    // Missing system-library inputs remain recordable; output validation owns
    // the private boundary. A private missing target can be produced normally.
    assert.equal(canonical(path.join(cache, 'dangling')), outside);
    fs.symlinkSync('new-private-file', path.join(cache, 'private-link'));
    assert.doesNotThrow(() => validateOutputs([{ target: 'Pod', buildSettings: { ...settings, LD_MAP_FILE_PATH: path.join(cache, 'private-link') } }], cache));
    fs.symlinkSync('dangling', path.join(cache, 'chain'));
    for (const dest of [path.join(cache, 'dangling'), path.join(cache, 'dangling/file'), path.join(cache, 'chain')]) {
      assert.throws(() => validateOutputs([{ target: 'Pod', buildSettings: { ...settings, LD_MAP_FILE_PATH: dest } }], cache), /output LD_MAP_FILE_PATH escapes private workspace/);
      assert.equal(fs.existsSync(outside), false);
    }
    fs.symlinkSync('cycle', path.join(cache, 'cycle'));
    assert.throws(() => canonical(path.join(cache, 'cycle')), /unresolved native symlink/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Xcode shell environment keeps executable paths literal', () => {
  const value = "/a path/with'quotes/$HOME/$(printf wrong)/`printf wrong`/node";
  const result = spawnSync('/bin/sh', ['-c', `printf %s ${shellQuote(value)}`], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, value);
});

test('output audits follow symlinks before parent traversal, including within link targets', async () => {
  const { auditNativeProject, canonical } = await import('../../../crates/snapback4/src/verbs/witness/native-closure.mjs');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'np-output-traversal-')));
  const cache = root + '/cache', dir = root + '/ios/Pods', sentinel = root + '/sentinel';
  try {
    fs.mkdirSync(cache); fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(root + '/outside-subdir');
    fs.writeFileSync(sentinel, 'another owner');
    fs.symlinkSync(root + '/outside-subdir', cache + '/link');
    const escaped = cache + '/link/../sentinel'; // Do not lexically join away '..'.
    fs.symlinkSync('link/../sentinel', cache + '/alias');
    fs.symlinkSync('link/../missing', cache + '/dangling-alias');
    const graph = { rootObject: 'project', objects: { project: { isa: 'PBXProject' },
      target: { isa: 'PBXNativeTarget', name: 'Pod', buildPhases: [] } } };
    const settings = { TARGET_BUILD_DIR: cache, TARGET_TEMP_DIR: cache, OBJROOT: cache, SYMROOT: cache };
    const audit = extra => auditNativeProject(graph, dir, [{ target: 'Pod', buildSettings: { ...settings, ...extra } }], root, cache, [], 'App');
    for (const dest of [escaped, cache + '/alias', cache + '/dangling-alias']) {
      for (const extra of [{ OTHER_CFLAGS: `-MJ ${dest}` },
        { OTHER_SWIFT_FLAGS: `-Xfrontend -emit-module-interface-path -Xfrontend ${dest}` },
        { LD_MAP_FILE_PATH: dest }, { INFOPLIST_PATH: dest.slice(cache.length + 1) }]) {
        let refusal;
        try { audit(extra); fs.writeFileSync(dest, 'compiler output'); } catch (error) { refusal = error; }
        assert.equal(fs.readFileSync(sentinel, 'utf8'), 'another owner', JSON.stringify(extra));
        assert.equal(fs.existsSync(root + '/missing'), false, JSON.stringify(extra));
        assert.match(String(refusal), /E_WITNESS_NATIVE_COMPAT: Pod: output .* escapes private workspace/);
      }
    }
    assert.equal(canonical(escaped), sentinel);
    assert.equal(canonical(cache + '/alias'), sentinel);
    assert.equal(canonical(cache + '/dangling-alias'), root + '/missing');
    fs.mkdirSync(cache + '/private-subdir');
    fs.symlinkSync('private-subdir', cache + '/private-link');
    assert.doesNotThrow(() => audit({ LD_MAP_FILE_PATH: cache + '/private-link/../new-output' }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
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
      { c: { buildSettings: { CONFIGURATION_BUILD_DIR: '/other/Products' } } },
      { c: { buildSettings: { OBJROOT: '/other/Objects' } } },
      { c: { buildSettings: { SYMROOT: '/other/Symbols' } } },
      { c: { buildSettings: { 'SKIP_BUNDLING[sdk=iphonesimulator*]': '1' } } },
      { c: { buildSettings: { 'SOURCEMAP_FILE[sdk=iphonesimulator*]': '/other/app.map' } } },
      ...['PER_ARCH_OBJECT_FILE_DIR', 'COMPILATION_CACHE_CAS_PATH', 'LD_MAP_FILE_PATH', 'LD_DEPENDENCY_INFO_FILE', 'LD_LTO_OBJECT_FILE', 'LD_SDK_IMPORTS_FILE'].map(k => ({ c: { buildSettings: { [k + '[sdk=iphonesimulator*]']: '/other/sentinel' } } })),
      { c: { buildSettings: { HEADER_SEARCH_PATHS: '$(SRCROOT)/../SharedNative' } } },
      { c: { buildSettings: { SWIFT_INCLUDE_PATHS: '$(SRCROOT)/../SharedNative' } } },
      { c: { buildSettings: { 'SWIFT_INCLUDE_PATHS[sdk=iphonesimulator*]': '/opt/shared-native' } } },
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
    for (const source of ['# include \"../SharedNative/Foo.swift\"\n', '#include \"/opt/shared-native/header.h\"\n']) {
      fs.writeFileSync(path.join(dir, 'ios/import.h'), source);
      assert.throws(() => nativeReferences(dir, { objects: {} }, 'App'), /E_WITNESS_NATIVE_COMPAT/);
    }
    fs.writeFileSync(path.join(dir, 'ios/import.h'), '#include </opt/shared-native/header.h>\n');
    assert.throws(() => nativeReferences(dir, { objects: {} }, 'App'), /E_WITNESS_NATIVE_COMPAT/);
    fs.unlinkSync(path.join(dir, 'ios/import.h'));
    for (const ext of ['pch', 'hh', 'hxx', 'metal']) {
      const f = path.join(dir, 'ios/import.' + ext); fs.writeFileSync(f, '# include \"../SharedNative/Foo.swift\"\n');
      assert.throws(() => nativeReferences(dir, { objects: {} }, 'App'), /E_WITNESS_NATIVE_COMPAT/); fs.unlinkSync(f);
    }
    const modulemap = path.join(dir, 'ios/module.modulemap');
    fs.writeFileSync(modulemap, 'module External { header \"../SharedNative/Foo.swift\" }');
    assert.throws(() => nativeReferences(dir, { objects: {} }, 'App'), /E_WITNESS_NATIVE_COMPAT/); fs.unlinkSync(modulemap);
    fs.mkdirSync(path.join(dir, 'ios/Images.xcassets'));
    fs.writeFileSync(path.join(dir, 'ios/Images.xcassets/Contents.json'), JSON.stringify({ images: [{ filename: '../../SharedNative/image.png' }] }));
    assert.throws(() => nativeReferences(dir, { objects: {} }, 'App'), /E_WITNESS_NATIVE_COMPAT/);
    fs.rmSync(path.join(dir, 'ios/Images.xcassets'), { recursive: true });
    fs.symlinkSync('../SharedNative', path.join(dir, 'ios/alias'));
    assert.throws(() => nativeReferences(dir, ref('alias/Foo.swift'), 'App'), /E_WITNESS_NATIVE_COMPAT/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('preparation rejects wrong HBC versions and escaping outputs before issuing a build receipt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'np-prepare-hbc-'));
  const project = path.join(root, 'project'), app = path.join(root, 'fixture.app');
  const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value); };
  try {
    write(path.join(project, 'package.json'), {});
    write(path.join(project, 'javascript.txt'), 'A');
    write(path.join(project, 'app.json'), { expo: { newArchEnabled: true } });
    write(path.join(project, 'package-lock.json'), { packages: {} });
    for (const [name, version] of Object.entries({ expo: '57.0.22', 'react-native': '0.86.3', '@expo/fingerprint': '0.20.13', 'hermes-compiler': 'test' })) {
      write(path.join(project, 'node_modules', name, 'package.json'), { version, bin: 'cli.js' });
    }
    write(path.join(project, 'node_modules/hermes-compiler/hermesc/osx-bin/hermesc'), 'compiler');
    write(path.join(project, 'ios/Pods/hermes-engine/destroot/bin/hermesc'), 'compiler');
    write(path.join(project, 'ios/Podfile.lock'), 'lock');
    write(path.join(project, 'ios/Podfile.properties.json'), {});
    const graph = (name, source) => ({ rootObject: 'project', objects: {
      project: { isa: 'PBXProject' }, target: { isa: 'PBXNativeTarget', name, buildPhases: ['phase'] },
      phase: { isa: 'PBXSourcesBuildPhase', files: ['build'] }, build: { isa: 'PBXBuildFile', fileRef: 'file' },
      file: { isa: 'PBXFileReference', path: source },
    } });
    write(path.join(project, 'ios/App.xcodeproj/project.pbxproj'), graph('App', 'App.c'));
    write(path.join(project, 'ios/Pods/Pods.xcodeproj/project.pbxproj'), graph('Pod', '../App.c'));
    write(path.join(project, 'ios/App.c'), 'int app = 1;');
    write(path.join(root, 'SharedNative.h'), 'external header');
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
    for (const [fault, expected] of [['output-escape', /Pod: output CONFIGURATION_BUILD_DIR escapes private workspace/],
      ['missing-dependencies', /missing compiler dependency coverage/], ['external-dependency', /native input outside covered roots:.*SharedNative.h/]]) {
      const bad = run('build', fault, fault);
      assert.equal(bad.status, 1, bad.stderr); assert.match(bad.stderr, expected);
      assert.equal(fs.existsSync(path.join(bad.out, 'build.json')), false);
      if (fault === 'output-escape') assert.equal(fs.existsSync(path.join(bad.out, 'xcode-build.log')), false);
    }
    const sentinel = path.join(root, 'outside-sentinel');
    fs.writeFileSync(sentinel, 'another owner');
    for (const key of ['PER_ARCH_OBJECT_FILE_DIR', 'COMPILATION_CACHE_CAS_PATH', 'LD_MAP_FILE_PATH', 'LD_DEPENDENCY_INFO_FILE', 'LD_LTO_OBJECT_FILE', 'LD_SDK_IMPORTS_FILE', ...siblingOutputs, 'INFOPLIST_PATH', 'DWARF_DSYM_FILE_NAME']) {
      const bad = run('build', key, 'destination:' + key);
      assert.equal(bad.status, 1, bad.stderr);
      assert.match(bad.stderr, new RegExp('Pod: output ' + key + ' escapes private workspace'));
      assert.equal(fs.readFileSync(sentinel, 'utf8'), 'another owner');
      assert.equal(fs.existsSync(path.join(bad.out, 'xcode-build.log')), false);
      assert.equal(fs.existsSync(path.join(bad.out, 'build.json')), false);
    }
    const dangling = path.join(project, '.snapback4-witness/dangling-output');
    const missingOutside = path.join(root, 'outside-not-created');
    fs.symlinkSync(missingOutside, dangling);
    const danglingBuild = run('build', 'dangling-output', 'dangling-output');
    assert.equal(fs.existsSync(missingOutside), false, 'a dangling output link must not create its outside target');
    assert.equal(danglingBuild.status, 1, danglingBuild.stderr);
    assert.match(danglingBuild.stderr, /output LD_MAP_FILE_PATH escapes private workspace:.*dangling-output/);
    assert.equal(fs.existsSync(path.join(danglingBuild.out, 'xcode-build.log')), false);
    assert.equal(fs.existsSync(path.join(danglingBuild.out, 'build.json')), false);
    fs.unlinkSync(dangling);
    fs.mkdirSync(path.join(root, 'outside-subdir'));
    const traversal = path.join(project, '.snapback4-witness/traversal');
    const alias = path.join(project, '.snapback4-witness/traversal-alias');
    fs.symlinkSync(path.join(root, 'outside-subdir'), traversal);
    fs.symlinkSync('traversal/../outside-sentinel', alias);
    for (const kind of ['clang', 'swift', 'linker', 'relative']) {
      for (const prefix of kind === 'relative' ? ['parent-output:'] : ['parent-output:', 'parent-link:']) {
        const fault = prefix + kind, bad = run('build', fault, fault);
        assert.equal(fs.readFileSync(sentinel, 'utf8'), 'another owner', fault);
        assert.equal(bad.status, 1, bad.stderr);
        assert.match(bad.stderr, /E_WITNESS_NATIVE_COMPAT: Pod: output .* escapes private workspace/);
        assert.equal(fs.existsSync(path.join(bad.out, 'xcode-build.log')), false);
        assert.equal(fs.existsSync(path.join(bad.out, 'build.json')), false);
      }
    }
    fs.unlinkSync(alias); fs.unlinkSync(traversal);
    const badBuild = run('build', 'bad-build', 'build-hbc');
    assert.equal(badBuild.status, 1, badBuild.stderr);
    assert.match(badBuild.stderr, /E_WITNESS_HERMES: bundle and installed compiler HBC versions differ/);
    assert.equal(fs.existsSync(path.join(badBuild.out, 'build.json')), false);
    // rsync preserves this ignored input as a link. Preparation must replace
    // only the snapshot's entry, without truncating another owner's file.
    const localEnv = path.join(project, 'ios/.xcode.env.local');
    fs.symlinkSync(sentinel, localEnv);
    const base = run('build', 'base');
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'another owner');
    assert.equal(base.status, 0, base.stderr);
    assert.equal(fs.readlinkSync(localEnv), sentinel, 'the source link stays untouched');
    const snapshotEnv = path.join(project, '.snapback4-witness/snapshot/ios/.xcode.env.local');
    assert.equal(fs.lstatSync(snapshotEnv).isFile(), true, 'the snapshot environment must be a regular file');
    assert.equal(fs.readFileSync(snapshotEnv, 'utf8'), `export NODE_BINARY=${shellQuote(process.execPath)}\n`);
    fs.unlinkSync(localEnv);
    const receipt = path.join(base.out, 'build.json');
    assert.equal(fs.statSync(receipt).mode & 0o777, 0o444, 'successful preparation seals a read-only build receipt');
    const built = JSON.parse(fs.readFileSync(receipt));
    assert.notEqual(built.inputs.pods.sha256, built.sourceInputs.pods.sha256, 'the key must describe post-resolution bytes');
    assert.notEqual(built.inputs.pods.sha256, built.preparedInputs.pods.sha256, 'Xcode-produced bytes have a separate inventory');
    // Change only JS after a successful A; stale valid A must never be sealed as B.
    write(path.join(project, 'javascript.txt'), 'B');
    const skipped = run('build', 'warm-skip-setting', 'skip-bundling');
    assert.equal(skipped.status, 1, skipped.stderr);
    assert.match(skipped.stderr, /App: unsupported SKIP_BUNDLING: 1/);
    assert.equal(fs.existsSync(path.join(skipped.out, 'xcode-build.log')), false);
    assert.equal(fs.existsSync(path.join(skipped.out, 'build.json')), false);
    const product = path.join(project, '.snapback4-witness/DerivedData/Build/Products/fixture.app');
    assert.equal(fs.readFileSync(product + '/main.jsbundle')[127], 'A'.charCodeAt(0));
    const noBundle = run('build', 'warm-skipped-phase', 'skipped-phase');
    assert.equal(noBundle.status, 1, noBundle.stderr);
    assert.match(noBundle.stderr, /Xcode did not produce main.jsbundle/);
    assert.equal(fs.existsSync(path.join(noBundle.out, 'build.json')), false);
    const warm = run('build', 'warm-b', 'requires-pin');
    assert.equal(warm.status, 0, warm.stderr);
    const b = JSON.parse(fs.readFileSync(path.join(warm.out, 'build.json')));
    assert.notEqual(b.source.sha256, built.source.sha256);
    assert.notEqual(b.executedApp.javascript.sha256, built.executedApp.javascript.sha256);
    assert.equal(fs.readFileSync(product + '/main.jsbundle')[127], 'B'.charCodeAt(0));
    // A failed command leaves a completely valid warm B product and dependency
    // graph. Removing the command status guard would incorrectly issue a receipt.
    const failed = run('build', 'failed-xcodebuild', 'failed-build');
    assert.equal(failed.status, 1, failed.stderr);
    assert.match(failed.stderr, /E_WITNESS_BUILD: xcode-build failed \(65\)/);
    assert.equal(hbc(product + '/main.jsbundle').sha256, b.executedApp.javascript.sha256);
    assert.equal(fs.existsSync(path.join(failed.out, 'build.json')), false);
    // The build consumes a changed snapshot while the live source stays B.
    // Only the snapshot custody guard can prevent sealing this source mismatch.
    const changedSnapshot = run('build', 'snapshot-source', 'snapshot-source');
    assert.equal(fs.readFileSync(path.join(project, 'javascript.txt'), 'utf8'), 'B');
    assert.equal(fs.readFileSync(path.join(project, '.snapback4-witness/snapshot/javascript.txt'), 'utf8'), 'C');
    assert.equal(fs.readFileSync(product + '/main.jsbundle')[127], 'C'.charCodeAt(0));
    assert.equal(changedSnapshot.status, 1, changedSnapshot.stderr);
    assert.match(changedSnapshot.stderr, /E_WITNESS_PROOF: snapshot source changed during preparation/);
    assert.equal(fs.existsSync(path.join(changedSnapshot.out, 'build.json')), false);
    for (const [fault, expected] of [
      ['swift-output', /Pod: output flag -emit-module-interface-path escapes private workspace/],
      ['swift-index-output', /Pod: output flag -index-store-path escapes private workspace/],
      ['clang-output', /Pod: output flag -serialize-diagnostics escapes private workspace/],
      ['sourcemap', /Pod: unsupported SOURCEMAP_FILE/],
    ]) {
      const bad = run('build', fault, fault);
      assert.equal(bad.status, 1, bad.stderr); assert.match(bad.stderr, expected);
      assert.ok(bad.stderr.includes(sentinel));
      assert.equal(fs.readFileSync(sentinel, 'utf8'), 'another owner');
      assert.equal(fs.existsSync(path.join(bad.out, 'xcode-build.log')), false);
      assert.equal(fs.existsSync(path.join(bad.out, 'build.json')), false);
    }
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
    // A starter has no source ios/. Prebuild owns that tree; warm snapshotting
    // must preserve both Pods intermediates and Xcode cache, yet rebuild JS.
    fs.renameSync(path.join(project, 'ios'), path.join(root, 'generated-template'));
    fs.rmSync(path.join(project, '.snapback4-witness/snapshot/ios'), { recursive: true });
    const generated = run('build', 'generated-cold');
    assert.equal(generated.status, 0, generated.stderr);
    const kept = path.join(project, '.snapback4-witness/snapshot/ios/Pods/warm-intermediate');
    write(kept, 'preserve this native preparation');
    fs.symlinkSync('../../node_modules/generated-header.h', path.join(project, '.snapback4-witness/snapshot/ios/Pods/generated-header.h'));
    write(path.join(project, 'javascript.txt'), 'D');
    const repeat = run('build', 'generated-warm');
    assert.equal(repeat.status, 0, repeat.stderr);
    assert.equal(fs.readFileSync(kept, 'utf8'), 'preserve this native preparation');
    assert.equal(fs.existsSync(path.join(project, 'ios')), false);
    const fresh = JSON.parse(fs.readFileSync(path.join(repeat.out, 'build.json')));
    assert.ok(fresh.phases.some(p => p.label === 'prebuild'));
    assert.ok(fresh.phases.some(p => p.label === 'xcode-build'));
    assert.equal(fs.readFileSync(product + '/main.jsbundle')[127], 'D'.charCodeAt(0));
    // A removed route cannot create a cache or artifact even via the JS entrypoint.
    for (const mode of ['repack', 'unknown', '']) {
      const rejected = run(mode, 'withdrawn-' + (mode || 'empty'));
      assert.equal(rejected.status, 1);
      assert.match(rejected.stderr, /repack is withdrawn; use witness ios --build/);
      assert.deepEqual(fs.readdirSync(rejected.out), []);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('compiler records cover spaced and macro includes, transitive dependencies and missing coverage', async () => {
  const { compilerClosure, dependencies } = await import('../../../crates/snapback4/src/verbs/witness/native-closure.mjs');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'np-closure-'))), cache = root + '/private', source = root + '/ios/App.c';
  const records = cache + '/DerivedData/Build/Intermediates.noindex';
  try {
    fs.mkdirSync(root + '/ios'); fs.mkdirSync(records, { recursive: true });
    fs.writeFileSync(root + '/ios/good.h', '#define ANSWER 1\n');
    fs.writeFileSync(source, '#include "good.h"\nint answer = ANSWER;\n');
    const record = records + '/App.d';
    fs.writeFileSync(record, `output: ${source} ${root}/ios/good.h\n`);
    assert.equal(compilerClosure(root, cache, [], [source]).inputs.length, 2);
    assert.deepEqual(dependencies('out: /a\\ b.h \\\n /c.h\n/c.h:\n'), ['/a b.h', '/c.h']);
    for (const text of [`# include "${root}/Shared.h"\n`, `#define CONFIG "${root}/Shared.h"\n# include CONFIG\n`]) {
      fs.writeFileSync(source, text); fs.writeFileSync(root + '/Shared.h', 'int native;');
      fs.writeFileSync(record, `output: ${source} ${root}/Shared.h\n`);
      for (const value of ['one', 'two']) {
        fs.writeFileSync(root + '/Shared.h', value);
        assert.throws(() => compilerClosure(root, cache, [], [source]), /native input outside covered roots:.*Shared.h/);
      }
    }
    fs.unlinkSync(record);
    assert.throws(() => compilerClosure(root, cache, [], [source]), /missing compiler dependency coverage/);
    fs.writeFileSync(record, `output: ${root}/ios/good.h\n`);
    assert.throws(() => compilerClosure(root, cache, [], [source]), /missing compiler dependency coverage/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('all target outputs and symlink parents must stay private', async () => {
  const { validateOutputs } = await import('../../../crates/snapback4/src/verbs/witness/native-closure.mjs');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'np-outputs-'))), cache = root + '/private';
  try {
    fs.mkdirSync(cache); fs.mkdirSync(root + '/shared'); fs.symlinkSync('../shared', cache + '/link');
    const s = { TARGET_BUILD_DIR: cache, TARGET_TEMP_DIR: cache, OBJROOT: cache, SYMROOT: cache };
    validateOutputs([{ target: 'App', buildSettings: s }], cache);
    for (const key of ['SKIP_BUNDLING', 'SOURCEMAP_FILE', 'BUNDLE_NAME', 'BUNDLE_COMMAND', 'BUNDLE_CONFIG',
      'CLI_PATH', 'COMPOSE_SOURCEMAP_PATH', 'NODE_ARGS', 'NODE_OPTIONS', 'EXTRA_PACKAGER_ARGS',
      'CONFIG_JSON', 'CONFIG_CMD', 'PROJECT_ROOT', 'ENTRY_FILE']) {
      validateOutputs([{ target: 'App', buildSettings: { ...s, [key]: '' } }], cache);
      for (const value of ['1', '0', ' ', root + '/shared/map']) assert.throws(() => validateOutputs([
        { target: 'App', buildSettings: { ...s, [key]: value } },
      ], cache), new RegExp('unsupported ' + key));
    }
    for (const key of ['PER_ARCH_OBJECT_FILE_DIR', 'COMPILATION_CACHE_CAS_PATH', 'CONFIGURATION_BUILD_DIR', 'OBJROOT', 'SYMROOT', 'DSTROOT', 'DERIVED_SOURCES_DIR', 'CLANG_MODULE_CACHE_PATH', 'LD_MAP_FILE_PATH', 'LD_DEPENDENCY_INFO_FILE', 'LD_LTO_OBJECT_FILE', 'LD_SDK_IMPORTS_FILE']) {
      for (const value of [root + '/shared', cache + '/link/new']) assert.throws(() => validateOutputs([
        { target: 'App', buildSettings: s }, { target: 'Pod', buildSettings: { ...s, [key]: value } },
      ], cache), /Pod: output .* escapes private workspace/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Pods graph audit refuses external search paths, config includes, phase lists and scripts', async () => {
  const { auditNativeProject } = await import('../../../crates/snapback4/src/verbs/witness/native-closure.mjs');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'np-pods-audit-'))), cache = root + '/private';
  const dir = root + '/ios/Pods';
  try {
    fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(cache);
    const graph = { rootObject: 'project', objects: { project: { isa: 'PBXProject' }, target: { isa: 'PBXNativeTarget', name: 'Pod', buildPhases: [] } } };
    const settings = { TARGET_BUILD_DIR: cache, TARGET_TEMP_DIR: cache, OBJROOT: cache, SYMROOT: cache, SRCROOT: dir };
    const audit = (g = graph, extra = {}) => auditNativeProject(g, dir, [{ target: 'Pod', buildSettings: { ...settings, ...extra } }], root, cache, [], 'App');
    assert.equal(audit().sources.length, 0);
    assert.throws(() => audit(graph, { HERMES_CLI_PATH: root + '/node_modules/other-compiler' }), /unsupported HERMES_CLI_PATH/);
    assert.ok(audit(graph, { HERMES_CLI_PATH: root + '/node_modules/hermes-compiler/hermesc/osx-bin/hermesc' }));
    fs.mkdirSync(root + '/shared'); fs.symlinkSync('../shared', cache + '/link');
    for (const key of ['OTHER_SWIFT_FLAGS', 'OTHER_MODULE_VERIFIER_FLAGS']) {
      for (const flag of ['-o', '-emit-module-path', '-emit-module-interface-path', '-emit-private-module-interface-path',
        '-emit-package-module-interface-path', '-emit-objc-header-path', '-emit-dependencies-path',
        '-emit-reference-dependencies-path', '-serialize-diagnostics-path', '-serialize-diagnostics',
        '-index-store-path', '-module-cache-path', '-MF', '-MJ']) {
        assert.throws(() => audit(graph, { [key]: `${flag} ${root}/shared/sentinel` }), /Pod: output flag .* escapes private workspace/);
        assert.ok(audit(graph, { [key]: `${flag} ${cache}/private-output` }));
      }
      for (const wrapper of ['', '-Xfrontend ', '-Xcc ']) {
        assert.ok(audit(graph, { [key]: `${wrapper}-emit-module-interface-path ${wrapper}${cache}/good.swiftinterface` }));
        for (const destination of [root + '/shared/sentinel', cache + '/link/sentinel', 'relative.swiftinterface']) {
          for (const value of [`${wrapper}-emit-module-interface-path ${wrapper}${destination}`, `${wrapper}-emit-module-interface-path=${destination}`])
            assert.throws(() => audit(graph, { [key]: value }), /Pod: output flag .* escapes private workspace/);
        }
      }
      for (const value of ['-Xcc', '-Xfrontend -Xcc', `-Xcc -I -Xfrontend ${dir}`, `-Xfrontend -emit-module-interface-path -Xcc ${cache}/out`])
        assert.throws(() => audit(graph, { [key]: value }));
      assert.ok(audit(graph, { [key]: `-Xcc -I -Xcc ${dir} -Xfrontend -import-underlying-module` }));
    }
    for (const key of ['HEADER_SEARCH_PATHS', 'FRAMEWORK_SEARCH_PATHS', 'LIBRARY_SEARCH_PATHS', 'SWIFT_INCLUDE_PATHS', 'SWIFT_OBJC_BRIDGING_HEADER']) {
      assert.throws(() => audit(graph, { [key]: root + '/SharedNative' }), /outside covered roots/);
    }
    for (const flag of ['-include ' + root + '/SharedNative/config.h', '-ivfsoverlay ' + root + '/SharedNative/overlay.yaml', '@' + root + '/SharedNative/flags']) {
      assert.throws(() => audit(graph, { OTHER_CFLAGS: flag }), /outside covered roots|unsupported native flag/);
    }
    fs.writeFileSync(dir + '/config.xcconfig', '# include "../../SharedNative/config.xcconfig"\n');
    const g = structuredClone(graph);
    Object.assign(g.objects, { configFile: { isa: 'PBXFileReference', path: 'config.xcconfig' },
      config: { isa: 'XCBuildConfiguration', name: 'Release', baseConfigurationReference: 'configFile' },
      list: { isa: 'XCConfigurationList', buildConfigurations: ['config'] } });
    g.objects.target.buildConfigurationList = 'list';
    assert.throws(() => audit(g), /outside covered roots/);
    g.objects.target.buildConfigurationList = undefined;
    g.objects.target.buildPhases = ['phase'];
    g.objects.phase = { isa: 'PBXResourcesBuildPhase', inputFileListPaths: ['inputs.xcfilelist'] };
    fs.writeFileSync(dir + '/inputs.xcfilelist', root + '/SharedNative/image.png\n');
    assert.throws(() => audit(g), /outside covered roots/);
    g.objects.phase = { isa: 'PBXShellScriptBuildPhase', shellPath: '/bin/sh', shellScript: 'cat /external/file', name: 'Generated-looking name' };
    assert.throws(() => audit(g), /unsupported native script Pod/);
    g.objects.phase = { isa: 'PBXCopyFilesBuildPhase', dstSubfolderSpec: 0, dstPath: '' };
    assert.throws(() => audit(g), /unknown native phase PBXCopyFilesBuildPhase/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('linker records require products and refuse external frameworks including missing probes', async () => {
  const { compilerClosure } = await import('../../../crates/snapback4/src/verbs/witness/native-closure.mjs');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'np-linker-'))), cache = root + '/private';
  const dir = cache + '/DerivedData/Build/Intermediates.noindex', source = root + '/ios/App.c', product = cache + '/DerivedData/App';
  try {
    fs.mkdirSync(root + '/ios'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(source, 'int native;');
    fs.writeFileSync(dir + '/App.d', `out: ${source}\n`); fs.writeFileSync(product, 'executable');
    assert.throws(() => compilerClosure(root, cache, [], [source], [product]), /missing linker dependency coverage/);
    const file = dir + '/App_dependency_info.dat', baseline = '\x00test\x00\x40' + product + '\x00';
    fs.writeFileSync(file, Buffer.from(baseline));
    assert.equal(compilerClosure(root, cache, [], [source], [product]).products[0], product);
    fs.writeFileSync(root + '/External.framework', 'native bytes');
    for (const tag of ['\x10', '\x11']) {
      fs.writeFileSync(file, Buffer.from(baseline + tag + root + '/External.framework\x00'));
      assert.throws(() => compilerClosure(root, cache, [], [source], [product]), /outside covered roots:.*External.framework/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
