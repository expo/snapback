# EAS Payments — engine-first slice

A learning/prototype **vertical slice** of the EAS Payments Engine on Snapback,
built to the brief in [`BRIEF.md`](./BRIEF.md). It is not production M1. It
proves one path end to end:

```
store notification  ->  action        (resolve authoritative state; stubbed here)
                    ->  mutation      (one atomic commit, idempotent)
                    ->  entitlementGrants   (the derived read model)
                    ->  live query    (what the app actually gates on)
```

```
eas-payments/
  BRIEF.md                    # the build brief this slice implements
  demo.snapback.json          # demo manifest (surfaces, capabilities, gaps)
  snapback/
    schema.mjs                # source-authored schema (the source of truth)
    functions.mjs             # inline JS handlers, action, cron
    seed.json                 # deterministic catalog seed
    generated/artifacts.json  # committed review manifest
  tests/acceptance/
    headless.mjs              # required surface acceptance suite
```

## The three design constraints

**The notification is a trigger, never a source of truth.** `validateReceipt`
takes a receipt, resolves what the store says is true, and hands typed values
to `recordPurchase`. Nothing from the payload is committed directly. For this
slice the resolution is a local derivation; the `ctx.fetch` seam and its
`uses: ['storeValidation']` grant are declared and marked with a TODO where the
real adapter call lands.

**Entitlements are derived from transactions.** `transactions` holds raw store
facts; `entitlementGrants` is the answer computed from them via
`productEntitlements`. The app asks `getEntitlements`, never `listProducts`,
when deciding whether a user may do something.

**Products carry per-platform ids and transactions carry an environment.**
`appleId` / `googleId` / `stripePriceId` live on the product; every transaction
is tagged `sandbox` or `production` so metering can exclude test rows later
without a backfill. Nothing consumes the tag yet.

## Idempotency and expiry

`recordPurchase` dedupes on `transactions.by_storeTxn`, so a re-delivered
notification finds the existing row and grants nothing a second time. The
acceptance proves this both at the mutation and through a replayed action.

`entitlementGrants.activeUntil` is the subscription window. The `expireGrants`
cron job runs `expireGrantsSweep`, which calls `applyGrantExpiry` — a mutation
that scans `by_active` and flips closed windows off. A grant with no
`activeUntil` (a non-consumable) is perpetual and is never swept.

## Run it

```sh
node packages/snapback-codegen/index.mjs demos/eas-payments/snapback
node demos/eas-payments/tests/acceptance/headless.mjs
```

The suite starts its own OS-port-isolated in-memory server with the scheduler
inert (`cronDisabled: true`) and forces every tick itself, so no assertion
waits on wall-clock cadence.

When the action does a real fetch, both generation and the server process need
the egress opt-in:

```sh
SNAPBACK_OUTBOUND_ACTIONS=1 node packages/snapback-codegen/index.mjs demos/eas-payments/snapback
```

## Out of scope for this slice

Real store adapters, outbound webhooks, per-project isolation, sessions auth,
offerings/merchandising, Stripe/web, and metering. See `notClaiming` in
[`demo.snapback.json`](./demo.snapback.json).

## Next slices

1. Replace the stub with a real `ctx.fetch` to a fake local store, keyed
   through `ctx.secrets`/`uses`.
2. Add `applyStoreState` (the re-fetch-on-notification path) and a second
   product/entitlement.
3. Add an outbound "entitlement changed" trigger the developer polls.
