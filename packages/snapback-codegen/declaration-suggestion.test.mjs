import assert from 'node:assert/strict';
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
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  applyDeclarationSuggestion,
  DECLARATION_SUGGESTION_REASON_CODES,
  suggestDeclarations,
} from './declaration-suggestion.mjs';
import { generate } from './index.mjs';
import {
  defaultVerifyConfig,
  runVerify,
  writeVerifyReceipt,
} from '../snapback-cli/verify.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(packageRoot, 'declaration-suggestion.schema.json'), 'utf8'));
const validateProtocol = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const verifyReceiptSchema = JSON.parse(readFileSync(join(packageRoot, '..', 'snapback-cli', 'verify-receipt.schema.json'), 'utf8'));
const validateVerifyReceipt = new Ajv2020({ allErrors: true, strict: false }).compile(verifyReceiptSchema);
const roots = [];
let assertions = 0;
const check = (value, message) => {
  assertions += 1;
  assert(value, message);
};
const equal = (actual, expected, message) => {
  assertions += 1;
  assert.equal(actual, expected, message);
};
const deepEqual = (actual, expected, message) => {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
};

function fixture({ explicitStoredResult = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'snapback-declaration-suggestion-'));
  roots.push(root);
  const appRoot = join(root, 'app');
  const backend = join(appRoot, 'snapback');
  mkdirSync(backend, { recursive: true });
  writeFileSync(join(appRoot, 'demo.snapback.json'), JSON.stringify({ id: 'suggestion-golden' }));
  const modules = join(appRoot, 'node_modules', '@expo');
  mkdirSync(modules, { recursive: true });
  symlinkSync(packageRoot, join(modules, 'snapback-codegen'), 'dir');
  writeFileSync(join(backend, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';
export default defineSchema({
  todos: defineTable({ title: v.string(), completed: v.boolean() }).sync().visibility({ kind: 'public-read' }),
  secrets: defineTable({ value: v.string() }).visibility({ kind: 'public-read' }),
  audit: defineTable({ value: v.string() }).visibility({ kind: 'public-read' }),
});
`);
  const storedResult = explicitStoredResult
    ? '  result: results.records(v.object({ "doc": v.doc("todos"), "computed": v.boolean() })),\n'
    : '';
  writeFileSync(join(backend, 'functions.mjs'), `
import { defineJsMutation, defineJsQuery, v${explicitStoredResult ? ', results' : ''} } from '@expo/snapback-codegen/define';
export const storedWithComputed = defineJsQuery({
  args: { id: v.id('todos') },
  reads: ['todos'],
${storedResult}  handler: async (ctx, args) => {
    const doc = await ctx.db.get('todos', args.id);
    return doc ? [{ doc, computed: true }] : [];
  },
});
export const anyResult = defineJsMutation({
  args: {},
  writes: ['todos'],
  source: 'handlers.ts',
  exportName: 'anyResult',
});
export const recursiveResult = defineJsMutation({
  args: {},
  writes: ['todos'],
  source: 'handlers.ts',
  exportName: 'recursiveResult',
});
export const literalResult = defineJsMutation({
  args: {},
  writes: ['todos'],
  handler: async () => true,
});
export const optionalNullable = defineJsMutation({
  args: {},
  writes: ['todos'],
  source: 'handlers.ts',
  exportName: 'optionalNullable',
});
export const primitiveTupleQuery = defineJsQuery({
  args: {},
  reads: ['todos'],
  source: 'handlers.ts',
  exportName: 'primitiveTupleQuery',
});
`);
  writeFileSync(join(backend, 'handlers.ts'), `
interface RecursiveNode {
  ok: true;
  next?: RecursiveNode;
}
globalThis.__snapbackHandlers = {
  async anyResult(): Promise<any> {
    return { ok: true };
  },
  async recursiveResult(): Promise<RecursiveNode> {
    return { ok: true };
  },
  async optionalNullable(): Promise<{ maybe?: true | null }> {
    return { maybe: null };
  },
  async primitiveTupleQuery(): Promise<readonly [true]> {
    return [true] as const;
  },
};
`);
  return backend;
}

function onlySuggestion(backend, operation) {
  const result = suggestDeclarations({ backendDir: backend, operation });
  equal(result.ok, true, JSON.stringify(result.diagnostics));
  equal(result.suggestions.length, 1);
  return { result, suggestion: result.suggestions[0] };
}

function resultHash(backend, name) {
  const manifest = JSON.parse(readFileSync(join(backend, 'generated', 'functions.manifest.json'), 'utf8'));
  return manifest.functions.find((entry) => entry.name === name).resultContractHash;
}

function generatedIdentity(backend) {
  const functions = JSON.parse(readFileSync(join(backend, 'generated', 'functions.manifest.json'), 'utf8'));
  const schemaManifest = JSON.parse(readFileSync(join(backend, 'generated', 'schema.manifest.json'), 'utf8'));
  return {
    appId: functions.appId,
    schemaVersion: functions.schemaVersion,
    schemaHash: schemaManifest.schemaHash,
    bundleHash: functions.bundleHash,
    inputsHash: functions.inputsHash,
  };
}

function writeRuntimeReceipt(backend, {
  functionName = 'storedWithComputed',
  pathId = 'runtime-path',
  nullFunctionId = false,
  missingReads = [],
  missingWrites = [],
  extraReads = [],
  extraWrites = [],
  noRegisteredPaths = false,
} = {}) {
  const functions = JSON.parse(readFileSync(join(backend, 'generated', 'functions.manifest.json'), 'utf8'));
  const functionId = functions.functions.find(({ name }) => name === functionName).id;
  const receiptFunctionId = nullFunctionId ? null : functionId;
  const limitationReason = 'repository acceptance suites have no universal D1 path-evidence registry in v0';
  const report = {
    missingReads,
    missingWrites,
    extraReads,
    extraWrites,
    readProvenance: 'complete',
    writeProvenance: 'complete',
  };
  const underDeclarations = missingReads.length === 0 && missingWrites.length === 0 ? [] : [{
    profileId: 'runtime-profile',
    pathId,
    functionId: receiptFunctionId,
    missingReads,
    missingWrites,
  }];
  const overDeclarations = extraReads.length === 0 && extraWrites.length === 0 ? [] : [{
    functionId,
    completeObservedPaths: { reads: 1, writes: 1 },
    extraReads,
    extraWrites,
    severity: 'warning',
  }];
  const aggregate = noRegisteredPaths ? {
    status: 'not-claimed',
    disposition: 'no-registered-acceptance-paths',
    scope: 'registered-or-repository-adapted-paths',
    limitationReason,
    complete: false,
    expectedPaths: 0,
    observedPaths: 0,
    pathEvidence: [],
    underDeclarations: [],
    overDeclarations: [],
    diagnostics: [],
  } : {
    status: underDeclarations.length > 0 ? 'failed' : 'passed',
    disposition: 'registered-path-aggregate-v0',
    scope: 'registered-or-repository-adapted-paths',
    limitationReason,
    complete: true,
    expectedPaths: 1,
    observedPaths: 1,
    authoritativePaths: 1,
    partialPaths: 0,
    pathEvidence: [{
      profileId: 'runtime-profile',
      id: pathId,
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      functionId: receiptFunctionId,
      status: 'authoritative',
      report,
    }],
    underDeclarations,
    overDeclarations,
    diagnostics: [],
  };
  const admissionStatus = underDeclarations.length > 0 ? 'failed' : 'passed';
  const testBytes = {
    algorithm: 'sha256-path-length-content.v1',
    sha256: `sha256:${'a'.repeat(64)}`,
    bytes: 0,
    files: [],
  };
  const context = {
    target: { kind: 'local-generated-artifact', identity: generatedIdentity(backend).inputsHash },
    data: { kind: 'sqlite-fixture', identity: `sha256:${'b'.repeat(64)}` },
    authority: { kind: 'dev-asserted', identity: 'actor-1', principalClass: 'dev' },
    seed: { kind: 'authored-seed-bytes', identity: `sha256:${'c'.repeat(64)}` },
  };
  const acceptanceProfiles = noRegisteredPaths ? [] : [{
    profileId: 'runtime-profile',
    title: 'runtime profile',
    status: 'passed',
    startedAtMs: 1,
    finishedAtMs: 2,
    durationMs: 1,
    testBytes,
    context,
    conformance: [{ pathId, status: 'observed', report }],
    diagnostics: [],
  }];
  const stage = (id, status, evidence) => ({ id, status, diagnostics: [], evidence });
  const receipt = {
    artifactKind: 'snapbackVerifyReceipt',
    schemaVersion: 'snapback.verify-receipt.v1',
    ok: admissionStatus === 'passed',
    status: admissionStatus === 'passed'
      ? noRegisteredPaths ? 'passed-without-acceptance' : 'passed'
      : 'failed',
    startedAtMs: 1,
    finishedAtMs: 2,
    durationMs: 1,
    profileSet: {
      ids: noRegisteredPaths ? [] : ['runtime-profile'],
      identity: `sha256:${'d'.repeat(64)}`,
      testBytes,
    },
    context,
    stages: [
      stage('artifact-freshness', 'passed', { identity: generatedIdentity(backend) }),
      stage('runtime-readiness', 'passed', {}),
      stage('admission-and-conformance', admissionStatus, {
        admissionMode: 'generated-artifact-local-admission',
        servedTarget: null,
        conformance: aggregate,
      }),
      stage('capability-resolution', 'passed', {}),
      stage('acceptance-profiles', 'passed', { profiles: acceptanceProfiles }),
    ],
    acceptanceProfiles,
    next: admissionStatus === 'passed' ? [] : [{
      code: 'SNAPBACK_VERIFY_FIX_ADMISSION_OR_COVERAGE',
      command: null,
      instruction: 'fix the under-declaration',
      reason: 'registered runtime path witnessed an undeclared dependency',
    }],
    nonclaims: [
      'registered contract is not product completion',
      'unregistered paths are not covered',
      'local admission is not live admission',
      'semantic review is not performed',
    ],
  };
  check(validateVerifyReceipt(receipt), JSON.stringify(validateVerifyReceipt.errors));
  const receiptDirectory = join(dirname(backend), '.snapback');
  mkdirSync(receiptDirectory, { recursive: true });
  const path = join(receiptDirectory, 'verify-receipt.json');
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
  return { path, receipt, functionId };
}

async function writeProducedRuntimeReceipt(backend, {
  functionName = 'literalResult',
  missingReads = [],
  missingWrites = [],
} = {}) {
  const identity = generatedIdentity(backend);
  const functions = JSON.parse(readFileSync(join(backend, 'generated', 'functions.manifest.json'), 'utf8'));
  const pathId = functionName.replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  const report = {
    missingReads,
    missingWrites,
    extraReads: [],
    extraWrites: [],
    readProvenance: 'complete',
    writeProvenance: 'complete',
  };
  const context = {
    target: { kind: 'local-generated-artifact', identity: identity.inputsHash },
    data: { kind: 'sqlite-fixture', identity: `sha256:${'b'.repeat(64)}` },
    authority: { kind: 'dev-asserted', identity: 'actor-1', principalClass: 'dev' },
    seed: { kind: 'authored-seed-bytes', identity: `sha256:${'c'.repeat(64)}` },
  };
  const profile = Object.freeze({
    id: 'runtime-profile',
    title: 'runtime profile',
    testFiles: Object.freeze([fileURLToPath(import.meta.url)]),
    requiredCapabilities: Object.freeze([]),
    paths: Object.freeze([Object.freeze({
      id: pathId,
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      functionId: null,
    })]),
    async run() {
      return {
        ok: true,
        context,
        conformance: [{ pathId, status: 'observed', report }],
        diagnostics: [],
      };
    },
  });
  const receipt = await runVerify(Object.freeze({
    ...defaultVerifyConfig({ backendDirectory: backend }),
    context: Object.freeze(context),
    profiles: Object.freeze([profile]),
  }), {
    artifactProbe: async () => ({
      ok: true,
      identity,
      seedIdentity: context.seed,
      generatedRoot: join(backend, 'generated'),
      manifests: {
        capability: { targetProfileId: 'local-dev-sqlite-ibex' },
        functions,
      },
      diagnostics: [],
    }),
    runtimeProbe: async () => ({ ok: true, receipt: { digest: 'runtime-ready' }, diagnostics: [] }),
    admissionProbe: async () => ({ ok: true, mode: 'generated-artifact-local-admission', diagnostics: [] }),
    capabilityProbe: async () => ({
      ok: true,
      targetProfileId: 'local-dev-sqlite-ibex',
      required: [],
      supported: [],
      missing: [],
      diagnostics: [],
    }),
    now: (() => { let now = 10; return () => ++now; })(),
  });
  const receiptPath = join(dirname(backend), '.snapback', 'verify-receipt.json');
  writeVerifyReceipt(receiptPath, receipt);
  return {
    path: receiptPath,
    receipt,
    functionId: functions.functions.find(({ name }) => name === functionName).id,
  };
}

async function writeProducedBlockedReceipt(backend) {
  const identity = generatedIdentity(backend);
  const context = {
    target: { kind: 'local-generated-artifact', identity: identity.inputsHash },
    data: { kind: 'not-exercised', identity: 'blocked-data' },
    authority: { kind: 'dev-asserted', identity: 'actor-1', principalClass: 'dev' },
    seed: { kind: 'not-exercised', identity: null },
  };
  const receipt = await runVerify(Object.freeze({
    ...defaultVerifyConfig({ backendDirectory: backend }),
    context: Object.freeze(context),
    profiles: Object.freeze([]),
  }), {
    artifactProbe: async () => ({ ok: false, diagnostics: [] }),
    now: (() => { let now = 20; return () => ++now; })(),
  });
  const receiptPath = join(dirname(backend), '.snapback', 'verify-receipt.json');
  writeVerifyReceipt(receiptPath, receipt);
  return { path: receiptPath, receipt };
}

async function writeMainEraBlockedZeroPathReceipt(backend) {
  const produced = await writeProducedBlockedReceipt(backend);
  const receipt = structuredClone(produced.receipt);
  // Byte-for-byte producer reconstruction from the pre-fix main tree at
  // 34d98f4890fa88a8bc144e259974619fd1fb9654: runVerify() used this property
  // order for its blocked fallback and writeVerifyReceipt() serialized it as
  // two-space JSON plus one trailing newline.
  receipt.stages[2].evidence.conformance = {
    status: 'blocked', disposition: 'upstream-stage-failed', complete: false,
    scope: 'explicitly-registered-paths-only',
    limitationReason: 'repository acceptance suites have no universal D1 path-evidence registry in v0',
    expectedPaths: 0, observedPaths: 0,
    pathEvidence: [], underDeclarations: [], overDeclarations: [], diagnostics: [],
  };
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  writeFileSync(produced.path, bytes);
  return { path: produced.path, receipt, bytes };
}

try {
  const golden = fixture();
  const primed = await generate(golden);
  equal(primed.ok, true, JSON.stringify(primed.diagnostics));

  const all = suggestDeclarations({ backendDir: golden });
  equal(all.ok, true, JSON.stringify(all.diagnostics));
  equal(validateProtocol(all), true, JSON.stringify(validateProtocol.errors));
  deepEqual(DECLARATION_SUGGESTION_REASON_CODES, schema.$defs.reasonCode.enum);

  const stored = all.suggestions.find(({ operation }) => operation.name === 'storedWithComputed');
  equal(stored.status, 'schema-derived', JSON.stringify(stored));
  equal(
    stored.declaration.after,
    'result: results.records(v.object({ "doc": v.doc("todos"), "computed": v.boolean() }))',
  );
  check(stored.evidence.some(({ contractExpression }) => contractExpression === 'v.doc("todos")'));
  check(stored.evidence.some(({ confidence }) => confidence === 'schema-derived'));

  const any = all.suggestions.find(({ operation }) => operation.name === 'anyResult');
  equal(any.status, 'holed');
  equal(any.declaration.after, null);
  equal(any.holes[0].code, 'SNAPBACK_AUTHORING_RETURN_ANY_UNRESOLVED');
  check(!JSON.stringify(any).includes('result: any'), 'an any return must never produce an any contract');

  const recursive = all.suggestions.find(({ operation }) => operation.name === 'recursiveResult');
  equal(recursive.status, 'refused');
  equal(recursive.diagnostics[0].code, 'SNAPBACK_AUTHORING_RECURSIVE_RETURN_UNSUPPORTED');

  const optionalNullable = all.suggestions.find(({ operation }) => operation.name === 'optionalNullable');
  equal(optionalNullable.status, 'exact');
  check(optionalNullable.declaration.after.includes('v.optional('));
  check(optionalNullable.declaration.after.includes('v.null()'));

  const primitiveTuple = all.suggestions.find(({ operation }) => operation.name === 'primitiveTupleQuery');
  equal(primitiveTuple.status, 'refused');
  equal(primitiveTuple.diagnostics[0].code, 'SNAPBACK_AUTHORING_RESULT_SHAPE_UNSUPPORTED');

  const applied = applyDeclarationSuggestion(stored);
  equal(applied.ok, true, JSON.stringify(applied.diagnostics));
  equal(validateProtocol(applied), true, JSON.stringify(validateProtocol.errors));
  const generatedAfterApply = await generate(golden);
  equal(generatedAfterApply.ok, true, JSON.stringify(generatedAfterApply.diagnostics));
  const suggestedHash = resultHash(golden, 'storedWithComputed');

  const handwritten = fixture({ explicitStoredResult: true });
  const generatedHandwritten = await generate(handwritten);
  equal(generatedHandwritten.ok, true, JSON.stringify(generatedHandwritten.diagnostics));
  equal(
    suggestedHash,
    resultHash(handwritten, 'storedWithComputed'),
    'suggest/apply must enter the normal result-contract hash path byte-for-byte equivalently',
  );

  const sourceCas = fixture();
  equal((await generate(sourceCas)).ok, true);
  const sourceSuggestion = onlySuggestion(sourceCas, 'storedWithComputed').suggestion;
  const sourcePath = join(sourceCas, 'functions.mjs');
  writeFileSync(sourcePath, `${readFileSync(sourcePath, 'utf8')}\n// concurrent source edit\n`);
  const changedSource = readFileSync(sourcePath);
  const sourceStale = applyDeclarationSuggestion(sourceSuggestion);
  equal(sourceStale.ok, false);
  equal(sourceStale.diagnostics[0].code, 'SNAPBACK_DECLARATION_SUGGESTION_STALE');
  deepEqual(readFileSync(sourcePath), changedSource, 'stale apply changed source bytes');

  const schemaCas = fixture();
  equal((await generate(schemaCas)).ok, true);
  const schemaSuggestion = onlySuggestion(schemaCas, 'storedWithComputed').suggestion;
  const schemaPath = join(schemaCas, 'schema.mjs');
  writeFileSync(schemaPath, `${readFileSync(schemaPath, 'utf8')}\n// concurrent schema edit\n`);
  const schemaSourceBeforeApply = readFileSync(join(schemaCas, 'functions.mjs'));
  const schemaStale = applyDeclarationSuggestion(schemaSuggestion);
  equal(schemaStale.ok, false);
  equal(schemaStale.diagnostics[0].code, 'SNAPBACK_DECLARATION_SUGGESTION_STALE');
  deepEqual(readFileSync(join(schemaCas, 'functions.mjs')), schemaSourceBeforeApply);

  const boundaryCas = fixture();
  equal((await generate(boundaryCas)).ok, true);
  const boundarySuggestion = onlySuggestion(boundaryCas, 'storedWithComputed').suggestion;
  const boundarySourcePath = join(boundaryCas, 'functions.mjs');
  const boundarySourceBeforeApply = readFileSync(boundarySourcePath);
  let boundaryHookCalls = 0;
  const boundaryStale = applyDeclarationSuggestion(boundarySuggestion, {
    testHooks: {
      beforeFinalAnalysis() {
        boundaryHookCalls += 1;
        const boundarySchemaPath = join(boundaryCas, 'schema.mjs');
        writeFileSync(
          boundarySchemaPath,
          `${readFileSync(boundarySchemaPath, 'utf8')}\n// write-boundary schema edit\n`,
        );
      },
    },
  });
  equal(boundaryHookCalls, 1, 'the non-target edit must occur after the temporary file is built');
  equal(boundaryStale.ok, false);
  equal(boundaryStale.diagnostics[0].code, 'SNAPBACK_DECLARATION_SUGGESTION_STALE');
  deepEqual(
    readFileSync(boundarySourcePath),
    boundarySourceBeforeApply,
    'write-boundary stale apply changed target source bytes',
  );

  const compilerCas = fixture();
  equal((await generate(compilerCas)).ok, true);
  const compilerSuggestion = structuredClone(onlySuggestion(compilerCas, 'storedWithComputed').suggestion);
  compilerSuggestion.compiler.effectiveOptions.strict = false;
  const compilerSourceBeforeApply = readFileSync(join(compilerCas, 'functions.mjs'));
  const compilerStale = applyDeclarationSuggestion(compilerSuggestion);
  equal(compilerStale.ok, false);
  equal(compilerStale.diagnostics[0].code, 'SNAPBACK_DECLARATION_SUGGESTION_STALE');
  deepEqual(readFileSync(join(compilerCas, 'functions.mjs')), compilerSourceBeforeApply);

  const cleanCas = fixture();
  equal((await generate(cleanCas)).ok, true);
  const cleanSuggestion = onlySuggestion(cleanCas, 'storedWithComputed').suggestion;
  const cleanApply = applyDeclarationSuggestion(cleanSuggestion);
  equal(cleanApply.ok, true, JSON.stringify(cleanApply.diagnostics));
  check(readFileSync(join(cleanCas, 'functions.mjs'), 'utf8').includes(cleanSuggestion.declaration.after));
  equal((await generate(cleanCas)).ok, true, 'ordinary generation must accept the atomic source write');

  const allOperationsCas = fixture();
  equal((await generate(allOperationsCas)).ok, true);
  const allOperationSuggestions = suggestDeclarations({ backendDir: allOperationsCas });
  equal(allOperationSuggestions.ok, true, JSON.stringify(allOperationSuggestions.diagnostics));
  const laterOperationSuggestion = allOperationSuggestions.suggestions.find(
    ({ operation }) => operation.name === 'literalResult',
  );
  equal(laterOperationSuggestion.status, 'exact');
  const laterOperationApply = applyDeclarationSuggestion(laterOperationSuggestion);
  equal(laterOperationApply.ok, true, JSON.stringify(laterOperationApply.diagnostics));
  equal((await generate(allOperationsCas)).ok, true);

  const runtimeWitnessed = fixture();
  equal((await generate(runtimeWitnessed)).ok, true);
  const producedRuntime = await writeProducedRuntimeReceipt(runtimeWitnessed, {
    functionName: 'literalResult',
    missingReads: ['secrets'],
    missingWrites: ['audit'],
  });
  equal(
    producedRuntime.receipt.stages[2].evidence.conformance.pathEvidence[0].functionId,
    null,
    'the real verify producer must exercise the null-functionId identity join',
  );
  const runtimeSuggestionResult = suggestDeclarations({
    backendDir: runtimeWitnessed,
    operation: 'literalResult',
    runtimeEvidenceReceiptPaths: [producedRuntime.path],
  });
  equal(runtimeSuggestionResult.ok, true, JSON.stringify(runtimeSuggestionResult.diagnostics));
  equal(runtimeSuggestionResult.suggestions.length, 1);
  const [runtimeSuggestion] = runtimeSuggestionResult.suggestions;
  equal(validateProtocol(runtimeSuggestion), true, JSON.stringify(validateProtocol.errors));
  equal(
    runtimeSuggestion.runtimeEvidenceReceipts.length,
    1,
    JSON.stringify(runtimeSuggestionResult.diagnostics),
  );
  equal(runtimeSuggestion.runtimeEvidenceReceipts[0].evidenceClass, 'runtime-witnessed');
  equal(runtimeSuggestion.runtimeEvidenceReceipts[0].aggregate.status, 'failed');
  equal(runtimeSuggestion.runtimeEvidenceReceipts[0].aggregate.scope, 'registered-or-repository-adapted-paths');
  equal(runtimeSuggestion.dependencyChanges.mode, 'addition-only');
  equal(runtimeSuggestion.dependencyChanges.completeSetClaim, false);
  deepEqual(
    runtimeSuggestion.dependencyChanges.additions.map(({ field, table }) => ({ field, table })),
    [{ field: 'reads', table: 'secrets' }, { field: 'writes', table: 'audit' }],
  );
  check(runtimeSuggestion.dependencyChanges.additions.every(({ evidence: [entry] }) => (
    entry.evidenceClass === 'runtime-witnessed'
    && entry.profileId === 'runtime-profile'
    && entry.pathId === 'literal-result'
    && entry.provenance === 'complete'
    && entry.scope === 'registered-or-repository-adapted-paths'
  )));
  check(runtimeSuggestion.patch.unifiedDiff.includes('reads: ["secrets"]'));
  check(runtimeSuggestion.patch.unifiedDiff.includes('writes: ["todos", "audit"]'));
  const runtimeApply = applyDeclarationSuggestion(runtimeSuggestion);
  equal(runtimeApply.ok, true, JSON.stringify(runtimeApply.diagnostics));
  const runtimeAppliedSource = readFileSync(join(runtimeWitnessed, 'functions.mjs'), 'utf8');
  check(runtimeAppliedSource.includes('reads: ["secrets"]'));
  check(runtimeAppliedSource.includes('writes: ["todos", "audit"]'));
  equal((await generate(runtimeWitnessed)).ok, true, 'addition-only dependency patch must enter ordinary generation');

  const alreadyDeclared = fixture({ explicitStoredResult: true });
  equal((await generate(alreadyDeclared)).ok, true);
  writeRuntimeReceipt(alreadyDeclared, {
    functionName: 'storedWithComputed',
    missingReads: ['todos'],
  });
  const declaredSuggestion = onlySuggestion(alreadyDeclared, 'storedWithComputed').suggestion;
  deepEqual(declaredSuggestion.dependencyChanges.additions, []);
  equal(declaredSuggestion.patch, null, 'a runtime witness for an already-declared table must be silent');

  const overDeclared = fixture({ explicitStoredResult: true });
  equal((await generate(overDeclared)).ok, true);
  writeRuntimeReceipt(overDeclared, {
    functionName: 'storedWithComputed',
    extraReads: ['todos'],
  });
  const overSuggestion = onlySuggestion(overDeclared, 'storedWithComputed').suggestion;
  deepEqual(overSuggestion.dependencyChanges.additions, []);
  equal(overSuggestion.patch, null, 'overDeclarations must never produce a removal patch');
  check(!JSON.stringify(overSuggestion).includes('overDeclarations'));
  check(!JSON.stringify(overSuggestion).includes('removal'));

  const noRegisteredPaths = fixture({ explicitStoredResult: true });
  equal((await generate(noRegisteredPaths)).ok, true);
  writeRuntimeReceipt(noRegisteredPaths, { noRegisteredPaths: true });
  const noClaimSuggestion = onlySuggestion(noRegisteredPaths, 'storedWithComputed').suggestion;
  equal(noClaimSuggestion.runtimeEvidenceReceipts[0].aggregate.status, 'not-claimed');
  equal(noClaimSuggestion.runtimeEvidenceReceipts[0].aggregate.scope, 'registered-or-repository-adapted-paths');
  equal(noClaimSuggestion.runtimeEvidenceReceipts[0].aggregate.expectedPaths, 0);
  equal(noClaimSuggestion.dependencyChanges.completeSetClaim, false);
  deepEqual(noClaimSuggestion.dependencyChanges.additions, []);
  equal(noClaimSuggestion.patch, null);

  const blockedConventional = fixture();
  equal((await generate(blockedConventional)).ok, true);
  const blockedProduced = await writeProducedBlockedReceipt(blockedConventional);
  equal(blockedProduced.receipt.stages[2].status, 'blocked');
  equal(blockedProduced.receipt.stages[2].evidence.conformance.status, 'not-claimed');
  equal(blockedProduced.receipt.stages[2].evidence.conformance.expectedPaths, 0);
  const blockedResultOnly = onlySuggestion(blockedConventional, 'literalResult').suggestion;
  deepEqual(blockedResultOnly.runtimeEvidenceReceipts, []);
  check(blockedResultOnly.patch !== null, 'blocked conventional evidence must not suppress a result-only patch');
  check(blockedResultOnly.diagnostics.some(({ code, details }) => (
    code === 'SNAPBACK_AUTHORING_RUNTIME_EVIDENCE_SKIPPED' && details.reason === 'blocked'
  )));

  const mainEraBlockedConventional = fixture();
  equal((await generate(mainEraBlockedConventional)).ok, true);
  const mainEraBlocked = await writeMainEraBlockedZeroPathReceipt(mainEraBlockedConventional);
  deepEqual(readFileSync(mainEraBlocked.path), mainEraBlocked.bytes, 'main-era leftover bytes changed after planting');
  equal(validateVerifyReceipt(mainEraBlocked.receipt), false, 'main-era blocked+0 must retain its pre-fix schema-invalid shape');
  const mainEraResultOnly = onlySuggestion(mainEraBlockedConventional, 'literalResult').suggestion;
  equal(validateProtocol(mainEraResultOnly), true, JSON.stringify(validateProtocol.errors));
  deepEqual(mainEraResultOnly.runtimeEvidenceReceipts, []);
  check(mainEraResultOnly.patch !== null, 'main-era blocked+0 conventional evidence must not suppress a result-only patch');
  check(mainEraResultOnly.diagnostics.some(({ code, details }) => (
    code === 'SNAPBACK_AUTHORING_RUNTIME_EVIDENCE_SKIPPED'
    && details.reason === 'admission-failed'
    && details.cause.includes('does not satisfy')
  )));

  const schemaInvalidConventional = fixture();
  equal((await generate(schemaInvalidConventional)).ok, true);
  const schemaInvalidReceipt = writeRuntimeReceipt(schemaInvalidConventional, { functionName: 'literalResult' });
  delete schemaInvalidReceipt.receipt.artifactKind;
  writeFileSync(schemaInvalidReceipt.path, `${JSON.stringify(schemaInvalidReceipt.receipt, null, 2)}\n`);
  const schemaInvalidResultOnly = onlySuggestion(schemaInvalidConventional, 'literalResult').suggestion;
  equal(validateProtocol(schemaInvalidResultOnly), true, JSON.stringify(validateProtocol.errors));
  deepEqual(schemaInvalidResultOnly.runtimeEvidenceReceipts, []);
  check(schemaInvalidResultOnly.patch !== null, 'schema-invalid conventional evidence must not suppress a result-only patch');
  check(schemaInvalidResultOnly.diagnostics.some(({ code, details }) => (
    code === 'SNAPBACK_AUTHORING_RUNTIME_EVIDENCE_SKIPPED'
    && details.reason === 'admission-failed'
    && details.cause.includes('does not satisfy')
  )));
  const schemaInvalidExplicit = suggestDeclarations({
    backendDir: schemaInvalidConventional,
    operation: 'literalResult',
    runtimeEvidenceReceiptPaths: [schemaInvalidReceipt.path],
  });
  equal(schemaInvalidExplicit.ok, false, 'explicit schema-invalid evidence must remain fail-closed');
  equal(schemaInvalidExplicit.diagnostics[0].code, 'SNAPBACK_AUTHORING_RUNTIME_EVIDENCE_INVALID');

  const staleConventional = fixture();
  equal((await generate(staleConventional)).ok, true);
  const staleReceipt = writeRuntimeReceipt(staleConventional, { functionName: 'literalResult' });
  staleReceipt.receipt.stages[0].evidence.identity.inputsHash = 'stale-generated-inputs';
  writeFileSync(staleReceipt.path, `${JSON.stringify(staleReceipt.receipt, null, 2)}\n`);
  const staleResultOnly = onlySuggestion(staleConventional, 'literalResult').suggestion;
  deepEqual(staleResultOnly.runtimeEvidenceReceipts, []);
  check(staleResultOnly.patch !== null, 'stale conventional evidence must not suppress a result-only patch');
  check(staleResultOnly.diagnostics.some(({ code, details }) => (
    code === 'SNAPBACK_AUTHORING_RUNTIME_EVIDENCE_SKIPPED'
    && details.reason === 'artifact-identity-mismatch'
    && details.mismatches.includes('inputsHash')
  )));
  const explicitStale = suggestDeclarations({
    backendDir: staleConventional,
    operation: 'literalResult',
    runtimeEvidenceReceiptPaths: [staleReceipt.path],
  });
  equal(explicitStale.ok, false, 'explicit evidence must remain fail-closed for the apply CAS');
  equal(explicitStale.diagnostics[0].code, 'SNAPBACK_AUTHORING_RUNTIME_EVIDENCE_INVALID');

  const plantedNoClaim = fixture({ explicitStoredResult: true });
  equal((await generate(plantedNoClaim)).ok, true);
  const planted = writeRuntimeReceipt(plantedNoClaim, { noRegisteredPaths: true });
  const plantedAggregate = planted.receipt.stages[2].evidence.conformance;
  plantedAggregate.pathEvidence.push({
    profileId: 'runtime-profile',
    id: 'stored-with-computed',
    kind: 'success',
    targetProfileId: 'local-dev-sqlite-ibex',
    functionId: null,
    status: 'authoritative',
    report: {
      missingReads: ['secrets'],
      missingWrites: [],
      extraReads: [],
      extraWrites: [],
      readProvenance: 'complete',
      writeProvenance: 'complete',
    },
  });
  plantedAggregate.underDeclarations.push({
    profileId: 'runtime-profile',
    pathId: 'stored-with-computed',
    functionId: null,
    missingReads: ['secrets'],
    missingWrites: [],
  });
  writeFileSync(planted.path, `${JSON.stringify(planted.receipt, null, 2)}\n`);
  const plantedRefusal = suggestDeclarations({
    backendDir: plantedNoClaim,
    operation: 'storedWithComputed',
    runtimeEvidenceReceiptPaths: [planted.path],
  });
  equal(plantedRefusal.ok, false, 'not-claimed evidence must never project planted additions');
  equal(plantedRefusal.diagnostics[0].code, 'SNAPBACK_AUTHORING_RUNTIME_EVIDENCE_INVALID');

  const pathCountMismatch = fixture();
  equal((await generate(pathCountMismatch)).ok, true);
  const mismatchedPathCount = writeRuntimeReceipt(pathCountMismatch, {
    functionName: 'literalResult',
    missingReads: ['secrets'],
  });
  mismatchedPathCount.receipt.stages[2].evidence.conformance.expectedPaths = 2;
  writeFileSync(mismatchedPathCount.path, `${JSON.stringify(mismatchedPathCount.receipt, null, 2)}\n`);
  const pathCountRefusal = suggestDeclarations({
    backendDir: pathCountMismatch,
    operation: 'literalResult',
    runtimeEvidenceReceiptPaths: [mismatchedPathCount.path],
  });
  equal(pathCountRefusal.ok, false);
  check(pathCountRefusal.diagnostics[0].details.cause.includes('pathEvidence length'));

  const evidenceCountMismatch = fixture();
  equal((await generate(evidenceCountMismatch)).ok, true);
  const mismatchedEvidenceCount = writeRuntimeReceipt(evidenceCountMismatch, {
    functionName: 'literalResult',
    missingReads: ['secrets'],
  });
  mismatchedEvidenceCount.receipt.stages[2].evidence.conformance.authoritativePaths = 0;
  writeFileSync(mismatchedEvidenceCount.path, `${JSON.stringify(mismatchedEvidenceCount.receipt, null, 2)}\n`);
  const evidenceCountRefusal = suggestDeclarations({
    backendDir: evidenceCountMismatch,
    operation: 'literalResult',
    runtimeEvidenceReceiptPaths: [mismatchedEvidenceCount.path],
  });
  equal(evidenceCountRefusal.ok, false);
  check(evidenceCountRefusal.diagnostics[0].details.cause.includes('counts'));

  const derivedEvidenceMismatch = fixture();
  equal((await generate(derivedEvidenceMismatch)).ok, true);
  const mismatchedDerivedEvidence = writeRuntimeReceipt(derivedEvidenceMismatch, {
    functionName: 'literalResult',
    missingReads: ['secrets'],
  });
  mismatchedDerivedEvidence.receipt.stages[2].evidence.conformance.underDeclarations[0].missingReads = ['secrets', 'audit'];
  writeFileSync(mismatchedDerivedEvidence.path, `${JSON.stringify(mismatchedDerivedEvidence.receipt, null, 2)}\n`);
  const derivedEvidenceRefusal = suggestDeclarations({
    backendDir: derivedEvidenceMismatch,
    operation: 'literalResult',
    runtimeEvidenceReceiptPaths: [mismatchedDerivedEvidence.path],
  });
  equal(derivedEvidenceRefusal.ok, false);
  check(derivedEvidenceRefusal.diagnostics[0].details.cause.includes('not derived from pathEvidence'));

  const unorderedStages = fixture();
  equal((await generate(unorderedStages)).ok, true);
  const unorderedReceipt = writeRuntimeReceipt(unorderedStages, { functionName: 'literalResult' });
  [unorderedReceipt.receipt.stages[0], unorderedReceipt.receipt.stages[1]] = [
    unorderedReceipt.receipt.stages[1],
    unorderedReceipt.receipt.stages[0],
  ];
  writeFileSync(unorderedReceipt.path, `${JSON.stringify(unorderedReceipt.receipt, null, 2)}\n`);
  const unorderedRefusal = suggestDeclarations({
    backendDir: unorderedStages,
    operation: 'literalResult',
    runtimeEvidenceReceiptPaths: [unorderedReceipt.path],
  });
  equal(unorderedRefusal.ok, false, 'Ajv receipt admission must enforce ordered verify stages');
  check(unorderedRefusal.diagnostics[0].details.cause.includes('does not satisfy'));

  const unregisteredPathProfile = fixture();
  equal((await generate(unregisteredPathProfile)).ok, true);
  const unregisteredReceipt = writeRuntimeReceipt(unregisteredPathProfile, {
    functionName: 'literalResult',
    missingReads: ['secrets'],
  });
  unregisteredReceipt.receipt.stages[2].evidence.conformance.pathEvidence[0].profileId = 'unregistered-profile';
  unregisteredReceipt.receipt.stages[2].evidence.conformance.underDeclarations[0].profileId = 'unregistered-profile';
  writeFileSync(unregisteredReceipt.path, `${JSON.stringify(unregisteredReceipt.receipt, null, 2)}\n`);
  const unregisteredRefusal = suggestDeclarations({
    backendDir: unregisteredPathProfile,
    operation: 'literalResult',
    runtimeEvidenceReceiptPaths: [unregisteredReceipt.path],
  });
  equal(unregisteredRefusal.ok, false, 'path evidence must belong to the registered profile set');
  check(unregisteredRefusal.diagnostics[0].details.cause.includes('unregistered profile'));

  const receiptCas = fixture();
  equal((await generate(receiptCas)).ok, true);
  const { path: receiptPath, receipt } = writeRuntimeReceipt(receiptCas, {
    functionName: 'literalResult',
    missingReads: ['secrets'],
  });
  const receiptSuggestion = onlySuggestion(receiptCas, 'literalResult').suggestion;
  const receiptCasSource = readFileSync(join(receiptCas, 'functions.mjs'));
  receipt.nonclaims[0] = 'the exact retained receipt bytes changed after suggestion';
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  const receiptStale = applyDeclarationSuggestion(receiptSuggestion);
  equal(receiptStale.ok, false);
  equal(receiptStale.diagnostics[0].code, 'SNAPBACK_DECLARATION_SUGGESTION_STALE');
  deepEqual(readFileSync(join(receiptCas, 'functions.mjs')), receiptCasSource);

  const unknownDependencyKey = structuredClone(runtimeSuggestion);
  unknownDependencyKey.dependencyChanges.unexpected = true;
  equal(validateProtocol(unknownDependencyKey), false, 'closed dependency-change records must reject unknown keys');
  const compatibleResultOnly = structuredClone(stored);
  delete compatibleResultOnly.dependencyChanges;
  delete compatibleResultOnly.semanticSummary.dependencyAdditions;
  delete compatibleResultOnly.semanticSummary.dependencyCompleteSetClaim;
  compatibleResultOnly.analyzer.version = 1;
  equal(validateProtocol(compatibleResultOnly), true, JSON.stringify(validateProtocol.errors));
  const v2WithoutDependencyChanges = structuredClone(runtimeSuggestion);
  delete v2WithoutDependencyChanges.dependencyChanges;
  equal(validateProtocol(v2WithoutDependencyChanges), false, 'analyzer v2 must require dependencyChanges');
  const v2WithoutDependencyNonclaim = structuredClone(runtimeSuggestion);
  delete v2WithoutDependencyNonclaim.semanticSummary.dependencyCompleteSetClaim;
  equal(validateProtocol(v2WithoutDependencyNonclaim), false, 'analyzer v2 must require semantic dependency nonclaims');
  const v1WithV2DependencyChanges = structuredClone(compatibleResultOnly);
  v1WithV2DependencyChanges.dependencyChanges = runtimeSuggestion.dependencyChanges;
  equal(validateProtocol(v1WithV2DependencyChanges), false, 'analyzer v1 must not admit analyzer-v2 dependency fields');

  console.log(`declaration-suggestion.test.mjs: ${assertions} assertions passed`);
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
