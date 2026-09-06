# Clique improvement loop, 2026-09-06

Objective: published Snapback 2 earns a higher holistic score than both Convex
and Supabase for each requested builder: Astra medium, Grok 4.6 xhigh, and
Muse 1.3 ultra. **Not achieved.** Retain the full canonical Clique scope,
including independent grading and the fresh-session M7 evolution phase.

Current checkpoint (2026-09-06): 0.0.9 is published and verified from npm.
All 154 packed files match the qualified artifacts; installed doctor, Hermes,
media, and the untouched chat Expo guide before/after check pass. The fresh
Astra-medium run stays pinned to published 0.0.8 on the baseline M5 host. Its
M1–M5 suites pass, and the latest M5 choreography records all four assertions
passing at 11:42:37Z. Named M6 API/push/custom-client and M8 totals/UTC/Trending
checks also pass. The M6 replay settled all167244 actions with zero failures
and final invariants passing; a separate completed-M8 replay is running. The
canonical120s digest proof passes restart and following quiet-period checks.
Native offline qualification remains unproven.
Concurrent load and actual toolchain
must remain disclosed; the current choreography records Node25.9.0, not merely
the Node24.18.0 named during preparation.

The old 0.0.6 outcome/scale grading is complete: 102 pass, 2 fail, 4 not recorded,
11 not run; 167,244 settled actions with zero failed and all scale invariants
passing. Its feed performance misses the target at all checkpoints. The first
repair improved performance but missed the larger checkpoints; further repairs
retain all original samples. Search integration remains unpublished and has
active compiler review findings and a client bundle budget issue.

Fresh M7 on the frozen 0.0.6 app completed diagnostically: new-feature API/web/
expiry/export checks pass, but prior regression is incomplete, so it is not
milestone-green. Independent M7 grading completed: eight assertion IDs pass
with stated limits, prior regression fails, and empty poll argument bounds fail.
Its M8 API recheck passes; prior native qualification gaps remain. The sealed
recording supplement reports B8 78 and M7-only holistic70, not a full score. The requested three-family comparative win is unproven. Entries below
retain chronology, including superseded intermediate statuses.

Latest release evidence: [`evidence/npm-0.0.9/`](evidence/npm-0.0.9/).
M7 evidence: [`evidence/m7-completion-006/`](evidence/m7-completion-006/).
The fresh run lives at `/Users/ccheever/clique-full-008-20260906` on M5;
its launch receipt and preparation remain under
`/Users/ccheever/clique-improvement/next-run/astra-008/`.

## Baseline

The earlier 0.0.4 narrative scores and original scorer prompt are retained in
[`../2026-09-05-clique-full-3x3/`](../2026-09-05-clique-full-3x3/).
Astra: Snapback 64, Convex 84, Supabase 77. Grok: 57, 78, 47 respectively.
Muse scores are absent. These are N=1 observations, not statistical rankings.

## Fresh published build

- Builder: fresh `gpt-6-astra`, medium, under the parent Codex agent harness.
- Package: npm `snapback2@0.0.6`, verified registry version at launch.
- Started: 2026-09-06T06:30:10Z.
- Host: office M1 MacBook Pro; different from the baseline M5 Max. Timing is
  diagnostic. Cold product-test compilation also overlapped part of M2.
- Instrument: unmodified canonical brief, fixtures, UI, choreography, schemas
  copied under `/Users/ccheever/clique-improvement/instrument/benchmarks/`.
- App and raw evidence:
  `/Users/ccheever/clique-improvement/lanes/astra-snapback2-006/`.
- Builder reads only the instrument and published product; no source checkout,
  previous app, or corrective steering. Product-fix agents do not modify it.
- Numeric caps in the supplied brief remain placeholders. Actual clocks and
  missing token metering are recorded; no invented cap compliance.

