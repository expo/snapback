import {useSnapbackQuery, type QueryState} from '@expo/snapback-react';
import type {FunctionArgs, FunctionResult} from '../../snapback/generated/api';
import {api} from '../../snapback/generated/api.mjs';

import type {
  AdapterResult,
  CommentCursor,
  ConnectionFact,
  EmojiCursor,
  FreshnessFact,
  IssueCursor,
  IssueDetail,
  Label,
  LabelCursor,
  ListIssue,
  Page,
  PreloadedIssue,
  Project,
  ProjectCursor,
  Refusal,
  RichComment,
  RichEmoji,
  ServerCompleteness,
  User,
  UserCursor,
  UserPreference,
} from './types';

const QUERY_REFS = {
  allLabels: api.allLabels,
  allUsers: api.allUsers,
  allProjects: api.allProjects,
  user: api.user,
  crewUser: api.crewUser,
  labels: api.labels,
  labelsOrderByName: api.labelsOrderByName,
  issuePreloadV2: api.issuePreloadV2,
  userPref: api.userPref,
  usersForProject: api.usersForProject,
  commentsPage: api.commentsPage,
  comment: api.comment,
  issueDetail: api.issueDetail,
  issueListV2: api.issueListV2,
  listIssueByID: api.listIssueByID,
  emojiChange: api.emojiChange,
  prevNext: api.prevNext,
  issueList: api.issueList,
  userPicker: api.userPicker,
} as const;

export type QueryName = keyof typeof QUERY_REFS;
export type QueryArgs<Name extends QueryName> = FunctionArgs<(typeof QUERY_REFS)[Name]>;

export type QueryValueMap = Readonly<{
  allLabels: Page<Label, LabelCursor>;
  allUsers: Page<User, UserCursor>;
  allProjects: Page<Project, ProjectCursor>;
  user: User;
  crewUser: User;
  labels: Page<Label, LabelCursor>;
  labelsOrderByName: Page<Label, LabelCursor>;
  issuePreloadV2: Page<PreloadedIssue, IssueCursor>;
  userPref: UserPreference;
  usersForProject: Page<User, UserCursor>;
  commentsPage: Page<RichComment, CommentCursor>;
  comment: RichComment;
  issueDetail: IssueDetail;
  issueListV2: Page<ListIssue, IssueCursor>;
  listIssueByID: Page<ListIssue, IssueCursor>;
  emojiChange: Page<RichEmoji, EmojiCursor>;
  prevNext: Page<ListIssue, IssueCursor>;
  issueList: Page<ListIssue, IssueCursor>;
  userPicker: Page<User, UserCursor>;
}>;

export type QueryValue<Name extends QueryName> = QueryValueMap[Name];

type AnyRecord = Record<string, unknown>;
type RawState = Readonly<{
  status: 'pending' | 'ready' | 'refreshing' | 'error' | 'skipped';
  data?: readonly unknown[];
  error?: unknown;
  connection: ConnectionFact;
  freshness: FreshnessFact;
}>;

const SERVER_STATUSES = new Set<ServerCompleteness>([
  'complete',
  'incomplete',
  'refreshing',
  'not-found-authoritative',
]);

function record(value: unknown, label: string): AnyRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw localRefusal('ZBUGS_ADAPTER_FRAME_REFUSED', `${label} must be an object`);
  }
  return value as AnyRecord;
}

function localRefusal(code: string, message: string, details: AnyRecord = {}): Error {
  const error = new Error(`${code}: ${message}`) as Error & {diagnostic?: Refusal};
  error.diagnostic = Object.freeze({code, message, details: Object.freeze({...details})});
  return error;
}

function refusalFrom(error: unknown): Refusal {
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    diagnostic?: {code?: unknown; message?: unknown; details?: unknown};
  } | null;
  const diagnostic = candidate?.diagnostic;
  const details = diagnostic?.details;
  return Object.freeze({
    code: typeof diagnostic?.code === 'string'
      ? diagnostic.code
      : typeof candidate?.code === 'string' ? candidate.code : 'ZBUGS_QUERY_REFUSED',
    message: typeof diagnostic?.message === 'string'
      ? diagnostic.message
      : typeof candidate?.message === 'string' ? candidate.message : String(error),
    details: details && typeof details === 'object' && !Array.isArray(details)
      ? Object.freeze({...details as AnyRecord})
      : Object.freeze({}),
  });
}

