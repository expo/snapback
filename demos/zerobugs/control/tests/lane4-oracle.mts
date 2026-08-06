import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

export type JsonRow = Record<string, unknown>;

export interface Lane4IntentExpectation {
  trigger:
    | 'commentAdd'
    | 'commentEdit'
    | 'emojiAddToComment'
    | 'emojiAddToIssue'
    | 'issueAddLabel'
    | 'issueCreate'
    | 'issueRemoveLabel'
    | 'issueUpdate';
  kind:
    | 'add-comment'
    | 'add-emoji-to-comment'
    | 'add-emoji-to-issue'
    | 'create-issue'
    | 'edit-comment'
    | 'update-issue';
  issueID: string;
  actorID: string;
  payload: JsonRow;
  recipients: JsonRow;
  discordEligible: boolean;
}

export interface Lane4Oracle {
  users: JsonRow[];
  projects: JsonRow[];
  issues: JsonRow[];
  comments: JsonRow[];
  labels: JsonRow[];
  issueLabels: JsonRow[];
  emoji: JsonRow[];
  viewState: JsonRow[];
  userPref: JsonRow[];
  issueNotifications: JsonRow[];
  searchEpoch: JsonRow[];
  notificationIntent: JsonRow[];
  notificationAttempt: JsonRow[];
}

export interface ApplyMutationInput {
  mutator: string;
  args: JsonRow;
  actorID: string;
  authoritativeTime: number | null;
}

const CONTROL_ROOT = resolve(import.meta.dirname, '..');
const FIXTURE_ROOT = join(CONTROL_ROOT, 'fixtures/normal-seed-v1');
const SOURCE_TABLES = [
  'user', 'project', 'issue', 'comment', 'label', 'issueLabel', 'emoji',
  'viewState', 'userPref', 'issueNotifications', 'searchEpoch',
] as const;
const DEFAULT_PROJECT_ID = 'iCNlS2qEpzYWEes1RTf-D';

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`lane4 oracle expected ${label} string`);
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`lane4 oracle expected ${label} number`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`lane4 oracle expected ${label} boolean`);
  return value;
}

function rowBy<T extends JsonRow>(rows: T[], field: string, value: unknown, label: string): T {
  const row = rows.find(candidate => candidate[field] === value);
  if (!row) throw new Error(`lane4 oracle could not find ${label}`);
  return row;
}

function sourceReference(map: Map<string, JsonRow>, value: unknown, label: string): string {
  return text(map.get(text(value, label))?.id, label);
}

