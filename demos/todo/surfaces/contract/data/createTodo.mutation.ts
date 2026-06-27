// `use createTodo from "./data/createTodo.mutation.ts"` target.
//
// @ref LLP 0015#contractexact — Contract actions call Snapback mutations through
//   generated descriptors, without hand-written private bridge code.
//
// The runtime mutation function is supplied by the shared Snapback↔Contract
// bridge (demos/_kit/snapback-contract-boundary.mjs). This module documents the
// binding and exports the live function name the Contract Vite plugin wires into
// the app.

import { getSnapbackContractLinks } from './runtime-links';

export const descriptor = 'createTodo';
export type CreateTodoArgs = { title: string };

export function createTodo(args: CreateTodoArgs) {
  return getSnapbackContractLinks().createTodo(args);
}
