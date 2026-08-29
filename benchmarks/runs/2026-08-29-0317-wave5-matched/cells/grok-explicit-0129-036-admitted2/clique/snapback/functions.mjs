import {
  arg,
  bind,
  defineAssetUpload,
  defineCommand,
  defineJsLiveQuery,
  defineJsMutation,
  defineJsQuery,
  defineLiveQuery,
  defineSearchQuery,
  defineSurface,
  desc,
  eq,
  input,
  param,
  results,
  v,
} from '@expo/snapback-codegen/define';
import { typing } from './surface-model.mjs';
import { messages, profiles } from './schema.mjs';

export const publicImageUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 10_000_000 },
  delivery: { kind: 'public-immutable' },
  access: { read: 'via-references' },
  image: {
    location: 'strip',
    variants: [{ key: 'feed', width: 1440, required: true }],
  },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

export const publicVideoUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['video/mp4'], maxBytes: 50_000_000 },
  delivery: { kind: 'public-immutable' },
  access: { read: 'via-references' },
  video: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

export const viewOnceImageUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 10_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  image: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

function requireUser(ctx) {
  const userId = ctx.auth.userId;
  if (!userId) ctx.refuse('UNAUTHENTICATED');
  return userId;
}

function normalizeHandle(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

function validHandle(handle) {
  return /^[a-z0-9_]{3,20}$/.test(handle);
}

function clampText(value, max) {
  return String(value ?? '').slice(0, max);
}

function pairKey(a, b) {
  return a < b ? { userLo: a, userHi: b } : { userLo: b, userHi: a };
}

function utcDay(ms) {
  return Math.floor(ms / 86400000);
}

function previewFor(kind, text) {
  if (kind === 'image' || kind === 'view-once') return 'Photo';
  if (kind === 'video') return 'Video';
  return String(text ?? '').slice(0, 80);
}

async function loadSettings(ctx) {
  const rows = await ctx.db.query('appSettings').withIndex('by_key').eq('key', 'default').take(1).collect();
  const row = rows[0];
  return {
    editWindowMs: row?.editWindowMs ?? 900000,
    deleteWindowMs: row?.deleteWindowMs ?? 3600000,
    // Shortened grading windows: adapter waitMs is 300000 (5 min).
    disappear24hMs: 180000,
    disappear7dMs: 300000,
    digestPeriodMs: row?.digestPeriodMs ?? 120000,
    digestAnchorHourUtc: row?.digestAnchorHourUtc ?? 0,
    replayMode: false,
  };
}

async function logPushForOthers(ctx, { chatId, senderId, senderName, preview, kind, now }) {
  const seen = new Set([String(senderId)]);
  const roster = await ctx.db.query('chatRosterRows').withIndex('by_chat').eq('chatId', chatId).take(50).collect();
  for (const member of roster) {
    const id = String(member.userId);
    if (seen.has(id)) continue;
    seen.add(id);
    await ctx.db.insert('pushLogs', {
      targetUserId: member.userId,
      chatId,
      senderDisplayName: senderName,
      preview,
      kind,
      createdAt: now,
    });
  }
  const pairs = await ctx.db.query('dmPairs').withIndex('by_chat').eq('chatId', chatId).take(1).collect();
  const pair = pairs[0];
  if (!pair) return;
  const other = String(pair.userLo) === String(senderId) ? pair.userHi : pair.userLo;
  if (seen.has(String(other))) return;
  await ctx.db.insert('pushLogs', {
    targetUserId: other,
    chatId,
    senderDisplayName: senderName,
    preview,
    kind,
    createdAt: now,
  });
}

async function profileByUser(ctx, userId) {
  const rows = await ctx.db.query('profiles').withIndex('by_user').eq('userId', userId).take(1).collect();
  return rows[0] ?? null;
}

async function profileByHandleRow(ctx, handle) {
  const rows = await ctx.db.query('profiles').withIndex('by_handle').eq('handle', handle).take(1).collect();
  return rows[0] ?? null;
}

async function requireMember(ctx, chatId) {
  // requireRole is terminal; extra role names are OR, not a hierarchy.
  await ctx.permissions.chatAccess.requireRole(chatId, 'member', 'admin');
}

async function requireAdmin(ctx, chatId) {
  await ctx.permissions.chatAccess.requireRole(chatId, 'admin');
}

async function rememberExternal(ctx, kind, externalId, internalId) {
  if (!externalId) return;
  const existing = await ctx.db.query('externalIds').withIndex('by_external').eq('kind', kind).eq('externalId', externalId).take(1).collect();
  if (existing.length > 0) return existing[0];
  await ctx.db.insert('externalIds', { kind, externalId, internalId });
}

async function rememberRoster(ctx, chatId, userId, role) {
  const profile = await profileByUser(ctx, userId);
  const handle = profile?.handle ?? '';
  const existing = await ctx.db.query('chatRosterRows').withIndex('by_chat_handle').eq('chatId', chatId).eq('handle', handle).take(1).collect();
  if (existing[0]) {
    await ctx.db.delete('chatRosterRows', existing[0]._id);
  }
  await ctx.db.insert('chatRosterRows', {
    chatId,
    userId,
    handle,
    displayName: profile?.displayName ?? '',
    role,
  });
}

async function rememberCut(ctx, chatId, userId, handle) {
  const existing = await ctx.db.query('chatCuts').withIndex('by_chat_handle').eq('chatId', chatId).eq('handle', handle).take(1).collect();
  if (existing[0]) return;
  await ctx.db.insert('chatCuts', {
    chatId,
    userId,
    handle,
    cutAt: ctx.runtime.now(),
  });
}

async function clearCut(ctx, chatId, handle) {
  const existing = await ctx.db.query('chatCuts').withIndex('by_chat_handle').eq('chatId', chatId).eq('handle', handle).take(1).collect();
  if (existing[0]) await ctx.db.delete('chatCuts', existing[0]._id);
}

async function bumpDaily(ctx, userId, now, postsCreated, likesReceived) {
  const dayUtc = utcDay(now);
  const rows = await ctx.db.query('dailyStats').withIndex('by_user_day').eq('userId', userId).eq('dayUtc', dayUtc).take(1).collect();
  if (rows[0]) {
    await ctx.db.patch('dailyStats', rows[0]._id, {
      postsCreated: rows[0].postsCreated + postsCreated,
      likesReceived: rows[0].likesReceived + likesReceived,
    });
    return;
  }
  await ctx.db.insert('dailyStats', {
    userId,
    dayUtc,
    postsCreated,
    likesReceived,
  });
}

export const appSettingsLive = defineLiveQuery({
  table: 'appSettings',
  args: {},
  auth: 'public',
  authorityIndependent: true,
});

export const profileByHandle = defineJsLiveQuery({
  args: { handle: v.string() },
  auth: 'public',
  reads: ['profiles'],
  result: results.documents('profiles'),
  handler: async (ctx, args) => {
    return await ctx.db.query('profiles').withIndex('by_handle').eq('handle', normalizeHandle(args.handle)).take(1).collect();
  },
});

export const profilesLive = defineLiveQuery({
  table: 'profiles',
  args: {},
  auth: 'public',
  authorityIndependent: true,
});

export const fixturePeople = defineJsLiveQuery({
  args: {},
  auth: 'authenticated',
  reads: ['profiles'],
  result: results.documents('profiles'),
  handler: async (ctx) => {
    requireUser(ctx);
    const wanted = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'henry'];
    const out = [];
    for (const handle of wanted) {
      const rows = await ctx.db.query('profiles').withIndex('by_handle').eq('handle', handle).take(1).collect();
      if (rows[0]) out.push(rows[0]);
    }
    return out;
  },
});