function oneServerFrame(data: readonly unknown[]): AnyRecord {
  if (data.length !== 1) {
    throw localRefusal(
      'ZBUGS_ADAPTER_FRAME_REFUSED',
      'a generated Zerobugs query must return exactly one completeness frame',
      {received: data.length},
    );
  }
  const frame = record(data[0], 'query frame');
  if (!SERVER_STATUSES.has(frame.status as ServerCompleteness)) {
    throw localRefusal('ZBUGS_ADAPTER_FRAME_REFUSED', 'query frame status is not admitted');
  }
  if (frame.reason !== null && typeof frame.reason !== 'string') {
    throw localRefusal('ZBUGS_ADAPTER_FRAME_REFUSED', 'query frame reason is malformed');
  }
  return frame;
}

function childCompleteness(value: unknown, label: string): ServerCompleteness {
  if (!SERVER_STATUSES.has(value as ServerCompleteness)) {
    throw localRefusal(
      'ZBUGS_ADAPTER_CHILD_COMPLETENESS_REFUSED',
      `${label} completeness fact is malformed`,
    );
  }
  return value as ServerCompleteness;
}

function validatePageFrame(frame: AnyRecord): void {
  if (!Array.isArray(frame.items)) {
    throw localRefusal('ZBUGS_ADAPTER_FRAME_REFUSED', 'page frame items must be an array');
  }
  if (typeof frame.hasMore !== 'boolean') {
    throw localRefusal('ZBUGS_ADAPTER_FRAME_REFUSED', 'page frame hasMore must be boolean');
  }
  if (!Number.isSafeInteger(frame.examined) || Number(frame.examined) < 0) {
    throw localRefusal('ZBUGS_ADAPTER_FRAME_REFUSED', 'page frame examined is invalid');
  }
  if (!Number.isSafeInteger(frame.total) || Number(frame.total) < 0) {
    throw localRefusal('ZBUGS_ADAPTER_FRAME_REFUSED', 'page frame total is invalid');
  }
  if (frame.status === 'complete' && (frame.hasMore || frame.cursor !== null)) {
    throw localRefusal(
      'ZBUGS_ADAPTER_CONTRADICTORY_FRAME',
      'a complete page cannot advertise a continuation',
    );
  }
  if (frame.status === 'not-found-authoritative' && frame.items.length !== 0) {
    throw localRefusal(
      'ZBUGS_ADAPTER_CONTRADICTORY_FRAME',
      'an authoritative not-found page cannot contain rows',
    );
  }
  if (frame.status === 'not-found-authoritative' && (frame.hasMore || frame.cursor !== null)) {
    throw localRefusal(
      'ZBUGS_ADAPTER_CONTRADICTORY_FRAME',
      'an authoritative not-found page cannot advertise a continuation',
    );
  }
  if (frame.status === 'incomplete' && frame.reason === 'page-limit' && !frame.hasMore) {
    throw localRefusal(
      'ZBUGS_ADAPTER_CONTRADICTORY_FRAME',
      'a page-limit frame must advertise a proved continuation',
    );
  }
  if (
    frame.hasMore
    && frame.reason === 'page-limit'
    && (frame.cursor === null || frame.items.length === 0)
  ) {
    throw localRefusal(
      'ZBUGS_ADAPTER_CONTRADICTORY_FRAME',
      'a proved page continuation needs rows and a cursor',
    );
  }
}

function richEmoji(value: unknown): RichEmoji {
  const entry = record(value, 'rich emoji');
  return Object.freeze({
    ...record(entry.emoji, 'emoji'),
    creator: Object.freeze({...record(entry.creator, 'emoji creator')}) as User,
  }) as RichEmoji;
}

