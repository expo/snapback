import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import api from '../snapback/generated/api.mjs';
import { anonymousClient, mutate as directMutate, query as directQuery, sessionClient } from './client.mjs';

const credentials = {
  alice: ['alice@example.com', 'Alice!Clique2026'], bob: ['bob@example.com', 'Bob!Clique2026'],
  carol: ['carol@example.com', 'Carol!Clique2026'], dave: ['dave@example.com', 'Dave!Clique2026'],
  erin: ['erin@example.com', 'Erin!Clique2026'], frank: ['frank@example.com', 'Frank!Clique2026'],
  grace: ['grace@example.com', 'Grace!Clique2026'], henry: ['henry@example.com', 'Henry!Clique2026'],
};
const milestoneIndex = process.argv.indexOf('--milestone');
const milestone = milestoneIndex >= 0 ? process.argv[milestoneIndex + 1] : null;
if (!/^m(?:[1-6]|8)$/u.test(milestone ?? '')) throw new Error('usage: npm run acceptance -- --milestone m1|m2|m3|m4|m5|m6|m8');

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('../src/CliqueApp.tsx', import.meta.url), 'utf8');
const uiLinkify = readFileSync(new URL('../node_modules/@snapback-bench/social-ui/src/linkify.tsx', import.meta.url), 'utf8');
const uiSearch = readFileSync(new URL('../node_modules/@snapback-bench/social-ui/src/SearchBar.tsx', import.meta.url), 'utf8');
const expectedIds = JSON.parse(readFileSync(new URL('../instrument/schema/social-messenger/assertions.json', import.meta.url), 'utf8'))
  .milestones[milestone.toUpperCase()].assertions.filter((row) => row.executor === 'suite-required').map((row) => row.id);
const checks = [];
let firstFailure = null;
const check = async (id, body) => {
  const startedAt = Date.now();
  try {
    const details = await body();
    checks.push({ id, pass: true, startedAt, completedAt: Date.now(), details: details ?? null });
  } catch (error) {
    firstFailure ??= error;
    checks.push({ id, pass: false, startedAt, completedAt: Date.now(), details: null, failure: String(error.stack ?? error) });
  }
};
let activeActor = null;
let activeActorClient = null;
const activate = async (actor) => {
  if (activeActor === actor && activeActorClient) return activeActorClient;
  await activeActorClient?.dispose();
  const [email, password] = credentials[actor];
  activeActorClient = await sessionClient({ email, password, databaseName: `acceptance-${milestone}-${actor}-${Date.now()}` });
  activeActor = actor;
  return activeActorClient;
};
const openActors = async (...actors) => Object.fromEntries(actors.map((actor) => [actor, { actor }]));
const disposeActors = async () => { await activeActorClient?.dispose(); activeActorClient = null; activeActor = null; };
const query = async (subject, ref, args = {}) => directQuery(subject?.actor ? await activate(subject.actor) : subject, ref, args);
const mutate = async (subject, ref, args, clientMutationId) => directMutate(subject?.actor ? await activate(subject.actor) : subject, ref, args, clientMutationId);
const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
const id = (prefix) => `${prefix}-${suffix}`;
const rejected = async (promise, pattern) => {
  let message = '';
  try { await promise; } catch (error) { message = String(error?.message ?? error); }
  assert.match(message, pattern);
  return message;
};

const replay = spawnSync(process.execPath, ['scripts/replay.mjs'], { cwd: root, encoding: 'utf8', timeout: 180000 });
const replayReceipt = JSON.parse(readFileSync(new URL('../receipts/replay.json', import.meta.url), 'utf8'));
if (replay.status !== 0 || !replayReceipt.ok) firstFailure = new Error(`starter replay failed before ${milestone}: ${replay.stderr || replayReceipt.failure}`);

