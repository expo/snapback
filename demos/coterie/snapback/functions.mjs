import {
  arg,
  asc,
  authUserId,
  defineAssetUpload,
  defineJsLiveQuery,
  defineJsMutation,
  defineJsQuery,
  defineLiveQuery,
  defineQuery,
  eq,
  results,
  v,
} from '../../_kit/define.mjs';

function normalizedProfile(args) {
  const handle = String(args.handle ?? '').trim().toLowerCase();
  const displayName = String(args.displayName ?? '').trim();
  const bio = String(args.bio ?? '').trim();
  const location = String(args.location ?? '').trim();
  const link = String(args.link ?? '').trim();
  const validHandle = handle.length >= 3
    && handle.length <= 20
    && handle.split('').every((character) => (
      (character >= 'a' && character <= 'z')
      || (character >= '0' && character <= '9')
      || character === '_'
    ));
  if (!validHandle) throw new Error('handle must contain 3-20 lowercase letters, digits, or underscores');
  if (displayName.length < 1 || displayName.length > 50) {
    throw new Error('display name must contain 1-50 characters');
  }
  if (bio.length > 200) throw new Error('bio must contain at most 200 characters');
  if (location.length > 50) throw new Error('location must contain at most 50 characters');
  if (link && !isHttpUrl(link)) {
    throw new Error('link must be empty or one http(s) URL');
  }
  return { handle, displayName, bio, location, link };
}

function isHttpUrl(value) {
  const prefix = value.startsWith('https://')
    ? 'https://'
    : value.startsWith('http://')
      ? 'http://'
      : null;
  if (!prefix) return false;
  const rest = value.slice(prefix.length);
  if (!rest || rest.split('').some((character) => character <= ' ')) return false;
  const delimiters = ['/', '?', '#']
    .map((character) => rest.indexOf(character))
    .filter((index) => index >= 0);
  const authorityEnd = delimiters.length > 0 ? Math.min(...delimiters) : rest.length;
  return authorityEnd > 0;
}

function normalizedSourceDigest(value) {
  const digest = String(value ?? '').trim().toLowerCase();
  const valid = digest.length === 64 && digest.split('').every((character) => (
    (character >= 'a' && character <= 'f')
    || (character >= '0' && character <= '9')
  ));
  if (!valid) throw new Error('avatar source digest must be a lowercase SHA-256 hex digest');
  return digest;
}

async function requireOwnedProfile(ctx, profileId) {
  const profile = await ctx.db.get('profiles', profileId);
  if (!profile || profile.ownerId !== ctx.auth.userId) {
    ctx.refuse('PROFILE_NOT_OWNED');
  }
  return profile;
}

async function requireMyProfile(ctx) {
  const profile = await ctx.db
    .query('profiles')
    .withIndex('by_owner')
    .eq('ownerId', ctx.auth.userId)
    .first();
  if (!profile) ctx.refuse('PROFILE_REQUIRED');
  return profile;
}

function pageKeyFor(ctx, createdAt) {
  return `${String(createdAt).padStart(16, '0')}:${ctx.runtime.id()}`;
}

function queryFilterBindingLimit() {
  return 500;
}

function threadDirectReplyLimit() {
  return 1023;
}

function chunkValues(values, maxItems) {
  const chunks = [];
  for (let start = 0; start < values.length; start += maxItems) {
    chunks.push(values.slice(start, start + maxItems));
  }
  return chunks;
}

function normalizedSha256(value, label) {
  const digest = String(value ?? '').trim().toLowerCase();
  const valid = digest.length === 64 && digest.split('').every((character) => (
    (character >= 'a' && character <= 'f')
    || (character >= '0' && character <= '9')
  ));
  if (!valid) throw new Error(`${label} must be a lowercase SHA-256 hex digest`);
  return digest;
}

function normalizedPostInput(ctx, args) {
  const kind = String(args.kind ?? '');
  const body = String(args.body ?? '');
  const imageAssetIds = Array.isArray(args.imageAssetIds) ? args.imageAssetIds : [];
  const videoAssetId = typeof args.videoAssetId === 'string' && args.videoAssetId.length > 0
    ? args.videoAssetId
    : undefined;

  if ([...body].length > 500) ctx.refuse('POST_BODY_TOO_LONG');
  if (imageAssetIds.length > 0 && videoAssetId) ctx.refuse('POST_MEDIA_MIXED');
  if (kind === 'images') {
    if (imageAssetIds.length < 1 || imageAssetIds.length > 4) {
      ctx.refuse('POST_IMAGE_COUNT_INVALID');
    }
    if (videoAssetId) ctx.refuse('POST_MEDIA_MIXED');
  } else if (kind === 'video') {
    if (imageAssetIds.length > 0 && videoAssetId) ctx.refuse('POST_MEDIA_MIXED');
    if (imageAssetIds.length > 0 || !videoAssetId) ctx.refuse('POST_KIND_MEDIA_MISMATCH');
  } else if (kind === 'text') {
    if (imageAssetIds.length > 0 || videoAssetId) ctx.refuse('POST_KIND_MEDIA_MISMATCH');
  } else {
    ctx.refuse('POST_KIND_INVALID');
  }

  return { kind, body, imageAssetIds, videoAssetId };
}

async function requiredParent(ctx, parentId) {
  if (!parentId) return null;
  const parent = await ctx.db.get('posts', parentId);
  if (!parent) ctx.refuse('POST_PARENT_NOT_FOUND');
  return parent;
}

