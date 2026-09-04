# Panel: LLP 1012, Local-first v1 — Round-1 brief (identical for every panelist)

**Type:** Review input
**Date:** 2026-09-04
**Panel:** Claude Fable 5.1 (max, fresh session), codex gpt-5.6-sol (ultra), grok-4.6 (xhigh), Muse Spark (ultra; served id `muse-spark`), Antigravity default model and `gemini-3.8-flash-high` (both resolved to Gemini 3.8 Flash High; two samples)
**Related:** LLP 1012, `llp/reviews/1012-local-first-v1.{fable,codex,grok,muse,gemini}.md`, `.panel.synthesis.md`

Preserved verbatim so the panel verdicts can be read against what was actually asked. Each panelist ran against its own read-only capsule exported from `9ffdf6dd0`; prompts differed only in the `REPO`/`OUT` paths.

---

# Panel: LLP 1012, Local-first v1 — Round-1 brief (identical for every panelist)

You are one of six independent panelists, each a different model or model
family. Do not coordinate; give your own read. The orchestrator will verify
every engine claim against the tree, synthesize all six, and put the splits to
the author. Your review will be preserved verbatim under `llp/reviews/`.

## Your working tree

`REPO` (given in your prompt) is a read-only export of the repository at
commit `9ffdf6dd0` (`origin/main`, 2026-09-04). Everything in it is real and
readable. **Read code, not just docs.** Cite `path:line` for every claim about
the engine, the compiler, the client, or the grammar. If you could not verify
something, say so in those words; do not guess and do not invent. Write your
review only to the output path in your prompt; do not modify the tree.

## What Snapback 2 is

Snapback 1 is a shipped scale-to-zero backend (server-authoritative data, live
queries, ephemeral realtime, auth, first-party React/Expo/Swift clients) that
accreted: ~3,600 diagnostic codes, drift registries, frozen-record gates, two
authoring profiles, a million-word guide. Snapback 2 (`snapback2/`, LLPs
numbered 1000 and up) is the from-scratch successor, started 2026-08-29. One
language for queries and mutations (Quarry), one agent loop, one binary. The
data plane is a Rust IR interpreter inside SQLite; the client is a small
TypeScript twin of that interpreter; JavaScript never runs in the data plane.

## The author's priorities — read this twice

> "Value simplicity and elegance and speed and ease and ergonomics as
> priority 1. Features are more about just making sure we can do everything
> we need to do, not beating out other things by having a longer list of
> features for its own sake."

A recommendation that adds surface must pay for itself in simplicity or
speed; a recommendation that removes something is first-class. The primary
user is an AI agent building an app; the second is a human reading what it
wrote.

## What this panel is about

On 2026-09-04 the author directed that Snapback 2 must work well on local and
offline data: WhatsApp-shaped apps that keep messages on the client and read
them with no network. Thirteen decisions were put to the author with
recommendations; the author ruled on all thirteen. `llp/1012-local-first-v1.spec.md`
is the implementing spec that folds those rulings.

**The thirteen rulings in LLP 1012 §2 are decided and are not up for
re-litigation.** They are context. The one exception: if you find, with
evidence from the tree, that a ruling *cannot be implemented as the spec
spells it*, say so and say what would make it implementable. Everything
else in the document — the mechanisms, the protocol, the spellings, the
states, the lane split, the recipe — was written by the orchestrator, has not
been reviewed by anyone, and is what you are here to break.

## Required reading, in order

1. `rules/RULES.md` and `rules/NOT-DOING.md` — the posture; NOT-DOING now has
   three bars and a Moves ledger.
2. `llp/1000-snapback2.explainer.md` — the root; the founding decisions.
3. **`llp/1012-local-first-v1.spec.md` — the document under review.** Read it
   whole.
4. The design it implements: `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md`
   §5 (retention, dimension F) and §7 (runtime, client); `llp/0329.014.007-…`
   sections F8 and F11 ("not a replica"); `llp/0329.014.008-…` (the eight
   candidates 1012 §11 declines or narrows).
5. The engine and wire it claims things about:
   `llp/1001-query-engine.spec.md` (receipts, absences, hidden rows, §8
   `new_ids`, the `ClientStore`), `llp/1002-dev-loop.spec.md` §4 (the wire)
   and §9 (client states), `llp/1006-assets.rfc.md` §9a–§9b and §10.
6. The code: `snapback2/crates/snapback2-core/src/{client.rs,engine/,live.rs,store.rs,retention.rs}`,
   `snapback2/crates/snapback2/src/{serve.rs,writer*.rs,receipt.rs,protocol.rs}`,
   `snapback2/packages/snapback2/src/{client.ts,react.tsx,sse.ts,types.ts}`,
   `snapback2/packages/evaluator/src/`, `snapback2/packages/compiler/src/quarry/`,
   `snapback2/packages/snapback2/templates/chat/snapback/*.q`,
   `snapback2/packages/snapback2/guide/quarry.md`.
