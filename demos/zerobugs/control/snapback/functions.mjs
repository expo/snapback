import {
  defineJsMutation,
  defineJsQuery,
  defineJsLiveQuery,
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

// Lane 3 query result contracts. These are source-shaped records rather than
// raw stored documents: the pinned Zero surface does not expose Snapback
// system fields, user email/github ids, or physical foreign-key ids.

function statusValidator() {
  return v.union([
    v.literal('complete'),
    v.literal('incomplete'),
    v.literal('refreshing'),
    v.literal('not-found-authoritative'),
  ]);
}

function nullableStringValidator() {
  return v.union([v.null(), v.string()]);
}

function roleResultValidator() {
  return v.union([v.literal('crew'), v.literal('user')]);
}

function visibilityResultValidator() {
  return v.union([v.literal('internal'), v.literal('public')]);
}

function userResultValidator() {
  return v.object({
    id: v.string(),
    login: v.string(),
    name: v.optional(v.string()),
    avatar: v.string(),
    role: roleResultValidator(),
  });
}

function projectResultValidator() {
  return v.object({
    id: v.string(),
    name: v.string(),
    lowerCaseName: v.string(),
    issueCountEstimate: v.optional(v.integer()),
    supportsSearch: v.boolean(),
    markURL: v.optional(v.string()),
    logoURL: v.optional(v.string()),
  });
}

function issueResultValidator() {
  return v.object({
    id: v.string(),
    shortID: v.optional(v.integer()),
    title: v.string(),
    open: v.boolean(),
    modified: v.number(),
    created: v.number(),
    projectID: v.string(),
    creatorID: v.string(),
    assigneeID: v.optional(v.string()),
    description: v.string(),
    visibility: visibilityResultValidator(),
  });
}

function labelResultValidator() {
  return v.object({id: v.string(), name: v.string(), projectID: v.string()});
}

function viewStateResultValidator() {
  return v.object({issueID: v.string(), userID: v.string(), viewed: v.number()});
}

function userPrefResultValidator() {
  return v.object({key: v.string(), userID: v.string(), value: v.string()});
}

function notificationResultValidator() {
  return v.object({
    userID: v.string(),
    issueID: v.string(),
    subscribed: v.boolean(),
    created: v.number(),
  });
}

function emojiResultValidator() {
  return v.object({
    id: v.string(),
    value: v.string(),
    annotation: v.string(),
    subjectID: v.string(),
    creatorID: v.string(),
    created: v.number(),
  });
}

function commentResultValidator() {
  return v.object({
    id: v.string(),
    issueID: v.string(),
    created: v.number(),
    body: v.string(),
    creatorID: v.string(),
  });
}

function issueCursorValidator() {
  return v.object({id: v.string(), created: v.number(), modified: v.number()});
}

function commentCursorValidator() {
  return v.object({id: v.string(), created: v.number()});
}

function userCursorValidator() {
  return v.object({id: v.string(), login: v.string()});
}

function projectCursorValidator() {
  return v.object({id: v.string(), lowerCaseName: v.string()});
}

function labelCursorValidator() {
  return v.object({id: v.string(), name: v.string(), projectID: v.string()});
}

function emojiCursorValidator() {
  return v.object({id: v.string(), created: v.number()});
}

function searchEpochResultValidator() {
  return v.object({visibility: visibilityResultValidator(), epoch: v.integer()});
}

function richEmojiResultValidator() {
  return v.object({emoji: emojiResultValidator(), creator: userResultValidator()});
}

function richCommentResultValidator() {
  return v.object({
    comment: commentResultValidator(),
    creator: userResultValidator(),
    emoji: v.array(richEmojiResultValidator(), {maxItems: 1_023}),
    emojiCompleteness: statusValidator(),
  });
}

function listIssueItemValidator() {
  return v.object({
    issue: issueResultValidator(),
    labels: v.array(labelResultValidator(), {maxItems: 1_023}),
    labelsCompleteness: statusValidator(),
    viewState: v.union([v.null(), viewStateResultValidator()]),
  });
}

function preloadIssueItemValidator() {
  return v.object({
    issue: issueResultValidator(),
    labels: v.array(labelResultValidator(), {maxItems: 1_023}),
    labelsCompleteness: statusValidator(),
    viewState: v.array(viewStateResultValidator(), {maxItems: 1}),
    creator: userResultValidator(),
    assignee: v.union([v.null(), userResultValidator()]),
    emoji: v.array(richEmojiResultValidator(), {maxItems: 1_023}),
    emojiCompleteness: statusValidator(),
    comments: v.array(richCommentResultValidator(), {maxItems: 10}),
    commentsCompleteness: statusValidator(),
    commentsCursor: v.union([v.null(), commentCursorValidator()]),
  });
}

function issueDetailValueValidator() {
  return v.object({
    issue: issueResultValidator(),
    project: projectResultValidator(),
    creator: userResultValidator(),
    assignee: v.union([v.null(), userResultValidator()]),
    labels: v.array(labelResultValidator(), {maxItems: 1_023}),
    labelsCompleteness: statusValidator(),
    notificationState: v.union([v.null(), notificationResultValidator()]),
    viewState: v.union([v.null(), viewStateResultValidator()]),
    emoji: v.array(richEmojiResultValidator(), {maxItems: 1_023}),
    emojiCompleteness: statusValidator(),
    comments: v.array(richCommentResultValidator(), {maxItems: 50}),
    commentsCompleteness: statusValidator(),
    commentsCursor: v.union([v.null(), commentCursorValidator()]),
  });
}

function listContextArgsValidator() {
  return v.object({
    open: v.union([v.null(), v.boolean()]),
    projectName: v.optional(v.string()),
    assignee: v.union([v.null(), v.string()]),
    creator: v.union([v.null(), v.string()]),
    labels: v.union([v.null(), v.array(v.string(), {maxItems: 64})]),
    textFilter: v.union([v.null(), v.string()]),
    sortField: v.union([v.literal('modified'), v.literal('created')]),
    sortDirection: v.union([v.literal('asc'), v.literal('desc')]),
  });
}

function pageFact(status, reason, hasMore, cursor, examined, total) {
  return {status, reason, hasMore, cursor, examined, total};
}

function sourceUserResult(user) {
  const row = {
    id: user.id,
    login: user.login,
    avatar: user.avatar,
    role: user.role,
  };
  if (typeof user.name === 'string') row.name = user.name;
  return row;
}

function sourceProjectResult(project) {
  const row = {
    id: project.id,
    name: project.name,
    lowerCaseName: project.lowerCaseName,
    supportsSearch: project.supportsSearch,
  };
  if (typeof project.issueCountEstimate === 'number') {
    row.issueCountEstimate = project.issueCountEstimate;
  }
  if (typeof project.markURL === 'string') row.markURL = project.markURL;
  if (typeof project.logoURL === 'string') row.logoURL = project.logoURL;
  return row;
}

function sourceIssueResult(issue, project, creator, assignee) {
  const row = {
    id: issue.id,
    title: issue.title,
    open: issue.open,
    modified: issue.modified,
    created: issue.created,
    projectID: project.id,
    creatorID: creator.id,
    description: issue.description,
    visibility: issue.visibility,
  };
  if (typeof issue.shortID === 'number') row.shortID = issue.shortID;
  if (assignee) row.assigneeID = assignee.id;
  return row;
}

function sourceLabelResult(label, project) {
  return {id: label.id, name: label.name, projectID: project.id};
}

function sourceViewStateResult(viewState, issue, user) {
  return {issueID: issue.id, userID: user.id, viewed: viewState.viewed};
}

function sourceUserPrefResult(pref, user) {
  return {key: pref.key, userID: user.id, value: pref.value};
}

function sourceNotificationResult(notification, issue, user) {
  return {
    userID: user.id,
    issueID: issue.id,
    subscribed: notification.subscribed,
    created: notification.created,
  };
}

function sourceEmojiResult(emoji, subjectSourceID, creator) {
  return {
    id: emoji.id,
    value: emoji.value,
    annotation: emoji.annotation,
    subjectID: subjectSourceID,
    creatorID: creator.id,
    created: emoji.created,
  };
}

function sourceCommentResult(comment, issue, creator) {
  return {
    id: comment.id,
    issueID: issue.id,
    created: comment.created,
    body: comment.body,
    creatorID: creator.id,
  };
}

async function optionalSourceUser(ctx) {
  if (!ctx.auth || typeof ctx.auth.userId !== 'string' || ctx.auth.userId.length === 0) {
    return null;
  }
  return await requireSourceUser(ctx);
}

async function visibleIssueOrNull(ctx, issue) {
  if (!issue) return null;
  try {
    await assertIssueVisible(ctx, issue);
    return issue;
  } catch (_error) {
    // Missing and invisible are deliberately projected into the same query
    // result. In particular, do not release the Lane 2 guard's internal reason.
    return null;
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function directionMultiplier(direction) {
  return direction === 'desc' ? -1 : 1;
}

function compareUserRows(left, right, direction) {
  const multiplier = directionMultiplier(direction);
  const login = compareText(left.login, right.login);
  return (login !== 0 ? login : compareText(left.id, right.id)) * multiplier;
}

function compareProjectRows(left, right, direction) {
  const multiplier = directionMultiplier(direction);
  const name = compareText(left.lowerCaseName, right.lowerCaseName);
  return (name !== 0 ? name : compareText(left.id, right.id)) * multiplier;
}

function compareLabelRows(left, right, direction, includeProject) {
  const multiplier = directionMultiplier(direction);
  if (includeProject) {
    const project = compareText(left.projectID, right.projectID);
    if (project !== 0) return project * multiplier;
  }
  const name = compareText(left.name, right.name);
  return (name !== 0 ? name : compareText(left.id, right.id)) * multiplier;
}

function compareIssueRows(left, right, sortField, direction) {
  const multiplier = directionMultiplier(direction);
  const leftOrdered = sortField === 'created' ? left.created : left.modified;
  const rightOrdered = sortField === 'created' ? right.created : right.modified;
  const leftID = typeof left.sourceIssueID === 'string' ? left.sourceIssueID : left.id;
  const rightID = typeof right.sourceIssueID === 'string' ? right.sourceIssueID : right.id;
  const ordered = leftOrdered < rightOrdered
    ? -1
    : leftOrdered > rightOrdered ? 1 : 0;
  return (ordered !== 0 ? ordered : compareText(leftID, rightID)) * multiplier;
}

function compareCommentRows(left, right, direction) {
  const multiplier = directionMultiplier(direction);
  const created = left.created < right.created ? -1 : left.created > right.created ? 1 : 0;
  return (created !== 0 ? created : compareText(left.id, right.id)) * multiplier;
}

function compareEmojiRows(left, right, direction) {
  const multiplier = directionMultiplier(direction);
  const created = left.created < right.created ? -1 : left.created > right.created ? 1 : 0;
  return (created !== 0 ? created : compareText(left.id, right.id)) * multiplier;
}

function pageAfterStart(rows, start, inclusive, compare) {
  if (!start) return rows;
  return rows.filter(row => {
    const order = compare(row, start);
    return inclusive ? order >= 0 : order > 0;
  });
}

function boundedPage(rows, limit) {
  const items = rows.slice(0, limit);
  return {items, hasMore: rows.length > limit};
}

async function issueBaseGraph(ctx, issue) {
  const [project, creator, assignee] = await Promise.all([
    ctx.db.get('project', issue.projectID),
    ctx.db.get('user', issue.creatorID),
    issue.assigneeID ? ctx.db.get('user', issue.assigneeID) : null,
  ]);
  if (!project || !creator || (issue.assigneeID && !assignee)) {
    throw new Error('issue graph references a missing source row');
  }
  return {
    project,
    creator,
    assignee,
    issue: sourceIssueResult(issue, project, creator, assignee),
  };
}

async function issueLabelsGraph(ctx, issue, project) {
  const memberships = await ctx.db
    .query('issueLabelRead')
    .withIndex('by_project_issue_label')
    .eq('projectID', issue.projectID)
    .eq('issueID', issue._id)
    .take(1_024)
    .collect();
  if (memberships.length === 1_024) {
    return {items: [], status: 'incomplete'};
  }
  const items = [];
  for (const membership of memberships) {
    const label = await ctx.db.get('label', membership.labelID);
    if (!label) throw new Error('issue label read model references a missing label');
    items.push(sourceLabelResult(label, project));
  }
  items.sort((left, right) => compareLabelRows(left, right, 'asc', false));
  return {items, status: 'complete'};
}

async function emojiGraph(ctx, physicalSubjectID, sourceSubjectID) {
  const emojiRows = await ctx.db
    .query('emoji')
    .withIndex('by_subject')
    .eq('subjectID', physicalSubjectID)
    .take(1_024)
    .collect();
  if (emojiRows.length === 1_024) {
    return {items: [], status: 'incomplete'};
  }
  const items = [];
  emojiRows.sort((left, right) => compareEmojiRows(left, right, 'asc'));
  for (const emoji of emojiRows) {
    const creator = await ctx.db.get('user', emoji.creatorID);
    if (!creator) throw new Error('emoji references a missing creator');
    items.push({
      emoji: sourceEmojiResult(emoji, sourceSubjectID, creator),
      creator: sourceUserResult(creator),
    });
  }
  return {items, status: 'complete'};
}

async function richCommentGraph(ctx, comment, issue) {
  const creator = await ctx.db.get('user', comment.creatorID);
  if (!creator) throw new Error('comment references a missing creator');
  const emoji = await emojiGraph(ctx, comment._id, comment.id);
  return {
    comment: sourceCommentResult(comment, issue, creator),
    creator: sourceUserResult(creator),
    emoji: emoji.items,
    emojiCompleteness: emoji.status,
  };
}

async function issueCommentsWindow(ctx, issue, limit, direction) {
  const comments = await ctx.db
    .query('comment')
    .withIndex('by_issue_created')
    .eq('issueID', issue._id)
    .take(1_024)
    .collect();
  if (comments.length === 1_024) {
    return {items: [], status: 'incomplete', cursor: null};
  }
  comments.sort((left, right) => compareCommentRows(left, right, direction));
  const page = boundedPage(comments, limit);
  const items = [];
  for (const comment of page.items) items.push(await richCommentGraph(ctx, comment, issue));
  const last = page.items.at(-1);
  return {
    items,
    status: page.hasMore ? 'incomplete' : 'complete',
    cursor: page.hasMore && last ? {id: last.id, created: last.created} : null,
  };
}

async function principalViewState(ctx, issue, viewer) {
  if (!viewer) return null;
  // The viewer came only from requireSourceUser; there is no caller identity
  // selector on this helper or any query that uses it.
  const row = await ctx.db
    .query('viewState')
    .withIndex('by_user_issue')
    .eq('userID', viewer._id)
    .eq('issueID', issue._id)
    .first();
  return row ? sourceViewStateResult(row, issue, viewer) : null;
}

async function principalNotificationState(ctx, issue, viewer) {
  if (!viewer) return null;
  const row = await ctx.db
    .query('issueNotifications')
    .withIndex('by_user_issue')
    .eq('userID', viewer._id)
    .eq('issueID', issue._id)
    .first();
  return row ? sourceNotificationResult(row, issue, viewer) : null;
}

function issueIndexName(listContext, creator, assignee) {
  const sort = listContext.sortField === 'created' ? 'created' : 'modified';
  if (creator) {
    return listContext.open === null
      ? `by_project_creator_${sort}`
      : `by_project_open_creator_${sort}`;
  }
  if (assignee) {
    return listContext.open === null
      ? `by_project_assignee_${sort}`
      : `by_project_open_assignee_${sort}`;
  }
  return listContext.open === null
    ? `by_project_${sort}`
    : `by_project_open_${sort}`;
}

async function resolveProject(ctx, projectName) {
  return await ctx.db
    .query('project')
    .withIndex('by_lower_case_name')
    .eq('lowerCaseName', projectName.toLowerCase())
    .first();
}

async function resolveUserByLogin(ctx, login) {
  if (login === null) return null;
  return await ctx.db
    .query('user')
    .withIndex('by_login')
    .eq('login', login)
    .first();
}

async function selectedLabelMembership(ctx, project, labelNames) {
  if (labelNames === null || labelNames.length === 0) {
    return {sets: [], refused: false, impossible: false};
  }
  const uniqueNames = [];
  for (const name of labelNames) if (!uniqueNames.includes(name)) uniqueNames.push(name);
  const sets = [];
  for (const name of uniqueNames) {
    const label = await ctx.db
      .query('label')
      .withIndex('by_project_name')
      .eq('projectID', project._id)
      .eq('name', name)
      .first();
    if (!label) return {sets: [], refused: false, impossible: true};
    const memberships = await ctx.db
      .query('issueLabelRead')
      .withIndex('by_project_label_issue')
      .eq('projectID', project._id)
      .eq('labelID', label._id)
      .take(1_024)
      .collect();
    if (memberships.length === 1_024) {
      return {sets: [], refused: true, impossible: false};
    }
    sets.push(new Set(memberships.map(row => row.issueID)));
  }
  return {sets, refused: false, impossible: false};
}

async function searchMembership(ctx, project, viewer, textFilter) {
  const epochs = [];
  const visibilityClasses = viewer && viewer.role === 'crew'
    ? ['public', 'internal']
    : ['public'];
  for (const visibility of visibilityClasses) {
    const epoch = await ctx.db
      .query('searchEpoch')
      .withIndex('by_project_visibility')
      .eq('projectID', project._id)
      .eq('visibility', visibility)
      .first();
    if (!epoch) return {ids: null, epochs, refused: true};
    epochs.push({visibility, epoch: epoch.epoch});
  }
  if (textFilter === null) return {ids: null, epochs, refused: false};

  // W-SEARCH-EPOCH deviation: role-partitioned search cannot currently be
  // composed into an opaque handler or generated route group. Scan only the
  // maintained search-document partitions under a strict proof ceiling; a
  // boundary hit refuses the result instead of releasing a truncated match
  // set. PLAN.md records why an exported public search plan would leak the
  // internal partition.
  const needle = textFilter.toLowerCase();
  const ids = new Set();
  for (const visibility of visibilityClasses) {
    const documents = await ctx.db
      .query('issueSearchDocument')
      .withIndex('by_project_visibility_issue')
      .eq('projectID', project._id)
      .eq('visibility', visibility)
      .take(1_024)
      .collect();
    if (documents.length === 1_024) return {ids: null, epochs, refused: true};
    for (const document of documents) {
      if (
        document.title.toLowerCase().includes(needle)
        || document.description.toLowerCase().includes(needle)
        || document.commentText.toLowerCase().includes(needle)
      ) {
        ids.add(document.issueID);
      }
    }
  }
  return {ids, epochs, refused: false};
}

async function runIssueListEngine(ctx, options) {
  const listContext = options.listContext;
  const viewer = await optionalSourceUser(ctx);
  const project = await resolveProject(ctx, listContext.projectName || 'Zero');
  if (!project) {
    return {
      status: options.point ? 'not-found-authoritative' : 'complete',
      reason: options.point ? 'missing-or-outside-list-context' : null,
      hasMore: false,
      cursor: null,
      examined: 0,
      total: 0,
      searchEpoch: [],
      entries: [],
    };
  }

  const creator = await resolveUserByLogin(ctx, listContext.creator);
  const assignee = await resolveUserByLogin(ctx, listContext.assignee);
  if ((listContext.creator !== null && !creator) || (listContext.assignee !== null && !assignee)) {
    return {
      status: options.point ? 'not-found-authoritative' : 'complete',
      reason: options.point ? 'missing-or-outside-list-context' : null,
      hasMore: false,
      cursor: null,
      examined: 0,
      total: 0,
      searchEpoch: [],
      entries: [],
    };
  }

  let roots;
  if (options.targetSourceID) {
    const target = await ctx.db
      .query('issueListRead')
      .withIndex('by_source_issue_id')
      .eq('sourceIssueID', options.targetSourceID)
      .first();
    roots = target ? [target] : [];
  } else {
    let query = ctx.db
      .query('issueListRead')
      .withIndex(issueIndexName(listContext, creator, assignee))
      .eq('projectID', project._id);
    if (listContext.open !== null) query = query.eq('open', listContext.open);
    if (creator) query = query.eq('creatorID', creator._id);
    else if (assignee) query = query.eq('assigneeID', assignee._id);
    roots = await query.take(1_024).collect();
    if (roots.length === 1_024) {
      return {
        status: 'incomplete',
        reason: 'issue-read-model-bound',
        hasMore: true,
        cursor: null,
        // The bounded refusal is public, but the sampled root count may mix
        // public and protected rows. Do not turn it into a visibility oracle.
        examined: 0,
        total: 0,
        searchEpoch: [],
        entries: [],
      };
    }
  }

  const authorizedRoots = roots.filter(row => (
    row.visibility === 'public' || (viewer && viewer.role === 'crew')
  ));

  const labels = await selectedLabelMembership(ctx, project, listContext.labels);
  if (labels.refused) {
    return {
      status: 'incomplete',
      reason: 'label-membership-bound',
      hasMore: true,
      cursor: null,
      examined: authorizedRoots.length,
      total: 0,
      searchEpoch: [],
      entries: [],
    };
  }
  const search = await searchMembership(ctx, project, viewer, listContext.textFilter);
  if (search.refused) {
    return {
      status: 'refreshing',
      reason: 'search-document-bound-or-epoch-missing',
      hasMore: true,
      cursor: null,
      examined: authorizedRoots.length,
      total: 0,
      searchEpoch: search.epochs,
      entries: [],
    };
  }

  let filtered = authorizedRoots.filter(row => (
    row.projectID === project._id
    && (listContext.open === null || row.open === listContext.open)
    && (!creator || row.creatorID === creator._id)
    && (!assignee || row.assigneeID === assignee._id)
    && !labels.impossible
    && labels.sets.every(set => set.has(row.issueID))
    && (search.ids === null || search.ids.has(row.issueID))
  ));

  const queryDirection = options.direction === 'backward'
    ? (listContext.sortDirection === 'asc' ? 'desc' : 'asc')
    : listContext.sortDirection;
  filtered.sort((left, right) => compareIssueRows(
    left,
    right,
    listContext.sortField,
    queryDirection,
  ));
  filtered = pageAfterStart(
    filtered,
    options.start,
    options.inclusive,
    (row, start) => compareIssueRows(row, start, listContext.sortField, queryDirection),
  );

  const total = filtered.length;
  const page = boundedPage(filtered, options.limit);
  const entries = [];
  let childIncomplete = false;
  for (const readRow of page.items) {
    const issue = await ctx.db.get('issue', readRow.issueID);
    if (!issue || issue.id !== readRow.sourceIssueID) {
      throw new Error('issue list read model references a missing or mismatched issue');
    }
    const base = await issueBaseGraph(ctx, issue);
    const issueLabels = await issueLabelsGraph(ctx, issue, base.project);
    const viewState = await principalViewState(ctx, issue, viewer);
    if (issueLabels.status !== 'complete') childIncomplete = true;
    entries.push({
      physicalIssue: issue,
      project: base.project,
      creator: base.creator,
      assignee: base.assignee,
      item: {
        issue: base.issue,
        labels: issueLabels.items,
        labelsCompleteness: issueLabels.status,
        viewState,
      },
    });
  }

  const last = page.items.at(-1);
  const cursor = page.hasMore && last
    ? {id: last.sourceIssueID, created: last.created, modified: last.modified}
    : null;
  let status = page.hasMore || childIncomplete ? 'incomplete' : 'complete';
  let reason = page.hasMore ? 'page-limit' : childIncomplete ? 'child-bound' : null;
  if (options.point && entries.length === 0) {
    status = 'not-found-authoritative';
    reason = 'missing-or-outside-list-context';
  }
  return {
    status,
    reason,
    hasMore: page.hasMore,
    cursor,
    examined: authorizedRoots.length,
    total,
    searchEpoch: search.epochs,
    entries,
  };
}

function listEngineResult(engine) {
  return {
    ...pageFact(
      engine.status,
      engine.reason,
      engine.hasMore,
      engine.cursor,
      engine.examined,
      engine.total,
    ),
    searchEpoch: engine.searchEpoch,
    items: engine.entries.map(entry => entry.item),
  };
}

async function findIssueByField(ctx, idField, idValue) {
  if (idField === 'shortID') {
    return typeof idValue === 'number'
      ? await ctx.db
        .query('issue')
        .withIndex('by_short_id')
        .eq('shortID', idValue)
        .first()
      : null;
  }
  return typeof idValue === 'string'
    ? await ctx.db
      .query('issue')
      .withIndex('by_source_id')
      .eq('id', idValue)
      .first()
    : null;
}

// @ref LLP 0183#design-principles — every Lane 3 collection releases an
// explicit completeness fact; an exact 1,024-row proof ceiling returns no
// plausible prefix.
export const allLabels = defineJsLiveQuery({
  auth: 'public',
  args: {
    limit: v.integer({min: 1, max: 1_023}),
    start: v.union([v.null(), labelCursorValidator()]),
  },
  reads: ['label', 'project'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), labelCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    items: v.array(labelResultValidator(), {maxItems: 1_023}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('label').take(1_024).collect();
    if (rows.length === 1_024) {
      return [{...pageFact('incomplete', 'label-bound', true, null, 1_024, 0), items: []}];
    }
    const items = [];
    for (const row of rows) {
      const project = await ctx.db.get('project', row.projectID);
      if (!project) throw new Error('label references a missing project');
      items.push(sourceLabelResult(row, project));
    }
    items.sort((left, right) => compareLabelRows(left, right, 'asc', true));
    const remaining = pageAfterStart(
      items,
      args.start,
      false,
      (left, right) => compareLabelRows(left, right, 'asc', true),
    );
    const page = boundedPage(remaining, args.limit);
    const last = page.items.at(-1);
    const cursor = page.hasMore && last
      ? {id: last.id, name: last.name, projectID: last.projectID}
      : null;
    return [{
      ...pageFact(page.hasMore ? 'incomplete' : 'complete', page.hasMore ? 'page-limit' : null, page.hasMore, cursor, rows.length, remaining.length),
      items: page.items,
    }];
  },
});

export const allUsers = defineJsLiveQuery({
  auth: 'public',
  args: {
    limit: v.integer({min: 1, max: 1_023}),
    start: v.union([v.null(), userCursorValidator()]),
  },
  reads: ['user'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), userCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    items: v.array(userResultValidator(), {maxItems: 1_023}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('user').withIndex('by_login').take(1_024).collect();
    if (rows.length === 1_024) {
      return [{...pageFact('incomplete', 'user-bound', true, null, 1_024, 0), items: []}];
    }
    let items = rows.map(sourceUserResult);
    items.sort((left, right) => compareUserRows(left, right, 'asc'));
    items = pageAfterStart(items, args.start, false, (left, right) => compareUserRows(left, right, 'asc'));
    const page = boundedPage(items, args.limit);
    const last = page.items.at(-1);
    const cursor = page.hasMore && last ? {id: last.id, login: last.login} : null;
    return [{
      ...pageFact(page.hasMore ? 'incomplete' : 'complete', page.hasMore ? 'page-limit' : null, page.hasMore, cursor, rows.length, items.length),
      items: page.items,
    }];
  },
});

export const allProjects = defineJsLiveQuery({
  auth: 'public',
  args: {
    limit: v.integer({min: 1, max: 1_023}),
    start: v.union([v.null(), projectCursorValidator()]),
  },
  reads: ['project'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), projectCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    items: v.array(projectResultValidator(), {maxItems: 1_023}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('project')
      .withIndex('by_lower_case_name')
      .take(1_024)
      .collect();
    if (rows.length === 1_024) {
      return [{...pageFact('incomplete', 'project-bound', true, null, 1_024, 0), items: []}];
    }
    let items = rows.map(sourceProjectResult);
    items.sort((left, right) => compareProjectRows(left, right, 'asc'));
    items = pageAfterStart(items, args.start, false, (left, right) => compareProjectRows(left, right, 'asc'));
    const page = boundedPage(items, args.limit);
    const last = page.items.at(-1);
    const cursor = page.hasMore && last
      ? {id: last.id, lowerCaseName: last.lowerCaseName}
      : null;
    return [{
      ...pageFact(page.hasMore ? 'incomplete' : 'complete', page.hasMore ? 'page-limit' : null, page.hasMore, cursor, rows.length, items.length),
      items: page.items,
    }];
  },
});

export const user = defineJsLiveQuery({
  auth: 'public',
  args: {userID: v.string()},
  reads: ['user'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    value: v.union([v.null(), userResultValidator()]),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('user')
      .withIndex('by_source_id')
      .eq('id', args.userID)
      .first();
    return row
      ? [{status: 'complete', reason: null, value: sourceUserResult(row)}]
      : [{status: 'not-found-authoritative', reason: 'missing-user', value: null}];
  },
});

export const crewUser = defineJsLiveQuery({
  auth: 'public',
  args: {userID: v.string()},
  reads: ['user'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    value: v.union([v.null(), userResultValidator()]),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('user')
      .withIndex('by_source_id')
      .eq('id', args.userID)
      .first();
    return row && row.role === 'crew'
      ? [{status: 'complete', reason: null, value: sourceUserResult(row)}]
      : [{status: 'not-found-authoritative', reason: 'missing-or-not-crew', value: null}];
  },
});

async function labelsQueryHandler(ctx, args, direction) {
  const project = await resolveProject(ctx, args.projectName);
  if (!project) {
    return [{
      ...pageFact('not-found-authoritative', 'missing-project', false, null, 0, 0),
      items: [],
    }];
  }
  const rows = await ctx.db
    .query('label')
    .withIndex('by_project_name')
    .eq('projectID', project._id)
    .take(1_024)
    .collect();
  if (rows.length === 1_024) {
    return [{...pageFact('incomplete', 'label-bound', true, null, 1_024, 0), items: []}];
  }
  let items = rows.map(row => sourceLabelResult(row, project));
  items.sort((left, right) => compareLabelRows(left, right, direction, false));
  items = pageAfterStart(
    items,
    args.start,
    false,
    (left, right) => compareLabelRows(left, right, direction, false),
  );
  const page = boundedPage(items, args.limit);
  const last = page.items.at(-1);
  const cursor = page.hasMore && last
    ? {id: last.id, name: last.name, projectID: last.projectID}
    : null;
  return [{
    ...pageFact(page.hasMore ? 'incomplete' : 'complete', page.hasMore ? 'page-limit' : null, page.hasMore, cursor, rows.length, items.length),
    items: page.items,
  }];
}

export const labels = defineJsLiveQuery({
  auth: 'public',
  args: {
    projectName: v.string(),
    limit: v.integer({min: 1, max: 1_023}),
    start: v.union([v.null(), labelCursorValidator()]),
  },
  reads: ['label', 'project'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), labelCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    items: v.array(labelResultValidator(), {maxItems: 1_023}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => await labelsQueryHandler(ctx, args, 'asc'),
});

export const labelsOrderByName = defineJsLiveQuery({
  auth: 'public',
  args: {
    projectName: v.string(),
    orderBy: v.union([v.literal('asc'), v.literal('desc')]),
    limit: v.integer({min: 1, max: 1_023}),
    start: v.union([v.null(), labelCursorValidator()]),
  },
  reads: ['label', 'project'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), labelCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    items: v.array(labelResultValidator(), {maxItems: 1_023}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => await labelsQueryHandler(ctx, args, args.orderBy),
});

export const issuePreloadV2 = defineJsLiveQuery({
  auth: 'public',
  args: {projectName: v.string()},
  reads: [
    'identityBinding',
    'user',
    'project',
    'issue',
    'issueListRead',
    'issueLabelRead',
    'label',
    'viewState',
    'comment',
    'emoji',
    'searchEpoch',
  ],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), issueCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    searchEpoch: v.array(searchEpochResultValidator(), {maxItems: 2}),
    items: v.array(preloadIssueItemValidator(), {maxItems: 1_000}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const engine = await runIssueListEngine(ctx, {
      listContext: {
        open: null,
        projectName: args.projectName,
        assignee: null,
        creator: null,
        labels: null,
        textFilter: null,
        sortField: 'modified',
        sortDirection: 'desc',
      },
      point: false,
      targetSourceID: null,
      limit: 1_000,
      start: null,
      direction: 'forward',
      inclusive: false,
    });
    const items = [];
    let childIncomplete = false;
    for (const entry of engine.entries) {
      const issueEmoji = await emojiGraph(
        ctx,
        entry.physicalIssue._id,
        entry.physicalIssue.id,
      );
      const comments = await issueCommentsWindow(ctx, entry.physicalIssue, 10, 'desc');
      if (
        entry.item.labelsCompleteness !== 'complete'
        || issueEmoji.status !== 'complete'
        || comments.status !== 'complete'
      ) childIncomplete = true;
      items.push({
        issue: entry.item.issue,
        labels: entry.item.labels,
        labelsCompleteness: entry.item.labelsCompleteness,
        viewState: entry.item.viewState ? [entry.item.viewState] : [],
        creator: sourceUserResult(entry.creator),
        assignee: entry.assignee ? sourceUserResult(entry.assignee) : null,
        emoji: issueEmoji.items,
        emojiCompleteness: issueEmoji.status,
        comments: comments.items,
        commentsCompleteness: comments.status,
        commentsCursor: comments.cursor,
      });
    }
    const status = engine.status === 'complete' && childIncomplete
      ? 'incomplete'
      : engine.status;
    const reason = engine.reason || (childIncomplete ? 'child-bound-or-window' : null);
    return [{
      ...pageFact(status, reason, engine.hasMore, engine.cursor, engine.examined, engine.total),
      searchEpoch: engine.searchEpoch,
      items,
    }];
  },
});

export const userPref = defineJsLiveQuery({
  auth: 'authenticated',
  args: {key: v.string()},
  reads: ['identityBinding', 'user', 'userPref'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    value: v.union([v.null(), userPrefResultValidator()]),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const viewer = await requireSourceUser(ctx);
    const pref = await ctx.db
      .query('userPref')
      .withIndex('by_key_user')
      .eq('key', args.key)
      .eq('userID', viewer._id)
      .first();
    return pref
      ? [{status: 'complete', reason: null, value: sourceUserPrefResult(pref, viewer)}]
      : [{status: 'not-found-authoritative', reason: 'missing-principal-preference', value: null}];
  },
});

export const usersForProject = defineJsLiveQuery({
  auth: 'public',
  args: {
    disabled: v.boolean(),
    login: v.union([v.null(), v.string()]),
    projectName: v.string(),
    filter: v.union([
      v.null(),
      v.literal('crew'),
      v.literal('creators'),
      v.literal('assignees'),
    ]),
    limit: v.integer({min: 1, max: 1_023}),
    start: v.union([v.null(), userCursorValidator()]),
  },
  reads: ['project', 'projectUserRead', 'user'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), userCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    items: v.array(userResultValidator(), {maxItems: 1_023}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    let users = [];
    let examined = 0;
    if (args.disabled && args.login !== null) {
      const row = await resolveUserByLogin(ctx, args.login);
      if (row) users = [row];
      examined = row ? 1 : 0;
    } else if (args.filter === null) {
      const rows = await ctx.db.query('user').withIndex('by_login').take(1_024).collect();
      if (rows.length === 1_024) {
        return [{...pageFact('incomplete', 'user-bound', true, null, 1_024, 0), items: []}];
      }
      users = rows;
      examined = rows.length;
    } else {
      const project = await resolveProject(ctx, args.projectName);
      if (project) {
        const flag = args.filter === 'crew'
          ? 'isCrew'
          : args.filter === 'creators' ? 'isCreator' : 'isAssignee';
        const index = args.filter === 'crew'
          ? 'by_project_crew'
          : args.filter === 'creators' ? 'by_project_creator' : 'by_project_assignee';
        const memberships = await ctx.db
          .query('projectUserRead')
          .withIndex(index)
          .eq('projectID', project._id)
          .eq(flag, true)
          .take(1_024)
          .collect();
        if (memberships.length === 1_024) {
          return [{...pageFact('incomplete', 'project-user-bound', true, null, 1_024, 0), items: []}];
        }
        examined = memberships.length;
        for (const membership of memberships) {
          const row = await ctx.db.get('user', membership.userID);
          if (!row) throw new Error('project user read model references a missing user');
          if (args.filter !== 'crew' || !row.login.startsWith('rocibot')) users.push(row);
        }
      }
    }
    let items = users.map(sourceUserResult);
    items.sort((left, right) => compareUserRows(left, right, 'asc'));
    items = pageAfterStart(items, args.start, false, (left, right) => compareUserRows(left, right, 'asc'));
    const page = boundedPage(items, args.limit);
    const last = page.items.at(-1);
    const cursor = page.hasMore && last ? {id: last.id, login: last.login} : null;
    return [{
      ...pageFact(page.hasMore ? 'incomplete' : 'complete', page.hasMore ? 'page-limit' : null, page.hasMore, cursor, examined, items.length),
      items: page.items,
    }];
  },
});

// @ref LLP 0183#d2--bounded-relational-graph-profile — protected child roots
// release no row, existence, order, or completeness fact before parent proof.
export const commentsPage = defineJsLiveQuery({
  auth: 'public',
  args: {
    issueID: v.string(),
    limit: v.integer({min: 1, max: 1_023}),
    start: v.union([v.null(), commentCursorValidator()]),
    dir: v.union([v.literal('forward'), v.literal('backward')]),
    inclusive: v.boolean(),
  },
  reads: ['identityBinding', 'issue', 'comment', 'emoji', 'user'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), commentCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    items: v.array(richCommentResultValidator(), {maxItems: 1_023}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const unresolved = await ctx.db
      .query('issue')
      .withIndex('by_source_id')
      .eq('id', args.issueID)
      .first();
    const issue = await visibleIssueOrNull(ctx, unresolved);
    if (!issue) {
      return [{
        ...pageFact('not-found-authoritative', 'missing-or-invisible-parent', false, null, 0, 0),
        items: [],
      }];
    }
    const comments = await ctx.db
      .query('comment')
      .withIndex('by_issue_created')
      .eq('issueID', issue._id)
      .take(1_024)
      .collect();
    if (comments.length === 1_024) {
      return [{...pageFact('incomplete', 'comment-bound', true, null, 1_024, 0), items: []}];
    }
    const direction = args.dir === 'backward' ? 'desc' : 'asc';
    comments.sort((left, right) => compareCommentRows(left, right, direction));
    const remaining = pageAfterStart(
      comments,
      args.start,
      args.inclusive,
      (left, right) => compareCommentRows(left, right, direction),
    );
    const page = boundedPage(remaining, args.limit);
    const items = [];
    let childIncomplete = false;
    for (const row of page.items) {
      const rich = await richCommentGraph(ctx, row, issue);
      if (rich.emojiCompleteness !== 'complete') childIncomplete = true;
      items.push(rich);
    }
    const last = page.items.at(-1);
    const cursor = page.hasMore && last ? {id: last.id, created: last.created} : null;
    const incomplete = page.hasMore || childIncomplete;
    return [{
      ...pageFact(
        incomplete ? 'incomplete' : 'complete',
        page.hasMore ? 'page-limit' : childIncomplete ? 'emoji-bound' : null,
        page.hasMore,
        cursor,
        comments.length,
        remaining.length,
      ),
      items,
    }];
  },
});

export const comment = defineJsLiveQuery({
  auth: 'public',
  args: {id: v.string()},
  reads: ['identityBinding', 'issue', 'comment', 'emoji', 'user'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    value: v.union([v.null(), richCommentResultValidator()]),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('comment')
      .withIndex('by_source_id')
      .eq('id', args.id)
      .first();
    const unresolved = row ? await ctx.db.get('issue', row.issueID) : null;
    const issue = await visibleIssueOrNull(ctx, unresolved);
    if (!row || !issue) {
      return [{status: 'not-found-authoritative', reason: 'missing-or-invisible-comment', value: null}];
    }
    const value = await richCommentGraph(ctx, row, issue);
    return [{
      status: value.emojiCompleteness === 'complete' ? 'complete' : 'incomplete',
      reason: value.emojiCompleteness === 'complete' ? null : 'emoji-bound',
      value,
    }];
  },
});

async function issueDetailQueryHandler(ctx, idField, id) {
  const unresolved = await findIssueByField(ctx, idField, id);
  const issue = await visibleIssueOrNull(ctx, unresolved);
  if (!issue) {
    return [{status: 'not-found-authoritative', reason: 'missing-or-invisible-issue', value: null}];
  }
  const viewer = await optionalSourceUser(ctx);
  const base = await issueBaseGraph(ctx, issue);
  const [labelsGraph, issueEmoji, comments, viewState, notificationState] = await Promise.all([
    issueLabelsGraph(ctx, issue, base.project),
    emojiGraph(ctx, issue._id, issue.id),
    issueCommentsWindow(ctx, issue, 50, 'desc'),
    principalViewState(ctx, issue, viewer),
    principalNotificationState(ctx, issue, viewer),
  ]);
  const incomplete = labelsGraph.status !== 'complete'
    || issueEmoji.status !== 'complete'
    || comments.status !== 'complete';
  return [{
    status: incomplete ? 'incomplete' : 'complete',
    reason: incomplete ? 'bounded-child-window' : null,
    value: {
      issue: base.issue,
      project: sourceProjectResult(base.project),
      creator: sourceUserResult(base.creator),
      assignee: base.assignee ? sourceUserResult(base.assignee) : null,
      labels: labelsGraph.items,
      labelsCompleteness: labelsGraph.status,
      notificationState,
      viewState,
      emoji: issueEmoji.items,
      emojiCompleteness: issueEmoji.status,
      comments: comments.items,
      commentsCompleteness: comments.status,
      commentsCursor: comments.cursor,
    },
  }];
}

export const issueDetail = defineJsLiveQuery({
  auth: 'public',
  args: {
    idField: v.union([v.literal('shortID'), v.literal('id')]),
    id: v.union([v.string(), v.integer()]),
  },
  reads: [
    'identityBinding',
    'user',
    'project',
    'issue',
    'issueLabelRead',
    'label',
    'viewState',
    'issueNotifications',
    'emoji',
    'comment',
  ],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    value: v.union([v.null(), issueDetailValueValidator()]),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => await issueDetailQueryHandler(ctx, args.idField, args.id),
});

// Route-only typed wrapper: route parameters can target primitive string args,
// while the frozen issueDetail query keeps its id|string/number union.
export const issueDetailBySourceID = defineJsLiveQuery({
  auth: 'public',
  args: {id: v.string()},
  reads: [
    'identityBinding',
    'user',
    'project',
    'issue',
    'issueLabelRead',
    'label',
    'viewState',
    'issueNotifications',
    'emoji',
    'comment',
  ],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    value: v.union([v.null(), issueDetailValueValidator()]),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => await issueDetailQueryHandler(ctx, 'id', args.id),
});

function issueListResultValidator() {
  return v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), issueCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    searchEpoch: v.array(searchEpochResultValidator(), {maxItems: 2}),
    items: v.array(listIssueItemValidator(), {maxItems: 1_023}),
  });
}

export const issueListV2 = defineJsLiveQuery({
  auth: 'public',
  args: {
    listContext: listContextArgsValidator(),
    limit: v.union([v.null(), v.integer({min: 1, max: 1_023})]),
    start: v.union([v.null(), issueCursorValidator()]),
    dir: v.union([v.literal('forward'), v.literal('backward')]),
    inclusive: v.optional(v.boolean()),
  },
  reads: [
    'identityBinding',
    'user',
    'project',
    'issue',
    'issueListRead',
    'issueLabelRead',
    'label',
    'issueSearchDocument',
    'searchEpoch',
    'viewState',
  ],
  result: results.records(issueListResultValidator(), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    if (args.limit === null) {
      return [{
        ...pageFact('incomplete', 'positive-limit-required', true, null, 0, 0),
        searchEpoch: [],
        items: [],
      }];
    }
    const engine = await runIssueListEngine(ctx, {
      listContext: args.listContext,
      point: false,
      targetSourceID: null,
      limit: args.limit,
      start: args.start,
      direction: args.dir,
      inclusive: args.inclusive === true,
    });
    return [listEngineResult(engine)];
  },
});

export const listIssueByID = defineJsLiveQuery({
  auth: 'public',
  args: {
    listContext: listContextArgsValidator(),
    idField: v.union([v.literal('shortID'), v.literal('id')]),
    idValue: v.union([v.string(), v.integer()]),
  },
  reads: [
    'identityBinding',
    'user',
    'project',
    'issue',
    'issueListRead',
    'issueLabelRead',
    'label',
    'issueSearchDocument',
    'searchEpoch',
    'viewState',
  ],
  result: results.records(issueListResultValidator(), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const issue = await findIssueByField(ctx, args.idField, args.idValue);
    const engine = await runIssueListEngine(ctx, {
      listContext: args.listContext,
      point: true,
      targetSourceID: issue ? issue.id : '__zerobugs_missing_issue__',
      limit: 1,
      start: null,
      direction: 'forward',
      inclusive: false,
    });
    return [listEngineResult(engine)];
  },
});

export const emojiChange = defineJsLiveQuery({
  auth: 'public',
  args: {
    subjectID: v.string(),
    limit: v.integer({min: 1, max: 1_023}),
    start: v.union([v.null(), emojiCursorValidator()]),
  },
  reads: ['identityBinding', 'issue', 'comment', 'emoji', 'user'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    subjectKind: v.union([v.null(), v.literal('issue'), v.literal('comment')]),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), emojiCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    items: v.array(richEmojiResultValidator(), {maxItems: 1_023}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    let subjectKind = null;
    let physicalSubjectID = null;
    const issueSubject = await ctx.db
      .query('issue')
      .withIndex('by_source_id')
      .eq('id', args.subjectID)
      .first();
    if (issueSubject) {
      const issue = await visibleIssueOrNull(ctx, issueSubject);
      if (!issue) {
        return [{
          ...pageFact('not-found-authoritative', 'missing-or-invisible-subject', false, null, 0, 0),
          subjectKind: null,
          items: [],
        }];
      }
      subjectKind = 'issue';
      physicalSubjectID = issue._id;
    } else {
      const commentSubject = await ctx.db
        .query('comment')
        .withIndex('by_source_id')
        .eq('id', args.subjectID)
        .first();
      const unresolvedParent = commentSubject
        ? await ctx.db.get('issue', commentSubject.issueID)
        : null;
      const parent = await visibleIssueOrNull(ctx, unresolvedParent);
      if (!commentSubject || !parent) {
        return [{
          ...pageFact('not-found-authoritative', 'missing-or-invisible-subject', false, null, 0, 0),
          subjectKind: null,
          items: [],
        }];
      }
      subjectKind = 'comment';
      physicalSubjectID = commentSubject._id;
    }

    const rows = await ctx.db
      .query('emoji')
      .withIndex('by_subject')
      .eq('subjectID', physicalSubjectID)
      .take(1_024)
      .collect();
    if (rows.length === 1_024) {
      return [{
        ...pageFact('incomplete', 'emoji-bound', true, null, 1_024, 0),
        subjectKind,
        items: [],
      }];
    }
    rows.sort((left, right) => compareEmojiRows(left, right, 'asc'));
    const remaining = pageAfterStart(
      rows,
      args.start,
      false,
      (left, right) => compareEmojiRows(left, right, 'asc'),
    );
    const page = boundedPage(remaining, args.limit);
    const items = [];
    for (const row of page.items) {
      const creator = await ctx.db.get('user', row.creatorID);
      if (!creator) throw new Error('emoji references a missing creator');
      items.push({
        emoji: sourceEmojiResult(row, args.subjectID, creator),
        creator: sourceUserResult(creator),
      });
    }
    const last = page.items.at(-1);
    const cursor = page.hasMore && last ? {id: last.id, created: last.created} : null;
    return [{
      ...pageFact(page.hasMore ? 'incomplete' : 'complete', page.hasMore ? 'page-limit' : null, page.hasMore, cursor, rows.length, remaining.length),
      subjectKind,
      items,
    }];
  },
});

export const prevNext = defineJsLiveQuery({
  auth: 'public',
  args: {
    listContext: v.union([v.null(), listContextArgsValidator()]),
    issue: v.union([v.null(), issueCursorValidator()]),
    dir: v.union([v.literal('next'), v.literal('prev')]),
  },
  reads: [
    'identityBinding',
    'user',
    'project',
    'issue',
    'issueListRead',
    'issueLabelRead',
    'label',
    'issueSearchDocument',
    'searchEpoch',
    'viewState',
  ],
  result: results.records(issueListResultValidator(), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    if (args.listContext === null) {
      return [{
        ...pageFact('not-found-authoritative', 'missing-list-context', false, null, 0, 0),
        searchEpoch: [],
        items: [],
      }];
    }
    const engine = await runIssueListEngine(ctx, {
      listContext: args.listContext,
      point: true,
      targetSourceID: null,
      limit: 1,
      start: args.issue,
      direction: args.dir === 'prev' ? 'backward' : 'forward',
      inclusive: false,
    });
    return [listEngineResult(engine)];
  },
});

export const issueList = defineJsLiveQuery({
  auth: 'public',
  args: {
    listContext: listContextArgsValidator(),
    limit: v.integer({min: 1, max: 1_023}),
  },
  reads: [
    'identityBinding',
    'user',
    'project',
    'issue',
    'issueListRead',
    'issueLabelRead',
    'label',
    'issueSearchDocument',
    'searchEpoch',
    'viewState',
  ],
  result: results.records(issueListResultValidator(), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    const engine = await runIssueListEngine(ctx, {
      listContext: args.listContext,
      point: false,
      targetSourceID: null,
      limit: args.limit,
      start: null,
      direction: 'forward',
      inclusive: false,
    });
    return [listEngineResult(engine)];
  },
});

export const userPicker = defineJsLiveQuery({
  auth: 'public',
  args: {
    disabled: v.boolean(),
    login: v.union([v.null(), v.string()]),
    filter: v.union([v.null(), v.literal('crew'), v.literal('creators')]),
    limit: v.integer({min: 1, max: 1_023}),
    start: v.union([v.null(), userCursorValidator()]),
  },
  reads: ['user', 'projectUserRead'],
  result: results.records(v.object({
    status: statusValidator(),
    reason: nullableStringValidator(),
    hasMore: v.boolean(),
    cursor: v.union([v.null(), userCursorValidator()]),
    examined: v.integer(),
    total: v.integer(),
    items: v.array(userResultValidator(), {maxItems: 1_023}),
  }), {minItems: 1, maxItems: 1}),
  handler: async (ctx, args) => {
    let users = [];
    let examined = 0;
    if (args.disabled && args.login !== null) {
      const row = await resolveUserByLogin(ctx, args.login);
      if (row) users = [row];
      examined = row ? 1 : 0;
    } else if (args.filter === 'creators') {
      const memberships = await ctx.db.query('projectUserRead').take(1_024).collect();
      if (memberships.length === 1_024) {
        return [{...pageFact('incomplete', 'project-user-bound', true, null, 1_024, 0), items: []}];
      }
      const userIDs = new Set(
        memberships.filter(row => row.isCreator).map(row => row.userID),
      );
      examined = memberships.length;
      for (const userID of userIDs) {
        const row = await ctx.db.get('user', userID);
        if (!row) throw new Error('project user read model references a missing user');
        users.push(row);
      }
    } else {
      const rows = await ctx.db.query('user').withIndex('by_login').take(1_024).collect();
      if (rows.length === 1_024) {
        return [{...pageFact('incomplete', 'user-bound', true, null, 1_024, 0), items: []}];
      }
      examined = rows.length;
      users = args.filter === 'crew'
        ? rows.filter(row => row.role === 'crew' && !row.login.startsWith('rocibot'))
        : rows;
    }
    let items = users.map(sourceUserResult);
    items.sort((left, right) => compareUserRows(left, right, 'asc'));
    items = pageAfterStart(items, args.start, false, (left, right) => compareUserRows(left, right, 'asc'));
    const page = boundedPage(items, args.limit);
    const last = page.items.at(-1);
    const cursor = page.hasMore && last ? {id: last.id, login: last.login} : null;
    return [{
      ...pageFact(page.hasMore ? 'incomplete' : 'complete', page.hasMore ? 'page-limit' : null, page.hasMore, cursor, examined, items.length),
      items: page.items,
    }];
  },
});
