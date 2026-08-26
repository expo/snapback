# LLP 0195 execution: staged docs-site generator (public publication author-gated)

**Status:** Open — D1 LIVE; D3 IN-REPO COMPLETE 2026-08-10; D2 + D3 REDEPLOY EXTERNALLY OWNED
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 3
**Systems:** Documentation, Publishing, Guide
**Date:** 2026-08-08
**Related:** LLP 0195 (governing RFC, Review at r8/r9; D1-D4 are
author decisions), LLP 0198 P2 (author-gated orientation phase)

Build the docs-site generator from guide/ bound to a qualified
published closure/content digest (not HEAD), with `/llms.txt` and the
LLP 0194 reference projection join once that lane lands. STAGING ONLY:
nothing publishes publicly — D1 (publish at all / where), D2
(licensing), D3 (snapshots), D4 (benchmarks on site) are Charlie's
decisions and get surfaced with the staged result. Output: a
generator + staged artifact + a decision memo for D1-D4.


## Triage (2026-08-26 leftover sweep)

Still open for D2/D3 current-closure. LLP 0195 is Accepted. D1 is live (`website/` → snapback.expo.app). In-repo D3 snapshots exist at `website/public/v/0.1.19/` + `/latest/` aliases; `guide/published-closure.json` is **0.1.27**, so the snapshot lags. No `snapback-examples` repo. `snapback feedback` is designed (LLP 0193) but not in `packages/snapback-cli`.

## D1–D4 author decision memo

No decision below is taken by this execution. The recommendations describe
the next move if Charlie chooses to publish; the staged artifact remains local
and gitignored.

### D1 — Whether and where to publish

- **Decision:** OPEN — author approval is required both to publish at all and
  to select the public origin.
- **Options:** keep the surface private; publish only the generated projection
  at a dedicated docs origin such as `docs.snapback.dev`; publish it under a
  product-site path such as `snapback.dev/docs`; or make repository visibility
  part of the same decision and use a repository-backed host.
- **What staging demonstrates:** `docs-site-dist/` is hosting-neutral static
  output with no external network assets. It carries root-relative stable
  routes, `/llms.txt`, and `/site-manifest.json`; nothing in the artifact
  chooses a host or performs a deployment.
- **Recommendation:** publish the generated projection at
  `docs.snapback.dev`, leaving repository visibility as a separate decision.
  A dedicated origin gives crawlers and pre-install agents one canonical
  address, while the content/digest binding keeps hosting from becoming a
  second documentation authority.

### D2 — Example licensing and repository location

- **Decision:** OPEN — no example projection was created and no license was
  assigned by this lane.
- **Options:** do not redistribute examples; publish a generated examples
  repository under MIT; use a dual permissive code license such as
  MIT/Apache-2.0; or keep examples alongside the docs projection with an
  explicit code-vs-prose license boundary.
- **What staging demonstrates:** the docs site can link a future example
  projection without copying repository-only authorities into public links,
  but it intentionally includes no examples repository and makes no licensing
  claim.
- **Recommendation:** use MIT for generated example code, with explicit
  provenance/NOTICE metadata and one separately generated
  `snapback-examples` repository. This matches Snapback's MIT-eyes-open posture,
  avoids treating code as prose under a content license, and preserves LLP
  0195's single-owner/regenerate rule.

### D3 — Snapshot policy

- **Decision:** OPEN — latest-only versus retained release snapshots remains
  the author's choice.
- **Options:** one mutable latest site; immutable per-release snapshots; or a
  hybrid with immutable `/v/<closure>/` paths plus a `/latest/` alias.
- **What staging demonstrates:** the artifact is reproducibly bound to
  published closure `0.1.15` and Guide content digest
  `sha256:9b06c4888b01b14a679007c4da15350607fd7312f7d2c7be41d1f20186ea2d8c`,
  not to repository HEAD. Nine current page/section `since:` fences render as
  version labels. The renderer also has a distinct unreleased treatment, and
  the build-bound LLP 0194 reference pages say explicitly that symbol presence
  is not itself a package-publication claim. This is the fence treatment LLP
  0194 OQ4 requires while D3 remains open.
- **Recommendation:** immutable per-release snapshots at `/v/<closure>/` with
  `/latest/` as an alias to the newest admitted snapshot. Stable symbol anchors
  then remain citable across releases, and a moving default does not erase the
  closure identity behind an old answer.

### D4 — Benchmark artifacts on the docs site

