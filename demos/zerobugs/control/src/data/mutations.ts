import type {FunctionArgs} from '../../snapback/generated/api';
import {api} from '../../snapback/generated/api.mjs';

import type {
  Comment,
  Emoji,
  Issue,
  IssueLabel,
  IssueNotification,
  Label,
  Refusal,
  User,
  UserPreference,
  ViewState,
} from './types';

// @ref LLP 0107#optimistic-mutation-projection — projections below capture
// an intended visible outcome once and set it on every rebase; none toggles,
// increments, derives authority, or predicts effects.

export const MUTATION_REFS = {
  'issue.create': api.issueCreate,
  'issue.update': api.issueUpdate,
  'issue.delete': api.issueDelete,
  'issue.addLabel': api.issueAddLabel,
  'issue.removeLabel': api.issueRemoveLabel,
  'notification.update': api.notificationUpdate,
  'emoji.addToIssue': api.emojiAddToIssue,
  'emoji.addToComment': api.emojiAddToComment,
  'emoji.remove': api.emojiRemove,
  'comment.add': api.commentAdd,
  'comment.edit': api.commentEdit,
  'comment.remove': api.commentRemove,
  'label.create': api.labelCreate,
  'label.createAndAddToIssue': api.labelCreateAndAddToIssue,
  'viewState.set': api.viewStateSet,
  'userPref.set': api.userPrefSet,
} as const;

export type MutationName = keyof typeof MUTATION_REFS;
export type MutationArgs<Name extends MutationName> = FunctionArgs<(typeof MUTATION_REFS)[Name]>;

export type MutationResultEnvelope = Readonly<{
  mutator: string;
  outcome: 'applied';
  sourceID: string | null;
  rowID: string | null;
  issueID: string | null;
  intentID: string | null;
  intentKey: string | null;
  authoritativeTime: number | null;
}>;

export type PendingBranch =
  | 'authorization'
  | 'assignee-subscription'
  | 'cascade-settlement'
  | 'hidden-upsert-absence'
  | 'notification-effect'
  | 'protected-visibility'
  | 'search-repair'
  | 'server-only-label-create'
  | 'subscription-effect'
  | 'unproven-visible-parent'
  | 'incomplete-visible-collections';

export type VisibleFacts = Readonly<{
  issues: readonly Issue[];
  comments: readonly Comment[];
  labels: readonly Label[];
  issueLabels: readonly IssueLabel[];
  emoji: readonly Emoji[];
  notifications: readonly IssueNotification[];
  viewStates: readonly ViewState[];
  userPreferences: readonly UserPreference[];
}>;

export const EMPTY_VISIBLE_FACTS: VisibleFacts = Object.freeze({
  issues: Object.freeze([]),
  comments: Object.freeze([]),
  labels: Object.freeze([]),
  issueLabels: Object.freeze([]),
  emoji: Object.freeze([]),
  notifications: Object.freeze([]),
  viewStates: Object.freeze([]),
  userPreferences: Object.freeze([]),
});

export type ReducerContext = Readonly<{
  actor: User | null;
  defaultProjectID?: string;
  labelsComplete?: boolean;
  issueLabelsComplete?: boolean;
}>;

export type MutationProjection = Readonly<{
  presentation: 'pending' | 'reducer' | 'reducer-with-pending';
  pending: readonly PendingBranch[];
  apply(facts: VisibleFacts): VisibleFacts;
  authoritative(result: MutationResultEnvelope): MutationProjection;
  matches(facts: VisibleFacts): boolean;
}>;

export type MutationAttempt = Readonly<{
  id: string;
  name: MutationName;
  args: Readonly<Record<string, unknown>>;
  status: 'pending' | 'confirmed';
  projection: MutationProjection;
  result: MutationResultEnvelope | null;
}>;

export type MutationPresentation = Readonly<{
  facts: VisibleFacts;
  attempts: readonly MutationAttempt[];
  pending: readonly Readonly<{id: string; name: MutationName; branches: readonly PendingBranch[]}>[];
  refusal: Readonly<{id: string; name: MutationName; refusal: Refusal}> | null;
  correlations: Readonly<Record<string, string>>;
}>;

type AnyRecord = Record<string, unknown>;
const identity = (facts: VisibleFacts): VisibleFacts => facts;

