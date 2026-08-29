import {
  arg,
  asc,
  authUserId,
  bind,
  defineJsMutation,
  defineLiveQuery,
  defineSurface,
  desc,
  eq,
  input,
  param,
  results,
  v,
} from '@expo/snapback-codegen/define';
import { typing } from './surface-model.mjs';

export const publicProfiles = defineLiveQuery({
  table: 'profiles', args: {}, auth: 'authenticated', order: [asc('handle')],
});

export const profileByHandle = defineLiveQuery({
  table: 'profiles', args: { handle: v.string() },
  filter: [eq('handle', arg('handle'))], index: 'by_handle',
  auth: 'authenticated',
});

export const myProfile = defineLiveQuery({
  table: 'profiles', args: {}, filter: [eq('ownerId', authUserId())],
  index: 'by_owner', auth: 'authenticated', authScopeField: 'ownerId',
});

export const publicFollows = defineLiveQuery({
  table: 'follows', args: {}, auth: 'authenticated',
});

export const globalPosts = defineLiveQuery({
  table: 'posts', args: {}, order: [desc('pageKey')], index: 'by_page_key',
  limit: 250, auth: 'authenticated',
});

export const allPostLikes = defineLiveQuery({
  table: 'postLikes', args: {}, auth: 'authenticated',
});

export const allReposts = defineLiveQuery({
  table: 'reposts', args: {}, auth: 'authenticated',
});

export const followingFeed = defineLiveQuery({
  table: 'feedEntries', args: {}, filter: [eq('ownerId', authUserId())],
  order: [desc('pageKey')], index: 'by_owner_page', auth: 'authenticated', authScopeField: 'ownerId', limit: 250,
});

export const myInbox = defineLiveQuery({
  table: 'inboxes', args: {}, filter: [eq('ownerId', authUserId())],
  order: [desc('pageKey')], index: 'by_owner_page', auth: 'authenticated', authScopeField: 'ownerId', limit: 250,
});

export const inboxForConversation = defineLiveQuery({
  table: 'inboxes', args: { conversationExternalId: v.string() },
  filter: [
    eq('ownerId', authUserId()),
    eq('conversationExternalId', arg('conversationExternalId')),
  ],
  index: 'by_owner_conversation', auth: 'authenticated', authScopeField: 'ownerId',
});

export const membershipsForConversation = defineLiveQuery({
  table: 'memberships', args: { conversationExternalId: v.string() },
  filter: [eq('conversationExternalId', arg('conversationExternalId'))],
  index: 'by_conversation', auth: 'authenticated',
});

export const messagesForConversation = defineLiveQuery({
  table: 'messageViews', args: { conversationExternalId: v.string() },
  filter: [
    eq('ownerId', authUserId()),
    eq('conversationExternalId', arg('conversationExternalId')),
  ],
  order: [asc('pageKey')], index: 'by_owner_conversation_page',
  auth: 'authenticated', authScopeField: 'ownerId', limit: 500,
});

export const recentMessagesForConversation = defineLiveQuery({
  table: 'messageViews', args: { conversationExternalId: v.string() },
  filter: [
    eq('ownerId', authUserId()),
    eq('conversationExternalId', arg('conversationExternalId')),
  ],
  order: [desc('pageKey')], index: 'by_owner_conversation_page',
  auth: 'authenticated', authScopeField: 'ownerId', limit: 100,
});

export const myMessages = defineLiveQuery({
  table: 'messageViews', args: {}, filter: [eq('ownerId', authUserId())],
  order: [desc('sentAt')], auth: 'authenticated', authScopeField: 'ownerId', limit: 100,
});

export const myMessageSearch = defineLiveQuery({
  table: 'messageSearchViews', args: {}, filter: [eq('ownerId', authUserId())],
  order: [desc('sentAt')], index: 'by_owner_sent',
  auth: 'authenticated', authScopeField: 'ownerId', limit: 500,
});

export const myNotifications = defineLiveQuery({
  table: 'notifications', args: {}, filter: [eq('ownerId', authUserId())],
  order: [desc('createdAt')], index: 'by_owner_created', auth: 'authenticated', authScopeField: 'ownerId', limit: 100,
});

export const myInsights = defineLiveQuery({
  table: 'insights', args: {}, filter: [eq('ownerId', authUserId())],
  index: 'by_owner', auth: 'authenticated', authScopeField: 'ownerId',
});

export const myActivityDays = defineLiveQuery({
  table: 'activityDays', args: {}, filter: [eq('ownerId', authUserId())],
  order: [desc('dayKey')], index: 'by_owner_day', auth: 'authenticated', authScopeField: 'ownerId', limit: 7,
});

export const upsertProfile = defineJsMutation({
  args: {
    email: v.string(), handle: v.string(), displayName: v.string(), bio: v.string(),
    location: v.string(), link: v.string(), avatarUri: v.string(),
  },
  auth: 'authenticated', reads: ['profiles', 'insights'], writes: ['profiles', 'insights'],
  result: results.value(v.string()),
  handler: async (ctx, args) => {
    const ownerId = ctx.auth.userId;
    if (!/^[a-z0-9_]{3,20}$/.test(args.handle)) throw new Error('HANDLE_INVALID');
    if (args.displayName.trim().length < 1 || args.displayName.length > 50) throw new Error('DISPLAY_NAME_INVALID');
    if (args.bio.length > 200 || args.location.length > 50) throw new Error('PROFILE_LIMIT');
    const occupied = await ctx.db.query('profiles').withIndex('by_handle').eq('handle', args.handle).first();
    if (occupied && occupied.ownerId !== ownerId) throw new Error('HANDLE_TAKEN');
    const existing = await ctx.db.query('profiles').withIndex('by_owner').eq('ownerId', ownerId).first();
    const now = ctx.runtime.now();
    if (existing) {
      await ctx.db.patch('profiles', existing._id, { ...args, updatedAt: now });
    } else {
      await ctx.db.insert('profiles', {
        ownerId, ...args, followerCount: 0, followingCount: 0, createdAt: now, updatedAt: now,
      });
      await ctx.db.insert('insights', {
        ownerId, posts: 0, likesReceived: 0, repostsReceived: 0, repliesReceived: 0,
        followers: 0, following: 0, updatedAt: now,
      });
    }
    return args.handle;
  },
});

