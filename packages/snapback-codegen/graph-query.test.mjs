import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GRAPH_IDENTITY_DOMAINS,
  compileGraphQueryV1,
  graphCanonicalJson,
  graphDomainHash,
  graphPlanIdentityV1,
  normalizeGraphIntervalEndV1,
  normalizeGraphPlanV1,
  normalizeKeysetKeyV1,
} from './graph-query.mjs';
import { arg, defineGraphQuery, defineSchema, defineTable, eq, lit, v } from './define.mjs';
import { generateInProcess } from './index.mjs';
import { jcs as clientJcs } from '../snapback-client/rqs.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDir, '../..');
const graphCorpus = join(repoRoot, 'tests', 'conformance', 'graph');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const zeroHash = `sha256:${'0'.repeat(64)}`;
const oneHash = `sha256:${'1'.repeat(64)}`;
const codegenParityCorpus = readJson(join(graphCorpus, 'codegen-parity-corpus.v1.json'));

function setPath(root, path, value) {
  let parent = root;
  for (const segment of path.slice(0, -1)) parent = parent[segment];
  parent[path.at(-1)] = clone(value);
}

function removePath(root, path) {
  let parent = root;
  for (const segment of path.slice(0, -1)) parent = parent[segment];
  const key = path.at(-1);
  if (Array.isArray(parent)) parent.splice(key, 1);
  else delete parent[key];
}

// The dependency-local graph canonicalizer stays byte-equal to the shipped
// client JCS on both the shared RQS corpus and the Rust-owned graph boundary
// corpus. Refusal vectors must fail in both JS arms without reaching hashing.
{
  const shared = readJson(join(repoRoot, 'tests', 'fixtures', 'rqs-parity-v1.json'));
  for (const [index, vector] of shared.jcs.entries()) {
    const value = vector.input;
    assert.equal(graphCanonicalJson(value), vector.canonical, `shared JCS vector ${index}`);
    assert.equal(graphCanonicalJson(value), clientJcs(value), `shared JCS vector ${index}`);
  }
  const vectors = readJson(join(graphCorpus, 'identity-vectors.v1.json'));
  for (const vector of vectors.jcsBoundary) {
    const value = vector.javascript === 'Infinity' ? Infinity : JSON.parse(vector.json);
    if (vector.canonical !== undefined) {
      assert.equal(graphCanonicalJson(value), vector.canonical, vector.name);
      assert.equal(graphCanonicalJson(value), clientJcs(value), vector.name);
    } else {
      assert.throws(() => graphCanonicalJson(value), undefined, vector.name);
      assert.throws(() => clientJcs(value), undefined, vector.name);
    }
  }
}

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
    Object.fromEntries(Object.entries(vectors).filter(([name]) => (
      !['format', 'jcsBoundary'].includes(name)
    )).map(
      ([name, vector]) => [name, vector.domain],
    )),
    GRAPH_IDENTITY_DOMAINS,
    'JS domain registry must be byte-identical to the Rust-owned vector domains',
  );
}

