# REL2 — wave 10 release lifecycle, third round

Implemented items #3, #4, #13, #14 and H7 in `/home/ccheever/projects/sb4-w10-rel2`, branch `sb4-w10-rel2`, starting clean at `f9e40ef515`. No push, publication or other-worktree changes. Governing amendment: LLP 3000.000.000 §10. No deferred REL2 item.

## Changes and commits

| Item | Change | Commits | Verification |
|---|---|---|---|
| #3 | Human and JSON preview steps use dormant vocabulary/counts; successful maintains show actual rebuild visits; warnings require existing rows and include counts. Evolution matches deploy. Added old-release E_OP/NOT_FOUND/null/forward table and proof, with every-card consistency test. | `26c77dc069`, `db5797ed79`, `5d8b6299e6` | CLI narration/maintain/empty+populated-warning/old-release proof tests; 121 guide tests pass; relocated consistency test passes. |
| #4 | Every retained-store selector requires committed release or predecessor proof; numeric refused candidates stay reserved and unselectable, even without the marker. Marker is durable before source publication and excluded from content digest. Legacy active predecessors remain selectable. Matching-source E_ADOPT leads with --to latest; full inventory JSON only under --json. | `26c77dc069` | Offline/live v1-v2-rollback-refused-v3-latest; explicit rollback/check/inspection rejection; killed precommit candidate; committed marker recovery; legacy migration tests pass. |
| #13 | Complete deploy/serve/rollback help; bare rollback uses previous active history, excluding prune/self-transitions/no-ops; help and receipt describe running serve adoption; conflicts show PID/URL/directory; run --release uses a full service token and served source; guide --list; dry-run points at --check. | `26c77dc069`, `db5797ed79`, `5d8b6299e6` | CLI help/aliases/history tests; served job completion from outside the app; guest/persona/read-token rejection and dev-door isolation; binary tests pass. |
| #14 | Retain capture source definitions with dormant cells and restore original read-through captures after widening while retaining parent lifetime/audience checks. Remove speculative capture-fill messages. Receipts include sample IDs past empty inventory definitions. Exact deploy-direction check includes worker prerequisites, post-dormancy constraints, changed/removed schedules and populated removed safeguard tables. | `bc7f51900e`, `26c77dc069`, `5d8b6299e6` | 44 dormant tests, including historical capture restore/new-row refusal and existing deletion/reuse/expiry controls; deploy-preview state equality/first-deploy/no-name-reuse/unique-after-dormancy/worker refusal tests pass; receipt edge regression passes. |
| H7 | Only acquired sidecar ownership permits reclaim; an ESRCH probe identifies a dead serve.lock PID and emits PID/URL/directory before replacing the hint. | `db5797ed79` | Dead owned child PID reclaim and live-server conflict tests pass. |

## Checks

Setup completed: frozen Bun install, binary build, wasm build, package TypeScript build. Every Cargo invocation used `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`. No full `scripts/test.sh` run.

- `node --test packages/snapback4/test/release-activation.test.mjs`: 40/40 passed before the final receipt edge test; final rerun **41/41 passed** (36.85 s).
- `cargo test -p snapback4-core --lib dormant`: 44 passed.
- `cargo test -p snapback4-lang --test guide`: 121 passed. New consistency test moved to `tests/guide/rollback.rs`; parent remains its original 1,606 lines, adding no oversized-file growth.
- `cargo test -p snapback4 --bin snapback4`: 414 passed, 5 existing ignored.
- Rebuilt wasm: 2,291,429 bytes raw / 698,386 bytes gzip; budget 698,886, PASS. Device bytes unchanged.
- `./ref-check`: 543 docs, 0 errors, 0 unchecked.
- `git diff --check`: PASS.
- Final relocated guide consistency test: 1 passed (120 unaffected guide tests filtered); final ref-check repeats 543 docs, 0 errors, 0 unchecked.

Initial tests exposed an obsolete crash test that activated a candidate killed before commit, pre-retention narrowing warnings on empty tables, and the guide's existing 150-line compactness constraint. Updated the crash assertion, empty warning expectations, and kept guide deploy at 138 lines. These are resolved; final product checks pass. A final 41-test run exposed the pre-existing crash fixture's zero-wait `BEGIN IMMEDIATE` racing serve maintenance. Commit `2efc400530` adds a bounded 5-second SQLite busy timeout to that test admission; the subsequent complete run passes 41/41. No product semantics changed. Two early commands mistakenly invoked Cargo from the repository root and refused on its uninitialized Ibex dependency; no root workspace was built or changed, and all actual Snapback 4 builds/tests used its own workspace.

## Independent reviews

Both round-two reviews are **READY**. All four verbatim reviews with provenance are committed under `llp/reviews/3000.000.000-rel2-wave10-r{1,2}.{muse,codex}.md`.

- Muse: `muse-spark-1.3-contributor`, high, using the required muse-exec wrapper. Round 1 READY; round 2 READY.
- Fresh Codex: `gpt-6.1-sol`, high, required fresh exec sessions. Round 1 NOT READY on legacy predecessor proof, pre-dormancy constraint narration and omitted worker preview prerequisites; all three reproduced, fixed and tested. Round 2 READY.

## Decisions, audit and boundaries

- Audited all production `releases/N` references: deploy is the sole numeric source publisher; activation prepares/link-flushes source but writes no new numeric source identity; rollback/serve select existing source; work-record inspection is read-only.
- Any full service seat can trigger any system job. Its capability is rechecked under the enqueue engine lock; accounts/personas/read scopes cannot trigger. Job execution uses the existing system FIFO/server clock, without introducing scopes, priorities or an idempotent trigger contract. Lost replies remain ambiguous: inspect queued work before retrying.
- Quarry has no hold declaration. Warn on every populated removed application table, rather than infer safety from a table name; also compare scheduled target program logic. This is an advisory about business compatibility, not a migration veto or a new hold language.
- Preview may create command/staging housekeeping directories, but a first deploy check creates neither a live store nor numbered release. Failed staged source is cleaned; committed candidates remain recoverable even if marker cleanup fails.
- Store history gates old unmarked refused directories as well as newly marked candidates. Proven predecessor events preserve legacy active release migration.
- HS owns handshake/types/Vite typing; DX2 owns starters, upgrade and client recipes; DIAG/PAGE2 own language/planner diagnostics. The deploy card includes a one-line DX2 ownership pointer. No lane-owned semantic work was taken over.

Final report is intentionally left uncommitted as authorized. All implementation, tests, documentation and review artifacts are committed.

Final commits: `bc7f51900e` capture restoration; `26c77dc069` source eligibility/exact previews; `db5797ed79` lifecycle CLI/served jobs/docs; `5d8b6299e6` complete samples/guide module/READY artifacts; `2efc400530` bounded crash-fixture lock acquisition.
