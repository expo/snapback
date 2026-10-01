// @ref LLP 3000#publication-suite-under-contention — state decides success;
// a separate, work-scaled watchdog diagnoses hangs, never product latency.
// Browser-safe: fixtures use this same helper in their Vite modules.
const schedule = globalThis.setTimeout.bind(globalThis);
const cancel = globalThis.clearTimeout.bind(globalThis);
const monotonic = performance.now.bind(performance);

// Two minutes of scheduling slack, then two seconds per operation/history.
// Callers doing bulk work pass its size, not a measured host-speed multiplier.
export const hangBudget = (work = 1) => 120_000 + Math.max(1, work) * 2000;

export async function withHangGuard(work, label = 'asynchronous work', units = 1) {
  const started = monotonic(), budget = hangBudget(units);
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
      timer = schedule(() => reject(new Error(`TEST_HANG: ${label}; ${units} work unit(s), ${Math.round(monotonic() - started)} ms elapsed, ${budget} ms guard`)), budget);
    })]);
  } finally { cancel(timer); }
}

export async function waitFor(check, label = check.toString(), { work = 1, poll, diagnostics } = {}) {
  let stopped = false;
  try {
    return await withHangGuard(async () => {
      while (!stopped) {
        const value = await check();
        if (value) return value;
        if (poll) await poll();
        else await new Promise(resolve => schedule(resolve, 10));
      }
    }, label, work);
  } catch (error) {
    if (error.message?.startsWith('TEST_HANG:') && diagnostics) error.message += `\n${diagnostics()}`;
    throw error;
  } finally { stopped = true; }
}
