import { withHangGuard } from './wait.mjs';

// A rejecting finally would replace the body's error. Keep both objects and
// spell out both failures: native test reporters need not render .errors.
export async function withCleanup(body, after) {
  const errors = [];
  let value;
  try { value = await body(); } catch (error) { errors.push(error); }
  try { await after(); } catch (error) { errors.push(error); }
  if (errors.length === 1) throw errors[0];
  if (errors.length === 2) {
    const message = `Test body and cleanup both failed:\n${errors.map(error => error?.stack ?? String(error)).join('\n')}`;
    // An outer test timeout can hide this eventual rejection too.
    console.error(message);
    throw new AggregateError(errors, message, { cause: errors[0] });
  }
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
