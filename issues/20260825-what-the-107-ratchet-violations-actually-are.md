# What the 107 ratchet violations actually are

Status: open
Date: 2026-08-25
Systems: snapback-kernel, snapback-engine, snapback-auth, snapback-server, snapback-sync
Related: issues/20260824-q04-membership-writer-route-enumeration.md,
  llp/0303-subject-authority-correlation-policy.decision.md

## Why measure this

`node scripts/check-kernel-raw-sql-api.mjs` is the programme's one objective axis — it reports this
exact defect class, runs in ~27 seconds, and has sat at **107** for the whole session. It is treated
as a ratchet rather than a proof, but nobody had broken the number down. A single aggregate that
never moves tells you nothing about where the work is.

## Composition

| Category | Violations |
|---|---:|
| `caller-discriminant` — **`MembershipWriter`** | **61** |
| `seed-obtain` | 39 |
| `reexport` | 4 |
| `sql-ingress` | 3 |
| **Total** | **107** |

**Fifty-seven percent of the entire ratchet is one row.** Every one of the 61 is the same finding —
`caller-constructible MembershipWriter is named directly in a registered privilege-sink signature` —
spread across `storage.rs`, `membership_plans.rs`, and the `MembershipPlansKernel` /
`MembershipPlansReadKernel` surfaces. Q04 owns it.

If Q04 closes, the ratchet goes **107 → 46** in one landing. Nothing else on the board comes close;
the next largest single type (`PushStorageAuthority`, `AskSpendReservation`,
`PromotionContentionReservation`, `AuthorizationCommitReservation`) accounts for a handful each.

## The number over-states distinct sites by ~27%

107 violation **lines** span only **84 distinct `file:line` sites**. Twenty-three sites are reported
twice because the scanner counts *paths*, not code locations — the same function is reachable as
`snapback_kernel::storage::membership_plans::X` and as the re-exported
`snapback_kernel::storage::X`, and both are counted.

This is defensible for a privilege scanner: two public paths to a privileged signature really are two
ways in, and closing one does not close the other. But it means **107 must not be read as "107
distinct problems"**, and a fix that removes a re-export will drop the count without changing any
code behaviour. Both directions of that need stating whenever the number is quoted.

## Consequences for sequencing

- **Q04 is the highest-leverage single row on the board by a wide margin.** It was already ranked
  top for a related reason (it was 61 of the then-105 violations); this confirms it precisely and
  independently.
- **The remaining 46 are diffuse.** After Q04 there is no second big win — `seed-obtain` at 39 is
  spread across at least six distinct seed types in five crates, each needing its own derivation
  work. So the ratchet's fall will look like one cliff and then a long shallow slope, and that shape
  should be expected rather than read as stalling.
- **Three `sql-ingress` and four `reexport` rows are the cheapest items on the list**, and two of the
  `sql-ingress` entries are in `push.rs` `test_support` under `[caller-features]` — which the
  test-support migration (M10) may remove as a side effect rather than as targeted work.