async function writePostMedia(ctx, postId, input, imageSourceDigests, videoSourceDigest) {
  for (const [position, assetId] of input.imageAssetIds.entries()) {
    const asset = await ctx.assets.attach(assetId, {
      upload: 'postImageUpload',
    });
    const sourceDigest = imageSourceDigests?.find((value, index) => index === position);
    await ctx.db.insert('postImages', {
      postId,
      position,
      asset,
      ...(sourceDigest
        ? { sourceDigest }
        : {}),
    });
  }
  if (input.videoAssetId) {
    const asset = await ctx.assets.attach(input.videoAssetId, { upload: 'postVideoUpload' });
    await ctx.db.insert('postVideos', {
      postId,
      asset,
      ...(videoSourceDigest ? { sourceDigest: videoSourceDigest } : {}),
    });
  }
}

async function insertPost(ctx, profile, input, parent, fixture, mediaDigests) {
  const createdAt = ctx.runtime.now();
  const pageKey = pageKeyFor(ctx, createdAt);
  const postId = await ctx.db.insert('posts', {
    ownerId: ctx.auth.userId,
    authorProfileId: profile._id,
    ...(fixture ? { fixtureId: fixture.id, fixtureDigest: fixture.digest } : {}),
    kind: input.kind,
    body: input.body,
    ...(parent ? { parentId: parent._id } : {}),
    parentKey: parent?._id ?? '',
    isReply: Boolean(parent),
    pageKey,
    createdAt,
    likeCount: 0,
    repostCount: 0,
    replyCount: 0,
  });
  await writePostMedia(
    ctx,
    postId,
    input,
    mediaDigests?.images,
    mediaDigests?.video,
  );
  if (parent) {
    await ctx.db.patch('posts', parent._id, { replyCount: parent.replyCount + 1 });
  } else {
    await ctx.db.insert('feedEvents', {
      eventKind: 'post',
      sourceKey: `post:${postId}`,
      postId,
      actorProfileId: profile._id,
      pageKey,
      createdAt,
    });
  }
  return postId;
}

async function clearPostMedia(ctx, postId) {
  const images = await ctx.db
    .query('postImages')
    .withIndex('by_post_position')
    .eq('postId', postId)
    .take(1024)
    .collect();
  for (const image of images) await ctx.db.delete('postImages', image._id);
  const video = await ctx.db
    .query('postVideos')
    .withIndex('by_post')
    .eq('postId', postId)
    .first();
  if (video) await ctx.db.delete('postVideos', video._id);
}

async function requireAvailableIdentity(ctx, ownerId, profileId, handle, fixtureId) {
  const byHandle = await ctx.db
    .query('profiles')
    .withIndex('by_handle')
    .eq('handle', handle)
    .first();
  if (byHandle && byHandle._id !== profileId) ctx.refuse('DUPLICATE_HANDLE');

  if (fixtureId) {
    const byFixture = await ctx.db
      .query('profiles')
      .withIndex('by_fixture_id')
      .eq('fixtureId', fixtureId)
      .first();
    if (byFixture && (byFixture._id !== profileId || byFixture.ownerId !== ownerId)) {
      throw new Error('fixture identity is already bound to another principal');
    }
  }
}

export const avatarUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 10_000_000 },
  delivery: { kind: 'public-immutable' },
  access: { read: 'via-references' },
  image: {
    location: 'strip',
    variants: [
      { key: 'thumb', width: 96, required: true },
      { key: 'profile', width: 256 },
    ],
  },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

export const postImageUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 10_000_000 },
  delivery: { kind: 'public-immutable' },
  access: { read: 'via-references' },
  image: {
    location: 'strip',
    variants: [
      { key: 'feed', width: 1440, required: true },
      { key: 'thumb', width: 480 },
    ],
  },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

export const postVideoUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['video/mp4'], maxBytes: 50_000_000 },
  delivery: { kind: 'public-immutable' },
  access: { read: 'via-references' },
  video: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

export const getMyProfile = defineQuery({
  auth: 'authenticated',
  table: 'profiles',
  args: {},
  filter: [eq('ownerId', authUserId())],
  index: 'by_owner',
});

export const getProfileByHandle = defineJsQuery({
  auth: 'public',
  args: { handle: v.string() },
  reads: ['profiles'],
  result: results.records(v.object({
    handle: v.string(),
    displayName: v.string(),
    bio: v.string(),
    location: v.string(),
    link: v.string(),
    avatar: v.optional(v.assetRef({ upload: 'avatarUpload' })),
  })),
  handler: async (ctx, args) => {
    const handle = String(args.handle ?? '').trim().toLowerCase();
    const profile = await ctx.db
      .query('profiles')
      .withIndex('by_handle')
      .eq('handle', handle)
      .first();
    return profile ? [{
      handle: profile.handle,
      displayName: profile.displayName,
      bio: profile.bio,
      location: profile.location,
      link: profile.link,
      ...(profile.avatar ? { avatar: profile.avatar } : {}),
    }] : [];
  },
});

export const listProfiles = defineLiveQuery({
  auth: 'authenticated',
  table: 'profiles',
  args: {},
  order: [asc('handle')],
  index: 'by_handle',
});

const postViewRow = v.object({
  _id: v.id('posts'),
  kind: v.string(),
  body: v.string(),
  parentId: v.optional(v.id('posts')),
  postPageKey: v.string(),
  createdAt: v.integer(),
  authorProfileId: v.id('profiles'),
  authorHandle: v.string(),
  authorDisplayName: v.string(),
  authorAvatar: v.optional(v.assetRef({ upload: 'avatarUpload' })),
  imageMedia: v.array(v.object({
    position: v.integer(),
    asset: v.assetRef({ upload: 'postImageUpload' }),
  }), { maxItems: 4 }),
  videoMedia: v.optional(v.object({
    asset: v.assetRef({ upload: 'postVideoUpload' }),
  })),
  likeCount: v.integer(),
  repostCount: v.integer(),
  replyCount: v.integer(),
  viewerLiked: v.boolean(),
  viewerReposted: v.boolean(),
});

