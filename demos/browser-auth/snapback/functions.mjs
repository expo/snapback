import {
  defineJsMutation,
  defineJsQuery,
  results,
  v,
} from '../../_kit/define.mjs';

async function requireBoundUser(ctx) {
  if (!ctx.auth || typeof ctx.auth.userId !== 'string') {
    throw new Error('an authenticated principal is required');
  }
  const binding = await ctx.db
    .query('identityBindings')
    .withIndex('by_principal')
    .eq('principal', ctx.auth.userId)
    .first();
  if (!binding) throw new Error('the authenticated principal is not bound');
  const appUser = await ctx.db.get('appUsers', binding.appUserId);
  if (
    !appUser
    || appUser.externalIssuer !== binding.externalIssuer
    || appUser.externalSubject !== binding.externalSubject
  ) {
    throw new Error('the principal binding no longer names the same app user');
  }
  return { appUser, binding };
}

// Closed deterministic setup for this demo's two app-user rows. Like the
// binder below, this operation is absent from the browser gateway allowlist.
export const brokerEnsureFixtureUsers = defineJsMutation({
  auth: 'authenticated',
  args: {},
  reads: ['appUsers'],
  writes: ['appUsers'],
  result: results.value(v.integer()),
  handler: async (ctx) => {
    const users = [
      {
        externalIssuer: 'https://identity.fixture.invalid',
        externalSubject: 'fixture-alice-001',
        displayName: 'Alice Fixture',
        privateNote: 'alice-only: north star',
      },
      {
        externalIssuer: 'https://identity.fixture.invalid',
        externalSubject: 'fixture-bob-002',
        displayName: 'Bob Fixture',
        privateNote: 'bob-only: red kite',
      },
    ];
    let inserted = 0;
    for (const user of users) {
      const existing = await ctx.db
        .query('appUsers')
        .withIndex('by_external_identity')
        .eq('externalIssuer', user.externalIssuer)
        .eq('externalSubject', user.externalSubject)
        .first();
      if (!existing) {
        await ctx.db.insert('appUsers', user);
        inserted += 1;
      }
    }
    return inserted;
  },
});

// Trusted-server bootstrap only. The browser gateway in server/gateway.mjs
// omits this function from its exact allowlist.
// @ref LLP 0058#shared-invocation-authority — handlers receive the Snapback
// principal but no verified external claim, so the trusted server must supply
// issuer + subject after verification and keep this mutation non-public.
export const brokerBindPrincipal = defineJsMutation({
  auth: 'authenticated',
  args: {
    externalIssuer: v.string(),
    externalSubject: v.string(),
  },
  reads: ['appUsers', 'identityBindings'],
  writes: ['identityBindings'],
  result: results.value(v.object({
    principal: v.principal(),
    appUserId: v.id('appUsers'),
    externalIssuer: v.string(),
    externalSubject: v.string(),
  })),
  handler: async (ctx, args) => {
    if (!ctx.auth || typeof ctx.auth.userId !== 'string') {
      throw new Error('binding requires an authenticated principal');
    }
    const appUser = await ctx.db
      .query('appUsers')
      .withIndex('by_external_identity')
      .eq('externalIssuer', args.externalIssuer)
      .eq('externalSubject', args.externalSubject)
      .first();
    if (!appUser) throw new Error('verified external identity has no app user');

    const principal = ctx.auth.userId;
    const [byPrincipal, byAppUser, byExternalIdentity] = await Promise.all([
      ctx.db.query('identityBindings').withIndex('by_principal').eq('principal', principal).first(),
      ctx.db.query('identityBindings').withIndex('by_app_user').eq('appUserId', appUser._id).first(),
      ctx.db
        .query('identityBindings')
        .withIndex('by_external_identity')
        .eq('externalIssuer', args.externalIssuer)
        .eq('externalSubject', args.externalSubject)
        .first(),
    ]);
    const existing = byPrincipal ?? byAppUser ?? byExternalIdentity;
    if (existing) {
      if (
        existing.principal !== principal
        || existing.appUserId !== appUser._id
        || existing.externalIssuer !== args.externalIssuer
        || existing.externalSubject !== args.externalSubject
      ) throw new Error('principal or app user is already bound differently');
      return {
        principal,
        appUserId: appUser._id,
        externalIssuer: existing.externalIssuer,
        externalSubject: existing.externalSubject,
      };
    }

    await ctx.db.insert('identityBindings', {
      principal,
      appUserId: appUser._id,
      externalIssuer: args.externalIssuer,
      externalSubject: args.externalSubject,
    });
    return {
      principal,
      appUserId: appUser._id,
      externalIssuer: args.externalIssuer,
      externalSubject: args.externalSubject,
    };
  },
});

// No identity selector is accepted. The only path to the protected app row is
// the server-projected principal.
export const viewer = defineJsQuery({
  auth: 'authenticated',
  args: {},
  reads: ['appUsers', 'identityBindings'],
  result: results.records(v.object({
    principal: v.principal(),
    externalIssuer: v.string(),
    externalSubject: v.string(),
    displayName: v.string(),
    privateNote: v.string(),
  }), { minItems: 1, maxItems: 1 }),
  handler: async (ctx) => {
    const { appUser, binding } = await requireBoundUser(ctx);
    return [{
      principal: ctx.auth.userId,
      externalIssuer: binding.externalIssuer,
      externalSubject: binding.externalSubject,
      displayName: appUser.displayName,
      privateNote: appUser.privateNote,
    }];
  },
});
