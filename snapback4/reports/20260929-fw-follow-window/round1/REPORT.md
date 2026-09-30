# FW round 1 — Following intent at every custody entry

Round 0: `a3a0c76744`. Merged `origin/main` at `fc8deceab4` first, in local merge
`882d25763b`, keeping FW's Following gate and main's pending/existence/read-work
changes. The merge conflicted in `local.ts`, `local-query.ts` and
`delivery-await-boundary.json`; the latter was regenerated through `awaitBoundary()`.
Nothing is pushed or published.

## Findings and changes

Read both reviews in full. Astra's P1 is reproduced: a tab adopting another tab's
pending follow/unfollow had no call-turn marker, and the existing outbox event
only notified pending-write listeners and started delivery. Its mounted Following
answer could remain complete and fresh until an unrelated read or sync woke it.
Grok's viewer check was also broader than this reader's intent.

Both browser hosts now report the committed entries with their existing outbox
notification. The client synchronously invalidates affected Following observations
before pending-write listeners or delivery can run. That includes ordinary
admission, orphan adoption and journal recovery. Restoring a committed image after
a lost persistence reply also reports its entries, even when recovery writes no
new outbox change. A restarted process has no mounted answer yet: its first read
continues to consult durable custody. No second durable queue or polling is added.

The publication check and recovered-entry invalidation both require
`entry.viewer === currentViewer`. It still applies only to reads touching a
timeline's Feed, Edges or Work, and mutations whose compiled static tables include
that timeline's edge source. Unknown/native footprints retain the pre-existing
conservative rule. Posts, likes and removals do not qualify just because they
can affect the feed. Disjoint reads retain their completeness.

The merge also requires recomputing main's derived `existence` when FW changes a
read's completeness; otherwise an incomplete empty fallback could retain an
`absent` discriminator. The Rust engine, `contract.ts`, storage format, authorization,
horizons, epoch filtering, immediate 50-event copy and 1,000-event window are
unchanged by this round. `local.ts` remains at 1,500 lines. The feeds card remains
401 lines and explains recovery plus the complete empty page for a quiet author.

## Causal evidence

Final dedicated regression: **24/24 pass**, no skips/cancellations
(`logs/final-causal.log`): round 0's eight frozen-clock cases plus sixteen new
cases. Tests run through the existing package inventory; tools stay under this
report. `tools/README.md` documents controls and setup. A separate final audit
probe, `tools/refusal.test.mjs`, also passes **1/1**: after recovered custody has
published incomplete data, a terminal self-follow refusal restores completeness
without an application query or sync publication (`logs/recovered-refusal-stable-before.log`).
The existing settlement invalidation already handles it; no additional product change was needed.

| Case | Devices / evidence | Result |
| --- | --- | --- |
| Adopted follow and adopted unfollow | Four independent Chromium tests: two tabs of Bob, real IndexedDB/Web Locks/wasm, both browser adapters. Keeper stays mounted, donor queues offline then closes; transport and sync held; synchronous custody snapshot and subsequent publications checked | Marked/incomplete through receipt, then Alice's one post or a complete fresh empty page |
| Post, like, remove while Following is mounted | Wasm and process, at call and while transport is held; direct and mounted reads plus disjoint `postState` | No edge-intent mark; complete, unmarked answers. Ordinary prediction/apply revalidation remains |
| Follow an author with no posts | Wasm and process; mutation and apply held independently | Ends complete, fresh, empty |
| Follow then unfollow before first apply | Wasm and process; both durable entries asserted before releasing first transport | Ends complete, fresh, empty; no complete intermediate Alice page |
| Offline follow | Wasm and process; queue offline, reconnect with transport held | Ends complete, fresh, with Alice |
| Queued process restart | Actual process/SQLite close and reopen with durable follow retained | Incomplete offline and before send, then complete/fresh with Alice |
| Principal reuse after sign-out | Both stores reopened for Carol; inspect the actual retained Bob entry and evaluate the gate for each viewer | Bob still gated; Carol not gated or invalidated. Separate replica principal fence remains |
| Restore after lost save reply | Real wasm host; persistence commits an edge then throws, reloads durable image without another write | Mounted feed invalidated synchronously; delivery converges to Alice |

Negative controls are retained, not inferred:

- Actual round 0 SDK: **four adoption failures**, independently covering both
  directions and adapters (`logs/round0-adoption-control.log`). The failure is
  the unmarked snapshot at the custody callback, before any query can repair it.
- Actual round 0 SDK: **two viewer failures and one restored-image failure**
  (`logs/round0-control.log.gz`). The other nine Node scope/liveness cases pass
  round 0: those review items were coverage gaps, not existing behavior failures.
- Select every timeline for every mutation: **both scope tests fail** at the
  post's call-turn mark (`logs/scope-mutant.log.gz`).
