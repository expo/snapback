import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

export function createNodeSqliteNamespace(directory) {
  return Object.freeze({
    async openDatabaseAsync(name, options) {
      if (options?.useNewConnection !== true) {
        throw new TypeError('qualification adapter requires useNewConnection:true');
      }
      const database = new DatabaseSync(path.join(directory, name), {
        timeout: 0,
      });
      return Object.freeze({
        async execAsync(sql) { database.exec(sql); },
        async runAsync(sql, ...parameters) { return database.prepare(sql).run(...parameters); },
        async getFirstAsync(sql, ...parameters) {
          return database.prepare(sql).get(...parameters) ?? null;
        },
        async getAllAsync(sql, ...parameters) { return database.prepare(sql).all(...parameters); },
        async closeAsync() { database.close(); },
      });
    },
  });
}

