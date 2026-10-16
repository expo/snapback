#!/usr/bin/env node
// @ref LLP 3000.011.003.000#14 — resolve once, pin core and adapters to that same release.
import { synopsis } from './cli-usage.js';
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { previousVersion, installedVersion, acknowledgeVersion, compareVersions, installedHistory, runtimeChanges } from './release-changes.js';

async function run() {
  const args = process.argv.slice(2).flatMap(arg => arg.startsWith('--to=') ? ['--to', arg.slice(5)] : [arg]);
  if (args.length === 1 && args[0] === '--help') { console.log(`usage: ${synopsis('upgrade')}\nUpgrade snapback4 and every installed snapback4-expo adapter with npm, bun or pnpm; keep exact pins. Default: latest; refuses downgrades unless --to is explicit. Rebuild native apps after changing the adapter.`); return; }
  const json = args.includes('--json');
  const input = args.filter(arg => arg !== '--json');
  const explicit = input[0] === '--to';
  const target = explicit ? input[1] : input[0];
  if (input.length !== (explicit ? 2 : target ? 1 : 0) || (explicit && target === 'latest') || (target && !/^(latest|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.test(target))) throw Error('E_INPUT: upgrade takes [--to <exact version>] [--json]');
  const log = text => (json ? process.stderr : process.stdout).write(text + '\n');
  let root = process.cwd();
  while (!existsSync(join(root, 'package.json'))) { const parent = dirname(root); if (parent === root) throw Error('E_UPGRADE: no project package.json'); root = parent; }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const previous = previousVersion(root);
  const installed = installedVersion(root);
  const schema = existsSync(join(root, 'snapback')) && readdirSync(join(root, 'snapback')).some(file => file.endsWith('.q'));
  // Resolve in a fresh Node process: pnpm can replace the package symlink,
  // while this helper's module/realpath cache still points at the old release.
  const checkScript = `
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
try {
  const root = process.argv[1], require = createRequire(join(root, 'package.json'));
  const cli = join(dirname(dirname(require.resolve('snapback4/bin-path'))), 'bin/snapback4.js');
  const result = spawnSync(process.execPath, [cli, 'check', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
  process.exit(result.status ?? 1);
} catch { console.error('E_UPGRADE: cannot load installed snapback4 for check'); process.exit(1); }
`;
  const check = (baseline = false) => spawnSync(process.execPath, ['--input-type=module', '-e', checkScript, root, ...(baseline || json ? ['--json'] : [])], { cwd: root, env: { ...process.env, ...(baseline ? { SNAPBACK4_UPGRADE_BASELINE: '1' } : {}) }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const declared = pkg.packageManager?.split('@')[0];
  const locks = [['bun', ['bun.lock', 'bun.lockb']], ['pnpm', ['pnpm-lock.yaml']], ['npm', ['package-lock.json', 'npm-shrinkwrap.json']]].filter(([, files]) => files.some(file => existsSync(join(root, file)))).map(([pm]) => pm);
  if (declared && !['npm', 'bun', 'pnpm'].includes(declared)) throw Error('E_UPGRADE: supported package managers are npm, bun and pnpm');
  if (!declared && locks.length > 1) throw Error('E_UPGRADE: multiple package-manager lockfiles; set packageManager in package.json');
  const pm = declared ?? locks[0] ?? 'npm';
  const dependencies = ['dependencies', 'devDependencies', 'optionalDependencies'];
  const targets = ['snapback4', 'snapback4-expo'].filter(name => name === 'snapback4' || dependencies.some(key => pkg[key]?.[name]) || existsSync(join(root, 'node_modules', name, 'package.json')));
  const invoke = (command, capture = false) => {
    const result = spawnSync(pm, command, { cwd: root, encoding: 'utf8', timeout: 300_000, stdio: capture ? ['ignore', 'pipe', 'pipe'] : json ? ['ignore', 2, 2] : 'inherit' });
    if (result.error || result.status !== 0) throw Error(`E_UPGRADE: ${pm} ${command[0]} failed; check registry/tool availability`);
    return result.stdout;
  };
  let version = target ?? 'latest';
  if (version === 'latest') {
    const text = invoke(pm === 'bun' ? ['info', 'snapback4@latest', 'version', '--json'] : ['view', 'snapback4@latest', 'version', '--json'], true).trim();
    try { const data = JSON.parse(text); version = typeof data === 'string' ? data : data.version; }
    catch { throw Error('E_UPGRADE: package manager returned no exact core version'); }
  }
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw Error('E_UPGRADE: registry returned no exact core version');
  if (!explicit && installed && compareVersions(version, installed) < 0) throw Error(`E_UPGRADE: the registry’s ${target ?? "latest"} is ${version}, which is older than the installed ${installed}; refusing a downgrade. Use --to ${version} to request it explicitly.`);
  // Check the adapter release before any install changes package.json.
  for (const name of targets) invoke(pm === 'bun' ? ['info', `${name}@${version}`, 'version', '--json'] : ['view', `${name}@${version}`, 'version', '--json'], true);
  const pins = new Map(targets.map(name => [name, version]));
  if (targets.includes('snapback4-expo')) {
    const info = (name, field) => {
      const output = invoke(pm === 'bun' ? ['info', name, field, '--json'] : ['view', name, field, '--json'], true);
      try { return JSON.parse(output); } catch { throw Error(`E_UPGRADE: registry returned invalid ${field} for ${name}`); }
    };
    const peers = info(`snapback4-expo@${version}`, 'peerDependencies');
    const peer = peers?.expo;
    const floor = typeof peer === 'string' && /^(?:>=|~|\^)?(\d+\.\d+\.\d+)(?: |$)/.exec(peer)?.[1];
    if (!floor) throw Error('E_UPGRADE: adapter Expo peer has no supported exact floor');
    const current = dependencies.map(section => pkg[section]?.expo).find(Boolean);
    const installedExpo = current?.match(/^\d+\.\d+\.\d+$/)?.[0];
    // Preserve a newer compatible SDK patch; otherwise select the adapter floor.
    const expo = installedExpo && installedExpo.split('.')[0] === floor.split('.')[0] && compareVersions(installedExpo, floor) >= 0 ? installedExpo : floor;
    pins.set('expo', expo);
    const tarball = info(`expo@${expo}`, 'dist.tarball');
    const response = await fetch(tarball, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw Error(`E_UPGRADE: could not read Expo ${expo} alignment manifest`);
    const unpack = spawnSync('tar', ['-xzOf', '-', 'package/bundledNativeModules.json'], { input: Buffer.from(await response.arrayBuffer()), encoding: 'utf8', timeout: 30_000 });
    let bundled;
    try { if (unpack.status !== 0) throw Error(); bundled = JSON.parse(unpack.stdout); }
    catch { throw Error(`E_UPGRADE: Expo ${expo} has no readable alignment manifest`); }
    for (const name of Object.keys(bundled)) if (dependencies.some(section => pkg[section]?.[name])) {
      const range = bundled[name];
      const exact = typeof range === 'string' && /^[~^]?(\d+\.\d+\.\d+)$/.exec(range)?.[1];
      if (!exact) throw Error(`E_UPGRADE: Expo alignment for ${name} has no exact supported pin: ${range}`);
      pins.set(name, exact);
    }
    // The old Expo runtime may recommend an older core than the adapter needs.
    // Pin the adapter's Expo-module floor too, including newly required peers.
    for (const [name, range] of Object.entries(peers)) if (name.startsWith('expo-')) {
      const minimum = typeof range === 'string' && /^(?:>=|~|\^)?(\d+\.\d+\.\d+)(?: |$)/.exec(range)?.[1];
      if (!minimum) throw Error(`E_UPGRADE: adapter peer ${name} has no supported exact floor`);
      if (!pins.has(name) || compareVersions(pins.get(name), minimum) < 0) pins.set(name, minimum);
    }
    log(`upgrade plan: snapback4/snapback4-expo → ${version}; expo ${current ?? '(absent)'} → ${expo}; align ${[...pins].filter(([name]) => !targets.includes(name)).map(([name, pin]) => `${name}@${pin}`).join(', ')}`);
  }
  if (previous) acknowledgeVersion(root, previous);
  if (schema && installed === previous) {
    // A previous package may predate snapshots. Capture its own compiler output
    // before install; never infer old facts using the newly installed engine.
    const old = check(true);
    let facts;
    try { facts = JSON.parse(old.stdout); } catch { /* Unavailable baseline remains explicit. */ }
    const api = join(root, 'snapback/generated/api.ts');
    if (facts && existsSync(api) && old.status === 0) {
      const counts = values => (values ?? []).reduce((out, value) => { out[value.code] = (out[value.code] ?? 0) + 1; return out; }, {});
      const require = createRequire(join(root, 'package.json'));
      const version = JSON.parse(readFileSync(join(dirname(dirname(require.resolve('snapback4/bin-path'))), 'package.json'), 'utf8')).version;
      const sources = readdirSync(join(root, 'snapback')).filter(file => file.endsWith('.q')).sort((a, b) => a === 'schema.q' ? -1 : b === 'schema.q' ? 1 : a.localeCompare(b)).map(file => [file, readFileSync(join(root, 'snapback', file), 'utf8')]);
      mkdirSync(join(root, '.snapback4'), { recursive: true });
      writeFileSync(join(root, '.snapback4/check-surface.json'), JSON.stringify({ version, sources, api: readFileSync(api, 'utf8'), notes: counts(facts.notes), refusals: counts(facts.problems) }));
    } else {
      if (previous) {
        mkdirSync(join(root, '.snapback4'), { recursive: true });
        writeFileSync(join(root, '.snapback4/upgrade-version.json'), JSON.stringify({ version: previous }));
      }
      log(`upgrade: old check did not complete; ${previous ? 'runtime history is still available from the previous package version' : 'previous package version is unavailable; see guide changes'}`);
    }
  }
  if (targets.includes('snapback4-expo')) {
  // Write the complete plan before resolving: peers may live in different sections.
  for (const [name, pin] of pins) {
    const sections = dependencies.filter(key => pkg[key]?.[name]);
    if (sections.length > 1) throw Error(`E_UPGRADE: ${name} occurs in multiple dependency sections; consolidate it first`);
    const section = sections[0] ?? 'dependencies';
    (pkg[section] ??= {})[name] = pin;
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  invoke(['install', ...(pm === 'pnpm' ? ['--no-frozen-lockfile'] : [])]);
  } else {
  // Preserve each dependency section. One resolved version, even across sections.
  const groups = new Map();
  for (const name of targets) {
    const sections = dependencies.filter(key => pkg[key]?.[name]);
    if (sections.length > 1) throw Error(`E_UPGRADE: ${name} occurs in multiple dependency sections; consolidate it first`);
    const section = sections[0] ?? 'dependencies';
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section).push(`${name}@${version}`);
  }
  for (const [section, packages] of groups) {
    const mode = section === 'devDependencies' ? (pm === 'bun' ? '--dev' : '--save-dev') : section === 'optionalDependencies' ? (pm === 'bun' ? '--optional' : '--save-optional') : null;
    invoke([pm === 'npm' ? 'install' : 'add', pm === 'bun' ? '--exact' : '--save-exact', ...(mode ? [mode] : []), ...packages]);
  }
  }
  const after = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const [name, pin] of pins) if (!dependencies.some(key => after[key]?.[name] === pin)) throw Error(`E_UPGRADE: ${name} was not pinned to ${pin}`);
  const exact = existsSync(join(root, 'exact.mjs')) || existsSync(join(root, 'exact.json')) || dependencies.some(key => Object.keys(pkg[key] ?? {}).some(name => /^exact2?(?:$|[-/])/.test(name)));
  if (exact) log('Exact device rebuild: bun exact.mjs snapback --rebuild'); // HS owns this command and the pairing gate.
  let history = '', checkedFacts = null;
  if (!schema) {
    try {
      history = previous ? runtimeChanges(installedHistory(root), previous, version) : '';
      if (history) (json ? process.stderr : process.stdout).write(history);
      acknowledgeVersion(root, version);
    } catch { log('runtime history unavailable in installed package; run snapback4 guide changes'); }
  }
  if (schema) {
    const checked = check();
    if (checked.stderr) process.stderr.write(checked.stderr);
    if (json) { try { checkedFacts = JSON.parse(checked.stdout); } catch { /* Refused subprocess remains an error below. */ } }
    else if (checked.stdout) process.stdout.write(checked.stdout);
    if (checked.error || checked.status !== 0) { const error = Error(`E_UPGRADE: packages pinned to ${version}; post-upgrade check refused. Repair the reported schema/device issues and run check again.`); error.check = checkedFacts; throw error; }
  }
  if (json) console.log(JSON.stringify({ ok: true, version, targets, packageManager: pm, check: checkedFacts }));
  log(`upgrade: ${targets.join(', ')} pinned to ${version} with ${pm}; commit the lockfile, run check and acceptance tests${targets.includes('snapback4-expo') ? ', and rebuild the native app' : ''}`);
}
try { await run(); } catch (error) { if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: error.message, ...(error.check ? { check: error.check } : {}) })); console.error(error.message); process.exitCode = 1; }
