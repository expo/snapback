# Bind webhook attempts to an atomic durable authority handoff

**Status:** Open — unblocked by author ruling 2026-08-23
**Opened:** 2026-08-23
**Systems:** Webhooks, Durable jobs, Watches, Auth, External effects
**Governing:** LLP 0070 §Webhook work; LLP 0204 D9.3
**Source:** `issues/20260821-durable-authority-to-effect-handoff-design.md`

## Scope and exit

Before provider bytes, atomically transition one webhook attempt under the
full job-claim plus watch/anchor/function authority composite and mint the
typed cut ticket used by transport. Retirement before the transition refuses;
retirement afterward does not veto that attempt or settlement. Preserve the
logical delivery id and idempotency key across retries and retain the
at-least-once duplicate warning.

Tests must prove both retirement orders, crash-before/after-cut behavior,
single-owner fencing, receiver-ignored-idempotency duplicates, and that no
caller/session credential is consulted after the handoff.
