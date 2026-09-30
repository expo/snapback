# BN round 5 failures

- **Expected pre-fix detecting control / inherited merged-tree interaction:**
  `baseline-focused.log` exits 1 with both requested failures: more-then-drop
  records 4 against the proxy's 5, dropped-first 3 against 4. No assertion or
  implementation had been edited when this ran. Both proofs still refuse.
- **Setup command error, corrected before any test launched:** the first log
  reservation used a repository-root-relative path while already inside
  snapback4, so shell redirection reported “No such file or directory”. The
  empty report directory and base.txt were moved to the intended round5 path;
  the accidentally created empty parent directories were removed. No product
  failure, test run, receipt or source change came from that command.
- **Read-only orientation lookup misses:** initial prompt globs and a witness
  guide `.rs` path were wrong; prompts were found as lane-bn.rN.prompt.md and
  the guide as witness.md. These were corrected reads, not failed checks.

- **Artifact-audit assertion, corrected reporting assumption:** a manual check
  that the built CLI still matched round 4 failed. Cargo's integration-target
  build had rebuilt the unchanged CLI source while initial Node checks ran.
  All those tests passed; their `*-initial.log`/`.exit` files remain. Final Node
  witness/transport/focused/control checks were repeated after builds completed
  to bind stable final binary bytes. The report no longer claims byte identity
  with round 4. This was an artifact-accounting mistake, not a product/test red.

All post-fix checks exit 0, including the focused merged transport and round-3
transport control. No post-fix product, baseline or environmental test failure;
no cancellations, skipped cases, reduced workloads or increased timeouts.
The full suite was explicitly excluded and not run. No failing run was replaced
by a rerun in the qualification totals.
