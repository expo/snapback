// Todo demo optimistic reducers: how THIS app's mutations transform its rows
// during the in-flight window. App logic, owned by the demo — the generic
// @expo/snapback-contract adapter ships no reducers (LLP 0032 P5).
//
// Reducers must be idempotent (ENG-23385): while a mutation is in flight the
// adapter re-applies its reducer to every authoritative server-rows write,
// and those rows may already contain the committed effect — the server can
// commit and fan out before the mutate() response resolves (own live_replace
// racing the HTTP response, or a concurrent mutation's reconcile). The
// id-keyed update/delete reducers are naturally idempotent; createTodo must
// not append a second copy once its committed row is present.

export const todoOptimisticReducers = {
  createTodo: (rows, args, { userId, optimisticId, baseVersion = null }) => {
    const title = String(args.title ?? '').trim();
    if (!title) return rows;
    // Skip the optimistic append when this mutation's commit already landed
    // in the rows: a non-optimistic row matching the args at a version NEWER
    // than the rows the mutation fired against (baseVersion). The version
    // guard keeps a pre-existing same-title todo from suppressing the
    // optimistic row for a genuinely new duplicate-title create.
    const committed = rows.some(
      (row) =>
        row.optimistic !== true
        && row.userId === userId
        && row.title === title
        && (typeof row._version !== 'number'
          || baseVersion === null
          || row._version > baseVersion),
    );
    if (committed) return rows;
    return [
      ...rows,
      {
        completed: false,
        userId,
        ...args,
        title,
        _id: optimisticId,
        optimistic: true,
      },
    ];
  },
  setCompleted: (rows, args) =>
    rows.map((row) => (row._id === args.id ? { ...row, completed: args.completed } : row)),
  editTitle: (rows, args) =>
    rows.map((row) => (row._id === args.id ? { ...row, title: args.title } : row)),
  deleteTodo: (rows, args) => rows.filter((row) => row._id !== args.id),
};
