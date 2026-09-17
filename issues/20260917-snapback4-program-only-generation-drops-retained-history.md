# Snapback 4: program-only generation drops retained history

Status: Open
Priority: P2
Date: 2026-09-17
Systems: Device generation adoption, delivered-history retention, identity
Author: Codex (lane MQ-R2, lead disposition of Sol and Grok round-2 reviews)

## Problem and reproduction

Any generation change without a literal-default addition drops every device row and clears its held/left group map. A program-only deploy therefore loses delivered-history rows from left groups. Re-acquisition restores held rows, but left-group history is no longer authorized on the server and cannot be re-acquired. In the retained-read fixture, `both()` changes from 25 retained + 26 held online to the whole server answer, 0 left + 26 held. This is the `b5a7ddde3` lifecycle restored by MQ-R2, not a composition defect. The client adoption fence still discards and retries delayed old-generation replies.

## Built candidate and reversal

Commit `65bc84ac9` broadened `keep_images` in both `Device::open_store` and `Device::adopt_captured` in [device.rs](../snapback4/crates/snapback4-device/src/device.rs): equal `schema.tables` and `schema.maintains`, or the existing `keeps_literal_default_images` predicate, kept images and the held/left group map. Acquisition still reset for program-only changes. Its both-store test, `compatible_adoption_keeps_retained_components_on_both_stores` in [round2.rs](../snapback4/crates/snapback4-device/tests/search_merge/round2.rs), demonstrated preserved rows after reacquisition on memory and SQLite. MQ-R2 reverts both sites exactly to `b5a7ddde3` and turns that test into `program_only_adoption_resets_retained_components_on_both_stores`, recording today's limitation. The lead ruled that changing this adoption lifecycle requires a separate design and review under [LLP 3000.007 §18.3](../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#183-a-literal-default-fills-the-column-wherever-it-is-absent-check-reads-the-store).

## Review evidence

Sol judged the candidate sound on inspection, with these lifecycle checks:

| Concern | Sol's reasoning |
| --- | --- |
| Table authority | Table equality includes rules, sync audience/horizon, leave policy, expiry, defaults, columns, indexes and constraints; maintains must also match. |
| Acquisition | Program-only changes clear `ACQUIRED`; synced reads refuse with `E_PREDICT` until reacquisition. |
| Predictions | Confirmed bases are overlaid into the snapshot before publication; predictions restore and replay under the new programs. |
| Interrupted snapshots | Adoption clears `STAGED_GROUPS`; the next first page clears stale staged rows. |
| Memory store | Schema-hash projection and index rebuilding still run; identical tables preserve image shape. |
| Native modules and identity | Native metadata and the owner-local module are invalidated; backend identity includes schema, sorted programs and generation. |
| Publication | Replacement publishes newly acquired rows and retained left rows; held groups are replaced. |

Sol requested more direct cross-product tests for staged snapshots, predictions, native modules and maintained values, but found no concrete failure. Grok identified an identity-mode scenario omitted by the predicate: a device store holds guest G's left-group messages with `retain delivered-history`; the application ships `use identity password` (or drops guests), without changing tables or maintains, and bumps generation. Adoption keeps images and `GROUPS`. G signs in as password principal P on the same store. The snapshot marks G's rooms left because they are not in P's audience and keeps those rows. P's `messages[leftRoom]` is trusted on the device through `trust_synced_read`, which skips live read rules for delivered history, and returns G's history. At `b5a7ddde3` this generation change dropped every row. This is the review's scenario, not a newly executed exploit qualification.

Review sources: [Sol](../llp/reviews/3000.001-retained-read-composition-round-2.sol.md) and [Grok](../llp/reviews/3000.001-retained-read-composition-round-2.grok.md), round 2. Both returned READY WITH CHANGES; the lead chose reversal rather than extending the predicate in this composition lane.

## Open design questions and acceptance work

- Is equality of `tables` + `maintains` + `auth` sufficient, or must the schema match except for operations?
- Do effects, schedules, routes or unique-refusals change the safety of retaining images?
- Is a device store ever shared across principals, and what invariant binds delivered history to the acquiring principal across auth-mode and session changes?
- What must a direct test combine: a pending prediction, an interrupted same-store snapshot, and a native module across program-only adoption, on both stores and both `open_store` and `adopt_captured` paths?
- Preserve the established literal-default lifecycle and test authority-changing refusals alongside a positive program-only retention case before admitting any expansion.

The retained-read composition implementation and its qualification remain in [LLP 3000.001](../llp/3000.001-durable-replica-and-write-lifecycle.research.md#proposed-composition-of-retained-and-authoritative-reads). This ticket is separate design and review work; no retention expansion is implemented by MQ-R2.