export const setFollow = defineJsMutation({
  args: { targetHandle: v.string(), state: v.string(), mutationId: v.string() },
  auth: 'authenticated',
  reads: ['profiles', 'follows', 'posts', 'feedEntries', 'mutationIntents', 'insights'],
  writes: ['profiles', 'follows', 'feedEntries', 'mutationIntents', 'insights'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    const ownerId = ctx.auth.userId;
    const intentKey = `${ownerId}:${args.mutationId}`;
    const priorIntent = await ctx.db.query('mutationIntents').withIndex('by_intent_key').eq('intentKey', intentKey).first();
    if (priorIntent) return priorIntent.result === 'true';
    const mine = await ctx.db.query('profiles').withIndex('by_owner').eq('ownerId', ownerId).first();
    const target = await ctx.db.query('profiles').withIndex('by_handle').eq('handle', args.targetHandle).first();
    if (!mine || !target) throw new Error('PROFILE_NOT_FOUND');
    if (target.ownerId === ownerId) throw new Error('SELF_FOLLOW_FORBIDDEN');
    const edgeKey = `${ownerId}:${target.ownerId}`;
    const existing = await ctx.db.query('follows').withIndex('by_edge').eq('edgeKey', edgeKey).first();
    const shouldExist = args.state === 'set';
    const now = ctx.runtime.now();
    if (shouldExist && !existing) {
      await ctx.db.insert('follows', {
        edgeKey, followerId: ownerId, followeeId: target.ownerId,
        followerHandle: mine.handle, followeeHandle: target.handle, createdAt: now,
      });
      await ctx.db.patch('profiles', mine._id, { followingCount: mine.followingCount + 1, updatedAt: now });
      await ctx.db.patch('profiles', target._id, { followerCount: target.followerCount + 1, updatedAt: now });
      const mineInsight = await ctx.db.query('insights').withIndex('by_owner').eq('ownerId', ownerId).first();
      const targetInsight = await ctx.db.query('insights').withIndex('by_owner').eq('ownerId', target.ownerId).first();
      if (mineInsight) await ctx.db.patch('insights', mineInsight._id, { following: mine.followingCount + 1, updatedAt: now });
      if (targetInsight) await ctx.db.patch('insights', targetInsight._id, { followers: target.followerCount + 1, updatedAt: now });
      const targetPosts = await ctx.db.query('posts').withIndex('by_author_page').eq('authorId', target.ownerId).collect();
      for (const post of targetPosts) {
        if (!post.isReply) {
          const entryKey = `${ownerId}:direct:${post.externalId}`;
          const oldEntry = await ctx.db.query('feedEntries').withIndex('by_entry').eq('entryKey', entryKey).first();
          if (!oldEntry) await ctx.db.insert('feedEntries', {
            ownerId, entryKey, postExternalId: post.externalId,
            projectedAuthorId: target.ownerId, repostedById: '', repostedByHandle: '', pageKey: post.pageKey,
          });
        }
      }
    }
    if (!shouldExist && existing) {
      await ctx.db.delete('follows', existing._id);
      await ctx.db.patch('profiles', mine._id, { followingCount: Math.max(0, mine.followingCount - 1), updatedAt: now });
      await ctx.db.patch('profiles', target._id, { followerCount: Math.max(0, target.followerCount - 1), updatedAt: now });
      const entries = await ctx.db.query('feedEntries').withIndex('by_owner_author').eq('ownerId', ownerId).eq('projectedAuthorId', target.ownerId).collect();
      for (const entry of entries) {
        if (!entry.repostedById) await ctx.db.delete('feedEntries', entry._id);
      }
      const mineInsight = await ctx.db.query('insights').withIndex('by_owner').eq('ownerId', ownerId).first();
      const targetInsight = await ctx.db.query('insights').withIndex('by_owner').eq('ownerId', target.ownerId).first();
      if (mineInsight) await ctx.db.patch('insights', mineInsight._id, { following: Math.max(0, mine.followingCount - 1), updatedAt: now });
      if (targetInsight) await ctx.db.patch('insights', targetInsight._id, { followers: Math.max(0, target.followerCount - 1), updatedAt: now });
    }
    await ctx.db.insert('mutationIntents', { ownerId, mutationId: args.mutationId, intentKey, result: String(shouldExist), createdAt: now });
    return shouldExist;
  },
});

