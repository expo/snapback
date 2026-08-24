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
const ZERO_HASH = `sha256:${'0'.repeat(64)}`;
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
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
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

function mapListRows(items) {
  return items.map(item => ({
    issue: compactIssue(item.issue),
    labels: item.labels.map(value => ({label: {id: value.id, name: value.name}})),
    viewState: compactNullable(item.viewState, ['viewed']),
  }));
}

function mapDetailRows(value) {
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
    labels: value.labels.map(labelValue => ({label: {id: labelValue.id, name: labelValue.name}})),
    comments: value.comments.map(row => ({
      id: row.comment.id, created: row.comment.created, body: row.comment.body,
    })),
    notificationState: compactNullable(value.notificationState, ['subscribed']),
    viewState: compactNullable(value.viewState, ['viewed']),
  }];
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
  const rows = query === 'issueDetail' ? mapDetailRows(envelope.value) : mapListRows(items);
  const orderedRootIds = query === 'issueDetail'
    ? (envelope.value === null ? [] : [envelope.value.issue.id])
    : items.map(item => item.issue.id);
  const nodeCompleteness = [];
  if (query === 'issueDetail') {
    const labelsMap = map.nodeCompleteness.find(entry => entry.oracleStatusField === 'value.labelsCompleteness');
    const commentsMap = map.nodeCompleteness.find(entry => entry.oracleStatusField === 'value.commentsCompleteness');
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
  const continuation = map.continuation.map(entry => {
    const hasMore = query === 'issueDetail'
      ? envelope.value?.commentsCursor !== null
      : envelope.hasMore;
    const nextRows = options.nextResult
      ? (query === 'issueDetail'
          ? mapDetailRows(options.nextResult[0].value)
          : mapListRows(options.nextResult[0].items))
      : [];
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
    resultBytes, digest: digestBytes(resultBytes), orderedRootIds,
    resultLength: rows.length, nodeCompleteness, outerStatusReason,
    graphCompleteness: composeLabels(translations), continuation,
  };
}

function windowVector(carrier, args, direction = 'forward') {
  return carrier.normalizedPlan.nodes
    .filter(node => node.kind === 'root-window' || (node.kind === 'bounded-to-many' && node.page.kind === 'demand'))
    .map(node => ({
      nodeId: node.nodeId,
      intervals: node.kind === 'root-window' ? [{
        parentKey: null,
        window: {
          order: node.order,
          direction,
          lower: { kind: 'unbounded' }, upper: { kind: 'unbounded' },
          take: 1,
        },
      }] : [],
    }));
}

function invocation(
  carrier,
  args,
  principal = 'principal_ordinary',
  epoch = 0,
  functionName = 'listIssueByID',
) {
  const windows = windowVector(carrier, args);
  const instancePreimage = {
    format: 'snapback.graph-instance.v1', graphPlanHash: carrier.planHash,
    argsDigest: domainHash('snapback:materialization-args:v1:', args), windows,
  };
  const instanceHash = domainHash('snapback:graph-instance:v1:', instancePreimage);
  return {
    planHash: carrier.planHash, args, windows,
    materialization: {
      format: 'snapback.graph-materialization.v1', appId: 'zerobugs-graph-g0-corpus',
      databaseId: 'normal-seed-v1', deploymentId: 'g0-stage-b',
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
    partition: { kind: 'partition-of-one', principal },
    authorizationVersion: { incarnation: 'normal-seed-v1', epoch },
    evaluationCut: 1,
  };
}

function completeEmptyResult(carrier, call) {
  const materializationHash = domainHash('snapback:graph-materialization:v1:', call.materialization);
  const partitionHash = domainHash('snapback:graph-authority-partition:v1:', call.partition);
  const tuple = {
    materializationHash, partitionHash,
    authorizationVersion: call.authorizationVersion, evaluationCut: call.evaluationCut,
  };
  const nodes = [];
  for (const node of carrier.normalizedPlan.nodes.filter(node => node.kind !== 'closed-projection')) {
    const evidence = node.kind === 'root-window'
      ? { interval: { lower: { kind: 'unbounded' }, upper: { kind: 'unbounded' } }, consumed: 0, hasMore: false, sourceExhausted: true }
      : node.kind === 'bounded-to-many'
        ? { ranges: [] }
        : { rows: [] };
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
  return {
    kind: 'result', label: 'complete', resultBytes: '[]', orderedRootIds: [],
    resultLength: 0, nodeCompleteness: nodes,
    graphCompleteness: { ...tuple, label: 'complete', proofClass: 'all-complete', proof: composition },
    refusalReason: null,
  };
}

function normalizeBackwardTies(envelope, issueListRead) {
  const physicalBySource = new Map(issueListRead.map(row => [row.sourceIssueID, row.issueID]));
  assert.equal(physicalBySource.size, issueListRead.length, 'source-to-physical issue identity must be unique');
  const items = deepClone(envelope.items);
  let tiedRows = 0;
  for (let start = 0; start < items.length;) {
    let end = start + 1;
    while (end < items.length && items[end].issue.modified === items[start].issue.modified) end += 1;
    if (end - start > 1) {
      tiedRows += end - start;
      const sorted = items.slice(start, end).sort((left, right) => {
        const leftPhysical = physicalBySource.get(left.issue.id);
        const rightPhysical = physicalBySource.get(right.issue.id);
        assert(leftPhysical && rightPhysical, 'every oracle source id resolves through issueListRead');
        return leftPhysical < rightPhysical ? -1 : leftPhysical > rightPhysical ? 1 : 0;
      });
      items.splice(start, end - start, ...sorted);
    }
    start = end;
  }
  assert(tiedRows >= 2, 'direction-tie-break case must contain a tied group');
  return items;
}

function pendingCases(carrier, baseInvocation) {
  const withEpoch = epoch => ({ ...deepClone(baseInvocation), authorizationVersion: { incarnation: 'normal-seed-v1', epoch } });
  const outsideScope = invocation(carrier, {
    sourceIssueID: '__outside_scope__', selectedLabelIDs: [],
  });
  return [
    { caseKind: 'allowDeny', id: 'zerobugs-allow-deny-g2', pending: 'G2', plan: carrier, invocations: { allowed: baseInvocation, denied: { ...deepClone(baseInvocation), partition: { kind: 'partition-of-one', principal: 'principal_removed' } } }, principals: { allowed: 'principal_ordinary', denied: 'principal_removed' }, expect: { allowed: completeEmptyResult(carrier, baseInvocation), denied: 'deny', deniedResultBytes: null } },
    { caseKind: 'audienceParity', id: 'zerobugs-audience-parity-g2', pending: 'G2', plan: carrier, invocations: [baseInvocation, { ...deepClone(baseInvocation), partition: { kind: 'partition-of-one', principal: 'principal_crew' } }], principals: ['principal_ordinary', 'principal_crew'], expect: { establishment: ['allow', 'allow'], strict: ['allow', 'allow'] } },
    { caseKind: 'scopeMismatch', id: 'zerobugs-scope-mismatch-g2', pending: 'G2', plan: carrier, invocations: { memberScope: baseInvocation, presentedInstance: outsideScope }, principal: 'principal_ordinary', expect: { classification: 'query-shaped', reason: 'scope-unbound', resultBytes: null } },
    { caseKind: 'authorityTransition', id: 'zerobugs-authority-transition-g2', pending: 'G2', plan: carrier, invocations: { before: withEpoch(0), after: withEpoch(1) }, principal: 'principal_ordinary', commit: { dataChanges: [], authorityEvents: [{ kind: 'authorization-incarnation-change', cause: 'app-reset' }], afterAuthorizationVersion: { incarnation: 'normal-seed-v1', epoch: 1 } }, observed: [{ ordinal: 0, kind: 'fence', authorizationVersion: { incarnation: 'normal-seed-v1', epoch: 1 } }, { ordinal: 1, kind: 'delivery', authorizationVersion: { incarnation: 'normal-seed-v1', epoch: 1 } }] },
    { caseKind: 'mixedCommit', id: 'zerobugs-mixed-commit-g2', pending: 'G2', plan: carrier, invocations: { before: withEpoch(0), after: withEpoch(1) }, principal: 'principal_ordinary', commit: { dataChanges: [{ table: 'issue', rowId: '__corpus_issue__' }], authorityEvents: [{ kind: 'authorization-incarnation-change', cause: 'app-reset' }], afterAuthorizationVersion: { incarnation: 'normal-seed-v1', epoch: 1 } }, observed: [{ ordinal: 0, kind: 'fence', authorizationVersion: { incarnation: 'normal-seed-v1', epoch: 1 } }, { ordinal: 1, kind: 'delivery', authorizationVersion: { incarnation: 'normal-seed-v1', epoch: 1 } }] },
  ];
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
      ([field, value]) => [field, { value, derivation: reason(field, value) }],
    ));
    const fixtureReason = (field, value, node = null) => {
      if (field === 'maxRootRowsPerPage') {
        return value === 1
          ? 'point/detail source-id lookup emits at most one root row; H=1'
          : 'hot-recent-v1 requests 1,000 roots; retain the portable 1,024 boundary (H=1.024)';
      }
      if (field === 'maxChildrenPerParent' && value === 16) return 'max(normal label edges per issue 5, documented large generator label maximum 3) × H=3.2 => 16';
      if (field === 'maxChildrenPerParent' && value === 1_024) return 'observed normal maximum comments per issue 21 × H=48.761904… => 1,024; the large generator is floored-exponential and its exact CSV maximum is deferred to the zb5 rerun, so no mean substitutes for a maximum';
      if (field === 'maxArgumentExpansion' && value === 16) return 'maximum selected-label collection length 16 × H=1';
      if (field === 'maxWindowPages' && query === 'issueListV2') return 'ceil(large fixture maximum 1,000,000 root rows / 1,024 rows per page) = 977';
      if (field === 'maxWindowPages' && query === 'issueDetail' && node?.maxRootRowsPerPage === undefined) return 'ceil(declared 1,024-comment parent cap / corpus demand take 50) = 21';
      if (field === 'maxWindowPages') return 'one exhaustive point/root interval at the declared page size';
      if (field === 'maxWindowRootRows') return 'maxWindowPages × maxRootRowsPerPage for the root; child lineage is exactly zero';
      if (field === 'maxWindowResultRows') return 'maxWindowPages × whole-result top-level row ceiling (one for point/child lineage)';
      if (field === 'maxWindowResultBytes') return 'maxWindowPages × declared maxPageResultBytes; conservative whole-result recharge per lineage';
      if (field === 'maxExaminedEntriesPerExecution') return 'analytical [G2 measures]: P(node) × node-kind entries formula, including cap+1 for bounded ranges';
      if (field === 'maxRelationshipLookupsPerExecution') return 'analytical [G2 measures]: attempted parent population × distinct argument expansion/consultations';
      if (field === 'maxWindowScannedRows') return 'analytical [G2 measures]: maxWindowPages × induced-subtree per-page examined entries';
      if (field === 'maxWindowIndexRanges') return 'analytical [G2 measures]: maxWindowPages × induced-subtree access-path consultations';
      return `closed declaration value ${value}, derived from the normalized plan and fixture maxima`;
    };
    queryRows[query] = {
      declarationPlanHash: carrier.planHash,
      logical: {
        maxResultRows: { value: plan.queryCost.maxResultRows, derivation: query === 'issueListV2' ? 'max observed normal page 516 and hot demand 1,000; H=1.024 over hot => portable page boundary 1,024' : 'point/detail root maximum 1 × H=1' },
        maxResultBytes: { value: plan.queryCost.maxResultBytes, derivation: `normal serialized-oracle maximum ${measurements[query].maxBytes} bytes × H=${plan.queryCost.maxResultBytes}/${measurements[query].maxBytes} => ${plan.queryCost.maxResultBytes}; headroom covers the declared root/child fanout and fixture text skew` },
        maxArgumentItems: { value: logical.maxArgumentItems, derivation: query === 'issueDetail' ? 'one bounded scalar source issue id' : 'one bounded scalar plus max 16 selected label ids' },
        maxPageResultBytes: { value: logical.maxPageResultBytes, derivation: 'same conservative per-result byte ceiling; one root page is one result frame' },
        maxMaintainedWritesPerMutation: { value: 0, derivation: 'G0 declares no graph maintenance or write path' },
      },
      physical: {
        observationPosture: '[G2 measures]',
        maxScannedRows: { value: plan.queryCost.maxScannedRows, derivation: `Σ analytical node examined-entry formulas = ${plan.queryCost.maxScannedRows}; no graph executor observation` },
        maxIndexRanges: { value: plan.queryCost.maxIndexRanges, derivation: `Σ analytical access-path consultations = ${plan.queryCost.maxIndexRanges}; no graph executor observation` },
        nodeLedger: plan.queryCost.graph.nodes.map(node => ({ ...node, derivation: 'P(node) × kind formula; bounded-to-many charges cap+1, to-one charges P, principal-bound charges P×2 when binding is present' })),
        windowRollup: { ...logical.windowRollup, derivation: 'sum of each demand-paged node lineage: pages × induced-subtree scanned rows/ranges; result bytes conservatively charged per lineage' },
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
          if (field === 'maxScannedRows') return 'checked sum of every node maxExaminedEntriesPerExecution [G2 measures]';
          if (field === 'maxIndexRanges') return 'checked sum of every point/range/principal consultation [G2 measures]';
          if (field === 'maxResultRows') return query === 'issueListV2' ? 'one declared page at the 1,024 hot-root boundary' : 'one point/detail root';
          if (field === 'maxResultBytes') return `normal oracle maximum ${measurements[query].maxBytes} bytes × exact rational H=${value}/${measurements[query].maxBytes}`;
          return `conservative G0 operational guardrail ${field}=${value}; not a graph-executor observation`;
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
          maxPageResultBytes: { value: logical.maxPageResultBytes, derivation: `normal oracle maximum ${measurements[query].maxBytes} bytes × exact rational H=${logical.maxPageResultBytes}/${measurements[query].maxBytes}` },
          windowRollup: wrapFields(logical.windowRollup, (field, value) => `checked sum of demand-lineage ${field} values = ${value}${field.includes('Scanned') || field.includes('IndexRanges') ? ' [G2 measures]' : ''}`),
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
  const measurements = Object.fromEntries(Object.entries(oracleValues).map(([query, value]) => {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    return [query, { normalResultBytes: bytes, maxBytes: bytes, oracleDigest: digestBytes(JSON.stringify(value)) }];
  }));

  const fieldMaps = Object.fromEntries(Object.entries(carriers).map(
    ([query, carrier]) => [query, fieldMap(query, carrier)],
  ));
  const tiedNormalizedItems = normalizeBackwardTies(listBackward[0], tables.issueListRead);
  const tiedFieldMap = deepClone(fieldMaps.issueListV2);
  tiedFieldMap.order.comparison = 'exact-after-id-tiebreak-normalization';
  const oracleCases = [
    ...Object.entries(oracleValues).map(([query, result]) => ({
      id: `${query}-normal`, query, fixture: 'normal-seed-v1',
      invocation: query === 'issueListV2' ? listArgs : query === 'issueDetail' ? detailArgs : pointArgs,
      oracle: { resultBytes: JSON.stringify(result), digest: digestBytes(JSON.stringify(result)) },
      fieldMap: fieldMaps[query],
      declaredGraph: {
        planHash: carriers[query].planHash,
        resultDisposition: query === 'issueListV2' ? 'admitted-non-search-fixed-order-shape' : 'admitted-fixed-id-structural-shape',
        fullOracleRows: 'refused',
        expected: expectedFromOracle(query, result, fieldMaps[query]),
      },
    })),
    {
      id: 'issueListV2-forward-page-and-resume', query: 'issueListV2', fixture: 'normal-seed-v1',
      invocation: listPageArgs,
      oracle: {
        resultBytes: JSON.stringify(listPage), digest: digestBytes(JSON.stringify(listPage)),
        resumedInvocation: listNextArgs,
        resumedResultBytes: JSON.stringify(listNextPage),
        resumedDigest: digestBytes(JSON.stringify(listNextPage)),
      },
      fieldMap: fieldMaps.issueListV2,
      declaredGraph: {
        planHash: carriers.issueListV2.planHash,
        resultDisposition: 'admitted-non-search-fixed-order-shape',
        fullOracleRows: 'refused',
        expected: expectedFromOracle(
          'issueListV2', listPage, fieldMaps.issueListV2, {nextResult: listNextPage},
        ),
      },
    },
    {
      id: 'issueListV2-backward-tied-modified', query: 'issueListV2', fixture: 'normal-seed-v1',
      oracleDivergence: 'direction-tie-break', invocation: listBackwardArgs,
      oracle: { resultBytes: JSON.stringify(listBackward), digest: digestBytes(JSON.stringify(listBackward)) },
      fieldMap: tiedFieldMap,
      declaredGraph: {
        planHash: carriers.issueListV2.planHash,
        orderedSourceIssueIDs: tiedNormalizedItems.map(item => item.issue.id),
        rowSetDigest: digestBytes(canonical(tiedNormalizedItems.map(item => item.issue.id).sort())),
        comparison: 'exact-after-id-tiebreak-normalization',
        expected: expectedFromOracle(
          'issueListV2', listBackward, tiedFieldMap, {items: tiedNormalizedItems},
        ),
      },
    },
  ];

  const pairedInvocation = invocation(carriers.listIssueByID, {
    sourceIssueID: 'zbav1_internal_issue', selectedLabelIDs: [],
  });
  const pairedExpect = completeEmptyResult(carriers.listIssueByID, pairedInvocation);
  const hiddenSlices = [
    ['issue', tables.issue.filter(row => row.visibility === 'internal').map(row => row._id)],
    ['comment', tables.comment.filter(row => row.id === 'zbav1_internal_comment').map(row => row._id)],
    ['emoji', tables.emoji.filter(row => row.id?.startsWith('zbav1_internal_')).map(row => row._id)],
    ['viewState', tables.viewState.filter(row => row.issueID === 'issue_ded0c2976675c34f4756035d' && row.userID !== fixture.actorBindings['ordinary-user'].userID).map(row => row._id)],
    ['userPref', tables.userPref.filter(row => row.key === 'zerobugs-acceptance.v1').map(row => row._id)],
    ['issueNotifications', tables.issueNotifications.filter(row => row.issueID === 'issue_ded0c2976675c34f4756035d').map(row => row._id)],
  ];
  const pairedWorlds = [];
  for (const [table, rowIds] of hiddenSlices) {
    const internalPointArgs = {
      listContext: defaultListContext(), idField: 'id', idValue: 'zbav1_internal_issue',
    };
    const presentResult = await handlers.listIssueByID(context, internalPointArgs);
    const absentTables = deepClone(tables);
    absentTables[table] = absentTables[table].filter(row => !rowIds.includes(row._id));
    const absentResult = await handlers.listIssueByID(
      mockContext(absentTables, ordinaryPrincipal), internalPointArgs,
    );
    assert.deepEqual(absentResult, presentResult, `${table} hidden slice must be observationally absent`);
    pairedWorlds.push({
      caseKind: 'pairedWorld', id: `zerobugs-hidden-${table}`,
      plan: carriers.listIssueByID, invocation: pairedInvocation,
      worlds: { present: { fixture: 'policy-extension-v1', hiddenSlice: [{ table, rowIds }] }, absent: { fixture: 'normal-seed-v1', hiddenSlice: [] } },
      oracleEvidence: { presentDigest: digestBytes(JSON.stringify(presentResult)), absentDigest: digestBytes(JSON.stringify(absentResult)) },
      expect: pairedExpect,
    });
  }

  const refusalCases = [
    { caseKind: 'refusal', id: 'issueListV2-search-membership', query: 'issueListV2', trigger: { phase: 'admission', plan: { sourceDeclaration: 'issueListSearchCandidate' }, schemaFixture: 'tests/conformance/graph/zerobugs/schema.mjs', policyFixture: 'public-read-corpus-mirror' }, expect: { reason: refusals.issueListV2, resultBytes: null } },
    { caseKind: 'refusal', id: 'issueDetail-ordered-result-bearing-through', query: 'issueDetail', trigger: { phase: 'admission', plan: { sourceDeclaration: 'issueDetailOrderedLabelsCandidate' }, schemaFixture: 'tests/conformance/graph/zerobugs/schema.mjs', policyFixture: 'public-read-corpus-mirror' }, expect: { reason: refusals.issueDetail, resultBytes: null } },
    { caseKind: 'refusal', id: 'listIssueByID-ordered-result-bearing-through', query: 'listIssueByID', trigger: { phase: 'admission', plan: { sourceDeclaration: 'listIssueByIDOrderedLabelsCandidate' }, schemaFixture: 'tests/conformance/graph/zerobugs/schema.mjs', policyFixture: 'public-read-corpus-mirror' }, expect: { reason: refusals.listIssueByID, resultBytes: null } },
  ];
  const cases = [
    ...pairedWorlds,
    ...pendingCases(carriers.listIssueByID, pairedInvocation),
    ...refusalCases,
  ];
  const corpus = {
    format: 'snapback.graph-conformance-corpus.v1', version: 1,
    description: 'G0 corpus: declarations compile/refuse; opaque JS handlers remain the oracle; G2-only evaluator cases are frozen but pending.',
    fixtures: { normal: 'demos/zerobugs/control/fixtures/normal-seed-v1', policyExtension: 'demos/zerobugs/control/fixtures/policy-extension-v1.json', large: 'demos/zerobugs/manifest/large-seed42-v1.receipt.json' },
    queries: Object.entries(carriers).map(([query, carrier]) => ({
      query, carrier, fieldMap: fieldMaps[query],
      disposition: {
        structuralDeclaration: 'admitted', fullOracleRows: 'refused',
        reason: refusals[query],
        detail: query === 'issueListV2' ? 'non-search fixed-order shape admitted; search membership refused' : 'fixed-id structural shape admitted; exact label-name-ordered through rows refused',
      },
    })),
    oracleCases, cases,
    caseKinds: ['pairedWorld', 'allowDeny', 'audienceParity', 'scopeMismatch', 'authorityTransition', 'mixedCommit', 'refusal'],
    broadcastInputs: [
      { label: 'G0-BCAST-CLASS', artifact: 'queries[*].carrier.normalizedPlan.nodes[*].authority', caseKinds: ['pairedWorld', 'refusal'] },
      { label: 'G0-BCAST-SEPARATION', artifact: 'queries[*].carrier.normalizedPlan.broadcast', caseKinds: ['allowDeny', 'refusal'] },
      { label: 'G0-BCAST-SCOPE', artifact: 'queries[*].carrier.normalizedPlan.broadcast', caseKinds: ['allowDeny', 'scopeMismatch'] },
      { label: 'G0-BCAST-SCOPE-BINDING', artifact: 'cases[scopeMismatch].invocations', caseKinds: ['scopeMismatch', 'refusal'] },
      { label: 'G0-BCAST-AUDIENCE', artifact: 'cases[audienceParity]', caseKinds: ['allowDeny', 'audienceParity'] },
      { label: 'G0-BCAST-INVALIDATION', artifact: 'cases[authorityTransition|mixedCommit].commit', caseKinds: ['authorityTransition', 'mixedCommit'] },
      { label: 'G0-BCAST-IDENTITY', artifact: 'queries[*].carrier + cases[*].invocation', caseKinds: ['pairedWorld', 'audienceParity', 'scopeMismatch', 'authorityTransition'] },
      { label: 'G0-BCAST-CORPUS', artifact: 'caseKinds + cases', caseKinds: ['pairedWorld', 'allowDeny', 'audienceParity', 'scopeMismatch', 'authorityTransition', 'mixedCommit', 'refusal'] },
      { label: 'G0-BCAST-BOUNDS', artifact: 'bound-derivation.v1.json + g0ExitObservations', caseKinds: ['pairedWorld', 'allowDeny', 'audienceParity', 'scopeMismatch', 'authorityTransition', 'mixedCommit'] },
    ],
    g0ExitObservations: Object.entries(carriers).flatMap(([query, carrier]) => {
      const normalResultBytes = measurements[query].normalResultBytes;
      const dependencyBytes = Buffer.byteLength(JSON.stringify(
        carrier.normalizedPlan.nodes.filter(node => node.kind !== 'closed-projection'),
      ));
      const normal = {
        format: 'snapback.graph-g0-exit-observation.v1', fixture: 'normal-seed-v1',
        graphPlanHash: carrier.planHash, groupCount: 1, subscriberFanout: 1,
        groups: [{
          groupOrdinal: 0, resultBytes: normalResultBytes, dependencyBytes,
          groupStateBytes: Buffer.byteLength(JSON.stringify({ graphPlanHash: carrier.planHash, resultBytes: normalResultBytes, dependencyBytes })),
        }],
        evidence: 'measured serialized opaque-oracle result plus frozen declared-dependency carrier; no graph executor exists',
      };
      return [
        normal,
        ...['large-seed42-v1', 'hot-recent-v1'].map(fixtureName => ({
          format: 'snapback.graph-g0-exit-observation.v1', fixture: fixtureName,
          graphPlanHash: carrier.planHash, pending: 'zb5-gate-rerun',
          command: fixtureName === 'large-seed42-v1'
            ? LARGE_SPOT_CHECK_COMMAND
            : HOT_SPOT_CHECK_COMMAND,
        })),
      ];
    }),
    requestedFixtures,
  };
  corpus.contentDigest = digestBytes(canonical(corpus));
  const bounds = boundDerivation(carriers, measurements, tables);
  bounds.contentDigest = digestBytes(canonical(bounds));

  if (checkOnly) {
    assert.equal(readFileSync(CORPUS_PATH, 'utf8'), pretty(corpus), 'corpus.v1.json is stale');
    assert.equal(readFileSync(BOUNDS_PATH, 'utf8'), pretty(bounds), 'bound-derivation.v1.json is stale');
  } else {
    writeFileSync(CORPUS_PATH, pretty(corpus));
    writeFileSync(BOUNDS_PATH, pretty(bounds));
  }
  console.log(`graph-g0-oracle-freeze: PASS normal-seed-v1 queries=3 oracleCases=${oracleCases.length} pairedWorlds=${pairedWorlds.length} refusals=${refusalCases.length}`);
  if (!existsSync(LARGE_ROOT)) console.log('graph-g0-large-spot-check: DEFERRED receipt-only; rerun zb5 command recorded in bound-derivation.v1.json');
}

await main();
