# Snapback 4 excellence increment — 2026-09-14

Source base: `5ec0a75a2db71ba4f7b764eacb89cf1501ec0c14`. Frozen integrated implementation reviewed: `17bde96d80ab5b5b520feb2c0a8ee234bc1d42cd`. The program follows [LLP 3000.008](../../../llp/3000.008-holistic-product-excellence.rfc.md). Later fixture/evidence-only changes and delivered source are identified below.

Charlie requested the usual panel, including the author, then implementation of directionally sound work using Astra. Independent Astra, Grok4.6, MuseSpark1.3 and ClaudeFable5.1 reviews all returned READY WITH CHANGES. The author pass is separate, not a fifth independent vote. The six RFCs reconcile already shipped work, retain LLP3000.007 ownership and select a finite completion increment. Their review artifacts preserve the received findings and disclose formatting-only normalization.

## Reproduced gaps and corrections

| Boundary | Before | Corrected behavior and evidence |
| --- | --- | --- |
| Replay result | Both clients promised `result` despite an execution-only replay receipt | Fresh values/null and `replayed: true` without a result are distinct in types, client outcomes and React. Four baseline failures;25 focused tests green. Existing historical-result withholding remains. |
| Acquisition | Backend installation followed by sync failure produced apparently complete empty lists, zero counts or negative point reads | Generation-scoped acquisition commits with snapshot/catch-up; reset invalidates it. Wasm/process and offline-reopen cases reproduced;76 device and19 acquisition/residency/retention tests green. Old stores need one online sync. |
| Browser persistence | Aborted save could leave uncommitted in-memory state; failed open leaked ownership | Failed calls discard the device and restore only persisted data. Earlier queued writes survive, close serializes and failed open releases locks. Six real-wasm tests plus fault-injected Chromium IndexedDB and fresh-realm offline reopen pass. |
| Runtime installation | After initialized-A/cache-save failure, wasm-bindgen could accept incompatible B through its shortcut and poison offline installation | Promotion follows successful linking/initialization. Initialized identity survives save failure; only same bytes retry in that realm. Actual incompatible-import regression and zero-fetch fresh offline reopen pass. |
| Stopped restore | A copied absolute store link followed the original deployment, or a dangling old link prevented startup | Relative generated links are repaired under deployment lock; regular files refuse.12 release and30 CLI tests pass, including whole `cp -a`, backed-up auth/dedup/jobs/effects/assets, fresh process device, widening/refusal/rollback. |
| Native replay latency |273 writes eventually drained in20.25 s, failing the original15 s deadline | Accepted TCP sockets use TCP_NODELAY. Same instrument drains4.61 s; sync body median40.7→0.3ms, total11,093→93ms. Original test/deadline unchanged; transport+adjacent seams15/15 green. |

The socket comparison uses the same Linux debug workload and ordinary SQLite build flags, not the packaged production configuration. It is a measured correction, not a universal target. Runtime and source identities are retained with the evidence. The initial shell-default Rust1.93.1 attribution in the vendor note is corrected to the actual pinned1.97.0 build after checking ELF/compiler receipts.

## Application evidence and limits

The bounded ranking regression executes the existing feeds-card query:1500 candidates place winning IDs beyond200/1000;8193 candidates with the true winner beyond8192 produce truthful incompleteness. No unbounded ranking engine was added.

The browser scale witness checks required transfer counts and representative exact local queries before recording completion, with six snapshot pages and catch-up for40 groups×500 messages×10 members (20,440 seeded rows;20,480 replica events). Offline reopen uses a new JavaScript realm with backend and Wasm requests blocked and exact result identities checked. The HTML/JavaScript shell is served for each realm; it does not measure application authentication/rendering, peak memory, an iPhone, or the full Clique fixture/floor. Production-candidate results follow below; the committed baseline debug observation is kept as a separate descriptive artifact, not an equivalent speed comparison.

