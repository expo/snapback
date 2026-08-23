import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  GRAPH_IDENTITY_DOMAINS,
  compileGraphQueryV1,
  graphDomainHash,
  graphPlanIdentityV1,
  normalizeGraphIntervalEndV1,
  normalizeGraphPlanV1,
  normalizeKeysetKeyV1,
} from './graph-query.mjs';
import { arg, defineGraphQuery, defineSchema, defineTable, eq, lit, v } from './define.mjs';
import { generate, generateInProcess } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDir, '../..');
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const graphCorpus = join(repoRoot, 'tests', 'conformance', 'graph');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const zeroHash = `sha256:${'0'.repeat(64)}`;
const oneHash = `sha256:${'1'.repeat(64)}`;

// The JS mirror replays every B1 identity vector, including each one-axis
// rotation, under the exact domain supplied by the Rust-owned corpus.
{
  const vectors = readJson(join(graphCorpus, 'identity-vectors.v1.json'));
  const carrier = readJson(join(graphCorpus, 'minimal-carrier.v1.json'));
  const plan = graphPlanIdentityV1(carrier.normalizedPlan);
  assert.deepEqual(plan.normalizedPlan, carrier.normalizedPlan);
  assert.equal(plan.planHash, vectors.plan.hash);
  const rotatedPlan = clone(carrier.normalizedPlan);
  rotatedPlan.nodes[0].table = 'issues_rotated';
  assert.equal(graphPlanIdentityV1(rotatedPlan).planHash, vectors.plan.rotatedHash);

  const argsDigest = graphDomainHash('snapback:materialization-args:v1:', {});
  const window = {
    nodeId: 'n0',
    intervals: [{
      parentKey: null,
      window: {
        order: [{ field: 'updatedAt', direction: 'Desc' }],
        direction: 'backward',
        lower: { kind: 'unbounded' },
        upper: { kind: 'unbounded' },
        take: 2,
      },
    }],
  };
  const instancePreimage = {
    format: 'snapback.graph-instance.v1',
    graphPlanHash: plan.planHash,
    argsDigest,
    windows: [window],
  };
  const instanceHash = graphDomainHash(vectors.instance.domain, instancePreimage);
  assert.equal(instanceHash, vectors.instance.hash);
  const rotatedInstance = clone(instancePreimage);
  rotatedInstance.windows[0].intervals[0].window.take = 1;
  assert.equal(graphDomainHash(vectors.instance.domain, rotatedInstance), vectors.instance.rotatedHash);

  const materializationPreimage = {
    format: 'snapback.graph-materialization.v1',
    appId: 'app',
    databaseId: 'db',
    deploymentId: 'deployment-a',
    targetProfileId: 'local',
    activationHash: zeroHash,
    function: {
      artifactKind: 'functionReference',
      schemaVersion: 'snapback.v1',
      appId: 'app',
      id: 'fn-id',
      name: 'issues',
      kind: 'LiveQuery',
      implementationHash: zeroHash,
      argsContractHash: zeroHash,
      resultContractHash: zeroHash,
      expectedGeneration: {
        schemaVersion: 'snapback.v1',
        appId: 'app',
        schemaHash: 'schema',
        bundleHash: 'bundle',
        inputsHash: 'inputs',
      },
    },
    graphInstanceHash: instanceHash,
  };
  const materializationHash = graphDomainHash(
    vectors.materialization.domain,
    materializationPreimage,
  );
  assert.equal(materializationHash, vectors.materialization.hash);
  const rotatedMaterialization = clone(materializationPreimage);
  rotatedMaterialization.deploymentId = 'deployment-b';
  assert.equal(
    graphDomainHash(vectors.materialization.domain, rotatedMaterialization),
    vectors.materialization.rotatedHash,
  );

  const policyInputs = [
    { declarationId: 'a-policy', kind: 'membership', identity: zeroHash },
    { declarationId: 'z-policy', kind: 'role', identity: oneHash },
  ];
  assert.equal(
    graphDomainHash(vectors.partitionFunction.domain, policyInputs),
    vectors.partitionFunction.hash,
  );
  const rotatedPolicyInputs = clone(policyInputs);
  rotatedPolicyInputs[0].identity = oneHash;
  assert.equal(
    graphDomainHash(vectors.partitionFunction.domain, rotatedPolicyInputs),
    vectors.partitionFunction.rotatedHash,
  );

  const authorityPartition = {
    format: 'snapback.graph-authority-partition.v1',
    graphPlanHash: plan.planHash,
    class2: [{
      nodeId: 'n0',
      declarationId: 'a-policy',
      scopeIdentity: zeroHash,
      policyIdentity: oneHash,
    }],
    class3: null,
  };
  assert.equal(
    graphDomainHash(vectors.authorityPartition.domain, authorityPartition),
    vectors.authorityPartition.hash,
  );
  const rotatedPartition = clone(authorityPartition);
  rotatedPartition.class2[0].scopeIdentity = oneHash;
  assert.equal(
    graphDomainHash(vectors.authorityPartition.domain, rotatedPartition),
    vectors.authorityPartition.rotatedHash,
  );

  const broadcastScope = {
    format: 'snapback.graph-broadcast-scope.v1',
    graphMaterializationHash: materializationHash,
    policyIdentity: zeroHash,
    arguments: [],
  };
  assert.equal(
    graphDomainHash(vectors.broadcastScope.domain, broadcastScope),
    vectors.broadcastScope.hash,
  );
  broadcastScope.policyIdentity = oneHash;
  assert.equal(
    graphDomainHash(vectors.broadcastScope.domain, broadcastScope),
    vectors.broadcastScope.rotatedHash,
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(vectors).filter(([name]) => name !== 'format').map(
      ([name, vector]) => [name, vector.domain],
    )),
    GRAPH_IDENTITY_DOMAINS,
    'JS domain registry must be byte-identical to the Rust-owned vector domains',
  );
}

