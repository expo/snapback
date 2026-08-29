// Static React core composition: provider, queries, mutations (including the
// provider-owned optimistic-create projection), presence, and outbox. The
// package root remains the compatibility composition that adds generated
// surfaces, command tasks, and asset projections.
// @ref LLP 0114#prepared-binding-and-provider-ownership — both public entries
// construct the same provider/store owner; this entry only narrows capability
// reachability.
export {
  REACT_QUERY_CONSUMER_CEILING,
  REACT_QUERY_STORE_CEILING,
  REACT_SERVER_SUBSCRIPTION_CEILING,
  REACT_VIEW_SUBSCRIPTION_WARNING_BUDGET,
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
  useSnapbackAuthorityMutation,
  useSnapbackAuthorityMutationStatus,
  useSnapbackAuthorityMyRole,
  useSnapbackAuthorityRoster,
  useSnapbackConnection,
  useSnapbackDiagnostics,
  useSnapbackMutation,
  useSnapbackActivityPresence,
  useSnapbackAuth,
  useSnapbackOptimisticCreate,
  useSnapbackOutbox,
  useSnapbackPresence,
  useSnapbackCurrentPrincipal,
  useSnapbackQueries,
  useSnapbackQuery,
  useSnapbackSettledMutation,
} from './implementation.mjs';
