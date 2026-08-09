# guide-gap: `ctx.mutation.settlement()` is shipped but undocumented

**Opened:** 2026-08-08 · **Severity:** P3 (docs; the surface itself is landed)

`issues/closed/20260808-handler-settlement-identity-surface.md` landed a new
mutation-handler authoring surface:

```js
const { clientMutationId, settlementId } = await ctx.mutation.settlement();
```

Design is recorded in
[LLP 0043 §Handler-visible settlement identity (2026-08-08)](../llp/0043-offline-replay-retention.rfc.md#handler-visible-settlement-identity-2026-08-08),
but the guide does not mention it yet. Two pages should absorb it:

- `guide/backend/mutations.md` — where to reach for a replay-stable effect
  idempotency key, and that queries/actions refuse it with
  `SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE`.
- `guide/backend/trusted-runtime-values.md` — this page currently points at
  `ctx.runtime.id()`, which is exactly the fallback the Zerobugs control
  reinvented. It should route effect-idempotency intent to
  `ctx.mutation.settlement()` instead and keep `ctx.runtime.id()` for
  genuinely fresh identity.

Also worth a `guide/capabilities.md` row, including the named arm asymmetry:
the hosted coordinator keeps no client-mutation replay ledger and answers the
all-null twin, so a replay-stable effect key is a local-target capability
today.

Deferred from the landing because `node scripts/check-guide.mjs` cannot run
clean in a fresh worktree — it needs `./scripts/check-generated-artifacts` and
the Exact/Contract demo installs first — so a guide edit could not be verified
in the same pass without a disproportionate setup. Do this on a pass that
already has the generated demo artifacts materialized.

## Resolution

Resolved 2026-08-08. The mutation settlement test now carries an executable
effect-intent recipe whose provider key survives replay and settled duplicate
delivery. The Guide transcludes it from the mutations page, routes runtime-id,
action, and offline-replay choices to it, records the local/hosted asymmetry in
the capability index, and adds retrieval case 28. The released section is
fenced at published closure 0.1.15.
