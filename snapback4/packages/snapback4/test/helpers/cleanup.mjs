import { withHangGuard } from './wait.mjs';

// A rejecting finally would replace the body's error. Report it before cleanup
// starts: a native test timeout can hide even a later successful cleanup's return.
export async function withCleanup(body, after) {
  let value, bodyError, bodyFailed = false;
  try { value = await body(); } catch (error) {
    bodyFailed = true; bodyError = error;
    console.error('TEST_BODY:', error);
  }
  try { await after(); } catch (error) {
    if (!bodyFailed) throw error;
    // Report separately too: reporters need not render attached cleanup errors.
    console.error('TEST_CLEANUP_AFTER_BODY:', error);
    try {
      if (bodyError !== null && (typeof bodyError === 'object' || typeof bodyError === 'function')) {
        if (bodyError.cleanupErrors === undefined) Object.defineProperty(bodyError, 'cleanupErrors', {
          value: [], enumerable: true, configurable: true, writable: true,
        });
        if (Array.isArray(bodyError.cleanupErrors)) bodyError.cleanupErrors.push(error);
      }
    } catch { /* Frozen/custom errors keep their identity; diagnostics above retain both failures. */ }
  }
  // Preserve class, code, comparison fields, stack and any pre-existing cause,
  // including through nested helpers. The flag also handles `throw undefined`.
  if (bodyFailed) throw bodyError;
  return value;
}

// Node's test timeout does not bound an after hook or cancel an awaited
// finally block. Give cleanup its own guard and preserve the refusal/logs.
export async function cleanup(work, label, diagnostics = () => '', children = []) {
  try {
    return await withHangGuard(work, `cleanup: ${label}`);
  } catch (error) {
    let detail;
    try { detail = diagnostics(); }
    catch (failure) { detail = `diagnostics failed: ${failure.message}`; }
    const message = `TEST_CLEANUP: ${label}: ${error.message}\n${detail}`;
    // Node can retain the body's timeout as its sole reported error and hide
    // the after-hook rejection. Keep the cleanup diagnosis visible either way.
    console.error(message);
    throw new Error(message, { cause: error });
  } finally {
    // A stuck child must not keep the failed file alive through its handles.
    // EOF still asks a watchdog to clean its own group: never kill that owner
    // or signal descendants here, including after the guard has fired.
    for (const child of children) {
      child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy();
      child.unref();
    }
  }
}
