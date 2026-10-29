// @ref LLP 3000.011.003.000.000#19-explicit-proof-completion-lat4 — the awaited suite, including its finally cleanup, owns completion.
import { getActiveResourcesInfo } from 'node:process';
import { setImmediate as turn } from 'node:timers/promises';

const counts = () => {
  const result = new Map();
  for (const name of getActiveResourcesInfo()) result.set(name, (result.get(name) ?? 0) + 1);
  return result;
};

/** Run one explicitly awaited finite suite and exit with its status after cleanup.
 * The callback must await every test and its cleanup. Background service entry
 * points and suites which schedule unawaited tests must not use this runner. */
export async function runProofSuite(suite) {
  // Open stdio before the baseline; report resource types/counts, never objects,
  // paths, socket endpoints, arguments or timer callback contents.
  const streams = [process.stdout, process.stderr];
  const initial = counts();
  const baseline = new Map(['PipeWrap', 'TTYWrap'].map(name => [name, Math.min(3, initial.get(name) ?? 0)]));
  // A pending promise alone does not keep Node alive (for example an awaited
  // unref timer). Keep the finite suite alive without imposing a new deadline.
  const started = Date.now();
  const running = setInterval(() => console.error(`snapback4 proof: running; ${Math.round((Date.now()-started)/1000)}s elapsed; waiting`), 5000);
  let failed = false, failure;
  try { await suite(); }
  catch (error) { failed = true; failure = error; process.exitCode = 1; }
  finally { clearInterval(running); }
  await Promise.all(streams.map(stream => new Promise(resolve => stream.write('', resolve))));
  // Let completed I/O callbacks close their handles before diagnosing residue.
  await turn();
  const lingering = [...counts()].flatMap(([name, count]) => {
    const extra = count - (baseline.get(name) ?? 0);
    return extra > 0 ? [`${name}(${extra})`] : [];
  }).sort();
  const code = failed ? 1 : process.exitCode ?? 0;
  if (lingering.length) console.error(`snapback4 proof: lingering handles after suite: ${lingering.join(', ')}; exiting with status ${code}`);
  // Exit only after the suite's complete stdout and stderr have drained.
  await Promise.all(streams.map(stream => new Promise(resolve => stream.write('', resolve))));
  if (failed) {
    // Preserve Node's ordinary uncaught rendering, including multiline error
    // messages captured by an enclosing proof. A caller/global error handler
    // may intercept the rejection; the completed suite must still terminate.
    const fallback = setImmediate(async () => {
      console.error(failure);
      await Promise.all(streams.map(stream => new Promise(resolve => stream.write('', resolve))));
      process.exit(code);
    });
    process.once('exit', () => clearImmediate(fallback));
    throw failure;
  }
  process.exit(code);
}
