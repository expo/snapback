import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(root, 'queries.mjs');
const outputPath = join(root, 'filter-order-queries.generated.mjs');

const variants = [
  {
    name: 'issueListMatrixProjectModifiedAsc',
    filters: [['projectID', 'projectID']],
    index: 'by_matrix_project_modified',
    order: [['asc', 'modified']],
  },
  {
    name: 'issueListMatrixProjectModifiedDesc',
    filters: [['projectID', 'projectID']],
    index: 'by_matrix_project_modified',
    order: [['desc', 'modified']],
  },
  {
    name: 'issueListMatrixProjectCreatedAsc',
    filters: [['projectID', 'projectID']],
    index: 'by_matrix_project_created',
    order: [['asc', 'created']],
  },
  {
    name: 'issueListMatrixProjectCreatedDesc',
    filters: [['projectID', 'projectID']],
    index: 'by_matrix_project_created',
    order: [['desc', 'created']],
  },
  {
    name: 'issueListMatrixOpen',
    filters: [['projectID', 'projectID'], ['open', 'open']],
    index: 'by_matrix_project_open_modified',
    order: [['desc', 'modified']],
    args: [['open', 'boolean']],
  },
  {
    name: 'issueListMatrixCreator',
    filters: [['projectID', 'projectID'], ['creatorID', 'creatorID']],
    index: 'by_matrix_project_creator_modified',
    order: [['desc', 'modified']],
    args: [['creatorID', 'string']],
  },
  {
    name: 'issueListMatrixAssignee',
    filters: [['projectID', 'projectID'], ['assigneeID', 'assigneeID']],
    index: 'by_matrix_project_assignee_modified',
    order: [['desc', 'modified']],
    args: [['assigneeID', 'string']],
  },
  {
    name: 'issueListMatrixLabelsAll',
    filters: [['projectID', 'projectID']],
    index: 'by_matrix_project_modified',
    order: [['desc', 'modified']],
  },
  {
    name: 'issueListMatrixCombined',
    filters: [
      ['projectID', 'projectID'],
      ['open', 'open'],
      ['creatorID', 'creatorID'],
      ['assigneeID', 'assigneeID'],
    ],
    index: 'by_matrix_project_open_creator_assignee_modified',
    order: [['desc', 'modified']],
    args: [['open', 'boolean'], ['creatorID', 'string'], ['assigneeID', 'string']],
  },
  {
    name: 'issueListWindowsAssigneeAsc',
    filters: [['projectID', 'projectID']],
    index: 'by_matrix_project_assignee_order',
    order: [['asc', 'assigneeID']],
  },
  {
    name: 'issueListWindowsAssigneeDesc',
    filters: [['projectID', 'projectID']],
    index: 'by_matrix_project_assignee_order',
    order: [['desc', 'assigneeID']],
  },
  {
    name: 'issueListWindowsAssigneeBefore',
    filters: [['projectID', 'projectID'], ['assigneeID', 'assigneeID', 'Lt']],
    index: 'by_matrix_project_assignee_order',
    order: [['asc', 'assigneeID']],
    args: [['assigneeID', 'string']],
  },
];

const source = readFileSync(sourcePath, 'utf8');
const match = source.match(
  /(export const issueListV2 = graph\.defineGraphQuery\(\{[\s\S]*?\n\}\);)\n\nexport const issueDetail/u,
);
assert(match, 'issueListV2 literal declaration template');
const template = match[1];
const detailMatch = source.match(
  /(export const issueDetail = graph\.defineGraphQuery\(\{[\s\S]*?\n\}\);)\n\n\/\/ The narrowest/u,
);
assert(detailMatch, 'issueDetail literal declaration template');
const detailTemplate = detailMatch[1];