const feedRow = v.object({
  itemId: v.string(),
  eventKind: v.string(),
  pageKey: v.string(),
  eventCreatedAt: v.integer(),
  _id: v.id('posts'),
  kind: v.string(),
  body: v.string(),
  parentId: v.optional(v.id('posts')),
  postPageKey: v.string(),
  createdAt: v.integer(),
  authorProfileId: v.id('profiles'),
  authorHandle: v.string(),
  authorDisplayName: v.string(),
  authorAvatar: v.optional(v.assetRef({ upload: 'avatarUpload' })),
  imageMedia: v.array(v.object({
    position: v.integer(),
    asset: v.assetRef({ upload: 'postImageUpload' }),
  }), { maxItems: 4 }),
  videoMedia: v.optional(v.object({
    asset: v.assetRef({ upload: 'postVideoUpload' }),
  })),
  likeCount: v.integer(),
  repostCount: v.integer(),
  replyCount: v.integer(),
  viewerLiked: v.boolean(),
  viewerReposted: v.boolean(),
  repostedByProfileId: v.optional(v.id('profiles')),
  repostedByHandle: v.optional(v.string()),
  repostedByDisplayName: v.optional(v.string()),
});

async function hydratePostViews(ctx, posts, viewerProfileId) {
  const presentPosts = posts.filter((post) => Boolean(post));
  if (presentPosts.length === 0) return posts.map(() => null);
  const postIds = [];
  const authorProfileIds = [];
  for (const post of presentPosts) {
    if (!postIds.includes(post._id)) postIds.push(post._id);
    if (!authorProfileIds.includes(post.authorProfileId)) {
      authorProfileIds.push(post.authorProfileId);
    }
  }

  const profiles = [];
  for (let start = 0; start < authorProfileIds.length; start += 256) {
    const chunk = authorProfileIds.slice(start, start + 256);
    profiles.push(...(await ctx.db.getMany('profiles', chunk)).filter((row) => Boolean(row)));
  }

  const images = [];
  const videos = [];
  for (let start = 0; start < postIds.length; start += 256) {
    const chunk = postIds.slice(start, start + 256);
    images.push(...await ctx.db
      .query('postImages')
      .withIndex('by_post_position')
      .in('postId', chunk)
      .take(chunk.length * 4)
      .collect());
    videos.push(...(await ctx.db.uniqueMany(
      'postVideos',
      'by_post',
      chunk.map((postId) => ({ postId })),
    )).filter((row) => Boolean(row)));
  }

  const viewerLikes = [];
  const viewerReposts = [];
  // The owner equality consumes one of the builder's 500 filter bindings.
  for (const chunk of chunkValues(postIds, queryFilterBindingLimit() - 1)) {
    viewerLikes.push(...await ctx.db
      .query('likes')
      .withIndex('by_owner_post')
      .eq('ownerProfileId', viewerProfileId)
      .in('postId', chunk)
      .take(chunk.length)
      .collect());
    viewerReposts.push(...await ctx.db
      .query('reposts')
      .withIndex('by_owner_post')
      .eq('ownerProfileId', viewerProfileId)
      .in('postId', chunk)
      .take(chunk.length)
      .collect());
  }

  return posts.map((post) => {
    if (!post) return null;
    const profile = profiles.find((candidate) => candidate._id === post.authorProfileId);
    if (!profile) return null;
    const imageMedia = images
      .filter((image) => image.postId === post._id)
      .sort((left, right) => left.position - right.position)
      .map((image) => ({ position: image.position, asset: image.asset }));
    const video = videos.find((candidate) => candidate.postId === post._id);
    return {
      _id: post._id,
      kind: post.kind,
      body: post.body,
      ...(post.parentId ? { parentId: post.parentId } : {}),
      postPageKey: post.pageKey,
      createdAt: post.createdAt,
      authorProfileId: profile._id,
      authorHandle: profile.handle,
      authorDisplayName: profile.displayName,
      ...(profile.avatar ? { authorAvatar: profile.avatar } : {}),
      imageMedia,
      ...(video ? { videoMedia: { asset: video.asset } } : {}),
      likeCount: post.likeCount,
      repostCount: post.repostCount,
      replyCount: post.replyCount,
      viewerLiked: viewerLikes.some((like) => like.postId === post._id),
      viewerReposted: viewerReposts.some((repost) => repost.postId === post._id),
    };
  });
}

async function followingFeedEvents(ctx, visibleActorIds, before, actorChunkSize) {
  const chunkPages = [];
  for (const actorIds of chunkValues(visibleActorIds, actorChunkSize)) {
    let eventsQuery = ctx.db
      .query('feedEvents')
      .withIndex('by_actor_page')
      .in('actorProfileId', actorIds);
    if (before) eventsQuery = eventsQuery.lt('pageKey', before);
    chunkPages.push(...await eventsQuery.order('pageKey', 'desc').take(20).collect());
  }
  // Every row outside a chunk's top 20 has at least 20 newer rows in that
  // same chunk, so it cannot belong to the global top 20. Merging the chunk
  // tops and taking the first 20 is therefore exact, not an approximation.
  return chunkPages
    .sort((left, right) => (left.pageKey > right.pageKey ? -1 : left.pageKey < right.pageKey ? 1 : 0))
    .slice(0, 20);
}

