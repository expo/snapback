# Revision 7 — Round 6 wrapper admission and complete static preflight

Authority: Lane P2A Round 6 user instruction. This is a harness correction;
builder trees, prompts, authoring inputs and the qualified native instrument
remain unchanged. The exact changes are bound by `metadata/harness-v6-v7.diff`.

## Wrapper and source qualification

Round 3 required every authored bash wrapper to receive exactly DerivedData and
the dedicated UDID. Convex supplied `["bash", "scripts/native-build.sh", "@DERIVED@"]`.
Its actual command compiles the custody workspace with Release, simulator SDK,
generic iOS Simulator destination and `$1` DerivedData. The published operator
interface permits argv wrappers; ENVIRONMENT explicitly permits this destination.
The rejection was an unstated harness restriction, not a builder failure.

Both lanes now admit wrapper arguments `[DerivedData]` or `[DerivedData, UDID]`.
The script must resolve inside custody. This shape check does not qualify the
script: both gating source audits still trace its actual invocation, substitutions,
branches, workspace, generated project and build phases. They require compilation
from custody, Release, the fresh attempt's exact DerivedData, simulator SDK
(explicit or resolved from the simulator destination), either the dedicated UDID
or the documented generic simulator destination, and only the build action.
The direct-xcodebuild path also accepts either simulator destination. It checks
actual action tokens rather than rejecting a path merely containing `test`.

After compilation the operator verifies the resolved app remains inside that
fresh DerivedData, in Release-iphonesimulator, with simulator platform metadata,
an arm64 slice and an arm64 IOSSIMULATOR Mach-O build version. Existing Hermes
and bundle/native digest checks remain. The unchanged qualified driver installs
on the dedicated UDID and verifies installed identity before seeding. No generic
destination is used for installation or measurement.

## Static admission before execution

`after.py --static-work <retained-work> <backend>` performs no model call,
backend start, simulator action, prepare or build. `--static-scratch <path>` can
project a fresh attempt without creating it. The same function runs before the
first gating source audit on every normal after-builder attempt. It collects
all independent refusals in `static-admission.json`, covering both segments:

- JSON handoff, exact bundle ID and work-copy symlink confinement;
- every argv's shape, known token substitution and declared path confinement;
- ordinary shell/Node/Python script entrypoint resolution;
- exact owned Convex launcher, per-segment store/origin/evidence and sealed binary;
- app path in fresh DerivedData and DerivedData absence;
- wrapper resolution/argument shape or direct Release/simulator/build-only argv;
- presence and confinement of both fixture image files.

Computed paths and behavior inside authored source still require the source
audits. Generated build inputs, runtime platform identity, installation and
driver/validator evidence cannot be established by a static admission pass.
Readiness separately checks the packet, toolchain, qualified runner and sealed
operator environment. Custody/reclassification admission remains bound to full
retained inventories and the completed chains.

Convex: all 22 static checks pass. Under revision 6 its wrapper shape was the
only handoff refusal found. Snapback 4: 21 pass, with existing DerivedData the
sole refusal on the already-used diagnostic scratch; projecting fresh output
passes all 22. This is an expected no-reuse guard, not a builder defect or reason
to erase retained products. The existing SB4 product also passes the new
simulator/arm64/Release check without a build or simulator operation.

Source inspection additionally records **both** builders' fixture-body defects:
Snapback 4 emits `Native queued first <runId>` / `Native queued second <runId>`;
Convex emits `First queued message <runId>` / `Second queued message <runId>`.
The frozen contract requires `<runId>:first` / `<runId>:second`. These are findings,
not harness repairs. No adapter is executed or rewritten for the static check.
The earlier SB4 passive-hook/oracle source refusal also remains in force.

## Retention and continuation

`chain-85cdc744-6413-4ca7-b3de-ec8f4566c7e2` and Convex `attempt-01` stopped at
`builder-handoff` after 140.186 seconds, before any source audit, preparation or
build. Their original files remain intact. The sealed revision binds
`attempts/convex-wrapper-refusal-reclassified/RECLASSIFICATION.json`, which
supersedes the old unclassified outcome as **harness-defect-refusal**, product
outcome null, **zero setup reruns consumed**. It binds the original attempt,
retained work, custody and prior chains; the revision-6 packet and harness are
retained. Authoring and its earlier replay reclassification are unchanged.

The one-use `pilot-chain.sh --continue-round6` launches only Convex after-builder,
with `--resume-wrapper-refusal`. It creates attempt-02 and fresh scratch from the
existing verified custody source, runs static admission, and preserves both
normal gating source audits and the unchanged driver/validator path. It launches
no builder and changes no authored argv. Reuse after a new chain/attempt refuses.
This special harness continuation does not consume the documented setup retry.

No SB4 diagnostic is queued: it already passed build and reached fixture
validation. This wrapper change cannot get the unchanged diagnostic beyond its
known fixture-body failure. Its source-refused, never-admissible, no-pass labels
and all diagnostic evidence remain unchanged.

## Verification and scope

Regression inputs contain the exact retained native-operator JSON and build
wrapper bytes for both lanes, with provenance in `scripts/fixtures/round6.json`.
Tests cover both handoffs, all-refusal collection, path/token/launcher rejection,
wrapper symlink escapes, generic and dedicated destination admission, forbidden
build actions, arm64 simulator identity, amended audit prompts and one-use
continuation. Readiness and self-test receipts live under `preparation/round6/`.
The operator records progress past source audit into prepare/build without waiting
for the driver. No native result, pass or score follows from that progress.

Governing context remains LLP 0201.000 §§3–7 and LLP 0201 D7; this correction
changes neither fixture semantics nor the qualification instrument. Only eb1000
and the Apartment mini are used. Commit locally with the required Astra trailer;
no push.
