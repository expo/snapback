// @ref LLP 3000.030#3 — private own-project preparation; never launch through Expo CLI.
import fs from 'node:fs';
import { nativeFingerprint as exportFingerprint, toolIdentity, overlayExport, readBase, saveBase, cacheMissReason } from './export-cache.mjs';
import { nativeReferences } from './native-inputs.mjs';
import { privateBuildFlags, validateOutputs, auditNativeProject, compilerClosure, canonical } from './native-closure.mjs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { hash, fail, safeFailure, readJSON, seal, inventory, hbc, nativeFiles, differences, shellQuote } from './payload.mjs';

// Unexpected setup errors can include paths; never print a Node stack or raw error.
process.on('uncaughtException', error => { console.error(safeFailure(error)); process.exitCode = 1; });
const [mode, projectArg, artifactsArg, udid, origin, exported] = process.argv.slice(2);
// Refuse before resolving projects, creating caches, or invoking any tool.
if (mode !== 'build') fail('E_WITNESS_INPUT', 'repack is withdrawn; use witness ios --build <project> --smoke with fresh artifacts');
const out = path.resolve(artifactsArg), project = fs.realpathSync(projectArg);
const adapter = hash(fs.readFileSync(new URL('./plugin-audit.mjs', import.meta.url))) + hash(fs.readFileSync(new URL('./plugin-audit.json', import.meta.url))) + hash(fs.readFileSync(new URL('./payload.mjs', import.meta.url))) + hash(fs.readFileSync(new URL('./export-cache.mjs', import.meta.url))) + hash(fs.readFileSync(new URL('./prepare.mjs', import.meta.url))) + hash(fs.readFileSync(new URL('./native-inputs.mjs', import.meta.url))) + hash(fs.readFileSync(new URL('./native-closure.mjs', import.meta.url))) + hash(fs.readFileSync(new URL('./native-scripts.mjs', import.meta.url)));
const started = Date.now(), deadline = started + 900_000, phases = [];
const cache = path.join(project, '.snapback4-witness'), snapshot = path.join(cache, 'snapshot');
const env = Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'DEVELOPER_DIR', 'LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
Object.assign(env, { CI: '1', EXPO_NO_TELEMETRY: '1', EXPO_NO_DOTENV: '1', NODE_ENV: 'production',
  EXPO_PUBLIC_SNAPBACK_URL: origin, CP_HOME_DIR: path.join(cache, 'pods-home'), CP_CACHE_DIR: path.join(cache, 'pods-cache'),
  HOME: path.join(cache, 'home'), npm_config_cache: path.join(cache, 'npm-cache'), TMPDIR: path.join(out, 'preparation-tmp') });
