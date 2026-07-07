# Review: LLP 0045 — Notifications outbox

**Reviewed:** `llp/0045-notifications-outbox.rfc.md` (working-tree revision, 2026-07-07 draft)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Fable 5
**Date:** 2026-07-07
**Redacted:** No — reviewed locally; nothing sent beyond the model serving this
session.
**Method:** Single-session independent read, verified against LLP 0028
(execution classes, idempotency guidance), LLP 0036 (grant model, D8), and
`src/manifest.rs` (the `notifications` gap is a real manifest fact).
Same-family sub-agent passes assisted verification; this artifact is **one**
family's review.

> **Independence (LLP 0005).** Draft authored by Charlie Cheever / Codex
> (GPT-family); genuine cross-family review.

## Overall assessment

The strongest-shaped RFC in the set: durable intent + side-effectful delivery
is the correct decomposition, matches 0028's action contract exactly ("an
action-level read followed by `ctx.runMutation` is not a transaction"), and the
error taxonomy and idempotency scoping are right. Two real problems. First,
the Design presumes a "notification runner" that is an unbuilt, undesigned
executor — while the Open Questions ask what it should be. 0028 already gives
everything a v1 runner needs (claim, no-overlap, at-least-once, jitter,
idempotency-key guidance); runner-as-cron-sweep should be the named first
implementation, not one of three open options. Second, the grant model doesn't
fit as written: "grants control which provider credentials a notification
runner may use" has no grant identity under 0036, whose unit is the
app-declared function's `uses` list. Either delivery executes as an action
carrying `uses: [providerKey]`, or 0036 needs extending — the RFC must pick.

## Strengths

- The transactional honesty (commit the intent, deliver as a separate side
  effect, never pretend one transaction) is exactly the corpus's posture.
- Provider error classification (retryable / permanent recipient /
  configuration / rate-limited / unknown) is the right vocabulary to pin early.
- "Admin/provider credentials authorize delivery to the provider; they do not
  authorize app code to contact arbitrary recipients" is a subtle and correct
  authority split.

## Concerns

1. **[MEDIUM] Runner undefined in Design, deferred in Open Questions** (see
   above). *Resolves with:* naming the 0028 cron-sweep as v1.
2. **[MEDIUM] Grant identity gap vs 0036** (see above). *Resolves with:*
   delivery-as-action carrying a `uses` grant.
3. **[LOW] The auth-email-code open question is already answered by LLP 0039**
   ("local capture mailbox in dev … later deliver through the
   notifications/provider subsystem"). Neither doc owns the decision; this one
   should record it rather than re-ask. Relatedly, both docs independently
   describe a "local capture mailbox" — it should be designed once, owned
   here, with 0039's slice consuming (or seeding) it.
4. **[LOW] Bounce/complaint suppression is unaddressed:** "permanent recipient
   failure" is classified but nothing says the failure persists as a
   suppression fact, and repeatedly mailing hard-bounced addresses damages
   provider standing. An open question suffices for v1.
5. **[LOW] No explicit ordering statement:** the outbox promises no
   cross-intent delivery ordering; saying so prevents apps from depending on
   accident.

## Recommended next step

Revise and stay `Draft`. The shape is right; the fixes are commitment
(runner, grants) and cross-doc reconciliation with 0039.

## Revisions applied (2026-07-07, at the author's request)

Applied to the draft: runner-as-cron-sweep named as the v1 implementation with
the durable queue as future work (concern 1); delivery-as-action `uses` grant
design (concern 2); auth-code decision recorded per 0039 and capture-mailbox
ownership stated (concern 3); suppression open question (concern 4);
no-ordering statement (concern 5); LLP 0039 added to Related. Status left
untouched.
