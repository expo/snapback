// Type declarations for online.mjs — the narrow Online-client entry for
// browser bundles that need the shared transport but not optional
// agent-custody or external-store exports.

export {
  SnapbackClient,
  bindSnapbackAppLifecycle,
  createExternalSessionClient,
} from './index.mjs';
export type { SnapbackClientOptions } from './index.mjs';
