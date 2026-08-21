# Retrieval eval run — 2026-08-21 — membership roster projection (cases 69, 73–77)

**Fixture:** fresh `gpt-5.6-sol` Codex context, read-only in this worktree,
with `AGENTS.md` as repository steer and the exact prompts “list chat
members,” “show roster,” “who is in the room,” “membership table public,” and
“enumerate members.” The prompt named no expected Guide path and allowed at
most 15 tool calls.

**Verdict: PASS.** The governing
`guide/recipes/membership-roster-projection.md` page was located and loaded
within the 15-call budget. The packaged `snapback guide` route returned
`SNAPBACK_GUIDE_REGISTRY_IDENTITY_MISMATCH` while generated Guide projections
were being refreshed; the cold builder followed that refusal and recovered
read-only by searching the same five plausible phrases.

The resulting route kept `conversationMemberships` private and authoritative,
used `conversationMembers` only as app-visible product projection, named the
`absent`/`unchanged` branches, froze `recipientSnapshot` and `roleAtSend` at
send time, preserved departed receipt history, and explicitly said the interim
pattern does not commit this recipe to a future LLP 0295 D0.4 option or public
API.

The subsequent executable acceptance corrected one semantic assumption in the
initial cold answer: principal-addressed `changeRole`/`remove` require a local
authority profile and are callable only through its synthesized operations.
The final page therefore claims atomicity only for bootstrap/add/self-leave;
promotion and other-member removal use one governed generated-operation plus
authority-checked reconciliation pair, state that the pair is non-atomic, and
compare the profile's admitted bounded authority roster with the product
projection after every branch. Static retrieval cases 69 and 73–77 were rerun
against that corrected page.

## Agent tool transcript

1. Loaded `AGENTS.md` and the complete `snapback-authoring` skill.
2. Loaded `guide/start/mental-model.md`.
3. Located and inspected the packaged Guide dispatcher.
4. Issued all five exact phrases through the packaged Guide command; each
   returned the same registry-identity refusal without mutating the checkout.
5. Searched the Guide with the five phrases and found the recipe.
6. Loaded `guide/recipes/membership-roster-projection.md` and its cited demo
   schema, functions, and acceptance witness.
7. Produced the initial implementation and verification plan within the
   15-call ceiling; the executable correction above was recorded afterward
   rather than misrepresented as part of that cold transcript.

## Final packaged retrieval probe

After the Guide projections were refreshed, `snapback guide` was rerun with
all five exact prompts. “list chat members,” “show roster,” “who is in the
room,” “membership table public,” and “enumerate members” each returned
`recipes/membership-roster-projection.md#recipe-list-chat-members-without-exposing-authority`
as the first match with exit status 0. This resolves the temporary registry
identity refusal recorded above.