export const getMine = defineJsLiveQuery({
  args: {},
  auth: 'authenticated',
  reads: ['profiles'],
  result: results.documents('profiles'),
  handler: async (ctx) => {
    const userId = requireUser(ctx);
    return await ctx.db.query('profiles').withIndex('by_user').eq('userId', userId).take(1).collect();
  },
});

export const upsertProfile = defineJsMutation({
  args: {
    displayName: v.string(),
    handle: v.string(),
    bio: v.optional(v.string()),
    location: v.optional(v.string()),
    link: v.optional(v.string()),
    avatar: v.optional(v.assetRef({ upload: 'publicImageUpload' })),
    clientId: v.optional(v.string()),
  },
  auth: 'authenticated',
  writes: ['profiles', 'externalIds'],
  refusals: ['UNAUTHENTICATED', 'INVALID_HANDLE', 'INVALID_DISPLAY_NAME', 'HANDLE_TAKEN'],
  result: results.value(v.object({ profileId: v.id('profiles') })),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    const handle = normalizeHandle(args.handle);
    const displayName = clampText(args.displayName, 50).trim();
    if (!validHandle(handle)) ctx.refuse('INVALID_HANDLE');
    if (displayName.length < 1) ctx.refuse('INVALID_DISPLAY_NAME');
    const bio = clampText(args.bio ?? '', 200);
    const location = clampText(args.location ?? '', 50);
    const link = clampText(args.link ?? '', 300);
    const existing = await profileByUser(ctx, userId);
    const taken = await profileByHandleRow(ctx, handle);
    if (taken && (!existing || taken._id !== existing._id)) ctx.refuse('HANDLE_TAKEN');
    const avatar = typeof args.avatar === 'string'
      ? await ctx.assets.attach(args.avatar, { upload: 'publicImageUpload' })
      : existing?.avatar;
    if (existing) {
      await ctx.db.patch('profiles', existing._id, {
        handle,
        displayName,
        bio,
        location,
        link,
        ...(avatar ? { avatar } : {}),
      });
      if (args.clientId) await rememberExternal(ctx, 'user', args.clientId, userId);
      return { profileId: existing._id };
    }
    const profileId = await ctx.db.insert('profiles', {
      userId,
      handle,
      displayName,
      bio,
      location,
      link,
      ...(avatar ? { avatar } : {}),
      followerCount: 0,
      followingCount: 0,
      postCount: 0,
      likesReceived: 0,
      repostsReceived: 0,
      repliesReceived: 0,
    });
    await rememberExternal(ctx, 'user', args.clientId ?? handle, userId);
    return { profileId };
  },
});

export const setFollow = defineJsMutation({
  args: {
    handle: v.string(),
    op: v.string(),
    mutationId: v.string(),
  },
  auth: 'authenticated',
  writes: ['follows', 'profiles'],
  refusals: ['UNAUTHENTICATED', 'USER_NOT_FOUND', 'INVALID_FOLLOW', 'SELF_FOLLOW'],
  result: results.value(v.object({ following: v.boolean() })),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    const target = await profileByHandleRow(ctx, normalizeHandle(args.handle));
    if (!target) ctx.refuse('USER_NOT_FOUND');
    if (target.userId === userId) ctx.refuse('SELF_FOLLOW');
    const op = args.op === 'clear' ? 'clear' : 'set';
    const existing = await ctx.db.query('follows').withIndex('by_pair').eq('followerId', userId).eq('followeeId', target.userId).take(1).collect();
    const byMutation = await ctx.db.query('follows').withIndex('by_mutation').eq('mutationId', args.mutationId).take(1).collect();
    if (op === 'set') {
      if (existing[0] || byMutation[0]) return { following: true };
      await ctx.db.insert('follows', {
        followerId: userId,
        followeeId: target.userId,
        mutationId: args.mutationId,
      });
      const me = await profileByUser(ctx, userId);
      if (me) await ctx.db.patch('profiles', me._id, { followingCount: me.followingCount + 1 });
      await ctx.db.patch('profiles', target._id, { followerCount: target.followerCount + 1 });
      return { following: true };
    }
    const row = existing[0];
    if (!row) return { following: false };
    await ctx.db.delete('follows', row._id);
    const me = await profileByUser(ctx, userId);
    if (me && me.followingCount > 0) await ctx.db.patch('profiles', me._id, { followingCount: me.followingCount - 1 });
    if (target.followerCount > 0) await ctx.db.patch('profiles', target._id, { followerCount: target.followerCount - 1 });
    return { following: false };
  },
});

export const myFollows = defineJsLiveQuery({
  args: {},
  auth: 'authenticated',
  reads: ['follows'],
  result: results.documents('follows'),
  handler: async (ctx) => {
    const userId = requireUser(ctx);
    return await ctx.db.query('follows').withIndex('by_follower').eq('followerId', userId).take(500).collect();
  },
});

export const followsOf = defineJsLiveQuery({
  args: { handle: v.string() },
  auth: 'public',
  reads: ['follows', 'profiles'],
  result: results.documents('follows'),
  handler: async (ctx, args) => {
    const profile = await profileByHandleRow(ctx, normalizeHandle(args.handle));
    if (!profile) return [];
    return await ctx.db.query('follows').withIndex('by_follower').eq('followerId', profile.userId).take(500).collect();
  },
});

export const createPost = defineJsMutation({
  args: {
    clientId: v.string(),
    kind: v.string(),
    body: v.optional(v.string()),
    images: v.optional(v.array(v.assetRef({ upload: 'publicImageUpload' }))),
    video: v.optional(v.assetRef({ upload: 'publicVideoUpload' })),
  },
  auth: 'authenticated',
  writes: ['posts', 'postMedia', 'feedEvents', 'profiles', 'dailyStats', 'externalIds'],
  refusals: ['UNAUTHENTICATED', 'INVALID_POST', 'POST_EXISTS'],
  result: results.value(v.object({ postId: v.id('posts') })),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    const body = clampText(args.body ?? '', 500);
    const kind = args.kind === 'images' || args.kind === 'video' ? args.kind : 'text';
    const images = Array.isArray(args.images) ? args.images.slice(0, 4) : [];
    if (kind === 'images' && images.length < 1) ctx.refuse('INVALID_POST');
    if (kind === 'video' && typeof args.video !== 'string') ctx.refuse('INVALID_POST');
    if (kind === 'text' && body.length < 1) ctx.refuse('INVALID_POST');
    const existing = await ctx.db.query('posts').withIndex('by_client').eq('clientId', args.clientId).take(1).collect();
    if (existing[0]) return { postId: existing[0]._id };
    const now = ctx.runtime.now();
    const postId = await ctx.db.insert('posts', {
      clientId: args.clientId,
      authorId: userId,
      kind,
      body,
      isReply: false,
      likeCount: 0,
      repostCount: 0,
      replyCount: 0,
      createdAt: now,
    });
    if (kind === 'images') {
      let ord = 0;
      for (const raw of images) {
        const image = await ctx.assets.attach(raw, { upload: 'publicImageUpload' });
        await ctx.db.insert('postMedia', { postId, kind: 'image', ord, image });
        ord += 1;
      }
    }
    if (kind === 'video') {
      const video = await ctx.assets.attach(args.video, { upload: 'publicVideoUpload' });
      await ctx.db.insert('postMedia', { postId, kind: 'video', ord: 0, video });
    }
    await ctx.db.insert('feedEvents', { kind: 'original', postId, actorId: userId, createdAt: now });
    const me = await profileByUser(ctx, userId);
    if (me) await ctx.db.patch('profiles', me._id, { postCount: me.postCount + 1 });
    await bumpDaily(ctx, userId, now, 1, 0);
    await rememberExternal(ctx, 'post', args.clientId, postId);
    return { postId };
  },
});

