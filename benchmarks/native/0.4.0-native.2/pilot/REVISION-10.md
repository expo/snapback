# Revision 10 — retain app setup results and finish both backend lanes

Authority: Lane P3 Round 1 user instruction, 2026-10-07. This revision changes
pilot orchestration only. Native.2 instrument/helper/UI/driver, builder prompts,
aids, pins, limits and authored applications remain unchanged. Scored use, O4,
overall and M7 remain disabled. Apartment mini and dedicated simulator
`3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B` only; never black M5 or office M1.

## Read-only M6 diagnosis

Retained packet: `/Users/ccheever/clique-native-pilot2-20261006-round2`.
Chain `chain-ff244727-a6b9-4f63-8af4-2204a9ab4df8` ended after
`results/snapback4/attempt-02/m6` with `selector-not-hittable`, driver exit 0,
`outcomeClass: setup`, independent validation valid/`pass: null`. No cold
assertion was entered. Both source audits and semantic handoff passed; Release
compilation, launch, Alice sign-in and direct-chat navigation succeeded.

The exact requested target was **`sm-convo-media` under `sm-convo-bubble`
with accessible value `0000000000SNJK6TFT4ZQTA5HP`**, the ordinary fixture
message, in `Driver.prime_app → media('ordinary', 'prime-ordinary')`.
`xctest.log` records the failed `sm-convo-media` existence wait. `tree-21.json`
shows the enclosing ordinary row hittable at y=559, height=93, and the view-once
row hittable at y=652. Neither media ID exists in the tree. `failure.png`
visibly has “Native ordinary” without an image and “Photo — view once”. This
is not merely an offscreen row or the driver looking for a different message.

The builder did **not** simply omit the two IDs from source:

- `src/Chat.tsx:85–88` makes the ordinary pressable/image conditional on
  `photo.status === 'ready'`. The ID is declared but its branch did not render.
  The ordinary viewer at line 93 also lacks the required viewer-image ID and
  media callback; this is a separate, unexercised wiring defect.
- `vendor/ui/src/MessageBubble.tsx:86` declares `sm-convo-viewonce`. This file
  is byte-identical to the supplied native kit (SHA-256
  `0acbb100270151001760e0a491e85358307c06dadf198d4b5e178d97076a450e`). The app
  wraps it in another pressable and renames its container `sm-convo-content`.
  That native node is exposed without children, despite the visible view-once
  label. Native accessibility exposure is missing in this composition; source
  occurrence is not exposure proof. The retained evidence does not isolate
  the nested app/kit cause. This was not the target that stopped prime.
- The backend `_assets` metadata binds the ordinary image to the exact message
  `photo` field, reports image/png, 640×480, 2062 bytes, and no release. The
  retained asset file hashes to the fixture descriptor's
  `7afbd9d91e6f1197e9fd392ba0a53dce78a66ee5a3a528a6c2641a82b2a0417c`.
  The view-once file is 2080 bytes and hashes to
  `ef284acb000e375fa4cffc07b3e2d228e47a6bf3b1f9078b4b7399d23c440101`.
  Read-only inspection of both backend and retained device SQLite confirms
  both exact message/asset references arrived, with `deleted: false`.
- `native-observations.jsonl` contains 124 events: 120 screen and four ready,
  **zero media load or error events**. Because image callbacks are inside the
  absent render branch, absence of an error event does not prove a successful
  download. Backend logs show adoption, service start, scheduled work and owned
  shutdown, with no asset request/error trace. The 64 captured app log messages
  contain UIKit/keyboard/haptic diagnostics, no asset/download/auth error.
  No retained HTTP asset trace or hook error state identifies the exact reason
  `useAsset` never supplied a ready display handle. Do not invent that cause.
- `scripts/native-seed.mjs` uses ordinary upload/sendMedia/sendOnce paths and
  creates the matching rows/assets. The read-only Bob oracle queries history;
  prime never reaches it. There is no evidence that the fixture, oracle or
  driver's specified selector caused the missing ordinary-image branch.

