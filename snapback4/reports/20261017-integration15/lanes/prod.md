# Workstream PROD — Wave 14 / 0.4.31

Worktree: `/home/ccheever/projects/sb4-w14-prod`; branch `sb4-w14-prod` from `4ef9f77fb3`; final HEAD `08913c7ca36c12e5937633e229035beaee65bcb0`. No push, version bump, publication, or production deployment.

## Item 8 — persona to production

Implemented preview-first `init --adapt --production` in its own module. Adds bare identity only when absent; retains explicit existing methods. Shares the first-writer reachability analysis; names all blocked tables; generates one typed service-seat insert per roster, explicitly showing and applying independent read/insert grants. Preserves screen/client/fixture/package bytes and reports frontend dev-principal locations. Full-source preflight, symlink refusal, compile-before-write, multiline rules, operation-name collisions, defaulted roles and repeat-apply behavior have regression coverage. Non-roster/inherited-authority roots are explicitly listed for application policy.

React and Expo starters include a runnable `recipes/production/` schema, App, client and saved cases. It provides password/guest accounts plus server-gated development personas, roster roles, direct invitation by principal, an authorized principal picker, and release-aware draft/selection ownership. Guest-before-read and GET auth-config behavior open the production guide. The guide's new seven-command recipe blocks are executed verbatim in packed qualification.

Commits: `96f47815f0`, `de87d6572c`, `48ff4e0489`, `07b746041f`, `b0307c1e17`, `dc5035fbe1`, `e8e4cca5ac`, `6fe932a3be`, `26e88e049f`, `2188a0288e`.

## Item 9 — release-aware UI/client recipes

Implemented denied-as-not-available and absent-as-empty rendering; state owners precede release-sensitive queries. Client guide lists matcher handlers/arguments, page shape, data narrowing and per-operation prediction timing. Generated header/operation JSDoc explain timing; decimal/money fields, args and results name integer scale. Invalid write configuration returns an inert App with refusal in auth.why and ready, without opening supplied storage/device/network; native smoke identifies its own missing-provider call.

Commits: `5b0a9b2e64`, `9e8cd90c11`, `dfc323587d`, `1a24675407`, `c7f5bf010a`, `d93611de1f`, `2188a0288e`, `08913c7ca3`, plus starter commits above. CHANGELOG has this lane's 0.4.31 entry; versions remain unchanged.

## Design review

LLP 3000.011.003.000 §14 supersedes §12's production-switch rejection; LLP 3000.013.000 links the observable construction-refusal amendment. Independent Muse Spark 1.3 contributor/high and fresh Codex GPT-6.1 Sol/high both returned READY. Verbatim reviews, prompt and provenance are under `llp/reviews/3000.011.003.000-wave14-prod-r1.*`. Muse used the authorized wrapper fallback after plan quota exhaustion. Nonblocking advice was implemented or explicitly documented.

## Verification ledger

