import type { SnapbackClient } from "../types.js";

export interface WitnessControl { close(): void }

/** E2 supplies the outward control connection. This dev entry is never imported by expo. */
export function witnessControl(_client: SnapbackClient, _url: string): WitnessControl {
  throw new Error("not built");
}

import { runSqliteDriverConformance as conformance } from "../../tests/sqlite-driver.conformance.js";
import type { SqliteDriver } from "../store/sqlite-driver.js";
export function runSqliteDriverConformance(open: () => SqliteDriver | Promise<SqliteDriver>): Promise<{ journalMode: string; checks: string[] }> {
  return conformance(open);
}
