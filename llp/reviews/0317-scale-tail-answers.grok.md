# Review — 2026-08-28 scale-tail answers, 0193 intake ruling, and the read-receipt recipe

**Reviewer:** `grok-4.6` @ `--reasoning-effort xhigh`, headless, terminal
denied (`--disallowed-tools run_terminal_command,search_replace,write`), file
reads only, no git access.
**Requested by:** Claude (Opus 5), closing
`issues/20260828-read-receipt-client-ack-pattern.md`,
`issues/20260828-non-snapback-diagnostic-registry-scope.md`, and
`issues/20260828-scale-tail-two-open-questions.md`.
**Date:** 2026-08-28
**Verdict as received:** NOT READY (4 MATERIAL, 9 MINOR).

## Disposition

All 13 concerns were accepted, 11 as written and 2 with a narrowed rationale.
Two were independently verified against the source before acting, because both
turned on a fact the reviewer could not check without a terminal:

- **#4** (the anti-pattern forbade the send-path insert the pattern requires) —
  confirmed: `insertMessageCore` in `demos/coterie/snapback/functions.mjs`
  inserts one `messageReceipts` row per recipient with `status: 'sent'`,
  `statusRank: 0`. The anti-pattern was split into "do not *assert* delivered
  or read from the sender's path" plus a new §1 step teaching the insert.
- **#9** (the `ctx.refuse` collision argument in the LLP 0193 amendment) —
  confirmed the reviewer's correction: application source is outside
  `DIAGNOSTICS_PRODUCTION_ROOTS`, so app refusal codes are **not** a live
  extractor collision today; the only `ctx.refuse` occurrences under
  `packages/` are in test files. The argument was re-led with prefix
  heterogeneity (the five codes span `CODEGEN_*`, `SCHEMA_*`, `FUNCTION_JS_*`)
  and production-root non-diagnostics, keeping `ctx.refuse` as the *latent*
  hazard it actually is — app backends do live under a production root at
  `packages/snapback-cli/templates/*/snapback/`.

Narrowed rather than adopted verbatim:

- **#10** — accepted that "by construction" was broader than the evidence, and
  tied the claim to C5's second acceptance witness instead of to empty-write
  permission alone.
- **#11** — dropped "not profile-neutral" as a weak reason and replaced it with
  the reviewer's stronger point, generalized: a vocabulary sniff wide enough to
  catch the lane would generate-fail this very recipe's `markRead`.

Items the reviewer marked **UNVERIFIED (no git access)** — the
`storage.rs:24216` raise site, `run-log.md:281`, the file-drop codegen probe,
retrieval-eval seed 136, and snippet byte-exactness — were verified separately
by the author: the probe and the raise site by direct execution and reading,
seed 136 by `node scripts/check-retrieval-eval.mjs` (ok, 0 errors), and snippet
byte-exactness by `node scripts/check-guide.mjs`.

## Review as received

I'll review the three deliverables against the cited evidence and guide conventions, reading only the enumerated files.Next I’ll read the cited LLP sections and the coterie receipt code so I can check the recipe against the actual implementation.I have the recipe, the two rulings, the tickets, and the coterie receipt code. Next I’ll check the remaining factual claims against those sources only.1. **MATERIAL** — `guide/recipes/read-receipts.md` §4: *"The paved shape is a per-membership watermark — 'everything through sequence N is delivered/read' — stored as a pair of sequence fields on the membership row and folded into the effective rank of every message at or below that sequence."*

   The page never names the fields, never transcludes the fold, and does not match coterie's mutation. The fold is `effectiveReceiptRank` (`demos/coterie/snapback/functions.mjs`): `Math.max(receipt.statusRank, message.sequence <= membership.deliveredThroughSequence ? 1 : …, message.sequence <= membership.readThroughSequence ? 2 : …)`. `markReceiptsThrough` takes `{ conversationId, state }` only; `throughSequence` is always `max(0, conversation.nextEventSequence - 1)`, not a caller-supplied N, and it cannot be chunked. §2's transcluded `advanceReceipt` already calls that unshown fold (and unshown `receiptStatusForRank`), so the "shape to hand-roll" is not reconstructable from the page. The fold is also only correct if `message.sequence` and that event-sequence watermark share a space — also unstated.

   **Fix:** Transclude `effectiveReceiptRank` and `markReceiptsThrough`. Name `deliveredThroughSequence` / `readThroughSequence` on the membership row. State that coterie always watermarks through the current conversation head, and that sender-facing reads must use the folded rank, not `receipt.status` / `statusRank`.

