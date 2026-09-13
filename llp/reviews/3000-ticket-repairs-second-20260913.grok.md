# Received second core review — Grok

Reviewer: Grok 4.6, xhigh; independent CLI session, 2026-09-13.
Reviewed immutable `65e2ad752` against `cca6a2d0b`. Mutually blind with the Sol review. The reviewer ran six existing focused sim tests (all passed), made no repository edits, and returned the full text below. Raw events, stderr and timing are retained in the run ledger's ignored `reviews/second-core/` archive.

## Received review

## Review

Immutable revision **`65e2ad752`** (`Cover device expiry revocation and maintained counts`) vs **`cca6a2d0b`**. Scope: partition log, engine reads/local/runner, store, meter, and the sim/device regressions that exercise them. LLP 3000 §7 from this SHA is the contract (whole commits, historical join/leave, logical expiry, device `complete` = horizon + meter, live aggregates when the source is not fully held, ceilings unchanged).

Focused sim tests at this SHA passed: `a_closed_membership_acquires_only_its_join_time_history`, `a_truncated_own_page_never_grants_a_later_membership_early`, `expired_memberships_bound_stream_history_before_the_sweep`, `a_legacy_grant_cannot_borrow_a_later_rejoins_lifetime`, `expired_rows_do_not_consume_the_acquisition_horizon`, `expired_rows_are_absent_to_uniqueness_caps_final_exists_and_maintains`. They do not cover the cases below.

---

### 1 — Severity: bug

**File:** `snapback4/crates/snapback4-core/src/partition.rs:201`, `254–270`, `279–282`

A paged snapshot pins the **watermark** on page 1 but re-evaluates audience membership at the **call’s `now`**. `groups_now` skips logically expired memberships. If a `retain delivered-history` group spans pages and `until` falls between them, later pages treat the group as gone (`groups.get(position) != Some(current)`), reset `after`/`taken`, and never emit the remaining rows.

Catch-up cannot repair this: those rows already exist at the pinned watermark and do not change, so they do not appear in `_log` after the watermark. The post-drain synthetic `scope` (`partition.rs:513–522`) is a no-op for delivered-history (`device.rs:661–663` at this SHA). The replica keeps a torn history.

Until-revoked reads still hide via `exists` on the expired membership; this is a delivered-history acquisition hole.

**Reproduction** (deterministic, no wall-clock race):

```text
members expire at .until; notes: retain delivered-history, sync to members[.group]
3 notes in group g; alice joined with until=10
p1 = snapshot_page_at("dev:alice", None, 1, now=9)     // first note, next is Some
p2 = snapshot_page_at("dev:alice", p1.next, 1, now=11) // membership expired; remaining notes omitted
```

HTTP `GET /sync` calls `snapshot_page` → `now_ms()` **per page** (`engine/mod.rs:818–831`), same shape. Apply p1+p2, then `stream_at` from the pinned watermark at now=11: history still has only note 1 of 3.

`snapshot()` in one call with a single `now` does not hit this; paging does.

---

### 2 — Severity: bug

**File:** `snapback4/crates/snapback4-core/src/engine/read.rs:137–143`, `420–422`  
**Also:** `snapback4/crates/snapback4-core/src/engine/local.rs:34`

LLP 3000 §7: on a device, `complete` is horizon and meter only, because the replica is already the partition.

`trust_synced_read` is false for **until-revoked** tables whose audience table has `expire`. A scan such as `return temporary[] first 10 by byId` then sets `non_uniform` because `read <- exists members[.group, viewer]` is not prefix-decided. `query_with_coverage` folds `!non_uniform` into `complete`.

So while membership is still live and every delivered row is held, that scan is `complete: false` and `unknown: false` (`beyond_horizon` is not set). Rechecking `exists` for offline revocation is right; classifying the scan as incomplete is not. Delivered-history scans of the same audience stay complete (`trust_synced_read` short-circuits). The device regression `expiring_membership_revokes_until_revoked_rows_offline_and_on_catch_up` checks row ids and `nextExpiry`, not `complete`.

**Reproduction:** schema from that device test; snapshot at now=5; `query temporaryRows` at now=5 with membership `until=10`. Data has both rows; `complete` is false. `historyRows` on the same replica is complete.

---

### 3 — Severity: bug

**File:** `snapback4/crates/snapback4-core/src/engine/read.rs:100`, `108`, `217`  
**Also:** `snapback4/crates/snapback4-lang/src/bind/program.rs:174–182`

`live_aggregate` charges `Examined` per source row (default ceiling 8192). On `Cut::Cap` it returns `Ok(None)`. Point `get` turns that into `Null`. A maintained point read is compiled as “null means 0”.

A live group with 8193+ contributing rows (or live+expired siblings) therefore returns **`data: 0`**, `complete: false`, `capped_at: Examined`, instead of the stored aggregate or a refusal. Ceilings are not raised; the new recompute spends the whole read budget and then looks like an empty group.

**Reproduction:**

```text
table items: expire at .until; maintain counts: count items by group
seed 8193 live rows in group g (until null)
query return counts['g'] by byGroup
```

Expect a count of 8193. Get `Int(0)` with the query capped. Same path on a device that actually holds the source rows. Online-only / horizon coverage is already marked incomplete; this is a full-coverage server (or fully held device) read.

---

Stream whole-commit cutting (`partition.rs:500–508`), historical `[join, leave)` reconstruction (`intervals` + `group_at`), same-commit join/scope suppression, legacy `expiresAt` fail-closed, offline until-revoked vs delivered-history row visibility, and live counts when the source is missing (null + `unknown`) look consistent with §7 and the regressions that exist.

Inspected at `65e2ad752`: `partition.rs`, `engine/read.rs`, `engine/local.rs`, `engine/runner.rs`, `engine/mod.rs` (snapshot/stream/query), `engine/write.rs` (live uniqueness/caps/rebuild), `store.rs` (`read_log_spans`, `group_at`, `memberships_before`), `meter.rs` (unchanged ceilings), `schema.rs` leave/maintain audience rules, sim `replica.rs` / `review_corrections.rs` / `reviews.rs`, device `apply`/`leave` and the expiry/maintain tests in `device.rs`. Ignored CLI/UI/native-cache.

## Lead disposition

1. **Declined: proposed atomic acquisition entitlement.** The existing snapshot cursor contract explicitly rechecks current membership on each page. Its watermark pins log catch-up, not authority for the whole acquisition. Delivered-history retains delivered rows, not rows that were never acquired. The independent host lane confirmed that reading of the existing contract. A two-store regression now makes it explicit: page one acquired before expiry remains, later unacquired rows do not arrive, and post-expiry edits/new rows remain excluded. The proposed all-three-rows reproduction is retained outside the repository; no cursor clock or history replay was added.
2. **Fixed.** Device scans over a synced table no longer infer non-uniform incompleteness merely because the expiring audience must be checked. The fully held device regression now asserts complete before and after logical expiry; horizon/meter cuts still make it incomplete.
3. **Fixed with the declared cap contract.** A capped point returns contributions examined so far and incomplete coverage, instead of fabricating an empty group. It does not promise the full 8,193-row result after an 8,192-row ceiling. The focused regression lowers the ceiling to three, sees two contributions from five source rows and asserts the cap. No ceiling was raised. A narrow independent delta review follows these corrections.
