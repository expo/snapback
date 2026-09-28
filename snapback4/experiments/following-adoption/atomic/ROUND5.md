# Atomic Following launch — lane FA round 5

Fast-forwarded `sb4-intent/fa-following-adoption` from `15234d8ee` to landed
main `687e2a05f` before editing. Read the round-0–4 prompts, lane reports,
journal entries, LLP 3000.026 and both post-landing round-4 reviews:
[Grok, NOT READY](../fa-r4.grok.md) and [Astra, READY](../fa-r4.astra.md).
The review files are retained verbatim. This follow-up commits locally only.

## Finding and change

Slot filling materialized literal defaults into the same source image it wrote
back. A successful launch therefore froze defaults into posts, reposts and even
excluded replies. Later edits could no longer reinterpret those absent fields.
`store/event_slots.rs` now materializes a clone for the actor and post lookups
and persists the original image plus the engine slot. The transaction and launch
contract are unchanged.

The sparse-source regression extends the four existing card, edge, post-slot
and repost-slot cases. Each starts from a schema without the mapped fields,
adds literal defaults through actual adoption, checks CLI/runtime agreement,
and launches. It verifies the missing fields remain absent, that removing the
new slots reproduces the original source image, and that an excluded reply gets
a false slot. A later default edit must leave the stored image unchanged while
ordinary point queries read the new values, including the reply.

The ceiling recheck already worked but had no interleaving regression. A
SQLite authorizer pauses the second BEGIN, after the unlocked estimate's read
transaction and before BEGIN IMMEDIATE acquires the writer lock. With 1,000
posts and 4,999 follows, the first estimate admits exactly 5,000,000 copies.
Another connection commits an ordinary follow of the full actor, increasing
its sequence by one and the estimate to 5,001,000. After release, launch must
return `E_TIMELINE_ACTIVATE` before any candidate write. Assertions preserve
the durable and in-memory generation, the post-follow sequence, every source
image/slot and the complete catalog; owned event, edge, feed and work rows
remain absent. SQLite total_changes and an update hook count writes even if later rolled back; a
catalog authorizer also catches the first attempted candidate write and prevents
a deliberate mutant from constructing five million copies.

No production pause or test API was added. The test uses existing SQLite hooks
and channel rendezvous, without timing sleeps.

## Builder program and governing context

The builder can still declare Following over populated qualifying sources:

```quarry
view activity:
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]
query home(c: cursor ?):
  return following last 20 by .at after c
```

The contract remains all retained own events plus the newest 1,000 live events
per current follow, with no refill on removal. Dev launches automatically;
deploy requires `--allow-feed-adoption`. The flag cannot override the 5,000,000
copy ceiling. Sparse literal defaults continue to be interpreted by the schema.

The scoped `llp-orient` pack is LLP 3000.026 §§3–4 (current, Draft; launch
semantics, atomicity and admission), LLP 3000.016 §2.1a (Implemented; filled
slots and generation reacquisition), LLP 3000.014 §7 (activation ordering) and
LLP 3000.019 §3.6 (current; detached predecessor reads and schema interpretation).
None is in foundation. Only LLP 3000.026 needs an update; the published guide
already states the correct contract. Skill hand-off: none. The supervisor owns
review and acceptance of this follow-up; no new product ruling is requested.

## Rejected options and their counterexamples

For this round, persisting the materialized lookup image freezes `authorId`,
`actorId` and `postId`; retaining only the unlocked estimate admits an extra
1,000 copies after the intervening follow; quiescent ceiling tests miss that
race; checking only committed state lets rollback hide attempted candidate
writes. The regressions exercise each distinction.

