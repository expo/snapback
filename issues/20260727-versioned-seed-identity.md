# Versioned seed identity and explicit evolution

**Status:** Open  
**Impact:** 4  
**Urgency:** 4  
**Ease:** 2  
**Confidence:** 5  
**Severity:** P1  
**Systems:** Provisioning, Storage, Migrations, Code generation, Dev loop, Diagnostics  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** LLP 0018, LLP 0034, LLP 0041, LLP 0081

`ensureApp` seeds only when every target table is empty and otherwise reports
`skipped-nonempty`. Seed data carries no version/digest and the database stores
no applied identity, so a changed seed cannot distinguish “already applied”
from “different or partially mutated data.” Browser setup can preserve stale
fixtures without an actionable migration boundary.

## Design gate

Reconcile LLP 0034's non-destructive seed-if-empty rule with LLP 0081's
explicit migration identity and approval. Run `llp-super-refine` with Fable 5
and Codex gpt-5.6-sol input before changing durable metadata or provisioning
semantics.

## Desired resolution

- Add canonical authored `seedVersion` plus generated content digest and
  durable applied-seed metadata scoped to app/database/stream.
- Record seed rows and identity atomically. Exact repeat returns `matched`;
  changed identity returns a stable `migration-required` outcome with safe
  current/requested identities and exact next actions.
- Never overwrite nonempty data automatically. Evolved data uses an explicit
  migration; destructive reset remains explicit.
- `reset(seed)` installs the new identity; reset without seed clears it.
  Inspect, ensure, dev events, receipts, and codegen summary expose identity
  and state without row contents.
- Define legacy nonempty database behavior as unversioned/unknown and fail
  actionable rather than silently blessing it.

## Acceptance

- Tests cover fresh seed, exact repeat, changed seed over empty/nonempty/partial
  tables, legacy state, crash atomicity, restart, reset/install/clear, schema
  migration ordering, sessions/authority-bearing seed provenance, and stream
  reset.
- Codegen identity is deterministic and any authored seed change updates the
  expected digest.
- `snapback dev` reports `seeded`, `matched`, or `migration-required`; it never
  resets on reload or file watch.
- Guide and capability pages teach bootstrap seed versus data migration, with
  stable recovery commands.