function frozenFacts(next: VisibleFacts): VisibleFacts {
  return Object.freeze({
    issues: Object.freeze([...next.issues]),
    comments: Object.freeze([...next.comments]),
    labels: Object.freeze([...next.labels]),
    issueLabels: Object.freeze([...next.issueLabels]),
    emoji: Object.freeze([...next.emoji]),
    notifications: Object.freeze([...next.notifications]),
    viewStates: Object.freeze([...next.viewStates]),
    userPreferences: Object.freeze([...next.userPreferences]),
  });
}

function replaceBy<T>(
  rows: readonly T[],
  predicate: (row: T) => boolean,
  value: T,
): readonly T[] {
  let found = false;
  const next = rows.map(row => {
    if (!predicate(row)) return row;
    found = true;
    return value;
  });
  return found ? next : [...next, value];
}

function removeBy<T>(rows: readonly T[], predicate: (row: T) => boolean): readonly T[] {
  return rows.filter(row => !predicate(row));
}

function projection(options: Readonly<{
  pending?: readonly PendingBranch[];
  apply?: (facts: VisibleFacts) => VisibleFacts;
  matches?: (facts: VisibleFacts) => boolean;
  settle?: (result: MutationResultEnvelope) => MutationProjection;
}>): MutationProjection {
  const pending = Object.freeze([...(options.pending ?? [])]);
  const apply = options.apply ?? identity;
  return Object.freeze({
    presentation: apply === identity
      ? 'pending'
      : pending.length > 0 ? 'reducer-with-pending' : 'reducer',
    pending,
    apply,
    matches: options.matches ?? (() => false),
    authoritative: options.settle ?? (() => projection(options)),
  });
}

function visibleIssue(facts: VisibleFacts, id: string): Issue | undefined {
  return facts.issues.find(row => row.id === id);
}

function visibleComment(facts: VisibleFacts, id: string): Comment | undefined {
  return facts.comments.find(row => row.id === id);
}

function issueCreate(
  args: MutationArgs<'issue.create'>,
  context: ReducerContext,
): MutationProjection {
  if (!context.actor) return projection({pending: ['authorization']});
  const actor = context.actor;
  const projectID = args.projectID ?? context.defaultProjectID;
  if (!projectID) return projection({pending: ['unproven-visible-parent']});
  const initial: Issue = Object.freeze({
    id: args.id,
    title: args.title,
    open: true,
    modified: args.modified,
    created: args.created,
    projectID,
    creatorID: actor.id,
    description: args.description ?? '',
    visibility: 'public',
  });
  const make = (row: Issue): MutationProjection => projection({
    pending: ['subscription-effect', 'notification-effect'],
    apply: facts => frozenFacts({
      ...facts,
      issues: replaceBy(facts.issues, issue => issue.id === row.id, row),
    }),
    matches: facts => {
      const current = visibleIssue(facts, row.id);
      return current !== undefined
        && current.title === row.title
        && current.description === row.description
        && current.creatorID === row.creatorID
        && current.created === row.created
        && current.modified === row.modified;
    },
    settle: result => make(Object.freeze({
      ...row,
      ...(result.authoritativeTime === null
        ? {}
        : {created: result.authoritativeTime, modified: result.authoritativeTime}),
    })),
  });
  return make(initial);
}

function issueUpdate(
  args: MutationArgs<'issue.update'>,
  captured: VisibleFacts,
): MutationProjection {
  const previous = visibleIssue(captured, args.id);
  if (!previous) return projection({pending: ['unproven-visible-parent']});
  // assigneeID and visibility are deliberately excluded: both alter facts
  // whose safe membership/branch outcome remains server-owned.
  const intended = Object.freeze({
    ...(args.title === undefined ? {} : {title: args.title}),
    ...(args.description === undefined ? {} : {description: args.description}),
    ...(args.open === undefined ? {} : {open: args.open}),
    modified: args.modified,
  });
  const pending: PendingBranch[] = ['subscription-effect', 'notification-effect'];
  if (args.assigneeID !== undefined) pending.push('assignee-subscription');
  if (args.visibility !== undefined) pending.push('protected-visibility');
  const make = (patch: Partial<Issue>): MutationProjection => projection({
    pending,
    apply: facts => {
      const current = visibleIssue(facts, args.id);
      if (!current) return facts;
      const row = Object.freeze({...current, ...patch}) as Issue;
      return frozenFacts({
        ...facts,
        issues: replaceBy(facts.issues, issue => issue.id === args.id, row),
      });
    },
    matches: facts => {
      const row = visibleIssue(facts, args.id);
      return row !== undefined
        && Object.entries(patch).every(([key, value]) => row[key as keyof Issue] === value);
    },
    settle: result => make({
      ...patch,
      ...(result.authoritativeTime === null ? {} : {modified: result.authoritativeTime}),
    }),
  });
  return make(intended);
}

