export async function openDatabaseAsync(name, options) {
  return globalThis.__snapbackExpoSqlite(name, options);
}
export const defaultDatabaseDirectory = "file:///documents/SQLite";