async function feedRows(ctx, args, followingOnly) {
  const viewer = await requireMyProfile(ctx);
  let events;
  if (followingOnly) {
    const follows = await ctx.db
      .query('follows')
      .withIndex('by_follower')
      .eq('followerProfileId', viewer._id)
      .take(1024)
      .collect();
    const visibleActorIds = [viewer._id, ...follows.map((follow) => follow.followedProfileId)];
    const requestedChunkSize = Number.isSafeInteger(args.actorChunkSize)
      ? args.actorChunkSize
      : queryFilterBindingLimit() - 1;
    // Leave one binding for the optional page-key predicate on every page.
    const actorChunkSize = Math.max(
      1,
      Math.min(requestedChunkSize, queryFilterBindingLimit() - 1),
    );
    events = await followingFeedEvents(ctx, visibleActorIds, args.before, actorChunkSize);
  } else {
    let eventsQuery = ctx.db
      .query('feedEvents')
      .withIndex('by_page_key');
    if (args.before) eventsQuery = eventsQuery.lt('pageKey', args.before);
    events = await eventsQuery.order('pageKey', 'desc').take(20).collect();
  }

  const posts = await ctx.db.getMany('posts', events.map((event) => event.postId));
  const views = await hydratePostViews(ctx, posts, viewer._id);
  const actors = await ctx.db.getMany(
    'profiles',
    events.map((event) => event.actorProfileId),
  );
  const output = [];
  for (const event of events) {
    const view = views.find((candidate) => candidate?._id === event.postId);
    const actor = actors.find((candidate) => candidate?._id === event.actorProfileId);
    if (!view || !actor) continue;
    output.push({
      itemId: event.sourceKey,
      eventKind: event.eventKind,
      pageKey: event.pageKey,
      eventCreatedAt: event.createdAt,
      ...view,
      ...(event.eventKind === 'repost'
        ? {
            repostedByProfileId: actor._id,
            repostedByHandle: actor.handle,
            repostedByDisplayName: actor.displayName,
          }
        : {}),
    });
  }
  return output;
}

export const globalFeed = defineJsLiveQuery({
  auth: 'authenticated',
  args: { before: v.optional(v.string()) },
  result: results.records(feedRow, { minItems: 0, maxItems: 20 }),
  reads: ['feedEvents', 'posts', 'profiles', 'postImages', 'postVideos', 'likes', 'reposts'],
  refusals: ['PROFILE_REQUIRED'],
  handler: async (ctx, args) => feedRows(ctx, args, false),
});

export const followingFeed = defineJsLiveQuery({
  auth: 'authenticated',
  args: {
    before: v.optional(v.string()),
    actorChunkSize: v.optional(v.integer()),
  },
  result: results.records(feedRow, { minItems: 0, maxItems: 20 }),
  reads: [
    'feedEvents',
    'posts',
    'profiles',
    'postImages',
    'postVideos',
    'likes',
    'reposts',
    'follows',
  ],
  refusals: ['PROFILE_REQUIRED'],
  handler: async (ctx, args) => feedRows(ctx, args, true),
});

export const thread = defineJsLiveQuery({
  auth: 'authenticated',
  args: { postId: v.id('posts') },
  result: results.records(postViewRow, { minItems: 0, maxItems: 1024 }),
  reads: ['posts', 'profiles', 'postImages', 'postVideos', 'likes', 'reposts'],
  refusals: ['PROFILE_REQUIRED', 'THREAD_REPLY_LIMIT_EXCEEDED'],
  handler: async (ctx, args) => {
    const viewer = await requireMyProfile(ctx);
    const parent = await ctx.db.get('posts', args.postId);
    if (!parent) return [];
    const replies = await ctx.db
      .query('posts')
      .withIndex('by_parent_page')
      .eq('parentKey', parent._id)
      .order('pageKey', 'asc')
      // listThread@1 is intentionally unpaged: parent + at most 1,023 direct
      // replies. Read one overflow witness so the bound never truncates.
      .take(threadDirectReplyLimit() + 1)
      .collect();
    if (replies.length > threadDirectReplyLimit()) {
      ctx.refuse('THREAD_REPLY_LIMIT_EXCEEDED');
    }
    return (await hydratePostViews(ctx, [parent, ...replies], viewer._id))
      .filter((row) => Boolean(row));
  },
});

export const profilePosts = defineJsLiveQuery({
  auth: 'authenticated',
  args: {
    profileId: v.id('profiles'),
    before: v.optional(v.string()),
  },
  result: results.records(postViewRow, { minItems: 0, maxItems: 20 }),
  reads: ['posts', 'profiles', 'postImages', 'postVideos', 'likes', 'reposts'],
  refusals: ['PROFILE_REQUIRED'],
  handler: async (ctx, args) => {
    const viewer = await requireMyProfile(ctx);
    let postsQuery = ctx.db
      .query('posts')
      .withIndex('by_author_reply_page')
      .eq('authorProfileId', args.profileId)
      .eq('isReply', false);
    if (args.before) postsQuery = postsQuery.lt('pageKey', args.before);
    const posts = await postsQuery.order('pageKey', 'desc').take(20).collect();
    return (await hydratePostViews(ctx, posts, viewer._id)).filter((row) => Boolean(row));
  },
});

