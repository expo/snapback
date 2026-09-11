# Snapback2 follow-up diagnostics and repairs — 2026-09-11

The foreground stall is repaired, acknowledgement admission avoids copying
retained history, and the package shares previously duplicated evaluator
primitives. The 30-second acquisition goal and the byte/timing budgets remain
open. This is the follow-up commissioned after the four-plan landing
`75a67c92c`, based on `b3b063b4e`. No budget, measurement root, retained-data
policy, machine security setting or publication baseline changed.

## Results

| Area | Observed result | Remaining limit |
| --- | --- | --- |
| Foreground send during acquisition | Three alternating controls: old source did not admit by 15 s; fixed source admitted in 148–398 ms and returned committed in 560–1,689 ms | Instrumented small cohort; first sender row is a queued preview; owner observer is same-account, not recipient-auth qualification |
| Full acquisition | Same 10,008 messages: 70.007 s old profile, 66.342 s after send fix, 53.634 s after pending projection; exact durable content passed | Single instrumented samples, not a clean distribution; 30 s unmet |
| Package closure | Final client 139,450 / React 149,260 / Expo 152,792 / runtime 88,086 gzip bytes | All exceed accepted 1% guard; runtime below 90,000 ceiling, above 80,000 target |
| Loop timing | Final consumer 37.60 s, project check 1.163 s; direct doctor 0.218/0.057 s; all functional steps pass | Consumer 30 s and check 1 s fail; unchanged-binary doctor does not close changed-binary first launch |
| macOS release | Public 0.0.22 and 0.0.23 binaries are ad-hoc signed; all four CLI/media binaries fail explicit notarized requirement | No signed release exists for a timing control; usable signing/notary setup and pipeline work remain |

## What changed and why

Repeated network validation restarted writer admission in the same scope.
The new activation is idempotent; ledger changes, inbox nudges and polling
continue to own updates. Online mutations append under the existing FIFO lock
before starting replay, preserving older follower admission and replay order.
A caller can receive its own durable terminal while newer work continues.
The terminal waiter resolves only if its guarded local settlement actually
applied; an intervening coverage change keeps the intent queued.

Session expiry after admission refuses the public call, seals custody and
sends no newer request. It does not discard the admitted bytes: fresh sign-in
resumes both intents in order. `outbox.settled()` still refers to the whole queue.
The four existing expiry assertions were updated to that intended consequence,
while retaining exact older replay bytes, sealed/anonymous state, no newer
pre-login request and exactly-once execution after recovery.

The profile then localized 13.54 s inclusive to full acknowledgement dictionary
copying. Admission now receives a detached map of pending event key→sequence,
reducing that path to 1.28 s in the next profile. Durable bindings and retry
marks are untouched. This still scans retained keys; it is not constant work.
The exported custom `OutboxStore` interface replaces `deliveryAcks()` with
`pendingDeliveryAcks(): Promise<Record<string, number>>`; keys are
`log + '\0' + eventId`. Custom carriers supporting receipts must implement it.

The existing private `image-runtime` leaf now also owns `value-runtime`, `hash`,
`certificate-identity` and `cursor`. This removes 69 duplicated function
declarations without changing algorithms or public imports. The isolated
sharing experiment saves 5,807/5,864/5,865 compressed bytes with byte-identical
complete runtime. Including the send and receipt fixes, final net client/React/
Expo savings are 5,739/5,796/5,797 bytes; complete runtime grows 33 bytes.

## Evidence and next work

- [Foreground report](foreground-report.md) separates durable admission,
  mutation result, queued preview and owner observation, retains censored
  controls and the capped old trace, and hashes original evidence.
- [Old acquisition profile](profile-report.md), [send-fix comparison](profile-fixed-comparison.md)
  and [pending-projection comparison](profile-projected-comparison.md) retain
  sampled CPU, source maps and overlapping I/O analysis. Remaining mapped
  costs include acknowledgement lifecycle cleanup 6.11 s and generic detached
  outbox reads 5.96 s inclusive. GC 10.45 s is not attributable to an allocation
  source from this profile. Next: label those read selectors, then check which
  swaps actually require acknowledgement cleanup before proposing a change.
