// Narrow declaration projection for the prepared React-binding owner. This
// subpath lets framework adapters depend on admission without reaching the
// root barrel's optional command and asset clients.
import type { SnapbackClient } from './index.mjs';

export {
  abandonConsumedReactQueryGroup,
  activeReactBindingDeploymentIdentity,
  admittedReactCommand,
  admittedReactEphemeralDefinition,
  admittedReactQueryGroup,
  admittedReactReference,
  admittedReactSurface,
  assertPreparedReactBinding,
  classifyRegeneratedReactReference,
  consumePreparedReactQueryGroup,
  handoffPreparedReactBindingGeneration,
  isPreparedReactQueryGroup,
  prepareReactQueryGroupForBinding,
  preparedReactBindingClient,
  preparedReactResultContract,
} from './index.mjs';

export function prepareReactBindingForClient(
  client: SnapbackClient,
  options?: Parameters<SnapbackClient['prepareReactBinding']>[0],
): Promise<import('./index.mjs').PreparedReactBinding>;

export type {
  PreparedReactBinding,
  PreparedReactEphemeralDefinition,
  PreparedReactQueryGroup,
  QueryGroupParams,
  RegeneratedReferenceGeneration,
} from './index.mjs';
