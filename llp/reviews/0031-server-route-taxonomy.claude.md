# Review: LLP 0031 - Server route taxonomy and authority boundary

**Reviewer family:** Claude (Opus 4.8, 1M context)
**Provider / runtime:** claude-code, fresh session (did not author the current revision's prose in a different family — see independence note)
**Date:** 2026-07-01
**Redacted:** No — reviewed local repository files only (the LLP corpus plus `src/server.rs`, `src/admin.rs`, `src/ephemeral.rs`, `src/local.rs`, `src/manifest.rs`, `demos/_kit/client.mjs`, and the demo acceptance tests); no external provider was invoked.
**Method:** Requested as `/llp-review 0030 and 0031 — full review loop, then revise both and settle the open decisions`. Read the full 0031 draft and the existing GPT-5 review, plus related coverage (LLP 0013, 0017, 0024, 0030). Verified every route/handler/permission claim through three code-verification sub-agents and pressure-tested the five candidate decisions through two adversarial Claude review passes before writing them into the spec.

> **Independence note.** LLP 0031's author line is "Charlie Cheever / Claude," and this is a **Claude-family** pass — the *same* family as the draft author. It is therefore **not** the independent cross-family review the LLP 0005 loop needs. The GPT-5 review already in this directory remains 0031's one independent pass, and it predates the five decisions settled here. This artifact records the within-family critical pass that settled (and in one case corrected) the open classifications, together with the sub-agent findings that drove the revision. A fresh non-Claude review of the *revised* spec is the outstanding review debt, and the revised Status/Revised notes say so.

## Overall assessment

The taxonomy invariant is sound and the spec was ready to have its five open classifications settled. Verification confirmed the draft's factual claims — the ungated root `/admin/*` aliases, the missing gated write twins, and the byte-identical publish/delete authorization all check out. Four of the five decisions were defensible as the author framed them; adversarial review corrected the fifth (collections) and sharpened three others rather than overturning the design. The spec is now internally consistent and drives a concrete registry implementation; its remaining debt is a cross-family review of the revised text, not more within-family iteration.

## Strengths

- **Operation-not-URL invariant is the right unit and is code-grounded.** The WS `EphemeralDelete` message (`src/server.rs:520-532`) routes into the same `delete_ephemeral` → `EphemeralStore::delete` as the HTTP route, and both gate on the byte-identical `ensure_authorized(&collection.publish, …)` that `publish` uses (`src/ephemeral.rs:783` vs `:715`). The invariant's insistence that a multiplexed socket operation is classified in its own right is exactly what makes D1 defensible.
- **Migration order is correct.** Add gated writes first, repoint callers, then retire aliases — so demos and tests never break mid-migration.
- **Honest about what the registry cannot do.** Enforcement now concedes that a route-level registry sees neither WebSocket message kinds nor field-level content trims, and specifies the two extra tests that close those gaps.

## Concerns (all applied in this revision unless noted)

- **C1 — Decision 4 classified a structural write as app-data. [Medium] [Applied]** `/ephemeral/collections` (register, `src/ephemeral.rs:612-615`) is an unconditional `self.collections.insert(...)` that overwrites a collection's definition including its `publish`/`subscribe` `AccessPolicy` — a privilege-downgrade vector (`RequireRoomPermission` → `AllowAll`). It has **no caller** (`client.mjs` wraps only `/ephemeral/collections/ensure`), and its definitions already ride in each app's `schema.manifest.json` (`ephemeralCollections`, loaded via `replace_collections`). Its validate-only sibling `ensure_collections` (`:638-693`) mutates nothing and is what the demo actually boots with. Split the decision: `ensure` = app-data at root; `register` = system, retire (dead) or gate. Written in as D4, with separate route-table rows.
- **C2 — D3's content trim is invisible to the route registry and its field list was too flat. [Medium] [Applied]** `appId`/`inputsHash` exist twice (nested under both `schema.*` and `functions.*`), and 0030 attach reads `functions.appId`/`functions.inputsHash`/top-level `targetProfileId` specifically, so a flat trim would break attach; separately, demo acceptance tests read operational counters (`ephemeral.*`, `liveDelivery.*`, `storage.version`) off the public read. Added a dedicated field-level test (separate from the registry), pinned the keep-set to 0030's exact nested facts, and recorded the "how far to shrink" question as still-open rather than silently trimming the counters.
- **C3 — D1/D4 contradicted 0030's proxy validation. [Medium] [Applied]** 0030 listed `/ephemeral/delete` and `/ephemeral/collections/ensure` among routes the proxy must refuse; once app-data they must be forwarded. Enumerated the exact deltas in *Impact on LLP 0030* and applied them to 0030 itself.
- **C4 — D1's "cleanup is the gated twin" was a category error. [Low-Medium] [Applied]** `cleanup_expired` (`src/ephemeral.rs:878-884`) sweeps only TTL-expired entries; `delete` removes a caller-named key regardless of expiry. LLP 0017's admin "delete a specific entry" is a separate, still-unbuilt capability gap. Dropped the twin claim and folded the ownership asterisk (publish-scope, not own-entry; `owner_connections` exists but `delete` ignores it) into the D1 note.
- **C5 — Two enforcement gaps. [Low] [Applied]** (a) WS dispatch is a serde-tagged `match` the router cannot see; added a message-kind assertion against the registry. (b) LLP 0024 folds seed into `app.reset`, so D5 is three writes, not four; reconciled the migration plan and route table.

## Suggestions

- State the D2+D3 synergy explicitly (done): gating disconnect and trimming the connection list from public `/inspect` are jointly necessary to close the enumerate-and-disconnect hole; neither alone suffices.
- When implementing, make the public `/inspect` a typed projection of `InspectState` so a newly-added sensitive field is a compile error at the projection rather than a silent leak.

## Open questions

Carried into the spec's Open questions: own-entry delete hardening sequencing relative to the proxy switch (D1); how far to shrink public `/inspect` (D3); retire-vs-gate for the register route (D4); and static-console gating on non-loopback binds (from the GPT-5 review).

## Recommended next step

Proposed only; this review does not change `**Status:**`.

Keep 0031 in **Draft**. The five classifications are settled and the spec drives the registry implementation, but the one independent pass (GPT-5) predates these decisions — so the highest-value next input is a fresh **cross-family** review of the revised spec, especially the enforcement-test design (route registry + WS message-kind assertion + field-level inspect projection) that LLP 0030's "safe by construction" future depends on. The author owns the sequencing call in Open questions and any `Status` change.
