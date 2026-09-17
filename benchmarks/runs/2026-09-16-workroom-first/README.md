# Workroom: qualification, calibration, then first cell

Date: 2026-09-16. State: **original pilot capped; supervised diagnostic
replay continuation; no cell result** (updated 2026-09-17 UTC).
Governing contract: [LLP 3000.009 §10.1](../../../llp/3000.009-general-purpose-backend.rfc.md#101-the-brief)
and [benchmark protocol](../../protocol.md).

Charlie requested the first Workroom cell and explicitly approved qualifying
and publishing its prerequisite release. During preflight another session
published `snapback4@0.2.26` from `fbefe0358`, with the receipt on main
`7df94ea36`. This run did not perform that publication. A fresh registry
installation on the control Mac reports 0.2.26, its Developer ID signature
verifies, and its binary SHA-256 is
`fa4834f3fd128f4c37f02c9c3954da95306bbf208b2c0c94eb34cda419e7d7be`,
matching the existing publication receipt. The package exports `./server`.
No additional release is needed merely to repeat that publication.

## Orientation and scope

- Scope of this run record: the Workroom instrument, application qualification
  and run evidence; no promotion or comparative claim. Charlie separately
  commissioned the remaining general-purpose program, including services and
  SQL, in [§14.7](../../../llp/3000.009-general-purpose-backend.rfc.md#14-the-authors-rulings-2026-09-15-and-2026-09-16).
  Those implementation lanes do not change this running application's pin.
- Governing LLPs: [3000 §3–4](../../../llp/3000-snapback4.explainer.md#3-the-bakeoff-protocol)
  (Snapback 4 corpus root, current working set),
  [3000.009 §10.1–10.2](../../../llp/3000.009-general-purpose-backend.rfc.md#101-the-brief)
  (current, application evidence determines service retention/removal), and the benchmark protocol.
- Constraints: published package, cold sessions, serial lanes on one machine,
  no application SQL in the first Snapback cell, real W3/W5 before that cell,
  calibration before freeze, independent outcomes and retained builder diary.
- Rationale: the existing A3 route witness omits full seat-limit/past-due
  authorization; fixture verification proves the instrument, not an app.
- Risks: unmeasured ceilings; the public brief currently embeds a supposedly
  private holdout section; its launch block needs bounded Workroom completion
  before freeze. Pilot failures remain failures. Pilot narrative and private
  lifecycle records can proceed now; before the actual cell, the base schema
  needs a bounded Workroom addition under protocol rule 7 (the older record
  guide's "optional" wording does not waive that run rule).
- Likely updates: brief/record shape, qualification receipts, run diary and
  report, RFC evidence, append-only journal, stale handoff disposition.
- Hand-off: none; execution remains within the commissioned instrument.

## Sequence registered before pilot results

1. Verify the published pin and prepare the backend-neutral packet.
2. Build a **diagnostic pilot** through W1–W7 on published 0.2.26, including
   canonical fixture replay and real W3/W5 application assertions. Preserve
   complete original action logs, actual state evidence and private receipts.
3. Independently verify W3/W5. Continue scale calibration and use a **fresh
   session** for W8. A failing/unmeasured probe cannot supply a ceiling.
4. Record measurements and the common cap/ceiling selection, resolve the
   brief's launch/holdout/record holes, then freeze the public packet.
5. Start separate empty applications and cold Astra, Grok and Muse builders
   for the first no-SQL Snapback configuration. No pilot code, implementation
   hints or mid-run steering enter those lanes.
6. Collect each builder's experience separately from independent
   acceptance/holdout outcomes; retain nulls and not-run results honestly. No comparative result
   without matched controls. Controls are due after freeze, serially on the
   same machine/model/effort.
7. Land evidence and bounded instrument updates, preserving raw private logs
   outside source control and leaving publication/promotion claims gated.

The pilot uses Codex `gpt-5.6-sol`, xhigh, a new CLI session on the Durand
M4 Pro (`100.85.133.74`), Node 24.13.1 and local development deployment.
It has a four-hour **operational safety limit**, not a calibrated benchmark
cap. W8 is separate. Stop before available disk falls below 2 GiB; do not
delete anyone else's artifacts. Preflight found this host quieter than the
other reachable Macs, with approximately 7.5 GiB free. The first cell and
controls must be requalified for host capacity at launch; pilot work is not
silently relabelled as a scored cell.

The diagnostic started at **2026-09-16 19:37:27 UTC** on Durand, using
Codex CLI 0.153.4, `gpt-5.6-sol` xhigh, Node 24.13.1 and the declared pin.
The launch receipt confirms all 31 packet-bound files, an empty app and
11.82 GiB free. Native builder thread:
`01a0abb9-5fa7-7a70-bbb3-22c9765ebbab`. Private lifecycle records are on Durand
under `/Users/ccheever/workroom-runs/20260916-pilot/private/`; the foreground
driver owns recorded PID/PGID 72357 and a four-hour operational limit.
Background indexing is active: functional evidence may proceed, but contended
timings cannot calibrate ceilings. No builder messages are being injected.

The prelaunch launcher passed its targeted safety mocks and independent Sol/Grok
source reviews, retained under `reviews/`. Sol cleared before launch; Grok's
inline-source review completed during diagnostic execution. The earlier Grok
attempt that returned no verdict is retained as incomplete, not counted.

### Original cap and explicit adoption

The original builder reached its four-hour operational limit at approximately
**2026-09-16 23:37 UTC**. Its foreground driver exited **124 / SIGTERM**;
the original private `end.json` and transcript are retained unchanged. The
builder did not deliver `FINAL.md` or a final message. This is a capped attempt,
not a completed or scored cell.

The canonical replay's acceptance child had created a separate process group,
**98850**, which survived the launcher's original-group cleanup. This is a
custody defect in the instrument, not evidence that cleanup succeeded. The
received prelaunch reviews remain historical; they do not qualify this missing
case. A bounded repair and an actual Codex-spawn regression witness are required
before a cold cell.

After checking the surviving group's recorded ancestry, UID, process start
identities and commands, the supervisor explicitly adopted that same replay
at **2026-09-17 00:13:26 UTC**, without changing the application or packet.
The adoption has a separate two-hour safety cap, a 2 GiB disk floor, and a
foreground monitor with its own lifecycle receipts under
`private/adoption-20260917T001326896Z-53865/` on Durand. At adoption the journal
had reached action 491,098 of 598,224. Its eventual completion and the original
child's exit status are separate facts; disappearance cannot recover an exit
status that the original parent did not retain.

A private APFS copy-on-write capture preserves files observed during replay.
It is **not a verified consistent/restorable backup**: the application was not
quiesced and the live SQLite/WAL files were not captured through a transactional
backup operation. No continuation erases the original cap, supplies a score,
or makes these contended timings suitable for frozen performance ceilings.

Charlie additionally authorized disk cleanup. On Durand, immediately rechecked
inactive and untracked Cargo debug caches, old-lane dependency trees and npm/Bun
download caches were removed; source, stores, credentials, release output and
test/benchmark evidence were preserved. Actual available space rose from
6.63 GiB to 12.77 GiB (6.14 GiB gained), less than the 20.23 GiB nominal removal
because dependency trees shared hardlinks. Recovery is by normal builds and
frozen dependency installation. The private exact-path receipt is
`/Users/ccheever/.codex/cleanup-receipts/2026-09-16-durand-cache-cleanup.md`
on Durand. No other host was cleaned.

A second bounded pass during the diagnostic replay removed only
`target/debug/{build,deps,incremental}` beneath the inactive
`exact-wp11-evidence-20260824` project and
`snapback-s2-benchmark/snapback2`. Each exact directory was rechecked for
physical/non-symlink identity, untracked content, no active build/process and
no open file or working directory. The first attempt stopped before deletion
because one path-resolution command was unavailable. The completed pass
recovered **6.79 GiB** immediately (6,988,268 → 14,110,484 KiB free), for
**12.93 GiB** measured across both passes. A later increase is not attributed
to cleanup. These build artifacts are regenerable by Cargo, not directly
recoverable; executables, release output, source, stores and evidence remain.
The private pass-2 receipt is
`/Users/ccheever/.codex/cleanup-receipts/2026-09-16-durand-cache-cleanup-pass2.md`
(SHA-256 `be79ef6857771fb4ad891af1a05a36b808858de70eeb7cd76bb39171e94c4d51`).
The overlapping cleanup is another reason not to use this replay's wall time
to calibrate a performance ceiling.

Only the public brief with its entire `Holdout probes` section removed is
delivered to the pilot; both source and rendered hashes are retained. The
original private section stays outside builder-accessible packet paths.
The revised frozen public brief will be identical across actual comparison
lanes. No model sees product source or another lane's application.

Measure the five named performance probes after validating the full fixture
state, with per-probe boundaries/sample policy recorded before sampling.
Orientation, authoring, acceptance and scale replay stay inside measured
time. Pilot observations do not support a platform score or frozen threshold
until the calibration disposition is written.

No task on this run may put load on `expo-build-1000`. Heavy verification,
replays and cells are serialized. Stop only PIDs/process groups recorded at
launch; preserve application stores and receipts for diagnosis.

## Three-family interpretation and record-format correction

Before any pilot acceptance green or scored launch, the supervisor found and
corrected its interpretation of "the three scorers." The inherited
[September 5 commission](../2026-09-05-clique-full-3x3/README.md) says to do the
entire program with each model separately; its scorers read their own family's
builder narratives, not independently grade outcomes. The
[September 14 three-model cell](../2026-09-14-snapback4-clique-0.2.10/README.md)
likewise has three independent applications, three family-specific experience
scores and separate outcome grades. Workroom retains its own declared B/O
dimensions, not Clique's older narrative rubric.

Thus the first configuration needs one machine record per independent
`(backend, builder family, repetition)` run: that builder's B1–B10 and holistic
judgment, plus a separately identified independent outcome grade. Astra, Grok
and Muse do not become three outcome judges sharing one builder's experience.
Matching Convex and Supabase lanes use the same family/model/effort, machine
and public packet, serially. Exact model versions/efforts, lane order, grader
assignment and calibrated caps remain to be registered at freeze. The Sol
pilot is diagnostic-only and does not replace any of those cold builds.

The initial local schema addition at `ff50d3fed` incorrectly required the
three-outcome-panel shape. Its ten passing tests and received Sol/Grok reviews
remain evidence about that revision, not approval of the experimental design.
The correction is integrated at `5bcfcbf0e`: one lane-local `outcome`, the
declared weights and explicit-null discipline, with no fixed grader family.
All 31 focused record/fixture tests pass on that commit (13 record tests and
18 fixture tests, no skips). Fresh mutually blind Sol and Grok reviews clear
that exact four-file net delta; their received verdicts are retained under
`reviews/`. Reference validation reports 481 docs, 9,032 refs, zero errors and
zero unchecked refs. No score has been assigned; comparative publisher
rendering remains outside this bounded record-admission change and is
unqualified.