function issueDelete(args: MutationArgs<'issue.delete'>): MutationProjection {
  return projection({
    pending: ['cascade-settlement'],
    apply: facts => {
      const commentIDs = new Set(
        facts.comments.filter(row => row.issueID === args.id).map(row => row.id),
      );
      return frozenFacts({
        ...facts,
        issues: removeBy(facts.issues, row => row.id === args.id),
        comments: removeBy(facts.comments, row => row.issueID === args.id),
        issueLabels: removeBy(facts.issueLabels, row => row.issueID === args.id),
        emoji: removeBy(facts.emoji, row => row.subjectID === args.id || commentIDs.has(row.subjectID)),
        notifications: removeBy(facts.notifications, row => row.issueID === args.id),
        viewStates: removeBy(facts.viewStates, row => row.issueID === args.id),
      });
    },
    matches: facts => !visibleIssue(facts, args.id),
  });
}

function issueAddLabel(
  args: MutationArgs<'issue.addLabel'>,
  captured: VisibleFacts,
): MutationProjection {
  const issue = visibleIssue(captured, args.issueID);
  const label = captured.labels.find(row => row.id === args.labelID);
  if (!issue || !label || label.projectID !== issue.projectID
    || (args.projectID !== undefined && args.projectID !== issue.projectID)) {
    return projection({pending: ['unproven-visible-parent']});
  }
  const edge: IssueLabel = Object.freeze({
    issueID: args.issueID,
    labelID: args.labelID,
    projectID: args.projectID ?? issue.projectID,
  });
  return projection({
    pending: ['notification-effect'],
    apply: facts => frozenFacts({
      ...facts,
      issueLabels: replaceBy(
        facts.issueLabels,
        row => row.issueID === edge.issueID && row.labelID === edge.labelID,
        edge,
      ),
    }),
    matches: facts => facts.issueLabels.some(row => (
      row.issueID === edge.issueID && row.labelID === edge.labelID
    )),
  });
}

function issueRemoveLabel(args: MutationArgs<'issue.removeLabel'>): MutationProjection {
  return projection({
    pending: ['notification-effect'],
    apply: facts => frozenFacts({
      ...facts,
      issueLabels: removeBy(
        facts.issueLabels,
        row => row.issueID === args.issueID && row.labelID === args.labelID,
      ),
    }),
    matches: facts => !facts.issueLabels.some(row => (
      row.issueID === args.issueID && row.labelID === args.labelID
    )),
  });
}

function notificationUpdate(
  args: MutationArgs<'notification.update'>,
  captured: VisibleFacts,
  context: ReducerContext,
): MutationProjection {
  if (!context.actor) return projection({pending: ['authorization']});
  const existing = captured.notifications.find(row => (
    row.issueID === args.issueID && row.userID === context.actor?.id
  ));
  if (!existing) return projection({pending: ['hidden-upsert-absence']});
  const row: IssueNotification = Object.freeze({
    ...existing,
    subscribed: args.subscribed === 'subscribe',
    created: args.created,
  });
  return projection({
    apply: facts => frozenFacts({
      ...facts,
      notifications: replaceBy(
        facts.notifications,
        item => item.issueID === row.issueID && item.userID === row.userID,
        row,
      ),
    }),
    matches: facts => facts.notifications.some(item => (
      item.issueID === row.issueID
      && item.userID === row.userID
      && item.subscribed === row.subscribed
      && item.created === row.created
    )),
  });
}