// Membership plus an explicit role subset derives both policy-input kinds;
// the projection receives the same closed class-2 proof/input roll-up.
{
  const carrier = readJson(join(graphCorpus, 'minimal-carrier.v1.json'));
  const root = clone(carrier.normalizedPlan.nodes[0]);
  delete root.authority;
  root.nodeId = 'root';
  root.authorityClass = 2;
  root.visibility = {
    kind: 'membership', declaration: 'members', resourceField: 'projectId', roles: ['member'],
  };
  const projection = clone(carrier.normalizedPlan.nodes[1]);
  delete projection.authority;
  projection.nodeId = 'projection';
  projection.authorityClass = 2;
  projection.object.scopeNodeId = 'root';
  projection.object.fields[0].value.nodeId = 'root';
  const queryCost = clone(carrier.normalizedPlan.queryCost);
  queryCost.graph.nodes[0].nodeId = 'root';
  const identity = compileGraphQueryV1({
    source: {
      nodes: [root], projection, queryCost, authorityScopes: {},
      broadcast: { classification: 'query-shaped' },
    },
    argsContract: { fields: [] },
    resultContractHash: zeroHash,
    tables: {
      issues: { name: 'issues', fields: [], indexes: [], visibility: root.visibility },
      membersTable: {
        name: 'membersTable', fields: [], indexes: [],
        membership: { id: 'members', scope: 'resource', roles: ['member', 'admin'] },
        visibility: { kind: 'owner', field: 'principal' },
      },
    },
  });
  assert.deepEqual(
    identity.normalizedPlan.nodes[0].authority.proof.policyInputs.map(({ kind }) => kind),
    ['membership', 'role'],
  );
  assert.deepEqual(
    identity.normalizedPlan.authorityPartitionRule.class2Inputs.map(({ nodeId, declarationId }) => (
      [nodeId, declarationId]
    )),
    [['n0', 'members'], ['n0', 'members'], ['n1', 'members'], ['n1', 'members']],
  );

  queryCost.graph.arguments = [{ argumentId: 'ids', maxItems: 4 }];
  queryCost.graph.maxArgumentItems = 4;
  const collectionIdentity = compileGraphQueryV1({
    source: {
      nodes: [root], projection, queryCost, authorityScopes: {},
      broadcast: { classification: 'query-shaped' },
    },
    argsContract: {
      fields: [{
        name: 'ids', required: true,
        value: { kind: 'array', element: { kind: 'string', maxBytes: 32 }, maxItems: 4 },
      }],
    },
    resultContractHash: zeroHash,
    tables: {
      issues: { name: 'issues', fields: [], indexes: [], visibility: root.visibility },
      membersTable: {
        name: 'membersTable', fields: [], indexes: [],
        membership: { id: 'members', scope: 'resource', roles: ['member', 'admin'] },
        visibility: { kind: 'owner', field: 'principal' },
      },
    },
  });
  assert.deepEqual(
    collectionIdentity.normalizedPlan.queryCost.graph.arguments,
    [{ argumentId: 'a0', maxItems: 4 }],
  );
}