7. The bar: `benchmarks/briefs/social-messenger.md` M5 and M6 (search the
   file for "### M5" and "### M6").
8. Snapback 1's offline story, for what not to rebuild:
   `guide/sync/offline-and-retention.md` (skim the routing table and the
   dead-ends), `issues/20260806-expo-file-carrier-process-kill-witness.md`,
   `issues/20260830-snapback2-wire-evaluator-into-public-client.md`.

## The questions

Answer each with evidence. Where the answer is "the spec is right", say so
briefly and move on; the value is in what is wrong or unverifiable.

1. **Absent versus hidden (§5).** The `delivered-history` policy keeps a held
   row unless the receipt proves an *absence*, and treats a row merely missing
   from a fresh result as still-delivered history. Does the receipt as
   implemented let a client tell a deleted row from a hidden one, for point
   reads *and* for rows inside a range? Where exactly (file:line)? If not,
   what does §5's fallback actually do to a messenger, and what is the right
   design?
2. **The resume protocol (§8).** One `POST /api/resume` re-executes every
   held `(op, args)` in one read transaction at one `seq` and answers
   `unchanged` by digest. Is that bounded and honest against the engine's
   subscription and digest machinery as it exists? What does it cost for a
   fifty-conversation inbox with two hundred held pages? Is a *read*
   transaction the right unit, given the owner's threading model? What is
   missing from the request or response shape?
3. **Ids (§7).** Session id blocks plus pinned-id replay "through the hook
   LLP 1001 §8 already names." Does that hook exist in code in a form a
   replayed client intent can use? What is the failure shape when a block is
   exhausted, when a device is wiped, when two devices of one principal
   race?
4. **The receipt on the wire (§8, `receipt=1`).** Is the closure receipt
   serializable as-is, generation-bound, and small enough per delivery to
   ship on every frame of a subscription? What would you cut or add?
5. **The delivery-log recipe (§3).** Does it compile under Quarry v0.3 as
   written? Does the fan-out `for` fit the certificate's write bound? Does one
   range actually cover every messenger screen the brief's M5–M6 need
   (inbox, thread, search, reactions, edits, deletes, disappearing messages,
   view-once), or is a second range or a second query needed? Is a per-viewer
   log the right shape at all against "not a replica", or is it a replica by
   another name?
6. **The outbox and prediction (§7).** Is `queued → committed | rejected |
   expired` with `predicted` as a flag the right and smallest state machine?
   Is the "same carrier transaction" claim achievable on IndexedDB? Is the
   FIFO-with-independent-settlement rule honest for the messenger's write
   shapes, and where does it produce a state a user will not understand?
7. **The fence (§5).** Trust-only, 7 d default, 30 d server hard maximum on
   intent age. Is anything in the runtime or the certificate assuming the
   old "store untrusted past the fence" reading? Does the server need the
   client's fence for anything?
8. **Spellings.** `retain until-revoked | delivered-history` as a table line;
   `fence: { days }` and `maxAssetBytes` as client options; `E_OFFLINE_CARRIER`,
   `E_OFFLINE_FENCE`, `E_RETAIN_POLICY`, `E_INTENT_EXPIRED`, `E_ID_BLOCK` as
   the `offline` family. Consistent with LLP 1010/1011 and the existing
   families? Anything that should be schema instead of client, or the reverse?
9. **Carriers and the witness (§4, §10).** IndexedDB and expo-sqlite behind
   one interface, loud `E_OFFLINE_CARRIER`, no encryption claim, a physical
   process-kill witness as the bar's evidence. What does the witness as
   written fail to catch? Is the interface in §4 the smallest one that
   supports lane O3?
10. **The lanes (§12) and the trade (§13).** Is the O1–O4 split buildable in
    that order with those dependencies? Is anything in v1 not needed for the
    offline bar as stated? Is anything needed for the bar missing?
11. **Surface.** Name every thing in 1012 that adds surface without paying
    for itself, and every thing you would delete.

## Your output

Write a single Markdown file to the output path in your prompt, at most
about 3,000 words, in this order:

1. **Verdict**: `READY` (implement as written), `READY WITH EDITS` (list
   them; none blocking), or `NOT READY` (at least one blocking finding).
2. **Blocking findings**, numbered, each with: the claim in the spec (quote
   it), the evidence (`path:line`), why it blocks, what would resolve it.
3. **Material findings** (should change before lanes start), same shape.
4. **Minor findings** (wording, spellings, consistency), briefly.
5. **Answers to the eleven questions**, one short paragraph each; cite.
6. **Strengths** — what the spec gets right that a revision must not lose.
7. **Open questions for the author**, only if a ruling is genuinely needed.
8. **One paragraph**: what you would build first if you owned lane O1.

Do not pad. Do not restate the spec. Do not review the thirteen rulings
except under the one exception above. If you ran out of time before reading
something on the list, say which.
