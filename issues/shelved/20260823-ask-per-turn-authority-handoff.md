# Bind each Ask provider turn to durable caller authority

**Status:** Open — unblocked by author ruling 2026-08-23
**Opened:** 2026-08-23
**Systems:** Ask, External providers, Auth, Spend accounting, Receipts
**Governing:** LLP 0204 D5
**Source:** `issues/shelved/20260821-durable-authority-to-effect-handoff-design.md`

## Scope and exit

Add durable run and per-provider-turn attempt identities. Each turn handoff
atomically binds caller authority, provider/model, request digest, and the
exact spend reservation before provider bytes. Retirement-before-handoff
prevents the call; handoff-before-retirement permits exactly that turn to send
and settle; every later turn re-authorizes.

Tests must prove both orders, single-use settlement, crash/transport ambiguity
without releasing unknown spend, no post-handoff caller veto, and refusal of a
later turn after retirement.
