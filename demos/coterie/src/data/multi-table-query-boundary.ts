import type {
  ContractQueryBoundary,
  ContractQueryHandle,
  ContractQuerySubscription,
} from '@exact/contract/runtime';

export interface MultiTableContractQueryBoundary extends ContractQueryBoundary {
  queryTables<Row>(
    tables: readonly string[],
    read: () => readonly Row[],
    options?: { key?: string },
  ): ContractQueryHandle<Row>;
}

/**
 * Adds honest multi-table invalidation to Exact's deliberately coarse mock
 * boundary. The memory provider remains a test/development adapter; product
 * providers implement the same declared read sets in their own query engine.
 */
export function withMultiTableQueries(
  base: ContractQueryBoundary,
): MultiTableContractQueryBoundary {
  const dependencies = new WeakMap<object, readonly string[]>();

  const boundary: MultiTableContractQueryBoundary = {
    openStore: () => base.openStore(),
    query: (table, read, options) => base.query(table, read, options),
    queryTables<Row>(tables: readonly string[], read: () => readonly Row[], options?: { key?: string }) {
      if (tables.length === 0) throw new Error('A multi-table query requires at least one table.');
      const handle: ContractQueryHandle<Row> = {
        __exactContractQuery: true,
        table: tables[0]!,
        key: options?.key,
        read: () => [...read()],
        subscribe(notify) {
          return boundary.subscribe(handle, notify);
        },
      };
      dependencies.set(handle, [...new Set(tables)]);
      return handle;
    },
    subscribe<Row>(handle: ContractQueryHandle<Row>, notify: (rows: readonly Row[]) => void) {
      const tables = dependencies.get(handle);
      if (!tables) return base.subscribe(handle, notify);

      let current = handle.read();
      let disposed = false;
      notify(current);
      const subscriptions = tables.map((table) => {
        let priming = true;
        const tableHandle = base.query(table, (rows) => rows, {
          key: `${handle.key ?? handle.table}:dependency:${table}`,
        });
        const subscription = base.subscribe(tableHandle, () => {
          if (priming || disposed) return;
          current = handle.read();
          notify(current);
        });
        priming = false;
        return subscription;
      });
      return {
        get current() {
          return current;
        },
        dispose() {
          disposed = true;
          subscriptions.forEach((subscription) => subscription.dispose());
        },
      } satisfies ContractQuerySubscription<Row>;
    },
    write: (table, apply) => base.write(table, apply),
    snapshot: (table) => base.snapshot(table),
    notificationCount: (table) => base.notificationCount(table),
  };

  return boundary;
}

export function queryAcrossTables<Row>(
  boundary: ContractQueryBoundary,
  tables: readonly string[],
  read: () => readonly Row[],
  options?: { key?: string },
): ContractQueryHandle<Row> {
  return (boundary as MultiTableContractQueryBoundary).queryTables(tables, read, options);
}
