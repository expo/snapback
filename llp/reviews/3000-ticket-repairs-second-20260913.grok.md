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

## Received narrow correction review

Reviewer: independent Grok 4.6 xhigh CLI, immutable `9bf6d4a83` against `d3c682d15`, scoped to the five changed core/guide files and their immediate callers. Full received final text:

**Finding:** replacement catch-up never revokes the predecessor grant, so until-revoked rows that left the group during the dead interval stay on the replica.

`9bf6d4a83328a65ffc4d28f3d34ba8c9b771976c` (`engine/read.rs`, `engine/write.rs`, `engine/mod.rs`, `partition.rs`, `lang/guide.rs`).

In `snapback4/crates/snapback4-core/src/partition.rs`, a replacement join now closes the prior span and opens its own (`487–494`), and sweeping an expired predecessor with a live sibling logs no `scope` (`176–198`). `expand_joins` still materializes the predecessor join (`571`: `span.from == event.seq` and the join commit is before that span’s `expiresAt`). The only synthetic revocation is appended after catch-up, and only if the **last** span is still open and already expired (`548–549`). After a live replacement that last span is B, so A’s logical end never becomes a `scope`. Default leave is until-revoked (`schema.rs` `LeavePolicy`). A replica drops those rows only on `scope` (`snapback4-sim/src/replica.rs` `149–156`).

This is not “keep already delivered history,” and it is not a demand that snapshots extend expired authority. A fresh snapshot at `now` is still `groups_now` (live only). The failure is stream catch-up across a replacement, including a device that snapshotted empty, went offline, then received both joins.

**Reproduction** (same membership/notes shape as `an_expired_unswept_grant_does_not_hide_its_replacement_interval`, plus `delete <- allow`):

1. Watermark `before` is the seq before any join (device already snapshotted empty, or `stream_at(..., 0, ...)`).
2. `join` `old-member` `until=10` at t=1.
3. `add` note `n1` at t=2.
4. `delete` `n1` at t=11 (`delete <- allow`; Alice is already logically expired).
5. `join` `new-member` `until=100` at t=20 (unswept predecessor, same `group+person`).
6. `stream_at("dev:alice", before, 100, 22)`.

**Observed:** put of `n1` from join A’s expansion; no group `del` (commit `at=11` is not `c.at < 10`); no `notes` `scope`. Applying the page leaves `n1` on an until-revoked replica.

**Expected:** A’s lifetime ends at expiry/replacement, so until-revoked rows that left before B are gone; B’s join still acquires the current group image.

Online equivalence: a device that synced between t=10 and t=20 got a synthetic scope at A’s expiry and dropped `n1`. Catch-up after B never emits that revocation.

No other material defect in the reviewed correction (zero-sum candidates, `Cut::Cap` partial point reads, capped scan resume-after-last-returned-row, `open()` repair from the stored backend, device completeness as horizon+meter with expiring-audience rules still evaluated).

Lead follow-up: main's current-image security filter removes deleted join candidates for the before-any-join watermark. The same lifetime-gap defect still matters when a device had already acquired the row before expiry: the gap's deletion is outside the old grant and the new grant's snapshot does not include it. A regression covers both watermark positions. A new grant after an expired interval must send that interval's scope before its join expansion, while a continuous live renewal must not clear its held horizon. Correction and qualification follow.

Correction qualification: the acquired-row watermark reproduced stale n1 on current security-integrated code. Grant initialization now consults the latest ledger transition before the watermark; a live renewal does not emit an ordinary scope; an expired predecessor emits its scope before the replacement's join image. Both watermark positions and a continuous live-renewal control pass on SQLite and memory. The existing replacement regression asserts scope ordering rather than forbidding the necessary earlier scope. Full focused totals are 18 device, 32 correction and 11 earlier-review passes. Final delta review follows.

## Received final integration review

A fresh independent Grok 4.6 xhigh CLI reviewed immutable `d8cdc6c81` and returned the following full static review. It was mutually blind with the Sol integration review and independently identified the same obsolete-bearer write failure, plus its online-only observation variant. The separate client lane is correcting the read retry/observation lifecycle; this is not a clean integration verdict.

