# G3 lane plan: asset-bearing command (LLP 0180 C0/C1 + LLP 0179 S2) — claimed

**Filed:** 2026-08-06
**Claimed by:** the session that ran today's G2 S1 review/delta/close-out
lanes (worktrees under `snapback-wt/`). Coordination channel: edit this
ticket. This morning two sessions built LLP 0179 S1 concurrently without
knowing it; this ticket exists so G3 does not repeat that.

## Scope claimed

LLP 0176 G3 — one online image-send command — decomposed as:

1. **Codegen lane** (branch `g3/codegen-commands`, in flight):
   `defineCommand` grammar with the §Declaration input-derivation rule,
   `AssetBearingCommandDescriptorV1` emission at `app.commands.*` and as
   surface `commands` members (un-closing the descriptor `commands` node),
   the eight §Declaration generation refusals with negative fixtures,
   LLP 0179 S2: descriptor-size measurement, command budgets, and a
   non-React consumer proof.
2. **Client/React lane** (starts when lane 1's wire shape is committed):
   `CommandTask` over the existing asset-task and mutation owners
   (§Command task, §Terminal-state transitions, §Failure/residue with
   `authoritative | inferred | unknown` provenance), text-only branch,
   `useSnapbackCommand` (LLP 0114 amendment already accepted 2026-08-06),
   surface `chat.commands.send`, and the full C1 negative matrix.
3. **Integration**: image-send in `demos/expo-golden-path-fixture` screens
   (currently on low-level upload hooks per the G2 rebuild), adversarial
   review of the integrated slice, guide command page, LLP 0176 G3 receipt.

Out of scope here (G4): C2's published-package externals and per-OS device
evidence; deferred extensions (multi-asset, offline custody, attempt
grants, anonymous claim-on-attach) stay deferred per LLP 0180.

## Seams other sessions can rely on

- Descriptor `commands` node opens only for `asset-bearing-command.v1`
  shapes; surfaces' `commands` members go from refusal to admission in the
  same lane-1 commit.
- The S1 surface machinery (grammar, budgets, refusal lane, hermetic
  conversation fixture in `packages/snapback-react/fixtures/conversation/`)
  is the base; lane 1 extends that fixture rather than minting a new app.
- No transport, endpoint, or server changes: the command is a client
  composition per LLP 0180 §Execution.

If you want one of these lanes, claim it by editing this ticket **before**
starting and note your branch; the claiming session will rebase around
whatever is recorded here. If you find this ticket stale (no lane commits
referenced on main within ~a day), treat the claim as lapsed.

## Resolution

Close when LLP 0176 G3's exit holds on main (text-only + one-image send
share one typed call; negative authority, retry, cancel, no-false-atomicity
tests pass; residue provenance explicit) with the landing SHAs recorded.
