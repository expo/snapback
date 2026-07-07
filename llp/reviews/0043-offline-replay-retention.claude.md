# Review: LLP 0043 — Offline replay and retention

**Reviewed:** `llp/0043-offline-replay-retention.rfc.md` (working-tree revision, 2026-07-07 draft)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Fable 5
**Date:** 2026-07-07
**Redacted:** No — reviewed locally; nothing sent beyond the model serving this
session.
**Method:** Single-session independent read, verified against LLP 0008 (parent
RFC, read in full — DK-9, §Mutation Replay, §Retention and Resume,
§Authorization-Aware Sync) and LLP 0012's sync-class/labeling rules.
Same-family sub-agent passes assisted verification; this artifact is **one**
family's review.

> **Independence (LLP 0005).** Draft authored by Charlie Cheever / Codex
> (GPT-family); genuine cross-family review.

## Overall assessment

The milestone split (retained reads → queued replay) is right and matches the
lived Valet sequencing; the server-authoritative no-CRDT posture and the auth
quarantine rules are faithful to 0008. But the draft has one contradiction
with a pinned rule, one silent design reversal, and a systematic problem: it
re-enumerates contracts 0008/DK-9 already pin, divergently and lossily, where
it should cite them. The contradiction: the Summary maps milestone 1 to "before
Snapback claims local-first," but LLP 0012 pins "no local handler execution
means no local-first/parity claim" — and the draft's own non-goals exclude
local handler execution, so neither milestone licenses the claim as written.
The reversal: 0008 pins *client*-side replay ("the client does a full resync,
waits for the local replica to reach current, then replays each pending
mutation in sequence order"); the draft says "the server replays in order" and
omits the resync-first precondition 0008 marks load-bearing.

## Strengths

- Two shippable milestones with a clean claim boundary between them is exactly
  how to unwind the local-first forward contract.
- The conflict posture ("show the failed mutation and authoritative state, not
  pretend convergence happened") is the honest core of 0008's model.
- Auth scoping of retained data and no-silent-replay-under-a-different-user
  are correctly load-bearing.

## Concerns

1. **[HIGH] Claim-language mapping contradicts LLP 0012's Parity rule** (see
   above). *Resolves with:* naming the intermediate classes the milestones
   actually deliver (0012 already has "offline-retained"; milestone 2 adds
   queued replay) and coordinating any "local-first" language change with a
   0012 revision.
2. **[HIGH] Replay executor silently reversed from 0008** (see above).
   *Resolves with:* restoring client-side sequence-ordered replay after
   resync-to-current, or explicitly amending 0008 with rationale.
3. **[MEDIUM] Re-decides DK-9 divergently:** DK-9 pins SQLite as the reference
   store (web *may* use IndexedDB/OPFS) — the draft inverts the web default;
   DK-9's stored contract includes `(stream, version)` cursors and
   **authorization epochs** — the draft says "last authoritative version
   cursor" and stores only "auth context." Cite DK-9; don't re-enumerate.
4. **[MEDIUM] Milestone-2 correctness machinery from 0008 is absent:** doc-id
   suppression (deltas for a doc with unconfirmed local mutations are dropped
   even at higher versions — "a correct client needs both"); drop-and-mark-
   failed, never retry; the typed conflict payload (LWW-per-field,
   delete-wins); multi-row all-or-nothing optimistic application; client-local
   monotonic sequence ("never a wall clock") vs the draft's "enqueue order."
5. **[MEDIUM] Reconnect path should name the landed retention-floor
   primitives** (`resume_requires_resnapshot`, pruned watermark) — this RFC is
   their first real consumer — and address retained-cursor validity across
   schema changes and `app.reset` for a client that was offline during the
   reset.
6. **[LOW] Open Question 1 is mostly answered:** 0008 pins the v1
   syncable-live subset; the real question is only "is retainable ≡
   syncable-live, or a strict subset?"
7. **[LOW] Terminology:** "retention" here (client) collides with 0008
   §Retention and Resume (server journal); one clarifying sentence prevents
   cross-doc confusion. The optimistic-overlay source (mutation args /
   host-plan write plans, absent local execution) is also unstated.

## Suggestions

- Acceptance additions straight from 0008 §Validation Requirements:
  suppression/no-flicker, sequence-order replay, multi-row atomicity,
  reconnect-outside-retention forcing resnapshot, replay failure surfaced as
  observable client state.
- Name milestone 3 ("delta-resume with pending mutations — later") to mirror
  0008's explicit pin instead of the vaguer non-goal.
- Store the authorization epoch with retained results and validate it against
  the current epoch on reconnect, feeding the existing `resync_required`
  machinery (aligns with LLP 0039).

## Recommended next step

Revise and stay `Draft`. The milestones survive; the contract details must
come from 0008 rather than paraphrase.

## Revisions applied (2026-07-07, at the author's request)

Applied to the draft: claim mapping rewritten against 0012's classes (concern
1); client-side replay restored with resync-first precondition (concern 2);
DK-9 cited with epochs/cursors/sequence in the stored contract and the SQLite
reference restored (concern 3); suppression, drop-not-retry, typed conflict
payload, atomic overlay added (concern 4); retention-floor primitives and
schema-change/reset validity addressed (concern 5); OQ1 narrowed (concern 6);
terminology note + overlay source (concern 7); acceptance criteria and
milestone 3 added. Status left untouched.