**Finding:** after session rotation, a stale `E_AUTH` is ignored for session liveness but still settles the local outbox as a terminal write failure (and can stick an online-only observe).

Rotation deletes the old bearer (`identity.rs` 131–133) and bumps `credentialRevision` (`local.ts` 327–347). `refusedSession` (302–303) correctly ignores `E_AUTH` unless the snapshot revision is still current, which is why a delayed `/changes` 401 cannot kill the replacement session.

`post()` still returns that denial as a successful protocol result:

```377:387:snapback4/packages/snapback4/src/local.ts
      const request = requestCredentials();
      const response = await doFetch(`${base}${path}`, { method: "POST", headers: request.headers, body: JSON.stringify(body), signal: aborter.signal });
      ...
      await refusedSession(json.denied ?? json.why, request.revision);
      if (link !== "online") setLink("online");
      return { ok: true, json };
```

`flushOnce` then treats any non-retryable denial as a judged failure. `E_AUTH` is not retryable. `settle` without `seq` deletes the outbox row (`device.rs` 589–596), `onWrite` emits `failed`, and the mutation never ran.

```709:722:snapback4/packages/snapback4/src/local.ts
      const why = (json.why ?? json.denied) as Refusal | undefined;
      if (why?.retryable || (json.state !== "sent" && !why)) { retryFlush(); return; }
      const applied = await call({ op: "settle", id: entry.id, ...(json.state === "sent" ? {seq: Number(json.seq ?? 0)} : {}) });
      ...
      emitWrite(outcome);
```

`refreshCurrent` waits for `syncing` (359–362) but not `flushing`. `/auth/refresh` is not on `network()`. The merge dropped the per-revision online client and kept this single outbox flush, so credential snapshots and `onWrite` do not coexist.

**Reproduction**

1. Local client, live session, at least one admitted outbox mutation.
2. Overlap `POST /m/...` (headers snapshotted at `local.ts:380`) with `refreshSession()` / the near-expiry timer (`local.ts:313–316`).
3. Server deletes bearer A, returns 401 `E_AUTH` for that POST; `refusedSession` no-ops on the stale revision.
4. `flushOnce` settles without `seq`. Device outbox row is gone. `onWrite` is `failed`. Same principal on bearer B; a retry would have applied.

Same hole on reads: `evaluateLocal`’s server path (`local.ts:579–585`) stores that `E_AUTH` on the watch. Successful rotation calls `setLink("online")` which is a no-op if already online (353–355), so an in-flight online-only observe can stay denied while `session()` is live.

**Fix:** if `denied.code === "E_AUTH"` and `request.revision !== credentialRevision` (or `rotating`), return `{ ok: false }` from `post` so flush retries with the new bearer; do not `settle` without `seq`. After a successful rotation, rerun watches.

---

Other scoped intersections were inspected at `d8cdc6c81` and did not show a material integration defect:

- Partition `stream`: interval reconstruction + virtual clock, then current `fetch`/`check_rule`; unreadable historical puts suppressed (no del); missing current rows become del; synthetic scope on drained catch-up.
- `snapshot_page` / `groups_now(..., now)` rechecks per page; expired groups are not resumed from the cursor.
- `asset_access_request`: Range/read rule, no `once` consume; host `respond_checked` + `ExactReader` finalizer after a successful full transfer; `_transfer` serializes `(id, principal)`.
- `insert_mode` / `check_constraints`: `live_lookup` + `visible_collision` preserves hidden `E_RULE`; expired ids can be replaced.
- `_asset_gc` reservation in `stage_stale_assets` / `claim_asset`; ordinary `release_asset` still allows a move until GC reserves.
- Scan meter cut keeps the observed partial aggregate and key, `complete` is false, continuation is emitted.
- `respond_checked` poisons sequential writers before the current writer drops.
- Admission, HTTP phase timeouts, and auth rate/KDF slots remain on the security path.
- Ceilings were not changed by the resolutions.

Static review only; no tests were run.

## Final correction review — c30a517d7 — Grok

Received from a fresh, mutually blind `grok-4.6` xhigh CLI session. This review covers the expired-predecessor/renewal and obsolete-authentication read/write corrections at the immutable checkpoint named below. The separately reproduced concurrent-sign-out classification correction follows in its own final delta review.

