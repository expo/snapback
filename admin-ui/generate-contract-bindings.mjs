// Generate the admin Contract binding modules from contract-bindings.mjs.
//
// This stays deliberately small and admin-specific: it owns the admin binding
// list and its arg vocabulary. The module *emission* — runtime links, binding
// modules, contract-meta sidecars — comes from the shared
// @snapback/codegen contract emitter (LLP 0032 P1), so the admin surface and
// the demo codegen cannot drift one renderer at a time (they had: this file's
// copy lost the result/shape facts the kit emitter gained).

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  generatedByHeader,
  renderBindingModule,
  renderMutationMetaModule,
  renderQueryMetaModule,
  renderRuntimeLinksModule,
} from '../packages/snapback-codegen/contract-emitter.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const HEADER = generatedByHeader('admin-ui/generate-contract-bindings.mjs (@snapback/codegen contract emitter)');
const REF_LINE = '// @ref LLP 0021#phase-4-move-admin-and-demo-surfaces-onto-the-adapter - admin Contract modules are projected from one binding list by the shared emitter.';
const LINKS_BASE_NAME = 'AdminContract';

export async function generateAdminContractBindings({
  root = here,
  bindings = null,
  bindingsPath = join(resolve(root), 'contract-bindings.mjs'),
  cacheBust = false,
} = {}) {
  const adminContractBindings = bindings ??
    await loadAdminContractBindings({ bindingsPath, cacheBust });
  const outDir = join(resolve(root), 'generated', 'contract');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const files = [
    {
      file: 'runtime-links.ts',
      source: renderRuntimeLinksModule({
        header: HEADER,
        refLine: REF_LINE,
        linksBaseName: LINKS_BASE_NAME,
        errorMessage: 'Admin Contract links were used before the bridge was configured.',
        entries: adminContractBindings.map((binding) => ({
          name: binding.name,
          argsType: typeForArgs(binding.args),
        })),
      }),
    },
  ];

  for (const binding of adminContractBindings) {
    const suffix = binding.kind === 'query' ? 'query' : 'mutation';
    files.push({
      file: `${binding.name}.${suffix}.ts`,
      source: renderBindingModule({
        header: HEADER,
        refLine: REF_LINE,
        bindingComment: `// Admin ${suffix} binding for ${binding.name}.`,
        name: binding.name,
        argsType: typeForArgs(binding.args),
        linksBaseName: LINKS_BASE_NAME,
      }),
    });
    files.push({
      file: `${binding.name}.${suffix}.contract-meta.ts`,
      source: binding.kind === 'query'
        ? renderQueryMetaModule({
            header: HEADER,
            name: binding.name,
            reads: binding.reads,
            readMode: binding.readMode,
            cacheKey: binding.cacheKey,
          })
        : renderMutationMetaModule({
            header: HEADER,
            name: binding.name,
            effects: binding.effects,
            invalidates: binding.invalidates,
          }),
    });
  }

  for (const { file, source } of files) {
    writeFileSync(join(outDir, file), source);
  }
  return { outDir, files: files.map((entry) => entry.file) };
}

async function loadAdminContractBindings({ bindingsPath, cacheBust }) {
  const url = pathToFileURL(resolve(bindingsPath));
  if (cacheBust) {
    url.searchParams.set('t', String(Date.now()));
  }
  const module = await import(url.href);
  if (!Array.isArray(module.adminContractBindings)) {
    throw new Error(`admin Contract binding list is missing from ${bindingsPath}`);
  }
  return module.adminContractBindings;
}

// Admin bindings declare args as primitive-name strings ('string' | 'number' |
// 'boolean'), unlike the demo codegen's validator objects; render them here and
// hand the emitter finished type strings.
function typeForArgs(args) {
  const entries = Object.entries(args ?? {});
  if (entries.length === 0) return 'Record<string, never>';
  return `{ ${entries.map(([name, type]) => `${name}: ${typeForPrimitive(type)}`).join('; ')} }`;
}

function typeForPrimitive(type) {
  return { string: 'string', number: 'number', boolean: 'boolean' }[type] ?? 'unknown';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await generateAdminContractBindings();
  console.log(`admin-ui: generated Contract bindings -> ${result.outDir}`);
}