- **Decision:** OPEN — this lane does not admit `benchmarks/` to the staged
  site.
- **Options:** exclude benchmarks entirely; publish them at an alternate public
  evidence origin; or add a clearly separated `/benchmarks/` projection after
  LLP 0197's standard is satisfied.
- **What staging demonstrates:** the Guide, capability index, and generated API
  reference compose without benchmark content. There is therefore no accidental
  comparative claim in the staged site.
- **Recommendation:** exclude benchmarks from the first publication. Admit a
  `/benchmarks/` projection only after LLP 0197's N>=3 calibration,
  equal-proof-bar, mandatory machine-record, redaction, receipt, and checked
  publisher requirements pass. LLP 0197 rule 3 depends on this D4 decision: if
  D4 remains “not on the docs site,” name an alternate public harness/record
  home before publishing any comparison.

## Execution log — 2026-08-08

Built `scripts/generate-docs-site.mjs` and ignored its staged output at
`docs-site-dist/`. The dependency-free generator renders all 106 manifest
pages (intent Guide, capability index, and LLP 0194 reference projection),
bundles local CSS/SVG/JSON only, preserves and checks all 847 stable symbol
anchors, emits `/llms.txt`, and writes a file-inventoried
`/site-manifest.json`. The manifest records `publicationStatus` as
`staged-only-author-decision-required`, binds closure `0.1.15` plus the Guide
content digest above, exposes `newestQualified: 0.1.7` separately, and records
`headBinding: none`. The generated site content digest is
`sha256:61773e924d443e83c0b71de6fa0e5d960e83eb3a21c2c62f61539ea30fe555b5`.

Checks and observations:

- `volta run --node 24.18.0 node scripts/generate-docs-site.mjs --check` —
  **PASS**. Two independent in-memory builds produced identical membership,
  bytes, and digest; 14,906 emitted internal links/assets resolved and all 847
  reference identities had their exact anchors.
- `volta run --node 24.18.0 node scripts/check-guide.mjs` — **PASS** after the
  documented fresh-worktree setup. Final result: 106 pages, 1,092 snippets,
  122 routes + 43 host operations joined, 62 warning-only authority-drift
  notices, zero errors. The first run failed because ignored demo/Contract
  codegen products and the local dependency tree were absent; root
  `bun install --frozen-lockfile` plus
  `scripts/check-generated-artifacts` supplied those local prerequisites. A
  separate demo-local install attempt could not use the sandbox network, but
  was unnecessary once the canonical codegen step produced the cited files.
- `volta run --node 24.18.0 scripts/check-generated-artifacts` — **PASS**;
  tracked generated projections remained unchanged.
- `volta run --node 24.18.0 node --check scripts/generate-docs-site.mjs` —
  **PASS**.
- `./ref-check --verbose` — **PASS**: 199 LLP documents, 4,147 refs in 11,272
  files, zero errors and zero unchecked refs.
- `node scripts/check-inventories.mjs` — **not run / not applicable** because
  this lane added no test file, metadata-declared demo, or tracked generated
  publication leaf; `docs-site-dist/` is deliberately ignored.
- `node scripts/generate-docs-site.mjs --serve --port 0` — the build completed,
  then the sandbox denied the loopback bind. The generator printed the exact
  orchestrator fallback and skipped the preview without publishing:
  `node scripts/generate-docs-site.mjs --serve --port 4173`.

No deployment, public write, license change, snapshot-policy decision, or
benchmark publication occurred. Remaining work is the D1–D4 author decision
set, selection/configuration of a deploy target if D1 is yes, and one
orchestrator-side preview using the command above before any later authorized
publication step.

## Author ruling — 2026-08-08

D1: PUBLISH — "will publish soon" (Charlie, in session). Timing is
author-held; the staged artifact and generator are ready. D2 (example
licensing), D3 (snapshot policy), D4 (benchmarks on site) were not
explicitly ruled this turn — the memo's recommendations stand as
proposals and need explicit confirmation before or at first deploy.

## Author rulings — 2026-08-08 (Charlie Cheever, "publish everything")

- **D1 — RULED: publish.** The generated projection publishes at a
  dedicated docs origin (`docs.snapback.dev` per the recommendation;
  interim hosting URL acceptable until DNS lands). Repository
  visibility remains a separate, unruled decision.
- **D2 — RULED: MIT** for generated example code with provenance/NOTICE
  metadata and one separately generated `snapback-examples` repository,
  per the recommendation.
