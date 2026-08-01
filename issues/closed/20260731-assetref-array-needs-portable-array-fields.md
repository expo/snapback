# v.assetRef arrays presuppose portable array table fields that do not exist

**Status:** OPEN — discovered during 0044 L1-03 (2026-07-31)

LLP 0044 (Accepted, v6.1) and LLP 0007's 2026-07-31 dated amendment
freeze `v.array(v.assetRef(...), { maxItems })` as an explicit schema
node. Implementation found the portable field vocabulary admits **no
array table fields of any kind** (`validateAuthoringValidator` has no
array primitive for table fields; LLP 0007 §Data Model lists "array of
portable values" in the *intended* vocabulary, unshipped). Scalar and
`v.optional` placements landed in L1-03; array placements refuse with
the generic unsupported-validator diagnostic.

Resolution needs an author-level call:

1. ship portable array table fields first (its own ticket/LLP scope —
   physical mapping, index semantics, bounded-children interaction), then
   admit `v.array(v.assetRef)` on top; or
2. amend 0044/0007 to defer the array node explicitly (multi-asset
   attachments via child rows — the LLP 0110 bounded-children idiom —
   in the interim).

Until decided, multi-asset use cases (galleries, attachments lists)
should model one row per asset with a scalar `v.assetRef`, which the
reverse-edge and read-authorization machinery already handles.

---

**RESOLVED 2026-07-31 — author decision (Charlie): option 2, amend the
docs.** The bounded-array node is withdrawn from LLP 0044 §Typed
references and LLP 0007's companion amendment (dated notes in both);
multi-asset relationships take the child-row / bounded-children paved
path, which Party Wall validated end to end and the reverse-edge,
sharing, and GC machinery already serve. If portable array fields ship
platform-wide later, admitting an assetRef element type is additive.
