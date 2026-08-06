// @ref LLP 0183#d2--bounded-relational-graph-profile — every adapter value
// carries the server's completeness fact; missing children never become an
// inferred empty/complete relation.

export type ServerCompleteness =
  | 'complete'
  | 'incomplete'
  | 'refreshing'
  | 'not-found-authoritative';

export type AdapterResultStatus =
  | 'pending'
  | 'refreshing'
  | 'complete'
  | 'incomplete'
  | 'not-found-authoritative'
  | 'refused';

export type ConnectionFact =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'polling'
  | 'stale'
  | 'disconnected'
  | 'closed'
  | 'error';

export type FreshnessFact = 'unknown' | 'retained' | 'current';

export type Refusal = Readonly<{
  code: string;
  message: string;
  details: Readonly<Record<string, unknown>>;
}>;

type ResultBase = Readonly<{
  reason: string | null;
  connection: ConnectionFact;
  freshness: FreshnessFact;
}>;

export type AdapterResult<Value> =
  | (ResultBase & Readonly<{
      status: 'pending';
      value: undefined;
      reason: null;
      freshness: 'unknown';
    }>)
  | (ResultBase & Readonly<{
      status: 'refreshing';
      value: Value;
      serverStatus: ServerCompleteness;
    }>)
  | (ResultBase & Readonly<{
      status: 'complete' | 'incomplete';
      value: Value;
      freshness: 'current';
    }>)
  | (ResultBase & Readonly<{
      status: 'not-found-authoritative';
      value: null;
      freshness: 'current';
    }>)
  | (ResultBase & Readonly<{
      status: 'refused';
      value: undefined;
      refusal: Refusal;
      freshness: 'unknown';
    }>);

export type Role = 'crew' | 'user';
export type Visibility = 'internal' | 'public';
export type Direction = 'forward' | 'backward';
export type SortDirection = 'asc' | 'desc';
export type IssueSortField = 'created' | 'modified';

export type User = Readonly<{
  id: string;
  login: string;
  name?: string;
  avatar: string;
  role: Role;
}>;

export type Project = Readonly<{
  id: string;
  name: string;
  lowerCaseName: string;
  issueCountEstimate?: number;
  supportsSearch: boolean;
  markURL?: string;
  logoURL?: string;
}>;

export type Issue = Readonly<{
  id: string;
  shortID?: number;
  title: string;
  open: boolean;
  modified: number;
  created: number;
  projectID: string;
  creatorID: string;
  assigneeID?: string;
  description: string;
  visibility: Visibility;
}>;

export type Label = Readonly<{
  id: string;
  name: string;
  projectID: string;
}>;

export type IssueLabel = Readonly<{
  issueID: string;
  labelID: string;
  projectID: string;
}>;

export type ViewState = Readonly<{
  issueID: string;
  userID: string;
  viewed: number;
}>;

export type UserPreference = Readonly<{
  key: string;
  userID: string;
  value: string;
}>;

export type IssueNotification = Readonly<{
  userID: string;
  issueID: string;
  subscribed: boolean;
  created: number;
}>;

export type Emoji = Readonly<{
  id: string;
  value: string;
  annotation: string;
  subjectID: string;
  creatorID: string;
  created: number;
}>;

export type Comment = Readonly<{
  id: string;
  issueID: string;
  created: number;
  body: string;
  creatorID: string;
}>;

export type RichEmoji = Emoji & Readonly<{creator: User}>;

export type RichComment = Comment & Readonly<{
  creator: User;
  emoji: readonly RichEmoji[];
  completeness: Readonly<{emoji: ServerCompleteness}>;
}>;

export type ListIssue = Issue & Readonly<{
  labels: readonly Label[];
  viewState: ViewState | null;
  completeness: Readonly<{labels: ServerCompleteness}>;
}>;

export type PreloadedIssue = Issue & Readonly<{
  labels: readonly Label[];
  viewState: ViewState | null;
  creator: User;
  assignee: User | null;
  emoji: readonly RichEmoji[];
  comments: readonly RichComment[];
  commentsCursor: CommentCursor | null;
  completeness: Readonly<{
    labels: ServerCompleteness;
    emoji: ServerCompleteness;
    comments: ServerCompleteness;
  }>;
}>;

export type IssueDetail = Issue & Readonly<{
  project: Project;
  creator: User;
  assignee: User | null;
  labels: readonly Label[];
  notificationState: IssueNotification | null;
  viewState: ViewState | null;
  emoji: readonly RichEmoji[];
  comments: readonly RichComment[];
  commentsCursor: CommentCursor | null;
  completeness: Readonly<{
    labels: ServerCompleteness;
    emoji: ServerCompleteness;
    comments: ServerCompleteness;
  }>;
}>;

export type IssueCursor = Readonly<{
  id: string;
  created: number;
  modified: number;
}>;

export type CommentCursor = Readonly<{id: string; created: number}>;
export type UserCursor = Readonly<{id: string; login: string}>;
export type ProjectCursor = Readonly<{id: string; lowerCaseName: string}>;
export type LabelCursor = Readonly<{id: string; name: string; projectID: string}>;
export type EmojiCursor = Readonly<{id: string; created: number}>;

export type ListContext = Readonly<{
  open: boolean | null;
  projectName?: string;
  assignee: string | null;
  creator: string | null;
  labels: readonly string[] | null;
  textFilter: string | null;
  sortField: IssueSortField;
  sortDirection: SortDirection;
}>;

export type SearchEpoch = Readonly<{
  visibility: Visibility;
  epoch: number;
}>;

export type Page<Value, Cursor> = Readonly<{
  items: readonly Value[];
  hasMore: boolean;
  cursor: Cursor | null;
  examined: number;
  /** Exact only in the server frame's own requested interval. */
  total: number;
  searchEpoch?: readonly SearchEpoch[];
}>;

export type ChildCompleteness = Readonly<Record<string, ServerCompleteness>>;

export function isCurrentResult<Value>(
  result: AdapterResult<Value>,
): result is Extract<AdapterResult<Value>, {status: 'complete' | 'incomplete'}> {
  return result.status === 'complete' || result.status === 'incomplete';
}

