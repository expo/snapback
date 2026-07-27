// Keep the local app typecheck at the public package boundary. Exact 0.1.6
// publishes TypeScript sources rather than declaration-only consumer types;
// published-runtime.d.mts describes only the surface this app consumes.
export {
  createBoundaryContractDataProvider,
  createContractMockQueryBoundary,
  createProviderQueryHandle,
  mount,
  reset,
} from '@exact/contract/runtime';
export { installContractWebHost } from '@exact/renderer/web-host';
export { SnapbackClient } from '../../../../packages/snapback-client/online.mjs';
export {
  createOnlineSnapbackContractSurface,
} from '../../../../packages/snapback-contract/online-surface.mjs';