- Setup: Snapback 4 frozen Bun install, binary build, wasm build (723160 B gzip within 723660 B budget), package build and typecheck pass. Root frozen Bun install and workspace hoist pass.
- Production adaptation: initial 5/5 Linux regressions pass; expanded 7/7 pass on Mac Studio. Tests execute generated writes with service:ops, refuse outsiders, cover defaulted roles/conditional grants/private typed parent references, and preserve app bytes.
- Mac Studio only (`~/sb4-ws-prod`): affected Rust init files pass after updating active-starter inventory assertions; latest production Rust tests 7/7; new preflight binary unit 1/1; affected client files 22/22 pass (init typecheck, production UI, Wave 10 starter, guide role form). No M5 access.
- Final `./ref-check --verbose`: PASS, 550 documents / 11971 references / 0 errors / 0 unchecked.
- `node snapback4/scripts/docs-budget.mjs`: PASS (317/320 physical README lines and named self-containment test).
- Root prerequisite `scripts/check-generated-artifacts`: PASS (35 review projections); `node scripts/check-inventories.mjs`: PASS (365 package tests, 35 script tests, 487 publication leaves); `node scripts/check-guide.mjs`: PASS (22 checks, 0 failed/skipped/preconditions; 162 pages, 1937 snippets). Existing freshness warnings remain advisory.
- Full affected crates: `cargo test -p snapback4 -p snapback4-lang --no-fail-fast -- --test-threads=4` completed 205 targets: 3305 passed, 2 failed, 29 ignored. Both failures were documentation snapshots, corrected in `08913c7ca3`; complete reruns of ephemeral_compat, list_lower_bounds and wave14_client_docs PASS 16/16. Every other target passed, including binary units 456 passed / 5 ignored, init 50/50, production init 7/7, check 103/103, check notes 10/10, language guide 125/125 and compatibility emitter 6/6. The earlier isolated route-saturation failure passed its isolated rerun and the full crate run. Original broad-run logs remain retained; this is not represented as a single green rerun of all crates.
- Fresh `publish.mjs --prepare-client` pack source: `d93611de1f9c1593ba3420327c795edb58fbeab1`, copied from the owned Mac Studio scratch checkout. Packed production proofs PASS for both verbatim seven-command guide recipes, real password accounts, browser release behavior, and preview/apply/idempotence on the persona-only starter plus copied lanes 045 and 063. Both original evidence lanes are hash-verified unchanged. Packed client matcher/page/configuration-refusal proofs PASS.
- Overall `qualify-linux --consumer-only`: PASS (exit 0); Ubuntu 24.04 and Alpine via proot; all six starters and their generated frontend proofs pass. Evidence: `snapback4/target/publication/prod-linux-r1/{consumer,production-proofs,client-recipes,day2-proof,frontend-proofs,starter-proofs,proofs}.json`. Binary SHA-256 `50c6fd40244f2769cf4dae7550b4ba5bbc0052de7f754a14ac402bd15c635de6`. The source-bound pack is the final product implementation; subsequent commits only update tests/snapshots. Disposable packed-app node_modules were removed after successful evidence capture to recover shared disk space.
- Isolated canonical client rerun: 6/6 files PASS, 125 tests passed / 1 skipped (asset avatars, answers-stay round 3, event-slot capability, event slots, following history, init typecheck). The initial event-slot failures required the generated Rust trace fixture; initial admission/adoption/envelope failures passed unchanged in isolation; the starter import defect was fixed in `e8e4cca5ac`.
- Both full client models PASS: 81 tests; 5,000 sequences in each online/local session tier plus 3,000 online-client sequences. The full affected-crate run's binary unit suite also passes: 456 passed / 5 ignored, including the earlier saturation case.
- Full canonical client pool completed all 411 files: 7,648 tests, 7,567 passed / 25 failed / 56 skipped, nine failing files. Six files subsequently pass as above; `2188a0288e` corrects the other three files' old browser-throw, active-starter scope and mocked-qualifier expectations. Those three files PASS 83/83 on Linux, including refusal propagation for both newly required packed proofs. All nine originally failing files now pass their complete reruns. The original broad-run failure remains recorded rather than represented as a single green full run. All 17 isolated timer files passed.
- Final Mac followups at `08913c7ca3`: PASS 83/83 client tests and 16/16 Rust documentation/snapshot tests, exit 0. Retained logs and summaries: `snapback4/target/wave14-prod/{linux,mac}/`; the final Mac run is `mac/fixture-followups.log`.

## Scope and decisions

DAY4 owns ordinary adaptation/proof/version advice; this mode stays in a separate module, with a small init dispatch hunk. Starter recognition has minimal changes needed to retain old template matching. SURF4 owns chat/social useAppReady. RULES4 owns rule recipes. Exact's equivalent account recipe is EX9; guide production points there. Automatic adaptation preserves explicit guest-only/password-only policies instead of silently changing an existing auth choice. Manual why proposals retain per-role literal variants; automatic adaptation uses one enum-typed mutation per roster.

Qualification uses `qualify-linux --consumer-only` because the user explicitly prohibits `scripts/test.sh`; full client files/models and affected Rust checks are run separately. Consumer evidence is not a publication receipt or full-battery claim.

No implementation deferrals within PROD. All shell invocations were bounded; every Cargo invocation carried the required nonincremental/debug flags. The root report is intentionally left uncommitted as authorized.
