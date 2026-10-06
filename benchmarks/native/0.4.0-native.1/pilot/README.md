# Unscored native pilot packet (P2A)

The authorized Round 5 retains Convex's completed authoring and starts its
normal gating native measurement. Its required post-M8 replay and reports were
prevented by the single-interval harness rule. Both lanes now share that
post-M8 replay/report omission. Replay intervals share one cumulative ceiling;
see [REVISION-6.md](REVISION-6.md).

SB4's diagnostic stopped before launch because its builder seed violates the
queued-body nonce contract. It is not a launch crash; the later XCTest snapshot
and xcodebuild diagnostic-environment errors are secondary. No diagnostic rerun
is queued. Every original SB4 diagnostic remains
`diagnostic: audit-refused, never admissible, no pass claimed`, and the original
source-audit refusal remains its native outcome. Revisions 2–5 remain historical;
attempt 1 alone is retained as a harness-defect void.

On the Apartment mini, continue once with the sealed Round 5 ruling:

```sh
cd ~/clique-native-pilot-20261005
./pilot-chain.sh --continue-round5
```

For a fresh packet with no prior chain, omit `--restart-void`.

Before launching, `python3 scripts/verify.py --cold --ready` must pass in the
environment supplied by the shell wrappers. A missing qualified XCTest runner
is a setup refusal. `runtime/runner.json` names its `binary` and `xctestrun`;
the actual test bundle must match `QUALIFIED.json`'s binary digest. Supply the
retained runner and dependencies; never rewrite the trust anchor to bless a
freshly built binary. See metadata/readiness.json for this packet's preparation
findings. The launcher checks this before spending builder tokens.

`launch-builder.sh snapback4|convex` renders identically, verifies frozen inputs,
records safety limits, and starts a detached Codex supervisor. It retains
start/end/PID, NDJSON, stderr, native rollout and checksum-validating native usage.
Model is gpt-6-astra, medium. Limits are 4 hours / 2M non-cached tokens per milestone
(normalized input + output; reasoning included, cache reads/writes recorded but uncapped),
with one cumulative four-hour replay wall ceiling across any number of
non-overlapping intervals during M6 or M8. Builder boundary requests and
operator observation times are retained; safety sampling is conservative and
does not claim the frozen scored meter's first-green settlement attribution.
Final publication of pilot costs still requires independent metering against
the raw rollout and suite/choreography terminals. Missing native usage stops.

Native build access includes Git configuration, native tool metadata, CocoaPods,
Expo/Convex CLI state and new default DerivedData directories. For the serial
build window, `com.apple.dt.Xcode:IDEPackageSupportDisableManifestSandbox` is set
to true so SwiftPM does not try to apply an incompatible nested sandbox. Its
previous boolean value or absence is recorded and restored after child cleanup;
the inherited outer sandbox still enforces file denial, including nested builds.
The serial lease covers the recorded pre-builder DerivedData listing, confirmed
child cleanup and atomic relocation of newly created directories to
`runtime/builder-BACKEND/derived-data`. Pre-existing project products, Xcode
archives and simulator app data are denied. A failed/interrupted relocation
leaves `runtime/derived-data-active.json`, which blocks readiness and another
builder until the operator reconciles the retained evidence. After-builder
waits for this cleanup before checking readiness or cloning source.

`after-builder.sh` requires a normal builder end or a sealed revision-4 or revision-6
completed-authoring reclassification, plus verified process cleanup, takes and verifies a complete APFS custody clone, then
prepares/builds the builder's own Release app in a new /tmp work copy. It retains
source/dependency/native/Hermes hashes and operation clocks. Only the dedicated
simulator is used. M6 and M8 each get a fresh install and separate store; each
segment preserves the same installation and store through its prime/offline/
restart steps. The qualified generic driver owns the backend. The oracle is
builder-authored raw read-only mapping, independently source-audited after
custody by a fresh read-only gpt-6-astra/medium session before any build or
adapter execution, and again after preparation over the generated native source. This operator review has its own transcript, source binding
and clock; a refusal records `handoff-refused-by-source-audit` and stops that
ordinary measurement. Both audit stages receive the exact sealed mandated
toolchain script and fixed operator environment. The Round 4 SB4 diagnostic's
prepared audit is recorded but non-gating. The harness separately invokes the trusted
artifact validator.

