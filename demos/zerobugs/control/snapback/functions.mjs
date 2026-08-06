import {
  defineJsMutation,
  defineJsQuery,
  results,
  v,
} from '@expo/snapback-codegen/define';

// Snapback function exports are JavaScript identifiers. `fixtureIngestBatch`
// is the identifier-safe lowering of the acceptance-only logical surface
// `fixture.ingestBatch` named in PLAN.md.

function fixtureTableNames() {
  return [
    'user',
    'project',
    'label',
    'issue',
    'issueLabel',
    'comment',
    'emoji',
    'viewState',
    'userPref',
    'issueNotifications',
    'identityBinding',
    'projectUserRead',
    'issueListRead',
    'issueLabelRead',
    'issueSearchDocument',
    'searchEpoch',
  ];
}

function fixtureUserRoles() {
  return {
    crew: [
      '2wKdbVVF7qtnn5bx92sr9',
      'Gg4MskWt3M-ttzzlrJ9jn',
      'OeVnr1y5bEM_Yg06sUFtD',
      'ieK09sy2C_AIWE8KRkrQR',
      'nqYkxAGMnzk7Y5STjZryV',
      'pgyTvcxh2hjmq2l4WKzK6',
      'tDY6IbKdVqbBlRBc3XMwF',
    ],
    user: [
      '9Fw3n6EQS8mzE126AFJxb',
      'FPEhfZQwiEMgpk3WnEY72',
      '_4MJeHV4T-qZb52fyNwQ9',
      'jpRvILZ1tibPsQXKvb3cF',
      'pFCse65icLsHqrf1TJMuV',
      'vxBeM-NB6tEvoQuhMhFJ9',
      'yJ5hiysWE-LBcDfT44lR8',
    ],
  };
}

function fixtureActorBinding(actor) {
  if (actor === 'ordinary-user') {
    return {
      role: 'user',
      sourceUserID: '9Fw3n6EQS8mzE126AFJxb',
    };
  }
  if (actor === 'creator') {
    return {
      role: 'user',
      sourceUserID: 'FPEhfZQwiEMgpk3WnEY72',
    };
  }
  if (actor === 'assignee') {
    return {
      role: 'user',
      sourceUserID: '_4MJeHV4T-qZb52fyNwQ9',
    };
  }
  if (actor === 'crew-admin') {
    return {
      role: 'crew',
      sourceUserID: '2wKdbVVF7qtnn5bx92sr9',
    };
  }
  if (actor === 'removed-member') {
    return {
      role: 'crew',
      sourceUserID: 'Gg4MskWt3M-ttzzlrJ9jn',
    };
  }
  return null;
}

function requireFixtureSession(ctx) {
  if (!ctx.auth || typeof ctx.auth.userId !== 'string' || ctx.auth.userId.length === 0) {
    throw new Error('fixture ingestion requires an authenticated session');
  }
}

// W-IDENTITY: private source rows never trust a caller-selected source user
// id. The sessions gate supplies the principal; this helper resolves the sole
// app-owned binding and verifies that it still names the same frozen source
// user row before releasing that row to any downstream guard.
export async function requireSourceUser(ctx) {
  requireFixtureSession(ctx);
  const principal = ctx.auth.userId;
  const binding = await ctx.db
    .query('identityBinding')
    .withIndex('by_principal')
    .eq('principal', principal)
    .first();
  if (!binding) {
    throw new Error('session principal is not bound to a source user');
  }
  const user = await ctx.db.get('user', binding.userID);
  if (
    !user
    || user.id !== binding.sourceUserID
    || (user.role !== 'crew' && user.role !== 'user')
  ) {
    throw new Error('session principal has an invalid source user binding');
  }
  return user;
}

// W-IDENTITY: role authority comes from the bound source row, never a session
// mint argument, request body, or caller-supplied role claim.
export async function requireCrew(ctx) {
  const user = await requireSourceUser(ctx);
  if (user.role !== 'crew') {
    throw new Error('source user is not authorized');
  }
  return user;
}

// The frozen query policy is crew-or-public. In particular, an ordinary issue
// creator receives no special internal-query visibility.
export async function assertIssueVisible(ctx, issue) {
  if (!issue || (issue.visibility !== 'public' && issue.visibility !== 'internal')) {
    throw new Error('issue was not found or is not visible');
  }
  if (issue.visibility === 'public') {
    return null;
  }
  return await requireCrew(ctx);
}

// The frozen ownership policy is creator-or-crew. Assignment grants neither
// ownership nor edit authority.
export async function assertCreatorOrCrew(ctx, resource) {
  const user = await requireSourceUser(ctx);
  if (!resource || (resource.creatorID !== user._id && user.role !== 'crew')) {
    throw new Error('resource was not found or is not authorized');
  }
  return user;
}

