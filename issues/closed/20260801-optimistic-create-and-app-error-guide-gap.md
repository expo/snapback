# guide-gap: optimistic create and actionable application errors need a paved React pattern

**Opened:** 2026-08-01 · **Resolved:** 2026-08-08
**Severity:** P2
**Systems:** Guide, React client, Optimistic mutations, Generated IDs, Diagnostics
**Governing:** LLP 0061, LLP 0107, LLP 0133, LLP 0155

## Original problem

The Zero bakeoff exposed two adjacent authoring cases without a paved example:

1. a create whose canonical row ID is server-minted could not safely forge a
   complete generated row; and
2. a domain rejection needed stable product copy without parsing handler text.

## Resolution

The error half landed first: declared `refusals` plus `ctx.refuse` now surface
`SNAPBACK_APP_REFUSAL` with stable `appCode`/`appDetails`, documented in the
mutation and React guides.

The server-minted-ID half is now taught by
`guide/recipes/optimistic-create.md`, transcluded from the executable
Contention Calendar shipping arm and retained rung-2 acceptance. The shipped
framework-neutral path authors one generated `Insert` IR, projects a typed
provisional identity from durable `clientMutationId`, preserves the branded
canonical id for authoritative rows only, consumes LLP 0133's logical-mint
`idMap`, and proves one intent/one canonical row after response loss and replay.
Capability `clients.optimistic-mutation-view` records that shipped substrate.

The original acceptance is therefore satisfied for a Guide-led React demo,
but not by pretending this is a provider hook. The remaining ergonomic request
— a provisional row directly in the canonical `useSnapbackQuery` store through
a first-class React API — is narrowed to
`issues/20260808-first-class-react-optimistic-create.md` and remains the
design-only `clients.optimistic-create` GAP.

## Evidence

- `demos/zero-bakeoff/apps/contention-calendar/snapback/src/App.tsx`
- `tests/acceptance/contention-calendar-rung2-v1.mjs`
- `tests/acceptance/fixtures/contention-calendar/rung2-exit.2026-08-04.r1.v1.json`
- `diaries/0044-contention-calendar-zero-bakeoff.diary.md`
- `guide/recipes/optimistic-create.md`

## Original suggested resolution and acceptance

- Add a CI-verified optimistic-create example with a client intent ID,
  server-minted canonical ID, typed provisional presentation, success mapping,
  and rollback.
- Document when an app-local pending sidecar is the correct current pattern.
- Add a safe, structured application-error example that survives optimistic
  rollback without exposing internal exception text.
- Link both examples from the React optimistic-mutation guide and capability
  index; record an explicit GAP row if the first-class API does not yet exist.

The ticket's acceptance required a clean Guide-led React demo without a forged
generated id, per-attempt rejection removal with a stable application code,
one-intent/one-row ambiguous settlement, and Guide/capability checks. The
resolution above satisfies that scope through the lower-level shipped view and
splits the provider ergonomics honestly.

## Historical running log

- **2026-08-04 — interaction with the new replay advisory (LLP 0107
  replay-safety affordances).** The development replay-divergence advisory
  landed by
  `issues/closed/20260804-optimistic-projection-replay-lint-and-helpers.md`
  checks reducer idempotence over its own output. An append-shaped
  optimistic-create reducer is replay-safe over authority but not idempotent
  over its own output, so it trips the advisory. The first-class follow-up must
  teach the advisory the paved insert shape; authors should not ignore it.
- **2026-08-07 — docs-only honest part absorbed.** The React guide documented
  branded-id refusal, the intent-keyed pending sidecar, and structured
  `refusals`/`ctx.refuse` application errors. Capability
  `clients.optimistic-create` remained an explicit GAP pending a CI-verified
  one-intent/one-row demo.
- **2026-08-03 — triaged in guide re-verification.** The existing bakeoff
  sidecar was not yet Guide-led; the ticket remained open for executable demo
  work rather than prose-only absorption.
