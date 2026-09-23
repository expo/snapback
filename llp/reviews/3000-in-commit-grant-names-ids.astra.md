**Reviewer family:** GPT (Codex CLI, gpt-6-astra, xhigh)
**Date:** 2026-09-23
**Scope:** the fix for `issues/closed/20260923-snapback4-in-commit-grant-names-ids.md`: `partition.rs` `account_row_change` and `engine/runner.rs` (rows and grants born and undone inside one commit), with its tests.
**Method:** Blind, read-only, one model family; each round's brief named the commit range and the prior findings. Each round is recorded verbatim below; dispositions follow each round. Briefs are not reproduced.

# LLP 3000 review — rows and grants born and undone inside one commit (Astra)

## Round 1 — `327fa6eac..e8b817af8`

Found three material issues in `327fa6eac → e8b817af8`. Line numbers refer to that committed revision; concurrent uncommitted edits are excluded. This was static review only: no edits or tests run.

1. **High — recreating a pre-existing row can erase its required deletion.** [partition.rs:176](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:176)

   `old.is_none()` marks a reinserted ID as born, even when that ID existed before the commit. Deleting it then removes **all** matching events, including the original required `Del`.

   This occurs naturally with maintained aggregates, whose IDs are deterministic. Extend `CHAT` with:

   ```quarry
   mutation churn(m: messages, c: conversations):
     delete messages[m]
     row = insert messages {
       conversationId: c, authorId: viewer, body: 'temp', at: now
     }
     delete messages[row]
     return null
   ```

   Start with one Alice-authored message in `c1`, and let Bob acquire its `messageCounts` row. Run `churn` as Alice. The count goes `1 → absent → 1 → absent`; its first deletion is erased when the recreated count is deleted. Bob receives the message deletion but no count deletion and retains stale state.

   Using the `reviews.rs` helpers, after the initial send:

   ```rust
   let before = engine.seq().unwrap();
   sent(&mut engine, "churn", "dev:alice", "churn",
        &[("m", id("original")), ("c", id("c1"))], &["temporary"]);
   let page = engine.stream_at("dev:bob", before, 1_000, 5_000).unwrap();
   assert!(page.events.iter().any(|e|
       e.table == "messageCounts" && e.kind == "del")); // fails
   ```

   Ordinary `delete → upsert same ID → delete` has the same defect. Preserve events preceding the new incarnation, or track existence at the commit’s initial boundary.

2. **Medium — a born row moved to another recipient still leaks its ID to the intermediate recipient.** [partition.rs:182](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:182)

   This remains an uncovered disclosure case:

   ```quarry
   table docs:
     owner: principal
     by byOwner: owner, id
     read <- .owner = viewer
     insert <- allow
     update <- allow
     sync to .owner

   mutation reroute():
     row = insert docs {owner: 'dev:alice'}
     update docs[row] {owner: 'dev:bob'}
     return null
   ```

   Compile into `Engine::memory`, invoke as the system at time 6 with minted ID `"transient"`, then stream Alice from watermark 0. She receives `del docs/transient`, although the row belonged to her at neither commit boundary. Bob correctly receives the surviving put.

   Suppression only runs on physical deletion. Here `append` coalesces Alice’s intermediate put/delete into the leaking tombstone. Born-row accounting must also handle partition changes before the row survives its commit.

3. **Medium — expiry can discard a grant’s birth marker and leave a leaking scope.** [partition.rs:253](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:253), [partition.rs:265](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:265)

   Append this mutation to `reviews.rs`’s `EXPIRING` schema:

   ```quarry
   mutation expireRecreateRevoke(person: principal):
     row = insert members {group: 'g', person, until: 100}
     update members[row] {until: 0}
     upsert members[row] {group: 'g', person, until: 200}
     delete members[row]
     return null
   ```

   Run through the existing system-principal `at` helper at time 6, granting Alice membership. Afterward, `stream_at("dev:alice", before, 1_000, 7)` contains a `scope` for `notes`, naming group `"g"`, despite no membership surviving the commit.

   Shortening the lifetime removes the born-grant marker and original join, then appends an expired join. The upsert physically retires that expired row; with no birth marker remaining, retirement emits a scope. The final deletion withdraws the joins but preserves that scope.

