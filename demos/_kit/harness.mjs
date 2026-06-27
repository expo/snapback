// Tiny dependency-free test harness with machine-readable output.
//
// @ref LLP 0010#diagnostic-shape — results are structured (stable name, ok,
//   details), not prose an agent must scrape. Also bans setTimeout/sleep in checks:
//   the server's drain seam is synchronous-on-demand, so no test needs to sleep.

export function createSuite(title) {
  const results = [];
  return {
    async check(name, fn) {
      try {
        const details = await fn();
        results.push({ name, ok: true, details: details ?? null });
        console.log(`  ✓ ${name}`);
      } catch (error) {
        results.push({ name, ok: false, error: error.message, diagnostic: error.diagnostic ?? null });
        console.log(`  ✗ ${name}\n      ${error.message}`);
      }
    },
    finish() {
      const passed = results.filter((r) => r.ok).length;
      const report = { title, passed, total: results.length, ok: passed === results.length, results };
      console.log(`\n${report.ok ? 'PASS' : 'FAIL'} ${title} — ${passed}/${results.length}`);
      return report;
    },
  };
}

export function assert(cond, message) {
  if (!cond) throw new Error(message);
}

export function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message ?? 'mismatch'}: expected ${e}, got ${a}`);
}

export async function assertThrows(fn, code, message) {
  try {
    await fn();
  } catch (error) {
    const got = error.diagnostic?.code ?? error.message;
    if (code && got !== code) throw new Error(`${message ?? 'wrong error'}: expected ${code}, got ${got}`);
    return error;
  }
  throw new Error(`${message ?? 'expected an error'}: nothing thrown (wanted ${code})`);
}
