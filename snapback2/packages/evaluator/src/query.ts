// @ref LLP 1018.008.007.002#10-receipt-groups-and-the-full-application-client — actual validated Quarry execution
// can read a durable snapshot without hydrating a second evaluator row pool.
import { EvalError, fail } from './errors';
import { Runner } from './runner';
import { driveAsync, uncoveredSites, type QueryHost } from './query-work';
import { clone, validateInputs } from './value-runtime';
import { SearchExecution } from './search-runtime';
import type { Context, LocalExecution, Value } from './types';

export type { QueryHost, QueryCursor, QueryDirectory, Awaitable } from './query-work';

/** The caller owns an immutable admitted schema/program and one read snapshot
 * through resolution. All rows and authority evidence come from that snapshot;
 * this function neither opens a carrier nor catches storage failures as absence. */
export async function executeQuery(host: QueryHost, schema: any, program: any, context: Context,
  certificate: any, search = new SearchExecution()): Promise<LocalExecution> {
  if (program.kind !== 'Query') fail('E_INPUT', 'asynchronous execution requires a query');
  context = clone(context);
  validateInputs(schema, program, context.args);
  const runner = new Runner(host, schema, context, certificate, search);
  let execution;
  try { execution = await runner.executeAsync(program); }
  catch (error) {
    if (error instanceof EvalError) {
      error.trace = runner.trace;
      error.partialSites = await driveAsync(uncoveredSites(host, schema, runner.trace,
        runner.coverageMisses(), program, search, context.viewer));
    }
    throw error;
  }
  const partialSites = await driveAsync(uncoveredSites(host, schema, execution.trace,
    runner.coverageMisses(), program, search, context.viewer));
  if (partialSites.length) execution.next = null;
  return { state: partialSites.length ? 'partial' : 'fresh', partialSites, execution };
}

/** The same tri-state rule check used by the in-memory held directory. */
export function readQueryAuthority(host: QueryHost, schema: any, context: Context, table: string,
  row: Value, scopeFields?: string[]): Promise<boolean | null> {
  return new Runner(host, schema, context, null).readAuthorityAsync(table, row, scopeFields);
}
