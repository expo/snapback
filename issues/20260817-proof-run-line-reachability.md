# Static proof inventory accepts unreachable `run` declarations

**Filed:** 2026-08-17 · **Status:** Open · **Systems:** Verification, Proof runner

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
