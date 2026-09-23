**Reviewer family:** GPT (Codex CLI, gpt-6-astra, xhigh)
**Date:** 2026-09-23
**Scope:** the partial fix for `issues/20260923-snapback4-already-expired-grant-names-ids.md`, in `partition.rs`: a row born already expired logs no put; logical expiry revokes only a grant once held live, walking back a chain held at the watermark.
**Method:** Blind, read-only, one model family; each round's brief named the commit range and the prior findings. Each round is recorded verbatim below; dispositions follow each round. Briefs are not reproduced.

# LLP 3000 review — a grant inserted already expired (Astra)

## Round 1 — `0388900b8..55fe2de64`

One **Medium** finding in `0388900b8..55fe2de64`: the group-ID leak remains across watermarks.

**Medium — consuming an already-expired join makes the next poll disclose its group.** [partition.rs:760](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:760)

`never_live` requires `from_ord.is_some()`. Once the watermark passes the join, [intervals:683](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:683) reconstructs it as a held-at-watermark span with `from_ord: None`. The next drained poll therefore emits `scope notes/["g"]`, although the grant was never live. No sweep or additional commit is necessary.

Concrete `reviews.rs` reproduction using the existing `EXPIRING` helpers:

```rust
#[test]
fn an_expired_join_stays_silent_after_consumption() {
    let mut engine = expiring();
    at(&mut engine, "n1", "add", &[], &["note"], 5);
    let before = engine.seq().unwrap();
    at(&mut engine, "j1", "join",
       &[("person", id("dev:alice"))], &["expired-member"], 150);

    for limit in [1, 1_000] {
        for from in [0, before] {
            let first = engine.stream_at("dev:alice", from, limit, 151).unwrap();
            assert!(first.events.is_empty());
            assert!(!first.more);

            let next = engine.stream_at(
                "dev:alice", first.watermark, limit, 151
            ).unwrap();
            // Source trace: fails with scope notes/["g"].
            assert!(next.events.is_empty(), "{:?}", next.events);
        }
    }
}
```

The same defect affects:

- **Fresh acquisition:** `snapshot_at("dev:alice", 151)` returns no rows; streaming from its watermark immediately discloses the scope.
- **Pagination within one catch-up:** after `j1`, insert another already-expired grant using `joinUntil(person: alice, until: 120)` at time `160`, ID `"expired-member-2"`. `drained(..., before, 1, 161)` emits the scope on page two. Limit `1_000` suppresses it during that drain, but its next poll leaks.

These are one underlying defect. The new regression stops after the first drained response and therefore misses it. Fixing this requires preserving the distinction across watermarks while retaining earlier live predecessors’ revocation obligations; checking only the latest predecessor’s timestamp would be insufficient.

I found **no additional dropped revocation or delete** by source tracing:

- Earlier live spans and held-at-watermark predecessors preserve logical revocation.
- Shortening a held grant to expiry preserves its physical scope; `replaced` handling is unchanged.
- Missing commit times conservatively retain the scope.
- Born-row withdrawal preserves pre-birth deletions. Intermediate images cannot stream before the transaction commits.
- `now: None` does not suppress the put; normal server mutations pin the clock before accounting.

The row-ID fix closes the reported insertion-time `del` path. The finding above is an incomplete closure of the existing group-ID leak, separate from the explicitly excluded physical-sweep behavior.

Review was read-only. I could not authenticate the cached test executable to HEAD; these reproductions are source-traced, not executed. No files changed and no suite ran.

NOT READY

**Disposition.** Accepted and fixed in `3bd88c4c1`. `Interval` carries its origin join and that join's explicit lifetime, and a span held at the watermark walks the chain back to its last scope. `a_never_live_grant_stays_silent_across_watermarks` (the reproduction, plus snapshot then poll and a two-page catch-up) fails on `55fe2de64`. The guard `a_live_chain_still_revokes_when_a_page_ends_at_its_never_live_join` fails if the chain walk is dropped.

## Round 2 — delta `55fe2de64..3bd88c4c1`

Reviewed `55fe2de64..3bd88c4c1`.

