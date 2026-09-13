# The security-boundary gate was masked, and 9 attacks compile behind it

- Status: open
- Created: 2026-08-25
- Area: `scripts/check-security-boundaries.mjs`, `tests/fixtures/security-boundaries/`
- Found by: q14r6 reported the block; independently reproduced and diagnosed here

## The mask

`node scripts/check-security-boundaries.mjs` has been exiting **2 — `SNAPBACK_SECURITY_BOUNDARY:
infrastructure failure`** on the very first attack, with:

```
error: the package 'snapback-security-boundary-fixtures' does not contain this feature:
snapback-server/test-support
```

Five `c009-*` entries declared `featureSets` naming `snapback-server/test-support` and
`snapback-activation/test-support`. The fixture crate must not depend on either: its `Cargo.toml`
says so explicitly, because the privilege scanner certifies both crates empty and **LLP 0284 I-12
forbids mounting either as a fixture dependency**. Those feature paths were never satisfiable.

Because the gate aborted on the first attack, **it never evaluated any of the other 58**. Narrowing
the five entries to declared dependencies makes it run: 84 attack-span rejections across 59
inventoried attacks in ~145s.

## What was behind the mask

The gate now reports **15 violations**. They were not introduced by the narrowing — they were simply
never reached.

**Nine attacks compile, meaning the effect is reachable:**

| Attack | Cell |
| --- | --- |
| `admit-system-push` | `[]` |
| `admit-protected-record-erasure` | `[]` |
| `admit-pending-effect-creation` | `[]` |
| `admit-pending-effect-refusal` | `[]` |
| `service-interlock-factory` | `[]` |
| `obtain-promotion-contention-reservation` | `[]` |
| `obtain-ask-spend-reservation` | `[]` |
| `forge-membership-writer-admin` | `[]` |
| `services-rusqlite-reexport` | `[snapback-services/remainder-tests]` |

Every one of these is in the **default** cell except the last — no features required.

**Two witnesses fail in the wrong place**, which is the trap LLP 0303 (s) names: a witness that
refuses at its `use` line proves nothing.

- `clone-secret-read-operator` — `error[E0433]: cannot find module or crate snapback_server`
- `mint-secret-read-lease-from-registry` — same shape

Both carry `mount: snapback-server`, which is the same LLP 0284 I-12 contradiction as the `c009`
entries: the manifest claims a mount the fixture crate is forbidden to declare. The gate says so
directly: `RED inventory: claimed mount(s) absent from cargo metadata dependencies: snapback-server`.

**One witness has an uncoded span:** `construct-authorization-view` expected `E0451` but its primary
span came back uncoded, with `panic!("compile-only private registry")` placeholders in the frame.

**Two publicly obtainable seed types have no attack witness at all:**
`ApprovePendingEffectCommand` and `DenyPendingEffectCommand`.

## What to do, in order

1. **Land the narrowing** so the gate runs at all. Done separately; it converts an infrastructure
   abort into a working gate. It does not turn a green gate red — the gate was already failing.
2. **Triage the nine compiling attacks.** Each is either a genuinely open row or a stale witness.
   Decide which per attack; do not assume either.
3. **Resolve the `mount: snapback-server` contradiction.** Either the two secret-read witnesses stop
   claiming a mount the fixture cannot declare, or LLP 0284 I-12's rule needs an explicit exception
   with a stated reason. The current state asserts both.
4. **Give the two seed types witnesses**, or record why they need none.

## Why this matters beyond the fifteen

A gate that aborts on its first item looks, in a log tail, very like a gate that is merely failing.
This one had been masked long enough that nine default-cell attacks accumulated behind it. Any gate
that can abort early should report how many items it evaluated versus how many it inventoried — this
one does print `59 inventoried attack(s)`, which is what made the gap visible once it ran.

Related: LLP 0284 I-12, LLP 0303 revision (s).