export const createPost = defineJsMutation({
  args: {
    externalId: v.string(), type: v.string(), text: v.string(), mediaUri1: v.string(),
    mediaUri2: v.string(), parentExternalId: v.string(),
  },
  auth: 'authenticated',
  reads: ['profiles', 'posts', 'follows', 'feedEntries', 'insights', 'activityDays'],
  writes: ['posts', 'feedEntries', 'insights', 'activityDays'],
  result: results.value(v.string()),
  handler: async (ctx, args) => {
    const ownerId = ctx.auth.userId;
    const prior = await ctx.db.query('posts').withIndex('by_external_id').eq('externalId', args.externalId).first();
    if (prior) return prior.externalId;
    const profile = await ctx.db.query('profiles').withIndex('by_owner').eq('ownerId', ownerId).first();
    if (!profile) throw new Error('PROFILE_REQUIRED');
    if (args.text.length > 500) throw new Error('POST_TOO_LONG');
    const now = ctx.runtime.now();
    const pageKey = `${String(now).padStart(16, '0')}:${ctx.runtime.id()}`;
    const isReply = args.parentExternalId.length > 0;
    await ctx.db.insert('posts', {
      externalId: args.externalId, authorId: ownerId, authorHandle: profile.handle,
      authorName: profile.displayName, authorAvatarUri: profile.avatarUri, type: args.type,
      text: args.text, mediaUri1: args.mediaUri1, mediaUri2: args.mediaUri2,
      parentExternalId: args.parentExternalId, isReply,
      likeCount: 0, repostCount: 0, replyCount: 0, createdAt: now, pageKey,
    });
    const insight = await ctx.db.query('insights').withIndex('by_owner').eq('ownerId', ownerId).first();
    if (isReply) {
      const parent = await ctx.db.query('posts').withIndex('by_external_id').eq('externalId', args.parentExternalId).first();
      if (!parent) throw new Error('PARENT_POST_NOT_FOUND');
      await ctx.db.patch('posts', parent._id, { replyCount: parent.replyCount + 1 });
      if (insight) await ctx.db.patch('insights', insight._id, { repliesReceived: insight.repliesReceived, updatedAt: now });
      const parentInsight = await ctx.db.query('insights').withIndex('by_owner').eq('ownerId', parent.authorId).first();
      if (parentInsight) await ctx.db.patch('insights', parentInsight._id, { repliesReceived: parentInsight.repliesReceived + 1, updatedAt: now });
    } else {
      const recipients = new Set([ownerId]);
      const followers = await ctx.db.query('follows').withIndex('by_followee').eq('followeeId', ownerId).collect();
      for (const follower of followers) recipients.add(follower.followerId);
      for (const recipientId of recipients) {
        await ctx.db.insert('feedEntries', {
          ownerId: recipientId, entryKey: `${recipientId}:direct:${args.externalId}`,
          postExternalId: args.externalId, projectedAuthorId: ownerId,
          repostedById: '', repostedByHandle: '', pageKey,
        });
      }
      if (insight) await ctx.db.patch('insights', insight._id, { posts: insight.posts + 1, updatedAt: now });
      const dayKey = String(Math.floor(now / 86400000));
      const rowKey = `${ownerId}:${dayKey}`;
      const day = await ctx.db.query('activityDays').withIndex('by_row_key').eq('rowKey', rowKey).first();
      if (day) await ctx.db.patch('activityDays', day._id, { posts: day.posts + 1 });
      else await ctx.db.insert('activityDays', { ownerId, dayKey, rowKey, posts: 1, likesReceived: 0 });
    }
    return args.externalId;
  },
});

export const setPostLike = defineJsMutation({
  args: { postExternalId: v.string(), state: v.string(), mutationId: v.string() },
  auth: 'authenticated', reads: ['profiles', 'posts', 'postLikes', 'mutationIntents', 'insights', 'activityDays'],
  writes: ['posts', 'postLikes', 'mutationIntents', 'insights', 'activityDays'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    const ownerId = ctx.auth.userId;
    const intentKey = `${ownerId}:${args.mutationId}`;
    const priorIntent = await ctx.db.query('mutationIntents').withIndex('by_intent_key').eq('intentKey', intentKey).first();
    if (priorIntent) return priorIntent.result === 'true';
    const post = await ctx.db.query('posts').withIndex('by_external_id').eq('externalId', args.postExternalId).first();
    const profile = await ctx.db.query('profiles').withIndex('by_owner').eq('ownerId', ownerId).first();
    if (!post || !profile) throw new Error('POST_NOT_FOUND');
    const edgeKey = `${ownerId}:${post.externalId}`;
    const existing = await ctx.db.query('postLikes').withIndex('by_edge').eq('edgeKey', edgeKey).first();
    const shouldExist = args.state === 'set';
    const now = ctx.runtime.now();
    if (shouldExist && !existing) {
      await ctx.db.insert('postLikes', { edgeKey, postExternalId: post.externalId, userId: ownerId, userHandle: profile.handle, createdAt: now });
      await ctx.db.patch('posts', post._id, { likeCount: post.likeCount + 1 });
      const insight = await ctx.db.query('insights').withIndex('by_owner').eq('ownerId', post.authorId).first();
      if (insight) await ctx.db.patch('insights', insight._id, { likesReceived: insight.likesReceived + 1, updatedAt: now });
      const dayKey = String(Math.floor(now / 86400000));
      const rowKey = `${post.authorId}:${dayKey}`;
      const day = await ctx.db.query('activityDays').withIndex('by_row_key').eq('rowKey', rowKey).first();
      if (day) await ctx.db.patch('activityDays', day._id, { likesReceived: day.likesReceived + 1 });
      else await ctx.db.insert('activityDays', { ownerId: post.authorId, dayKey, rowKey, posts: 0, likesReceived: 1 });
    }
    if (!shouldExist && existing) {
      await ctx.db.delete('postLikes', existing._id);
      await ctx.db.patch('posts', post._id, { likeCount: Math.max(0, post.likeCount - 1) });
      const insight = await ctx.db.query('insights').withIndex('by_owner').eq('ownerId', post.authorId).first();
      if (insight) await ctx.db.patch('insights', insight._id, { likesReceived: Math.max(0, insight.likesReceived - 1), updatedAt: now });
    }
    await ctx.db.insert('mutationIntents', { ownerId, mutationId: args.mutationId, intentKey, result: String(shouldExist), createdAt: now });
    return shouldExist;
  },
});