M1–M5 are green. Copied receipts under `evidence/` bind their passing
suites: M1 passed all three required choreography assertions at
2026-09-06T07:00:35.177Z; M2 passed all nine at 2026-09-06T07:02:06.871Z;
M3 passed all seven implemented assertions (five required) at
2026-09-06T07:20:12.911Z, including group receipts and the removal cutoff.
The first M1 choreography failure was an app form-hydration race, corrected by
the builder. Earlier receipts overstated setup/prepack qualification; these
reruns use the builder's corrected metadata and make no such claim.
The iOS Hermes bundle exported; simulator execution is unavailable on this
host (`simctl` exit 72), so there is no physical/native runtime claim.
M4 passed all five required choreography assertions at 2026-09-06T07:29:19.964Z; its suite hash was verified before copying. M5 is green; its retained choreography receipt and suite hash were verified. M6 is next. No new holistic score exists yet.

Findings already recorded: conditional page returns lose their cursor
(`issues/20260906-snapback2-conditional-query-page-loses-cursor.md`), and help
and migration command discovery
(`issues/20260906-snapback2-guide-gaps-from-the-clique-run.md`, items 15–16).

## Product fixes and review

| Lane | Review target | Current evidence |
| --- | --- | --- |
| Auth startup | `9b22e7b48`, branch `s2/clique-auth` | Nine new cancellation regressions fail before/pass after; 181 affected tests pass; both independent reviewers READY; integrating with asset/cursor fixes |
| Abandoned assets | `6351b2d49`, branch `s2/clique-assets` | Fullf7 script/measurement pass; final JS134 and Rust35 affected tests pass; AstraREADY, Grok final review running |
| Conditional cursors | `f997292c6`, branch `s2/clique-cursors` | Consolidated run: Rust 743 pass, compiler 400 pass, evaluator 216 pass; package 379 pass/one 10s timeout. Nested operand/prefix regressions fixed;72Rust/216evaluator/400compiler pass; both independent reviewers READY |

Received auth and asset reviews are retained under `reviews/`, exactly as received.
They are static reviews, not test execution. New interleaving regressions must
prove the revisions. Both code reviewers use xhigh, independently; the
benchmark builder uses medium and receives none of their findings.

Assets verification on the M5 retained `/tmp/clique-assets-full.log`: 743 Rust
tests passed (four existing skips), doctests, 202 evaluator cases, two
visibility checks, 399 compiler checks, and the package suite. This proves the
asset branch, not a future integrated auth/cursor build or an npm publication.

Auth revision `9052d09a6` remote verification retained
`/tmp/clique-auth-9052-full.log`: 741/741 Rust tests and 399/399 compiler checks
passed; the overall script exited nonzero because one package real-owner test
exceeded its 10-second deadline. A quiet rerun of that file passed 10/10 under
the unchanged deadline (`/tmp/clique-auth-9052-recovery.log`). This is not an
unconditionally green full-script result. Both second-round reviewers identified the same retained-fetch cancellation barrier; revision `0e6cebfcd` fixes it and awaits final review.

## Muse limitation

The M5's existing three Muse 1.3 **xhigh** baseline builder processes remain
live; preserve and poll them rather than restarting. A fresh ultra request
reported `gate ultra_reasoning_effort is closed; using xhigh`; fresh SSH
authentication also failed because its Keychain credentials were locked.
Do not label those xhigh runs or reviews as ultra. The requested Muse ultra
comparison remains outstanding even if other lanes later win.

Cursor consolidated evidence at `bbe2f85aa` is `/tmp/clique-cursors-bbe2f85aa-consolidated.log` on the M5. The complete script exited 1; no timing phase witness identifies the package timeout cause. Host load sampled afterward suggests contention but does not prove it. No timeout increase or aggregate-green claim. The next independent CLI lane addresses help and migration-command discovery only.

Session authorization: the author explicitly requested unattended operation and
authorized overriding the three-round fix limit as needed. Auth and cursor
revisions resumed in their existing named lanes; the override does not claim
that their review findings are resolved or alter verification evidence.

Asset integration prepared at `4b1764370` on `s2/clique-integration`, based on
main `e929282ad`. All three asset commits applied without conflicts;
`snapback2/` is byte-for-byte identical to `f7d251394`. This is a prepared
branch, not a main landing or publication. The exact asset full-run package
phase passed 386 tests; remaining full verification and final reviews are
still in progress.