- **D3 — RULED: immutable per-release snapshots** at `/v/<closure>/`
  with `/latest/` as an alias, per the recommendation.
- **D4 — RULED: benchmarks excluded from first publication**, admitted
  as a `/benchmarks/` projection only when LLP 0197's requirements
  pass (the author's "publish everything" is read against the memo's
  own recommendation and 0197's standard — publishing a comparison
  before its published gates pass would violate the standard the site
  itself documents).

## Publication execution — 2026-08-08 (post-ruling)

Deployed per D1: Cloudflare Pages project `snapback-docs`, live at
<https://snapback-docs.pages.dev> (all routes verified 200; llms.txt,
capability index, reference projection, site-manifest). Site content
digest `sha256:fc802536dab0…` (regenerated with publicationStatus
`published-d1-ruled-2026-08-08`), bound to closure 0.1.15 + Guide
digest 8f37f0a5…. Remaining: wire `docs.snapback.dev` — the stored
Cloudflare token lacks Zone:Read (zones list empty), so the custom
domain needs an author-minted token with Zone+Pages scope or
confirmation of where the domain lives. D2 (examples repo), D3
(snapshot paths /v/<closure>/), and the D4 benchmarks gate remain
follow-ons.

## Origin change + EAS Hosting migration — 2026-08-08 (author direction)

Author directed same-day: publish at **https://snapback.expo.app** on
EAS Hosting instead of Cloudflare Pages/docs.snapback.dev. Executed:
`website/` (in-repo Expo Router site) with `/` placeholder product
page, `/guide/` = the docs projection (links rebased), `/docs/` →
redirect, root `/llms.txt`; deployed via `eas deploy --prod` (project
@ccheever/snapback, id d6c81653); all routes verified 200. The
`snapback-docs.pages.dev` Pages project was **deleted**. D1's origin is
therefore ruled-and-executed as snapback.expo.app; the earlier
docs.snapback.dev recommendation and its Zone-token blocker are moot.
Redeploy recipe: `website/README.md`.

## D3 in-repo execution — 2026-08-10

Implemented the ruled snapshot policy without performing a deployment.
`scripts/generate-docs-site.mjs` now derives the canonical
`/v/<closure>/` route from `guide/published-closure.json`, records the D3
snapshot and `/latest/` alias contract in `site-manifest.json`, emits canonical
page links for a snapshot build, and refuses a versioned `--base` that does not
match the published closure. `website/scripts/assemble-docs.mjs` generates at
that exact base, installs `public/v/<closure>/` once, refuses to change an
existing snapshot's bytes, and refreshes `/latest/` plus the compatibility
`/guide/` route as byte-for-byte aliases. `/docs/`, the product-page guide
link, and root `/llms.txt` now enter through the D3 routing policy.

Local proof on Node 24.18.0:

- `node scripts/generate-docs-site.mjs --check --base /v/0.1.17/` — **PASS**
  (two deterministic builds; 118 pages, 18,555 internal links/assets, 937
  stable anchors).
- `node website/scripts/assemble-docs.mjs --check` — **PASS**. The temporary
  assembly proved exact `/latest/` and `/guide/` aliases and proved that a
  changed same-version snapshot is refused.
- Existing generator checks at `/` and `/guide/` — **PASS**; the version-base
  increment did not regress either supported base.
- `npm run assemble` twice — **PASS** (`installed`, then `reused` for the same
  immutable snapshot); `npm run export` — **PASS**, with the version, latest,
  guide, docs, and root-agent files present in the static Expo output. The
  `deploy` script now runs the D3 check before assembly/export, but was not run.
- `node scripts/check-guide.mjs`, `node scripts/check-inventories.mjs`, and
  `./ref-check --verbose` — **PASS** (the Guide checker retained its 62
  pre-existing warning-only authority-drift notices).

The ticket remains open. The remaining externally owned steps are:

1. **D2:** create the separate MIT-licensed `snapback-examples` repository with
   the ruled provenance/NOTICE and generated-single-owner posture.
2. **D3 publication:** run the real EAS Hosting production redeploy and verify
   `/v/0.1.17/`, `/latest/`, `/guide/`, `/docs/`, and root `/llms.txt` on
   `snapback.expo.app`. No deploy was attempted by this in-repo lane.

D4 remains ruled as a gate, not an unfinished first-publication action:
benchmarks stay excluded until LLP 0197's admission requirements pass.
