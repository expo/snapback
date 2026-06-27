// `use tableScan from "./data/tableScan.query.ts"` — the data explorer's current
// page (a one-row collection holding the shaped scan view), republished by
// loadTable. Live function supplied by the admin bridge.

import { getAdminLinks } from './runtime-links';

export const descriptor = 'tableScan';

export function tableScan(args: Record<string, never>) {
  return getAdminLinks().tableScan(args);
}
