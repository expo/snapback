# MUSE1 measurement method

The pre-change 40-pair decomposition and selection were recorded in commit
9ec7a73c10 before product edits. Four Muse ideas are the largest absolute input
regressions in wave34r2: 019 child talent, 032 gown preservation, 026 wildlife
exclusion, 035 real estate photos. Codex controls are 001 CPAP and 014 e-bike;
selection was fixed before any new result. Frontend and model draws are copied
from wave34r2 assignments, which preserve wave 34's draws.

Each of the six draws runs once on frozen .46, .47 and candidate packages.
The before packages come from the local mirror, verified by SRI and the exact
wave34r1/r2 native SHA-256 pins. Requested source references are 67740e5975 and
11fb847329. Candidate packages use integrated main .48 plus MUSE1; they include
TOK5/GEN1 and therefore do not isolate MUSE1 from those changes. Package and
native hashes are in baseline-pins.json and branch-pins.json. The candidate
platform tarball is byte-identical to the consumer-qualified tarball.

`replay.mjs` copies the complete rendered wave34r2 BRIEF, changing only paths,
ports and both Snapback package pins. Every application starts with only that
brief and no installed package, under /tmp/muse1-replay/. The original builder
CLIs/flags are retained, including high reasoning, JSON output and Codex's final
response file. Muse's approved wrapper preserves its exec arguments and handles
plan-quota fallback without exposing the key. `builderEnvironment` clears probe
hold; the same process guards, Chromium, Node/Bun frontend tools and private
short TMPDIR convention are used. Local frozen registries proxy ordinary
frontend dependencies to the harness mirror. No extra scaffold/verify advice,
reading milestone, feedback intervention or premature stop is supplied.

Observed tools: Node 24.13.1, codex-cli 0.165.0, Muse Code 1.4.14-R7309.1,
Bun 1.4.2, Rust 1.97.0. The native candidate is production-profile, static musl,
with the publication SQLite flags. Long jobs use user systemd scopes with
MemoryMax=40G/OOMPolicy=continue; no more than four expensive workers run.
The builder queue admits three sessions and reserves capacity for checks or
independent reviews. Admission pauses leave active sessions unchanged.

Each complete session archives its own IDs through sessions34.mjs, including
credential sweep and exact provider usage. `parse.py` independently checks call
and input totals against those metrics. All original candidate results remain;
there is no retry for an unfavorable draw. Package-lock client integrity and
installed native hashes are checked before deletion. Full installed client-file
comparison was also added after the first four captures (381 files per package).
Completed application/store/install/build copies and owned processes are removed;
private sanitized session archives and counts remain under /tmp/muse1-evidence/.

Input/call bars use exact unrounded provider totals. Report raw per-idea values,
medians by version, and paired ratios; do not substitute keyword counts or file
bytes for usage. Wall is launch through builder exit/archive capture, rounded to
minutes; capture overhead is small and wall is not used for the hard bars.
Shared provider windows and stochastic authoring limit causal interpretation;
these six draws do not establish a population-wide performance result.

The initial affected run executed all 16 scoped commands successfully. Its
receipt's unchanged-input guard refused because review/provenance commits landed
while it ran; the final committed-state pass is required separately. The full
selector plan is retained: the root workstream report/shared CLI table fail
broad, but the brief excludes the full multi-crate/client/model battery. The
scoped runner uses the selector executor for CLI/guide/proof surfaces and all
mandatory root checks, excluding only the unrelated W8B residency calibration.

## Revised candidate after the first result

The initial opt-in-only candidate completed all 18 sessions and missed both
models' input/call bars. replays-v1.json preserves every draw and independently
parsed totals. A second candidate changes the mechanism: a <=8KB three-file,
one-scenario default business draft retains shared accounts/lifecycle; the full
matrix remains opt-in. Run six new after sessions (`compact`) on the fixed draws,
reuse the same twelve completed before controls, and retain all six rejected
after sessions. This is a changed-code experiment, not a reroll. Final compact
package/native hashes are kept separately from branch-pins.json. Its source
reviews use a new mutually blind restricted snapshot.

## Explicit-choice fallback

All six compact-default sessions completed and missed Muse input/call bars and
Codex calls. replays-v2.json retains all 24 sessions, independently parsed. The
third changed-code candidate (`optin`) makes both drafts explicit choices and
keeps verify unchanged. Run six fresh after sessions against the same twelve
controls; preserve both rejected candidate sets. This uses fresh isolated ports
53500+ and the same brief/CLI rules. The global queue admits at most three builders.
Main merge 085cb67d7d adds fixture/test corrections only; repacking confirms every
client/expo/platform byte and native hash unchanged. Final consumer qualification
runs on a frozen checkout; no commits or Snapback4 edits until its receipt.
