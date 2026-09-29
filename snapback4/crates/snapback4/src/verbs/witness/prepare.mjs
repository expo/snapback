// @ref LLP 3000.030#3 — private own-project preparation; never launch through Expo CLI.
import fs from 'node:fs';
import { qualifiedScriptTooling } from './native-scripts.mjs';
import { nativeReferences } from './native-inputs.mjs';
import { privateBuildFlags, validateOutputs, auditNativeProject, compilerClosure } from './native-closure.mjs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { hash, fail, readJSON, seal, inventory, hbc, nativeFiles, differences, shellQuote, repackAssets } from './payload.mjs';

const [mode, projectArg, artifactsArg, udid, origin, receiptArg] = process.argv.slice(2);
const out = path.resolve(artifactsArg), project = fs.realpathSync(projectArg);
const adapter = hash(fs.readFileSync(new URL('./prepare.mjs', import.meta.url))) + hash(fs.readFileSync(new URL('./native-inputs.mjs', import.meta.url))) + hash(fs.readFileSync(new URL('./native-closure.mjs', import.meta.url))) + hash(fs.readFileSync(new URL('./native-scripts.mjs', import.meta.url)));
const started = Date.now(), deadline = started + 900_000, phases = [];
const cache = path.join(project, '.snapback4-witness'), snapshot = path.join(cache, 'snapshot');
const env = Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'DEVELOPER_DIR', 'LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
Object.assign(env, { CI: '1', EXPO_NO_TELEMETRY: '1', EXPO_NO_DOTENV: '1', NODE_ENV: 'production',
  EXPO_PUBLIC_SNAPBACK_URL: origin, CP_HOME_DIR: path.join(cache, 'pods-home'), CP_CACHE_DIR: path.join(cache, 'pods-cache'),
  HOME: path.join(cache, 'home'), npm_config_cache: path.join(cache, 'npm-cache'), TMPDIR: path.join(cache, 'tmp') });
