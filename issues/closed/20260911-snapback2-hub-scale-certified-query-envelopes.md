# Snapback 2 hub-scale reads: exact final digest eligibility

**Status:** Resolved
**Priority:** P1
**Date:** 2026-09-11
**Systems:** Snapback 2 Quarry certifier (LLP 1001, LLP 1010 A5 merge), Clique brief envelopes
**Related:** [closed/20260906-snapback2-following-feed-merge-ceiling-under-brief-envelope.md](./20260906-snapback2-following-feed-merge-ceiling-under-brief-envelope.md) (500-follow 20-row merge, resolved); `benchmarks/briefs/social-messenger.md`

## Resolution — 2026-09-12

The read forms and exact final-time digest now compile and pass scoped owner
controls. The reopened digest gap is resolved by fresh per-user attempts with
transactional invalidation and a final current-source recount; the earlier
counterexample remains below as the regression this repair closes.
The interim globally ordered search helper and its measured request cost
remain shipped; [LLP 1024](../../llp/1024-single-lane-delivered-search.rfc.md)
owns its one-lane successor. This program's grouped-search form does not use
that client merge.

The corrected form is published in **0.0.30**. Both fresh final reviewers
cleared `05b71a4181`; source landed at `f47f667c7e`. Both native platforms
qualified the same shim and all three registry integrities were verified.
[Release evidence](../../benchmarks/runs/2026-09-12-snapback2-hub-digest-0030/README.md)
retains the source, tests, certificates, received verdicts and publication record.

## Symptom

Two independent Astra Clique lanes on published `snapback2@0.0.24` and `0.0.25` (expo-build-1000, 2026-09-11) could not certify the brief’s hub-scale reads. The 500-follow feed fix did **not** cover these envelopes. Builders shipped workarounds (smaller pages, client-side merges, chunked jobs) and still marked M8 green.

| Shape | Refusal (representative) | What compiled |
| --- | --- | --- |
| 1,000-follow Following merge | closure ~6.3–6.7 MiB > 4 MiB (`E_BOUND`) | declared 500-follow envelope |
| 1,000-chat global message search | closure ~16–32 MiB, heap ~20 MiB > 8 MiB | 100-chat server query + client head merge |
| 50-row composite conversation view (author/quote/reactions/receipts) | heap ~18.5 MiB > 8 MiB; 256 live-shape ceiling | 10-row composite; raw history kept at 50 |
| Digest over 500–1,000 follows / 1,000 memberships | heap ~12.7 MiB > 8 MiB and closure 4 MiB | compact per-period cells + chunked emission |
| Directory backfill of 100 | `E_STEPS` ~2.25 M > 1 M | chunks of 25 |

## Evidence

Remote on expo-build-1000:

- 0.0.24: `/home/ccheever/clique-ri-20260911/lanes/astra-snapback2/evidence/m2-bound-1000.log`, `m8-search1000-check.log`, `m8-thousand-memberships-check.log`, `m8-split-digest-check.log`; run-log epochs `1789163102`, `1789170020`, `1789170456`.
- 0.0.25: `/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/evidence/check-m4-composite*.log`, `check-m5.log`, `check-search-batch.log`, `check-search-batch-cursor.log`; run-log epochs `1789163777`, `1789165975`, `1789167250`, `1789168962`, `1789170312`.

Local run records: `benchmarks/runs/2026-09-11-clique-astra-snapback2-0024-linux/`, `benchmarks/runs/2026-09-11-snapback2-0025-clique-linux/`.

Also: `held_search` `E_ARGS_TYPE` and dynamic merge `E_QUARRY_SYNTAX` blocked the 1,000-lane search rewrite; keep those as diagnostic quality on this ticket or split if the envelope work does not need them.

## Requested outcome and acceptance — corrected 2026-09-12

Implement [LLP 1023.001](../../llp/1023.001-hub-scale-certified-reads.plan.md)
without changing frozen instrument f40559f37722c79178be664a11f8a6485f1508fd.
The earlier requested brief reduction is rejected. The named u0500 probe has
500 follows and 100 conversations; u0001 actually has 100 groups plus 900 DMs.
A 1,000-follow query, 50-row rich page, and 100-row backfill are builder-selected
spellings, not exact required spellings.