function emojiAdd(
  name: 'emoji.addToIssue' | 'emoji.addToComment',
  args: MutationArgs<'emoji.addToIssue'>,
  captured: VisibleFacts,
  context: ReducerContext,
): MutationProjection {
  const parentVisible = name === 'emoji.addToIssue'
    ? visibleIssue(captured, args.subjectID) !== undefined
    : visibleComment(captured, args.subjectID) !== undefined;
  if (!context.actor || !parentVisible) {
    return projection({pending: ['unproven-visible-parent']});
  }
  const initial: Emoji = Object.freeze({
    id: args.id,
    value: args.unicode,
    annotation: args.annotation,
    subjectID: args.subjectID,
    creatorID: context.actor.id,
    created: args.created,
  });
  const make = (row: Emoji): MutationProjection => projection({
    pending: name === 'emoji.addToIssue'
      ? ['subscription-effect', 'notification-effect']
      : ['notification-effect'],
    apply: facts => frozenFacts({
      ...facts,
      emoji: replaceBy(facts.emoji, item => item.id === row.id, row),
    }),
    matches: facts => facts.emoji.some(item => (
      item.id === row.id
      && item.value === row.value
      && item.annotation === row.annotation
      && item.subjectID === row.subjectID
      && item.creatorID === row.creatorID
      && item.created === row.created
    )),
    settle: result => make(Object.freeze({
      ...row,
      ...(result.authoritativeTime === null ? {} : {created: result.authoritativeTime}),
    })),
  });
  return make(initial);
}

function emojiRemove(
  args: MutationArgs<'emoji.remove'>,
  captured: VisibleFacts,
  context: ReducerContext,
): MutationProjection {
  const visible = captured.emoji.find(row => row.id === args.id);
  if (!visible || !context.actor
    || (visible.creatorID !== context.actor.id && context.actor.role !== 'crew')) {
    return projection({pending: ['authorization']});
  }
  return projection({
    apply: facts => frozenFacts({
      ...facts,
      emoji: removeBy(facts.emoji, row => row.id === args.id),
    }),
    matches: facts => !facts.emoji.some(row => row.id === args.id),
  });
}

function commentAdd(
  args: MutationArgs<'comment.add'>,
  captured: VisibleFacts,
  context: ReducerContext,
): MutationProjection {
  if (!context.actor || !visibleIssue(captured, args.issueID)) {
    return projection({pending: ['unproven-visible-parent']});
  }
  const initial: Comment = Object.freeze({
    id: args.id,
    issueID: args.issueID,
    body: args.body,
    created: args.created,
    creatorID: context.actor.id,
  });
  const make = (row: Comment): MutationProjection => projection({
    pending: ['subscription-effect', 'notification-effect'],
    apply: facts => frozenFacts({
      ...facts,
      comments: replaceBy(facts.comments, item => item.id === row.id, row),
    }),
    matches: facts => facts.comments.some(item => (
      item.id === row.id
      && item.issueID === row.issueID
      && item.body === row.body
      && item.creatorID === row.creatorID
      && item.created === row.created
    )),
    settle: result => make(Object.freeze({
      ...row,
      ...(result.authoritativeTime === null ? {} : {created: result.authoritativeTime}),
    })),
  });
  return make(initial);
}

function commentEdit(
  args: MutationArgs<'comment.edit'>,
  captured: VisibleFacts,
): MutationProjection {
  if (!visibleComment(captured, args.id)) {
    return projection({pending: ['unproven-visible-parent']});
  }
  return projection({
    pending: ['notification-effect', 'search-repair'],
    apply: facts => {
      const current = visibleComment(facts, args.id);
      if (!current) return facts;
      return frozenFacts({
        ...facts,
        comments: replaceBy(
          facts.comments,
          row => row.id === args.id,
          Object.freeze({...current, body: args.body}),
        ),
      });
    },
    matches: facts => visibleComment(facts, args.id)?.body === args.body,
  });
}

function commentRemove(args: MutationArgs<'comment.remove'>): MutationProjection {
  return projection({
    pending: ['search-repair'],
    apply: facts => frozenFacts({
      ...facts,
      comments: removeBy(facts.comments, row => row.id === args.id),
      emoji: removeBy(facts.emoji, row => row.subjectID === args.id),
    }),
    matches: facts => !facts.comments.some(row => row.id === args.id),
  });
}

