// Tiny dependency-free test harness with machine-readable output.
//
// @ref LLP 0010#diagnostic-shape — results are structured (stable name, ok,
//   details), not prose an agent must scrape. Also bans setTimeout/sleep in checks:
//   the server's drain seam is synchronous-on-demand, so no test needs to sleep.
//
// Vacuous-pass guard (ENG-22486): a run that performs zero checks — or fewer
// than the suite declares via `expectedChecks` — is a harness failure, not a
// pass. `finish()` never reports ok on 0/0, and `runAcceptance()` surfaces a
// thrown setup error (with stack) instead of letting a `finally`-style
// process.exit swallow it into a green exit.

export function createSuite(title, { expectedChecks = null } = {}) {
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
      const total = results.length;
      // ENG-22486: zero checks (or a short run against a declared count) can
      // never be a pass — a pre-check throw that skips the checks must fail.
      let shortfall = null;
      if (total === 0) {
        shortfall = 'zero checks ran';
      } else if (expectedChecks !== null && total !== expectedChecks) {
        shortfall = `ran ${total}/${expectedChecks} expected checks`;
      }
      const ok = passed === total && shortfall === null;
      const report = { title, passed, total, ok, results };
      if (expectedChecks !== null) report.expectedChecks = expectedChecks;
      if (shortfall !== null) report.shortfall = shortfall;
      console.log(`\n${ok ? 'PASS' : 'FAIL'} ${title} — ${passed}/${total}`);
      if (shortfall !== null) {
        console.error(`FAIL ${title} — ${shortfall} (vacuous-pass guard, ENG-22486)`);
      }
      return report;
    },
  };
}

// Shared acceptance-runner tail (ENG-22486). Runs `body`, then always:
//   1. surfaces a thrown setup/teardown error with its stack (never swallowed
//      by the exit path);
//   2. prints the suite report plus a machine-readable JSON line;
//   3. runs cleanups best-effort in reverse registration order;
//   4. exits nonzero unless every declared check ran and passed:
//      0 = pass, 1 = check failure or short/zero run, 2 = setup error.
// `cleanups` may be a live array (registered during body) — it is read at
// exit time. `reportExtra` merges extra fields into the machine report.
export async function runAcceptance(suite, body, { cleanups = [], reportExtra = null } = {}) {
  let setupError = null;
  try {
    await body();
  } catch (error) {
    setupError = error;
    console.error(`\nSETUP FAILURE before checks completed: ${error?.stack ?? error}`);
  }
  const report = suite.finish();
  if (setupError !== null) {
    if (report.ok) {
      // All declared checks passed but the body still threw (e.g. teardown):
      // the summary line above says PASS, so mark the failure explicitly.
      console.error(`FAIL ${report.title} — setup/teardown error after ${report.passed}/${report.total} checks (ENG-22486)`);
    }
    report.ok = false;
    report.setupError = String(setupError?.message ?? setupError);
  }
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify(reportExtra === null ? report : { ...report, ...reportExtra }));
  for (const cleanup of [...cleanups].reverse()) {
    try {
      await cleanup();
    } catch {
      /* best-effort teardown */
    }
  }
  process.exit(setupError !== null ? 2 : report.ok ? 0 : 1);
}

// ENG-22655: the Exact-importing regression suites load the Contract runtime,
// whose `.js`-suffixed TypeScript imports (e.g. `./signals.js` resolving to
// `signals.ts`) resolve ONLY under bun. Run under plain `node` they crash deep
// in a dynamic import with a cryptic `ERR_MODULE_NOT_FOUND: Cannot find module
// '.../signals.js'`. Call this as the first statement of such a suite so the
// wrong-runtime failure is self-explanatory — a clear "run under bun" message
// and a distinct nonzero exit (3), never a module-resolution stack trace.
// `label` names the suite in the message.
export function requireBunRuntime(label) {
  if (typeof process === 'undefined' || process.versions?.bun) return;
  const script = process.argv?.[1] ?? 'demos/_kit/tests/<this-test>.mjs';
  const runtime = process.versions?.node ? `node v${process.versions.node}` : 'a non-bun runtime';
  console.error(
    [
      '',
      `SNAPBACK_KIT_REQUIRES_BUN: ${label} imports the Exact Contract runtime,`,
      "whose .js-suffixed TypeScript imports resolve only under bun. You ran it",
      `under ${runtime}, which cannot resolve Exact's .ts modules and would`,
      'otherwise crash with a cryptic ERR_MODULE_NOT_FOUND. Re-run it with bun:',
      '',
      `    bun ${script}`,
      '',
    ].join('\n'),
  );
  process.exit(3);
}

export function assert(cond, message) {
  if (!cond) throw new Error(message);
}

export function assertEqual(actual, expected, message) {
  const a = stableStringify(actual);
  const e = stableStringify(expected);
  if (a !== e) throw new Error(`${message ?? 'mismatch'}: expected ${e}, got ${a}`);
}

// ENG-22658: compare by canonical (sorted-key) JSON so two deeply-equal objects
// that differ only in key insertion order are equal. Arrays keep their order —
// element order is meaningful — while object keys are sorted at every depth.
// Every other JSON.stringify semantic is unchanged, so this fixes the key-order
// paper cut without changing what counts as equal in any other way. The
// replacer returns a reordered object for each plain object; JSON.stringify then
// recurses into it, so the canonicalization propagates to every nesting level.
function stableStringify(value) {
  return JSON.stringify(value, (_key, val) =>
    (val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]]))
      : val));
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
