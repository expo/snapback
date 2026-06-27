// `use deleteTodo from "./data/deleteTodo.mutation.ts"` target.
//
// @ref LLP 0015#contractexact — delete goes through the generated Snapback
// mutation descriptor so the Contract surface remains a consumer of backend
// facts rather than owning a separate todo model.

import { getSnapbackContractLinks } from './runtime-links';

export const descriptor = 'deleteTodo';
export type DeleteTodoArgs = { id: string };

export function deleteTodo(args: DeleteTodoArgs) {
  return getSnapbackContractLinks().deleteTodo(args);
}