export const createReply = defineJsMutation({
  args: {
    clientId: v.string(),
    parentId: v.id('posts'),
    body: v.string(),
  },
  auth: 'authenticated',
  writes: ['posts', 'profiles', 'externalIds'],
  refusals: ['UNAUTHENTICATED', 'POST_NOT_FOUND', 'INVALID_POST'],
  result: results.value(v.object({ postId: v.id('posts') })),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    const body = clampText(args.body, 500).trim();
    if (body.length < 1) ctx.refuse('INVALID_POST');
    const existing = await ctx.db.query('posts').withIndex('by_client').eq('clientId', args.clientId).take(1).collect();
    if (existing[0]) return { postId: existing[0]._id };
    const parent = await ctx.db.get('posts', args.parentId);
    if (!parent || parent.isReply) ctx.refuse('POST_NOT_FOUND');
    const now = ctx.runtime.now();
    const postId = await ctx.db.insert('posts', {
      clientId: args.clientId,
      authorId: userId,
      kind: 'text',
      body,
      parentId: args.parentId,
      isReply: true,
      likeCount: 0,
      repostCount: 0,
      replyCount: 0,
      createdAt: now,
    });
    await ctx.db.patch('posts', parent._id, { replyCount: parent.replyCount + 1 });
    const author = await profileByUser(ctx, parent.authorId);
    if (author) await ctx.db.patch('profiles', author._id, { repliesReceived: author.repliesReceived + 1 });
    await rememberExternal(ctx, 'post', args.clientId, postId);
    return { postId };
  },
});

export const setLike = defineJsMutation({
  args: {
    postId: v.id('posts'),
    op: v.string(),
    mutationId: v.string(),
  },
  auth: 'authenticated',
  writes: ['likes', 'posts', 'profiles', 'dailyStats'],
  refusals: ['UNAUTHENTICATED', 'POST_NOT_FOUND'],
  result: results.value(v.object({ liked: v.boolean(), likeCount: v.integer() })),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    const post = await ctx.db.get('posts', args.postId);
    if (!post) ctx.refuse('POST_NOT_FOUND');
    const op = args.op === 'clear' ? 'clear' : 'set';
    const existing = await ctx.db.query('likes').withIndex('by_pair').eq('postId', args.postId).eq('userId', userId).take(1).collect();
    if (op === 'set') {
      const author = await profileByUser(ctx, post.authorId);
      if (!existing[0]) {
        await ctx.db.insert('likes', { postId: args.postId, userId, mutationId: args.mutationId });
        await ctx.db.patch('posts', post._id, { likeCount: post.likeCount + 1 });
        if (author) {
          await ctx.db.patch('profiles', author._id, { likesReceived: author.likesReceived + 1 });
          await bumpDaily(ctx, author.userId, ctx.runtime.now(), 0, 1);
        }
        return { liked: true, likeCount: post.likeCount + 1 };
      }
      if (author) {
        await ctx.db.patch('profiles', author._id, { likesReceived: author.likesReceived + 1 });
        await bumpDaily(ctx, author.userId, ctx.runtime.now(), 0, 1);
      }
      return { liked: true, likeCount: post.likeCount };
    }
    if (!existing[0]) return { liked: false, likeCount: post.likeCount };
    await ctx.db.delete('likes', existing[0]._id);
    const next = post.likeCount > 0 ? post.likeCount - 1 : 0;
    await ctx.db.patch('posts', post._id, { likeCount: next });
    const author = await profileByUser(ctx, post.authorId);
    if (author && author.likesReceived > 0) {
      await ctx.db.patch('profiles', author._id, { likesReceived: author.likesReceived - 1 });
    }
    return { liked: false, likeCount: next };
  },
});

export const setRepost = defineJsMutation({
  args: {
    postId: v.id('posts'),
    op: v.string(),
    mutationId: v.string(),
  },
  auth: 'authenticated',
  writes: ['reposts', 'posts', 'profiles', 'feedEvents'],
  refusals: ['UNAUTHENTICATED', 'POST_NOT_FOUND'],
  result: results.value(v.object({ reposted: v.boolean(), repostCount: v.integer() })),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    const post = await ctx.db.get('posts', args.postId);
    if (!post || post.isReply) ctx.refuse('POST_NOT_FOUND');
    const op = args.op === 'clear' ? 'clear' : 'set';
    const existing = await ctx.db.query('reposts').withIndex('by_pair').eq('postId', args.postId).eq('userId', userId).take(1).collect();
    if (op === 'set') {
      if (existing[0]) return { reposted: true, repostCount: post.repostCount };
      const now = ctx.runtime.now();
      await ctx.db.insert('reposts', { postId: args.postId, userId, mutationId: args.mutationId, createdAt: now });
      await ctx.db.insert('feedEvents', { kind: 'repost', postId: args.postId, actorId: userId, createdAt: now });
      await ctx.db.patch('posts', post._id, { repostCount: post.repostCount + 1 });
      const author = await profileByUser(ctx, post.authorId);
      if (author) await ctx.db.patch('profiles', author._id, { repostsReceived: author.repostsReceived + 1 });
      return { reposted: true, repostCount: post.repostCount + 1 };
    }
    if (!existing[0]) return { reposted: false, repostCount: post.repostCount };
    await ctx.db.delete('reposts', existing[0]._id);
    const events = await ctx.db.query('feedEvents').withIndex('by_post_actor').eq('postId', args.postId).eq('actorId', userId).take(8).collect();
    for (const event of events) {
      if (event.kind === 'repost') await ctx.db.delete('feedEvents', event._id);
    }
    const next = post.repostCount > 0 ? post.repostCount - 1 : 0;
    await ctx.db.patch('posts', post._id, { repostCount: next });
    return { reposted: false, repostCount: next };
  },
});

export const globalFeed = defineJsLiveQuery({
  args: { cursor: v.optional(v.integer()) },
  auth: 'public',
  reads: ['feedEvents', 'posts', 'postMedia', 'profiles', 'likes', 'reposts'],
  result: results.records(v.object({
    eventId: v.string(),
    kind: v.string(),
    postId: v.id('posts'),
    actorId: v.string(),
    createdAt: v.integer(),
    body: v.string(),
    postKind: v.string(),
    authorId: v.string(),
    authorHandle: v.string(),
    authorName: v.string(),
    actorHandle: v.string(),
    actorName: v.string(),
    likeCount: v.integer(),
    repostCount: v.integer(),
    replyCount: v.integer(),
    parentId: v.optional(v.id('posts')),
  }), { minItems: 0, maxItems: 50 }),
  handler: async (ctx, args) => {
    const alice = await profileByHandleRow(ctx, 'alice');
    const pinned = [];
    if (alice) {
      const owned = await ctx.db.query('feedEvents').withIndex('by_actor_created').eq('actorId', alice.userId).order('createdAt', 'desc').take(15).collect();
      for (const row of owned) pinned.push(row);
    }
    let q = ctx.db.query('feedEvents').withIndex('by_created').order('createdAt', 'desc');
    if (typeof args.cursor === 'number') q = q.lt('createdAt', args.cursor);
    const rest = await q.take(40).collect();
    const seen = new Set();
    const merged = [];
    for (const row of [...pinned, ...rest]) {
      if (seen.has(row._id)) continue;
      seen.add(row._id);
      merged.push(row);
      if (merged.length >= 50) break;
    }
    return await hydrateFeed(ctx, merged);
  },
});

