# EXPOFIX — 0.4.27

Branch `sb4-w11-expofix`; base `e46faa6062`. No push or npm publication.

| Item | Change | Commits | Validation |
| --- | --- | --- | --- |
| Expo starter and asset/config audit | Omit the optional favicon key and unused SVG from Todos/chat/social; preserve Vite's browser SVG. Users can add their own PNG. Adapt repairs only the exact 0.4.26 asset/setting and preserves edited assets/custom config. Real template installs exposed social Router's floating range selecting a release that failed dependency resolution; pin the workspace-qualified 57.0.23. Bound generated Expo web export scripts to two workers. | `06947bdc9a`, `d65bfb6c24` | Rust starter regressions; real exports/typechecks/builds for web, Expo, web-chat, Expo-chat, social; ownership controls. |
| Publication qualification | Prepare packed Expo alongside client; require `qualify-linux --expo <tarball>`. Linux receipts bind all three SRIs and explicit default/adapt/template success. Darwin publication/resume runs the same real toolchains. Async commands use the existing live keeper, private pipe and read-only empty-group probes; timeouts kill TERM-ignoring descendants. Historical stages without Expo proof bytes refuse explicitly while retaining all artifacts. | `06947bdc9a`, `d65bfb6c24`, `b65930a922`, `74d144a326` | Publication regression suite: 105 passed, including timeout/descendant cleanup, spawn failure, nonzero exit, missing/failed proofs and SRI mismatches. Published 0.4.26 fails the real proof with `Invalid mimeType ... ./assets/favicon.svg`. |
| Untouched README | Fresh UI starters describe their known Todos schema immediately, rather than a generic offline paragraph that check would later suggest adapting. | `06947bdc9a` | Every untouched mode/template has no adaptation advice. Existing schema/identity/offline adaptation coverage passes. |
| Missing Exact wasm | Missing/unreadable files get their path and `bun exact.mjs snapback --rebuild` from the Exact app directory. Existing unstamped files retain `unknown (unstamped)`. | `06947bdc9a` | check/doctor CLI regression; all affected Rust CLI tests pass. |
| Version | Exactly 0.4.27, same ten manifests/locks/release pins as 82855e5ed5, in its own commit. | `8487563659` — `snapback4 0.4.27: exported Expo starters and publication toolchain qualification` | Frozen Bun install; rebuilt wasm/client and static Linux package; device-version/sync-generation tests: 62 passed, 1 existing opt-in skip. |

Validation:

- Setup: frozen Snapback 4 install, CLI build, wasm build (704178 B gzip within 704678 B budget), client build; fresh final `publish.mjs --prepare-client` at source `74d144a326`.
- Affected Rust: `cargo test -p snapback4 --test init --test cli_friction`: 76 passed. Final 0.4.27 focused untouched-starter, owned-favicon adaptation and missing/unstamped device regressions: 3 passed. Final build/test commands used the required incremental/debug suppression.
- Affected client: wave10-starters, init-typecheck and social-starter: 33 passed on the final product changes.
- Publication regression files (qualify-linux, publish-linux, publish-signing): 105 passed on final custody code.
- Pre-custody real five-template/default-adaptation proof: Ubuntu 24.04/Node 22.22.0 passed in 270.1 s; Alpine/Node 24.18.1 passed in 381.3 s. Final custody proof: Ubuntu passed in 271.0 s; Alpine passed in 383.6 s; both all five templates plus default adaptations, exit 0.
- `./ref-check`: pass, zero errors/unchecked references.
- `node scripts/docs-budget.mjs` from snapback4: pass, README 320/320 lines and its affected guide checks.
- Root `node scripts/check-inventories.mjs`: pass (365 package tests, 35 scripts tests, 31 demos/catalog entries, 487 publication leaves, 162 guide pages/1937 snippets). Existing expired guide-gap warnings remain.
- Root `node scripts/check-guide.mjs`: pass (22 passed, 0 failed/skipped/preconditions). Existing guide warnings remain.

Root-check setup required a frozen root Bun install with `--linker hoisted` (the newer Bun's isolated layout omitted undeclared transitive workspace resolution used by existing code), then `scripts/check-generated-artifacts`; that bootstrap passed. Installer-created executable mode changes were restored; no unrelated tracked root changes remain.

Review: Muse and fresh Codex both READY on `74d144a326` (round 4). Verbatim responses/provenance and briefs are under `llp/reviews/3000.011.003.000-expofix.*`. Muse's subscription route exhausted quota but the prescribed automatic Meta fallback completed both final reviews. One Codex session ended at provider capacity without a verdict; it is recorded and a fresh session retried. The first Codex review's worker/timeout counterexample drove the bounded exports and live-group cleanup.

Boundaries and deferrals: no requested implementation deferred. No full `scripts/test.sh` run, push, npm upload, Darwin signing, native iOS/Android build or full publication-success receipt is claimed. The new Linux installed-consumer step was invoked directly via exported `prootProof` to obey the full-suite prohibition. Native Expo publication remains separately qualified. Its retained tarball is a web proof input and is excluded from the publisher's upload list. Final publication must use its ordinary complete host qualification, with the native build prepared separately before choosing the Expo proof bytes.

Dependency installs need the npm registry; npm uses prefer-offline download caching. Expo network checks and telemetry are disabled with EXPO_OFFLINE=1/EXPO_NO_TELEMETRY=1. Distribution/Node/proot inputs are checksum pinned; host homes, credentials, checkout and /proc are not mounted in guests. Direct exports and all generated build:web scripts use two workers. Each command has a five-minute limit plus bounded cleanup, and each starter proof has a twenty-minute guard.


Evidence is retained in `snapback4/reports/20261014-expofix/`: compressed raw logs,
packed-artifact integrity records, final distribution proof records and this
report. Prepared client/Expo tarballs remain in `snapback4/target/publication/client-0.4.27/`;
the qualified static platform tarball is in `snapback4/target/expofix-final/`.
These are local candidates and proof evidence, not a full publication-success receipt.
