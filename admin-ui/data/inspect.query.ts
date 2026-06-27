// `use inspect from "./data/inspect.query.ts"` target — the admin contract's
// single read: the flattened inspect view model. The runtime function is
// supplied by the admin bridge (admin-boundary.mjs) via the configured slot.

import { getAdminLinks } from './runtime-links';

export const descriptor = 'inspect';
export type InspectArgs = Record<string, never>;

export function inspect(args: InspectArgs) {
  return getAdminLinks().inspect(args);
}
