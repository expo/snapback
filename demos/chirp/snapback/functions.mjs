import { defineJsLiveQuery, defineJsMutation, results, v } from '@expo/snapback-codegen/define';

const postResult = v.object({
  _id: v.id('posts'),
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

export const timeline = defineJsLiveQuery({
  args: { limit: v.integer(), viewerHandle: v.string() },
  result: results.records(postResult),
  reads: ['posts', 'profiles', 'likes'],
  handler: async (ctx, args) => {
    const posts = await ctx.db.query('posts').withIndex('by_created').order('createdAt', 'desc').take(Math.min(args.limit, 100)).collect();
    const profiles = await ctx.db.query('profiles').take(100).collect();
    const likes = await ctx.db.query('likes').take(1024).collect();
    return posts.map((post) => {
      const profile = profiles.find((item) => item.handle === post.authorHandle);
      return { _id: post._id, authorHandle: post.authorHandle, body: post.body, createdAt: post.createdAt, ...(post.replyToId ? { replyToId: post.replyToId } : {}), likeCount: post.likeCount, replyCount: post.replyCount, displayName: profile?.displayName ?? post.authorHandle, avatarUrl: profile?.avatarUrl ?? '', verified: profile?.verified ?? false, liked: likes.some((like) => like.postId === post._id && like.userHandle === args.viewerHandle) };
    });
  },
});

export const profilePosts = defineJsLiveQuery({
  args: { handle: v.string(), viewerHandle: v.string() },
  result: results.records(postResult),
  reads: ['posts', 'profiles', 'likes'],
  handler: async (ctx, args) => {
    const posts = await ctx.db.query('posts').withIndex('by_author_created').eq('authorHandle', args.handle).order('createdAt', 'desc').take(100).collect();
    const profile = await ctx.db.query('profiles').withIndex('by_handle').eq('handle', args.handle).first();
    const likes = await ctx.db.query('likes').take(1024).collect();
    return posts.map((post) => ({ _id: post._id, authorHandle: post.authorHandle, body: post.body, createdAt: post.createdAt, ...(post.replyToId ? { replyToId: post.replyToId } : {}), likeCount: post.likeCount, replyCount: post.replyCount, displayName: profile?.displayName ?? post.authorHandle, avatarUrl: profile?.avatarUrl ?? '', verified: profile?.verified ?? false, liked: likes.some((like) => like.postId === post._id && like.userHandle === args.viewerHandle) }));
  },
});

export const profiles = defineJsLiveQuery({
  args: {}, result: results.documents('profiles'), reads: ['profiles'],
  handler: async (ctx) => ctx.db.query('profiles').take(100).collect(),
});

export const createPost = defineJsMutation({
  args: { authorHandle: v.string(), body: v.string(), replyToId: v.optional(v.id('posts')) },
  result: results.value(v.id('posts')),
  reads: ['posts'], writes: ['posts'],
  handler: async (ctx, args) => {
    const body = args.body.trim();
    if (!body || body.length > 280) throw new Error('Posts must be between 1 and 280 characters');
    const id = await ctx.db.insert('posts', { authorHandle: args.authorHandle, body, createdAt: ctx.runtime.now(), replyToId: args.replyToId, likeCount: 0, replyCount: 0 });
    if (args.replyToId) {
      const parent = await ctx.db.get('posts', args.replyToId);
      if (parent) await ctx.db.patch('posts', args.replyToId, { replyCount: parent.replyCount + 1 });
    }
    return id;
  },
});

export const toggleLike = defineJsMutation({
  args: { postId: v.id('posts'), userHandle: v.string() },
  result: results.value(v.object({ liked: v.boolean(), likeCount: v.integer() })), reads: ['posts', 'likes'], writes: ['posts', 'likes'],
  handler: async (ctx, args) => {
    const post = await ctx.db.get('posts', args.postId);
    if (!post) throw new Error('Post not found');
    const existing = await ctx.db.query('likes').withIndex('by_post_user').eq('postId', args.postId).eq('userHandle', args.userHandle).first();
    if (existing) {
      const likeCount = Math.max(0, post.likeCount - 1);
      await ctx.db.delete('likes', existing._id);
      await ctx.db.patch('posts', args.postId, { likeCount });
      return { liked: false, likeCount };
    }
    const likeCount = post.likeCount + 1;
    await ctx.db.insert('likes', args);
    await ctx.db.patch('posts', args.postId, { likeCount });
    return { liked: true, likeCount };
  },
});
