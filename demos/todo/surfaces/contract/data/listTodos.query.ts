// `use listTodos from "./data/listTodos.query.ts"` target.
//
// @ref LLP 0015#contractexact — the Contract surface consumes generated Snapback
//   query descriptors; it must not own a separate todo store or ad hoc bridge.
//
// The runtime factory is supplied by the shared Snapback↔Contract bridge
// (demos/_kit/snapback-contract-boundary.mjs), which reads this descriptor from
// the generated contract-data manifest. This module documents the binding and
// exports the live function name the Contract Vite plugin wires into the app.

import { getSnapbackContractLinks } from './runtime-links';

export const descriptor = 'listTodos';
export type ListTodosArgs = Record<string, never>;

export function listTodos(args: ListTodosArgs) {
  return getSnapbackContractLinks().listTodos(args);
}
