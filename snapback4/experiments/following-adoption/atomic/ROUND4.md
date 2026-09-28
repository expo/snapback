# Atomic Following launch — lane FA round 4

The three commissioned review findings are addressed: waiting syncs have their
own bounded admission pool, launch interprets sparse retained source images
through the candidate schema, and the copy-ceiling regression distinguishes a
sum across declarations from a maximum. The launch contract and transaction
boundary are unchanged. Nothing was pushed or published.

Merged `origin/main` at `8112f4ef640058132c1c58fc69f3fbfaa2143de5` in local merge
`48895b810aad60daede21f410e5d5082d74ae348`. The only conflict was JOURNAL.md;
line-multiset comparisons found zero missing lines from either parent.
Both complete round-3 reviews are preserved verbatim:
[Astra, NOT READY](../fa-r3.astra.md) and [Grok, READY](../fa-r3.grok.md).

## Changes and discriminating regressions

- **Sync admission.** `/sync` always takes its own 32-request permit, including
  requests dispatched before a launch begins. It cannot consume Short query/
  discovery permits or mutation permits. Authentication and input validation
  precede the launch wait where a detached reader is available; bearer authority
  is checked again after the wait. Missing/invalid credentials refuse before
  waiting, and revoked/expired credentials refuse afterward. The held-commit
  HTTP test waits until all 32 syncs are queued on the engine lock, then proves
  `/q/home` and `/schema` return the predecessor without candidate slots. A 33rd
  sync is refused by bounded admission. After commit all waiting syncs receive
  `E_SYNC_GENERATION`, and the waiting mutation plus same-id retry commits once.
- **Sparse sources.** Materialize candidate defaults for a repost's original
  card, edges in both estimate and construction, and source inputs to slot fill.
  Event walks already did this. The regression creates rows before fields exist,
  adopts literal defaults and owner/immutability rules, and confirms the defaults
  remain physically absent. Four cases cover original-card attribution, edges,
  original slots and repost slots. Each runs implicit and explicit-store CLI
  `check`, checks database/WAL byte equality, compares the shared preflight to
  runtime, then asserts exact copy count, the reader's page, author/actor and slots.
- **Aggregate ceiling.** Two new declarations share 1,001 posts and 3,000 follows.
  Each estimates 3,001,001 copies. Check and runtime must refuse their combined
  6,002,002 copies before any SQLite write, preserving sources, generation,
  sequence and catalog. Production summation was already correct.

Before the fixes, the extended HTTP test failed because the query response was
aborted after 32 waiting syncs. The sparse-image test passed check and failed
runtime with `MissingField("authorId")`, reproducing Astra's scenario.
Removing the original-card, edge-preflight, edge-construction or slot-fill
materialization independently is mutation-tested, as is replacing `sum()` with
`max()`. Each mutation is temporary and restored before final qualification.

## Contract, governing context and alternatives

Builders can continue to add this program over retained sources:

```quarry
view activity:
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]
query home(c: cursor ?):
  return following last 20 by .at after c
```

It starts the feed now: all retained own events plus the newest 1,000 live events
per current follow, with no refill on removal. Dev launches automatically;
deploy needs `--allow-feed-adoption`, which cannot override the unchanged
5,000,000-copy ceiling. Devices reacquire after the atomic generation commit.