// A class-1 base plus a literal establishment-only membership predicate emits
// the complete host-recomputable broadcast proof. The same authored request
// falls back to query-shaped when its resource scope cannot be data-flow bound.
{
  const carrier = readJson(join(graphCorpus, 'minimal-carrier.v1.json'));
  const root = clone(carrier.normalizedPlan.nodes[0]);
  delete root.authority;
  root.nodeId = 'rooms';
  root.table = 'rooms';
  root.authorityClass = 1;
  root.filters = [{ field: 'scopeId', op: 'Eq', value: { Arg: 'roomId' } }];
  const projection = clone(carrier.normalizedPlan.nodes[1]);
  delete projection.authority;
  projection.nodeId = 'projection';
  projection.authorityClass = 1;
  projection.object.scopeNodeId = 'rooms';
  projection.object.fields[0].value.nodeId = 'rooms';
  const queryCost = clone(carrier.normalizedPlan.queryCost);
  queryCost.graph.nodes[0].nodeId = 'rooms';
  queryCost.graph.maxArgumentItems = 1;
  const source = {
    nodes: [root], projection, queryCost, authorityScopes: {},
    functionMembership: [{
      declaration: 'roomMembers', resourceArg: 'roomId', roles: ['member'],
    }],
    broadcast: {
      classification: 'broadcast',
      establishment: {
        predicate: {
          kind: 'membership',
          declaration: 'roomMembers',
          resourceField: 'scopeId',
          roles: ['member'],
        },
      },
    },
  };
  const compile = (candidate) => compileGraphQueryV1({
    source: candidate,
    argsContract: {
      fields: [{
        name: 'roomId', required: true,
        value: { kind: 'id', table: 'rooms' },
      }],
    },
    resultContractHash: zeroHash,
    tables: {
      rooms: {
        name: 'rooms', fields: [
          { name: 'scopeId', field_type: { Id: { table: 'rooms' } }, optional: false },
        ], indexes: [], visibility: { kind: 'public-read' },
      },
      roomMembers: {
        name: 'roomMembers', fields: [
          { name: 'principal', field_type: 'Principal', optional: false },
          { name: 'roomId', field_type: { Id: { table: 'rooms' } }, optional: false },
          { name: 'role', field_type: 'String', optional: false },
        ], indexes: [],
        membership: {
          principal: 'principal', resource: 'roomId', resourceTable: 'rooms',
          role: 'role', scope: 'resource', roles: ['member', 'admin'], transitions: [],
        },
        visibility: { kind: 'owner', field: 'principal' },
      },
    },
  });
  const identity = compile(source);
  assert.equal(identity.normalizedPlan.broadcast.classification, 'broadcast');
  assert.deepEqual(identity.normalizedPlan.functionMembership, [{
    declaration: 'roomMembers',
    resource: { arg: { path: 'roomId', resourceTable: 'rooms' } },
    roles: ['member'],
  }]);
  assert.deepEqual(identity.normalizedPlan.broadcast.baseNodeIds, ['n0']);
  assert.deepEqual(
    identity.normalizedPlan.broadcast.establishment.scope.resourceEqualities,
    [{ nodeId: 'n0', field: 'scopeId', argumentId: 'a0' }],
  );
  assert.equal(identity.normalizedPlan.broadcast.establishment.invalidation.length, 18);
  assert.equal(
    new Set(identity.normalizedPlan.broadcast.establishment.invalidation
      .map(({ declarationId }) => declarationId)).size,
    1,
  );
  assert.match(
    identity.normalizedPlan.broadcast.establishment.audience.installedOwnerIdentity,
    /^sha256:[0-9a-f]{64}$/u,
  );
  const bareAuth = clone(source);
  delete bareAuth.functionMembership;
  assert.equal(
    compile(bareAuth).normalizedPlan.broadcast.reason,
    'audience-parity-failed',
    'bare authenticated function auth cannot qualify a broadcast audience',
  );
  const divergentAudience = clone(source);
  divergentAudience.functionMembership[0].roles = ['admin'];
  assert.equal(
    compile(divergentAudience).normalizedPlan.broadcast.reason,
    'audience-parity-failed',
    'a stricter function audience is query-shaped until exact parity exists',
  );
  const unbound = clone(source);
  unbound.nodes[0].filters = [];
  assert.deepEqual(compile(unbound).normalizedPlan.broadcast, {
    format: 'snapback.graph-broadcast-admission.v1',
    classification: 'query-shaped',
    reason: 'scope-unbound',
  });
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
  const compileCollectionCost = (candidateCost) => compileGraphQueryV1({
    source: {
      nodes: [root], projection, queryCost: candidateCost, authorityScopes: {},
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
  const incorrectArgumentAggregate = clone(queryCost);
  incorrectArgumentAggregate.graph.maxArgumentItems = 3;
  assert.throws(
    () => compileCollectionCost(incorrectArgumentAggregate),
    (error) => error.code === 'SNAPBACK_GRAPH_BOUND_INVALID',
    'JS lowering must refuse the same maxArgumentItems mismatch as B1',
  );
  const incorrectScannedAggregate = clone(queryCost);
  incorrectScannedAggregate.maxScannedRows = 4;
  assert.throws(
    () => compileCollectionCost(incorrectScannedAggregate),
    (error) => error.code === 'SNAPBACK_GRAPH_BOUND_INVALID',
    'JS lowering must refuse the same maxScannedRows mismatch as B1',
  );
  assert.throws(
    () => compileGraphQueryV1({
      source: {
        nodes: [{ ...root, parentNodeId: 'missing-parent' }],
        projection,
        queryCost,
        authorityScopes: {},
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
    }),
    (error) => error.code === 'SNAPBACK_GRAPH_PARENT_INVALID',
    'an unknown parent must refuse before topological cycle derivation',
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
    'filter conjunctions sort by the whole filter\'s canonical JCS UTF-8 bytes',
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
  for (const value of [Infinity, 9_007_199_254_740_992, '\uD800']) {
    assert.throws(
      () => defineGraphQuery({
        ...base,
        nodes: [{ ...base.nodes[0], filters: [eq('title', lit(value))] }],
      }),
      (error) => error.code === 'SNAPBACK_GRAPH_ARGUMENT_UNBOUND',
      `canonical-value refusal for ${String(value)}`,
    );
  }
  let getterReads = 0;
  const accessorSpec = { ...base };
  Object.defineProperty(accessorSpec, 'broadcast', {
    enumerable: true,
    get() {
      getterReads += 1;
      return base.broadcast;
    },
  });
  assert.throws(
    () => defineGraphQuery(accessorSpec),
    (error) => error.code === 'SNAPBACK_GRAPH_CODE_FORBIDDEN',
  );
  assert.equal(getterReads, 0, 'runtime preflight must not invoke authored getters');
  let fakeTableGetterReads = 0;
  const fakeTable = { __table: true };
  Object.defineProperty(fakeTable, '__tableName', {
    enumerable: true,
    get() {
      fakeTableGetterReads += 1;
      return 'issues';
    },
  });
  assert.throws(
    () => defineGraphQuery({
      ...base,
      nodes: [{ ...base.nodes[0], table: fakeTable }],
    }),
    (error) => error.code === 'SNAPBACK_GRAPH_CODE_FORBIDDEN',
  );
  assert.equal(fakeTableGetterReads, 0, 'string markers cannot spoof a trusted table builder');
  assert.throws(
    () => defineGraphQuery(Object.assign(Object.create({ inherited: true }), base)),
    (error) => error.code === 'SNAPBACK_GRAPH_CODE_FORBIDDEN',
  );
  let toJsonCalls = 0;
  assert.throws(
    () => defineGraphQuery({
      ...base,
      toJSON() {
        toJsonCalls += 1;
        return base;
      },
    }),
    (error) => error.code === 'SNAPBACK_GRAPH_CODE_FORBIDDEN',
  );
  assert.equal(toJsonCalls, 0, 'runtime preflight and JCS must not honor toJSON');
  assert.doesNotThrow(() => defineGraphQuery(Object.assign(Object.create(null), base)));
  assert.throws(
    () => defineGraphQuery({
      ...base,
      nodes: [{
        nodeId: 'search',
        kind: 'search-membership',
        edgeName: '$root',
        authorityClass: 1,
        providerCapabilityId: 'search-provider',
        membershipIdentity: { authorityClass: 3 },
        memberField: 'title',
        scopeBindings: [],
        invalidationTables: [],
        providerCompletenessClass: 'complete',
      }],
    }),
    (error) => error.code === 'SNAPBACK_GRAPH_SEARCH_UNADMITTED',
  );
  const frozenCarrier = defineGraphQuery(base);
  assert(Object.isFrozen(frozenCarrier));
  assert(Object.isFrozen(frozenCarrier.graphQuerySource));
  assert(Object.isFrozen(frozenCarrier.graphQuerySource.nodes));
  assert(Object.isFrozen(frozenCarrier.graphQuerySource.nodes[0]));
  assert.throws(
    () => { frozenCarrier.graphQuerySource.nodes[0].nodeId = 'mutated'; },
    TypeError,
    'post-hoc graph carrier mutation must throw',
  );
  assert.equal(lit('ok').Literal, 'ok');
}

// One frozen corpus drives defineGraphQuery plus lowering and Rust manifest
// admission. The sole jsOnly row exercises syntax that cannot survive runtime
// expression evaluation and is replayed through the source collector below.
{
  const carrier = readJson(join(graphCorpus, codegenParityCorpus.base));
  const basePlan = carrier.normalizedPlan;
  const issues = defineTable({ title: v.string(), updatedAt: v.integer() })
    .index('by_updated', ['updatedAt'])
    .visibility({ kind: 'public-read' });
  defineSchema({ issues });
  const baseSpec = () => {
    const root = clone(basePlan.nodes[0]);
    root.table = issues;
    root.authorityClass = root.authority.declaredClass;
    delete root.authority;
    delete root.page;
    delete root.visibility;
    const projection = clone(basePlan.nodes[1]);
    projection.authorityClass = projection.authority.declaredClass;
    delete projection.authority;
    delete projection.kind;
    const { graph, ...bounds } = clone(basePlan.queryCost);
    return {
      nodes: [root],
      projection,
      args: {},
      bounds,
      queryCost: { graph },
      broadcast: { classification: 'query-shaped' },
    };
  };
  const authoringPath = (path) => (
    path[0] === 'queryCost' && path[1] !== 'graph'
      ? ['bounds', ...path.slice(1)]
      : path
  );
  for (const parityCase of codegenParityCorpus.cases.filter(({ jsOnly }) => !jsOnly)) {
    const spec = baseSpec();
    for (const mutation of parityCase.set ?? []) {
      setPath(spec, authoringPath(mutation.path), mutation.value);
    }
    for (const path of parityCase.remove ?? []) removePath(spec, authoringPath(path));
    let actual = { outcome: 'accept', reason: null };
    try {
      const definition = defineGraphQuery(spec);
      compileGraphQueryV1({
        source: definition.graphQuerySource,
        argsContract: { fields: [] },
        resultContractHash: zeroHash,
        tables: {
          issues: {
            name: 'issues', fields: [], indexes: [],
            visibility: { kind: 'public-read' },
          },
        },
      });
    } catch (error) {
      actual = { outcome: 'refuse', reason: error.code ?? null };
    }
    assert.deepEqual(actual, parityCase.expected, parityCase.name);
  }
  const authoredBroadcastProof = baseSpec();
  authoredBroadcastProof.broadcast = {
    classification: 'broadcast',
    establishment: {
      predicate: {
        kind: 'membership', declaration: 'members', resourceField: 'scopeId',
      },
      scope: { argumentIds: [], resourceEqualities: [] },
    },
  };
  assert.throws(
    () => defineGraphQuery(authoredBroadcastProof),
    (error) => error.code === 'SNAPBACK_GRAPH_UNKNOWN_FIELD',
    'authored broadcast proof fields are outside the source grammar',
  );
}

// End-to-end: regenerate the committed authored fixture and byte-compare the
// exact FunctionManifest with the vector consumed by the engine admission
// test. The entry module deliberately only re-exports a helper-module graph;
// that graph uses namespace property-access DSL calls, proving the source gate
// follows every module in the authored definition graph.
const fixtureRoot = mkdtempSync(join(tmpdir(), 'snapback-graph-query-'));
const fixture = join(fixtureRoot, 'snapback');
try {
  mkdirSync(fixture, { recursive: true });
  const snapbackModules = join(fixture, 'node_modules', '@expo');
  mkdirSync(snapbackModules, { recursive: true });
  symlinkSync(packageDir, join(snapbackModules, 'snapback-codegen'), 'dir');
  const authoredFixture = join(graphCorpus, 'codegen-fixture');
  writeFileSync(
    join(fixtureRoot, 'demo.snapback.json'),
    readFileSync(join(authoredFixture, 'demo.snapback.json'), 'utf8'),
  );
  for (const name of ['schema.mjs', 'functions.mjs', 'issue-graph.mjs']) {
    writeFileSync(join(fixture, name), readFileSync(join(authoredFixture, name), 'utf8'));
  }
  const literalFunctions = readFileSync(join(authoredFixture, 'issue-graph.mjs'), 'utf8');
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
  const emittedManifestLines = readFileSync(manifestPath, 'utf8').split('\n');
  const frozenManifestLines = readFileSync(
    join(graphCorpus, 'codegen-emitted-manifest.v1.json'),
    'utf8',
  ).split('\n');
  assert.equal(
    emittedManifestLines.length,
    frozenManifestLines.length,
    'codegen output line count must stay byte-equal to the engine admission vector',
  );
  for (const [index, line] of emittedManifestLines.entries()) {
    assert.equal(
      line,
      frozenManifestLines[index],
      `codegen output line ${index + 1} must stay byte-equal to the engine admission vector`,
    );
  }
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
  const assertGeneratedRefusal = async (source, code) => {
    writeFileSync(join(fixture, 'issue-graph.mjs'), source);
    const refused = await generateInProcess(fixture, {}, { capabilityManifest: localCapability });
    assert.equal(refused.ok, false, `${code} source unexpectedly generated`);
    assert(
      refused.diagnostics.some((diagnostic) => diagnostic.code === code),
      `${code}: ${JSON.stringify(refused.diagnostics)}`,
    );
    return refused;
  };
  const assertGeneratedAcceptance = async (source, message) => {
    writeFileSync(join(fixture, 'issue-graph.mjs'), source);
    const accepted = await generateInProcess(fixture, {}, { capabilityManifest: localCapability });
    assert.equal(accepted.ok, true, `${message}: ${JSON.stringify(accepted.diagnostics)}`);
  };
  const withConditionalNodes = (source) => source
    .replace('  nodes: [{', '  nodes: true ? [{')
    .replace('  }],\n  projection:', '  }] : [],\n  projection:');
  for (const parityCase of codegenParityCorpus.cases.filter(({ jsOnly }) => jsOnly)) {
    assert.equal(parityCase.sourceStage, 'conditional-nodes', parityCase.name);
    await assertGeneratedRefusal(
      withConditionalNodes(literalFunctions),
      parityCase.expected.reason,
    );
  }
  const projectionOffset = literalFunctions.indexOf('  projection:');
  const authoredSearch = `${literalFunctions.slice(0, literalFunctions.indexOf('  nodes: [{'))}  nodes: [{
    nodeId: 'search', kind: 'search-membership', edgeName: '$root', authorityClass: 1,
    providerCapabilityId: 'search-provider-v1',
    membershipIdentity: { authorityClass: 3, providerVersion: 'v1' },
    memberField: 'title', scopeBindings: [], invalidationTables: [],
    providerCompletenessClass: 'complete-membership-v1',
  }],
${literalFunctions.slice(projectionOffset)}`;
  rmSync(join(fixture, 'generated'), { recursive: true, force: true });
  await assertGeneratedRefusal(authoredSearch, 'SNAPBACK_GRAPH_SEARCH_UNADMITTED');
  assert.equal(
    existsSync(manifestPath),
    false,
    'authored search membership must not publish a manifest',
  );
  await assertGeneratedRefusal(
    literalFunctions
      .replace("nodeId: 'root',", "nodeId: graphDsl.arg('node'),"),
    'SNAPBACK_GRAPH_CLIENT_AST_FORBIDDEN',
  );
  await assertGeneratedRefusal(
    literalFunctions.replace('    filters: [],', '    filters: [() => true],'),
    'SNAPBACK_GRAPH_CODE_FORBIDDEN',
  );
  await assertGeneratedRefusal(
    literalFunctions.replace('nodes: [{', 'nodes: [graphDsl.defineGraphQuery({}), {'),
    'SNAPBACK_GRAPH_RECURSION_FORBIDDEN',
  );
  await assertGeneratedAcceptance(
    literalFunctions.replace(
      'graphDsl.defineGraphQuery(',
      "graphDsl['defineGraphQuery'](",
    ),
    'string-literal element access must resolve to the owned builder',
  );
  await assertGeneratedRefusal(
    withConditionalNodes(literalFunctions.replace(
      'graphDsl.defineGraphQuery(',
      "graphDsl['defineGraphQuery'](",
    )),
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );
  const callBuilder = literalFunctions.replace(
    'graphDsl.defineGraphQuery({',
    'graphDsl.defineGraphQuery.call(null, {',
  );
  await assertGeneratedRefusal(
    withConditionalNodes(callBuilder),
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );
  const applyBuilder = literalFunctions
    .replace('graphDsl.defineGraphQuery({', 'graphDsl.defineGraphQuery.apply(null, [{')
    .replace(/\}\);\s*$/u, '}]);\n');
  await assertGeneratedRefusal(
    withConditionalNodes(applyBuilder),
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );
  await assertGeneratedRefusal(
    withConditionalNodes(`const dsl = graphDsl;\n${literalFunctions}`.replace(
      'graphDsl.defineGraphQuery(',
      'dsl.defineGraphQuery(',
    )),
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );

  const importLine = "import * as graphDsl from '@expo/snapback-codegen/define';";
  const withBuilderAlias = (declarations, callee) => literalFunctions
    .replace(importLine, `${importLine}\n${declarations}`)
    .replace('graphDsl.defineGraphQuery(', `${callee}(`);
  const propertyAlias = withBuilderAlias(
    'const dgq = graphDsl.defineGraphQuery;',
    'dgq',
  );
  await assertGeneratedAcceptance(
    propertyAlias,
    'a const property alias retains own-package builder provenance',
  );
  await assertGeneratedRefusal(
    withConditionalNodes(propertyAlias),
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );
  await assertGeneratedAcceptance(
    withBuilderAlias("const dgq = graphDsl['defineGraphQuery'];", 'dgq'),
    'a const literal-element alias retains own-package builder provenance',
  );
  await assertGeneratedAcceptance(
    withBuilderAlias(
      'const firstBuilder = graphDsl.defineGraphQuery;\nconst dgq = firstBuilder;',
      'dgq',
    ),
    'multi-hop const identifier aliases retain own-package builder provenance',
  );
  const aliasCall = propertyAlias.replace('dgq({', 'dgq.call(null, {');
  await assertGeneratedAcceptance(
    aliasCall,
    'call on a proven const builder alias is collected like the direct spelling',
  );
  await assertGeneratedRefusal(
    withConditionalNodes(aliasCall),
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );
  await assertGeneratedRefusal(
    withBuilderAlias('let dgq = graphDsl.defineGraphQuery;', 'dgq'),
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );
  await assertGeneratedRefusal(
    literalFunctions.replace(
      'graphDsl.defineGraphQuery(',
      "graphDsl['define' + 'GraphQuery'](",
    ),
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );
  const withNamedBuilder = literalFunctions.replace(
    importLine,
    `${importLine}\nimport { defineGraphQuery } from '@expo/snapback-codegen/define';`,
  );
  await assertGeneratedRefusal(
    withNamedBuilder.replace(
      'graphDsl.defineGraphQuery(',
      '(0, defineGraphQuery)(',
    ),
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );
  await assertGeneratedRefusal(
    withNamedBuilder.replace(
      'graphDsl.defineGraphQuery(',
      'Function.prototype.call.call(defineGraphQuery, null, ',
    ),
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );

  const wrapperRefusal = await assertGeneratedRefusal(
    `${importLine}
function getBuilder() { return graphDsl.defineGraphQuery; }
const cond = true;
const a = [];
const b = [];
export const issueGraph = getBuilder()({ nodes: cond ? a : b });
`,
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );
  assert(
    wrapperRefusal.diagnostics.some((diagnostic) => (
      diagnostic.code === 'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION'
        && diagnostic.message.startsWith('[snapback-define] defineGraphQuery ')
        && diagnostic.message.includes('source allowances')
    )),
    `wrapper indirection must fail in the runtime allowance gate: ${JSON.stringify(wrapperRefusal.diagnostics)}`,
  );

  const definitionStart = literalFunctions.indexOf('export const issueGraph =');
  const builderSpelling = 'graphDsl.defineGraphQuery(';
  const builderStart = literalFunctions.indexOf(builderSpelling, definitionStart);
  const builderEnd = literalFunctions.lastIndexOf(');');
  assert(definitionStart >= 0 && builderStart >= 0 && builderEnd > builderStart);
  const graphSpecSource = literalFunctions.slice(builderStart + builderSpelling.length, builderEnd);
  const zeroIterationLoop = `${literalFunctions.slice(0, definitionStart)}
for (let i = 0; i < 0; i += 1) {
  graphDsl.defineGraphQuery(${graphSpecSource});
}
function getBuilder() { return graphDsl.defineGraphQuery; }
export const issueGraph = getBuilder()(${graphSpecSource});
`;
  const loopRefusal = await assertGeneratedRefusal(
    zeroIterationLoop,
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );
  assert(
    loopRefusal.diagnostics.some((diagnostic) => (
      diagnostic.code === 'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION'
        && diagnostic.message.includes('top-level expressions or direct exported const initializers')
    )),
    `a zero-iteration loop must be an AST refusal and mint no allowance for a wrapper call: ${JSON.stringify(loopRefusal.diagnostics)}`,
  );

  const conditionalCall = `${literalFunctions.slice(0, definitionStart)}
let issueGraph;
if (true) {
  issueGraph = graphDsl.defineGraphQuery(${graphSpecSource});
}
export { issueGraph };
`;
  const conditionalCallRefusal = await assertGeneratedRefusal(
    conditionalCall,
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );
  assert(
    conditionalCallRefusal.diagnostics.some((diagnostic) => (
      diagnostic.code === 'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION'
        && diagnostic.message.includes('top-level expressions or direct exported const initializers')
    )),
    `a builder call beneath an if statement must be an AST refusal: ${JSON.stringify(conditionalCallRefusal.diagnostics)}`,
  );

  writeFileSync(
    join(fixture, 'graph-builder.mjs'),
    "export { defineGraphQuery } from '@expo/snapback-codegen/define';\n",
  );
  const reexportedBuilder = literalFunctions
    .replace(
      "import * as graphDsl from '@expo/snapback-codegen/define';",
      "import * as graphDsl from '@expo/snapback-codegen/define';\nimport { defineGraphQuery as reexportedGraphBuilder } from './graph-builder.mjs';",
    )
    .replace('graphDsl.defineGraphQuery(', 'reexportedGraphBuilder(');
  await assertGeneratedAcceptance(
    reexportedBuilder,
    'a re-export chain to define.mjs must resolve',
  );
  await assertGeneratedRefusal(
    withConditionalNodes(reexportedBuilder),
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );

  writeFileSync(
    join(fixture, 'unknown-builder.mjs'),
    'export const defineGraphQuery = (spec) => spec;\n',
  );
  await assertGeneratedRefusal(
    literalFunctions
      .replace(
        "import * as graphDsl from '@expo/snapback-codegen/define';",
        "import * as graphDsl from '@expo/snapback-codegen/define';\nimport { defineGraphQuery } from './unknown-builder.mjs';",
      )
      .replace('graphDsl.defineGraphQuery(', 'defineGraphQuery('),
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );
  await assertGeneratedRefusal(
    `const arbitraryTable = issues;\n${literalFunctions}`.replace(
      '    table: issues,',
      '    table: arbitraryTable,',
    ),
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );

  await assertGeneratedRefusal(literalFunctions.replace(
    "export const issueGraph = graphDsl.defineGraphQuery({\n  nodes: [{",
    "const graphNodes = [{",
  ).replace(
    "  }],\n  projection:",
    "  }];\nexport const issueGraph = graphDsl.defineGraphQuery({\n  nodes: graphNodes,\n  projection:",
  ), 'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION');
  await assertGeneratedRefusal(
    literalFunctions.replace("    nodeId: 'root',", "    ['node' + 'Id']: 'root',"),
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );
  await assertGeneratedRefusal(
    `const broadcast = { classification: 'query-shaped' };\n${literalFunctions}`
      .replace("  broadcast: { classification: 'query-shaped' },", '  broadcast,'),
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );
  await assertGeneratedRefusal(
    literalFunctions.replace("'query-shaped'", "new String('query-shaped')"),
    'SNAPBACK_GRAPH_CODE_FORBIDDEN',
  );
  await assertGeneratedRefusal(
    literalFunctions.replace("'query-shaped'", 'globalThis.graphClassification'),
    'SNAPBACK_GRAPH_CODE_FORBIDDEN',
  );
  await assertGeneratedRefusal(
    literalFunctions.replace("'query-shaped'", "`query-${'shaped'}`"),
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );
  await assertGeneratedRefusal(
    `const fakeDsl = graphDsl;\n${literalFunctions}`.replace('graphDsl.desc', 'fakeDsl.desc'),
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  );

  const allSourceFaults = literalFunctions
    .replace("nodeId: 'root',", "nodeId: graphDsl.arg('node'),")
    .replace('    filters: [],', '    filters: [() => true],')
    .replace("'query-shaped'", "true ? 'query-shaped' : 'other'");
  writeFileSync(join(fixture, 'issue-graph.mjs'), allSourceFaults);
  const ordered = await generateInProcess(fixture, {}, { capabilityManifest: localCapability });
  assert.equal(ordered.ok, false, 'multi-fault graph source must refuse');
  assert.deepEqual(
    ordered.diagnostics
      .map(({ code }) => code)
      .filter((code) => [
        'SNAPBACK_GRAPH_CLIENT_AST_FORBIDDEN',
        'SNAPBACK_GRAPH_CODE_FORBIDDEN',
        'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
      ].includes(code)),
    [
      'SNAPBACK_GRAPH_CLIENT_AST_FORBIDDEN',
      'SNAPBACK_GRAPH_CODE_FORBIDDEN',
      'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
    ],
    'source faults follow the normative register instead of traversal order',
  );
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('graph-query.test.mjs: identity, normalization, source refusals, and frozen seam vector passed');