function renderVariant(variant) {
  const filters = variant.filters
    .map(([field, argument, operator = 'Eq']) => (
      `{ field: '${field}', op: '${operator}', value: graph.arg('${argument}') }`
    ))
    .join(', ');
  const order = variant.order
    .map(([direction, field]) => `graph.${direction}('${field}')`)
    .join(', ');
  const extraArgs = (variant.args ?? []).map(([name, type]) => (
    type === 'boolean'
      ? `    ${name}: graph.v.boolean(),`
      : `    ${name}: graph.v.string({ maxBytes: 128 }),`
  ));
  const argumentItems = 17 + extraArgs.length;
  return template
    .replace('export const issueListV2 =', `export const ${variant.name} =`)
    .replace(
      "filters: [{ field: 'projectID', op: 'Eq', value: graph.arg('projectID') }],\n      accessIndex: 'by_project_modified',\n      order: [graph.desc('modified'), graph.desc('sourceIssueID')],",
      `filters: [${filters}],\n      accessIndex: '${variant.index}',\n      order: [${order}],`,
    )
    .replace(
      "  args: {\n    projectID: graph.v.string({ maxBytes: 128 }),\n    selectedLabelIDs: graph.v.array(graph.v.string({ maxBytes: 128 }), { maxItems: 16 }),\n  },",
      [
        '  args: {',
        "    projectID: graph.v.string({ maxBytes: 128 }),",
        "    selectedLabelIDs: graph.v.array(graph.v.string({ maxBytes: 128 }), { maxItems: 16 }),",
        ...extraArgs,
        '  },',
      ].join('\n'),
    )
    .replace('maxArgumentItems: 17,', `maxArgumentItems: ${argumentItems},`)
    .replaceAll(
      'maxWindowPages: 1, maxWindowRootRows: 1_024, maxWindowScannedRows: 54_273, maxWindowResultRows: 1_024, maxWindowResultBytes: 33_554_432, maxWindowIndexRanges: 36_865',
      'maxWindowPages: 2, maxWindowRootRows: 2_048, maxWindowScannedRows: 108_546, maxWindowResultRows: 2_048, maxWindowResultBytes: 67_108_864, maxWindowIndexRanges: 73_730',
    );
}

function renderDetailVariant() {
  return detailTemplate
    .replace('export const issueDetail =', 'export const issueDetailTwoWay =')
    .replace(
      "{ nodeId: 'comments', maxExaminedEntriesPerExecution: 1_025, maxRelationshipLookupsPerExecution: 1, maxChildrenPerParent: 1_024, maxWindowPages: 1, maxWindowRootRows: 0, maxWindowScannedRows: 1_025, maxWindowResultRows: 1, maxWindowResultBytes: 8_388_608, maxWindowIndexRanges: 1 },",
      "{ nodeId: 'comments', maxExaminedEntriesPerExecution: 1_025, maxRelationshipLookupsPerExecution: 1, maxChildrenPerParent: 1_024, maxWindowPages: 2, maxWindowRootRows: 0, maxWindowScannedRows: 2_050, maxWindowResultRows: 2, maxWindowResultBytes: 16_777_216, maxWindowIndexRanges: 2 },",
    )
    .replace(
      'windowRollup: { maxWindowPages: 2, maxWindowRootRows: 1, maxWindowScannedRows: 2_092, maxWindowResultRows: 2, maxWindowResultBytes: 16_777_216, maxWindowIndexRanges: 27 }',
      'windowRollup: { maxWindowPages: 3, maxWindowRootRows: 1, maxWindowScannedRows: 3_117, maxWindowResultRows: 3, maxWindowResultBytes: 25_165_824, maxWindowIndexRanges: 28 }',
    );
}

const output = [
  '// Generated by generate-filter-order-queries.mjs; do not hand-edit.',
  '// Each export is a complete static plan so admission never receives a client-authored AST.',
  "import * as graph from '@expo/snapback-codegen/define';",
  'import {',
  '  comment, identityBinding, issue, issueLabelRead, issueListRead,',
  '  issueNotifications, label, project, user, viewState,',
  "} from './schema.mjs';",
  '',
  ...variants.flatMap(variant => [renderVariant(variant), '']),
  renderDetailVariant(),
  '',
].join('\n');

if (process.argv.includes('--check')) {
  assert.equal(readFileSync(outputPath, 'utf8'), output, 'filter/order generated declarations are stale');
} else {
  writeFileSync(outputPath, output);
}

console.log(`graph-filter-order-query-generation: PASS variants=${variants.length + 1}`);
