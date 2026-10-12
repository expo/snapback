#!/usr/bin/env node
// @ref LLP 3000.011.003.000#8 — resolve once, pin core and adapters to that same release.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

function run() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log('usage: snapback4 upgrade [version]\nUpgrade snapback4 and every installed snapback4-expo adapter with npm, bun or pnpm; keep exact pins. Default: latest. Rebuild native apps after changing the adapter.'); return; }
  if (args.length > 1 || (args[0] && !/^(latest|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.test(args[0]))) throw Error('E_INPUT: upgrade takes an exact version or latest');
  let root = process.cwd();
  while (!existsSync(join(root, 'package.json'))) { const parent = dirname(root); if (parent === root) throw Error('E_UPGRADE: no project package.json'); root = parent; }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const declared = pkg.packageManager?.split('@')[0];
  const locks = [['bun', ['bun.lock', 'bun.lockb']], ['pnpm', ['pnpm-lock.yaml']], ['npm', ['package-lock.json', 'npm-shrinkwrap.json']]].filter(([, files]) => files.some(file => existsSync(join(root, file)))).map(([pm]) => pm);
  if (declared && !['npm', 'bun', 'pnpm'].includes(declared)) throw Error('E_UPGRADE: supported package managers are npm, bun and pnpm');
  if (!declared && locks.length > 1) throw Error('E_UPGRADE: multiple package-manager lockfiles; set packageManager in package.json');
  const pm = declared ?? locks[0] ?? 'npm';
  const dependencies = ['dependencies', 'devDependencies', 'optionalDependencies'];
  const targets = ['snapback4', 'snapback4-expo'].filter(name => name === 'snapback4' || dependencies.some(key => pkg[key]?.[name]) || existsSync(join(root, 'node_modules', name, 'package.json')));
  const invoke = (command, capture = false) => {
    const result = spawnSync(pm, command, { cwd: root, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    if (result.error || result.status !== 0) throw Error(`E_UPGRADE: ${pm} ${command[0]} failed; check registry/tool availability`);
    return result.stdout;
  };
  let version = args[0] ?? 'latest';
  if (version === 'latest') {
    const text = invoke(pm === 'bun' ? ['info', 'snapback4@latest', 'version', '--json'] : ['view', 'snapback4@latest', 'version', '--json'], true).trim();
    try { const data = JSON.parse(text); version = typeof data === 'string' ? data : data.version; }
    catch { throw Error('E_UPGRADE: package manager returned no exact core version'); }
  }
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw Error('E_UPGRADE: registry returned no exact core version');
  // Check the adapter release before any install changes package.json.
  for (const name of targets) invoke(pm === 'bun' ? ['info', `${name}@${version}`, 'version', '--json'] : ['view', `${name}@${version}`, 'version', '--json'], true);
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
  const after = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const name of targets) if (!dependencies.some(key => after[key]?.[name] === version)) throw Error(`E_UPGRADE: ${name} was not pinned to ${version}`);
  console.log(`upgrade: ${targets.join(', ')} pinned to ${version} with ${pm}; commit the lockfile, run check and acceptance tests${targets.includes('snapback4-expo') ? ', and rebuild the native app' : ''}`);
}
try { run(); } catch (error) { console.error(error.message); process.exitCode = 1; }
