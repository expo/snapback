# TOK3 whole-session method

The primary comparison is `clean-before` / `clean-after`: four original wave-34
ideas, one whole native builder session per idea on each side. Codex 001 CPAP
Equipment Setups (Expo) and 039 Boat Shrink Wrapping; Muse 019 Child Talent
Bookings and 018 Horse Trailer Rentals include the decomposition’s section
hoppers. Each launch creates an app directory containing only the original
rendered BRIEF.md. It has no package manifest, dependency tree or installed
Snapback. Only the task-owned directory and allocated port range change in the
brief. Models receive no TOK3 hints or interim intervention.

`replay-whole-session.mjs` is the executed runner. It imports the harness’s
builderEnvironment and uses its native model names, reasoning and CLI flags.
Codex receives the brief on stdin; Muse receives its original prompt file through
muse-exec.sh, including that wrapper’s quota fallback. Sessions run through their
terminal responses, with exit status and REPORT.md presence recorded. The full
post-builder bakeoff scorer was not run; terminal exit is not a capability claim.

The registry overlay pins client/platform/Expo tarballs and forwards other
requests, preserving HTTP methods and bodies, to the existing bakeoff mirror.
Before uses the frozen original 0.4.44 packages (integrities checked against
wave 34); after uses packed source 1846658b08 and an optimized **host production**
CLI, not a development binary. Both tarball and executable hashes are in
package-provenance.json. No version bump or publication occurred. Expo/native
Mac qualification was skipped. Temporary roots are short, separate cb-N/ca-N
paths beneath /tmp/tok3-replay/t, matching the harness’s short-temp convention.
All substantial concurrent jobs use user systemd scopes capped at 40G, at most
four jobs at a time.

`measure-whole-sessions.py` uses the original wave-34 native-session parser,
including its corrected Codex call index. Native usage records, rather than
Muse’s task-level stdout, supply calls and input/cached/output tokens. Input
includes cache reads; uncached=input-cached. Each row retains native-session
identifiers and per-call usage/categories/diagnostic codes. Guide commands are
redacted; raw transcripts and account secrets are not committed.

Guide reads count explicit CLI invocations, including --find, --section,
--repeat, --full and deduplicated zero-new-block responses. API digests and
ordinary cards are also split out. First schema means the parser’s first authored
schema.q write, not initializer output. A guide invocation on that same model
call is conservatively counted after the write. Declaration reads count package
source commands naming .d.ts; README/reference counts are per matching tool
command. These are observable command counts, not claims about model attention.
Wall is native builder launch to process exit and includes install/proofs.

The earlier `before`, `after` and `final` labels are exploratory, **not the bar**.
They used long TMPDIRs which hit Chromium socket limits and development after
binaries; after trials also exposed invalid nullable prose, now corrected and
executed verbatim by tests. Eleven exploratory sessions ended normally. The
fourth revision trial (Muse 018) was explicitly aborted and excluded from
complete-session measurements. The abort receipt and every completed exploratory
measurement remain available. No favorable exploratory number substitutes for a
clean control. One draw per idea is descriptive, with no statistical inference.

The final affected receipt uses the repository selector’s planner and runPlan,
with explicit scoped tests because its source-family closure includes the full
five-crate/client battery forbidden by this brief. It is marked
fullSelectorPlanExecuted:false and qualification:false. The unchanged W8B
residency calibration already passed in the earlier run and is not repeated.
No complete publication qualification or performance target is inferred from
source-byte budgets or a passing literal recipe.