export const setRepost = defineJsMutation({
  args: { postExternalId: v.string(), state: v.string(), mutationId: v.string() },
  auth: 'authenticated', reads: ['profiles', 'posts', 'reposts', 'feedEntries', 'mutationIntents', 'follows', 'insights'],
  writes: ['posts', 'reposts', 'feedEntries', 'mutationIntents', 'insights'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    const ownerId = ctx.auth.userId;
    const intentKey = `${ownerId}:${args.mutationId}`;
    const priorIntent = await ctx.db.query('mutationIntents').withIndex('by_intent_key').eq('intentKey', intentKey).first();
    if (priorIntent) return priorIntent.result === 'true';
    const post = await ctx.db.query('posts').withIndex('by_external_id').eq('externalId', args.postExternalId).first();
    const profile = await ctx.db.query('profiles').withIndex('by_owner').eq('ownerId', ownerId).first();
    if (!post || !profile || post.isReply) throw new Error('POST_NOT_FOUND');
    const edgeKey = `${ownerId}:${post.externalId}`;
    const existing = await ctx.db.query('reposts').withIndex('by_edge').eq('edgeKey', edgeKey).first();
    const shouldExist = args.state === 'set';
    const now = ctx.runtime.now();
    if (shouldExist && !existing) {
      const pageKey = `${String(now).padStart(16, '0')}:${ctx.runtime.id()}`;
      await ctx.db.insert('reposts', { edgeKey, postExternalId: post.externalId, userId: ownerId, userHandle: profile.handle, userName: profile.displayName, createdAt: now, pageKey });
      await ctx.db.patch('posts', post._id, { repostCount: post.repostCount + 1 });
      const recipients = new Set([ownerId]);
      const followers = await ctx.db.query('follows').withIndex('by_followee').eq('followeeId', ownerId).collect();
      for (const follower of followers) recipients.add(follower.followerId);
      for (const recipientId of recipients) await ctx.db.insert('feedEntries', {
        ownerId: recipientId, entryKey: `${recipientId}:repost:${ownerId}:${post.externalId}`,
        postExternalId: post.externalId, projectedAuthorId: post.authorId,
        repostedById: ownerId, repostedByHandle: profile.handle, pageKey,
      });
      const insight = await ctx.db.query('insights').withIndex('by_owner').eq('ownerId', post.authorId).first();
      if (insight) await ctx.db.patch('insights', insight._id, { repostsReceived: insight.repostsReceived + 1, updatedAt: now });
    }
    if (!shouldExist && existing) {
      await ctx.db.delete('reposts', existing._id);
      await ctx.db.patch('posts', post._id, { repostCount: Math.max(0, post.repostCount - 1) });
      const entries = await ctx.db.query('feedEntries').withIndex('by_reposter_post').eq('repostedById', ownerId).eq('postExternalId', post.externalId).collect();
      for (const entry of entries) await ctx.db.delete('feedEntries', entry._id);
      const insight = await ctx.db.query('insights').withIndex('by_owner').eq('ownerId', post.authorId).first();
      if (insight) await ctx.db.patch('insights', insight._id, { repostsReceived: Math.max(0, insight.repostsReceived - 1), updatedAt: now });
    }
    await ctx.db.insert('mutationIntents', { ownerId, mutationId: args.mutationId, intentKey, result: String(shouldExist), createdAt: now });
    return shouldExist;
  },
});

export const ensureDm = defineJsMutation({
  args: { otherHandle: v.string() }, auth: 'authenticated',
  reads: ['profiles', 'conversations', 'memberships', 'inboxes'],
  writes: ['conversations', 'memberships', 'inboxes'], result: results.value(v.string()),
  handler: async (ctx, args) => {
    const ownerId = ctx.auth.userId;
    const mine = await ctx.db.query('profiles').withIndex('by_owner').eq('ownerId', ownerId).first();
    const other = await ctx.db.query('profiles').withIndex('by_handle').eq('handle', args.otherHandle).first();
    if (!mine || !other || other.ownerId === ownerId) throw new Error('DM_TARGET_INVALID');
    const dmKey = [ownerId, other.ownerId].sort().join(':');
    let conversation = await ctx.db.query('conversations').withIndex('by_dm_key').eq('dmKey', dmKey).first();
    const now = ctx.runtime.now();
    if (!conversation) {
      const externalId = `dm-${[mine.handle, other.handle].sort().join('-')}`;
      await ctx.db.insert('conversations', {
        externalId, dmKey, kind: 'dm', name: '', description: '', createdBy: ownerId,
        accent: 'indigo', backgroundUri: '', disappearing: 'off', updatedAt: now, createdAt: now,
      });
      conversation = await ctx.db.query('conversations').withIndex('by_external_id').eq('externalId', externalId).first();
    }
    for (const pair of [[mine, other], [other, mine]]) {
      const member = pair[0]; const counterpart = pair[1];
      const edgeKey = `${conversation.externalId}:${member.ownerId}`;
      const oldMember = await ctx.db.query('memberships').withIndex('by_edge').eq('edgeKey', edgeKey).first();
      if (!oldMember) await ctx.db.insert('memberships', {
        edgeKey, conversationExternalId: conversation.externalId, userId: member.ownerId,
        userHandle: member.handle, userName: member.displayName, avatarUri: member.avatarUri,
        role: 'member', active: true, joinedAt: now,
      });
      const inboxKey = `${member.ownerId}:${conversation.externalId}`;
      const oldInbox = await ctx.db.query('inboxes').withIndex('by_inbox_key').eq('inboxKey', inboxKey).first();
      if (!oldInbox) await ctx.db.insert('inboxes', {
        ownerId: member.ownerId, inboxKey, conversationExternalId: conversation.externalId,
        identity: `dm:${counterpart.handle}`, kind: 'dm', title: counterpart.displayName,
        description: '', counterpartHandle: counterpart.handle, avatarUri: counterpart.avatarUri,
        accent: conversation.accent, backgroundUri: conversation.backgroundUri,
        disappearing: conversation.disappearing, role: 'member', preview: '', unreadCount: 0,
        messageCount: 0, updatedAt: now, pageKey: `${String(now).padStart(16, '0')}:${conversation.externalId}`,
      });
    }
    return conversation.externalId;
  },
});

export const createGroup = defineJsMutation({
  args: { externalId: v.string(), name: v.string(), description: v.string(), memberHandles: v.array(v.string()) },
  auth: 'authenticated', reads: ['profiles', 'conversations', 'memberships', 'inboxes'],
  writes: ['conversations', 'memberships', 'inboxes'], result: results.value(v.string()),
  handler: async (ctx, args) => {
    const ownerId = ctx.auth.userId;
    const prior = await ctx.db.query('conversations').withIndex('by_external_id').eq('externalId', args.externalId).first();
    if (prior) return prior.externalId;
    const creator = await ctx.db.query('profiles').withIndex('by_owner').eq('ownerId', ownerId).first();
    if (!creator) throw new Error('PROFILE_REQUIRED');
    const now = ctx.runtime.now();
    await ctx.db.insert('conversations', {
      externalId: args.externalId, dmKey: `group:${args.externalId}`, kind: 'group', name: args.name,
      description: args.description, createdBy: ownerId, accent: 'indigo', backgroundUri: '',
      disappearing: 'off', updatedAt: now, createdAt: now,
    });
    const members = [creator];
    for (const handle of args.memberHandles) {
      const profile = await ctx.db.query('profiles').withIndex('by_handle').eq('handle', handle).first();
      if (profile && !members.some((member) => member.ownerId === profile.ownerId)) members.push(profile);
    }
    if (members.length < 2 || members.length > 50) throw new Error('GROUP_SIZE_INVALID');
    for (const member of members) {
      const role = member.ownerId === ownerId ? 'admin' : 'member';
      await ctx.db.insert('memberships', {
        edgeKey: `${args.externalId}:${member.ownerId}`, conversationExternalId: args.externalId,
        userId: member.ownerId, userHandle: member.handle, userName: member.displayName,
        avatarUri: member.avatarUri, role, active: true, joinedAt: now,
      });
      await ctx.db.insert('inboxes', {
        ownerId: member.ownerId, inboxKey: `${member.ownerId}:${args.externalId}`,
        conversationExternalId: args.externalId, identity: `group:${args.name.toLowerCase().replace(/\s+/g, '-')}`,
        kind: 'group', title: args.name, description: args.description, counterpartHandle: '', avatarUri: '',
        accent: 'indigo', backgroundUri: '', disappearing: 'off', role, preview: '', unreadCount: 0,
        messageCount: 0, updatedAt: now, pageKey: `${String(now).padStart(16, '0')}:${args.externalId}`,
      });
    }
    return args.externalId;
  },
});

