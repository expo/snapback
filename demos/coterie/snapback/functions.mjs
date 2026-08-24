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

// @ref LLP 0278#d3-closed-membership-semi-join — the interim manual plan
// must admit a finite actor set instead of truncating an unbounded follow graph.
function followingSetLimit() {
  return 1024;
}

function requireFollowingSetCapacity(ctx, currentFollowingCount) {
  if (currentFollowingCount >= followingSetLimit()) {
    ctx.refuse('FOLLOWING_SET_LIMIT_EXCEEDED');
  }
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

async function feedRows(
  ctx,
  args,
  followingOnly,
  actorChunkSize = queryFilterBindingLimit() - 1,
) {
  const viewer = await requireMyProfile(ctx);
  let events;
  if (followingOnly) {
    const follows = await ctx.db
      .query('follows')
      .withIndex('by_follower')
      .eq('followerProfileId', viewer._id)
      // setFollowCore admits at most this many rows, so this bounded read is
      // complete rather than a truncating prefix.
      .take(followingSetLimit())
      .collect();
    const visibleActorIds = [viewer._id, ...follows.map((follow) => follow.followedProfileId)];
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
  args: { before: v.optional(v.string()) },
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
  const followingRows = await ctx.db
    .query('follows')
    .withIndex('by_follower')
    .eq('followerProfileId', follower._id)
    .take(followingSetLimit())
    .collect();
  let followingCount = followingRows.length;
  let disposition = 'matched';
  if (following && !existing) {
    requireFollowingSetCapacity(ctx, followingCount);
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
    followingCount += 1;
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
    followingCount -= 1;
    disposition = 'removed';
  }
  const followers = await ctx.db
    .query('follows')
    .withIndex('by_followed')
    .eq('followedProfileId', target._id)
    .take(1024)
    .collect();
  return {
    following,
    followerCount: followers.length,
    followingCount,
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
  refusals: [
    'PROFILE_REQUIRED',
    'PROFILE_NOT_FOUND',
    'SELF_FOLLOW_FORBIDDEN',
    'FOLLOWING_SET_LIMIT_EXCEEDED',
  ],
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
  refusals: [
    'PROFILE_REQUIRED',
    'PROFILE_NOT_FOUND',
    'SELF_FOLLOW_FORBIDDEN',
    'FOLLOWING_SET_LIMIT_EXCEEDED',
  ],
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

function codePointLength(value) {
  return [...value].length;
}

function normalizedDmPair(leftProfileId, rightProfileId) {
  return [leftProfileId, rightProfileId].sort().join(':');
}

function activeMembershipKey(conversationId, profileId) {
  return `${conversationId}:${profileId}`;
}

function conversationSequencePrefix(sequence) {
  return String(sequence).padStart(12, '0');
}

function conversationPageKey(ctx, sequence) {
  return `${conversationSequencePrefix(sequence)}:${ctx.runtime.id()}`;
}

function removalCutoffPageKey(sequence) {
  return `${conversationSequencePrefix(sequence)}:`;
}

export function receiptEnvelopeMessageLimit() {
  return 1_024;
}

export function receiptEnvelopeAdmits(receiptCount) {
  return Number.isSafeInteger(receiptCount)
    && receiptCount >= 0
    && receiptCount <= receiptEnvelopeMessageLimit();
}

export function chatHistoryEnvelopeLimit() {
  return 1_000;
}

export function messageHistoryEnvelopeLimit() {
  return 1_024;
}

async function getManyChunked(ctx, table, ids) {
  const uniqueIds = [];
  for (const id of ids) {
    if (id && !uniqueIds.includes(id)) uniqueIds.push(id);
  }
  const rows = [];
  for (const chunk of chunkValues(uniqueIds, 256)) {
    rows.push(...(await ctx.db.getMany(table, chunk)).filter((row) => Boolean(row)));
  }
  return rows;
}

async function currentMembershipForProfileConversation(ctx, profileId, conversationId) {
  return ctx.db
    .query('conversationMembers')
    .withIndex('by_active_key')
    .eq('activeKey', activeMembershipKey(conversationId, profileId))
    .first();
}

async function latestMembershipForProfileConversation(ctx, profileId, conversationId) {
  return ctx.db
    .query('conversationMembers')
    .withIndex('by_profile_conversation')
    .eq('profileId', profileId)
    .eq('conversationId', conversationId)
    .order('joinedSequence', 'desc')
    .first();
}

function boundedCurrentMemberships(rows) {
  if (rows.length > 50) {
    throw new Error('conversation current-membership projection exceeds the 50-member invariant');
  }
  return rows;
}

async function chatAccessForProfileConversation(
  ctx,
  conversation,
  profileId,
  refuse = true,
) {
  if (!conversation) {
    if (refuse) ctx.refuse('CHAT_NOT_FOUND');
    return null;
  }
  const active = await currentMembershipForProfileConversation(
    ctx,
    profileId,
    conversation._id,
  );
  if (active) return { conversation, membership: active, active: true, cutoffPageKey: null };
  const historical = await latestMembershipForProfileConversation(
    ctx,
    profileId,
    conversation._id,
  );
  if (!historical || !Number.isSafeInteger(historical.removedSequence)) {
    if (refuse) ctx.refuse('CHAT_MEMBERSHIP_REQUIRED');
    return null;
  }
  return {
    conversation,
    membership: historical,
    active: false,
    cutoffPageKey: removalCutoffPageKey(historical.removedSequence),
  };
}

function requireActiveChatAccess(ctx, access) {
  if (!access.active) ctx.refuse('CHAT_MEMBERSHIP_REQUIRED');
  return access;
}

function requireGroupAdminAccess(ctx, access) {
  requireActiveChatAccess(ctx, access);
  if (access.conversation.kind !== 'group') ctx.refuse('NOT_GROUP_CHAT');
  if (access.membership.role !== 'admin') ctx.refuse('NOT_GROUP_ADMIN');
  return access;
}

function normalizedGroupInput(ctx, args) {
  const name = String(args.name ?? '').trim();
  const description = String(args.description ?? '').trim();
  if (codePointLength(name) < 1 || codePointLength(name) > 50) {
    ctx.refuse('GROUP_NAME_INVALID');
  }
  if (codePointLength(description) > 200) ctx.refuse('GROUP_DESCRIPTION_TOO_LONG');
  return { name, description };
}

function normalizedMessageBody(ctx, value) {
  const body = String(value ?? '');
  if (!body.trim()) ctx.refuse('MESSAGE_BODY_REQUIRED');
  if (codePointLength(body) > 2_000) ctx.refuse('MESSAGE_BODY_TOO_LONG');
  return body;
}

async function requireChatEnvelopeCapacity(ctx, profiles) {
  const seenProfileIds = [];
  for (const profile of profiles) {
    if (seenProfileIds.includes(profile._id)) continue;
    seenProfileIds.push(profile._id);
    const chats = await ctx.db
      .query('conversationMembers')
      .withIndex('by_profile_latest_chat_page')
      .eq('profileId', profile._id)
      .eq('isLatest', true)
      .take(chatHistoryEnvelopeLimit())
      .collect();
    if (chats.length >= chatHistoryEnvelopeLimit()) {
      ctx.refuse('CHAT_ENVELOPE_EXCEEDED');
    }
  }
}

async function createConversationCore(ctx, creator, input, fixture) {
  await requireChatEnvelopeCapacity(ctx, input.initialProfiles);
  const createdAt = ctx.runtime.now();
  const chatPageKey = pageKeyFor(ctx, createdAt);
  // @ref LLP 0056#dated-amendment-bounded-atomic-bootstrap-rosters-2026-08-15
  // — the canonical current roster and its conversation are one atomic
  // authority-creating command; incarnation history is written beside it.
  const conversationId = await ctx.membership.conversationCurrentMembers.bootstrap({
    ownerId: creator.ownerId,
    kind: input.kind,
    ...(input.dmPairKey ? { dmPairKey: input.dmPairKey } : {}),
    ...(fixture ? { fixtureId: fixture.id, fixtureDigest: fixture.digest } : {}),
    ...(input.groupName ? { groupName: input.groupName } : {}),
    ...(input.groupDescription ? { groupDescription: input.groupDescription } : {}),
    creatorProfileId: creator._id,
    nextEventSequence: 1,
    chatPageKey,
    lastMessageAt: createdAt,
    createdAt,
  }, input.initialProfiles
    .filter((profile) => profile._id !== creator._id)
    .map((profile) => ({ ownerId: profile.ownerId, role: 'member' })));
  for (const profile of input.initialProfiles) {
    await ctx.db.insert('conversationMembers', {
      ownerId: profile.ownerId,
      conversationId,
      profileId: profile._id,
      role: input.kind === 'group' && profile._id === creator._id ? 'admin' : 'member',
      joinedAt: createdAt,
      joinedSequence: 0,
      isCurrent: true,
      isLatest: true,
      activeKey: activeMembershipKey(conversationId, profile._id),
      chatPageKey,
      unreadCount: 0,
      receiptCount: 0,
      deliveredThroughSequence: 0,
      readThroughSequence: 0,
    });
  }
  return conversationId;
}

async function openDmCore(ctx, creator, otherProfile, existing, fixture = null) {
  if (creator._id === otherProfile._id) ctx.refuse('SELF_DM_FORBIDDEN');
  const dmPairKey = normalizedDmPair(creator._id, otherProfile._id);
  if (existing) {
    if (existing.kind !== 'dm') throw new Error('normalized DM key is attached to a non-DM');
    if (fixture) {
      if (existing.fixtureId && existing.fixtureId !== fixture.id) {
        ctx.refuse('FIXTURE_OWNERSHIP_MISMATCH');
      }
      if (existing.fixtureId !== fixture.id || existing.fixtureDigest !== fixture.digest) {
        await ctx.db.patch('conversations', existing._id, {
          fixtureId: fixture.id,
          fixtureDigest: fixture.digest,
        });
      }
    }
    return { conversationId: existing._id, disposition: fixture ? 'matched' : 'reused' };
  }
  return {
    conversationId: await createConversationCore(ctx, creator, {
      kind: 'dm',
      dmPairKey,
      initialProfiles: [creator, otherProfile],
    }, fixture),
    disposition: 'created',
  };
}

async function addGroupMemberCore(
  ctx,
  conversation,
  targetProfile,
  existing,
  activeMembers,
  fixture = null,
) {
  const activeKey = activeMembershipKey(conversation._id, targetProfile._id);
  if (existing) {
    let disposition = 'matched';
    if (fixture && (
      existing.fixtureMutationId !== fixture.mutationId
      || existing.fixtureDigest !== fixture.digest
    )) {
      await ctx.db.patch('conversationMembers', existing._id, {
        fixtureMutationId: fixture.mutationId,
        fixtureDigest: fixture.digest,
      });
      disposition = 'repaired';
    }
    return { membershipId: existing._id, disposition };
  }
  if (activeMembers.length >= 50) ctx.refuse('GROUP_MEMBER_LIMIT_REACHED');
  const previousMembership = await latestMembershipForProfileConversation(
    ctx,
    targetProfile._id,
    conversation._id,
  );
  if (!previousMembership) {
    await requireChatEnvelopeCapacity(ctx, [targetProfile]);
  }
  if (previousMembership?.isLatest) {
    await ctx.db.patch('conversationMembers', previousMembership._id, { isLatest: false });
  }
  await ctx.membership.conversationCurrentMembers.insert({
    ownerId: targetProfile.ownerId,
    conversationId: conversation._id,
    role: 'member',
  });
  const joinedAt = ctx.runtime.now();
  const joinedSequence = conversation.nextEventSequence;
  const membershipId = await ctx.db.insert('conversationMembers', {
    ownerId: targetProfile.ownerId,
    conversationId: conversation._id,
    profileId: targetProfile._id,
    role: 'member',
    joinedAt,
    joinedSequence,
    isCurrent: true,
    isLatest: true,
    activeKey,
    chatPageKey: conversation.chatPageKey,
    unreadCount: 0,
    receiptCount: 0,
    deliveredThroughSequence: 0,
    readThroughSequence: 0,
    ...(fixture
      ? { fixtureMutationId: fixture.mutationId, fixtureDigest: fixture.digest }
      : {}),
  });
  await ctx.db.patch('conversations', conversation._id, {
    nextEventSequence: joinedSequence + 1,
  });
  return { membershipId, disposition: 'created' };
}

async function closeMembership(ctx, conversation, membership) {
  if (membership.ownerId === ctx.auth.userId) {
    await ctx.membership.conversationCurrentMembers.removeSelf(conversation._id);
  } else {
    await ctx.membership.conversationCurrentMembers.removePrincipal(
      conversation._id,
      membership.ownerId,
    );
  }
  const removedAt = ctx.runtime.now();
  const removedSequence = conversation.nextEventSequence;
  await ctx.db.patch('conversationMembers', membership._id, {
    removedAt,
    removedSequence,
    isCurrent: false,
    activeKey: `removed:${membership._id}`,
    unreadCount: 0,
  });
  await ctx.db.patch('conversations', conversation._id, {
    nextEventSequence: removedSequence + 1,
  });
  return removedSequence;
}

async function insertMessageCore(
  ctx,
  sender,
  conversation,
  activeMembers,
  body,
  quotedMessage,
  fixture = null,
) {
  const senderMembership = activeMembers.find((member) => member.profileId === sender._id);
  if (!senderMembership) ctx.refuse('CHAT_MEMBERSHIP_REQUIRED');
  const existingMessages = await ctx.db
    .query('messages')
    .withIndex('by_conversation_page')
    .eq('conversationId', conversation._id)
    .take(messageHistoryEnvelopeLimit())
    .collect();
  if (existingMessages.length >= messageHistoryEnvelopeLimit()) {
    ctx.refuse('MESSAGE_ENVELOPE_EXCEEDED');
  }
  const recipients = activeMembers.filter((member) => member.profileId !== sender._id);
  const sequence = conversation.nextEventSequence;
  const createdAt = ctx.runtime.now();
  const pageKey = conversationPageKey(ctx, sequence);
  const chatPageKey = pageKeyFor(ctx, createdAt);
  const messageId = await ctx.db.insert('messages', {
    ownerId: sender.ownerId,
    conversationId: conversation._id,
    senderProfileId: sender._id,
    ...(fixture ? { fixtureId: fixture.id, fixtureDigest: fixture.digest } : {}),
    body,
    ...(quotedMessage ? { quotedMessageId: quotedMessage._id } : {}),
    recipientCount: recipients.length,
    sequence,
    pageKey,
    createdAt,
  });
  for (const recipient of recipients) {
    await ctx.db.insert('messageReceipts', {
      ownerId: recipient.ownerId,
      conversationId: conversation._id,
      messageId,
      recipientMemberId: recipient._id,
      recipientProfileId: recipient.profileId,
      status: 'sent',
      statusRank: 0,
    });
  }
  for (const member of activeMembers) {
    const recipient = member.profileId !== sender._id;
    await ctx.db.patch('conversationMembers', member._id, {
      chatPageKey,
      ...(recipient
        ? {
            unreadCount: member.unreadCount + 1,
            receiptCount: member.receiptCount + 1,
          }
        : {}),
    });
  }
  await ctx.db.patch('conversations', conversation._id, {
    nextEventSequence: sequence + 1,
    chatPageKey,
    lastMessageId: messageId,
    lastMessageAt: createdAt,
  });
  return messageId;
}

function requiredQuotedMessage(ctx, conversationId, quotedMessageId, quoted) {
  if (!quotedMessageId) return null;
  if (!quoted || quoted.conversationId !== conversationId) {
    ctx.refuse('QUOTED_MESSAGE_NOT_FOUND');
  }
  return quoted;
}

function effectiveReceiptRank(message, receipt, membership) {
  let rank = receipt.statusRank;
  if (message.sequence <= membership.deliveredThroughSequence) rank = Math.max(rank, 1);
  if (message.sequence <= membership.readThroughSequence) rank = Math.max(rank, 2);
  return rank;
}

function receiptStatusForRank(rank) {
  return rank >= 2 ? 'read' : rank >= 1 ? 'delivered' : 'sent';
}

function receiptSummaryFor(message, receipts, recipientMemberships) {
  const membershipById = new Map(recipientMemberships.map((row) => [row._id, row]));
  const requiredReceipts = receipts.flatMap((receipt) => {
    const membership = membershipById.get(receipt.recipientMemberId);
    return membership && membership.removedAt == null
      ? [{ receipt, membership }]
      : [];
  });
  const deliveredCount = requiredReceipts.filter(({ receipt, membership }) => (
    effectiveReceiptRank(message, receipt, membership) >= 1
  )).length;
  const readCount = requiredReceipts.filter(({ receipt, membership }) => (
    effectiveReceiptRank(message, receipt, membership) >= 2
  )).length;
  let aggregateStatus = 'sent';
  if (requiredReceipts.length === 0 || readCount === requiredReceipts.length) aggregateStatus = 'read';
  else if (deliveredCount === requiredReceipts.length) aggregateStatus = 'delivered';
  return {
    aggregateStatus,
    recipientCount: message.recipientCount,
    requiredCount: requiredReceipts.length,
    sentCount: requiredReceipts.length,
    deliveredCount,
    readCount,
  };
}

const receiptSummaryRow = v.object({
  aggregateStatus: v.string(),
  recipientCount: v.integer(),
  requiredCount: v.integer(),
  sentCount: v.integer(),
  deliveredCount: v.integer(),
  readCount: v.integer(),
});

const quotedMessageRow = v.object({
  messageId: v.id('messages'),
  excerpt: v.string(),
  senderProfileId: v.id('profiles'),
  senderDisplayName: v.string(),
});

const chatMessageRow = v.object({
  _id: v.id('messages'),
  conversationId: v.id('conversations'),
  senderProfileId: v.id('profiles'),
  senderHandle: v.string(),
  senderDisplayName: v.string(),
  senderAvatar: v.optional(v.assetRef({ upload: 'avatarUpload' })),
  body: v.string(),
  quotedMessageId: v.optional(v.id('messages')),
  quotedMessage: v.optional(quotedMessageRow),
  pageKey: v.string(),
  createdAt: v.integer(),
  viewerReceiptStatus: v.optional(v.string()),
  viewerReceiptRequired: v.boolean(),
  receiptSummary: receiptSummaryRow,
});

async function hydrateChatMessages(
  ctx,
  messages,
  viewerProfileId,
  quotedMessages,
  receipts,
  recipientMemberships,
) {
  if (messages.length === 0) return [];
  const allMessages = [...messages, ...quotedMessages];
  const profiles = await getManyChunked(
    ctx,
    'profiles',
    allMessages.map((message) => message.senderProfileId),
  );
  return messages.map((message) => {
    const sender = profiles.find((profile) => profile._id === message.senderProfileId);
    if (!sender) throw new Error(`message ${message._id} has no sender profile`);
    const messageReceipts = receipts.filter((receipt) => receipt.messageId === message._id);
    const viewerReceipt = messageReceipts.find((receipt) => (
      receipt.recipientProfileId === viewerProfileId
    ));
    const viewerReceiptMembership = viewerReceipt
      ? recipientMemberships.find((membership) => membership._id === viewerReceipt.recipientMemberId)
      : null;
    const viewerReceiptRequired = Boolean(
      viewerReceiptMembership && viewerReceiptMembership.removedAt == null,
    );
    const quoted = message.quotedMessageId
      ? quotedMessages.find((candidate) => candidate._id === message.quotedMessageId)
      : null;
    const quotedSender = quoted
      ? profiles.find((profile) => profile._id === quoted.senderProfileId)
      : null;
    return {
      _id: message._id,
      conversationId: message.conversationId,
      senderProfileId: sender._id,
      senderHandle: sender.handle,
      senderDisplayName: sender.displayName,
      ...(sender.avatar ? { senderAvatar: sender.avatar } : {}),
      body: message.body,
      ...(message.quotedMessageId ? { quotedMessageId: message.quotedMessageId } : {}),
      ...(quoted && quotedSender
        ? {
            quotedMessage: {
              messageId: quoted._id,
              excerpt: [...quoted.body].slice(0, 120).join(''),
              senderProfileId: quotedSender._id,
              senderDisplayName: quotedSender.displayName,
            },
          }
        : {}),
      pageKey: message.pageKey,
      createdAt: message.createdAt,
      ...(viewerReceipt && viewerReceiptMembership
        ? {
            viewerReceiptStatus: receiptStatusForRank(
              effectiveReceiptRank(message, viewerReceipt, viewerReceiptMembership),
            ),
          }
        : {}),
      viewerReceiptRequired,
      receiptSummary: receiptSummaryFor(message, messageReceipts, recipientMemberships),
    };
  });
}

const chatMemberRow = v.object({
  profileId: v.id('profiles'),
  handle: v.string(),
  displayName: v.string(),
  avatar: v.optional(v.assetRef({ upload: 'avatarUpload' })),
  role: v.string(),
  active: v.boolean(),
});

const chatListRow = v.object({
  _id: v.id('conversations'),
  pageKey: v.string(),
  kind: v.string(),
  name: v.string(),
  description: v.string(),
  viewerRole: v.string(),
  active: v.boolean(),
  unreadCount: v.integer(),
  members: v.array(chatMemberRow, { maxItems: 50 }),
  lastMessage: v.optional(chatMessageRow),
  lastMessageAt: v.integer(),
});

async function chatRoster(ctx, memberships) {
  const profiles = await getManyChunked(
    ctx,
    'profiles',
    memberships.map((membership) => membership.profileId),
  );
  return profiles.map((profile) => {
    const membership = memberships.find((candidate) => candidate.profileId === profile._id);
    return {
      profileId: profile._id,
      handle: profile.handle,
      displayName: profile.displayName,
      ...(profile.avatar ? { avatar: profile.avatar } : {}),
      role: membership.role,
      active: true,
    };
  }).sort((left, right) => left.handle.localeCompare(right.handle));
}

export const listChats = defineJsLiveQuery({
  auth: 'authenticated',
  args: {},
  result: results.records(chatListRow, { minItems: 0, maxItems: 1_000 }),
  reads: ['profiles', 'conversations', 'conversationMembers', 'messages', 'messageReceipts'],
  refusals: ['PROFILE_REQUIRED'],
  handler: async (ctx) => {
    const viewer = await requireMyProfile(ctx);
    let membershipQuery = ctx.db
      .query('conversationMembers')
      .withIndex('by_profile_latest_chat_page')
      .eq('profileId', viewer._id)
      .eq('isLatest', true);
    const memberships = await membershipQuery
      .order('chatPageKey', 'desc')
      .take(1_000)
      .collect();
    const byConversation = new Map(
      memberships.map((membership) => [membership.conversationId, membership]),
    );
    const conversations = [];
    for (const chunk of chunkValues([...byConversation.keys()], 256)) {
      conversations.push(...(await ctx.db.elevated.getMany('conversations', chunk))
        .filter((row) => Boolean(row)));
    }
    const projected = [];
    for (const conversation of conversations) {
      const historical = byConversation.get(conversation._id);
      const active = historical?.isCurrent ? historical : null;
      if (!historical) continue;
      const cutoff = active ? null : removalCutoffPageKey(historical.removedSequence);
      let latestQuery = ctx.db.elevated
        .query('messages')
        .withIndex('by_conversation_page')
        .eq('conversationId', conversation._id);
      if (cutoff) latestQuery = latestQuery.lt('pageKey', cutoff);
      const lastMessage = await latestQuery.order('pageKey', 'desc').first();
      let hydrated = null;
      if (lastMessage) {
        const quotedMessages = lastMessage.quotedMessageId
          ? [(await ctx.db.elevated.get('messages', lastMessage.quotedMessageId))].filter(Boolean)
          : [];
        const receipts = await ctx.db.elevated
          .query('messageReceipts')
          .withIndex('by_message')
          .eq('messageId', lastMessage._id)
          .take(49)
          .collect();
        const recipientMemberships = (await ctx.db.elevated.getMany(
          'conversationMembers',
          receipts.map((receipt) => receipt.recipientMemberId),
        )).filter((row) => Boolean(row));
        hydrated = (await hydrateChatMessages(
          ctx,
          [lastMessage],
          viewer._id,
          quotedMessages,
          receipts,
          recipientMemberships,
        ))[0];
      }
      const rosterMemberships = await ctx.db.elevated
        .query('conversationMembers')
        .withIndex('by_current_conversation')
        .eq('conversationId', conversation._id)
        .eq('isCurrent', true)
        .take(51)
        .collect();
      const members = await chatRoster(ctx, boundedCurrentMemberships(rosterMemberships));
      const other = members.find((member) => member.profileId !== viewer._id);
      projected.push({
        _id: conversation._id,
        pageKey: historical.chatPageKey,
        kind: conversation.kind,
        name: conversation.kind === 'group'
          ? conversation.groupName
          : other?.displayName ?? 'Direct message',
        description: conversation.groupDescription ?? '',
        viewerRole: historical.role,
        active: Boolean(active),
        unreadCount: active ? historical.unreadCount : 0,
        members,
        ...(hydrated ? { lastMessage: hydrated } : {}),
        lastMessageAt: hydrated?.createdAt ?? conversation.createdAt,
      });
    }
    return projected
      .sort((left, right) => right.pageKey.localeCompare(left.pageKey));
  },
});

export const listMessages = defineJsLiveQuery({
  auth: 'authenticated',
  args: {
    conversationId: v.id('conversations'),
  },
  result: results.records(chatMessageRow, { minItems: 0, maxItems: 1_024 }),
  reads: ['profiles', 'conversations', 'conversationMembers', 'messages', 'messageReceipts'],
  refusals: ['PROFILE_REQUIRED', 'CHAT_NOT_FOUND', 'CHAT_MEMBERSHIP_REQUIRED'],
  handler: async (ctx, args) => {
    const viewer = await requireMyProfile(ctx);
    const conversation = await ctx.db.elevated.get('conversations', args.conversationId);
    const access = await chatAccessForProfileConversation(
      ctx,
      conversation,
      viewer._id,
    );
    const before = access.cutoffPageKey;
    let query = ctx.db.elevated
      .query('messages')
      .withIndex('by_conversation_page')
      .eq('conversationId', args.conversationId);
    if (before) query = query.lt('pageKey', before);
    const rows = await query.order('pageKey', 'desc').take(1_024).collect();
    const quotedMessages = (await ctx.db.elevated.getMany(
      'messages',
      rows.map((message) => message.quotedMessageId).filter(Boolean),
    )).filter((row) => Boolean(row));
    const receipts = [];
    for (const messageChunk of chunkValues(rows, 20)) {
      receipts.push(...(await ctx.db.elevated
        .query('messageReceipts')
        .withIndex('by_message')
        .in('messageId', messageChunk.map((message) => message._id))
        .take(messageChunk.length * 49)
        .collect()));
    }
    const recipientMembershipIds = [];
    for (const receipt of receipts) {
      if (!recipientMembershipIds.includes(receipt.recipientMemberId)) {
        recipientMembershipIds.push(receipt.recipientMemberId);
      }
    }
    const recipientMemberships = [];
    for (const chunk of chunkValues(recipientMembershipIds, 256)) {
      recipientMemberships.push(...(await ctx.db.elevated.getMany(
        'conversationMembers',
        chunk,
      )).filter((row) => Boolean(row)));
    }
    return hydrateChatMessages(
      ctx,
      rows,
      viewer._id,
      quotedMessages,
      receipts,
      recipientMemberships,
    );
  },
});

export const openDm = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { otherProfileId: v.id('profiles') },
  result: results.value(v.object({
    conversationId: v.id('conversations'),
    disposition: v.string(),
  })),
  reads: ['profiles', 'conversations', 'conversationMembers'],
  writes: ['conversations', 'conversationMembers', 'conversationCurrentMembers'],
  refusals: [
    'PROFILE_REQUIRED',
    'PROFILE_NOT_FOUND',
    'SELF_DM_FORBIDDEN',
    'CHAT_ENVELOPE_EXCEEDED',
  ],
  handler: async (ctx, args) => {
    const creator = await requireMyProfile(ctx);
    const other = await ctx.db.get('profiles', args.otherProfileId);
    if (!other) ctx.refuse('PROFILE_NOT_FOUND');
    const dmPairKey = normalizedDmPair(creator._id, other._id);
    const existing = await ctx.db.elevated
      .query('conversations')
      .withIndex('by_dm_pair')
      .eq('dmPairKey', dmPairKey)
      .first();
    return openDmCore(ctx, creator, other, existing);
  },
});

export const createGroup = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {
    name: v.string(),
    description: v.string(),
    memberProfileIds: v.array(v.id('profiles'), { maxItems: 64 }),
  },
  result: results.value(v.id('conversations')),
  reads: ['profiles', 'conversationMembers'],
  writes: ['conversations', 'conversationMembers', 'conversationCurrentMembers'],
  refusals: [
    'PROFILE_REQUIRED',
    'PROFILE_NOT_FOUND',
    'GROUP_NAME_INVALID',
    'GROUP_DESCRIPTION_TOO_LONG',
    'GROUP_SIZE_INVALID',
    'CHAT_ENVELOPE_EXCEEDED',
  ],
  handler: async (ctx, args) => {
    const creator = await requireMyProfile(ctx);
    const input = normalizedGroupInput(ctx, args);
    const memberProfileIds = [];
    for (const profileId of args.memberProfileIds) {
      if (profileId !== creator._id && !memberProfileIds.includes(profileId)) {
        memberProfileIds.push(profileId);
      }
    }
    if (memberProfileIds.length < 1 || memberProfileIds.length > 49) {
      ctx.refuse('GROUP_SIZE_INVALID');
    }
    const members = await getManyChunked(ctx, 'profiles', memberProfileIds);
    if (members.length !== memberProfileIds.length) ctx.refuse('PROFILE_NOT_FOUND');
    return createConversationCore(ctx, creator, {
      kind: 'group',
      groupName: input.name,
      groupDescription: input.description,
      initialProfiles: [creator, ...members],
    }, null);
  },
});

