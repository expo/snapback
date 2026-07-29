// Fixture expectations shared by the acceptance runner. Server-owned row ids
// are deliberately not fixtures: authenticated resource bootstrap creates them.
export const TODO_FIXTURE = Object.freeze({
  workspaces: 2,
  listNames: ['Inbox', 'Bakeoff', 'Operations', 'Done'],
  tasksPerList: 25,
});
