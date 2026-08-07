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
takes a receipt, asks the store what is actually true over `ctx.fetch`, and
hands typed values to `recordPurchase`. Nothing from the payload is committed.
The `environment` argument is routing input only — it selects which store
endpoint to ask, exactly as Apple's sandbox and production endpoints differ —
and whatever the store answers is what gets stored. The acceptance proves this
by having the store answer `production` to a request that said `sandbox`.

The credential reaches the request through
`ctx.secrets.get('storeValidation').asBearer()`, granted by
`uses: ['storeValidation']`. Queries and mutations get no config surface at
all, and a wrong credential fails the action with no write.

**Entitlements are derived from transactions.** `transactions` holds raw store
facts; `entitlementGrants` is the answer computed from *all* of a user's
transactions via `productEntitlements`. The app asks `getEntitlements`, never
`listProducts`, when deciding whether a user may do something.

Derivation is not per-purchase assignment, and the difference is observable:
`pro_monthly` and `pro_annual` both grant `pro`, so a user holding both keeps
`pro` when one expires. One same-file helper (`deriveGrant`) computes this, and
both the purchase path and the notification path call it, so they cannot drift
into two different answers.

**A notification is a thin trigger.** `applyStoreState` takes
`{ userId, store, storeTxnId }` — no status, no expiry, no entitlement. It asks
the store what is true *now* and reconciles. That is what makes a replayed,
delayed, reordered, or forged-payload notification harmless: none of them can
assert state. Reconciling twice over the same store state writes nothing and
reports `changed: false`.

**Products carry per-platform ids and transactions carry an environment.**
`appleId` / `googleId` / `stripePriceId` live on the product; every transaction
is tagged `sandbox` or `production` so metering can exclude test rows later
without a backfill. Nothing consumes the tag yet.

## Idempotency and expiry

`recordPurchase` dedupes on `transactions.by_storeTxn`, so a re-delivered
notification finds the existing row and grants nothing a second time. The
acceptance proves this both at the mutation and through a replayed action.

`entitlementGrants.activeUntil` is the subscription window. There are two ways
a grant goes away, and they are independent:

- **The notification path** (`applyStoreState`) — the store says the
  transaction is now `expired` or `refunded`, and the reconcile revokes
  immediately. No scheduler involved.
- **The cron sweep** (`expireGrants` → `expireGrantsSweep` →
  `applyGrantExpiry`) — a window simply ran out and no notification arrived.

A grant with no `activeUntil` (a non-consumable) is perpetual and is never
swept.

## Known prototype gap: reconcile authority

`reconcileTransaction` takes `userId` as an argument rather than reading
`ctx.auth.userId`, because a store notification arrives with no user session
attached. Under dev auth that makes it callable for any user id. It does refuse
to rewrite a transaction that belongs to someone else, but that is a
consistency check, not an authority fence. A real deployment must restrict this
mutation to system authority; the authoring surface offers only
`public | optional-user | authenticated` today.

## Run it

```sh
SNAPBACK_OUTBOUND_ACTIONS=1 node packages/snapback-codegen/index.mjs demos/eas-payments/snapback
node demos/eas-payments/tests/acceptance/headless.mjs
```

**Generate with `SNAPBACK_OUTBOUND_ACTIONS=1`.** The opt-in is a codegen input:
the same sources generate a different `inputsHash`, bundle hash, and descriptor
identity with it off. Generating without it produces artifacts that do not match
the committed `artifacts.json`. (Codegen does not *fail* without the flag here,
because `ctx.fetch` is a host-mediated call rather than the global `fetch`
identifier that trips `BUNDLE_UNSUPPORTED_FETCH` — so the mismatch is silent.)

The acceptance sets `SNAPBACK_OUTBOUND_ACTIONS=1` on the server child it spawns,
so the test command needs no prefix. Generation opting in does not grant the
running process network authority; the runtime is a separate boundary.

The suite starts its own OS-port-isolated in-memory server with the scheduler
inert (`cronDisabled: true`) and forces every tick itself, so no assertion
waits on wall-clock cadence. It also starts a fake store
(`tests/acceptance/fake-store.mjs`) on an OS-assigned port and sets the store
credential through the admin config API.

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