export const changeMember = defineJsMutation({
  args: { conversationExternalId: v.string(), targetHandle: v.string(), action: v.string(), mutationId: v.string() },
  auth: 'authenticated', reads: ['profiles', 'memberships', 'inboxes', 'messages', 'messageViews', 'mutationIntents'],
  writes: ['memberships', 'inboxes', 'messageViews', 'mutationIntents'], result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    const ownerId = ctx.auth.userId;
    const intentKey = `${ownerId}:${args.mutationId}`;
    const priorIntent = await ctx.db.query('mutationIntents').withIndex('by_intent_key').eq('intentKey', intentKey).first();
    if (priorIntent) return true;
    const actorMember = await ctx.db.query('memberships').withIndex('by_edge').eq('edgeKey', `${args.conversationExternalId}:${ownerId}`).first();
    if (!actorMember || !actorMember.active) throw new Error('NOT_A_MEMBER');
    const targetProfile = await ctx.db.query('profiles').withIndex('by_handle').eq('handle', args.targetHandle).first();
    if (!targetProfile) throw new Error('PROFILE_NOT_FOUND');
    let target = await ctx.db.query('memberships').withIndex('by_edge').eq('edgeKey', `${args.conversationExternalId}:${targetProfile.ownerId}`).first();
    const now = ctx.runtime.now();
    if (args.action !== 'leave' && actorMember.role !== 'admin') throw new Error('ADMIN_REQUIRED');
    if (args.action === 'add') {
      if (target) await ctx.db.patch('memberships', target._id, { active: true, role: 'member', joinedAt: now });
      else {
        await ctx.db.insert('memberships', {
          edgeKey: `${args.conversationExternalId}:${targetProfile.ownerId}`,
          conversationExternalId: args.conversationExternalId, userId: targetProfile.ownerId,
          userHandle: targetProfile.handle, userName: targetProfile.displayName,
          avatarUri: targetProfile.avatarUri, role: 'member', active: true, joinedAt: now,
        });
      }
      const inboxKey = `${targetProfile.ownerId}:${args.conversationExternalId}`;
      const oldInbox = await ctx.db.query('inboxes').withIndex('by_inbox_key').eq('inboxKey', inboxKey).first();
      const actorInbox = await ctx.db.query('inboxes').withIndex('by_inbox_key').eq('inboxKey', `${ownerId}:${args.conversationExternalId}`).first();
      if (!oldInbox && actorInbox) await ctx.db.insert('inboxes', {
        ownerId: targetProfile.ownerId, inboxKey,
        conversationExternalId: actorInbox.conversationExternalId, identity: actorInbox.identity,
        kind: actorInbox.kind, title: actorInbox.title, description: actorInbox.description,
        counterpartHandle: actorInbox.counterpartHandle, avatarUri: actorInbox.avatarUri,
        accent: actorInbox.accent, backgroundUri: actorInbox.backgroundUri,
        disappearing: actorInbox.disappearing, role: 'member', preview: actorInbox.preview,
        unreadCount: 0, messageCount: actorInbox.messageCount, updatedAt: actorInbox.updatedAt,
        pageKey: actorInbox.pageKey,
      });
      const history = await ctx.db.query('messages').withIndex('by_conversation_page').eq('conversationExternalId', args.conversationExternalId).collect();
      for (const message of history) {
        const oldView = await ctx.db.query('messageViews').withIndex('by_view_key').eq('viewKey', `${targetProfile.ownerId}:${message.externalId}`).first();
        if (!oldView) await ctx.db.insert('messageViews', {
          ownerId: targetProfile.ownerId, viewKey: `${targetProfile.ownerId}:${message.externalId}`,
          externalId: message.externalId, conversationExternalId: message.conversationExternalId,
          senderId: message.senderId, senderHandle: message.senderHandle, senderName: message.senderName,
          senderAvatarUri: message.senderAvatarUri, type: message.type, text: message.text,
          mediaUri: message.viewOnce ? '' : message.mediaUri, mediaKind: message.mediaKind,
          viewOnce: message.viewOnce, viewOnceState: message.viewOnce ? 'unopened' : '',
          replyToExternalId: message.replyToExternalId, replySenderName: '', replyExcerpt: '',
          reactionsJson: '[]', edited: message.edited, tombstone: message.tombstone,
          receipt: 'delivered', pending: false, expiresAt: message.expiresAt,
          sentAt: message.sentAt, pageKey: message.pageKey,
        });
      }
    } else if (args.action === 'promote' && target) {
      await ctx.db.patch('memberships', target._id, { role: 'admin' });
      const targetInbox = await ctx.db.query('inboxes').withIndex('by_inbox_key').eq('inboxKey', `${target.userId}:${args.conversationExternalId}`).first();
      if (targetInbox) await ctx.db.patch('inboxes', targetInbox._id, { role: 'admin' });
    } else if (args.action === 'remove' && target) {
      await ctx.db.patch('memberships', target._id, { active: false });
    } else if (args.action === 'leave') {
      target = actorMember;
      await ctx.db.patch('memberships', actorMember._id, { active: false });
    }
    await ctx.db.insert('mutationIntents', { ownerId, mutationId: args.mutationId, intentKey, result: 'true', createdAt: now });
    return true;
  },
});

