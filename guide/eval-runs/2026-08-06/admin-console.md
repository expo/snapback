# Retrieval eval run — 2026-08-06 — misbehaving mutation → admin console (seed case 6)

**Protocol:** guide/retrieval-eval.md (LLP 0061 §5; seed case added by LLP
0187 T7 / LLP 0186 W2 from the 3/3 bakeoff miss in which every arm debugged
with curl and hand-written probes while the shipped console went unused).
**Fixture:** fresh Claude subagent with no inherited conversation context,
cold in the Snapback worktree checkout at `42218ccae`, instructed to read
`AGENTS.md` first and then plan (read-only) how to debug a misbehaving
mutation — inspect what it read and wrote and see current table contents —
against a running `snapback dev`.
**Run:** `guide/index.md` at tool use 2, `guide/operating/admin-console.md`
at tool use 3. Ten tool uses total.

## Rubric

- **(a) Loads the relevant guide page within ~15 tool uses: PASS.**
  `operating/admin-console.md` at tool use 3; the index's Operating section
  ("before reaching for `curl` or raw host operations") routed it directly.
- **(b) Plans with the paved technique: PASS.** Step 1 of the plan is
  `snapback admin --ready-file .snapback/dev.ready.json` — the console's
  Functions view for captured reads/writes and Data view for rows — with
  typed host-ops (`function.run`, `function.explain`/`mutationDryRun`),
  telemetry CLI, and the app CLI as the scripted follow-ons, all through
  the ready file rather than guessed ports/tokens.
- **(c) Avoids the named anti-patterns: PASS.** Raw curl against host-ops
  was considered and explicitly demoted to a scripted-reproduction fallback
  because the guide ranks the console first; direct SQLite/telemetry-table
  reads and master-token-in-URL handling were rejected citing the pages'
  anti-pattern sections. The one free raw call retained (`GET /inspect`) is
  the public projection the guide itself sanctions.

**Verdict: PASS.** The bakeoff failure mode (raw probes with the console
unused) did not reproduce; the console was the first surface named.

## Agent tool transcript

1. Read `AGENTS.md` — steered to the guide.
2. Read `guide/index.md` — Operating section named the console first.
3. Read `guide/operating/admin-console.md`.
4. Read `guide/backend/mutations.md` — result envelope, read sets, OCC codes.
5. Read `guide/operating/host-ops.md` — `function.run`, `function.explain`.
6. Read `guide/getting-started/the-authoring-loop.md` — ready file, inspect.
7. Read `guide/clients/app-cli.md`.
8. Read `guide/operating/observability.md` — telemetry events/stats.
9. Grep for the data-scan surface (first attempt failed on shell quoting).
10. Grep of `guide/surface-map.md` + `guide/capabilities.md` — confirmed
    `GET /_snapback/api/data/{table}` → `operating.admin-console`.
