# G3 lane plan: asset-bearing command (LLP 0180 C0/C1 + LLP 0179 S2) — closed

**Status:** Closed 2026-08-06 — G3 exited on `main`, and this ticket's own
coordination purpose failed. See the resolution at the bottom.


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

## Resolution (2026-08-06) — exited on `main`, and the claim protocol failed

**Timeline.**

| Time | Event |
| --- | --- |
| 08:23 | `da52b6eef` files this ticket to claim the G3 lane, explicitly because "this morning two sessions built LLP 0179 S1 concurrently without knowing it". |
| 08:23–10:00 | The claiming session builds the full lane on branches `g3/*` (`g3/integration`, five commits, tip `d49ddeeb4`). |
| 08:56 | A second session lands `17e7ca8ca feat(client,react,codegen,runtime): image-send command core + S2 commands admission` on `main` — a complete, independent implementation of the same gate — **without reading or editing this ticket**. |
| ~10:00 | The collision is discovered. `main` is also left red on two gates by that landing (client-bundle metrology's missing `commands` profile, and the agent-safe publication leaf set vs the conversation fixture's regenerated closure). |

The claim was recorded exactly where the ticket asked, and it still did not
prevent the duplication: a filesystem ticket only coordinates sessions that
read `issues/` before starting. That is the honest finding here, and it is the
same shape as the S1 collision this ticket was written to prevent.

**Disposition — reduce and re-land.** `main`'s engine is the one
implementation. The unlanded variant is preserved on `g3/*` (do **not**
re-land it: different engine placement, descriptor node, diagnostic-code and
remediation vocabulary). A follow-on lane adopted `main`'s engine and ported
only the unique value that composes with it — the non-React
`packages/snapback-codegen/app-inspection.mjs` descriptor consumer that closes
LLP 0179 S2's language-neutral-consumer bullet, the test coverage `main`
lacked, and the guide's enumerated command refusal tables — each verified
against `main`'s real API rather than the variant's.

**Receipts.** LLP 0176 §G3's dated exit receipt records the gate's exit, the
collision, and the explicit nonclaims (no C2, no per-OS command evidence, no
published-package run). LLP 0180 §Delivery carries the C0/C1 note and the
routed LLP 0044 attachment-fact ask; LLP 0179 §Delivery carries the S2 note.
Two engine gaps found in review are ticketed, not absorbed:
`issues/20260806-command-task-provider-disposal-unfenced.md` and
`issues/20260806-asset-cross-owner-attach-negative-missing.md`.
