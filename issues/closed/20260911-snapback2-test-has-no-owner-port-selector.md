# `snapback2 test` cannot be told which port its nested owner may bind

**Status:** Resolved (2026-09-11)
**Priority:** P3
**Date:** 2026-09-11
**Systems:** Snapback 2 `test` verb (`snapback2/crates/snapback2/src/verbs.rs` "test" usage, `test.rs` nested `dev --foreground --port 0`), LLP 1002, LLP 0329.016 §5.11
**Related:** [0.0.25 run](../../benchmarks/runs/2026-09-11-snapback2-0025-clique-linux/README.md); [20260829-snapback2-run-clique-m1-against-the.md](../20260829-snapback2-run-clique-m1-against-the.md) (the loop bar requires plain `snapback2 test`)

## Symptom

`snapback2 test` accepts `--project`, `--blocked`, `--journeys-only`,
`--derived-only`, `--journey` and `--json`. Its nested owner is launched as
`snapback2 dev --foreground --port 0`, so the operating system picks an
ephemeral port outside any range the operator was assigned. The receipt records
the command text, not the port that was actually bound or the owner PID.

On builder-1000 the 0.0.25 Clique builder was assigned ports 53200–53219 on a
shared host. Its final report: "The package's native test command was
discovered but not executed because its public surface did not expose an
owner-port selector within the assigned range." The fresh scorer repeated it
("the package test command lacked the required port selector", diagnostics 84).
The product's own proof verb was therefore never run in that lane; authored
suites stood in for it. The loop bar's plain `snapback2 test` requirement
inherits the same limitation on any port-constrained host.

## Requested outcome

- `snapback2 test --port N` (and, if cheap, `--port N-M` for a range), passed
  through to the nested `dev --foreground`, refusing with the existing
  `dev` occupied-port diagnostic rather than falling back to an ephemeral port.
  This is a flag on an existing verb, not a new verb, so LLP 0329.016 §5.11
  needs only its row's usage text updated.
- The `test` receipt (and `--json`) records the nested owner's bound port and
  PID next to the command list, so a shared-host operator can attribute and
  clean up exactly the process it started (`rules/RULES.md`: kill only PIDs you
  recorded at launch).
- `guide testing` names the flag in its first screen.

## Acceptance

- On a host where only one port in a stated range is free, plain
  `snapback2 test --port <that port>` runs the full suite and the receipt shows
  that port and the owner PID; with an occupied port it refuses with the `dev`
  diagnostic and no ephemeral fallback.
- Default behaviour without `--port` is unchanged; `scripts/measure.mjs`
  budgets for `test` do not regress.

## Resolution — 2026-09-11

`snapback2 test --port N` now passes the scalar port directly to its isolated
`dev --foreground` owner. An occupied port preserves `E_OWNER_PORT_TAKEN`;
there is no ephemeral fallback. The existing default remains port 0.
Receipts and JSON include `owner: { pid, port }` after ready, and command
records reflect the selected port. Startup/compile refusals omit a ready-owner
record. Help, the first screen of `guide testing`, LLP 1002 and the existing
LLP 0329.016 verb row document the flag. Ranges were optional and are not added.

Validation: the three selected/occupied/invalid-port integration regressions
pass. The selected-port case runs the full todos derived/journey suite,
checks the bound URL inside a journey, verifies the persisted receipt and
confirms the recorded owner PID has exited. Existing default-port receipt
coverage is extended without changing the default.
