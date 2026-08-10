# Review artifact: LLP 0220 — GPT family

**Round:** 1
**Date:** 2026-08-10
**Target:** llp/0220-recipient-bound-asset-grants.plan.md @ blob b249e9b1911abc3ec3449681e007e0ed8a97c2f2 (rev b)
**Capsule:** sha256-16 df746f862148df3b (target + Related LLPs + cited guide/issue/benchmark files + asset_grants.rs + line-ranged excerpts of large cited files)
**Reviewer runtime:** codex exec, gpt-5.6-sol, model_reasoning_effort=xhigh, --sandbox read-only, capsule cwd. Attempt 1 was truncated by an environment restart mid-run with no final message and is recorded as malformed (scratch: round1/gpt5.attempt1.malformed.out); this is attempt 2's complete final message (footer: tokens used 163,795), sealed verbatim.
**Verdict:** NOT READY

---

## Review: LLP 0220 (round 1)

### MATERIAL concerns

1. D1 does not close an existing guide contradiction. The target’s Summary says `guide/backend/assets.md` already makes grant ops primary, but that page’s §“Anti-patterns” still says: “**Do not call the designed grant operations yet.** LLP 0210 D5(b) is a design reference, not a shipped API.” This directly contradicts both §“Grant and revoke per-recipient access” and LLP 0210’s Implemented status. D1 currently adds a recipe without requiring this stale instruction to be removed. Smallest fix: add the anti-pattern replacement and link correction to D1, with proof that no “not shipped” instruction remains.

2. Option C and OQ1 incorrectly claim activation TTL necessarily adds a new LLP 0053 authorization-event kind. LLP 0053 §“Asset read-authorization inputs” says asset system-table changes are ordinary captured writes inside the invalidation perimeter and require neither `permissionBacking` nor a new event; its protected-query rules say time-limited grants must be materialized as database writes and that v1 lacks a deadline scheduler. LLP 0044 §“Asset read authorization” already makes grant identity/state captured dependencies whose revocation invalidates readers. Smallest fix: preserve the evidence gate, but state that TTL requires persisted deadline state and a scheduler/sweep that materializes expiry as a grant-state/revoke write using existing invalidation machinery. Amend LLP 0053 only if the eventual design genuinely introduces a new event outside that model.

3. D3’s proof can pass without proving the app-owned consumption invariant that the Plan calls load-bearing. §“Design detail,” Open says activation alone “does not prevent a second logical open,” yet D3 tests only pending denial, one successful open, and post-revoke denial. `guide/backend/assets.md` likewise says the separate consumption record is what makes a second `open()` refuse. Smallest fix: require the demo acceptance test to prove that a repeated—and race-concurrent—second open is refused by the unique consumption state without producing another logical view.

4. The multi-recipient delete path is ambiguous and unproved. Send creates one grant per recipient, but §“Close / delete” says only “revoke the grant.” `src/storage/asset_grants.rs` revokes exactly one `grantId`, and LLP 0210 §D5 explicitly proves independent grants survive another grant’s revoke. An owner delete that revokes only one edge could leave other recipients authorized and keep GC/quota state alive. Smallest fix: distinguish recipient close (revoke that recipient’s edge) from owner delete-for-everyone (revoke every grant and remove the typed message reference atomically), and add a two-recipient delete acceptance case.

### MINOR concerns

1. The stated quota limit is accurate but understates its operational scope. “1,024 edges per app makes large audiences a non-fit” can read like a per-message fanout limit, while `src/storage/asset_grants.rs` counts all pending and active grants across the app. Clarify that it is a global outstanding-edge ceiling across every asset/message and that revoke releases capacity.

2. D2 says maturity remains `partial` “until hosted is claimed or explicitly re-scoped,” but the current `backend.assets` row also names byte-level backup and transcoding as nonclaims. Replace that causal statement with “maturity stays `partial`”; any later promotion must resolve or re-scope all listed nonclaims.

3. The exact `f706d11c8` commit identity and title in the Summary are not corroborated anywhere else in the capsule, although the implementation itself is well supported. Remove that precision or cite capsule evidence that records the landing commit.

### AUTHOR-DECISION ITEMS

None.

VERDICT: NOT READY

---

# Round 2: FAILED TO REVIEW

**Round:** 2
**Date:** 2026-08-10
**Target:** llp/0220-recipient-bound-asset-grants.plan.md @ blob d0aeea530e7dae0d7637fd950a163d6564082ebb (rev c)
**Capsule:** sha256-16 02e80e30fb0f4fe8
**Status:** No round 2 GPT-family review exists. Three codex exec attempts (gpt-5.6-sol, xhigh, --sandbox read-only, capsule cwd) all died mid-run without producing a final message: attempt 1 exited 1 shortly after start; attempt 2 died at ~1,491 output lines; attempt 3 died at ~7,898 output lines with the wrapper shell killed before its exit marker. Raw transcripts preserved in the loop scratch area (loops/0220/round2/gpt5.attempt{1,2,3}.failed.out). Per the coordinator's directive, round 2 proceeded on the Claude-family review alone; nothing here is a review and no verdict is recorded for this family in round 2.
