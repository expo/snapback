# Guide gap: vector and semantic-search capability row

**Status:** Open
**Area:** Guide, Capability index, Vector storage, Semantic retrieval
**Found by:** LLP 0102 Research Room/Snapback deep-round arm
**Date:** 2026-07-29
**Governing:** LLP 0007, LLP 0019, LLP 0061, LLP 0102

## Problem

The Research Room bakeoff classified semantic retrieval as an explicit product
GAP because Snapback has no ordinary vector type, ANN index, or semantic-search
path. The Guide's capability index promises to enumerate author-facing
capabilities and explicit GAPs, but it contains no vector/semantic-search row.

A builder can otherwise mistake application-authored JSON embeddings and
in-memory similarity code for a shipped, indexed, portable backend capability.
LLP 0019 already records this as an unmade product decision and separates
portable vector storage/retrieval from outbound embedding generation.

## Suggested resolution

- Add an owned, dated `backend.vector-search` GAP row to
  `guide/capabilities.md`.
- Link LLP 0019 and LLP 0007 and say plainly that no target currently ships the
  capability.
- Keep the Guide-only discoverability repair separate from the product
  decision about vector type, index semantics, portability, and retrieval API.
- Do not present JSON fields, full-table scans, or application-local similarity
  calculations as a product witness.

## Evidence

- `demos/backend-bakeoff/arms/research-room/snapback/run-capsule.v1.json`
  (`RESEARCH-05-SEMANTIC`)
- `demos/backend-bakeoff/arms/research-room/snapback/receipts/evidence-audit.md`
- `llp/0019-agentic-readiness.research.md` §F7

## Acceptance

- `guide/capabilities.md` contains an explicit vector/semantic-search GAP row
  with maturity, owner, review date, authorities, and this filing pointer;
- Guide search for “vector,” “semantic search,” “embeddings,” or “RAG” reaches
  the row;
- the row makes the current product nonclaim explicit and is covered by the
  Guide checker; and
- product design and implementation remain separately tracked rather than
  being implied by the Guide-only resolution.
