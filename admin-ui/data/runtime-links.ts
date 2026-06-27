// Runtime link slot for the admin Contract console.
//
// The .contract module's `use ... from "./data/*.ts"` targets delegate through
// this configured slot. main.ts bootstraps the live admin bridge after the
// admin API is reachable and calls configureAdminLinks(surface.links).

export interface AdminLinks {
  inspect(args: Record<string, never>): unknown;
  refresh(): Promise<void> | void;
  tableScan(args: Record<string, never>): unknown;
  loadTable(args: { table: string; offset: number }): Promise<void> | void;
  runResult(args: Record<string, never>): unknown;
  runFunction(args: { name: string; argsText: string; userId: string }): Promise<void> | void;
}

let links: AdminLinks | null = null;

export function configureAdminLinks(next: AdminLinks): void {
  links = next;
}

export function getAdminLinks(): AdminLinks {
  if (!links) {
    throw new Error('Admin Contract links were used before the bridge was configured.');
  }
  return links;
}
