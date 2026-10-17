# SURF4 — 0.4.31

Worktree: `/home/ccheever/projects/sb4-w14-surf4`; base `4ef9f77fb3`.
No push and no version bump. Implementation, review records and verification are complete. The report is intentionally uncommitted, as permitted.

## Orientation and scope

Read Snapback 4 AGENTS, RULES, NOT-DOING, JOURNAL; LLP 3000, the design
brief LLP 2000.000, LLP 3000.009 §5.3, LLP 3000.011.004.000, the release and
surface amendments, starter/proof owners, relevant guide cards and Wave 14's
publish gate, fix list, ledger, open decisions, H9, DT13 and NA15 evidence.
LLP-orient context: remain inside the Snapback 4 fence; immutable release
source, existing worker revision/session authority, descriptor-pinned no-follow
source copies, host-installed packages, bounded process waits, and one shared
help/parser table govern this change. Production files remain below 1500 lines
(serve.rs was already 1512 lines; moving its accept loop reduced it to 1464).

## Item dispositions

| Item | Change and dedicated verification | Commits |
| --- | --- | --- |
| Serve ready wait | Help and deploy card name existing bounded `startServe(...,{timeoutMs})`; success and deadline/owned cleanup tests; packed starter qualification exercises it | 53ca0157ea, 2d992316ad |
| Socket closed line | Drop HTTP listener and confirm connection refusal before SNAPBACK4_SOCKET_CLOSED; actual serve lifecycle tested; fix flush fixture to own its listener | 53ca0157ea, a2ed3f3cfd |
| Captured handler parity | Capture conventional server/worker and checked project imports; automatic serve startup and hot replacement; warning without supervised handlers | 53ca0157ea, 65a8e7ed81, a2ed3f3cfd, 37efd739e2; capture refinements through 461ca2611f |
| Worker seats/resources | Serve help explains service:worker vs service:<stem>, immutable release resource root, cwd, host dependencies and override | 53ca0157ea |
| Active/working schema | Start banner labels both hashes, working unavailable never blocks retained source; differing-schema test | 53ca0157ea |
| releases JSON | Dedicated guide release-json table with selected source and pagination; compact deploy pointer; exact installed-card recipe executed in packed proof | 1258cb14cb, 2d992316ad, 7d82f89c85, c9c48a352b |
| Upgrade action line | Per-project pins/check/test/rebuild action above runtime history; fake-PM tests assert ordering | 1258cb14cb |
| run/clock/reset port help | Per-verb single-port descriptions; parser/help tests and invalid-port assertions | 1258cb14cb |
| clock --release | Remove permanently refused flag; unknown flag refuses before any work | 1258cb14cb |
| web-shell --base | Existing shared-table support verified through native/wrapper help parity; no duplicate parser | 1258cb14cb |
| upgrade [version] | Existing shared synopsis verified in native and wrapper parity test | 1258cb14cb |
| new description | Template-specific verb help plus distinct top-level overview | 1258cb14cb, 793e77b916 |
| new social --dry-run | Validate/localize full plan, print final paths and create nothing; compare actual scaffold | 1258cb14cb |
| Doubled codes | Strip only runtime refusal's own leading CODE prefix before envelope construction; schema regression and social seed expectation | 1258cb14cb, ca1a1a5f4f |
| Fresh text timeout | Overall deadline remains primary; suppress misleading final observation timeout; preserves selector/strictness errors | 1258cb14cb, 53ca0157ea |
| Doctor expiry orphan | findings contains code/table/id/message/repair; existing physically missing-parent fixture asserts JSON | 1258cb14cb |
| Secret stdout file | Explanatory placeholder, secret remains only in caller memory; both direct and token tests assert no secret in logs | 1258cb14cb |
| Redirected init ANSI | Plain npm install output; redirected subprocess assertion | 1258cb14cb |
| Registry downgrade wording | Requested vs installed versions named once; both explicit-version/latest refusal tests | 1258cb14cb |
| Every verb help sweep | Shared table census against actual Options parser arity, native help, JS wrapper synopsis and unknown-flag admission | 1258cb14cb |
| Guide numbering | Existing common census verified from printed testing index through every numeric selection | 1258cb14cb |
| Internal lane names | Remove source leaks; extend publication linter; actual card/source corpus tests | 2d992316ad |
| Long cards | Terminal overview carries first nonempty section; piped full body precedes index, preventing an index-only output prefix | 2d992316ad |
| Blind update docs | N_LOOKUP_HIDDEN explanation distinguishes explicit lookup from blind patch; rules/why agreement regression | 2d992316ad, a2ed3f3cfd |
| Chat/social readiness | All three AppProvider template gates call useAppReady; packed typecheck/build qualification asserts exact generated files | 2d992316ad |