export const profileStats = defineJsLiveQuery({
  auth: 'authenticated',
  args: { profileId: v.id('profiles') },
  result: results.records(v.object({
    profileId: v.id('profiles'),
    handle: v.string(),
    displayName: v.string(),
    avatar: v.optional(v.assetRef({ upload: 'avatarUpload' })),
    followerCount: v.integer(),
    followingCount: v.integer(),
    viewerFollows: v.boolean(),
    isSelf: v.boolean(),
  }), { minItems: 0, maxItems: 1 }),
  reads: ['profiles', 'follows'],
  refusals: ['PROFILE_REQUIRED'],
  handler: async (ctx, args) => {
    const viewer = await requireMyProfile(ctx);
    const profile = await ctx.db.get('profiles', args.profileId);
    if (!profile) return [];
    const followers = await ctx.db
      .query('follows')
      .withIndex('by_followed')
      .eq('followedProfileId', profile._id)
      .take(1024)
      .collect();
    const following = await ctx.db
      .query('follows')
      .withIndex('by_follower')
      .eq('followerProfileId', profile._id)
      .take(1024)
      .collect();
    return [{
      profileId: profile._id,
      handle: profile.handle,
      displayName: profile.displayName,
      ...(profile.avatar ? { avatar: profile.avatar } : {}),
      followerCount: followers.length,
      followingCount: following.length,
      viewerFollows: followers.some((follow) => follow.followerProfileId === viewer._id),
      isSelf: profile._id === viewer._id,
    }];
  },
});

export const getMyFixturePost = defineJsQuery({
  auth: 'authenticated',
  args: { fixtureId: v.string() },
  result: results.documents('posts'),
  reads: ['posts'],
  handler: async (ctx, args) => {
    const post = await ctx.db
      .query('posts')
      .withIndex('by_fixture_id')
      .eq('fixtureId', args.fixtureId)
      .first();
    if (post && post.ownerId !== ctx.auth.userId) return [];
    return post ? [post] : [];
  },
});

export const getMyFixturePostMedia = defineJsQuery({
  auth: 'authenticated',
  args: { postId: v.id('posts') },
  result: results.records(v.object({
    mediaKind: v.string(),
    position: v.integer(),
    assetId: v.string(),
    sourceDigest: v.string(),
  }), { minItems: 0, maxItems: 5 }),
  reads: ['posts', 'postImages', 'postVideos'],
  handler: async (ctx, args) => {
    const post = await ctx.db.get('posts', args.postId);
    if (!post || post.ownerId !== ctx.auth.userId) return [];
    const images = await ctx.db
      .query('postImages')
      .withIndex('by_post_position')
      .eq('postId', post._id)
      .order('position', 'asc')
      .take(4)
      .collect();
    const video = await ctx.db
      .query('postVideos')
      .withIndex('by_post')
      .eq('postId', post._id)
      .first();
    return [
      ...images.map((image) => ({
        mediaKind: 'image',
        position: image.position,
        assetId: image.asset,
        sourceDigest: image.sourceDigest ?? '',
      })),
      ...(video
        ? [{
            mediaKind: 'video',
            position: 0,
            assetId: video.asset,
            sourceDigest: video.sourceDigest ?? '',
          }]
        : []),
    ];
  },
});

export const ensureMyProfile = defineJsMutation({
  auth: 'authenticated',
  args: {
    fixtureId: v.optional(v.string()),
    handle: v.string(),
    displayName: v.string(),
    bio: v.string(),
    location: v.string(),
    link: v.string(),
  },
  reads: ['profiles'],
  writes: ['profiles'],
  refusals: ['DUPLICATE_HANDLE'],
  result: results.value(v.id('profiles')),
  handler: async (ctx, args) => {
    const values = normalizedProfile(args);
    const fixtureId = typeof args.fixtureId === 'string' && args.fixtureId.trim()
      ? args.fixtureId.trim()
      : undefined;
    const existing = await ctx.db
      .query('profiles')
      .withIndex('by_owner')
      .eq('ownerId', ctx.auth.userId)
      .first();
    await requireAvailableIdentity(
      ctx,
      ctx.auth.userId,
      existing?._id ?? null,
      values.handle,
      fixtureId,
    );

    if (!existing) {
      return await ctx.db.insert('profiles', {
        ownerId: ctx.auth.userId,
        ...(fixtureId ? { fixtureId } : {}),
        ...values,
      });
    }

    if (fixtureId && existing.fixtureId && fixtureId !== existing.fixtureId) {
      throw new Error('an existing fixture profile cannot change fixture identity');
    }
    const changed = existing.handle !== values.handle
      || existing.displayName !== values.displayName
      || existing.bio !== values.bio
      || existing.location !== values.location
      || existing.link !== values.link
      || (fixtureId && existing.fixtureId !== fixtureId);
    if (changed) {
      await ctx.db.patch('profiles', existing._id, {
        ...(fixtureId && !existing.fixtureId ? { fixtureId } : {}),
        ...values,
      });
    }
    return existing._id;
  },
});

export const editProfile = defineJsMutation({
  auth: 'authenticated',
  args: {
    profileId: v.id('profiles'),
    handle: v.string(),
    displayName: v.string(),
    bio: v.string(),
    location: v.string(),
    link: v.string(),
  },
  reads: ['profiles'],
  writes: ['profiles'],
  refusals: ['DUPLICATE_HANDLE', 'PROFILE_NOT_OWNED'],
  result: results.value(v.id('profiles')),
  handler: async (ctx, args) => {
    const profile = await requireOwnedProfile(ctx, args.profileId);
    const values = normalizedProfile(args);
    await requireAvailableIdentity(
      ctx,
      ctx.auth.userId,
      profile._id,
      values.handle,
      profile.fixtureId,
    );
    await ctx.db.patch('profiles', profile._id, values);
    return profile._id;
  },
});

