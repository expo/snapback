// `use runResult from "./data/runResult.query.ts"` — the function runner's last
// result (a one-row collection), republished by runFunction.

import { getAdminLinks } from './runtime-links';

export const descriptor = 'runResult';

export function runResult(args: Record<string, never>) {
  return getAdminLinks().runResult(args);
}
