import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { allocateSequence, arg, asc, defineJsMutation } from './define.mjs';
import {
  buildContractJsMutationDescriptor,
  buildContractMutationDescriptor,
  contractCapabilitiesForMutations,
  generate,
} from './index.mjs';

const declaration = [{
  name: 'jobNumber',
  scopeTable: 'orgs',
  scopeAccess: { declaration: 'orgMembers', roles: ['dispatcher', 'operator'] },
}];
const direct = defineJsMutation({
  writes: ['jobs'],
  sequences: declaration,
  handler: async (ctx, args) => ctx.sequence.allocate('jobNumber', args.orgId),
});
assert.deepEqual(direct.sequences, declaration);
const sequenceOnly = defineJsMutation({
  writes: [],
  sequences: declaration,
  handler: async (ctx, args) => ctx.sequence.allocate('jobNumber', args.orgId),
});
assert.deepEqual(sequenceOnly.js.writes, []);
assert.throws(
  () => defineJsMutation({
    writes: ['jobs'],
    sequences: [{ name: 'jobNumber', scopeTable: 'orgs', scopeAccess: 'private-ish' }],
    handler: async () => null,
  }),
  /scopeAccess/,
);
for (const name of ['bad/name', '9jobs', '_snapbackJobs', '_auth', '_AUTH_jobs']) {
  assert.throws(
    () => defineJsMutation({
      writes: ['jobs'],
      sequences: [{ ...declaration[0], name }],
      handler: async () => null,
    }),
    /non-reserved user identifier/,
    `handler sequence counter ${name} must refuse before generation`,
  );
  assert.throws(
    () => allocateSequence(name, arg('orgId'), 'jobNumber'),
    /non-reserved user identifier/,
    `generated WWA sequence counter ${name} must refuse at authoring`,
  );
}
assert.deepEqual(asc('title', { maxEncodedBytes: 8 }), {
  field: 'title', direction: 'Asc', maxEncodedBytes: 8,
});
assert.throws(() => asc('title', { maxEncodedBytes: 0 }), /positive safe integer/);
assert.throws(() => asc('title', { maxEncodedBytes: 8, bytesMaybe: 9 }), /unknown field/);

const sequenceIrDescriptor = buildContractMutationDescriptor({
  name: 'allocateIr',
  args: {},
  argOrder: [],
  writes: ['jobs'],
  plan: { steps: [{ AllocateSequence: {} }], return_value: null },
  sequenceAllocationCount: 1,
});
assert.equal(sequenceIrDescriptor.optimistic, false);
assert.equal(sequenceIrDescriptor.atomicOptimisticWithholding, true);
assert.deepEqual(sequenceIrDescriptor.plan, {
  steps: [{ AllocateSequence: {} }],
  return_value: null,
});
assert.equal(sequenceIrDescriptor.serverRunnable, true);
assert.deepEqual(contractCapabilitiesForMutations({ allocateIr: sequenceIrDescriptor }), {
  optimisticMutations: false,
  derivedOptimisticOverlays: false,
  offlineReplay: true,
});
const sequenceJsDescriptor = buildContractJsMutationDescriptor({
  name: 'allocateJs',
  args: {},
  argOrder: [],
  writes: ['jobs'],
  sequenceCount: 1,
});
assert.equal(sequenceJsDescriptor.optimistic, false);
assert.equal(sequenceJsDescriptor.atomicOptimisticWithholding, true);
assert.equal(sequenceJsDescriptor.plan, undefined);
const ordinaryJsDescriptor = buildContractJsMutationDescriptor({
  name: 'ordinaryJs',
  args: {},
  argOrder: [],
  writes: ['jobs'],
});
assert.equal(ordinaryJsDescriptor.optimistic, false);
assert.equal(ordinaryJsDescriptor.atomicOptimisticWithholding, undefined);

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const dir = mkdtempSync(join(tmpdir(), 'snapback-sequence-authoring-'));
try {
  writeFileSync(join(dir, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  orgs: defineTable({ name: v.string() }).visibility({ kind: 'public-read' }).sync(),
  jobs: defineTable({ orgId: v.id('orgs'), sequence: v.integer(), sequenceLabel: v.string() })
    .visibility({ kind: 'public-read' })
    .sync(),
});
`);
  writeFileSync(join(dir, 'functions.mjs'), `
import { asc, defineJsMutation, defineQuery, results, v } from '${defineUrl}';
export const orderedJobs = defineQuery({
  table: 'jobs',
  order: [asc('sequenceLabel', { maxEncodedBytes: 8 })],
});
export const createJob = defineJsMutation({
  args: { orgId: v.id('orgs') },
  writes: ['jobs'],
  sequences: [{ name: 'jobNumber', scopeTable: 'orgs', scopeAccess: 'public.v1' }],
  result: results.value(v.object({ sequence: v.integer() })),
  handler: async (ctx, args) => ({ sequence: await ctx.sequence.allocate('jobNumber', args.orgId) }),
});
`);
  const generated = await generate(dir);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const functionsManifest = JSON.parse(
    readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'),
  );
  const createJob = functionsManifest.functions.find((entry) => entry.name === 'createJob');
  assert.deepEqual(createJob.sequences, declaration.map((entry) => ({
    name: entry.name,
    scopeTable: entry.scopeTable,
    scopeAccess: 'public.v1',
  })));
  assert.ok(
    createJob.requiredCapabilities.includes('sequence_allocation_v1'),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// The A6 operations-ledger app is the brownfield acceptance fixture that
// motivated this primitive. Inspect and attempt its retained source so a
// regression to the old org.jobSeq read/patch cannot hide in historical demo
// prose or generated artifacts.
const a6Source = resolve(
  packageRoot,
  '../../demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback',
);
const a6Dir = mkdtempSync(join(tmpdir(), 'snapback-sequence-a6-'));
try {
  for (const file of ['schema.mjs', 'functions.mjs']) {
    const source = readFileSync(join(a6Source, file), 'utf8')
      .replace("'@expo/snapback-codegen/define'", `'${defineUrl}'`);
    writeFileSync(join(a6Dir, file), source);
  }
  writeFileSync(join(a6Dir, 'seed.json'), readFileSync(join(a6Source, 'seed.json')));
  const previousOutbound = process.env.SNAPBACK_OUTBOUND_ACTIONS;
  process.env.SNAPBACK_OUTBOUND_ACTIONS = '1';
  const generated = await generate(a6Dir);
  if (previousOutbound === undefined) delete process.env.SNAPBACK_OUTBOUND_ACTIONS;
  else process.env.SNAPBACK_OUTBOUND_ACTIONS = previousOutbound;
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const generatedFunctions = JSON.parse(
    readFileSync(join(a6Dir, 'generated', 'functions.manifest.json'), 'utf8'),
  );
  const createJob = generatedFunctions.functions.find((entry) => entry.name === 'createJob');
  assert.ok(
    createJob.requiredCapabilities.includes('sequence_allocation_v1'),
    'A6 consumes the target-owned Experimental publication',
  );
  const createJobSource = readFileSync(join(a6Source, 'functions.mjs'), 'utf8');
  assert.match(
    createJobSource,
    /ctx\.sequence\.allocate\(['"]jobNumber['"],\s*args\.orgId\)/,
  );
  assert.doesNotMatch(createJobSource, /jobSeq\s*\+\s*1/);
} finally {
  rmSync(a6Dir, { recursive: true, force: true });
}

console.log('sequence-authoring.test.mjs: declaration, v3 identity, and capability checks passed');
