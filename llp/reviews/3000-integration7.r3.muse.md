# Integration 7 round 3 — muse

**Reviewer:** Muse Spark 1.3 Contributor
**Effort:** high
**Date:** 2026-10-13
**Reviewed source:** 74895a66f0dd64efda0bdd077474b7fe496e9877
**Delta:** e759005d33..74895a66f0 (final fixtures/guide/version/metrology)
**Provenance:** ~/sb4-loop/muse-exec.sh --yolo --model muse-spark-1.3-contributor --reasoning-effort high --prompt-file review-r3-brief.txt. Mutually blind; response below verbatim. Source readiness is separate from execution qualification. Raw transcript sha256 14bb6efa6a6ad010ca0c1c52ac8039ba26738f3cde9ca8f4c05a29c8f11bfe97, retained compressed in integration evidence.

---

READY — bound to `74895a66f0`. Independent source inspection of `e759005d33..74895a66f0` (via `git show` objects only) finds no material source defect. Pending qualification below is execution evidence, not a code defect.

Material findings (all verified at `74895a66f0`):

- Version bump is exactly the eight-file set of `383858cfe5` (`Cargo.toml`, `Cargo.lock`, `bun.lock`, `native-fixtures/following/Cargo.lock`, four `package.json`s), all `0.4.24`→`0.4.25`. Live-version assertions now derive from the manifest (`device-version.test.mjs:6,30`, `sync-generation.test.mjs:17,559`). Mocked `0.4.24` engine fixtures, `0.4.23` refusal/legacy stamps, and floor `FLOOR = "0.4.24"` (`device_protocol.rs:6`, `wire.md:243`, `minimum_version` tests) are untouched and intentionally retained.
- Corrupt-stamp/pinning controls still alter bytes and gate identity first: both tests locate `"version":"0.4.25"`, flip `0x35`→`0x33` (→`0.4.23`), assert `engineInfo` reads `0.4.23`, and the identity test asserts `DeviceVersionError` with `claims == 0` before store open (`device-version.test.mjs:66,83-86`).
- Following fixtures: `feeds.md` recipe is unchanged (two `insert posts` arms, `108-112`); the old second `.replace` matched neither arm (no-op), the new `"authorId: viewer, parentId:"` prefix fills both with `extra: 0` (`timeline_adoption.rs:208-209`). `addPost` now proves the group via `parent = groups[group] ! else NOT_FOUND` + `group: parent.id` (`:577`). Refusal/rollback/expiry assertions are untouched.
- Unavailable-membership envelope: only the `filteredEvents` arm changed — `data []`, `complete false`, `next null`, `tables ["eventActors"]` — matching unknown-discovery emitting no rows/continuation. `withheld()` plus `unknown`/`speculative` and the `speculativePage`/FIFO/composed-read assertions are unchanged (`bounded-following.test.mjs:260-292,443,567`).
- Tab barrier establishes the §4.5 precondition, hides nothing: `LLP 3000.013.000 §4.5` states recovery skips records whose runtime lock is held/pending and that a closed tab's lock releases with the document — exactly what the fixture polls (`online-journal-browser.test.mjs:391-406`). Live-peer exclusion (`total == before`) and exact-once recovery (`before+1`, `posts == [id]`) are retained; the `until`→`withHangGuard` (`122s`) still fails loudly as `TEST_HANG: closed tab liveness lock released`, and the after-close snapshot is logged. No lock is forged/released, no timeout relaxed.
- Serializer delta is comment-only (`json_codec.rs` header + `to_sink` gloss); single `&mut dyn Write` sink with callers limited to counting, exact-capacity keys, and cursor hashing (`branch_merge.rs:405`, `read.rs:1643-1648`, `runner.rs:1282-1291`) matches the `LLP 3000.002` narrow audit. Metrology is consistent: clean entry `2291429` raw / `698386` gzip / `527885` brotli (`wasm.jsonl` @`5a4779e48a`), budget `698886 = 698386 + 500` (`wasm-budget.json`). Guide diffs are prose joins only; measured `client 114/1199`, `deploy 150`, `README 320`; `init --adapt` is a real flag (`cli_flags.rs:2`, `verbs/init.rs:18-20`); all four changed tests pass `node --check`.

Minor (non-blocking): the pinning tests hardcode the `'"version":"0.4.2'` prefix length — correct for `0.4.2x` but brittle past it; `wasm.jsonl`'s last row still records the contemporaneous `698992` budget, which is history, not inconsistency.

Remaining execution gates (not inspected as source, not defects): the rerun five-crate Rust command on the bumped version and the Mac full publication stages are still running per the task statement.