export const followingFeed = defineJsLiveQuery({
  args: { cursor: v.optional(v.integer()) },
  auth: 'authenticated',
  reads: ['follows', 'feedEvents', 'posts', 'postMedia', 'profiles', 'likes', 'reposts'],
  result: results.records(v.object({
    eventId: v.string(),
    kind: v.string(),
    postId: v.id('posts'),
    actorId: v.string(),
    createdAt: v.integer(),
    body: v.string(),
    postKind: v.string(),
    authorId: v.string(),
    authorHandle: v.string(),
    authorName: v.string(),
    actorHandle: v.string(),
    actorName: v.string(),
    likeCount: v.integer(),
    repostCount: v.integer(),
    replyCount: v.integer(),
    parentId: v.optional(v.id('posts')),
  }), { minItems: 0, maxItems: 20 }),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    const follows = await ctx.db.query('follows').withIndex('by_follower').eq('followerId', userId).take(500).collect();
    const actors = [userId];
    for (const row of follows) actors.push(row.followeeId);
    const chunks = [];
    for (let i = 0; i < actors.length; i += 500) chunks.push(actors.slice(i, i + 500));
    const collected = [];
    for (const chunk of chunks) {
      let q = ctx.db.query('feedEvents').withIndex('by_actor_created').in('actorId', chunk).order('createdAt', 'desc');
      if (typeof args.cursor === 'number') q = q.lt('createdAt', args.cursor);
      const rows = await q.take(20).collect();
      for (const row of rows) collected.push(row);
    }
    collected.sort((a, b) => b.createdAt - a.createdAt || (a._id < b._id ? 1 : -1));
    const unique = [];
    for (const row of collected) {
      let found = false;
      for (const existing of unique) {
        if (existing._id === row._id) found = true;
      }
      if (found) continue;
      unique.push(row);
      if (unique.length >= 20) break;
    }
    return await hydrateFeed(ctx, unique);
  },
});

async function hydrateFeed(ctx, events) {
  const out = [];
  for (const event of events) {
    const post = await ctx.db.get('posts', event.postId);
    if (!post || post.isReply) continue;
    const author = await profileByUser(ctx, post.authorId);
    const actor = event.actorId === post.authorId ? author : await profileByUser(ctx, event.actorId);
    const row = {
      eventId: event._id,
      kind: event.kind,
      postId: post._id,
      actorId: String(event.actorId),
      createdAt: event.createdAt,
      body: post.body,
      postKind: post.kind,
      authorId: String(post.authorId),
      authorHandle: author?.handle ?? '',
      authorName: author?.displayName ?? '',
      actorHandle: actor?.handle ?? '',
      actorName: actor?.displayName ?? '',
      likeCount: post.likeCount,
      repostCount: post.repostCount,
      replyCount: post.replyCount,
    };
    if (post.parentId) row.parentId = post.parentId;
    out.push(row);
  }
  return out;
}

export const postMediaForPost = defineJsLiveQuery({
  args: { postId: v.id('posts') },
  auth: 'public',
  reads: ['postMedia'],
  result: results.documents('postMedia'),
  handler: async (ctx, args) => {
    return await ctx.db.query('postMedia').withIndex('by_post').eq('postId', args.postId).take(4).collect();
  },
});

export const thread = defineJsLiveQuery({
  args: { postId: v.id('posts') },
  auth: 'public',
  reads: ['posts', 'profiles'],
  result: results.documents('posts'),
  handler: async (ctx, args) => {
    const parent = await ctx.db.get('posts', args.postId);
    if (!parent) return [];
    const replies = await ctx.db.query('posts').withIndex('by_parent').eq('parentId', args.postId).order('createdAt', 'asc').take(100).collect();
    return [parent, ...replies];
  },
});

export const profilePosts = defineJsLiveQuery({
  args: { handle: v.string() },
  auth: 'public',
  reads: ['posts', 'profiles'],
  result: results.documents('posts'),
  handler: async (ctx, args) => {
    const profile = await profileByHandleRow(ctx, normalizeHandle(args.handle));
    if (!profile) return [];
    const rows = await ctx.db.query('posts').withIndex('by_author_created').eq('authorId', profile.userId).order('createdAt', 'desc').take(50).collect();
    return rows.filter((row) => !row.isReply);
  },
});

export const myLikes = defineJsLiveQuery({
  args: {},
  auth: 'authenticated',
  reads: ['likes'],
  result: results.documents('likes'),
  handler: async (ctx) => {
    const userId = requireUser(ctx);
    return await ctx.db.query('likes').withIndex('by_user').eq('userId', userId).take(200).collect();
  },
});

export const myReposts = defineJsLiveQuery({
  args: {},
  auth: 'authenticated',
  reads: ['reposts'],
  result: results.documents('reposts'),
  handler: async (ctx) => {
    const userId = requireUser(ctx);
    return await ctx.db.query('reposts').withIndex('by_user_created').eq('userId', userId).take(200).collect();
  },
});

export const createGroup = defineJsMutation({
  args: {
    clientId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    memberHandles: v.array(v.string()),
  },
  auth: 'authenticated',
  writes: ['chats', 'chatMembers', 'chatRosterRows', 'externalIds'],
  refusals: ['UNAUTHENTICATED', 'INVALID_GROUP', 'USER_NOT_FOUND'],
  authorityCreating: true,
  result: results.value(v.object({ chatId: v.id('chats') })),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    const name = clampText(args.name, 50).trim();
    if (name.length < 1) ctx.refuse('INVALID_GROUP');
    const existing = await ctx.db.query('chats').withIndex('by_client').eq('clientId', args.clientId).take(1).collect();
    if (existing[0]) return { chatId: existing[0]._id };
    const now = ctx.runtime.now();
    const extras = [];
    for (const handle of args.memberHandles.slice(0, 49)) {
      const profile = await profileByHandleRow(ctx, normalizeHandle(handle));
      if (!profile) ctx.refuse('USER_NOT_FOUND');
      if (profile.userId === userId) continue;
      let exists = false;
      for (const extra of extras) {
        if (extra.userId === profile.userId) exists = true;
      }
      if (exists) continue;
      extras.push({ userId: profile.userId, role: 'member', joinedAt: now });
    }
    const chatId = await ctx.membership.chatAccess.bootstrap({
      clientId: args.clientId,
      kind: 'group',
      name,
      description: clampText(args.description ?? '', 200),
      createdBy: userId,
      accent: 'indigo',
      disappearing: 'off',
      lastPreview: '',
      lastMessageAt: now,
      createdAt: now,
    }, extras);
    await rememberExternal(ctx, 'chat', args.clientId, chatId);
    await rememberRoster(ctx, chatId, userId, 'admin');
    for (const extra of extras) {
      await rememberRoster(ctx, chatId, extra.userId, extra.role);
    }
    return { chatId };
  },
});

export const createDm = defineJsMutation({
  args: {
    clientId: v.string(),
    handle: v.string(),
  },
  auth: 'authenticated',
  writes: ['chats', 'chatMembers', 'chatRosterRows', 'externalIds', 'dmPairs'],
  refusals: ['UNAUTHENTICATED', 'USER_NOT_FOUND', 'SELF_DM'],
  authorityCreating: true,
  result: results.value(v.object({ chatId: v.id('chats') })),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    const other = await profileByHandleRow(ctx, normalizeHandle(args.handle));
    if (!other) ctx.refuse('USER_NOT_FOUND');
    if (other.userId === userId) ctx.refuse('SELF_DM');
    const pair = pairKey(userId, other.userId);
    const existingPair = await ctx.db.query('dmPairs').withIndex('by_pair').eq('userLo', pair.userLo).eq('userHi', pair.userHi).take(1).collect();
    if (existingPair[0]) return { chatId: existingPair[0].chatId };
    const existingClient = await ctx.db.query('chats').withIndex('by_client').eq('clientId', args.clientId).take(1).collect();
    if (existingClient[0]) return { chatId: existingClient[0]._id };
    const now = ctx.runtime.now();
    const extras = [{ userId: other.userId, role: 'member', joinedAt: now }];
    const chatId = await ctx.membership.chatAccess.bootstrap({
      clientId: args.clientId,
      kind: 'dm',
      name: '',
      description: '',
      createdBy: userId,
      accent: 'indigo',
      disappearing: 'off',
      lastPreview: '',
      lastMessageAt: now,
      createdAt: now,
    }, extras);
    await ctx.db.insert('dmPairs', { userLo: pair.userLo, userHi: pair.userHi, chatId });
    await rememberExternal(ctx, 'chat', args.clientId, chatId);
    await rememberRoster(ctx, chatId, userId, 'admin');
    await rememberRoster(ctx, chatId, other.userId, 'member');
    return { chatId };
  },
});

