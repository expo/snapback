// @ref LLP 3000.030#15 — JS exclusion is a property of audited implementations.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire, builtinModules } from 'node:module';
import { hash, readJSON } from './payload.mjs';

// Content pins include entry points, resolved helpers (including lazy literal
// requires), every package resolution manifest and missing optional imports.
// Re-audit native/config reads before updating; do not auto-trust new versions.
const audit = readJSON(new URL('./plugin-audit.json', import.meta.url));
export function auditedPlugins(project, manifest, plugins) {
  if (!plugins.length) return true;
  project = fs.realpathSync(project);
  try {
    const req = createRequire(path.join(project, 'package.json'));
    const lock = readJSON(path.join(project, 'package-lock.json'));
    const checked = new Map();
    const inspect = relative => {
      if (checked.has(relative)) return checked.get(relative);
      const file = path.join(project, 'node_modules', relative);
      if (fs.realpathSync(file) !== file) throw Error('linked plugin implementation');
      const bytes = fs.readFileSync(file), edges = {};
      if (/\.[cm]?js$/.test(file)) {
        const from = createRequire(file);
        for (const match of bytes.toString().matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
          const spec = match[1];
          if (builtinModules.includes(spec) || spec.startsWith('node:')) continue;
          let resolved = null;
          try { resolved = path.relative(path.join(project, 'node_modules'), from.resolve(spec)); } catch {}
          edges[spec] = resolved;
        }
      }
      const row = [relative, hash(bytes), edges]; checked.set(relative, row); return row;
    };
    for (const value of plugins) {
      const plugin = Array.isArray(value) ? value[0] : value;
      const name = plugin.split('/')[0];
      const spec = { ...manifest.dependencies, ...manifest.devDependencies }[name];
      // Aliases, tags, forks, git/path/workspace installs never earn exclusion.
      if (typeof spec !== 'string' || !/^[~^]?\d+\.\d+\.\d+$/.test(spec)) return false;
      const installed = lock.packages?.[`node_modules/${name}`];
      if (!(audit[plugin] ?? []).some(pin => {
        if (installed?.version !== pin.version || installed.link ||
            installed.resolved !== `https://registry.npmjs.org/${name}/-/${name}-${pin.version}.tgz`) return false;
        if (req.resolve(pin.spec) !== path.join(project, 'node_modules', pin.entry)) return false;
        try { return hash(JSON.stringify(pin.files.map(inspect))) === pin.sha256; } catch { return false; }
      })) return false;
    }
    return true;
  } catch { return false; }
}
