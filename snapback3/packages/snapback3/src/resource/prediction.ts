// @ref LLP 2000#durable-operation-ownership — only the immutable durable FIFO
// journal contributes local query prediction; transport status never rewrites it.
import { canonicalJson } from '../../../evaluator/src/value-runtime.js';
import { checkedStoredOperation } from './operation.js';
import { FactPool, type PendingPrediction, type PredictionWork } from './facts.js';
import type { Manifest, Session, StoredOperation } from './types.js';

export interface PredictionUpdate {
  readonly changedTables: ReadonlySet<string>;
  readonly work: Readonly<PredictionWork>;
}

const emptyWork = (): PredictionWork =>
  ({ restoredRows: 0, appliedWrites: 0, predictedOperations: 0, skippedOperations: 0 });

/** Coordinates one immutable operation list across the client's directly held
 * and acquired fact pools. Pools own their reversible row overlays; this owner
 * supplies the durable FIFO and current program fence once. */
export class PendingQueryCoordinator {
  private operations: readonly PendingPrediction[] = [];
  private identity = '';
  private tables = new Set<string>();

  sync(manifest: Manifest | null, session: Session | null, journal: Iterable<StoredOperation>,
    pools: Iterable<FactPool>): PredictionUpdate {
    const indexed = [...journal].map((entry, index) => ({ entry, index }));
    indexed.sort((left, right) => {
      const a = left.entry.order ?? left.entry.createdAt;
      const b = right.entry.order ?? right.entry.createdAt;
      return a - b || left.index - right.index;
    });
    const operations: PendingPrediction[] = [];
    if (manifest && session) for (const { entry } of indexed) {
      if (entry.status !== 'queued' || entry.principal !== session.principal.id) continue;
      const body = checkedStoredOperation(entry);
      const program = manifest.programs[body.op];
      if (!program || program.kind.toLowerCase() !== 'mutation'
        || body.schemaHash !== manifest.schemaHash || body.planHash !== program.planHash) continue;
      operations.push(Object.freeze({ operationId: entry.id, op: body.op, args: body.args, createdAt: entry.createdAt }));
    }
    const identity = canonicalJson(operations);
    this.operations = Object.freeze(operations);
    const changed = identity !== this.identity;
    this.identity = identity;
    const previousTables = this.tables;
    const nextTables = new Set<string>();
    const work = emptyWork();
    for (const pool of pools) {
      const result = pool.setPending(this.operations);
      work.restoredRows += result.restoredRows;
      work.appliedWrites += result.appliedWrites;
      work.predictedOperations += result.predictedOperations;
      work.skippedOperations += result.skippedOperations;
      for (const table of pool.predictedTables) nextTables.add(table);
    }
    this.tables = nextTables;
    return { changedTables: changed
      ? new Set([...previousTables, ...nextTables])
      : new Set([...previousTables].filter(table => !nextTables.has(table))
        .concat([...nextTables].filter(table => !previousTables.has(table)))), work };
  }

  attach(pool: FactPool): PredictionWork {
    return pool.setPending(this.operations);
  }

  clear(): void {
    this.operations = []; this.identity = ''; this.tables.clear();
  }
}