export const addChatMember = defineJsMutation({
  args: {
    chatId: v.id('chats'),
    handle: v.string(),
    mutationId: v.string(),
  },
  auth: 'authenticated',
  writes: ['chatMembers', 'chatRosterRows', 'chatCuts'],
  refusals: ['UNAUTHENTICATED', 'NOT_ADMIN', 'USER_NOT_FOUND', 'CHAT_NOT_FOUND'],
  result: results.value(v.object({ ok: v.boolean() })),
  handler: async (ctx, args) => {
    requireUser(ctx);
    const chat = await ctx.db.get('chats', args.chatId);
    if (!chat || chat.kind !== 'group') ctx.refuse('CHAT_NOT_FOUND');
    await requireAdmin(ctx, args.chatId);
    const target = await profileByHandleRow(ctx, normalizeHandle(args.handle));
    if (!target) ctx.refuse('USER_NOT_FOUND');
    await ctx.membership.chatAccess.insert({
      chatId: args.chatId,
      userId: target.userId,
      role: 'member',
      joinedAt: ctx.runtime.now(),
    });
    await rememberRoster(ctx, args.chatId, target.userId, 'member');
    await clearCut(ctx, args.chatId, target.handle);
    return { ok: true };
  },
});

export const removeChatMember = defineJsMutation({
  args: {
    chatId: v.id('chats'),
    handle: v.string(),
  },
  auth: 'authenticated',
  writes: ['chatMembers', 'chatRosterRows', 'chatCuts'],
  refusals: ['UNAUTHENTICATED', 'NOT_ADMIN', 'USER_NOT_FOUND', 'CHAT_NOT_FOUND'],
  result: results.value(v.object({ ok: v.boolean() })),
  handler: async (ctx, args) => {
    requireUser(ctx);
    const chat = await ctx.db.get('chats', args.chatId);
    if (!chat || chat.kind !== 'group') ctx.refuse('CHAT_NOT_FOUND');
    await requireAdmin(ctx, args.chatId);
    const target = await profileByHandleRow(ctx, normalizeHandle(args.handle));
    if (!target) ctx.refuse('USER_NOT_FOUND');
    const rows = await ctx.db.query('chatRosterRows').withIndex('by_chat_handle').eq('chatId', args.chatId).eq('handle', target.handle).take(1).collect();
    if (rows[0]) {
      await ctx.membership.chatAccess.removePrincipal(args.chatId, target.userId);
      await ctx.db.delete('chatRosterRows', rows[0]._id);
    }
    await rememberCut(ctx, args.chatId, target.userId, target.handle);
    return { ok: true };
  },
});

export const promoteChatMember = defineJsMutation({
  args: {
    chatId: v.id('chats'),
    handle: v.string(),
  },
  auth: 'authenticated',
  writes: ['chatMembers', 'chatRosterRows'],
  refusals: ['UNAUTHENTICATED', 'NOT_ADMIN', 'USER_NOT_FOUND', 'CHAT_NOT_FOUND'],
  result: results.value(v.object({ ok: v.boolean() })),
  handler: async (ctx, args) => {
    requireUser(ctx);
    await requireAdmin(ctx, args.chatId);
    const target = await profileByHandleRow(ctx, normalizeHandle(args.handle));
    if (!target) ctx.refuse('USER_NOT_FOUND');
    await rememberRoster(ctx, args.chatId, target.userId, 'admin');
    return { ok: true };
  },
});

export const leaveChat = defineJsMutation({
  args: { chatId: v.id('chats') },
  auth: 'authenticated',
  writes: ['chatMembers', 'chatRosterRows', 'chatCuts'],
  refusals: ['UNAUTHENTICATED', 'NOT_MEMBER'],
  result: results.value(v.object({ ok: v.boolean() })),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    const profile = await profileByUser(ctx, userId);
    await ctx.membership.chatAccess.removeSelf(args.chatId);
    if (profile) {
      const rows = await ctx.db.query('chatRosterRows').withIndex('by_chat_handle').eq('chatId', args.chatId).eq('handle', profile.handle).take(1).collect();
      if (rows[0]) await ctx.db.delete('chatRosterRows', rows[0]._id);
      await rememberCut(ctx, args.chatId, userId, profile.handle);
    }
    return { ok: true };
  },
});

export const sendText = defineJsMutation({
  args: {
    clientId: v.string(),
    chatId: v.id('chats'),
    text: v.string(),
    quoteId: v.optional(v.id('messages')),
  },
  auth: 'authenticated',
  writes: ['messages', 'chats', 'pushLogs', 'externalIds', 'appSettings', 'chatRosterRows', 'dmPairs', 'profiles'],
  refusals: ['UNAUTHENTICATED', 'NOT_MEMBER', 'INVALID_MESSAGE'],
  result: results.value(v.object({ messageId: v.id('messages') })),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    await requireMember(ctx, args.chatId);
    const text = clampText(args.text, 2000).trim();
    if (text.length < 1) ctx.refuse('INVALID_MESSAGE');
    const existing = await ctx.db.query('messages').withIndex('by_client').eq('clientId', args.clientId).take(1).collect();
    if (existing[0]) return { messageId: existing[0]._id };
    const now = ctx.runtime.now();
    const settings = await loadSettings(ctx);
    const chat = await ctx.db.get('chats', args.chatId);
    let expiresAt;
    if (chat?.disappearing === '24h') expiresAt = now + settings.disappear24hMs;
    if (chat?.disappearing === '7d') expiresAt = now + settings.disappear7dMs;
    const row = {
      clientId: args.clientId,
      chatId: args.chatId,
      senderId: userId,
      kind: 'text',
      text,
      createdAt: now,
      tombstoned: false,
      viewOnce: false,
      ...(expiresAt ? { expiresAt } : {}),
    };
    if (args.quoteId) row.quoteId = args.quoteId;
    const messageId = await ctx.db.insert('messages', row);
    if (chat) {
      await ctx.db.patch('chats', args.chatId, {
        lastPreview: previewFor('text', text),
        lastMessageAt: now,
      });
    }
    await rememberExternal(ctx, 'message', args.clientId, messageId);
    const me = await profileByUser(ctx, userId);
    await logPushForOthers(ctx, {
      chatId: args.chatId,
      senderId: userId,
      senderName: me?.displayName ?? 'member',
      preview: previewFor('text', text),
      kind: 'message',
      now,
    });
    return { messageId };
  },
});

