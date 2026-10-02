// @ref LLP 3000.030#15 — execute Expo's resolver and prebuild config; inspect registered mods, never crawl require() source.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { hash } from './payload.mjs';

// Only packages registering file-writing mods need an audit. Hash their entire
// shipped plugin tree, not a guessed import closure. Unrecognized registrations
// (including direct config.mods assignments) conservatively retain application JS.
export function pluginTree(root) {
  const rows = [];
  function walk(file, relative = '') {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) { rows.push([relative, 'link', fs.readlinkSync(file)]); return; }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) if (name !== 'node_modules') walk(path.join(file, name), relative ? relative + '/' + name : name);
    } else rows.push([relative, hash(fs.readFileSync(file))]);
  }
  walk(root); return hash(JSON.stringify(rows));
}
export async function evaluate(project) {
  const req = createRequire(path.join(project, 'package.json'));
  const expo = createRequire(req.resolve('expo/package.json'));
  const pluginsRoot = path.dirname(expo.resolve('@expo/config-plugins/package.json'));
  const prebuild = expo('@expo/prebuild-config');
  const registration = expo(path.join(pluginsRoot, 'build/plugins/withMod.js'));
  const pins = JSON.parse(fs.readFileSync(new URL('./native-mods.json', import.meta.url)));
  const packages = new Map(), registrations = [], tracked = new Map(), untracked = new Set();
  const ownFile = fileURLToPath(import.meta.url);
  function identify(file) {
    if (!file || !path.isAbsolute(file)) return null;
    let dir = path.dirname(file);
    while (dir !== path.dirname(dir) && !fs.existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir);
    if (!fs.existsSync(path.join(dir, 'package.json'))) return { name: null, file, audited: false };
    if (dir === project) return { name: 'project', file: path.relative(dir, file), audited: false };
    if (!packages.has(dir)) {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json')));
      const digest = pluginTree(dir);
      packages.set(dir, { name: manifest.name, version: manifest.version, sha256: digest,
        audited: pins[manifest.name]?.includes(digest) === true });
    }
    return { ...packages.get(dir), file: path.relative(dir, file) };
  }
  for (const method of ['withMod', 'withBaseMod']) {
    const original = registration[method];
    registration[method] = function(config, props) {
      const oldLimit = Error.stackTraceLimit; Error.stackTraceLimit = 60;
      const stack = new Error().stack; Error.stackTraceLimit = oldLimit;
      const files = [...new Set(stack.split('\n').slice(1).map(line => line.match(/(?:\(|at )(\/.*?):\d+:\d+\)?$/)?.[1]).filter(Boolean))]
        .filter(file => file !== ownFile);
      const callers = files.map(identify).filter(Boolean);
      if (props.platform === 'ios' && config.mods?.ios?.[props.mod] && tracked.get(props.mod) !== config.mods.ios[props.mod]) untracked.add(props.mod);
      const result = original(config, props);
      if (props.platform === 'ios') {
        // Even an introspective callback can have hidden file effects. Only an
        // audited registration may drop JS; all its evaluated results still bind.
        registrations.push({ mod: props.mod, callers, audited: callers.length > 0 && callers.every(c => c.audited) });
        tracked.set(props.mod, result.mods?.ios?.[props.mod]);
      }
      return result;
    };
  }
  let { exp } = await prebuild.getPrebuildConfigAsync(project, { platforms: ['ios'] });
  const mods = Object.keys(exp.mods?.ios ?? {});
  const unknown = [...new Set([...untracked, ...mods.filter(name => tracked.get(name) !== exp.mods.ios[name])])];
  const { compileModsAsync } = expo('@expo/config-plugins');
  const before = registrations.slice();
  exp = await compileModsAsync(exp, { projectRoot: project, platforms: ['ios'], introspect: true, ignoreExistingNativeFiles: true });
  const { mods: ignored, _internal, ...config } = exp;
  // Keep the whole serializable evaluated configuration and actual mod results.
  // Internal paths/history describe the evaluation machinery, not native output.
  return { config, modResults: _internal?.modResults?.ios ?? {}, mods: before,
    unobserved: unknown, retainApplicationJs: unknown.length > 0 || before.some(r => !r.audited) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Plugins may log; keep the machine-readable result on its own final line.
  try { console.log('SNAPBACK4_EFFECTIVE_CONFIG=' + JSON.stringify(await evaluate(fs.realpathSync(process.argv[2])))); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
