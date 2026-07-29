import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { extname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const receiptDir = resolve(root, '../receipts');
mkdirSync(receiptDir, { recursive: true });
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const authoredExtensions = new Set(['.ts', '.tsx', '.mjs', '.css', '.html']);
const excluded = new Set(['node_modules', 'dist', '.arm-runtime']);
const files = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (authoredExtensions.has(extname(entry.name))) files.push(path);
  }
}
walk(root);
const authored = files.map((path) => {
  const text = readFileSync(path, 'utf8');
  return {
    path: path.slice(root.length + 1),
    lines: text.split(/\r?\n/).length,
    bytes: Buffer.byteLength(text),
  };
});
const distBytes = existsSync(resolve(root, 'dist'))
  ? (() => {
      let total = 0;
      const accumulate = (directory) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const path = resolve(directory, entry.name);
          if (entry.isDirectory()) accumulate(path);
          else total += statSync(path).size;
        }
      };
      accumulate(resolve(root, 'dist'));
      return total;
    })()
  : null;
const inventory = {
  providerVersions: {
    instantCore: packageJson.dependencies['@instantdb/core'],
    instantReact: packageJson.dependencies['@instantdb/react'],
    instantAdmin: packageJson.dependencies['@instantdb/admin'],
    instantCli: packageJson.devDependencies['instant-cli'],
    react: packageJson.dependencies.react,
    vite: packageJson.devDependencies.vite,
    typescript: packageJson.devDependencies.typescript,
  },
  authoredFiles: authored,
  authoredTotals: {
    files: authored.length,
    lines: authored.reduce((sum, file) => sum + file.lines, 0),
    bytes: authored.reduce((sum, file) => sum + file.bytes, 0),
  },
  dependencies: {
    direct:
      Object.keys(packageJson.dependencies).length +
      Object.keys(packageJson.devDependencies).length,
    lockfilePackages: Object.keys(lock.packages ?? {}).length - 1,
  },
  productionBuildBytes: distBytes,
  capturedAt: new Date().toISOString(),
};
writeFileSync(
  resolve(receiptDir, 'inventory.json'),
  JSON.stringify(inventory, null, 2) + '\n',
);
const audit = spawnSync('npm', ['audit', '--json'], {
  cwd: root,
  encoding: 'utf8',
});
let auditJson;
try {
  auditJson = JSON.parse(audit.stdout);
} catch {
  auditJson = {
    parseFailure: true,
    exitStatus: audit.status,
    stderr: audit.stderr.slice(-4_000),
  };
}
writeFileSync(
  resolve(receiptDir, 'npm-audit.json'),
  JSON.stringify(auditJson, null, 2) + '\n',
);
process.stdout.write(
  JSON.stringify({
    ok: true,
    authoredTotals: inventory.authoredTotals,
    lockfilePackages: inventory.dependencies.lockfilePackages,
    auditExitStatus: audit.status,
  }) + '\n',
);