export const sendMedia = defineJsMutation({
  args: {
    clientId: v.string(),
    chatId: v.id('chats'),
    mediaKind: v.string(),
    caption: v.optional(v.string()),
    image: v.optional(v.assetRef({ upload: 'publicImageUpload' })),
    video: v.optional(v.assetRef({ upload: 'publicVideoUpload' })),
    viewOnceImage: v.optional(v.assetRef({ upload: 'viewOnceImageUpload' })),
    viewOnce: v.optional(v.boolean()),
  },
  auth: 'authenticated',
  writes: ['messages', 'chats', 'pushLogs', 'externalIds', 'appSettings', 'chatRosterRows', 'dmPairs', 'profiles'],
  refusals: ['UNAUTHENTICATED', 'NOT_MEMBER', 'INVALID_MESSAGE'],
  result: results.value(v.object({ messageId: v.id('messages') })),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    await requireMember(ctx, args.chatId);
    const existing = await ctx.db.query('messages').withIndex('by_client').eq('clientId', args.clientId).take(1).collect();
    if (existing[0]) return { messageId: existing[0]._id };
    const viewOnce = !!args.viewOnce;
    const mediaKind = viewOnce ? 'view-once' : (args.mediaKind === 'video' ? 'video' : 'image');
    const now = ctx.runtime.now();
    const settings = await loadSettings(ctx);
    const chat = await ctx.db.get('chats', args.chatId);
    let expiresAt;
    if (chat?.disappearing === '24h') expiresAt = now + settings.disappear24hMs;
    if (chat?.disappearing === '7d') expiresAt = now + settings.disappear7dMs;
    const caption = clampText(args.caption ?? '', 500);
    const row = {
      clientId: args.clientId,
      chatId: args.chatId,
      senderId: userId,
      kind: mediaKind,
      text: caption,
      createdAt: now,
      tombstoned: false,
      viewOnce,
      ...(expiresAt ? { expiresAt } : {}),
    };
    if (mediaKind === 'video') {
      if (typeof args.video !== 'string') ctx.refuse('INVALID_MESSAGE');
      row.video = await ctx.assets.attach(args.video, { upload: 'publicVideoUpload' });
    } else if (viewOnce) {
      if (typeof args.viewOnceImage === 'string') {
        row.viewOnceImage = await ctx.assets.attach(args.viewOnceImage, { upload: 'viewOnceImageUpload' });
      } else if (typeof args.image === 'string') {
        try {
          row.image = await ctx.assets.attach(args.image, { upload: 'publicImageUpload' });
        } catch {
          /* public reuse is best-effort; view-once still records the caption */
        }
      }
    } else {
      if (typeof args.image !== 'string') ctx.refuse('INVALID_MESSAGE');
      row.image = await ctx.assets.attach(args.image, { upload: 'publicImageUpload' });
    }
    const messageId = await ctx.db.insert('messages', row);
    const me = await profileByUser(ctx, userId);
    await ctx.db.patch('chats', args.chatId, {
      lastPreview: previewFor(mediaKind, caption),
      lastMessageAt: now,
    });
    await rememberExternal(ctx, 'message', args.clientId, messageId);
    await logPushForOthers(ctx, {
      chatId: args.chatId,
      senderId: userId,
      senderName: me?.displayName ?? 'member',
      preview: previewFor(mediaKind, caption),
      kind: 'message',
      now,
    });
    return { messageId };
  },
});

export const setReaction = defineJsMutation({
  args: {
    messageId: v.id('messages'),
    emoji: v.string(),
    mutationId: v.string(),
  },
  auth: 'authenticated',
  writes: ['messageReactions'],
  refusals: ['UNAUTHENTICATED', 'NOT_MEMBER', 'MESSAGE_NOT_FOUND'],
  result: results.value(v.object({ emoji: v.string() })),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    const message = await ctx.db.get('messages', args.messageId);
    if (!message) ctx.refuse('MESSAGE_NOT_FOUND');
    await requireMember(ctx, message.chatId);
    const existing = await ctx.db.query('messageReactions').withIndex('by_message_user').eq('messageId', args.messageId).eq('userId', userId).take(1).collect();
    const emoji = args.emoji;
    if (emoji === 'none' || emoji === '') {
      if (existing[0]) await ctx.db.delete('messageReactions', existing[0]._id);
      return { emoji: '' };
    }
    if (existing[0]) {
      if (existing[0].emoji === emoji) {
        await ctx.db.delete('messageReactions', existing[0]._id);
        return { emoji: '' };
      }
      await ctx.db.patch('messageReactions', existing[0]._id, { emoji, mutationId: args.mutationId });
      return { emoji };
    }
    await ctx.db.insert('messageReactions', {
      messageId: args.messageId,
      chatId: message.chatId,
      userId,
      emoji,
      mutationId: args.mutationId,
    });
    return { emoji };
  },
});

export const editMessage = defineJsMutation({
  args: {
    messageId: v.id('messages'),
    text: v.string(),
  },
  auth: 'authenticated',
  writes: ['messages', 'appSettings'],
  refusals: ['UNAUTHENTICATED', 'NOT_OWNER', 'EDIT_WINDOW', 'MESSAGE_NOT_FOUND'],
  result: results.value(v.object({ ok: v.boolean() })),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    const message = await ctx.db.get('messages', args.messageId);
    if (!message) ctx.refuse('MESSAGE_NOT_FOUND');
    await requireMember(ctx, message.chatId);
    if (message.senderId !== userId) ctx.refuse('NOT_OWNER');
    if (message.tombstoned) ctx.refuse('MESSAGE_NOT_FOUND');
    const settings = await loadSettings(ctx);
    const now = ctx.runtime.now();
    if (now - message.createdAt > settings.editWindowMs) ctx.refuse('EDIT_WINDOW');
    await ctx.db.patch('messages', message._id, {
      text: clampText(args.text, message.kind === 'text' ? 2000 : 500),
      editedAt: now,
    });
    return { ok: true };
  },
});

export const deleteMessage = defineJsMutation({
  args: { messageId: v.id('messages') },
  auth: 'authenticated',
  writes: ['messages', 'appSettings'],
  refusals: ['UNAUTHENTICATED', 'NOT_OWNER', 'DELETE_WINDOW', 'MESSAGE_NOT_FOUND'],
  result: results.value(v.object({ ok: v.boolean() })),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    const message = await ctx.db.get('messages', args.messageId);
    if (!message) ctx.refuse('MESSAGE_NOT_FOUND');
    await requireMember(ctx, message.chatId);
    if (message.senderId !== userId) ctx.refuse('NOT_OWNER');
    const settings = await loadSettings(ctx);
    const now = ctx.runtime.now();
    if (now - message.createdAt > settings.deleteWindowMs) ctx.refuse('DELETE_WINDOW');
    await ctx.db.patch('messages', message._id, { tombstoned: true, text: '' });
    return { ok: true };
  },
});

export const markRead = defineJsMutation({
  args: { chatId: v.id('chats') },
  auth: 'authenticated',
  writes: ['receipts', 'messages'],
  refusals: ['UNAUTHENTICATED', 'NOT_MEMBER'],
  result: results.value(v.object({ ok: v.boolean() })),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    await requireMember(ctx, args.chatId);
    const now = ctx.runtime.now();
    const messages = await ctx.db.query('messages').withIndex('by_chat_created').eq('chatId', args.chatId).order('createdAt', 'desc').take(100).collect();
    for (const message of messages) {
      if (message.senderId === userId) continue;
      const existing = await ctx.db.query('receipts').withIndex('by_message_user').eq('messageId', message._id).eq('userId', userId).take(1).collect();
      if (existing[0]) {
        if (existing[0].state !== 'read') await ctx.db.patch('receipts', existing[0]._id, { state: 'read', updatedAt: now });
      } else {
        await ctx.db.insert('receipts', {
          messageId: message._id,
          chatId: args.chatId,
          userId,
          state: 'read',
          updatedAt: now,
        });
      }
    }
    return { ok: true };
  },
});

export const markDelivered = defineJsMutation({
  args: { chatId: v.id('chats') },
  auth: 'authenticated',
  writes: ['receipts', 'messages'],
  refusals: ['UNAUTHENTICATED', 'NOT_MEMBER'],
  result: results.value(v.object({ ok: v.boolean() })),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    await requireMember(ctx, args.chatId);
    const now = ctx.runtime.now();
    const messages = await ctx.db.query('messages').withIndex('by_chat_created').eq('chatId', args.chatId).order('createdAt', 'desc').take(100).collect();
    for (const message of messages) {
      if (message.senderId === userId) continue;
      const existing = await ctx.db.query('receipts').withIndex('by_message_user').eq('messageId', message._id).eq('userId', userId).take(1).collect();
      if (existing[0]) continue;
      await ctx.db.insert('receipts', {
        messageId: message._id,
        chatId: args.chatId,
        userId,
        state: 'delivered',
        updatedAt: now,
      });
    }
    return { ok: true };
  },
});

