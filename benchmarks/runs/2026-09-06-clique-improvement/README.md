# Clique improvement loop, 2026-09-06

Objective: published Snapback 2 earns a higher holistic score than both Convex
and Supabase for each requested builder: Astra medium, Grok 4.6 xhigh, and
Muse 1.3 ultra. **Not achieved.** Retain the full canonical Clique scope,
including independent grading and the fresh-session M7 evolution phase.

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
| Auth startup | `9b22e7b48`, branch `s2/clique-auth` | Nine new cancellation regressions fail before/pass after; 181 affected tests pass; revision in independent Astra/Grok review |
| Abandoned assets | `f7d251394`, branch `s2/clique-assets` | Full script and measurements pass; Astra resolves prior residuals but finds terminal invalidation under supersession; next revision underway, Grok review running |
| Conditional cursors | `bbe2f85aa`, branch `s2/clique-cursors` | Consolidated run: Rust 743 pass, compiler 400 pass, evaluator 216 pass; package 379 pass/one 10s timeout. Astra finds duplicate-site provenance and malformed-prefix panic; Grok READY; Astra residuals still require revision, now underway under the extended round limit |

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
