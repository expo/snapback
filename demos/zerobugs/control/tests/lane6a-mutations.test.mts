import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe, expect, test} from 'bun:test';

import {
  EMPTY_VISIBLE_FACTS,
  MUTATION_DISPOSITIONS,
  MUTATION_REFS,
  MutationPresentationController,
  captureMutationProjection,
  createMutationAdapter,
  type VisibleFacts,
} from '../src/data/mutations';
import type {Comment, Emoji, Issue, User} from '../src/data/types';

const fixtureRoot = resolve(import.meta.dirname, '../fixtures/normal-seed-v1');

async function rows(name: string): Promise<Record<string, unknown>[]> {
  return JSON.parse(await readFile(resolve(fixtureRoot, `${name}.json`), 'utf8'));
}

async function fixtureFacts(): Promise<{facts: VisibleFacts; actor: User; issue: Issue; comment: Comment}> {
  const [users, issues, comments, emoji] = await Promise.all([
    rows('user'), rows('issue'), rows('comment'), rows('emoji'),
  ]);
  const sourceUser = new Map(users.map(row => [row._id, row.id as string]));
  const sourceIssue = new Map(issues.map(row => [row._id, row.id as string]));
  const issueRow = issues.find(row => row.visibility === 'public')!;
  const commentRow = comments.find(row => row.issueID === issueRow._id) ?? comments[0];
  const actorRow = users.find(row => row._id === issueRow.creatorID)!;
  const actor = {
    id: actorRow.id as string,
    login: actorRow.login as string,
    name: actorRow.name as string | undefined,
    avatar: actorRow.avatar as string,
    role: actorRow.role as 'crew' | 'user',
  } satisfies User;
  const issue = {
    id: issueRow.id as string,
    shortID: issueRow.shortID as number | undefined,
    title: issueRow.title as string,
    open: issueRow.open as boolean,
    modified: issueRow.modified as number,
    created: issueRow.created as number,
    projectID: issueRow.projectID as string,
    creatorID: sourceUser.get(issueRow.creatorID)!,
    ...(issueRow.assigneeID ? {assigneeID: sourceUser.get(issueRow.assigneeID)!} : {}),
    description: issueRow.description as string,
    visibility: issueRow.visibility as 'internal' | 'public',
  } satisfies Issue;
  const comment = {
    id: commentRow.id as string,
    issueID: sourceIssue.get(commentRow.issueID)!,
    created: commentRow.created as number,
    body: commentRow.body as string,
    creatorID: sourceUser.get(commentRow.creatorID)!,
  } satisfies Comment;
  const visibleEmoji = emoji.slice(0, 2).map(row => ({
    id: row.id as string,
    value: row.value as string,
    annotation: row.annotation as string,
    subjectID: sourceIssue.get(row.subjectID) ?? (row.subjectID as string),
    creatorID: sourceUser.get(row.creatorID)!,
    created: row.created as number,
  } satisfies Emoji));
  return {
    actor,
    issue,
    comment,
    facts: {
      ...EMPTY_VISIBLE_FACTS,
      issues: [issue],
      comments: [comment],
      emoji: visibleEmoji,
    },
  };
}

const envelope = (overrides: Record<string, unknown> = {}) => ({
  mutator: 'issue.update',
  outcome: 'applied' as const,
  sourceID: 'source-issue',
  rowID: 'id_physical-row',
  issueID: 'source-issue',
  intentID: null,
  intentKey: null,
  authoritativeTime: 9001,
  ...overrides,
});