Required: a 500-follow+self enriched feed; grouped search reaching all 1,000
memberships; full author/quote/reaction/receipt history through valid smaller
pages; complete server-driven digest across the population. Do not stop discovery
at the first 100 or require an invented client merge. Independent pages carry
independent snapshots and receipts. Final digest emission must exclude currently
revoked, deleted and expired contributions, including changes after earlier
chunks, and remain logical-once across restart. A documented gap leaves this
ticket open.

The historical refusal numbers above remain observations from the named apps,
not universal platform ceilings. The 256 live-shape limit is subscription
admission, distinct from certificate heap/output/closure limits.

## Current-source investigation — 2026-09-12

The rich message schema retained from the 0.0.25 app was copied into the existing
quarry-fanout-guide fixture. Current-source probes, without ceiling changes:

| Form | Current certificate outcome |
| --- | --- |
| Original-media 500-follow+self enriched feed, last 20 | closure 3,428,749; heap 4,216,301; output 90,652: admitted after retained-merge repair f7273a41f6 |
| 1,000-lane message search, last 20 | heap 20,407,874; closure 17,543,326: refused |
| Rich 50 with author, quote, 50 reactions and 50 receipts | output 4,178,012: refused |
| Membership page 10, one search preview per group | closure 344,839; heap 393,355: admitted |
| Separate per-chat search page 20 | closure 245,232; heap 271,124: admitted |
| Full rich page 5 | closure 417,345; heap 1,724,224: admitted |
| Existing same-transaction digest enlarged to 1,000 memberships | heap 12,525,666; closure 13,748,664: refused |
| Digest maintained key reduced to membershipId,periodStart | heap 9,922,666; closure 8,683,664: refused |

The compact-key reduction preserves selection but is insufficient. Its public
count absence reserve alone is 2,531,718 bytes. System visibility and persisted
contributions cannot by themselves establish final eligibility. Existing
periodUnread contributions require deletion/expiry maintenance as well as
membership-incarnation checks.

Executed consumer result: the existing real-owner test passes in 27.096 seconds
(28.431 seconds including the harness). It covers the original enriched feed,
all 1,000 memberships after 99 empty slices and a final-slice-only match, 125
tied-time messages through distinct message cursors, full rich continuation,
warm/cold held reads, live insert/edit/delete boundary rebuilding and membership
revocation. The shipped fanout card's grouped-search consumer is executed
verbatim. All 18 affected compiler fanout checks plus packaged guide discovery
pass; the package builds with 97,853 / 98,304 guide bytes.

Digest kept this ticket open at that checkpoint. An executed negative witness closes both clients,
completes the old 500-follow accumulation, deletes one contributing post, and
restarts the owner. Its maintained source count becomes zero, while the cached
total remains 500 and the job remains done. This does not qualify final emission.

The retained app's compact authored counters do not resolve that gap:
periodUnread has no expiry provenance; clearSeat removes only the current and
previous periods, without a period cap covering paused older work. Cached
postDigestContribution values need final deletion/expiry validation. Current
[writer_timers.rs](../../snapback2/crates/snapback2/src/writer_timers.rs) processes at
most 64 due timers before [writer_jobs.rs](../../snapback2/crates/snapback2/src/writer_jobs.rs)
runs a job chunk, without proving that all due expiry work has drained. Thus
timer-driven decrement alone cannot establish exact eligibility at emission.
This is source evidence for the remaining expiry gap, not an executed expiry
qualification. No new read model, ceiling or reduced population is selected.

Precise source/probe/log locations and cost terms are in the child plan's
implementation record. Publication and the full Clique wave remain separate
work; the digest requirement was still unmet at that checkpoint.

## Exact digest completion — 2026-09-12

