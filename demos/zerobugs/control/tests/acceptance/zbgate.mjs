import {pathToFileURL} from 'node:url';

import {createSuite} from '../../../../_kit/harness.mjs';
import {startServer as startKitServer} from '../../../../_kit/server-process.mjs';

import {
  RECEIPT_SCHEMA_VERSION,
  redactDiagnostic,
  sha256File,
  writeReceipt,
} from './receipt.mjs';

// Shared Lane F gate runner. It deliberately delegates check accounting to the
// guide kit, then preserves ZB's richer PASS/GAP/FAIL/MISSING vocabulary in the
// immutable receipt.
// @ref LLP 0183#acceptance-program — gates retain exact per-check outcomes and
// never turn an unsupported or short attempt into a product claim.

export async function loadGeneratedRefs(path) {
  const absolute = String(path);
  const imported = await import(pathToFileURL(absolute).href);
  return Object.freeze({
    api: imported.default ?? imported.api ?? imported,
    path: absolute,
    sha256: await sha256File(absolute),
  });
}

/**
 * Run one gate and publish exactly one immutable receipt when at least one
 * check executed. `buildReceipt` supplies the gate-specific identities and
 * accounting; runner-owned outcome/check/cleanup/diagnostic fields win.
 */
export async function runZBGate({
  arm,
  gate,
  attempt = 'v1',
  title = `${arm} ${gate.toUpperCase()}`,
  expectedCheckIds,
  run,
  buildReceipt,
  evidenceDir,
}) {
  if (!Array.isArray(expectedCheckIds) || expectedCheckIds.length === 0) {
    throw new TypeError('runZBGate requires a nonempty expectedCheckIds array');
  }
  if (new Set(expectedCheckIds).size !== expectedCheckIds.length) {
    throw new TypeError('runZBGate expectedCheckIds must be unique');
  }
  if (typeof run !== 'function' || typeof buildReceipt !== 'function') {
    throw new TypeError('runZBGate requires run and buildReceipt functions');
  }

  const expected = new Set(expectedCheckIds);
  const observed = new Set();
  const rows = [];
  const diagnostics = [];
  const cleanups = [];
  const startedAt = new Date().toISOString();
  const suite = createSuite(title, {expectedChecks: expectedCheckIds.length});
  let setupError = null;

  const requireExpectedId = id => {
    if (!expected.has(id)) throw new Error(`ZBUGS_GATE_UNDECLARED_CHECK: ${id}`);
    if (observed.has(id)) throw new Error(`ZBUGS_GATE_DUPLICATE_CHECK: ${id}`);
    observed.add(id);
  };

  const check = async (id, action) => {
    requireExpectedId(id);
    await suite.check(id, async () => {
      try {
        const result = await action();
        const details = result ?? null;
        rows.push(Object.freeze({id, status: 'PASS', details}));
        return details;
      } catch (error) {
        const diagnostic = retainedDiagnostic(id, error);
        rows.push(Object.freeze({id, status: 'FAIL', diagnostic}));
        diagnostics.push(diagnostic);
        throw error;
      }
    });
  };

  const recordGap = (id, details) => {
    requireExpectedId(id);
    const normalized = details ?? null;
    rows.push(Object.freeze({id, status: 'GAP', details: normalized}));
    suite.skip(id, normalized);
  };

  const registerCleanup = ({label, targets = [], run: cleanup}) => {
    if (typeof label !== 'string' || label.trim() === '' || typeof cleanup !== 'function') {
      throw new TypeError('registerCleanup requires a label and run function');
    }
    if (!Array.isArray(targets)) throw new TypeError('cleanup targets must be an array');
    cleanups.push(Object.freeze({label, targets: Object.freeze([...targets]), run: cleanup}));
  };

  const startServer = async options => {
    const server = await startKitServer({port: 0, ...options});
    registerCleanup({
      label: 'Snapback server',
      targets: [{kind: 'process', id: String(server.pid ?? 'owned-child')}],
      run: () => server.stop(),
    });
    return server;
  };

  try {
    await run(Object.freeze({
      check,
      gap: recordGap,
      registerCleanup,
      startServer,
      loadGeneratedRefs,
    }));
  } catch (error) {
    setupError = error;
    const diagnostic = retainedDiagnostic('gate-runner', error);
    diagnostics.push(diagnostic);
    console.error(`\nGATE FAILURE before all checks completed: ${renderError(error)}`);
  }

  const suiteReport = suite.finish();
  const cleanupResults = [];
  for (const [reverseIndex, entry] of [...cleanups].reverse().entries()) {
    try {
      await entry.run();
      cleanupResults.push(Object.freeze({
        label: entry.label,
        status: 'PASS',
        targets: entry.targets,
        reverseIndex,
      }));
    } catch (error) {
      const diagnostic = retainedDiagnostic(`cleanup:${entry.label}`, error);
      diagnostics.push(diagnostic);
      cleanupResults.push(Object.freeze({
        label: entry.label,
        status: 'FAIL',
        targets: entry.targets,
        reverseIndex,
        diagnostic,
      }));
      console.error(`CLEANUP FAILURE ${entry.label}: ${renderError(error)}`);
    }
  }

  const byId = new Map(rows.map(row => [row.id, row]));
  const accountedRows = expectedCheckIds.map(id => byId.get(id) ?? Object.freeze({
    id,
    status: 'MISSING',
    diagnostic: Object.freeze({
      redacted: true,
      code: 'ZBUGS_GATE_CHECK_MISSING',
      message: 'declared check did not execute',
    }),
  }));
  const counts = Object.freeze({
    pass: accountedRows.filter(row => row.status === 'PASS').length,
    gap: accountedRows.filter(row => row.status === 'GAP').length,
    fail: accountedRows.filter(row => row.status === 'FAIL').length,
    missing: accountedRows.filter(row => row.status === 'MISSING').length,
  });
  const executed = accountedRows.length - counts.missing;
  const cleanupFailed = cleanupResults.some(result => result.status === 'FAIL');
  const executionFailed = setupError !== null || suiteReport.shortfall !== undefined;
  const outcome = counts.fail > 0 || counts.missing > 0 || executionFailed || cleanupFailed
    ? 'FAIL'
    : counts.gap > 0 ? 'GAP' : 'PASS';
  const completedAt = new Date().toISOString();

  const cleanup = Object.freeze({
    status: cleanupFailed ? 'FAIL' : 'PASS',
    ownership: cleanups.length === 0
      ? 'No server, socket, browser, process, credential file, or scratch target was created.'
      : 'Every resource registered through the gate runner was cleaned in reverse ownership order.',
    targets: cleanupResults.flatMap(result => result.targets),
    results: cleanupResults,
  });
  const checks = Object.freeze({
    expected: expectedCheckIds.length,
    executed,
    counts,
    rows: Object.freeze(accountedRows),
    missing: Object.freeze(accountedRows.filter(row => row.status === 'MISSING').map(row => row.id)),
    harness: Object.freeze({
      expectedChecks: suiteReport.expectedChecks,
      total: suiteReport.total,
      passed: suiteReport.passed,
      failed: suiteReport.failed,
      skipped: suiteReport.skipped,
      ok: suiteReport.ok,
      shortfall: suiteReport.shortfall ?? null,
    }),
  });
  const execution = Object.freeze({
    status: executionFailed ? 'FAIL' : 'PASS',
    setupCompleted: setupError === null,
    harnessAcceptedCount: suiteReport.shortfall === undefined,
  });

  let receiptResult = null;
  let receiptError = null;
  try {
    const gateFields = await buildReceipt(Object.freeze({
      arm,
      gate,
      attempt,
      startedAt,
      completedAt,
      outcome,
      checks,
      execution,
      cleanup,
      diagnostics: Object.freeze([...diagnostics]),
    }));
    const receipt = {
      ...gateFields,
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      arm,
      gate,
      attempt,
      startedAt,
      completedAt,
      outcome,
      checks,
      execution,
      cleanup,
      diagnostics: Object.freeze([...diagnostics]),
    };
    receiptResult = await writeReceipt(receipt, evidenceDir === undefined ? {} : {evidenceDir});
    console.log(`\nZB RECEIPT ${receiptResult.path}`);
  } catch (error) {
    receiptError = error;
    console.error(`\nRECEIPT REFUSED: ${renderError(error)}`);
  }

  console.log(
    `ZB GATE ${gate.toUpperCase()} — ${outcome} — `
      + `PASS ${counts.pass} / GAP ${counts.gap} / FAIL ${counts.fail} / MISSING ${counts.missing}`,
  );
  return Object.freeze({
    outcome,
    counts,
    checks,
    cleanup,
    receiptPath: receiptResult?.path ?? null,
    receiptSha256: receiptResult?.sha256 ?? null,
    receiptError,
    exitCode: receiptError !== null ? 2 : outcome === 'FAIL' ? 1 : 0,
  });
}

function retainedDiagnostic(id, error) {
  const candidate = error && typeof error === 'object' ? error : {message: String(error)};
  const redacted = redactDiagnostic({
    code: candidate.diagnostic?.code ?? candidate.code ?? 'ZBUGS_GATE_CHECK_FAILED',
    message: candidate.diagnostic?.message ?? candidate.message ?? String(error),
    details: candidate.diagnostic?.details ?? null,
  });
  return Object.freeze({id, redacted: true, ...redacted});
}

function renderError(error) {
  const code = error?.diagnostic?.code ?? error?.code;
  const message = error instanceof Error ? error.message : String(error);
  return code && !message.startsWith(`${code}:`) ? `${code}: ${message}` : message;
}
