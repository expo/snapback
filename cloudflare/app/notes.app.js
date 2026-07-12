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

export const schema = {
  schemaHash: 'notes-app-v1',
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

export const bundleHash = 'notes-app-bundle-v1';

export const functions = [
  { name: 'listNotes', kind: 'LiveQuery', export: 'listNotes', tables: ['notes'] },
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
  // ENG-23606 regression probes: null/missing optional-field filters must
  // behave identically on the SQL-pushdown path (no buffered writes) and the
  // buffered-overlay path (mid-mutation, after a write).
  { name: 'listNotesByAuthor', kind: 'LiveQuery', export: 'listNotesByAuthor', tables: ['notes'], testingOnly: true },
  { name: 'probeNullSemantics', kind: 'Mutation', export: 'probeNullSemantics', tables: ['notes'], testingOnly: true },
  { name: 'probeBadTable', kind: 'Mutation', export: 'probeBadTable', tables: ['notes'], testingOnly: true },
  { name: 'addNoteDetachedFailure', kind: 'Mutation', export: 'addNoteDetachedFailure', tables: ['notes'], testingOnly: true },
];

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