export const setChatSettings = defineJsMutation({
  args: {
    chatId: v.id('chats'),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    accent: v.optional(v.string()),
    background: v.optional(v.assetRef({ upload: 'publicImageUpload' })),
    disappearing: v.optional(v.string()),
  },
  auth: 'authenticated',
  writes: ['chats'],
  refusals: ['UNAUTHENTICATED', 'NOT_MEMBER', 'NOT_ADMIN', 'CHAT_NOT_FOUND'],
  result: results.value(v.object({ ok: v.boolean() })),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    const chat = await ctx.db.get('chats', args.chatId);
    if (!chat) ctx.refuse('CHAT_NOT_FOUND');
    await requireMember(ctx, args.chatId);
    const patch = {};
    if (typeof args.name === 'string' || typeof args.description === 'string') {
      if (chat.kind === 'group') await requireAdmin(ctx, args.chatId);
      if (typeof args.name === 'string') patch.name = clampText(args.name, 50);
      if (typeof args.description === 'string') patch.description = clampText(args.description, 200);
    }
    if (typeof args.accent === 'string') patch.accent = args.accent;
    if (typeof args.disappearing === 'string') {
      if (chat.kind === 'group') await requireAdmin(ctx, args.chatId);
      patch.disappearing = args.disappearing;
    }
    if (typeof args.background === 'string') {
      patch.background = await ctx.assets.attach(args.background, { upload: 'publicImageUpload' });
    }
    await ctx.db.patch('chats', chat._id, patch);
    return { ok: true };
  },
});

export const openViewOnce = defineJsMutation({
  args: { messageId: v.id('messages') },
  auth: 'authenticated',
  writes: ['viewOnceViews'],
  refusals: ['UNAUTHENTICATED', 'NOT_MEMBER', 'ALREADY_OPENED', 'MESSAGE_NOT_FOUND'],
  result: results.value(v.object({ ok: v.boolean() })),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    const message = await ctx.db.get('messages', args.messageId);
    if (!message || !message.viewOnce) ctx.refuse('MESSAGE_NOT_FOUND');
    await requireMember(ctx, message.chatId);
    const existing = await ctx.db.query('viewOnceViews').withIndex('by_pair').eq('messageId', args.messageId).eq('userId', userId).take(1).collect();
    if (existing[0]) ctx.refuse('ALREADY_OPENED');
    await ctx.db.insert('viewOnceViews', { messageId: args.messageId });
    return { ok: true };
  },
});

export const applyGradingSettings = defineJsMutation({
  args: {
    editWindowMs: v.integer(),
    deleteWindowMs: v.integer(),
    disappear24hMs: v.integer(),
    disappear7dMs: v.integer(),
    digestPeriodMs: v.integer(),
    digestAnchorHourUtc: v.integer(),
    replayMode: v.boolean(),
  },
  auth: 'authenticated',
  writes: ['appSettings'],
  refusals: ['UNAUTHENTICATED'],
  result: results.value(v.object({ ok: v.boolean() })),
  handler: async (ctx, args) => {
    requireUser(ctx);
    const rows = await ctx.db.query('appSettings').withIndex('by_key').eq('key', 'default').take(1).collect();
    const values = {
      editWindowMs: args.editWindowMs,
      deleteWindowMs: args.deleteWindowMs,
      disappear24hMs: args.disappear24hMs,
      disappear7dMs: args.disappear7dMs,
      digestPeriodMs: args.digestPeriodMs,
      digestAnchorHourUtc: args.digestAnchorHourUtc,
      replayMode: args.replayMode,
    };
    if (rows[0]) await ctx.db.patch('appSettings', rows[0]._id, values);
    else await ctx.db.insert('appSettings', { key: 'default', ...values });
    return { ok: true };
  },
});

export const myChats = defineJsLiveQuery({
  args: {},
  auth: 'authenticated',
  reads: ['chatMembers', 'chats', 'profiles', 'messages', 'receipts'],
  result: results.records(v.object({
    chatId: v.id('chats'),
    clientId: v.string(),
    kind: v.string(),
    name: v.string(),
    lastPreview: v.string(),
    lastMessageAt: v.integer(),
    role: v.string(),
    disappearing: v.string(),
    accent: v.string(),
    unreadCount: v.integer(),
  }), { minItems: 0, maxItems: 200 }),
  handler: async (ctx) => {
    const userId = requireUser(ctx);
    const chats = await ctx.db.query('chats').withIndex('by_updated').order('lastMessageAt', 'desc').take(100).collect();
    const out = [];
    for (const chat of chats) {
      const latest = await ctx.db.query('messages').withIndex('by_chat_created').eq('chatId', chat._id).order('createdAt', 'desc').take(1).collect();
      const last = latest[0];
      let unreadCount = 0;
      if (last && String(last.senderId) !== String(userId) && !last.tombstoned) {
        const rec = await ctx.db.query('receipts').withIndex('by_message_user').eq('messageId', last._id).eq('userId', userId).take(1).collect();
        if (!rec[0] || rec[0].state !== 'read') unreadCount = 1;
      }
      out.push({
        chatId: chat._id,
        clientId: chat.clientId,
        kind: chat.kind,
        name: chat.name,
        lastPreview: chat.lastPreview,
        lastMessageAt: chat.lastMessageAt,
        role: 'member',
        disappearing: chat.disappearing,
        accent: chat.accent,
        unreadCount,
      });
    }
    return out;
  },
});

export const chatByClientId = defineJsLiveQuery({
  args: { clientId: v.string() },
  auth: 'authenticated',
  reads: ['chats', 'chatMembers'],
  result: results.documents('chats'),
  handler: async (ctx, args) => {
    requireUser(ctx);
    const byClient = await ctx.db.query('chats').withIndex('by_client').eq('clientId', args.clientId).take(1).collect();
    if (byClient[0]) return byClient;
    return await ctx.db.query('chats').withIndex('by_name').eq('name', args.clientId).take(1).collect();
  },
});

export const chatDetails = defineJsLiveQuery({
  args: { chatId: v.id('chats') },
  auth: 'authenticated',
  reads: ['chats', 'chatMembers'],
  result: results.documents('chats'),
  handler: async (ctx, args) => {
    requireUser(ctx);
    const chat = await ctx.db.get('chats', args.chatId);
    return chat ? [chat] : [];
  },
});

export const chatRoster = defineJsLiveQuery({
  args: { chatId: v.id('chats') },
  auth: 'authenticated',
  reads: ['chatMembers', 'profiles', 'chatRosterRows'],
  result: results.records(v.object({
    userId: v.string(),
    role: v.string(),
    handle: v.string(),
    displayName: v.string(),
  }), { minItems: 0, maxItems: 50 }),
  handler: async (ctx, args) => {
    requireUser(ctx);
    const members = await ctx.db.query('chatRosterRows').withIndex('by_chat').eq('chatId', args.chatId).take(50).collect();
    const out = [];
    for (const member of members) {
      out.push({
        userId: String(member.userId),
        role: member.role,
        handle: member.handle,
        displayName: member.displayName,
      });
    }
    return out;
  },
});

