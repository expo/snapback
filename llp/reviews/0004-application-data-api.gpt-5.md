# Review: LLP 0004 - Application data API

**Reviewed:** `llp/0004-application-data-api.rfc.md` (working-tree revision)
**Family:** GPT-5 (OpenAI)
**Provider/runtime:** OpenAI API via Codex
**Date:** 2026-06-25
**Redacted:** No - reviewed local repo artifacts only.
**Method:** Single-session read-and-critique against storage, sync, DX, and
integration LLPs.

## Overall assessment

The function-first API is the right product surface for agents: named queries
and mutations, generated references, `ctx.db`, diagnostics, and no raw protocol
as the app API. The document is appropriately explicit about no silent schema
drops and local/server parity.

## Strengths

- Strong agent bias: generated manifests, source spans, query plans, and doctor
  output.
- Good determinism constraints around ids, time, and replay.
- Correctly pushes exact integers/decimals and binary data out of plain JSON
  before finance/assets are claimed.

## Concerns

- **C1 - Query syncability is still the hard boundary. [High]** Opaque functions,
  auth-aware live subscriptions, and read-set extraction need a narrow v1 line.
- **C2 - Cursor pagination needs to become concrete. [Medium]** `skip(n)` is
  correctly flagged as a footgun, but large reference apps need a chosen cursor
  shape.
- **C3 - Handler dependency bundling cannot remain open too long. [Medium]**
  Agents will write helper functions immediately; codegen must bundle or reject.

## Suggestions

- Define the first analyzable query subset with LLP 0008 rather than letting API
  and sync infer different boundaries.
- Make exact decimal and id encoding early decisions because they affect client
  types and storage.

## Open questions

- Which API operations are v1 syncable, online-only, or unsupported?
- What is the minimum doctor command that proves a query's plan and permission
  result?

## Recommended next step

Keep `Draft`. Promote the first query subset, cursor shape, and handler bundle
contract into a narrower implementation spec once the local smoke app starts.
