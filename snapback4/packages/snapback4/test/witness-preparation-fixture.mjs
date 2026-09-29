// Command-boundary doubles for preparation tests: the real prepare.mjs owns
// inventory, receipt, HBC, build and failure decisions.
import fs from 'node:fs';
import path from 'node:path';
import child from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const root = process.env.NP_FIXTURE_ROOT, fault = process.env.NP_FIXTURE_FAULT;
Object.defineProperty(process, 'platform', { value: 'darwin' });
Object.defineProperty(process, 'arch', { value: 'arm64' });
const fixture = path.join(root, 'fixture.app');
const cache = path.join(root, 'project/.snapback4-witness'), derived = path.join(cache, 'DerivedData');
const product = path.join(derived, 'Build/Products/fixture.app');
const traversalOutput = fault?.startsWith('parent-output:') || fault?.startsWith('parent-link:');
const traversalDestination = fault?.startsWith('parent-link:') ? cache + '/traversal-alias' : cache + '/traversal/../outside-sentinel';
const traversalSettings = {
  clang: { OTHER_CFLAGS: '-MJ ' + traversalDestination },
  swift: { OTHER_SWIFT_FLAGS: '-Xfrontend -emit-module-interface-path -Xfrontend ' + traversalDestination },
  linker: { LD_MAP_FILE_PATH: traversalDestination },
  relative: { INFOPLIST_PATH: '../../../traversal/../outside-sentinel' },
};
child.spawnSync = (exe, args, options) => {
  let stdout = '', status = 0;
  if (exe === '/usr/bin/plutil') stdout = fs.readFileSync(args.at(-1), 'utf8');
  else if (args[0] === '-e') stdout = JSON.stringify({ hash: 'fingerprint', sources: [] });
  else if (exe === 'xcodebuild') {
    if (args.includes('-version')) stdout = 'Xcode 27.0\nBuild version test';
    else if (args.includes('-list')) stdout = JSON.stringify({ workspace: { schemes: ['App'] } });
    else if (args.includes('-showBuildSettings')) {
      const pod = args.includes('-project') && args[args.indexOf('-project') + 1].endsWith('Pods.xcodeproj');
      stdout = JSON.stringify([{ target: pod ? 'Pod' : 'App', buildSettings: {
        PRODUCT_TYPE: 'com.apple.product-type.application', TARGET_BUILD_DIR: path.dirname(product), FULL_PRODUCT_NAME: 'fixture.app', EXECUTABLE_PATH: 'fixture.app/App',
        TARGET_TEMP_DIR: derived + '/Build/Intermediates.noindex', OBJROOT: derived + '/Build/Intermediates.noindex', SYMROOT: derived + '/Build/Products',
        CLANG_MODULES_BUILD_SESSION_FILE: args.find(a => a.startsWith('CLANG_MODULES_BUILD_SESSION_FILE='))?.slice('CLANG_MODULES_BUILD_SESSION_FILE='.length) ?? root + '/outside-session',
        ...(pod && (fault?.startsWith('LD_') || ['PER_ARCH_OBJECT_FILE_DIR', 'COMPILATION_CACHE_CAS_PATH'].includes(fault)) ? { [fault]: root + '/outside-sentinel' } : {}),
        ...(pod && fault?.startsWith('destination:') ? { [fault.slice(12)]: root + '/outside-sentinel' } : {}),
        ...(pod && fault === 'dangling-output' ? { LD_MAP_FILE_PATH: cache + '/dangling-output' } : {}),
        ...(pod && traversalOutput ? traversalSettings[fault.split(':')[1]] : {}),
        ...(!pod && fault === 'skip-bundling' ? { SKIP_BUNDLING: '1' } : {}),
        ...(pod && fault === 'sourcemap' ? { SOURCEMAP_FILE: root + '/outside-sentinel' } : {}),
        ...(pod && fault === 'swift-output' ? { OTHER_SWIFT_FLAGS: '-Xfrontend -emit-module-interface-path -Xfrontend ' + root + '/outside-sentinel' } : {}),
        ...(pod && fault === 'swift-index-output' ? { OTHER_SWIFT_FLAGS: '-index-store-path ' + root + '/outside-sentinel' } : {}),
        ...(pod && fault === 'clang-output' ? { OTHER_MODULE_VERIFIER_FLAGS: '-Xcc -serialize-diagnostics -Xcc ' + root + '/outside-sentinel' } : {}),
        CONFIGURATION_BUILD_DIR: fault === 'output-escape' && pod ? root + '/shared-products' : path.dirname(product),
      } }]);
    } else {
      if (fault?.startsWith('destination:')) fs.writeFileSync(root + '/outside-sentinel', 'overwritten by Xcode task');
      if (fault === 'dangling-output') fs.writeFileSync(cache + '/dangling-output', 'created by linker');
      if (traversalOutput) fs.writeFileSync(traversalDestination, 'overwritten through symlink and parent traversal');
      if (fault?.startsWith('LD_') || ['PER_ARCH_OBJECT_FILE_DIR', 'COMPILATION_CACHE_CAS_PATH', 'sourcemap', 'swift-output', 'swift-index-output', 'clang-output'].includes(fault)) fs.writeFileSync(root + '/outside-sentinel', 'overwritten by compiler or bundler');
      fs.mkdirSync(args[args.indexOf('-resultBundlePath') + 1], { recursive: true });
      fs.cpSync(fixture, product, { recursive: true, filter: file => path.basename(file) !== 'main.jsbundle' });
      // A warm build may exit zero and leave any existing bundle untouched.
      // Also model an inherited skip default unless the invocation pins it empty.
      if (fault !== 'skipped-phase' && (args.includes('SKIP_BUNDLING=') || fault !== 'requires-pin')) {
        if (fault === 'snapshot-source') fs.writeFileSync(cache + '/snapshot/javascript.txt', 'C');
        const bytes = fs.readFileSync(fixture + '/main.jsbundle');
        bytes[127] = fs.readFileSync(cache + '/snapshot/javascript.txt')[0];
        fs.writeFileSync(product + '/main.jsbundle', bytes);
      }
      fs.writeFileSync(cache + '/snapshot/ios/Pods/build-generated.h', 'generated by the pinned Xcode phase');
      const dir = derived + '/Build/Intermediates.noindex'; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(dir + '/App_dependency_info.dat', Buffer.from('\x00test\x00\x40' + product + '/App\x00'));
      if (fault !== 'missing-dependencies') fs.writeFileSync(dir + '/App.d', 'output: ' + cache + '/snapshot/ios/App.c' +
        (fault === 'external-dependency' ? ' ' + root + '/SharedNative.h' : '') + '\n');
      // All products/records are valid: only the subprocess status stops sealing.
      if (fault === 'failed-build') status = 65;
    }
  } else if (exe === 'xcrun') {
    stdout = args.includes('--show-sdk-path') ? root + '/sdk' : args.includes('--show-sdk-version') ? '27.0' : args.includes('--show-sdk-build-version') ? 'test' : '{"runtimes":[]}';
  } else if (exe === 'pod') {
    stdout = '1.17.0';
    if (args[0] === 'install') fs.writeFileSync(path.join(options.cwd, 'Pods/resolved-native.h'), fault === 'resolved-pod' ? 'different resolved native bytes' : 'resolved native bytes');
  }
  else if (exe === '/usr/bin/rsync') {
    const src = args.at(-2), dest = args.at(-1);
    for (const name of fs.readdirSync(dest)) fs.rmSync(path.join(dest, name), { recursive: true, force: true });
    for (const name of fs.readdirSync(src).filter(n => n !== '.snapback4-witness')) fs.cpSync(path.join(src, name), path.join(dest, name), { recursive: true, verbatimSymlinks: true });
  } else if (exe === '/bin/cp') {
    fs.cpSync(args[1], args[2], { recursive: true });
    if (fault === 'build-hbc') corrupt(args[2]);
  } else if (exe.endsWith('/hermesc')) stdout = 'HBC bytecode version: 98';
  else if (args[1] === 'config') stdout = '{}';
 else throw Error('unexpected fixture command ' + JSON.stringify([exe, args, options.cwd]));
  return { status, stdout, stderr: '' };
};
function corrupt(app) {
  const file = path.join(app, 'main.jsbundle'), bytes = fs.readFileSync(file);
  bytes.writeUInt32LE(97, 8); fs.writeFileSync(file, bytes);
}
syncBuiltinESMExports();
