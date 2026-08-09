# guide: flat projection has outgrown its one-request reading premise

**Status:** Closed
**Impact:** 3
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Systems:** Guide, Documentation, Developer experience
**Date:** 2026-08-06
**Related:** LLP 0061 (owner — guide distribution and projections), LLP 0186
(W2 `/llms.txt` depends on a servable projection), LLP 0187 (OQ4 raised
this; filed per its "ticket regardless" disposition)

## Summary

`guide/guide-flat.generated.md` measures 718,436 bytes / 13,948 lines
(2026-08-06). LLP 0061 justified the flat projection as a one-request
rendering of the whole authoring surface when the corpus was ~130 KB; at
5.5x that size the single-request channel is quietly broken for
context-limited agents, and LLP 0186's planned `/llms.txt` cannot honestly
point at it as "read this in one request."

## Ask

LLP 0061 (the owning document) needs a disposition: diet the flat
projection, tier it (index + per-section flats), or re-scope the
one-request claim to the capability index + surface map (which do have
enforced budgets: 40 KiB / 16 KiB). LLP 0186 W2's `/llms.txt` consumes
whichever projection lands; LLP 0187 OQ4 records the analysis.

## Resolution

**Resolved:** 2026-08-09

Implemented the program orchestrator's tiering disposition and recorded it as
an LLP 0061 amendment with this ticket, LLP 0187 OQ4, and the 2026-08-09
orchestrator disposition as provenance.

- The honest one-request entry tier is the capability index plus surface map.
  The disposition's 40 KiB capability-budget figure had already advanced to an
  enforced 51 KiB as capability rows landed, so current discovery copy says
  “about 50 KiB”; the surface map remains about 12 KiB under its 16 KiB budget.
- `generate-guide-manifest.mjs` now emits and the guide/inventory checks validate
  13 per-section `guide-flat.<section>.generated.md` projections, including
  manifest path, served path, MCP URI, byte count, and SHA-256 records. Obsolete
  section projections are removed by generation and rejected by checking.
- `build.rs` embeds and registers the section flats. HTTP serves them through
  the build-bound Guide route with the shared hash/build headers; MCP exposes
  them with the same identity metadata.
- `/llms.txt`, the Guide index/conventions, README, native Guide command,
  instance home, MCP descriptions, and generated-app pointers recommend the
  tiers and label the whole-corpus flat as a roughly 2.5 MiB bulk export.

Verification completed: `node scripts/check-guide.mjs` passed (115 pages,
1,193 snippets, 146 routes + 46 host ops; freshness warnings only),
`node scripts/check-inventories.mjs` passed, and `./ref-check --verbose` passed.
The required Ibex bootstrap/link/launch/handler-VM qualification passed. Guide
MCP integration passed 1/1, embedded Guide registry unit coverage passed 1/1,
Guide MCP unit coverage passed 4/4, and the in-process served-guide coverage
passed 6/6. The suite's additional black-box socket witness was run but cannot
bind `127.0.0.1:0` in this sandbox (`Operation not permitted`); its failure is
environmental and occurs before any guide assertion.
