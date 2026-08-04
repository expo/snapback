# Guide gap: P2 materialization retention and durable registration

**Date:** 2026-08-03  
**Status:** Open  
**Area:** Snapback guide — offline retention, generated artifacts, headless client

## Problem

The P1 proof issuer and P2 client hydration bridge now support an
owner-scoped generated relational query establishing qmk1 custody and rendering
an authoritative retained result from a new client while the backend is
unreachable. The guide does not explain that path. `guide/sync/offline-and-retention.md`
still describes protected JS retention as unproven/Contract-only, and its
authorities/examples predate LLP 0157/0166 and the P1/P2 acceptance evidence.

While building `demos/triage-graph`, the guide could not answer:

- how and when to run `composition-activation-prepare`, then regenerate and
  launch the exact trusted activation;
- which generated composition profiles are retainable (owner-scoped
  relational) versus deliberately volatile (snapshot batch);
- how the LLP 0166 D4 answer classes control offline rendering;
- how proof custody, authorized leases, and generated references participate
  in P2 establishment and relaunch;
- how an app creates a durable programmatic registration. OQ8 intentionally
  has no public authoring surface, but the guide does not name that boundary or
  a supported alternative;
- how to inspect stored volatile grace payloads separately from rows that are
  authorized to render offline.

## Proposed guide change

- Revise the JS/React retention section to describe the P1/P2 materialization
  bridge with precise evidence scope and no broader capability claim.
- Add a controlled local-target recipe covering generated activation,
  sessions, `persistResume`, the relational retention declaration, server
  stop, fresh-client relaunch, and `answerClass`/`freshness` checks.
- Include the LLP 0166 D4 renderability table or a concise equivalent.
- State explicitly that snapshot-batch retention is `none` and that stored
  grace payloads are not thereby authoritative offline answers.
- State the OQ8 public API boundary: active registrations are automatic;
  durable programmatic authoring is not yet public. Do not teach underscored
  methods as product API.
- Add the local persistent-store/materialization seam to the capability index
  at its accurately evidenced maturity, preserving existing GAPs.

## Evidence

- `demos/triage-graph/`
- `tests/acceptance/triage-graph-move1-v1.mjs`
- `tests/acceptance/fixtures/triage-graph/move1-exit.2026-08-03.v1.json`
- `diaries/0054-triage-graph-successor.diary.md`
- LLP 0157 and LLP 0166

## Resolution (2026-08-04)

`guide/sync/offline-and-retention.md` gains "Render retained rows
proof-validated after relaunch (the materialization bridge)": precise
evidence scope (local/Node/file carrier, receipt 15 PASS / 2 GAP with
publication-gated GAPs named), the retainable-vs-volatile split
(owner-scoped relational vs snapshot-batch `none` + grace payloads are
not answers), the controlled recipe (activation-prepare → sessions +
persistResume → server stop → fresh-client relaunch) with
transcluded-verified snippets from the proof-run carrier-exit harness,
the LLP 0166 §D4 answer-class render table, and the OQ8 boundary stated
(automatic registration is the product surface; underscored durable
seams are not taught). Capability index gains
`sync.local-persistent-store` (partial, GAP row preserved). Guide check
green (54 pages, 160 snippets).