// Preorder, keyset, literal-page, and Serde spelling vectors share the same
// JS normalization path rather than a test-only canonicalizer.
{
  const carrier = readJson(join(graphCorpus, 'minimal-carrier.v1.json'));
  const preorder = readJson(join(graphCorpus, 'normalized-preorder.v1.json'));
  const candidate = clone(carrier.normalizedPlan);
  candidate.nodes.splice(1, 0,
    {
      nodeId: 'labels', kind: 'equality-to-one', edgeName: 'labels',
      authority: { declaredClass: 1, proof: null }, parentNodeId: 'n0', table: 'labels',
      visibility: { kind: 'public-read' },
      joinOn: [{ rootField: 'id', joinedField: 'issueId' }],
      accessIndex: 'by_issue', presence: 'optional',
    },
    {
      nodeId: 'comments', kind: 'equality-to-one', edgeName: 'comments',
      authority: { declaredClass: 1, proof: null }, parentNodeId: 'n0', table: 'comments',
      visibility: { kind: 'public-read' },
      joinOn: [{ rootField: 'id', joinedField: 'issueId' }],
      accessIndex: 'by_issue', presence: 'optional',
    },
  );
  candidate.nodes[0].nodeId = 'root';
  candidate.nodes[1].parentNodeId = 'root';
  candidate.nodes[2].parentNodeId = 'root';
  candidate.nodes[3].nodeId = 'result';
  candidate.nodes[3].object.scopeNodeId = 'root';
  candidate.nodes[3].object.fields[0].value.nodeId = 'root';
  candidate.queryCost.graph.nodes[0].nodeId = 'root';
  candidate.queryCost.graph.nodes.push(
    { nodeId: 'labels', maxExaminedEntriesPerExecution: 1, maxRelationshipLookupsPerExecution: 1 },
    { nodeId: 'comments', maxExaminedEntriesPerExecution: 1, maxRelationshipLookupsPerExecution: 1 },
  );
  const normalized = normalizeGraphPlanV1(candidate);
  assert.deepEqual(
    normalized.nodes.map(({ nodeId, edgeName }) => [nodeId, edgeName]),
    preorder.normalized,
  );

  const unicodeFilters = clone(carrier.normalizedPlan);
  unicodeFilters.nodes[0].filters = [
    { field: '\u{10000}', op: 'Eq', value: { Literal: 1 } },
    { field: '\uE000', op: 'Eq', value: { Literal: 1 } },
  ];
  assert.deepEqual(
    normalizeGraphPlanV1(unicodeFilters).nodes[0].filters.map(({ field }) => field),
    ['\uE000', '\u{10000}'],
    'filter conjunctions sort by canonical JCS UTF-8 bytes, matching Rust String::cmp',
  );

  const keysets = readJson(join(graphCorpus, 'keyset-vectors.v1.json'));
  const keysetOrder = [
    { field: 'priority', direction: 'Asc' },
    { field: 'updatedAt', direction: 'Desc' },
  ];
  assert.deepEqual(normalizeKeysetKeyV1(keysets.positive, keysetOrder), keysets.positive);
  for (const vector of keysets.negative) {
    assert.throws(
      () => normalizeKeysetKeyV1(vector, keysetOrder),
      (error) => error.code === 'SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID',
      vector.name,
    );
  }
  for (const vector of keysets.literalPageNegative) {
    const end = clone(vector.end);
    if (vector.name === 'literal-lower-oversized-canonical-value') {
      end.key.entries[0][1] = 'x'.repeat(65_537);
    }
    assert.throws(
      () => normalizeGraphIntervalEndV1(end, vector.order),
      (error) => ['SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID', 'SNAPBACK_GRAPH_ORDER_NOT_TOTAL'].includes(error.code),
      vector.name,
    );
  }
  const serde = readJson(join(graphCorpus, 'serde-vectors.v1.json'));
  const class3 = clone(carrier.normalizedPlan);
  for (const node of class3.nodes) node.authority.declaredClass = 3;
  class3.authorityPartitionRule.class3 = 'partition-of-one';
  assert.equal(normalizeGraphPlanV1(class3).broadcast.reason, serde.queryShapedReason);
}

