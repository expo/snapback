// Shared with Node 24 proof scripts: explicit .ts imports work in Node and bundlers.
export type ListFilter = "all" | "open" | "done";
export function matchesFilter(done: boolean, filter: ListFilter): boolean {
  return filter === "all" || (filter === "done" ? done : !done);
}

export function prepareTitle(value: string): string {
  return value.trim();
}
