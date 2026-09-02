# quarryc: branch-arm writes undercounted in the trace — check-green, runtime-red

**Opened:** 2026-08-31 · **Systems:** snapback2/packages/quarry
**Status:** reported by the Quarry benchmark lane (worked around with literal-list for-loops).

A `.q` mutation whose branches write the same table produced
`E_TRACE_SUBSET: writes to members 2 > 1` at runtime while `check` was
green — quarryc's emitted write accounting undercounts branch arms.
Certify-time and runtime must agree (loud-refusal law). Add a fixture with
per-branch writes to the quarry package tests.

**Resolved 2026-09-02 (`b2bebb49a`, LLP 1007 §5 item 2 / LLP 1004 P0-B).** The
lane that folded the Quarry front end into `packages/compiler` found the
certifier already branch-maxes mutually exclusive arm totals on `main`
(`Summary::branch` in `snapback2-core`'s certificate policy, landed after this
ticket was filed), so the 2026-08-31 emission could no longer be reproduced.
The shape is now pinned from both sides instead of re-fixed: a Quarry fixture
(`fixtures/quarry-surface`, `surface.branchWrite`) certifies at `max_rows: 1`
and a Rust engine test executes both arms at that bound
(`mutually_exclusive_branch_writes_certify_and_execute_at_the_same_bound`).