2. **MATERIAL** — `guide/recipes/read-receipts.md` §4: *"Coterie's `markReceiptsThrough` refuses `RECEIPT_ENVELOPE_EXCEEDED` above that ceiling rather than writing an unbounded number of rows"* and the busy-thread pitch that the watermark is the paved alternative to *O(unread)* mutations.

   `markReceiptsThrough` writes only `conversationMembers` (`writes: ['conversationMembers']`). The ceiling is `receiptEnvelopeAdmits(access.membership.receiptCount)` with limit `1_024`, i.e. a pre-write gate on the membership's maintained incarnation/required-message count. It does not bound rows this handler writes. Because the mutation always covers the current head, any membership with `receiptCount > 1024` cannot use the bulk path at all — the exact backlog case used to justify it. Per-message `markRead` is then the only remaining path, which is what §4 said not to do.

   **Fix:** Describe the envelope as an admission bound on `membership.receiptCount` for a through-head claim. Say explicitly that over-ceiling conversations cannot call this mutation (and that coterie does not chunk). Do not contrast it with "writing an unbounded number of rows."

3. **MATERIAL** — `guide/recipes/read-receipts.md` lede/§2: product affordance *"read 4:12"*; *"Timestamps are stamped once, on the transition, never overwritten."*

   Timestamps are written only in `advanceReceipt`, and only when `currentRank < targetRank` and `deliveredAt`/`readAt` is null. `currentRank` is the *folded* rank. `markReceiptsThrough` never stamps `readAt`/`deliveredAt` (nor any membership timestamp). After a read watermark, `effectiveReceiptRank` is already ≥ 2, so a later `markRead` is a no-op and `readAt` stays null. The paved open-a-thread path cannot support "read 4:12" from the receipt row.

   **Fix:** Either drop per-message read times from the affordance list, or teach a timestamp that the watermark actually writes, or teach a follow-up that stamps `readAt` without going through the folded-rank no-op (coterie does none of these — do not imply it does).

4. **MATERIAL** — `guide/recipes/read-receipts.md` anti-patterns: *"Do not write receipts from the sender's mutation. A receipt created by the sender's write path is a receipt about the sender."* versus transcluded `markRead`: `if (!receipt || receipt.recipientMemberId !== access.membership._id) { ctx.refuse('MESSAGE_RECEIPT_NOT_RECIPIENT'); }`.

   The handler will not create the row. Without a send-path insert of a `sent` / rank-0 row per recipient, every ack refuses. The anti-pattern's second sentence forbids that insert. The delivered-section warning (do not insert *delivered* from the sender path) is the right rule; this wording is not.

   **Fix:** Split the two. Require insert of identity rows (`status: 'sent'`, `statusRank: 0`) on send. Forbid asserting `delivered`/`read` from the sender path. Point that second half at §Delivered.

5. **MINOR** — `guide/recipes/read-receipts.md` trust bullets: *"A buggy client can fail to acknowledge a message that was displayed for a minute; the sender then sees 'delivered' forever."* and *"Neither case is detectable server-side, because the honest and dishonest calls are byte-identical."*

   Until the LLP 0008 primitive exists, delivered is the same client-ack at rank 1 (the page says so later). Silence therefore leaves *sent*, not a trusted "delivered." Silence vs ack is also not byte-identical; what is undetectable is whether an ack (or its absence) matches what was displayed.

   **Fix:** Residual state is whatever was last asserted, itself untrusted. Detectability: the server can see that a mutation did or did not run; it cannot know if the claim is true.

6. **MINOR** — `guide/recipes/read-receipts.md` must-not list: *"Proof of receipt or non-repudiation."*

   That bars using an ack as proof someone *saw* the message. It does not bar using *silence* as proof they did *not* (notice-was-not-served, unread-TOS, "they haven't seen the warning"). The first trust bullet describes the case; the copy-paste list does not.

   **Fix:** Add **Proof of non-reading.** A missing ack is not evidence the recipient has not seen the message. The rest of the list (access, entitlement/billing, compliance/safety) and the view-once pointer are right, and they are consistent with refusing to sniff `markViewed` in O54.

7. **MINOR** — `guide/recipes/read-receipts.md` §1: *"index it by `(recipientProfileId, messageId)` so the acknowledging client's own row is a point read."*

   `by_recipient_message` is not unique. The unique invariant is `by_message_recipient` on `(messageId, recipientMemberId)`. The transcluded handler is `.take(2).collect()`, then `receipts[0]`. That is a bounded scan on a non-unique index, and a rejoin can produce two profile-scoped rows.

   **Fix:** Call it a bounded lookup on `(recipientProfileId, messageId)` plus a current-membership check. Do not say "point read," and do not equate "recipient" with both member id and profile id.

8. **MINOR** — `guide/conventions.md` Headings / grep vocabulary vs `guide/recipes/read-receipts.md` headings (`Recipe: read receipts (client-ack)`, `Delivered is a different problem`, numbered technique titles).

   Workload strings the closed ticket cares about live in the lede, not in headings: "mark as read", "blue tick", "unread badge", "mark delivered". Conventions require those strings on headings (and aliases), not only in the opening paragraph.

   **Fix:** Put the search terms in headings or a short alias line under the H1 (e.g. mark as read / blue ticks / unread badge / mark delivered). Retrieval-eval seed 136 is **UNVERIFIED** (file not in pack; no git).

