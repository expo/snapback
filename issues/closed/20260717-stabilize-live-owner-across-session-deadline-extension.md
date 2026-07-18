# Stabilize live ownership across session deadline extension

**Status:** Closed
**Severity:** P1
**Systems:** Session auth, Live queries, Connection grants, RBAC acceptance
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0058 §Live owner and replacement predicate; `issues/20260716-dispose-rbac-live-subscriptions.md`
**Marker:** auth, live-query, ownership, session-deadline, teardown, release-blocker

Retained live ownership compared the complete `ResolvedAppAuthority` captured
at subscribe time with the authority prepared for resume, supersession, or
unsubscribe. Session resolution contains mutable `session_not_after_ms` and
`provider_not_after_ms` facts. A successful authenticated use can extend those
deadlines without changing the session's user, id, or generation, after which
the exact same connection grant was refused with
`SNAPBACK_LIVE_RESUME_OWNERSHIP`. The RBAC acceptance exposed this while
unsubscribing Eve after global membership invalidation traffic.

LLP 0058 defines the retained owner as the stable bearer-free
`resolvedAuthorityKey` plus the exact connection grant. Deadlines are act-time
liveness facts, not ownership identity.

**Done when:**

- A retained subscription stores the stable `AuthorityKey` separately from the
  complete resolved authority needed for reruns.
- Resume, explicit supersession, and unsubscribe compare that key plus the exact
  connection effect fence; a deadline-only extension remains the same owner.
- A changed session user, session generation, or connection grant still fails
  with `SNAPBACK_LIVE_RESUME_OWNERSHIP` and preserves the subscription.
- Deterministic regression coverage subscribes under one deadline snapshot and
  unsubscribes under a later snapshot with the same stable key.
- Focused live-owner tests, repeated RBAC acceptance, and the canonical proof
  pass.

## Resolution

`RetainedLiveAuthority` now records `AuthorityKey` when the live owner is
established while retaining the complete resolved authority for subsequent
reruns and durable service validation. Owner comparison uses that stable key;
the existing `ConnectionEffectFence` comparison continues to enforce the exact
connection-grant and session/service carrier axis.

The focused local regression varies both session and provider deadlines and
proves that the exact owner can unsubscribe, while changed user, generation,
and grant identities remain refused without removing the subscription.
Repeated RBAC acceptance and the full Rust library suite (1,102 passed) also
passed.
