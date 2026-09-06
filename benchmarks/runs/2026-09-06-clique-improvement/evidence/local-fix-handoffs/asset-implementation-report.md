# Asset pending quota implementation report

**Status:** implemented and committed in the requested isolated lane. Source-level affected verification and local public-owner witnesses pass. The full Clique outcome objective remains open; this is not benchmark, publication, native-device, endurance, or total-physical-storage qualification.

**Implementer:** Astra, this lane; no subagents. **Date:** 2026-09-06.
**Worktree:** `/Users/ccheever/projects/snapback-worktrees/clique-asset-pending`.
**Branch:** `s2/clique-asset-pending`.
**Base:** `4b87d8bd90d4a8a466a3b91a011216844c90b0f8` (initial worktree clean).
**Commit:** `3e923878783afbf4b25556cae3e4683d3481a6ee` — `Fix pending asset quotas after successful releases`.
**Tree:** `52948feac2949a94623a44c9aae5ecb99e7517f8`. Final worktree clean. No fetch/rebase, main push, or publication was performed.

## Decision and scope

[Root's explicit decision](root-decision.md) supersedes the original proposed release-admission redesign. I read the root and Snapback 2 AGENTS, both rules files, LLP 1000, the relevant LLP 1006 authority/admission/lifecycle/quota sections, LLP 1012 §7's replay contract, the current operator/offline guides, and the scoped ledger/owner/client/test code before implementing. [context-pack.md](context-pack.md) records the read-only LLP orientation.

I read only `review.md`, `findings.json`, and the original `policy-design.md` in the named independent review directory. The rejected design SHA-256 is `919cb51431bb5c2253b744a31fcb6d6eb29a04f516fcaa8708fc308ff9801f4c`. Neither that design nor its review was modified. No peer approval is inferred: root's fresh immutable-code reviews remain separate work, and the earlier Grok final-design delta review was outstanding in the supplied decision.

The repair removes successful releases from pending-object admission. It preserves the existing original-byte admission selection, production constants, finalized-growth reservation, full 24-hour grace, creator isolation, affine identity, transactional reconciliation, replay/disposal boundaries, derived widths, once-view history and fork referrers. It introduces no release/replacement/reset capacity refusal, garbage envelope, charge floor, metadata budget, new quota setting or schema migration.

## Actual classification and code change

The classification comes from `assets_ledger.rs` and owner custody code, rather than assuming every unlocated row means a pending upload:

| Durable row | Pending object slots | Original-byte admission charge |
|---|---:|---:|
| Located/claimed | 0 | 0 |
| Unlocated receiving, including reclaiming cancellation custody | 1 | `max(staged_bytes, finalized bytes or 0)` |
| Unlocated ready, no release time, not reclaiming | 1 | Same original-byte charge |
| Unlocated ready, release time present, not reclaiming | 0 | Same original-byte charge |
| Unlocated ready tombstone or failed row | 0 | 0 under the inherited query; physical cleanup may remain |

Claim clears `released_at`; release sets it. Same-cell retention does not perform either transition. The existing byte-query WHERE predicate and byte SUM remain unchanged. Only the count aggregate now selects receiving rows or rows with null release time within that existing selection. Receiving cancellation still owns a slot while the finalizer/staging file remains in custody. Ready tombstones and failed rows retain their old admission exclusion, explicitly recorded as a physical-custody limitation.

The constants remain **20 objects / 256 MiB per creator and 40 / 512 MiB per owner**, with **86,400,000 ms grace**. Admission checks and original growth reservation still reject at those byte ceilings. The totals are recomputed from durable ledger rows; restart needs no process counter or backfill. Ordinary release can still create an over-admission-budget store, and destructive reset retains its old availability. A new core regression deliberately releases beyond a creator's byte ceiling and then resets successfully.

`enforce_staging_caps` now reports which resource refused: pending objects or charged bytes, creator or owner. Messages explain retained released-original bytes and avoid promising immediate physical cleanup. The existing `E_ASSET_TOO_LARGE` / input family and operator recovery page remain. Only caller-owned usage and configured owner limits are exposed; no exact foreign or aggregate owner usage/headroom was added. Finalized-growth errors use the same byte-admission terminology.

`listUploads()` continues listing only the caller's unlocated receiving/available-ready rows, including releases. The existing 100-row page and `after`/`next` behavior are retained. Additive `releasedAt` and `reclaiming` fields describe the rows; the current client validates and types them. `usage.objects` means pending slots across all pages, whereas `usage.bytes` includes released originals. It is intentionally possible to list 40 released rows with zero pending objects. Old clients accept additive fields; the new client/guide is intended to travel with the source owner exposing these fields. This work did not qualify a new client against an older owner.

Product implementation changes are confined to the ledger, upload-listing client types/validation, and existing refusal wording. [source-receipt.json](source-receipt.json) proves that the limits block, validation/reconciliation/release/reset region, and discard/reclaim/finish region are byte-identical to base. Store schema, engine/replay, successors, owner asset worker/GC/blob implementation and outbox custody files are also unchanged.

## Regression and public-owner evidence

The first core run is retained in [core-pending-first.log](receipts/core-pending-first.log): 1 pass, 4 failures. Its central regression observes **40 pending objects rather than 0**, with **2,000 bytes unchanged**, after 43 claims and 40 releases. Other failures include the new expected diagnostic labels. These were observed before the product patch, not a reconstructed old failure. The 204,800-byte first-failure database is retained; an immutable read-only inspection confirms 43 assets, 40 unlocated/released and 2,000 unlocated original bytes (path/hash in [cleanup-receipt.json](cleanup-receipt.json)).

Final selected receipts contain **187 passing test cases** (Node counts include nested subtests; repeated exploratory runs are excluded):

| Scope | Result | Wrapper elapsed | Evidence |
|---|---:|---:|---|
| Core asset regressions | 30 pass | 9.850s | [receipt](receipts/core-assets-final.json), [log](receipts/core-assets-final.log) |
| Owner custody/GC/protocol | 19 pass | 6.051s | [receipt](receipts/owner-custody-tests-fixed.json), [log](receipts/owner-custody-tests-fixed.log) |
| Owner asset HTTP integration | 11 pass | 55.860s | [receipt](receipts/owner-asset-http-tests.json), [log](receipts/owner-asset-http-tests.log) |
| Client asset/native-mock/outbox/once custody | 120 pass | 8.737s | [receipt](receipts/client-asset-custody-tests.json), [log](receipts/client-asset-custody-tests.log) |
| Public 43 claims / 40 releases / bytes / restart | 1 pass | 8.436s | [receipt](receipts/public-release-byte-witness.json), [log](receipts/public-release-byte-witness.log) |
| Public pending caps / 21 replacements | 2 pass | 9.949s | [receipt](receipts/public-caps-replacements-final.json), [log](receipts/public-caps-replacements-final.log) |
| Public media replay controls (ready owner) | 3 pass | 4.144s | [receipt](receipts/public-media-replay-controls-ready.json), [log](receipts/public-media-replay-controls-ready.log) |
| Public definitive-refusal cleanup control | 1 pass | 5.635s | [receipt](receipts/public-definitive-refusal-control.json), [log](receipts/public-definitive-refusal-control.log) |

The new core cases cover mixed receiving/never-claimed ready creator and owner saturation, creator isolation, retained release byte ceilings and growth refusal, receiving/ready tombstone classification, identical/conflicting finalization reservation retries, restart, release beyond admission budget followed by reset, full grace boundaries, exact ID re-claim, and once history surviving until final reclaim. Existing affected asset tests cover scalar/list/optional reconciliation, affine reuse refusal, argument/column facts, migration clocks, reset and cancellation. The owner tests add real HTTP and physical-file controls, including paused sockets, finalizer unlink failure retry, original/rung fork retention and the publish-to-ready crash window. Their passes do not close the distinct custody defects below.

The public witness is a tiny committed Quarry fixture at `snapback2/packages/snapback2/tests/fixtures/asset-pending/`, driven by supported `createClient`, upload/mutation/list/discard/query/delivery APIs. It is not a benchmark application or modified benchmark input. Its authored image bound is 256 MiB solely to exercise the unchanged production byte-admission ceiling through a header-only refusal; it sends small fixture PNGs for successful uploads.

The final release witness establishes:

1. 43 automatic File uploads become 43 distinct claimed IDs, despite identical bytes. Claimed usage is zero.
2. 40 successful authored releases leave 3 original live rows and **40 listed releases, 0 pending objects, 6,240 charged bytes** (40 × 156 finalized bytes; the input PNG is 118 bytes). A fresh account sees zero own usage and no foreign rows, and cannot discard another creator's ID.
3. A request declaring 268,435,456 bytes is refused **HTTP 422 before body upload**, with `E_ASSET_TOO_LARGE` identifying the existing 6,240-byte charge. No 256 MiB buffer or physical upload fixture is allocated. This proves byte admission still sees the released originals; core arithmetic separately exercises the global byte ceiling.
4. Restart preserves the entire listing, release clocks and every original's SHA-256. A fresh account uploads a new small image. The original creator re-claims the exact released record and gets the same bytes; the three original retained rows stay live.
5. Separate public controls reach the true 20/creator and 40/owner never-claimed caps, including a committed return-only operation that does not claim its asset. Twenty-one successful replacements produce **0 pending objects and 3,276 charged bytes**.

[witness-receipt.json](witness-receipt.json) extracts the observed listing/refusals and binds their logs. The retained original SHA-256 is `c397de92662ce9581afea82cfcd9010a17b688096c8c8f88c1f923f4b965c54e`. This fixture's 6,240 bytes are not the original investigation's asserted 6,204-byte fixture. No earlier witness/benchmark failure is retroactively relabeled passing.

The replay controls passed against a verified ready owner of the same disposable chat fixture after the self-started file timed out: persistence failure retains media, a lost committed response does not discard the claimed ID, and queued media survives to replay commit. The separate 24-definitive-refusal control confirms automatic cleanup remains distinct from successful release.

## Failures, bounds and build provenance

Every execution receipt includes its exact argv, cwd, PID, timeout, elapsed time and exit code, with full stdout/stderr in the adjacent log. [test-receipts.json](test-receipts.json) indexes them. Prior failures were never overwritten:

- Core baseline: exit 101, 4 expected regressions / 1 passing control.
- First package build: exit 124 at the original 60-second wrapper while Rust was compiling. A retry within the same bound reached the guide validator and failed because the offline page exceeded its existing 4,352-byte budget. Concise text then passed at 4,341 bytes; the budget was not raised. The successful full package build, including TS declarations and guide validation, took 10.658s.
- First public witness: missing `await` on the async `assetUrl` in new test code, followed by the unchanged 10-second file timeout. Its recorded owner survived; the next attempt hit that own occupied port. PID 39347 was stopped explicitly. No other lane's process was touched.
- Expanded combined witness: the byte probe plus restart/replacements hit the original 10-second bound and left recorded PID 44782; it was stopped. The probe now closes its connection, and independent replacement coverage is in the separate cap test file. Assertions remain; no timeout or quota was increased. The final caps/replacement runner took 9.839s, close to the 10-second file bound, so this is not a steady-state performance qualification.
- Initial nextest invocation used `-j2` and `--test-threads=2` together; nextest rejected the duplicate option before testing. The corrected invocation uses `--build-jobs=2 -j2`.
- The self-started real-owner replay control file timed out at 10 seconds. A subsequent attempted connection found that owner had already exited and produced network/subscription failures. The same fixture was then explicitly reopened, PID/ready URL/listener verified, and the unchanged 10-second tests passed. These initial failures remain harness/availability evidence, not passing product tests.

The primary warm target was inspected and copied with APFS `cp -cR` into this named worktree's own `snapback2/target`. No shared target or another lane's source/build was mutated. Rust builds used `-j2` or nextest `--build-jobs=2`; HTTP integration execution was serial to honor the port allocation. The source engine build took 122.547s within a 300-second build bound. Fast tests retain their original HTTP/socket/subscription and Node 10-second bounds. No remote M5, v1 Ibex bootstrap, browser, simulator, or physical device was used.

Actual executed hashes:

- Source engine: `9c90fbdba98612d9424798e4ec6af7873f9f6f4470dfc7151330d0a0c881cea6`.
- Client bundle: `a1b6f9226a9d5237063849aa9b0607a820be4494d33372552101df65904c6599`.
- Reused debug media helper: `7bcbda3b321887aac79529ca831b792fd319610b847369cfa49633854db183f4`.

The engine and local ignored client/compiler bundles were rebuilt in this lane. The media helper was reused from the copied primary warm target; its actual hash is recorded, but no fresh helper build, production artifact provenance or media-format qualification is inferred. Published package files and versions were not edited; no npm publication ran.

## Docs, open work and qualification limits

LLP 1006 now records the actual count/byte contract and distinguishes admission from physical custody. Operator/offline guidance explains release rows, cancellation, creator-only usage, 24-hour eligibility and the fact that replay grants/row leases do not pin server uploads. The diary records the build experience and exact failure history. Every changed source file is under 1,500 lines; LLP 1006 is 1,497 lines. Final `caps` and `ref-check --verbose` pass (0 errors, 0 unchecked references). `git diff --check` is clean. No v1 inventory/bootstrap workflow or full benchmark/loop measurement was applied; the entire workspace battery was not claimed.

`issues/20260906-snapback2-asset-custody-gc-follow-up.md` keeps the independent review's concrete inherited work open:

- Ready/failed admission credit before physical deletion, including fork-held cleanup.
- Reset staging unlink before seed/core transactional validation and worker custody handling.
- Full live/fork materialization and directory traversal, with blob deletion errors aborting sibling settlement.
- Rung/once completion races against final GC and untracked scratch cleanup failures.

Review F1/F2 are rejected policy changes, not waived defects. F3's newly proposed capacity-refusal ordering trigger is avoided, while inherited reset ordering remains open. F4's proposed exact headroom disclosure is not implemented. F5 is explicitly unqualified. The original reseed/benchmark ticket remains open for causal attribution and full Clique verification.

No broader custody redesign was necessary for the observed pending-slot fix. Broader work is necessary before anyone can claim a finite failure-inclusive physical envelope, bounded whole-sweep latency or complete cleanup/worker correctness. None is claimed here. Full superior Clique outcomes, independent immutable-code review, integration, publication and any original benchmark rerun remain root's subsequent work.

## Cleanup and delivery

[cleanup-receipt.json](cleanup-receipt.json) records **25 launch-recorded owner PIDs**, all absent at final inspection. Only ports **52000, 52001 and 52002** were used; the final `lsof` check for 52000–52009 returns exit 1 with no listener output. The own-port collision above is retained as a failed attempt. Successful harnesses removed their temporary projects; three remaining owned public-test projects were removed after owner exit. The first-failure core database and the isolated warm target are deliberately retained. No benchmark DB was reset or removed.

The coherent code/docs/tests commit is local to this branch. [source-receipt.json](source-receipt.json) records all 19 changed file hashes/Git blobs, protected source comparisons, executed artifact hashes and the clean final status. [source-before.json](source-before.json) binds the original decision/review inputs and clean base. `phase.json` marks lane implementation complete with the broader qualification explicitly open. `final-answer.md` is a separate concise handoff and does not replace this report.
