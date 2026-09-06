# Snapback2 app guide timer binding fix

Implemented and committed locally. The chat Expo app guide now succeeds against the original, untouched cache that reproduced the failure. Missing exposed operations, corrupt or mismatched certificates, and invalid seed facts still refuse. Nothing was pushed or published.

## Source and delivery

- Lane: `/Users/ccheever/projects/snapback-worktrees/clique-guide`
- Branch: `s2/clique-guide`
- Base: `0063509e13a9a80f50d16e157edf9640be0a98a1`
- Commit: `f7c7b10611bc936162475f1fa8ddb1ca3345b184` — `Fix Snapback2 app guide operation certificate custody`
- Machine: `Charlies-MacBook-Pro-M5Max-Black.local`, arm64 (M5 Max).
- Initial and final tracked working trees were clean; final HEAD is the commit above.
- Changed files only: `snapback2/crates/snapback2/src/guide.rs`, existing `snapback2/crates/snapback2/tests/guide.rs`, and `llp/1002-dev-loop.spec.md`.
- File lengths: 506, 722, and 987 lines respectively. No new repository files, scripts, gates, or configs.
- [Copyable patch](guide-timer.patch) and [Git bundle](guide-timer.bundle). The bundle contains the one commit and requires the base above.

To apply the patch on an appropriate branch:

```sh
git am /Users/ccheever/clique-improvement/revisions/guide-timer/guide-timer.patch
```

Or import the commit through the bundle:

```sh
git fetch /Users/ccheever/clique-improvement/revisions/guide-timer/guide-timer.bundle HEAD
git cherry-pick f7c7b10611bc936162475f1fa8ddb1ca3345b184
```

`git bundle verify` exited 0; `git apply --reverse --check` against the committed lane exited 0. The report is separate from `final-answer.md`.

## Governing context and custody boundary

Read the Snapback2 command sheet, `rules/RULES.md`, `rules/NOT-DOING.md`, LLP 1000, relevant LLP 1002 sections, LLP 1001 §4, and LLP 1016 D5 and its J2 implementation record. Applied the installed `llp-orient` skill to this bounded scope. LLP 1000/1002/1016 are linked in `llp/current/`; no new design document was needed. Read the shipped source grammar, schedule/job guidance, and the real chat delivery module. The reproduction and tests used package assets built from this clean base.

LLP 1002 §8 makes the app guide a projection of generation facts. LLP 1016 D5 and the J2 record distinguish an internal schedule binding from an operation. The relevant code agrees:

1. The chat schedule lowers a pure binding program named `deliveries._timerBinding_expireMessage`, referenced by `schema.schedules[].binding`.
2. `Generation::certify` certifies that program and retains it in its internal timer binding collection. It removes the binding from `Generation::programs()` based on the certified schedule relationship, not its spelling.
3. `project::stage_build_cache` writes `project.json` from the raw project, so it includes the binding, and writes `certificates.json` from `Generation::programs()`, so it excludes the binding.
4. Before this fix, `guide::app_page` demanded a certificate for every raw project program and then rendered that same raw inventory. It therefore called a valid owner-produced cache stale. Running `check` could only reproduce that valid cache, so its suggested recovery never worked.

The correct repair is in the guide consumer. The project writer, generation implementation, engine, compiler, and search logic remain unchanged.

## Reproduction and before/after evidence

No installed `snapback2` executable was on PATH. Used the clean specified 0.0.8 source base, a private compiled binary, and package assets built from that base; this was not a new npm installation or a production/Hermes qualification. The baseline executable was preserved privately before changing the implementation.

Private fixture:

`/Users/ccheever/projects/snapback-worktrees/clique-guide/snapback2/target/guide-timer-evidence/chat-expo`

The following command sequence used the lane's `target/debug/snapback2`. `SNAPBACK2_COMPILER`, `SNAPBACK2_GUIDE`, and `SNAPBACK2_TEMPLATES` pointed to this lane's `packages/snapback2/dist/compiler.mjs`, `dist/guide`, and `dist/templates` respectively. Full commands, PIDs, stdout, stderr, and exits are in [before.jsonl](evidence/before.jsonl) and [after.jsonl](evidence/after.jsonl).

