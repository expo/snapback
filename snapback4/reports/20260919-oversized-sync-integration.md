# Oversized-sync recovery integration, 2026-09-19

Merge of `origin/main` / `5df0d211a12ef3255a142685d064ae56d794aba3` into
`sb4/mc-prereq-51b7a134` / `0d4d60347`. The merge is resolved and staged;
no merge commit or push is authorized. Verification results follow below.

## Conflict resolutions

All nine files and 21 original hunks are accounted for below. Hunk numbers are
in file order in the saved conflicted files under `/tmp/f188-integration/`.
Crate paths are relative to `snapback4/crates/`; package paths to `snapback4/`.

| File / hunk | Resolution |
| --- | --- |
| `issues/20260913-snapback4-wasm-device-diet.md` 1 | Kept all three colliding dated entries from both sides, ordered by date; no budget change. |
| `snapback4/JOURNAL.md` 1 | Kept all 48 colliding entries and the unchanged common prefix; sorted the colliding entries by date and appended integration evidence. |
| `snapback4-core/src/engine/mod.rs` 1 | Added a shared-transaction `acknowledged_at_in` for main's event-cut/image-head split; retained the lane's single-cut wrapper. |
| `snapback4-core/src/engine/mod.rs` 2 | Return both receipt maps from the shared transaction; only the convenience wrapper rolls its own transaction back. |
| `snapback4-core/src/partition.rs` 1 | The empty terminal page remains `Some(StreamPage)` and carries main's `images_at: Some(head)`. |
| `snapback4-core/src/partition.rs` 2 | The completed inspected page remains optional and carries main's image head; inspection can still stop without retaining a partial page. |
| `snapback4-device/src/call.rs` 1 | Kept `capture:false`, `begin_send` and full adoption captures alongside typed metadata dispatch and the lane's published-cut adoption fence. |
| `snapback4-device/src/device/store_identity.rs` 1 | Factored main's observation into shared `IdentityEvidence`; metadata never fabricates a data page and data retains `publish_first`. |
| `snapback4-device/src/device/store_identity.rs` 2 | Preserved main's private identity and restore evidence; metadata checks same-generation heads and never treats obsolete/successor generations as restore proof. |
| `snapback4-device/src/device/store_identity.rs` 3 | Preserved source-bound receipt disposal, unknown writes and private cleanup; added transactional receipt history and recovery-flag clearing. |
| `snapback4-device/src/device/store_identity.rs` 4 | Preserved main's staged first identity and publication rules; observing metadata cannot prematurely publish that identity. |
| `snapback4-device/src/device.rs` 1 | Kept every declaration, transfer, restore and adoption field; added `snapshot_required` and made reported acquisition false while recovery is owed. |
| `snapback4-device/src/device.rs` 2 | Ordinary apply refuses during required recovery, then main's requested-position and replacement fences still run. |
| `snapback4-device/src/device.rs` 3 | Replacement publication uses main's snapshot/deferred cleanup and also clears the lane's recovery obligation. |
| `snapback4/src/serve.rs` 1 | Kept the sole opaque typed dispatcher; moved main's split receipts into its reply/measurement builders and removed the unused identity-bearing overflow responder. |
| `packages/snapback4/src/local.ts` 1 | Kept commit-hook delivery before fallible reconciliation, including metadata reset/recovery invalidation. |
| `packages/snapback4/src/local.ts` 2 | Kept metadata discovery state and main's mutable incarnation capture. |
| `packages/snapback4/src/local.ts` 3 | Requests use main's private transfer identity/cut, declarations and restore captures; metadata separately binds the durable request cut and published cut. |
| `packages/snapback4/src/local.ts` 4 | Refusals only trigger fresh metadata discovery; typed device acceptance preserves restore/adoption precedence and is the only recovery authority. |
| `packages/snapback4/src/local.ts` 5 | Kept main's read-only published-identity refresh and replacement flag, plus the lane's shared retired-receipt delivery. |
| `packages/snapback4/src/local.ts` 6 | Shared backend adoption retains main's atomic adoption capture and published identity; all discovery/private cursor state resets before replacement. |

## Semantic composition

Every successful `/sync` reply passes through the opaque typed dispatcher.
The measurement owns the inspected walk and carries from, limit, stream, send
revision, single-commit, commit, measured head, store and generation. Ordinary
and measured encoding include Repair B's `images_at` and `committed_above` from
the same catalog-validated read transaction. A fitting rewrite grants nothing;
an interrupted inspection or encoding error grants nothing. Overflow refusals
remain identity-free, contain no rows and authorize no state transition.

The substantive cursor conflict is between the lane's confirmed-position
capture and Repair B's ordinary private cursor, which can already be beyond
publication when the next commit overflows. For that case only, metadata's
`captured_watermark` names the durable deferred cut and an additive
`published_watermark` independently fences published progress. Acceptance checks
both against durable state and still explicitly requires `limit == 1` and
`from == captured_watermark`. A host cannot substitute an arbitrary cut; the
private cursor, restore cut/head, incarnation and send revision are checked.
Old captures and snapshot leases retain their published-cut semantics; advanced
snapshot positions receive no exemption. The wire grant gains no new fields.

The substantive receipt conflict is early recovery retirement versus Repair B's
base/overlay invariant. Known receipts for live, unpublished predictions stay
queued until replacement publication. Non-predicting and already-published
known receipts can retire, with source-incarnation checks and durable write
history. Unknown writes remain queued. Grant acceptance preserves the deferred
effects and ACKs until the first valid replacement page discards them together;
a malformed first page rolls back. Maximum private image-head evidence survives
consumption of a staged snapshot lease. Old published rows and predictions stay
readable until the staged replacement and catch-up publish atomically. The old
acquisition evidence stays available to queries, while `snapshot_required`
makes reported acquisition false and prevents new predictions. First-ever
acquisition cannot use evidence it never had.

