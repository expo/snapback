# Fixture policy repair: ~67 transcribable, ~96 need an author ruling

**Status:** Open — BLOCKED on a policy ruling for the larger half
**Filed:** 2026-08-21
**Parent:** `issues/20260821-rust-tests-179-failures-decomposed.md`

## What these failures are

163 of the 179 `rust-tests` failures are fixtures failing because the system is
**correctly failing closed** — they lack write policies, sealed ownership
markers, or visibility-governance config.

**They must not be fixed by loosening authorization.** The analysis explicitly
rejected the tempting shortcuts: generic owner patch, caller-selected owner,
admission bypass, and weakening immutability. In each case the product check is
right and the fixture is asking for an unsupported authority transition. A
correct repair adds declarations to fixtures; it never removes a product check.

## Leverage — the mechanical half

Failures concentrate in a few shared test constructors, so a small number of
edits retire most of the count:

| Constructor | Failures | Cumulative |
|---|---|---|
| `local_v0::todo_schema()` | 49 | 49 |
| `unhandled_rejection_v0::schema()` | 15 | 64 |
| `rqs_bundle_v0::bundle_schema()` | 12 | 76 |
| `workerd_twin_v0::schema()` | 10 | 86 |
| `live_coalesce_v0::schema()` | 10 | 96 |
| `handler_settlement_v0` + `live_delta_v0` | 8 each | 112 |
| concurrency + context-ledger + data-patch | 6 each | 130 |

Top three retire ~76; top ten ~130. All retirement counts are INFERRED until
focused reruns confirm second-order checks behind each first failure.

## THE BLOCKER — ~96 failures need a ruling, not a guess

The repair is only mechanical where the intended policy is *transcribable*. For
most of these it is not:

- **85 failures across six shared fixture families** — local, RQS bundle, live
  coalesce, live delta ordinary tables, mutation-settlement identity, and
  relational migration. `AUTH-*` is the narrowest posture consistent with
  observed behaviour, but that is INFERRED: authenticated test calls do not
  prove an authenticated-only product contract.
- **11 failures across three helpers** — concurrency, live scheduler, network
  profile. `OWNER(userId)` is strongly suggested by the sealed marker and
  user-scoped shape, but per LLP 0274 field names and caller values are NOT
  authority, so this needs confirmation.
- **1 codegen fixture** (`rqs_routes_manifest_v0.rs:805`) creates `todos` with
  no visibility. Whether its rows are intentionally public cannot be inferred —
  the handler returns `[]` and exercises no stored-data audience. The codegen
  diagnostic itself warns never to use `public-read` merely to unblock
  generation.

**Do not dispatch an agent to guess these.** A wrong policy transcribed into a
shared test constructor becomes precedent: later fixtures copy it, and the
corpus then encodes an authorization posture nobody chose. That is materially
worse than leaving the tests red, because red is visible and a wrong-but-green
policy is not.

## Proposed order

1. Repair only the fixtures whose intended policy is unambiguous.
2. Get a ruling on the six shared families (the `AUTH-*` question) — that single
   decision unblocks ~85.
3. Confirm `OWNER(userId)` for the three helpers.
4. Rule on the codegen route fixture's audience.

Steps 2–4 are author decisions. Step 1 can proceed now.
