import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildContractMutationDescriptor,
  buildContractJsMutationDescriptor,
  contractCapabilitiesForMutations,
  functionImplementationHashRecord,
  generate,
} from './index.mjs';

const hashFixture = {
  name: 'allocate',
  kind: 'Mutation',
  runtime: { HostPlan: { Mutation: { steps: [], return_value: null } } },
  argsContractHash: 'sha256:args',
  resultContractHash: 'sha256:result',
  authRequirement: 'optional-user',
  authorizationDependence: [],
  uses: [],
};
const hashSummaries = {
  reads: { mode: 'none', primaryTable: null, tables: [], authScopeField: null },
  writes: { mode: 'none', tables: [] },
};
for (const [label, fn, version, expected] of [
  ['frozen v1', hashFixture, 'v1', 'sha256:b9521e3867f288f20558799d5ba6acf2beeac53f716ab44634bb21e9b7dfe7eb'],
  ['frozen v2', {
    ...hashFixture,
    inlineAst: { type: 'Program', body: [] },
    inlineHelpers: [{ name: 'helper', contentHash: 'sha256:helper' }],
  }, 'v2', 'sha256:8e11683616fa778e3b1c314ec8a533035c31f595057db34e6b75c3bf889e3646'],
  ['ordered v3 alpha-beta', { ...hashFixture, sequences: ['alpha', 'beta'] }, 'v3', 'sha256:6a9d518cf2540f6806b34c8d4fe15a5d27498098dc3b3ab2033bcd8f1c6c8444'],
  ['ordered v3 beta-alpha', { ...hashFixture, sequences: ['beta', 'alpha'] }, 'v3', 'sha256:44c392c950c902f5319ffc5b3c64828dffda6d6d8bb6d77a21da5d70211ec28f'],
]) {
  const record = functionImplementationHashRecord('sequence-hash-fixture', fn, hashSummaries);
  assert.equal(record.implementationFormatVersion, version, label);
  assert.equal(record.implementationHash, expected, label);
}

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const dir = mkdtempSync(join(tmpdir(), 'snapback-sequence-authoring-'));

const schemaSource = `
import { defineSchema, defineSequence, defineTable, v } from '${defineUrl}';
export const orgs = defineTable({
  ownerId: v.principal(),
  optionalOwner: v.optional(v.principal()),
  name: v.string(),
}).sync();
export const items = defineTable({ orgId: v.id('orgs'), sequence: v.integer() }).sync();
export default defineSchema({ orgs, items }, {
  sequences: {
    privateJobs: defineSequence({ scope: orgs }),
    publicJobs: defineSequence({ scope: orgs, scopeAccess: 'public.v1' }),
  },
});
`;

const handlerSource = ({ sequences = '', authScopeField = "authScopeField: 'ownerId',", body = 'return true;' } = {}) => `
import { defineJsMutation, results, v } from '${defineUrl}';
export const allocate = defineJsMutation({
  args: { orgId: v.id('orgs') },
  reads: ['orgs'],
  writes: ['items'],
  ${authScopeField}
  ${sequences}
  result: results.value(v.json()),
  handler: async (ctx, args) => { ${body} },
});
`;