export const addMember = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {
    conversationId: v.id('conversations'),
    profileId: v.id('profiles'),
  },
  result: results.value(v.id('conversationMembers')),
  reads: ['profiles', 'conversations', 'conversationMembers'],
  writes: ['conversations', 'conversationMembers', 'conversationCurrentMembers'],
  refusals: [
    'PROFILE_REQUIRED',
    'PROFILE_NOT_FOUND',
    'CHAT_NOT_FOUND',
    'CHAT_MEMBERSHIP_REQUIRED',
    'NOT_GROUP_CHAT',
    'NOT_GROUP_ADMIN',
    'MEMBER_ALREADY_EXISTS',
    'GROUP_MEMBER_LIMIT_REACHED',
    'CHAT_ENVELOPE_EXCEEDED',
  ],
  handler: async (ctx, args) => {
    const actor = await requireMyProfile(ctx);
    const conversation = await ctx.db.elevated.get('conversations', args.conversationId);
    const access = requireGroupAdminAccess(
      ctx,
      await chatAccessForProfileConversation(ctx, conversation, actor._id),
    );
    const target = await ctx.db.get('profiles', args.profileId);
    if (!target) ctx.refuse('PROFILE_NOT_FOUND');
    const existing = await ctx.db.elevated
      .query('conversationMembers')
      .withIndex('by_active_key')
      .eq('activeKey', activeMembershipKey(access.conversation._id, target._id))
      .first();
    if (existing) ctx.refuse('MEMBER_ALREADY_EXISTS');
    const allMembers = await ctx.db.elevated
      .query('conversationMembers')
      .withIndex('by_current_conversation')
      .eq('conversationId', access.conversation._id)
      .eq('isCurrent', true)
      .take(51)
      .collect();
    return (await addGroupMemberCore(
      ctx,
      access.conversation,
      target,
      existing,
      boundedCurrentMemberships(allMembers),
    )).membershipId;
  },
});