The backup point is a stopped whole deployment. Serving the isolated copy resumes built-in schedules/jobs; the exercise controls a schedule boundary and parks a real job, while external effect workers remain disconnected. Old devices/outboxes are not attached. Production rewind reconciliation and physical power-loss durability are not established.

## Verification and delivery

Initial integrated Linux suite (`e589d3aa4`) took116 s:473 Rust passed,1 ignored;9 fixture tests passed;162 client tests passed,1 failed and1 cancelled. The native failure led to the socket correction above. The worker cancellation reproduced on baseline: an outstanding killed-worker claim held the second request on a60 s lease, incompatible with that crash test's20 s deadline. Final fixture disposition and verification follow below. The original failures are retained, not relabeled as passes.

A separate open ticket tracks the60-second complete-suite budget. No deadline was raised and no new gate was introduced. The long suite and native/physical application gaps do not become promotion evidence through this completion increment.

## Earlier 0.2.13 candidate Linux observations

Source `17bde96d` plus the unchanged worker fixture `7284143393`: 71 affected
Rust tests and 26 affected Node tests passed with no failures, cancellations or
skips. The Node set comprises 12 release, six transport and eight worker tests.
The native 256-pending boundary finished in 4.920 s, the wasm boundary in
3.412 s, and the worker restart case in 1.745 s. Both production Chrome
witnesses passed. This affected pass resolves the initial Node failures; it
does not relabel the earlier full-suite result.

The Linux production binary uses `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`,
Rust 1.97.0, Node 24.13.1 and Bun 1.3.14; Chrome 151.0.7922.34. The
[complete summary](./linux-verification-summary.json) binds source, binary,
wasm and commands. [The IndexedDB receipt](./idb.jsonl) records fault/reopen
results; the scale receipt is appended unchanged to
[the existing metrics](../../../snapback4/metrics/witness.jsonl).

| Endpoint, 40 groups × 500 messages × 10 members | Observed time |
| --- | ---: |
| Constructor and acquisition | 11,646.3 ms |
| First useful thread result | 11,658.4 ms |
| Three required local queries after open | 18.8 ms |
| Fresh-realm offline reopen | 621.9 ms |
| Three required offline queries | 3.2 ms |

The transfer has six snapshot pages plus catch-up, 20,480 replica events and
5,204,479 JSON bytes. The required queries issue no online query request;
offline reopen makes zero wasm requests and preserves the compared row IDs
and content hashes. The acquisition clock includes the instrument's per-page
`Response.clone()` and JSON decoding. These are descriptive single-run
observations, not an optimization comparison to the earlier debug run or
the full-hub 2× floor. Startup remains a meaningful performance gap.

[Native response-body observations](./native-body-observations.json) summarize
the controlled transport comparison; [compiler/artifact receipts](./native-evidence.json)
bind both raw logs, both retained binaries, the instrument and source snapshots.

## Independent implementation review

Fresh Sol (xhigh) and Grok 4.6 (xhigh) both returned READY with no must-fix
correctness findings on `17bde96d`. Their artifacts and the author critical
pass live under `llp/reviews/` and are linked from LLP 3000.008. Sol also
reviewed the exact worker fixture separately and returned READY.

Disposition: the package's browser-witness sentence now names the behavior
actually exercised, and its duplicated words are removed. Grok's requested
one-sync upgrade note was already present at the reviewed source in the
local-client paragraph; that finding was a missed existing note, not a missing
implementation. The final candidate scale row is now recorded separately
from baseline. The 8,193-row ranking test proves the global examined ceiling
preserves incompleteness; it does not isolate the recipe's `first` limit from
that global ceiling. Non-Unix release serving remains outside the supported
packaged target.

## Qualification status