## Regression test map

- Native CLI items and per-verb parser/help census: `snapback4/crates/snapback4/tests/surf4.rs`;
  orphan JSON uses the actual missing-parent fixture in `tests/day3.rs`.
- Serve readiness/closure/capture/hash/warnings, runtime import custody,
  declaration-hidden implementations, runtime watch recovery, Node-only workers,
  package scopes and ESM/require conditions: `packages/snapback4/test/surf4.test.mjs`.
- Secret command log content: `packages/snapback4/test/proof.test.mjs`.
- Upgrade action/narration: `packages/snapback4/test/wave10-upgrade.test.mjs`.
- Guide numbering/long-card/blind-write agreement: `crates/snapback4-lang/tests/surf4_guide.rs`.
- Shipped internal-name rejection: `packages/snapback4/test/packaged-docs.test.mjs`;
  flag retirement and native/wrapper publication help: `test/wave12-surface.test.mjs`.
- Actual generated chat/social files: social/starter client suites plus
  `scripts/publication-starters.mjs` packed typechecks, builds, readiness helper
  and real releases-JSON assertions. No mock implementation is used there.

## Qualification-discovered worker fix

The clean Ubuntu starter smoke uncovered a real server abort when procfs is
absent: worker_process used current_exe().expect, which requires /proc/self/exe
on Linux. `2bb710bfbf` uses Linux AT_EXECFN from the kernel exec loader as the
fallback, never argv[0]/PATH/application environment. If both OS sources fail,
the attempted session retires under existing custody and retries without
panicking the serving host. A child test spoofs argv[0] and forces fallback;
a real procfs-free retained chat deployment then starts its worker and reports
normal socket closure. Both independent R9 reviews returned READY. No watchdog,
credential or process-group ownership rule changed.

## Independent reviews

The governing amendment is LLP 3000.000.000.000.000 §7. Nine independent
rounds are preserved verbatim with briefs and provenance in
`llp/reviews/3000.000.000.000.000-surf4-r*`. Both Muse and fresh Codex sessions returned **READY** in R8 on `461ca2611f`
and R9 on the additional executable-path fix `2bb710bfbf`. Later
`f0a623f9cf` and `4ad79d393d` only align existing test expectations and wire
the worker graph into the standalone fix test crate. `dd9080ca3a` fixes
publication flag-retirement validation and rejects all wave-number labels; seven
focused publication/help tests passed. `ac705fb393` updates the pinned clean
Ubuntu runtime from unsupported Node 22 to Node 24.13.1 (official SHASUMS256),
adds a clean-runtime-major test, aligns JSON message assertions and adds @refs.
The 35 qualifier harness tests passed. Historical source comments were cleaned
without changing emitted guide text or runtime behavior.

The reviews drove actual fixes: R1 absolute/file imports, no-follow ancestor
custody, overbroad native/target exclusions and schema-local dependencies; R2
external helpers' nested package scope; R3 JavaScript implementations hidden
behind declarations; R4 CommonJS directory main; R5 runtime-only package
metadata; R6 missing-runtime dev recovery and aliased-root scope traversal;
R7 import vs require export conditions. R6's inline `type` concern was checked
against Node 24's actual stripping primitive: inline bindings leave a runtime
import, while whole `import type` is erased. Both R7/R8 reviewers confirmed
that distinction. The full Rust run exposed an additional TypeScript-toolchain
regression for low-level worker.mjs; the new bundled-parser + Node-only resolver
preserves that toolchain, with a fixture outside the installed workspace.
Muse's wrapper used its own Meta fallback after plan quota. No key was read or
printed by this workstream.

## Tests and qualification

The durable results, source bindings, checksums and log paths are in
`llp/reviews/3000.000.000.000.000-surf4-verification.json`.

