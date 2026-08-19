// The deployed app bundle for the LLP 0040 Cloudflare narrow proof.
//
// Deploy-time compiled into the handler Worker — the Workers runtime forbids
// dynamic code evaluation (`eval`/`new Function`), so the local
// load-bundle-at-runtime model does not port (LLP 0040 §App subset, LLP 0014
// one-way door 2). An app-code change is a redeploy; the capability manifest
// reports code hot-load as missing.
//
// The smallest meaningful app: one syncable table, one real JS mutation
// handler executing in V8, one single-table live query. The handler reaches
// storage only through the async `ctx` surface — never a Durable Object
// storage handle, Worker env, or ambient global (LLP 0009, verified by the
// ambient-power denial test).

import capabilityManifest from '../generated/capability.manifest.cloudflare-do-sqlite-v8.json';
import deploymentIdentityArtifact from '../generated/deployment-identity.notes.json';

// Uniform app-bundle surface for the LLP 0049 deploy-time app selector: every
// bundle exports appMeta/seed/capabilityManifest alongside schema/functions,
// and the build resolves ONE bundle through the 'snapback-app' alias
// (wrangler `alias` / esbuild `alias` in the Miniflare harness).
export const appMeta = {
  name: 'notes',
  objectName: 'notes-proof',
};

// The notes fixture seeds nothing — it starts empty by design.
export const seed = null;

// No declared configuration: the notes proof exercises no secrets backend
// (LLP 0049 Phase 1 lands that on the All Aboard bundle).
export const config = [];

// No cron jobs: the notes proof has no scheduled execution (LLP 0049
// Phase 3 lands warm polling on the All Aboard bundle).
export const cron = [];

export { capabilityManifest };
export const deploymentIdentity = deploymentIdentityArtifact;

// @ref LLP 0058#capability-maturity — this bundle requires no experimental
// capability, so it acknowledges none.
export const acknowledgedExperimentalCapabilities = [];

export const schema = {
  schemaHash: deploymentIdentity.schemaHash,
  strictDeclarations: false,
  tables: [
    {
      name: 'notes',
      syncable: true,
      fields: [
        { name: 'boardId', type: 'string', optional: false },
        { name: 'text', type: 'string', optional: false },
        { name: 'authorId', type: 'string', optional: true },
      ],
      indexes: [{ name: 'by_board', fields: ['boardId'] }],
    },
  ],
};

export const bundleHash = deploymentIdentity.bundleHash;