The first cold Office M1 publication dry-run refused after 656 s, with five
deadline failures across Rust and client groups. Host load reached 107 on
ten CPUs; a sample caught the unchanged large maintained-source test running
inside seed/upsert, while three controlled CLI launches took 15–25 ms. Those
observations do not prove a single cause for every failure. No publication tarball was produced and nothing was published by that attempt. The isolated M5 qualifications below use four build jobs and a task-local
descriptor limit of 4,096; their passing results do not relabel the Office
attempt as a pass.

### Earlier Darwin and Expo candidate qualification

The isolated warm M5 run of `node scripts/publish.mjs --dry-run` passed in
271.13 s. Its full canonical suite had zero failures in 136 s, including
166 client tests with zero skips; production build, tarballs and installed
consumer proof passed. It used Node 24.18.0, Rust 1.97.0, four build jobs,
`RLIMIT_NOFILE=4096` and the publication SQLite flag. No deadline, assertion
or test concurrency was changed. The reviewed semantic delta is `17bde96d`
plus the exact worker fixture, with the final README prose copied before pack.
The [qualification receipt](./darwin-qualification.json) binds each artifact.

The [Expo artifact receipt](./expo-artifact.json) identifies 0.2.5's two iOS
arm64 slices, headers/module maps, podspec, packed contents, real C consumer
links and Swift C-module imports. Apple's `nm` could not read some newer LLVM
bitcode; actual links on both targets passed, so that inspection limitation
was not turned into a claimed link failure or a simulator-runtime pass.
Native apps need `snapback4-expo@0.2.5` and a rebuilt native binary to receive
the acquisition repair; updating JavaScript alone does not update Rust.

Grok's separate worker-fixture review also returned READY, matching Sol. The
short fixture lease exercises designed lease-expiry recovery; it does not
change the production abandoned-claim delay.

The earlier 0.2.13 candidate tarballs were never published by this program.
Main independently delivered its borrowed sync encoder and 0.2.13 release
while this program qualified; its code and evidence are preserved in the
combined 0.2.14 candidate below.

## Combined 0.2.14 qualification

Main's incoming `d81381a98` replaces duplicate sync value trees with borrowed
serialization and adds byte-equivalence tests. It was merged at `7c25d6839`,
then versions were advanced to 0.2.14 at `a0ee114aa`. Fresh
[Sol](../../../llp/reviews/3000.008-holistic-product-excellence-sync-integration.gpt.md)
and [Grok](../../../llp/reviews/3000.008-holistic-product-excellence-sync-integration.grok.md)
composition reviews both returned READY with no must-fix finding. The author
also checked envelope fields, acquired-generation publication, response bounds,
ownership/drop before I/O and socket framing. The exact-byte regression tests
pass; Grok's remark about historical object insertion order is not a claim
that this API promises canonical JSON key ordering. No client here depends on it.

The [final Darwin qualification](./darwin-0.2.14-qualification.json) passed
`node scripts/publish.mjs --dry-run` in 216.01 s: the canonical suite had zero
failures in 110 s, including 166 client tests with zero skips. Production pack
and installed-consumer verification passed. Actual build source `ec4480d2`
has the same executable inputs as integration `a0ee114aa`.
[The source comparison](./darwin-0.2.14-source-proof.json) establishes that
native/core/language source and Expo 0.2.5 package inputs are unchanged, so the
earlier Expo artifact still has the same runtime source. The subsequent
deployment-target audit below blocks publishing those bytes. There is no new
claim of simulator execution or physical-device qualification.

The [final Linux qualification](./linux-0.2.14-verification-summary.json)
records actual merge `7e1f938`, whose tracked tree equals `a0ee114aa` before its
single appended metric. All 73 Rust CLI tests and 12 HTTP/acquisition tests
passed. Native and wasm 273-write drains took 4.977 s and 3.457 s respectively.
The production Chrome [IndexedDB witness](./idb-0.2.14.jsonl) and scale witness
passed with actual artifact identities, including the new borrowed encoder.

