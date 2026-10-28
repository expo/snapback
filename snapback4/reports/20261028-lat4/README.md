# LAT4: production overhead and finite proof completion

Production's non-security target passes. The exact LAT3 day-two target does not:
94.272 → 76.376 seconds is a 19.0% median reduction, versus the requested 40%.
All 33 original target lanes were replayed; 31 pass on both variants, and two
have independently reproduced 0.4.44 → 0.4.45 conservation failures. Their
statuses remain failures. No publication qualification is claimed.

## Changes

- Release commands share a bounded, command-local compiler result keyed by the
  complete ordered source filenames and bytes. Results are cloned; source files
  are reread. Live admission, security, registry checks, previews, CAS, adoption
  and durability still run. Current-release inspection avoids a redundant open.
- Explicit finite suites await their entire callback and cleanup, drain output,
  name lingering resource types/counts, and exit with the suite's status.
  Generated frontend/day-two proofs opt in. Custom suites opt in through the
  separate `snapback4/proof-runner` entry. An awaited unref task stays alive.
  Service lifetime and `snapback4/proof` declarations are unchanged.
- Opt-in native phases separate process/main startup, owner/store open, source
  materialization, preview, registry/bookkeeping, release/pointer durability,
  adoption/backfills, live-host writer wait and final report output.

## Measurements

Unmodified-clock production controls use the same-version unoptimized and final
optimized production binaries, on fresh copies of all 40 wave33 Snapback apps.
One rollback preparation remains refused on both variants, leaving 119 actual
deploys across 120 cases. These numbers subtract the measured security envelope;
security still executes in full.

| Production case | n | Before median / p90 (s) | After median / p90 (s) |
| --- | ---: | ---: | ---: |
| Unchanged release | 40 | 1.191 / 2.814 | 0.245 / 0.547 |
| Reactivation | 39 | 1.904 / 4.082 | 0.555 / 0.917 |
| New release | 40 | 1.261 / 2.970 | 0.424 / 0.794 |
| Combined | 119 | 1.496 / 3.309 | 0.409 / 0.815 |

The after maximum is 1.436 seconds. These results meet median ≤2 s / p90 ≤4 s.
The 11-second LAT3 example is not substituted for this same-version baseline.

Full store/release identity is a separate fixed-REALTIME control, retaining real
MONOTONIC wall timing. Every canonical schema/table/column/row/metadata value and
every regular retained release file hash matches in all 120 cases. No store
field is normalized. The expanded custody comparison also includes the legacy
`current` pointer, `releases.jsonl` journal, optional deployed-schema record and
each retained store-link target. Literal output matches in 47 initial cases;
the remaining output
matches after projecting only pre-existing numeric elapsed-ms strings in the
documented successful JSON fields. Every refusal and all other values remain
literal. Raw output hashes are retained. Uncontrolled-clock output is not an
identity proof: time-sensitive witness notices differ in two wave33/008 cases.

| Paired LAT3 successful target | Before median / p90 (s) | After median / p90 (s) |
| --- | ---: | ---: |
| Full day-two proof, 31 matched passing lanes | 94.272 / 166.386 | 76.376 / 111.903 |
| Wall complement of measured security | 81.341 / 135.056 | 71.028 / 89.172 |

The original 33-lane selection is frozen, and all 33 were observed. The table
does not convert the two failed target lanes into passes. Median improvement is
19.0% overall and 12.7% outside the measured security envelope. The target is
missed under either view. Primary .44 → .45 figures also include pre-existing
security/version changes; those improvements are not attributed to LAT4.

Same-version read-only controls isolate the current-release improvements:

| Command, 40 copied apps each | Before median / p90 (s) | After median / p90 (s) |
| --- | ---: | ---: |
| `--version` | 0.0023 / 0.0031 | 0.0024 / 0.0032 |
| `releases deploy --json` | 0.313 / 0.805 | 0.118 / 0.255 |
| `releases deploy current --json` | 0.404 / 1.106 | 0.116 / 0.258 |
| `sql '\dt' --release deploy --json` | 0.060 / 0.155 | 0.060 / 0.157 |

