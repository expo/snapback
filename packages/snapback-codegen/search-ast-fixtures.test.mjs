// The CV-5 cross-carrier conformance gate (LLP 0131 §The search fixture,
// item 4; acceptance 5/6/11).
//
// One committed accepted/rejected corpus — schemas/search.request.fixtures-v1
// .json, generated through the Rust parser (which asserts the Rust
// deserialization verdict during generation) — is re-proved here against
// every JS-side carrier:
//   1. the exported search.request.schema.json (ajv);
//   2. the expansion embedded by value in the per-operation args JSON Schema
//      and the provider-projection descriptor (an embedded copy that drifts
//      is a corpus failure);
//   3. the codegen-emitted TypeScript types and the client package's
//      published typings, at compile time (tsc; rejected fixtures compile
//      only under @ts-expect-error, so a silently-widened type fails);
// plus the LLP 0131 identity cascade item 2 gate: the client's generated
// search pin equals the codegen-computed hash of defineSearchQuery's
// contract, byte-for-byte.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import { searchAstEmission } from './search-request-schema.mjs';
import {
  computeSearchContractPin,
  searchContractPinSource,
} from '../snapback-client/search-contract-pin.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const schema = JSON.parse(
  readFileSync(join(repoRoot, 'schemas', 'search.request.schema.json'), 'utf8'),
);
const corpus = JSON.parse(
  readFileSync(join(repoRoot, 'schemas', 'search.request.fixtures-v1.json'), 'utf8'),
);

assert.equal(corpus.artifactKind, 'searchRequestFixturesV1');
assert.equal(corpus.schema, 'search.request.schema.json');
assert.ok(Array.isArray(corpus.fixtures) && corpus.fixtures.length >= 15);

const AjvClass = Ajv2020.default ?? Ajv2020;
const ajv = new AjvClass({ strict: false, allowUnionTypes: true });
const validateRequest = ajv.compile(schema);
const validateQuerySubtree = ajv.compile({
  ...schema.$defs.SearchQueryAstV1,
  $defs: schema.$defs,
});

// --- Carrier 1: the exported request schema -------------------------------

for (const fixture of corpus.fixtures) {
  const valid = validateRequest(fixture.request);
  assert.equal(
    valid,
    fixture.expect === 'accept',
    `${fixture.name}: exported schema disagrees with the Rust verdict (${fixture.expect})`,
  );
}

// --- Carrier 2: the embedded-by-value expansions --------------------------

const emission = searchAstEmission();
const validateEmbeddedQuery = ajv.compile(emission.queryJsonSchema);

// A minimal evaluator for the provider descriptor grammar: enough to prove
// the embedded descriptor expansion agrees with the schema carriers on the
// same fixtures. Unknown shapes throw — an evaluator gap is a test failure,
// never a silent pass.
function descriptorAdmits(descriptor, value) {
  switch (descriptor.shape) {
    case 'primitive':
      if (descriptor.name === 'string') return typeof value === 'string';
      if (descriptor.name === 'number') return typeof value === 'number';
      if (descriptor.name === 'boolean') return typeof value === 'boolean';
      throw new Error(`unhandled primitive ${descriptor.name}`);
    case 'literal':
      return value === descriptor.value;
    case 'array':
      return Array.isArray(value)
        && value.every((item) => descriptorAdmits(descriptor.items, item));
    case 'union':
      return descriptor.variants.some((variant) => descriptorAdmits(variant, value));
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
      const fields = Object.entries(descriptor.fields);
      const declared = new Set(descriptor.fields ? Object.keys(descriptor.fields) : []);
      if (Object.keys(value).some((key) => !declared.has(key))) return false;
      return fields.every(([name, field]) => {
        if (!(name in value)) return field.optional === true;
        return descriptorAdmits(field, value[name]);
      });
    }
    default:
      throw new Error(`unhandled descriptor shape ${descriptor.shape}`);
  }
}

for (const fixture of corpus.fixtures) {
  const query = fixture.request?.query;
  if (query === undefined) continue;
  // Reference verdict for the query subtree comes from the exported schema;
  // both embedded expansions must agree with it exactly.
  const subtreeValid = validateQuerySubtree(query);
  assert.equal(
    validateEmbeddedQuery(query),
    subtreeValid,
    `${fixture.name}: embedded args-schema expansion drifted from the export`,
  );
  assert.equal(
    descriptorAdmits(emission.queryDescriptorExpansion, query),
    subtreeValid,
    `${fixture.name}: embedded provider descriptor expansion drifted from the export`,
  );
}

// --- Carrier 3: generated + published TypeScript types, at compile time ---

// The workdir lives inside this package (not the OS tmpdir) so the published
// client typings are type-checked IN PLACE — their own package imports
// (e.g. @expo/snapback-contract subpaths) resolve through the real workspace
// node_modules chain instead of breaking in an isolated copy.
const workDir = mkdtempSync(join(here, '.search-ast-fixtures-tmp-'));
try {
  writeFileSync(
    join(workDir, 'generated.d.ts'),
    `${emission.tsLines.join('\n')}\n`,
  );
  const lines = [
    "import type { SearchRequestV1 as ClientSearchRequestV1 } from '../../snapback-client/index.mjs';",
    "import type { SearchRequestV1 as GeneratedSearchRequestV1 } from './generated.js';",
    '',
  ];
  corpus.fixtures.forEach((fixture, index) => {
    const literal = JSON.stringify(fixture.request);
    const reject = fixture.expect === 'reject';
    if (reject && fixture.typeLevel !== true) return;
    if (reject) lines.push('// @ts-expect-error rejected fixture must not type-check (generated)');
    lines.push(`const generated${index}: GeneratedSearchRequestV1 = ${literal};`);
    if (reject) lines.push('// @ts-expect-error rejected fixture must not type-check (published)');
    lines.push(`const client${index}: ClientSearchRequestV1 = ${literal};`);
    lines.push(`void generated${index}; void client${index};`);
  });
  writeFileSync(join(workDir, 'fixtures.ts'), `${lines.join('\n')}\n`);
  const tsc = join(repoRoot, 'node_modules', '.bin', 'tsc');
  execFileSync(tsc, [
    '--noEmit',
    '--strict',
    '--target', 'es2022',
    '--module', 'esnext',
    '--moduleResolution', 'bundler',
    join(workDir, 'fixtures.ts'),
  ], { stdio: 'pipe' });
} catch (error) {
  const stdout = error.stdout?.toString?.() ?? '';
  throw new Error(`search AST fixtures failed TypeScript agreement:\n${stdout}`, {
    cause: error,
  });
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

// --- Identity cascade item 2: the generated client search pin -------------

const committedPin = readFileSync(
  join(repoRoot, 'packages', 'snapback-client', 'search-contract.generated.mjs'),
  'utf8',
);
assert.equal(
  committedPin,
  await searchContractPinSource(),
  'search-contract.generated.mjs drifted; run node packages/snapback-client/generate-search-contract.mjs',
);
const { SEARCH_REQUEST_ARGS_CONTRACT_HASH } = await import(
  '../snapback-client/search-contract.generated.mjs'
);
assert.equal(SEARCH_REQUEST_ARGS_CONTRACT_HASH, await computeSearchContractPin());

console.log('search-ast-fixtures: all carriers agree on the committed corpus');
