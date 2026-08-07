import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | {[key: string]: JsonValue};
type CsvRow = Record<string, string>;
type SourceRow = Record<string, JsonValue>;

const CONTROL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_ROOT = resolve(CONTROL_ROOT, '../../..');
const DEFAULT_RECEIPT = join(
  REPOSITORY_ROOT,
  'demos/zerobugs/manifest/large-seed42-v1.receipt.json',
);
const DEFAULT_OUTPUT = join(
  CONTROL_ROOT,
  '.snapback/large-fixture/large-overlay-v1.json',
);

export const MANIFEST_ID = 'zerobugs-acceptance.v1';
export const LARGE_FIXTURE_ID = 'large-seed42-v1';
export const LARGE_OVERLAY_ID = 'large-overlay-v1';
export const POLICY_EXTENSION_ID = 'policy-extension-v1';
export const GENERATION_INSTANT = '2026-08-05T00:00:00.000Z';
export const GENERATION_EPOCH_MS = Date.parse(GENERATION_INSTANT);
export const POLICY_ISSUE_ID = 'zbav1_internal_issue';
export const POLICY_ISSUE_SHORT_ID = 9_183_001;
export const POLICY_COMMENT_ID = 'zbav1_internal_comment';
export const POLICY_ISSUE_EMOJI_ID = 'zbav1_internal_issue_emoji';
export const POLICY_COMMENT_EMOJI_ID = 'zbav1_internal_comment_emoji';
export const DEFAULT_WORKING_SET_SIZE = 1_000;

const GENERATED_TABLES = [
  'user',
  'project',
  'label',
  'issue',
  'comment',
  'issueLabel',
] as const;

const CSV_HEADERS: Record<(typeof GENERATED_TABLES)[number], readonly string[]> = {
  user: ['id', 'login', 'name', 'avatar', 'role', 'githubID', 'email'],
  project: ['id', 'name', 'lowerCaseName'],
  label: ['id', 'name', 'projectID'],
  issue: [
    'id', 'title', 'open', 'modified', 'created', 'creatorID', 'assigneeID',
    'description', 'visibility', 'projectID',
  ],
  comment: ['id', 'issueID', 'created', 'body', 'creatorID'],
  issueLabel: ['labelID', 'issueID', 'projectID'],
};

interface LargeFixtureReceipt {
  schemaVersion: string;
  fixtureId: string;
  counts: Record<(typeof GENERATED_TABLES)[number] | 'total', number>;
  shards: Record<string, string>;
  overallDigest: string;
  syntheticStandIn?: boolean;
}

interface ActorBinding {
  role: 'crew' | 'user';
  sourceUserID: string;
}

type ActorName =
  | 'ordinary-user'
  | 'creator'
  | 'assignee'
  | 'crew-admin'
  | 'removed-member';

export type ActorBindings = Record<ActorName, ActorBinding>;

interface IssueRow {
  id: string;
  title: string;
  open: boolean;
  modified: number;
  created: number;
  creatorID: string;
  description: string;
  visibility: string;
  projectID: string;
  assigneeID?: string;
  shortID?: number;
}

interface CommentRow {
  id: string;
  issueID: string;
  created: number;
  body: string;
  creatorID: string;
}

interface UserRow {
  id: string;
  login: string;
  role: 'crew' | 'user';
}

export interface LargeOverlayEnvelope {
  schemaVersion: 'zerobugs-large-overlay-envelope.v1';
  contentDigest: string;
  payload: LargeOverlayPayload;
}

export interface LargeOverlayPayload {
  schemaVersion: 'zerobugs-large-overlay.v1';
  manifestId: typeof MANIFEST_ID;
  fixtureId: string;
  overlayId: typeof LARGE_OVERLAY_ID;
  policyExtensionId: typeof POLICY_EXTENSION_ID;
  generationInstant: typeof GENERATION_INSTANT;
  generationEpochMs: number;
  sourceReceiptDigest: string;
  sourceOverallDigest: string;
  profileMode: 'authoritative-large' | 'synthetic-stand-in';
  actorBindings: ActorBindings;
  selectedProject: {id: string; issueCount: number};
  workingSet: {
    bound: number;
    issueIDs: string[];
    issueIDsDigest: string;
    oracleRows: IssueRow[];
    newestComments: Record<string, CommentRow>;
  };
  rows: Record<string, SourceRow[]>;
  projections: Record<string, SourceRow[]>;
  counts: Record<string, number>;
  gaps: Array<Record<string, JsonValue>>;
  determinism: Record<string, JsonValue>;
}