The compiled fanout fixture now buckets application writes from the owner's
clock, records append-only period and recipient revisions, and processes each
recipient through fresh bounded jobs. Unread contributions retain source, exact
membership incarnation, send time, expiry and a monotonic conversation send
sequence. Read marks bind the current membership incarnation and sequence, so
equal millisecond timestamps cannot invert commit order. The sequence high-water
mark never decrements on remove/expiry; imports initialize it to at least the
largest persisted message sequence. The final transaction rechecks
eligibility/period revisions and earliest expiry. At the required 500-follow
population it recounts every current followed author's maintained period total
in that transaction; larger populations retain the complete chunk accumulator
behind the conservative period fence. Unique digest and log rows plus one
idempotent effect commit atomically, and zero activity only settles the run.

The real-owner regression runs with clients closed at the scheduled boundary.
It covers 500 follows, 1,000 memberships and 1,000 unread contributions; 900
expiries become due after accumulation and cross the owner's 64-timer turns. A
real membership leave follows the first unread chunk, a real post author deletes
a cached source, five same-target sends enter the next period, and the owner
restarts before the fresh attempt. Deterministic controls force equal persisted
timestamps for read-then-send and send-then-read and replace one membership
incarnation. The result is exactly 1 new follower, 499
followed posts, 99 unread messages and 98 unread chats, with one logged effect,
no zero-activity emission and no replay duplicate. The final chunk certifies at
3,221,762 heap bytes, 3,446,773 closure bytes, 31,461 steps and 1,515 examined
rows under the unchanged ceilings.

The copyable compiled project ships at
`dist/guide/recipes/exact-hub-digest/`; `guide fanout` states the finite relevant
change liveness condition. Same-target later-period messages have their own
revision key and cannot postpone a closed period. Permanent changes that affect that
recipient and period can continue to retry, because exact emission requires a
current point.

### Distinct final-counter check — 2026-09-12

This retained negative concerns a different recipe checked against 0.0.29.
The exact attempt/recount repair recorded here addresses its remaining
affordable-read and automatic-retry obligations.

One fresh compile against qualified 0.0.29 still refuses the compact final
500-follow / 1,000-membership fold: 9,922,698 heap bytes and 8,691,704 closure
bytes, before expiry validation. Its 117,835 steps fit. The earlier
2,531,718-byte count-evidence term was not the whole transaction.

An earlier prune plus a final guard also fails progress even with correct,
affordable counters: one message can expire between prune and emission.
`if` then skips the recipient; `require` parks the job until operator resume,
including across restart and later timer cleanup. A global guard also depends
on unrelated expiry. A complete recipe still needs affordable final reads,
atomic contribution maintenance and automatic retry of the same pending period.
This is a candidate-specific negative, not a language impossibility claim.
The [retained source assessment and probe](../../benchmarks/runs/2026-09-12-snapback2-1023-release-0029/digest-distinct-probe/assessment.json)
bind source hashes, exact command, costs and raw output. No runtime success
or new ceiling is claimed.

## Owner-stop followup — 2026-09-12

The integrated hub test at 71039e4a86 passed its data assertions but twice failed
its explicit restart boundary on 450b with E_OWNER_STOP_TIMEOUT (PIDs 3701292
and 3707138). A third ordinary run reproduced it with PID 3718298. The original
logs remain in /home/ccheever/snapback-1023-20260912/integration/ on that host;
the third is scale-stop/ordinary.log beside that directory.

The same prebuilt candidate owner passed on EPYC. Two 450b runs with a scratch
stop observer also passed, with six stops taking 169–234 ms. Their owner logs
show the digest job done before stop, and thread samples show the source watcher
briefly reaping its compiler worker. These controls did not justify blaming
unfinished fixture work or extending the two-second boundary.

The CLI had a concrete exit-observation race: wait_for_owner_exit observed true
to leave its loop, then called owner_process_exited again. The latter combines
signal 0 and a process-state probe; a supervisor can reap the zombie between
those system calls, so the repeated probe can return false after exit was
already established. That explains how a stop could report a two-second timeout
before two seconds elapsed, as also observed in the
[acquisition investigation](./20260911-snapback2-full-acquisition-and-foreground-send.md).
The repair makes the first observed exit terminal, keeping the deadline and
still-running refusal unchanged. Deterministic tests exercise an exit observation
followed by a false probe result, plus a genuinely running owner at the deadline.
The digest eligibility gap above remained open at that checkpoint.