export const removeMember = defineJsMutation({
  auth: 'authenticated',
  args: {
    conversationId: v.id('conversations'),
    profileId: v.id('profiles'),
  },
  result: results.value(v.id('conversations')),
  reads: ['profiles', 'conversations', 'conversationMembers', 'conversationCurrentMembers'],
  writes: ['conversations', 'conversationMembers', 'conversationCurrentMembers'],
  refusals: [
    'PROFILE_REQUIRED',
    'CHAT_NOT_FOUND',
    'CHAT_MEMBERSHIP_REQUIRED',
    'NOT_GROUP_CHAT',
    'NOT_GROUP_ADMIN',
    'MEMBER_NOT_FOUND',
    'REMOVE_SELF_WITH_LEAVE',
  ],
  handler: async (ctx, args) => {
    const actor = await requireMyProfile(ctx);
    const conversation = await ctx.db.elevated.get('conversations', args.conversationId);
    const access = requireGroupAdminAccess(
      ctx,
      await chatAccessForProfileConversation(ctx, conversation, actor._id),
    );
    if (actor._id === args.profileId) ctx.refuse('REMOVE_SELF_WITH_LEAVE');
    const memberRows = await ctx.db.elevated
      .query('conversationMembers')
      .withIndex('by_current_conversation')
      .eq('conversationId', access.conversation._id)
      .eq('isCurrent', true)
      .take(51)
      .collect();
    const members = boundedCurrentMemberships(memberRows);
    const target = members.find((membership) => membership.profileId === args.profileId);
    if (!target) ctx.refuse('MEMBER_NOT_FOUND');
    await closeMembership(ctx, access.conversation, target);
    return access.conversation._id;
  },
});

