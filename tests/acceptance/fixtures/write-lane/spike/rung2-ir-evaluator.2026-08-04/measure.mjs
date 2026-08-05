#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

import { build, version as esbuildVersion } from 'esbuild';

import { CALENDAR_RESERVE_PLAN } from './calendar-fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../../..');
const CLIENT_DIR = resolve(ROOT, 'packages/snapback-client');
const EVALUATOR_PATH = resolve(CLIENT_DIR, 'ir-evaluator.mjs');
const STORE_PATH = resolve(CLIENT_DIR, 'materialization-store.mjs');
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const evaluatorSource = await readFile(EVALUATOR_PATH, 'utf8');

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  assert.notEqual(first, -1, `missing source transform anchor: ${label}`);
  assert.equal(source.indexOf(before, first + before.length), -1, `duplicate source transform anchor: ${label}`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

const SEQUENCE_HELPER = `
const MAX_SEQUENCE_CLAIMS = 1_024;

const prepareSequenceClaimLedger = (input) => {
  const claims = cloneTransportValue(input ?? []);
  if (!Array.isArray(claims) || claims.length > MAX_SEQUENCE_CLAIMS) {
    fail('SNAPBACK_SEQUENCE_CLAIM_LIMIT_EXCEEDED', 'sequence claim ledger exceeds spike bounds');
  }
  for (const claim of claims) {
    if (
      claim === null
      || typeof claim !== 'object'
      || Array.isArray(claim)
      || typeof claim.counter !== 'string'
      || claim.counter.length === 0
      || claim.counter.length > 256
      || typeof claim.scope !== 'string'
      || claim.scope.length === 0
      || claim.scope.length > 256
      || !Number.isSafeInteger(claim.value)
      || claim.value < 1
    ) {
      fail('SNAPBACK_SEQUENCE_CLAIM_INVALID', 'sequence claim ledger contains an invalid entry');
    }
  }
  let cursor = 0;
  return {
    next(counter, scope) {
      const claim = claims[cursor];
      if (claim === undefined) {
        fail('SNAPBACK_SEQUENCE_CLAIM_EXHAUSTED', 'sequence claim ledger is exhausted');
      }
      if (claim.counter !== counter || claim.scope !== scope) {
        fail('SNAPBACK_SEQUENCE_CLAIM_MISMATCH', 'sequence claim does not match its IR site');
      }
      cursor += 1;
      return claim.value;
    },
    finish() {
      if (cursor !== claims.length) {
        fail('SNAPBACK_SEQUENCE_CLAIM_UNUSED', 'sequence claim ledger has unused entries');
      }
      return claims;
    },
  };
};
`;

function variantSource(verbs) {
  const verbSet = new Set(verbs);
  const ordered = ['AllocateSequence', 'Delete', 'Let'].filter((verb) => verbSet.has(verb));
  const classSuffix = ordered.map((verb) => `-${verb.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`).join('');
  let source = replaceOnce(
    evaluatorSource,
    "  'snapback.browser-ir.insert-get-guard-patch.v1';",
    `  'snapback.browser-ir.insert-get-guard-patch${classSuffix}.v1';`,
    'effect class',
  );
  source = replaceOnce(
    source,
    "const LOCAL_STEPS = new Set(['Insert', 'Get', 'Guard', 'Patch']);",
    `const LOCAL_STEPS = new Set(${JSON.stringify(['Insert', 'Get', 'Guard', 'Patch', ...ordered])});`,
    'local steps',
  );

  if (!verbSet.has('AllocateSequence')) return source;

  source = replaceOnce(
    source,
    "  'AllocateSequence',\n",
    '',
    'AllocateSequence server-only classification',
  );
  source = replaceOnce(
    source,
    "const expectString = (value, label) => {",
    `${SEQUENCE_HELPER}\nconst expectString = (value, label) => {`,
    'sequence claim helper insertion',
  );
  source = replaceOnce(
    source,
    "  authUserId,\n}) => {",
    "  authUserId,\n  sequenceClaims,\n}) => {",
    'sequence claim input',
  );
  source = replaceOnce(
    source,
    "    const ledger = prepareLedger(inputCtxLedger);\n    const steps = admittedPlan?.steps;",
    "    const ledger = prepareLedger(inputCtxLedger);\n    const sequenceClaimLedger = prepareSequenceClaimLedger(sequenceClaims);\n    const steps = admittedPlan?.steps;",
    'sequence claim preparation',
  );
  source = replaceOnce(
    source,
    "      if (kind === 'Insert') {",
    `      if (kind === 'AllocateSequence') {
        const scope = expectString(evalValueExpr(body.scope, environment), 'sequence scope');
        bindings.set(body.into, sequenceClaimLedger.next(body.counter, scope));
      } else if (kind === 'Insert') {`,
    'AllocateSequence execution branch',
  );
  source = replaceOnce(
    source,
    "    const outputCtxLedger = ledger.finish();\n    return {",
    "    const outputCtxLedger = ledger.finish();\n    const outputSequenceClaims = sequenceClaimLedger.finish();\n    return {",
    'sequence claim exact consumption',
  );
  source = replaceOnce(
    source,
    "        outputCtxLedger: canonicalValue(outputCtxLedger),\n        rejectionCode: null,",
    "        outputCtxLedger: canonicalValue(outputCtxLedger),\n        sequenceClaims: canonicalValue(outputSequenceClaims),\n        rejectionCode: null,",
    'sequence claim outcome',
  );
  source = replaceOnce(
    source,
    "    outputCtxLedger: evaluated.outcome.outputCtxLedger,\n  });",
    "    outputCtxLedger: evaluated.outcome.outputCtxLedger,\n    sequenceClaims: evaluated.outcome.sequenceClaims ?? null,\n  });",
    'sequence claim label',
  );
  return source;
}

const variants = [
  { id: 'rung1-current', verbs: [] },
  { id: 'candidate-allocate-sequence', verbs: ['AllocateSequence'] },
  { id: 'candidate-delete', verbs: ['Delete'] },
  { id: 'candidate-let', verbs: ['Let'] },
  { id: 'cumulative-allocate-sequence-delete', verbs: ['AllocateSequence', 'Delete'] },
  { id: 'cumulative-allocate-sequence-delete-let', verbs: ['AllocateSequence', 'Delete', 'Let'] },
].map((variant) => ({ ...variant, source: variantSource(variant.verbs) }));
const variantById = new Map(variants.map((variant) => [variant.id, variant]));

const plugin = {
  name: 'rung2-in-memory-evaluator-variants',
  setup(builder) {
    builder.onResolve({ filter: /^rung2-variant:/ }, (args) => ({
      path: args.path.slice('rung2-variant:'.length),
      namespace: 'rung2-variant',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'rung2-variant' }, (args) => {
      const variant = variantById.get(args.path);
      assert(variant, `unknown evaluator variant ${args.path}`);
      return {
        contents: variant.source,
        loader: 'js',
        resolveDir: CLIENT_DIR,
      };
    });
  },
};

function entrySource(variantId, withStore) {
  const store = withStore
    ? "import * as store from '../../../../../../packages/snapback-client/materialization-store.mjs'; export { store }; "
    : '';
  return `${store}export { BROWSER_IR_LOCAL_EFFECT_CLASS, classifyLocalMutationIrV1, evaluateLocalMutationIrV1 } from 'rung2-variant:${variantId}';`;
}

async function bundle(profile) {
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
    plugins: [plugin],
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
    variant: profile.variant ?? null,
    verbs: profile.verbs ?? [],
    entrySha256: sha256(profile.source),
    variantSourceSha256: profile.variant === undefined
      ? null
      : sha256(variantById.get(profile.variant).source),
    minifiedBytes: output.byteLength,
    gzipBytes: gzipSync(output, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(output, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
    outputSha256: sha256(output),
    modules,
    output,
  };
}

const profiles = [{
  id: 'landed-materialization-store-all-exports',
  source: "import * as value from '../../../../../../packages/snapback-client/materialization-store.mjs'; export { value };",
}];
for (const variant of variants) {
  profiles.push({
    id: `${variant.id}-used-entry`,
    variant: variant.id,
    verbs: variant.verbs,
    source: entrySource(variant.id, false),
  });
  profiles.push({
    id: `landed-store-plus-${variant.id}-used-entry`,
    variant: variant.id,
    verbs: variant.verbs,
    source: entrySource(variant.id, true),
  });
}

const measuredWithOutput = [];
for (const profile of profiles) measuredWithOutput.push(await bundle(profile));

const verifiedVariants = [];
for (const variant of variants) {
  const measured = measuredWithOutput.find((profile) => profile.id === `${variant.id}-used-entry`);
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(measured.output).toString('base64')}`;
  const evaluator = await import(moduleUrl);
  const common = {
    name: variant.id,
    schema: {
      tables: [{
        name: 'reservations',
        fields: [{ name: 'ordinal', field_type: 'Integer', optional: true }],
        indexes: [],
        syncable: true,
      }],
    },
    initialRows: { reservations: [{ _id: 'existing', ordinal: 1 }] },
    args: { id: 'existing', scope: 'room-00' },
    ctxLedger: { version: 1, ids: [], now: 1_787_000_000_000 },
    declaredEffectClass: evaluator.BROWSER_IR_LOCAL_EFFECT_CLASS,
    readAdmission: 'ready',
    layerId: `layer-${variant.id}`,
  };
  for (const verb of variant.verbs) {
    let plan;
    let extra = {};
    if (verb === 'Delete') {
      plan = { steps: [{ Delete: { table: 'reservations', id: { Arg: 'id' } } }], return_value: 'ChangedCount' };
    } else if (verb === 'Let') {
      plan = { steps: [{ Let: { bind_as: 'value', expr: { Literal: 7 } } }], return_value: { Binding: 'value' } };
    } else {
      plan = {
        steps: [{ AllocateSequence: { counter: 'reservationOrdinal', scope: { Arg: 'scope' }, into: 'ordinal' } }],
        return_value: { Binding: 'ordinal' },
      };
      extra = { sequenceClaims: [{ counter: 'reservationOrdinal', scope: 'room-00', value: 7 }] };
    }
    const outcome = evaluator.evaluateLocalMutationIrV1({ ...common, ...extra, plan });
    assert.equal(outcome.classification, 'ready', `${variant.id} did not admit ${verb}`);
    assert.equal(outcome.execution.status, 'committed', `${variant.id} did not execute ${verb}`);
  }
  verifiedVariants.push({ id: variant.id, verbs: variant.verbs, assertions: variant.verbs.length });
}

const inputFiles = [
  'tests/acceptance/fixtures/write-lane/spike/rung2-ir-evaluator.2026-08-04/calendar-fixture.mjs',
  'packages/snapback-client/ir-evaluator.mjs',
  'packages/snapback-client/materialization-store.mjs',
  'demos/zero-bakeoff/protocol/acceptance/contention-calendar.v1.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/functions.mjs',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/src/App.tsx',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/tests/acceptance.mjs',
  'llp/0129-local-first-program.plan.md',
  'llp/0133-local-settlement.spec.md',
];
const inputs = [];
for (const path of inputFiles) {
  const contents = await readFile(resolve(ROOT, path));
  inputs.push({ path, sha256: sha256(contents) });
}

const measured = measuredWithOutput.map(({ output: _output, ...profile }) => profile);
const calendarStepKinds = CALENDAR_RESERVE_PLAN.steps.map((step) => Object.keys(step)[0]);
console.log(JSON.stringify({
  schemaVersion: 'snapback.rung2-ir-evaluator-sizing-spike.v1',
  date: '2026-08-04',
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
    sourceMethod: 'in-memory exact-anchor transforms over the shipping evaluator; no shipping file written',
  },
  inputs,
  workloadInventory: {
    witness: 'contention-calendar common-path reserve',
    stepKinds: calendarStepKinds,
    counts: Object.fromEntries(
      ['Insert', 'AllocateSequence', 'Delete', 'Let'].map((kind) => [
        kind,
        calendarStepKinds.filter((candidate) => candidate === kind).length,
      ]),
    ),
  },
  variantBoundary: {
    AllocateSequence: 'bounded typed sequence-claim skeleton for sizing only; not an admitted input contract',
    Delete: 'activate the shipping D5 Delete branch in the local effect classifier',
    Let: 'activate the shipping D5 Let branch in the local effect classifier',
  },
  verifiedVariants,
  profiles: measured,
}, null, 2));