Metadata identity observation uses the same private restore and adoption fences
as data observation, without manufacturing a data page. Metadata reset/recovery
invalidates client observations in the durable commit callback, before media
reconciliation or other fallible work. IndexedDB metadata replacement also uses
Repair B's journal fence and recovery path.

W15c's binder, value-index suffixes, cards and `Queued.receipt_store` lane
fixture are unchanged from main. The store/asset leak fixes are unchanged;
the engine's upload construction retains their ephemeral-directory flag.
No ceiling, rule, card word or disclosure boundary was changed by resolution.
The inherited sync-card description of overflow-carried identity is not edited
under the user's card constraint; the implementation keeps the lane's stricter
metadata-only authority.

## Corrections made during integration

The new Rust composition regressions cover both memory and SQLite: a published
cut of 5 with private cut 10 and image head 20, wrong capture/grant fields,
retained live predictions, late settlement, reopen and a restore below private
image evidence. They exposed two real composition defects that were fixed:
unvalidated `from` could become restore evidence, and removing old acquisition
evidence would make old rows/replayed predictions unavailable. The device now
uses the validated capture for restore checks and keeps old-base evidence while
separately blocking new predictions. Grant consumption also clears the answered
pending declaration.

The existing Repair B host tests found an extra capturing state inspection
before the request loop; it is now read-only. Four additional JS fault cases
verify metadata commits invalidate observations before failed follow-up work.
The IndexedDB metadata reset also follows main's admission-journal fencing and
orphan recovery path.

Fixtures were composed with the new protocol rather than dropping assertions:
main's overflow suites now expect identity-free refusals followed by measured
metadata; the interrupted-recovery assertions allow Repair B's durable
declaration revision increment and inspect state without declaring a request;
the advanced-private-cut lease rejection runs last because its retained evidence
correctly fences older pages. All original row/overlay/publication, lease and
grant-bound checks remain. The added metadata fault fixture was corrected to
overflow only the old-store request, allowing the replacement's catch-up.
The wide first-snapshot HTTP fixture now explicitly checks that an uncaptured
identity authorizes no metadata recovery: both hosts shrink the same cursor
without a store identity, then finish all snapshot pages and catch-up.

## Verification

Logs are under `/tmp/f188-integration/`. Cargo invocations were serialized
with `CARGO_BUILD_JOBS=1`; JavaScript uses Node 24.18.0. The native CLI and wasm
were rebuilt before package typecheck/build and JS execution. Source and dist
wasm have identical SHA-256
`97d0d2920992090af9d9c503cf13642655baf07f0320900991d9538585f82fd2`.

| Rust suite | Passed | Existing ignores |
| --- | ---: | ---: |
| Server crate, including W15c CLI and typed sync/grant tests | 291 | 0 |
| Device crate, including Repair B and recovery composition | 882 | 3 |
| Core unit / rows / stream receipts | 65 / 8 / 1 | 0 |
| Language unit / guide / maintains | 10 / 48 / 14 | 0 |
| Simulator unit / clique / maintains / security | 17 / 242 / 15 / 12 | 1 |
| **Distinct Rust total** | **1,605** | **4** |

Device counts combine the full run with affected correction reruns: the final
store-reset group passed 13/13, Repair B passed 108/108 and its four new measured
recovery cases passed again after capture consumption was finalized. This is
not a claim that the whole device package ran twice at the final revision.
W15c's device lane tests are in the device package; its language, guide, CLI and
simulator coverage all passed. Security's twelve include both asset-directory
leak regressions.

Fresh wasm size: **1,601,169 B raw / 441,568 B gzip**, **7,568 B over** main's
unchanged 434,000 B budget. The build produced the artifact and exited 1 at the
size gate. The diet issue records this combined-tree measurement; no budget
increase or size qualification is claimed.

| JS suite / file | Passed |
| --- | ---: |
| Oversized-sync recovery | 66 |
| Horizon boundary | 82 |
| Retained history | 44 |
| Store reset / IndexedDB / review / reconnect | 4 / 2 / 25 / 12 |
| Client lifecycle | 56 |
| Repair B / round 7 / round 8 / round 9 / round 16 / overflow | 5 / 3 / 1 / 47 / 9 / 3 |
| Sync overflow | 11 |
| Web durability | 14 |
| HTTP transport / HTTP bounds | 10 / 10 |
| Codec / acquisition / online session / session security | 1 / 25 / 11 / 7 |
| **Distinct JS total (22 files)** | **448** |

All JS tests pass, with no skips or cancellations. The final host correction
was followed by package typecheck/build and reruns of the full recovery,
Repair B, lifecycle and sync-overflow files. The HTTP-bounds fixture correction
was followed by its full-file rerun on both hosts. No device source changed
after the recorded fresh wasm build. The final log ledger is
`/tmp/f188-integration/js-final-results.json`; it combines the original run
with successful affected reruns without counting tests twice.

`./ref-check --verbose`: exactly the same ten errors as main's
`issues/20260918-repair-b-ref-check-red-on-main.md`: nine references to
`repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes`
and one to `repair-b-replacement-disposal`, in the same source files. Line
numbers moved with the merge. No annotation/anchor repair was made.

The integration diff against MERGE_HEAD passes `git diff --check`. Full staged
whitespace checking reports one trailing space inherited unchanged from main's
`benchmarks/runs/2026-09-18-snapback4-clique-astra-0.2.29/astra/lane-final-report.md:48`.
No unrelated benchmark text was edited.
