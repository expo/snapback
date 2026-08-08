# `verify-local-proof` can pass green while silently skipping gates (shared selection file + grep-status conflation)

**Opened:** 2026-08-08 · **Severity:** P2 (fail-open gate under the repo's own documented concurrency) · **Area:** scripts / proof

## What

`scripts/verify-local-proof:59, 79-80, 91`

```sh
PROOF_SELECTED_GATES="$ROOT/target/proof/local-proof-selected-gates.txt"  # fixed, NOT env-overridable
run() { ... if grep -Fqx -- "$gate_id" "$PROOF_SELECTED_GATES"; then proof_gate "$@"; else proof_not_selected ...; }
```

Unlike the results paths, the selection file is a fixed shared path under
`target/`. `run()` cannot distinguish "gate not selected" from "selection file
missing/unreadable/foreign" — any `grep` non-match (including exit ≥2 on a
vanished file) routes to `proof_not_selected`.

## Failure scenario

CLAUDE.md documents many concurrent agent sessions in this checkout. (a) A
concurrent `cargo clean` removes `target/proof/`, or (b) a second
`verify-local-proof --affected X` overwrites the file mid-run of a `--complete`
proof. Every remaining gate then becomes NOT_SELECTED and `proof_runner_finish`
prints "all selected gates passed (N not selected)" with **exit 0** — a
green proof that ran a fraction of its gates. This is a live fail-open, not
theoretical.

## Fix

Write the selection to a run-unique path (`mktemp` or `$$`-suffixed, honoring an
env override like the results paths already do), and make `run()` treat `grep`
exit ≥2 or a missing selection file as a **hard error**, not "not selected".

## Confidence

High — the fixed path and grep-status conflation are verifiable in the script,
and the results paths being namespaceable shows the omission is inconsistency,
not intent.