export const attachMyAvatar = defineJsMutation({
  auth: 'authenticated',
  args: {
    profileId: v.id('profiles'),
    assetId: v.string(),
    sourceDigest: v.string(),
  },
  reads: ['profiles'],
  writes: ['profiles'],
  refusals: ['PROFILE_NOT_OWNED'],
  result: results.value(v.id('profiles')),
  handler: async (ctx, args) => {
    const profile = await requireOwnedProfile(ctx, args.profileId);
    const avatarSourceDigest = normalizedSourceDigest(args.sourceDigest);
    const avatar = await ctx.assets.attach(args.assetId, { upload: 'avatarUpload' });
    if (profile.avatar !== avatar || profile.avatarSourceDigest !== avatarSourceDigest) {
      await ctx.db.patch('profiles', profile._id, { avatar, avatarSourceDigest });
    }
    return profile._id;
  },
});

async function setFollowCore(ctx, targetProfileId, following, fixture, clientMutationId) {
  const follower = await requireMyProfile(ctx);
  const target = await ctx.db.get('profiles', targetProfileId);
  if (!target) ctx.refuse('PROFILE_NOT_FOUND');
  if (target._id === follower._id) ctx.refuse('SELF_FOLLOW_FORBIDDEN');
  const existing = await ctx.db
    .query('follows')
    .withIndex('by_pair')
    .eq('followerProfileId', follower._id)
    .eq('followedProfileId', target._id)
    .first();
  let disposition = 'matched';
  if (following && !existing) {
    await ctx.db.insert('follows', {
      followerId: ctx.auth.userId,
      followerProfileId: follower._id,
      followedProfileId: target._id,
      createdAt: ctx.runtime.now(),
      ...(clientMutationId ? { clientMutationId } : {}),
      ...(fixture
        ? { fixtureMutationId: fixture.mutationId, fixtureDigest: fixture.digest }
        : {}),
    });
    disposition = 'created';
  } else if (following && existing && (
    (fixture && (
      existing.fixtureMutationId !== fixture.mutationId
      || existing.fixtureDigest !== fixture.digest
    ))
    || (clientMutationId && existing.clientMutationId !== clientMutationId)
  )) {
    await ctx.db.patch('follows', existing._id, {
      ...(clientMutationId ? { clientMutationId } : {}),
      ...(fixture
        ? { fixtureMutationId: fixture.mutationId, fixtureDigest: fixture.digest }
        : {}),
    });
    if (fixture) disposition = 'repaired';
  } else if (!following && existing) {
    await ctx.db.delete('follows', existing._id);
    disposition = 'removed';
  }
  const followers = await ctx.db
    .query('follows')
    .withIndex('by_followed')
    .eq('followedProfileId', target._id)
    .take(1024)
    .collect();
  const followingRows = await ctx.db
    .query('follows')
    .withIndex('by_follower')
    .eq('followerProfileId', follower._id)
    .take(1024)
    .collect();
  return {
    following,
    followerCount: followers.length,
    followingCount: followingRows.length,
    disposition,
  };
}

async function setLikeCore(ctx, postId, liked, fixture, clientMutationId) {
  const profile = await requireMyProfile(ctx);
  const post = await ctx.db.get('posts', postId);
  if (!post) ctx.refuse('POST_NOT_FOUND');
  const existing = await ctx.db
    .query('likes')
    .withIndex('by_owner_post')
    .eq('ownerProfileId', profile._id)
    .eq('postId', post._id)
    .first();
  let likeCount = post.likeCount;
  let disposition = 'matched';
  if (liked && !existing) {
    likeCount += 1;
    await ctx.db.insert('likes', {
      ownerId: ctx.auth.userId,
      ownerProfileId: profile._id,
      postId: post._id,
      createdAt: ctx.runtime.now(),
      ...(clientMutationId ? { clientMutationId } : {}),
      ...(fixture
        ? { fixtureMutationId: fixture.mutationId, fixtureDigest: fixture.digest }
        : {}),
    });
    await ctx.db.patch('posts', post._id, { likeCount });
    disposition = 'created';
  } else if (liked && existing && (
    (fixture && (
      existing.fixtureMutationId !== fixture.mutationId
      || existing.fixtureDigest !== fixture.digest
    ))
    || (clientMutationId && existing.clientMutationId !== clientMutationId)
  )) {
    await ctx.db.patch('likes', existing._id, {
      ...(clientMutationId ? { clientMutationId } : {}),
      ...(fixture
        ? { fixtureMutationId: fixture.mutationId, fixtureDigest: fixture.digest }
        : {}),
    });
    if (fixture) disposition = 'repaired';
  } else if (!liked && existing) {
    likeCount = Math.max(0, likeCount - 1);
    await ctx.db.delete('likes', existing._id);
    await ctx.db.patch('posts', post._id, { likeCount });
    disposition = 'removed';
  }
  return { liked, likeCount, disposition };
}

