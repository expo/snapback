import { nodeSqliteDriver, sqliteRangeStore } from "../dist/sqlite-test.mjs";

export function sqliteFactory(path: string, options = {}) {
  return sqliteRangeStore(() => nodeSqliteDriver(path), options);
}

export async function sqliteKeys(path: string, partition = "dev:alice"): Promise<string[]> {
  const driver = nodeSqliteDriver(path);
  try {
    return (await driver.all<{ key: string }>("SELECT key FROM bytes WHERE partition = ?", [partition]))
      .map(({ key }) => JSON.parse(key)[0]).sort();
  } finally { await driver.close(); }
}
