import {
  defineJsLiveQuery,
  defineJsMutation,
  results,
  v,
} from '@expo/snapback-codegen/define';

const postResult = v.object({
  _id: v.id('posts'),
  authorId: v.id('profiles'),
  authorHandle: v.string(),
  body: v.string(),
  createdAt: v.integer(),
  replyToId: v.optional(v.id('posts')),
  likeCount: v.integer(),
  replyCount: v.integer(),
  displayName: v.string(),
  avatarUrl: v.string(),
  verified: v.boolean(),
  liked: v.boolean(),
});

function normalizeHandle(value) {
  const handle = value.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/u.test(handle)) {
    throw new Error('Handles use 3 to 24 lowercase letters, numbers, or underscores');
  }
  return handle;
}

async function profileForPrincipal(ctx) {
  const profile = await ctx.db.query('profiles')
    .withIndex('by_principal')
    .eq('principal', ctx.auth.userId)
    .first();
  if (!profile) throw new Error('Complete your profile before using Knockoff');
  return profile;
}

export const ensureProfile = defineJsMutation({
  auth: 'authenticated',
  args: {
    handle: v.string(),
    displayName: v.string(),
    avatarUrl: v.string(),
  },
  result: results.value(v.object({
    _id: v.id('profiles'),
    handle: v.string(),
    created: v.boolean(),
  })),
  reads: ['profiles'],
  writes: ['profiles'],
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('profiles')
      .withIndex('by_principal')
      .eq('principal', ctx.auth.userId)
      .first();
    if (existing) return { _id: existing._id, handle: existing.handle, created: false };
    const handle = normalizeHandle(args.handle);
    const collision = await ctx.db.query('profiles').withIndex('by_handle').eq('handle', handle).first();
    if (collision) throw new Error('That handle is already in use');
    const displayName = args.displayName.trim().slice(0, 80) || handle;
    const _id = await ctx.db.insert('profiles', {
      principal: ctx.auth.userId,
      handle,
      displayName,
      bio: 'New here. Probably posting a knockoff of something.',
      avatarUrl: args.avatarUrl,
      verified: false,
      followers: 0,
    });
    return { _id, handle, created: true };
  },
});

export const timeline = defineJsLiveQuery({
  auth: 'authenticated',
  args: { limit: v.integer() },
  result: results.records(postResult),
  reads: ['posts', 'profiles', 'likes'],
  handler: async (ctx, args) => {
    const posts = await ctx.db.query('posts')
      .withIndex('by_created')
      .order('createdAt', 'desc')
      .take(Math.min(args.limit, 100))
      .collect();
    const profiles = await ctx.db.query('profiles').take(200).collect();
    const likes = await ctx.db.query('likes').take(1024).collect();
    return posts.map((post) => {
      const profile = profiles.find((item) => item._id === post.authorId);
      return {
        _id: post._id,
        authorId: post.authorId,
        authorHandle: profile?.handle ?? 'unknown',
        body: post.body,
        createdAt: post.createdAt,
        ...(post.replyToId ? { replyToId: post.replyToId } : {}),
        likeCount: post.likeCount,
        replyCount: post.replyCount,
        displayName: profile?.displayName ?? 'Unknown user',
        avatarUrl: profile?.avatarUrl ?? '',
        verified: profile?.verified ?? false,
        liked: likes.some((like) => like.postId === post._id && like.principal === ctx.auth.userId),
      };
    });
  },
});

export const profilePosts = defineJsLiveQuery({
  auth: 'authenticated',
  args: { handle: v.string() },
  result: results.records(postResult),
  reads: ['posts', 'profiles', 'likes'],
  handler: async (ctx, args) => {
    const profile = await ctx.db.query('profiles').withIndex('by_handle').eq('handle', args.handle).first();
    if (!profile) return [];
    const posts = await ctx.db.query('posts')
      .withIndex('by_author_created')
      .eq('authorId', profile._id)
      .order('createdAt', 'desc')
      .take(100)
      .collect();
    const likes = await ctx.db.query('likes').take(1024).collect();
    return posts.map((post) => ({
      _id: post._id,
      authorId: post.authorId,
      authorHandle: profile.handle,
      body: post.body,
      createdAt: post.createdAt,
      ...(post.replyToId ? { replyToId: post.replyToId } : {}),
      likeCount: post.likeCount,
      replyCount: post.replyCount,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      verified: profile.verified,
      liked: likes.some((like) => like.postId === post._id && like.principal === ctx.auth.userId),
    }));
  },
});

export const profiles = defineJsLiveQuery({
  auth: 'authenticated',
  args: {},
  result: results.documents('profiles'),
  reads: ['profiles'],
  handler: async (ctx) => ctx.db.query('profiles').take(200).collect(),
});

export const viewerProfile = defineJsLiveQuery({
  auth: 'authenticated',
  args: {},
  result: results.records(v.object({
    _id: v.id('profiles'),
    handle: v.string(),
    displayName: v.string(),
    avatarUrl: v.string(),
  }), { minItems: 0, maxItems: 1 }),
  reads: ['profiles'],
  handler: async (ctx) => {
    const profile = await ctx.db.query('profiles')
      .withIndex('by_principal')
      .eq('principal', ctx.auth.userId)
      .first();
    return profile ? [{
      _id: profile._id,
      handle: profile.handle,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
    }] : [];
  },
});

export const createPost = defineJsMutation({
  auth: 'authenticated',
  args: { body: v.string(), replyToId: v.optional(v.id('posts')) },
  result: results.value(v.id('posts')),
  reads: ['profiles', 'posts'],
  writes: ['posts'],
  handler: async (ctx, args) => {
    const profile = await profileForPrincipal(ctx);
    const body = args.body.trim();
    if (!body || body.length > 280) throw new Error('Posts must be between 1 and 280 characters');
    const id = await ctx.db.insert('posts', {
      authorId: profile._id,
      body,
      createdAt: ctx.runtime.now(),
      replyToId: args.replyToId,
      likeCount: 0,
      replyCount: 0,
    });
    if (args.replyToId) {
      const parent = await ctx.db.get('posts', args.replyToId);
      if (parent) await ctx.db.patch('posts', args.replyToId, { replyCount: parent.replyCount + 1 });
    }
    return id;
  },
});

export const toggleLike = defineJsMutation({
  auth: 'authenticated',
  args: { postId: v.id('posts') },
  result: results.value(v.object({ liked: v.boolean(), likeCount: v.integer() })),
  reads: ['posts', 'likes'],
  writes: ['posts', 'likes'],
  handler: async (ctx, args) => {
    const post = await ctx.db.get('posts', args.postId);
    if (!post) throw new Error('Post not found');
    const existing = await ctx.db.query('likes')
      .withIndex('by_post_principal')
      .eq('postId', args.postId)
      .eq('principal', ctx.auth.userId)
      .first();
    if (existing) {
      const likeCount = Math.max(0, post.likeCount - 1);
      await ctx.db.delete('likes', existing._id);
      await ctx.db.patch('posts', args.postId, { likeCount });
      return { liked: false, likeCount };
    }
    const likeCount = post.likeCount + 1;
    await ctx.db.insert('likes', { postId: args.postId, principal: ctx.auth.userId });
    await ctx.db.patch('posts', args.postId, { likeCount });
    return { liked: true, likeCount };
  },
});