export const promoteAdmin = defineJsMutation({
  auth: 'authenticated',
  args: {
    conversationId: v.id('conversations'),
    profileId: v.id('profiles'),
  },
  result: results.value(v.id('conversationMembers')),
  reads: ['profiles', 'conversations', 'conversationMembers'],
  writes: ['conversationMembers'],
  refusals: [
    'PROFILE_REQUIRED',
    'CHAT_NOT_FOUND',
    'CHAT_MEMBERSHIP_REQUIRED',
    'NOT_GROUP_CHAT',
    'NOT_GROUP_ADMIN',
    'MEMBER_NOT_FOUND',
  ],
  handler: async (ctx, args) => {
    const actor = await requireMyProfile(ctx);
    const conversation = await ctx.db.elevated.get('conversations', args.conversationId);
    const access = requireGroupAdminAccess(
      ctx,
      await chatAccessForProfileConversation(ctx, conversation, actor._id),
    );
    const memberRows = await ctx.db.elevated
      .query('conversationMembers')
      .withIndex('by_current_conversation')
      .eq('conversationId', access.conversation._id)
      .eq('isCurrent', true)
      .take(51)
      .collect();
    const members = boundedCurrentMemberships(memberRows);
    const target = members.find((membership) => membership.profileId === args.profileId);
    if (!target) ctx.refuse('MEMBER_NOT_FOUND');
    if (target.role !== 'admin') {
      await ctx.db.patch('conversationMembers', target._id, { role: 'admin' });
    }
    return target._id;
  },
});

