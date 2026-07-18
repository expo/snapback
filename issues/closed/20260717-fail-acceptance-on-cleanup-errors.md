# Fail acceptance runs when asynchronous cleanup fails

**Status:** Closed
**Severity:** P1
**Systems:** Acceptance testing, CI, Local server lifecycle
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Closed:** 2026-07-17
**Related:** LLP 0010 §Diagnostic Shape; LLP 0010 §Test Surfaces and Harness; ENG-24378
**Marker:** acceptance, teardown, process-lifecycle, diagnostics

The shared acceptance runner awaited cleanup callbacks in reverse order but
caught and discarded every rejection. It had already printed its
machine-readable report before teardown began and chose the process exit code
without considering cleanup. A suite whose checks all passed could therefore
exit zero even when `server.stop()` rejected with
`SNAPBACK_PROCESS_TREE_CLEANUP_FAILED`, leaving a process tree unattested or
other resources incompletely released.

**Done when:**

- Every registered cleanup is attempted in reverse order even after earlier
  cleanup failures.
- Cleanup rejections make the final report `ok: false` and force a nonzero
  process exit.
- The machine-readable report is emitted only after teardown and aggregates
  useful error codes, messages, stacks, and process-tree details.
- Caller-supplied report metadata cannot overwrite the runner's outcome or
  cleanup failures.
- A deterministic subprocess regression proves a passing check plus multiple
  asynchronous cleanup failures cannot green-pass.

## Resolution

Closed 2026-07-17. `runAcceptance` now snapshots its live cleanup stack at
exit time, awaits every entry in reverse registration order, and aggregates
each rejection into `cleanupErrors`. The final machine report is printed only
after that work, core outcome fields override `reportExtra`, and any cleanup
failure sets `ok: false`. Setup and teardown infrastructure failures share
exit code `2`; this preserves the existing acceptance-runner taxonomy and
leaves exit code `3` to the separate wrong-runtime guard.

`demos/_kit/tests/harness-cleanup-failures.mjs` runs the exit-owning harness in
a child process. It proves reverse/all cleanup execution, two retained
failures (including `SNAPBACK_PROCESS_TREE_CLEANUP_FAILED` details), an exit
status of `2`, post-cleanup report emission, and resistance to forged
`reportExtra` outcome fields. The canonical local proof now runs this
regression directly.
