# Snapback 4: Schema, catalog and change feed require no principal

Status: Open
Priority: P1
Observed: 2026-09-13
Review finding: S03
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Related: [security review](../llp/reviews/3000-security-review-20260913.md)

## Problem and reproduction

These routes call neither `principal_of` nor any other identity check:

- `GET /` — version, generation, every operation name and kind, every table and its `sync` line
- `GET /schema` — the full schema and every program's IR (read/write rules, indexes, jobs)
- `GET /api.ts` — generated TypeScript of the same
- `GET /changes?since=&wait=` — tables touched by recent commits, and a 25s long poll

A network peer with no token can map the entire backend and watch when `messages` (or any other table) is written. Combined with `use identity` guests, they can then mint a session and try the mapped mutations. Combined with CORS `*`, a browser page can do the same.

Local-first clients send `Authorization` when they have a session, but the server ignores that on these routes. A smaller unauthenticated identity advertisement (`guests` / `password`) is enough for sign-in; the IR does not need to be public.

## Acceptance

- `/schema`, `/api.ts` and `/changes` require a live session (or a documented public subset that does not include rules, IR, or per-commit table names).
- `/changes` must not be a global activity oracle for anonymous clients.
- Online and local clients still load a backend after sign-in.
- Guest/password discovery, if it stays unauthenticated, is a dedicated tiny route.

## Implementation locations

- [crates/snapback4/src/serve.rs](../snapback4/crates/snapback4/src/serve.rs)
- [packages/snapback4/src/local.ts](../snapback4/packages/snapback4/src/local.ts) (`loadBackend`)
- [packages/snapback4/src/client.ts](../snapback4/packages/snapback4/src/client.ts) (change poll)
