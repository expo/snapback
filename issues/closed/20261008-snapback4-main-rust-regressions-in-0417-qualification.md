# Snapback 4: two Rust test targets fail on main in the 0.4.17 Linux qualification

Status: Closed 2026-10-08 (lane S1 fix-forward)
Date: 2026-10-08
Scope: Snapback 4 `check` notes (`N_WRITE_DENIED`), lane S1
Related: LLP 3000.036 §3 B–D; a5d4a295c2 (S1, `N_WRITE_DENIED`)

The 0.4.17 Linux qualification on eb1000 (release d620e4f22e, from main
ceba4a94f0) failed `cargo test` in the full suite (`== 1 failure(s) in
2019 s`). Everything else passed, including all 357 client files and the
client models. So the 0.4.17 cut stopped before its Darwin dry run, and
nothing was published. Both failures are deterministic: they reproduce
alone on eb1000 in under a second. Both come from the new `N_WRITE_DENIED`
note in a5d4a295c2. The S1 landing did not run the full suite.

- `snapback4-device::unread_range` `guide_memory` and `guide_sqlite`:
  these tests compile the `maintains` guide card's "A value per member:
  Clique unread" example and require no notes. `check` now notes
  `N_WRITE_DENIED` at `guide.q:18:3`, which is the `receipts chat …`
  declaration: "members has no `update` rule (guide.q:7:1), so it is deny;
  the update at guide.q:18:3 in `chatDelivered` cannot pass it for any
  caller but the system".

  `chatDelivered` is the receipt recipe's generated operation.
  a5d4a295c2 says that receipt recipe operations are exempt from the
  note. So this looks like a product bug: the exemption misses generated
  receipt operations. Any app that uses `receipts` would get a false note,
  and the guide card teaches a program that `check` flags. The same
  example also feeds `snapback4::scale_row_ranges`, which did not fail.

- `snapback4-sim::clique::digest::markers_are_private_unsynced_and_cannot_be_forged`
  (`tests/digest/mod.rs:19`): this test requires the legacy digest fixture
  (`snapback4-lang/tests/fixtures/legacy-digest.q`) to carry exactly its
  `N_SYNC_ORDER` notes. The fixture's `forge` mutation inserts into
  `digestMarkers`, whose rule is `insert <- deny`, on purpose, and the
  note now fires there (left 2, right 1). The note looks correct here. The
  test's expectation needs the S1 owner's ruling: either account for the
  note, or decide that a deliberately denied write should not get one.

Lane S1 should fix this forward, without weakening either test, and run
the complete `scripts/test.sh`. The 0.4.17 cut will be redone from the
fixed main.

The raw suite log is on eb1000 at
`~/sb4-intent/ops-tmp/qualify-0417-suite.log`. The publication kit is at
`~/sb4-pub-0417/` on the M5. Its native witness passed for d620e4f22e.

## Resolution

Closed 2026-10-08 by lane S1. Both targets are fixed forward; neither test is
weakened.

- **`unread_range` (product bug).** The receipt exemption in
  `bind/program/denied_writes.rs` compared the bare program name
  (`chatDelivered`) with the family's module-qualified operation
  (`guide.chatDelivered`), so it held only in `schema.q`. It now matches
  qualified or bare names, and also any write located at a `receipts` clause
  site, which every generated statement carries. Receipt expansion already
  refuses an authored declaration with a generated name in any module, so no
  authored mutation is exempted. A new `snapback4-lang` regression compiles the
  card example as both `schema.q` and `guide.q`.
- **`markers_are_private_unsynced_and_cannot_be_forged` (expected note).**
  `forge` deliberately writes the `insert <- deny` table, and the note is
  correct there. The digest `bound()` helper now expects exactly one
  `N_WRITE_DENIED` on `forge` when the source declares it (none otherwise),
  plus its `N_SYNC_ORDER` advice. The runtime refusal assertions are
  unchanged.

The complete `scripts/test.sh` from `snapback4/` passed on the M5: `== 0
failure(s) in 2127 s`, with every step ok and no reruns. A quick blind GPT-6
Astra look (high) gave READY.