Qualification: all nine owner unit checks and all three existing native stop
tests pass, including a genuinely surviving PID's timeout. The exact new
adversarial tests fail against a scratch copy of the old polling loop and pass
against the repaired loop. The complete 450b hub case passes in 36.635 seconds
(38.126 seconds including its harness), using the repaired scratch binary and
only a load-time binary-path override; no stop polling instrumentation is active.
The shared 450b source, dist and binary were not modified for that run.

Logs are /home/ccheever/snapback-1023-20260912/scale-stop/:
on EPYC, owner-unit.log, owner-stop-pinned.log, old-wait-control.log and
fixed-wait-control.log; on 450b, ordinary.log (failure), repro/ and repro2/
(process timelines and owner logs), and fixed-ready.log (repaired consumer).
No client runtime bytes or certified limits changed.

## Earlier main closure — historical record

The following was the prior resolution, not a claim that the subsequent
final-emission counterexample is solved. Existing main preserves its original
source history.

### Resolution (2026-09-11)


The brief and fixed certificate ceilings remain unchanged. `guide fanout` now
records a legal preserving form for all five rows:

- A narrow immutable `postHeads` table makes the viewer plus 1,000-follow lane
  merge certify for 20 winners. Compiled maximums are 48,752 output bytes,
  2,024,488 closure bytes, 1,605,760 heap bytes, and 50,180 steps. The fixture
  includes atomic create/edit/delete custody for post and head rows.
- Global chat search pages the whole current membership directory, fetches a
  certified one-row head from every conversation, and merges/refills those
  heads with the public `snapback2/global-search-pager` export. The helper
  walks all 1,000 scopes, limits concurrency, preserves descending order,
  suppresses duplicates, detects cursor cycles, serializes concurrent `next`
  calls, and propagates the weakest unusable receipt. The installed
  `dist/guide/recipes/global-message-search.ts` recipe binds the generated
  client API, branded cursors, captured term, Unicode-scalar comparator, pages,
  and issues.
  Search remains on the original membership-authorized message rows;
  held-search authority was not widened.
  This is the **interim client N-way merge**, not a one-lane scale result.
  The earlier LLP 1023.001 §C exclusion of client N-way composition does not
  describe this shipped close. On the unchanged 100,015-message Clique fixture,
  hub `u0001`'s `busy` term matches only in the final membership slice: the
  first 20 rows cost 1,030 HTTP queries (10 scope pages, 1,000 heads, 20
  refills), measured at 669/616 ms on localhost EPYC; an absent term costs
  1,010 queries/576 ms. The cost is now visible in the fanout card and recipe.
  [LLP 1024](../../llp/1024-single-lane-delivered-search.rfc.md) records the
  one-lane capability gap, measurement method, delivery-authority distinction
  and write-side price; it remains Draft. This close establishes a complete
  composition, not constant-request hub search.
- Rich conversation composites use a smaller continued rich page while raw
  history remains independently pageable at 50.
- Digest work uses maintained period cells and a resumable 50-row job chunk.
- Directory backfill uses resumable 25-row chunks through the entire table.

The `E_BOUND` and `E_STEPS` family recipes and merge/work repairs now point to
these population-preserving forms. No frozen benchmark brief or run packet was
changed.

### Historical validation

- Pinned Node 24.18.0 package build and pack: pass; 32 guide cards,
  97,979/98,304 bytes. The installed recipe is present in the packed file set
  and typechecks through the public client/pager exports against the generated
  fanout fixture API.
- Compiler suite: 307 passed, 0 failed, including the compiling guide fixture,
  installed consumer binding, and pager coverage/order/refill/deduplication/
  cursor-cycle/partial-state tests.
- `cargo test -p snapback2-core --lib -- --test-threads=4`: 187 passed,
  0 failed.
- Published self-reference import `snapback2/global-search-pager`: pass.
- Installed recipe equal-time ordering: astral, BMP, and shared-prefix IDs
  match the engine and twin's Unicode-scalar order.
- `./ref-check --verbose`: 450 LLP docs, 8,109 refs, 0 errors, 0 unchecked.
- `scripts/caps.mjs` still reports the two inherited Snapback 1 line-cap reds;
  every file changed here is below 1,500 lines.
