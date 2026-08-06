import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | {[key: string]: JsonValue};
type Row = Record<string, JsonValue> & {_id: string};
type CsvRow = Record<string, string>;

const CONTROL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_ROOT = resolve(CONTROL_ROOT, '../../..');
const NORMAL_FIXTURE_DIR = join(CONTROL_ROOT, 'fixtures/normal-seed-v1');
const POLICY_FIXTURE_PATH = join(
  CONTROL_ROOT,
  'fixtures/policy-extension-v1.json',
);
const DIGEST_PATH = join(
  CONTROL_ROOT,
  'tests/fixtures/fixture-digests.json',
);

const MANIFEST_ID = 'zerobugs-acceptance.v1';
const NORMAL_FIXTURE_ID = 'normal-seed-v1';
const POLICY_EXTENSION_ID = 'policy-extension-v1';
const SEED_VERSION = 'normal-seed-v1.policy-extension-v1';
const GENERATION_INSTANT = '2026-08-05T00:00:00.000Z';
const GENERATION_EPOCH_MS = Date.parse(GENERATION_INSTANT);
const SOURCE_PROJECT_ID = 'iCNlS2qEpzYWEes1RTf-D';
const POLICY_ISSUE_ID = 'zbav1_internal_issue';
const POLICY_ISSUE_SHORT_ID = 9_183_001;
const POLICY_COMMENT_ID = 'zbav1_internal_comment';
const POLICY_ISSUE_EMOJI_ID = 'zbav1_internal_issue_emoji';
const POLICY_COMMENT_EMOJI_ID = 'zbav1_internal_comment_emoji';
const POLICY_PREFERENCE_KEY = MANIFEST_ID;

const SOURCE_TABLES = [
  'user',
  'project',
  'issue',
  'viewState',
  'comment',
  'label',
  'issueLabel',
  'emoji',
  'userPref',
  'issueNotifications',
] as const;

const SUPPORT_TABLES = [
  'identityBinding',
  'projectUserRead',
  'issueListRead',
  'issueLabelRead',
  'issueSearchDocument',
  'searchEpoch',
] as const;

const ALL_TABLES = [...SOURCE_TABLES, ...SUPPORT_TABLES] as const;
type TableName = (typeof ALL_TABLES)[number];
type Tables = Record<TableName, Row[]>;

const CSV_HEADERS: Record<string, readonly string[]> = {
  user: ['id', 'login', 'name', 'avatar', 'role', 'githubID', 'email'],
  project: ['id', 'name'],
  issue: [
    'id',
    'title',
    'open',
    'modified',
    'created',
    'creatorID',
    'assigneeID',
    'description',
    'visibility',
    'projectID',
  ],
  comment: ['id', 'issueID', 'created', 'body', 'creatorID'],
  label: ['id', 'name', 'projectID'],
  issueLabel: ['labelID', 'issueID', 'projectID'],
};

const EXPECTED_BASE_COUNTS = {
  user: 14,
  project: 0,
  issue: 516,
  comment: 924,
  label: 30,
  issueLabel: 603,
} as const;

