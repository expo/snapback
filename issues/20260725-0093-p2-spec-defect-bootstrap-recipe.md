# 0093 P-2 spec defect: no documented non-JS path from generated manifests to a serving backend

**Opened:** 2026-07-25
**Source:** LLP 0093 D4 clean-room discipline (P-2 Swift client build,
live-acceptance bootstrap).
**Systems:** Guide, Client SDK, Agent operating surface

The P-2 harness must load the todo demo backend (schema, functions, seed)
into a bare `snapback --memory` server **without** the JS kit. What the
documents provide vs what had to be discovered by probing:

- LLP 0031/0024 name the seams (`POST /_snapback/api/schema/load`,
  `/functions/load`, `/app/reset` with "optional seed") — good. But no
  document states the **body shapes**: schema/functions take the raw
  generated manifest JSON (`demos/*/snapback/generated/*.manifest.json`)
  as the body, and reset takes `{"seed": <seed.json contents>}`. All three
  were discovered by black-box probing (structured diagnostics made this
  tractable — credit where due).
- Admin-token discovery for a headless caller: `--ready-file <path>`
  writes a descriptor whose `adminTokenFile` names a `<ready>.admin-token`
  sidecar. This flow is only learnable from the binary's error message when
  starting without a terminal. Fine ergonomics, undocumented.
- The guide's client pages are JS-kit-shaped (`guide/clients/headless.md`
  documents `ensureApp(...)`), so none of this exists for a non-JS
  implementer. The LLP 0093 v0.8 "minimal-client recipe" deliverable
  (riding the 0074-tranche branch) covers the app-data routes but, per its
  description, not this bootstrap surface.

**Resolution taken (best effort):** `snapback-prove` posts the raw
manifests with `x-snapback-admin-token` from `SNAPBACK_ADMIN_TOKEN(_FILE)`
and seeds via `{"seed": …}`; verified live.

**Fix wanted:** the guide minimal-client recipe (or `guide/testing/`)
gains the three body shapes and the ready-file/admin-token sidecar flow,
so a non-JS acceptance harness can be written from documents alone.