async function setRepostCore(ctx, postId, reposted, fixture, clientMutationId) {
  const profile = await requireMyProfile(ctx);
  const post = await ctx.db.get('posts', postId);
  if (!post) ctx.refuse('POST_NOT_FOUND');
  // @ref LLP 0266#d4-backend-boundary — reply eligibility is mutation
  // authority, not a client/adapter projection preflight.
  if (post.parentId) ctx.refuse('REPLY_REPOST_FORBIDDEN');
  const existing = await ctx.db
    .query('reposts')
    .withIndex('by_owner_post')
    .eq('ownerProfileId', profile._id)
    .eq('postId', post._id)
    .first();
  let repostCount = post.repostCount;
  let disposition = 'matched';
  if (reposted && !existing) {
    const createdAt = ctx.runtime.now();
    const pageKey = pageKeyFor(ctx, createdAt);
    const repostId = await ctx.db.insert('reposts', {
      ownerId: ctx.auth.userId,
      ownerProfileId: profile._id,
      postId: post._id,
      pageKey,
      createdAt,
      ...(clientMutationId ? { clientMutationId } : {}),
      ...(fixture
        ? { fixtureMutationId: fixture.mutationId, fixtureDigest: fixture.digest }
        : {}),
    });
    if (!post.isReply) {
      await ctx.db.insert('feedEvents', {
        eventKind: 'repost',
        sourceKey: `repost:${repostId}`,
        postId: post._id,
        actorProfileId: profile._id,
        pageKey,
        createdAt,
      });
    }
    repostCount += 1;
    await ctx.db.patch('posts', post._id, { repostCount });
    disposition = 'created';
  } else if (reposted && existing && (
    (fixture && (
      existing.fixtureMutationId !== fixture.mutationId
      || existing.fixtureDigest !== fixture.digest
    ))
    || (clientMutationId && existing.clientMutationId !== clientMutationId)
  )) {
    await ctx.db.patch('reposts', existing._id, {
      ...(clientMutationId ? { clientMutationId } : {}),
      ...(fixture
        ? { fixtureMutationId: fixture.mutationId, fixtureDigest: fixture.digest }
        : {}),
    });
    if (fixture) disposition = 'repaired';
  } else if (!reposted && existing) {
    const event = await ctx.db
      .query('feedEvents')
      .withIndex('by_source_key')
      .eq('sourceKey', `repost:${existing._id}`)
      .first();
    if (event) await ctx.db.delete('feedEvents', event._id);
    await ctx.db.delete('reposts', existing._id);
    repostCount = Math.max(0, repostCount - 1);
    await ctx.db.patch('posts', post._id, { repostCount });
    disposition = 'removed';
  }
  return { reposted, repostCount, disposition };
}

export const createPost = defineJsMutation({
  auth: 'authenticated',
  args: {
    kind: v.string(),
    body: v.string(),
    imageAssetIds: v.array(v.string(), { maxItems: 32 }),
    videoAssetId: v.optional(v.string()),
    parentId: v.optional(v.id('posts')),
  },
  reads: ['profiles', 'posts'],
  writes: ['posts', 'postImages', 'postVideos', 'feedEvents'],
  refusals: [
    'PROFILE_REQUIRED',
    'POST_BODY_TOO_LONG',
    'POST_IMAGE_COUNT_INVALID',
    'POST_MEDIA_MIXED',
    'POST_KIND_MEDIA_MISMATCH',
    'POST_KIND_INVALID',
    'POST_PARENT_NOT_FOUND',
  ],
  result: results.value(v.id('posts')),
  handler: async (ctx, args) => {
    const profile = await requireMyProfile(ctx);
    const input = normalizedPostInput(ctx, args);
    const parent = await requiredParent(ctx, args.parentId);
    return insertPost(ctx, profile, input, parent, null, null);
  },
});

export const setFollow = defineJsMutation({
  auth: 'authenticated',
  args: {
    profileId: v.id('profiles'),
    following: v.boolean(),
    mutationId: v.optional(v.string()),
  },
  reads: ['profiles', 'follows'],
  writes: ['follows'],
  refusals: ['PROFILE_REQUIRED', 'PROFILE_NOT_FOUND', 'SELF_FOLLOW_FORBIDDEN'],
  result: results.value(v.object({
    following: v.boolean(),
    followerCount: v.integer(),
    followingCount: v.integer(),
  })),
  handler: async (ctx, args) => {
    const outcome = await setFollowCore(
      ctx,
      args.profileId,
      args.following,
      null,
      args.mutationId,
    );
    return {
      following: outcome.following,
      followerCount: outcome.followerCount,
      followingCount: outcome.followingCount,
    };
  },
});

export const setLike = defineJsMutation({
  auth: 'authenticated',
  args: {
    postId: v.id('posts'),
    liked: v.boolean(),
    mutationId: v.optional(v.string()),
  },
  reads: ['profiles', 'posts', 'likes'],
  writes: ['posts', 'likes'],
  refusals: ['PROFILE_REQUIRED', 'POST_NOT_FOUND'],
  result: results.value(v.object({
    liked: v.boolean(),
    likeCount: v.integer(),
  })),
  handler: async (ctx, args) => {
    const outcome = await setLikeCore(ctx, args.postId, args.liked, null, args.mutationId);
    return { liked: outcome.liked, likeCount: outcome.likeCount };
  },
});

export const setRepost = defineJsMutation({
  auth: 'authenticated',
  args: {
    postId: v.id('posts'),
    reposted: v.boolean(),
    mutationId: v.optional(v.string()),
  },
  reads: ['profiles', 'posts', 'reposts', 'feedEvents'],
  writes: ['posts', 'reposts', 'feedEvents'],
  refusals: ['PROFILE_REQUIRED', 'POST_NOT_FOUND', 'REPLY_REPOST_FORBIDDEN'],
  result: results.value(v.object({
    reposted: v.boolean(),
    repostCount: v.integer(),
  })),
  handler: async (ctx, args) => {
    const outcome = await setRepostCore(ctx, args.postId, args.reposted, null, args.mutationId);
    return { reposted: outcome.reposted, repostCount: outcome.repostCount };
  },
});