fs.mkdirSync(env.TMPDIR, { recursive: true });
fs.mkdirSync(env.HOME, { recursive: true });
function command(label, executable, args, cwd = snapshot) {
  const time = Date.now(), log = path.join(out, `${label}.log`), fd = fs.openSync(log, 'wx');
  const r = spawnSync(executable, args, { cwd, env, timeout: Math.max(1, deadline - time), maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
  fs.writeSync(fd, (r.stdout ?? '') + (r.stderr ?? '')); fs.closeSync(fd);
  phases.push({ label, executable, args, cwd, startedAt: time, durationMs: Date.now() - time, status: r.status, signal: r.signal, log: path.basename(log), sha256: hash(fs.readFileSync(log)) });
  fs.writeFileSync(path.join(out, 'preparation-phases.json'), JSON.stringify(phases, null, 2));
  if (r.error || r.status !== 0) fail('E_WITNESS_BUILD', `${label} failed (${r.error?.message ?? r.status}); see ${log}; use --build in a fresh artifacts directory`);
  return r.stdout.trim();
}
const excluded = new Set(['.git', '.expo', '.snapback4', '.snapback4-witness', 'artifacts', 'evidence', 'dist', 'choreography', 'node_modules', 'ios']);
function sourceOmit(p) { return excluded.has(p.split('/')[0]) || p.split('/').some(n => n === 'provider-secrets.env' || n.startsWith('.env')); }
function nativeOmit(p) { return p === 'build' || p.startsWith('build/') || p === 'Pods' || p.startsWith('Pods/') || p.includes('/xcuserdata') || p === '.xcode.env.local'; }
function nativeInput(root) {
  root = fs.realpathSync(root);
  const deps = inventory(path.join(root, 'node_modules'));
  const ios = fs.existsSync(path.join(root, 'ios')) ? inventory(path.join(root, 'ios'), nativeOmit) : null;
  const references = [];
  if (ios) for (const name of fs.readdirSync(path.join(root, 'ios')).filter(n => n.endsWith('.xcodeproj'))) {
    const file = path.join(root, 'ios', name, 'project.pbxproj');
    const parsed = spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' });
    if (parsed.status !== 0) fail('E_WITNESS_NATIVE_COMPAT', `cannot inspect native references in ${file}`);
    references.push(nativeReferences(root, JSON.parse(parsed.stdout), name.slice(0, -10)));
  }
  // Root the Pods inventory at the project: generated header links point into
  // node_modules, which is independently inventoried in full above.
  const podTargets = [];
  const pods = fs.existsSync(path.join(root, 'ios/Pods'))
    ? inventory(root, p => p !== 'ios' && p !== 'ios/Pods' && !p.startsWith('ios/Pods/'),
      (file, resolved) => podTargets.push({ path: file, target: path.relative(root, resolved) })) : null;
  // CocoaPods headers also link into Expo/RN codegen's generated input tree.
  // Bind its bytes explicitly rather than treating all ignored build files as safe.
  const generated = path.join(root, 'ios/build/generated');
  const podsGenerated = fs.existsSync(generated) ? inventory(generated) : null;
  for (const row of podTargets) {
    const target = row.target;
    if (!target.startsWith('node_modules/') && !target.startsWith('ios/Pods/')
      && !(podsGenerated && target.startsWith('ios/build/generated/'))
      && !(target.startsWith('ios/') && !nativeOmit(target.slice(4)))) {
      fail('E_WITNESS_NATIVE_COMPAT', `Pods input outside covered roots: ${row.path} -> ${target}; use manual preparation`);
    }
  }
  const config = readJSON(path.join(root, 'app.json'));
  const manifest = readJSON(path.join(root, 'package.json'));
  const lock = hash(fs.readFileSync(path.join(root, 'package-lock.json')));
  return { config, manifest, lock, dependencies: deps, ios, pods, podsGenerated, references };
}
function sameInputs(a, b, code = 'E_WITNESS_NATIVE_COMPAT') {
  const changes = [];
  for (const key of ['config', 'manifest', 'lock', 'dependencies', 'ios', 'pods', 'podsGenerated', 'references']) if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
    changes.push({ field: key, ...(a[key]?.files && b[key]?.files ? { changes: differences(a[key].files, b[key].files) } : { expected: a[key], actual: b[key] }) });
  }
  if (changes.length) { seal(path.join(out, 'input-differences.json'), changes); fail(code, `input differences in ${changes.map(x => x.field).join(', ')}; see input-differences.json; use witness ios --build ${project}`); }
}
function plist(file) { return JSON.parse(command(`plist-${phases.length}`, '/usr/bin/plutil', ['-convert', 'json', '-o', '-', file])); }
function appInfo(app) {
  const inv = inventory(app), info = plist(path.join(app, 'Info.plist')), js = hbc(path.join(app, 'main.jsbundle'));
  const native = nativeFiles(app, inv);
  if (!native.some(f => f.path === info.CFBundleExecutable)) fail('E_WITNESS_HERMES', 'application has no Mach-O executable');
  return { inventory: inv, native, javascript: js, info, path: app };
}
try {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') fail('E_WITNESS_PLATFORM', 'preparation requires an Apple-silicon Mac');
  for (const file of ['app.config.js', 'app.config.ts', 'app.config.json', '.fingerprintignore', 'fingerprint.config.js', 'fingerprint.config.cjs', 'react-native.config.js', 'react-native.config.cjs', 'react-native.config.ts']) {
    if (fs.existsSync(path.join(project, file))) fail('E_WITNESS_NATIVE_COMPAT', `${file} is outside the first static-config preparation adapter; use manual installed-app mode`);
  }
  const req = createRequire(path.join(project, 'package.json'));
  const version = name => req(`${name}/package.json`).version;
  if (version('expo') !== '57.0.22' || version('react-native') !== '0.86.3' || version('@expo/fingerprint') !== '0.20.13') fail('E_WITNESS_BUILD', 'this preparation adapter requires Expo 57.0.22, RN 0.86.3 and @expo/fingerprint 0.20.13; use installed-app mode');
  const source = inventory(project, sourceOmit), inputs = nativeInput(project);
  if (inputs.manifest.codegenConfig || inputs.manifest.expo?.autolinking || inputs.config.expo?.autolinking || inputs.manifest.workspaces || fs.existsSync(path.join(project, 'modules'))
      || Object.values({ ...inputs.manifest.dependencies, ...inputs.manifest.devDependencies }).some(v => /^(file:|link:|workspace:|\.)/.test(v))
      || inputs.config.expo?.plugins?.some(p => (Array.isArray(p) ? p[0] : p).match(/^(?:\.|\/)/))) {
    fail('E_WITNESS_BUILD', 'local workspaces/modules/plugins require manual preparation in this adapter; use installed-app mode');
  }
  if (inputs.config.expo?.newArchEnabled !== true || (inputs.config.expo?.jsEngine && inputs.config.expo.jsEngine !== 'hermes')) fail('E_WITNESS_BUILD', 'this adapter requires New Architecture and Hermes');
  // An embedded-bundle hash cannot attest an Updates-selected cached bundle.
  if (fs.existsSync(path.join(project, 'node_modules/expo-updates'))) fail('E_WITNESS_NATIVE_COMPAT', 'linked expo-updates is outside both prepared proof routes; use manual installed-app mode');
  const fingerprintOptions = { platforms: ['ios'], silent: true, sourceSkips: 0 };
  // Use a clean child environment for config/plugin evaluation, not ambient secrets.
  const fpScript = `const f=require('@expo/fingerprint'); f.createFingerprintAsync(process.cwd(),${JSON.stringify(fingerprintOptions)}).then(x=>console.log(JSON.stringify(x)))`;
  const fingerprint = JSON.parse(command('fingerprint-before', process.execPath, ['-e', fpScript], project));
  const toolchain = { node: process.version, xcode: command('xcode-version', 'xcodebuild', ['-version'], project), sdk: command('sdk-version', 'xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'], project),
    sdkBuild: command('sdk-build', 'xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-build-version'], project), pod: command('pod-version', 'pod', ['--version'], project),
    runtime: JSON.parse(command('runtime', 'xcrun', ['simctl', 'list', 'runtimes', '--json'], project)).runtimes.map(({ identifier, version, buildversion }) => ({ identifier, version, buildversion })), architecture: 'arm64' };
  const nativeFingerprint = { version: '0.20.13', options: fingerprintOptions, fingerprint };
  if (!toolchain.xcode.startsWith('Xcode 27.0\n') || toolchain.sdk !== '27.0') fail('E_WITNESS_BUILD', 'this adapter is qualified for Xcode 27.0 / iOS simulator SDK 27.0 only; use installed-app mode');
  let base = null, nativeClosure = null;
  if (mode === 'repack') {
    base = readJSON(receiptArg);
    if (base.format !== 1 || base.project !== project || base.proofKind !== 'application-release') fail('E_WITNESS_NATIVE_COMPAT', 'receipt is not an own-build base for this project; use --build');
    const baseApp = path.join(path.dirname(path.resolve(receiptArg)), 'base.app');
    if (inventory(baseApp).sha256 !== base.executedApp.inventory.sha256) fail('E_WITNESS_PROOF', 'immutable base bytes changed; use --build');
    if (!base.sourceInputs?.ios) fail('E_WITNESS_NATIVE_COMPAT', 'repack requires an existing inventoried iOS project; use --build');
    sameInputs(base.sourceInputs, inputs);
    if (JSON.stringify(base.toolchain) !== JSON.stringify(toolchain) || base.nativeFingerprint.fingerprint.hash !== fingerprint.hash) fail('E_WITNESS_NATIVE_COMPAT', 'toolchain or Expo fingerprint changed; use --build');
    if (version('@expo/repack-app') !== '0.10.3') fail('E_WITNESS_REPACK', 'repack requires installed @expo/repack-app 0.10.3; use --build');
    if (base.nativeClosure?.format !== 1 || base.nativeClosure?.adapter !== adapter || !base.nativeClosure.compiler?.records?.length || !base.nativeClosure.compiler?.sources?.length) fail('E_WITNESS_NATIVE_COMPAT', 'base has no complete native dependency coverage; use --build');
    for (const input of base.nativeClosure.compiler.inputs) if (input.kind === 'toolchain' && (input.missing ? fs.existsSync(input.path) : !fs.existsSync(input.path) || hash(fs.readFileSync(input.path)) !== input.sha256)) fail('E_WITNESS_NATIVE_COMPAT', `compiler toolchain input changed: ${input.path}; use --build`);
    if (base.nativeClosure.graphs.some(g => g.phases.length) && inputs.dependencies.sha256 !== qualifiedScriptTooling) fail('E_WITNESS_NATIVE_COMPAT', 'unqualified native script/tool dependency tree; use --build');
    base.sourceApp = baseApp;
    nativeClosure = base.nativeClosure;
  }
  // Stable private path permits warm Xcode intermediates. A project lease in
  // the Rust parent excludes competing writers; each run retains its inputs.
  fs.mkdirSync(snapshot, { recursive: true });
  command('snapshot', '/usr/bin/rsync', ['-a', '--delete', '--exclude=/.git', '--exclude=/.expo', '--exclude=/.snapback4', '--exclude=/.snapback4-witness', '--exclude=/artifacts', '--exclude=/evidence', '--exclude=/dist', '--exclude=/choreography', '--exclude=provider-secrets.env', '--exclude=.env*', project + '/', snapshot + '/'], project);
  const sourceSnapshot = inventory(snapshot, sourceOmit);
  if (sourceSnapshot.sha256 !== source.sha256) fail('E_WITNESS_PROOF', 'source changed while snapshotting');
  sameInputs(inputs, nativeInput(snapshot), 'E_WITNESS_PROOF');
  seal(path.join(out, 'source-inputs.json'), source);
  const expoCLI = path.join(snapshot, 'node_modules/expo/bin/cli');
  const publicConfig = JSON.parse(command('public-config', process.execPath, [expoCLI, 'config', '--type', 'public', '--json']));
  let app, transformation = null, settings = null;
  if (!fs.existsSync(path.join(snapshot, 'ios'))) command('prebuild', process.execPath, [expoCLI, 'prebuild', '--platform', 'ios', '--no-install']);
  fs.writeFileSync(path.join(snapshot, 'ios/.xcode.env.local'), `export NODE_BINARY=${shellQuote(process.execPath)}\n`);
  command('pods', 'pod', ['install'], path.join(snapshot, 'ios'));
  // Compare equivalent stages: post-pod/codegen, before Xcode mutates generated
  // products. The separate closure records the inputs actually consumed by Xcode.
  const resolvedInputs = nativeInput(snapshot);
  seal(path.join(out, 'resolved-native.json'), resolvedInputs);
  if (mode === 'build') {
    const workspaces = fs.readdirSync(path.join(snapshot, 'ios')).filter(n => n.endsWith('.xcworkspace'));
    if (workspaces.length !== 1) fail('E_WITNESS_BUILD', 'no unique iOS workspace; use installed-app mode');
    const workspace = path.join(snapshot, 'ios', workspaces[0]);
    const list = JSON.parse(command('schemes', 'xcodebuild', ['-list', '-json', '-workspace', workspace]));
    const scheme = workspaces[0].slice(0, -12);
    if (!list.workspace.schemes.includes(scheme)) fail('E_WITNESS_BUILD', 'no matching application scheme; use installed-app mode');
    const derived = path.join(cache, 'DerivedData');
    const args = ['-workspace', workspace, '-scheme', scheme, '-configuration', 'Release', '-sdk', 'iphonesimulator', '-destination', `id=${udid}`, '-derivedDataPath', derived, 'ARCHS=arm64', 'ONLY_ACTIVE_ARCH=YES', 'CODE_SIGN_IDENTITY=-', 'RCT_NEW_ARCH_ENABLED=1', ...privateBuildFlags(cache)];
    const all = JSON.parse(command('build-settings', 'xcodebuild', [...args, '-showBuildSettings', '-json']));
    validateOutputs(all, cache);
    const targets = all.filter(x => x.buildSettings.PRODUCT_TYPE === 'com.apple.product-type.application' && x.target === scheme);
    if (targets.length !== 1) fail('E_WITNESS_BUILD', 'no unique application product in build settings');
    settings = targets[0].buildSettings;
    app = path.join(settings.TARGET_BUILD_DIR, settings.FULL_PRODUCT_NAME);
    const systemRoots = [command('sdk-path', 'xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path']),
      env.DEVELOPER_DIR ?? '/Applications/Xcode.app/Contents/Developer', '/System/Library', '/usr/lib'];
    const graphs = [];
    for (const relative of [`${scheme}.xcodeproj`, 'Pods/Pods.xcodeproj']) {
      const projectFile = path.join(snapshot, 'ios', relative);
      const graph = plist(path.join(projectFile, 'project.pbxproj'));
      const rows = JSON.parse(command(`target-settings-${graphs.length}`, 'xcodebuild', ['-project', projectFile, '-alltargets',
        '-configuration', 'Release', '-sdk', 'iphonesimulator', 'ARCHS=arm64', ...privateBuildFlags(cache), '-showBuildSettings', '-json']));
      graphs.push(auditNativeProject(graph, path.dirname(projectFile), rows, snapshot, cache, systemRoots, scheme));
    }
    // A failed build may leave a stale product; only exit success advances.
    command('xcode-build', 'xcodebuild', [...args, '-resultBundlePath', path.join(out, 'build.xcresult'), 'build']);
    nativeClosure = { format: 1, adapter, graphs, compiler: compilerClosure(snapshot, cache, systemRoots, graphs.flatMap(g => g.sources), graphs.flatMap(g => g.products)) };
    seal(path.join(out, 'native-closure.json'), nativeClosure);
    app = fs.realpathSync(app);
    command('preserve-app', '/bin/cp', ['-cR', app, path.join(out, 'base.app')]);
    app = path.join(out, 'base.app');
  } else {
    // Compare the actual post-pod/codegen stage that produced the immutable base.
    sameInputs(base.inputs, resolvedInputs);
    const pkg = readJSON(path.join(snapshot, 'node_modules/@expo/repack-app/package.json'));
    const cli = path.join(snapshot, 'node_modules/@expo/repack-app', typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin)[0]);
    app = path.join(out, 'repacked.app');
    command('repack', process.execPath, [cli, '--platform', 'ios', '--js-bundle-only', '--source-app', base.sourceApp, '--output', app, '--working-directory', path.join(out, 'repack-work'), '--skip-working-dir-cleanup']);
    transformation = { tool: '@expo/repack-app', version: '0.10.3', integrity: readJSON(path.join(snapshot, 'package-lock.json')).packages['node_modules/@expo/repack-app'].integrity,
      exportedAssets: repackAssets(app, path.join(out, 'repack-work/bundles/assets')), source: base.executedApp.inventory.sha256, changes: differences(base.executedApp.inventory.files, inventory(app).files) };
  }
  const executedApp = appInfo(app);
  if (!executedApp.info.UIApplicationSceneManifest) fail('E_WITNESS_BUILD', 'iOS 27 requires UIScene; migrate the project native lifecycle before --build; see guide witness');
  const compilerPath = path.join(snapshot, 'node_modules/hermes-compiler/hermesc/osx-bin/hermesc');
  const compiler = { package: version('hermes-compiler'), sha256: hash(fs.readFileSync(compilerPath)), version: command('hermes-version', compilerPath, ['-version']) };
  const podCompiler = path.join(snapshot, 'ios/Pods/hermes-engine/destroot/bin/hermesc');
  if (hash(fs.readFileSync(podCompiler)) !== compiler.sha256) fail('E_WITNESS_HERMES', 'CocoaPods and JS export resolve different Hermes compilers');
  const hbcVersion = Number(compiler.version.match(/HBC bytecode version:\s*(\d+)/)?.[1]);
  if (executedApp.javascript.version !== hbcVersion) fail('E_WITNESS_HERMES', 'bundle and installed compiler HBC versions differ');
  if (base) {
    if (JSON.stringify(executedApp.native) !== JSON.stringify(base.executedApp.native)) fail('E_WITNESS_REPACK', 'native Mach-O bytes changed; use --build');
    if (executedApp.javascript.version !== base.executedApp.javascript.version || JSON.stringify(compiler) !== JSON.stringify(base.compiler)) fail('E_WITNESS_HERMES', 'base/repack Hermes compiler or bytecode changed');
    if (!isDeepStrictEqual(executedApp.info, base.executedApp.info)) fail('E_WITNESS_REPACK', 'Info.plist semantics changed; use --build');
    for (const row of transformation.changes) {
      if (!(row.path === 'main.jsbundle' || row.path.startsWith('assets/'))) fail('E_WITNESS_REPACK', `unclassified changed resource ${row.path}; use --build`);
    }
    if (JSON.stringify(publicConfig) !== JSON.stringify(base.publicConfig)) fail('E_WITNESS_REPACK', 'public config changed');
    if (!isDeepStrictEqual(readJSON(path.join(app, 'EXConstants.bundle/app.config')), readJSON(path.join(base.sourceApp, 'EXConstants.bundle/app.config')))) fail('E_WITNESS_REPACK', 'embedded public config changed; use --build');
    if (!isDeepStrictEqual(plist(path.join(app, 'Expo.plist')), plist(path.join(base.sourceApp, 'Expo.plist')))) fail('E_WITNESS_REPACK', 'Expo.plist semantics changed; use --build');
    if (inventory(base.sourceApp).sha256 !== base.executedApp.inventory.sha256) fail('E_WITNESS_PROOF', 'base changed during repack');
    if (executedApp.javascript.sha256 === base.executedApp.javascript.sha256) fail('E_WITNESS_REPACK', 'repack did not produce changed JavaScript');
  }
  const after = nativeInput(project);
  sameInputs(inputs, after, 'E_WITNESS_PROOF');
  if (inventory(project, sourceOmit).sha256 !== source.sha256) fail('E_WITNESS_PROOF', 'live source changed during preparation');
  if (inventory(snapshot, sourceOmit).sha256 !== sourceSnapshot.sha256) fail('E_WITNESS_PROOF', 'snapshot source changed during preparation');
  const fpAfter = JSON.parse(command('fingerprint-after', process.execPath, ['-e', fpScript], project));
  if (fpAfter.hash !== fingerprint.hash) fail('E_WITNESS_PROOF', 'native fingerprint changed during preparation');
  const preparedInputs = nativeInput(snapshot);
  if (base) sameInputs(base.inputs, preparedInputs, 'E_WITNESS_PROOF');
  const result = { format: 1, proofKind: base ? 'application-release-repack' : 'application-release', project, startedAt: started, durationMs: Date.now() - started,
    sourceInputs: inputs, inputs: resolvedInputs, preparedInputs, nativeFingerprint, nativeClosure, source, publicConfig, toolchain, compiler, settings, executedApp, transformation, phases, origin,
    buildResult: base ? null : inventory(path.join(out, 'build.xcresult')),
    nativeBase: base ? { app: base.executedApp.inventory.sha256, build: hash(fs.readFileSync(receiptArg)), fingerprint: base.nativeFingerprint.fingerprint.hash } : null,
    resolvedNative: hash(fs.readFileSync(path.join(out, 'resolved-native.json'))) };
  seal(path.join(out, base ? 'repack.json' : 'build.json'), result);
} catch (error) {
  seal(path.join(out, 'preparation-failure.json'), { startedAt: started, durationMs: Date.now() - started, error: String(error), phases });
  console.error(String(error)); process.exitCode = 1;
}