export const functions = [
  { name: 'listNotes', kind: 'LiveQuery', export: 'listNotes', tables: ['notes'], authRequirement: 'public' },
  // RQS-eligible queries (LLP 0090 rollout step 4). These are declarative
  // HostPlan queries the coordinator evaluates natively — no JS handler, no
  // opaque code — which is what makes the compiled facts honest: the
  // rqsEligible predicate (authorityIndependent + the closed-inputs
  // singleTable proof) and the publicInline disclosure fact are DERIVED by
  // the coordinator from these fields (targets/cloudflare/src/rqs-host.mjs), the
  // deploy-time-compiled analog of the local arm's codegen + served-manifest
  // validation. `boardNotes` is unordered (mset1 digests); `boardNotesOrdered`
  // adds an order clause (seq1 digests) so both digest kinds have a
  // Cloudflare-arm witness.
  {
    name: 'boardNotes',
    kind: 'LiveQuery',
    tables: ['notes'],
    authRequirement: 'public',
    authorityIndependent: true,
    publicInline: true,
    uses: [],
    readSetSummary: { authScopeField: null, mode: 'singleTable', primaryTable: 'notes', tables: ['notes'] },
    runtime: {
      HostPlan: {
        Query: {
          table: 'notes',
          indexed_by: 'by_board',
          filters: [{ field: 'boardId', op: 'Eq', value: { Arg: 'boardId' } }],
          membershipFilters: [],
          order: [],
          limit: null,
        },
      },
    },
  },
  {
    name: 'boardNotesOrdered',
    kind: 'LiveQuery',
    tables: ['notes'],
    authRequirement: 'public',
    authorityIndependent: true,
    publicInline: true,
    uses: [],
    readSetSummary: { authScopeField: null, mode: 'singleTable', primaryTable: 'notes', tables: ['notes'] },
    runtime: {
      HostPlan: {
        Query: {
          table: 'notes',
          indexed_by: 'by_board',
          filters: [{ field: 'boardId', op: 'Eq', value: { Arg: 'boardId' } }],
          membershipFilters: [],
          order: [{ field: '_createdAt', direction: 'Asc' }],
          limit: null,
        },
      },
    },
  },
  { name: 'addNote', kind: 'Mutation', export: 'addNote', tables: ['notes'] },
  // A probe used only by the ambient-power denial acceptance test (LLP 0040
  // §Acceptance). It reports what the handler isolate can and cannot reach, so
  // the test asserts denial against the *deployed* handler, not just the twin.
  { name: 'probeAmbient', kind: 'Query', export: 'probeAmbient' },
  // Regression probes for the Miniflare acceptance suite: no-op commits must
  // not advance the version (ENG-23583), off-schema tables must be refused
  // (ENG-23578), and a detached rejection parked on a host call must fail the
  // mutation with nothing committed (ENG-23584/ENG-23585).
  { name: 'touchNote', kind: 'Mutation', export: 'touchNote', tables: ['notes'], testingOnly: true },
  { name: 'insertRawNote', kind: 'Mutation', export: 'insertRawNote', tables: ['notes'], testingOnly: true },
  { name: 'writeDerivedRawNote', kind: 'Mutation', export: 'writeDerivedRawNote', tables: ['notes'], testingOnly: true },
  { name: 'queryRawNotes', kind: 'Query', export: 'queryRawNotes', tables: ['notes'], testingOnly: true },
  // ENG-23606 regression probes: null/missing optional-field filters must
  // behave identically on the SQL-pushdown path (no buffered writes) and the
  // buffered-overlay path (mid-mutation, after a write).
  { name: 'listNotesByAuthor', kind: 'LiveQuery', export: 'listNotesByAuthor', tables: ['notes'], testingOnly: true },
  { name: 'probeNullSemantics', kind: 'Mutation', export: 'probeNullSemantics', tables: ['notes'], testingOnly: true },
  { name: 'probeBadTable', kind: 'Mutation', export: 'probeBadTable', tables: ['notes'], testingOnly: true },
  { name: 'addNoteDetachedFailure', kind: 'Mutation', export: 'addNoteDetachedFailure', tables: ['notes'], testingOnly: true },
];

// The route→query manifest compiled into the Worker (LLP 0092 §0C.1's 0C
// artifact; LLP 0090 rollout step 4). Deploy-time compiled like everything
// else on this arm — the coordinator validates it at first use and the
// gateway's Channel A seam matches pageload paths against it. `/board/:boardId`
// and `/` are the publicInline lanes; `/private/:boardId` deliberately names
// the non-publicInline `listNotes` so the NOT_PUBLIC refusal and the
// degrade-to-shell posture stay under test.
export const routesManifest = {
  formatVersion: 1,
  app: 'notes',
  routes: [
    { route: '/', queries: [{ function: 'boardNotes', args: { boardId: 'lobby' } }] },
    {
      route: '/board/:boardId',
      queries: [{ function: 'boardNotes', args: { boardId: { $param: 'boardId' } } }],
    },
    {
      route: '/ordered/:boardId',
      queries: [{ function: 'boardNotesOrdered', args: { boardId: { $param: 'boardId' } } }],
    },
    {
      route: '/private',
      queries: [{ function: 'listNotes', args: { boardId: 'secret' } }],
    },
  ],
};