export const ensureFixturePost = defineJsMutation({
  auth: 'authenticated',
  args: {
    fixtureId: v.string(),
    fixtureDigest: v.string(),
    kind: v.string(),
    body: v.string(),
    imageAssetIds: v.array(v.string(), { maxItems: 4 }),
    imageSourceDigests: v.array(v.string(), { maxItems: 4 }),
    videoAssetId: v.optional(v.string()),
    videoSourceDigest: v.optional(v.string()),
    parentId: v.optional(v.id('posts')),
  },
  reads: ['profiles', 'posts', 'postImages', 'postVideos', 'feedEvents'],
  writes: ['posts', 'postImages', 'postVideos', 'feedEvents'],
  refusals: [
    'PROFILE_REQUIRED',
    'POST_BODY_TOO_LONG',
    'POST_IMAGE_COUNT_INVALID',
    'POST_MEDIA_MIXED',
    'POST_KIND_MEDIA_MISMATCH',
    'POST_KIND_INVALID',
    'POST_PARENT_NOT_FOUND',
    'FIXTURE_OWNERSHIP_MISMATCH',
  ],
  result: results.value(v.object({
    postId: v.id('posts'),
    disposition: v.string(),
  })),
  handler: async (ctx, args) => {
    const fixtureId = String(args.fixtureId ?? '').trim();
    if (!fixtureId) throw new Error('fixture id is required');
    const fixtureDigest = normalizedSha256(args.fixtureDigest, 'fixture digest');
    const input = normalizedPostInput(ctx, args);
    if (args.imageSourceDigests.length !== input.imageAssetIds.length) {
      throw new Error('fixture image assets and source digests must have equal length');
    }
    const imageSourceDigests = args.imageSourceDigests.map((digest) => (
      normalizedSha256(digest, 'fixture image source digest')
    ));
    const videoSourceDigest = input.videoAssetId
      ? normalizedSha256(args.videoSourceDigest, 'fixture video source digest')
      : undefined;
    const profile = await requireMyProfile(ctx);
    const parent = await requiredParent(ctx, args.parentId);
    const existing = await ctx.db
      .query('posts')
      .withIndex('by_fixture_id')
      .eq('fixtureId', fixtureId)
      .first();
    if (existing && existing.ownerId !== ctx.auth.userId) {
      ctx.refuse('FIXTURE_OWNERSHIP_MISMATCH');
    }
    if (!existing) {
      const postId = await insertPost(
        ctx,
        profile,
        input,
        parent,
        { id: fixtureId, digest: fixtureDigest },
        { images: imageSourceDigests, video: videoSourceDigest },
      );
      return { postId, disposition: 'created' };
    }
    if ((existing.parentId ?? null) !== (parent?._id ?? null)) {
      throw new Error('fixture post parent identity cannot change');
    }
    await clearPostMedia(ctx, existing._id);
    await ctx.db.patch('posts', existing._id, {
      fixtureDigest,
      kind: input.kind,
      body: input.body,
    });
    await writePostMedia(
      ctx,
      existing._id,
      input,
      imageSourceDigests,
      videoSourceDigest,
    );
    if (!existing.isReply) {
      const event = await ctx.db
        .query('feedEvents')
        .withIndex('by_source_key')
        .eq('sourceKey', `post:${existing._id}`)
        .first();
      if (!event) {
        await ctx.db.insert('feedEvents', {
          eventKind: 'post',
          sourceKey: `post:${existing._id}`,
          postId: existing._id,
          actorProfileId: existing.authorProfileId,
          pageKey: existing.pageKey,
          createdAt: existing.createdAt,
        });
      }
    }
    return { postId: existing._id, disposition: 'repaired' };
  },
});

export const ensureFixtureFollow = defineJsMutation({
  auth: 'authenticated',
  args: {
    profileId: v.id('profiles'),
    mutationId: v.string(),
    sourceDigest: v.string(),
  },
  reads: ['profiles', 'follows'],
  writes: ['follows'],
  refusals: ['PROFILE_REQUIRED', 'PROFILE_NOT_FOUND', 'SELF_FOLLOW_FORBIDDEN'],
  result: results.value(v.string()),
  handler: async (ctx, args) => {
    const outcome = await setFollowCore(
      ctx,
      args.profileId,
      true,
      {
        mutationId: String(args.mutationId),
        digest: normalizedSha256(args.sourceDigest, 'fixture follow source digest'),
      },
      null,
    );
    return outcome.disposition;
  },
});

export const ensureFixtureLike = defineJsMutation({
  auth: 'authenticated',
  args: {
    postId: v.id('posts'),
    mutationId: v.string(),
    sourceDigest: v.string(),
  },
  reads: ['profiles', 'posts', 'likes'],
  writes: ['posts', 'likes'],
  refusals: ['PROFILE_REQUIRED', 'POST_NOT_FOUND'],
  result: results.value(v.string()),
  handler: async (ctx, args) => {
    const outcome = await setLikeCore(ctx, args.postId, true, {
      mutationId: String(args.mutationId),
      digest: normalizedSha256(args.sourceDigest, 'fixture like source digest'),
    }, null);
    return outcome.disposition;
  },
});

export const ensureFixtureRepost = defineJsMutation({
  auth: 'authenticated',
  args: {
    postId: v.id('posts'),
    mutationId: v.string(),
    sourceDigest: v.string(),
  },
  reads: ['profiles', 'posts', 'reposts', 'feedEvents'],
  writes: ['posts', 'reposts', 'feedEvents'],
  refusals: ['PROFILE_REQUIRED', 'POST_NOT_FOUND', 'REPLY_REPOST_FORBIDDEN'],
  result: results.value(v.string()),
  handler: async (ctx, args) => {
    const outcome = await setRepostCore(ctx, args.postId, true, {
      mutationId: String(args.mutationId),
      digest: normalizedSha256(args.sourceDigest, 'fixture repost source digest'),
    }, null);
    return outcome.disposition;
  },
});

export { chunkValues };