function withoutSystemFields(row: JsonRow): JsonRow {
  return Object.fromEntries(Object.entries(row).filter(([key]) => (
    key !== '_id' && key !== '_version' && key !== '_createdAt' && key !== '_updatedAt'
  )));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('lane4 oracle cannot digest a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as JsonRow)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`)
      .join(',')}}`;
  }
  throw new Error(`lane4 oracle cannot digest ${typeof value}`);
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function semanticSort(rows: JsonRow[], keys: string[]): JsonRow[] {
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const order = compareText(String(left[key] ?? ''), String(right[key] ?? ''));
      if (order !== 0) return order;
    }
    return compareText(canonicalJson(left), canonicalJson(right));
  });
}

function nextIssueShortID(issues: JsonRow[]): number {
  const used = new Set(issues
    .map(issue => issue.shortID)
    .filter((value): value is number => Number.isSafeInteger(value) && Number(value) >= 3_000));
  let candidate = 3_000;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}

export async function loadLane4Oracle(): Promise<Lane4Oracle> {
  const raw = Object.fromEntries(await Promise.all(SOURCE_TABLES.map(async table => [
    table,
    JSON.parse(await readFile(join(FIXTURE_ROOT, `${table}.json`), 'utf8')) as JsonRow[],
  ]))) as Record<(typeof SOURCE_TABLES)[number], JsonRow[]>;
  const usersByPhysical = new Map(raw.user.map(row => [text(row._id, 'user _id'), row]));
  const projectsByPhysical = new Map(raw.project.map(row => [text(row._id, 'project _id'), row]));
  const issuesByPhysical = new Map(raw.issue.map(row => [text(row._id, 'issue _id'), row]));
  const commentsByPhysical = new Map(raw.comment.map(row => [text(row._id, 'comment _id'), row]));
  const labelsByPhysical = new Map(raw.label.map(row => [text(row._id, 'label _id'), row]));

  const users = raw.user.map(withoutSystemFields);
  const projects = raw.project.map(withoutSystemFields);
  const issues = raw.issue.map(row => {
    const normalized: JsonRow = {
      id: row.id,
      title: row.title,
      open: row.open,
      modified: row.modified,
      created: row.created,
      projectID: sourceReference(projectsByPhysical, row.projectID, 'issue project'),
      creatorID: sourceReference(usersByPhysical, row.creatorID, 'issue creator'),
      description: row.description,
      visibility: row.visibility,
    };
    if (typeof row.shortID === 'number') normalized.shortID = row.shortID;
    if (typeof row.assigneeID === 'string') {
      normalized.assigneeID = sourceReference(usersByPhysical, row.assigneeID, 'issue assignee');
    }
    return normalized;
  });
  const comments = raw.comment.map(row => ({
    id: row.id,
    issueID: sourceReference(issuesByPhysical, row.issueID, 'comment issue'),
    created: row.created,
    body: row.body,
    creatorID: sourceReference(usersByPhysical, row.creatorID, 'comment creator'),
  }));
  const labels = raw.label.map(row => ({
    id: row.id,
    name: row.name,
    projectID: sourceReference(projectsByPhysical, row.projectID, 'label project'),
  }));
  const issueLabels = raw.issueLabel.map(row => ({
    issueID: sourceReference(issuesByPhysical, row.issueID, 'join issue'),
    labelID: sourceReference(labelsByPhysical, row.labelID, 'join label'),
    projectID: sourceReference(projectsByPhysical, row.projectID, 'join project'),
  }));
  const emoji = raw.emoji.map(row => {
    const subject = issuesByPhysical.get(text(row.subjectID, 'emoji subject'))
      ?? commentsByPhysical.get(text(row.subjectID, 'emoji subject'));
    return {
      id: row.id,
      value: row.value,
      annotation: row.annotation,
      subjectID: text(subject?.id, 'emoji source subject'),
      creatorID: sourceReference(usersByPhysical, row.creatorID, 'emoji creator'),
      created: row.created,
    };
  });
  const viewState = raw.viewState.map(row => ({
    issueID: sourceReference(issuesByPhysical, row.issueID, 'view issue'),
    userID: sourceReference(usersByPhysical, row.userID, 'view user'),
    viewed: row.viewed,
  }));
  const userPref = raw.userPref.map(row => ({
    key: row.key,
    userID: sourceReference(usersByPhysical, row.userID, 'preference user'),
    value: row.value,
  }));
  const issueNotifications = raw.issueNotifications.map(row => ({
    userID: sourceReference(usersByPhysical, row.userID, 'notification user'),
    issueID: sourceReference(issuesByPhysical, row.issueID, 'notification issue'),
    subscribed: row.subscribed,
    created: row.created,
  }));
  const searchEpoch = raw.searchEpoch.map(row => ({
    projectID: sourceReference(projectsByPhysical, row.projectID, 'epoch project'),
    visibility: row.visibility,
    epoch: row.epoch,
  }));
  return {
    users,
    projects,
    issues,
    comments,
    labels,
    issueLabels,
    emoji,
    viewState,
    userPref,
    issueNotifications,
    searchEpoch,
    notificationIntent: [],
    notificationAttempt: [],
  };
}

function upsertNotification(
  oracle: Lane4Oracle,
  issueID: string,
  userID: string,
  subscribed: boolean,
  created: number,
  forceUpdate: boolean,
): void {
  const existing = oracle.issueNotifications.find(row => (
    row.issueID === issueID && row.userID === userID
  ));
  if (!existing) oracle.issueNotifications.push({issueID, userID, subscribed, created});
  else if (forceUpdate) Object.assign(existing, {subscribed, created});
}

function bumpSearchEpoch(
  oracle: Lane4Oracle,
  projectID: string,
  visibility: unknown,
): void {
  const row = rowBy(
    oracle.searchEpoch.filter(epoch => epoch.projectID === projectID),
    'visibility',
    visibility,
    'search epoch',
  );
  row.epoch = number(row.epoch, 'search epoch') + 1;
}

function validEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const at = trimmed.indexOf('@');
  if (
    trimmed.length === 0
    || at <= 0
    || at !== trimmed.lastIndexOf('@')
    || at >= trimmed.length - 3
    || trimmed.slice(at + 1).indexOf('.') <= 0
    || /\s/u.test(trimmed)
  ) return null;
  return trimmed;
}

function expectedRecipientSnapshot(
  oracle: Lane4Oracle,
  issue: JsonRow,
  actor: JsonRow,
  includeActor: boolean,
): JsonRow {
  const byEmail = new Map<string, JsonRow>();
  for (const subscription of oracle.issueNotifications) {
    if (subscription.issueID !== issue.id || subscription.subscribed !== true) continue;
    const user = rowBy(oracle.users, 'id', subscription.userID, 'notification user');
    if (!includeActor && user.id === actor.id) continue;
    if (issue.visibility === 'internal' && user.role !== 'crew') continue;
    const email = validEmail(user.email);
    if (!email || byEmail.has(email)) continue;
    byEmail.set(email, {sourceUserID: user.id, email});
  }
  return {
    actorSourceUserID: actor.id,
    includeActor,
    issueVisibility: issue.visibility,
    issueShortID: issue.shortID ?? null,
    recipients: [...byEmail.values()].sort((left, right) => (
      compareText(text(left.email, 'recipient email'), text(right.email, 'recipient email'))
      || compareText(text(left.sourceUserID, 'recipient user'), text(right.sourceUserID, 'recipient user'))
    )),
    discordEligible: issue.visibility === 'public',
  };
}

function expectedPayload(kind: string, actor: JsonRow, issue: JsonRow, details: JsonRow): JsonRow {
  return {
    kind,
    actor: {id: actor.id, login: actor.login},
    issue: {
      id: issue.id,
      shortID: issue.shortID ?? null,
      title: issue.title,
      description: issue.description,
      visibility: issue.visibility,
    },
    ...details,
  };
}

function intent(
  oracle: Lane4Oracle,
  trigger: Lane4IntentExpectation['trigger'],
  kind: Lane4IntentExpectation['kind'],
  issue: JsonRow,
  actor: JsonRow,
  details: JsonRow,
  includeActor: boolean,
): Lane4IntentExpectation {
  const recipients = expectedRecipientSnapshot(oracle, issue, actor, includeActor);
  return {
    trigger,
    kind,
    issueID: text(issue.id, 'intent issue id'),
    actorID: text(actor.id, 'intent actor id'),
    payload: expectedPayload(kind, actor, issue, details),
    recipients,
    discordEligible: recipients.discordEligible === true,
  };
}

export function applyExpectedMutation(
  oracle: Lane4Oracle,
  input: ApplyMutationInput,
): Lane4IntentExpectation | null {
  const {mutator, args, actorID, authoritativeTime} = input;
  const actor = rowBy(oracle.users, 'id', actorID, 'actor');
  const now = authoritativeTime;

  if (mutator === 'issue.create') {
    if (now === null) throw new Error('issue.create needs authoritative time');
    const projectID = typeof args.projectID === 'string' ? args.projectID : DEFAULT_PROJECT_ID;
    const issue: JsonRow = {
      id: args.id,
      shortID: nextIssueShortID(oracle.issues),
      title: args.title,
      open: true,
      modified: now,
      created: now,
      projectID,
      creatorID: actorID,
      description: args.description ?? '',
      visibility: 'public',
    };
    oracle.issues.push(issue);
    upsertNotification(oracle, text(issue.id, 'created issue id'), actorID, true, now, false);
    bumpSearchEpoch(oracle, projectID, 'public');
    return intent(oracle, 'issueCreate', 'create-issue', issue, actor, {}, true);
  }

  if (mutator === 'issue.update') {
    if (now === null) throw new Error('issue.update needs authoritative time');
    const issue = rowBy(oracle.issues, 'id', args.id, 'updated issue');
    const oldAssignee = typeof issue.assigneeID === 'string' ? issue.assigneeID : null;
    const oldVisibility = issue.visibility;
    const submitted: JsonRow = {id: args.id, modified: now};
    issue.modified = now;
    for (const field of ['title', 'description', 'open', 'visibility'] as const) {
      if (Object.hasOwn(args, field)) {
        issue[field] = args[field];
        submitted[field] = args[field];
      }
    }
    if (Object.hasOwn(args, 'assigneeID')) {
      if (args.assigneeID === null) delete issue.assigneeID;
      else issue.assigneeID = args.assigneeID;
      submitted.assigneeID = args.assigneeID;
      if (typeof args.assigneeID === 'string') {
        upsertNotification(oracle, text(issue.id, 'issue id'), args.assigneeID, true, now, false);
      }
      if (oldAssignee && oldAssignee !== args.assigneeID) {
        upsertNotification(oracle, text(issue.id, 'issue id'), oldAssignee, false, now, true);
      }
    }
    if (
      Object.hasOwn(args, 'title')
      || Object.hasOwn(args, 'description')
      || Object.hasOwn(args, 'visibility')
    ) {
      bumpSearchEpoch(oracle, text(issue.projectID, 'issue project'), oldVisibility);
      if (issue.visibility !== oldVisibility) {
        bumpSearchEpoch(oracle, text(issue.projectID, 'issue project'), issue.visibility);
      }
    }
    return intent(oracle, 'issueUpdate', 'update-issue', issue, actor, {update: submitted}, false);
  }

  if (mutator === 'issue.delete') {
    const issue = rowBy(oracle.issues, 'id', args.id, 'deleted issue');
    const commentIDs = new Set(
      oracle.comments.filter(comment => comment.issueID === issue.id).map(comment => comment.id),
    );
    oracle.comments = oracle.comments.filter(comment => comment.issueID !== issue.id);
    oracle.emoji = oracle.emoji.filter(row => row.subjectID !== issue.id && !commentIDs.has(row.subjectID));
    oracle.issueLabels = oracle.issueLabels.filter(row => row.issueID !== issue.id);
    oracle.viewState = oracle.viewState.filter(row => row.issueID !== issue.id);
    oracle.issueNotifications = oracle.issueNotifications.filter(row => row.issueID !== issue.id);
    oracle.issues = oracle.issues.filter(row => row.id !== issue.id);
    bumpSearchEpoch(oracle, text(issue.projectID, 'deleted issue project'), issue.visibility);
    return null;
  }

  if (mutator === 'issue.addLabel') {
    const issue = rowBy(oracle.issues, 'id', args.issueID, 'label issue');
    const label = rowBy(oracle.labels, 'id', args.labelID, 'added label');
    const projectID = typeof args.projectID === 'string' ? args.projectID : DEFAULT_PROJECT_ID;
    oracle.issueLabels.push({issueID: issue.id, labelID: label.id, projectID});
    return intent(
      oracle,
      'issueAddLabel',
      'update-issue',
      issue,
      actor,
      {update: {id: issue.id}},
      false,
    );
  }

  if (mutator === 'issue.removeLabel') {
    const issue = rowBy(oracle.issues, 'id', args.issueID, 'label issue');
    const before = oracle.issueLabels.length;
    oracle.issueLabels = oracle.issueLabels.filter(row => !(
      row.issueID === args.issueID && row.labelID === args.labelID
    ));
    if (oracle.issueLabels.length !== before - 1) throw new Error('oracle issue label was not unique');
    return intent(
      oracle,
      'issueRemoveLabel',
      'update-issue',
      issue,
      actor,
      {update: {id: issue.id}},
      false,
    );
  }

  if (mutator === 'notification.update') {
    upsertNotification(
      oracle,
      text(args.issueID, 'notification issue'),
      actorID,
      args.subscribed === 'subscribe',
      number(args.created, 'notification time'),
      true,
    );
    return null;
  }

  if (mutator === 'emoji.addToIssue') {
    if (now === null) throw new Error('emoji.addToIssue needs authoritative time');
    const issue = rowBy(oracle.issues, 'id', args.subjectID, 'emoji issue');
    oracle.emoji.push({
      id: args.id,
      value: args.unicode,
      annotation: args.annotation,
      subjectID: issue.id,
      creatorID: actorID,
      created: now,
    });
    issue.modified = now;
    upsertNotification(oracle, text(issue.id, 'emoji issue id'), actorID, true, now, false);
    return intent(
      oracle,
      'emojiAddToIssue',
      'add-emoji-to-issue',
      issue,
      actor,
      {emoji: args.unicode},
      false,
    );
  }

  if (mutator === 'emoji.addToComment') {
    if (now === null) throw new Error('emoji.addToComment needs authoritative time');
    const comment = rowBy(oracle.comments, 'id', args.subjectID, 'emoji comment');
    const issue = rowBy(oracle.issues, 'id', comment.issueID, 'emoji comment issue');
    oracle.emoji.push({
      id: args.id,
      value: args.unicode,
      annotation: args.annotation,
      subjectID: comment.id,
      creatorID: actorID,
      created: now,
    });
    issue.modified = now;
    return intent(
      oracle,
      'emojiAddToComment',
      'add-emoji-to-comment',
      issue,
      actor,
      {emoji: args.unicode, comment: {id: comment.id, body: comment.body}},
      false,
    );
  }

  if (mutator === 'emoji.remove') {
    const before = oracle.emoji.length;
    oracle.emoji = oracle.emoji.filter(row => row.id !== args.id);
    if (oracle.emoji.length !== before - 1) throw new Error('oracle emoji was not unique');
    return null;
  }

  if (mutator === 'comment.add') {
    if (now === null) throw new Error('comment.add needs authoritative time');
    const issue = rowBy(oracle.issues, 'id', args.issueID, 'comment issue');
    const comment = {
      id: args.id,
      issueID: issue.id,
      body: args.body,
      creatorID: actorID,
      created: now,
    };
    oracle.comments.push(comment);
    issue.modified = now;
    upsertNotification(oracle, text(issue.id, 'comment issue id'), actorID, true, now, false);
    bumpSearchEpoch(oracle, text(issue.projectID, 'comment issue project'), issue.visibility);
    return intent(
      oracle,
      'commentAdd',
      'add-comment',
      issue,
      actor,
      {comment: {id: comment.id, body: comment.body}},
      false,
    );
  }

  if (mutator === 'comment.edit') {
    const comment = rowBy(oracle.comments, 'id', args.id, 'edited comment');
    comment.body = args.body;
    const issue = rowBy(oracle.issues, 'id', comment.issueID, 'edited comment issue');
    bumpSearchEpoch(oracle, text(issue.projectID, 'edited comment project'), issue.visibility);
    return intent(
      oracle,
      'commentEdit',
      'edit-comment',
      issue,
      actor,
      {comment: {id: comment.id, body: comment.body}},
      false,
    );
  }

  if (mutator === 'comment.remove') {
    const comment = rowBy(oracle.comments, 'id', args.id, 'removed comment');
    const issue = rowBy(oracle.issues, 'id', comment.issueID, 'removed comment issue');
    oracle.comments = oracle.comments.filter(row => row.id !== comment.id);
    oracle.emoji = oracle.emoji.filter(row => row.subjectID !== comment.id);
    bumpSearchEpoch(oracle, text(issue.projectID, 'removed comment project'), issue.visibility);
    return null;
  }

  if (mutator === 'label.create') {
    oracle.labels.push({
      id: args.id,
      name: args.name,
      projectID: typeof args.projectID === 'string' ? args.projectID : DEFAULT_PROJECT_ID,
    });
    return null;
  }

  if (mutator === 'label.createAndAddToIssue') {
    const projectID = typeof args.projectID === 'string' ? args.projectID : DEFAULT_PROJECT_ID;
    oracle.labels.push({id: args.labelID, name: args.labelName, projectID});
    oracle.issueLabels.push({issueID: args.issueID, labelID: args.labelID, projectID});
    return null;
  }

  if (mutator === 'viewState.set') {
    const existing = oracle.viewState.find(row => row.issueID === args.issueID && row.userID === actorID);
    if (existing) existing.viewed = args.viewed;
    else oracle.viewState.push({issueID: args.issueID, userID: actorID, viewed: args.viewed});
    return null;
  }

  if (mutator === 'userPref.set') {
    const existing = oracle.userPref.find(row => row.key === args.key && row.userID === actorID);
    if (existing) existing.value = args.value;
    else oracle.userPref.push({key: args.key, userID: actorID, value: args.value});
    return null;
  }

  throw new Error(`lane4 oracle does not know mutator ${mutator}`);
}

export function rebuildReadModels(oracle: Lane4Oracle): {
  projectUserRead: JsonRow[];
  issueListRead: JsonRow[];
  issueLabelRead: JsonRow[];
  issueSearchDocument: JsonRow[];
} {
  const projectUsers = new Map<string, JsonRow>();
  const addProjectUser = (projectID: string, userID: string, reason: string): void => {
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
  for (const issue of oracle.issues) {
    addProjectUser(text(issue.projectID, 'issue project'), text(issue.creatorID, 'issue creator'), 'isCreator');
    if (typeof issue.assigneeID === 'string') {
      addProjectUser(text(issue.projectID, 'issue project'), issue.assigneeID, 'isAssignee');
    }
  }
  for (const project of oracle.projects) {
    for (const user of oracle.users) {
      if (user.role === 'crew' && !text(user.login, 'user login').startsWith('rocibot')) {
        addProjectUser(text(project.id, 'project id'), text(user.id, 'user id'), 'isCrew');
      }
    }
  }
  const projectUserRead = [...projectUsers.values()];
  const issueListRead = oracle.issues.map(issue => ({
    issueID: issue.id,
    projectID: issue.projectID,
    creatorID: issue.creatorID,
    assigneeID: issue.assigneeID ?? null,
    open: boolean(issue.open, 'issue open'),
    visibility: issue.visibility,
    modified: issue.modified,
    created: issue.created,
  }));
  const issueLabelRead = oracle.issueLabels.map(row => ({...row}));
  const issueSearchDocument = oracle.issues.map(issue => ({
    issueID: issue.id,
    projectID: issue.projectID,
    visibility: issue.visibility,
    title: issue.title,
    description: issue.description,
    commentText: oracle.comments
      .filter(comment => comment.issueID === issue.id)
      .sort((left, right) => (
        number(left.created, 'comment created') - number(right.created, 'comment created')
        || compareText(text(left.id, 'comment id'), text(right.id, 'comment id'))
      ))
      .map(comment => text(comment.body, 'comment body'))
      .join('\n'),
  }));
  return {projectUserRead, issueListRead, issueLabelRead, issueSearchDocument};
}

export function normalizedExpectedAudit(oracle: Lane4Oracle): JsonRow {
  const readModels = rebuildReadModels(oracle);
  return {
    issues: semanticSort(oracle.issues, ['id']),
    comments: semanticSort(oracle.comments, ['id']),
    labels: semanticSort(oracle.labels, ['id']),
    issueLabels: semanticSort(oracle.issueLabels, ['issueID', 'labelID']),
    emoji: semanticSort(oracle.emoji, ['id']),
    viewState: semanticSort(oracle.viewState, ['issueID', 'userID']),
    userPref: semanticSort(oracle.userPref, ['userID', 'key']),
    issueNotifications: semanticSort(oracle.issueNotifications, ['issueID', 'userID']),
    projectUserRead: semanticSort(readModels.projectUserRead, ['projectID', 'userID']),
    issueListRead: semanticSort(readModels.issueListRead, ['issueID']),
    issueLabelRead: semanticSort(readModels.issueLabelRead, ['issueID', 'labelID']),
    issueSearchDocument: semanticSort(readModels.issueSearchDocument, ['issueID']),
    searchEpoch: semanticSort(oracle.searchEpoch, ['projectID', 'visibility']),
    notificationIntent: semanticSort(oracle.notificationIntent, ['physicalID']),
    notificationAttempt: semanticSort(oracle.notificationAttempt, ['physicalID']),
  };
}

export function normalizedObservedAudit(value: JsonRow): JsonRow {
  const keys: Record<string, string[]> = {
    issues: ['id'], comments: ['id'], labels: ['id'],
    issueLabels: ['issueID', 'labelID'], emoji: ['id'],
    viewState: ['issueID', 'userID'], userPref: ['userID', 'key'],
    issueNotifications: ['issueID', 'userID'],
    projectUserRead: ['projectID', 'userID'], issueListRead: ['issueID'],
    issueLabelRead: ['issueID', 'labelID'], issueSearchDocument: ['issueID'],
    searchEpoch: ['projectID', 'visibility'], notificationIntent: ['physicalID'],
    notificationAttempt: ['physicalID'],
  };
  return Object.fromEntries(Object.entries(keys).map(([key, sortKeys]) => {
    const rows = value[key];
    if (!Array.isArray(rows)) throw new Error(`lane4 audit ${key} is not an array`);
    return [key, semanticSort(rows as JsonRow[], sortKeys)];
  }));
}

export function readModelRebuildDigest(value: JsonRow): string {
  const tableDigests = Object.fromEntries([
    'projectUserRead', 'issueListRead', 'issueLabelRead', 'issueSearchDocument',
  ].map(table => [table, digest(value[table])]));
  return digest(tableDigests);
}

export function canonicalValue(value: unknown): string {
  return canonicalJson(value);
}
