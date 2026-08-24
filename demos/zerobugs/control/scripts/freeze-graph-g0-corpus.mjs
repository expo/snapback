#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

// Freeze the G0 graph declarations and the opaque-handler oracle together.
// This does not execute a graph: it codegens the declaration carrier, invokes
// the existing control handler seam, and records the comparison contract.
// @ref LLP 0209#stage-b-oracle-comparison-contract — normal-fixture rows,
// label translations, exclusions, identities, and stable refusals are data.

const CONTROL_ROOT = resolve(import.meta.dirname, '..');
const REPO_ROOT = resolve(CONTROL_ROOT, '../../..');
const GRAPH_ROOT = join(REPO_ROOT, 'tests/conformance/graph');
const DECLARATION_ROOT = join(GRAPH_ROOT, 'zerobugs');
const NORMAL_ROOT = join(CONTROL_ROOT, 'fixtures/normal-seed-v1');
const LARGE_ROOT = join(REPO_ROOT, 'demos/zerobugs/fixtures-local/large-seed42-v1');
const CORPUS_PATH = join(GRAPH_ROOT, 'corpus.v1.json');
const BOUNDS_PATH = join(GRAPH_ROOT, 'bound-derivation.v1.json');
const PENDING_CASES_PATH = join(GRAPH_ROOT, 'broadcast-cases.g2-pending.v1.json');
const PAIRED_FIXTURES_PATH = join(GRAPH_ROOT, 'paired-world-fixtures.v1.json');
const ZERO_HASH = `sha256:${'0'.repeat(64)}`;
const OWNER_SCOPE_DOMAIN = 'snapback:g0-corpus-authority-scope:v1:';
const LARGE_SPOT_CHECK_COMMAND = 'ZBUGS_LARGE_FIXTURE_ROOT=demos/zerobugs/fixtures-local/large-seed42-v1 ZBUGS_ATTEMPT=v4 volta run --node 24.18.0 node demos/zerobugs/control/tests/acceptance/gates/zb5-large.mjs';
const HOT_SPOT_CHECK_COMMAND = 'ZBUGS_LARGE_FIXTURE_ROOT=demos/zerobugs/fixtures-local/large-seed42-v1 ZBUGS_ATTEMPT=v11 volta run --node 24.18.0 node demos/zerobugs/control/tests/acceptance/gates/zb5-hot.mjs';
const FIXTURE_TABLES = [
  'user', 'project', 'label', 'issue', 'issueLabel', 'comment', 'emoji',
  'viewState', 'userPref', 'issueNotifications', 'projectUserRead',
  'issueListRead', 'issueLabelRead', 'issueSearchDocument', 'searchEpoch',
];

const fixtureOptionIndex = process.argv.indexOf('--fixtures');
const requestedFixtures = (process.argv.find(value => value.startsWith('--fixtures='))
  ?? (fixtureOptionIndex >= 0 ? process.argv[fixtureOptionIndex + 1] : undefined)
  ?? 'normal-seed-v1,large-seed42-v1,hot-recent-v1')
  .replace(/^--fixtures=/u, '')
  .split(',');
