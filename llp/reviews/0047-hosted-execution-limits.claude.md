# Review: LLP 0047 — Hosted execution limits

**Reviewed:** `llp/0047-hosted-execution-limits.rfc.md` (working-tree revision, 2026-07-07 draft)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Fable 5
**Date:** 2026-07-07
**Redacted:** No — reviewed locally; nothing sent beyond the model serving this
session.
**Method:** Single-session independent read, verified against LLP 0009 (parent
RFC — pooling posture, DK-4/DK-5), LLP 0028 (action-kill semantics), and
`src/manifest.rs` (`ResourceLimitStatus { Enforced, Advisory, Missing }`,
`hosted_untrusted_code`, `wall_clock_timeout`, `action_wall_clock_timeout`).
Same-family sub-agent passes assisted verification; this artifact is **one**
family's review.

> **Independence (LLP 0005).** Draft authored by Charlie Cheever / Codex
> (GPT-family); genuine cross-family review.

## Overall assessment

Substantively the most conflict-free RFC in the set: the
Enforced/Advisory/Missing trichotomy is the as-built vocabulary (not an
invention), fresh-per-invocation-unless-pooling-proves-itself matches 0009's
durable hosted default, burn-on-uncertainty matches DK-4, and V8-first for
hosted matches 0009's named rule. The defects are staleness and one semantic
trap. Staleness: the motivation implies all wall-clock enforcement is missing
locally, but the local action watchdog already shipped
(`action_wall_clock_timeout: Enforced`, default 30 s, ENG-23324) — the RFC
should acknowledge it and narrow its claim to query/mutation preemption plus
hosted isolation. The trap: "no mutation writes commit after a killed
invocation" is correct for mutations, but for *actions* LLP 0028 is explicit
that mutations committed before the timeout stand (actions are not
transactions) — as written, the acceptance list can be read as requiring a
rollback 0028 forbids.

## Strengths

- "If a limit cannot be enforced on a target, the target must not claim hosted
  untrusted execution" is the exact fail-closed inversion of Valet's
  fictional-timeout failure, stated as a gate.
- The host-powers denial list (including timers that outlive invocation and
  stale-continuation host calls) matches the epoch-guard machinery that
  already exists for the warm pool.
- Non-goals correctly refuse to relitigate warm pooling or claim local Ibex
  CPU limits.

## Concerns

1. **[MEDIUM] Stale about the shipped action watchdog** (see above).
2. **[MEDIUM] Killed-action semantics must defer to 0028** (see above) —
   one sentence prevents an acceptance-test author from "fixing" 0028's
   contract.
3. **[LOW] The DK-5 revisit trigger goes unnoted:** 0009/0032 name "hosted or
   untrusted execution work begins anywhere" as a trigger for the deferred V8
   conformance twin; this RFC is that work beginning, and should say it fires
   the trigger (LLP 0040 fires the other one).
4. **[LOW] Per-app fairness is absent:** invocation-scoped limits are covered,
   but nothing bounds one app's aggregate concurrency/queue depth in a
   multi-tenant host — even naming it a non-goal would be better than silence.

## Recommended next step

Revise and stay `Draft` — the smallest revision in the set; then this document
is a solid gate.

## Revisions applied (2026-07-07, at the author's request)

Applied to the draft: action-watchdog prior art acknowledged and claims
narrowed (concern 1); action-kill semantics deferred to 0028 (concern 2);
DK-5 trigger sentence (concern 3); per-app fairness named (concern 4). Status
left untouched.
