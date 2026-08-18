import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from '../../../packages/snapback-codegen/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const spikeRoot = resolve(here, '..');
const repositoryRoot = resolve(spikeRoot, '../..');
const defineUrl = pathToFileURL(join(repositoryRoot, 'packages/snapback-codegen/define.mjs')).href;

export async function runPortableProfileControl() {
  const runCase = async ({ name, handlerSource = null, inline = false }) => {
    const backend = mkdtempSync(join(tmpdir(), 'snapback-0249-portable-control-'));
    try {
      writeFileSync(join(backend, 'schema.mjs'), `
        import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
        export default defineSchema({ rows: defineTable({ value: v.string() }).visibility({ kind: 'public-read' }) });
      `);
      writeFileSync(join(backend, 'codegen.policy.json'), JSON.stringify({
        schemaVersion: 'snapback.codegen-policy.v1',
        committedProjections: [],
        contractMetadata: 'exact',
      }, null, 2));
      let declaration;
      if (inline) {
        declaration = `export const inlineAmbient = defineAction({ handler: async () => ({ process, required: require('@vendor/sdk'), wasm: WebAssembly }) });`;
      } else {
        mkdirSync(join(backend, 'handlers'));
        writeFileSync(
          join(backend, 'handlers', handlerSource),
          readFileSync(join(spikeRoot, 'fixtures', 'portable', handlerSource)),
        );
        declaration = `export const ${name} = defineAction({ js: { source: 'handlers/${handlerSource}', exportName: 'default' } });`;
      }
      writeFileSync(join(backend, 'functions.mjs'), `
        import { defineAction } from ${JSON.stringify(defineUrl)};
        ${declaration}
      `);
      const generated = await generate(backend);
      return {
        name,
        refused: generated.ok === false,
        diagnostics: generated.diagnostics.map(({ code, message, path, line, column }) => ({ code, message, path, line, column })),
      };
    } finally {
      rmSync(backend, { recursive: true, force: true });
    }
  };
  const cases = [];
  cases.push(await runCase({ name: 'packageImport', handlerSource: 'package-import.mjs' }));
  cases.push(await runCase({ name: 'nodeImport', handlerSource: 'node-import.mjs' }));
  cases.push(await runCase({ name: 'dynamicAuthority', handlerSource: 'require-wasm.mjs' }));
  cases.push(await runCase({ name: 'inlineAmbient', inline: true }));
  const diagnostics = cases.flatMap(({ name, diagnostics: caseDiagnostics }) => (
    caseDiagnostics.map((diagnostic) => ({ fixture: name, ...diagnostic }))
  ));
  const codes = [...new Set(diagnostics.map(({ code }) => code))].sort();
  return {
    refused: cases.every(({ refused }) => refused),
    cases,
    codes,
    diagnostics,
    requiredCodesObserved: [
      'BUNDLE_UNSUPPORTED_IMPORT',
      'BUNDLE_UNSUPPORTED_REQUIRE',
      'BUNDLE_UNSUPPORTED_WEBASSEMBLY',
      'SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER',
    ].every((code) => codes.includes(code)),
  };
}