try {
  if (milestone === 'm1') {
    const email = `suite-${suffix}@example.com`; const password = 'Suite!Clique2026'; const handle = `s${suffix}`.slice(0, 20).toLowerCase();
    const user = await sessionClient({ email, password, signup: true, databaseName: `acceptance-m1-new-${suffix}` });
    await check('m1-a01', async () => { assert.equal(user.auth.currentPrincipal().status, 'authenticated'); return { email, passwordLength: password.length, path: 'built-in-password-signup' }; });
    await check('m1-a02', async () => { const principal = user.auth.currentPrincipal(); assert.equal(principal.status, 'authenticated'); assert(principal.userId); return { principalStatus: principal.status }; });
    await mutate(user, api.upsertProfile, { email, handle, displayName: 'Suite Member', bio: 'Before edit', location: 'Berlin', link: 'https://example.com/suite', avatarUri: 'fixture:avatar-alice' });
    await check('m1-a08', async () => {
      await mutate(user, api.upsertProfile, { email, handle, displayName: 'Suite Member Edited', bio: 'Edited bio persists', location: 'Berlin', link: 'https://example.com/suite', avatarUri: 'fixture:avatar-alice' });
      const profile = (await query(user, api.myProfile))[0]; assert.equal(profile.displayName, 'Suite Member Edited'); assert.equal(profile.bio, 'Edited bio persists'); return { ownerId: profile.ownerId, displayName: profile.displayName, bio: profile.bio };
    });
    await check('m1-a10', async () => { const profile = (await query(user, api.myProfile))[0]; assert.equal(profile.avatarUri, 'fixture:avatar-alice'); return { avatarUri: profile.avatarUri, fixtureUploadPath: true }; });
    await check('m1-a11', async () => { const profile = (await query(user, api.profileByHandle, { handle }))[0]; assert.equal(profile.avatarUri, 'fixture:avatar-alice'); assert.match(source, /avatarUri\s*\?/u); return { renderedAvatarReference: profile.avatarUri }; });
    await user.dispose();
    const duplicateHandleEmail = `suite-other-${suffix}@example.com`;
    const duplicateHandleUser = await sessionClient({ email: duplicateHandleEmail, password, signup: true, databaseName: `acceptance-m1-handle-${suffix}` });
    await check('m1-a03', async () => {
      const message = await rejected(mutate(duplicateHandleUser, api.upsertProfile, { email: duplicateHandleEmail, handle, displayName: 'Duplicate', bio: '', location: '', link: '', avatarUri: '' }), /HANDLE_TAKEN/u);
      assert.match(source, /errorText=\{error\}/u); return { rejected: message, visibleErrorSurface: true };
    });
    await duplicateHandleUser.dispose();
    await check('m1-a04', async () => {
      const anonymous = await anonymousClient(`acceptance-m1-email-${suffix}`);
      try {
        if (anonymous.auth.currentPrincipal().status === 'authenticated') await anonymous.auth.signOut();
        const message = await rejected(anonymous.auth.signUpWithPassword({ email, password: 'Other!Clique2026' }), /EMAIL|IDENTIFIER|ACCOUNT|already|exists|taken|credential|CONFLICT/iu);
        return { rejected: message, visibleErrorSurface: source.includes('errorText={error}') };
      } finally { await anonymous.dispose(); }
    });
  }

  if (milestone === 'm2') {
    const c = await openActors('alice', 'bob', 'carol', 'dave');
    try {
      const profiles = await query(c.alice, api.publicProfiles); const byHandle = new Map(profiles.map((p) => [p.handle, p]));
      const textId = id('suite-text'); const imageId = id('suite-images'); const videoId = id('suite-video');
      await mutate(c.alice, api.createPost, { externalId: textId, type: 'text', text: 'Suite text https://example.com/clique', mediaUri1: '', mediaUri2: '', parentExternalId: '' });
      await mutate(c.alice, api.createPost, { externalId: imageId, type: 'image', text: 'Two fixture images', mediaUri1: 'fixture:img-01', mediaUri2: 'fixture:img-02', parentExternalId: '' });
      await mutate(c.alice, api.createPost, { externalId: videoId, type: 'video', text: 'Fixture video', mediaUri1: 'fixture:vid-01', mediaUri2: '', parentExternalId: '' });
      const global = await query(c.bob, api.globalPosts);
      await check('m2-a01', () => { const row = global.find((p) => p.externalId === textId); assert.equal(row.type, 'text'); return { externalId: row.externalId }; });
      await check('m2-a02', () => { const row = global.find((p) => p.externalId === imageId); assert.equal(row.mediaUri1, 'fixture:img-01'); assert.equal(row.mediaUri2, 'fixture:img-02'); return { externalId: row.externalId, media: [row.mediaUri1, row.mediaUri2] }; });
      await check('m2-a03', () => { const row = global.find((p) => p.externalId === videoId); assert.equal(row.mediaUri1, 'fixture:vid-01'); return { externalId: row.externalId, media: row.mediaUri1 }; });
      await mutate(c.bob, api.setFollow, { targetHandle: 'alice', state: 'set', mutationId: id('follow-alice') });
      await check('m2-a06', async () => { const feed = await query(c.bob, api.followingFeed); assert(feed.some((e) => e.postExternalId === textId)); return { followed: 'alice', projectedPost: textId }; });
      await mutate(c.bob, api.setFollow, { targetHandle: 'alice', state: 'clear', mutationId: id('unfollow-alice') });
      await check('m2-a08', async () => { const feed = await query(c.bob, api.followingFeed); assert(!feed.some((e) => [textId, imageId, videoId].includes(e.postExternalId) && !e.repostedById)); return { absentDirectPosts: [textId, imageId, videoId] }; });
      await check('m2-a09', async () => { const posts = await query(c.bob, api.globalPosts); assert(posts.some((p) => p.externalId === textId)); return { globalStillContains: textId }; });
      const carolId = id('suite-carol-global'); await mutate(c.carol, api.createPost, { externalId: carolId, type: 'text', text: 'Carol global only', mediaUri1: '', mediaUri2: '', parentExternalId: '' });
      await check('m2-a10', async () => { assert((await query(c.bob, api.globalPosts)).some((p) => p.externalId === carolId)); return { globalPost: carolId, author: 'carol' }; });
      await check('m2-a11', async () => { assert(!(await query(c.bob, api.followingFeed)).some((e) => e.postExternalId === carolId)); return { absentFromFollowing: carolId }; });
      await check('m2-a12', () => { assert.match(uiLinkify, /accessibilityRole="link"/u); assert.match(source, /Linking\.openURL/u); return { detectedScheme: 'https', role: 'link', opener: 'Linking.openURL' }; });
      await check('m2-a13', () => { assert.match(uiLinkify, /no unfurling, no previews/u); assert(!/previewCard|unfurl/iu.test(source)); return { previewCard: false }; });
      const beforeLike = (await query(c.bob, api.globalPosts)).find((p) => p.externalId === textId).likeCount;
      await mutate(c.bob, api.setPostLike, { postExternalId: textId, state: 'set', mutationId: id('like-set') });
      await mutate(c.bob, api.setPostLike, { postExternalId: textId, state: 'clear', mutationId: id('like-clear') });
      await check('m2-a15', async () => { const row = (await query(c.bob, api.globalPosts)).find((p) => p.externalId === textId); assert.equal(row.likeCount, beforeLike); assert(!(await query(c.bob, api.allPostLikes)).some((e) => e.postExternalId === textId && e.userId === byHandle.get('bob').ownerId)); return { beforeLike, afterUnlike: row.likeCount }; });
      await mutate(c.dave, api.setFollow, { targetHandle: 'bob', state: 'set', mutationId: id('dave-follows-bob') });
      await mutate(c.bob, api.setRepost, { postExternalId: textId, state: 'set', mutationId: id('repost-set') });
      await check('m2-a16', async () => { const row = (await query(c.alice, api.allReposts)).find((e) => e.postExternalId === textId && e.userHandle === 'bob'); assert.equal(row.userName, byHandle.get('bob').displayName); return { repostedBy: row.userName, handle: row.userHandle }; });
      await check('m2-a18', async () => { const feed = await query(c.dave, api.followingFeed); const row = feed.find((e) => e.postExternalId === textId && e.repostedById === byHandle.get('bob').ownerId); assert(row); return { follower: 'dave', originalPost: textId, reposter: 'bob' }; });
      await mutate(c.bob, api.setRepost, { postExternalId: textId, state: 'clear', mutationId: id('repost-clear') });
      await check('m2-a17', async () => { assert(!(await query(c.alice, api.allReposts)).some((e) => e.postExternalId === textId && e.userId === byHandle.get('bob').ownerId)); return { cleared: true }; });
      const parentId = id('suite-thread'); const reply1 = id('suite-reply-1'); const reply2 = id('suite-reply-2');
      await mutate(c.alice, api.createPost, { externalId: parentId, type: 'text', text: 'Suite thread parent', mediaUri1: '', mediaUri2: '', parentExternalId: '' });
      await mutate(c.bob, api.createPost, { externalId: reply1, type: 'text', text: 'First direct reply', mediaUri1: '', mediaUri2: '', parentExternalId: parentId });
      await mutate(c.carol, api.createPost, { externalId: reply2, type: 'text', text: 'Second direct reply', mediaUri1: '', mediaUri2: '', parentExternalId: parentId });
      await check('m2-a20', async () => { const rows = (await query(c.alice, api.globalPosts)).filter((p) => p.parentExternalId === parentId).sort((a, b) => a.pageKey.localeCompare(b.pageKey)); assert.deepEqual(rows.map((p) => p.externalId), [reply1, reply2]); assert.match(source, /\[parent, \.\.\.allPosts\.filter/u); return { parentId, replies: rows.map((p) => p.externalId) }; });
      await check('m2-a21', async () => { const feed = await query(c.bob, api.followingFeed); assert(!feed.some((e) => [reply1, reply2].includes(e.postExternalId))); assert.match(source, /allPosts\.filter\(\(p: any\) => !p\.isReply\)/u); return { absentReplyIds: [reply1, reply2] }; });
      for (const profile of profiles.filter((p) => p.handle !== 'bob')) await mutate(c.bob, api.setFollow, { targetHandle: profile.handle, state: 'set', mutationId: id(`page-follow-${profile.handle}`) });
      const followingForPages = await query(c.bob, api.followingFeed); const globalForPages = await query(c.bob, api.globalPosts);
      await check('m2-a22', () => { assert(followingForPages.length > 20); assert.match(source, /useState\(20\)/u); assert.match(source, /count \+ 20/u); return { totalEntries: followingForPages.length, pageSize: 20, nextPageTrigger: 'scroll threshold' }; });
      await check('m2-a23', () => { assert(globalForPages.filter((p) => !p.isReply).length > 20); assert.match(source, /list\.slice\(0, visibleCount\)/u); return { totalGlobalPosts: globalForPages.filter((p) => !p.isReply).length, pageSize: 20 }; });
      await check('m2-a24', () => { const globalIds = globalForPages.filter((p) => !p.isReply).map((p) => p.externalId); const feedKeys = followingForPages.map((e) => e.entryKey); assert.equal(new Set(globalIds).size, globalIds.length); assert.equal(new Set(feedKeys).size, feedKeys.length); return { globalUnique: globalIds.length, followingUnique: feedKeys.length, pageExpansion: 'stable prefix slice' }; });
      const bobEdges = (await query(c.bob, api.publicFollows)).filter((e) => e.followerId === byHandle.get('bob').ownerId);
      for (const edge of bobEdges) await mutate(c.bob, api.setFollow, { targetHandle: edge.followeeHandle, state: 'clear', mutationId: id(`self-clear-${edge.followeeHandle}`) });
      const bobPost = id('suite-bob-own'); await mutate(c.bob, api.createPost, { externalId: bobPost, type: 'text', text: 'Bob own implicit feed post', mediaUri1: '', mediaUri2: '', parentExternalId: '' });
      await check('m2-a25', async () => { const feed = await query(c.bob, api.followingFeed); assert(feed.some((e) => e.postExternalId === bobPost)); assert(!(await query(c.bob, api.publicFollows)).some((e) => e.followerId === byHandle.get('bob').ownerId)); return { ownPost: bobPost, explicitSelfEdge: false }; });
      await mutate(c.bob, api.setRepost, { postExternalId: carolId, state: 'set', mutationId: id('self-repost') });
      await check('m2-a26', async () => { const feed = await query(c.bob, api.followingFeed); assert(feed.some((e) => e.postExternalId === carolId && e.repostedById === byHandle.get('bob').ownerId)); return { ownRepostOf: carolId }; });
      await check('m2-a27', async () => { const allEdges = await query(c.bob, api.publicFollows); const bob = (await query(c.bob, api.profileByHandle, { handle: 'bob' }))[0]; assert.equal(bob.followingCount, allEdges.filter((e) => e.followerId === bob.ownerId).length); assert.equal(bob.followerCount, allEdges.filter((e) => e.followeeId === bob.ownerId).length); assert(!allEdges.some((e) => e.followerId === bob.ownerId && e.followeeId === bob.ownerId)); return { followerCount: bob.followerCount, followingCount: bob.followingCount, explicitSelfEdge: false }; });
    } finally { await disposeActors(c); }
  }

  if (milestone === 'm3') {
    const c = await openActors('alice', 'bob');
    try {
      const dm1 = await mutate(c.alice, api.ensureDm, { otherHandle: 'bob' }); const dm2 = await mutate(c.alice, api.ensureDm, { otherHandle: 'bob' });
      await check('m3-a03', () => { assert.equal(dm1, dm2); return { first: dm1, second: dm2 }; });
      const group1 = id('suite-group-one'); const group2 = id('suite-group-two');
      await mutate(c.alice, api.createGroup, { externalId: group1, name: 'Suite Trio One', description: 'First same-member group', memberHandles: ['bob', 'carol'] });
      await check('m3-a04', async () => { const members = await query(c.alice, api.membershipsForConversation, { conversationExternalId: group1 }); assert.deepEqual(new Set(members.filter((m) => m.active).map((m) => m.userHandle)), new Set(['alice', 'bob', 'carol'])); return { group: group1, members: members.map((m) => m.userHandle) }; });
      await mutate(c.alice, api.createGroup, { externalId: group2, name: 'Suite Trio Two', description: 'Second same-member group', memberHandles: ['bob', 'carol'] });
      await check('m3-a05', async () => { assert.notEqual(group1, group2); const inbox = await query(c.alice, api.myInbox); assert(inbox.some((r) => r.conversationExternalId === group1)); assert(inbox.some((r) => r.conversationExternalId === group2)); return { groups: [group1, group2] }; });
      const original = id('suite-quote-original'); const reply = id('suite-quote-reply');
      await mutate(c.alice, api.sendMessage, { externalId: original, conversationExternalId: dm1, text: 'Quoted source excerpt', mediaUri: '', mediaKind: '', viewOnce: false, replyToExternalId: '' });
      await mutate(c.bob, api.sendMessage, { externalId: reply, conversationExternalId: dm1, text: 'Quoted response', mediaUri: '', mediaKind: '', viewOnce: false, replyToExternalId: original });
      await check('m3-a10', async () => { const row = (await query(c.alice, api.messagesForConversation, { conversationExternalId: dm1 })).find((m) => m.externalId === reply); assert.equal(row.replyToExternalId, original); assert.equal(row.replyExcerpt, 'Quoted source excerpt'); return { reply, quoted: original, excerpt: row.replyExcerpt }; });
      await check('m3-a11', () => { assert.match(source, /scrollIntoView\(\{ behavior: 'smooth' \}\)/u); assert.match(source, /data-message-id/u); return { interaction: 'quote preview scrollIntoView target' }; });
      await check('m3-a14', async () => { const message = await rejected(mutate(c.bob, api.changeMember, { conversationExternalId: group1, targetHandle: 'carol', action: 'remove', mutationId: id('non-admin-remove') }), /ADMIN_REQUIRED/u); return { rejected: message, actor: 'bob', role: 'member' }; });
      await check('m3-a15', async () => { assert.equal(replayReceipt.actionCount, 87); const posts = await query(c.alice, api.globalPosts); const inbox = await query(c.alice, api.myInbox); const messages = await query(c.alice, api.messagesForConversation, { conversationExternalId: 'g-starter' }); assert.equal(new Set(posts.map((p) => p.externalId)).size, posts.length); assert.equal(new Set(inbox.map((r) => r.inboxKey)).size, inbox.length); assert.equal(new Set(messages.map((m) => m.externalId)).size, messages.length); return { replayedActions: replayReceipt.actionCount, uniquePostIds: posts.length, uniqueInboxKeys: inbox.length, uniqueStarterGroupMessageIds: messages.length }; });
    } finally { await disposeActors(c); }
  }

  if (milestone === 'm4') {
    const c = await openActors('alice', 'bob');
    try {
      const photo = id('suite-photo-message'); const video = id('suite-video-message');
      await mutate(c.alice, api.sendMessage, { externalId: photo, conversationExternalId: 'dm-alice-bob', text: 'Photo caption', mediaUri: 'fixture:img-01', mediaKind: 'image', viewOnce: false, replyToExternalId: '' });
      await check('m4-a01', async () => { const row = (await query(c.bob, api.messagesForConversation, { conversationExternalId: 'dm-alice-bob' })).find((m) => m.externalId === photo); assert.equal(row.mediaUri, 'fixture:img-01'); assert.equal(row.mediaKind, 'image'); return { message: photo, media: row.mediaUri }; });
      await mutate(c.alice, api.sendMessage, { externalId: video, conversationExternalId: 'dm-alice-bob', text: 'Video caption', mediaUri: 'fixture:vid-01', mediaKind: 'video', viewOnce: false, replyToExternalId: '' });
      await check('m4-a03', async () => { const row = (await query(c.bob, api.messagesForConversation, { conversationExternalId: 'dm-alice-bob' })).find((m) => m.externalId === video); assert.equal(row.mediaUri, 'fixture:vid-01'); assert.equal(row.mediaKind, 'video'); return { message: video, media: row.mediaUri }; });
      await mutate(c.bob, api.setMessageReaction, { messageExternalId: photo, emoji: '👍', mutationId: id('react-thumb') });
      await mutate(c.bob, api.setMessageReaction, { messageExternalId: photo, emoji: '❤️', mutationId: id('react-heart') });
      await check('m4-a06', async () => { const row = (await query(c.alice, api.messagesForConversation, { conversationExternalId: 'dm-alice-bob' })).find((m) => m.externalId === photo); const reactions = JSON.parse(row.reactionsJson); assert.deepEqual(reactions.map((r) => r.emoji), ['❤️']); assert.equal(reactions[0].count, 1); return { reactions }; });
      await mutate(c.bob, api.setMessageReaction, { messageExternalId: photo, emoji: 'none', mutationId: id('react-none') });
      await check('m4-a07', async () => { const row = (await query(c.alice, api.messagesForConversation, { conversationExternalId: 'dm-alice-bob' })).find((m) => m.externalId === photo); assert.deepEqual(JSON.parse(row.reactionsJson), []); return { reactions: [] }; });
      await mutate(c.alice, api.editMessage, { messageExternalId: photo, text: 'Edited photo caption' });
      await check('m4-a09', async () => { const row = (await query(c.bob, api.messagesForConversation, { conversationExternalId: 'dm-alice-bob' })).find((m) => m.externalId === photo); assert.equal(row.edited, true); assert.match(source, /edited=\{message\.edited\}/u); return { message: photo, edited: row.edited, labelBinding: true }; });
    } finally { await disposeActors(c); }
  }

  if (milestone === 'm5') {
    const c = await openActors('alice', 'bob', 'carol');
    try {
      const once = id('suite-view-once'); await mutate(c.alice, api.sendMessage, { externalId: once, conversationExternalId: 'dm-alice-bob', text: 'View once suite', mediaUri: 'fixture:img-01', mediaKind: 'image', viewOnce: true, replyToExternalId: '' });
      await check('m5-a04', async () => { assert.equal(await mutate(c.bob, api.consumeViewOnce, { messageExternalId: once }), true); const row = (await query(c.bob, api.messagesForConversation, { conversationExternalId: 'dm-alice-bob' })).find((m) => m.externalId === once); assert.equal(row.viewOnceState, 'opened'); return { firstOpen: true, state: row.viewOnceState }; });
      await check('m5-a05', async () => { const message = await rejected(mutate(c.bob, api.consumeViewOnce, { messageExternalId: once }), /VIEW_ONCE_CONSUMED/u); return { secondOpenDenied: message }; });
      await check('m5-a08', async () => { const message = await rejected(mutate(c.bob, api.updateConversation, { conversationExternalId: 'g-starter', name: 'Forbidden rename', description: 'Forbidden', accent: 'teal', backgroundUri: '', disappearing: 'off' }), /ADMIN_REQUIRED/u); return { rejected: message }; });
      await check('m5-a09', async () => { const profiles = await query(c.alice, api.publicProfiles); const term = 'car'; const matches = profiles.filter((p) => `${p.displayName} ${p.handle}`.toLowerCase().split(/[^a-z0-9_]+/u).some((word) => word.startsWith(term))); assert(matches.some((p) => p.handle === 'carol')); assert.match(source, /word\.startsWith\(term\)/u); return { term, matches: matches.map((p) => p.handle) }; });
      await check('m5-a10', async () => { const messages = await query(c.alice, api.messagesForConversation, { conversationExternalId: 'g-starter' }); const known = messages.find((m) => /dinner|weekend|coffee/iu.test(m.text)); assert(known); assert.match(source, /m\.text\?\.toLowerCase\(\)\.includes\(term\)/u); return { chat: 'g-starter', knownMessage: known.externalId, text: known.text }; });
      const token = `global-search-${suffix}`; const dmMessage = id('suite-search-dm'); const groupMessage = id('suite-search-group');
      await mutate(c.alice, api.sendMessage, { externalId: dmMessage, conversationExternalId: 'dm-alice-bob', text: `${token} direct`, mediaUri: '', mediaKind: '', viewOnce: false, replyToExternalId: '' });
      await mutate(c.alice, api.sendMessage, { externalId: groupMessage, conversationExternalId: 'g-starter', text: `${token} group`, mediaUri: '', mediaKind: '', viewOnce: false, replyToExternalId: '' });
      await check('m5-a11', async () => { const inbox = await query(c.alice, api.myInbox); const title = new Map(inbox.map((r) => [r.conversationExternalId, r.title])); const matches = (await query(c.alice, api.myMessages)).filter((m) => m.text.includes(token)); const groups = new Set(matches.map((m) => title.get(m.conversationExternalId))); assert.equal(groups.size, 2); assert.match(uiSearch, /sm-search-group/u); assert.match(source, /groupLabel: chatTitle\.get/u); return { resultCount: matches.length, groups: [...groups] }; });
    } finally { await disposeActors(c); }
  }

  if (milestone === 'm6') {
    const c = await openActors('alice', 'bob');
    try {
      const text = `This message has a deliberately long preview boundary ${'x'.repeat(90)}`; const messageId = id('suite-push-text');
      await mutate(c.alice, api.sendMessage, { externalId: messageId, conversationExternalId: 'dm-alice-bob', text, mediaUri: '', mediaKind: '', viewOnce: false, replyToExternalId: '' });
      await check('m6-a08', async () => { const alice = (await query(c.alice, api.myProfile))[0]; const notification = (await query(c.bob, api.myNotifications)).find((n) => n.externalId.includes(messageId)); const payload = JSON.parse(notification.payloadJson); assert.equal(payload.targetUserId, (await query(c.bob, api.myProfile))[0].ownerId); assert.equal(payload.chatId, 'dm-alice-bob'); assert.equal(payload.senderDisplayName, alice.displayName); assert.equal(payload.preview, text.slice(0, 80)); return payload; });
      const photoId = id('suite-push-photo'); await mutate(c.alice, api.sendMessage, { externalId: photoId, conversationExternalId: 'dm-alice-bob', text: 'Secret image', mediaUri: 'fixture:img-01', mediaKind: 'image', viewOnce: true, replyToExternalId: '' });
      await check('m6-a09', async () => { const notification = (await query(c.bob, api.myNotifications)).find((n) => n.externalId.includes(photoId)); assert.equal(notification.preview, 'Photo'); return { externalId: notification.externalId, preview: notification.preview }; });
      const demo = spawnSync(process.execPath, ['scripts/custom-client-demo.mjs'], { cwd: root, encoding: 'utf8', timeout: 120000 });
      await check('m6-a10', () => { assert.equal(demo.status, 0, demo.stderr); const receipt = JSON.parse(demo.stdout.trim().split('\n').at(-1)); assert.equal(receipt.ok, true); return receipt; });
      await check('m6-a11', () => { const receipt = JSON.parse(demo.stdout.trim().split('\n').at(-1)); assert.equal(receipt.auth, 'password-session'); assert(receipt.conversationCount > 0); assert(receipt.historyAfter > receipt.historyBefore); assert.equal(receipt.receiveMode, 'polling'); assert(existsSync(new URL('../API.md', import.meta.url))); return { operations: ['authenticate', 'list conversations', 'page history', 'send text', 'poll receive'], receipt }; });
      const validation = spawnSync(process.execPath, ['instrument/fixtures/social-messenger/validate.mjs', 'instrument/fixtures/social-messenger/sample-50.log'], { cwd: root, encoding: 'utf8', timeout: 30000 });
      const sample = spawnSync(process.execPath, ['scripts/replay.mjs', '--sample-50'], { cwd: root, encoding: 'utf8', timeout: 180000 });
      await check('m6-a13', () => { assert.equal(validation.status, 0, validation.stderr); assert.equal(sample.status, 0, sample.stderr); const receipt = JSON.parse(readFileSync(new URL('../receipts/replay-sample-50.json', import.meta.url), 'utf8')); assert.equal(receipt.ok, true); assert.equal(receipt.actionCount, 50); assert.equal(new Set(receipt.actions.map((a) => a.action)).size, 13); return { validator: validation.stdout.trim().split('\n'), replayedActions: receipt.actionCount, verbs: [...new Set(receipt.actions.map((a) => a.action))] }; });
    } finally { await disposeActors(c); }
  }

  if (milestone === 'm8') {
    const c = await openActors('alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'henry');
    try {
      await check('m8-a01', async () => { const alice = (await query(c.alice, api.myProfile))[0]; const [insight] = await query(c.alice, api.myInsights); const posts = await query(c.alice, api.globalPosts); const likes = await query(c.alice, api.allPostLikes); const reposts = await query(c.alice, api.allReposts); const follows = await query(c.alice, api.publicFollows); const authored = posts.filter((p) => p.authorId === alice.ownerId); const originals = authored.filter((p) => !p.isReply); const repliesReceived = posts.filter((p) => p.isReply && originals.some((parent) => parent.externalId === p.parentExternalId)).length; const expected = { posts: originals.length, likesReceived: likes.filter((e) => originals.some((p) => p.externalId === e.postExternalId)).length, repostsReceived: reposts.filter((e) => originals.some((p) => p.externalId === e.postExternalId)).length, repliesReceived, followers: follows.filter((e) => e.followeeId === alice.ownerId).length, following: follows.filter((e) => e.followerId === alice.ownerId).length }; assert.deepEqual({ posts: insight.posts, likesReceived: insight.likesReceived, repostsReceived: insight.repostsReceived, repliesReceived: insight.repliesReceived, followers: insight.followers, following: insight.following }, expected); return { totals: expected, consistencyBasis: 'current starter-derived state plus retained journey actions' }; });
      const todayPost = id('suite-today'); await mutate(c.alice, api.createPost, { externalId: todayPost, type: 'text', text: 'Today activity bucket', mediaUri1: '', mediaUri2: '', parentExternalId: '' });
      await check('m8-a03', async () => { const dayKey = String(Math.floor(Date.now() / 86400000)); const row = (await query(c.alice, api.myActivityDays)).find((d) => d.dayKey === dayKey); assert(row); assert(row.posts > 0); return { post: todayPost, dayKey, posts: row.posts, boundary: 'server epoch UTC day' }; });
      await check('m8-a04', () => { assert.match(source, /Array\.from\(\{ length: 7 \}/u); assert.match(source, /row\?\.posts \?\? 0/u); assert.match(source, /row\?\.likesReceived \?\? 0/u); return { renderedDays: 7, missingValue: 0 }; });
      const olderTie = id('suite-trending-older'); const newerTie = id('suite-trending-newer');
      await mutate(c.alice, api.createPost, { externalId: olderTie, type: 'text', text: 'Older tied trending post', mediaUri1: '', mediaUri2: '', parentExternalId: '' });
      await mutate(c.alice, api.createPost, { externalId: newerTie, type: 'text', text: 'Newer tied trending post', mediaUri1: '', mediaUri2: '', parentExternalId: '' });
      for (const [actor, client] of Object.entries(c)) {
        await mutate(client, api.setPostLike, { postExternalId: olderTie, state: 'set', mutationId: id(`trend-old-${actor}`) });
        await mutate(client, api.setPostLike, { postExternalId: newerTie, state: 'set', mutationId: id(`trend-new-${actor}`) });
      }
      const allPosts = await query(c.alice, api.globalPosts); const trending = allPosts.filter((p) => !p.isReply && Date.now() - p.createdAt <= 86400000).sort((a, b) => b.likeCount - a.likeCount || b.createdAt - a.createdAt).slice(0, 10);
      await check('m8-a05', () => { assert.equal(trending[0].externalId, newerTie); assert.equal(trending[0].likeCount, 8); return { first: trending[0].externalId, likeCount: trending[0].likeCount }; });
      await check('m8-a06', () => { const synthetic = [{ externalId: 'old-heavy', isReply: false, createdAt: Date.now() - 86400001, likeCount: 999 }, ...trending]; const filtered = synthetic.filter((p) => !p.isReply && Date.now() - p.createdAt <= 86400000); assert(!filtered.some((p) => p.externalId === 'old-heavy')); assert.match(source, /Date\.now\(\) - p\.createdAt <= 86400000/u); return { unitBoundaryMs: 86400000, excluded: 'old-heavy', evidenceKind: 'source-plus-boundary-unit' }; });
      await check('m8-a07', () => { const oldIndex = trending.findIndex((p) => p.externalId === olderTie); const newIndex = trending.findIndex((p) => p.externalId === newerTie); assert(newIndex >= 0 && oldIndex > newIndex); assert.equal(trending[newIndex].likeCount, trending[oldIndex].likeCount); assert.match(source, /b\.likeCount - a\.likeCount \|\| b\.createdAt - a\.createdAt/u); return { newer: newerTie, older: olderTie, positions: [newIndex, oldIndex], tiedLikes: trending[newIndex].likeCount }; });
    } finally { await disposeActors(c); }
  }
} catch (error) {
  firstFailure ??= error;
}

const actualIds = checks.map((row) => row.id).sort();
if (JSON.stringify(actualIds) !== JSON.stringify([...expectedIds].sort())) firstFailure ??= new Error(`coverage mismatch expected=${expectedIds.join(',')} actual=${actualIds.join(',')}`);
const receipt = {
  schemaVersion: 'clique.suite-receipt.v2', instrument: 'social-messenger@0.3.6-m8', milestone,
  pass: firstFailure === null && checks.every((row) => row.pass), outcomeClass: firstFailure ? 'application' : null,
  coverage: { expectedAssertionIds: expectedIds, observedAssertionIds: checks.map((row) => row.id), complete: JSON.stringify(actualIds) === JSON.stringify([...expectedIds].sort()) },
  starterReplay: { pass: replayReceipt.ok, actionCount: replayReceipt.actionCount, completedAt: replayReceipt.completedAt },
  checks, failure: firstFailure ? String(firstFailure.stack ?? firstFailure) : null,
  startedAt: checks[0]?.startedAt ?? Date.now(), completedAt: Date.now(),
};
const output = new URL(`../receipts/suite-${milestone}.json`, import.meta.url);
mkdirSync(dirname(output.pathname), { recursive: true }); writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(receipt)}\n`); if (!receipt.pass) process.exitCode = 1;
