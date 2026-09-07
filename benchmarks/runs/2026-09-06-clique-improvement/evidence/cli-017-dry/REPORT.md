**Functional standard dry qualification PASS; timing RED.** The installed chat `check` took **1.056743167 s** against **<1 s**. The original result is retained in [first-failure.json](first-failure.json); no rerun, deadline change, source repair, or publication followed. Root disposition is required before any further qualification or publication work.

Candidate **0.0.17**, source `a606383b6e5ad7cf79555bbc4b810d6cf6ea0e92`, full tree `e070c0b09e681d59755ad0942fde380fb90a09cd`, Snapback2 tree `c4070f6674aa85dbe32a8b2a26b332165ec1479c`. Archive SHA256 `4271943bf5ef4c4cac700088be545841c880c771d70cc5b610c5e4b2217128e7`. Source on Apartment is an archive materialization, with no remote Git HEAD claim. The full archive's 20,494 leaves are mechanical custody; the unchanged relevant path selection covers 946 leaves. Unrelated archived benchmark/review bodies and diagnostic sessions were not read.

Root's exact qualification-only approval was present and matched before any helper execution. All 64 bound inputs matched complete bytes, modes and hashes; the exact `<UNBOUND_[A-Z0-9_]+>` regex found zero placeholders. All 16 helpers and embedded remote Python parsed statically. All 68 recorded historical016 files matched before and after the run. Root's admission and this verification are in [root-approval.json](root-approval.json), [binding-verification.json](receipts/binding-verification.json), and [final-custody-verification.json](receipts/final-custody-verification.json). The preparation-era hold text remains unchanged; its hold was satisfied by the subsequent exact approval.

All **nine workload commands ran exactly once, in order, and exited 0**: capacity, warm inputs, archive transfers, source stage, preflight, existing publisher self-test, standard production dry run, finalizer, collection. [phase.json](phase.json) retains each exact argv, original bound, tool terminal, and original transport receipt. Only two additional read-only observations tailed the already recorded publisher log; neither replayed a workload. Every command stayed within its original bound. No transport uncertainty occurred.

The strict-key Apartment probe confirmed MacBookPro18,2/arm64, absence of all three new destinations, and absence of prior recorded donor owners. Initial load was 4.362/4.438/4.555, CPU idle 59.62%, and disk free 1.082 TB. Capacity was accepted for jobs2 as a point observation. Preflight load was 22.921/14.198/8.641; stable compressor use and unchanged swap counters, substantial inactive memory, and more than 1 TB free supported the bounded run. Producer load was 15.907/13.520/8.648 at start and 20.022/21.251/13.603 at end. No quiet/reserved-host or causal latency claim follows.

Warm staging verified all 20,352 donor016 source leaves, then copied and checked 119,989 permitted entries by bytes, modes, symlink targets and independent file inodes. All 68 existing qualified Hermes leaves matched the donor input manifest. Only production/hermes/media-codecs/publish-tools targets, the named dependency trees/tools, selected Cargo data and completed npm cache were copied. Donor016 remained read-only. No credentials/config copy, hardlinks, global change, new toolchain, install or Hermes bootstrap occurred. Source stage verified all 20,494 new source leaves and installed modes, plus 57 private dependency links.

Preflight observed Node22.23.2/npm10.9.8, Bun1.3.12, Rust/Cargo1.97.1, nextest0.9.143, Xcode26.6, CMake4.4.2 and pkgconf3.0.5. Cargo/CMake jobs2 and nextest threads2 remained fixed. The existing publisher self-test ran once with private real npm: PID84457, start Mon Sep7 13:36:04 2026, actual exit0 in1.587327459s. All seven packaging self-tests passed; their synthetic Linux fixtures are not Linux runtime qualification.

The unchanged `node scripts/publish.mjs --dry-run` producer PID**84713**, start **Mon Sep7 13:36:18 2026**, actually exited0 after **254.593804042s**. Driver84698 and receipt observer84697 both exited0 and were waited; remote-run84696 completed in255.701590666s. SSH22994 was waited with exit0 in256.888799458s. Original PID/start identities, waits and log digests are in [production-dry-run.json](apartment-results/receipts/production-dry-run.json), [remote-run.json](apartment-results/remote-run.json), and [production transport](receipts/production.json).

Standard native/engine/media, HEIC/static codecs, dependency/macOS-floor, package build/validator and fresh installed-consumer paths remained enabled. The original production log records four media tests passed, zero skipped, decoder-only codec reuse and deployment target11.0. Engine/media/floor acceptance is the unchanged standard publisher's successful path; no separate broad suite or alternate compiler ran. The actual metric records engine `ibex2 + vanilla hermes`, engine binary7,029,792bytes, normal engine-less size3,812,208bytes, and media helper2,147,968bytes. The dry wrapper recorded exactly two packs, one standard install and two explicit `publish --dry-run --ignore-scripts` calls; all exited0. No real publication occurred.

All **19** actual consumer summaries passed, comprising17 executions and2 accepted receipt verdicts. Complete immutable receipt bodies have **todos6 / chat30** passing checks, including chat's15 journeys, six embedded offline checks and passing effects. Receipt counts and digests are in [installed-test-receipts.json](apartment-results/installed-test-receipts.json); these are fresh017 outputs, not reused016 receipts.

