// Shared O14 live-query fixture source for the headless and standards-real
// browser arms. Keeping one authoring source prevents the browser arm from
// silently narrowing a reported shape while the headless harness evolves.

export function liveQueryInvalidationBackendSources({ defineUrl }) {
  if (typeof defineUrl !== 'string' || defineUrl.length === 0) {
    throw new TypeError('liveQueryInvalidationBackendSources requires defineUrl');
  }

  const schema = `
import { defineAuth, defineSchema, defineTable, v } from '${defineUrl}';

const authProgram = defineAuth({
  version: 1,
  mechanisms: {
    password: {
      kind: 'password',
      identifier: 'email',
      provider: 'builtIn',
      recovery: 'recoveryCodes',
    },
  },
  assuranceRequirements: {},
  recoveryPolicy: {
    recoveryCodes: {
      enabled: true,
      requiredWhen: 'no-independent-recovery',
      rotateAfterUse: true,
      plaintextCustody: 'one-time-response',
    },
    lastAuthenticator: 'enforce',
  },
  guestPolicy: { enabled: false },
  secretReferences: {},
});

export default defineSchema({
  parents: defineTable({ name: v.string() }).visibility({ kind: 'public-read' }).sync(),
  children: defineTable({
    parentId: v.id('parents'),
    lookupKey: v.string(),
    body: v.string(),
    revision: v.integer(),
  })
    .visibility({ kind: 'public-read' })
    .index('by_parent', ['parentId'])
    .index('by_lookup_key', ['lookupKey'])
    .sync(),
  messages: defineTable({
    sequence: v.integer(),
    body: v.string(),
  })
    .visibility({ kind: 'public-read' })
    .index('by_sequence', ['sequence'])
    .sync(),
  posts: defineTable({
    parentId: v.optional(v.id('posts')),
    body: v.string(),
    replyCount: v.integer(),
    createdAt: v.integer(),
  })
    .visibility({ kind: 'public-read' })
    .index('by_parent_created', ['parentId', 'createdAt'])
    .sync(),
}, { auth: { mode: 'sessions' }, authProgram });
`;

  const functions = `
import {
  asc,
  arg,
  defineJsLiveQuery,
  defineJsMutation,
  defineLiveQuery,
  desc,
  eq,
  results,
  v,
} from '${defineUrl}';

export const parentWithChildren = defineJsLiveQuery({
  auth: 'authenticated',
  args: { parentId: v.id('parents') },
  result: results.records(v.object({
    parentId: v.id('parents'),
    name: v.string(),
    children: v.array(v.object({
      id: v.id('children'),
      body: v.string(),
      revision: v.integer(),
    }), { maxItems: 1024 }),
  }), { minItems: 0, maxItems: 1 }),
  reads: ['parents', 'children'],
  handler: async (ctx, args) => {
    const parent = await ctx.db.get('parents', args.parentId);
    if (!parent) return [];
    const children = await ctx.db
      .query('children')
      .withIndex('by_parent')
      .eq('parentId', parent._id)
      .collect();
    return [{
      parentId: parent._id,
      name: parent.name,
      children: children.map((child) => ({
        id: child._id,
        body: child.body,
        revision: child.revision,
      })),
    }];
  },
});

export const childrenForParent = defineLiveQuery({
  auth: 'authenticated',
  table: 'children',
  args: { parentId: v.id('parents') },
  filter: [eq('parentId', arg('parentId'))],
  index: 'by_parent',
});

export const childByKey = defineLiveQuery({
  auth: 'authenticated',
  table: 'children',
  args: { lookupKey: v.string() },
  filter: [eq('lookupKey', arg('lookupKey'))],
  index: 'by_lookup_key',
  limit: 1,
});

export const allMessages = defineJsLiveQuery({
  auth: 'public',
  args: {},
  result: results.documents('messages'),
  reads: ['messages'],
  handler: async (ctx) => ctx.db.query('messages').collect(),
});

export const latestMessage = defineLiveQuery({
  auth: 'public',
  table: 'messages',
  args: {},
  order: [desc('sequence')],
  index: 'by_sequence',
  limit: 1,
});

export const postById = defineLiveQuery({
  auth: 'authenticated',
  table: 'posts',
  args: { id: v.id('posts') },
  filter: [eq('_id', arg('id'))],
  limit: 1,
});

export const repliesForPost = defineLiveQuery({
  auth: 'authenticated',
  table: 'posts',
  args: { parentId: v.id('posts') },
  filter: [eq('parentId', arg('parentId'))],
  order: [asc('createdAt')],
  index: 'by_parent_created',
});

export const createParent = defineJsMutation({
  auth: 'authenticated',
  args: { name: v.string() },
  result: results.value(v.id('parents')),
  writes: ['parents'],
  handler: async (ctx, args) => ctx.db.insert('parents', { name: args.name }),
});

export const createChild = defineJsMutation({
  auth: 'authenticated',
  args: { parentId: v.id('parents'), lookupKey: v.string(), body: v.string() },
  result: results.value(v.id('children')),
  writes: ['children'],
  handler: async (ctx, args) => ctx.db.insert('children', {
    parentId: args.parentId,
    lookupKey: args.lookupKey,
    body: args.body,
    revision: 1,
  }),
});

export const patchChild = defineJsMutation({
  auth: 'authenticated',
  args: { childId: v.id('children'), body: v.string(), revision: v.integer() },
  result: results.value(v.boolean()),
  writes: ['children'],
  handler: async (ctx, args) => ctx.db.patch('children', args.childId, {
    body: args.body,
    revision: args.revision,
  }),
});

export const insertMessageBatch = defineJsMutation({
  auth: 'public',
  args: { startSequence: v.integer(), count: v.integer() },
  result: results.value(v.object({ inserted: v.integer(), lastSequence: v.integer() })),
  writes: ['messages'],
  handler: async (ctx, args) => {
    for (let offset = 0; offset < args.count; offset += 1) {
      const sequence = args.startSequence + offset;
      await ctx.db.insert('messages', { sequence, body: 'message-' + sequence });
    }
    return { inserted: args.count, lastSequence: args.startSequence + args.count - 1 };
  },
});

export const createThread = defineJsMutation({
  auth: 'authenticated',
  args: { body: v.string(), createdAt: v.integer() },
  result: results.value(v.id('posts')),
  writes: ['posts'],
  handler: async (ctx, args) => ctx.db.insert('posts', {
    parentId: null,
    body: args.body,
    replyCount: 0,
    createdAt: args.createdAt,
  }),
});

export const writePost = defineJsMutation({
  auth: 'authenticated',
  args: {
    parentId: v.id('posts'),
    body: v.string(),
    createdAt: v.integer(),
  },
  result: results.value(v.id('posts')),
  reads: ['posts'],
  writes: ['posts'],
  handler: async (ctx, args) => {
    const parent = await ctx.db.get('posts', args.parentId);
    if (!parent) throw new Error('parent post not found');
    const replyId = await ctx.db.insert('posts', {
      parentId: args.parentId,
      body: args.body,
      replyCount: 0,
      createdAt: args.createdAt,
    });
    await ctx.db.patch('posts', args.parentId, {
      replyCount: parent.replyCount + 1,
    });
    return replyId;
  },
});
`;

  return { functions, schema };
}
