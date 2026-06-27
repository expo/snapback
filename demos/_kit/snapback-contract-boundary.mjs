// Snapback ↔ Contract bridge — first cut of the `@expo/snapback/contract` adapter.
//
// @ref LLP 0005#contractexact-integration — the generated Contract adapter owns
//   the boring seams Valet demos copied by hand (boot, query-boundary wiring,
//   mutation invocation, initial snapshot, pending state). This is one shared
//   adapter, not per-demo glue.
// @ref LLP 0012#capability-manifest — Online vs. Parity: this adapter speaks the
//   wire protocol and runs mutations on the *server*, offering optimistic UI from
//   mutation args. It does NOT run handlers locally, so it is an Online adapter
//   and must not be presented as local-first/Parity.
//
// `runtime` is the resolved @exact/contract/runtime module (imported by the
// caller through the capability-probed resolver), so this file stays decoupled
// from any particular Exact checkout location.

export function createSnapbackContractSurface({ runtime, client, userId, manifest }) {
  const pending = [];
  let optimisticSeq = 0;

  // Boot: hydrate the local reactive boundary from the authoritative server
  // snapshot (the "current value + subscription" seam — no manual prime race).
  return (async () => {
    const initial = (await client.query('listTodos', { userId })).rows;
    const boundary = runtime.createContractMockQueryBoundary({ todos: initial });

    // Query factories (the `use ... from` link targets) over the boundary.
    const links = {
      listTodos: (_args) => boundary.query('todos', (rows) => rows, { key: 'todos' }),

      // Mutation link used by the Contract `submit` action: optimistic local
      // insert (from args) for an instant view update, then server-authoritative
      // persist + re-read. Optimistic rows carry an `optimistic` marker.
      createTodo: (args) => {
        const optimisticId = `optimistic_${++optimisticSeq}`;
        boundary.write('todos', (rows) => [
          ...rows,
          { _id: optimisticId, title: args.title, completed: false, userId, optimistic: true },
        ]);
        pending.push(persist(args.title));
      },
      setCompleted: (args) => {
        boundary.write('todos', (rows) =>
          rows.map((row) => row._id === args.id ? { ...row, completed: args.completed } : row),
        );
        pending.push(persistCompletion(args));
      },
      deleteTodo: (args) => {
        boundary.write('todos', (rows) => rows.filter((row) => row._id !== args.id));
        pending.push(persistDelete(args));
      },
    };

    async function persist(title) {
      await client.mutate('createTodo', { args: { title }, userId });
      const rows = (await client.query('listTodos', { userId })).rows;
      boundary.write('todos', () => rows); // reconcile optimistic -> authoritative
    }

    async function persistCompletion(args) {
      await client.mutate('setCompleted', { args, userId });
      const rows = (await client.query('listTodos', { userId })).rows;
      boundary.write('todos', () => rows);
    }

    async function persistDelete(args) {
      await client.mutate('deleteTodo', { args, userId });
      const rows = (await client.query('listTodos', { userId })).rows;
      boundary.write('todos', () => rows);
    }

    // The neutral ContractDataProvider seam (subscribe/mutate/forceQueryState),
    // for adapters/tools that prefer the provider over direct links.
    const provider = runtime.createBoundaryContractDataProvider(manifest, boundary, {
      queries: { listTodos: (_args, qb) => qb.query('todos', (rows) => rows, { key: 'todos' }) },
      mutations: {
        createTodo: async (args, qb) => {
          await client.mutate('createTodo', { args: { title: args.title }, userId });
          const rows = (await client.query('listTodos', { userId })).rows;
          qb.write('todos', () => rows);
        },
        setCompleted: async (args, qb) => {
          await client.mutate('setCompleted', { args, userId });
          const rows = (await client.query('listTodos', { userId })).rows;
          qb.write('todos', () => rows);
        },
        deleteTodo: async (args, qb) => {
          await client.mutate('deleteTodo', { args, userId });
          const rows = (await client.query('listTodos', { userId })).rows;
          qb.write('todos', () => rows);
        },
      },
      rowSyncState: async (table, rowId) => {
        const rows = (await client.query('listTodos', { userId })).rows;
        const row = rows.find((r) => r._id === rowId);
        return row
          ? { syncedVersion: row._version, approxSyncedAt: null, pendingMutations: false }
          : null;
      },
    });

    return {
      boundary,
      links,
      provider,
      pendingCount: () => pending.length,
      // Await all in-flight server persists (deterministic; no sleeps).
      flush: async () => { await Promise.all(pending.splice(0)); },
    };
  })();
}
