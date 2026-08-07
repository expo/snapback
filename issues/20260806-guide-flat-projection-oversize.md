# guide: flat projection has outgrown its one-request reading premise

**Status:** Open
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
