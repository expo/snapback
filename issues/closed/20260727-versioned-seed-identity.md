# Versioned seed identity and explicit evolution

**Status:** Closed  
**Impact:** 4  
**Urgency:** 4  
**Ease:** 2  
**Confidence:** 5  
**Severity:** P1  
**Systems:** Provisioning, Storage, Migrations, Code generation, Dev loop, Diagnostics  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Closed:** 2026-07-27  
**Related:** LLP 0018, LLP 0034, LLP 0041, LLP 0081, LLP 0103

`ensureApp` seeded only when every target table was empty and otherwise
reported `skipped-nonempty`. Seed data carried no version/digest and the
database stored no applied identity, so a changed seed could not distinguish
“already applied” from “different or partially mutated data.” Browser setup
could preserve stale fixtures without an actionable migration boundary.

## Design gate

Reconcile LLP 0034's non-destructive seed-if-empty rule with LLP 0081's
explicit migration identity and approval. Run `llp-super-refine` with Fable 5
and Codex gpt-5.6-sol input before changing durable metadata or provisioning
semantics.

## Desired resolution

- Add canonical authored `seedVersion` plus generated content digest and
  durable applied-seed metadata scoped to app/database/stream.
- Record seed rows and identity atomically. Exact repeat returns `matched`;
  changed identity returns a stable migration-required refusal with safe
  current/requested identities and exact next actions.
- Never overwrite nonempty data automatically. Evolved data uses an explicit
  migration; destructive reset remains explicit.
- Reset-install installs the new identity; clear removes it through the same
  coordinated reset boundary.
- Define legacy nonempty database behavior as unversioned/unknown and fail
  actionable rather than silently blessing it.

## Acceptance

- Tests cover fresh seed, exact repeat, changed seed over empty/nonempty/partial
  tables, legacy state, crash atomicity, restart, reset/install/clear, schema
  migration ordering, sessions/membership refusal, and stream reset.
- Codegen identity is deterministic and any authored seed change updates the
  expected digest.
- Managed CLI and Vite lifecycle use the versioned protocol without legacy
  fallback or watch-triggered reset.
- Guide and capability pages teach bootstrap seed versus data migration, with
  stable recovery commands.

## Resolution

LLP 0103 was created and super-refined with retained Codex and Fable review
artifacts. The implementation now includes:

- a closed, canonical `seed.artifact.json` with authored `seedVersion`;
- stream-keyed protected installation and bounded replay metadata;
- atomic install, reset-install, and clear receipts plus pure matched
  observations;
- exact preview/effect accounting and the 1,024-effect ceiling;
- all four AdminWrite + NonProd direct routes and host operations;
- capability-preflighted client, managed CLI, and Vite lifecycle surfaces with
  no legacy fallback;
- Rust-owned schemas and a dedicated Guide page; and
- an executable closed conformance dispatcher covering HTTP, host operations,
  client/CLI/Vite, true package cold install, restore, fault/replay,
  empty-array occupancy, sessions membership refusal, effect bounds, and the
  exact predecessor binary.

The official dispatcher receipt at
`target/conformance/versioned-seed-v1.receipt.json` records 20 mandatory
passes, one explicit hosted GAP, both Experimental local capability ids, the
target binary identity/digest, and the full predecessor
`3db3185a8325b5e8209b637080ab65d775c880ea` build identity/digest. It is
owner-only and contains no credential patterns.

LLP 0103 intentionally remains Review pending author acceptance; the SQLite
capability ids are Experimental, and hosted compiled-seed custody remains an
explicit GAP.