| Endpoint, same 40 × 500 × 10 fixture | 0.2.14 observation |
| --- | ---: |
| Constructor and acquisition | 11,265.2 ms |
| First useful thread result | 11,278.1 ms |
| Three required local queries | 20.2 ms |
| Fresh-realm offline reopen | 674.9 ms |
| Three required offline queries | 3.2 ms |

Transfer remains 20,480 replica events, six snapshot pages plus catch-up and
5,204,479 JSON bytes. Required offline identities match and there are zero
Wasm requests or page errors. All measurement limits above still apply.
The two production observations are descriptive single runs; their difference
is not attributed as a new speedup. Subsequent main updates merged at
`7a3b56618` contain only documentation and receipts, with both append-only
publication histories preserved. They do not change tested executable inputs.

Only the final 0.2.14 client/platform tarballs are presently selected for
publication. Expo 0.2.5 awaits the target correction below. Actual registry
identities and integrity checks will be recorded after publication; a dry-run
receipt is never a publish claim.

### Expo deployment-target correction in progress

The final cleanup audit inspected the complete C-link logs and found a material
qualification omission: both links succeeded but warned that bundled SQLite
objects were built for iOS/iOS Simulator 26.5, while the podspec advertises 16.4.
The earlier Expo receipt records successful linking, not established 16.4
runtime compatibility. The original unpublished artifact is held. Astra is
correcting the native build target and will rebuild both slices, inspect their
deployment metadata and repeat consumer linking against 16.4. This does not
change the independently qualified Darwin CLI or browser client inputs.

## CLI and browser delivery

Source landed on `origin/main` at `a72a1dda3`. The normal pre-push hook passed
visibility governance and applied the repository's scheduled drift posture.
Two absent shared-hook dependencies were installed at their lockfile pins in
ignored task-owned state; no hook was bypassed and no Snapback 1 product input
was changed.

The exact qualified `snapback4-darwin-arm64@0.2.14` and `snapback4@0.2.14`
tarballs are published. [The publication receipt](./publication-0.2.14.json)
records SHA-256, registry SHA-512/SHA-1 and tarball identities. npm accepted
the platform submission while its metadata was still processing; early reads
returned 404. Later read-only verification matched both hashes, with no
second submission. The client was then submitted and verified the same way.
The live metric explicitly identifies direct publication of previously
qualified tarballs; it does not claim that the publisher's full build ran twice.
Expo delivery remains separate until the target-corrected artifact qualifies.

## Corrected Expo artifact qualification

The [original strict-link controls](./expo-original-target-refusal.json) refuse
both old 26.5-targeted slices when the existing 16.4 consumer links treat
warnings as errors. The four-line script correction was integrated unchanged
at `a8ae933ce`, with its governing decision and journal entry. Both installed
rustc and cc consume the shared target variable; cc also declares it as a
rebuild input. Runtime, CLI and client sources are unchanged.

The [replacement receipt](./expo-0.2.5-target-qualified.json) binds clean
build `43577eed5` (landed `a72a1dda3` plus the script correction), Rust 1.97.0,
production size optimization, the publication SQLite flag and the exact new
0.2.5 tarball. Each arm64 slice contains 374 Mach-O objects. All deployment
records are at most 16.4; Rust and SQLite declare 16.4. The author independently
[reconciled the exact packed archive members](./expo-archive-reconciliation.json)
and verified that the symbol table is the sole other member. Actual C and
Swift consumer executables link at 16.4 for device and simulator with fatal
linker warnings and four empty logs. These are build and linking checks,
not execution on an iOS 16.4 device or a complete Expo application.

[Sol's source review](../../../llp/reviews/3000.008-holistic-product-excellence-native-target.gpt.md)
and [Grok's source review](../../../llp/reviews/3000.008-holistic-product-excellence-native-target.grok.md)
both returned READY with no must-fix finding. Grok's first attempt exhausted
its turn limit without a verdict; the fresh completed review is the one
recorded. The earlier unpublished tarball remains counterevidence and is
not reused for release. Actual publication follows source landing.
