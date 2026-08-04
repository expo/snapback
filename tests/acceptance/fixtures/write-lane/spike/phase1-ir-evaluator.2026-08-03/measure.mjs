#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, version as esbuildVersion } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../../..');
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

const profiles = [
  {
    id: 'shipped-derived-overlay-all-exports',
    source: "import * as value from '../../../../../../packages/snapback-contract/derived-overlay.mjs'; export { value };",
  },
  {
    id: 'shipped-canonical-client-value-all-exports',
    source: "import * as value from '../../../../../../packages/snapback-client/canonical-client-value.mjs'; export { value };",
  },
  {
    id: 'shipped-answer-classes-all-exports',
    source: "import * as value from '../../../../../../packages/snapback-client/answer-classes.mjs'; export { value };",
  },
  {
    id: 'landed-materialization-store-all-exports',
    source: "import * as value from '../../../../../../packages/snapback-client/materialization-store.mjs'; export { value };",
  },
  {
    id: 'landed-materialization-store-plus-spike-used-entry',
    source: "import * as store from '../../../../../../packages/snapback-client/materialization-store.mjs'; export { store }; export { evaluateKanbanMutationSpike, classifySpikePlan } from './browser-evaluator.mjs';",
  },
  {
    id: 'spike-kanban-evaluator-all-exports',
    source: "import * as value from './browser-evaluator.mjs'; export { value };",
  },
  {
    id: 'spike-kanban-evaluator-used-entry',
    source: "export { evaluateKanbanMutationSpike, classifySpikePlan } from './browser-evaluator.mjs';",
  },
];

async function measure(profile) {
  const built = await build({
    stdin: {
      contents: profile.source,
      resolveDir: HERE,
      sourcefile: `${profile.id}.fixture.mjs`,
      loader: 'js',
    },
    absWorkingDir: ROOT,
    bundle: true,
    conditions: ['browser', 'import', 'default'],
    define: { 'process.env.NODE_ENV': '"production"' },
    format: 'esm',
    legalComments: 'none',
    logLevel: 'silent',
    metafile: true,
    minify: true,
    platform: 'browser',
    target: 'es2022',
    treeShaking: true,
    write: false,
  });
  const output = built.outputFiles[0].contents;
  const outputMeta = Object.values(built.metafile.outputs)[0];
  const modules = Object.entries(outputMeta.inputs)
    .map(([module, value]) => ({
      module: module.replace(`${ROOT}/`, ''),
      minifiedModuleOwnBytes: value.bytesInOutput,
    }))
    .sort((left, right) => right.minifiedModuleOwnBytes - left.minifiedModuleOwnBytes
      || left.module.localeCompare(right.module));
  return {
    id: profile.id,
    entrySha256: sha256(profile.source),
    minifiedBytes: output.byteLength,
    gzipBytes: gzipSync(output, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(output, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
    outputSha256: sha256(output),
    modules,
  };
}

const measured = [];
for (const profile of profiles) measured.push(await measure(profile));
console.log(JSON.stringify({
  schemaVersion: 'snapback.phase1-ir-evaluator-sizing-spike.v1',
  date: '2026-08-03',
  status: 'throwaway-unregistered-evidence',
  method: {
    runtime: process.version,
    zlib: process.versions.zlib,
    brotli: process.versions.brotli,
    bundler: `esbuild@${esbuildVersion}`,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    minify: true,
    treeShaking: true,
    legalComments: 'none',
    conditions: ['browser', 'import', 'default'],
    gzipLevel: 9,
    brotliQuality: 11,
    attribution: 'esbuild metafile output.inputs bytesInOutput (module-own minified bytes)',
  },
  profiles: measured,
}, null, 2));