All 160 command pairs succeed, have byte-identical output, and leave complete
canonical stores and retained release files unchanged. SQL dispatch is already
cheap; no cross-process mutable-store/authorization cache was introduced.

Wave33/025 retains 124 native invocations in both primary variants: 108 SQL/data,
nine release inspections, two rollbacks, two deploys, two serves and one token.
Finite command wall time falls 111.018 → 30.208 seconds; full proof time falls
194.824 → 111.903 seconds. The security envelope also changes 52.455 → 20.187
seconds across versions, so the entire improvement cannot be credited to LAT4.

## Evidence and interpretation

`built-inputs.json` binds every native/packed artifact. The frozen primary
timing campaign uses the full ordered protocol on all 120 apps, 400 pairs.
Two exported-helper setup refusals were explicitly superseded by complete
whole-lane replays; `primary-selection.json` retains the original attempts.
The primary successful path uses the reviewed initial finite runner. Final
failure-only fixes preserve native Node rendering/status; final negative-path
replays and final packed consumers are separate, without replacing timing rows.

The primary explicit-completion observer finds two tails >1 s (wave32/002 and
wave33/002 acceptance): 11.033 and 11.082 s before, neither after; the after
maximum is 3 ms. TS and shell-composed entries receive a separate complete
ordered tail supplement, with only a declaration for the added measurement
import; authored typechecks remain enabled. The resulting tail view retains
400 whole-lane pairs and observes 378 explicit completions per variant, with
the same two >1 s tails before and none after. Its 38 supplementary pairs are
observation evidence, never replacements for the frozen primary timing table.
The first TS adapter lacked a declaration for its added baseline-only file-URL
import, causing TS2307 in wave32/013 and 014. Both entire ordered lanes were
replayed with that declaration; all six pairs pass on both variants. Superseded
adapter failures and explicit revision selections remain recorded.
Authored `process.exit` can bypass
the wrapper's final observer. `primary-post-report-observations.json.gz` records
exit-minus-last-observed-userland-write for 399 processes per variant, including
those entries. This gap can include running tests, cleanup, or unobserved native
uncaught-error output, so it must not be called a completed-suite tail. The one
missing client process is the correctly refused wave33/033 deployment.

Primary failure-rendering differences in 001 and wave34/034 are fixed and
replayed with final artifacts. 033 refusal text and the 012/020/038 conservation
failures reproduce in same-version controls without LAT4. The handle diagnostic
is the declared builder-visible addition; comparison removes only that exact
typed diagnostic, known relocated paths/fixture IDs and synthetic wrapper frames.
Raw message hashes and actual statuses remain. All 6,728 client-call vectors
across 119 pairs agree on operation, role, verdict, expectation and error.

Numeric details are in the adjacent summaries; compressed JSON keeps every
case without dumping stores, credentials or private application logs into Git.
Phase intervals nest and differing instrumentation boundaries cannot be added
or naively compared. In particular, the old new-release write phase included
preview; the final native reports them separately. Live-host evidence covers
nine actual activations with the final native. The scoped affected receipt and
complete test results are reported in the worktree's `WORKSTREAM-REPORT.md`.

Packed consumers use the actual final client/Linux tarballs and the existing
0.4.45 Expo tarball, outside the checkout. Proof-kit, staging and production
pass. The first starter attempt reports a malformed strace record; its failure
is retained. A fresh canonical starter run passes all six cases, including
loaded-host browser/listener checks and negative controls; no audit is disabled.

Reproduction tools: `replay.py`, `wrap.mjs`, `observe.mjs`, `summarize.py`,
`merge-census.py`, `deploy.py`, `deploy-summary.py`, `inspect.py`, and
`profile-summary.py`. Raw logs/canonical dumps remain private under `/tmp/lat4`.
Run each long worker in the required systemd 40-GiB scope, at most four workers.
Mac, full batteries, publication and pushes are outside this workstream.
