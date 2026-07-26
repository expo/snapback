# Retrieval eval run — 2026-07-26 — trusted runtime values

**Protocol:** guide/retrieval-eval.md (LLP 0061 §5).
**Fixture:** fresh Codex subagent with no conversation context, cold in the
Snapback checkout at `59c86d2d`, instructed to read `AGENTS.md` first and
then plan a server-authored creation timestamp and default identifier after
`Date.now()` and `Math.random()` were rejected (read-only; no writes). The
intent also required an honest transition from existing client-authored
fields without inventing hosted or migration behavior.
**Run:** the trusted-runtime-values page was loaded at tool use 3, within the
~15-use retrieval budget. The agent then checked the capability index,
diagnostics routing, and target-honesty page.

## Rubric

- **(a) Loads the relevant guide page within ~15 tool uses: PASS.**
  `guide/index.md` was loaded at tool use 2 and
  `guide/backend/trusted-runtime-values.md` at tool use 3.
- **(b) Plans with the paved technique: PASS.** The plan uses
  `ctx.runtime.now()` and `ctx.runtime.id()`, omits server-derived fields from
  the closed operation arguments, regenerates the argument schema, relies on
  stable diagnostic codes, coordinates callers, and keeps preserved-data
  reshaping application-specific.
- **(c) Avoids the named anti-patterns: PASS.** It explicitly rejects
  client-supplied trusted fields, ambient `Date` and `Math.random`, treating a
  runtime ID as randomness, a principal, or a foreign key, reusing one ID for
  distinct records, parsing diagnostic prose, hosted generalization, and an
  invented migration or rollout workflow.

**Verdict: PASS.**

## Agent tool transcript

1. Loaded `AGENTS.md` and confirmed the guide-first instruction.
2. Loaded `guide/index.md`; the backend map exposed “Trusted runtime time and
   identifiers.”
3. Loaded `guide/backend/trusted-runtime-values.md`.
4. Checked `backend.runtime-values` in `guide/capabilities.md`.
5. Loaded `guide/operating/diagnostics.md`.
6. Loaded `guide/auth/targets.md`.

## Agent plan (retained)

1. Keep durable fields as an ordinary required integer timestamp and plain
   string identifier.
2. Remove those fields from the mutation arguments.
3. Derive them inside the handler with
   `const createdAt = ctx.runtime.now()` and
   `const generatedId = ctx.runtime.id()`.
4. Reuse one `now()` result for writes describing the same event, but call
   `id()` separately for each logical record.
5. Regenerate the closed argument schema and verify the trusted fields remain
   omitted.
6. Coordinate callers to stop sending the removed properties. Future writes
   become handler-authoritative; existing stored values may remain.
7. Reset and reseed disposable local data. If preserved data needs reshaping,
   use an application-specific authorization and acceptance plan; do not claim
   a general hosted migration or zero-downtime workflow.
8. Test the stable `BUNDLE_UNSUPPORTED_TIME` and
   `BUNDLE_UNSUPPORTED_RANDOM` codes, keeping
   `BUNDLE_UNSUPPORTED_TIMER` distinct.

Anti-patterns named by the agent: client-supplied trusted fields; leaving
trusted fields in operation arguments; `Date`, `new Date()`, or
`Math.random()`; runtime IDs as randomness, principals, or foreign keys;
reusing IDs; parsing diagnostic prose; hosted generalization; and invented
migration, backfill, or rollout behavior.