- [Byte attribution](bytes-report.md) and adjacent CSV/JSON reproduce the
  accepted/pristine/four-plan baselines and attribute modules and shared leaves.
  Continue measured deletion/sharing; do not sum overlapping public entries.
- [Timing analysis](timing-analysis.md) retains both current consumer/check
  failures and the four-command project-check control. Its high-load A/B/B/A
  run fails all four 1 s budgets; the middle B arm is slower despite identical
  compiler leaves. Cause remains unresolved. Isolate packaging/setup and
  consumer stages on an idle host; do not infer that post-run load explains
  earlier failures.
- [Release inspection](doctor/report.md) records registry integrity, signatures,
  notarization requirements and the missing publisher steps. Next setup needs
  a headless-usable Developer ID Application key and named notary profile.
  Published signing alone does not change the local measurement executable.

Browser runs use the pinned old owner/SQLite snapshot, derived-delivery chat
fixture, real IndexedDB and fresh profiles on the EPYC host, with Node 24.13.1.
The busy group contains Alice only, no assets and no effects engine. Some
other host work occurred; diagnostics are not the prior clean primary cohort.
An initial profile waited for obsolete UI text and timed out despite complete
data; that harness failure remains excluded, with the corrected truthful
`local.caughtUp` predicate used afterward. Network/IDB/CPU times overlap and
must not be added. The projected profile predates a semantics-preserving helper
extraction into the existing acknowledgement module to respect the 1,500-line
cap; the comparison records its exact binding and final-source tests separately.

Large raw traces, CPU profiles, source maps, fixed package copies and commands
remain under `runs/followup-diagnostics-20260911/` in the local named lane and
`~/lanes/clique-20260909-initial/` on EPYC. Compact JSON records hash those
inputs. [final-source-manifest.json](final-source-manifest.json) binds 1,128
Snapback2 inputs; it is run evidence, not a new gate or registry. Canonical
byte measurements use Node 24.18.0 / esbuild 0.25.9 / gzip 9, independently of
the Linux browser diagnostics. Git SHA fields in loop records name the base
while source changes were uncommitted; the manifest identifies tested inputs.

## Verification

The package build and graph/identity self-tests pass. Focused suites pass
94 existing/new replay/inbox tests,17 delivery-custody tests, and all four
expiry/admission controls. Independent review is READY; it caught and verified
the coverage-change guard and explicitly assessed the admission/expiry contract.
The first full suite retained four failures from the old pre-admission
expectations; its other 1,336 package tests and native/compiler/evaluator checks
passed. The [final full rerun](final-test-r2.log) passes **1,340/1,340 package tests,
1,127/1,127 native tests, 302/302 compiler checks, 266 evaluator cases, two
visibility checks and doctests**. All 1,128 manifest inputs matched on EPYC
before execution and remain unchanged locally afterward. The 73-second run
(18:50:18–18:51:31 UTC) does not qualify the separate 60-second suite budget.
The [first full failure](final-test.log) remains retained.

The final ordinary `measure.mjs --check` exits 1 for the four byte guards and
consumer/project-check timing. Its functionally successful receipt retains the
standard no-effects-engine block. Exact logs are linked alongside this report.
No package publication or full budget qualification is claimed.

`ref-check` passes and the Snapback2 file/guide caps pass. Root `caps` still
fails on the same two unrelated Snapback1 oversize files. Root inventories
retain the existing caps-test registration gap, stale Snapback1 diagnostics
registry and missing generated Snapback1 guide inputs. Their exact outputs
are [caps](final-caps.log) and [inventories](inventories.log); this pass does
not repair or qualify those unrelated surfaces. Existing tickets retain them.

The last ordinary measurement precedes the final guide clarification and
four assertion updates; measured runtime/package source remains unchanged.
The final build self-test and full suite include those final prose/test edits.
Independent [review disposition](../../../llp/reviews/1018.008-followup-diagnostics.astra.md)
records the actual review, findings and fixes.

For repository whitespace conventions, the committed CSV uses LF and the first
failed-test log omits trailing spaces. Original bytes remain in the ignored run;
the byte manifest records CSV normalization. Original failed-test log SHA-256:
`49e5ef190b5ee30ca1bcad030cb4e4eab0e3645f8658620c2ee99a8ffea08f48`. All results and failure text are preserved.