**Disposition: Snapback 4 app failure, native M6 unmeasured during prime.**
Keep raw receipts, `pass: null`, and all original files unchanged; do not
fabricate failed cold assertions, a score, or a passing measurement. Do not
repair the app or rerun M6. This result remains in this backend's matrix.

There is also a secondary `invalid-startup-video:video-endpoint-uncovered`
instrument finding recorded after the primary selector failure. Retain it as
an evidence limitation; screenshots/trees/source and fixture/store records
establish the primary failure independently. It did not make the selector
absent and grants no product retry. This revision neither changes video
validation nor claims complete video coverage or pilot acceptance.

## Chain policy

Under LLP 0201.000 §4, raw assertion validity and chain attribution are separate.
A valid unmeasured driver outcome caused by the app (missing/unhittable contract
selector, startup crash, sign-in/restore failure, missing fixture row or failed
prime-media behavior) is a completed backend result. The harness records
`disposition: app-unmeasured`, application attribution and `pass: null`, and
returns success **for orchestration**, allowing M8 and the next backend.
No product/setup retry is authorized by this classification.

Attribution requires a recognized reason, the driver's matching primary
`setup` failure, corroborating foreground/not-running app state, successful
independent evidence validation and the expected driver exit. Unknown setup
reasons require triage. Host/simulator/runner faults, invalid evidence, verdict
mismatch and incomplete cleanup stop progression. The specific secondary
startup-video endpoint shortfall above can coexist with an independently
observed app failure; other secondary infrastructure failures still stop.
No valid pass or failed assertion is rewritten by this policy.

## Bound one-use continuation

Preserve `PACKET.v9.sha256` and the prior harness/metadata under
`preparation/revision10/prior-packet/`. Seal the exact v9→v10 diff, disposition,
read-only diagnosis and evidence bindings in `metadata/revision-10.json`.
`attempts/snapback4-m6-app-setup/DISPOSITION.json` binds the original attempt,
prior chains, prepared source/dependencies, passing admission and Release
identity. Admission rejects drift, an already used continuation, existing M8
store, live owned builder, occupied ports or a non-cold Convex lane.

`pilot-chain.sh --resume-product-setup` performs:

1. Normal Snapback 4 M8, recorded under `attempt-03/m8`, using the exact
   attempt-02 Release app and prepared work. Its summary carries a reference
   to retained attempt-02 M6; there is no new M6 execution, build, preparation,
   builder edit or diagnostic lane. M8's ordinary independent store and
   installation/cleanup rules remain intact.
2. The original unchanged Convex builder with normalized non-cached input plus
   output metering, unchanged four-hour/2M limits and cumulative replay clock.
3. Normal Convex custody, both audits, semantic handoff, Release build, M6 and
   M8, using the same app-result continuation policy.

The handoff stops waiting once Convex has demonstrably started and its live
meter reports the correct token basis; the detached chain continues unattended.
Every earlier seal, attempt, chain, log and outcome remains recoverable.

## Verification

Self-tests cover recognized app startup/selector failures, host/simulator and
unknown failures, invalid evidence, secondary cleanup/video distinctions,
normal M8 execution on the retained build with byte-unchanged M6 evidence,
chain order and infrastructure stop, and one-use/cold-Convex admission. Run the
complete pilot self-test suite on the packet's pinned Python runtime, then
packet readiness and resume admission. Retain exact receipts in
`preparation/revision10/`; no qualification or native pass is inferred.

Executed checks before sealing: macOS **86 tests passed**, no skips (14.532 s);
Linux **86 tests passed**, four macOS-only skips (3.564 s). The first Linux
invocation lacked jsonschema; the retained passing run uses a dedicated venv
with jsonschema 4.25.1. A missing temporary `attempts/` fixture directory in the
new custody test was fixed; failed preparation test logs remain alongside final
receipts. `git diff --check` and `ref-check` pass (529 LLPs, zero errors).
Repository-source `freeze.mjs --check` reports pilot-source drift, also present
at baseline 5091428e91 from revisions 8–9; do not rewrite that qualified
instrument seal. The packet separately preserves its original native component
and verifies every frozen component byte on readiness. Revision 10 seals only
the disclosed operator harness change.