I also traced `intervals`, `expand_joins`, `live_join_chain`, and `continuous_renewal`; held-grant renewals, group moves and expired-predecessor replacement; tables serving as both content and audience targets; and all 12 `partition::append` callers. No caller combines event vectors from separate writing Runners. Seed paths use ordinary accounting; direct load paths call `row_changed`; activation-only rewrites have separate generation semantics. I found no additional defect in SQLite feature gating or logless-host accounting.

NOT READY

**Disposition.** All three accepted and fixed in `9e1a58c74`:

- the first by withdrawing only events since birth;
- the second by logging only a born row's final image;
- the third by keeping a born grant born through a new lifetime (`undone_born`).

Each reproduction is a test in `snapback4-sim/tests/reviews.rs` and fails on `e8b817af8`. The exhaustive explorer gained `churn`, which catches the first on its own.

## Round 2 — delta `e8b817af8..9e1a58c74`

The three original reproductions are closed by inspection. One additional **High** remains in the whole change. It was introduced before `e8b817af8`, so it is a newly identified finding, not a regression introduced by this revision.

**High — deleting a temporary replacement can erase a pre-existing grant’s revocation.**  
Location: [partition.rs:262](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:262), particularly the withdrawal at line 266 and birth classification at line 278.

Use the existing `EXPIRING` Quarry schema in [reviews.rs:303](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-sim/tests/reviews.rs:303), adding:

```quarry
mutation replaceThenUndo(old: members, person: principal):
  temporary = insert members {group: 'g', person, until: 300}
  upsert members[old] {group: 'h', person, until: 300}
  delete members[old]
  delete members[temporary]
  return null
```

Reproduction using the existing system-context `at` helper:

1. At time 5, `join('dev:alice')`, supplying ID `old-member`. Its deadline is 100.
2. At time 6, `add()`, supplying ID `note`. Alice snapshots and holds that note; save the watermark.
3. Without sweeping, at time 150 run `replaceThenUndo(old-member, dev:alice)`, supplying ID `temporary`.
4. Stream Alice from the saved watermark at time 151, with either page size 1 or 1000.

Expected: a `notes` scope for `["g"]`.  
Static trace: only the deletion of `old-member` survives; the required scope is absent.

The failure occurs in three steps:

- Inserting `temporary` marks the logical `g` grant born.
- Upserting the expired original physically removes it. `replaced == true` suppresses its scope because `temporary` is live.
- Deleting `temporary` withdraws its join and suppresses its scope because it is born.

Nothing records the original grant’s outstanding revocation. With no remaining membership or transition, [intervals at line 618](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:618) excludes the group entirely, so logical-expiry handling cannot recover it. The device misses its until-revoked purge; with delivered-history, it misses the transition to “left.”

The replacement path must preserve that revocation obligation when its temporary replacement is subsequently undone.

For the other requested cases, I found no additional event loss from per-key counting, interleaved keys, self-targeting membership tables, repeated grant moves, or `append` coalescing. Pre-birth deletions and surviving final puts remain intact. No tests were run or files changed.

NOT READY

**Disposition.** Accepted and fixed in `edabd1a39`. A join beside another row of its key is not a birth, because it replaces a predecessor whose revocation is owed. The reproduction is `undoing_a_replacement_keeps_the_predecessors_revocation`, which fails on `9e1a58c74`.

## Round 3 — delta `9e1a58c74..edabd1a39`

One new **Medium** finding. The round-2 High is closed by source tracing at both page sizes, but the probe introduces another group-ID disclosure.

**Medium — a same-commit expired sibling is mistaken for a pre-existing grant.** At [partition.rs:288](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:288), finding another row prevents birth classification without checking whether that sibling ever existed before this commit.

Using the existing `EXPIRING` fixture in [reviews.rs:303](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-sim/tests/reviews.rs:303), append:

