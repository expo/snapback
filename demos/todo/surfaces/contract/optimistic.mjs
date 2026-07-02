// Todo demo optimistic reducers: how THIS app's mutations transform its rows
// during the in-flight window. App logic, owned by the demo — the generic
// @snapback/contract adapter ships no reducers (LLP 0032 P5).

export const todoOptimisticReducers = {
  createTodo: (rows, args, { userId, optimisticId }) => [
    ...rows,
    {
      completed: false,
      userId,
      ...args,
      _id: optimisticId,
      optimistic: true,
    },
  ],
  setCompleted: (rows, args) =>
    rows.map((row) => (row._id === args.id ? { ...row, completed: args.completed } : row)),
  editTitle: (rows, args) =>
    rows.map((row) => (row._id === args.id ? { ...row, title: args.title } : row)),
  deleteTodo: (rows, args) => rows.filter((row) => row._id !== args.id),
};