1. **Medium — a later physical sweep still leaks the never-live grant’s row and group IDs.** This is inherited from `55fe2de64`, but leaves the expiry fix incomplete.

   Reproduction using `EXPIRING`: insert `expired-member` for Alice at time 150 (`until: 100`), consume its silent stream or take a snapshot at 151, then call `sweep_expired(152, 100)`. Poll from that watermark at 153 with limit **1 or 1000**. The sweep logs `del members/expired-member` and `scope notes/["g"]`. Fresh catch-up also receives them.

   The later transaction has no birth markers, so [partition.rs:201](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:201) logs the deletion and [partition.rs:290](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:290) logs the scope. [partition.rs:855](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:855) forwards both. This is a source-traced reproduction, not an authenticated HEAD test.

2. **Low — the rare path can perform quadratic history work.** Leave **G** never-live groups unswept, with **H** membership transitions for the principal, then repeatedly poll at HEAD. [partition.rs:780](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:780) materializes all H transitions once per request; [partition.rs:807](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:807) scans that history separately for each qualifying group and performs a commit-time query per chain. Worst-case work is **O(GH)**, plus history allocation and queries. It repeats until sweeping removes the condition. Nonblocking performance follow-up: group/index the loaded history once.

**Round 1 is closed by source inspection:** fresh and catch-up streams, subsequent polls, snapshot-then-poll, and two-page catch-up remain silent at both page sizes before a sweep. The snapshot regression explicitly exercises limit 1; the same source path covers 1000.

I found **no dropped revocation introduced by this revision**. Live or legacy predecessors prevent suppression; missing commit times remain conservative. Renewal and `ends_in_join` behavior is unchanged. `replaced` preserves live replacements. Both storage implementations order transitions by `(seq, ord)`; the backward walk isolates `(table, group)` and stops at the matching physical scope, including within one commit. Multiple content tables remain independent.

**Test limitation:** the cached silence test passed, but the live-chain guard failed. Disassembly shows that cached binary’s `chain_never_live` returns unconditional success, unlike HEAD. Cargo was denied access to `.cargo-build-lock`, so **I could not authenticate a test binary to HEAD** and exclude those results from the verdict. No files changed; no full suite ran.

NOT READY

**Disposition.**

- **Finding 1, the physical sweep.** It is inherited and was scoped out in the round-1 brief. It stays on the ticket with its design question: the write path has no log access.
- **Finding 2, the Low.** Fixed in `6ab0c1d82`. The history is grouped once, and chain commit times come from one query. Empty commit-time queries are skipped, so the common path adds no SQL.
- **The test limitation.** Astra correctly distrusted a cached binary. It was left by this session's own mutation test of `chain_never_live`.

## Round 3 — delta `3bd88c4c1..6ab0c1d82`

Reviewed `3bd88c4c1..6ab0c1d820bc`. No blocking findings.

- **(a) Low closed; logic equivalent.** [stream()](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:767) groups history once and walks each qualifying `(table, group)` once, eliminating the O(G·H) rescans and per-chain queries. Chain timestamps are fetched together; both new timestamp queries skip empty inputs. Walk eligibility, transition ordering, the strict `(seq, ord) < origin` cut, and stopping at the last matching scope are unchanged. Empty chains retain their previous result. Missing commit times and legacy joins remain conservative and preserve revocation.

- **(b) No dropped revocation or new ID leak found in this delta.** The batched lookup supplies the same commit-time mapping to the unchanged liveness predicate. Live predecessors still prevent suppression. Physical scopes, deletes, acquisitions, and pagination remain unchanged.

- **(c) Ready as a scoped strict improvement.** The physical-sweep leak is present in the inspected `origin/main` (`0388900b8`) and remains explicitly open in the [ticket](/Users/ccheever/lanes/f188/issues/20260923-snapback4-already-expired-grant-names-ids.md:65) and [LLP 3000 §7](/Users/ccheever/lanes/f188/llp/3000-snapback4.explainer.md:1449). The stated design question matches the code: the write runner exposes `&dyn Rows`, without partition-log access. That inherited limitation does not block this improvement.

Verification is source-based. A single live-chain regression attempt using a fresh target directory was denied by the sandbox (`Operation not permitted`). **I could not authenticate a test binary to HEAD** and did not rely on cached binaries. No files changed; no full suite ran.

READY

**Disposition.** READY; landed as a scoped improvement. The physical-sweep residual stays open on the ticket.