export const sendMessage = defineJsMutation({
  args: {
    externalId: v.string(), conversationExternalId: v.string(), text: v.string(),
    mediaUri: v.string(), mediaKind: v.string(), viewOnce: v.boolean(), replyToExternalId: v.string(),
  },
  auth: 'authenticated',
  reads: ['profiles', 'conversations', 'memberships', 'messages', 'messageViews', 'messageSearchViews', 'inboxes'],
  writes: ['messages', 'messageViews', 'messageSearchViews', 'inboxes', 'notifications'],
  result: results.value(v.string()),
  handler: async (ctx, args) => {
    const ownerId = ctx.auth.userId;
    const prior = await ctx.db.query('messages').withIndex('by_external_id').eq('externalId', args.externalId).first();
    if (prior) {
      const priorMembers = await ctx.db.query('memberships').withIndex('by_conversation').eq('conversationExternalId', prior.conversationExternalId).collect();
      for (const recipient of priorMembers.filter((item) => item.active)) {
        const rowKey = `${recipient.userId}:${prior.externalId}`;
        const oldSearch = await ctx.db.query('messageSearchViews').withIndex('by_row_key').eq('rowKey', rowKey).first();
        if (!oldSearch) await ctx.db.insert('messageSearchViews', {
          ownerId: recipient.userId, rowKey, externalId: prior.externalId,
          conversationExternalId: prior.conversationExternalId, senderName: prior.senderName,
          text: prior.text, tombstone: prior.tombstone, expiresAt: prior.expiresAt, sentAt: prior.sentAt,
        });
      }
      return prior.externalId;
    }
    const profile = await ctx.db.query('profiles').withIndex('by_owner').eq('ownerId', ownerId).first();
    const member = await ctx.db.query('memberships').withIndex('by_edge').eq('edgeKey', `${args.conversationExternalId}:${ownerId}`).first();
    const conversation = await ctx.db.query('conversations').withIndex('by_external_id').eq('externalId', args.conversationExternalId).first();
    if (!profile || !member || !member.active || !conversation) throw new Error('MESSAGE_FORBIDDEN');
    if (args.text.length > (args.mediaKind ? 500 : 2000)) throw new Error('MESSAGE_TOO_LONG');
    const now = ctx.runtime.now();
    const pageKey = `${String(now).padStart(16, '0')}:${ctx.runtime.id()}`;
    const type = args.mediaKind || 'text';
    const ttl = conversation.disappearing === '24h' ? 180000 : conversation.disappearing === '7d' ? 300000 : 0;
    const expiresAt = ttl ? now + ttl : 0;
    let replySenderName = ''; let replyExcerpt = '';
    if (args.replyToExternalId) {
      const reply = await ctx.db.query('messages').withIndex('by_external_id').eq('externalId', args.replyToExternalId).first();
      if (reply && reply.conversationExternalId === args.conversationExternalId) {
        replySenderName = reply.senderName; replyExcerpt = reply.text.slice(0, 100);
      }
    }
    await ctx.db.insert('messages', {
      externalId: args.externalId, conversationExternalId: args.conversationExternalId,
      senderId: ownerId, senderHandle: profile.handle, senderName: profile.displayName,
      senderAvatarUri: profile.avatarUri, type, text: args.text, mediaUri: args.mediaUri,
      mediaKind: args.mediaKind, viewOnce: args.viewOnce, replyToExternalId: args.replyToExternalId,
      edited: false, tombstone: false, expiresAt, sentAt: now, pageKey,
    });
    const members = await ctx.db.query('memberships').withIndex('by_conversation').eq('conversationExternalId', args.conversationExternalId).collect();
    for (const recipient of members.filter((item) => item.active)) {
      await ctx.db.insert('messageViews', {
        ownerId: recipient.userId, viewKey: `${recipient.userId}:${args.externalId}`,
        externalId: args.externalId, conversationExternalId: args.conversationExternalId,
        senderId: ownerId, senderHandle: profile.handle, senderName: profile.displayName,
        senderAvatarUri: profile.avatarUri, type, text: args.text,
        mediaUri: args.mediaUri, mediaKind: args.mediaKind, viewOnce: args.viewOnce,
        viewOnceState: args.viewOnce ? 'unopened' : '', replyToExternalId: args.replyToExternalId,
        replySenderName, replyExcerpt, reactionsJson: '[]', edited: false, tombstone: false,
        receipt: 'sent', pending: false,
        expiresAt, sentAt: now, pageKey,
      });
      await ctx.db.insert('messageSearchViews', {
        ownerId: recipient.userId, rowKey: `${recipient.userId}:${args.externalId}`,
        externalId: args.externalId, conversationExternalId: args.conversationExternalId,
        senderName: profile.displayName, text: args.text, tombstone: false, expiresAt, sentAt: now,
      });
      const inbox = await ctx.db.query('inboxes').withIndex('by_inbox_key').eq('inboxKey', `${recipient.userId}:${args.conversationExternalId}`).first();
      if (inbox) await ctx.db.patch('inboxes', inbox._id, {
        preview: args.mediaKind ? (args.mediaKind === 'image' ? 'Photo' : 'Video') : args.text.slice(0, 80),
        unreadCount: recipient.userId === ownerId ? inbox.unreadCount : inbox.unreadCount + 1,
        messageCount: inbox.messageCount + 1, updatedAt: now,
        pageKey: `${String(now).padStart(16, '0')}:${args.conversationExternalId}`,
      });
      if (recipient.userId !== ownerId) await ctx.db.insert('notifications', {
        ownerId: recipient.userId, externalId: `push-${args.externalId}-${recipient.userId}`,
        kind: 'message', chatId: args.conversationExternalId, senderDisplayName: profile.displayName,
        preview: args.mediaKind ? (args.mediaKind === 'image' ? 'Photo' : 'Video') : args.text.slice(0, 80),
        payloadJson: JSON.stringify({ targetUserId: recipient.userId, chatId: args.conversationExternalId, senderDisplayName: profile.displayName, preview: args.mediaKind ? (args.mediaKind === 'image' ? 'Photo' : 'Video') : args.text.slice(0, 80) }),
        createdAt: now,
      });
    }
    return args.externalId;
  },
});