function labelCreateAndAdd(
  args: MutationArgs<'label.createAndAddToIssue'>,
  captured: VisibleFacts,
  context: ReducerContext,
): MutationProjection {
  const issue = visibleIssue(captured, args.issueID);
  if (!issue || !context.labelsComplete || !context.issueLabelsComplete
    || (args.projectID !== undefined && args.projectID !== issue.projectID)) {
    return projection({pending: ['incomplete-visible-collections']});
  }
  const label: Label = Object.freeze({
    id: args.labelID,
    name: args.labelName,
    projectID: args.projectID ?? issue.projectID,
  });
  const edge: IssueLabel = Object.freeze({
    issueID: args.issueID,
    labelID: args.labelID,
    projectID: label.projectID,
  });
  return projection({
    apply: facts => frozenFacts({
      ...facts,
      labels: replaceBy(facts.labels, row => row.id === label.id, label),
      issueLabels: replaceBy(
        facts.issueLabels,
        row => row.issueID === edge.issueID && row.labelID === edge.labelID,
        edge,
      ),
    }),
    matches: facts => facts.labels.some(row => row.id === label.id && row.name === label.name)
      && facts.issueLabels.some(row => row.issueID === edge.issueID && row.labelID === edge.labelID),
  });
}

function viewStateSet(
  args: MutationArgs<'viewState.set'>,
  context: ReducerContext,
): MutationProjection {
  if (!context.actor) return projection({pending: ['authorization']});
  const row: ViewState = Object.freeze({
    issueID: args.issueID,
    userID: context.actor.id,
    viewed: args.viewed,
  });
  return projection({
    apply: facts => frozenFacts({
      ...facts,
      viewStates: replaceBy(
        facts.viewStates,
        item => item.issueID === row.issueID && item.userID === row.userID,
        row,
      ),
    }),
    matches: facts => facts.viewStates.some(item => (
      item.issueID === row.issueID && item.userID === row.userID && item.viewed === row.viewed
    )),
  });
}

function userPrefSet(
  args: MutationArgs<'userPref.set'>,
  context: ReducerContext,
): MutationProjection {
  if (!context.actor) return projection({pending: ['authorization']});
  const row: UserPreference = Object.freeze({
    key: args.key,
    userID: context.actor.id,
    value: args.value,
  });
  return projection({
    apply: facts => frozenFacts({
      ...facts,
      userPreferences: replaceBy(
        facts.userPreferences,
        item => item.key === row.key && item.userID === row.userID,
        row,
      ),
    }),
    matches: facts => facts.userPreferences.some(item => (
      item.key === row.key && item.userID === row.userID && item.value === row.value
    )),
  });
}

export function captureMutationProjection<Name extends MutationName>(
  name: Name,
  args: MutationArgs<Name>,
  captured: VisibleFacts,
  context: ReducerContext,
): MutationProjection {
  switch (name) {
    case 'issue.create': return issueCreate(args as MutationArgs<'issue.create'>, context);
    case 'issue.update': return issueUpdate(args as MutationArgs<'issue.update'>, captured);
    case 'issue.delete': return issueDelete(args as MutationArgs<'issue.delete'>);
    case 'issue.addLabel': return issueAddLabel(args as MutationArgs<'issue.addLabel'>, captured);
    case 'issue.removeLabel': return issueRemoveLabel(args as MutationArgs<'issue.removeLabel'>);
    case 'notification.update': return notificationUpdate(
      args as MutationArgs<'notification.update'>,
      captured,
      context,
    );
    case 'emoji.addToIssue':
    case 'emoji.addToComment':
      return emojiAdd(name, args as MutationArgs<'emoji.addToIssue'>, captured, context);
    case 'emoji.remove': return emojiRemove(
      args as MutationArgs<'emoji.remove'>,
      captured,
      context,
    );
    case 'comment.add': return commentAdd(args as MutationArgs<'comment.add'>, captured, context);
    case 'comment.edit': return commentEdit(args as MutationArgs<'comment.edit'>, captured);
    case 'comment.remove': return commentRemove(args as MutationArgs<'comment.remove'>);
    case 'label.create': return projection({pending: ['server-only-label-create']});
    case 'label.createAndAddToIssue':
      return labelCreateAndAdd(args as MutationArgs<'label.createAndAddToIssue'>, captured, context);
    case 'viewState.set': return viewStateSet(args as MutationArgs<'viewState.set'>, context);
    case 'userPref.set': return userPrefSet(args as MutationArgs<'userPref.set'>, context);
  }
}

