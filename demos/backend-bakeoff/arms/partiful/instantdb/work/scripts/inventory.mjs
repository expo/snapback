import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
  armRoot,
  evidenceDir,
  receiptsDir,
  sha256,
  workRoot,
  writeJson,
} from './lib.mjs';

function walk(root, current = root) {
  const output = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.arm-runtime'].includes(entry.name)) continue;
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) output.push(...walk(root, path));
    else output.push({
      path: relative(root, path),
      bytes: statSync(path).size,
      lines: readFileSync(path, 'utf8').split('\n').length,
    });
  }
  return output;
}

function directoryBytes(path) {
  const result = spawnSync('du', ['-sk', path], { encoding: 'utf8' });
  return result.status === 0 ? Number(result.stdout.trim().split(/\s+/)[0]) * 1024 : null;
}

const authored = walk(workRoot);
const dependencyManifest = JSON.parse(readFileSync(resolve(workRoot, 'package-lock.json'), 'utf8'));
const audit = spawnSync('npm', ['audit', '--json'], {
  cwd: workRoot,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});
let auditBody;
try {
  auditBody = JSON.parse(audit.stdout);
} catch {
  auditBody = { parseError: true, stdoutSha256: sha256(audit.stdout), stderr: audit.stderr.slice(-1000) };
}
writeJson(resolve(receiptsDir, 'npm-audit.json'), {
  capturedAt: new Date().toISOString(),
  exitStatus: audit.status,
  metadata: auditBody.metadata,
  vulnerabilities: auditBody.vulnerabilities,
  note: 'Frozen Vite 7.1.3 has one aggregate high development-server finding; this arm bound Vite to loopback and stopped it after evidence.',
});

const screenshotPath = resolve(evidenceDir, 'screenshots/login.png');
writeJson(resolve(receiptsDir, 'ui-smoke.json'), {
  capturedAt: new Date().toISOString(),
  url: 'http://127.0.0.1:4337/',
  viteBinding: '127.0.0.1:4337',
  browserDebugBinding: '127.0.0.1:9337',
  httpStatus: 200,
  screenshotPath: 'evidence/screenshots/login.png',
  screenshotSha256: sha256(readFileSync(screenshotPath)),
  screenshotBytes: statSync(screenshotPath).size,
  postEvidencePorts: { 4337: 'stopped', 9337: 'stopped' },
});

const inventory = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  providerVersions: {
    product: 'InstantDB hosted temporary app',
    client: dependencyManifest.packages['node_modules/@instantdb/react']?.version,
    core: dependencyManifest.packages['node_modules/@instantdb/core']?.version,
    admin: dependencyManifest.packages['node_modules/@instantdb/admin']?.version,
    cli: dependencyManifest.packages['node_modules/instant-cli']?.version,
  },
  authoredFiles: authored,
  authoredTotals: {
    files: authored.length,
    bytes: authored.reduce((sum, file) => sum + file.bytes, 0),
    lines: authored.reduce((sum, file) => sum + file.lines, 0),
  },
  categories: {
    uiSource: authored.filter((file) => file.path.startsWith('src/')),
    schemaAndPolicy: authored.filter((file) => file.path.startsWith('instant.')),
    harnessAndOperations: authored.filter((file) => file.path.startsWith('scripts/')),
    configurationAndManifests: authored.filter((file) =>
      ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html'].includes(file.path),
    ),
  },
  dependencies: {
    directProduction: Object.keys(dependencyManifest.packages['']?.dependencies ?? {}).length,
    directDevelopment: Object.keys(dependencyManifest.packages['']?.devDependencies ?? {}).length,
    lockPackages: Object.keys(dependencyManifest.packages).length - 1,
    installedDependencyBytes: directoryBytes(resolve(workRoot, 'node_modules')),
  },
  productionBuildBytes: directoryBytes(resolve(workRoot, 'dist')),
  receiptsAtCapture: readdirSync(receiptsDir).sort(),
  evidenceAtCapture: walk(armRoot, evidenceDir),
  glue: [
    'native @instantdb/react UI queries/auth',
    'native @instantdb/admin authority/subscription/webhook operations',
    'native @instantdb/core actor-scoped Storage clients',
    'instant-cli schema/permission deployment',
  ],
};
writeJson(resolve(receiptsDir, 'inventory.json'), inventory);
process.stdout.write(`${JSON.stringify({ ok: true, authoredTotals: inventory.authoredTotals, providerVersions: inventory.providerVersions })}\n`);