| Command / observation | Base result | Fixed result |
| --- | --- | --- |
| `init <private-fixture> --template chat --client expo --json` | Exit 0, unmodified template | Covered again by the new regression, exit 0 |
| `guide app --project <private-fixture> --json` | Exit 1, `E_GUIDE_STALE` | Exit 0, 26 operations |
| `check --project <private-fixture> --json` | Exit 0 | Exit 0 |
| `guide app --project <private-fixture> --json` after check | Same exit 1 refusal | Exit 0, 26 operations |
| Plain `guide app --project <private-fixture>` | Not required for baseline reproduction | Exit 0, valid app JSON |

Exact base refusal:

```json
{"code":"E_GUIDE_STALE","family":"owner","guide":"owner/dev","message":"certificates.json is missing operation(s): deliveries._timerBinding_expireMessage","rewrite":"run snapback2 check"}
```

The raw project had 27 programs and the cache had 26 operation certificates; the sole difference was the real timer binding. The fixed binary succeeded against those same cached bytes **before any new check**. Subsequent plain/JSON guide calls and check left every file in the original fixture byte-identical, verified by SHA-256 snapshots in [after-snapshot.json](evidence/after-snapshot.json). The guide excludes the internal binding while retaining real operations, including the operator-invocable schedule target `deliveries.purgeMessage`.

## Implementation

`app_page` retains the certified `Generation` instead of immediately discarding it for its hash. Certificate completeness and operation rendering both use `generation.programs()`, matching the cache writer. There is no `_timerBinding` string test or operation-name exception in production code.

Every required cached operation certificate must also equal its freshly certified value. This keeps the disk certificate requirement intact and prevents null, structurally damaged, stale, or altered bounds from becoming plausible app facts. A missing certificate is not silently replaced by the freshly computed one. Invalid project caches retain `E_OWNER_BUILD_CACHE`; missing/unparseable or mismatched operation certificates retain/use `E_GUIDE_STALE` with `run snapback2 check`. Seed facts still come through the compiler worker and refusal path. The guide writes no cache files.

The existing output envelope, tables/rules/constraints, channels, personas, operation kinds/arguments, and generation identity remain as before. LLP 1002 §8 now records this boundary. The production change has seven net added lines; the rest is primarily moving the existing certification before inventory validation.

## Regression and verification results

No existing assertions were removed or weakened. All regression additions are in the existing guide test file.

1. **Real chat Expo regression:** initializes the actual shipped chat/Expo template, confirms its schedule refers to a raw binding with no operation certificate, and requires successful app guide output immediately and after another check. It compares the entire operation key set, every operation's kind/args/sites/bounds, table facts, channels, generation hash, and a real persona, and verifies the guide did not change the cache.
2. **Adversarial operation regression:** adds a real authored, exposed query named `adversarial._timerBinding_exposed` alongside the real chat timer. It must appear in the guide. Independently removing its certificate, `deliveries.post`, or `deliveries.purgeMessage` must produce `E_GUIDE_STALE` naming the missing operation. A name-pattern suppression or an inventory inferred only from certificates fails this test.
3. **Certificate integrity regression:** preserves existing missing-file, missing-operation, malformed-JSON, and invalid-seed coverage, and adds null/empty operation certificates and falsified `max_steps`.

All Cargo commands below ran from the Snapback2 workspace with the private target and `-j3`.

| Command | Exact outcome |
| --- | --- |
| `cargo test --locked -p snapback2 -j3 --test guide app_guide -- --test-threads=3` before implementation, corrected regression setup | Exit 101; 0 passed, 3 failed, 10 filtered; 3.11 s test time. Two failures show the exact timer refusal; the corruption case shows the old guide accepting null bounds. |
| `cargo test --locked -p snapback2 -j3 --test guide -- --test-threads=3` after implementation | Exit 0; 13 passed, 0 failed; 4.16 s tests, 2.04 s build. Includes all existing keyword/symbol/help/cache/recipe coverage. |
| `cargo test --locked -p snapback2 -j3 --bin snapback2 project::tests -- --test-threads=3` | Exit 0; 6 passed, 0 failed, 145 filtered; 0.40 s tests, 5.63 s build. Compiler/seed protocol and worker custody remain valid. |
| Private owner/why/cache CLI assertions below | Exit 0; 9 assertions passed, including cleanup. |
| `node scripts/caps.mjs` from repo root | Exit 0; all 7 budget categories pass, 204/204 baseline oversize files, working set 59/59, foundation 12/12. |
| `./ref-check --verbose` from repo root | Exit 0; 411 LLP docs, 7,652 refs in 15,919 files, 0 errors, 0 unchecked. |
| `git diff --check` | Exit 0. |

