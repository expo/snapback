#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [workArgument, ledgerArgument] = process.argv.slice(2);
if (!workArgument || !ledgerArgument) {
  throw new Error('usage: node transform-external.mjs <external-work-root> <publish-ledger>');
}

const workRoot = resolve(workArgument);
const ledgerPath = resolve(ledgerArgument);
const here = dirname(fileURLToPath(import.meta.url));
const receiptPath = join(workRoot, 'transformation-receipt.json');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const transformations = [];

function replaceExact(relativePath, before, after, reason) {
  const path = join(workRoot, relativePath);
  const original = readFileSync(path, 'utf8');
  const occurrences = original.split(before).length - 1;
  if (occurrences !== 1) {
    throw new Error(`${relativePath}: expected exactly one occurrence for ${reason}, found ${occurrences}`);
  }
  const transformed = original.replace(before, after);
  writeFileSync(path, transformed);
  transformations.push({
    path: relativePath,
    operation: 'exact-replacement',
    reason,
    beforeSha256: sha256(original),
    afterSha256: sha256(transformed),
  });
}

function replaceExactCount(relativePath, before, after, expectedOccurrences, reason) {
  const path = join(workRoot, relativePath);
  const original = readFileSync(path, 'utf8');
  const occurrences = original.split(before).length - 1;
  if (occurrences !== expectedOccurrences) {
    throw new Error(`${relativePath}: expected ${expectedOccurrences} occurrences for ${reason}, found ${occurrences}`);
  }
  const transformed = original.replaceAll(before, after);
  writeFileSync(path, transformed);
  transformations.push({
    path: relativePath,
    operation: 'exact-replacement',
    occurrences,
    reason,
    beforeSha256: sha256(original),
    afterSha256: sha256(transformed),
  });
}

const packagePath = join(workRoot, 'package.json');
const packageBefore = readFileSync(packagePath, 'utf8');
const packageJson = JSON.parse(packageBefore);
const arm = packageJson.name === 'llp0102-todo-snapback'
  ? 'todo/snapback'
  : packageJson.name === 'llp0102-chat-snapback'
    ? 'chat/snapback'
    : null;
if (!arm) throw new Error(`unexpected frozen arm package: ${packageJson.name}`);
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
if (ledger.mode !== 'dry-run' || ledger.sourceDirty !== false) {
  throw new Error('publish ledger is not a clean dry-run closure');
}
if (ledger.revision !== process.env.SNAPBACK_BAKEOFF_EXPECTED_COMMIT) {
  throw new Error(`publish ledger revision ${ledger.revision} is not the frozen source`);
}
if (!Array.isArray(ledger.packages) || ledger.packages.length !== 7) {
  throw new Error('expected the seven-package Linux host closure');
}
for (const entry of ledger.packages) {
  if (entry.status !== 'dry-run-ok') throw new Error(`package ${entry.sourceName} was not staged successfully`);
  packageJson.dependencies[entry.sourceName] = `file:${resolve(dirname(ledgerPath), entry.tarball)}`;
}
packageJson.scripts.generate = 'snapback generate snapback --json';
delete packageJson.scripts.finalize;
const packageAfter = `${JSON.stringify(packageJson, null, 2)}\n`;
writeFileSync(packagePath, packageAfter);
transformations.push({
  path: 'package.json',
  operation: 'structured-rewrite',
  reason: 'bind all Snapback imports and commands to the staged host package closure',
  beforeSha256: sha256(packageBefore),
  afterSha256: sha256(packageAfter),
});