export const leaveChat = defineJsMutation({
  auth: 'authenticated',
  args: { conversationId: v.id('conversations') },
  result: results.value(v.id('conversations')),
  reads: ['profiles', 'conversations', 'conversationMembers', 'conversationCurrentMembers'],
  writes: ['conversations', 'conversationMembers', 'conversationCurrentMembers'],
  refusals: [
    'PROFILE_REQUIRED',
    'CHAT_NOT_FOUND',
    'CHAT_MEMBERSHIP_REQUIRED',
    'NOT_GROUP_CHAT',
  ],
  handler: async (ctx, args) => {
    const actor = await requireMyProfile(ctx);
    const conversation = await ctx.db.elevated.get('conversations', args.conversationId);
    const access = requireActiveChatAccess(
      ctx,
      await chatAccessForProfileConversation(ctx, conversation, actor._id),
    );
    if (access.conversation.kind !== 'group') ctx.refuse('NOT_GROUP_CHAT');
    await closeMembership(ctx, access.conversation, access.membership);
    return access.conversation._id;
  },
});

export const sendMessage = defineJsMutation({
  auth: 'authenticated',
  args: {
    conversationId: v.id('conversations'),
    body: v.string(),
    quotedMessageId: v.optional(v.id('messages')),
  },
  result: results.value(v.id('messages')),
  reads: ['profiles', 'conversations', 'conversationMembers', 'messages'],
  writes: ['conversations', 'conversationMembers', 'messages', 'messageReceipts'],
  refusals: [
    'PROFILE_REQUIRED',
    'CHAT_NOT_FOUND',
    'CHAT_MEMBERSHIP_REQUIRED',
    'MESSAGE_BODY_REQUIRED',
    'MESSAGE_BODY_TOO_LONG',
    'QUOTED_MESSAGE_NOT_FOUND',
    'MESSAGE_ENVELOPE_EXCEEDED',
  ],
  handler: async (ctx, args) => {
    const sender = await requireMyProfile(ctx);
    const conversation = await ctx.db.elevated.get('conversations', args.conversationId);
    const access = requireActiveChatAccess(
      ctx,
      await chatAccessForProfileConversation(ctx, conversation, sender._id),
    );
    const body = normalizedMessageBody(ctx, args.body);
    const quotedRow = args.quotedMessageId
      ? await ctx.db.elevated.get('messages', args.quotedMessageId)
      : null;
    const quoted = requiredQuotedMessage(
      ctx,
      access.conversation._id,
      args.quotedMessageId,
      quotedRow,
    );
    const memberRows = await ctx.db.elevated
      .query('conversationMembers')
      .withIndex('by_current_conversation')
      .eq('conversationId', access.conversation._id)
      .eq('isCurrent', true)
      .take(51)
      .collect();
    return insertMessageCore(
      ctx,
      sender,
      access.conversation,
      boundedCurrentMemberships(memberRows),
      body,
      quoted,
    );
  },
});

