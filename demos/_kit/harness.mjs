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

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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
    skip(name, details) {
      results.push({ name, ok: false, outcome: 'skip', details: details ?? null });
      console.log(`  - ${name} (skipped)`);
    },
    finish() {
      const passed = results.filter((r) => r.ok).length;
      const skipped = results.filter((r) => r.outcome === 'skip').length;
      const failed = results.length - passed - skipped;
      const total = results.length;
      // ENG-22486: zero checks (or a short run against a declared count) can
      // never be a pass — a pre-check throw that skips the checks must fail.
      let shortfall = null;
      if (total === 0 || passed + failed === 0) {
        shortfall = 'zero checks ran';
      } else if (expectedChecks !== null && total !== expectedChecks) {
        shortfall = `ran ${total}/${expectedChecks} expected checks`;
      }
      const ok = failed === 0 && shortfall === null;
      const report = { title, passed, skipped, failed, total, ok, results };
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
//   2. runs every cleanup in reverse registration order, retaining every
//      rejection as a structured failure rather than swallowing teardown;
//   3. prints the final suite report plus a machine-readable JSON line only
//      after cleanup outcomes are known;
//   4. exits nonzero unless every declared check and cleanup passed:
//      0 = pass, 1 = check failure or short/zero run,
//      2 = setup/teardown infrastructure error.
// `cleanups` may be a live array (registered during body) — it is read at
// exit time. `reportExtra` extends the machine report but cannot override its
// core outcome fields.
export async function runAcceptance(suite, body, {
  cleanups = [],
  reportExtra = null,
  reportFile = null,
} = {}) {
  let cleanupPromise = null;
  const runRegisteredCleanups = (title) => {
    if (cleanupPromise !== null) return cleanupPromise;
    cleanupPromise = (async () => {
      const cleanupErrors = [];
      const registeredCleanups = [...cleanups];
      let cleanupOrder = 0;
      for (let registrationIndex = registeredCleanups.length - 1;
        registrationIndex >= 0;
        registrationIndex -= 1) {
        const cleanup = registeredCleanups[registrationIndex];
        try {
          await cleanup();
        } catch (error) {
          const failure = cleanupFailureReport(error, cleanup, registrationIndex, cleanupOrder);
          cleanupErrors.push(failure);
          console.error(
            `CLEANUP FAILURE ${title} [${failure.code}] `
              + `(registered ${registrationIndex}, reverse order ${cleanupOrder}): `
              + `${failure.stack ?? failure.message}`,
          );
        }
        cleanupOrder += 1;
      }
      return cleanupErrors;
    })();
    return cleanupPromise;
  };

  // @ref LLP 0175#d1--make-keep-going-dependency-aware — a gate timeout sends
  // TERM before KILL. Run the live cleanup stack during that grace so resources
  // deliberately outside the gate process group (including fork servers that
  // call setsid()) still follow their exact owner/drop lifecycle.
  let signalCleanupStarted = false;
  const signalHandlers = Object.freeze({
    SIGINT: () => beginSignalCleanup('SIGINT', 130),
    SIGTERM: () => beginSignalCleanup('SIGTERM', 143),
  });
  function beginSignalCleanup(signal, exitCode) {
    if (signalCleanupStarted) return;
    signalCleanupStarted = true;
    console.error(`[snapback-acceptance] signal cleanup: signal=${signal}`);
    void runRegisteredCleanups('interrupted acceptance run').then((cleanupErrors) => {
      if (cleanupErrors.length > 0) {
        console.error(
          `[snapback-acceptance] signal cleanup failed: signal=${signal} `
            + `failures=${cleanupErrors.length}`,
        );
      }
      process.exit(exitCode);
    });
  }
  process.on('SIGINT', signalHandlers.SIGINT);
  process.on('SIGTERM', signalHandlers.SIGTERM);

  let setupFailed = false;
  let setupError;
  try {
    await body();
  } catch (error) {
    setupFailed = true;
    setupError = error;
    console.error(`\nSETUP FAILURE before checks completed: ${error?.stack ?? error}`);
  }
  const report = suite.finish();
  if (setupFailed) {
    if (report.ok) {
      // All declared checks passed but the body still threw (e.g. teardown):
      // the summary line above says PASS, so mark the failure explicitly.
      console.error(`FAIL ${report.title} — setup/teardown error after ${report.passed}/${report.total} checks (ENG-22486)`);
    }
    report.ok = false;
    report.setupError = String(setupError?.message ?? setupError);
  }
  const cleanupErrors = await runRegisteredCleanups(report.title);
  report.cleanupErrors = cleanupErrors;
  report.cleanupErrorCount = cleanupErrors.length;
  if (cleanupErrors.length > 0) {
    report.ok = false;
    console.error(
      `FAIL ${report.title} — ${cleanupErrors.length} cleanup ` +
        `${cleanupErrors.length === 1 ? 'failure' : 'failures'} after ${report.passed}/${report.total} checks`,
    );
  }
  const machineReport = reportExtra === null ? report : { ...reportExtra, ...report };
  if (reportFile !== null) writeMachineReport(reportFile, machineReport);
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify(machineReport));
  process.removeListener('SIGINT', signalHandlers.SIGINT);
  process.removeListener('SIGTERM', signalHandlers.SIGTERM);
  process.exit(setupFailed || cleanupErrors.length > 0 ? 2 : report.ok ? 0 : 1);
}

// A retained acceptance receipt is evidence only after cleanup has completed.
// Write it atomically so interruption cannot leave a truncated file that a
// later aggregate validator mistakes for a complete run.
export function writeMachineReport(reportFile, machineReport) {
  // @ref LLP 0063#sequence — Step 0 evidence is retained only after its
  // cleanup outcome is known; required skips never become passing receipts.
  const path = String(reportFile);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(machineReport, null, 2)}\n`);
  renameSync(temporary, path);
}

function cleanupFailureReport(error, cleanup, registrationIndex, cleanupOrder) {
  const diagnostic = reportProperty(error, 'diagnostic');
  const message = reportProperty(error, 'message');
  const stack = reportProperty(error, 'stack');
  return {
    registrationIndex,
    cleanupOrder,
    name: reportProperty(cleanup, 'name') || null,
    code: reportString(
      reportProperty(error, 'code') ?? reportProperty(diagnostic, 'code') ?? 'SNAPBACK_ACCEPTANCE_CLEANUP_FAILED',
      'SNAPBACK_ACCEPTANCE_CLEANUP_FAILED',
    ),
    message: reportString(message ?? error, '<cleanup rejection could not be rendered>'),
    stack: typeof stack === 'string' ? stack : null,
    diagnostic: reportValue(diagnostic),
    details: reportValue(reportProperty(error, 'cleanup')),
  };
}

function reportProperty(value, key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}

function reportString(value, fallback) {
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

// Keep a cleanup's structured details useful when they are ordinary JSON, but
// never let a circular diagnostic or BigInt turn reporting itself into a
// second teardown failure.
function reportValue(value) {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return reportString(value, '<unserializable cleanup detail>');
  }
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

// Phase 1 (LLP 0200): in served mode, live fan-out runs on a scheduler off
// the commit turn, so mutation settlement no longer implies the subscription
// frames are already drainable. Re-run `assertion` (sync or async) until it
// stops throwing or the budget lapses; the last failure is rethrown with the
// label so the timeout names the convergence it was waiting on.
export async function eventually(assertion, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await assertion();
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(`${label ?? 'eventually'} (after ${timeoutMs}ms): ${error?.message ?? error}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
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