// Source-stage failure precedence: client AST, executable expressions,
// recursive carriers, then source-graph dynamic construction.
{
  const issues = defineTable({ title: v.string(), updatedAt: v.integer() })
    .index('by_updated', ['updatedAt'])
    .visibility({ kind: 'public-read' });
  defineSchema({ issues });
  const base = {
    nodes: [{
      nodeId: 'root', kind: 'root-window', edgeName: '$root', authorityClass: 1,
      table: issues, filters: [], accessIndex: 'by_updated', order: [{ field: 'updatedAt', direction: 'Desc' }],
    }],
    projection: {
      nodeId: 'result', edgeName: '$result', authorityClass: 1,
      object: { scopeNodeId: 'root', fields: [{ name: 'title', value: { kind: 'field', nodeId: 'root', field: 'title' } }] },
    },
    args: {},
    bounds: {
      maxScannedRows: 3, maxIndexRanges: 1, maxResultRows: 2, maxResultBytes: 100,
      maxEvaluationTurnMs: 10, maxObservers: 1, maxDistinctEvaluationGroups: 1,
      maxEstimatedLiveFanoutMs: 10,
    },
    queryCost: { graph: {
      nodes: [{
        nodeId: 'root', maxRootRowsPerPage: 2, maxExaminedEntriesPerExecution: 3,
        maxWindowPages: 2, maxWindowRootRows: 4, maxWindowScannedRows: 6,
        maxWindowResultRows: 4, maxWindowResultBytes: 200, maxWindowIndexRanges: 2,
      }],
      arguments: [], maxArgumentItems: 0, maxPageResultBytes: 100,
      windowRollup: {
        maxWindowPages: 2, maxWindowRootRows: 4, maxWindowScannedRows: 6,
        maxWindowResultRows: 4, maxWindowResultBytes: 200, maxWindowIndexRanges: 2,
      },
      maxMaintainedWritesPerMutation: 0,
    } },
    broadcast: { classification: 'query-shaped' },
  };
  assert.throws(
    () => defineGraphQuery({ ...base, nodes: [{ ...base.nodes[0], nodeId: arg('node') }] }),
    (error) => error.code === 'SNAPBACK_GRAPH_CLIENT_AST_FORBIDDEN',
  );
  assert.throws(
    () => defineGraphQuery({ ...base, nodes: [{ ...base.nodes[0], filters: [eq('title', { __expr: true, Call: {} })] }] }),
    (error) => error.code === 'SNAPBACK_GRAPH_CODE_FORBIDDEN',
  );
  const recursive = clone(base);
  recursive.nodes[0].table = issues;
  recursive.projection.object.fields[0].value = {
    kind: 'object', nodeId: 'root', object: recursive.projection.object,
  };
  assert.throws(
    () => defineGraphQuery(recursive),
    (error) => error.code === 'SNAPBACK_GRAPH_RECURSION_FORBIDDEN',
  );
  assert.doesNotThrow(() => defineGraphQuery(base));
  assert.equal(lit('ok').Literal, 'ok');
}

