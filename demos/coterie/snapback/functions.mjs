import {
  arg,
  asc,
  authUserId,
  defineAssetUpload,
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