- Never retire an edge call: **both empty-author tests fail** their deadlock
  guards (`logs/liveness-mutant.log`).

All **66** round 0 report/tool/measurement files were compared with the round 0
commit and are preserved byte-for-byte. Its 160 fixed transitions,
zero misleading publications (313 baseline), zero timeouts, every-stage p50/p95
and limitations remain in `../REPORT.md` and `../summary.json`. They cover calls
made by that device; this round adds causal adoption/recovery evidence and makes
no new latency claim or expanded measurement claim.

## Orientation and design

Used `llp-orient`, scoped to Following publication and outbox recovery. Governing
context: LLP 3000 root and LLP 2000.000 design brief; LLP 3000.016 §2.2/§2.3 and
§Own edge publication; LLP 3000.023 §10 for retention, bounded change evidence and
publication revisions; LLP 3000.026 §4 for the unchanged atomic launch boundary.
Root and .023/.026 are in `llp/current/`; .016 is implemented. No Snapback 4
foundation overlay applies here. Read the current feeds guide before editing.
LLP 3000.016 now records custody entry and viewer scoping. No new LLP or hand-off.

## Validation

- Whole guide: **105/105 pass**, no ignores (`logs/guide-final.log.gz`).
- Await classification: **1/1 pass**, regenerated with `awaitBoundary()`;
  no new asynchronous delivery boundary (`logs/await-boundary.log`).
- Docs budget and final SDK build pass. Ref check: **525 LLP docs, 9,970 refs,
  0 errors, 0 unchecked** (`logs/ref-check.log`).
- Wasm: **1,978,828 B raw / 593,295 B gzip**, 424 B under the unchanged
  **593,719 B** ratchet (`logs/wasm-build.log`). No budget increase.
- Affected integration: **138/138 pass**, no skips/cancellations (`logs/affected.log`).
- Full client inventory: **5,308 pass, 0 fail, 0 cancelled, 10 existing skips**,
  including all 24 Following cases. Rust: **4,362 pass / 33 declared ignores**;
  fixture wrappers: **9/9 pass**. Serial models: **79/79 pass**, including both
  5,000-sequence session walks, without reduced counts or timeouts.

Ran `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`
**exactly once**, exit **0** (`logs/test-sh.log.gz`, `logs/test-sh.exit`). Exact summary:

```text
== 0 failure(s) in 1293 s
```

Full-suite failures: **ours 0; baseline 0; environmental 0**. No product source
changed after the full run began. The separately run refusal audit added no
product change. The inherited nominal 60-second process bar remains exceeded;
no model count, timeout or assertion was relaxed. Round 0's full-suite red stays
in its own record; this round's integrated await classification passed inside the
full run as well as the targeted assertion.

## Failure ledger

Expected detecting controls above are product defects in round 0 or deliberately
introduced mutants, not failures of the final implementation. The full suite has no failures to attribute.

Development failures retained under `logs/`:

| Log | Attribution | Failure and disposition |
| --- | --- | --- |
| `sdk-build.log` | Ours, merge integration | TS2322 from changing `complete` without recomputing main's new discriminated read state; TS7006 on the merged callback parameter. Both corrected; final build passes |
| `recovery-first.log`, `scope-debug.log`, `recovery-debug.log` | Ours, harness | Initial non-edge probe assumed a sync/publication path identical to an edge and waited under frozen host timers. Abandoned hung probes were terminated; the final test explicitly syncs after settlement and holds causal transport boundaries without freezing Node's timers. Round 0's eight frozen-clock cases remain intact |
| `adoption-first.log`, `adoption-debug.log` | Ours, harness | Donor initially owned the base store rather than an adoptable alternate; its keeper could not adopt. Corrected tab roles; the first guarded run reports a browser deadlock |
| `adoption-causal.log` | Ours, harness | Both tests counted a publication before custody as an adopted-intent failure. Trace now starts at the custody event |
| `recovery-causal.log.gz` | Ours, harness | Two tests expected a reused principal's offline replica to answer, overlooking its separate principal fence. They now inspect the real retained outbox and exercise viewer-scoped gating without bypassing that fence |
| `round0-control.log.gz` (browser portion) | Ours, harness sensitivity | Both early adoption controls passed because background polling could mask the missing callback. Final tests discover the live donor, hold positive-delay timers, and assert at the callback itself; all four independent round 0 controls fail |

Two scratch-edit commands used a repository-relative path from `snapback4/` and
reported `FileNotFoundError` before editing; rerun from the correct directory.
No product test, timeout, count or assertion was weakened to accommodate a failure.

Three diagnostic logs with trailing whitespace, both guide logs and the complete
full-suite log are gzip-compressed without changing their decompressed bytes. The final staged
whitespace check passes. Source, artifact and harness hashes are in
`qualification.json`.
