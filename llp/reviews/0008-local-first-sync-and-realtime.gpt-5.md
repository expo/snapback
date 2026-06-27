# Review: LLP 0008 - Local-first sync and realtime

**Reviewed:** `llp/0008-local-first-sync-and-realtime.rfc.md` (working-tree revision)
**Family:** GPT-5 (OpenAI)
**Provider/runtime:** OpenAI API via Codex
**Date:** 2026-06-25
**Redacted:** No - reviewed local repo artifacts only.
**Method:** Single-session read-and-critique against LLP 0006, 0007, 0010, and
0011; targeted auth-change revision applied.

## Overall assessment

The RFC is strong because it treats local-first sync and realtime as one
ordered-changeset system. The added permission-epoch/resubscribe model makes the
auth interaction concrete without requiring universal live permission
re-evaluation in v1.

## Strengths

- Authoritative initial snapshot fixes the most repeated Valet integration bug.
- Replay environment, doc-id suppression, and atomic optimistic changesets are
  grounded in Valet rather than invented cold.
- Retention rejects Valet's unbounded min-watermark anti-pattern.

## Concerns

- **C1 - Fan-out ceiling remains the biggest product unknown. [High]** Whiteboard
  and community-chat claims need hard measurements.
- **C2 - Matcher/read-set cost can dominate. [High]** The analyzable-query v1
  line is good, but the prototype must measure false-positive reruns.
- **C3 - Authz epochs need precise dependency declarations. [Medium]** Broad
  invalidation is safe but may be costly; narrow invalidation requires real rule
  metadata.

## Suggestions

- Make `resync_required` and stale-slice clearing first-class runtime states.
- Build burst/backpressure and two-client auth tests before richer conflict work.

## Open questions

- What permission dependency metadata is required for v1?
- What fan-out benchmark decides whether presence is table sync or a separate
  ephemeral channel?

## Recommended next step

Keep `Draft`. Prototype the ordered-changeset path with metrics for matcher
cost, queue depth, reconnect, retention, and permission resubscribe.