try {
  writeFileSync(join(dir, 'schema.mjs'), schemaSource);
  writeFileSync(join(dir, 'functions.mjs'), handlerSource({
    sequences: "sequences: ['privateJobs'],",
    body: "return await ctx.sequence.allocate('privateJobs', args.orgId);",
  }));
  const authoredSchema = await import(`${pathToFileURL(join(dir, 'schema.mjs')).href}?authored`);
  assert.deepEqual(Object.keys(authoredSchema.default.sequences), ['privateJobs', 'publicJobs']);
  assert.equal(authoredSchema.default.sequences.privateJobs.scopeAccess, 'declared-authorization.v1');
  assert.equal(authoredSchema.default.sequences.publicJobs.scopeAccess, 'public.v1');
  const authoredFunctions = await import(`${pathToFileURL(join(dir, 'functions.mjs')).href}?authored`);
  assert.deepEqual(authoredFunctions.allocate.sequences, ['privateJobs']);

  let generated = await generate(dir);
  assert.equal(generated.ok, false, 'the substrate checkpoint must not publish target support');
  assert.match(JSON.stringify(generated.diagnostics), /sequence_allocation_v1/u);

  const sequenceDescriptor = buildContractMutationDescriptor({
    name: 'allocate',
    args: { orgId: { type: 'id', table: 'orgs' } },
    argOrder: ['orgId'],
    writes: ['items'],
    plan: { steps: [{ AllocateSequence: {} }], return_value: null },
    sequenceAllocationCount: 1,
  });
  assert.equal(sequenceDescriptor.optimistic, false);
  assert.equal(sequenceDescriptor.atomicOptimisticWithholding, true);
  assert.equal(sequenceDescriptor.plan, undefined);
  assert.equal(sequenceDescriptor.serverRunnable, true);
  assert.deepEqual(contractCapabilitiesForMutations({ allocate: sequenceDescriptor }), {
    optimisticMutations: false,
    derivedOptimisticOverlays: false,
    offlineReplay: false,
  });
  const sequenceJsDescriptor = buildContractJsMutationDescriptor({
    name: 'allocateJs',
    args: {},
    argOrder: [],
    writes: ['items'],
    sequenceCount: 1,
  });
  assert.equal(sequenceJsDescriptor.optimistic, false);
  assert.equal(sequenceJsDescriptor.atomicOptimisticWithholding, true);
  assert.equal(sequenceJsDescriptor.plan, undefined);
  const ordinaryJsDescriptor = buildContractJsMutationDescriptor({
    name: 'ordinaryJs',
    args: {},
    argOrder: [],
    writes: ['items'],
  });
  assert.equal(ordinaryJsDescriptor.optimistic, false);
  assert.equal(ordinaryJsDescriptor.atomicOptimisticWithholding, undefined);

  writeFileSync(join(dir, 'functions.mjs'), handlerSource({
    sequences: "sequences: ['publicJobs'],",
    authScopeField: '',
    body: "return await ctx.sequence.allocate('publicJobs', args.orgId);",
  }));
  generated = await generate(dir);
  assert.equal(generated.ok, false, 'public scope does not publish the withheld target capability');
  assert.match(JSON.stringify(generated.diagnostics), /sequence_allocation_v1/u);

  for (const [label, source, expected] of [
    [
      'unknown counter',
      handlerSource({ sequences: "sequences: ['missingCounter']," }),
      /SNAPBACK_SEQUENCE_UNDECLARED/u,
    ],
    [
      'non-public scope without authority field',
      handlerSource({ sequences: "sequences: ['privateJobs'],", authScopeField: '' }),
      /non-public handler sequence scope must be its sole primary read table/u,
    ],
    [
      'optional authority field',
      handlerSource({
        sequences: "sequences: ['privateJobs'],",
        authScopeField: "authScopeField: 'optionalOwner',",
      }),
      /non-public handler sequence scope must be its sole primary read table/u,
    ],
    [
      'ordinary mutation step',
      `
import { allocateSequence, arg, defineMutation, returnBinding, v } from '${defineUrl}';
export const allocate = defineMutation({
  args: { orgId: v.id('orgs') },
  plan: allocateSequence('privateJobs', arg('orgId'), 'sequence'),
  returns: returnBinding('sequence'),
});
`,
      /AllocateSequence is admitted only by write-with-activity\.v1/u,
    ],
  ]) {
    writeFileSync(join(dir, 'functions.mjs'), source);
    const invalid = await generate(dir);
    assert.equal(invalid.ok, false, `${label} unexpectedly generated`);
    assert.match(JSON.stringify(invalid.diagnostics), expected, label);
  }

  writeFileSync(
    join(dir, 'schema.mjs'),
    schemaSource.replace(
      `}).sync();\nexport const items`,
      `}).sync().assetSharing({ kind: 'public-read' });\nexport const items`,
    ),
  );
  writeFileSync(join(dir, 'functions.mjs'), handlerSource());
  const independentAuthority = await generate(dir);
  assert.equal(independentAuthority.ok, false);
  assert.match(
    JSON.stringify(independentAuthority.diagnostics),
    /scope must be an ordinary table without independent authority/u,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('sequence authoring tests passed');
