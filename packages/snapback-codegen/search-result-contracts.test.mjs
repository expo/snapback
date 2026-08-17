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
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { compileResultContractValidator } from '@expo/snapback-contract/result-contract-validator';

import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(dirname(packageRoot));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const backend = mkdtempSync(join(tmpdir(), 'snapback-search-result-contract-'));

try {
  // Generated declarations consume the public client package. Model that
  // dependency explicitly so an unresolved type-only import cannot silently
  // degrade to `any` under --skipLibCheck.
  const snapbackModules = join(backend, 'node_modules', '@expo');
  mkdirSync(snapbackModules, { recursive: true });
  symlinkSync(
    join(repositoryRoot, 'packages', 'snapback-client'),
    join(snapbackModules, 'snapback-client'),
    'dir',
  );
  symlinkSync(
    join(repositoryRoot, 'packages', 'snapback-codegen'),
    join(snapbackModules, 'snapback-codegen'),
    'dir',
  );

  writeFileSync(join(backend, 'schema.mjs'), `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};

export const incidents = defineTable({
  title: v.string(),
  summary: v.optional(v.string()),
  open: v.boolean(),
  updatedAt: v.integer(),
}).visibility({ kind: 'public-read' }).searchIndex('search_incidents', {
  semanticVersion: 'search-result-contract.v1',
  textFields: {
    title: { weight: 8, classification: 'public' },
    summary: { weight: 4, classification: 'public' },
  },
  fieldClassifications: {
    open: 'public',
    updatedAt: 'public',
  },
  equalityFilters: ['open'],
  storedFields: ['open', 'summary', 'title', 'updatedAt'],
  highlightFields: ['summary', 'title'],
  visibility: { kind: 'public-read' },
});

export default defineSchema({ incidents });
`);
  writeFileSync(join(backend, 'functions.mjs'), `
import { defineSearchQuery } from ${JSON.stringify(defineUrl)};
import { incidents } from './schema.mjs';

export const searchIncidents = defineSearchQuery({
  table: incidents,
  index: 'search_incidents',
});
`);

  const generated = await generate(backend);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  assert.equal(generated.summary.counts.degradedResults, 0);
  assert.equal(generated.summary.degradedResults.length, 0);
  assert.equal(
    generated.diagnostics.some(({ path }) => (
      typeof path === 'string' && path.startsWith('queries.searchIncidents.result')
    )),
    false,
    'the schema-derived search result must not emit a degraded provider warning',
  );

  const manifest = JSON.parse(readFileSync(
    join(backend, 'generated', 'functions.manifest.json'),
    'utf8',
  ));
  const operation = manifest.functions.find(({ name }) => name === 'searchIncidents');
  assert.equal(operation.resultContract.kind, 'records');
  const rowFields = Object.fromEntries(
    operation.resultContract.record.fields.map((field) => [field.name, field]),
  );
  assert.deepEqual(rowFields.rowId.value, { kind: 'id', table: 'incidents' });
  assert.equal(rowFields.fields.value.kind, 'object');
  assert.equal(rowFields.fields.value.allowExtra, false);
  assert.deepEqual(
    rowFields.fields.value.fields.map(({ name }) => name),
    ['open', 'summary', 'title', 'updatedAt'],
  );
  const stored = Object.fromEntries(
    rowFields.fields.value.fields.map((field) => [field.name, field.value]),
  );
  assert.equal(stored.open.kind, 'boolean');
  assert.deepEqual(stored.summary.variants.map(({ kind }) => kind), ['null', 'string']);
  assert.equal(stored.title.kind, 'string');
  assert.equal(stored.updatedAt.kind, 'integer');
  assert.equal(
    JSON.stringify(operation.resultContract).includes('"kind":"json"'),
    false,
    'search result contracts must not hide stored fields behind bounded JSON',
  );

  // Runtime validation consumes the same generated contract. Optional source
  // fields are present-null in the search projection, and the stored-field
  // object is closed.
  const validator = compileResultContractValidator(operation.resultContract);
  const validRow = {
    rowId: 'incident_1',
    score: 800,
    fields: {
      open: true,
      summary: null,
      title: 'Cache saturation',
      updatedAt: 42,
    },
    highlights: [],
  };
  assert.equal(validator.validate([validRow]).ok, true);
  assert.equal(
    validator.validate([{ ...validRow, fields: { ...validRow.fields, hidden: 'nope' } }]).ok,
    false,
  );
  assert.equal(
    validator.validate([{ ...validRow, fields: { ...validRow.fields, title: 42 } }]).ok,
    false,
  );
  const { summary: _summary, ...missingSummary } = validRow.fields;
  assert.equal(
    validator.validate([{ ...validRow, fields: missingSummary }]).ok,
    false,
    'optional storage fields are still materialized keys',
  );

  const apiTypes = readFileSync(join(backend, 'generated', 'api.d.ts'), 'utf8');
  assert.match(
    apiTypes,
    /import type \{ SearchPageV1 as ClientSearchPageV1 \} from '@expo\/snapback-client';/u,
  );
  assert.match(
    apiTypes,
    /export type SearchPageV1<[^;]+> = ClientSearchPageV1<Fields, RowId>;/u,
  );
  assert.match(
    apiTypes,
    /"searchIncidents": FunctionReference<"searchIncidents", 'Query', SearchRequestV1, SearchPageV1<\{ "open": boolean; "summary": null \| string; "title": string; "updatedAt": number \}, Id<"incidents">>, "snapback-explicit-v1">;/u,
  );

  const fixturePath = join(backend, 'search-types.fixture.ts');
  const clientImport = relative(
    backend,
    join(repositoryRoot, 'packages', 'snapback-client', 'index.mjs'),
  ).split('\\').join('/');
  writeFileSync(fixturePath, `
import { SnapbackClient, search } from ${JSON.stringify(
    clientImport.startsWith('.') ? clientImport : `./${clientImport}`,
  )};
import api from './generated/api.mjs';

const client = new SnapbackClient('http://127.0.0.1:5050');
type IncidentId = string & { readonly __snapbackIdTable: 'incidents' };
client.search(api.searchIncidents, {
  query: search.all(search.term('cache')),
}).then((page) => {
  const item = page.items[0];
  if (!item) return;
  item.fields.title.toUpperCase();
  item.fields.summary?.toUpperCase();
  item.fields.updatedAt.toFixed();
  const rowId: IncidentId = item.rowId;
  void rowId;
  // @ts-expect-error stored-field keys are declaration-specific.
  item.fields.notStored;
  // @ts-expect-error stored-field value types come from the source schema.
  item.fields.open.toUpperCase();
});
`);
  const tsc = spawnSync(
    join(repositoryRoot, 'node_modules', '.bin', 'tsc'),
    [
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--allowJs',
      '--target', 'es2022',
      '--module', 'esnext',
      '--moduleResolution', 'bundler',
      fixturePath,
    ],
    { cwd: backend, encoding: 'utf8' },
  );
  assert.equal(
    tsc.status,
    0,
    `generated search consumer failed exact typecheck\n${tsc.stdout}\n${tsc.stderr}`,
  );
} finally {
  rmSync(backend, { recursive: true, force: true });
}

console.log('search-result-contracts.test.mjs: exact runtime, codegen, and consumer types pass');