export const MUTATION_DISPOSITIONS: Readonly<Record<MutationName, Readonly<{
  reducer: boolean;
  serverOnlyBranches: readonly PendingBranch[];
}>>> = Object.freeze({
  'issue.create': {reducer: true, serverOnlyBranches: ['subscription-effect', 'notification-effect']},
  'issue.update': {reducer: true, serverOnlyBranches: ['assignee-subscription', 'protected-visibility', 'subscription-effect', 'notification-effect']},
  'issue.delete': {reducer: true, serverOnlyBranches: ['cascade-settlement']},
  'issue.addLabel': {reducer: true, serverOnlyBranches: ['notification-effect']},
  'issue.removeLabel': {reducer: true, serverOnlyBranches: ['notification-effect']},
  'notification.update': {reducer: true, serverOnlyBranches: ['hidden-upsert-absence']},
  'emoji.addToIssue': {reducer: true, serverOnlyBranches: ['subscription-effect', 'notification-effect']},
  'emoji.addToComment': {reducer: true, serverOnlyBranches: ['unproven-visible-parent', 'notification-effect']},
  'emoji.remove': {reducer: true, serverOnlyBranches: []},
  'comment.add': {reducer: true, serverOnlyBranches: ['subscription-effect', 'notification-effect']},
  'comment.edit': {reducer: true, serverOnlyBranches: ['notification-effect', 'search-repair']},
  'comment.remove': {reducer: true, serverOnlyBranches: ['search-repair']},
  'label.create': {reducer: false, serverOnlyBranches: ['server-only-label-create']},
  'label.createAndAddToIssue': {reducer: true, serverOnlyBranches: ['incomplete-visible-collections']},
  'viewState.set': {reducer: true, serverOnlyBranches: []},
  'userPref.set': {reducer: true, serverOnlyBranches: []},
});

export type MutationClient = Readonly<{
  mutate(
    reference: unknown,
    options: Readonly<{
      args: unknown;
      clientMutationId: string;
      queue: false;
    }>,
  ): Promise<Readonly<{result: unknown}>>;
}>;

function mutationResult(value: unknown): MutationResultEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ZBUGS_MUTATION_RESULT_REFUSED: result envelope must be an object');
  }
  const result = value as AnyRecord;
  if (result.outcome !== 'applied' || typeof result.mutator !== 'string') {
    throw new Error('ZBUGS_MUTATION_RESULT_REFUSED: result envelope is not applied');
  }
  for (const key of ['sourceID', 'rowID', 'issueID', 'intentID', 'intentKey'] as const) {
    if (result[key] !== null && typeof result[key] !== 'string') {
      throw new Error(`ZBUGS_MUTATION_RESULT_REFUSED: ${key} must be a string or null`);
    }
  }
  if (result.authoritativeTime !== null
    && (typeof result.authoritativeTime !== 'number'
      || !Number.isFinite(result.authoritativeTime))) {
    throw new Error('ZBUGS_MUTATION_RESULT_REFUSED: authoritativeTime must be finite or null');
  }
  return Object.freeze(result) as MutationResultEnvelope;
}

function refusalFrom(error: unknown): Refusal {
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    diagnostic?: {code?: unknown; message?: unknown; details?: unknown};
  } | null;
  const details = candidate?.diagnostic?.details;
  return Object.freeze({
    code: typeof candidate?.diagnostic?.code === 'string'
      ? candidate.diagnostic.code
      : typeof candidate?.code === 'string' ? candidate.code : 'ZBUGS_MUTATION_REFUSED',
    message: typeof candidate?.diagnostic?.message === 'string'
      ? candidate.diagnostic.message
      : typeof candidate?.message === 'string' ? candidate.message : String(error),
    details: details && typeof details === 'object' && !Array.isArray(details)
      ? Object.freeze({...details as AnyRecord})
      : Object.freeze({}),
  });
}

/**
 * Pure overlay/settlement ledger for the app-owned controller windows. HTTP
 * success confirms an attempt and applies rowID/time correlation, but only a
 * later authoritative graph adoption retires the visible layer.
 */
