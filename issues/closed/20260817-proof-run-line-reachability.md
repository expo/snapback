# Static proof inventory accepts unreachable `run` declarations

**Filed:** 2026-08-17 · **Status:** Closed · **Systems:** Verification, Proof runner

## Problem

The canonical proof's static gate inventory accepts a syntactically valid
`run` declaration even when shell control flow makes that declaration
unreachable. For example, wrapping an inventory gate in the following guard
allows the scripts-test inventory to pass without ever invoking the gate:

```bash
if false; then
    run probe-fixtures -- node --test scripts/probe.test.mjs
fi
```

`scripts/check-local-proof-gates.mjs` joins physical lines and
`parseGateCalls` recognizes the guarded line, so inventory consumers conclude
that `scripts/probe.test.mjs` has a canonical runner. At execution time Bash
skips the block.

The proof runner does not close the gap at termination. `proof_gate` increments
`PROOF_SELECTED_INDEX` for each selected gate that is actually invoked and
rejects only an index greater than `PROOF_SELECTED_COUNT`.
`proof_runner_finish` summarizes the recorded gate states but does not verify
that `PROOF_SELECTED_INDEX === PROOF_SELECTED_COUNT` or that every selected
gate id was invoked. The guarded gate can therefore be absent from the result
ledger while the proof reports green.

## Scope and impact

This is a pre-existing proof-engine parser/runtime-join hole, not specific to
the scripts-test inventory. Every inventory gate that treats
`parseGateCalls` output as evidence of execution can be satisfied by an
unreachable `run` line, so the issue affects all canonical inventory gates and
the completeness promise in LLP 0175
§D2 (assign every maintained test to an explicit cadence). It also weakens the
authoritative scheduled complete-battery record described by LLP 0189 D-1,
because a selected but uninvoked gate can be missing without making the
battery red.

## Suggested acceptance

- Add a proof-runner fixture reproducing the `if false` guard and require a
  nonzero finish status.
- Make completion reconcile the selected gate-id set against the ids actually
  recorded, rather than relying only on a count.
- Keep static parsing fail-closed, but do not treat syntactic presence alone as
  runtime reachability evidence.

## Resolution

Resolved 2026-08-21 and adversarially hardened in the follow-up review-fix.
`proof_runner_init` snapshots and validates the exact selected gate-id set from
the selector's atomically materialized output, binds the parsed set to the
validated receipt's exact count and digest, rejects selected/results aliasing,
and makes that in-memory snapshot the only runtime membership authority.
`proof_runner_finish` reconciles every selected id against the runtime result
ledger and exits nonzero with the missing ids when a shell guard or other
control flow prevents a selected gate from being recorded. The public proof
entrypoint launches the proof body in a child shell and requires a private,
run-bound completion token that `proof_runner_finish` writes atomically only
after reconciliation; missing or mismatched evidence fails in the outer
parent regardless of `exit`, dynamic `exec`, or signal behavior in the child.
The verified retained token binds the selected-set and JSONL digests, and both
GitHub's scheduled report and the launchd ticket publisher require it before
consuming results.
The EXIT trap remains defense in depth. Gate commands run under `set -e` in a
subshell whose status is captured outside conditional context, so a
function-valued gate cannot turn `false; true` into PASS. Selected/results
descriptor pseudo-paths are rejected, and general alias identity is compared
through opened descriptors before results are truncated.

The proof-runner fixtures cover the original `if false; then ... fi` case and
the same inventory with the gate unguarded, dynamic `builtin`-`exec` spellings,
an early-failing function with a later successful command, symlink/hardlink
aliases, and `/dev/fd` pseudo-paths. Static `run` parsing remains unchanged and
fail-closed.

A complete-inventory reachability traversal surfaced 15 existing
host-conditioned omissions in the canonical shell: the Darwin side of the
Linux runtime-package branch and the unavailable side of the Exact/admin
branch. The review-fix separates those cases from cadence `NOT_SELECTED`: each
selected non-applicable gate now emits `INAPPLICABLE` only through a statically
declared gate/predicate pair with structured evidence checked by both the
inventory and complete-battery consumer. A repeat traversal reconciled all 172
selected ids.

**Landing SHA:** TBD
