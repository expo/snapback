# Competitive checkpoint demo diary

Build-experience notes for `demos/competitive-checkpoint` (the frozen
LLP 0074/0075/0076 checkpoint app: generated owner CRUD + keyset pages,
streamed replies, and now the first maintained projection). Earlier
checkpoint history lives in the LLP 0074/0075 execution notes; this diary
starts with the Phase B projection work.

## 2026-07-25 — maintained projection (conversation cards)

Added the first `defineMaintainedProjection` use: `conversation-cards`
joins each owner's conversations (left) to the public `models` dimension
into a `conversationCards` output table, maintained inside every source
mutation's commit.

What felt good: the authoring surface is the relational-query shape plus
four honest declarations (output table, output key, reverse index,
fan-out), and every refusal I hit during authoring (missing reverse
index, undisclosed shared fan-out) named the rule and the fix. The
acceptance check needed no polling or flushing — the card is simply
there in the same commit as `createConversation`, and `registerModel`
fanned out to it synchronously; that is a materially better experience
than eventual-consistency materialized views (Convex components or a
Supabase trigger+view pair), where the test has to wait or retry.

Friction: the output table must be declared by hand in the schema with
fields matching the projection leaves — codegen validates the match but
cannot yet derive the table; and `defineMutation` takes `plan:` (a single
step or array), not `steps:` — the error surfaced as a sandbox
strict-JSON refusal rather than a spec-shape message, which cost a
bisection. Filed nothing: the ticket already tracks surface polish.