async function advanceReceipt(ctx, message, receipt, membership, targetStatus, targetRank) {
  const currentRank = effectiveReceiptRank(message, receipt, membership);
  if (currentRank < targetRank) {
    const now = ctx.runtime.now();
    await ctx.db.patch('messageReceipts', receipt._id, {
      status: targetStatus,
      statusRank: targetRank,
      ...(targetRank >= 1 && receipt.deliveredAt == null ? { deliveredAt: now } : {}),
      ...(targetRank >= 2 && receipt.readAt == null ? { readAt: now } : {}),
    });
    if (targetRank >= 2) {
      await ctx.db.patch('conversationMembers', membership._id, {
        unreadCount: Math.max(0, membership.unreadCount - 1),
      });
    }
    return targetStatus;
  }
  return receiptStatusForRank(currentRank);
}

const receiptMutationResult = results.value(v.object({ status: v.string() }));

export const markDelivered = defineJsMutation({
  auth: 'authenticated',
  args: { messageId: v.id('messages') },
  result: receiptMutationResult,
  reads: ['profiles', 'conversations', 'conversationMembers', 'messages', 'messageReceipts'],
  writes: ['conversationMembers', 'messageReceipts'],
  refusals: [
    'PROFILE_REQUIRED',
    'CHAT_NOT_FOUND',
    'CHAT_MEMBERSHIP_REQUIRED',
    'MESSAGE_NOT_FOUND',
    'MESSAGE_RECEIPT_NOT_RECIPIENT',
  ],
  handler: async (ctx, args) => {
    const viewer = await requireMyProfile(ctx);
    const message = await ctx.db.elevated.get('messages', args.messageId);
    if (!message) ctx.refuse('MESSAGE_NOT_FOUND');
    const conversation = await ctx.db.elevated.get('conversations', message.conversationId);
    const access = requireActiveChatAccess(
      ctx,
      await chatAccessForProfileConversation(ctx, conversation, viewer._id),
    );
    const receipts = await ctx.db
      .query('messageReceipts')
      .withIndex('by_recipient_message')
      .eq('recipientProfileId', viewer._id)
      .eq('messageId', message._id)
      .take(2)
      .collect();
    const receipt = receipts[0];
    if (!receipt || receipt.recipientMemberId !== access.membership._id) {
      ctx.refuse('MESSAGE_RECEIPT_NOT_RECIPIENT');
    }
    return {
      status: await advanceReceipt(
        ctx,
        message,
        receipt,
        access.membership,
        'delivered',
        1,
      ),
    };
  },
});

export const markRead = defineJsMutation({
  auth: 'authenticated',
  args: { messageId: v.id('messages') },
  result: receiptMutationResult,
  reads: ['profiles', 'conversations', 'conversationMembers', 'messages', 'messageReceipts'],
  writes: ['conversationMembers', 'messageReceipts'],
  refusals: [
    'PROFILE_REQUIRED',
    'CHAT_NOT_FOUND',
    'CHAT_MEMBERSHIP_REQUIRED',
    'MESSAGE_NOT_FOUND',
    'MESSAGE_RECEIPT_NOT_RECIPIENT',
  ],
  handler: async (ctx, args) => {
    const viewer = await requireMyProfile(ctx);
    const message = await ctx.db.elevated.get('messages', args.messageId);
    if (!message) ctx.refuse('MESSAGE_NOT_FOUND');
    const conversation = await ctx.db.elevated.get('conversations', message.conversationId);
    const access = requireActiveChatAccess(
      ctx,
      await chatAccessForProfileConversation(ctx, conversation, viewer._id),
    );
    const receipts = await ctx.db
      .query('messageReceipts')
      .withIndex('by_recipient_message')
      .eq('recipientProfileId', viewer._id)
      .eq('messageId', message._id)
      .take(2)
      .collect();
    const receipt = receipts[0];
    if (!receipt || receipt.recipientMemberId !== access.membership._id) {
      ctx.refuse('MESSAGE_RECEIPT_NOT_RECIPIENT');
    }
    return {
      status: await advanceReceipt(ctx, message, receipt, access.membership, 'read', 2),
    };
  },
});

export const markReceiptsThrough = defineJsMutation({
  auth: 'authenticated',
  args: {
    conversationId: v.id('conversations'),
    state: v.string(),
  },
  result: results.value(v.object({
    status: v.string(),
    requiredCount: v.integer(),
    throughSequence: v.integer(),
  })),
  reads: ['profiles', 'conversations', 'conversationMembers'],
  writes: ['conversationMembers'],
  refusals: [
    'PROFILE_REQUIRED',
    'CHAT_NOT_FOUND',
    'CHAT_MEMBERSHIP_REQUIRED',
    'RECEIPT_STATE_INVALID',
    'RECEIPT_ENVELOPE_EXCEEDED',
  ],
  handler: async (ctx, args) => {
    const viewer = await requireMyProfile(ctx);
    const conversation = await ctx.db.elevated.get('conversations', args.conversationId);
    const access = requireActiveChatAccess(
      ctx,
      await chatAccessForProfileConversation(ctx, conversation, viewer._id),
    );
    const state = String(args.state);
    if (state !== 'delivered' && state !== 'read') ctx.refuse('RECEIPT_STATE_INVALID');

    // Admission is decided from the atomically maintained incarnation count
    // before the single membership projection is changed. The exact benchmark
    // boundary (10,000 required messages) is admitted; 10,001 is refused.
    if (!receiptEnvelopeAdmits(access.membership.receiptCount)) {
      ctx.refuse('RECEIPT_ENVELOPE_EXCEEDED');
    }
    const throughSequence = Math.max(0, access.conversation.nextEventSequence - 1);
    const deliveredThroughSequence = Math.max(
      access.membership.deliveredThroughSequence,
      throughSequence,
    );
    const readThroughSequence = state === 'read'
      ? Math.max(access.membership.readThroughSequence, throughSequence)
      : access.membership.readThroughSequence;
    await ctx.db.patch('conversationMembers', access.membership._id, {
      deliveredThroughSequence,
      readThroughSequence,
      ...(state === 'read' ? { unreadCount: 0 } : {}),
    });
    return {
      status: state,
      requiredCount: access.membership.receiptCount,
      throughSequence,
    };
  },
});

