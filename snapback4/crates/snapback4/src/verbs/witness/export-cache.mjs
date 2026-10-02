// @ref LLP 3000.030#15 — exact exported bytes, conservative native cache identity.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { hash, inventory, readJSON, hbc, nativeFiles, differences, fail, seal } from './payload.mjs';

const excluded = new Set(['.git', '.expo', '.snapback4', '.snapback4-witness', 'artifacts', 'evidence', 'dist', 'choreography']);
export function nativeFingerprint(project, toolchain, adapter, nativeEnvironment = {}) {
  // Config/plugins may evaluate arbitrary source. Only static, generated projects
  // can exclude application JS. Existing native projects/codegen are conservative.
  const manifest = readJSON(path.join(project, 'package.json'));
  const config = fs.existsSync(path.join(project, 'app.json')) ? readJSON(path.join(project, 'app.json')) : {};
  const references = configFiles(project, config);
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./effective-config.mjs', import.meta.url)), project], {
    cwd: project, env: Object.keys(nativeEnvironment).length ? nativeEnvironment : process.env, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
  });
  const line = child.stdout?.split('\n').findLast(line => line.startsWith('SNAPBACK4_EFFECTIVE_CONFIG='));
  if (child.status !== 0 || !line) fail('E_WITNESS_NATIVE_COMPAT', 'cannot evaluate effective Expo prebuild config; use installed-app mode');
  const effective = JSON.parse(line.slice('SNAPBACK4_EFFECTIVE_CONFIG='.length));
  references.push(...configFiles(project, effective.config), ...configFiles(project, effective.modResults));
  let dynamic = effective.retainApplicationJs || fs.readdirSync(project).some(n => /^app\.config\./.test(n))
    || fs.existsSync(path.join(project, 'ios')) || manifest.codegenConfig
    || fs.existsSync(path.join(project, 'modules'))
    || fs.readdirSync(project).some(n => /^react-native\.config\./.test(n));
  const collect = () => inventory(project, p => {
    const parts = p.split('/');
    if (excluded.has(parts[0])) return true;
    if (parts[0] === 'ios' && (parts[1] === 'build' || parts.includes('xcuserdata'))) return true;
    // All dependency bytes, including plugin implementations and package versions.
    if (parts[0] === 'node_modules') return false;
    if (!dynamic && /\.[cm]?[jt]sx?$/.test(p) && (['app', 'src'].includes(parts[0]) || /^(App|index)\.[jt]sx?$/.test(p))) return true;
    return false;
  });
  let inputs = collect();
  // A known writer can call any installed helper while its mod executes. Bind
  // the audited starter dependency snapshot, without guessing an import graph
  // or walking dependency bytes twice on the stock warm path.
  if (effective.mods.length) {
    const digest = hash(JSON.stringify(inputs.files.filter(row => row.path === 'node_modules' || row.path.startsWith('node_modules/'))));
    const audited = readJSON(fileURLToPath(new URL('./native-mods.json', import.meta.url)))._dependencySnapshots.includes(digest);
    effective.dependencyAudit = { sha256: digest, audited };
    if (!audited) {
      effective.retainApplicationJs = true;
      if (!dynamic) { dynamic = true; inputs = collect(); }
    }
  }
  // Custom plugins/native projects can consume the driver's generated origin
  // or TMPDIR in native configuration. Preserve the whole sanitized environment
  // for those shapes; the bounded static starter plugins have no such inputs.
  const environment = dynamic ? nativeEnvironment : null;
  return { format: 1, hash: hash(JSON.stringify({ inputs: inputs.sha256, references, effective, toolchain, adapter, ...(dynamic ? { environment } : {}) })), inputs, references, effective, toolchain, adapter, environment };
}
// A static config can name a file outside the snapshot or an otherwise excluded
// JS file. Refuse external paths; bind every existing in-tree file it names.
export function configFiles(project, config) {
  const root = fs.realpathSync(project), files = [];
  function visit(value) {
    if (typeof value === 'string') {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^file:/i.test(value)) return;
      const file = path.resolve(root, value);
      if (/^file:/i.test(value) || value.split(/[\\/]/).includes('..') || path.win32.isAbsolute(value) || !file.startsWith(root + path.sep)) {
        fail('E_WITNESS_NATIVE_COMPAT', 'out-of-tree config paths are not supported by export caching; copy the file into the project or use installed-app mode');
      }
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        if (!fs.realpathSync(file).startsWith(root + path.sep)) fail('E_WITNESS_NATIVE_COMPAT', 'config file escapes the project');
        files.push({ path: path.relative(root, file), sha256: hash(fs.readFileSync(file)) });
      }
    } else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  }
  visit(config); return files.sort((a, b) => a.path.localeCompare(b.path));
}
export function cacheMissReason(cache, fingerprint) {
  const file = path.join(cache, 'export-base.json');
  if (!fs.existsSync(file)) return 'no cached Release app';
  try {
    const before = readJSON(file).exportFingerprint;
    const changed = differences(before.inputs.files, fingerprint.inputs.files)[0];
    if (changed) return `input changed: ${changed.path}`;
    for (const field of ['references', 'effective', 'adapter', 'toolchain', 'environment']) {
      if (JSON.stringify(before[field]) !== JSON.stringify(fingerprint[field])) return `${field} changed`;
    }
  } catch {}
  return 'cached app or native build inputs no longer validate';
}
// The audited Expo embed writes Metro resources in these two namespaces.
// Keep the exact set in the base/overlay receipt, never infer removals from the
// new export (which cannot name resources it no longer contains).
export const metroResources = inv => inv.files.filter(r => r.path === 'assets' || r.path.startsWith('assets/') || r.path === '_expo' || r.path.startsWith('_expo/'));
export function toolIdentity(command, project) {
  const req = createRequire(path.join(project, 'package.json'));
  const compiler = req.resolve('hermes-compiler/hermesc/osx-bin/hermesc');
  const xcode = command('export-xcode-version', 'xcodebuild', ['-version'], project);
  const sdk = command('export-sdk-version', 'xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'], project);
  const sdkBuild = command('export-sdk-build', 'xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-build-version'], project);
  const developer = command('export-developer', 'xcrun', ['--find', 'clang'], project);
  const clang = hash(fs.readFileSync(developer));
  const tools = {};
  for (const name of ['swiftc', 'swift-frontend', 'ld']) {
    const file = command(`export-tool-${name}`, 'xcrun', ['--find', name], project);
    tools[name] = { path: file, sha256: hash(fs.readFileSync(file)) };
  }
  const sdkPath = command('export-sdk-path', 'xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], project);
  return { xcode, sdk, sdkBuild, sdkPath, developer, clang, tools, node: process.version,
    hermes: hash(fs.readFileSync(compiler)), architecture: process.arch,
    versions: Object.fromEntries(['snapback4', 'snapback4-expo', 'expo', 'react-native'].map(n => [n, readJSON(path.join(project, 'node_modules', n, 'package.json')).version])),
    pod: command('export-pod-version', 'pod', ['--version'], project),
    ruby: command('export-ruby-version', 'ruby', ['--version'], project),
    environment: Object.fromEntries(['PATH', 'USER', 'LOGNAME', 'LANG', 'DEVELOPER_DIR'].map(k => [k, process.env[k] ?? null])),
    sdkSettings: hash(fs.readFileSync(path.join(sdkPath, 'SDKSettings.json'))) };
}
export function overlayExport(project, exported, base, destination, command) {
  const exportedInventory = inventory(exported);
  const metadata = readJSON(path.join(exported, 'metadata.json'));
  const ios = metadata.fileMetadata?.ios;
  if (!ios || typeof ios.bundle !== 'string' || !Array.isArray(ios.assets)) fail('E_WITNESS_HERMES', 'export has no unique iOS payload');
  const within = (root, relative) => {
    if (typeof relative !== 'string' || path.isAbsolute(relative)) fail('E_WITNESS_PROOF', 'export path is not relative');
    const result = path.resolve(root, relative);
    if (!result.startsWith(path.resolve(root) + path.sep)) fail('E_WITNESS_PROOF', 'export path escapes its root');
    return result;
  };
  const javascript = hbc(within(exported, ios.bundle));
  if (javascript.version !== base.executedApp.javascript.version) fail('E_WITNESS_HERMES', 'export HBC version differs from the native base');
  if (inventory(base.executedApp.path).sha256 !== base.executedApp.inventory.sha256) fail('E_WITNESS_PROOF', 'cached native base changed');
  command('export-copy-base', '/bin/cp', ['-cR', base.executedApp.path, destination], project);
  const previous = base.metroResources;
  if (!Array.isArray(previous)) fail('E_WITNESS_PROOF', 'native base has no Metro resource inventory');
  for (const row of [...previous].reverse()) {
    const file = within(destination, row.path);
    if (row.type === 'directory') fs.rmdirSync(file);
    else fs.unlinkSync(file);
  }
  fs.copyFileSync(within(exported, ios.bundle), path.join(destination, 'main.jsbundle'));
  const map = readJSON(path.join(exported, 'assetmap.json'));
  const req = createRequire(path.join(project, 'package.json'));
  const expoReq = createRequire(req.resolve('expo/package.json'));
  const { getAssetLocalPath } = expoReq('@expo/cli/build/src/export/metroAssetLocalPath.js');
  const { filterPlatformAssetScales } = expoReq('@expo/cli/build/src/export/persistMetroAssets.js');
  const copied = new Map([['main.jsbundle', javascript.sha256]]);
  // Expo 57 exportEmbedBundleAndAssetsAsync saves its first JS artifact as the
  // main bundle plus native assets. It does not embed export-only worker HBCs
  // from _expo/static/js/ios; copying them changes Paths.bundle observability.
  // RN resolves embedded Image/font assets by Metro's native path, not EAS's hash
  // filenames. Copy bytes FROM the export, with names from that export's asset map.
  for (const asset of Object.values(map)) {
    const validScales = new Set(filterPlatformAssetScales('ios', asset.scales));
    for (let i = 0; i < asset.fileHashes.length; i++) {
      // Expo's native persister uses the last entry for duplicate scales (for
      // example clear-icon.png and clear-icon@1x.png), and filters iOS scales.
      if (!validScales.has(asset.scales[i]) || asset.scales.lastIndexOf(asset.scales[i]) !== i) continue;
      const digest = asset.fileHashes[i];
      const row = ios.assets.find(a => path.basename(a.path) === digest || path.basename(a.path) === `${digest}.${asset.type}`);
      if (!row) fail('E_WITNESS_PROOF', 'export omitted an embedded asset; remove assetPatternsToBeBundled');
      const relative = getAssetLocalPath(asset, { platform: 'ios', scale: asset.scales[i] });
      if (!relative.startsWith('assets/')) fail('E_WITNESS_PROOF', 'unsupported native asset destination');
      const source = within(exported, row.path), target = within(destination, relative);
      const bytes = fs.readFileSync(source), sha256 = hash(bytes);
      if (copied.has(relative) && copied.get(relative) !== sha256) fail('E_WITNESS_PROOF', 'conflicting exported assets');
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); copied.set(relative, sha256);
    }
  }
  // Only recorded Metro resources may disappear. Native/configuration bytes stay exact.
  const inv = inventory(destination);
  for (const diff of differences(base.executedApp.inventory.files, inv.files)) {
    if (!diff.actual && previous.some(r => r.path === diff.path)) continue;
    if (diff.actual?.type === 'directory' && (diff.path === 'assets' || diff.path.startsWith('assets/') || diff.path === '_expo' || diff.path.startsWith('_expo/'))) continue;
    if (!copied.has(diff.path) || diff.actual?.sha256 !== copied.get(diff.path)) fail('E_WITNESS_PROOF', 'unexpected native change while replacing export');
  }
  const native = nativeFiles(destination, inv);
  if (JSON.stringify(native) !== JSON.stringify(base.executedApp.native)) fail('E_WITNESS_PROOF', 'native executable changed while replacing export');
  if (inventory(exported).sha256 !== exportedInventory.sha256) fail('E_WITNESS_PROOF', 'export changed while copying');
  return { metroResources: metroResources(inv), nativeBase: { app: base.executedApp.inventory.sha256, build: base.buildResult?.sha256,
      fingerprint: base.exportFingerprint?.hash, receipt: base.nativeReceipt },
    executedApp: { ...base.executedApp, path: destination, inventory: inv, javascript, native },
    exported: { path: exported, inventory: exportedInventory, javascript, assets: [...copied].map(([path, sha256]) => ({ path, sha256 })) } };
}
// Positive compiler records cannot observe __has_include / missing header lookups.
// Bind directory topology too, including newly appearing generated/SDK headers.
export function lookupTopology(roots) {
  const rows = [];
  const walk = file => {
    if (!fs.existsSync(file)) { rows.push([file, 'missing']); return; }
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) { rows.push([file, 'link', fs.readlinkSync(file)]); return; }
    rows.push([file, stat.isDirectory() ? 'directory' : 'file']);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) walk(path.join(file, name));
  };
  for (const root of roots) walk(fs.existsSync(root) ? fs.realpathSync(root) : root);
  return { roots, sha256: hash(JSON.stringify(rows)) };
}
function generatedInventory(cache) {
  return inventory(path.join(cache, 'snapshot'), p => (p !== 'ios' && !p.startsWith('ios/')) || (p.startsWith('ios/build/') && p !== 'ios/build/generated' && !p.startsWith('ios/build/generated/')));
}
function cacheCheck(kind, value) {
  if (kind === 'dependencies') return inventory(path.join(value, 'snapshot/node_modules')).sha256;
  if (kind === 'generated') return generatedInventory(value).sha256;
  if (kind === 'compiler') return value.every(input => input.missing ? !fs.existsSync(input.path) : hash(fs.readFileSync(input.path)) === input.sha256);
  throw Error('unknown cache check');
}
function checkInWorker(kind, value) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { kind, value } });
    let result;
    worker.once('message', message => { result = message; });
    worker.once('error', reject);
    // Resolve only after exit: preparation may start a cache-miss build as soon
    // as all checks finish, so no reader can outlive this operation.
    worker.once('exit', code => code === 0 ? resolve(result) : reject(Error('cache check failed')));
  });
}
if (!isMainThread) {
  try { parentPort.postMessage(cacheCheck(workerData.kind, workerData.value)); }
  catch { parentPort.postMessage(null); }
}
export async function readBase(cache, fingerprint) {
  const file = path.join(cache, 'export-base.json');
  if (!fs.existsSync(file)) return null;
  try {
    const base = readJSON(file);
    if (fingerprint && base.exportFingerprint.hash !== fingerprint.hash) return null;
    const checks = await Promise.allSettled([
      checkInWorker('dependencies', cache), checkInWorker('generated', cache),
      checkInWorker('compiler', base.nativeClosure.compiler.inputs),
    ]);
    if (checks.some(r => r.status !== 'fulfilled')) return null;
    if (checks[0].value !== base.preparedInputs.dependencies.sha256 || checks[1].value !== base.generatedNative.sha256 || checks[2].value !== true) return null;
    if (inventory(base.executedApp.path).sha256 !== base.executedApp.inventory.sha256) return null;
    if (base.lookupTopology && lookupTopology(base.lookupTopology.roots).sha256 !== base.lookupTopology.sha256) return null;
    return base;
  } catch { return null; }
}
export function saveBase(cache, base, fingerprint, artifacts) {
  const destination = path.join(cache, 'export-base.app');
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(base.executedApp.path, destination, { recursive: true, verbatimSymlinks: true });
  const record = { ...base, metroResources: metroResources(base.executedApp.inventory), executedApp: { ...base.executedApp, path: destination }, exportFingerprint: fingerprint,
    lookupTopology: lookupTopology([path.join(cache, 'DerivedData'), fingerprint.toolchain.sdkPath, path.resolve(path.dirname(fingerprint.toolchain.developer), '../lib/clang')]),
    generatedNative: generatedInventory(cache) };
  const receipt = path.join(artifacts, 'native-base.json'); seal(receipt, record);
  const pinnedReceipt = path.join(cache, 'native-producer.json');
  fs.rmSync(pinnedReceipt, { force: true }); fs.copyFileSync(receipt, pinnedReceipt);
  record.nativeReceipt = { path: pinnedReceipt, sha256: hash(fs.readFileSync(pinnedReceipt)) };
  const file = path.join(cache, 'export-base.json'); fs.rmSync(file, { force: true }); seal(file, record);
  return record;
}
