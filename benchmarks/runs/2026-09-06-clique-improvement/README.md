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

M1, M2, and M3 are green. Copied receipts under `evidence/` bind their passing
suites: M1 passed all three required choreography assertions at
2026-09-06T07:00:35.177Z; M2 passed all nine at 2026-09-06T07:02:06.871Z;
M3 passed all seven implemented assertions (five required) at
2026-09-06T07:20:12.911Z, including group receipts and the removal cutoff.
The first M1 choreography failure was an app form-hydration race, corrected by
the builder. Earlier receipts overstated setup/prepack qualification; these
reruns use the builder's corrected metadata and make no such claim.
The iOS Hermes bundle exported; simulator execution is unavailable on this
host (`simctl` exit 72), so there is no physical/native runtime claim.
M4 is in progress. No new holistic score exists yet.

Findings already recorded: conditional page returns lose their cursor
(`issues/20260906-snapback2-conditional-query-page-loses-cursor.md`), and help
and migration command discovery
(`issues/20260906-snapback2-guide-gaps-from-the-clique-run.md`, items 15–16).

## Product fixes and review

| Lane | Review target | Current evidence |
| --- | --- | --- |
| Auth startup | `9052d09a6` after `a6a46b5a3`, branch `s2/clique-auth` | Revised 130 affected tests pass; second Astra review finds a remaining cancellation barrier; second Grok review pending |
| Abandoned assets | `184d88c9c`, branch `s2/clique-assets` | Complete test script green on isolated M5 lane; first Astra/Grok reviews require changes; combined revision being tested; branch pushed, not landed |
| Conditional cursors | branch `s2/clique-cursors` | Implementing executed-return page provenance; no passing result claimed |

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
unconditionally green full-script result. The second Astra review's retained
fetch-after-cancellation interleaving remains to be fixed before landing.

## Muse limitation

The M5's existing three Muse 1.3 **xhigh** baseline builder processes remain
live; preserve and poll them rather than restarting. A fresh ultra request
reported `gate ultra_reasoning_effort is closed; using xhigh`; fresh SSH
authentication also failed because its Keychain credentials were locked.
Do not label those xhigh runs or reviews as ultra. The requested Muse ultra
comparison remains outstanding even if other lanes later win.
