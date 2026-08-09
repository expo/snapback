# Stored-field `v.object({...})` silently degrades to untyped Json (no refusal, no diagnostic)

**Status:** Open
**Severity:** P2 (schema-fidelity honesty defect; contradicts the guide and the documented closed-map behavior)
**Systems:** Codegen, Schema, Guide, Diagnostics
**Date:** 2026-08-09
**Related:** LLP 0115 (CV-4b), LLP 0211 (typed structured stored values — the
admit path), LLP 0131 (position grammar), guide getting-started page

## Problem

Found during the LLP 0211 adjudication (codex gpt-5.6-sol review,
verified against main): in `packages/snapback-codegen/index.mjs`,
`validateAuthoringValidator`'s closed (schema-field) primitive map contains
`['object', new Set(['Json'])]`, so `v.object({...})` at a stored-field
position is **accepted**, its children are recursively validated at
authoring time, and manifest emission then writes only
`field_type: Json` — the nested shape is erased. Row codegen projects the
field as `unknown`, the server sees an ordinary Json column, and no
write-time shape validation exists. There is no diagnostic anywhere in the
path.

Meanwhile:

- `v.array` at the same position gets a fail-closed refusal with a
  teaching hint (`table fields have no array node; store the field as
  v.json() ...`);
- the guide's first-backend page states table fields cannot use
  `v.array(...)` or `v.object(...)` directly and prescribes the
  `v.json()` + result-contract pairing;
- LLP 0115 §CV-4 describes the closed primitive map as the sole
  enforcement rejecting structured validators at stored-field boundaries.

So an author who writes `v.object` on a table field gets behavior
identical to `v.json()` while believing they declared a validated shape —
a silent honesty gap of exactly the class the platform's fail-closed
posture exists to prevent.

## Ask

Short term (independent of CV-4b's direction): make stored-position
`v.object` **refuse fail-closed** with the same teaching hint as
`v.array`, and add a regression fixture asserting both refusals plus the
guide claim. Alternatively, if LLP 0211 lands first, route the admit path
through its declared-structured machinery instead — either outcome removes
the silent half-state. Reconcile the guide sentence and the LLP 0115 CV-4
"closed primitive map" description with whichever behavior ships.

## Done when

`v.object` on a stored field either refuses with a named diagnostic or is
admitted as a typed structured value per LLP 0211 — never silently
degraded — with a pinned regression test and the guide/capability index
telling the truth about it.
