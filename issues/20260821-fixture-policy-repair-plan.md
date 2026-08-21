# Fixture policy repair: ~67 transcribable, ~96 need an author ruling

**Status:** Open — BLOCKED ON IMPLEMENTATION, not (yet) on a ruling
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


## Correction — 2026-08-21: the blocker is not the ruling

This plan assumed the write postures were declarable and only the CHOICE was
missing. That premise is wrong. A repair lane stopped before modifying anything
and reported why:

- **LLP 0274 says its own runtime manifest carrier and lowerer do not yet
  exist** (`llp/0274-explicit-write-authority-postures.spec.md:68`).
- `TableManifest` carries read `visibility` but has **no write-posture field**
  (`crates/snapback-types/src/manifest/types.rs:1192`).
- Codegen is still `snapback.owner-write.v1`; non-owner visibility lowers to
  `migration-pending` (`packages/snapback-codegen/write-policy.mjs:13`).
- Runtime dispatch supports only derived owner-write. Declaring `PublicRead`
  here would use the Phase-1a pass-through that this plan explicitly forbids
  (`crates/snapback-kernel/src/storage.rs:19925`).

So `open-write` (48 fixtures) and `authenticated-write` (3) **cannot be
declared at all today**. The nine rulings still need to be made eventually, but
making them now would not retire a single failure.

### What IS actionable

- **Owner fixtures (11)** — derived owner-write is supported.
- **Governance-config (3)** — likely, needs confirmation.
- The **Graffiti ruling already exists** and did not need to be sought:
  `cells` uses `authenticated-write`, attribution `authorId`, insert-only
  (`llp/0274:1734`). It is blocked on the same missing mechanism.

### Useful findings the lane produced before stopping

**47 of the 48 candidate open-write fixtures were confirmed genuinely
anonymous** — writing paths use default/anonymous auth and the tables have no
owner or membership field. Breakdown: unhandled rejection 15, workerd twin 10,
handler settlement 8, context ledger 6, conformance 4, egress ambient 1,
handler-harness security 1, runtime qualification 1, warm VM 1.

**One was reclassified**: `data_tier_corpus_v0`. Its aggregate corpus includes
`todos.userId` and supplies `case.auth_user_id`, so labelling the shared corpus
open-write would incorrectly widen owner-shaped cases. That is exactly the
reclassification the brief asked for rather than defaulting to the weakest
posture.

### The 163 figure is NOT stale — I was wrong about that

An earlier revision of this section claimed the counts had drifted, citing
`admin_v0` 45 and `workerd_twin_v0` 32 from the repair lane's report. That was
wrong, and wrong in the way this repository keeps getting caught: **those were
sandbox numbers**. The lane runs where `127.0.0.1` binds are denied, which
inflates any target that needs loopback.

Re-measured unsandboxed on `aec754689` with `--no-fail-fast`:

**3284 passed / 179 failed across 117 test binaries, 32 failing targets** —
identical to the `f99b92cee` battery total, and the per-target counts match this
plan closely:

| Target | Failures |
|---|---:|
| `local_v0` | 50 |
| `unhandled_rejection_v0` | 16 |
| `rqs_bundle_v0` | 12 |
| `workerd_twin_v0` | 11 |
| `live_coalesce_v0` | 10 |
| `live_delta_v0` | 9 |
| `handler_settlement_v0` | 8 |
| `data_patch_v1`, `ctx_ledger_v0`, `concurrency_v0`, `lib.rs` | 6 each |

`workerd_twin_v0` is 11 unsandboxed, not 32. So the decomposition, the leverage
ranking, and the 163/179 figures in this plan all stand and can be planned
against.

### Revised order

1. Land the LLP 0274 write-posture mechanism — manifest field, codegen
   lowering, runtime dispatch. Everything else waits on this.
2. Then apply the nine rulings.
3. Then the mechanical repairs, using the 47/1 classification above.