Logs and exact command records are under [evidence/](evidence/). The corrected failing-before log is [regression-before-corrected.log](evidence/regression-before-corrected.log); the complete passing guide log is [guide-after.log](evidence/guide-after.log).

The manual owner fixture used **only port 50837**, with recorded owner PID **60068**. [owner-why-cache-final.jsonl](evidence/owner-why-cache-final.jsonl) records all commands and outcomes. Assertions covered:

- `why todos.list --as alice` and app guide agree on read certificates.
- `why todos.add` refuses with `E_OP_KIND` before executing the mutation.
- Missing, malformed, incomplete, and predecessor-plan certificates each refuse in both `why` (`E_WHY_STALE`) and app guide (`E_GUIDE_STALE`), preserving the check rewrite.
- An admitted hot edit from `first 50` to `first 49` updates both why and app guide to the new certificate.
- A destructive schema edit is refused with `E_SUCCESSOR_DESTRUCTIVE`; project/certificate/API cache bytes and app guide facts stay at the active predecessor.
- `dev --stop` succeeds. Afterwards PID 60068 was absent and that fixture's `owner.json` was absent. No unrelated processes were killed.

The existing live owner/why test binaries were not run with their automatically chosen ports; equivalent affected behavior was exercised through the CLI on the explicit private port. This report does not claim the full workspace suite, effects runtime, publication checks, or performance qualification.

## Preparation issues, distinguished from product failures

- The first APFS copy command used `snapback2/target` while already in `snapback2/`, so it failed with `No such file or directory` and copied nothing. Corrected to `if [ ! -e target ]; then cp -cR /Users/ccheever/projects/snapback-worktrees/clique-release/snapback2/target target; fi`. The target was absent; the corrected private clone succeeded. All subsequent target writes were lane-local.
- `bun install --frozen-lockfile` in Snapback2 exited 0 (1,213 packages, reported 735 ms). `node build.mjs` in `snapback2/packages/snapback2` exited 0. `cargo build --locked -p snapback2 -j3` exited 0 in 16.51 s using the copied target. No v1 runtime bootstrap or inventory/drift repair ran.
- The first new test assumed the schedule name itself was qualified. The actual cached schedule name is `expireMessage`; its target and binding are qualified. Corrected the assertion to the real metadata and reran before changing production code. The corrected test then failed on the intended product refusal, not fixture setup. Both logs are retained.
- The manual verification wrapper initially appended unsupported `--project` to `init` (exit 2); a second attempt assumed init emitted one JSON value, while it emits JSON lines. Corrected the temporary inline command runner; the final full assertion run exited 0. These were verification setup mistakes, not additional product failures. No new script was added.

## Self-review and scope audit

Reviewed the production diff against both the cache writer and generation timer classification. Both guide loops now share the writer's operation inventory; all raw programs still undergo certification before the boundary is trusted. Adversarial operation naming cannot bypass completeness checks. The guide never trusts certificate keys as its operation inventory and never fabricates a missing certificate. It checks certificate contents before rendering facts, while preserving seed validation and cache refusal behavior. JSON equality makes the comparison independent of object-key order and whitespace.

Reviewed the tests for a real template trigger and useful failure modes, and removed unrelated rustfmt-only changes. Only the three listed files are committed. Engine/compiler/search code, templates, benchmark assertion/instrument sources, and benchmark app source/data were untouched; no builder was contacted. No main push or publication was attempted. The code is ready for the coordinating owner to integrate and publish through its own process.