export const markConversationRead = defineJsMutation({
  args: { conversationExternalId: v.string() }, auth: 'authenticated',
  reads: ['inboxes', 'messages', 'messageViews'], writes: ['inboxes', 'messageViews'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    const ownerId = ctx.auth.userId;
    const inbox = await ctx.db.query('inboxes').withIndex('by_owner_conversation').eq('ownerId', ownerId).eq('conversationExternalId', args.conversationExternalId).first();
    if (!inbox) throw new Error('NOT_A_MEMBER');
    await ctx.db.patch('inboxes', inbox._id, { unreadCount: 0 });
    const messages = await ctx.db.query('messages').withIndex('by_conversation_page').eq('conversationExternalId', args.conversationExternalId).collect();
    for (const message of messages) {
      if (message.senderId !== ownerId) {
        const ownView = await ctx.db.query('messageViews').withIndex('by_view_key').eq('viewKey', `${ownerId}:${message.externalId}`).first();
        if (ownView && ownView.receipt !== 'read') await ctx.db.patch('messageViews', ownView._id, { receipt: 'read' });
        const views = await ctx.db.query('messageViews').withIndex('by_external').eq('externalId', message.externalId).collect();
        const recipients = views.filter((view) => view.ownerId !== message.senderId);
        // A recipient that has never fetched the message remains outside the
        // observed aggregate until delivery; fetched recipients are the
        // retained slowest-member set represented in the live receipt.
        const observedRecipients = recipients.filter((view) => view.ownerId === ownerId || view.receipt !== 'sent');
        const allRead = observedRecipients.length > 0 && observedRecipients.every((view) => view.ownerId === ownerId || view.receipt === 'read');
        const senderView = views.find((view) => view.ownerId === message.senderId);
        if (senderView) await ctx.db.patch('messageViews', senderView._id, { receipt: allRead ? 'read' : 'delivered' });
      }
    }
    return true;
  },
});

export const markConversationDelivered = defineJsMutation({
  args: { conversationExternalId: v.string() }, auth: 'authenticated',
  reads: ['inboxes', 'messages', 'messageViews'], writes: ['messageViews'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    const ownerId = ctx.auth.userId;
    const inbox = await ctx.db.query('inboxes').withIndex('by_owner_conversation').eq('ownerId', ownerId).eq('conversationExternalId', args.conversationExternalId).first();
    if (!inbox) throw new Error('NOT_A_MEMBER');
    const messages = await ctx.db.query('messages').withIndex('by_conversation_page').eq('conversationExternalId', args.conversationExternalId).collect();
    for (const message of messages) {
      if (message.senderId !== ownerId) {
        const ownView = await ctx.db.query('messageViews').withIndex('by_view_key').eq('viewKey', `${ownerId}:${message.externalId}`).first();
        if (ownView && ownView.receipt === 'sent') await ctx.db.patch('messageViews', ownView._id, { receipt: 'delivered' });
        const views = await ctx.db.query('messageViews').withIndex('by_external').eq('externalId', message.externalId).collect();
        const recipients = views.filter((view) => view.ownerId !== message.senderId);
        const allDelivered = recipients.every((view) => view.ownerId === ownerId || view.receipt === 'delivered' || view.receipt === 'read');
        const senderView = views.find((view) => view.ownerId === message.senderId);
        if (senderView && allDelivered && senderView.receipt === 'sent') await ctx.db.patch('messageViews', senderView._id, { receipt: 'delivered' });
      }
    }
    return true;
  },
});

export const setMessageReaction = defineJsMutation({
  args: { messageExternalId: v.string(), emoji: v.string(), mutationId: v.string() },
  auth: 'authenticated', reads: ['profiles', 'messages', 'memberships', 'reactions', 'messageViews', 'mutationIntents'],
  writes: ['reactions', 'messageViews', 'mutationIntents'], result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    const ownerId = ctx.auth.userId;
    const intentKey = `${ownerId}:${args.mutationId}`;
    const priorIntent = await ctx.db.query('mutationIntents').withIndex('by_intent_key').eq('intentKey', intentKey).first();
    if (priorIntent) return true;
    const profile = await ctx.db.query('profiles').withIndex('by_owner').eq('ownerId', ownerId).first();
    const message = await ctx.db.query('messages').withIndex('by_external_id').eq('externalId', args.messageExternalId).first();
    if (!profile || !message) throw new Error('MESSAGE_NOT_FOUND');
    const membership = await ctx.db.query('memberships').withIndex('by_edge').eq('edgeKey', `${message.conversationExternalId}:${ownerId}`).first();
    if (!membership || !membership.active) throw new Error('REACTION_FORBIDDEN');
    const edgeKey = `${ownerId}:${message.externalId}`;
    const old = await ctx.db.query('reactions').withIndex('by_edge').eq('edgeKey', edgeKey).first();
    if (old) await ctx.db.delete('reactions', old._id);
    if (args.emoji && args.emoji !== 'none') await ctx.db.insert('reactions', {
      edgeKey, messageExternalId: message.externalId, conversationExternalId: message.conversationExternalId,
      userId: ownerId, userHandle: profile.handle, emoji: args.emoji, createdAt: ctx.runtime.now(),
    });
    const reactions = await ctx.db.query('reactions').withIndex('by_message').eq('messageExternalId', message.externalId).collect();
    const counts = [];
    for (const reaction of reactions) {
      const aggregate = counts.find((item) => item.emoji === reaction.emoji);
      if (aggregate) {
        aggregate.count += 1;
        aggregate.users.push(reaction.userId);
      } else {
        counts.push({ emoji: reaction.emoji, count: 1, users: [reaction.userId] });
      }
    }
    const views = await ctx.db.query('messageViews').withIndex('by_external').eq('externalId', message.externalId).collect();
    for (const view of views) {
      const summary = counts.map((item) => ({ emoji: item.emoji, count: item.count, mine: item.users.includes(view.ownerId) }));
      await ctx.db.patch('messageViews', view._id, { reactionsJson: JSON.stringify(summary) });
    }
    await ctx.db.insert('mutationIntents', { ownerId, mutationId: args.mutationId, intentKey, result: 'true', createdAt: ctx.runtime.now() });
    return true;
  },
});