The scoped `llp-orient` context is [LLP 3000.026 §§3–4](../../../../llp/3000.026-following-over-a-populated-store.rfc.md#3-launch-contract)
(current, Draft), [LLP 3000.016 §2.1a](../../../../llp/3000.016-following-on-a-bounded-device.rfc.md#21a-owned-events-follow-their-source-rows)
(Implemented, slot filling and reacquisition), [LLP 3000.014 §7](../../../../llp/3000.014-a-child-reads-through-its-parent.rfc.md#7-activation)
(activation ordering), and [LLP 3000.019 §3.6](../../../../llp/3000.019-what-the-builder-still-wrote.rfc.md#36-p10-adding-a-view-never-stalls-reads)
(current, detached predecessor reads). None is in foundation. LLP 3000.026 and
the admission paragraph of LLP 3000.019 are updated; the guide's existing launch
contract remains accurate. Hand-off: supervisor review, no additional skill.

All rejected design options and their counterexamples remain in
[LLP 3000.026 §6](../../../../llp/3000.026-following-over-a-populated-store.rfc.md#6-immediate-card-and-rejected-options)
and the [round-3 report](./ROUND3.md#rejected-options-retained-for-review).
For these fixes specifically, retaining Short permits while waiting fails at 32
syncs; testing only one waiter cannot detect it. Reading raw fields rejects valid
literal-default schemas. Testing only one over-ceiling declaration permits a
`max()` implementation. No new publisher design or device contract is introduced.

No launch performance benchmark was repeated. Round-2 release-profile writer
lock observations remain **46.901 s at 1× / 696.667 s at 10×**, as documented in
[REPORT.md](./REPORT.md); they are fixture measurements, not live-service SLOs.
This round measures correctness, test outcomes and the rebuilt device artifact.

## Qualification

Affected checks pass:

| Check | Passed | Existing ignored |
|---|---:|---:|
| Atomic launch | 8 | 2 helper/benchmark entrypoints; crash child executed by its parent |
| Retained-source research | 4 | 2 helper/benchmark entrypoints |
| Language Following / background / epoch / timeline guide | 8 / 17 / 1 / 4 | 0 |
| Whole guide | 86 | 0 |
| CLI Following / timeline / adoption / delivery / counterexample / design | 2 / 23 / 15 / 1 / 1 / 2 | 0 |
| HTTP adoption package | 20 | 2 |
| Core activation equivalence | 6 | 0 |
| Complete device package | 1,332 | 3 |
| Wasm codec census | 26 | 0 |

The complete device run has 68 harness summaries, including its empty doctest
harness. The rebuilt wasm is **1,981,453 B raw / 572,553 B gzip**, **288 B below
the unchanged 572,841 B budget**. Its SHA-256 is
`3bb763b9f9eee9f76dba6965a3a7a940a7ea1bd3fcc2b69b215404ff7c6a4aaa`.
Rust 1.97.0, wasm-bindgen 0.2.127, without wasm-opt. The single full script also
rebuilds the artifact and reports the same size.

All five deliberate source mutations failed the intended test with exit 101;
no mutant survived or remained in the qualified tree. The two unfixed-code
reproductions and those five mutation failures are lane-owned expected reds,
not baseline or environmental failures. Every affected check above passes on
the restored implementation.

`scripts/test.sh` started exactly once at `2026-09-27T16:17:21.859272Z`.
It exited 0. Its exact summary is:

```text
== 0 failure(s) in 1392 s
```

**Every full-suite failure: none. Ours: 0; baseline: 0; environmental: 0.**
The Rust scheduler reports 3,932 passed, zero failed and 28 ignored across
250 binaries / 963 executions (898 s including compilation). Ordinary client
tests and shards pass 2,701 with 10 existing skips (194 s); client models pass
78/78 (262 s); fixture wrappers pass 9/9. Build, wasm, docs budget, release
guard, package build/typecheck and both app typechecks pass. The inherited
60-second suite budget remains exceeded and unchanged. No code or test source
changed during or after this full run.

Full-log SHA-256:
`928a87d219acf1779b10060ca6cb0127cea08db3a57f1bed4874d074b249ff2c`.
[The durable verification record](./ROUND4.verification.json) records commands,
mutation results, totals, environment and artifact bytes. Raw logs live under
the ignored worktree-local `snapback4/target/fa-round4/` directory.

Node 24.13.1, Bun 1.3.14, eight Cargo build jobs, development/test debug information
and incremental compilation disabled, `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`,
fd limit 65,536. `bun install --frozen-lockfile` completed before JavaScript tests
with no dependency changes. No tools were installed, no budgets or timeouts were
raised, and no source or evidence was removed.

Final reference audit: 519 LLP documents, 9,649 references, zero errors and zero
unchecked references. The complete staged whitespace check passes. The journal
is a strict append to the merge result; both archived reviews are byte-identical
to the supplied review files.

## Supervisor handoff

The revised atomic launch is ready for the supervisor's review; this report
does not accept it on the supervisor's behalf or invent a new reviewer verdict.
No additional product decision is requested. The future online publisher in
LLP 3000.026 §8 remains unbuilt, with its earlier review requirements retained.