function richComment(value: unknown): RichComment {
  const entry = record(value, 'rich comment');
  const comment = record(entry.comment, 'comment');
  return Object.freeze({
    ...comment,
    creator: Object.freeze({...record(entry.creator, 'comment creator')}) as User,
    emoji: Object.freeze((entry.emoji as readonly unknown[]).map(richEmoji)),
    completeness: Object.freeze({
      emoji: childCompleteness(entry.emojiCompleteness, 'comment emoji'),
    }),
  }) as RichComment;
}

function listIssue(value: unknown): ListIssue {
  const entry = record(value, 'list issue');
  return Object.freeze({
    ...record(entry.issue, 'issue'),
    labels: Object.freeze([...(entry.labels as readonly Label[])]),
    viewState: (entry.viewState ?? null) as ListIssue['viewState'],
    completeness: Object.freeze({
      labels: childCompleteness(entry.labelsCompleteness, 'issue labels'),
    }),
  }) as ListIssue;
}

function preloadedIssue(value: unknown): PreloadedIssue {
  const entry = record(value, 'preloaded issue');
  const viewStates = entry.viewState as readonly PreloadedIssue['viewState'][];
  return Object.freeze({
    ...record(entry.issue, 'issue'),
    labels: Object.freeze([...(entry.labels as readonly Label[])]),
    viewState: viewStates[0] ?? null,
    creator: Object.freeze({...record(entry.creator, 'issue creator')}) as User,
    assignee: entry.assignee === null
      ? null
      : Object.freeze({...record(entry.assignee, 'issue assignee')}) as User,
    emoji: Object.freeze((entry.emoji as readonly unknown[]).map(richEmoji)),
    comments: Object.freeze((entry.comments as readonly unknown[]).map(richComment)),
    commentsCursor: entry.commentsCursor as CommentCursor | null,
    completeness: Object.freeze({
      labels: childCompleteness(entry.labelsCompleteness, 'preload labels'),
      emoji: childCompleteness(entry.emojiCompleteness, 'preload emoji'),
      comments: childCompleteness(entry.commentsCompleteness, 'preload comments'),
    }),
  }) as PreloadedIssue;
}

function issueDetail(value: unknown): IssueDetail {
  const entry = record(value, 'issue detail');
  return Object.freeze({
    ...record(entry.issue, 'issue'),
    project: Object.freeze({...record(entry.project, 'project')}) as Project,
    creator: Object.freeze({...record(entry.creator, 'issue creator')}) as User,
    assignee: entry.assignee === null
      ? null
      : Object.freeze({...record(entry.assignee, 'issue assignee')}) as User,
    labels: Object.freeze([...(entry.labels as readonly Label[])]),
    notificationState: entry.notificationState as IssueDetail['notificationState'],
    viewState: entry.viewState as IssueDetail['viewState'],
    emoji: Object.freeze((entry.emoji as readonly unknown[]).map(richEmoji)),
    comments: Object.freeze((entry.comments as readonly unknown[]).map(richComment)),
    commentsCursor: entry.commentsCursor as CommentCursor | null,
    completeness: Object.freeze({
      labels: childCompleteness(entry.labelsCompleteness, 'detail labels'),
      emoji: childCompleteness(entry.emojiCompleteness, 'detail emoji'),
      comments: childCompleteness(entry.commentsCompleteness, 'detail comments'),
    }),
  }) as IssueDetail;
}

function page<Value, Cursor>(
  frame: AnyRecord,
  mapItem: (value: unknown) => Value,
): Page<Value, Cursor> {
  validatePageFrame(frame);
  return Object.freeze({
    items: Object.freeze((frame.items as readonly unknown[]).map(mapItem)),
    hasMore: frame.hasMore as boolean,
    cursor: frame.cursor as Cursor | null,
    examined: frame.examined as number,
    total: frame.total as number,
    ...(Array.isArray(frame.searchEpoch)
      ? {searchEpoch: Object.freeze([...frame.searchEpoch])}
      : {}),
  });
}

