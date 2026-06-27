// Source of truth for the Snapback admin Contract data bindings.
//
// @ref LLP 0021#phase-4-move-admin-and-demo-surfaces-onto-the-adapter - admin
//   Contract modules should be projected like the todo demos, not maintained as
//   hand-written per-binding sidecars.

export const adminContractBindings = [
  {
    name: 'inspect',
    kind: 'query',
    args: {},
    reads: ['inspect'],
    readMode: 'sync',
    cacheKey: 'inspect',
  },
  {
    name: 'refresh',
    kind: 'mutation',
    args: {},
    effects: ['inspect.refresh'],
    invalidates: ['inspect'],
  },
  {
    name: 'tableScan',
    kind: 'query',
    args: {},
    reads: ['tableScan'],
    readMode: 'sync',
    cacheKey: 'tableScan',
  },
  {
    name: 'loadTable',
    kind: 'mutation',
    args: {
      table: 'string',
      offset: 'number',
    },
    effects: ['tableScan.load'],
    invalidates: ['tableScan'],
  },
  {
    name: 'runResult',
    kind: 'query',
    args: {},
    reads: ['runResult'],
    readMode: 'sync',
    cacheKey: 'runResult',
  },
  {
    name: 'runFunction',
    kind: 'mutation',
    args: {
      name: 'string',
      argsText: 'string',
      userId: 'string',
    },
    effects: ['runResult.run'],
    invalidates: ['runResult'],
  },
];
