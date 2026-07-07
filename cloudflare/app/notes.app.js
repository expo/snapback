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

export const functions = [
  { name: 'listNotes', kind: 'LiveQuery', export: 'listNotes' },
  { name: 'addNote', kind: 'Mutation', export: 'addNote' },
  // A probe used only by the ambient-power denial acceptance test (LLP 0040
  // §Acceptance). It reports what the handler isolate can and cannot reach, so
  // the test asserts denial against the *deployed* handler, not just the twin.
  { name: 'probeAmbient', kind: 'Query', export: 'probeAmbient' },
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