// Expo's CI embed keeps Metro transforms, including inlined EXPO_PUBLIC values.
// A new free port needs a distinct JS cache; native DerivedData stays warm.
fs.mkdirSync(env.TMPDIR, { recursive: true });
fs.mkdirSync(env.HOME, { recursive: true });
function command(label, executable, args, cwd = snapshot) {
  const time = Date.now(), log = path.join(out, `${label}.log`), fd = fs.openSync(log, 'wx');
  const r = spawnSync(executable, args, { cwd, env, timeout: Math.max(1, deadline - time), maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
  fs.writeSync(fd, (r.stdout ?? '') + (r.stderr ?? '')); fs.closeSync(fd);
  phases.push({ label, executable, args, cwd, startedAt: time, durationMs: Date.now() - time, status: r.status, signal: r.signal, log: path.basename(log), sha256: hash(fs.readFileSync(log)) });
  fs.writeFileSync(path.join(out, 'preparation-phases.json'), JSON.stringify(phases, null, 2));
  if (r.error || r.status !== 0) fail('E_WITNESS_BUILD', `${label} failed (${r.status ?? 'could not start'}); see the command's own raw log path: ${log}; use --build in a fresh --artifacts directory`);
  return r.stdout.trim();
}
const excluded = new Set(['.git', '.expo', '.snapback4', '.snapback4-witness', 'artifacts', 'evidence', 'dist', 'choreography', 'node_modules', 'ios']);
function sourceOmit(p) { return excluded.has(p.split('/')[0]) || p.split('/').some(n => n === 'provider-secrets.env' || n.startsWith('.env')); }
function nativeOmit(p) { return p === 'build' || p.startsWith('build/') || p === 'Pods' || p.startsWith('Pods/') || p.includes('/xcuserdata') || p === '.xcode.env.local'; }
function nativeInput(root, generatedIOS = false) {
  root = fs.realpathSync(root);
  const deps = inventory(path.join(root, 'node_modules'));
  const ios = !generatedIOS && fs.existsSync(path.join(root, 'ios')) ? inventory(path.join(root, 'ios'), nativeOmit) : null;
  const references = [];
  if (ios) for (const name of fs.readdirSync(path.join(root, 'ios')).filter(n => n.endsWith('.xcodeproj'))) {
    const file = path.join(root, 'ios', name, 'project.pbxproj');
    const parsed = spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' });
    if (parsed.status !== 0) fail('E_WITNESS_NATIVE_COMPAT', 'cannot inspect --build native references');
    references.push(nativeReferences(root, JSON.parse(parsed.stdout), name.slice(0, -10)));
  }
  // Root the Pods inventory at the project: generated header links point into
  // node_modules, which is independently inventoried in full above.
  const podTargets = [];
  const pods = !generatedIOS && fs.existsSync(path.join(root, 'ios/Pods'))
    ? inventory(root, p => p !== 'ios' && p !== 'ios/Pods' && !p.startsWith('ios/Pods/'),
      (file, resolved) => podTargets.push({ path: file, target: path.relative(root, resolved) })) : null;
  // CocoaPods headers also link into Expo/RN codegen's generated input tree.
  // Bind its bytes explicitly rather than treating all ignored build files as safe.
  const generated = path.join(root, 'ios/build/generated');
  const podsGenerated = !generatedIOS && fs.existsSync(generated) ? inventory(generated) : null;
  for (const row of podTargets) {
    const target = row.target;
    if (!target.startsWith('node_modules/') && !target.startsWith('ios/Pods/')
      && !(podsGenerated && target.startsWith('ios/build/generated/'))
      && !(target.startsWith('ios/') && !nativeOmit(target.slice(4)))) {
      fail('E_WITNESS_NATIVE_COMPAT', 'Pods input outside covered roots; use manual preparation instead of --build');
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
  if (changes.length) { seal(path.join(out, 'input-differences.json'), changes); fail(code, "input differences; see the command's own file input-differences.json in --artifacts; retry --build"); }
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
  for (const file of ['app.config.js', 'app.config.ts', 'app.config.json', '.fingerprintignore', 'fingerprint.config.js', 'fingerprint.config.cjs', 'react-native.config.js', 'react-native.config.cjs', 'react-native.config.ts', 'react-native.config.mjs', 'react-native.config.json', 'app.config.mjs', 'app.config.cjs']) {
    if (fs.existsSync(path.join(project, file))) fail('E_WITNESS_NATIVE_COMPAT', `${file} is outside the first static-config preparation adapter; use manual installed-app mode`);
  }
  const req = createRequire(path.join(project, 'package.json'));
  const version = name => req(`${name}/package.json`).version;
  if (version('expo') !== '57.0.22' || version('react-native') !== '0.86.3' || version('@expo/fingerprint') !== '0.20.13') fail('E_WITNESS_BUILD', 'this preparation adapter requires Expo 57.0.22, RN 0.86.3 and @expo/fingerprint 0.20.13; use installed-app mode');
  let exportKey;
  if (exported) {
    const identity = toolIdentity(command, project);
    const pendingBase = readBase(cache, null);
    exportKey = exportFingerprint(project, identity, adapter, env);
    const base = await pendingBase;
    if (base?.exportFingerprint.hash === exportKey.hash) {
      const transformed = overlayExport(project, exported, base, path.join(out, 'export.app'), command);
      const after = exportFingerprint(project, exportKey.toolchain, adapter, env);
      if (after.hash !== exportKey.hash) fail('E_WITNESS_PROOF', 'native inputs changed while replacing export');
      seal(path.join(out, 'build.json'), { format: 1, ...transformed, compiler: base.compiler, toolchain: base.toolchain, proofKind: 'application-export', cacheHit: true,
        nativeFingerprint: { fingerprint: { hash: exportKey.hash } }, exportFingerprint: { hash: exportKey.hash },
        startedAt: started, durationMs: Date.now() - started, phases, origin });
      process.exit(0);
    }
    fs.writeFileSync(path.join(out, 'cache-miss.json'), JSON.stringify({ reason: cacheMissReason(cache, exportKey) }));
  }
  const source = inventory(project, sourceOmit), inputs = nativeInput(project);
  if (inputs.manifest.codegenConfig || inputs.manifest.expo?.autolinking || inputs.config.expo?.autolinking || inputs.manifest.workspaces || fs.existsSync(path.join(project, 'modules'))
      || Object.values({ ...inputs.manifest.dependencies, ...inputs.manifest.devDependencies }).some(v => /^(file:|link:|workspace:|\.)/.test(v))
      || inputs.config.expo?.plugins?.some(p => (Array.isArray(p) ? p[0] : p).match(/^(?:\.|\/)/))) {
    fail('E_WITNESS_BUILD', 'local workspaces/modules/plugins require manual preparation in this adapter; use installed-app mode');
  }
  if (inputs.config.expo?.newArchEnabled !== true || (inputs.config.expo?.jsEngine && inputs.config.expo.jsEngine !== 'hermes')) fail('E_WITNESS_BUILD', 'this adapter requires New Architecture and Hermes');
  // An embedded-bundle hash cannot attest an Updates-selected cached bundle.
  if (fs.existsSync(path.join(project, 'node_modules/expo-updates'))) fail('E_WITNESS_NATIVE_COMPAT', 'linked expo-updates is outside own-build preparation; use manual installed-app mode');
  const fingerprintOptions = { platforms: ['ios'], silent: true, sourceSkips: 0 };
  // Use a clean child environment for config/plugin evaluation, not ambient secrets.
  const fpScript = `const f=require('@expo/fingerprint'); f.createFingerprintAsync(process.cwd(),${JSON.stringify(fingerprintOptions)}).then(x=>console.log(JSON.stringify(x)))`;
  const fingerprint = JSON.parse(command('fingerprint-before', process.execPath, ['-e', fpScript], project));
  const toolchain = { node: process.version, xcode: command('xcode-version', 'xcodebuild', ['-version'], project), sdk: command('sdk-version', 'xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'], project),
    sdkBuild: command('sdk-build', 'xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-build-version'], project), pod: command('pod-version', 'pod', ['--version'], project),
    runtime: JSON.parse(command('runtime', 'xcrun', ['simctl', 'list', 'runtimes', '--json'], project)).runtimes.map(({ identifier, version, buildversion }) => ({ identifier, version, buildversion })), architecture: 'arm64' };
  const nativeFingerprint = { version: '0.20.13', options: fingerprintOptions, fingerprint };
  if (!toolchain.xcode.startsWith('Xcode 27.0\n') || toolchain.sdk !== '27.0') fail('E_WITNESS_BUILD', 'this adapter is qualified for Xcode 27.0 / iOS simulator SDK 27.0 only; use installed-app mode');
  let nativeClosure = null;
  // Stable private path permits warm Xcode intermediates. A project lease in
  // the Rust parent excludes competing writers; each run retains its inputs.
  const generatedIOS = !fs.existsSync(path.join(project, 'ios'));
  fs.mkdirSync(snapshot, { recursive: true });
  command('snapshot', '/usr/bin/rsync', ['-a', '--delete', '--exclude=/.git', '--exclude=/.expo', '--exclude=/.snapback4', '--exclude=/.snapback4-witness', '--exclude=/artifacts', '--exclude=/evidence', '--exclude=/dist', '--exclude=/choreography', '--exclude=provider-secrets.env', '--exclude=.env*', ...(generatedIOS ? ['--exclude=/ios'] : []), project + '/', snapshot + '/'], project);
  const sourceSnapshot = inventory(snapshot, sourceOmit);
  if (sourceSnapshot.sha256 !== source.sha256) fail('E_WITNESS_PROOF', 'source changed while snapshotting');
  // Cached Pods can link generated headers removed by dependency snapshotting.
  // Audit that derived tree after pod install regenerates them, not mid-stage.
  const copiedInputs = nativeInput(snapshot, generatedIOS);
  sameInputs(inputs, copiedInputs, 'E_WITNESS_PROOF');
  seal(path.join(out, 'source-inputs.json'), source);
  const expoCLI = path.join(snapshot, 'node_modules/expo/bin/cli');
  const publicConfig = JSON.parse(command('public-config', process.execPath, [expoCLI, 'config', '--type', 'public', '--json']));
  let app, settings = null;
  if (generatedIOS) {
    // Export cache misses must regenerate config, including removals. Keep only
    // installed pod dependencies so a native-input change adds no download step.
    const keptPods = path.join(cache, 'retained-pods'), pods = path.join(snapshot, 'ios/Pods');
    const lock = path.join(snapshot, 'ios/Podfile.lock');
    const oldLock = exported && fs.existsSync(lock) ? fs.readFileSync(lock) : null;
    if (exported && fs.existsSync(pods)) { fs.rmSync(keptPods, { recursive: true, force: true }); fs.renameSync(pods, keptPods); }
    command('prebuild', process.execPath, [expoCLI, 'prebuild', '--platform', 'ios', '--no-install', ...(exported ? ['--clean'] : [])]);
    if (exported && fs.existsSync(keptPods)) fs.renameSync(keptPods, pods);
    if (oldLock) fs.writeFileSync(lock, oldLock);
  }
  // rsync preserves the ignored environment entry, including an outside link.
  // Replace that entry without following it; exclusive creation also refuses a
  // replacement link appearing between removal and creation.
  const localEnv = path.join(snapshot, 'ios/.xcode.env.local');
  fs.rmSync(localEnv, { force: true });
  fs.writeFileSync(localEnv, `export NODE_BINARY=${shellQuote(process.execPath)}\n`, { flag: 'wx' });
  command('pods', 'pod', ['install'], path.join(snapshot, 'ios'));
  // Compare equivalent stages: post-pod/codegen, before Xcode mutates generated
  // products. The separate closure records the inputs actually consumed by Xcode.
  const resolvedInputs = nativeInput(snapshot);
  seal(path.join(out, 'resolved-native.json'), resolvedInputs);
  {
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
    app = path.join(canonical(settings.TARGET_BUILD_DIR), settings.FULL_PRODUCT_NAME);
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
    // Query settings without masking overrides, then pin bundling on the build.
    // A successful skipped phase must not seal a previous build's JavaScript.
    const bundle = path.join(app, 'main.jsbundle');
    if (!canonical(bundle).startsWith(canonical(cache) + path.sep)) fail('E_WITNESS_BUILD', '--build bundle output escapes private workspace');
    fs.rmSync(bundle, { force: true });
    if (exported) for (const name of ['assets', '_expo']) fs.rmSync(path.join(app, name), { recursive: true, force: true });
    // A failed build may retain/recreate a valid product; only exit success advances.
    command('xcode-build', 'xcodebuild', [...args, 'SKIP_BUNDLING=', 'SOURCEMAP_FILE=', '-resultBundlePath', path.join(out, 'build.xcresult'), 'build']);
    if (!fs.existsSync(bundle)) fail('E_WITNESS_BUILD', 'Xcode did not produce main.jsbundle for this build');
    nativeClosure = { format: 1, adapter, graphs, compiler: compilerClosure(snapshot, cache, systemRoots, graphs.flatMap(g => g.sources), graphs.flatMap(g => g.products)) };
    seal(path.join(out, 'native-closure.json'), nativeClosure);
    app = fs.realpathSync(app);
    command('preserve-app', '/bin/cp', ['-cR', app, path.join(out, 'base.app')]);
    app = path.join(out, 'base.app');
  }
  const executedApp = appInfo(app);
  if (!executedApp.info.UIApplicationSceneManifest) fail('E_WITNESS_BUILD', 'iOS 27 requires UIScene; migrate the project native lifecycle before --build; see guide witness');
  const compilerPath = path.join(snapshot, 'node_modules/hermes-compiler/hermesc/osx-bin/hermesc');
  const compiler = { package: version('hermes-compiler'), sha256: hash(fs.readFileSync(compilerPath)), version: command('hermes-version', compilerPath, ['-version']) };
  const podCompiler = path.join(snapshot, 'ios/Pods/hermes-engine/destroot/bin/hermesc');
  if (hash(fs.readFileSync(podCompiler)) !== compiler.sha256) fail('E_WITNESS_HERMES', 'CocoaPods and JS export resolve different Hermes compilers');
  const hbcVersion = Number(compiler.version.match(/HBC bytecode version:\s*(\d+)/)?.[1]);
  if (executedApp.javascript.version !== hbcVersion) fail('E_WITNESS_HERMES', 'bundle and installed compiler HBC versions differ');
  const after = nativeInput(project);
  sameInputs(inputs, after, 'E_WITNESS_PROOF');
  if (inventory(project, sourceOmit).sha256 !== source.sha256) fail('E_WITNESS_PROOF', 'live source changed during preparation');
  if (inventory(snapshot, sourceOmit).sha256 !== sourceSnapshot.sha256) fail('E_WITNESS_PROOF', 'snapshot source changed during preparation');
  const fpAfter = JSON.parse(command('fingerprint-after', process.execPath, ['-e', fpScript], project));
  if (fpAfter.hash !== fingerprint.hash) fail('E_WITNESS_PROOF', 'native fingerprint changed during preparation');
  const preparedInputs = nativeInput(snapshot);
  const result = { format: 1, proofKind: 'application-release', project, startedAt: started, durationMs: Date.now() - started,
    sourceInputs: inputs, inputs: resolvedInputs, preparedInputs, nativeFingerprint, nativeClosure, source, publicConfig, toolchain, compiler, settings, executedApp, transformation: null, phases, origin,
    buildResult: inventory(path.join(out, 'build.xcresult')),
    nativeBase: null,
    resolvedNative: hash(fs.readFileSync(path.join(out, 'resolved-native.json'))) };
  if (exported) {
    if (exportFingerprint(project, exportKey.toolchain, adapter, env).hash !== exportKey.hash) fail('E_WITNESS_PROOF', 'native inputs changed during build');
    const base = saveBase(cache, result, exportKey, out);
    const transformed = overlayExport(project, exported, base, path.join(out, 'export.app'), command);
    Object.assign(result, transformed, { proofKind: 'application-export', cacheHit: false,
      nativeFingerprint: { fingerprint: { hash: exportKey.hash } }, exportFingerprint: exportKey, durationMs: Date.now() - started });
  }
  seal(path.join(out, 'build.json'), result);
} catch (error) {
  seal(path.join(out, 'preparation-failure.json'), { startedAt: started, durationMs: Date.now() - started, error: safeFailure(error), phases });
  console.error(safeFailure(error)); process.exitCode = 1;
}