The design alternatives remain rejected for the recorded reasons in
[LLP 3000.026 §6](../../../../llp/3000.026-following-over-a-populated-store.rfc.md#6-immediate-card-and-rejected-options)
and the complete table in [ROUND3.md](./ROUND3.md#rejected-options-retained-for-review).
The online publisher remains unbuilt with all review requirements retained in
LLP 3000.026 §8.

## Evidence and qualification

Before the fix, `sparse_literal_defaults_agree_in_check_and_atomic_launch`
fails with `card: launch stored authorId` (exit 101). With the fix all four
cases pass. Temporarily deleting the in-lock preflight makes
`copy_ceiling_rechecks_a_follow_committed_between_estimate_and_writer_lock`
fail on its first attempted candidate catalog write (exit 101). The original
activation file was restored byte-for-byte before qualification. Both failures
are **ours, expected regression/mutation reds**, not baseline or environmental
failures.

No launch benchmark was repeated. Round-2 release-profile writer-lock samples
remain 46.901 s at 1× and 696.667 s at 10×; they are historical fixture results,
not a new performance claim. This round measures regression behavior, suite
outcomes and the rebuilt device artifact.

Affected checks all pass:

| Check | Passed | Existing ignored |
|---|---:|---:|
| Atomic launch | 9 | 2 helper/benchmark entrypoints; crash child executed by parent |
| Retained-source research | 4 | 2 helper/benchmark entrypoints |
| Language Following / background / epoch / timeline guide | 8 / 17 / 1 / 4 | 0 |
| Whole guide | 86 | 0 |
| CLI Following / timeline / adoption / delivery / counterexample / design | 2 / 23 / 15 / 1 / 1 / 2 | 0 |
| HTTP adoption | 20 | 2 |
| Core activation equivalence | 6 | 0 |
| Complete device package | 1,332 | 3 |
| Wasm codec census | 26 | 0 |

The device package completed 68 harnesses, including its empty doctest harness.
The rebuilt wasm is **1,981,453 B raw / 572,553 B gzip**, **288 B below the
unchanged 572,841 B budget**. Rust 1.97.0, wasm-bindgen 0.2.127, no wasm-opt.
The device package ran once, without a filter, in 1,570.706 s including
compilation. No test count, meter, timeout or budget was changed.

The strengthened interleaving regression, including `total_changes` coverage for
WITHOUT ROWID tables, passes on its final targeted rerun. `scripts/test.sh`
started **exactly once** at `2026-09-27T17:42:38.248732+00:00` and exited 0. Exact summary:

```text
== 0 failure(s) in 1368 s
```

**Every full-suite failure: none. Ours: 0; baseline: 0; environmental: 0.**
Rust: **3,933 passed, zero failed, 28 ignored**, across 250 binaries / 963
scheduled executions, plus workspace doctests (866 s). Ordinary client tests
and shards: **2,701 passed, zero failed, 10 skipped** (197 s). Client models:
**78/78** (256 s). Fixture wrappers: **9/9**. Build, wasm, docs budget, release
guard, package build/typecheck and both app typechecks pass. The inherited
60-second total budget remains exceeded and unchanged.

Full-log SHA-256: `ca675e28668a5018c306aa5aab464796c8cc9e7f11f9d624f0a22da9451816dd`.
Before/after SHA-256 over tracked crate, script and package files is identical:
`afd6be835d06fc1138fb2d5bf6bb23995c8e0a288a970551b8ef4c3c07be75fe`. No code or test source changed during or after the
full run. [The verification record](./ROUND5.verification.json) retains commands,
results, timings, hashes and failure attribution; raw logs and exit statuses
remain under the ignored worktree-local `snapback4/target/fa-round5/` directory.

Node 24.13.1, Bun 1.3.14, eight Cargo build jobs, development/test debug
information and incremental compilation disabled,
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`, fd limit 65,536.
`bun install --frozen-lockfile` passed before JavaScript tests, with no dependency
changes. No tool was installed. No launch performance measurement was repeated.

The ceiling-interleaving ticket is closed under `issues/closed/`. No open
product question is introduced; the supervisor can review this follow-up against
the two supplied findings. Nothing was pushed or published.

Final reference audit: 519 LLP docs, 9649 refs in 27389 files, 0 errors, 0 unchecked.
The journal is a strict append to main; both archived review files match the
supplied files byte-for-byte. The source and documentation whitespace audit passes.