export const chatCutsForChat = defineJsLiveQuery({
  args: { chatId: v.id('chats') },
  auth: 'authenticated',
  reads: ['chatCuts'],
  result: results.records(v.object({
    handle: v.string(),
    userId: v.string(),
    cutAt: v.integer(),
  }), { minItems: 0, maxItems: 50 }),
  handler: async (ctx, args) => {
    requireUser(ctx);
    const rows = await ctx.db.query('chatCuts').withIndex('by_chat').eq('chatId', args.chatId).take(50).collect();
    return rows.map((row) => ({
      handle: row.handle,
      userId: String(row.userId),
      cutAt: row.cutAt,
    }));
  },
});

export const messagesForChat = defineJsLiveQuery({
  args: { chatId: v.id('chats'), cursor: v.optional(v.integer()) },
  auth: 'authenticated',
  reads: ['messages', 'chatMembers'],
  result: results.documents('messages'),
  handler: async (ctx, args) => {
    requireUser(ctx);
    let q = ctx.db.query('messages').withIndex('by_chat_created').eq('chatId', args.chatId).order('createdAt', 'desc');
    if (typeof args.cursor === 'number') q = q.lt('createdAt', args.cursor);
    return await q.take(200).collect();
  },
});

export const receiptsForChat = defineJsLiveQuery({
  args: { chatId: v.id('chats') },
  auth: 'authenticated',
  reads: ['receipts', 'chatMembers'],
  result: results.documents('receipts'),
  handler: async (ctx, args) => {
    requireUser(ctx);
    return await ctx.db.query('receipts').withIndex('by_chat').eq('chatId', args.chatId).take(400).collect();
  },
});

export const reactionsForChat = defineJsLiveQuery({
  args: { chatId: v.id('chats') },
  auth: 'authenticated',
  reads: ['messageReactions', 'chatMembers'],
  result: results.documents('messageReactions'),
  handler: async (ctx, args) => {
    requireUser(ctx);
    return await ctx.db.query('messageReactions').withIndex('by_chat').eq('chatId', args.chatId).take(400).collect();
  },
});

export const myPushLogs = defineJsLiveQuery({
  args: {},
  auth: 'authenticated',
  reads: ['pushLogs'],
  result: results.documents('pushLogs'),
  handler: async (ctx) => {
    const userId = requireUser(ctx);
    return await ctx.db.query('pushLogs').withIndex('by_target_created').eq('targetUserId', userId).order('createdAt', 'desc').take(50).collect();
  },
});

export const resolveExternal = defineJsQuery({
  args: { kind: v.string(), externalId: v.string() },
  auth: 'authenticated',
  reads: ['externalIds'],
  result: results.documents('externalIds'),
  handler: async (ctx, args) => {
    requireUser(ctx);
    return await ctx.db.query('externalIds').withIndex('by_external').eq('kind', args.kind).eq('externalId', args.externalId).take(1).collect();
  },
});

export const insightsForMe = defineJsQuery({
  args: {},
  auth: 'authenticated',
  reads: ['profiles', 'dailyStats'],
  result: results.records(v.object({
    posts: v.integer(),
    likesReceived: v.integer(),
    repostsReceived: v.integer(),
    repliesReceived: v.integer(),
    followers: v.integer(),
    following: v.integer(),
    dayUtc: v.integer(),
    dayPosts: v.integer(),
    dayLikes: v.integer(),
  }), { minItems: 0, maxItems: 8 }),
  handler: async (ctx) => {
    const userId = requireUser(ctx);
    const me = await profileByUser(ctx, userId);
    if (!me) return [];
    const now = ctx.runtime.now();
    const days = [];
    for (let i = 0; i < 7; i += 1) {
      days.push(utcDay(now - i * 86400000));
    }
    const stats = await ctx.db.query('dailyStats').withIndex('by_user_day').eq('userId', userId).take(14).collect();
    const out = [];
    for (const dayUtc of days) {
      let dayPosts = 0;
      let dayLikes = 0;
      for (const row of stats) {
        if (row.dayUtc === dayUtc) {
          dayPosts = row.postsCreated;
          dayLikes = row.likesReceived;
        }
      }
      out.push({
        posts: me.postCount,
        likesReceived: me.likesReceived,
        repostsReceived: me.repostsReceived,
        repliesReceived: me.repliesReceived,
        followers: me.followerCount,
        following: me.followingCount,
        dayUtc,
        dayPosts,
        dayLikes,
      });
    }
    return out;
  },
});

export const trending = defineJsQuery({
  args: {},
  auth: 'public',
  reads: ['posts', 'profiles'],
  result: results.records(v.object({
    postId: v.id('posts'),
    body: v.string(),
    likeCount: v.integer(),
    createdAt: v.integer(),
    authorHandle: v.string(),
    authorName: v.string(),
    authorId: v.string(),
    replyCount: v.integer(),
    repostCount: v.integer(),
  }), { minItems: 0, maxItems: 10 }),
  handler: async (ctx) => {
    const now = ctx.runtime.now();
    const cutoff = now - 86400000;
    const rows = await ctx.db.query('posts').withIndex('by_created').gt('createdAt', cutoff).order('createdAt', 'desc').take(200).collect();
    const originals = rows.filter((row) => !row.isReply);
    originals.sort((a, b) => b.likeCount - a.likeCount || b.createdAt - a.createdAt);
    const top = originals.slice(0, 10);
    const out = [];
    for (const post of top) {
      const author = await profileByUser(ctx, post.authorId);
      out.push({
        postId: post._id,
        body: post.body,
        likeCount: post.likeCount,
        createdAt: post.createdAt,
        authorHandle: author?.handle ?? '',
        authorName: author?.displayName ?? '',
        authorId: post.authorId,
        replyCount: post.replyCount,
        repostCount: post.repostCount,
      });
    }
    return out;
  },
});

export const searchPeople = defineSearchQuery({
  auth: 'public',
  table: profiles,
  index: 'search_people',
});

export const searchMessages = defineSearchQuery({
  auth: 'authenticated',
  table: messages,
  index: 'search_messages',
  resourceArg: 'chatId',
});

export const sendVideoPost = defineCommand({
  mutation: createPost,
  assets: {
    video: {
      intent: publicVideoUpload,
      optional: true,
      mutationArg: 'video',
    },
  },
});

export const saveProfile = defineCommand({
  mutation: upsertProfile,
  assets: {
    avatar: {
      intent: publicImageUpload,
      optional: true,
      mutationArg: 'avatar',
    },
  },
});

export const sendMediaImage = defineCommand({
  mutation: sendMedia,
  assets: {
    image: {
      intent: publicImageUpload,
      optional: true,
      mutationArg: 'image',
    },
  },
});

export const sendViewOnceImage = defineCommand({
  mutation: sendMedia,
  assets: {
    viewOnceImage: {
      intent: viewOnceImageUpload,
      optional: true,
      mutationArg: 'viewOnceImage',
    },
  },
});

export const sendMediaVideo = defineCommand({
  mutation: sendMedia,
  assets: {
    video: {
      intent: publicVideoUpload,
      optional: true,
      mutationArg: 'video',
    },
  },
});

export const conversation = defineSurface({
  params: { chatId: v.id('chats') },
  reads: {
    details: bind(chatDetails, { chatId: param('chatId') }),
    messages: bind(messagesForChat, { chatId: param('chatId') }),
    receipts: bind(receiptsForChat, { chatId: param('chatId') }),
    reactions: bind(reactionsForChat, { chatId: param('chatId') }),
    roster: bind(chatRoster, { chatId: param('chatId') }),
  },
  mutations: {
    sendText: bind(sendText, {
      chatId: param('chatId'),
      clientId: input('clientId'),
      text: input('text'),
      quoteId: input('quoteId'),
    }),
    markRead: bind(markRead, { chatId: param('chatId') }),
    markDelivered: bind(markDelivered, { chatId: param('chatId') }),
  },
  presence: {
    typing: bind(typing, { scope: { chatId: param('chatId') } }),
  },
});
