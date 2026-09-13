<!-- Received review: Grok CLI 1.0.30, grok-4.6, xhigh; 2026-09-13. Raw transcript SHA256 ad732860e57d31e60108fce9a589aa12b7c1dbf9ceb31421d398af4d1c85a734. Retained under .llp/ship-runs/sb4-36-20260913/reviews/grok.ndjson in the lead checkout. -->

# Independent review (LLP 3000 decision 4)

**Inspected revision:** `3d2007794b3ac050da3f23dc2d9cb4473a53c385`  
**Base:** `42437496ddcd09071e22b080ae362ff2649af49e`  
**Fence:** `snapback4/` plus LLP 2000.000 §6–§7 / LLP 3000 decision 4 (partition inversion; meter cut / device coverage)  
**Read-only.** Temporary reproductions were run from `/tmp/sb4-review-repro` against this SHA; repository files were not changed.

Two material findings. Truncated stream pages, whole-commit delivery, join-time images for an explicit leave, and per-group log merge were inspected and did not yield a further material defect.

---

## Finding 1 — Severity: high

**File:** `snapback4/crates/snapback4-core/src/partition.rs:473-508`, `518-533`; `snapback4/crates/snapback4-core/src/engine/read.rs:146-148`

Logical membership expiry bounds *which log events are visible* (`c.at < expires_at`) but never revokes the partition. A stale-watermark catch-up after expiry still **bootstraps** until-revoked content (join expansion at the join commit, plus in-interval puts) and **emits no `scope`**. The device then treats those puts as current holdings: it does not re-run the read rule on synced tables, so a local scan is `complete: true` with rows the server will not return.

### Why this is wrong

LLP 2000.000 §7.1: the engine maintains the rows the principal *may read*. LLP 3000 §7: a row past `expire` is absent on every host; revocation is a scope; the device does not re-judge the partition because the server withdraws what it revokes. Snapshot at `now` past expiry is empty (`groups_now` skips expired memberships). Stream catch-up from an older watermark is not equivalent: it installs the group and leaves it there until a later sweep delete emits a real scope.

`intervals` keeps an open span (`to: None`) after expiry:

```473:508:snapback4/crates/snapback4-core/src/partition.rs
        if let Some((from, expires_at)) = open {
            spans.push(Interval { from, to: None, expires_at });
        }
        // ...
    let mut page = tx.read_log_spans(&spans, watermark, None, limit.saturating_add(1))?;
```

`expand_joins` still treats the join as authority if the *join commit's* time is before `expires_at`, not if `now` is:

```526:533:snapback4/crates/snapback4-core/src/partition.rs
        let open = held.get(&(event.table.clone(), event.id.clone())).is_some_and(|spans| spans.iter().any(|span| span.from == event.seq && span.to.is_none_or(|to| to > event.seq) && span.expires_at.is_none_or(|expires| commit_times.get(&event.seq).is_some_and(|at| *at < expires))));
        // ...
        let mut rows: Vec<Value> = tx.group_at(&group_partition(&event.table, &group), event.seq)?.into_iter().filter_map(|event| event.data).filter(|row| !table.expired(row, now)).collect();
```

The device then trusts the puts:

```146:148:snapback4/crates/snapback4-core/src/engine/read.rs
        if self.device && effect == Effect::Read && table.sync.is_some() {
            return Ok(true);
        }
```

### Reproduction

Schema: `members` expire at `.until`, `notes` `read <- exists members[.group, viewer]`, `sync to members[.group]`, default until-revoked, query `return notes[] first 10 by byId`.

1. At t=1 insert note `old`. Record watermark `before`.
2. At t=2 insert membership `until: 10`.
3. At t=9 insert note `live`. At t=10 insert note `hidden`.
4. Do not sweep.
5. `snapshot_at(principal, 20)` → no notes.
6. `stream_at(principal, before, 100, 20)` → puts `old` and `live`, **zero scopes**, `hidden` correctly omitted.
7. Apply that stream page to an empty device (`apply(..., first=false)`), then `query("notes", now=20)`.

Observed at this SHA:

| Path | Notes | `complete` |
| --- | --- | --- |
| Server snapshot at 20 | `[]` | n/a |
| Server `notes` query at 20 | `[]` | `false` (non-uniform scan) |
| Stream from `before` at 20 | `old`, `live` puts; no scope | n/a |
| Device after applying that stream | `["live","old"]` | **`true`**, `nextExpiry` null |

A `from=0` snapshot remains empty. The hole is the normal catch-up path (`watermark > 0` → `/sync?stream=1`). A device that already held the notes when the membership was live also never receives a scope when the clock passes `until`, so until-revoked rows remain until sweep.

### Why existing tests miss it

`expired_memberships_bound_stream_history_before_the_sweep` (passes) only asserts stream *ids*: `live` in, `hidden` out, `old` only if the join is in the window. It never applies the page, never compares to snapshot-after-apply, never queries the device, and never checks for a closing `scope`. `a_scope_tombstone_applies_the_leave_policy` only covers an explicit `leave` mutation. `a_closed_membership_acquires_only_its_join_time_history` covers a logged scope, not clock expiry.

---

## Finding 2 — Severity: high