// End-to-end: author a literal graph, run the ordinary generator with a
// test-only admission target, then ask Rust to deserialize and validate the
// exact emitted FunctionManifest (including graph identity reconstruction).
const fixture = mkdtempSync(join(tmpdir(), 'snapback-graph-query-'));
try {
  const snapbackModules = join(fixture, 'node_modules', '@expo');
  mkdirSync(snapbackModules, { recursive: true });
  symlinkSync(packageDir, join(snapbackModules, 'snapback-codegen'), 'dir');
  writeFileSync(join(fixture, 'schema.mjs'), `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export const issues = defineTable({ title: v.string(), updatedAt: v.integer() })
  .index('by_updated', ['updatedAt'])
  .permissionBacking(['title'])
  .visibility({ kind: 'public-read' })
  .sync();
export default defineSchema({ issues });
`);
  const literalFunctions = `
import { defineGraphQuery, desc, v } from ${JSON.stringify(defineUrl)};
import { issues } from './schema.mjs';
export const issueGraph = defineGraphQuery({
  nodes: [{
    nodeId: 'root', kind: 'root-window', edgeName: '$root', authorityClass: 2,
    table: issues, filters: [], accessIndex: 'by_updated', order: [desc('updatedAt')],
  }],
  projection: {
    nodeId: 'result', edgeName: '$result', authorityClass: 2,
    object: { scopeNodeId: 'root', fields: [
      { name: 'title', value: { kind: 'field', nodeId: 'root', field: 'title' } },
    ] },
  },
  args: {
    labels: v.array(v.string({ maxBytes: 32 }), { maxItems: 3 }),
    assignees: v.array(v.string({ maxBytes: 32 }), { maxItems: 5 }),
  },
  bounds: {
    maxScannedRows: 3, maxIndexRanges: 1, maxResultRows: 2, maxResultBytes: 100,
    maxEvaluationTurnMs: 10, maxObservers: 1, maxDistinctEvaluationGroups: 1,
    maxEstimatedLiveFanoutMs: 10,
  },
  queryCost: { graph: {
    nodes: [{
      nodeId: 'root', maxRootRowsPerPage: 2, maxExaminedEntriesPerExecution: 3,
      maxWindowPages: 2, maxWindowRootRows: 4, maxWindowScannedRows: 6,
      maxWindowResultRows: 4, maxWindowResultBytes: 200, maxWindowIndexRanges: 2,
    }],
    arguments: [
      { argumentId: 'labels', maxItems: 3 },
      { argumentId: 'assignees', maxItems: 5 },
    ],
    maxArgumentItems: 8, maxPageResultBytes: 100,
    windowRollup: {
      maxWindowPages: 2, maxWindowRootRows: 4, maxWindowScannedRows: 6,
      maxWindowResultRows: 4, maxWindowResultBytes: 200, maxWindowIndexRanges: 2,
    },
    maxMaintainedWritesPerMutation: 0,
  } },
  broadcast: { classification: 'query-shaped' },
});
`;
  writeFileSync(join(fixture, 'functions.mjs'), literalFunctions);
  const localCapability = readJson(
    join(repoRoot, 'schemas', 'capability.manifest.local-dev-sqlite-ibex.json'),
  );
  localCapability.supportedCapabilities = [
    ...new Set([...localCapability.supportedCapabilities, 'graph_query_v1']),
  ].sort();
  localCapability.capabilityMaturity = {
    ...localCapability.capabilityMaturity,
    graph_query_v1: 'experimental',
  };
  const generated = await generateInProcess(fixture, {}, { capabilityManifest: localCapability });
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const manifestPath = join(fixture, 'generated', 'functions.manifest.json');
  const manifest = readJson(manifestPath);
  const fn = manifest.functions.find(({ name }) => name === 'issueGraph');
  assert(fn, 'defineGraphQuery must emit one function');
  assert.equal(fn.runtime.HostPlan.GraphQuery.normalizedPlan.rootNodeId, 'n0');
  assert.equal(fn.runtime.HostPlan.GraphQuery.normalizedPlan.nodes[0].authority.declaredClass, 2);
  assert.equal(
    fn.runtime.HostPlan.GraphQuery.normalizedPlan.nodes[0].authority.proof.policyInputs[0].kind,
    'permissionBacking',
  );
  assert.deepEqual(
    fn.runtime.HostPlan.GraphQuery.normalizedPlan.authorityPartitionRule.class2Inputs
      .map(({ nodeId }) => nodeId),
    ['n0', 'n1'],
    'the compiler emits partition inputs for the class-2 data node and projection roll-up',
  );
  assert.equal(
    fn.runtime.HostPlan.GraphQuery.normalizedPlan.broadcast.reason,
    'base-not-class-1',
  );
  assert.equal(
    fn.runtime.HostPlan.GraphQuery.planHash,
    graphDomainHash(GRAPH_IDENTITY_DOMAINS.plan, fn.runtime.HostPlan.GraphQuery.normalizedPlan),
  );
  assert.deepEqual(
    fn.runtime.HostPlan.GraphQuery.normalizedPlan.arguments.map(({ argumentId, name }) => (
      [argumentId, name]
    )),
    [['a0', 'assignees'], ['a1', 'labels']],
  );
  assert.deepEqual(
    fn.runtime.HostPlan.GraphQuery.normalizedPlan.queryCost.graph.arguments,
    [{ argumentId: 'a0', maxItems: 5 }, { argumentId: 'a1', maxItems: 3 }],
  );
  const jsRoundTrip = graphPlanIdentityV1(fn.runtime.HostPlan.GraphQuery.normalizedPlan);
  assert.deepEqual(jsRoundTrip.normalizedPlan, fn.runtime.HostPlan.GraphQuery.normalizedPlan);
  assert.equal(jsRoundTrip.planHash, fn.runtime.HostPlan.GraphQuery.planHash);
  assert.deepEqual(
    [...fn.requiredCapabilities].sort(),
    ['args_contract_v1', 'graph_query_v1', 'host_plan_runtime', 'live_subscriptions', 'result_contract_v1'],
  );
  execFileSync('cargo', [
    'test', '-p', 'snapback-types', '--test', 'graph_codegen_admission',
    'emitted_graph_function_manifest_admits', '--', '--exact', '--nocapture',
  ], {
    cwd: repoRoot,
    env: { ...process.env, SNAPBACK_GRAPH_CODEGEN_MANIFEST: manifestPath },
    stdio: 'inherit',
  });

  const assertGeneratedRefusal = async (source, code) => {
    writeFileSync(join(fixture, 'functions.mjs'), source);
    const refused = await generate(fixture);
    assert.equal(refused.ok, false, `${code} source unexpectedly generated`);
    assert(
      refused.diagnostics.some((diagnostic) => diagnostic.code === code),
      `${code}: ${JSON.stringify(refused.diagnostics)}`,
    );
  };
  await assertGeneratedRefusal(
    literalFunctions
      .replace('defineGraphQuery, desc', 'defineGraphQuery, desc, arg')
      .replace("nodeId: 'root', kind: 'root-window'", "nodeId: arg('node'), kind: 'root-window'"),
    'SNAPBACK_GRAPH_CLIENT_AST_FORBIDDEN',
  );
  await assertGeneratedRefusal(
    literalFunctions.replace('table: issues, filters: []', 'table: issues, filters: [() => true]'),
    'SNAPBACK_GRAPH_CODE_FORBIDDEN',
  );
  await assertGeneratedRefusal(
    literalFunctions.replace('nodes: [{', 'nodes: [defineGraphQuery({}), {'),
    'SNAPBACK_GRAPH_RECURSION_FORBIDDEN',
  );

  await assertGeneratedRefusal(literalFunctions.replace(
    "export const issueGraph = defineGraphQuery({\n  nodes: [{",
    "const graphNodes = [{",
  ).replace(
    "  }],\n  projection:",
    "  }];\nexport const issueGraph = defineGraphQuery({\n  nodes: graphNodes,\n  projection:",
  ), 'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log('graph-query.test.mjs: identity, normalization, source refusals, and Rust admission passed');
