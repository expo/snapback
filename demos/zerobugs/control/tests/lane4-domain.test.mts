import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNotificationRecipientSnapshot,
  nextIssueShortID,
  notificationPayload,
  planCommentDependentCleanup,
  planIssueDependentCleanup,
} from '../snapback/functions.mjs';
import {
  loadLane4Oracle,
  normalizedExpectedAudit,
  readModelRebuildDigest,
} from './lane4-oracle.mts';

test('notification payload and recipient selection are deterministic snapshots', () => {
  const issue = {
    _id: 'issue_runtime',
    id: 'issue-source',
    shortID: 4042,
    title: 'Intent is durable',
    description: 'before delivery',
    visibility: 'internal',
  };
  const actor = {
    _id: 'user_actor',
    id: 'actor-source',
    login: 'actor',
    role: 'user',
    email: 'actor@example.com',
  };
  const users = [
    actor,
    {_id: 'user_crew', id: 'crew-source', login: 'crew', role: 'crew', email: ' crew@example.com '},
    {_id: 'user_duplicate', id: 'crew-duplicate', login: 'dup', role: 'crew', email: 'crew@example.com'},
    {_id: 'user_ordinary', id: 'ordinary-source', login: 'ordinary', role: 'user', email: 'ordinary@example.com'},
    {_id: 'user_invalid', id: 'invalid-source', login: 'invalid', role: 'crew', email: 'not-an-email'},
  ];
  const subscriptions = users.map(user => ({
    userID: user._id,
    issueID: issue._id,
    subscribed: true,
  }));
  const recipients = buildNotificationRecipientSnapshot(
    issue,
    actor,
    false,
    subscriptions,
    users,
  );
  assert.deepEqual(recipients, {
    actorSourceUserID: 'actor-source',
    includeActor: false,
    issueVisibility: 'internal',
    issueShortID: 4042,
    recipients: [{sourceUserID: 'crew-source', email: 'crew@example.com'}],
    discordEligible: false,
  });
  assert.deepEqual(
    notificationPayload('edit-comment', actor, issue, {
      comment: {id: 'comment-source', body: 'corrected'},
    }),
    {
      kind: 'edit-comment',
      actor: {id: 'actor-source', login: 'actor'},
      issue: {
        id: 'issue-source',
        shortID: 4042,
        title: 'Intent is durable',
        description: 'before delivery',
        visibility: 'internal',
      },
      comment: {id: 'comment-source', body: 'corrected'},
    },
  );
});

test('dependent cleanup plans cover issue and comment subject emoji exactly', () => {
  const issue = {_id: 'issue_1'};
  const comments = [{_id: 'comment_1'}, {_id: 'comment_2'}];
  const joins = [{_id: 'join_1', labelID: 'label_1'}];
  const views = [{_id: 'view_1'}];
  const notifications = [{_id: 'notification_1'}];
  const emoji = [
    {_id: 'emoji_issue', subjectID: 'issue_1'},
    {_id: 'emoji_comment', subjectID: 'comment_2'},
    {_id: 'emoji_other', subjectID: 'issue_other'},
  ];
  assert.deepEqual(
    planIssueDependentCleanup(issue, comments, joins, views, notifications, emoji),
    {
      commentIDs: ['comment_1', 'comment_2'],
      emojiIDs: ['emoji_issue', 'emoji_comment'],
      issueLabels: [{id: 'join_1', labelID: 'label_1'}],
      viewStateIDs: ['view_1'],
      notificationIDs: ['notification_1'],
    },
  );
  assert.deepEqual(
    planCommentDependentCleanup(comments[1], emoji),
    {commentID: 'comment_2', emojiIDs: ['emoji_comment']},
  );
});

test('issue short-id allocation follows the source identity without sentinel drift', () => {
  assert.equal(nextIssueShortID([
    {shortID: 3_000},
    {shortID: 3_002},
    {shortID: 9_183_001},
    {shortID: null},
  ]), 3_001);
});

test('Lane 4 oracle rebuilds all four Lane 3 projections deterministically', async () => {
  const oracle = await loadLane4Oracle();
  assert.equal(nextIssueShortID(oracle.issues), 3_516);
  const audit = normalizedExpectedAudit(oracle);
  assert.equal((audit.projectUserRead as unknown[]).length, 12);
  assert.equal((audit.issueListRead as unknown[]).length, 517);
  assert.equal((audit.issueLabelRead as unknown[]).length, 603);
  assert.equal((audit.issueSearchDocument as unknown[]).length, 517);
  assert.match(readModelRebuildDigest(audit), /^sha256:[a-f0-9]{64}$/u);
  assert.equal(readModelRebuildDigest(audit), readModelRebuildDigest(normalizedExpectedAudit(oracle)));
});
