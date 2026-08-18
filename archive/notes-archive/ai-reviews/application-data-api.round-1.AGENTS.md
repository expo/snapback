# Review: LLP 0004 Application Data API, Round 1

**Reviewed:** 2026-06-25
**Reviewer:** Codex
**Target:** `llp/0004-application-data-api.rfc.md`

## Overall Assessment

This RFC is worth having separately from LLP 0003. The app-facing data API is
the contract agents and generated apps will use constantly; it should remain
stable even if the local server, Cloudflare target, or hosted target changes.

The proposed function-first API is directionally right: schema plus
`defineQuery`/`defineMutation`, handler code using `ctx.db`, and clients using
generated function references.

## Strengths

- It separates schema, handler, and client API layers cleanly.
- It keeps raw SQL and direct table writes out of the paved path.
- It ties the API to SQLite/Postgres portability and local-first sync without
  trying to solve those whole subsystems in this RFC.
- It includes agent feedback requirements, which is essential for this project.

## Concerns

1. The original `ctx.db` section did not distinguish read-only query handlers
   from read-write mutation handlers.
2. Query determinism needed to be explicit because reactive queries, caching,
   and replay all depend on it.
3. `ctx.auth` appeared in examples before the auth model exists.
4. Local optimistic execution and server-authoritative execution need the same
   observable data API semantics, or agents will debug phantom differences.

## Suggestions

- Keep `Status: Draft`.
- Let the first implementation stay single-table-first, but keep joins and
  relation traversal as explicit follow-on work.
- Decide soon whether query builders are mutable or immutable, because that
  affects codegen, runtime implementation, and agent predictability.
- Add machine-readable diagnostics before broadening the API surface.

## Open Questions

- What are exact null, sorting, and type-comparison semantics?
- Should `delete(id)` be idempotent?
- Should `replace(id, value)` exist in the first API?
- How early can codegen validate field names used inside handlers?
- What is the final shape of `ctx.auth`?

## Revisions Applied

- Marked concrete hook/helper names as illustrative.
- Added the auth-shape caveat.
- Split `ctx.db` into read and write contracts.
- Added query determinism and local/server execution parity requirements.
- Added generated IDs/system fields to portability rules.

The LLP process also recommends a GPT review unless this Codex review is the GPT
review wanted for this round.