**File:** `snapback4/crates/snapback4-core/src/engine/read.rs:83-91`

`live_aggregate` was added so a maintain over expiring sources is a live fact before sweep. On the device, if the source is online-only **or has any horizon**, it returns the **stored** aggregate unchanged and sets `beyond_horizon`. That stored value still counts unswept expired sources. Server reads recompute and do not.

```83:91:snapback4/crates/snapback4-core/src/engine/read.rs
    pub(crate) fn live_aggregate(&mut self, table_name: &str, row: Value) -> Result<Option<Value>, RuntimeError> {
        let Some(maintain) = self.schema.maintain_for(table_name).cloned() else { return Ok(Some(row)); };
        let source = self.schema.table(&maintain.source).ok_or_else(|| RuntimeError::Schema("missing maintain source".into()))?;
        if source.expire.is_none() { return Ok(Some(row)); }
        self.read_tables.insert(maintain.source.clone());
        if self.device && source.sync.as_ref().is_none_or(|sync| sync.horizon.is_some()) {
            self.beyond_horizon = true;
            return Ok(Some(row));
        }
```

LLP 3000 §7: expired is absent on every host, before any rule. LLP 2000.000 §7.1: a delivered maintain is a local fact. The device has the expired source rows (unswept) and could skip them; it does not. Completeness is also wrong for a group fully inside the horizon: `complete` becomes `false` solely because `horizon.is_some()`, which is not a meter cut and not “ran off the replica.”

### Reproduction

`items` with `expire at .until` and `sync public last 50 by byTime`; `maintain counts: count items by group`; one live row (`until` null) and one `until: 10`.

1. Snapshot and apply while `now=5` (both rows live; stored count = 2).
2. Query `count` at `now=20` without sweeping.

Observed at this SHA:

- Server: `data=Int(1)`, `complete=true` (expired source skipped).
- Device: `data=Int(2)`, `complete=false`, `nextExpiry=None`.

Online, `packages/snapback4/src/local.ts` falls back to the server when `complete === false`, so the wrong number is hidden while linked. Offline (the local-first tier), the host is given **2**. Shared-host meter tests never build this shape.

### Why existing tests miss it

`expired_rows_are_absent_to_uniqueness_caps_final_exists_and_maintains` is server-only. `query_reports_the_next_expiry_to_the_host` expires the scanned table itself, not a maintain source. `the_unified_device_shares_search_value_and_output_bound_semantics` checks the 1 MiB output ceiling and mixed tags, not expiry × horizon × maintain. Chat `messageCounts` has no `expire` on `messages`, so inbox does not hit this branch.

---

## Inspected, no further material defect

**Truncated stream pages / later membership.** `membership_transitions` / `memberships_before` load join/scope independently of the content page; `read_log_spans` merges authorized intervals by seq. `a_truncated_own_page_never_grants_a_later_membership_early` passes. A later join cannot leak earlier group rows: the group span starts at the join seq.

**Historical join/leave images.** Closed membership uses `group_at` at the join seq, not current images. `a_closed_membership_acquires_only_its_join_time_history` passes for limits 1 and 1000 (whole-commit path included). Same-commit grant+leave still drops the join (`to == from`).

**Whole commits.** If `page[0].seq == page[limit].seq`, the page is re-read for that seq with no row cap. `p3_a_commit_larger_than_the_page_streams_whole` passes. `ord` is assigned across partitions in one commit, so `(seq, ord)` is a total order.

**Per-group query amplification (content log).** One `json_each` join replaces per-group `read_log`. Interval reconstruction still walks all of the principal’s join/scope history (required for authority, not a page-sized leak).

**Device shared meter.** Native and memory hosts both use `Ceilings::default()` + `Cut::Cap` per query (`local.rs:27-34`). Output overflow is still `E_BOUND` (indivisible result), matching the server; `the_unified_device_shares_search_value_and_output_bound_semantics` passes. Non-uniform server cuts, hidden=miss costs, and hoisted-false empty-range costs are unchanged in `reviews.rs` H1/H4/M1. Device synced scans skip the read rule, so they do not reintroduce a hidden-population oracle on partition rows.

**Scan cursor after expired siblings.** Stored keys are index columns **plus id**. `skip(prefix)` (dropping `take(index.components.len())`) keeps that id so a non-unique scan does not jump a tag. `cursorless_nonunique_scans_keep_live_siblings_after_an_expired_batch` passes.

**`now` pin on in-process snapshot.** `snapshot_at` reuses one `now` across pages. HTTP `/sync` snapshot pages each call `now_ms()`; a membership expiring *between* HTTP pages is a narrow race, not demonstrated here.

---

**Verdict:** two material defects, both in the unswept-expiry window this revision set out to close: (1) partition catch-up after membership expiry grants until-revoked rows with `complete: true` and no scope; (2) device maintains over a horizon-bounded expiring source keep counting expired rows.

## Lead disposition

Both findings were reproduced by the reviewer. Correction `87a5fabab` appends terminal expiry scopes, checks temporary until-revoked audiences on the offline clock, and computes partial maintained values from live held sources. Device regressions and final qualification follow in the journal. The incompleteness of a horizon-backed maintain remains intentional: a small held row count cannot prove complete coverage without exact horizon backfill.