```quarry
mutation blinkTwice(person: principal):
  expired = insert members {group: 'g', person, until: 0}
  first = insert members {group: 'g', person, until: 300}
  delete members[first]
  second = insert members {group: 'g', person, until: 300}
  upsert members[expired] {group: 'h', person, until: 300}
  delete members[expired]
  delete members[second]
  return null
```

Start with an empty engine compiled from that source, then use the existing helpers:

```rust
let before = engine.seq().unwrap();
at(
    &mut engine, "blink", "blinkTwice",
    &[("person", id("dev:alice"))],
    &["expired", "first", "second"], 150,
);
for limit in [1, 1_000] {
    let page = engine.stream_at("dev:alice", before, limit, 151).unwrap();
    assert!(page.events.is_empty(), "{:?}", page.events);
}
```

The source-derived result is a `notes` scope with group ID `["g"]`, although Alice held no membership at either commit boundary:

1. Deleting `first` removes the group’s birth marker and withdraws both earlier joins.
2. Inserting `second` sees the expired sibling and incorrectly classifies the grant as pre-existing.
3. The upsert physically removes that sibling while `second` is live, so its removal correctly skips revocation. The temporary `h` grant is withdrawn.
4. Deleting `second` finds no birth marker and emits the scope at [partition.rs:269](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:269).

Every membership row is gone before commit. The scope survives at both page sizes because commits are indivisible and ordinary scopes pass through delivery. On `9e1a58c74`, `second` would be marked born and its join withdrawn. The fix needs to distinguish outstanding pre-commit authority from same-commit expired rows; physical sibling existence alone is insufficient.

The requested order checks:

| Case | Assessment |
|---|---|
| Supplied round-2 reproduction | Closed: the replacement remains non-born and its deletion logs the owed scope. |
| Predecessor swept before insertion | Correct: its scope already exists; withdrawing the later birth preserves it. |
| Predecessor swept after insertion | Correct for a pre-existing predecessor: the live replacement suppresses the sweep’s scope, and deleting the replacement supplies it. |
| Replacement inserted beside a live predecessor | Rejected by the unique-index constraint through `live_lookup`, before partition accounting. |
| Several expired predecessors | Limit 2 reliably detects another physical row, regardless of ordering. It cannot distinguish their commit provenance—the finding above. |
| `undone_born`, probe sees only its own row | Correct: the grant is marked born again. |
| Move into a group with a pre-existing expired predecessor | Correct: destination classification is non-born; undoing the move preserves destination revocation. Same-commit siblings retain the finding above. |

Leaving this probe unmetered preserves **logical meter parity**: neither host charges it, it introduces no meter-dependent refusal, and each probe fetches at most two rows per affected write/dependent. The existing expired-membership scan remains metered on both hosts. “Every host pays the same partition work” should be understood as the same logical charges, rather than identical physical work; event construction already differs.

I found no additional dropped-event path. Verification was read-only: the targeted regression could not start because the sandbox denied Cargo’s `.cargo-build-lock`; the reproduction above was traced, not executed.

NOT READY

**Disposition.** Accepted and fixed in `86a87bcc8`:

- `born_rows` covers every table;
- the probe scans the whole key and passes over rows born in the commit.

The reproduction is `a_same_commit_expired_sibling_is_no_predecessor`, which fails on `edabd1a39`. The round's view of meter parity (logical charges, not physical work) is adopted in the code comment.

## Round 4 — delta `edabd1a39..8a0804903`

**One residual Medium: retiring two expired siblings born in the commit still leaks a scope.** This remains in the whole change; it is not newly introduced by the latest delta.

At [partition.rs:272](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:272), retiring the first sibling consumes the shared `born_grants` entry and withdraws both siblings’ joins. Retiring the second then takes the `None => scope` branch at line 277.

Concrete reproduction using the existing `EXPIRING` fixture:

```quarry
mutation retireTwoExpired(person: principal):
  a = insert members {group: 'g', person, until: 0}
  b = insert members {group: 'g', person, until: 0}
  upsert members[a] {group: 'h', person, until: 300}
  delete members[a]
  upsert members[b] {group: 'h', person, until: 300}
  delete members[b]
  return null
```