function validateFixtureBatch(table, rows) {
  if (!fixtureTableNames().includes(table)) {
    throw new Error('unknown fixture table');
  }
  if (!Array.isArray(rows) || rows.length > 900) {
    throw new Error('fixture batch must contain at most 900 rows');
  }
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('fixture rows must be objects');
    }
    if ('_id' in row || '_version' in row || '_createdAt' in row || '_updatedAt' in row) {
      throw new Error('fixture rows may not author system fields');
    }
    if (table === 'user' && row.role !== 'crew' && row.role !== 'user') {
      throw new Error('fixture user role must be crew or user');
    }
    if (
      (table === 'issue'
        || table === 'issueListRead'
        || table === 'issueSearchDocument'
        || table === 'searchEpoch')
      && row.visibility !== 'internal'
      && row.visibility !== 'public'
    ) {
      throw new Error('fixture visibility must be internal or public');
    }
  }
}

async function requireFixtureBootstrapWindow(db) {
  // @ref LLP 0109#155-quantitative-and-acceptance-closure — the large fixture
  // is a sequence of ordinary bounded commits, not a partially installed seed.
  // `searchEpoch` is deliberately last in the frozen load order and therefore
  // acts as the completion sentinel: any later ingest attempt fails closed.
  const completed = await db.query('searchEpoch').take(1).collect();
  if (completed.length !== 0) {
    throw new Error('fixture ingestion is closed after fixture completion');
  }

  // Bootstrap is circular: the fixture creates the source users that a later
  // identityBinding maps to session principals. While the sentinel is absent,
  // only the frozen user population may exist. A foreign source user closes
  // the acceptance loader rather than widening this into a general import API.
  const expected = fixtureUserRoles();
  const users = await db.query('user').take(15).collect();
  if (
    users.length > 14
    || users.some(user => (
      user.role === 'crew'
        ? !expected.crew.includes(user.id)
        : user.role !== 'user' || !expected.user.includes(user.id)
    ))
  ) {
    throw new Error('fixture ingestion found source users outside the frozen fixture');
  }
}

async function requireLoadedFrozenFixture(db) {
  const epochs = await db.query('searchEpoch').take(3).collect();
  if (
    epochs.length !== 2
    || !epochs.some(row => row.visibility === 'public')
    || !epochs.some(row => row.visibility === 'internal')
  ) {
    throw new Error('actor binding requires the complete frozen fixture');
  }

  const expected = fixtureUserRoles();
  const users = await db.query('user').take(15).collect();
  const ids = new Set(users.map(user => user.id));
  if (
    users.length !== 14
    || ids.size !== 14
    || users.some(user => (
      user.role === 'crew'
        ? !expected.crew.includes(user.id)
        : user.role !== 'user' || !expected.user.includes(user.id)
    ))
  ) {
    throw new Error('actor binding requires exactly the frozen source users');
  }
}

export const fixtureIngestBatch = defineJsMutation({
  auth: 'authenticated',
  args: {table: v.string(), rows: v.json()},
  reads: ['user', 'searchEpoch'],
  writes: fixtureTableNames(),
  result: results.value(v.json()),
  outgrewIr: 'general-iteration',
  handler: async (ctx, args) => {
    requireFixtureSession(ctx);
    validateFixtureBatch(args.table, args.rows);
    await requireFixtureBootstrapWindow(ctx.db);
    const ids = [];
    for (const row of args.rows) {
      ids.push(await ctx.db.insert(args.table, row));
    }
    return {inserted: args.rows.length, ids};
  },
});

export const fixtureInspectTable = defineJsQuery({
  auth: 'authenticated',
  args: {table: v.string()},
  reads: fixtureTableNames(),
  handler: async (ctx, args) => {
    requireFixtureSession(ctx);
    if (!fixtureTableNames().includes(args.table)) {
      throw new Error('unknown fixture table');
    }
    // Lane 1 needs one broad inverse-remap inspection pass before principals
    // exist. The first W-IDENTITY row closes that acceptance bootstrap surface
    // so it cannot bypass Lane 2's principal-bound private queries.
    const bindings = await ctx.db.query('identityBinding').take(1).collect();
    if (bindings.length !== 0) {
      throw new Error('fixture inspection is closed after actor binding begins');
    }
    return await ctx.db.query(args.table).take(1024).collect();
  },
});