describe('Lane 6a mutation presentation', () => {
  test('declares all 16 generated mutations and exact reducer/server-only dispositions', () => {
    expect(Object.keys(MUTATION_REFS).sort()).toEqual(Object.keys(MUTATION_DISPOSITIONS).sort());
    expect(Object.keys(MUTATION_REFS)).toHaveLength(16);
    expect(MUTATION_DISPOSITIONS['label.create'].reducer).toBe(false);
    expect(MUTATION_DISPOSITIONS['issue.update'].serverOnlyBranches).toContain('protected-visibility');
    expect(MUTATION_DISPOSITIONS['notification.update'].serverOnlyBranches).toContain('hidden-upsert-absence');
  });

  test('capture-and-set paints visible fields, never protected fields, and settles on Lane 4 facts', async () => {
    const {facts, actor, issue} = await fixtureFacts();
    const controller = new MutationPresentationController(facts);
    controller.begin('cmid-update', 'issue.update', {
      id: issue.id,
      title: 'captured title',
      modified: 8000,
      visibility: 'internal',
      assigneeID: 'hidden-assignee',
    }, {actor});
    let snapshot = controller.snapshot();
    expect(snapshot.facts.issues[0]?.title).toBe('captured title');
    expect(snapshot.facts.issues[0]?.visibility).toBe(issue.visibility);
    expect(snapshot.facts.issues[0]?.assigneeID).toBe(issue.assigneeID);
    expect(snapshot.pending[0]?.branches).toContain('protected-visibility');
    expect(snapshot.pending[0]?.branches).toContain('assignee-subscription');

    controller.adoptAuthoritative({...facts, issues: [{...issue, title: 'concurrent base'}]});
    expect(controller.snapshot().facts.issues[0]?.title).toBe('captured title');

    controller.confirm('cmid-update', envelope({sourceID: issue.id, issueID: issue.id}));
    snapshot = controller.snapshot();
    expect(snapshot.facts.issues[0]?.modified).toBe(9001);
    expect(snapshot.attempts[0]?.status).toBe('confirmed');
    expect(snapshot.correlations[issue.id]).toBe('id_physical-row');

    controller.adoptAuthoritative({
      ...facts,
      issues: [{...issue, title: 'captured title', modified: 9001}],
    });
    expect(controller.snapshot().attempts).toHaveLength(0);
  });

  test('refusal drops the rejected layer, rebases survivors, and surfaces the refusal', async () => {
    const {facts, actor, issue} = await fixtureFacts();
    const controller = new MutationPresentationController(facts);
    controller.begin('cmid-rejected', 'issue.update', {
      id: issue.id, title: 'must disappear', modified: 8000,
    }, {actor});
    expect(controller.snapshot().facts.issues[0]?.title).toBe('must disappear');
    controller.refuse('cmid-rejected', {
      diagnostic: {code: 'SNAPBACK_AUTHORIZATION_REFUSED', message: 'not owner'},
    });
    const snapshot = controller.snapshot();
    expect(snapshot.facts.issues[0]?.title).toBe(issue.title);
    expect(snapshot.attempts).toHaveLength(0);
    expect(snapshot.refusal?.refusal.code).toBe('SNAPBACK_AUTHORIZATION_REFUSED');
  });

  test('hidden absence and incomplete collections stay honest pending facts', async () => {
    const {facts, actor, issue} = await fixtureFacts();
    const notification = captureMutationProjection(
      'notification.update',
      {issueID: issue.id, subscribed: 'subscribe', created: 1},
      facts,
      {actor},
    );
    expect(notification.presentation).toBe('pending');
    expect(notification.pending).toEqual(['hidden-upsert-absence']);
    expect(notification.apply(facts)).toBe(facts);

    const label = captureMutationProjection(
      'label.createAndAddToIssue',
      {issueID: issue.id, labelID: 'label-new', labelName: 'new'},
      facts,
      {actor, labelsComplete: false, issueLabelsComplete: true},
    );
    expect(label.presentation).toBe('pending');
    expect(label.pending).toEqual(['incomplete-visible-collections']);
  });

  test('adapter forwards clientMutationId and reconciles result envelopes', async () => {
    const {facts, actor, issue} = await fixtureFacts();
    let seen: Record<string, unknown> | null = null;
    const adapter = createMutationAdapter({
      async mutate(_reference, options) {
        seen = options as unknown as Record<string, unknown>;
        return {result: envelope({sourceID: issue.id, issueID: issue.id})};
      },
    }, new MutationPresentationController(facts));
    await adapter.invoke({
      name: 'issue.update',
      args: {id: issue.id, title: 'server', modified: 8},
      clientMutationId: 'cmid-forwarded',
      context: {actor},
    });
    expect(seen?.clientMutationId).toBe('cmid-forwarded');
    expect(seen?.queue).toBe(false);
    expect(adapter.presentation.snapshot().attempts[0]?.status).toBe('confirmed');
  });
});
