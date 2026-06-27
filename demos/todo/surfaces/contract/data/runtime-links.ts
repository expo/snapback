// Runtime link slot for the browser-hosted Contract surface.
//
// The .contract module is compiled by Exact's Vite plugin, which imports the
// generated query/mutation binding modules directly. The live Snapback bridge is
// bootstrapped by main.ts after the server is ready, so those bindings delegate
// through this configured slot instead of owning a separate store.

export interface TodoContractLinks {
  listTodos(args: Record<string, never>): unknown;
  createTodo(args: { title: string }): unknown;
  setCompleted(args: { id: string; completed: boolean }): unknown;
  deleteTodo(args: { id: string }): unknown;
}

let links: TodoContractLinks | null = null;

export function configureSnapbackContractLinks(next: TodoContractLinks): void {
  links = next;
}

export function getSnapbackContractLinks(): TodoContractLinks {
  if (!links) {
    throw new Error('Snapback Contract links were used before the browser bridge was configured.');
  }
  return links;
}
