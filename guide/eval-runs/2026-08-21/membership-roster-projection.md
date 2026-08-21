# Retrieval eval run — 2026-08-21 — membership roster projection (cases 69, 73–77)

**Fixture correction:** the initial cold `gpt-5.6-sol` Codex run used five
short phrases rather than the six frozen prompts below. It found the governing
recipe within 15 read-only tool calls, but that transcript is supporting
exploration, not a conforming execution of cases 69 and 73–77.

The security-review remediation ran the packaged Guide dispatcher with every
full frozen prompt:

1. “Render a chat display roster with join dates and keep send-time recipients,
   but the membership roster is private.”
2. “list chat members without exposing the private authority rows.”
3. “show roster with roles and join dates for a chat room.”
4. “who is in the room now, and who received a message before someone left?”
5. “Should I make the membership table public so the client can render
   members?”
6. “enumerate members for a room settings screen and support add, promote,
   remove, and leave retries.”

**Packaged-routing verdict: PASS.** Each full prompt returned the recipe's
packaged section projection,
`guide-flat.recipes.generated.md#recipe-list-chat-members-without-exposing-authority`,
as the first match with exit status 0; the source recipe was the next match.
Case 69 is included explicitly rather than inferred from the five shorter
probes.

The retrieved page keeps `conversationMemberships` private and authoritative,
makes `conversationMembers` membership-scoped product state, derives inbox
identity from `ctx.auth`, and requires current room admission before either a
roster or historical recipient snapshot read. It separates current projection
from frozen `recipientSnapshot` and `roleAtSend` history.

The page also describes the transition boundary honestly. The generated
`invite`, `leave`, `changeRole`, `transferOwner`, and `remove` writers remain
directly reachable today, so the application reconciliation coordinator is not
exclusive. A guarded send compares bounded authority with the product
projection and refuses on drift; an owner-only, idempotent reconciliation
mutation repairs an interrupted or bypassed write. This is the sanctioned
interim two-store pattern. LLP 0240 D0.4 has selected platform-generated
projection facts, but that public authoring surface has not shipped yet.

## Original exploratory transcript

1. Loaded `AGENTS.md`, `snapback-authoring`, and the Guide mental model.
2. Located and inspected the packaged Guide dispatcher.
3. Sent five shortened search phrases while generated projections were stale;
   the dispatcher returned `SNAPBACK_GUIDE_REGISTRY_IDENTITY_MISMATCH`.
4. Recovered read-only by searching those phrases and loaded the recipe plus
   its demo witnesses.
5. Produced an initial plan within 15 calls.

That exploration is retained for provenance, but only the six full packaged
probes above carry the current retrieval verdict.