Asset `f7d251394` full script exited 0: package386, Rust746(four skips and
two leak notices), evaluator202 plus visibility2, compiler399. It took199.533s
under high shared host load; no sub-60s gate claim. Measurement exited0 with
all named budgets passing. Summary JSON and measurement rows are retained
under evidence/. The two surviving Node processes correlate with duplicated
startup-cleanup test timestamps; without launch-PID records attribution is
inferred and the processes were left untouched. This full result does not
resolve the newer static-review auth ordering finding.

CLI candidate `1296ec51a` has package-build,11guide and86owner tests passing
(two pre-existing ignores). Independent reviews and full verification are
running. It can land independently if ready before the asset revision.

CLI fullscript at1296ec51a exited0:380package,743Rust,399compiler,
doctests/evaluator pass. Measurement exited1: doctor first sample0.549s
exceeded0.5s, second0.057s; all other budgets passed. That red is retained
and under investigation before publication. Assets final candidate is now
f52d6dcd8(134affectedJS pass), but Grok identified a separate per-id unlink
error escaping through the background writer turn; that revision is underway.

CLI landing: both independent Astra/Grok reviews are READY. Fullscript is
green. After the initial doctor budget miss, an unchanged-binary focused
comparison retained all four samples(CLI0.093/0.056s, asset0.069/0.056s).
One canonical warm confirmation then exited0: doctor0.151/0.056s,
check0.540s, incremental2.410s; every budget passed. The initial red is
retained; its cause is unproven, so this does not claim every cold launch
passes. The CLI commit was cherry-picked to main with no semantic changes
under snapback2/. Production0.0.7 dry-run is in progress; publication is
not yet claimed.

## Published0.0.7

`snapback2@0.0.7` and `snapback2-darwin-arm64@0.0.7` are both published
and tagged latest. Source7f59d3a42 has the same Snapback2 tree as
landed5510cdf7f. Exact prepared tarballs were consumer-qualified and
published through the existing resume/convergence path; registry SRI and
fresh installed binary bytes match. Production Hermes/media, help, and
migration guidance checks pass. Evidence is under `evidence/npm-0.0.7/`.

This release contains CLI help and migration discoverability, not the pending
auth/cursor/asset integration. The running benchmark remains pinned0.0.6.
The first staged doctor failed with Bun isolated dependency layout; the same
locked dependencies in the supported hoisted layout passed. One external
launcher accidentally repeated dry-run, retained as such. Actual publication
took27s; npm processing delayed shim visibility for several minutes.
A fresh installed version invocation took12.893s; subsequent doctor took
0.143s and help roughly0.06s. No cause is assigned to that first-launch delay
and no universal cold-launch latency claim follows from warm measurements.


Integration verification at21b21abd3 retains the original failed full run and
its targeted corrections. All753 Rust test identities passed across the
original588, first rerun164, and final guide-contract test1; four are ignored.
Compiler400, evaluator216 plus visibility2, package422 plus separate assets27,
and final package build/caps/ref-check pass. The two corrections changed only
guide prose; this is combined affected evidence, not a final fullscript exit0.
Asset6351b2d49 now has both independent READY reviews retained.

The integration Astra review found an additional interaction: automatic upload
discard can wait indefinitely when its transport ignores timeout cancellation,
blocking auth replacement and terminal expiry. The finding is static, with
reproduction and repair underway; integration is not yet cleared for release.
M6 has five passing required suite IDs but offline reconnect choreography is
not green: the pinned0.0.6 client reports conflicting inbox deliveries at the
same sequence. Exact evidence and an independent reduction are pending.


M6 web green at2026-09-06T08:42:36.122Z: frozen choreography passes
the two-send offline queue/ordered-flush assertion and its five required
suite IDs. Root verified the suite hash and frozen M6 source SHA256 before
retaining receipts. Three drain:true subscriptions were replaced with
explicit cursor-page live subscriptions in application code; this workaround
and both same-sequence SDK refusal observations remain recorded as friction.
The pinned package stays0.0.6. Native is explicitly not-recorded; the iOS
Hermes export is not execution evidence. M8 has started; no holistic score
or independent acceptance grade yet.


