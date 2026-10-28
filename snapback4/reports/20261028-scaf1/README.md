# SCAF1: generated proof scaffolding, measured without changing first-read content

Product source: 1ccf620a0a; both independent final-delta reviews are READY in
llp/reviews (review-record commit 8626bfb493). No version bump or publication.
The generated directory is scripts/proof-scaffold. The next guide changes entry
is 0.4.47. Root WORKSTREAM-REPORT.md records the final state and limitations.

Measurement uses wave-34 assignments 001/039 (Codex high), 019/018 (Muse high).
The retained runners use the harness's exact builder CLIs/flags and existing
BRIEF.md, with only assigned paths/ports and the requested 0.4.46 pin changed.
Each app begins with BRIEF.md only and no installed package. Each cohort uses
its own local registry serving retained tarball bytes; other npm traffic uses
the existing harness mirror. Both binary snapshots use Rust 1.97.0 production
optimization (opt3/fat LTO/one codegen unit/stripped), GNU Linux for matched host
replays. Separate consumer-only qualification builds musl. Package provenance
records all binary and tarball SHA-256 values. No Mac execution.

Reconstruct /tmp/scaf1-replay/baseline-source with git archive 1c4c51b551 and the
Snapback 4 workspace inputs, including rust-toolchain.toml. Build each snapshot
with CARGO_BUILD_JOBS=4 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
CARGO_PROFILE_TEST_DEBUG=0 cargo build -p snapback4 --profile production. If
reusing the shared target and replacing source at the same snapshot path, update
source mtimes so Cargo cannot trust older same-path metadata; assert the built
hash and a fresh green-check smoke before packing. Pack the client/platform/Expo
at 0.4.46 and start registry.mjs with that directory and a unique label. Run
replay.mjs with unique phase and registry URL under the brief's systemd memory
scope. Never reuse an app path. The final after phase is final-after.

measure.py reads the actual native Codex/Muse session logs using wave34-repro's
parser, without truncating shell commands before classification. It reports all
model calls, full input including cache, cached/uncached input, output and whole
builder wall. Post-schema counts conservatively include the first schema-write
model call. A lookup call is a tool invocation containing guide reads or reads
from the installed snapback4 package; multiple guide commands in one invocation
count once. Individual guide-command counts are also retained. Reading generated
app code is recorded separately, not counted as an external API lookup. Native
sessions and raw streams remain local; no credential-bearing app roster or raw
transcript is committed. One draw per idea/side is observational, not a causal
or significance claim. The first-read corpus is deliberately the frozen 0.4.46
content: TOK4 owns its change.

strength.py clones completed apps, links their installed packages, runs ordinary
acceptance, then changes the stored approval actor, an exact deadline/approval
refusal code, or removes that time/approval guard. Negative controls must fail
with ERR_ASSERTION, not a compile/setup refusal. These demonstrate only those
holes; they are not exhaustive security equivalence. They also do not establish
that unused generated scaffolds replaced the builder's suite. The packed packet
separately executes role/guard/upload/clock/approval assertions, six real browser
accounts and eight deliberate missing/wrong-proof controls. Probe runtime checks
real password accounts, mode-0600 roster, one readiness line and clean SIGTERM.

All excluded attempts are retained as explicit JSON accounting: wrong pin,
development-profile runs, an unfrozen exploratory after run, and the cohort
stopped to fix the introduced verdict-first compatibility defect. They are not
pooled with the final comparison. Final source and briefs stay frozen during
that comparison. All replay app copies are deleted after evidence capture.