| Check | Result |
| --- | --- |
| Setup | Root frozen Bun install + ensure-workspace-hoist, Snapback 4 install, Cargo build, wasm build and client build passed |
| Full five-crate Cargo run | Completed all targets and doctests with --no-fail-fast; exit 101 from five targets corrected below. Log: target/surf4-five-crates-final-r2.log |
| All five corrected complete targets | Device 440/440; guide 125/125; SURF4 guide 4/4; membership_search 24/24; write_authority 35/35; no unresolved affected product test failure |
| Linux after executable fix | 456 CLI unit tests + day3 12 + lifecycle 29 + surf4 9 passed; five pre-existing unit tests intentionally ignored |
| Linux clients | Initial stable eight-file run 171/171; repeated four worker/runtime files after executable fix 129/129 |
| Mac after executable fix | 50/50 Rust tests and 129/129 client tests, in own Mac Studio scratch only |
| Publication/help/lint regressions | 42/42 passed against final validation code |
| Fresh client preparation | Passed at a32bfd3266cc0cf893eb88a833a484061337e846; target/surf4-pack-reviewed/prepare.json |
| qualify-linux --consumer-only | **Passed**, host + Ubuntu 24.04 / Node 24.13.1 + Alpine / Node 24.18.1; target/surf4-qualify-reviewed/consumer.json |
| Packed guide and starters | All six starter cases typecheck/build; exact installed guide recipe executed 18 times (six host + six Ubuntu + six Alpine); 28 host frontend proof passes |
| Wasm | 2,372,586 raw / 723,240 gzip bytes; within 723,660 gzip budget |
| ref-check | Passed: 550 LLP documents, 11,361 references, zero errors/unchecked |
| docs-budget | Passed: README 317/320 lines; named first-account self-containment test 1/1 |
| Root inventories | Ran after required dependency setup; exit 1 solely from inherited missing Snapback 1 generated guide artifacts |
| Root guide | 19 passed, zero failed, three generated-artifact preconditions; exit 1 |

The original full Cargo run compiled several tests before their corrected
expectations/guide contracts landed. Its five failed targets are preserved in
the ledger and all five have complete green reruns. No second complete battery
was required for unchanged semantic inputs. The final membership correction
asserts E_SEARCH_OPEN in `code` and the authorized-count text in `message`.

Qualification is deliberately consumer-only: the default invokes the explicitly
forbidden full scripts/test.sh. Direct full Rust and affected client suites ran
separately. `publicationQualified` remains false; no publication suite receipt
or npm publication is claimed. The only product-tree delta after the qualified
snapshot is the membership-search test assertion and one trailing-blank-line cleanup, with runtime/guide logic unchanged.

Earlier qualification attempts uncovered and repaired the flag-retirement help
scanner, obsolete Ubuntu Node 22 pin, procfs-dependent worker abort and guide
fact/size contracts. Initial broad client checks overlapped artifact rebuilds;
stable copies removed deleted-executable/missing-wasm races, then all affected
files passed. One docs-budget wrapper initially omitted the low-debug variables;
it was rerun with them and only that worktree's extra debug/incremental artifacts
were removed.

Root preconditions are `demos/competitive-checkpoint/snapback/generated/operations/startReply.args.schema.json`
and todo-v2's generated Contract `setCompleted.mutation.ts` / `runtime-links.ts`.
Logs: `/tmp/surf4-inventories.log`, `/tmp/surf4-guide.log`. Snapback 1 bootstrap
and generator work stayed outside this fence.

Mac logs: `/tmp/surf4-mac-rust-executable2bb.log` and
`/tmp/surf4-mac-client-executable2bb.log`; originals are retained under
`~/sb4-ws-surf4/bundle-repo`. A scratch-pinned Playwright headless browser was
used after system Chrome's close deadline failed. The black M5 was never used.

## Deferrals

No listed implementation item is deferred. Inherited root generated-artifact
preconditions remain. Version bump, integration, push and publication belong to
the coordinator. Full publication qualification remains separate from these
consumer-only results.

## Ownership and judgment calls

LANG3 owns N_LOOKUP_HIDDEN emission/reach; SURF4 corrects its public explanation.
KIT3 owns all other proof helper contracts and clock reply semantics. REG owns
Expo floors. DAY4 owns adaptation advice. Existing snippets were not rewritten
as a workaround. Each modified starter is part of packed toolchain qualification.
The new action/service capture semantics were reviewed in §7; auth, adoption,
sync, language and expiry behavior are unchanged. No Slack/email messages, push,
publication, version bump or change to other worktrees was performed.
