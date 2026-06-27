// `use runFunction from "./data/runFunction.mutation.ts"` — run a generated
// query/mutation through the admin API and republish the shaped result. Live
// function from the admin bridge.

import { getAdminLinks } from './runtime-links';

export const descriptor = 'runFunction';
export type RunFunctionArgs = { name: string; argsText: string; userId: string };

export function runFunction(args: RunFunctionArgs) {
  return getAdminLinks().runFunction(args);
}