All failed attempts and scratch remain. Existing launch/results are never
overwritten. A restart requires the explicit bound VOID record and is recorded
in the new chain; the retained void consumes no setup rerun. A single setup rerun is available through
`after-builder.sh BACKEND --repair /absolute/repair.json`, only after an initial
setup failure without a product failure. The repair record must contain a
nonempty `reason` and `scope: "operator-setup-only"`, with no other fields.
Builder commands and source cannot be replaced. A completed segment, observed
product failure, driver failure or unclassified authoring/build failure refuses
repair. Only explicitly attributed operator setup before measurement is eligible. Product code repairs are not
accepted here. Material prompt/kit/helper/driver changes require a new packet
and affected pilot milestones; no product retries until green.

The ordinary caffeinated chain runs Snapback 4 builder → after-builder → Convex
builder → after-builder and stops on setup failure. The historical Round 4
continuation runs Convex builder → after-builder → SB4 diagnostic, retaining
setup failures while still attempting the final diagnostic. Round 5 measures retained Convex only; both audits remain gating and the
SB4 diagnostic is not repeated. Product failures stay false in
the matrix, and no automatic retry erases them. Independent human/agent review
of full video, actual frames, passive hooks, oracle mapping and recycled native
accessibility remains mandatory. `REVIEW-REQUIRED.md` lists these tasks per
attempt. Negative controls must be selected and rerun where app wiring differs;
this harness cannot decide equivalence from receipts. Review is not faked by a
JSON boolean. M7 and M8 web convergence remain distinct. No O4 or overall scores.

To reproduce preparation, run scripts/cut.py with --repo and a new --out; it
exports native inventory bytes from QUALIFIED.json's source commit, overlays
only the explicitly post-build qualification record/commit marker, and exports
the inherited web manifest's own commit. Copy those components to
inputs/components, this harness to packet root, and the tested Convex binary to
inputs/convex. scripts/assemble.py creates both identical authoring views and
prompts; scripts/toolchain.py records the mini. Run scripts/convex-preflight.mjs
with an isolated npm project (convex 1.45.0, ws 8.18.3) and the binary path. Run
scripts/preflight.py for an absent-app preflight. Install pinned operator Python
and Playwright dependencies in runtime, collect metadata, then scripts/seal.py
and scripts/verify.py --cold. The packet inventory covers immutable source,
prompts, tools and metadata; runtime, preparation and all attempts stay separate.

The enclosing instrument's old freeze.mjs inventories every directory, including
this new pilot/ source. Do not run it to recut/overwrite the qualified native
candidate. `cut.py` reconstructs and checks the original 86-file inventory from
Git, and the packet's untouched native component passes its own freeze --check.
Harness source has its own PACKET.sha256, never a changed native trust anchor.

Adapted from cal30 render/run_phase/verify/template/operator custody and launch
scripts, and Sept 16 render/launch/run_campaign/Convex setup. Neither source
packet is modified. LLP context: 0201 D7 (pilot ceilings), 0201.000 §§3–7
(passive aids, owned backend, independent evidence, series break, retained setup
rerun). No new product design decision is introduced. Foundation orientation
uses LLP 0000; governing native RFC remains in llp/current. Hand-off: none;
post-pilot acceptance and any instrument changes remain owner decisions.


## Round 6 / revision 7

[REVISION-7.md](./REVISION-7.md) corrects the unstated two-argument wrapper
restriction and documents the complete static admission pass. Both documented
simulator destinations remain subject to gating source audits and independent
post-build arm64 simulator/Release checks. Run static admission without execution:

```sh
python3 scripts/after.py convex --static-work /path/to/retained/app
python3 scripts/after.py snapback4 --static-work /path/to/retained/app --static-scratch /path/to/fresh-projection
```

The sealed one-use `pilot-chain.sh --continue-round6` resumes only Convex native
measurement in attempt-02 after reclassifying attempt-01 as a retained harness
defect, zero setup reruns consumed. The original attempt and its scratch remain
unchanged. SB4 has no new harness reason to rerun its diagnostic; both lanes now
have recorded fixture-body source findings. See the revision and retained static
reports for every refusal; a static pass is not source-audit or native proof.