const fixtureConversationRow = v.object({
  _id: v.id('conversations'),
  kind: v.string(),
  fixtureId: v.string(),
  fixtureDigest: v.string(),
  groupName: v.optional(v.string()),
  groupDescription: v.optional(v.string()),
});

export const getMyFixtureConversation = defineJsQuery({
  auth: 'authenticated',
  args: { fixtureId: v.string() },
  result: results.records(fixtureConversationRow, { minItems: 0, maxItems: 1 }),
  reads: ['profiles', 'conversations', 'conversationMembers'],
  refusals: ['PROFILE_REQUIRED'],
  handler: async (ctx, args) => {
    const viewer = await requireMyProfile(ctx);
    const conversation = await ctx.db.elevated
      .query('conversations')
      .withIndex('by_fixture_id')
      .eq('fixtureId', String(args.fixtureId))
      .first();
    if (!conversation) return [];
    const access = await chatAccessForProfileConversation(
      ctx,
      conversation,
      viewer._id,
      false,
    );
    if (!access) return [];
    return [{
      _id: conversation._id,
      kind: conversation.kind,
      fixtureId: conversation.fixtureId,
      fixtureDigest: conversation.fixtureDigest,
      ...(conversation.groupName ? { groupName: conversation.groupName } : {}),
      ...(conversation.groupDescription
        ? { groupDescription: conversation.groupDescription }
        : {}),
    }];
  },
});

const fixtureMessageRow = v.object({
  _id: v.id('messages'),
  conversationId: v.id('conversations'),
  senderProfileId: v.id('profiles'),
  fixtureId: v.string(),
  fixtureDigest: v.string(),
  body: v.string(),
  quotedMessageId: v.optional(v.id('messages')),
  recipientCount: v.integer(),
});

export const getMyFixtureMessage = defineJsQuery({
  auth: 'authenticated',
  args: { fixtureId: v.string() },
  result: results.records(fixtureMessageRow, { minItems: 0, maxItems: 1 }),
  reads: ['profiles', 'conversations', 'conversationMembers', 'messages'],
  refusals: ['PROFILE_REQUIRED'],
  handler: async (ctx, args) => {
    const viewer = await requireMyProfile(ctx);
    const message = await ctx.db.elevated
      .query('messages')
      .withIndex('by_fixture_id')
      .eq('fixtureId', String(args.fixtureId))
      .first();
    if (!message) return [];
    const conversation = await ctx.db.elevated.get('conversations', message.conversationId);
    const access = await chatAccessForProfileConversation(ctx, conversation, viewer._id, false);
    if (!access) return [];
    if (access.cutoffPageKey && message.pageKey >= access.cutoffPageKey) return [];
    return [{
      _id: message._id,
      conversationId: message.conversationId,
      senderProfileId: message.senderProfileId,
      fixtureId: message.fixtureId,
      fixtureDigest: message.fixtureDigest,
      body: message.body,
      ...(message.quotedMessageId ? { quotedMessageId: message.quotedMessageId } : {}),
      recipientCount: message.recipientCount,
    }];
  },
});

export const ensureFixtureDm = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {
    fixtureId: v.string(),
    fixtureDigest: v.string(),
    otherProfileId: v.id('profiles'),
  },
  result: results.value(v.object({
    conversationId: v.id('conversations'),
    disposition: v.string(),
  })),
  reads: ['profiles', 'conversations', 'conversationMembers'],
  writes: ['conversations', 'conversationMembers', 'conversationCurrentMembers'],
  refusals: [
    'PROFILE_REQUIRED',
    'PROFILE_NOT_FOUND',
    'SELF_DM_FORBIDDEN',
    'FIXTURE_OWNERSHIP_MISMATCH',
    'CHAT_ENVELOPE_EXCEEDED',
  ],
  handler: async (ctx, args) => {
    const creator = await requireMyProfile(ctx);
    const other = await ctx.db.get('profiles', args.otherProfileId);
    if (!other) ctx.refuse('PROFILE_NOT_FOUND');
    const fixture = {
      id: String(args.fixtureId),
      digest: normalizedSha256(args.fixtureDigest, 'fixture DM source digest'),
    };
    const byFixture = await ctx.db.elevated
      .query('conversations')
      .withIndex('by_fixture_id')
      .eq('fixtureId', fixture.id)
      .first();
    if (byFixture) {
      if (
        byFixture.kind !== 'dm'
        || byFixture.dmPairKey !== normalizedDmPair(creator._id, other._id)
      ) ctx.refuse('FIXTURE_OWNERSHIP_MISMATCH');
      if (byFixture.fixtureDigest !== fixture.digest) {
        await ctx.db.patch('conversations', byFixture._id, { fixtureDigest: fixture.digest });
        return { conversationId: byFixture._id, disposition: 'repaired' };
      }
      return { conversationId: byFixture._id, disposition: 'matched' };
    }
    const pairConversation = await ctx.db.elevated
      .query('conversations')
      .withIndex('by_dm_pair')
      .eq('dmPairKey', normalizedDmPair(creator._id, other._id))
      .first();
    return openDmCore(ctx, creator, other, pairConversation, fixture);
  },
});

export const ensureFixtureGroup = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {
    fixtureId: v.string(),
    fixtureDigest: v.string(),
    secondMemberProfileId: v.id('profiles'),
    name: v.string(),
    description: v.string(),
  },
  result: results.value(v.object({
    conversationId: v.id('conversations'),
    disposition: v.string(),
  })),
  reads: ['profiles', 'conversations', 'conversationMembers'],
  writes: ['conversations', 'conversationMembers', 'conversationCurrentMembers'],
  refusals: [
    'PROFILE_REQUIRED',
    'PROFILE_NOT_FOUND',
    'GROUP_NAME_INVALID',
    'GROUP_DESCRIPTION_TOO_LONG',
    'FIXTURE_OWNERSHIP_MISMATCH',
    'GROUP_MEMBER_LIMIT_REACHED',
    'CHAT_ENVELOPE_EXCEEDED',
  ],
  handler: async (ctx, args) => {
    const creator = await requireMyProfile(ctx);
    const second = await ctx.db.get('profiles', args.secondMemberProfileId);
    if (!second) ctx.refuse('PROFILE_NOT_FOUND');
    if (second._id === creator._id) ctx.refuse('FIXTURE_OWNERSHIP_MISMATCH');
    const input = normalizedGroupInput(ctx, args);
    const fixture = {
      id: String(args.fixtureId),
      digest: normalizedSha256(args.fixtureDigest, 'fixture group source digest'),
    };
    const existing = await ctx.db.elevated
      .query('conversations')
      .withIndex('by_fixture_id')
      .eq('fixtureId', fixture.id)
      .first();
    if (existing) {
      if (existing.kind !== 'group' || existing.creatorProfileId !== creator._id) {
        ctx.refuse('FIXTURE_OWNERSHIP_MISMATCH');
      }
      let disposition = 'matched';
      if (
        existing.fixtureDigest !== fixture.digest
        || existing.groupName !== input.name
        || (existing.groupDescription ?? '') !== input.description
      ) {
        await ctx.db.patch('conversations', existing._id, {
          fixtureDigest: fixture.digest,
          groupName: input.name,
          groupDescription: input.description,
        });
        disposition = 'repaired';
      }
      const existingMembership = await ctx.db.elevated
        .query('conversationMembers')
        .withIndex('by_active_key')
        .eq('activeKey', activeMembershipKey(existing._id, second._id))
        .first();
      const memberRows = await ctx.db.elevated
        .query('conversationMembers')
        .withIndex('by_current_conversation')
        .eq('conversationId', existing._id)
        .eq('isCurrent', true)
        .take(51)
        .collect();
      const membership = await addGroupMemberCore(
        ctx,
        existing,
        second,
        existingMembership,
        boundedCurrentMemberships(memberRows),
      );
      if (membership.disposition === 'created') disposition = 'repaired';
      return { conversationId: existing._id, disposition };
    }
    return {
      conversationId: await createConversationCore(ctx, creator, {
        kind: 'group',
        groupName: input.name,
        groupDescription: input.description,
        initialProfiles: [creator, second],
      }, fixture),
      disposition: 'created',
    };
  },
});