function refuse(message: string): never {
  throw new Error(`ZBUGS_LARGE_OVERLAY_REFUSED: ${message}`);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareTuple(left: readonly string[], right: readonly string[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const compared = compareText(left[index] ?? '', right[index] ?? '');
    if (compared !== 0) return compared;
  }
  return 0;
}

function compareIssueRecency(left: IssueRow, right: IssueRow): number {
  const modified = right.modified - left.modified;
  return modified === 0 ? compareText(right.id, left.id) : modified;
}

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) refuse('canonical JSON received a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function taggedDigest(value: JsonValue): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

export function overlayHash(
  table: string,
  actorSourceID: string,
  naturalKeyFields: readonly string[],
): Buffer {
  return createHash('sha256')
    .update([MANIFEST_ID, table, actorSourceID, ...naturalKeyFields].join('\0'), 'utf8')
    .digest();
}

export function overlayID(
  table: string,
  actorSourceID: string,
  naturalKeyFields: readonly string[],
): string {
  return `zbav1_${overlayHash(table, actorSourceID, naturalKeyFields).toString('hex').slice(0, 24)}`;
}

function readNumber(value: string, location: string): number {
  if (value === '') refuse(`${location} is required`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) refuse(`${location} is not a finite number`);
  return parsed;
}

function readInteger(value: string, location: string): number {
  const parsed = readNumber(value, location);
  if (!Number.isSafeInteger(parsed)) refuse(`${location} is not a safe integer`);
  return parsed;
}

function readBoolean(value: string, location: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  refuse(`${location} must be true or false`);
}

function required(value: string, location: string): string {
  if (value === '') refuse(`${location} is required`);
  return value;
}

async function sha256FileHex(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function shardTable(fileName: string): (typeof GENERATED_TABLES)[number] {
  const table = fileName.replace(/_[0-9]{3}\.csv$/u, '');
  if (!GENERATED_TABLES.includes(table as (typeof GENERATED_TABLES)[number])) {
    refuse(`receipt names unsupported shard ${fileName}`);
  }
  return table as (typeof GENERATED_TABLES)[number];
}

export async function verifyLargeFixtureShards(
  fixtureRoot: string,
  receiptPath = DEFAULT_RECEIPT,
): Promise<{receipt: LargeFixtureReceipt; receiptDigest: string; shardsByTable: Record<string, string[]>}> {
  const receiptBytes = await readFile(receiptPath);
  const receipt = JSON.parse(receiptBytes.toString('utf8')) as LargeFixtureReceipt;
  if (receipt.schemaVersion !== 'zerobugs-large-fixture.v1') {
    refuse(`unsupported source receipt schema ${JSON.stringify(receipt.schemaVersion)}`);
  }
  if (receipt.fixtureId !== LARGE_FIXTURE_ID && receipt.syntheticStandIn !== true) {
    refuse(`source receipt fixture id ${JSON.stringify(receipt.fixtureId)} is not ${LARGE_FIXTURE_ID}`);
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(receipt.overallDigest)) {
    refuse('source receipt has an invalid overall digest');
  }
  const shardsByTable = Object.fromEntries(GENERATED_TABLES.map(table => [table, []])) as Record<string, string[]>;
  const shardNames = Object.keys(receipt.shards).sort(compareText);
  if (shardNames.length === 0) refuse('source receipt names no CSV shards');
  for (const fileName of shardNames) {
    const expected = receipt.shards[fileName];
    if (!/^[0-9a-f]{64}$/u.test(expected)) refuse(`${fileName} has an invalid receipt digest`);
    const table = shardTable(fileName);
    const path = join(fixtureRoot, fileName);
    const actual = await sha256FileHex(path);
    if (actual !== expected) {
      refuse(`${fileName} digest mismatch: expected ${expected}, observed ${actual}`);
    }
    shardsByTable[table].push(path);
  }
  for (const table of GENERATED_TABLES) {
    shardsByTable[table].sort(compareText);
    if (shardsByTable[table].length === 0) refuse(`source receipt names no ${table} shard`);
  }
  return {
    receipt,
    receiptDigest: `sha256:${sha256Hex(receiptBytes)}`,
    shardsByTable,
  };
}

async function* csvRecords(path: string): AsyncGenerator<string[]> {
  const stream = createReadStream(path, {encoding: 'utf8'});
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let quotePending = false;
  let atFieldStart = true;

  const finishField = () => {
    record.push(field);
    field = '';
    atFieldStart = true;
  };

  for await (const rawChunk of stream) {
    const chunk = String(rawChunk);
    for (const character of chunk) {
      let current = character;
      if (quotePending) {
        if (current === '"') {
          field += '"';
          quotePending = false;
          atFieldStart = false;
          continue;
        }
        quotePending = false;
        inQuotes = false;
      }
      if (inQuotes) {
        if (current === '"') quotePending = true;
        else field += current;
        continue;
      }
      if (current === '"') {
        if (!atFieldStart) refuse(`${path} contains a quote inside an unquoted CSV field`);
        inQuotes = true;
        atFieldStart = false;
      } else if (current === ',') {
        finishField();
      } else if (current === '\n') {
        finishField();
        yield record;
        record = [];
      } else if (current !== '\r') {
        field += current;
        atFieldStart = false;
      }
    }
  }
  if (quotePending) {
    quotePending = false;
    inQuotes = false;
  }
  if (inQuotes) refuse(`${path} ends inside a quoted CSV field`);
  if (field.length > 0 || record.length > 0) {
    finishField();
    yield record;
  }
}

export async function* readCsvTable(
  paths: readonly string[],
  table: (typeof GENERATED_TABLES)[number],
): AsyncGenerator<CsvRow> {
  let rowCount = 0;
  for (const path of paths) {
    let header: string[] | null = null;
    for await (const fields of csvRecords(path)) {
      if (header === null) {
        header = fields;
        if (canonicalJson(header) !== canonicalJson([...CSV_HEADERS[table]])) {
          refuse(`${path} header mismatch: ${JSON.stringify(header)}`);
        }
        continue;
      }
      if (fields.length !== header.length) {
        refuse(`${path} row ${rowCount + 2} has ${fields.length}/${header.length} fields`);
      }
      rowCount += 1;
      yield Object.fromEntries(header.map((name, index) => [name, fields[index]]));
    }
    if (header === null) refuse(`${path} is empty`);
  }
}

function bindActors(users: readonly UserRow[]): ActorBindings {
  const crew = users.filter(user => user.role === 'crew').sort((a, b) => compareText(a.id, b.id));
  const ordinary = users.filter(user => user.role === 'user').sort((a, b) => compareText(a.id, b.id));
  if (crew.length < 2 || ordinary.length < 3) refuse('cannot form the five authenticated actor bindings');
  return {
    'ordinary-user': {role: 'user', sourceUserID: ordinary[0].id},
    creator: {role: 'user', sourceUserID: ordinary[1].id},
    assignee: {role: 'user', sourceUserID: ordinary[2].id},
    'crew-admin': {role: 'crew', sourceUserID: crew[0].id},
    'removed-member': {role: 'crew', sourceUserID: crew[1].id},
  };
}

function generatedRowID(
  table: string,
  actorSourceID: string,
  naturalKeyFields: readonly string[],
  ids: Map<string, string>,
): string {
  const id = overlayID(table, actorSourceID, naturalKeyFields);
  const owner = ids.get(id);
  if (owner) refuse(`generated id collision ${id} between ${owner} and ${table}`);
  ids.set(id, table);
  return id;
}

function supportID(table: string, naturalKeyFields: readonly string[]): string {
  return `zbrm_${sha256Hex([MANIFEST_ID, LARGE_OVERLAY_ID, table, ...naturalKeyFields].join('\0')).slice(0, 24)}`;
}

function expectCount(receipt: LargeFixtureReceipt, table: string, observed: number): void {
  const expected = receipt.counts[table as keyof LargeFixtureReceipt['counts']];
  if (!Number.isSafeInteger(expected) || observed !== expected) {
    refuse(`${table} count mismatch: expected ${String(expected)}, observed ${observed}`);
  }
}

function sourceIssue(source: CsvRow, location: string): IssueRow {
  const visibility = required(source.visibility, `${location}.visibility`);
  if (visibility !== 'public' && visibility !== 'internal') {
    refuse(`${location}.visibility is not public|internal`);
  }
  const row: IssueRow = {
    id: required(source.id, `${location}.id`),
    title: required(source.title, `${location}.title`),
    open: readBoolean(source.open, `${location}.open`),
    modified: readNumber(source.modified, `${location}.modified`),
    created: readNumber(source.created, `${location}.created`),
    creatorID: required(source.creatorID, `${location}.creatorID`),
    description: source.description,
    visibility,
    projectID: required(source.projectID, `${location}.projectID`),
  };
  if (source.assigneeID !== '') row.assigneeID = source.assigneeID;
  return row;
}

function sourceComment(source: CsvRow, location: string): CommentRow {
  return {
    id: required(source.id, `${location}.id`),
    issueID: required(source.issueID, `${location}.issueID`),
    created: readNumber(source.created, `${location}.created`),
    body: source.body,
    creatorID: required(source.creatorID, `${location}.creatorID`),
  };
}

// A worst-first bounded heap keeps the per-project selection pass at
// O(issueCount log W). Sorting all W rows after every one of the million input
// issues would make fixture qualification itself an unusable workload.
function compareIssueWorstFirst(left: IssueRow, right: IssueRow): number {
  return compareIssueRecency(right, left);
}

function bubbleHeapUp(heap: IssueRow[], start: number): void {
  let index = start;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (compareIssueWorstFirst(heap[index], heap[parent]) >= 0) break;
    [heap[index], heap[parent]] = [heap[parent], heap[index]];
    index = parent;
  }
}

function bubbleHeapDown(heap: IssueRow[], start: number): void {
  let index = start;
  for (;;) {
    const left = index * 2 + 1;
    const right = left + 1;
    let candidate = index;
    if (
      left < heap.length
      && compareIssueWorstFirst(heap[left], heap[candidate]) < 0
    ) candidate = left;
    if (
      right < heap.length
      && compareIssueWorstFirst(heap[right], heap[candidate]) < 0
    ) candidate = right;
    if (candidate === index) return;
    [heap[index], heap[candidate]] = [heap[candidate], heap[index]];
    index = candidate;
  }
}

function addTopIssue(top: IssueRow[], issue: IssueRow, bound: number): void {
  if (top.length < bound) {
    top.push(issue);
    bubbleHeapUp(top, top.length - 1);
    return;
  }
  // `top[0]` is the least-recent admitted issue. Replace it only when the
  // candidate precedes it under (modified desc, id desc).
  if (compareIssueRecency(issue, top[0]) >= 0) return;
  top[0] = issue;
  bubbleHeapDown(top, 0);
}

export async function buildLargeOverlay(options: {
  fixtureRoot: string;
  receiptPath?: string;
  outputPath?: string;
  workingSetSize?: number;
}): Promise<{outputPath: string; fileDigest: string; envelope: LargeOverlayEnvelope}> {
  const fixtureRoot = resolve(options.fixtureRoot);
  const receiptPath = resolve(options.receiptPath ?? DEFAULT_RECEIPT);
  const outputPath = resolve(options.outputPath ?? DEFAULT_OUTPUT);
  const verified = await verifyLargeFixtureShards(fixtureRoot, receiptPath);
  const {receipt, receiptDigest, shardsByTable} = verified;
  const synthetic = receipt.syntheticStandIn === true;
  const workingSetSize = options.workingSetSize ?? DEFAULT_WORKING_SET_SIZE;
  if (!Number.isSafeInteger(workingSetSize) || workingSetSize <= 0) {
    refuse('working-set size must be a positive safe integer');
  }
  if (!synthetic && workingSetSize !== DEFAULT_WORKING_SET_SIZE) {
    refuse(`authoritative ${LARGE_FIXTURE_ID} must use a 1,000-issue working set`);
  }

  const users: UserRow[] = [];
  const userIDs = new Set<string>();
  let userCount = 0;
  for await (const source of readCsvTable(shardsByTable.user, 'user')) {
    userCount += 1;
    const id = required(source.id, `user row ${userCount}.id`);
    if (userIDs.has(id)) refuse(`duplicate user id ${id}`);
    userIDs.add(id);
    const role = source.role;
    if (role !== 'crew' && role !== 'user') refuse(`user ${id} role is not crew|user`);
    readInteger(source.githubID, `user ${id}.githubID`);
    users.push({id, login: required(source.login, `user ${id}.login`), role});
  }
  expectCount(receipt, 'user', userCount);
  const actorBindings = bindActors(users);

  const projectIDs = new Set<string>();
  let projectCount = 0;
  for await (const source of readCsvTable(shardsByTable.project, 'project')) {
    projectCount += 1;
    const id = required(source.id, `project row ${projectCount}.id`);
    if (projectIDs.has(id)) refuse(`duplicate project id ${id}`);
    projectIDs.add(id);
    required(source.name, `project ${id}.name`);
    required(source.lowerCaseName, `project ${id}.lowerCaseName`);
  }
  expectCount(receipt, 'project', projectCount);

  const labelProjects = new Map<string, string>();
  let labelCount = 0;
  for await (const source of readCsvTable(shardsByTable.label, 'label')) {
    labelCount += 1;
    const id = required(source.id, `label row ${labelCount}.id`);
    const projectID = required(source.projectID, `label ${id}.projectID`);
    if (labelProjects.has(id)) refuse(`duplicate label id ${id}`);
    if (!projectIDs.has(projectID)) refuse(`label ${id} references missing project ${projectID}`);
    labelProjects.set(id, projectID);
  }
  expectCount(receipt, 'label', labelCount);

  const issueProjects = new Map<string, string>();
  const projectIssueCounts = new Map<string, number>();
  const topsByProject = new Map<string, IssueRow[]>();
  let issueCount = 0;
  for await (const source of readCsvTable(shardsByTable.issue, 'issue')) {
    issueCount += 1;
    const issue = sourceIssue(source, `issue row ${issueCount}`);
    if (issueProjects.has(issue.id)) refuse(`duplicate issue id ${issue.id}`);
    if (!projectIDs.has(issue.projectID)) refuse(`issue ${issue.id} references missing project ${issue.projectID}`);
    if (!userIDs.has(issue.creatorID)) refuse(`issue ${issue.id} references missing creator ${issue.creatorID}`);
    if (issue.assigneeID && !userIDs.has(issue.assigneeID)) {
      refuse(`issue ${issue.id} references missing assignee ${issue.assigneeID}`);
    }
    issueProjects.set(issue.id, issue.projectID);
    projectIssueCounts.set(issue.projectID, (projectIssueCounts.get(issue.projectID) ?? 0) + 1);
    const top = topsByProject.get(issue.projectID) ?? [];
    addTopIssue(top, issue, workingSetSize);
    topsByProject.set(issue.projectID, top);
  }
  expectCount(receipt, 'issue', issueCount);
  let selectedProjectID = '';
  let selectedIssueCount = -1;
  for (const projectID of [...projectIDs].sort(compareText)) {
    const count = projectIssueCounts.get(projectID) ?? 0;
    if (count > selectedIssueCount) {
      selectedProjectID = projectID;
      selectedIssueCount = count;
    }
  }
  if (!selectedProjectID) refuse('could not select a project by issue count');

  if (issueProjects.has(POLICY_ISSUE_ID)) refuse(`policy issue id collision ${POLICY_ISSUE_ID}`);
  const policyIssue: IssueRow = {
    id: POLICY_ISSUE_ID,
    shortID: POLICY_ISSUE_SHORT_ID,
    title: 'policy-extension-v1 internal issue',
    open: true,
    modified: GENERATION_EPOCH_MS + 1,
    created: GENERATION_EPOCH_MS,
    projectID: selectedProjectID,
    creatorID: actorBindings.creator.sourceUserID,
    assigneeID: actorBindings.assignee.sourceUserID,
    description: 'policy-extension-v1 protected issue fixture',
    visibility: 'internal',
  };
  const workingIssues = [policyIssue, ...(topsByProject.get(selectedProjectID) ?? [])]
    .sort(compareIssueRecency)
    .slice(0, workingSetSize);
  if (workingIssues.length !== workingSetSize) {
    refuse(`selected project has only ${workingIssues.length}/${workingSetSize} working-set issues`);
  }
  if (workingIssues[0]?.id !== POLICY_ISSUE_ID) {
    refuse('policy issue did not enter the working set as the most recent issue');
  }
  const workingIDs = new Set(workingIssues.map(issue => issue.id));

  const commentsByWorkingIssue = new Map<string, CommentRow[]>();
  const commentIDs = new Set<string>();
  let commentCount = 0;
  for await (const source of readCsvTable(shardsByTable.comment, 'comment')) {
    commentCount += 1;
    const comment = sourceComment(source, `comment row ${commentCount}`);
    if (commentIDs.has(comment.id)) refuse(`duplicate comment id ${comment.id}`);
    commentIDs.add(comment.id);
    if (!issueProjects.has(comment.issueID)) {
      refuse(`comment ${comment.id} references missing issue ${comment.issueID}`);
    }
    if (!userIDs.has(comment.creatorID)) {
      refuse(`comment ${comment.id} references missing creator ${comment.creatorID}`);
    }
    if (workingIDs.has(comment.issueID)) {
      const rows = commentsByWorkingIssue.get(comment.issueID) ?? [];
      rows.push(comment);
      commentsByWorkingIssue.set(comment.issueID, rows);
    }
  }
  expectCount(receipt, 'comment', commentCount);
  if (commentIDs.has(POLICY_COMMENT_ID)) refuse(`policy comment id collision ${POLICY_COMMENT_ID}`);
  const policyComment: CommentRow = {
    id: POLICY_COMMENT_ID,
    issueID: POLICY_ISSUE_ID,
    created: GENERATION_EPOCH_MS,
    body: 'policy-extension-v1 protected child comment',
    creatorID: actorBindings.creator.sourceUserID,
  };
  commentsByWorkingIssue.set(POLICY_ISSUE_ID, [policyComment]);

  const workingIssueLabels: SourceRow[] = [];
  let issueLabelCount = 0;
  const issueLabelKeys = new Set<string>();
  for await (const source of readCsvTable(shardsByTable.issueLabel, 'issueLabel')) {
    issueLabelCount += 1;
    const labelID = required(source.labelID, `issueLabel row ${issueLabelCount}.labelID`);
    const issueID = required(source.issueID, `issueLabel row ${issueLabelCount}.issueID`);
    const projectID = required(source.projectID, `issueLabel row ${issueLabelCount}.projectID`);
    const key = `${labelID}\0${issueID}`;
    if (issueLabelKeys.has(key)) refuse(`duplicate issueLabel key ${JSON.stringify(key)}`);
    issueLabelKeys.add(key);
    const issueProject = issueProjects.get(issueID);
    const labelProject = labelProjects.get(labelID);
    if (!issueProject) refuse(`issueLabel references missing issue ${issueID}`);
    if (!labelProject) refuse(`issueLabel references missing label ${labelID}`);
    if (!projectIDs.has(projectID) || issueProject !== projectID || labelProject !== projectID) {
      refuse(`issueLabel (${labelID},${issueID}) crosses project boundaries`);
    }
    if (workingIDs.has(issueID)) workingIssueLabels.push({labelID, issueID, projectID});
  }
  expectCount(receipt, 'issueLabel', issueLabelCount);
  const total = userCount + projectCount + labelCount + issueCount + commentCount + issueLabelCount;
  expectCount(receipt, 'total', total);

  const actorRows = Object.entries(actorBindings)
    .map(([actor, binding]) => ({actor: actor as ActorName, ...binding}))
    .sort((left, right) => compareText(left.sourceUserID, right.sourceUserID));
  const generatedIDs = new Map<string, string>();

  const privateSpecs = actorRows.flatMap(actor => workingIssues.map(issue => ({actor, issue})))
    .sort((left, right) => compareTuple(
      [left.actor.sourceUserID, left.issue.id],
      [right.actor.sourceUserID, right.issue.id],
    ));
  const viewState = privateSpecs.map(({actor, issue}, rank) => ({
    _id: generatedRowID('viewState', actor.sourceUserID, [issue.id], generatedIDs),
    issueID: issue.id,
    userID: actor.sourceUserID,
    viewed: GENERATION_EPOCH_MS - rank,
  }));
  const issueNotifications = privateSpecs.map(({actor, issue}, rank) => ({
    _id: generatedRowID('issueNotifications', actor.sourceUserID, [issue.id], generatedIDs),
    userID: actor.sourceUserID,
    issueID: issue.id,
    subscribed: overlayHash('issueNotifications', actor.sourceUserID, [issue.id])[0] % 2 === 0,
    created: GENERATION_EPOCH_MS - rank,
  }));
  const userPref = actorRows.map(actor => {
    const digest = overlayHash('userPref', actor.sourceUserID, [MANIFEST_ID]).toString('hex');
    return {
      _id: generatedRowID('userPref', actor.sourceUserID, [MANIFEST_ID], generatedIDs),
      key: MANIFEST_ID,
      userID: actor.sourceUserID,
      value: digest.slice(0, 32),
    };
  });

  const newestComments: Record<string, CommentRow> = {};
  const emojiSpecs: Array<{kind: 'comment' | 'issue'; subjectID: string; policy: boolean}> = [];
  for (const issue of workingIssues) {
    emojiSpecs.push({kind: 'issue', subjectID: issue.id, policy: issue.id === POLICY_ISSUE_ID});
    const comments = commentsByWorkingIssue.get(issue.id) ?? [];
    comments.sort((left, right) => {
      const created = right.created - left.created;
      return created === 0 ? compareText(right.id, left.id) : created;
    });
    if (comments[0]) {
      newestComments[issue.id] = comments[0];
      emojiSpecs.push({
        kind: 'comment',
        subjectID: comments[0].id,
        policy: issue.id === POLICY_ISSUE_ID,
      });
    }
  }
  emojiSpecs.sort((left, right) => compareTuple(
    [left.kind, left.subjectID],
    [right.kind, right.subjectID],
  ));
  const emoji = emojiSpecs.map((spec, rank) => {
    const actor = spec.policy
      ? actorBindings.creator
      : actorRows[rank % actorRows.length];
    const fixedID = spec.policy
      ? spec.kind === 'issue' ? POLICY_ISSUE_EMOJI_ID : POLICY_COMMENT_EMOJI_ID
      : null;
    const id = fixedID ?? generatedRowID(
      'emoji',
      actor.sourceUserID,
      [spec.kind, spec.subjectID, '👍'],
      generatedIDs,
    );
    if (fixedID) {
      if (generatedIDs.has(fixedID)) refuse(`policy emoji id collision ${fixedID}`);
      generatedIDs.set(fixedID, 'emoji');
    }
    return {
      _id: id,
      id,
      value: '👍',
      annotation: 'thumbs up',
      subjectID: spec.subjectID,
      creatorID: actor.sourceUserID,
      created: GENERATION_EPOCH_MS - rank,
    };
  });

  const projectUser = new Map<string, {isCreator: boolean; isAssignee: boolean; isCrew: boolean}>();
  const markProjectUser = (userID: string, field: 'isCreator' | 'isAssignee' | 'isCrew') => {
    const current = projectUser.get(userID) ?? {isCreator: false, isAssignee: false, isCrew: false};
    current[field] = true;
    projectUser.set(userID, current);
  };
  for (const issue of workingIssues) {
    markProjectUser(issue.creatorID, 'isCreator');
    if (issue.assigneeID) markProjectUser(issue.assigneeID, 'isAssignee');
  }
  for (const user of users) {
    if (user.role === 'crew' && !user.login.startsWith('rocibot')) markProjectUser(user.id, 'isCrew');
  }
  const projectUserRead = [...projectUser.entries()].sort(([left], [right]) => compareText(left, right))
    .map(([userID, reasons]) => ({
      _id: supportID('projectUserRead', [selectedProjectID, userID]),
      projectID: selectedProjectID,
      userID,
      ...reasons,
    }));
  const issueListRead = workingIssues.map(issue => ({
    _id: supportID('issueListRead', [issue.id]),
    issueID: issue.id,
    sourceIssueID: issue.id,
    projectID: issue.projectID,
    creatorID: issue.creatorID,
    ...(issue.assigneeID ? {assigneeID: issue.assigneeID} : {}),
    open: issue.open,
    visibility: issue.visibility,
    modified: issue.modified,
    created: issue.created,
  }));
  const issueLabelRead = workingIssueLabels
    .sort((left, right) => compareTuple(
      [String(left.issueID), String(left.labelID)],
      [String(right.issueID), String(right.labelID)],
    ))
    .map(edge => ({
      _id: supportID('issueLabelRead', [String(edge.labelID), String(edge.issueID)]),
      ...edge,
    }));
  const issueSearchDocument = workingIssues.map(issue => {
    const comments = [...(commentsByWorkingIssue.get(issue.id) ?? [])].sort((left, right) => {
      const created = left.created - right.created;
      return created === 0 ? compareText(left.id, right.id) : created;
    });
    return {
      _id: supportID('issueSearchDocument', [issue.id]),
      issueID: issue.id,
      sourceIssueID: issue.id,
      projectID: issue.projectID,
      visibility: issue.visibility,
      title: issue.title,
      description: issue.description,
      commentText: comments.map(comment => comment.body).join('\n'),
    };
  });
  const searchEpoch = (['internal', 'public'] as const).map(visibility => ({
    _id: supportID('searchEpoch', [selectedProjectID, visibility]),
    projectID: selectedProjectID,
    visibility,
    epoch: 0,
  }));

  const rows = {
    issue: [policyIssue as unknown as SourceRow],
    comment: [policyComment as unknown as SourceRow],
    emoji,
    viewState,
    userPref,
    issueNotifications,
  } satisfies Record<string, SourceRow[]>;
  const projections = {
    projectUserRead,
    issueListRead,
    issueLabelRead,
    issueSearchDocument,
    searchEpoch,
  } satisfies Record<string, SourceRow[]>;
  const payload: LargeOverlayPayload = {
    schemaVersion: 'zerobugs-large-overlay.v1',
    manifestId: MANIFEST_ID,
    fixtureId: receipt.fixtureId,
    overlayId: LARGE_OVERLAY_ID,
    policyExtensionId: POLICY_EXTENSION_ID,
    generationInstant: GENERATION_INSTANT,
    generationEpochMs: GENERATION_EPOCH_MS,
    sourceReceiptDigest: receiptDigest,
    sourceOverallDigest: receipt.overallDigest,
    profileMode: synthetic ? 'synthetic-stand-in' : 'authoritative-large',
    actorBindings,
    selectedProject: {id: selectedProjectID, issueCount: selectedIssueCount},
    workingSet: {
      bound: workingSetSize,
      issueIDs: workingIssues.map(issue => issue.id),
      issueIDsDigest: taggedDigest(workingIssues.map(issue => issue.id)),
      oracleRows: workingIssues,
      newestComments,
    },
    rows,
    projections,
    counts: {
      baseGenerated: total,
      issue: issueCount + 1,
      comment: commentCount + 1,
      emoji: emoji.length,
      viewState: viewState.length,
      userPref: userPref.length,
      issueNotifications: issueNotifications.length,
      projectUserRead: projectUserRead.length,
      issueListRead: issueListRead.length,
      issueLabelRead: issueLabelRead.length,
      issueSearchDocument: issueSearchDocument.length,
      searchEpoch: searchEpoch.length,
      overlaySourceRows: Object.values(rows).reduce((sum, tableRows) => sum + tableRows.length, 0),
      boundedProjectionRows: Object.values(projections).reduce((sum, tableRows) => sum + tableRows.length, 0),
    },
    gaps: [{
      id: 'W-READMODEL-LARGE-FULL-CORPUS',
      owner: 'control server/read-model ingestion lane',
      status: 'GAP',
      reason: 'The artifact builds issue-list, label, search-document, and project-user projections only for the declared 1,000-row W. A full 1,000,001-issue/2,000,370-edge projection would add about 4.0M rows and is not silently claimed.',
      admittedBound: 'selected hot project working set W only',
    }],
    determinism: {
      hashAlgorithm: 'SHA-256',
      hashEncoding: 'UTF-8 fields separated by one NUL byte',
      hashFields: ['zerobugs-acceptance.v1', 'table', 'actor source user id', 'natural-key fields'],
      idRule: 'zbav1_ plus first 24 lowercase digest hex characters',
      timestampRule: 'generationEpochMs minus zero-based lexicographic natural-key rank per table',
      workingSetRule: 'greatest base issue count (tie project id); first 1,000 after policy issue by modified desc, id desc',
      projectionBound: 'W only; full-corpus projection named as GAP',
    },
  };
  const envelope: LargeOverlayEnvelope = {
    schemaVersion: 'zerobugs-large-overlay-envelope.v1',
    contentDigest: taggedDigest(payload as unknown as JsonValue),
    payload,
  };
  const bytes = `${canonicalJson(envelope as unknown as JsonValue)}\n`;
  await mkdir(dirname(outputPath), {recursive: true});
  await writeFile(outputPath, bytes, {mode: 0o600});
  const fileDigest = `sha256:${sha256Hex(bytes)}`;
  await writeFile(`${outputPath}.sha256`, `${fileDigest}  ${outputPath.split('/').at(-1)}\n`, {mode: 0o600});
  return {outputPath, fileDigest, envelope};
}

export async function readAndVerifyOverlay(path: string): Promise<LargeOverlayEnvelope> {
  const bytes = await readFile(path, 'utf8');
  const envelope = JSON.parse(bytes) as LargeOverlayEnvelope;
  if (envelope.schemaVersion !== 'zerobugs-large-overlay-envelope.v1') {
    refuse(`unsupported overlay envelope ${JSON.stringify(envelope.schemaVersion)}`);
  }
  const observed = taggedDigest(envelope.payload as unknown as JsonValue);
  if (observed !== envelope.contentDigest) {
    refuse(`overlay content digest mismatch: expected ${envelope.contentDigest}, observed ${observed}`);
  }
  return envelope;
}

function parseArguments(argv: readonly string[]): {
  fixtureRoot: string;
  receiptPath?: string;
  outputPath?: string;
  workingSetSize?: number;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name.startsWith('--')) refuse(`unknown argument ${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) refuse(`${name} requires a value`);
    values.set(name, value);
    index += 1;
  }
  const fixtureRoot = values.get('--fixture-root') ?? process.env.ZBUGS_LARGE_FIXTURE_ROOT;
  if (!fixtureRoot) refuse('ZBUGS_LARGE_FIXTURE_ROOT or --fixture-root is required');
  const workingSet = values.get('--working-set-size');
  return {
    fixtureRoot,
    receiptPath: values.get('--receipt') ?? process.env.ZBUGS_LARGE_FIXTURE_RECEIPT,
    outputPath: values.get('--out') ?? process.env.ZBUGS_LARGE_OVERLAY_PATH,
    ...(workingSet ? {workingSetSize: readInteger(workingSet, '--working-set-size')} : {}),
  };
}

async function main(): Promise<void> {
  const result = await buildLargeOverlay(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({
    status: 'ok',
    schemaVersion: result.envelope.schemaVersion,
    fixtureId: result.envelope.payload.fixtureId,
    overlayId: result.envelope.payload.overlayId,
    outputPath: result.outputPath,
    contentDigest: result.envelope.contentDigest,
    fileDigest: result.fileDigest,
    selectedProject: result.envelope.payload.selectedProject,
    workingSet: {
      bound: result.envelope.payload.workingSet.bound,
      firstIssueID: result.envelope.payload.workingSet.issueIDs[0],
      digest: result.envelope.payload.workingSet.issueIDsDigest,
    },
    counts: result.envelope.payload.counts,
    gaps: result.envelope.payload.gaps,
  })}\n`);
}

if (import.meta.main) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