No material finding remains in the reviewed scope at `c30a517d7cbb7429295a0708bee33b51b5534a94`.

Static-only pass over both corrections as they exist at that commit (no tests, no later worktree edits).

**Correction 1 (expired predecessor vs live renewal).** `memberships_before` supplies the last join/scope at the watermark. A following replacement join therefore still reconstructs the prior span; `expand_joins` emits that span’s `scope` before `group_at` acquisition when the replacement commit is at or after the old deadline (`partition.rs` 485–487, 624–628). Device apply is vector order, so that `scope` lands before the new puts. A live same-audience update skips the logged `scope` (`renewed`, 196–201) and does not synthesize one (`commit at < old expiry`). Shortening to an already-elapsed deadline still logs `scope`. Delivered-history `leave` stays a no-op; the stream still rewrites puts with current visibility.

**Correction 2 (obsolete `E_AUTH` after rotation).** `obsoleteAuth` is `E_AUTH` that did not kill the session (`local.ts` 388–390). Writes hit `retryFlush` on that flag and do not `settle` (724). Reads wait on `refreshing` when present, then retry with current headers (589–594). Current-revision `E_AUTH` still runs `endSession` (`rotating` false). Refresh waits for current-revision `syncOnce`, then `void rerun` under the existing running/dirty coalescing (361–365, 648–668). Close is rechecked after the wait via `unavailable()`.

## Request-revision correction review — 0c21402ed — Grok

Received from a fresh `grok-4.6` xhigh session, mutually blind with the corresponding Sol review. Only immutable supplied source and regression context was reviewed, without tools.

**No material finding remains in the reviewed scope at `0c21402edaa23381d42d94edb915d73762ecaebe`.**

This is a static-only review of the request-revision correction. The moved expression matches the intended obsolete-vs-current split, and the two immediate callers keep the right settle/retry outcomes on the interleavings in scope.

The old `E_AUTH && !sessionDead` bit was not a request identity. `endSession` sets `sessionDead` for *whoever* won the current-credential refusal, so a later reply that still carried the old bearer could be treated as live. The replacement uses the request’s captured revision plus the in-flight rotation flag, and it is read before `await refusedSession(...)`. That await is required: `endSession` bumps `credentialRevision` (and clears `rotating`) synchronously, so evaluating the new formula *after* the handler would mark the current request’s own `E_AUTH` obsolete and skip a terminal settle.

Interleavings:

- **Successful rotation.** Start of `refreshCurrent` sets `rotating` and bumps `credentialRevision` before the new bearer is installed. An in-flight post therefore sees `request.revision !== credentialRevision` and/or `rotating`. `flushOnce` retries instead of `settle`; the query loop waits on `refreshing` and retries. After the replacement token is installed, a matching-revision, non-rotating `E_AUTH` is current: `obsoleteAuth` is false, `refusedSession` ends the session, and a mutation at that revision may settle as failed.
- **Failed rotation.** Failure bumps `credentialRevision` again and only then may `endSession`. Stale replies remain revision-mismatched, so they stay obsolete and do not settle. A later post at the post-failure revision is classified independently; a real current `E_AUTH` can still end the session.
- **Concurrent session end (the new regression).** Order: old `/m/send` is in flight at revision *R* → rotation installs the new bearer → a current-revision `/q/remote` `E_AUTH` runs `refusedSession` → `endSession` → the held old `E_AUTH` arrives. Classification is already `obsoleteAuth === true` from `request.revision !== credentialRevision`. `flushOnce` takes `retryFlush()` and does not `settle`. `retryFlush` no-ops once `sessionDead` is set, so the outbox row stays pending. The current query still signs out: its own `obsoleteAuth` is false.

`|| rotating` is load-bearing for the window where a post is captured *after* the mid-rotation revision bump but *before* the second bump and `rotating = false`. In that window the revision matches and the wire token is still the old one; `refusedSession` already refuses to kill the session while `rotating` is set. Treating that `E_AUTH` as obsolete is the same rule, not a new one.

No other surface was reviewed.