function assemble<Name extends QueryName>(name: Name, frame: AnyRecord): QueryValue<Name> | null {
  if (frame.status === 'not-found-authoritative') return null;
  switch (name) {
    case 'allLabels':
    case 'labels':
    case 'labelsOrderByName':
      return page<Label, LabelCursor>(frame, value => Object.freeze({...record(value, 'label')}) as Label) as QueryValue<Name>;
    case 'allUsers':
    case 'usersForProject':
    case 'userPicker':
      return page<User, UserCursor>(frame, value => Object.freeze({...record(value, 'user')}) as User) as QueryValue<Name>;
    case 'allProjects':
      return page<Project, ProjectCursor>(frame, value => Object.freeze({...record(value, 'project')}) as Project) as QueryValue<Name>;
    case 'user':
    case 'crewUser':
      return (frame.value === null ? null : Object.freeze({...record(frame.value, 'user')})) as QueryValue<Name> | null;
    case 'userPref':
      return (frame.value === null ? null : Object.freeze({...record(frame.value, 'user preference')})) as QueryValue<Name> | null;
    case 'issuePreloadV2':
      return page<PreloadedIssue, IssueCursor>(frame, preloadedIssue) as QueryValue<Name>;
    case 'commentsPage':
      return page<RichComment, CommentCursor>(frame, richComment) as QueryValue<Name>;
    case 'comment':
      return (frame.value === null ? null : richComment(frame.value)) as QueryValue<Name> | null;
    case 'issueDetail':
      return (frame.value === null ? null : issueDetail(frame.value)) as QueryValue<Name> | null;
    case 'issueListV2':
    case 'listIssueByID':
    case 'prevNext':
    case 'issueList':
      return page<ListIssue, IssueCursor>(frame, listIssue) as QueryValue<Name>;
    case 'emojiChange':
      return page<RichEmoji, EmojiCursor>(frame, richEmoji) as QueryValue<Name>;
  }
}

/**
 * Converts the closed React query state plus the server's own completeness
 * frame into the control adapter state. Transport refresh and server
 * incompleteness remain independent; this function never upgrades either.
 */
export function deriveAdapterResult<Name extends QueryName>(
  name: Name,
  state: RawState,
): AdapterResult<QueryValue<Name>> {
  if (state.status === 'pending' || state.status === 'skipped') {
    return Object.freeze({
      status: 'pending',
      value: undefined,
      reason: null,
      connection: state.connection,
      freshness: 'unknown',
    });
  }
  if (state.status === 'error') {
    return Object.freeze({
      status: 'refused',
      value: undefined,
      reason: null,
      refusal: refusalFrom(state.error),
      connection: state.connection,
      freshness: 'unknown',
    });
  }

  try {
    const frame = oneServerFrame(state.data ?? []);
    const serverStatus = frame.status as ServerCompleteness;
    if (serverStatus === 'not-found-authoritative') {
      if (PAGE_QUERY_NAMES.has(name)) validatePageFrame(frame);
      else if (frame.value !== null) {
        throw localRefusal(
          'ZBUGS_ADAPTER_CONTRADICTORY_FRAME',
          'an authoritative point-query absence must carry a null value',
        );
      }
    }
    const value = assemble(name, frame);
    if (serverStatus === 'not-found-authoritative') {
      return Object.freeze({
        status: 'not-found-authoritative',
        value: null,
        reason: frame.reason as string | null,
        connection: state.connection,
        freshness: 'current',
      });
    }
    if (value === null) {
      throw localRefusal(
        'ZBUGS_ADAPTER_CONTRADICTORY_FRAME',
        'a non-not-found frame returned no value',
      );
    }
    if (state.status === 'refreshing' || serverStatus === 'refreshing') {
      return Object.freeze({
        status: 'refreshing',
        value,
        serverStatus,
        reason: frame.reason as string | null,
        connection: state.connection,
        freshness: state.freshness,
      });
    }
    return Object.freeze({
      status: serverStatus,
      value,
      reason: frame.reason as string | null,
      connection: state.connection,
      freshness: 'current',
    }) as AdapterResult<QueryValue<Name>>;
  } catch (error) {
    return Object.freeze({
      status: 'refused',
      value: undefined,
      reason: null,
      refusal: refusalFrom(error),
      connection: state.connection,
      freshness: 'unknown',
    });
  }
}

