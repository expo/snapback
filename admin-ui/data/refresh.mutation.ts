// `use refresh from "./data/refresh.mutation.ts"` target — re-reads the admin
// contract and republishes it to the reactive boundary. Modeled as a mutation
// because it republishes the `inspect` view; the live function is supplied by
// the admin bridge (admin-boundary.mjs).

import { getAdminLinks } from './runtime-links';

export const descriptor = 'refresh';

export function refresh() {
  return getAdminLinks().refresh();
}
