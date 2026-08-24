# crud-dashboard start packet script glossary disagrees with its template `package.json`

Status: open
Filed: 2026-08-24
Area: packages/snapback-cli (scaffold templates), guide/start

## Symptom

`node --test packages/snapback-cli/package.test.mjs` throws before any
assertion runs:

```
Error: crud-dashboard start packet script glossary disagrees with package.json
```

Raised by `scripts/template-portfolio-qualification-lib.mjs:116`, which
requires each template's manifest-derived script glossary to match the scripts
its `package.json` actually declares.

## Provenance

Inherited from `main`, not from any branch merging into it. Between merge-base
`941e965ad` and `origin/main`, main changed both halves of the pair:

- `packages/snapback-cli/templates/crud-dashboard/package.json`
- `guide/start/crud-dashboard.md` (the start packet carrying the glossary)

Confirmed on `seth/knockoff-shared-development-auth` while merging `main` in;
that branch touches no crud-dashboard or template path.

## Why it matters beyond itself

The glossary check throws rather than asserting, so it aborts the whole file at
test 1. That masks
[the liveQuery receiver drift](./20260824-crud-dashboard-acceptance-livequery-assertion-drift.md)
at `package.test.mjs:716`, which cannot be observed until this one is fixed.
Fix this first, then re-check that ticket rather than assuming it is resolved.

## Fix

Bring the glossary in `guide/start/crud-dashboard.md` back into agreement with
the scripts in the template `package.json` — whichever side main intended to
move. LLP 0294 §4 governs: every scaffold carries one short script glossary
generated or checked from the manifest.