const PAGE_QUERY_NAMES: ReadonlySet<QueryName> = new Set([
  'allLabels', 'allUsers', 'allProjects', 'labels', 'labelsOrderByName',
  'issuePreloadV2', 'usersForProject', 'commentsPage', 'issueListV2',
  'listIssueByID', 'emojiChange', 'prevNext', 'issueList', 'userPicker',
]);

/** The first-party live-subscription path for every frozen named query. */
export function useZerobugsQuery<Name extends QueryName>(
  name: Name,
  args: QueryArgs<Name>,
): AdapterResult<QueryValue<Name>> {
  const state = useSnapbackQuery(
    QUERY_REFS[name] as never,
    args as never,
  ) as QueryState<FunctionResult<(typeof QUERY_REFS)[Name]>>;
  return deriveAdapterResult(name, state as unknown as RawState);
}

export type QueryClient = Readonly<{
  query(
    reference: unknown,
    options: Readonly<{args: unknown}>,
  ): Promise<Readonly<{rows: readonly unknown[]}>>;
}>;

export type ZerobugsDataAdapter = Readonly<{
  query<Name extends QueryName>(
    name: Name,
    args: QueryArgs<Name>,
  ): Promise<AdapterResult<QueryValue<Name>>>;
}>;

/** Imperative twin used by the headless window controller and acceptance. */
export function createZerobugsDataAdapter(client: QueryClient): ZerobugsDataAdapter {
  return Object.freeze({
    async query<Name extends QueryName>(name: Name, args: QueryArgs<Name>) {
      try {
        const response = await client.query(QUERY_REFS[name], {args});
        return deriveAdapterResult(name, {
          status: 'ready',
          data: response.rows,
          error: null,
          connection: 'live',
          freshness: 'current',
        });
      } catch (error) {
        return deriveAdapterResult(name, {
          status: 'error',
          error,
          connection: 'error',
          freshness: 'unknown',
        });
      }
    },
  });
}

type PageQueryName = {
  [Name in QueryName]: QueryValueMap[Name] extends Page<unknown, unknown> ? Name : never
}[QueryName];

/**
 * Manual bounded page assembly for catalog/preload consumers. Each frame is
 * accepted on its own proof; a non-page incomplete reason is surfaced rather
 * than converted into a plausible concatenated prefix.
 */
export async function collectPages<
  Name extends PageQueryName,
  Item,
  Cursor,
>(options: Readonly<{
  first: () => Promise<AdapterResult<Page<Item, Cursor>>>;
  next: (cursor: Cursor) => Promise<AdapterResult<Page<Item, Cursor>>>;
}>): Promise<AdapterResult<readonly Item[]>> {
  const items: Item[] = [];
  const seen = new Set<string>();
  let result = await options.first();
  for (;;) {
    if (result.status === 'refused' || result.status === 'pending'
      || result.status === 'refreshing' || result.status === 'not-found-authoritative') {
      return result as AdapterResult<readonly Item[]>;
    }
    for (const item of result.value.items) {
      const key = record(item, 'paged item').id;
      const identity = typeof key === 'string' ? key : JSON.stringify(item);
      if (seen.has(identity)) {
        return Object.freeze({
          status: 'refused',
          value: undefined,
          reason: null,
          connection: result.connection,
          freshness: 'unknown',
          refusal: Object.freeze({
            code: 'ZBUGS_ADAPTER_PAGE_DUPLICATE',
            message: `duplicate source identity ${identity}`,
            details: Object.freeze({identity}),
          }),
        });
      }
      seen.add(identity);
      items.push(item);
    }
    if (!result.value.hasMore) {
      if (result.status !== 'complete') {
        return Object.freeze({...result, value: Object.freeze(items)}) as AdapterResult<readonly Item[]>;
      }
      return Object.freeze({
        status: 'complete',
        value: Object.freeze(items),
        reason: null,
        connection: result.connection,
        freshness: 'current',
      });
    }
    if (result.reason !== 'page-limit' || result.value.cursor === null) {
      return Object.freeze({...result, value: Object.freeze(items)}) as AdapterResult<readonly Item[]>;
    }
    result = await options.next(result.value.cursor);
  }
}

export {QUERY_REFS};
