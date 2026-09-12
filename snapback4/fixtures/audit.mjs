import { readFileSync } from 'node:fs';
import { fixtureRoot, readJSON } from './grammar.mjs';
import { tables, logs, replayFiles } from './replay.mjs';

const count = (rows, predicate) => [...rows.values()].filter(predicate).length;
const tally = (ids, rows, field) => {
  const result = Object.fromEntries([...ids].map(id => [id, 0]));
  for (const row of rows.values()) result[row[field]] = (result[row[field]] ?? 0) + 1;
  return result;
};
export const tableCounts = state => Object.fromEntries(tables.map(table => [table, state[table].size]));

export function summarize(s) {
  const c = tableCounts(s);
  const perUserFollowingCounts = tally(s.users.keys(), s.follows, 'userId');
  const perUserConversationCounts = tally(s.users.keys(), s.memberships, 'userId');
  const perChatMessageCounts = tally(s.conversations.keys(), s.messages, 'conversationId');
  const memberCounts = tally(s.conversations.keys(), s.memberships, 'conversationId');
  const groupIds = [...s.conversations.values()].filter(row => row.kind === 'group').map(row => row.id);
  const following = [...s.follows.values()].filter(row => row.userId === 'u0901').map(row => row.targetUserId).sort();
  const members = [...s.memberships.values()].filter(row => row.conversationId === 'g0001').map(row => row.userId).sort();
  return {
    perEntityCounts: { users: c.users, profiles: c.profiles, followEdges: c.follows,
      posts: c.posts + c.replies, topLevelPosts: c.posts, replies: c.replies,
      activeLikes: c.likes, activeReposts: c.reposts, conversations: c.conversations,
      dms: c.conversations - groupIds.length, groups: groupIds.length, memberships: c.memberships,
      messages: c.messages, textMessages: count(s.messages, row => row.messageType === 'text'),
      mediaMessages: count(s.messages, row => row.messageType !== 'text'),
      quotedReplies: count(s.messages, row => row.quoteId !== null), activeReactions: c.reactions,
      disappearingSettingsEnabled: count(s.conversations, row => row.disappearing === true) },
    followEdgeCount: c.follows, perUserFollowingCounts, perUserConversationCounts, perChatMessageCounts,
    perGroupMemberCounts: Object.fromEntries(groupIds.map(id => [id, memberCounts[id]])),
    namedO5Fixtures: !s.users.has('u0500') ? null : {
      u0500: { followingCount: perUserFollowingCounts.u0500, conversationMembershipCount: perUserConversationCounts.u0500 },
      u0005: { followingCount: perUserFollowingCounts.u0005 },
      u0900: { followerCount: count(s.follows, row => row.targetUserId === 'u0900'),
        postCount: count(s.posts, row => row.authorId === 'u0900') },
      u0901: { followingCount: following.length, following },
      g0001: { memberCount: members.length, members, messageCount: perChatMessageCounts.g0001 }
    }
  };
}

export function spots(s, template) {
  return Object.fromEntries(Object.entries(template).map(([table, entities]) => [table,
    Object.fromEntries(Object.keys(entities).map(id => {
      let row = table === 'posts' ? s.post(id) : s[table].get(id);
      if (!row) return [id, null];
      if (table === 'posts') row = { ...row,
        activeLikeCount: count(s.likes, edge => edge.postId === id),
        activeRepostCount: count(s.reposts, edge => edge.postId === id),
        directReplyCount: count(s.replies, reply => reply.parentPostId === id) };
      if (table === 'messages') row = { ...row, media: row.media?.path ?? null,
        reactions: [...s.reactions.values()].filter(edge => edge.messageId === id).map(({ userId, emoji }) => ({ userId, emoji })) };
      if (table === 'conversations') row = { ...row, type: row.kind,
        members: [...s.memberships.values()].filter(edge => edge.conversationId === id).map(edge => edge.userId).sort(),
        messageCount: count(s.messages, message => message.conversationId === id) };
      return [id, row];
    }))]));
}

export function assertFacts(actual, expected, path = 'manifest') {
  const failures = [];
  const visit = (got, want, field) => {
    if (want !== null && typeof want === 'object' && got !== null && typeof got === 'object') {
      if (Array.isArray(want)) visit(got.length, want.length, `${field}.length`);
      for (const [key, value] of Object.entries(want)) visit(got[key], value, `${field}.${key}`);
    } else if (!Object.is(got, want)) failures.push(`${field}: expected ${JSON.stringify(want)}, actual ${JSON.stringify(got)}`);
  };
  visit(actual, expected, path);
  if (failures.length) throw new Error(failures.join('\n'));
}

function checkState(s, manifest, path) {
  assertFacts({ expectedState: summarize(s), namedSpotEntities: spots(s, manifest.namedSpotEntities) },
    { expectedState: manifest.expectedState, namedSpotEntities: manifest.namedSpotEntities }, path);
}

export function verifyFixtures() {
  const combined = readJSON('invariant-manifest-combined.json');
  const starter = readJSON('invariant-manifest-starter.json');
  const version = readFileSync(new URL('VERSION', fixtureRoot), 'utf8').trim();
  assertFacts(version, combined.schemaVersion, 'combined.schemaVersion');
  assertFacts(version, combined.generatedBy.generatorVersion, 'combined.generatedBy.generatorVersion');
  const first = replayFiles(logs.starter);
  assertFacts(first.artifacts, starter.artifacts, 'starter.artifacts');
  checkState(first.state, starter, 'starter');
  const seen = [];
  const full = replayFiles(logs.scale, { state: first.state, checkpoint(label, s, facts) {
    const expected = combined.checkpoints[label];
    if (!expected) throw new Error(`combined.checkpoints.${label}: expected absent, actual ${JSON.stringify(facts)}`);
    seen.push(label);
    assertFacts({ ...facts, expectedState: summarize(s), namedSpotEntities: spots(s, expected.namedSpotEntities) },
      expected, `combined.checkpoints.${label}`);
  } });
  assertFacts(seen, Object.keys(combined.checkpoints), 'combined.checkpoints.labels');
  checkState(full.state, combined, 'combined');
  const sample = replayFiles(logs.sample);
  assertFacts({ ...first.artifacts, ...full.artifacts, ...sample.artifacts }, combined.artifacts, 'combined.artifacts');
  return combined;
}

export function formatStats(state, log) {
  const summary = summarize(state);
  const largest = Object.entries(summary.perChatMessageCounts).sort(([a, x], [b, y]) =>
    y - x || (a < b ? -1 : a > b ? 1 : 0))[0];
  return [`log: ${log}`, ...Object.entries(tableCounts(state)).map(([table, value]) => `${table}: ${value}`),
    `u0001.memberships: ${summary.perUserConversationCounts.u0001 ?? 0}`,
    `u0500.follows: ${summary.perUserFollowingCounts.u0500 ?? 0}`,
    `text-sends: ${summary.perEntityCounts.textMessages}`, `media-sends: ${summary.perEntityCounts.mediaMessages}`,
    `largest-conversation: ${largest ? `${largest[0]} (${largest[1]} messages)` : 'none'}`,
    'manifest: PASS (combined + starter states, all spots, 10%/50% checkpoints, all log artifacts)', ''].join('\n');
}