export class MutationPresentationController {
  #base: VisibleFacts;
  #attempts: MutationAttempt[] = [];
  #refusal: MutationPresentation['refusal'] = null;
  #correlations = new Map<string, string>();
  #listeners = new Set<() => void>();

  constructor(initial: VisibleFacts = EMPTY_VISIBLE_FACTS) {
    this.#base = frozenFacts(initial);
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }

  snapshot(): MutationPresentation {
    let facts = this.#base;
    for (const attempt of this.#attempts) facts = attempt.projection.apply(facts);
    const pending = this.#attempts
      .filter(attempt => attempt.projection.pending.length > 0)
      .map(attempt => Object.freeze({
        id: attempt.id,
        name: attempt.name,
        branches: attempt.projection.pending,
      }));
    return Object.freeze({
      facts,
      attempts: Object.freeze([...this.#attempts]),
      pending: Object.freeze(pending),
      refusal: this.#refusal,
      correlations: Object.freeze(Object.fromEntries(this.#correlations)),
    });
  }

  begin<Name extends MutationName>(
    id: string,
    name: Name,
    args: MutationArgs<Name>,
    context: ReducerContext,
  ): MutationAttempt {
    if (!id) throw new TypeError('clientMutationId must be non-empty');
    if (this.#attempts.some(attempt => attempt.id === id)) {
      throw new TypeError(`clientMutationId ${id} is already pending`);
    }
    const projection = captureMutationProjection(name, args, this.snapshot().facts, context);
    const attempt = Object.freeze({
      id,
      name,
      args: Object.freeze({...args as AnyRecord}),
      status: 'pending' as const,
      projection,
      result: null,
    });
    this.#attempts.push(attempt);
    this.#refusal = null;
    this.#emit();
    return attempt;
  }

  confirm(id: string, value: unknown): MutationResultEnvelope {
    const index = this.#attempts.findIndex(attempt => attempt.id === id);
    if (index < 0) throw new TypeError(`unknown mutation attempt ${id}`);
    const result = mutationResult(value);
    const previous = this.#attempts[index];
    if (result.mutator !== previous.name) {
      throw new Error(
        `ZBUGS_MUTATION_RESULT_REFUSED: expected ${previous.name}, received ${result.mutator}`,
      );
    }
    if (result.rowID && result.sourceID) this.#correlations.set(result.sourceID, result.rowID);
    this.#attempts[index] = Object.freeze({
      ...previous,
      status: 'confirmed',
      result,
      projection: previous.projection.authoritative(result),
    });
    this.#emit();
    return result;
  }

  refuse(id: string, error: unknown): Refusal {
    const index = this.#attempts.findIndex(attempt => attempt.id === id);
    if (index < 0) throw new TypeError(`unknown mutation attempt ${id}`);
    const [attempt] = this.#attempts.splice(index, 1);
    const refusal = refusalFrom(error);
    this.#refusal = Object.freeze({id, name: attempt.name, refusal});
    this.#emit();
    return refusal;
  }

  /** Replace the base from a validated subscription and retire only matches. */
  adoptAuthoritative(facts: VisibleFacts): void {
    this.#base = frozenFacts(facts);
    this.#attempts = this.#attempts.filter(attempt => (
      attempt.status !== 'confirmed' || !attempt.projection.matches(this.#base)
    ));
    this.#emit();
  }
}

export function createMutationAdapter(
  client: MutationClient,
  presentation = new MutationPresentationController(),
) {
  return Object.freeze({
    presentation,
    async invoke<Name extends MutationName>(options: Readonly<{
      name: Name;
      args: MutationArgs<Name>;
      clientMutationId: string;
      context: ReducerContext;
    }>): Promise<MutationResultEnvelope> {
      presentation.begin(
        options.clientMutationId,
        options.name,
        options.args,
        options.context,
      );
      try {
        const response = await client.mutate(MUTATION_REFS[options.name], {
          args: options.args,
          clientMutationId: options.clientMutationId,
          queue: false,
        });
        return presentation.confirm(options.clientMutationId, response.result);
      } catch (error) {
        presentation.refuse(options.clientMutationId, error);
        throw error;
      }
    },
  });
}
