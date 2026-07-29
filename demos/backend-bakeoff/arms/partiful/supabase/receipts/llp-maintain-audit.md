# LLP maintenance audit — Partiful / Supabase

**Intent:** pre-pr
**Scope:** `demos/backend-bakeoff/arms/partiful/supabase/` only
**Date:** 2026-07-28
**Mode:** Propose-only; no LLP edits or status changes applied

## Result

- `./ref-check --verbose`: pass — 107 LLP documents, 2,229 references in
  4,009 files, zero errors and zero unchecked references.
- `node scripts/check-guide.mjs`: pass — 41 pages, 95 snippets, 69 routes plus
  19 host-ops joined. Its 23 freshness warnings predate and are outside this
  provider arm.
- The frozen capsule verifier passes all 15 Partiful scenario identities.
- The arm is governed by accepted LLP 0102 and does not modify Snapback product
  code, shared protocol files, LLPs, issues, diaries, reports, or other arms.
- The SQL, RLS, Storage policies, Edge Functions, and `pg_cron` job are
  provider-arm evidence, so no product `@ref` annotation is warranted.
- Hosted deployment is an explicit environment nonclaim. Cold Realtime misses,
  effect-boundary corrections, and the missing timestamped pre-provision
  baseline remain disclosed rather than converted into capability claims.
- No code/document drift, broken reference, tombstoned target, stale gloss,
  provenance error, status proposal, or reconciliation proposal was found.

No changes are proposed by this audit.
