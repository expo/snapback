# Workroom: qualification, calibration, then first cell

Date: 2026-09-16. State: **preparing the diagnostic pilot; no cell result**.
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

- Scope: the Workroom instrument, application qualification and run evidence;
  no new backend services, SQL implementation, promotion or comparative claim.
- Governing LLPs: [3000 §3–4](../../../llp/3000-snapback4.explainer.md#3-the-bakeoff-protocol)
  (Snapback 4 corpus root, current working set),
  [3000.009 §10.1–10.2](../../../llp/3000.009-general-purpose-backend.rfc.md#101-the-brief)
  (current, application evidence chooses services), and the benchmark protocol.
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
5. Start a new empty application and cold builder for the first no-SQL cell.
   No pilot code, implementation hints or mid-run steering enter that lane.
6. Collect independent acceptance/holdout outcomes and the three declared
   scorers; retain nulls and not-run results honestly. No comparative result
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

Charlie additionally authorized disk cleanup. On Durand, immediately rechecked
inactive and untracked Cargo debug caches, old-lane dependency trees and npm/Bun
download caches were removed; source, stores, credentials, release output and
test/benchmark evidence were preserved. Actual available space rose from
6.63 GiB to 12.77 GiB (6.14 GiB gained), less than the 20.23 GiB nominal removal
because dependency trees shared hardlinks. Recovery is by normal builds and
frozen dependency installation. The private exact-path receipt is
`/Users/ccheever/.codex/cleanup-receipts/2026-09-16-durand-cache-cleanup.md`
on Durand. No other host was cleaned.

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
