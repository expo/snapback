// `use setCompleted from "./data/setCompleted.mutation.ts"` target.
//
// @ref LLP 0015#contractexact — completion state is changed through the shared
// Snapback mutation descriptor, not by a private Contract-side todo store.

import { getSnapbackContractLinks } from './runtime-links';

export const descriptor = 'setCompleted';
export type SetCompletedArgs = { id: string; completed: boolean };

export function setCompleted(args: SetCompletedArgs) {
  return getSnapbackContractLinks().setCompleted(args);
}