const checkOnly = process.argv.includes('--check');
let corpusAuthorityOwner = null;
const freezerProofSelfChecks = {consumed: false, found: false, parentLinkage: false};

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function pretty(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function digestBytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(item => item === undefined ? 'null' : canonical(item)).join(',')}]`;
  }
  return `{${Object.keys(value)
    .filter(key => value[key] !== undefined)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(',')}}`;
}

function domainHash(domain, value) {
  return `sha256:${createHash('sha256').update(domain).update(canonical(value)).digest('hex')}`;
}

function deepClone(value) {
  return structuredClone(value);
}

function loadTables() {
  return Object.fromEntries(FIXTURE_TABLES.map(table => [
    table,
    readJson(join(NORMAL_ROOT, `${table}.json`)),
  ]));
}

function mockContext(tables, principal) {
  return {
    auth: principal === null ? null : { userId: principal },
    db: {
      query(table) {
        const equals = [];
        let limit = Number.POSITIVE_INFINITY;
        let direction = 'asc';
        const builder = {
          withIndex() { return builder; },
          eq(field, value) { equals.push([field, value]); return builder; },
          order(next) { direction = next; return builder; },
          take(next) { limit = next; return builder; },
          async collect() {
            const rows = (tables[table] ?? [])
              .filter(row => equals.every(([field, value]) => row[field] === value));
            return (direction === 'desc' ? [...rows].reverse() : rows).slice(0, limit);
          },
          async first() { return (await builder.collect())[0] ?? null; },
        };
        return builder;
      },
      async get(table, id) {
        return (tables[table] ?? []).find(row => row._id === id) ?? null;
      },
    },
  };
}

function installBinding(tables, principal, actor) {
  tables.identityBinding = [{
    _id: `identity_${principal}`,
    principal,
    sourceUserID: actor.sourceUserID,
    userID: actor.userID,
  }];
}

function ownerProjectRole(projectRoleFacts) {
  if (projectRoleFacts.isCrew) return 'crew';
  if (projectRoleFacts.isCreator && projectRoleFacts.isAssignee) return 'creator-assignee';
  if (projectRoleFacts.isCreator) return 'creator';
  if (projectRoleFacts.isAssignee) return 'assignee';
  return 'none';
}

function buildAuthorityOwner(tables, fixture) {
  const actors = [
    ['principal_ordinary', 'ordinary-user'],
    ['principal_crew', 'crew-admin'],
    ['principal_removed', 'removed-member'],
  ];
  const facts = actors.map(([principal, actorName]) => {
    const actor = fixture.actorBindings[actorName];
    const user = tables.user.find(row => row._id === actor.userID);
    assert(user, `${principal} resolves its frozen source user`);
    assert.equal(user.id, actor.sourceUserID, `${principal} source identity is exact`);
    assert.equal(user.role, actor.role, `${principal} frozen role is exact`);
    const memberships = tables.projectUserRead.filter(row => row.userID === actor.userID);
    assert(memberships.length <= 1, `${principal} has at most one frozen project-role row`);
    const membership = memberships[0];
    const projectRoleFacts = {
      isCrew: membership?.isCrew ?? false,
      isCreator: membership?.isCreator ?? false,
      isAssignee: membership?.isAssignee ?? false,
    };
    const crewMembership = user.role === 'crew';
    assert.equal(
      projectRoleFacts.isCrew, crewMembership,
      `${principal} source role and project crew membership agree`,
    );
    const allowedValues = crewMembership ? ['internal', 'public'] : ['public'];
    return {
      principal, sourceUserID: actor.sourceUserID, userID: actor.userID,
      role: user.role, crewMembership, projectRoleFacts,
      visibilityPolicyInputs: ['issue', 'issueListRead'].map(declarationId => ({
        declarationId, permissionFields: ['visibility'], allowedValues,
      })),
    };
  });
  return {
    format: 'snapback.graph-corpus-authority-owner.v1',
    scopeHashDomain: OWNER_SCOPE_DOMAIN,
    facts,
    equivalenceAssertions: [
      {
        relation: 'same', query: 'listIssueByID',
        graphArgs: {sourceIssueID: 'zbav1_internal_issue', selectedLabelIDs: []},
        principals: ['principal_crew', 'principal_removed'],
      },
      {
        relation: 'different', query: 'listIssueByID',
        graphArgs: {sourceIssueID: 'zbav1_internal_issue', selectedLabelIDs: []},
        principals: ['principal_crew', 'principal_ordinary'],
      },
    ],
  };
}

function authorityFact(principal) {
  assert(corpusAuthorityOwner, 'corpus authority owner is initialized');
  const fact = corpusAuthorityOwner.facts.find(candidate => candidate.principal === principal);
  assert(fact, `frozen owner facts exist for ${principal}`);
  return fact;
}

function normalizedOwnerScope(input, args, principal) {
  const fact = authorityFact(principal);
  const visibilityPolicyInput = fact.visibilityPolicyInputs
    .find(candidate => candidate.declarationId === input.declarationId);
  assert(visibilityPolicyInput, `${input.declarationId} has frozen visibility-policy facts`);
  const scopeArguments = input.scopeArgumentIds.map(argumentId => {
    assert(Object.hasOwn(args, argumentId), `${argumentId} is a declared scope argument`);
    return {argumentId, value: args[argumentId]};
  });
  return {
    format: 'snapback.graph-corpus-policy-equivalence-scope.v1',
    policyInput: {
      nodeId: input.nodeId,
      declarationId: input.declarationId,
      policyIdentity: input.policyIdentity,
    },
    rolePermissionFacts: {
      crewMembership: fact.crewMembership,
      projectRole: ownerProjectRole(fact.projectRoleFacts),
      visibilityPolicyInput,
    },
    scopeArguments,
  };
}

function resolvedClass2Inputs(carrier, args, principal) {
  return carrier.normalizedPlan.authorityPartitionRule.class2Inputs.map(input => {
    const normalizedScope = normalizedOwnerScope(input, args, principal);
    assert(!Object.hasOwn(normalizedScope, 'principal'), 'raw principal is outside the class-2 scope preimage');
    assert(
      !canonical(normalizedScope).includes(JSON.stringify(principal)),
      'raw principal value is absent from the complete class-2 scope preimage',
    );
    return {
      nodeId: input.nodeId,
      declarationId: input.declarationId,
      scopeIdentity: domainHash(OWNER_SCOPE_DOMAIN, normalizedScope),
      policyIdentity: input.policyIdentity,
    };
  });
}

function defaultListContext(overrides = {}) {
  return {
    open: null, assignee: null, creator: null, labels: null, textFilter: null,
    sortField: 'modified', sortDirection: 'desc', ...overrides,
  };
}

async function codegenDeclarations() {
  const packageDir = join(REPO_ROOT, 'packages/snapback-codegen');
  const { generateInProcess } = await import(pathToFileURL(join(packageDir, 'index.mjs')));
  const tempRoot = mkdtempSync(join(tmpdir(), 'snapback-g0-graph-freeze-'));
  const backend = join(tempRoot, 'snapback');
  mkdirSync(join(backend, 'node_modules/@expo'), { recursive: true });
  symlinkSync(packageDir, join(backend, 'node_modules/@expo/snapback-codegen'), 'dir');
  cpSync(join(DECLARATION_ROOT, 'demo.snapback.json'), join(tempRoot, 'demo.snapback.json'));
  for (const file of ['schema.mjs', 'queries.mjs', 'functions.mjs', 'refusal-candidates.mjs']) {
    cpSync(join(DECLARATION_ROOT, file), join(backend, file));
  }
  const capability = readJson(join(
    REPO_ROOT, 'schemas/capability.manifest.local-dev-sqlite-ibex.json',
  ));
  capability.supportedCapabilities = [
    ...new Set([...capability.supportedCapabilities, 'graph_query_v1']),
  ].sort();
  capability.capabilityMaturity = {
    ...capability.capabilityMaturity,
    graph_query_v1: 'experimental',
  };
  const generated = await generateInProcess(backend, {}, { capabilityManifest: capability });
  assert.equal(generated.ok, true, `graph declarations must codegen: ${JSON.stringify(generated.diagnostics)}`);
  const manifest = readJson(join(backend, 'generated/functions.manifest.json'));
  const carriers = Object.fromEntries(['issueListV2', 'issueDetail', 'listIssueByID'].map(name => {
    const fn = manifest.functions.find(candidate => candidate.name === name);
    assert(fn, `generated graph declaration ${name}`);
    return [name, fn.runtime.HostPlan.GraphQuery];
  }));
  const refusalModule = await import(`${pathToFileURL(join(backend, 'refusal-candidates.mjs')).href}?freeze=${Date.now()}`);
  const refusalFns = {
    issueListV2: refusalModule.issueListSearchCandidate,
    issueDetail: refusalModule.issueDetailOrderedLabelsCandidate,
    listIssueByID: refusalModule.listIssueByIDOrderedLabelsCandidate,
  };
  const refusals = Object.fromEntries(Object.entries(refusalFns).map(([query, candidate]) => {
    let reason = null;
    try { candidate(); } catch (error) { reason = error.code ?? null; }
    assert(reason, `${query} full-feature candidate must refuse`);
    return [query, reason];
  }));
  rmSync(tempRoot, { recursive: true });
  return { carriers, refusals };
}

function translation(status, reason, cursor, rows, label, refusal = null, excluded = null) {
  return {
    oracleStatus: status, oracleReason: reason, when: { cursor, rows },
    graphLabel: label, graphRefusalReason: refusal, excludedReason: excluded,
  };
}

const complete = translation('complete', null, 'any', 'any', 'complete');
const childCompleteTranslations = [
  complete,
  translation('incomplete', null, 'any', 'any', 'refused', 'SNAPBACK_QUERY_COST_BOUND_EXCEEDED'),
];

function fieldMap(query, carrier) {
  const nodes = carrier.normalizedPlan.nodes;
  const root = nodes.find(node => node.kind === 'root-window').nodeId;
  const labels = nodes.find(node => node.edgeName === 'labels').nodeId;
  if (query === 'issueListV2') return {
    query,
    rows: {
      graphProjectionPaths: [
        '$.issue.id', '$.issue.shortID', '$.issue.title', '$.issue.open',
        '$.issue.modified', '$.issue.created', '$.issue.description',
        '$.labels[*].label.id', '$.labels[*].label.name', '$.viewState.viewed',
      ],
      oracleFields: [
        'items[*].issue.id', 'items[*].issue.shortID', 'items[*].issue.title',
        'items[*].issue.open', 'items[*].issue.modified', 'items[*].issue.created',
        'items[*].issue.description', 'items[*].labels[*].id',
        'items[*].labels[*].name', 'items[*].viewState.viewed',
      ],
      comparison: 'exact-declared-rows',
    },
    order: { graphNodeId: root, oracleFields: ['items[*].issue.id'], comparison: 'exact-id-order' },
    nodeCompleteness: [{
      graphNodeId: labels, oracleStatusField: 'items[*].labelsCompleteness',
      oracleReasonField: null, oracleCursorField: 'cursor',
      oracleRowsField: 'items[*].labels', comparison: 'translated-label',
      translations: childCompleteTranslations,
    }],
    outerStatusReason: {
      oracleStatusField: 'status', oracleReasonField: 'reason',
      oracleCursorField: 'cursor', oracleRowsField: 'items',
      comparison: 'translated-label',
      translations: [
        complete,
        translation('incomplete', 'page-limit', 'non-null', 'non-empty', 'prefix'),
        translation('incomplete', 'child-bound', 'any', 'any', 'refused', 'SNAPBACK_QUERY_COST_BOUND_EXCEEDED'),
        translation('incomplete', 'issue-read-model-bound', 'any', 'any', 'refused', 'SNAPBACK_QUERY_COST_BOUND_EXCEEDED'),
        translation('incomplete', 'label-membership-bound', 'any', 'any', 'refused', 'SNAPBACK_QUERY_COST_BOUND_EXCEEDED'),
        translation('incomplete', 'positive-limit-required', 'null', 'empty', 'refused', 'SNAPBACK_GRAPH_ARGUMENT_INVALID'),
        translation('refreshing', 'search-document-bound-or-epoch-missing', 'any', 'any', null, null, 'transient provider state, not a graph result label'),
      ],
    },
    continuation: [{ graphNodeId: root, oracleHasMoreField: 'hasMore', oracleCursorField: 'cursor', comparison: 'same-next-page-rows' }],
    excluded: [
      { oracleField: 'items[*].issue.projectID', reason: 'root project partition is already fixed by the graph argument' },
      { oracleField: 'items[*].issue.creatorID', reason: 'creator identity is not part of the admitted list projection' },
      { oracleField: 'items[*].issue.visibility', reason: 'visibility is an authorization input, not a projected result leaf' },
      { oracleField: 'items[*].labels[*].projectID', reason: 'label project partition is already fixed by the root argument' },
      { oracleField: 'examined', reason: 'opaque-handler physical work, not a graph result leaf' },
      { oracleField: 'total', reason: 'full filtered count outside the bounded declared projection' },
      { oracleField: 'searchEpoch', reason: 'provider diagnostic/version metadata, not a projected graph field' },
    ],
  };
  if (query === 'issueDetail') {
    const comments = nodes.find(node => node.edgeName === 'comments').nodeId;
    return {
      query,
      rows: {
        graphProjectionPaths: [
          '$.issueId', '$.issueShortID', '$.issueTitle', '$.issueOpen',
          '$.issueModified', '$.issueCreated', '$.issueDescription',
          '$.project.id', '$.project.name', '$.creator.id', '$.creator.login',
          '$.assignee.id', '$.assignee.login', '$.labels[*].label.id',
          '$.labels[*].label.name', '$.comments[*].id', '$.comments[*].created',
          '$.comments[*].body', '$.notificationState.subscribed', '$.viewState.viewed',
        ],
        oracleFields: [
          'value.issue.id', 'value.issue.shortID', 'value.issue.title',
          'value.issue.open', 'value.issue.modified', 'value.issue.created',
          'value.issue.description', 'value.project.id', 'value.project.name',
          'value.creator.id', 'value.creator.login', 'value.assignee.id',
          'value.assignee.login', 'value.labels[*].id', 'value.labels[*].name',
          'value.comments[*].comment.id', 'value.comments[*].comment.created',
          'value.comments[*].comment.body', 'value.notificationState.subscribed',
          'value.viewState.viewed',
        ],
        comparison: 'exact-declared-rows',
      },
      order: { graphNodeId: root, oracleFields: ['value.issue.id'], comparison: 'exact-id-order' },
      nodeCompleteness: [
        { graphNodeId: labels, oracleStatusField: 'value.labelsCompleteness', oracleReasonField: null, oracleCursorField: 'value.commentsCursor', oracleRowsField: 'value.labels', comparison: 'translated-label', translations: childCompleteTranslations },
        { graphNodeId: comments, oracleStatusField: 'value.commentsCompleteness', oracleReasonField: null, oracleCursorField: 'value.commentsCursor', oracleRowsField: 'value.comments', comparison: 'translated-label', translations: [
          complete,
          translation('incomplete', null, 'non-null', 'non-empty', 'window'),
          translation('incomplete', null, 'null', 'empty', 'refused', 'SNAPBACK_QUERY_COST_BOUND_EXCEEDED'),
        ] },
      ],
      outerStatusReason: {
        oracleStatusField: 'status', oracleReasonField: 'reason', oracleCursorField: 'value.commentsCursor', oracleRowsField: 'value.comments', comparison: 'translated-label',
        translations: [
          translation('complete', null, 'any', 'any', null, null, 'aggregate duplicate; compose mapped node labels'),
          translation('incomplete', 'bounded-child-window', 'any', 'any', null, null, 'aggregate duplicate; compose mapped node labels'),
          translation('not-found-authoritative', 'missing-or-invisible-issue', 'null', 'empty', 'complete'),
        ],
      },
      continuation: [{ graphNodeId: comments, oracleHasMoreField: 'value.commentsCursor', oracleCursorField: 'value.commentsCursor', comparison: 'same-next-page-rows' }],
      excluded: [
        { oracleField: 'value.issue.projectID', reason: 'project is represented by the admitted project node' },
        { oracleField: 'value.issue.creatorID', reason: 'creator is represented by the admitted creator node' },
        { oracleField: 'value.issue.visibility', reason: 'visibility is an authorization input, not a projected result leaf' },
        { oracleField: 'value.project.lowerCaseName', reason: 'control-only normalized sort helper outside the admitted detail projection' },
        { oracleField: 'value.project.supportsSearch', reason: 'search-provider capability metadata outside the admitted detail projection' },
        { oracleField: 'value.creator.avatar', reason: 'rich user leaf outside the admitted structural projection' },
        { oracleField: 'value.creator.name', reason: 'rich user leaf outside the admitted structural projection' },
        { oracleField: 'value.creator.role', reason: 'authorization source field outside the admitted structural projection' },
        { oracleField: 'value.assignee.avatar', reason: 'rich user leaf outside the admitted structural projection' },
        { oracleField: 'value.assignee.name', reason: 'rich user leaf outside the admitted structural projection' },
        { oracleField: 'value.assignee.role', reason: 'authorization source field outside the admitted structural projection' },
        { oracleField: 'value.labels[*].projectID', reason: 'project partition is already bound by the root issue' },
        { oracleField: 'value.comments[*].comment.issueID', reason: 'comment parent identity is already fixed by the root issue' },
        { oracleField: 'value.comments[*].comment.creatorID', reason: 'rich comment creator branch is outside the admitted structural projection' },
        { oracleField: 'value.emoji', reason: 'v1 admitted structural declaration omits the rich through-child emoji branch' },
        { oracleField: 'value.emojiCompleteness', reason: 'paired with the omitted rich through-child emoji branch; full row shape is refused' },
        { oracleField: 'value.comments[*].creator', reason: 'v1 admitted structural declaration omits the rich comment creator branch' },
        { oracleField: 'value.comments[*].emoji', reason: 'v1 admitted structural declaration omits the rich comment emoji branch' },
        { oracleField: 'value.comments[*].emojiCompleteness', reason: 'paired with the omitted rich comment emoji branch; full row shape is refused' },
      ],
    };
  }
  return {
    query,
    rows: {
      graphProjectionPaths: [
        '$.issue.id', '$.issue.shortID', '$.issue.title', '$.issue.open',
        '$.issue.modified', '$.issue.created', '$.issue.description',
        '$.labels[*].label.id', '$.labels[*].label.name', '$.viewState.viewed',
      ],
      oracleFields: [
        'items[*].issue.id', 'items[*].issue.shortID', 'items[*].issue.title',
        'items[*].issue.open', 'items[*].issue.modified', 'items[*].issue.created',
        'items[*].issue.description', 'items[*].labels[*].id',
        'items[*].labels[*].name', 'items[*].viewState.viewed',
      ],
      comparison: 'exact-declared-rows',
    },
    order: { graphNodeId: root, oracleFields: ['items[*].issue.id'], comparison: 'exact-id-order' },
    nodeCompleteness: [{ graphNodeId: labels, oracleStatusField: 'items[*].labelsCompleteness', oracleReasonField: null, oracleCursorField: 'cursor', oracleRowsField: 'items[*].labels', comparison: 'translated-label', translations: childCompleteTranslations }],
    outerStatusReason: {
      oracleStatusField: 'status', oracleReasonField: 'reason', oracleCursorField: 'cursor', oracleRowsField: 'items', comparison: 'translated-label',
      translations: [
        complete,
        translation('not-found-authoritative', 'missing-or-outside-list-context', 'null', 'empty', 'complete'),
        translation('incomplete', 'child-bound', 'any', 'any', 'refused', 'SNAPBACK_QUERY_COST_BOUND_EXCEEDED'),
        translation('incomplete', 'label-membership-bound', 'any', 'any', 'refused', 'SNAPBACK_QUERY_COST_BOUND_EXCEEDED'),
        translation('refreshing', 'search-document-bound-or-epoch-missing', 'any', 'any', null, null, 'transient provider state, not a graph result label'),
      ],
    },
    continuation: [{ graphNodeId: root, oracleHasMoreField: 'hasMore', oracleCursorField: 'cursor', comparison: 'same-next-page-rows' }],
    excluded: [
      { oracleField: 'items[*].issue.projectID', reason: 'root project partition is already fixed by the list context' },
      { oracleField: 'items[*].issue.creatorID', reason: 'creator identity is not part of the admitted point/list projection' },
      { oracleField: 'items[*].issue.visibility', reason: 'visibility is an authorization input, not a projected result leaf' },
      { oracleField: 'items[*].labels[*].projectID', reason: 'label project partition is already fixed by the root issue' },
      { oracleField: 'examined', reason: 'opaque-handler physical work, not a graph result leaf' },
      { oracleField: 'total', reason: 'full filtered count outside the bounded declared projection' },
      { oracleField: 'searchEpoch', reason: 'provider diagnostic/version metadata, not a projected graph field' },
    ],
  };
}

function compactIssue(value) {
  return {
    id: value.id, shortID: value.shortID, title: value.title, open: value.open,
    modified: value.modified, created: value.created, description: value.description,
  };
}

function compactNullable(value, fields) {
  if (value === null) return null;
  return Object.fromEntries(fields.map(field => [field, value[field]]));
}

function labelsInGraphOrder(values, labelRows) {
  const physicalBySource = new Map(labelRows.map(row => [row.id, row._id]));
  assert.equal(physicalBySource.size, labelRows.length, 'label source ids are unique');
  return [...values].sort((left, right) => {
    const leftID = physicalBySource.get(left.id);
    const rightID = physicalBySource.get(right.id);
    assert(leftID && rightID, 'every oracle label resolves to a physical graph label id');
    return leftID < rightID ? -1 : leftID > rightID ? 1 : 0;
  });
}

function mapListRows(items, labelRows) {
  return items.map(item => ({
    issue: compactIssue(item.issue),
    labels: labelsInGraphOrder(item.labels, labelRows)
      .map(value => ({label: {id: value.id, name: value.name}})),
    viewState: compactNullable(item.viewState, ['viewed']),
  }));
}

function mapDetailRows(value, labelRows) {
  if (value === null) return [];
  return [{
    issueId: value.issue.id,
    issueShortID: value.issue.shortID,
    issueTitle: value.issue.title,
    issueOpen: value.issue.open,
    issueModified: value.issue.modified,
    issueCreated: value.issue.created,
    issueDescription: value.issue.description,
    project: compactNullable(value.project, ['id', 'name']),
    creator: compactNullable(value.creator, ['id', 'login']),
    assignee: compactNullable(value.assignee, ['id', 'login']),
    labels: labelsInGraphOrder(value.labels, labelRows)
      .map(labelValue => ({label: {id: labelValue.id, name: labelValue.name}})),
    comments: value.comments.map(row => ({
      id: row.comment.id, created: row.comment.created, body: row.comment.body,
    })),
    notificationState: compactNullable(value.notificationState, ['subscribed']),
    viewState: compactNullable(value.viewState, ['viewed']),
  }];
}

function mapCommentPageRows(items) {
  return items.map(row => ({
    id: row.comment.id, created: row.comment.created, body: row.comment.body,
  }));
}

function applyTranslation(entry, status, reason, cursor, rows) {
  assert(Array.isArray(rows), `${entry.oracleRowsField} must resolve to rows`);
  const cursorClass = cursor === null ? 'null' : 'non-null';
  const rowsClass = rows.length === 0 ? 'empty' : 'non-empty';
  const matches = entry.translations.filter(candidate => (
    candidate.oracleStatus === status
    && candidate.oracleReason === reason
    && (candidate.when.cursor === 'any' || candidate.when.cursor === cursorClass)
    && (candidate.when.rows === 'any' || candidate.when.rows === rowsClass)
  ));
  assert.equal(matches.length, 1, `translation ${status}/${reason}/${cursorClass}/${rowsClass}`);
  return {
    oracleStatus: status, oracleReason: reason,
    when: {cursor: cursorClass, rows: rowsClass},
    graphLabel: matches[0].graphLabel,
    graphRefusalReason: matches[0].graphRefusalReason,
    excludedReason: matches[0].excludedReason,
  };
}

function composeLabels(translations) {
  const labels = translations
    .filter(entry => entry.excludedReason === null)
    .map(entry => entry.graphLabel);
  if (labels.includes('refused')) return 'refused';
  if (labels.includes('unknown')) return 'unknown';
  if (labels.includes('window')) return 'window';
  if (labels.includes('prefix')) return 'prefix';
  return 'complete';
}

function expectedFromOracle(query, result, map, options = {}) {
  assert.equal(result.length, 1, `${query} harness returns one envelope`);
  const envelope = result[0];
  const items = options.items ?? envelope.items;
  const detailValue = options.detailValue ?? envelope.value;
  const rows = query === 'issueDetail'
    ? mapDetailRows(detailValue, options.labelRows)
    : mapListRows(items, options.labelRows);
  const orderedRootIds = query === 'issueDetail'
    ? (envelope.value === null ? [] : [envelope.value.issue.id])
    : items.map(item => item.issue.id);
  const nodeCompleteness = [];
  if (query === 'issueDetail') {
    const labelsMap = map.nodeCompleteness.find(entry => entry.oracleStatusField === 'value.labelsCompleteness');
    const commentsMap = map.nodeCompleteness.find(entry => entry.oracleStatusField === 'value.commentsCompleteness');
    if (envelope.value === null) {
      nodeCompleteness.push({graphNodeId: labelsMap.graphNodeId, rows: []});
      nodeCompleteness.push({graphNodeId: commentsMap.graphNodeId, rows: []});
    } else {
      nodeCompleteness.push({
        graphNodeId: labelsMap.graphNodeId,
        rows: [{rootId: envelope.value.issue.id, ...applyTranslation(
          labelsMap, envelope.value.labelsCompleteness, null,
          envelope.value.commentsCursor, envelope.value.labels,
        )}],
      });
      nodeCompleteness.push({
        graphNodeId: commentsMap.graphNodeId,
        rows: [{rootId: envelope.value.issue.id, ...applyTranslation(
          commentsMap, envelope.value.commentsCompleteness, null,
          envelope.value.commentsCursor, envelope.value.comments,
        )}],
      });
    }
  } else {
    const labelsMap = map.nodeCompleteness[0];
    nodeCompleteness.push({
      graphNodeId: labelsMap.graphNodeId,
      rows: items.map(item => ({
        rootId: item.issue.id,
        ...applyTranslation(labelsMap, item.labelsCompleteness, null, envelope.cursor, item.labels),
      })),
    });
  }
  const outerRows = query === 'issueDetail' ? (envelope.value === null ? [] : envelope.value.comments) : items;
  const outerCursor = query === 'issueDetail' ? (envelope.value?.commentsCursor ?? null) : envelope.cursor;
  const outerStatusReason = applyTranslation(
    map.outerStatusReason, envelope.status, envelope.reason, outerCursor, outerRows,
  );
  const translations = [
    outerStatusReason,
    ...nodeCompleteness.flatMap(entry => entry.rows),
  ];
  const graphCompleteness = composeLabels(translations);
  const refusalReasons = [...new Set(translations
    .map(entry => entry.graphRefusalReason)
    .filter(reason => reason !== null))];
  assert(refusalReasons.length <= 1, `${query} has one top-level graph refusal reason`);
  if (graphCompleteness === 'refused') {
    assert.equal(refusalReasons.length, 1, `${query} refused result names its reason`);
    return {
      basis: 'oracle-mapped-target; admitted structural declaration is not executed at G0',
      kind: 'result', label: 'refused', graphCompleteness, resultBytes: null, digest: null,
      orderedRootIds: [], resultLength: 0, nodeCompleteness, outerStatusReason,
      continuation: [], refusalReason: refusalReasons[0],
    };
  }
  const continuation = map.continuation.map(entry => {
    const hasMore = query === 'issueDetail'
      ? envelope.value !== null && envelope.value.commentsCursor !== null
      : envelope.hasMore;
    const nextRows = options.nextRows ?? (options.nextResult
      ? mapListRows(options.nextResult[0].items, options.labelRows)
      : []);
    return {
      graphNodeId: entry.graphNodeId, hasMore,
      cursorPresent: outerCursor !== null,
      comparison: entry.comparison,
      nextPageResultBytes: JSON.stringify(nextRows),
      nextPageDigest: digestBytes(JSON.stringify(nextRows)),
    };
  });
  const resultBytes = JSON.stringify(rows);
  return {
    basis: 'oracle-mapped-target; admitted structural declaration is not executed at G0',
    kind: 'result', label: graphCompleteness,
    resultBytes, digest: digestBytes(resultBytes), orderedRootIds,
    resultLength: rows.length, nodeCompleteness, outerStatusReason,
    graphCompleteness, continuation, refusalReason: null,
  };
}

function windowVector(
  carrier,
  direction = 'forward',
  evaluatedParentKeys = [],
  options = {},
) {
  return carrier.normalizedPlan.nodes
    .filter(node => node.kind === 'root-window' || (node.kind === 'bounded-to-many' && node.page.kind === 'demand'))
    .map(node => {
      const cost = carrier.normalizedPlan.queryCost.graph.nodes.find(entry => entry.nodeId === node.nodeId);
      const parent = node.kind === 'root-window'
        ? null
        : carrier.normalizedPlan.nodes.find(entry => entry.nodeId === node.parentNodeId);
      const intervals = node.kind === 'root-window' ? [{
        parentKey: null,
        window: {
          order: node.order, direction,
          lower: { kind: 'unbounded' }, upper: { kind: 'unbounded' },
          take: options.rootTake ?? 1,
        },
      }] : evaluatedParentKeys.map(parentKey => {
        assert.deepEqual(parentKey.table, parent.table, `${node.nodeId} parent key uses the physical parent table`);
        return {
          parentKey,
          window: {
            order: node.order, direction,
            lower: { kind: 'unbounded' }, upper: { kind: 'unbounded' },
            take: cost.maxChildrenPerParent,
          },
        };
      });
      return {
        nodeId: node.nodeId,
        intervals,
      };
    });
}

function invocation(
  carrier,
  args,
  principal = 'principal_ordinary',
  epoch = 0,
  functionName = 'listIssueByID',
  evaluatedParentKeys = [],
  windowOptions = {},
) {
  const windows = windowVector(
    carrier,
    windowOptions.direction ?? 'forward',
    evaluatedParentKeys,
    windowOptions,
  );
  const instancePreimage = {
    format: 'snapback.graph-instance.v1', graphPlanHash: carrier.planHash,
    argsDigest: domainHash('snapback:materialization-args:v1:', args), windows,
  };
  const instanceHash = domainHash('snapback:graph-instance:v1:', instancePreimage);
  return {
    planHash: carrier.planHash, args, windows,
    materialization: {
      format: 'snapback.graph-materialization.v1', appId: 'zerobugs-graph-g0-corpus',
      databaseId: 'g0-corpus-fixtures-v1', deploymentId: 'g0-stage-b',
      targetProfileId: 'local', activationHash: ZERO_HASH,
      function: {
        artifactKind: 'functionReference', schemaVersion: 'snapback.v1',
        appId: 'zerobugs-graph-g0-corpus', id: `graph-${carrier.planHash.slice(-16)}`,
        name: functionName, kind: 'LiveQuery', implementationHash: ZERO_HASH,
        argsContractHash: ZERO_HASH, resultContractHash: carrier.normalizedPlan.resultContractHash,
        expectedGeneration: { schemaVersion: 'snapback.v1', appId: 'zerobugs-graph-g0-corpus', schemaHash: 'corpus-schema-v1', bundleHash: 'corpus-bundle-v1', inputsHash: 'corpus-inputs-v1' },
      },
      graphInstanceHash: instanceHash,
    },
    partition: {
      format: 'snapback.graph-authority-partition.v1',
      graphPlanHash: carrier.planHash,
      class2: resolvedClass2Inputs(carrier, args, principal),
      class3: {
        format: 'snapback.authority-partition.v1',
        principalDataScope: {
          authMode: 'sessions', userId: principal,
          authorizationStreamIncarnation: 'g0-corpus-stream-v1',
        },
        authorityInstanceId: `g0-authority-${principal}`,
        authFingerprint: domainHash('snapback:g0-corpus-auth-fingerprint:v1:', {principal}),
        tenantId: null, providerId: 'g0-corpus-provider', delegation: null,
      },
    },
    authorizationVersion: { incarnation: 'g0-corpus-authorization-v1', epoch },
    evaluationCut: 1,
  };
}

function graphArgumentValue(carrier, call, expression) {
  if (Object.hasOwn(expression, 'Literal')) return expression.Literal;
  const argument = carrier.normalizedPlan.arguments
    .find(candidate => candidate.argumentId === expression.Arg);
  assert(argument, `graph argument ${expression.Arg} is declared`);
  return call.args[argument.name];
}

function graphFilterMatches(carrier, call, row, filter) {
  const expected = graphArgumentValue(carrier, call, filter.value);
  if (filter.op === 'Eq') return row[filter.field] === expected;
  if (filter.op === 'In') {
    return Array.isArray(expected) && expected.some(value => canonical(value) === canonical(row[filter.field]));
  }
  assert.fail(`freezer does not model graph filter operator ${filter.op}`);
}

function graphJoinMatches(parent, child, join) {
  return join.every(equality => (
    parent[equality.rootField] !== null
    && parent[equality.rootField] !== undefined
    && child[equality.joinedField] === parent[equality.rootField]
  ));
}

function graphCompareValue(left, right) {
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  return left < right ? -1 : 1;
}

function graphSortRows(rows, order, direction = 'forward') {
  const reversed = direction === 'backward';
  return [...rows].sort((left, right) => {
    for (const component of order) {
      const declared = component.direction === 'Desc' ? -1 : 1;
      const compared = graphCompareValue(left[component.field], right[component.field]);
      if (compared !== 0) return compared * declared * (reversed ? -1 : 1);
    }
    // LLP 0007/0209: physical `_id` is always the ascending tie rule, even
    // for backward traversal.
    return graphCompareValue(left._id, right._id);
  });
}

function graphPhysicalKey(node, row) {
  assert.equal(typeof row?._id, 'string', `${node.nodeId} row has physical _id`);
  return {table: node.table, id: row._id};
}

function graphApplicationId(row) {
  return row.id ?? row.sourceIssueID ?? row._id;
}

function graphChildKey(parentNodeId, parent, childNodeId) {
  return `${parentNodeId}\u0000${parent.key.id}\u0000${childNodeId}`;
}

function frozenGraphState(carrier, call, tables, orderedRootIds) {
  const nodes = carrier.normalizedPlan.nodes;
  const root = nodes.find(node => node.kind === 'root-window');
  const byNode = new Map();
  const childrenBy = new Map();
  const existenceBy = new Map();
  const proofEvidence = new Map();
  const rootRows = orderedRootIds.map(id => {
    const row = (tables[root.table] ?? []).find(candidate => graphApplicationId(candidate) === id);
    assert(row, `${root.nodeId} ordered application id ${id} resolves to a physical row`);
    return {row, key: graphPhysicalKey(root, row), rootId: id};
  });
  byNode.set(root.nodeId, rootRows);
  proofEvidence.set(root.nodeId, {
    interval: {lower: {kind: 'unbounded'}, upper: {kind: 'unbounded'}},
    consumed: rootRows.length, hasMore: false, sourceExhausted: true,
  });

  const principal = call.partition.class3.principalDataScope.userId;
  const authority = authorityFact(principal);
  for (const node of nodes.filter(candidate => !['root-window', 'closed-projection'].includes(candidate.kind))) {
    const parents = byNode.get(node.parentNodeId) ?? [];
    const output = [];
    if (node.kind === 'equality-to-one') {
      const rows = [];
      for (const parent of parents) {
        const matches = (tables[node.table] ?? []).filter(row => (
          graphJoinMatches(parent.row, row, node.joinOn)
          && (node.filters ?? []).every(filter => graphFilterMatches(carrier, call, row, filter))
        ));
        assert(matches.length <= 1, `${node.nodeId} equality edge is unique`);
        const children = matches.map(row => ({row, key: graphPhysicalKey(node, row), rootId: parent.rootId}));
        output.push(...children);
        childrenBy.set(graphChildKey(node.parentNodeId, parent, node.nodeId), children);
        rows.push({parentKey: parent.key, found: children.length === 1});
      }
      rows.sort((left, right) => canonical(left.parentKey).localeCompare(canonical(right.parentKey)));
      proofEvidence.set(node.nodeId, {rows});
    } else if (node.kind === 'bounded-to-many') {
      const ranges = [];
      for (const parent of parents) {
        const interval = node.page.kind === 'literal'
          ? {window: node.page}
          : call.windows.find(window => window.nodeId === node.nodeId)?.intervals
            .find(candidate => canonical(candidate.parentKey) === canonical(parent.key));
        assert(interval, `${node.nodeId} has a frozen interval for ${canonical(parent.key)}`);
        const window = interval.window;
        const matches = graphSortRows(
          (tables[node.table] ?? []).filter(row => (
            graphJoinMatches(parent.row, row, node.joinOn)
            && (node.filters ?? []).every(filter => graphFilterMatches(carrier, call, row, filter))
          )),
          node.order,
          window.direction,
        );
        assert(matches.length <= window.take, `${node.nodeId} complete freeze does not truncate a parent range`);
        const children = matches.map(row => ({row, key: graphPhysicalKey(node, row), rootId: parent.rootId}));
        output.push(...children);
        childrenBy.set(graphChildKey(node.parentNodeId, parent, node.nodeId), children);
        ranges.push({parentKey: parent.key, consumed: children.length, cap: window.take, hasMore: false});
      }
      ranges.sort((left, right) => canonical(left.parentKey).localeCompare(canonical(right.parentKey)));
      proofEvidence.set(node.nodeId, {ranges});
    } else if (node.kind === 'exists-semi-join') {
      const rows = [];
      const argument = node.argumentId === null || node.argumentId === undefined
        ? null
        : carrier.normalizedPlan.arguments.find(candidate => candidate.argumentId === node.argumentId);
      const values = argument ? call.args[argument.name] : [null];
      for (const parent of parents) {
        let found = node.mode === 'all' && values.length === 0;
        if (!found) {
          const probes = node.mode === 'all' ? values : [null];
          found = probes.every(value => {
            const filters = (node.filters ?? []).map(filter => (
              node.mode === 'all' && filter.op === 'In'
                ? {...filter, op: 'Eq', value: {Literal: value}}
                : filter
            ));
            assert(!node.edge.targetTable, `${node.nodeId} complete freezer helper expects a direct edge`);
            return (tables[node.edge.table] ?? []).some(row => (
              graphJoinMatches(parent.row, row, node.edge.joinOn)
              && filters.every(filter => graphFilterMatches(carrier, call, row, filter))
            ));
          });
        }
        existenceBy.set(graphChildKey(node.parentNodeId, parent, node.nodeId), found);
        rows.push({parentKey: parent.key, existenceBit: found});
      }
      rows.sort((left, right) => canonical(left.parentKey).localeCompare(canonical(right.parentKey)));
      proofEvidence.set(node.nodeId, {rows});
    } else if (node.kind === 'principal-bound') {
      const rows = [];
      const bindingFound = authority !== undefined;
      const boundPrincipal = bindingFound ? authority.userID : null;
      for (const parent of parents) {
        const matches = boundPrincipal === null ? [] : (tables[node.table] ?? []).filter(row => (
          graphJoinMatches(parent.row, row, node.parentJoin)
          && row[node.principalField] === boundPrincipal
          && (node.filters ?? []).every(filter => graphFilterMatches(carrier, call, row, filter))
        ));
        assert(matches.length <= 1, `${node.nodeId} principal edge is unique`);
        const children = matches.map(row => ({row, key: graphPhysicalKey(node, row), rootId: parent.rootId}));
        output.push(...children);
        childrenBy.set(graphChildKey(node.parentNodeId, parent, node.nodeId), children);
        rows.push({parentKey: parent.key, bindingFound, targetFound: children.length === 1});
      }
      rows.sort((left, right) => canonical(left.parentKey).localeCompare(canonical(right.parentKey)));
      proofEvidence.set(node.nodeId, {rows});
    } else {
      assert.fail(`complete freezer helper does not model ${node.kind}`);
    }
    byNode.set(node.nodeId, output);
  }
  return {root, roots: rootRows, byNode, childrenBy, existenceBy, proofEvidence};
}

function assertFrozenProofsMatchBytes(carrier, resultBytes, state, nodeCompleteness) {
  const projected = JSON.parse(resultBytes);
  assert.equal(projected.length, state.roots.length, 'root proof consumed count matches frozen result rows');
  const proofs = new Map(nodeCompleteness.map(proof => [proof.nodeId, proof]));
  const nodes = new Map(carrier.normalizedPlan.nodes.map(node => [node.nodeId, node]));

  for (const node of nodes.values()) {
    if (!node.parentNodeId) continue;
    const parents = state.byNode.get(node.parentNodeId) ?? [];
    const evidence = proofs.get(node.nodeId)?.proof;
    const proofRows = evidence?.rows ?? evidence?.ranges ?? [];
    assert.deepEqual(
      proofRows.map(row => row.parentKey),
      [...parents].map(parent => parent.key)
        .sort((left, right) => canonical(left).localeCompare(canonical(right))),
      `${node.nodeId} proof cites every immediate physical parent and no root substitute`,
    );
  }

  const verifyObject = (object, bytes, scope) => {
    assert(bytes && typeof bytes === 'object' && !Array.isArray(bytes), 'projected object bytes exist');
    for (const field of object.fields) {
      const value = field.value;
      if (value.kind === 'object') {
        const parent = scope.get(value.object.scopeNodeId);
        assert(parent, `${field.name} projection has its immediate parent scope`);
        const children = state.childrenBy.get(graphChildKey(value.object.scopeNodeId, parent, value.nodeId)) ?? [];
        const proofRow = proofs.get(value.nodeId).proof.rows
          .find(row => canonical(row.parentKey) === canonical(parent.key));
        const proofFound = Object.hasOwn(proofRow, 'found') ? proofRow.found : proofRow.targetFound;
        assert.equal(proofFound, bytes[field.name] !== null, `${field.name} found proof matches frozen nullability`);
        assert.equal(children.length === 1, bytes[field.name] !== null, `${field.name} child bytes match frozen nullability`);
        if (children.length === 1) {
          verifyObject(value.object, bytes[field.name], new Map(scope).set(value.nodeId, children[0]));
        }
      } else if (value.kind === 'array') {
        const parent = scope.get(object.scopeNodeId);
        assert(parent, `${field.name} projection has its immediate parent scope`);
        const children = state.childrenBy.get(graphChildKey(object.scopeNodeId, parent, value.scopeNodeId)) ?? [];
        assert(Array.isArray(bytes[field.name]), `${field.name} freezes array bytes`);
        assert.equal(children.length, bytes[field.name].length, `${field.name} consumed rows match frozen array bytes`);
        const range = proofs.get(value.scopeNodeId).proof.ranges
          .find(row => canonical(row.parentKey) === canonical(parent.key));
        assert.equal(range.consumed, bytes[field.name].length, `${field.name} consumed proof matches frozen array bytes`);
        children.forEach((child, index) => {
          verifyObject(value.item, bytes[field.name][index], new Map(scope).set(value.scopeNodeId, child));
        });
      } else if (value.kind === 'exists') {
        const parent = scope.get(object.scopeNodeId);
        const bit = state.existenceBy.get(graphChildKey(object.scopeNodeId, parent, value.nodeId)) ?? false;
        assert.equal(bit, bytes[field.name], `${field.name} existence proof matches frozen bytes`);
      }
    }
  };
  const projection = carrier.normalizedPlan.nodes.find(node => node.kind === 'closed-projection');
  state.roots.forEach((root, index) => {
    verifyObject(projection.object, projected[index], new Map([[state.root.nodeId, root]]));
  });
}

function exerciseFrozenProofSelfChecks(carrier, resultBytes, state, nodeCompleteness) {
  if (!freezerProofSelfChecks.consumed) {
    const bounded = nodeCompleteness.find(proof => proof.proof.ranges?.length > 0);
    if (bounded) {
      const contradictory = deepClone(nodeCompleteness);
      contradictory.find(proof => proof.nodeId === bounded.nodeId).proof.ranges[0].consumed += 1;
      assert.throws(
        () => assertFrozenProofsMatchBytes(carrier, resultBytes, state, contradictory),
        /consumed proof matches frozen array bytes/u,
      );
      freezerProofSelfChecks.consumed = true;
    }
  }
  if (!freezerProofSelfChecks.found) {
    const optionalNode = carrier.normalizedPlan.nodes.find(node => (
      node.kind === 'equality-to-one' && node.presence === 'optional'
    ));
    const proof = optionalNode && nodeCompleteness.find(entry => (
      entry.nodeId === optionalNode.nodeId && entry.proof.rows.length > 0
    ));
    if (proof) {
      const contradictory = deepClone(nodeCompleteness);
      const row = contradictory.find(entry => entry.nodeId === proof.nodeId).proof.rows[0];
      row.found = !row.found;
      assert.throws(
        () => assertFrozenProofsMatchBytes(carrier, resultBytes, state, contradictory),
        /found proof matches frozen nullability/u,
      );
      freezerProofSelfChecks.found = true;
    }
  }
  if (!freezerProofSelfChecks.parentLinkage) {
    const nested = carrier.normalizedPlan.nodes.find(node => (
      node.parentNodeId
      && carrier.normalizedPlan.nodes.find(parent => parent.nodeId === node.parentNodeId)?.parentNodeId
    ));
    const proof = nested && nodeCompleteness.find(entry => (
      entry.nodeId === nested.nodeId && (entry.proof.rows ?? entry.proof.ranges)?.length > 0
    ));
    if (proof) {
      const contradictory = deepClone(nodeCompleteness);
      const evidence = contradictory.find(entry => entry.nodeId === proof.nodeId).proof;
      (evidence.rows ?? evidence.ranges)[0].parentKey.id = '__wrong_root_substitute__';
      assert.throws(
        () => assertFrozenProofsMatchBytes(carrier, resultBytes, state, contradictory),
        /immediate physical parent/u,
      );
      freezerProofSelfChecks.parentLinkage = true;
    }
  }
}

function completeResult(carrier, call, tables, resultBytes = '[]', orderedRootIds = []) {
  const materializationHash = domainHash('snapback:graph-materialization:v1:', call.materialization);
  const partitionHash = domainHash('snapback:graph-authority-partition:v1:', call.partition);
  const tuple = {
    materializationHash, partitionHash,
    authorizationVersion: call.authorizationVersion, evaluationCut: call.evaluationCut,
  };
  const state = frozenGraphState(carrier, call, tables, orderedRootIds);
  const nodes = [];
  for (const node of carrier.normalizedPlan.nodes.filter(node => node.kind !== 'closed-projection')) {
    const evidence = state.proofEvidence.get(node.nodeId);
    const proof = { ...tuple, kind: node.kind, label: 'complete', ...evidence };
    nodes.push({ nodeId: node.nodeId, nodeKind: node.kind, label: 'complete', proofClass: node.kind === 'root-window' ? 'whole-source' : node.kind === 'equality-to-one' ? 'unique-point' : node.kind === 'bounded-to-many' ? 'parent-ranges' : node.kind === 'exists-semi-join' ? 'complete-membership' : 'principal-point', proof });
  }
  const citations = nodes.map(entry => ({
    nodeId: entry.nodeId, nodeKind: entry.nodeKind, label: entry.label,
    proofHash: domainHash('snapback:graph-node-completeness:v1:', entry),
  }));
  const composition = { ...tuple, kind: 'graph-composition', label: 'complete', nodes: citations, allComplete: true };
  const projection = carrier.normalizedPlan.nodes.find(node => node.kind === 'closed-projection');
  nodes.push({ nodeId: projection.nodeId, nodeKind: projection.kind, label: 'complete', proofClass: 'projection-composition', proof: { ...tuple, kind: 'closed-projection', label: 'complete', composition } });
  // This is deliberately a freezer gate rather than a Rust-runner assertion:
  // a contradictory expectation must never be written to the corpus.
  assertFrozenProofsMatchBytes(carrier, resultBytes, state, nodes);
  exerciseFrozenProofSelfChecks(carrier, resultBytes, state, nodes);
  return {
    kind: 'result', label: 'complete', resultBytes, orderedRootIds,
    resultLength: orderedRootIds.length, nodeCompleteness: nodes,
    graphCompleteness: { ...tuple, label: 'complete', proofClass: 'all-complete', proof: composition },
    refusalReason: null,
  };
}

function materializedRefusalResult(carrier, call, reason) {
  const materializationHash = domainHash('snapback:graph-materialization:v1:', call.materialization);
  const partitionHash = domainHash('snapback:graph-authority-partition:v1:', call.partition);
  const tuple = {
    materializationHash, partitionHash,
    authorizationVersion: call.authorizationVersion, evaluationCut: call.evaluationCut,
  };
  const nodes = carrier.normalizedPlan.nodes
    .filter(node => node.kind !== 'closed-projection')
    .map(node => ({
      nodeId: node.nodeId, nodeKind: node.kind, label: 'refused', proofClass: 'refusal',
      proof: {...tuple, kind: node.kind, label: 'refused', reason},
    }));
  const citations = nodes.map(entry => ({
    nodeId: entry.nodeId, nodeKind: entry.nodeKind, label: entry.label,
    proofHash: domainHash('snapback:graph-node-completeness:v1:', entry),
  }));
  const composition = {
    ...tuple, kind: 'graph-composition', label: 'refused', nodes: citations,
    primaryReason: reason,
  };
  return {
    kind: 'result', label: 'refused', resultBytes: null, orderedRootIds: [],
    resultLength: 0, nodeCompleteness: nodes,
    graphCompleteness: {...tuple, label: 'refused', proofClass: 'refusal', proof: composition},
    refusalReason: reason,
  };
}

function countDeclaredTieGroups(items, field) {
  let groups = 0;
  for (let start = 0; start < items.length;) {
    let end = start + 1;
    while (end < items.length && items[end].issue[field] === items[start].issue[field]) end += 1;
    if (end - start > 1) groups += 1;
    start = end;
  }
  return groups;
}

function normalizeCommentTiesForGraph(value, commentRows) {
  const normalized = deepClone(value);
  const physicalBySource = new Map(commentRows.map(row => [row.id, row._id]));
  let groups = 0;
  const physicalIdBindings = [];
  for (let start = 0; start < normalized.comments.length;) {
    let end = start + 1;
    while (
      end < normalized.comments.length
      && normalized.comments[end].comment.created === normalized.comments[start].comment.created
    ) end += 1;
    if (end - start > 1) {
      groups += 1;
      physicalIdBindings.push(...normalized.comments.slice(start, end).map(row => {
        const physicalId = physicalBySource.get(row.comment.id);
        assert(physicalId, 'every tied oracle comment resolves to a physical graph comment id');
        return {
          sourceId: row.comment.id,
          physicalId,
          createdAt: row.comment.created,
        };
      }));
      const sorted = normalized.comments.slice(start, end).sort((left, right) => {
        const leftPhysical = physicalBySource.get(left.comment.id);
        const rightPhysical = physicalBySource.get(right.comment.id);
        assert(leftPhysical && rightPhysical, 'every oracle comment resolves to a physical graph comment id');
        return leftPhysical < rightPhysical ? -1 : leftPhysical > rightPhysical ? 1 : 0;
      });
      normalized.comments.splice(start, end - start, ...sorted);
    }
    start = end;
  }
  physicalIdBindings.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  return {value: normalized, groups, physicalIdBindings};
}

function pendingCases(carrier, baseInvocation) {
  const withEpoch = epoch => ({ ...deepClone(baseInvocation), authorizationVersion: { incarnation: 'g0-corpus-authorization-v1', epoch } });
  const withPrincipal = principal => invocation(
    carrier, deepClone(baseInvocation.args), principal, 0, 'listIssueByID',
  );
  const outsideScope = invocation(carrier, {
    sourceIssueID: '__outside_scope__', selectedLabelIDs: [],
  });
  return [
    { caseKind: 'audienceParity', id: 'zerobugs-audience-parity-g2', plan: carrier, invocations: [baseInvocation, withPrincipal('principal_crew')], principals: ['principal_ordinary', 'principal_crew'], expect: { establishment: ['allow', 'allow'], strict: ['allow', 'allow'] } },
    { caseKind: 'scopeMismatch', id: 'zerobugs-scope-mismatch-g2', plan: carrier, invocations: { memberScope: baseInvocation, presentedInstance: outsideScope }, principal: 'principal_ordinary', expect: { classification: 'query-shaped', reason: 'scope-unbound', resultBytes: null } },
    { caseKind: 'authorityTransition', id: 'zerobugs-authority-transition-g2', plan: carrier, invocations: { before: withEpoch(0), after: withEpoch(1) }, principal: 'principal_ordinary', commit: { dataChanges: [], authorityEvents: [{ kind: 'authorization-incarnation-change', cause: 'app-reset' }], afterAuthorizationVersion: { incarnation: 'g0-corpus-authorization-v1', epoch: 1 } }, observed: [{ ordinal: 0, kind: 'fence', authorizationVersion: { incarnation: 'g0-corpus-authorization-v1', epoch: 1 } }, { ordinal: 1, kind: 'delivery', authorizationVersion: { incarnation: 'g0-corpus-authorization-v1', epoch: 1 } }] },
    { caseKind: 'mixedCommit', id: 'zerobugs-mixed-commit-g2', plan: carrier, invocations: { before: withEpoch(0), after: withEpoch(1) }, principal: 'principal_ordinary', commit: { dataChanges: [{ table: 'issue', rowId: '__corpus_issue__' }], authorityEvents: [{ kind: 'authorization-incarnation-change', cause: 'app-reset' }], afterAuthorizationVersion: { incarnation: 'g0-corpus-authorization-v1', epoch: 1 } }, observed: [{ ordinal: 0, kind: 'fence', authorizationVersion: { incarnation: 'g0-corpus-authorization-v1', epoch: 1 } }, { ordinal: 1, kind: 'delivery', authorizationVersion: { incarnation: 'g0-corpus-authorization-v1', epoch: 1 } }] },
  ];
}

function oracleTranslationCoverage(fieldMaps, oracleCases) {
  const matches = (translationRow, actual) => (
    translationRow.oracleStatus === actual.oracleStatus
    && translationRow.oracleReason === actual.oracleReason
    && (translationRow.when.cursor === 'any' || translationRow.when.cursor === actual.when.cursor)
    && (translationRow.when.rows === 'any' || translationRow.when.rows === actual.when.rows)
  );
  const coverage = [];
  for (const [query, map] of Object.entries(fieldMaps)) {
    const queryCases = oracleCases.filter(caseRow => caseRow.query === query);
    const surfaces = [
      {surface: 'outerStatusReason', map: map.outerStatusReason, actual: caseRow => [caseRow.declaredGraph.expected.outerStatusReason]},
      ...map.nodeCompleteness.map(entry => ({
        surface: `node:${entry.graphNodeId}:${entry.oracleStatusField}`,
        map: entry,
        actual: caseRow => caseRow.declaredGraph.expected.nodeCompleteness
          .find(actual => actual.graphNodeId === entry.graphNodeId)?.rows ?? [],
      })),
    ];
    for (const surface of surfaces) {
      for (const [translationIndex, translationRow] of surface.map.translations.entries()) {
        const exercisedBy = queryCases
          .filter(caseRow => surface.actual(caseRow).some(actual => matches(translationRow, actual)))
          .map(caseRow => caseRow.id)
          .sort();
        coverage.push({
          query, surface: surface.surface, translationIndex,
          translation: translationRow, exercisedBy,
          unexercised: exercisedBy.length === 0
            ? 'not produced by the normal or corpus-local G0 opaque-oracle fixtures; retained as a closed translation row'
            : null,
        });
      }
    }
  }
  return coverage;
}

function capturedDependencyVector(carrier, call, tables, orderedRootIds) {
  const root = carrier.normalizedPlan.nodes.find(node => node.kind === 'root-window');
  const state = frozenGraphState(carrier, call, tables, orderedRootIds);
  const instanceHash = call.materialization.graphInstanceHash;
  const partitionHash = domainHash('snapback:graph-authority-partition:v1:', call.partition);
  const common = node => ({
    format: 'snapback.graph-captured-read.v1', graphPlanHash: carrier.planHash,
    instanceHash, nodeId: node.nodeId, nodeKind: node.kind,
    authorityClass: node.authority.declaredClass,
  });
  const captures = [];
  for (const node of carrier.normalizedPlan.nodes) {
    if (node.kind === 'root-window') {
      const interval = call.windows.find(window => window.nodeId === node.nodeId).intervals[0];
      captures.push({...common(node), dependency: {
        kind: 'root-range', table: node.table, index: node.accessIndex,
        predicate: node.filters, order: node.order, limit: interval.window.take,
        resultCount: orderedRootIds.length, boundary: null, complete: true,
      }});
    } else if (node.kind === 'equality-to-one') {
      for (const parent of state.byNode.get(node.parentNodeId) ?? []) {
        const children = state.childrenBy.get(graphChildKey(node.parentNodeId, parent, node.nodeId)) ?? [];
        const lookupKey = node.joinOn.map(equality => parent.row[equality.rootField]);
        captures.push({...common(node), dependency: lookupKey.some(value => value == null)
          ? {
              kind: 'parent-lookup-skipped', table: node.table, index: node.accessIndex,
              parentKey: parent.key, reason: 'null-or-omitted-key',
            }
          : {
              kind: 'parent-point', table: node.table, index: node.accessIndex,
              parentKey: parent.key, lookupKey,
              childKey: children.length === 0 ? null : children[0].key,
              found: children.length === 1, rowVersion: children.length === 0 ? null : 1,
            }});
      }
    } else if (node.kind === 'bounded-to-many') {
      for (const parent of state.byNode.get(node.parentNodeId) ?? []) {
        const children = state.childrenBy.get(graphChildKey(node.parentNodeId, parent, node.nodeId)) ?? [];
        const interval = node.page.kind === 'literal'
          ? {window: node.page}
          : call.windows.find(window => window.nodeId === node.nodeId).intervals
            .find(candidate => canonical(candidate.parentKey) === canonical(parent.key));
        captures.push({...common(node), dependency: {
        kind: 'parent-range', table: node.table, index: node.accessIndex, parentKey: parent.key,
        predicate: node.filters ?? [], order: node.order,
        limit: interval.window.take, resultCount: children.length, boundary: null, complete: true,
      }});
      }
    } else if (node.kind === 'exists-semi-join') {
      const edge = node.edge;
      const direct = edge.targetTable === undefined;
      const tables = direct ? [edge.table] : [edge.table, edge.targetTable];
      const indexes = direct ? [edge.accessIndex] : [edge.parentIndex, edge.targetIndex];
      const argumentName = carrier.normalizedPlan.arguments
        .find(argument => argument.argumentId === node.argumentId)?.name;
      for (const parent of state.byNode.get(node.parentNodeId) ?? []) captures.push({...common(node), dependency: {
        kind: 'membership', tables, indexes, parentKey: parent.key,
        argumentId: node.argumentId,
        ...(node.argumentId === null ? {} : {argumentDigest: domainHash('snapback:g0-corpus-argument:v1:', call.args[argumentName])}),
        matchedCount: Number(state.existenceBy.get(graphChildKey(node.parentNodeId, parent, node.nodeId)) ?? false), complete: true,
      }});
    } else if (node.kind === 'principal-bound') {
      for (const parent of state.byNode.get(node.parentNodeId) ?? []) {
        const children = state.childrenBy.get(graphChildKey(node.parentNodeId, parent, node.nodeId)) ?? [];
        captures.push({...common(node), dependency: {
        kind: 'principal-field', table: node.table, index: node.accessIndex,
        partitionHash, field: node.principalField,
        valueDigest: domainHash('snapback:g0-corpus-principal-value:v1:', call.partition.class3.principalDataScope.userId),
        found: children.length === 1,
      }});
      }
    } else if (node.kind === 'closed-projection') {
      captures.push({...common(node), dependency: {
        kind: 'projection',
        sourceNodeIds: carrier.normalizedPlan.nodes
          .filter(source => source.kind !== 'closed-projection')
          .map(source => source.nodeId),
      }});
    }
  }
  return captures;
}

function frozenWorld(identity, tables, input, sliceTable) {
  assert.notEqual(identity, 'normal-seed-v1');
  const tableDigests = Object.fromEntries(Object.keys(tables).sort().map(table => [
    table, digestBytes(canonical(tables[table])),
  ]));
  const inputDigest = digestBytes(canonical(input));
  const fixtureDigest = digestBytes(canonical({tableDigests, inputDigest}));
  return {
    identity, fixtureDigest,
    identityDigest: digestBytes(canonical({identity, fixtureDigest})),
    inputDigest, tableDigests, sliceTableRows: tables[sliceTable],
  };
}

function maximumRowsPerKey(rows, key) {
  const counts = new Map();
  for (const row of rows) counts.set(row[key], (counts.get(row[key]) ?? 0) + 1);
  return Math.max(0, ...counts.values());
}

function boundDerivation(carriers, measurements, tables) {
  const receipt = readJson(join(REPO_ROOT, 'demos/zerobugs/manifest/large-seed42-v1.receipt.json'));
  const large = receipt.tables ?? receipt.counts ?? receipt;
  // The compiled control fixture layers policy-extension-v1 onto the ordinary
  // GitHub seed. §2.6's named normal facts are the base fixture maxima, so
  // remove only the extension's stable source-id namespace for this table.
  const normalIssues = tables.issue.filter(row => !row.id.startsWith('zbav1_'));
  const normalComments = tables.comment.filter(row => !row.id.startsWith('zbav1_'));
  const normal = {
    users: tables.user.length,
    issues: normalIssues.length,
    comments: normalComments.length,
    labels: tables.label.length,
    issueLabelEdges: tables.issueLabelRead.length,
    maxCommentsPerIssue: maximumRowsPerKey(normalComments, 'issueID'),
    maxLabelsPerIssue: maximumRowsPerKey(tables.issueLabelRead, 'issueID'),
  };
  assert.deepEqual(normal, {
    users: 14, issues: 516, comments: 924, labels: 30,
    issueLabelEdges: 603, maxCommentsPerIssue: 21, maxLabelsPerIssue: 5,
  }, 'normal fixture maxima match the commissioned facts');
  const largeFacts = {
    users: large.user,
    projects: large.project,
    issues: large.issue,
    comments: large.comment,
    labels: large.label,
    issueLabelEdges: large.issueLabel,
    receiptDigest: digestBytes(readFileSync(join(REPO_ROOT, 'demos/zerobugs/manifest/large-seed42-v1.receipt.json'))),
  };
  assert.deepEqual(
    Object.fromEntries(Object.entries(largeFacts).filter(([field]) => field !== 'receiptDigest')),
    { users: 100, projects: 100, issues: 1_000_000, comments: 2_527_886, labels: 4_810, issueLabelEdges: 2_000_370 },
    'large receipt totals match the commissioned facts',
  );
  const facts = {
    normal,
    large: largeFacts,
    documentedPerIssueDistribution: {
      labels: {method: 'uniform integer draw in the closed interval 1..3', maximum: 3},
      comments: {
        method: 'floor of a seeded exponential draw; the distribution has no finite per-issue ceiling',
        obtainableReceiptCeiling: large.comment,
        exactSeed42Maximum: 'requires the preserved CSV shards',
      },
      hotWorkingSet: {method: 'manifest-defined greatest-project interval truncated to W', maximum: 1_000},
    },
    source: {
      normalPolicyExtensionExcluded: 'stable source ids beginning zbav1_',
      receiptShape: Object.keys(large).sort(), largeCsvAvailable: existsSync(LARGE_ROOT),
    },
  };
  const queryRows = {};
  for (const [query, carrier] of Object.entries(carriers)) {
    const plan = carrier.normalizedPlan;
    const logical = plan.queryCost.graph;
    const wrapFields = (record, reason) => Object.fromEntries(Object.entries(record).map(
      ([field, value]) => {
        const detail = reason(field, value);
        return [field, {value, ...(typeof detail === 'string' ? {derivation: detail} : detail)}];
      },
    ));
    const provisional = (derivation, command = LARGE_SPOT_CHECK_COMMAND) => ({
      derivation, provisional: true, validationCommand: command,
    });
    const fixtureReason = (field, value, node = null) => {
      if (field === 'maxRootRowsPerPage') {
        return value === 1
          ? 'point/detail source-id lookup emits at most one root row; H=1'
          : provisional('hot-recent-v1 defines W as 1,000 filtered roots; retain the portable 1,024 boundary (H=1.024)', HOT_SPOT_CHECK_COMMAND);
      }
      if (field === 'maxChildrenPerParent' && value === 16) return 'max(normal label edges per issue 5, documented generator closed maximum 3) × H=3.2 => 16';
      if (field === 'maxChildrenPerParent' && value === 1_024) return provisional('the control refuses the collection at exactly 1,024 comments; normal maximum is 21, while the documented floored-exponential generator has no finite per-issue ceiling and the receipt supplies only the 2,527,886-row absolute ceiling');
      if (field === 'maxArgumentExpansion' && value === 16) return 'maximum selected-label collection length 16 × H=1';
      if (field === 'maxWindowPages' && query === 'issueListV2') return provisional('ceil(max currently obtainable filtered interval max(normal project 516, manifest-defined hot W 1,000) / 1,024) = 1; the large selected-project full interval is not the whole-table 1,000,000-row receipt count and awaits zb5');
      if (field === 'maxWindowPages' && query === 'issueDetail' && node?.maxRootRowsPerPage === undefined) return provisional('ceil(normal maxCommentsPerIssue 21 / declared maxChildrenPerParent 1,024) = 1; the large seed-42 per-issue maximum remains unverified');
      if (field === 'maxWindowPages') return 'one exhaustive point/root interval at the declared page size';
      if (field === 'maxWindowRootRows') return query === 'issueListV2'
        ? provisional('maxWindowPages × maxRootRowsPerPage for the filtered list interval; child lineage is exactly zero')
        : 'maxWindowPages × maxRootRowsPerPage for the root; child lineage is exactly zero';
      if (field === 'maxWindowResultRows') return query === 'issueListV2'
        ? provisional('maxWindowPages × whole-result top-level row ceiling for the filtered list interval')
        : 'maxWindowPages × whole-result top-level row ceiling (one for point/child lineage)';
      if (field === 'maxWindowResultBytes') return provisional('maxWindowPages × provisional maxPageResultBytes; conservative whole-result recharge per lineage');
      if (field === 'maxExaminedEntriesPerExecution') return (query === 'issueListV2' || value >= 1_025)
        ? provisional('analytical [G2 measures]: P(node) × node-kind entries formula, including cap+1 for bounded ranges')
        : 'analytical [G2 measures]: P(node) × node-kind entries formula, including cap+1 for bounded ranges';
      if (field === 'maxRelationshipLookupsPerExecution') return query === 'issueListV2'
        ? provisional('analytical [G2 measures]: attempted parent population × distinct argument expansion/consultations')
        : 'analytical [G2 measures]: attempted parent population × distinct argument expansion/consultations';
      if (field === 'maxWindowScannedRows') return (query === 'issueListV2' || value >= 1_025)
        ? provisional('analytical [G2 measures]: maxWindowPages × induced-subtree per-page examined entries')
        : 'analytical [G2 measures]: maxWindowPages × induced-subtree per-page examined entries';
      if (field === 'maxWindowIndexRanges') return query === 'issueListV2'
        ? provisional('analytical [G2 measures]: maxWindowPages × induced-subtree access-path consultations')
        : 'analytical [G2 measures]: maxWindowPages × induced-subtree access-path consultations';
      return `closed declaration value ${value}, derived from the normalized plan and fixture maxima`;
    };
    queryRows[query] = {
      declarationPlanHash: carrier.planHash,
      logical: {
        maxResultRows: { value: plan.queryCost.maxResultRows, ...(query === 'issueListV2' ? provisional('normal filtered page maximum 516 and manifest-defined hot W 1,000; H=1.024 over hot => portable page boundary 1,024', HOT_SPOT_CHECK_COMMAND) : {derivation: 'point/detail root maximum 1 × H=1'}) },
        maxResultBytes: { value: plan.queryCost.maxResultBytes, ...provisional(`normal serialized mapped-result maximum ${measurements[query].maxBytes} bytes × H=${plan.queryCost.maxResultBytes}/${measurements[query].maxBytes} => ${plan.queryCost.maxResultBytes}; large/hot result-byte maxima await zb5`) },
        maxArgumentItems: { value: logical.maxArgumentItems, derivation: query === 'issueDetail' ? 'one bounded scalar source issue id' : 'one bounded scalar plus max 16 selected label ids' },
        maxPageResultBytes: { value: logical.maxPageResultBytes, ...provisional('same provisional per-result byte ceiling; one root page is one result frame') },
        maxMaintainedWritesPerMutation: { value: 0, derivation: 'G0 declares no graph maintenance or write path' },
      },
      physical: {
        observationPosture: '[G2 measures]',
        maxScannedRows: { value: plan.queryCost.maxScannedRows, ...provisional(`Σ analytical node examined-entry formulas = ${plan.queryCost.maxScannedRows}; inputs that depend on large/hot maxima remain provisional and no graph executor observation exists`) },
        maxIndexRanges: { value: plan.queryCost.maxIndexRanges, ...provisional(`Σ analytical access-path consultations = ${plan.queryCost.maxIndexRanges}; inputs that depend on large/hot maxima remain provisional and no graph executor observation exists`) },
        nodeLedger: plan.queryCost.graph.nodes.map(node => ({
          ...node,
          derivation: 'P(node) × kind formula; bounded-to-many charges cap+1, to-one charges P, principal-bound charges P×2 when binding is present',
          provisional: true, validationCommand: LARGE_SPOT_CHECK_COMMAND,
        })),
        windowRollup: { ...logical.windowRollup, ...provisional('sum of each demand-paged node lineage; list filtered-interval and whole-result byte inputs remain provisional') },
      },
      derivationTable: {
        queryCost: wrapFields({
          maxScannedRows: plan.queryCost.maxScannedRows,
          maxIndexRanges: plan.queryCost.maxIndexRanges,
          maxResultRows: plan.queryCost.maxResultRows,
          maxResultBytes: plan.queryCost.maxResultBytes,
          maxEvaluationTurnMs: plan.queryCost.maxEvaluationTurnMs,
          maxObservers: plan.queryCost.maxObservers,
          maxDistinctEvaluationGroups: plan.queryCost.maxDistinctEvaluationGroups,
          maxEstimatedLiveFanoutMs: plan.queryCost.maxEstimatedLiveFanoutMs,
        }, (field, value) => {
          if (field === 'maxScannedRows') return provisional('checked sum of every node maxExaminedEntriesPerExecution [G2 measures]');
          if (field === 'maxIndexRanges') return provisional('checked sum of every point/range/principal consultation [G2 measures]');
          if (field === 'maxResultRows') return query === 'issueListV2' ? provisional('one declared page at the 1,024 hot-root boundary', HOT_SPOT_CHECK_COMMAND) : 'one point/detail root';
          if (field === 'maxResultBytes') return provisional(`normal mapped-result maximum ${measurements[query].maxBytes} bytes × exact rational H=${value}/${measurements[query].maxBytes}`);
          return provisional(`conservative G0 operational guardrail ${field}=${value}; large/hot maximum and graph-executor observation are unavailable`);
        }),
        graph: {
          nodes: logical.nodes.map(node => ({
            nodeId: node.nodeId,
            fields: wrapFields(
              Object.fromEntries(Object.entries(node).filter(([field]) => field !== 'nodeId')),
              (field, value) => fixtureReason(field, value, node),
            ),
          })),
          arguments: logical.arguments.map(argument => ({
            argumentId: argument.argumentId,
            fields: { maxItems: { value: argument.maxItems, derivation: 'maximum selected-label collection cardinality 16 × H=1, within the authored contract' } },
          })),
          maxArgumentItems: { value: logical.maxArgumentItems, derivation: query === 'issueDetail' ? 'one scalar argument × H=1' : 'one scalar plus 16 selected-label items × H=1' },
          maxPageResultBytes: { value: logical.maxPageResultBytes, ...provisional(`normal mapped-result maximum ${measurements[query].maxBytes} bytes × exact rational H=${logical.maxPageResultBytes}/${measurements[query].maxBytes}`) },
          windowRollup: wrapFields(logical.windowRollup, (field, value) => provisional(`checked sum of demand-lineage ${field} values = ${value}${field.includes('Scanned') || field.includes('IndexRanges') ? ' [G2 measures]' : ''}`)),
          maxMaintainedWritesPerMutation: { value: logical.maxMaintainedWritesPerMutation, derivation: 'G0 owns no graph-maintained writes; exact declaration and observation are zero' },
        },
      },
    };
  }
  return {
    format: 'snapback.graph-bound-derivation.v1', derivedAt: '2026-08-23',
    fixtures: facts, oracleMeasurements: measurements, queries: queryRows,
    largeFixtureSpotCheck: existsSync(LARGE_ROOT)
      ? { status: 'available-requires-zb5-rerun', path: 'demos/zerobugs/fixtures-local/large-seed42-v1', command: LARGE_SPOT_CHECK_COMMAND }
      : { status: 'deferred-to-zb5-gate-rerun', reason: 'receipt is present but local CSV fixture is absent', command: LARGE_SPOT_CHECK_COMMAND },
  };
}

async function main() {
  assert.equal(process.versions.node, '24.18.0', 'freeze requires paid-for Node 24.18.0');
  assert(requestedFixtures.includes('normal-seed-v1'), 'normal-seed-v1 is mandatory');
  const { carriers, refusals } = await codegenDeclarations();
  assert.equal(refusals.issueListV2, 'SNAPBACK_GRAPH_SEARCH_UNADMITTED');
  assert.equal(refusals.issueDetail, 'SNAPBACK_GRAPH_NODE_KIND_UNSUPPORTED');
  assert.equal(refusals.listIssueByID, 'SNAPBACK_GRAPH_NODE_KIND_UNSUPPORTED');

  const control = await import(pathToFileURL(join(CONTROL_ROOT, 'snapback/functions.mjs')));
  const handlers = Object.fromEntries(['issueListV2', 'issueDetail', 'listIssueByID'].map(name => {
    const handler = control[name]?.js?.inlineHandler;
    assert.equal(typeof handler, 'function', `${name} exposes the control inline-handler harness seam`);
    return [name, handler];
  }));
  const commentsPageHandler = control.commentsPage?.js?.inlineHandler;
  assert.equal(typeof commentsPageHandler, 'function', 'commentsPage exposes the control inline-handler continuation seam');
  const fixture = readJson(join(NORMAL_ROOT, 'fixture.json'));
  const tables = loadTables();
  const ordinaryPrincipal = 'principal_ordinary';
  installBinding(tables, ordinaryPrincipal, fixture.actorBindings['ordinary-user']);
  const context = mockContext(tables, ordinaryPrincipal);
  const listArgs = { listContext: defaultListContext(), limit: 1_023, start: null, dir: 'forward', inclusive: false };
  const list = await handlers.issueListV2(context, listArgs);
  const listPageArgs = { ...listArgs, limit: 50 };
  const listPage = await handlers.issueListV2(context, listPageArgs);
  assert.equal(listPage[0].status, 'incomplete');
  assert.equal(listPage[0].reason, 'page-limit');
  assert(listPage[0].cursor, 'normal 50-row list page carries a continuation');
  const listNextArgs = { ...listPageArgs, start: listPage[0].cursor };
  const listNextPage = await handlers.issueListV2(context, listNextArgs);
  const listNextRows = mapListRows(listNextPage[0].items, tables.label);
  assert(listNextRows.length > 0, 'list continuation resumes to a non-empty next page');
  const listBackwardArgs = { ...listArgs, dir: 'backward' };
  const listBackward = await handlers.issueListV2(context, listBackwardArgs);
  const commentsByIssue = new Map();
  for (const row of tables.comment) commentsByIssue.set(row.issueID, (commentsByIssue.get(row.issueID) ?? 0) + 1);
  const publicIssue = tables.issue
    .filter(row => row.visibility === 'public')
    .sort((left, right) => (commentsByIssue.get(right._id) ?? 0) - (commentsByIssue.get(left._id) ?? 0))[0];
  const detailArgs = { idField: 'id', id: publicIssue.id };
  const detail = await handlers.issueDetail(context, detailArgs);
  const pointArgs = { listContext: defaultListContext(), idField: 'id', idValue: publicIssue.id };
  const point = await handlers.listIssueByID(context, pointArgs);
  const oracleValues = { issueListV2: list, issueDetail: detail, listIssueByID: point };
  const fieldMaps = Object.fromEntries(Object.entries(carriers).map(
    ([query, carrier]) => [query, fieldMap(query, carrier)],
  ));
  const normalCases = Object.entries(oracleValues).map(([query, result]) => ({
    id: `${query}-normal`, query, fixture: 'normal-seed-v1',
    invocation: query === 'issueListV2' ? listArgs : query === 'issueDetail' ? detailArgs : pointArgs,
    oracle: { resultBytes: JSON.stringify(result), digest: digestBytes(JSON.stringify(result)) },
    fieldMap: fieldMaps[query],
    declaredGraph: {
      planHash: carriers[query].planHash,
      resultDisposition: query === 'issueListV2' ? 'admitted-non-search-graph-order-shape' : 'admitted-fixed-id-structural-shape',
      fullOracleRows: 'refused',
      expected: expectedFromOracle(query, result, fieldMaps[query], {labelRows: tables.label}),
    },
  }));
  const measurements = Object.fromEntries(normalCases.map(caseRow => {
    const mappedBytes = Buffer.byteLength(caseRow.declaredGraph.expected.resultBytes);
    return [caseRow.query, {
      normalResultBytes: mappedBytes, maxBytes: mappedBytes,
      mappedResultDigest: caseRow.declaredGraph.expected.digest,
      rawOracleEnvelopeBytes: Buffer.byteLength(caseRow.oracle.resultBytes),
      oracleDigest: caseRow.oracle.digest,
    }];
  }));

  const noCommentIssues = tables.issue.filter(row => (
    row.visibility === 'public' && (commentsByIssue.get(row._id) ?? 0) === 0
  ));
  assert(noCommentIssues.length >= 2, 'normal fixture has two public zero-comment issues');
  const commentOverlay = (issueRow, count, prefix) => Array.from({length: count}, (_, index) => ({
    _id: `comment_${prefix}_${String(index).padStart(4, '0')}`,
    id: index === 0 ? `${prefix}_a` : index === 1 ? `${prefix}_z` : `${prefix}_${String(index).padStart(4, '0')}`,
    issueID: issueRow._id,
    created: index < 2 ? 2_000_000_000_000 : 2_000_000_000_000 - index,
    body: `${prefix} comment ${index}`,
    creatorID: fixture.actorBindings['ordinary-user'].userID,
  }));
  const continuationTables = deepClone(tables);
  continuationTables.comment.push(...commentOverlay(noCommentIssues[0], 51, 'g0_window'));
  const continuationArgs = {idField: 'id', id: noCommentIssues[0].id};
  const continuationDetail = await handlers.issueDetail(
    mockContext(continuationTables, ordinaryPrincipal), continuationArgs,
  );
  assert.equal(continuationDetail[0].value.comments.length, 50);
  assert.notEqual(continuationDetail[0].value.commentsCursor, null);
  const continuationResumeArgs = {
    issueID: noCommentIssues[0].id, limit: 50,
    start: continuationDetail[0].value.commentsCursor,
    dir: 'backward', inclusive: false,
  };
  const continuationNextPage = await commentsPageHandler(
    mockContext(continuationTables, ordinaryPrincipal), continuationResumeArgs,
  );
  const continuationNextRows = mapCommentPageRows(continuationNextPage[0].items);
  assert(continuationNextRows.length > 0, 'detail continuation resumes to a non-empty next page');
  const normalizedComments = normalizeCommentTiesForGraph(
    continuationDetail[0].value, continuationTables.comment,
  );
  assert.equal(normalizedComments.groups, 1, 'continuation case carries one equal-created child tie');

  const costBoundTables = deepClone(tables);
  costBoundTables.comment.push(...commentOverlay(noCommentIssues[1], 1_024, 'g0_cost_bound'));
  const costBoundArgs = {idField: 'id', id: noCommentIssues[1].id};
  const costBoundDetail = await handlers.issueDetail(
    mockContext(costBoundTables, ordinaryPrincipal), costBoundArgs,
  );
  assert.equal(costBoundDetail[0].value.comments.length, 0);
  assert.equal(costBoundDetail[0].value.commentsCursor, null);
  assert.equal(costBoundDetail[0].value.commentsCompleteness, 'incomplete');

  const missArgs = {idField: 'id', id: '__g0_authoritative_miss__'};
  const missDetail = await handlers.issueDetail(context, missArgs);
  assert.equal(missDetail[0].status, 'not-found-authoritative');
  assert.equal(missDetail[0].value, null);

  const backwardTieGroups = countDeclaredTieGroups(listBackward[0].items, 'modified');
  assert.equal(backwardTieGroups, 69, 'all 69 modified ties are resolved by explicit sourceIssueID order');
  const commentsNodeId = carriers.issueDetail.normalizedPlan.nodes
    .find(node => node.edgeName === 'comments').nodeId;
  const oracleCases = [
    ...normalCases,
    {
      id: 'issueListV2-forward-page-and-resume', query: 'issueListV2', fixture: 'normal-seed-v1',
      invocation: listPageArgs,
      oracle: {
        resultBytes: JSON.stringify(listPage), digest: digestBytes(JSON.stringify(listPage)),
        resumedInvocation: listNextArgs,
        resumedResultBytes: JSON.stringify(listNextPage),
        resumedDigest: digestBytes(JSON.stringify(listNextPage)),
        resumedRowsBytes: JSON.stringify(listNextRows),
        resumedRowsDigest: digestBytes(JSON.stringify(listNextRows)),
      },
      fieldMap: fieldMaps.issueListV2,
      declaredGraph: {
        planHash: carriers.issueListV2.planHash,
        resultDisposition: 'admitted-non-search-fixed-order-shape',
        fullOracleRows: 'refused',
        expected: expectedFromOracle(
          'issueListV2', listPage, fieldMaps.issueListV2,
          {nextResult: listNextPage, labelRows: tables.label},
        ),
      },
    },
    {
      id: 'issueListV2-backward-tied-modified', query: 'issueListV2', fixture: 'normal-seed-v1',
      invocation: listBackwardArgs,
      oracle: { resultBytes: JSON.stringify(listBackward), digest: digestBytes(JSON.stringify(listBackward)) },
      fieldMap: fieldMaps.issueListV2,
      declaredGraph: {
        planHash: carriers.issueListV2.planHash,
        orderedSourceIssueIDs: listBackward[0].items.map(item => item.issue.id),
        rowSetDigest: digestBytes(canonical(listBackward[0].items.map(item => item.issue.id).sort())),
        declaredTieGroups: backwardTieGroups, residualImplicitTieGroups: 0,
        comparison: 'exact-id-order',
        expected: expectedFromOracle(
          'issueListV2', listBackward, fieldMaps.issueListV2,
          {items: listBackward[0].items, labelRows: tables.label},
        ),
      },
    },
    {
      id: 'issueDetail-comments-window-and-child-tie', query: 'issueDetail',
      fixture: 'g0-oracle-comments-window-v1', invocation: continuationArgs,
      oracleDivergence: 'direction-tie-break',
      oracle: {
        resultBytes: JSON.stringify(continuationDetail), digest: digestBytes(JSON.stringify(continuationDetail)),
        physicalIdBindings: normalizedComments.physicalIdBindings,
        resumedInvocation: continuationResumeArgs,
        resumedResultBytes: JSON.stringify(continuationNextPage),
        resumedDigest: digestBytes(JSON.stringify(continuationNextPage)),
        resumedRowsBytes: JSON.stringify(continuationNextRows),
        resumedRowsDigest: digestBytes(JSON.stringify(continuationNextRows)),
      },
      fieldMap: {
        ...deepClone(fieldMaps.issueDetail),
        order: {
          graphNodeId: commentsNodeId,
          oracleFields: [
            'value.comments[*].comment.created',
            'value.comments[*].comment.id',
          ],
          comparison: 'exact-after-id-tiebreak-normalization',
        },
      },
      declaredGraph: {
        planHash: carriers.issueDetail.planHash,
        resultDisposition: 'admitted-fixed-id-structural-shape', fullOracleRows: 'refused',
        expected: expectedFromOracle('issueDetail', continuationDetail, fieldMaps.issueDetail, {
          detailValue: normalizedComments.value, labelRows: tables.label,
          nextRows: continuationNextRows,
        }),
      },
    },
    {
      id: 'issueDetail-comments-cost-bound-refusal', query: 'issueDetail',
      fixture: 'g0-oracle-comments-cost-bound-v1', invocation: costBoundArgs,
      oracle: {resultBytes: JSON.stringify(costBoundDetail), digest: digestBytes(JSON.stringify(costBoundDetail))},
      fieldMap: fieldMaps.issueDetail,
      declaredGraph: {
        planHash: carriers.issueDetail.planHash,
        resultDisposition: 'materialized-cost-bound-refusal', fullOracleRows: 'refused',
        expected: expectedFromOracle('issueDetail', costBoundDetail, fieldMaps.issueDetail, {labelRows: tables.label}),
      },
    },
    {
      id: 'issueDetail-authoritative-miss', query: 'issueDetail',
      fixture: 'g0-oracle-authoritative-miss-v1', invocation: missArgs,
      oracle: {resultBytes: JSON.stringify(missDetail), digest: digestBytes(JSON.stringify(missDetail))},
      fieldMap: fieldMaps.issueDetail,
      declaredGraph: {
        planHash: carriers.issueDetail.planHash,
        resultDisposition: 'authoritative-empty-result', fullOracleRows: 'refused',
        expected: expectedFromOracle('issueDetail', missDetail, fieldMaps.issueDetail, {labelRows: tables.label}),
      },
    },
  ];
  const translationCoverage = oracleTranslationCoverage(fieldMaps, oracleCases);

  const internalIssue = tables.issue.find(row => row.id === 'zbav1_internal_issue');
  const internalListRow = tables.issueListRead.find(row => row.sourceIssueID === internalIssue.id);
  const otherUserID = fixture.actorBindings['crew-admin'].userID;
  const crewPrincipal = 'principal_crew';
  corpusAuthorityOwner = buildAuthorityOwner(tables, fixture);
  for (const assertion of corpusAuthorityOwner.equivalenceAssertions) {
    const carrier = carriers[assertion.query];
    const [left, right] = assertion.principals.map(principal => (
      resolvedClass2Inputs(carrier, assertion.graphArgs, principal)
        .map(input => input.scopeIdentity)
    ));
    if (assertion.relation === 'same') {
      assert.deepEqual(left, right, 'same policy-equivalence class mints equal scope identities');
    } else {
      assert.notDeepEqual(left, right, 'different policy-equivalence classes mint different scope identities');
    }
    assertion.scopeIdentities = {left, right};
  }
  const notificationOverlay = {
    _id: 'issueNotifications_g0_other_principal', userID: otherUserID,
    issueID: publicIssue._id, subscribed: true, created: 2_000_000_000_100,
  };
  const viewStateOverlay = {
    _id: 'viewState_g0_other_principal', userID: otherUserID,
    issueID: publicIssue._id, viewed: 2_000_000_000_200,
  };
  const pairDefinitions = [
    {
      id: 'g0-pair-list-hidden-internal-root', query: 'issueListV2', table: 'issueListRead',
      presentTables: deepClone(tables),
      absentTables: {...deepClone(tables), issueListRead: tables.issueListRead.filter(row => row._id !== internalListRow._id)},
      rowIds: [internalListRow._id], handlerArgs: listArgs,
      graphArgs: {projectID: internalIssue.projectID, selectedLabelIDs: []},
      principal: ordinaryPrincipal, coveredNodeIds: ['n0'],
      // Preserve the pair's full-interval hidden-root channel. Freezing take=1
      // would turn this into a one-row prefix claim, so the invocation uses
      // the admitted 1,024-row full window and proves all 516 visible roots.
      windowOptions: {rootTake: 1_024},
      channel: 'internal list root is wholly hidden from the ordinary principal',
    },
    {
      id: 'g0-pair-point-hidden-internal-root', query: 'listIssueByID', table: 'issueListRead',
      presentTables: deepClone(tables),
      absentTables: {...deepClone(tables), issueListRead: tables.issueListRead.filter(row => row._id !== internalListRow._id)},
      rowIds: [internalListRow._id],
      handlerArgs: {listContext: defaultListContext(), idField: 'id', idValue: internalIssue.id},
      graphArgs: {sourceIssueID: internalIssue.id, selectedLabelIDs: []},
      principal: ordinaryPrincipal, coveredNodeIds: ['n0'],
      channel: 'internal point root is wholly hidden from the ordinary principal',
    },
    {
      id: 'g0-pair-detail-hidden-root-empty-child-demand', query: 'issueDetail', table: 'issue',
      presentTables: deepClone(tables),
      absentTables: {...deepClone(tables), issue: tables.issue.filter(row => row._id !== internalIssue._id)},
      rowIds: [internalIssue._id], handlerArgs: {idField: 'id', id: internalIssue.id},
      graphArgs: {sourceIssueID: internalIssue.id}, coveredNodeIds: ['n0'],
      principal: ordinaryPrincipal, evaluatedParentKeys: [],
      channel: 'internal detail root collapsed into the authoritative not-found channel',
    },
    {
      id: 'g0-pair-detail-notification-principal', query: 'issueDetail', table: 'issueNotifications',
      presentTables: {...deepClone(tables), issueNotifications: [...tables.issueNotifications, notificationOverlay]},
      absentTables: deepClone(tables), rowIds: [notificationOverlay._id], handlerArgs: detailArgs,
      graphArgs: {sourceIssueID: publicIssue.id}, coveredNodeIds: ['n6'],
      principal: ordinaryPrincipal,
      evaluatedParentKeys: [{table: 'issue', id: publicIssue._id}],
      channel: 'other-principal notification row beside a hydrated issue',
    },
    {
      id: 'g0-pair-point-view-state-principal', query: 'listIssueByID', table: 'viewState',
      presentTables: {...deepClone(tables), viewState: [...tables.viewState, viewStateOverlay]},
      absentTables: deepClone(tables), rowIds: [viewStateOverlay._id], handlerArgs: pointArgs,
      graphArgs: {sourceIssueID: publicIssue.id, selectedLabelIDs: []}, coveredNodeIds: ['n5'],
      principal: ordinaryPrincipal,
      channel: 'other-principal view-state row beside a hydrated point result',
    },
  ];
  const pairedWorlds = [];
  const frozenPairs = [];
  for (const definition of pairDefinitions) {
    const presentResult = await handlers[definition.query](
      mockContext(definition.presentTables, definition.principal), definition.handlerArgs,
    );
    const absentResult = await handlers[definition.query](
      mockContext(definition.absentTables, definition.principal), definition.handlerArgs,
    );
    assert.deepEqual(absentResult, presentResult, `${definition.id} hidden slice is observationally absent`);
    const mapped = expectedFromOracle(
      definition.query, presentResult, fieldMaps[definition.query], {labelRows: tables.label},
    );
    const absentMapped = expectedFromOracle(
      definition.query, absentResult, fieldMaps[definition.query], {labelRows: tables.label},
    );
    assert.deepEqual(absentMapped, mapped, `${definition.id} mapped results exact-match`);
    assert.equal(mapped.graphCompleteness, 'complete', `${definition.id} paired result is complete`);
    const call = invocation(
      carriers[definition.query], definition.graphArgs, definition.principal, 0,
      definition.query, definition.evaluatedParentKeys, definition.windowOptions,
    );
    const input = {query: definition.query, handlerArgs: definition.handlerArgs, graphArgs: definition.graphArgs, principal: definition.principal};
    const present = frozenWorld(`${definition.id}-present-v1`, definition.presentTables, input, definition.table);
    const absent = frozenWorld(`${definition.id}-absent-v1`, definition.absentTables, input, definition.table);
    const planNodes = new Map(carriers[definition.query].normalizedPlan.nodes.map(node => [node.nodeId, node]));
    const coveredAuthorityClasses = [...new Set(definition.coveredNodeIds.map(nodeId => {
      const node = planNodes.get(nodeId);
      assert(node, `${definition.id} covers an actual graph node ${nodeId}`);
      return node.authority.declaredClass;
    }))].sort();
    frozenPairs.push({
      id: definition.id, query: definition.query, channel: definition.channel,
      namedSlice: {table: definition.table, rowIds: definition.rowIds},
      coveredNodeIds: definition.coveredNodeIds, coveredAuthorityClasses,
      present, absent,
    });
    pairedWorlds.push({
      caseKind: 'pairedWorld', id: definition.id, query: definition.query,
      plan: carriers[definition.query], invocation: call,
      fixturePairId: definition.id, coveredNodeIds: definition.coveredNodeIds,
      coveredAuthorityClasses,
      windowVectorDisposition: definition.windowVectorDisposition ?? {status: 'VALIDATED'},
      worlds: {
        present: {fixture: present.identity, fixtureDigest: present.fixtureDigest, hiddenSlice: [{table: definition.table, rowIds: definition.rowIds}]},
        absent: {fixture: absent.identity, fixtureDigest: absent.fixtureDigest, hiddenSlice: []},
      },
      oracleEvidence: {presentDigest: digestBytes(JSON.stringify(presentResult)), absentDigest: digestBytes(JSON.stringify(absentResult))},
      expect: completeResult(
        carriers[definition.query], call, definition.presentTables,
        mapped.resultBytes, mapped.orderedRootIds,
      ),
    });
  }
  const pairedFixtureCorpus = {
    format: 'snapback.graph-paired-world-fixtures.v1', version: 1,
    source: 'corpus-local worlds reconstructed by the freezer; world identities are not normal-seed-v1',
    pairs: frozenPairs,
  };
  pairedFixtureCorpus.contentDigest = digestBytes(canonical(pairedFixtureCorpus));

  const activationTables = deepClone(tables);
  installBinding(activationTables, crewPrincipal, fixture.actorBindings['crew-admin']);
  const activationHandlerArgs = {
    listContext: defaultListContext(), idField: 'id', idValue: internalIssue.id,
  };
  const activationGraphArgs = {sourceIssueID: internalIssue.id, selectedLabelIDs: []};
  const activationAllowed = await handlers.listIssueByID(
    mockContext(activationTables, crewPrincipal), activationHandlerArgs,
  );
  const activationDenied = await handlers.listIssueByID(
    mockContext(tables, ordinaryPrincipal), activationHandlerArgs,
  );
  assert.equal(activationAllowed[0].status, 'complete');
  assert.equal(activationAllowed[0].items.length, 1);
  assert.equal(activationDenied[0].status, 'not-found-authoritative');
  assert.equal(activationDenied[0].reason, 'missing-or-outside-list-context');
  assert.deepEqual(activationDenied[0].items, []);
  const activationMapped = expectedFromOracle(
    'listIssueByID', activationAllowed, fieldMaps.listIssueByID, {labelRows: tables.label},
  );
  assert.equal(activationMapped.graphCompleteness, 'complete');
  const activationAllowedInvocation = invocation(
    carriers.listIssueByID, activationGraphArgs, crewPrincipal, 0, 'listIssueByID',
  );
  const activationDeniedInvocation = invocation(
    carriers.listIssueByID, activationGraphArgs, ordinaryPrincipal, 0, 'listIssueByID',
  );
  const allowDenyCases = [{
    caseKind: 'allowDeny', id: 'g0-allow-deny-point-crew-internal-root',
    query: 'listIssueByID', plan: carriers.listIssueByID,
    invocations: {allowed: activationAllowedInvocation, denied: activationDeniedInvocation},
    principals: {allowed: crewPrincipal, denied: ordinaryPrincipal},
    coveredNodeIds: carriers.listIssueByID.normalizedPlan.nodes
      .filter(node => node.authority.declaredClass === 2)
      .map(node => node.nodeId),
    oracleEvidence: {
      allowedResultBytes: JSON.stringify(activationAllowed),
      allowedDigest: digestBytes(JSON.stringify(activationAllowed)),
      allowedMappedResultBytes: activationMapped.resultBytes,
      allowedMappedDigest: digestBytes(activationMapped.resultBytes),
      deniedResultBytes: JSON.stringify(activationDenied),
      deniedDigest: digestBytes(JSON.stringify(activationDenied)),
      deniedDisposition: {
        status: activationDenied[0].status,
        reason: activationDenied[0].reason,
      },
    },
    expect: {
      allowed: completeResult(
        carriers.listIssueByID, activationAllowedInvocation, activationTables,
        activationMapped.resultBytes, activationMapped.orderedRootIds,
      ),
      denied: 'deny',
      deniedResultBytes: null,
    },
  }];

  const pendingBaseInvocation = invocation(carriers.listIssueByID, {
    sourceIssueID: internalIssue.id, selectedLabelIDs: [],
  }, ordinaryPrincipal, 0, 'listIssueByID');
  const pendingCorpus = {
    format: 'snapback.graph-broadcast-cases.g2-pending.v1', version: 1,
    description: 'Structurally frozen graph-evaluator records. G0 executes none of these four cases.',
    caseKinds: ['audienceParity', 'scopeMismatch', 'authorityTransition', 'mixedCommit'],
    cases: pendingCases(carriers.listIssueByID, pendingBaseInvocation),
  };
  pendingCorpus.contentDigest = digestBytes(canonical(pendingCorpus));

  const requiredMissInvocation = invocation(
    carriers.listIssueByID,
    {sourceIssueID: publicIssue.id, selectedLabelIDs: []},
    ordinaryPrincipal,
    0,
    'listIssueByID',
  );
  const refusalCases = [
    { caseKind: 'refusal', id: 'issueListV2-search-membership', query: 'issueListV2', trigger: { phase: 'admission', plan: { sourceDeclaration: 'issueListSearchCandidate' }, schemaFixture: 'tests/conformance/graph/zerobugs/schema.mjs', policyFixture: 'crew-or-public-permission-backing-mirror' }, expect: { reason: refusals.issueListV2, resultBytes: null } },
    { caseKind: 'refusal', id: 'issueDetail-ordered-result-bearing-through', query: 'issueDetail', trigger: { phase: 'admission', plan: { sourceDeclaration: 'issueDetailOrderedLabelsCandidate' }, schemaFixture: 'tests/conformance/graph/zerobugs/schema.mjs', policyFixture: 'crew-or-public-permission-backing-mirror' }, expect: { reason: refusals.issueDetail, resultBytes: null } },
    { caseKind: 'refusal', id: 'listIssueByID-ordered-result-bearing-through', query: 'listIssueByID', trigger: { phase: 'admission', plan: { sourceDeclaration: 'listIssueByIDOrderedLabelsCandidate' }, schemaFixture: 'tests/conformance/graph/zerobugs/schema.mjs', policyFixture: 'crew-or-public-permission-backing-mirror' }, expect: { reason: refusals.listIssueByID, resultBytes: null } },
    {
      caseKind: 'refusal', id: 'listIssueByID-required-issue-edge-missing', query: 'listIssueByID',
      trigger: {phase: 'evaluation', nodeId: 'n1', presence: 'required'},
      plan: carriers.listIssueByID, invocation: requiredMissInvocation,
      fixture: {
        table: 'issue',
        rows: tables.issue.filter(row => row._id !== publicIssue._id),
        removedPhysicalRowKey: {table: 'issue', id: publicIssue._id},
      },
      expect: materializedRefusalResult(
        carriers.listIssueByID,
        requiredMissInvocation,
        'SNAPBACK_GRAPH_REQUIRED_EDGE_MISSING',
      ),
    },
  ];
  const cases = [...pairedWorlds, ...allowDenyCases, ...refusalCases];
  assert.deepEqual(
    freezerProofSelfChecks,
    {consumed: true, found: true, parentLinkage: true},
    'freezer adversarial self-checks cover result-row consumption, optional found/null, and immediate parent linkage',
  );
  const g0ExitObservations = [];
  const g0ExitObservationEvidence = [];
  const g0ExitObservationGaps = [];
  const observationGraphArgs = {
    issueListV2: {projectID: internalIssue.projectID, selectedLabelIDs: []},
    issueDetail: {sourceIssueID: publicIssue.id},
    listIssueByID: {sourceIssueID: publicIssue.id, selectedLabelIDs: []},
  };
  for (const [query, carrier] of Object.entries(carriers)) {
    const normalCase = normalCases.find(caseRow => caseRow.query === query);
    const call = invocation(
      carrier, observationGraphArgs[query], ordinaryPrincipal, 0, query,
      query === 'issueDetail' ? [{table: 'issue', id: publicIssue._id}] : [],
      query === 'issueListV2' ? {rootTake: 1_024} : {},
    );
    const resultBytes = normalCase.declaredGraph.expected.resultBytes;
    const capturedDependencies = capturedDependencyVector(
      carrier, call, tables, normalCase.declaredGraph.expected.orderedRootIds,
    );
    const proofTuple = {
      materializationHash: domainHash('snapback:graph-materialization:v1:', call.materialization),
      partitionHash: domainHash('snapback:graph-authority-partition:v1:', call.partition),
      authorizationVersion: call.authorizationVersion, evaluationCut: call.evaluationCut,
    };
    const groupState = {result: JSON.parse(resultBytes), proofTuple};
    const dependencyVectorBytes = JSON.stringify(capturedDependencies);
    const groupStateBytes = JSON.stringify(groupState);
    const evidence = {
      fixture: 'normal-seed-v1', graphPlanHash: carrier.planHash,
      invocation: call, resultBytes,
      resultDigest: digestBytes(resultBytes),
      capturedDependencies,
      capturedDependencyVectorDigest: digestBytes(canonical(capturedDependencies)),
      groupState,
      groupStateDigest: digestBytes(canonical(groupState)),
    };
    g0ExitObservationEvidence.push(evidence);
    g0ExitObservations.push({
      format: 'snapback.graph-g0-exit-observation.v1', fixture: 'normal-seed-v1',
      graphPlanHash: carrier.planHash, groupCount: 1, subscriberFanout: 1,
      groups: [{
        groupOrdinal: 0,
        resultBytes: Buffer.byteLength(resultBytes),
        dependencyBytes: Buffer.byteLength(dependencyVectorBytes),
        groupStateBytes: Buffer.byteLength(groupStateBytes),
      }],
    });
    for (const fixtureName of ['large-seed42-v1', 'hot-recent-v1']) {
      g0ExitObservationGaps.push({
        fixture: fixtureName, query, graphPlanHash: carrier.planHash,
        status: 'NOT SATISFIED',
        missingCarrier: 'GraphG0ExitObservationV1 has no deferred arm; no typed pseudo-record is emitted',
        command: fixtureName === 'large-seed42-v1' ? LARGE_SPOT_CHECK_COMMAND : HOT_SPOT_CHECK_COMMAND,
      });
    }
  }
  const corpus = {
    format: 'snapback.graph-conformance-corpus.v1', version: 1,
    description: 'G2-A corpus: opaque G0 oracle evidence, evaluator-executed paired worlds and allowed activation, one evaluation-time refusal, and structural admission refusals plus pending broadcast cases.',
    fixtures: {
      normal: 'demos/zerobugs/control/fixtures/normal-seed-v1',
      policyExtension: 'demos/zerobugs/control/fixtures/policy-extension-v1.json',
      pairedWorlds: 'tests/conformance/graph/paired-world-fixtures.v1.json',
      large: 'demos/zerobugs/manifest/large-seed42-v1.receipt.json',
    },
    queries: Object.entries(carriers).map(([query, carrier]) => ({
      query, carrier, fieldMap: fieldMaps[query],
      disposition: {
        structuralDeclaration: 'admitted', fullOracleRows: 'refused',
        reason: refusals[query],
        detail: query === 'issueListV2' ? 'non-search graph-order shape admitted; search membership refused' : 'fixed-id structural shape admitted; name-ordered through-shape remains refused while mapped label arrays use labelID graph order',
      },
    })),
    authorityOwner: corpusAuthorityOwner,
    oracleCases, oracleTranslationCoverage: translationCoverage, cases,
    caseKinds: ['pairedWorld', 'allowDeny', 'audienceParity', 'scopeMismatch', 'authorityTransition', 'mixedCommit', 'refusal'],
    executableCaseKinds: ['pairedWorld', 'allowDeny', 'refusal'],
    pendingBroadcastCases: 'tests/conformance/graph/broadcast-cases.g2-pending.v1.json',
    broadcastInputs: [
      { label: 'G0-BCAST-CLASS', status: 'NOT SATISFIED', missingCarrier: 'every admitted Zerobugs base derives class 2 and each projection rolls up to class 3; no class-1 broadcast base or executed counterfeit-broadcast refusal exists', artifact: 'queries[*].carrier.normalizedPlan.nodes[*].authority + pairedWorld cases', caseKinds: ['pairedWorld', 'refusal'] },
      { label: 'G0-BCAST-SEPARATION', status: 'NOT SATISFIED', missingCarrier: 'host-proven separation certificate and executed counterfeit-broadcast refusal; allowed activation executes through the evaluator while denial remains establishment-only', artifact: 'corpus.v1.json allowDeny + broadcast-cases.g2-pending.v1.json', caseKinds: ['allowDeny', 'refusal'] },
      { label: 'G0-BCAST-SCOPE', status: 'NOT SATISFIED', missingCarrier: 'executed P/Q mismatch evidence; owner-normalized P/Q-distinct scope identities are frozen and Rust-reconstructed', artifact: 'corpus.v1.json authorityOwner/allowDeny + broadcast-cases.g2-pending.v1.json', caseKinds: ['allowDeny', 'scopeMismatch'] },
      { label: 'G0-BCAST-SCOPE-BINDING', status: 'NOT SATISFIED', missingCarrier: 'executed resource-to-scope equality proof', artifact: 'broadcast-cases.g2-pending.v1.json', caseKinds: ['scopeMismatch', 'refusal'] },
      { label: 'G0-BCAST-AUDIENCE', status: 'NOT SATISFIED', missingCarrier: 'executed establishment versus strict-evaluator parity; allowed activation executes through the evaluator while denial remains establishment-only', artifact: 'corpus.v1.json allowDeny + broadcast-cases.g2-pending.v1.json', caseKinds: ['allowDeny', 'audienceParity'] },
      { label: 'G0-BCAST-INVALIDATION', status: 'NOT SATISFIED', missingCarrier: 'executed authority-transition and mixed-commit fence evidence', artifact: 'broadcast-cases.g2-pending.v1.json', caseKinds: ['authorityTransition', 'mixedCommit'] },
      { label: 'G0-BCAST-IDENTITY', status: 'SATISFIED', missingCarrier: null, artifact: 'full plan/instance/materialization/partition/version/cut preimages and Rust reconstruction', caseKinds: ['pairedWorld'] },
      { label: 'G0-BCAST-CORPUS', status: 'NOT SATISFIED', missingCarrier: 'four graph-evaluator case kinds are structurally pending and not executable at G0', artifact: 'caseKinds schema + corpus allowDeny + broadcast-cases.g2-pending.v1.json', caseKinds: ['pairedWorld', 'allowDeny', 'audienceParity', 'scopeMismatch', 'authorityTransition', 'mixedCommit', 'refusal'] },
      { label: 'G0-BCAST-BOUNDS', status: 'NOT SATISFIED', missingCarrier: 'large/hot typed exit observations and ratified non-provisional maxima', artifact: 'bound-derivation.v1.json + g0ExitObservationGaps', caseKinds: ['pairedWorld'] },
    ],
    g0ExitObservations, g0ExitObservationEvidence, g0ExitObservationGaps,
    requestedFixtures,
  };
  const bounds = boundDerivation(carriers, measurements, tables);
  bounds.contentDigest = digestBytes(canonical(bounds));
  // Bound derivation shares normalized carrier objects with the corpus and
  // may normalize/sort nested arrays. Bind the bytes only after that pass.
  corpus.contentDigest = digestBytes(canonical(corpus));

  if (checkOnly) {
    assert.equal(readFileSync(CORPUS_PATH, 'utf8'), pretty(corpus), 'corpus.v1.json is stale');
    assert.equal(readFileSync(BOUNDS_PATH, 'utf8'), pretty(bounds), 'bound-derivation.v1.json is stale');
    assert.equal(readFileSync(PENDING_CASES_PATH, 'utf8'), pretty(pendingCorpus), 'broadcast pending corpus is stale');
    assert.equal(readFileSync(PAIRED_FIXTURES_PATH, 'utf8'), pretty(pairedFixtureCorpus), 'paired-world fixtures are stale');
  } else {
    writeFileSync(CORPUS_PATH, pretty(corpus));
    writeFileSync(BOUNDS_PATH, pretty(bounds));
    writeFileSync(PENDING_CASES_PATH, pretty(pendingCorpus));
    writeFileSync(PAIRED_FIXTURES_PATH, pretty(pairedFixtureCorpus));
  }
  console.log(`graph-g0-oracle-freeze: PASS normal-seed-v1 queries=3 oracleCases=${oracleCases.length} pairedWorlds=${pairedWorlds.length} allowDeny=${allowDenyCases.length} refusals=${refusalCases.length}`);
  if (!existsSync(LARGE_ROOT)) console.log('graph-g0-large-spot-check: DEFERRED receipt-only; rerun zb5 command recorded in bound-derivation.v1.json');
}

await main();