function refuse(message: string): never {
  throw new Error(`ZBUGS_FIXTURE_REFUSED: ${message}`);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) refuse('canonical JSON received a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJson(item)).join(',')}]`;
  }
  const members = Object.entries(value)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${members.join(',')}}`;
}

function prettyJson(value: JsonValue): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function taggedDigest(value: JsonValue): string {
  return `sha256:${sha256(canonicalJson(value))}`;
}

function sourceIdBody(table: string, sourceIdentity: string): string {
  return sha256(
    ['zerobugs-snapback-source-id.v1', table, sourceIdentity].join('\0'),
  ).slice(0, 24);
}

function physicalId(table: string, sourceIdentity: string): string {
  return `${table}_${sourceIdBody(table, sourceIdentity)}`;
}

function hashRule(
  table: string,
  actorSourceId: string,
  naturalKeyFields: readonly string[],
): Uint8Array {
  return createHash('sha256')
    .update(
      [MANIFEST_ID, table, actorSourceId, ...naturalKeyFields].join('\0'),
      'utf8',
    )
    .digest();
}

function hashHex(
  table: string,
  actorSourceId: string,
  naturalKeyFields: readonly string[],
): string {
  return Buffer.from(hashRule(table, actorSourceId, naturalKeyFields)).toString(
    'hex',
  );
}

function required(value: string, location: string): string {
  if (value === '') refuse(`${location} is required`);
  return value;
}

function optional(value: string): string | undefined {
  return value === '' ? undefined : value;
}

function numberValue(value: string, location: string): number {
  if (value === '') refuse(`${location} is required`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) refuse(`${location} is not a finite number: ${value}`);
  return parsed;
}

function integerValue(value: string, location: string): number {
  const parsed = numberValue(value, location);
  if (!Number.isSafeInteger(parsed)) refuse(`${location} is not a safe integer: ${value}`);
  return parsed;
}

function booleanValue(value: string, location: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  refuse(`${location} is not true or false: ${value}`);
}

function assertRole(value: string, location: string): 'crew' | 'user' {
  if (value === 'crew' || value === 'user') return value;
  refuse(`${location} has unknown role ${JSON.stringify(value)}; expected crew|user`);
}

function assertVisibility(
  value: string,
  location: string,
): 'internal' | 'public' {
  if (value === 'internal' || value === 'public') return value;
  refuse(
    `${location} has unknown visibility ${JSON.stringify(value)}; expected internal|public`,
  );
}

function parseCsv(bytes: string, fileName: string): CsvRow[] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let justClosedQuote = false;
  let atFieldStart = true;

  const finishField = () => {
    record.push(field);
    field = '';
    atFieldStart = true;
    justClosedQuote = false;
  };
  const finishRecord = () => {
    finishField();
    records.push(record);
    record = [];
  };

  const text = bytes.charCodeAt(0) === 0xfeff ? bytes.slice(1) : bytes;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          justClosedQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (justClosedQuote && character !== ',' && character !== '\r' && character !== '\n') {
      refuse(`${fileName} has data after a closing quote at byte ${index}`);
    }
    if (character === '"') {
      if (!atFieldStart) refuse(`${fileName} has a quote in an unquoted field at byte ${index}`);
      inQuotes = true;
      atFieldStart = false;
    } else if (character === ',') {
      finishField();
    } else if (character === '\n') {
      finishRecord();
    } else if (character === '\r') {
      if (text[index + 1] === '\n') index += 1;
      finishRecord();
    } else {
      field += character;
      atFieldStart = false;
    }
  }

  if (inQuotes) refuse(`${fileName} ends inside a quoted field`);
  if (field !== '' || record.length > 0 || !atFieldStart) finishRecord();
  if (records.length === 0) refuse(`${fileName} is empty`);

  const header = records.shift()!;
  const expectedHeader = CSV_HEADERS[fileName];
  if (!expectedHeader) refuse(`no header contract for ${fileName}.csv`);
  if (canonicalJson(header) !== canonicalJson([...expectedHeader])) {
    refuse(
      `${fileName}.csv header mismatch: expected ${expectedHeader.join(',')}; got ${header.join(',')}`,
    );
  }

  return records.map((values, rowIndex) => {
    if (values.length !== header.length) {
      refuse(
        `${fileName}.csv row ${rowIndex + 2} has ${values.length} fields; expected ${header.length}`,
      );
    }
    return Object.fromEntries(header.map((column, index) => [column, values[index]]));
  });
}

function expectCount(table: keyof typeof EXPECTED_BASE_COUNTS, actual: number): void {
  const expected = EXPECTED_BASE_COUNTS[table];
  if (actual !== expected) {
    refuse(`${table}.csv has ${actual} rows; manifest requires ${expected}`);
  }
}

function uniqueMap(rows: Row[], sourceField: string, table: string): Map<string, Row> {
  const result = new Map<string, Row>();
  for (const row of rows) {
    const value = row[sourceField];
    if (typeof value !== 'string') refuse(`${table}.${sourceField} is not a string`);
    if (result.has(value)) refuse(`${table}.${sourceField} collision: ${value}`);
    result.set(value, row);
  }
  return result;
}

function expectReference(
  target: Map<string, Row>,
  sourceTable: string,
  sourceIdentity: string,
  field: string,
  value: JsonValue | undefined,
): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !target.has(value)) {
    refuse(`${sourceTable} ${sourceIdentity} has broken ${field} reference ${String(value)}`);
  }
}

function rowIdentity(table: TableName, row: Row): string {
  const sourceId = row.id;
  if (typeof sourceId === 'string') return sourceId;
  return row._id;
}

function sortRows(table: TableName, rows: Row[]): Row[] {
  return [...rows].sort((left, right) =>
    compareText(rowIdentity(table, left), rowIdentity(table, right)),
  );
}

function addOptional(row: Row, key: string, value: JsonValue | undefined): void {
  if (value !== undefined) row[key] = value;
}

interface ActorBinding {
  role: 'crew' | 'user';
  sourceUserID: string;
  userID: string;
}

type ActorBindings = Record<
  'ordinary-user' | 'creator' | 'assignee' | 'crew-admin' | 'removed-member',
  ActorBinding
>;

function bindActors(users: Row[]): ActorBindings {
  const byRole = {
    crew: users
      .filter(row => row.role === 'crew')
      .sort((left, right) => compareText(String(left.id), String(right.id))),
    user: users
      .filter(row => row.role === 'user')
      .sort((left, right) => compareText(String(left.id), String(right.id))),
  };
  if (byRole.crew.length < 2 || byRole.user.length < 3) {
    refuse('cannot form manifest actor bindings from role populations');
  }

  const binding = (row: Row, role: 'crew' | 'user'): ActorBinding => ({
    role,
    sourceUserID: String(row.id),
    userID: row._id,
  });
  return {
    'ordinary-user': binding(byRole.user[0], 'user'),
    creator: binding(byRole.user[1], 'user'),
    assignee: binding(byRole.user[2], 'user'),
    'crew-admin': binding(byRole.crew[0], 'crew'),
    'removed-member': binding(byRole.crew[1], 'crew'),
  };
}

function buildPolicyExtension(
  actorBindings: ActorBindings,
  projectID: string,
): {
  sourceRows: Record<string, JsonValue[]>;
  normalizedRows: Partial<Record<TableName, Row[]>>;
} {
  const creator = actorBindings.creator;
  const assignee = actorBindings.assignee;
  const issueID = physicalId('issue', POLICY_ISSUE_ID);
  const commentID = physicalId('comment', POLICY_COMMENT_ID);

  const issueSource = {
    id: POLICY_ISSUE_ID,
    shortID: POLICY_ISSUE_SHORT_ID,
    title: 'policy-extension-v1 internal issue',
    open: true,
    modified: GENERATION_EPOCH_MS + 1,
    created: GENERATION_EPOCH_MS,
    projectID: SOURCE_PROJECT_ID,
    creatorID: creator.sourceUserID,
    assigneeID: assignee.sourceUserID,
    description: 'policy-extension-v1 protected issue fixture',
    visibility: 'internal',
  } satisfies Record<string, JsonValue>;
  const issueRow: Row = {
    ...issueSource,
    _id: issueID,
    projectID,
    creatorID: creator.userID,
    assigneeID: assignee.userID,
  };

  const commentSource = {
    id: POLICY_COMMENT_ID,
    issueID: POLICY_ISSUE_ID,
    created: GENERATION_EPOCH_MS,
    body: 'policy-extension-v1 protected child comment',
    creatorID: creator.sourceUserID,
  } satisfies Record<string, JsonValue>;
  const commentRow: Row = {
    ...commentSource,
    _id: commentID,
    issueID,
    creatorID: creator.userID,
  };

  const emojiSpecs = [
    {id: POLICY_COMMENT_EMOJI_ID, subjectSourceID: POLICY_COMMENT_ID, subjectID: commentID},
    {id: POLICY_ISSUE_EMOJI_ID, subjectSourceID: POLICY_ISSUE_ID, subjectID: issueID},
  ].sort((left, right) => compareText(left.id, right.id));
  const emojiSourceRows = emojiSpecs.map((spec, rank) => ({
    id: spec.id,
    value: '👍',
    annotation: 'thumbs up',
    subjectID: spec.subjectSourceID,
    creatorID: creator.sourceUserID,
    created: GENERATION_EPOCH_MS - rank,
  }));
  const emojiRows: Row[] = emojiSpecs.map((spec, rank) => ({
    _id: physicalId('emoji', spec.id),
    id: spec.id,
    value: '👍',
    annotation: 'thumbs up',
    subjectID: spec.subjectID,
    creatorID: creator.userID,
    created: GENERATION_EPOCH_MS - rank,
  }));

  const actors = Object.entries(actorBindings)
    .map(([actor, binding]) => ({actor, ...binding}))
    .sort((left, right) => compareText(left.sourceUserID, right.sourceUserID));

  const viewStateSourceRows = actors.map((actor, rank) => ({
    issueID: POLICY_ISSUE_ID,
    userID: actor.sourceUserID,
    viewed: GENERATION_EPOCH_MS - rank,
  }));
  const viewStateRows: Row[] = actors.map((actor, rank) => ({
    _id: physicalId('viewState', `${actor.sourceUserID}\0${POLICY_ISSUE_ID}`),
    issueID,
    userID: actor.userID,
    viewed: GENERATION_EPOCH_MS - rank,
  }));

  const preferenceSourceRows = actors.map(actor => ({
    key: POLICY_PREFERENCE_KEY,
    userID: actor.sourceUserID,
    value: hashHex('userPref', actor.sourceUserID, [POLICY_PREFERENCE_KEY]).slice(0, 32),
  }));
  const preferenceRows: Row[] = actors.map(actor => ({
    _id: physicalId(
      'userPref',
      `${actor.sourceUserID}\0${POLICY_PREFERENCE_KEY}`,
    ),
    key: POLICY_PREFERENCE_KEY,
    userID: actor.userID,
    value: hashHex('userPref', actor.sourceUserID, [POLICY_PREFERENCE_KEY]).slice(0, 32),
  }));

  const notificationSourceRows = actors.map((actor, rank) => ({
    userID: actor.sourceUserID,
    issueID: POLICY_ISSUE_ID,
    subscribed:
      hashRule('issueNotifications', actor.sourceUserID, [POLICY_ISSUE_ID])[0] % 2 === 0,
    created: GENERATION_EPOCH_MS - rank,
  }));
  const notificationRows: Row[] = actors.map((actor, rank) => ({
    _id: physicalId(
      'issueNotifications',
      `${actor.sourceUserID}\0${POLICY_ISSUE_ID}`,
    ),
    userID: actor.userID,
    issueID,
    subscribed:
      hashRule('issueNotifications', actor.sourceUserID, [POLICY_ISSUE_ID])[0] % 2 === 0,
    created: GENERATION_EPOCH_MS - rank,
  }));

  return {
    sourceRows: {
      issue: [issueSource],
      comment: [commentSource],
      emoji: emojiSourceRows,
      viewState: viewStateSourceRows,
      userPref: preferenceSourceRows,
      issueNotifications: notificationSourceRows,
    },
    normalizedRows: {
      issue: [issueRow],
      comment: [commentRow],
      emoji: emojiRows,
      viewState: viewStateRows,
      userPref: preferenceRows,
      issueNotifications: notificationRows,
    },
  };
}

function buildReadModels(tables: Tables): Pick<
  Tables,
  | 'projectUserRead'
  | 'issueListRead'
  | 'issueLabelRead'
  | 'issueSearchDocument'
  | 'searchEpoch'
> {
  const usersByID = new Map(tables.user.map(row => [row._id, row]));
  const projectsByID = new Map(tables.project.map(row => [row._id, row]));
  const issuesByID = new Map(tables.issue.map(row => [row._id, row]));
  const labelsByID = new Map(tables.label.map(row => [row._id, row]));
  const projectUsers = new Map<
    string,
    {projectID: string; userID: string; isCreator: boolean; isAssignee: boolean; isCrew: boolean}
  >();

  const upsertProjectUser = (
    projectID: string,
    userID: string,
    reason: 'isAssignee' | 'isCreator' | 'isCrew',
  ) => {
    const key = `${projectID}\0${userID}`;
    const row = projectUsers.get(key) ?? {
      projectID,
      userID,
      isCreator: false,
      isAssignee: false,
      isCrew: false,
    };
    row[reason] = true;
    projectUsers.set(key, row);
  };

  for (const issue of tables.issue) {
    upsertProjectUser(String(issue.projectID), String(issue.creatorID), 'isCreator');
    if (typeof issue.assigneeID === 'string') {
      upsertProjectUser(String(issue.projectID), issue.assigneeID, 'isAssignee');
    }
  }
  for (const project of tables.project) {
    for (const user of tables.user) {
      if (user.role === 'crew' && !String(user.login).startsWith('rocibot')) {
        upsertProjectUser(project._id, user._id, 'isCrew');
      }
    }
  }

  const projectUserRead: Row[] = [...projectUsers.values()].map(item => {
    const project = projectsByID.get(item.projectID);
    const user = usersByID.get(item.userID);
    if (!project || !user) refuse('read-model builder encountered a broken project/user edge');
    return {
      _id: physicalId(
        'projectUserRead',
        `${String(project.id)}\0${String(user.id)}`,
      ),
      ...item,
    };
  });

  const issueListRead: Row[] = tables.issue.map(issue => ({
    _id: physicalId('issueListRead', String(issue.id)),
    issueID: issue._id,
    sourceIssueID: String(issue.id),
    projectID: String(issue.projectID),
    creatorID: String(issue.creatorID),
    ...(typeof issue.assigneeID === 'string'
      ? {assigneeID: issue.assigneeID}
      : {}),
    open: Boolean(issue.open),
    visibility: String(issue.visibility),
    modified: Number(issue.modified),
    created: Number(issue.created),
  }));

  const issueLabelRead: Row[] = tables.issueLabel.map(edge => {
    const issue = issuesByID.get(String(edge.issueID));
    const label = labelsByID.get(String(edge.labelID));
    if (!issue || !label) refuse('read-model builder encountered a broken issue-label edge');
    return {
      _id: physicalId(
        'issueLabelRead',
        `${String(label.id)}\0${String(issue.id)}`,
      ),
      projectID: String(edge.projectID),
      issueID: String(edge.issueID),
      labelID: String(edge.labelID),
    };
  });

  const commentsByIssue = new Map<string, Row[]>();
  for (const comment of tables.comment) {
    const comments = commentsByIssue.get(String(comment.issueID)) ?? [];
    comments.push(comment);
    commentsByIssue.set(String(comment.issueID), comments);
  }
  const issueSearchDocument: Row[] = tables.issue.map(issue => {
    const comments = (commentsByIssue.get(issue._id) ?? []).sort((left, right) => {
      const created = Number(left.created) - Number(right.created);
      return created === 0 ? compareText(String(left.id), String(right.id)) : created;
    });
    return {
      _id: physicalId('issueSearchDocument', String(issue.id)),
      issueID: issue._id,
      sourceIssueID: String(issue.id),
      projectID: String(issue.projectID),
      visibility: String(issue.visibility),
      title: String(issue.title),
      description: String(issue.description),
      commentText: comments.map(comment => String(comment.body)).join('\n'),
    };
  });

  const searchEpoch: Row[] = tables.project.flatMap(project =>
    (['internal', 'public'] as const).map(visibility => ({
      _id: physicalId(
        'searchEpoch',
        `${String(project.id)}\0${visibility}`,
      ),
      projectID: project._id,
      visibility,
      epoch: 0,
    })),
  );

  return {
    projectUserRead,
    issueListRead,
    issueLabelRead,
    issueSearchDocument,
    searchEpoch,
  };
}

function validateTables(tables: Tables): void {
  const allPhysicalIds = new Map<string, string>();
  for (const table of ALL_TABLES) {
    for (const row of tables[table]) {
      if (allPhysicalIds.has(row._id)) {
        refuse(
          `physical _id collision ${row._id} between ${allPhysicalIds.get(row._id)} and ${table}`,
        );
      }
      allPhysicalIds.set(row._id, table);
    }
  }

  const users = uniqueMap(tables.user, 'id', 'user');
  const projects = uniqueMap(tables.project, 'id', 'project');
  const issues = uniqueMap(tables.issue, 'id', 'issue');
  const comments = uniqueMap(tables.comment, 'id', 'comment');
  const labels = uniqueMap(tables.label, 'id', 'label');
  uniqueMap(tables.emoji, 'id', 'emoji');

  const usersByPhysical = new Map(tables.user.map(row => [row._id, row]));
  const projectsByPhysical = new Map(tables.project.map(row => [row._id, row]));
  const issuesByPhysical = new Map(tables.issue.map(row => [row._id, row]));
  const commentsByPhysical = new Map(tables.comment.map(row => [row._id, row]));
  const labelsByPhysical = new Map(tables.label.map(row => [row._id, row]));

  for (const row of tables.user) assertRole(String(row.role), `user ${String(row.id)}`);
  for (const row of tables.issue) {
    assertVisibility(String(row.visibility), `issue ${String(row.id)}`);
    expectReference(projectsByPhysical, 'issue', String(row.id), 'projectID', row.projectID);
    expectReference(usersByPhysical, 'issue', String(row.id), 'creatorID', row.creatorID);
    expectReference(usersByPhysical, 'issue', String(row.id), 'assigneeID', row.assigneeID);
  }
  for (const row of tables.comment) {
    expectReference(issuesByPhysical, 'comment', String(row.id), 'issueID', row.issueID);
    expectReference(usersByPhysical, 'comment', String(row.id), 'creatorID', row.creatorID);
  }
  for (const row of tables.label) {
    expectReference(projectsByPhysical, 'label', String(row.id), 'projectID', row.projectID);
  }
  for (const row of tables.issueLabel) {
    expectReference(labelsByPhysical, 'issueLabel', row._id, 'labelID', row.labelID);
    expectReference(issuesByPhysical, 'issueLabel', row._id, 'issueID', row.issueID);
    expectReference(projectsByPhysical, 'issueLabel', row._id, 'projectID', row.projectID);
    const issue = issuesByPhysical.get(String(row.issueID));
    const label = labelsByPhysical.get(String(row.labelID));
    if (issue?.projectID !== row.projectID || label?.projectID !== row.projectID) {
      refuse(`issueLabel ${row._id} crosses project boundaries`);
    }
  }
  for (const row of [...tables.viewState, ...tables.userPref, ...tables.issueNotifications]) {
    expectReference(usersByPhysical, 'private overlay', row._id, 'userID', row.userID);
  }
  for (const row of [...tables.viewState, ...tables.issueNotifications]) {
    expectReference(issuesByPhysical, 'private overlay', row._id, 'issueID', row.issueID);
  }
  for (const row of tables.emoji) {
    expectReference(usersByPhysical, 'emoji', String(row.id), 'creatorID', row.creatorID);
    const subject = String(row.subjectID);
    if (!issuesByPhysical.has(subject) && !commentsByPhysical.has(subject)) {
      refuse(`emoji ${String(row.id)} has broken polymorphic subjectID ${subject}`);
    }
  }

  const shortIDs = new Set<number>();
  for (const row of tables.issue) {
    if (typeof row.shortID !== 'number' || !Number.isSafeInteger(row.shortID)) {
      refuse(`issue ${String(row.id)} has invalid shortID`);
    }
    if (shortIDs.has(row.shortID)) refuse(`issue shortID collision: ${row.shortID}`);
    shortIDs.add(row.shortID);
  }

  const uniqueComposite = (table: TableName, fields: readonly string[]) => {
    const seen = new Set<string>();
    for (const row of tables[table]) {
      const key = fields.map(field => canonicalJson(row[field] ?? null)).join('\0');
      if (seen.has(key)) refuse(`${table} has duplicate (${fields.join(',')}) key`);
      seen.add(key);
    }
  };
  uniqueComposite('viewState', ['userID', 'issueID']);
  uniqueComposite('issueLabel', ['labelID', 'issueID']);
  uniqueComposite('userPref', ['userID', 'key']);
  uniqueComposite('issueNotifications', ['userID', 'issueID']);
  uniqueComposite('projectUserRead', ['projectID', 'userID']);
  uniqueComposite('issueLabelRead', ['issueID', 'labelID']);
  uniqueComposite('searchEpoch', ['projectID', 'visibility']);

  for (const row of tables.issueListRead) {
    assertVisibility(String(row.visibility), `issueListRead ${String(row.sourceIssueID)}`);
  }
  for (const row of tables.issueSearchDocument) {
    assertVisibility(String(row.visibility), `issueSearchDocument ${String(row.sourceIssueID)}`);
  }
  for (const row of tables.searchEpoch) {
    assertVisibility(String(row.visibility), `searchEpoch ${row._id}`);
  }

  if (!users.has(actorSourceID(tables, 'creator'))) refuse('actor binding creator is missing');
  if (!projects.has(SOURCE_PROJECT_ID)) refuse('migration-created project is missing');
  if (!issues.has(POLICY_ISSUE_ID)) refuse('policy issue is missing');
  if (!comments.has(POLICY_COMMENT_ID)) refuse('policy comment is missing');
  if (!labels.size) refuse('label set is empty');
}

function actorSourceID(tables: Tables, actor: 'creator'): string {
  const users = tables.user
    .filter(row => row.role === 'user')
    .sort((left, right) => compareText(String(left.id), String(right.id)));
  return String(users[actor === 'creator' ? 1 : 0]?.id ?? '');
}

function assertExpectedDistributions(tables: Tables): void {
  const baseIssues = tables.issue.filter(row => row.id !== POLICY_ISSUE_ID);
  const roles = {
    crew: tables.user.filter(row => row.role === 'crew').length,
    user: tables.user.filter(row => row.role === 'user').length,
  };
  const issueDistribution = {
    public: baseIssues.filter(row => row.visibility === 'public').length,
    internal: baseIssues.filter(row => row.visibility === 'internal').length,
    open: baseIssues.filter(row => row.open === true).length,
    closed: baseIssues.filter(row => row.open === false).length,
  };
  const expected = {crew: 7, user: 7, public: 516, internal: 0, open: 155, closed: 361};
  const actual = {...roles, ...issueDistribution};
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    refuse(`ordinary seed distribution mismatch: ${JSON.stringify(actual)}`);
  }
  if (
    baseIssues.some(
      row =>
        row.projectID !== physicalId('project', SOURCE_PROJECT_ID) ||
        row.visibility !== 'public',
    )
  ) {
    refuse('ordinary issues are not all public rows in the migration-created project');
  }
}

async function readCsvInputs(pin: string): Promise<{
  csvRows: Record<string, CsvRow[]>;
  sourceDigests: Record<string, string>;
}> {
  const dataDir = join(pin, 'db/seed-data/github');
  const csvRows: Record<string, CsvRow[]> = {};
  const sourceDigests: Record<string, string> = {};
  for (const table of ['user', 'project', 'issue', 'comment', 'label', 'issueLabel']) {
    const path = join(dataDir, `${table}.csv`);
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (error) {
      refuse(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    sourceDigests[`${table}.csv`] = `sha256:${sha256(bytes)}`;
    csvRows[table] = parseCsv(bytes.toString('utf8'), table);
    expectCount(table as keyof typeof EXPECTED_BASE_COUNTS, csvRows[table].length);
  }
  return {csvRows, sourceDigests};
}

function buildSourceTables(csvRows: Record<string, CsvRow[]>): Tables {
  const tables = Object.fromEntries(ALL_TABLES.map(table => [table, []])) as Tables;

  tables.user = csvRows.user.map((source, index) => {
    const id = required(source.id, `user.csv row ${index + 2} id`);
    const role = assertRole(source.role, `user ${id}`);
    const row: Row = {
      _id: physicalId('user', id),
      id,
      login: required(source.login, `user ${id} login`),
      avatar: required(source.avatar, `user ${id} avatar`),
      role,
      githubID: integerValue(source.githubID, `user ${id} githubID`),
    };
    addOptional(row, 'name', optional(source.name));
    addOptional(row, 'email', optional(source.email));
    return row;
  });

  const projectID = physicalId('project', SOURCE_PROJECT_ID);
  tables.project = [
    {
      _id: projectID,
      id: SOURCE_PROJECT_ID,
      name: 'Zero',
      lowerCaseName: 'zero',
      supportsSearch: true,
    },
  ];

  const userPhysical = new Map(tables.user.map(row => [String(row.id), row._id]));
  tables.issue = csvRows.issue.map((source, index) => {
    const id = required(source.id, `issue.csv row ${index + 2} id`);
    const creatorSourceID = required(source.creatorID, `issue ${id} creatorID`);
    const assigneeSourceID = optional(source.assigneeID);
    const projectSourceID = required(source.projectID, `issue ${id} projectID`);
    const creatorID = userPhysical.get(creatorSourceID);
    const assigneeID = assigneeSourceID ? userPhysical.get(assigneeSourceID) : undefined;
    if (!creatorID) refuse(`issue ${id} references missing creator ${creatorSourceID}`);
    if (assigneeSourceID && !assigneeID) {
      refuse(`issue ${id} references missing assignee ${assigneeSourceID}`);
    }
    if (projectSourceID !== SOURCE_PROJECT_ID) {
      refuse(`issue ${id} references unexpected project ${projectSourceID}`);
    }
    const row: Row = {
      _id: physicalId('issue', id),
      id,
      shortID: 3000 + index,
      title: required(source.title, `issue ${id} title`),
      open: booleanValue(source.open, `issue ${id} open`),
      modified: numberValue(source.modified, `issue ${id} modified`),
      created: numberValue(source.created, `issue ${id} created`),
      projectID,
      creatorID,
      description: source.description,
      visibility: assertVisibility(source.visibility, `issue ${id}`),
    };
    addOptional(row, 'assigneeID', assigneeID);
    return row;
  });

  const issuePhysical = new Map(tables.issue.map(row => [String(row.id), row._id]));
  tables.comment = csvRows.comment.map((source, index) => {
    const id = required(source.id, `comment.csv row ${index + 2} id`);
    const sourceIssueID = required(source.issueID, `comment ${id} issueID`);
    const creatorSourceID = required(source.creatorID, `comment ${id} creatorID`);
    const issueID = issuePhysical.get(sourceIssueID);
    const creatorID = userPhysical.get(creatorSourceID);
    if (!issueID) refuse(`comment ${id} references missing issue ${sourceIssueID}`);
    if (!creatorID) refuse(`comment ${id} references missing creator ${creatorSourceID}`);
    return {
      _id: physicalId('comment', id),
      id,
      issueID,
      created: numberValue(source.created, `comment ${id} created`),
      body: source.body,
      creatorID,
    };
  });

  tables.label = csvRows.label.map((source, index) => {
    const id = required(source.id, `label.csv row ${index + 2} id`);
    const projectSourceID = required(source.projectID, `label ${id} projectID`);
    if (projectSourceID !== SOURCE_PROJECT_ID) {
      refuse(`label ${id} references unexpected project ${projectSourceID}`);
    }
    return {
      _id: physicalId('label', id),
      id,
      name: required(source.name, `label ${id} name`),
      projectID,
    };
  });

  const labelPhysical = new Map(tables.label.map(row => [String(row.id), row._id]));
  tables.issueLabel = csvRows.issueLabel.map((source, index) => {
    const sourceLabelID = required(source.labelID, `issueLabel row ${index + 2} labelID`);
    const sourceIssueID = required(source.issueID, `issueLabel row ${index + 2} issueID`);
    const projectSourceID = required(
      source.projectID,
      `issueLabel row ${index + 2} projectID`,
    );
    const labelID = labelPhysical.get(sourceLabelID);
    const issueID = issuePhysical.get(sourceIssueID);
    if (!labelID) refuse(`issueLabel references missing label ${sourceLabelID}`);
    if (!issueID) refuse(`issueLabel references missing issue ${sourceIssueID}`);
    if (projectSourceID !== SOURCE_PROJECT_ID) {
      refuse(`issueLabel references unexpected project ${projectSourceID}`);
    }
    return {
      _id: physicalId('issueLabel', `${sourceLabelID}\0${sourceIssueID}`),
      labelID,
      issueID,
      projectID,
    };
  });

  return tables;
}

function appendRows(
  tables: Tables,
  additions: Partial<Record<TableName, Row[]>>,
): void {
  for (const [table, rows] of Object.entries(additions) as [TableName, Row[]][]) {
    tables[table].push(...rows);
  }
}

function tableDigest(rows: Row[]): {rowCount: number; contentDigest: string} {
  return {rowCount: rows.length, contentDigest: taggedDigest(rows)};
}

async function writeOutputs(
  tables: Tables,
  actorBindings: ActorBindings,
  policySourceRows: Record<string, JsonValue[]>,
  sourceDigests: Record<string, string>,
): Promise<{overallDigest: string; rebuildDigest: string}> {
  const sortedTables = Object.fromEntries(
    ALL_TABLES.map(table => [table, sortRows(table, tables[table])]),
  ) as Tables;

  const manifestMarkdown = await readFile(
    join(REPOSITORY_ROOT, 'demos/zerobugs/manifest/acceptance.v1.md'),
  );
  const manifestJson = await readFile(
    join(REPOSITORY_ROOT, 'demos/zerobugs/manifest/acceptance.v1.json'),
  );
  const manifestDigests = {
    markdown: `sha256:${sha256(manifestMarkdown)}`,
    json: `sha256:${sha256(manifestJson)}`,
  };

  const tableDigests = Object.fromEntries(
    ALL_TABLES.map(table => [table, tableDigest(sortedTables[table])]),
  ) as Record<TableName, {rowCount: number; contentDigest: string}>;
  const rebuildTableDigests = Object.fromEntries(
    ['projectUserRead', 'issueListRead', 'issueLabelRead', 'issueSearchDocument'].map(
      table => [table, tableDigests[table as TableName].contentDigest],
    ),
  );
  const rebuildDigest = taggedDigest(rebuildTableDigests);
  const overallDigest = taggedDigest({
    manifestDigests,
    actorBindings,
    tables: tableDigests,
  });

  const fixtureMetadata = {
    schemaVersion: 'zerobugs-normalized-fixture.v1',
    fixtureId: NORMAL_FIXTURE_ID,
    extensionId: POLICY_EXTENSION_ID,
    generationInstant: GENERATION_INSTANT,
    deterministicIdRule:
      '<table>_ + first 24 lowercase hex chars of SHA-256(zerobugs-snapback-source-id.v1 NUL table NUL source identity)',
    actorBindings,
    sourceInputs: sourceDigests,
    tableFiles: Object.fromEntries(ALL_TABLES.map(table => [table, `${table}.json`])),
  };
  const policyArtifact = {
    schemaVersion: 'zerobugs-policy-extension.v1',
    id: POLICY_EXTENSION_ID,
    generationInstant: GENERATION_INSTANT,
    actorBindings,
    rows: policySourceRows,
  };
  const digests = {
    schemaVersion: 'zerobugs-fixture-digests.v1',
    fixtureId: NORMAL_FIXTURE_ID,
    extensionId: POLICY_EXTENSION_ID,
    seedVersion: SEED_VERSION,
    generationInstant: GENERATION_INSTANT,
    manifestId: MANIFEST_ID,
    manifestDigests,
    sourceInputs: sourceDigests,
    actorBindings,
    ordinaryBase: {
      counts: {
        user: 14,
        projectCsv: 0,
        migrationProject: 1,
        issue: 516,
        viewState: 0,
        comment: 924,
        label: 30,
        issueLabel: 603,
        emoji: 0,
        userPref: 0,
        issueNotifications: 0,
      },
      actorDistribution: {crew: 7, user: 7},
      issueDistribution: {
        public: 516,
        internal: 0,
        open: 155,
        closed: 361,
        sourceProjectID: SOURCE_PROJECT_ID,
      },
    },
    policyExtensionCounts: {
      issue: 1,
      viewState: 5,
      comment: 1,
      emoji: 2,
      userPref: 5,
      issueNotifications: 5,
    },
    sourceCounts: Object.fromEntries(
      SOURCE_TABLES.map(table => [table, tableDigests[table].rowCount]),
    ),
    supportCounts: Object.fromEntries(
      SUPPORT_TABLES.map(table => [table, tableDigests[table].rowCount]),
    ),
    tables: tableDigests,
    readModelRebuild: {
      algorithm: 'sha256-canonical-json-v1',
      tableDigests: rebuildTableDigests,
      rebuildDigest,
    },
    overall: {
      rowCount: Object.values(tableDigests).reduce((sum, table) => sum + table.rowCount, 0),
      contentDigest: overallDigest,
    },
  };

  await mkdir(NORMAL_FIXTURE_DIR, {recursive: true});
  await mkdir(dirname(POLICY_FIXTURE_PATH), {recursive: true});
  await mkdir(dirname(DIGEST_PATH), {recursive: true});
  for (const table of ALL_TABLES) {
    await writeFile(
      join(NORMAL_FIXTURE_DIR, `${table}.json`),
      prettyJson(sortedTables[table]),
      'utf8',
    );
  }
  await writeFile(
    join(NORMAL_FIXTURE_DIR, 'fixture.json'),
    prettyJson(fixtureMetadata),
    'utf8',
  );
  await writeFile(POLICY_FIXTURE_PATH, prettyJson(policyArtifact), 'utf8');
  await writeFile(DIGEST_PATH, prettyJson(digests), 'utf8');
  return {overallDigest, rebuildDigest};
}

async function main(): Promise<void> {
  const pin = process.env.ZBUGS_PIN;
  if (!pin) refuse('ZBUGS_PIN must name the pinned apps/zbugs directory');
  const resolvedPin = resolve(pin);
  const {csvRows, sourceDigests} = await readCsvInputs(resolvedPin);
  const tables = buildSourceTables(csvRows);
  const actorBindings = bindActors(tables.user);
  const policy = buildPolicyExtension(
    actorBindings,
    physicalId('project', SOURCE_PROJECT_ID),
  );
  appendRows(tables, policy.normalizedRows);
  assertExpectedDistributions(tables);

  const readModels = buildReadModels(tables);
  appendRows(tables, readModels);
  validateTables(tables);

  const {overallDigest, rebuildDigest} = await writeOutputs(
    tables,
    actorBindings,
    policy.sourceRows,
    sourceDigests,
  );
  const counts = Object.fromEntries(ALL_TABLES.map(table => [table, tables[table].length]));
  process.stdout.write(
    `${JSON.stringify({
      status: 'ok',
      fixtureId: NORMAL_FIXTURE_ID,
      extensionId: POLICY_EXTENSION_ID,
      counts,
      rebuildDigest,
      overallDigest,
    })}\n`,
  );
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
