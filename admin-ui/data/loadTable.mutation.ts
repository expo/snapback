// `use loadTable from "./data/loadTable.mutation.ts"` — fetch a page of a table
// and republish it to the `tableScan` boundary key. Modeled as a mutation
// because it republishes reactive state. Live function from the admin bridge.

import { getAdminLinks } from './runtime-links';

export const descriptor = 'loadTable';
export type LoadTableArgs = { table: string; offset: number };

export function loadTable(args: LoadTableArgs) {
  return getAdminLinks().loadTable(args);
}
