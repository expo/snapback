# `defineAuth` `minimumLength` change silently refused through the successor flow (silent-degradation class)

**Status:** Closed (2026-08-28)
**Opened:** 2026-08-27
**Systems:** Auth catalog, Schema successors, Diagnostics
**Source:** Clique benchmark matrix (published Snapback 0.1.29), glm-snapback-explicit lane

## Problem

A lane changed a `defineAuth` password `minimumLength` bound and applied it through the
normal successor flow. The change **silently refused to apply** — signup kept enforcing
the OLD bound — and only took effect after a full store reset. No diagnostic was emitted.

Quoted (`glm-snapback-explicit`): a `defineAuth` `minimumLength` change "silently refused
to apply through the normal successor flow"; signup kept returning the old bound until a
full store reset.

## Why this is worth a ticket (silent-degradation class)

This is the failure mode Snapback otherwise avoids well. The same matrix praised Snapback's
diagnostic precision repeatedly ("the platform told me exactly what was wrong every time")
and every OTHER auth/schema refusal in the run was loud and coded
(`CODEGEN_MODULE_EVALUATION_FAILED`, `SNAPBACK_AUTH_PROGRAM_INVALID`,
`SNAPBACK_SEED_MIGRATION_REQUIRED`, etc.). A change that is **neither applied nor loudly
refused** is the worst outcome: the author believes the new bound is live when it is not.
It should either apply through the successor, or fail with a specific
`SNAPBACK_AUTH_*` / successor diagnostic explaining that an auth-catalog change of this
kind requires a store reset (or whatever the real constraint is).

## Verification plan

On published 0.1.29: scaffold auth with a password mechanism at `minimumLength: N`; apply a
successor changing it to `minimumLength: M`; attempt a signup with a password of length in
`[N, M)`. Observe whether the new bound applies, is loudly refused with a coded diagnostic,
or silently no-ops (reproducing the report). If it silently no-ops, that is the bug: the
successor path for auth-catalog value changes needs either application or a loud refusal.

## Related

The auth-catalog successor semantics may intentionally not support in-place value changes
for some fields; if so, the gap is a **missing diagnostic**, not a missing feature — but
silence is still wrong. See also the familiar-profile custody/auth docs gaps recorded in
the matrix synthesis.

## Owner

Auth catalog / schema successors. Reproduce before classifying as bug-vs-intended; if
intended, the fix is a loud diagnostic + a guide note.

---

## Resolution (2026-08-28, `f3c09fcb0`)

**Reproduced, and the mechanism was not what this ticket assumed.**

This ticket recorded that the change "silently refused to apply through the
normal successor flow" and "only took effect after a full store reset." The
reproduction (`tests/acceptance/auth-password-policy-successor-v1.mjs`) shows
something narrower and less alarming: live provisioning silently **retains** the
predecessor bound, and a **restart of the same store applies the successor** —
no reset, no migration, no data loss. Anyone acting on the original wording
would have destroyed a store to fix a restart.

The test pins both halves, because "the new bound is inactive" alone does not
distinguish retention from enforcement being switched off: a sub-8 signup is
still refused with `SNAPBACK_AUTH_PASSWORD_POLICY` carrying `minimumLength: 8`
**after** provisioning, and a post-restart sign-in for the predecessor account
proves the same store survived.

**Fix: loud refusal, not live apply.** Live apply is unsound —
`minimumLength` is startup-carried policy captured by the process's single
`AuthProvider`, not mutable auth-catalog state. Same-mode provisioning now
commits the successor and returns HTTP 409
`SNAPBACK_AUTH_PASSWORD_POLICY_RESTART_REQUIRED`, naming both bounds and a
**restart — not reset** — repair. Identical retries stay loud by comparing
against the live provider rather than the updated durable manifest.

- Refusal and retry behaviour: `crates/snapback-server/src/server.rs`
- Candidate bound exposed to the process owner: `crates/snapback-auth/src/auth/provision.rs`
- Status classification: `crates/snapback-server/src/server/api_error.rs:471`
- Guide, both authoring profiles: `guide/backend/schema-evolution.md:100`
- Acceptance: first refusal, retry refusal, predecessor enforcement until
  restart, successor enforcement after, store persistence

Verified failing against the pre-fix binary ("Missing expected rejection") and
passing against one built from the fixed checkout. Reviewed by codex
`gpt-5.6-sol` and `grok-4.6`, both at xhigh, both LAND.

**Scope note.** The refusal is newer than the newest published closure, so the
guide section carries an unreleased fence: an already-published runtime,
including the 0.1.29 packages that produced this report, still exhibits the
silent behaviour. Tracked as LLP 0317 O29.
