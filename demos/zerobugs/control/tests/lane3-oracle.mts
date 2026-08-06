import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

export type OracleRow = Record<string, unknown> & {_id: string};
export type OracleTables = Record<string, OracleRow[]>;

export interface ListContext {
  open: boolean | null;
  projectName?: string;
  assignee: string | null;
  creator: string | null;
  labels: string[] | null;
  textFilter: string | null;
  sortField: 'modified' | 'created';
  sortDirection: 'asc' | 'desc';
}

export interface OracleFixture {
  actors: Record<string, {role: 'crew' | 'user'; sourceUserID: string; userID: string}>;
  tables: OracleTables;
}

const CONTROL_ROOT = resolve(import.meta.dirname, '..');
const FIXTURE_ROOT = join(CONTROL_ROOT, 'fixtures/normal-seed-v1');
const SOURCE_TABLES = [
  'user',
  'project',
  'label',
  'issue',
  'issueLabel',
  'comment',
  'emoji',
  'viewState',
  'userPref',
  'issueNotifications',
] as const;

export function defaultListContext(overrides: Partial<ListContext> = {}): ListContext {
  return {
    open: null,
    projectName: 'Zero',
    assignee: null,
    creator: null,
    labels: null,
    textFilter: null,
    sortField: 'modified',
    sortDirection: 'desc',
    ...overrides,
  };
}

export async function loadOracleFixture(): Promise<OracleFixture> {
  const metadata = JSON.parse(
    await readFile(join(FIXTURE_ROOT, 'fixture.json'), 'utf8'),
  ) as OracleFixture['actors'] & {actorBindings?: OracleFixture['actors']};
  const tables: OracleTables = {};
  for (const table of SOURCE_TABLES) {
    tables[table] = JSON.parse(
      await readFile(join(FIXTURE_ROOT, `${table}.json`), 'utf8'),
    ) as OracleRow[];
  }
  const actorBindings = (metadata as unknown as {actorBindings: OracleFixture['actors']}).actorBindings;
  return {actors: actorBindings, tables};
}

function text(left: unknown): string {
  return typeof left === 'string' ? left : '';
}

function number(left: unknown): number {
  if (typeof left !== 'number') throw new Error('oracle expected a number');
  return left;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareOracleIssues(
  left: OracleRow,
  right: OracleRow,
  context: ListContext,
  direction: 'forward' | 'backward' = 'forward',
): number {
  let multiplier = context.sortDirection === 'desc' ? -1 : 1;
  if (direction === 'backward') multiplier *= -1;
  const ordered = number(left[context.sortField]) - number(right[context.sortField]);
  return (ordered !== 0 ? ordered : compareText(text(left.id), text(right.id))) * multiplier;
}

export function oracleIssueList(
  fixture: OracleFixture,
  context: ListContext,
  actor: string | null,
  direction: 'forward' | 'backward' = 'forward',
): OracleRow[] {
  const {tables} = fixture;
  const viewer = actor === null ? null : fixture.actors[actor];
  const crew = viewer?.role === 'crew';
  const project = tables.project.find(row => (
    text(row.lowerCaseName) === (context.projectName ?? 'Zero').toLowerCase()
  ));
  if (!project) return [];

  const usersByID = new Map(tables.user.map(row => [row._id, row]));
  const labelsByID = new Map(tables.label.map(row => [row._id, row]));
  const selectedLabelIDs = context.labels === null
    ? []
    : [...new Set(context.labels)].map(name => (
      tables.label.find(row => row.projectID === project._id && row.name === name)?._id ?? null
    ));
  if (selectedLabelIDs.includes(null)) return [];

  const labelsByIssue = new Map<string, Set<string>>();
  for (const edge of tables.issueLabel) {
    const issueID = text(edge.issueID);
    const names = labelsByIssue.get(issueID) ?? new Set<string>();
    const label = labelsByID.get(text(edge.labelID));
    if (label) names.add(label._id);
    labelsByIssue.set(issueID, names);
  }
  const commentsByIssue = new Map<string, string[]>();
  for (const comment of tables.comment) {
    const issueID = text(comment.issueID);
    const bodies = commentsByIssue.get(issueID) ?? [];
    bodies.push(text(comment.body));
    commentsByIssue.set(issueID, bodies);
  }

  const needle = context.textFilter?.toLowerCase() ?? null;
  return tables.issue.filter(issue => {
    if (issue.projectID !== project._id) return false;
    if (issue.visibility !== 'public' && !crew) return false;
    if (context.open !== null && issue.open !== context.open) return false;
    const creator = usersByID.get(text(issue.creatorID));
    const assignee = usersByID.get(text(issue.assigneeID));
    if (context.creator !== null && creator?.login !== context.creator) return false;
    if (context.assignee !== null && assignee?.login !== context.assignee) return false;
    const memberships = labelsByIssue.get(issue._id) ?? new Set<string>();
    if (!selectedLabelIDs.every(id => id !== null && memberships.has(id))) return false;
    if (needle !== null && !(
      text(issue.title).toLowerCase().includes(needle)
      || text(issue.description).toLowerCase().includes(needle)
      || (commentsByIssue.get(issue._id) ?? []).some(body => body.toLowerCase().includes(needle))
    )) return false;
    return true;
  }).sort((left, right) => compareOracleIssues(left, right, context, direction));
}

export function sourceID(row: OracleRow): string {
  return text(row.id);
}

export function sourceUserForPhysical(fixture: OracleFixture, physicalID: unknown): OracleRow | null {
  return fixture.tables.user.find(row => row._id === physicalID) ?? null;
}

export function sourceIssueForID(fixture: OracleFixture, sourceIssueID: string): OracleRow | null {
  return fixture.tables.issue.find(row => row.id === sourceIssueID) ?? null;
}

export function sourceCommentForID(fixture: OracleFixture, sourceCommentID: string): OracleRow | null {
  return fixture.tables.comment.find(row => row.id === sourceCommentID) ?? null;
}