Integrated revisionea35e15b1 passes431 selected client tests plus36assets,
including18 new regressions(17 demonstrated red before repair). First existing
measurement run exits0 in61.16s: projectcheck0.521s, doctor0.393/0.061s;
all original budgets pass. Proof-only617f61b4d appends its existing metric row.
Fresh Astra review finds two further static cases: upload supersession can
lose terminal bearer evidence, and terminal expiry leaves sibling drains
waiting. They are being reproduced and repaired; no clearance is claimed.
Version0.0.8 is prepared in the separate release lane atf01cf97a3, with warm
production dependencies but no build or publication.

Named-shape fixb48d95526 has compiler402/evaluator216plus2/core382plus1skip
passing and Astra READY. Second-family review is pending. Search feasibility
now has exact Unicode17 conformance and real100k fixture layout measurements;
fullengine closure, client budget and cursor design still require resolution.
Independent design reviews are underway, with no search implementation claim.

## Frozen artifact and native failure

Final source archive SHA256 is
`c64b7b1e82a5f4588dfe7f0f07110ad149c0c7c3e0764424be678160f2f75b61`.
The builder's original green M8 choreography referred to a suite file that was
subsequently overwritten. Its exact bound suite could not be recovered. An
unchanged-source requalification failed dual-offline convergence and the
dependent receipt assertion. The addendum and uniquely named raw evidence are
retained under `evidence/m8-final/requalification/`; their hashes were checked
before copying. Do not claim a verified M8 pass from the earlier green report.

Independent native M6 execution used the frozen M6 artifact on an M5 iOS
simulator with a Release Hermes app and an uninterrupted 197-second recording.
The evidence validates, but acceptance fails: native subscriptions report
`SSE response has no body`, preventing the history/media/search preconditions;
read ticks also precede server confirmation. Two pending messages and an
exactly-once ordered manual flush pass. Four assertions pass, two fail, and
four are not recorded. The verbatim report and compact receipts are under
`evidence/native-m6/`; large app/video artifacts remain at its documented
external location. This older M6 artifact does not qualify final M8 source.

## Integration and search checkpoint

Shape and reconnect fixes now have both independent READY reviews retained.
The combined runtime at `38d406d79` passes its package build, selected client
tests, assets tests, and existing measurement run. The later byte-delivery fix
at `12c01f469` adds 18 passing cases, 11 demonstrated failing before repair;
100 affected tests and 50 assets tests pass. Its measurement passes in 28.54s.
Proof-only `d1499f395` preserves the result. These are scoped execution claims,
not a newly green full-script claim or publication clearance.

Both third-round integration reviews are retained. Astra identified the byte
conversion gap addressed above. Grok identified a separate FIFO pre-enqueue
catch that replaces an originating session-expiry refusal with a sealed-store
error; its reproduction and repair are underway. Overlay-retirement changes
at `44cd420ae` are also under fresh independent review.

Search design revision 2 resolves the two design reviews into shared Unicode17
normalization, engine-maintained prefix postings, and an indexed held client
execution path. Foundation implementation has started. The current session's
delegated trade is a 34,000-byte total twin ceiling with a 30,000-byte target,
deferring Exact 2 until search qualifies; existing resource ceilings remain.
The proposed closure allocation is not an integrated measurement. No search
qualification or improvement in comparative score is claimed.

Both independent overlay reviews now report READY for `44cd420ae`; they are
retained verbatim under `reviews/`. Integration revision `220186033` fixes
the thrown-401 FIFO case, but its fourth Astra review identifies the supported
HTTP-200 typed terminal response bypass. Five representative cases reproduce
that broader defect without timeouts. Repair and affected verification continue;
the 0.0.8 production dry run has not started.

Native stream fix `1957b9591` removes the internal dependency on the global
Response constructor. Its two native-specific regressions fail before and pass
after. Independent reviews and a real candidate Release Hermes witness are
running. The initial broader verification had two file cancellations; a later
189-test run used a longer timeout and excluded one real-session recovery case.
Original-deadline verification is therefore being completed explicitly, rather
than presenting that run as unchanged-deadline evidence.

An independent source-integrity check compared all 328 supplied regular files
in both live grading copies with the retained filtered source archive: no
changed or missing files. This proves source preservation only. Starter
invariants pass in the outcome grader; scale replay is underway, without a
completed scale or performance qualification claim.
