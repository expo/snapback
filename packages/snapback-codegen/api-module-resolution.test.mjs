import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(dirname(packageRoot));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const backend = mkdtempSync(join(tmpdir(), 'snapback-api-module-resolution-'));

try {
  const packageScope = join(backend, 'node_modules', '@expo');
  mkdirSync(packageScope, { recursive: true });
  symlinkSync(packageRoot, join(packageScope, 'snapback-codegen'), 'dir');

  writeFileSync(join(backend, 'schema.mjs'), `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export default defineSchema({
  todos: defineTable({ ownerId: v.string(), title: v.string() })
    .visibility({ kind: 'public-read' }),
});
`);
  writeFileSync(join(backend, 'functions.mjs'), `
import { defineQuery, v } from ${JSON.stringify(defineUrl)};
export const listTodos = defineQuery({
  table: 'todos',
  args: { ownerId: v.string() },
});
`);

  const generated = await generate(backend);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  for (const stem of ['api', 'app']) {
    const legacyDeclaration = readFileSync(join(generated.outDir, `${stem}.d.ts`), 'utf8');
    const moduleDeclaration = readFileSync(join(generated.outDir, `${stem}.d.mts`), 'utf8');
    assert.equal(
      moduleDeclaration,
      legacyDeclaration,
      `${stem} .d.ts compatibility and .d.mts module-resolution leaves stay byte-identical`,
    );
  }

  const fixture = join(backend, 'consumer.ts');
  writeFileSync(fixture, `
import api from './generated/api.mjs';
import app from './generated/app.mjs';

type ArgsOf<Reference> = Reference extends { readonly __args?: infer Args } ? Args : never;
const name: 'listTodos' = api.listTodos.name;
const args: ArgsOf<typeof api.listTodos> = { ownerId: 'owner_1' };
// @ts-expect-error generated argument types must reject the wrong scalar.
const wrongArgs: ArgsOf<typeof api.listTodos> = { ownerId: 42 };
const appName: 'listTodos' = app.api.queries.listTodos.name;
const appArgs: ArgsOf<typeof app.api.queries.listTodos> = { ownerId: 'owner_1' };
// @ts-expect-error generated app argument types must reject the wrong scalar.
const wrongAppArgs: ArgsOf<typeof app.api.queries.listTodos> = { ownerId: 42 };
void [name, args, wrongArgs, appName, appArgs, wrongAppArgs];
`);

  // @ref LLP 0277#f11-small-clientcodegen-papercuts--single-run-each — the
  // exact relative `.mjs` spelling must retain full generated types in both
  // resolver families without allowJs or a consumer declaration shim.
  const resolverModes = [
    { module: 'esnext', moduleResolution: 'node' },
    { module: 'esnext', moduleResolution: 'bundler' },
    { module: 'nodenext', moduleResolution: 'nodenext' },
  ];
  for (const { module, moduleResolution } of resolverModes) {
    const typecheck = spawnSync(
      join(repositoryRoot, 'node_modules', '.bin', 'tsc'),
      [
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        '--target', 'es2022',
        '--module', module,
        '--moduleResolution', moduleResolution,
        fixture,
      ],
      { cwd: backend, encoding: 'utf8' },
    );
    assert.equal(
      typecheck.status,
      0,
      `relative api.mjs consumer failed under moduleResolution ${moduleResolution}\n${typecheck.stdout}\n${typecheck.stderr}`,
    );
  }
} finally {
  rmSync(backend, { recursive: true, force: true });
}

console.log('api-module-resolution.test.mjs: node + bundler + nodenext relative .mjs types pass');
