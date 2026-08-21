import { mutation, query, v } from './generated/server';

export const profiles = query({
  args: {}, returns: v.array(v.doc('profiles')), auth: 'public', reads: ['profiles'],
  handler: async (ctx) => ctx.db.query('profiles').take(1_024).collect(),
});

export const posts = query({
  args: {}, returns: v.array(v.doc('posts')), auth: 'public', reads: ['posts'],
  handler: async (ctx) => ctx.db.query('posts').take(1_024).collect(),
});

export const follows = query({
  args: {}, returns: v.array(v.doc('follows')), auth: 'public', reads: ['follows'],
  handler: async (ctx) => ctx.db.query('follows').take(1_024).collect(),
});

export const likes = query({
  args: {}, returns: v.array(v.doc('likes')), auth: 'public', reads: ['likes'],
  handler: async (ctx) => ctx.db.query('likes').take(1_024).collect(),
});

export const reposts = query({
  args: {}, returns: v.array(v.doc('reposts')), auth: 'public', reads: ['reposts'],
  handler: async (ctx) => ctx.db.query('reposts').take(1_024).collect(),
});

export const replies = query({
  args: {}, returns: v.array(v.doc('replies')), auth: 'public', reads: ['replies'],
  handler: async (ctx) => ctx.db.query('replies').take(1_024).collect(),
});

export const relationalState = query({
  args: {},
  returns: v.array(v.object({
    profiles: v.array(v.doc('profiles')),
    posts: v.array(v.doc('posts')),
    follows: v.array(v.doc('follows')),
    likes: v.array(v.doc('likes')),
    reposts: v.array(v.doc('reposts')),
    replies: v.array(v.doc('replies')),
  })),
  auth: 'public',
  reads: ['profiles', 'posts', 'follows', 'likes', 'reposts', 'replies'],
  handler: async (ctx) => {
    const [profiles, posts, follows, likes, reposts, replies] = await Promise.all([
      ctx.db.query('profiles').take(1_024).collect(),
      ctx.db.query('posts').take(1_024).collect(),
      ctx.db.query('follows').take(1_024).collect(),
      ctx.db.query('likes').take(1_024).collect(),
      ctx.db.query('reposts').take(1_024).collect(),
      ctx.db.query('replies').take(1_024).collect(),
    ]);
    return [{ profiles, posts, follows, likes, reposts, replies }];
  },
});

export const setState = mutation({
  args: { revision: v.integer(), enabled: v.boolean() },
  returns: v.object({ revision: v.integer(), changed: v.integer() }),
  auth: 'authenticated',
  reads: ['profiles', 'posts', 'follows', 'likes', 'reposts', 'replies'],
  writes: ['profiles', 'posts', 'follows', 'likes', 'reposts', 'replies'],
  handler: async (ctx, args) => {
    const existingProfiles = await ctx.db.query('profiles')
      .withIndex('by_owner').eq('ownerId', ctx.auth.userId).first();
    const existingPosts = await ctx.db.query('posts')
      .withIndex('by_owner').eq('ownerId', ctx.auth.userId).first();
    const existingFollows = await ctx.db.query('follows')
      .withIndex('by_owner').eq('ownerId', ctx.auth.userId).first();
    const existingLikes = await ctx.db.query('likes')
      .withIndex('by_owner').eq('ownerId', ctx.auth.userId).first();
    const existingReposts = await ctx.db.query('reposts')
      .withIndex('by_owner').eq('ownerId', ctx.auth.userId).first();
    const existingReplies = await ctx.db.query('replies')
      .withIndex('by_owner').eq('ownerId', ctx.auth.userId).first();
    const value = { revision: args.revision, enabled: args.enabled };
    if (existingProfiles) await ctx.db.patch('profiles', existingProfiles._id, value);
    else await ctx.db.insert('profiles', { ownerId: ctx.auth.userId, ...value });
    if (existingPosts) await ctx.db.patch('posts', existingPosts._id, value);
    else await ctx.db.insert('posts', { ownerId: ctx.auth.userId, ...value });
    if (existingFollows) await ctx.db.patch('follows', existingFollows._id, value);
    else await ctx.db.insert('follows', { ownerId: ctx.auth.userId, ...value });
    if (existingLikes) await ctx.db.patch('likes', existingLikes._id, value);
    else await ctx.db.insert('likes', { ownerId: ctx.auth.userId, ...value });
    if (existingReposts) await ctx.db.patch('reposts', existingReposts._id, value);
    else await ctx.db.insert('reposts', { ownerId: ctx.auth.userId, ...value });
    if (existingReplies) await ctx.db.patch('replies', existingReplies._id, value);
    else await ctx.db.insert('replies', { ownerId: ctx.auth.userId, ...value });
    return { revision: args.revision, changed: 6 };
  },
});