Run as the system at time `150`, with `person = dev:alice`, starting from an empty engine. Stream from the preceding watermark at time `151`, with limits **1 and 1,000**. The source trace leaves exactly a `notes` scope naming `g`, although Alice never held either group at a commit boundary and all membership rows are gone. No row image leaks. This is a source-traced reproduction, also checked with an in-memory bookkeeping model, not an executed Engine regression.

The other requested checks:

- **Round-3 reproduction:** closed by inspection at both page sizes; its joins and row events are withdrawn.
- **`born_rows` placement:** no additional defect found. Removal follows row-event withdrawal and precedes the early return. Target-only and simultaneously synced/target tables are covered.
- **Reinserted predecessor:** no dropped revocation found. Same-key reinsertion while a live replacement exists fails logical uniqueness. Without that replacement, retirement records the scope before reinsertion.
- **Batch scan:** unmetered, but not an arbitrary historical walk. Each probe examines at most the matching born rows plus one 32-row batch before stopping on a pre-commit predecessor. Births are bounded by charged writes; I did not establish another blocking resource defect.

Reviewed through `8a0804903`, including the additional fixture adjustment. Cargo’s targeted regression run was blocked by the sandbox’s build-lock restriction. The cached executable failed the regression but could not be authenticated to HEAD, so I did not treat that as a HEAD failure. No files were edited; no full suite ran.

NOT READY

**Disposition.** Accepted and fixed in `8f6afe0c1`. Undoing a born grant keeps the key's birth marker while another row of the key remains, using a shared unmetered probe (`key_has_row`). The reproduction is `two_born_siblings_share_their_birth`, which fails on `8a0804903`.

## Round 5 — delta `8a0804903..8f6afe0c1`

Reviewed through `8f6afe0c1`. **No blocking findings in this delta.** One inherited metadata disclosure merits a separate fix-forward ticket.

Round 4 is **closed by source inspection at page sizes 1 and 1,000**. Retiring the first sibling withdraws the joins but preserves the shared marker; retiring the last consumes it without logging a scope. Both sizes are covered by [the regression](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-sim/tests/reviews.rs:526).

The requested cases check out:

| Case | Assessment |
|---|---|
| Pre-commit sibling | An untouched pre-commit row of that key prevents birth classification. A pre-commit row can coexist with a marker after moving into or returning to the key, but that creates no new pre-commit authority there. Earlier owed scopes remain intact. |
| Sibling live at commit end | Logical uniqueness prevents two live siblings. Retiring an expired sibling sees the live survivor through `replaced`, so it preserves the survivor’s join. |
| Siblings moved elsewhere | Accounting sees the updated indexes. Source-marker retention considers remaining source siblings; destination classification independently checks its predecessors. |
| `replaced` / `renewed` | Neither consumes the marker. Held-grant renewals remain non-born; replacement revocation obligations remain preserved. |

The shared helper advances past the complete stored key, including the ID suffix, across batches of 32. I found no additional dropped event or disclosure introduced by its extraction or marker retention.

**Medium, inherited and nonblocking — an already-expired insertion still discloses its row ID and group.**

Concrete reproduction using the existing `EXPIRING` fixture:

1. Start with `expiring()` and save its watermark.
2. Call `at(..., "join", person = dev:alice, ids = ["expired-member"], now = 150)`. `join` writes `until: 100`.
3. Stream Alice from that watermark at time 151, with either limit 1 or 1,000.

The source-derived result contains `del members/expired-member` and `scope notes/["g"]`, although neither row nor grant was ever live at a commit boundary. The expired put becomes a deletion at [partition.rs:804](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:804); logical-expiry handling supplies the scope at [partition.rs:751](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:751). Both paths already exist at `327fa6eac`.

Verification was read-only. The targeted regression could not start because the sandbox denied Cargo’s `.cargo-build-lock`. I could not authenticate the existing test binary to HEAD and did not trust it. No full suite ran and no files were changed.

For the record: I see no remaining risk in this revision that warrants another review round. Track the inherited expiry disclosure separately as fix-forward work.

READY

**Disposition.** READY; no further round. The inherited Medium is filed as `issues/20260923-snapback4-already-expired-grant-names-ids.md`.