// W-IDENTITY acceptance bootstrap. The actor name selects only one member of
// the manifest's frozen five-row map; it is not a general source-user id. The
// mutation is intentionally omitted from the composition gateway and closes
// after five one-to-one bindings.
export const acceptanceBindActor = defineJsMutation({
  auth: 'authenticated',
  args: {actor: v.string()},
  reads: ['identityBinding', 'searchEpoch', 'user'],
  writes: ['identityBinding'],
  result: results.value(v.object({
    actor: v.string(),
    principal: v.string(),
    sourceUserID: v.string(),
    userID: v.id('user'),
    role: v.string(),
  })),
  outgrewIr: 'general-iteration',
  handler: async (ctx, args) => {
    requireFixtureSession(ctx);
    const actor = fixtureActorBinding(args.actor);
    if (!actor) {
      throw new Error('actor binding is closed to the frozen manifest actors');
    }

    const sourceUser = await ctx.db
      .query('user')
      .withIndex('by_source_id')
      .eq('id', actor.sourceUserID)
      .first();
    if (!sourceUser || sourceUser.role !== actor.role) {
      throw new Error('actor binding source user is unknown or has the wrong frozen role');
    }
    await requireLoadedFrozenFixture(ctx.db);

    const principal = ctx.auth.userId;
    const existingPrincipal = await ctx.db
      .query('identityBinding')
      .withIndex('by_principal')
      .eq('principal', principal)
      .first();
    if (existingPrincipal) {
      throw new Error('session principal is already bound');
    }

    const existingBindings = await ctx.db.query('identityBinding').take(6).collect();
    if (existingBindings.length >= 5) {
      throw new Error('actor binding is closed after the frozen actor set is complete');
    }

    const [existingUser, existingSource] = await Promise.all([
      ctx.db
        .query('identityBinding')
        .withIndex('by_user')
        .eq('userID', sourceUser._id)
        .first(),
      ctx.db
        .query('identityBinding')
        .withIndex('by_source_user_id')
        .eq('sourceUserID', sourceUser.id)
        .first(),
    ]);
    if (existingUser || existingSource) {
      throw new Error('source user is already bound');
    }

    await ctx.db.insert('identityBinding', {
      principal,
      userID: sourceUser._id,
      sourceUserID: sourceUser.id,
    });
    return {
      actor: args.actor,
      principal,
      sourceUserID: sourceUser.id,
      userID: sourceUser._id,
      role: sourceUser.role,
    };
  },
});

export const acceptanceActorBindingSelf = defineJsQuery({
  auth: 'authenticated',
  args: {},
  reads: ['identityBinding', 'user'],
  result: results.records(v.object({
    principal: v.string(),
    sourceUserID: v.string(),
    userID: v.id('user'),
    role: v.string(),
  })),
  handler: async (ctx) => {
    const user = await requireSourceUser(ctx);
    return [{
      principal: ctx.auth.userId,
      sourceUserID: user.id,
      userID: user._id,
      role: user.role,
    }];
  },
});

export const acceptanceCrewGuard = defineJsQuery({
  auth: 'authenticated',
  args: {},
  reads: ['identityBinding', 'user'],
  result: results.records(v.object({
    sourceUserID: v.string(),
    role: v.string(),
  })),
  handler: async (ctx) => {
    const user = await requireCrew(ctx);
    return [{sourceUserID: user.id, role: user.role}];
  },
});

export const acceptanceOwnershipGuard = defineJsQuery({
  auth: 'authenticated',
  args: {},
  reads: ['identityBinding', 'issue', 'user'],
  result: results.records(v.object({
    sourceIssueID: v.string(),
    sourceUserID: v.string(),
  })),
  handler: async (ctx) => {
    const issue = await ctx.db
      .query('issue')
      .withIndex('by_source_id')
      .eq('id', 'zbav1_internal_issue')
      .first();
    const user = await assertCreatorOrCrew(ctx, issue);
    return [{sourceIssueID: issue.id, sourceUserID: user.id}];
  },
});

export const acceptancePrivateOverlay = defineJsQuery({
  auth: 'authenticated',
  args: {},
  reads: ['identityBinding', 'issue', 'user', 'viewState'],
  result: results.records(v.object({
    issueID: v.id('issue'),
    sourceUserID: v.string(),
    userID: v.id('user'),
    viewed: v.number(),
  })),
  handler: async (ctx) => {
    const user = await requireSourceUser(ctx);
    const overlay = await ctx.db
      .query('viewState')
      .withIndex('by_user_issue')
      .eq('userID', user._id)
      .first();
    if (!overlay) {
      throw new Error('source user has no acceptance view-state row');
    }
    const issue = await ctx.db.get('issue', overlay.issueID);
    await assertIssueVisible(ctx, issue);
    return [{
      issueID: overlay.issueID,
      sourceUserID: user.id,
      userID: user._id,
      viewed: overlay.viewed,
    }];
  },
});

// The remaining 19-query and 16-mutator inventory is intentionally not
// implemented by Lane 2. PLAN.md fixes those names, lowering, and lane order.