replaceExact(
  'src/provider.ts',
  "../../../../../../../packages/snapback-client/online.mjs",
  '@snapback/client/online',
  'replace source-tree client import with installed package export',
);
replaceExact(
  'src/App.tsx',
  "../../../../../../../packages/snapback-react/index.mjs",
  '@snapback/react',
  'replace source-tree React import with installed package export',
);
for (const relativePath of ['snapback/schema.mjs', 'snapback/functions.mjs']) {
  replaceExact(
    relativePath,
    "../../../../../../_kit/define.mjs",
    '@snapback/codegen/define',
    'replace demo-kit schema DSL import with installed codegen export',
  );
}
replaceExact(
  'scripts/run-arm.mjs',
  "import { SnapbackClient, createExternalSessionClient } from '../../../../../../_kit/client.mjs';\nimport { freePort } from '../../../../../../_kit/provenance.mjs';\nimport { startServer } from '../../../../../../_kit/server-process.mjs';",
  "import { SnapbackClient, createExternalSessionClient } from '@snapback/client';\nimport { freePort, startServer } from './external-acceptance-kit.mjs';",
  'replace all demo-kit client and lifecycle imports with installed packages and the external package-only launcher',
);
replaceExact(
  'scripts/run-arm.mjs',
  "../../../../../../../packages/snapback-contract/index.mjs",
  '@snapback/contract',
  'replace source-tree contract import with installed package export',
);
replaceExact(
  'scripts/run-arm.mjs',
  "const repoRoot = resolve(workRoot, '../../../../../../');\n",
  '',
  'remove source checkout root discovery',
);
replaceExactCount(
  'scripts/run-arm.mjs',
  'cwd: repoRoot,',
  'cwd: workRoot,',
  2,
  'run both installed server processes from the external project root',
);
replaceExact(
  'scripts/run-arm.mjs',
  "const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';",
  "const chromePath = process.env.SNAPBACK_BAKEOFF_CHROME_PATH;\nif (!chromePath) throw new Error('SNAPBACK_BAKEOFF_CHROME_PATH is required');",
  'make the controlled browser path explicit and machine-local',
);
replaceExact(
  'vite.config.ts',
  "  server: {\n    fs: {\n      allow: ['../../../../../../'],\n    },\n  },\n",
  '',
  'remove source-checkout filesystem access from Vite',
);

const onlineTypesPath = join(workRoot, 'src', 'snapback-client-online.d.ts');
const onlineTypes = [
  "declare module '@snapback/client/online' {",
  '  export function createExternalSessionClient(...args: any[]): any;',
  '}',
  '',
].join('\n');
writeFileSync(onlineTypesPath, onlineTypes);
transformations.push({
  path: 'src/snapback-client-online.d.ts',
  operation: 'add',
  reason: 'the staged client package exports online.mjs without a TypeScript declaration; preserve runtime imports while recording the package gap',
  beforeSha256: null,
  afterSha256: sha256(onlineTypes),
});

const finalizePath = join(workRoot, 'scripts', 'finalize-capsule.mjs');
const finalizeBefore = readFileSync(finalizePath);
rmSync(finalizePath);
transformations.push({
  path: 'scripts/finalize-capsule.mjs',
  operation: 'delete',
  reason: 'sealed capsule finalization is coordinator-owned and source-tree-coupled',
  beforeSha256: sha256(finalizeBefore),
  afterSha256: null,
});

copyFileSync(join(here, 'external-acceptance-kit.mjs'), join(workRoot, 'scripts', 'external-acceptance-kit.mjs'));
transformations.push({
  path: 'scripts/external-acceptance-kit.mjs',
  operation: 'add',
  reason: 'installed-package-only lifecycle with assigned-port, provenance, and cleanup proof',
  beforeSha256: null,
  afterSha256: sha256(readFileSync(join(workRoot, 'scripts', 'external-acceptance-kit.mjs'))),
});

const forbidden = [
  '../../../../../../_kit/',
  '../../../../../../../packages/snapback-',
  '../../../../../../packages/snapback-',
  'repoRoot',
  'cargo run',
  'target/release/snapback',
  'target/debug/snapback',
];
const scanned = [
  'package.json',
  'src/provider.ts',
  'src/App.tsx',
  'src/snapback-client-online.d.ts',
  'snapback/schema.mjs',
  'snapback/functions.mjs',
  'scripts/run-arm.mjs',
  'scripts/external-acceptance-kit.mjs',
  'vite.config.ts',
];
const forbiddenFindings = [];
for (const relativePath of scanned) {
  const content = readFileSync(join(workRoot, relativePath), 'utf8');
  for (const token of forbidden) {
    if (content.includes(token)) forbiddenFindings.push({ path: relativePath, token });
  }
}
if (forbiddenFindings.length !== 0) {
  throw new Error(`external transformation retained forbidden source coupling: ${JSON.stringify(forbiddenFindings)}`);
}

writeFileSync(receiptPath, `${JSON.stringify({
  schemaVersion: 'snapback.llp0102.external-transformation.v1',
  arm,
  sourceRevision: ledger.revision,
  packageVersion: ledger.version,
  publicationMode: ledger.mode,
  ledgerPath,
  ledgerSha256: sha256(readFileSync(ledgerPath)),
  externalWorkRoot: workRoot,
  sourceCapsuleMutated: false,
  transformations,
  scan: {
    paths: scanned,
    forbiddenTokens: forbidden,
    findings: forbiddenFindings,
    ok: true,
  },
}, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, receiptPath, transformations: transformations.length }));
