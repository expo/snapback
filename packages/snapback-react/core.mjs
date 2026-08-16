// Static React core composition: provider, queries, mutations (including the
// provider-owned optimistic-create projection), presence, and outbox. The
// package root remains the compatibility composition that adds generated
// surfaces, command tasks, and asset projections.
// @ref LLP 0114#prepared-binding-and-provider-ownership — both public entries
// construct the same provider/store owner; this entry only narrows capability
// reachability.
export {
  SnapbackQueuedMutationError,
  createSnapbackReactCoreProvider as createSnapbackReactProvider,
  invokeSnapbackMutation,
  observeSnapbackOptimisticCreate,
  observeSnapbackDiagnostics,
  observeSnapbackOutbox,
  observeSnapbackPresence,
  observeSnapbackQueries,
  projectRecordFields,
  skip,
  SnapbackCoreProvider as SnapbackProvider,
  useEphemeralRepublisher,
  useSnapbackConnection,
  useSnapbackDiagnostics,
  useSnapbackMutation,
  useSnapbackActivityPresence,
  useSnapbackOptimisticCreate,
  useSnapbackOutbox,
  useSnapbackPresence,
  useSnapbackQueries,
  useSnapbackQuery,
  useSnapbackSettledMutation,
} from './implementation.mjs';