export const ensureFixtureMember = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {
    conversationId: v.id('conversations'),
    profileId: v.id('profiles'),
    mutationId: v.string(),
    sourceDigest: v.string(),
  },
  result: results.value(v.object({
    membershipId: v.id('conversationMembers'),
    disposition: v.string(),
  })),
  reads: ['profiles', 'conversations', 'conversationMembers'],
  writes: ['conversations', 'conversationMembers', 'conversationCurrentMembers'],
  refusals: [
    'PROFILE_REQUIRED',
    'PROFILE_NOT_FOUND',
    'CHAT_NOT_FOUND',
    'CHAT_MEMBERSHIP_REQUIRED',
    'NOT_GROUP_CHAT',
    'NOT_GROUP_ADMIN',
    'GROUP_MEMBER_LIMIT_REACHED',
    'FIXTURE_OWNERSHIP_MISMATCH',
    'CHAT_ENVELOPE_EXCEEDED',
  ],
  handler: async (ctx, args) => {
    const actor = await requireMyProfile(ctx);
    const conversation = await ctx.db.elevated.get('conversations', args.conversationId);
    const access = requireGroupAdminAccess(
      ctx,
      await chatAccessForProfileConversation(ctx, conversation, actor._id),
    );
    const target = await ctx.db.get('profiles', args.profileId);
    if (!target) ctx.refuse('PROFILE_NOT_FOUND');
    const mutationId = String(args.mutationId);
    const fixtureDigest = normalizedSha256(args.sourceDigest, 'fixture member source digest');
    const byFixture = await ctx.db.elevated
      .query('conversationMembers')
      .withIndex('by_fixture_mutation')
      .eq('fixtureMutationId', mutationId)
      .first();
    if (byFixture && (
      byFixture.conversationId !== access.conversation._id
      || byFixture.profileId !== target._id
    )) ctx.refuse('FIXTURE_OWNERSHIP_MISMATCH');
    if (byFixture && byFixture.removedAt == null) {
      if (byFixture.fixtureDigest !== fixtureDigest) {
        await ctx.db.patch('conversationMembers', byFixture._id, { fixtureDigest });
        return { membershipId: byFixture._id, disposition: 'repaired' };
      }
      return { membershipId: byFixture._id, disposition: 'matched' };
    }
    if (byFixture) ctx.refuse('FIXTURE_OWNERSHIP_MISMATCH');
    const existingMembership = await ctx.db.elevated
      .query('conversationMembers')
      .withIndex('by_active_key')
      .eq('activeKey', activeMembershipKey(access.conversation._id, target._id))
      .first();
    const memberRows = await ctx.db.elevated
      .query('conversationMembers')
      .withIndex('by_current_conversation')
      .eq('conversationId', access.conversation._id)
      .eq('isCurrent', true)
      .take(51)
      .collect();
    return addGroupMemberCore(
      ctx,
      access.conversation,
      target,
      existingMembership,
      boundedCurrentMemberships(memberRows),
      { mutationId, digest: fixtureDigest },
    );
  },
});

export const ensureFixtureMessage = defineJsMutation({
  auth: 'authenticated',
  args: {
    fixtureId: v.string(),
    fixtureDigest: v.string(),
    conversationId: v.id('conversations'),
    body: v.string(),
    quotedMessageId: v.optional(v.id('messages')),
  },
  result: results.value(v.object({
    messageId: v.id('messages'),
    disposition: v.string(),
  })),
  reads: ['profiles', 'conversations', 'conversationMembers', 'messages', 'messageReceipts'],
  writes: ['conversations', 'conversationMembers', 'messages', 'messageReceipts'],
  refusals: [
    'PROFILE_REQUIRED',
    'CHAT_NOT_FOUND',
    'CHAT_MEMBERSHIP_REQUIRED',
    'MESSAGE_BODY_REQUIRED',
    'MESSAGE_BODY_TOO_LONG',
    'QUOTED_MESSAGE_NOT_FOUND',
    'FIXTURE_OWNERSHIP_MISMATCH',
    'MESSAGE_ENVELOPE_EXCEEDED',
  ],
  handler: async (ctx, args) => {
    const sender = await requireMyProfile(ctx);
    const conversation = await ctx.db.elevated.get('conversations', args.conversationId);
    const access = requireActiveChatAccess(
      ctx,
      await chatAccessForProfileConversation(ctx, conversation, sender._id),
    );
    const body = normalizedMessageBody(ctx, args.body);
    const quotedRow = args.quotedMessageId
      ? await ctx.db.elevated.get('messages', args.quotedMessageId)
      : null;
    const quoted = requiredQuotedMessage(
      ctx,
      access.conversation._id,
      args.quotedMessageId,
      quotedRow,
    );
    const fixtureId = String(args.fixtureId);
    const fixtureDigest = normalizedSha256(args.fixtureDigest, 'fixture message source digest');
    const existing = await ctx.db.elevated
      .query('messages')
      .withIndex('by_fixture_id')
      .eq('fixtureId', fixtureId)
      .first();
    if (existing) {
      if (
        existing.conversationId !== access.conversation._id
        || existing.senderProfileId !== sender._id
      ) ctx.refuse('FIXTURE_OWNERSHIP_MISMATCH');
      const quotedId = quoted?._id ?? null;
      if (
        existing.fixtureDigest !== fixtureDigest
        || existing.body !== body
        || (existing.quotedMessageId ?? null) !== quotedId
      ) {
        await ctx.db.patch('messages', existing._id, {
          fixtureDigest,
          body,
          quotedMessageId: quotedId,
        });
        return { messageId: existing._id, disposition: 'repaired' };
      }
      return { messageId: existing._id, disposition: 'matched' };
    }
    const memberRows = await ctx.db.elevated
      .query('conversationMembers')
      .withIndex('by_current_conversation')
      .eq('conversationId', access.conversation._id)
      .eq('isCurrent', true)
      .take(51)
      .collect();
    return {
      messageId: await insertMessageCore(
        ctx,
        sender,
        access.conversation,
        boundedCurrentMemberships(memberRows),
        body,
        quoted,
        { id: fixtureId, digest: fixtureDigest },
      ),
      disposition: 'created',
    };
  },
});

export { chunkValues };