// One handler module, the same `globalThis.__snapbackHandlers` contract the
// local Ibex target and the LLP 0048 twin execute. Every db touch is awaited
// because the ctx host boundary is async and RPC-shaped on this target
// (LLP 0014 one-way door 3).
globalThis.__snapbackHandlers = {
  async listNotes(ctx, args) {
    return await ctx.db
      .query('notes')
      .eq('boardId', args.boardId)
      .order('_createdAt', 'asc')
      .collect();
  },
  async addNote(ctx, args) {
    if (!args.text || typeof args.text !== 'string') {
      throw new Error('addNote requires a text string');
    }
    const id = await ctx.db.insert('notes', {
      boardId: args.boardId,
      text: args.text.slice(0, 280),
      authorId: args.authorId || null,
    });
    return { id };
  },
  async listNotesByAuthor(ctx, args) {
    // `authorId` may be an explicit null: the ENG-23606 canonical semantics
    // (SQL three-valued logic, matching the Rust hosts) say `eq(field, null)`
    // matches NOTHING — not even rows storing null.
    return await ctx.db
      .query('notes')
      .eq('authorId', args.authorId === undefined ? null : args.authorId)
      .order('_createdAt', 'asc')
      .collect();
  },
  async probeNullSemantics(ctx, args) {
    // Runs the same null-sensitive queries before any buffered write (SQL
    // pushdown path) and after one (buffered-overlay path) inside a single
    // invocation. The two answer sets must agree (ENG-23606).
    const eqNullBefore = await ctx.db.query('notes').eq('authorId', null).collect();
    const ltBefore = await ctx.db.query('notes').lt('authorId', 'zzz').collect();
    await ctx.db.insert('notes', {
      boardId: args.boardId,
      text: 'null-author probe',
      authorId: null,
    });
    const eqNullAfter = await ctx.db.query('notes').eq('authorId', null).collect();
    const ltAfter = await ctx.db.query('notes').lt('authorId', 'zzz').collect();
    return {
      eqNullBefore: eqNullBefore.length,
      eqNullAfter: eqNullAfter.length,
      ltBefore: ltBefore.length,
      ltAfter: ltAfter.length,
    };
  },
  async touchNote(ctx, args) {
    // Patches an arbitrary (usually missing) id, optionally with an empty
    // values object — both must be commit no-ops that leave the version
    // untouched, matching the local target (ENG-23583).
    const existed = await ctx.db.patch('notes', args.id || 'missing-note-id', args.values || {});
    return { existed };
  },
  async insertRawNote(ctx, args) {
    return { id: await ctx.db.insert('notes', args.values) };
  },
  async writeDerivedRawNote(ctx, args) {
    // ENG-24342 corpus probe: the invalid value/key is computed inside the
    // handler so the test reaches the same host validation boundary as any
    // ordinary derived write, rather than posting a pre-built row only.
    const derived = { [args.field]: args.left + args.right };
    if (args.operation === 'patch') {
      return { existed: await ctx.db.patch('notes', args.id, derived) };
    }
    return {
      id: await ctx.db.insert('notes', {
        boardId: 'validation-board',
        text: 'valid derived row',
        ...derived,
      }),
    };
  },
  async queryRawNotes(ctx, args) {
    let query = ctx.db.query('notes');
    if (args.index) query = query.withIndex(args.index);
    if (args.field) query = query.eq(args.field, args.value);
    return await query.collect();
  },
  async probeBadTable(ctx) {
    try {
      await ctx.db.insert('not_a_table', { text: 'nope' });
      return { inserted: true };
    } catch (error) {
      return { inserted: false, message: String((error && error.message) || error) };
    }
  },
  async addNoteDetachedFailure(ctx, args) {
    // The ENG-23361 shape parked on a host call: the detached chain buffers a
    // write over the async RPC seam and THEN rejects. The invocation must
    // fail closed with nothing committed (ENG-23584), and only THIS
    // invocation may fail (ENG-23585).
    [1, 2].forEach(async (rank) => {
      await ctx.db.insert('notes', { boardId: args.boardId, text: `detached-${rank}` });
      throw new Error(`detached failure ${rank}`);
    });
    return { launched: true };
  },
  // Probe both denial directions (LLP 0040 §App subset): ambient globals
  // (fetch/env/bindings) and direct host-object reach-through (a Durable
  // Object storage handle, module globals). Every name must be unreachable —
  // the handler's only power is the async ctx surface.
  async probeAmbient(ctx) {
    function reach(name) {
      let value;
      try {
        value = globalThis[name];
      } catch (_) {
        return { name: name, reachable: false };
      }
      if (value === undefined || value === null) return { name: name, reachable: false };
      if (typeof value === 'function') {
        try {
          value();
          return { name: name, reachable: true };
        } catch (error) {
          const message = String((error && error.message) || error);
          return {
            name: name,
            reachable: message.indexOf('SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED') !== 0,
          };
        }
      }
      return { name: name, reachable: true };
    }
    return [
      reach('fetch'),
      reach('WebSocket'),
      reach('caches'),
      reach('crypto'),
      // Host reach-through: none of these Durable-Object/Worker handles are
      // module globals in the handler isolate.
      reach('DurableObjectStorage'),
      reach('env'),
      reach('COORDINATOR'),
      reach('HANDLER'),
      reach('HOST'),
    ];
  },
};
