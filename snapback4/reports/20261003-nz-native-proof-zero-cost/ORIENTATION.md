# NZ context

Scope: Expo export wrapper, witness publication/custody/status, doctor output,
starter scripts/READMEs and the witness guide. Engineering Snapback 4; no app
authoring or engine/contract change. Base: WD `38d9bfe0de`.

Governing LLPs: [3000 §4](../../../llp/3000-snapback4.explainer.md#4-fence-numbering-routing)
(independent fence), [2000.000 §11–12](../../../llp/2000.000-keep-the-core-flip-two-substrates.rfc.md)
(native boundary witness; measured loop), and
[3000.030 §13, §15](../../../llp/3000.030-native-proof-in-minutes.rfc.md#15-export-proves-native-execution-nx-rounds-08-2026-10-02)
(bounded preparation and exact export proof). The root and native-proof LLP
are not linked in this checkout's foundation/current sets.

Active constraints and rationale:

- LLP 3000.030 §15: independently verify selected HBC on prime/offline/restart;
  exact native/dependency audit, conservative unknown-plugin fallback.
- LLP 3000.030 §15: wrapper/export/run leases, atomic publication rollback,
  durable creation intent, birth-bound cleanup, native supervisor/anchor custody.
- LLP 3000.030 §13: select only tool-created, recorded, leased simulators;
  never infer ownership from a name or reclaim another backend's port.
- LLP 3000 §4 and rules/RULES.md: no engine changes, budget increases or
  broad process machinery. The user's commission authorizes the background
  command, focused regression coverage and local measurement tools.

Risks: detach must transfer custody before command exit; supersession must
serialize through cleanup; publication must not claim a still-pending proof;
status must expose dead workers; sleep must invalidate execution and clean up
on wake. Darwin birth/signal and simultaneous-watchdog-destruction residuals
from §15 still apply. Simulator services are not ordinary inherited child work,
so QoS and foreground interference require measurement, not an E-core promise.
Current 0.4.12 dependency audit drift is independently ticketed by WD; use
the archived, checksum-verified 0.4.11 fixtures for matched warm comparisons,
and report the scope explicitly without weakening the audit.

Doc updates: dated §15 revision, append-only JOURNAL, starter READMEs,
`guide witness`, local report. Hand-off: none.

Round 1 (2026-10-03): the user's explicit revision authorizes only automatic
background preparation to earn time from progress, capped near 60 minutes.
Foreground preparation remains 900 seconds; custody/step/cleanup policies stay.
The user also replaces quiet-only admission with recorded-load ABBA on this
host as it is. No host, simulator, process-signalling or push restriction changes.

Round 2 (2026-10-04): merge origin/main at abafa9af9c into NZ as a merge
commit. LLP 3000.030 §15 now includes landed WD round 1 byte-based Linux
inspection, scoped member validation and idle/hard cleanup diagnostics alongside
NZ background preparation. Preserve both policies and both journal histories.
Starter READMEs/scripts and guide witness retain the background default and status
commands. This integration requests Mac build/witness/JavaScript tests, plain and
social warm round trips, and the complete Mac suite. No push; same host/ownership
constraints. Hand-off: none.

Round 2 suite follow-up: LLP 3000#http-overload-diagnostics keeps engine/request
producers nonblocking; #contended-read-serving governs the existing bounded
startup drain. LLP 3000.026#4-atomic-launch-adoption and guide feeds require
the adoption estimate to be visible. Apply the same bounded drain only after
release-command custody ends, with a delayed-writer process regression.

Round 2 Mac capability tests: LLP 3000.022 §14.3 and RP's selective legacy
decoding require every new source price (including zero) to carry v1/v2. Keep
the authentic pre-RP capability-free fixture unchanged, create old adoption
stores with the published old compiler, and test current-output refusal on old
native/WASM engines. No runtime fence or schema normalization changes.

Round 2 local-network fixture follow-up: LLP 3000.019's per-response
development evidence and guide bounds require the actual loopback listener/peer
fence. Keep HTTP assertions on a real non-loopback interface, but enumerate
local up IPv4 addresses instead of depending on a route to 192.0.2.1. Test-only;
no network configuration, disclosure boundary or runtime change.

Round 3 (2026-10-04): build on the completed Round 2 merge, a6af2febbb.
LLP 3000.030 §15 governs native retention custody, publication identity and
background/foreground bounds. The author explicitly requests bounded retention,
current-publication reporting and a documented choice on activity versus semantic
progress. Preserve WD's process-group drain/scoped enumeration unchanged. Read
both commissioned reviews from eb1000 using read-only SSH; all implementation
and verification stays on this mini. No new review delegation or publication.
Doc targets: dated §15, witness guide, Round 3 report and append-only JOURNAL.
Hand-off: none.

Round 4 (2026-10-04), base e7e325b7d1: LLP 3000.030 §15 governs both skipped
and background publication, retention custody and reporting linearization. The
operator's commissioned Astra/Grok findings require atomic skipped publication,
short orphan-reconciliation lock ownership, bounded public retention entry,
maintenance deferral, consistent status observations and commit-time request
timestamps. Preserve the accepted 900-second idle / 60-minute activity bound and
WD group drain/scoped enumeration; no repeated-line filter. Tests must exercise
the specified interleavings without touching FX or any unowned process/device.
Doc targets: §15, guide witness, both package READMEs, both generated starter
READMEs, Round 4 report and append-only JOURNAL. No delegate/review/ship skill
is required: this is a local correction with explicit no-push authority.
Hand-off: none.


Round 5 (2026-10-04), base 7f0ef58712: LLP 3000.030 §15 still governs the
private-tree publication, exact generation handoff and 5-full/20-compressed
retention contract. The operator requests detached bounded maintenance for both
skipped modes, after the publication lock is released, and exact verifiedAt
parity. Retain the same 30-second custody and WD drain, make retention-lock
waiting background-only and include it in that budget. Preserve proof outcomes,
all foreground preparation bounds and recorded ownership; no real device is
needed. Tests must reproduce 28 skips per mode and prove publication completes
while compression is paused. Update stale §15 prose, guide witness, Round 5 report
and append-only JOURNAL. No other worktrees, hosts, processes or simulators.
Hand-off: none.


Round 6 (2026-10-04), base f118e78bf2: LLP 3000.030 §15's publication identity,
leased ownership and bounded retention govern the fixes. Pin the current and
pending publication evidence without holding the destination lock over work;
coalesce requests without putting maintenance waits on export publication.
Preserve native owner-death custody, 30-second work deadline and WD drain.
The operator explicitly supersedes round 5's per-request lock-wait design.
Tests must exercise late publication, contended scheduling, and a substantive
post-crash 5/20 restoration using real full fixture exports. Scope: retention,
recovery, export-background tests, witness guide and dated §15; report/JOURNAL.
No new real native, cross-host or independent-review claim. Hand-off: none.


Round 7 (2026-10-04), base d488a5f7db: LLP 3000.030 §15 governs durable
maintenance, generation pins, leases and bounded process custody. The operator's
Astra reproduction requires a successful scan to preserve every skipped unfinished
discovery; Grok requires passive publication-lock backoff rather than a worker
respawn loop. Preserve the round-6 5/20 quiescent bound, one active custodian plus
one pending observer, fail-closed current status and unchanged WD/preparation
policies. Scope: recovery discovery, observer readiness, post-commit scheduling,
three-mode failed-handoff/held-wrapper tests and the held-publication-lock control.
Doc targets: dated §15, witness guide, Round 7 report and append-only JOURNAL.
No other host, worktree, process or simulator; no new native measurement or
independent review is claimed. Hand-off: none.