| Result | Functional verdict | Seconds |
|---|---|---:|
| install tarballs | pass | 1.314494750 |
| doctor | pass | 0.495803125 |
| guide auth | pass | 0.037431625 |
| public client and React exports | pass | 0.045225417 |
| todos init | pass | 0.669718083 |
| todos check | pass | 0.670301666 |
| todos React bundle | pass | 1.493295459 |
| todos dev | pass | 0.457305667 |
| React live query round trip | pass | 0.139117375 |
| todos receipt | accepted / pass | — |
| todos test | pass | 1.421500916 |
| todos stop | pass | 0.182360542 |
| chat init | pass | 1.047797417 |
| chat check | pass | 1.056743167 |
| chat React bundle | pass | 0.802831125 |
| chat dev | pass | 0.923690708 |
| chat receipt | accepted / pass | — |
| chat test | pass | 10.008290125 |
| chat stop | pass | 0.143691583 |

Doctor0.495803125s is below0.5s; todos check0.670301666s is below1s; chat check1.056743167s is RED. The17 measured execution steps sum to **20.909598750s**. Recorded first npm pack wrapper start1788813609870205000ns through first post-consumer dry-publish wrapper start1788813632509055000ns spans **22.638850s**, containing the installed-consumer phase and packing/intervening work. This retained interval is below30s and is **not an exact smoke duration**. Original per-step floats and interval endpoints are preserved in [final-custody-verification.json](receipts/final-custody-verification.json).

The original pair and reconstructed immutable `resume-ready.json` are retained on Office and Apartment at `/Users/ccheever/projects/snapback-artifacts/clique-release/0.0.17-a606383b6`. The complete actual packed inventory contains **156 regular files** (platform3 + shim153). The collected203-file results archive is20,289,346bytes, SHA256 `d115dc36617af9f58dec84567adf9c93efea6218b11327e51ea49eff13c44c56`; all transferred bytes/modes matched. Exact tarball SRIs, original pack receipts and binary digests are retained in [artifact-receipt.json](/Users/ccheever/projects/snapback-artifacts/clique-release/0.0.17-a606383b6/artifact-receipt.json).

| Package | Tarball bytes | SHA256 |
|---|---:|---|
| snapback2-darwin-arm64 | 4824518 | `951ba61c117b18c7fa6ae7504d6060ac603cc0d0fcf0ca89c8cf45c29243c6bc` |
| snapback2 | 1851961 | `5f5e0cc751329e27dae02b283de805db9b140372c7ab8db9924e4e13be3cf189` |

Both tarballs and the new017 resume remain0444. Resume SHA256 is `b1880f15cd48ae137cea379cba0b4aa8114bc0d87c538463dd0ad4201c5aec33`; it was reconstructed from the original qualified017 packs and actual metric. It conveys no publication permission. The staged shim selects only `snapback2-darwin-arm64:0.0.17`; source normal/peer/peer-meta/export fields match exactly. Packed guide and embedded client/offline source-map content match final source custody. Source-mode custody was checked at stage and immediately before the producer; finalizer checked all20,494 final source bytes/symlink targets after metric restoration.

The metric after-image and own append remain separate. Original226 baseline rows, SHA256 `3aed00f9020929f447b5724007dab42ed161b11ce744cc66f4ca468fbac32290`, retain exact bytes, order and multiplicity. The227-row after-image SHA256 is `04aafbd770889c1d3906b60fb87915116135127db6e81d259e2208b31a33685b`; this run's one append SHA256 is `9c86898de0bb1057919f2a5243a0a91ad757083213335f69d9df79aad9971495`. Only that append was restored in the isolated017 source; source mismatches were zero.

Finalizer observed all**264** recorded matching PID/start identities absent at epoch1788813657.5999491. Actual automatic owners were todos90689/port**49986** and chat90829/port**50028**; exact starts and private project custody remain in [production-processes.json](apartment-results/production-processes.json). No signals were issued by the external containment helper. Four private temporary entries remain, listed in [cleanup.json](apartment-results/cleanup.json); source, tools, caches, Hermes and artifacts are preserved. This is a bounded recorded-owner observation, not a global cleanup claim.

Historical016 timing remains RED: dry chat1.050835625s and publication chat1.082446709s against<1s; publication measured-step sum31.401559001s against30s. Historical dry22.810614s was a containing pack-through-consumer interval, not an exact smoke timer. No latency improvement is attributed to compiler semantics. Historical E404 and first failures remain unchanged and confer no retry permission.

The supplied supervisor launch identity records this native turn as gpt-6-astra/xhigh. The **future native terminal, final native identity collection and outer launcher closure belong to the launcher after this executor returns**; they are not claimed here. This finite handoff is complete with functional PASS and timing RED retained for Root. No diagnostic review body/session,51-callback replay, optional installed3 DX checks, publication, registry/default-install witness, M5/live benchmark, native-device/app/Linux qualification, blocked work, or offline physical process-kill-bar claim is included.
