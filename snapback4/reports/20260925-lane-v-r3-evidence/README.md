# Round-3 verification evidence

Commands run from `snapback4/`, with
`PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH`.

- `test-final.log`: final `scripts/test.sh`, after correcting asynchronous browser polling.
- `test.log`: first complete run, `== 0 failure(s) in 466 s`.
- `browser-awaited.log`: both real-browser files, 36 passed / 0 failed.
- `mutant-*-awaited.log`: eight final startup mutations, each exits 1 at its intended assertion. Run `SNAPBACK4_WEB_STARTUP_MUTANT=<name> node --test packages/snapback4/test/web-admission-review.test.mjs`.
- `storage-lock-repro.mjs` / `.log`: standalone counterexample to cross-tab localStorage authority validation under Web Locks. Exit 1 means the defect reproduced; it is not a passing test. It uses only synthetic session metadata.
- `storage-lock-trace.log`: the earlier minimal numeric-value handoff also read stale data on its third iteration.
- `targeted-final.log`: the earlier combined run that exposed a real stale-principal admission (`sent`), followed by two audit-count failures caused by that write. This pre-existing product problem remains open.
- `authority-stress-long.log`: 150 instrumented logout/principal/epoch interleavings did not reproduce the admission failure. This does not override the independent counterexample.
- `probe-order-trace.log`: diagnosed the test wait that returned before the restore refusal committed. No production trace instrumentation remains.
- `browser-initial.log`, `browser-r3.log`, `browser-final.log`: corrected fixture auth, restore-wait and offline-transport assertions.
- `targeted-compatibility.log`: the redundant post-sync probe introduced in development hung the existing held-probe test. `replay-fixed.log` records its correction (64 passed / 0 failed).
- `mutant-probe-restore.log`: the initial weaker restore test let the mutant survive; the final awaited check rejects it.
- `mutant-probe-restore-final.log`: also contains the intermittent same-epoch authority symptom.
- `mutant-journal-fence-qualified.log`, `mutant-probe-restore-qualified.log`: development runs before async polling was fixed; the latter also exposed cleanup masking a replacement-server setup failure. Both are superseded for mutant qualification by the `-awaited` logs.
- `browser-final-qualified.log`, `mutant-journal-fence-verified.log`: environmental five-second dev-server readiness timeouts before the client opened. No readiness timeout was changed.
- `typecheck-final.log`, `ref-check.log`: package types and reference audit.
- `review-inputs.sha256`: both review inputs checked before the final suite.

The final manifest hashes these files after logs finish. Only trailing
whitespace in log lines is normalized before committing; outcomes and numbers
are retained. See `../20260925-lane-v-r3.md` for the implementation map,
qualification limits, decisions and the stopped authorization problem.
