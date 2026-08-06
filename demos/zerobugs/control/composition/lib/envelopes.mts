export const QUERY_NAMES = [
  'allLabels',
  'allUsers',
  'allProjects',
  'user',
  'crewUser',
  'labels',
  'labelsOrderByName',
  'issuePreloadV2',
  'userPref',
  'usersForProject',
  'commentsPage',
  'comment',
  'issueDetail',
  'issueListV2',
  'listIssueByID',
  'emojiChange',
  'prevNext',
  'issueList',
  'userPicker',
] as const;

export const MUTATION_NAMES = [
  'issue.create',
  'issue.update',
  'issue.delete',
  'issue.addLabel',
  'issue.removeLabel',
  'notification.update',
  'emoji.addToIssue',
  'emoji.addToComment',
  'emoji.remove',
  'comment.add',
  'comment.edit',
  'comment.remove',
  'label.create',
  'label.createAndAddToIssue',
  'viewState.set',
  'userPref.set',
] as const;

export const MUTATION_REF_NAMES = {
  'issue.create': 'issueCreate',
  'issue.update': 'issueUpdate',
  'issue.delete': 'issueDelete',
  'issue.addLabel': 'issueAddLabel',
  'issue.removeLabel': 'issueRemoveLabel',
  'notification.update': 'notificationUpdate',
  'emoji.addToIssue': 'emojiAddToIssue',
  'emoji.addToComment': 'emojiAddToComment',
  'emoji.remove': 'emojiRemove',
  'comment.add': 'commentAdd',
  'comment.edit': 'commentEdit',
  'comment.remove': 'commentRemove',
  'label.create': 'labelCreate',
  'label.createAndAddToIssue': 'labelCreateAndAddToIssue',
  'viewState.set': 'viewStateSet',
  'userPref.set': 'userPrefSet',
} as const;

export type QueryName = (typeof QUERY_NAMES)[number];
export type MutationName = (typeof MUTATION_NAMES)[number];

export type QueryEnvelope = Readonly<{
  version: 'zerobugs.query.v1';
  name: QueryName;
  args: Record<string, unknown>;
}>;

export type MutationEnvelope = Readonly<{
  version: 'zerobugs.mutation.v1';
  name: MutationName;
  args: Record<string, unknown>;
  clientID: string;
  mutationID: string;
}>;

export class EnvelopeError extends Error {
  readonly code = 'ZERBUGS_ENVELOPE_INVALID';
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function boundedIdentity(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 256
    && /^[A-Za-z0-9._:-]+$/u.test(value);
}

export function parseQueryEnvelope(value: unknown): QueryEnvelope {
  const input = record(value);
  if (
    !input
    || !exactKeys(input, ['version', 'name', 'args'])
    || input.version !== 'zerobugs.query.v1'
    || !QUERY_NAMES.includes(input.name as QueryName)
    || !record(input.args)
  ) throw new EnvelopeError('query envelope was refused');
  return input as QueryEnvelope;
}

export function parseMutationEnvelope(value: unknown): MutationEnvelope {
  const input = record(value);
  if (
    !input
    || !exactKeys(input, ['version', 'name', 'args', 'clientID', 'mutationID'])
    || input.version !== 'zerobugs.mutation.v1'
    || !MUTATION_NAMES.includes(input.name as MutationName)
    || !record(input.args)
    || !boundedIdentity(input.clientID)
    || !boundedIdentity(input.mutationID)
  ) throw new EnvelopeError('mutation envelope was refused');
  return input as MutationEnvelope;
}

export function queryResultEnvelope(name: QueryName, rows: readonly unknown[]) {
  return {version: 'zerobugs.result.v1' as const, kind: 'query' as const, name, rows};
}

export function mutationResultEnvelope(name: MutationName, result: unknown) {
  return {version: 'zerobugs.result.v1' as const, kind: 'mutation' as const, name, result};
}

