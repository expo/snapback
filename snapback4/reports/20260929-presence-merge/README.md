# Presence merge qualification

Evidence for merging main at `398552255dab53ad9aa2e347f47bded11d65aad0`
into `sb4/presence`, reconciling the presence implementation with landed
DX and RL. The dated reconciliation entry in `snapback4/JOURNAL.md` records
the result; the requested complete conflict and behavior report is at
`/Users/ccheever/projects/snapback-sb5-program/presence-merge.final.md`.

Final evidence: `full-suite-node24.log`, `ref-check-final.log`,
`wasm-node24.log`, `dev-refusals-final.log`, `serve-refusals.log`,
`guide.log`, `presence-node24.log`, `client-reconciliation-final.log`,
`typecheck-final.log` and `build-final.log`.

Other logs retain the earlier test/setup corrections described in the
report. In particular, `full-suite.log` is the deliberately interrupted
Node 25 attempt, not qualification; `wasm.log` is the runtime-pin refusal.
The final runs explicitly select Node 24.18.0. `conflicts.txt` lists the
16 files reported by Git during the merge. No gate or budget was relaxed.
