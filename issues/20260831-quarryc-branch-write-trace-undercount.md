# quarryc: branch-arm writes undercounted in the trace — check-green, runtime-red

**Opened:** 2026-08-31 · **Systems:** snapback2/packages/quarry
**Status:** reported by the Quarry benchmark lane (worked around with literal-list for-loops).

A `.q` mutation whose branches write the same table produced
`E_TRACE_SUBSET: writes to members 2 > 1` at runtime while `check` was
green — quarryc's emitted write accounting undercounts branch arms.
Certify-time and runtime must agree (loud-refusal law). Add a fixture with
per-branch writes to the quarry package tests.