9. **MINOR** — `llp/0193-errors-as-docs-completeness.plan.md` discovery rule: *"SCREAMING_SNAKE is also the application refusal namespace: `ctx.refuse('MESSAGE_NOT_FOUND')` … an application's `ctx.refuse` is not a Snapback emitter and does not live in a production root."*

   Those two sentences fight. If app refusals are outside `DIAGNOSTICS_PRODUCTION_ROOTS`, they are not the false-positive that makes a wider lexical pattern unsafe; protocol constants, bundler codes, and `codePrefix:` fragments in production roots are. The stronger reason emitter-scope is required is already in the five-code table: the observed population is `CODEGEN_*`, `SCHEMA_*`, and `FUNCTION_JS_*`. Widening to `CODEGEN_*` would miss two of five; widening to all SCREAMING_SNAKE would ingest non-diagnostics. Emitter-scope is the right rule; do not reopen it. `PRODUCTION_ROOTS` itself is **UNVERIFIED** (not in pack).

   **Fix:** Lead with prefix heterogeneity plus production-root non-diagnostics. Keep `ctx.refuse` as the reason the population cannot be "any SCREAMING_SNAKE in app or demo source," not as a current extractor collision. Implementation ticket guardrail (positive test that demo `ctx.refuse` codes stay out) still belongs.

10. **MINOR** — `llp/0317-clique-0129-correction-loop-disposition.research.md` §Scale-tail Q1: *"Does C5 remove the class? Yes, by construction"* / *"never takes a durable client-mutation id."*

    Raise-site `crates/snapback-kernel/src/storage.rs:24216` and `run-log.md:281` are **UNVERIFIED** (not in pack). The O13 half does not need them: Insights/Trending were refused because empty write sets are illegal, so a read was submitted as a durable mutation. That coupling is authoring-boundary, not ledger-path. What is broader than the evidence is "by construction" if C5 is only "allow `writes: []`." A client that still submits a durable id on that handler still hits saturation. The new acceptance witness ("a read-model handler must not consume a durable client-mutation record") is load-bearing; without it the class is not gone. C5 still does not save acknowledgements or real writes (O53); the document already says that.

    **Fix:** Tie "by construction" to that witness, not to empty-write permission alone. Keep the incidental-vs-intended split. Do not claim query evaluation is unaffected by saturation beyond "this code is not raised on the query path."

11. **MINOR** — `llp/0317-clique-0129-correction-loop-disposition.research.md` §Scale-tail Q2 / O54: *"it is not profile-neutral"* as a reason not to refuse application-level view-once vocabulary.

    That extra reason is weak (both profiles parse). The split is still right: `grants: true` plus `delivery.kind: 'public-immutable'` is a declaration-internal contradiction (`guide/recipes/view-once-media.md` §4 already requires `grants: true` + `owner-only` + `private-strict` so revoke can deny the next *governed* byte request; a public URL has no such request). Sniffing `expiresAt` / `markViewed` / `disappearingMessages` cannot be stated precisely, false-positives on expiring *text*, and would also generate-fail this recipe's `markRead`. Residue after O54 (UI-hide over public-immutable, no grant/revoke at all) is correctly left out of reach. File-drop probe is **UNVERIFIED**; the contradiction does not depend on it.

    **Fix:** Drop or demote "not profile-neutral." Keep refuse-(a) / do-not-sniff-(b). In the O54 ticket, keep the generate-time repair (`private-strict` / `private-signed` + neither retracts delivered bytes) and the revoke-on-public-immutable second half.

12. **MINOR** — `llp/0193-errors-as-docs-completeness.plan.md` `## Program` Phase 1: *"Extract the complete `SNAPBACK_*` code inventory"* versus the amendment *"Exit criteria 1–5 are unchanged in wording and now range over the union."*

    An implementer who reads Program and not the dated amendment will under-scope intake. The living document now has two populations.

    **Fix:** One sentence in Phase 1 that the 2026-08-28 amendment extends inventory to emitter-scoped non-`SNAPBACK_*` product diagnostics.

13. **MINOR** — `guide/recipes/read-receipts.md` §5: *"The properties this recipe depends on are exactly the ones a test can pin"* plus the transcluded four-assert sequence (`markDelivered` ×2, `markRead`, `markDelivered` → `read`).

    That pins per-message idempotence and rank monotonicity on the mutation *result*. It does not pin timestamp-once, watermark fold, envelope refusal, or "sender reads the folded rank." Byte-exactness of the excerpt against `acceptance-m3.test.mjs` is **UNVERIFIED**.

    **Fix:** Say what the excerpt pins, or transclude tests that pin the other load-bearing properties.

VERDICT: NOT READY