export const editMessage = defineJsMutation({
  args: { messageExternalId: v.string(), text: v.string() }, auth: 'authenticated',
  reads: ['messages', 'messageViews', 'messageSearchViews'], writes: ['messages', 'messageViews', 'messageSearchViews'], result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    const ownerId = ctx.auth.userId;
    const message = await ctx.db.query('messages').withIndex('by_external_id').eq('externalId', args.messageExternalId).first();
    if (!message || message.senderId !== ownerId) throw new Error('EDIT_FORBIDDEN');
    if (ctx.runtime.now() - message.sentAt > 60000) throw new Error('EDIT_WINDOW_EXPIRED');
    await ctx.db.patch('messages', message._id, { text: args.text, edited: true });
    const views = await ctx.db.query('messageViews').withIndex('by_external').eq('externalId', message.externalId).collect();
    for (const view of views) await ctx.db.patch('messageViews', view._id, { text: args.text, edited: true });
    const searchViews = await ctx.db.query('messageSearchViews').withIndex('by_external').eq('externalId', message.externalId).collect();
    for (const view of searchViews) await ctx.db.patch('messageSearchViews', view._id, { text: args.text });
    return true;
  },
});

export const deleteMessage = defineJsMutation({
  args: { messageExternalId: v.string() }, auth: 'authenticated',
  reads: ['messages', 'messageViews', 'messageSearchViews', 'inboxes'], writes: ['messages', 'messageViews', 'messageSearchViews', 'inboxes'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    const ownerId = ctx.auth.userId;
    const message = await ctx.db.query('messages').withIndex('by_external_id').eq('externalId', args.messageExternalId).first();
    if (!message || message.senderId !== ownerId) throw new Error('DELETE_FORBIDDEN');
    if (ctx.runtime.now() - message.sentAt > 120000) throw new Error('DELETE_WINDOW_EXPIRED');
    await ctx.db.patch('messages', message._id, { text: '', mediaUri: '', tombstone: true });
    const views = await ctx.db.query('messageViews').withIndex('by_external').eq('externalId', message.externalId).collect();
    for (const view of views) await ctx.db.patch('messageViews', view._id, { text: '', mediaUri: '', tombstone: true });
    const searchViews = await ctx.db.query('messageSearchViews').withIndex('by_external').eq('externalId', message.externalId).collect();
    for (const view of searchViews) await ctx.db.patch('messageSearchViews', view._id, { text: '', tombstone: true });
    return true;
  },
});

export const consumeViewOnce = defineJsMutation({
  args: { messageExternalId: v.string() }, auth: 'authenticated', reads: ['messageViews'], writes: ['messageViews'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    const ownerId = ctx.auth.userId;
    const view = await ctx.db.query('messageViews').withIndex('by_owner_external').eq('ownerId', ownerId).eq('externalId', args.messageExternalId).first();
    if (!view || !view.viewOnce || view.senderId === ownerId) throw new Error('VIEW_ONCE_FORBIDDEN');
    if (view.viewOnceState === 'opened') throw new Error('VIEW_ONCE_CONSUMED');
    await ctx.db.patch('messageViews', view._id, { viewOnceState: 'opened', mediaUri: '' });
    return true;
  },
});

export const updateConversation = defineJsMutation({
  args: {
    conversationExternalId: v.string(), name: v.string(), description: v.string(),
    accent: v.string(), backgroundUri: v.string(), disappearing: v.string(),
  },
  auth: 'authenticated', reads: ['conversations', 'memberships', 'inboxes'],
  writes: ['conversations', 'inboxes'], result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    const ownerId = ctx.auth.userId;
    const member = await ctx.db.query('memberships').withIndex('by_edge').eq('edgeKey', `${args.conversationExternalId}:${ownerId}`).first();
    const conversation = await ctx.db.query('conversations').withIndex('by_external_id').eq('externalId', args.conversationExternalId).first();
    if (!member || !member.active || !conversation) throw new Error('NOT_A_MEMBER');
    if (conversation.kind === 'group' && member.role !== 'admin') throw new Error('ADMIN_REQUIRED');
    await ctx.db.patch('conversations', conversation._id, {
      name: conversation.kind === 'group' ? args.name : conversation.name,
      description: conversation.kind === 'group' ? args.description : conversation.description,
      accent: args.accent, backgroundUri: args.backgroundUri, disappearing: args.disappearing,
      updatedAt: ctx.runtime.now(),
    });
    const inboxes = await ctx.db.query('inboxes').withIndex('by_conversation').eq('conversationExternalId', args.conversationExternalId).collect();
    for (const inbox of inboxes) await ctx.db.patch('inboxes', inbox._id, {
      title: conversation.kind === 'group' ? args.name : inbox.title,
      description: conversation.kind === 'group' ? args.description : inbox.description,
      accent: args.accent, backgroundUri: args.backgroundUri, disappearing: args.disappearing,
    });
    return true;
  },
});

export const conversation = defineSurface({
  params: { conversationExternalId: v.string() },
  reads: {
    inbox: bind(inboxForConversation, { conversationExternalId: param('conversationExternalId') }),
    messages: bind(recentMessagesForConversation, { conversationExternalId: param('conversationExternalId') }),
    memberships: bind(membershipsForConversation, { conversationExternalId: param('conversationExternalId') }),
  },
  mutations: {
    send: bind(sendMessage, {
      conversationExternalId: param('conversationExternalId'),
      externalId: input('externalId'), text: input('text'), mediaUri: input('mediaUri'),
      mediaKind: input('mediaKind'), viewOnce: input('viewOnce'), replyToExternalId: input('replyToExternalId'),
    }),
    markRead: bind(markConversationRead, { conversationExternalId: param('conversationExternalId') }),
  },
  presence: {
    typing: bind(typing, { scope: { conversationKey: param('conversationExternalId') } }),
  },
});
