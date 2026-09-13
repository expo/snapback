---
title: Guide conventions
id: meta.conventions
order: 90
audience: agent-first
capabilities: []
authorities: [llp/0061-agent-first-snapback-guide.rfc.md]
examples: []
status: current
targets: [all]
maturity: shipped
authoring-profiles: []
reviewed: 2026-08-25
reviewed-authorities-digest: sha256:636aab1ee1ab3ffe0712f132f100f289ddd4c3ccae1af57e168e6a1af68d6b82
---

# Guide conventions

<!-- @ref LLP 0061#design — the corpus rules this file operationalizes -->

These are the rules every page under `guide/` follows. They are adapted from
the Exact guide's conventions (Exact LLP 0365 §1) as a **compatible core plus
Snapback extensions**, so an agent that has used either guide can navigate
the other. `scripts/check-guide.mjs` enforces the mechanical parts.

## Frontmatter

Every `.md` file under `guide/` opens with YAML frontmatter using the **flat
subset only**: `key: value` scalars and inline arrays (`key: [a, b]`). No
nested maps, no block sequences — the checker parses exactly this subset.

Fields (schema: [`frontmatter.schema.json`](./frontmatter.schema.json)):

| Field | Required | Meaning |
| --- | --- | --- |
| `title` | yes | Human title. |
| `id` | yes | Stable dotted id (`clients.contract-adapter`). Used by nav, links, the capability index, and reserved as the resource id for later projections (MCP, console). Never renamed casually. |
| `order` | yes | Deterministic ordering within the section. |
| `audience` | yes | `agent-first`. |
| `capabilities` | yes | Capability-index ids this page claims coverage of (`[]` for meta pages). |
| `authorities` | yes | Repo paths (LLPs and code) this page derives from. Freshness hashes these paths and their bytes. |
| `examples` | yes | Demo directories/files that exercise what the page teaches (`[]` if none). |
| `status` | yes | `draft` \| `current` \| `deprecated` — authored lifecycle. |
| `targets` | yes | `[local]`, `[local, cloudflare]`, or `[all]` for genuinely target-independent material. Local-only pages render a banner line (see below). |
| `maturity` | yes | `shipped` \| `partial` \| `design-only`, consistent with the capability index. |
| `authoring-profiles` | yes for new or materially edited authored pages | `[explicit]`, `[familiar]`, `[explicit, familiar]`, or `[]` for profile-neutral material. Unchanged legacy pages use the content-bound migration inventory below. |
| `since` | no | Published closure version (`X.Y.Z`) in which the page's described surface first became, or is expected to become, available. |
| `unreleased` | no | The boolean `true` when the whole page deliberately describes a surface newer than the newest published closure; requires `since` and a rendered unreleased banner. |
| `reviewed` | yes | Date of the last intentional review — display metadata only. |
| `reviewed-authorities-digest` | yes | SHA-256 digest of the declared authority bytes at the last intentional review — the freshness **identity**. Refreshing it is a deliberate review act, not ordinary regeneration: `node scripts/migrate-guide-review-digests.mjs --refresh guide/path.md`. |

`targets:` and `maturity:` are the honesty boundary made mechanical
(LLP 0060's posture): a page must never generalize a local-target guarantee
into a hosted claim. A `maturity: partial` page names what works and what
doesn't. `design-only` material may appear only inside an explicitly marked
**Design reference** section, never as a technique. Auth pages teach only
behavior witnessed by an acceptance test or the server's own
capability/inspect reporting.

## Authoring-profile scope

Snapback has two first-class source profiles, Explicit and Familiar. Every new
or materially edited authored Guide page declares which profiles its teaching
actually covers:

- `authoring-profiles: [explicit]` means the page's usable authoring route is
  Explicit. A passing mention of Familiar or a stop sign routing Familiar
  authors elsewhere does not make the page dual-profile.
- `authoring-profiles: [familiar]` means the usable route is Familiar-only.
- `authoring-profiles: [explicit, familiar]` means an author can complete the
  page's promise in either profile. Parallel snippets are not required when the
  spelling is genuinely shared, but the page must state the shared route; a
  common normalized runtime alone is not coverage.
- `authoring-profiles: []` means profile-neutral: the page neither depends on
  nor teaches a source-profile spelling. Client, protocol, deployment, and
  operating material can be neutral when it starts after source normalization.

The generated manifest projects this field as `authoringProfiles`, and the
published HTML metadata renders it as **Explicit only**, **Familiar only**,
**Explicit + Familiar**, or **Profile-neutral**. Scope must be visible to a
reader; it is not an internal lint annotation.

### Content-bound legacy migration

The 2026-08-28 survey of the 100 authored pages found 5 Familiar-covered, 52
Explicit-only, and 43 profile-neutral pages. In particular,
`start/mental-model.md` is Explicit-only: it teaches the Explicit `.mjs`
layout and routes Familiar authors to another page.

This change converts `conventions.md` as the single exemplar. The other 99
authored pages are frozen in
`scripts/guide-authoring-profiles.mjs` by path, surveyed scope, and SHA-256 of
the complete page bytes. The checker uses that surveyed scope for manifest and
site projection only while the bytes still match. Generated
`guide/reference/` API pages remain generator-owned and outside this authored
page inventory; their projection scope is deterministic.

The list shrinks through the ordinary edit path. A material edit to an
inventoried page fails until the editor adds `authoring-profiles` to that page
and removes its inventory row. A declaration that still has an inventory row,
a missing inventoried page, and a new unscoped page also fail. Updating a hash
to extend an exemption or adding a new legacy row is not a migration and is
forbidden. The remaining corpus conversion is tracked in
`issues/shelved/20260828-migrate-guide-authoring-profile-frontmatter.md`.

### Banner

Pages with `targets: [local]` start the body with:

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](./auth/targets.md).

## The published-closure fence

[`published-closure.json`](./published-closure.json) is the checked-in,
machine-readable record of the newest `@expo/snapback-*` closure available
from npm. The guide checker reads that local record; this check performs no
network access. A separate scheduled registry canary
(`scripts/check-published-closure-registry.mjs`) fails when `newestPublished`
is not the identity-preset closure's registry `latest`, so a publish that
skips the record update cannot drift silently.

A page whose whole surface has one version may declare `since: X.Y.Z`. If the
whole page is deliberately ahead of the record's `newestPublished`, it also
declares `unreleased: true` and renders a blockquote whose first line starts
with `> **Unreleased.**` before the first `##` heading. The banner names the
literal newest published version so a reader knows which concrete closure is
missing the surface. Once the closure catches up, the fence is stale and must
be removed (or `since:` must be bumped to the actual future version).

Pages that mix vintages fence the affected section with an HTML comment on its
own line: `<!-- since: X.Y.Z -->` for a surface already present in that
closure, or `<!-- since: X.Y.Z unreleased -->` for a surface expected in a
future closure. An unreleased marker must be immediately followed (apart from
blank lines) by a contiguous rendered blockquote whose first line starts with
`> **Unreleased.**` and whose text names the literal newest published version.
A released marker may not name a version newer than `newestPublished`, and an
unreleased marker may not name that version or an older one.

This is an availability fence, separate from capability maturity. A
`maturity: shipped` page that claims a surface absent from the newest published
closure without an unreleased fence is a check **failure**. The npm promotion
lane updates `published-closure.json` in the same change that publishes a new
closure, regenerates the guide manifest, and sweeps all unreleased fences. The
stale-fence errors make a forgotten promotion-time sweep loud. The registry
canary then fails closed if that git record still lags npm.

## Headings

Intent-first: name sections for what the reader wants to do ("Subscribe to a
query", "Scope a query to the signed-in user"), not for internal subsystem
names, so grep-by-goal works. Where a page covers an enumerable surface, it
lists **all** of it — sampling is how capabilities go undiscovered. Each
teaching page ends with an **Anti-patterns** section naming what not to
hand-roll.

## Routing: paved alternatives, grep vocabulary, vocabulary splits

Added 2026-08-06 from accepted LLP 0187 T1 (the routing-over-coverage
diagnosis; LLP 0061 owns these conventions):

- **Paved alternative at the point of choice.** Anti-pattern content and any
  "hard way" a page teaches (a JS handler where a declarative surface exists,
  a raw subscription where a hook exists) must link the paved alternative at
  the point the reader chooses, with the honest boundary of what the paved
  road cannot express. A worked hard-way example with no adjacent pointer is
  a guide defect, not a style preference.
- **The alias column is grep vocabulary.** Capability-index **Aliases** and
  page headings must include the literal strings an agent would plausibly
  search for: workload terms ("typing indicator", "dashboard") and plausible
  wrong-guess symbol names (`useSnapbackEphemeral`), whichever register they
  come from — including competitor vocabulary (Convex `useQuery`, Supabase
  RLS; LLP 0186 W2). A miss caused by a reasonable grep that returned nothing
  is a guide defect with a mechanical fix: add the string. Do not stuff —
  each alias should be a string someone would actually search.
- **Vocabulary splits are defects.** When a feature's schema side and client
  side use different names (ephemeral collections vs `useSnapbackPresence`),
  each side's page must name the other side's vocabulary. A grep from either
  register must reach the feature.
- **Every replicated miss becomes an eval seed.** When a replicated
  discoverability miss is fixed, the fix must add a seed case to
  [the retrieval eval](./retrieval-eval.md) that would have caught it
  (LLP 0187 T7's standing rule), so the fix cannot silently regress.

## Links

Two classes, checked:

- **Corpus-internal links** are relative paths within `guide/`
  (`../realtime/live-queries.md`). They must resolve. A `file.md#anchor`
  fragment must resolve to an actual heading or explicit anchor using the same
  slug identity as the rendered docs site.
- **Out-of-corpus references** — `authorities:`, `examples:`, and inline
  bridges into `llp/`, `demos/`, `crates/snapback/src/`, etc. — use repo-root paths in
  frontmatter and the `repo:` scheme inline
  (`[LLP 0008](repo:llp/0008-local-first-sync-and-realtime.rfc.md)`). They
  must exist in the repo.
- **Cross-repository references** use the shared
  `repo(<repository>):<repo-root-relative-path>` form, for example
  `[the Exact guide](repo(exact):guide/index.md)`. The repository token is
  lowercase ASCII (`[a-z0-9._-]+`); the path is relative, contains no `..`,
  and may carry a heading anchor. When a sibling checkout is present the
  checker verifies the path; without one it degrades honestly rather than
  claiming the remote bytes were checked. Exact uses the same convention and
  points its `data.snapback` external-authority row back to this guide.

When a diagnostic appears on several pages, put
`<!-- diagnostic-primary: SNAPBACK_CODE -->` immediately below its canonical
teaching heading. The generated diagnostics registry keeps that heading first
even when a compact start packet also names the failure class.

## Code snippets

Every fenced `js` / `mjs` / `ts` / `tsx` / `json` / `contract` block carries
a declared class in its info string; the checker fails on unclassified
fences in those languages.

- **Transcluded-verified (the default):**
  <code>```js source=demos/todo/tests/acceptance/headless.mjs</code>
  The fence body must be an exact contiguous excerpt of the named file,
  copied byte-exact **including leading indentation** — the checker matches
  it as a literal substring of the source; only trailing whitespace is
  normalized. The named file must be exercised by CI — a demo acceptance
  suite, package test, or proof script. Drift in the source breaks the
  check, which is the point: the snippet's "this ran" property is inherited
  from CI, and behavioral drift becomes structural breakage. Update the page
  in the same change that changes the source.
- **Fragment:** <code>```js fragment reason="mid-file excerpt"</code>
  Not verified; the reason is mandatory so partial code is a tracked class,
  not an escape hatch.
- **Standalone-runnable:** reserved (LLP 0061 §Design 3). The scratch-app
  assembler is built only when a technique no CI-exercised file demonstrates
  needs a snippet; until then the checker rejects the class with a pointer
  to this paragraph. Prefer adding the technique to a demo or fixture and
  transcluding it.

`sh` fences are illustrative commands and exempt from mechanical
verification; keep them real and current. `text`, `yaml`, and diagram fences
are exempt.

**Exact-dependent snippets** (Contract-arm sources): the text match runs
everywhere with no Exact dependency. The *execution* guarantee is inherited
from the suite that runs the source file — Contract-arm suites are gated by
`SNAPBACK_VERIFY_EXACT`, which merge/release CI pins to `1`, so those
sources are always executed before landing even when a local core-only run
skipped them. The manifest records each snippet's source so a consumer can
see which suite carries its guarantee.

## The capability index

[`capabilities.md`](./capabilities.md) is authored, not generated. Shipped
rows carry a **witness** — a route in the declared registry, a host-op id, a
package export, a generated-manifest field, or a CLI command proving the
capability exists in code. Uncovered capabilities are explicit **GAP** rows
naming an owner, a review date, and a live open `issues/` pointer. A missing
pointer or one under `issues/closed/` is a hard consistency error. An expired
review date, or one expiring within seven days, prints a clearly labelled
warning without failing the push-time check. The scheduled drift backstop
files one open owner-routed ticket per expired capability id and does not
duplicate it while that ticket remains open. The authored
[`surface-map.md`](./surface-map.md) carries the mechanically growing route
and host-op classifications under a separate size budget. The checker joins
that map against the repo's declared enumerations — every enumerated entry
maps to a capability id or a `notAuthorFacing` classification.

## The manifest

[`guide-manifest.generated.json`](./guide-manifest.generated.json) is
generated by `scripts/generate-guide-manifest.mjs` — nav tree, per-page
frontmatter, content hashes, capability join, per-snippet status, and the
build identity the corpus was verified against. Never hand-edit it; every
later projection (MCP, admin console, CLI) consumes the manifest rather than
re-parsing the tree.

The same command emits [`guide-flat.generated.md`](./guide-flat.generated.md),
the whole-corpus bulk export (currently about 2.5 MiB), plus one
`guide-flat.<section>.generated.md` projection for every top-level manifest
navigation section. The whole export places the capability index first and
then includes every page exactly once in manifest order; each section export
contains only that section's pages in manifest order. The manifest's
`flatProjections` records their paths, served paths, MCP URIs, byte counts, and
SHA-256 digests. The guide checker rejects the manifest, whole flat, or any
section flat when stale.

For a context-limited one-request read, start with the budgeted entry tier:
[`capabilities.md`](./capabilities.md) (about 50 KiB under its current enforced
budget) plus [`surface-map.md`](./surface-map.md) (about 12 KiB under its 16 KiB
budget). Then choose a section flat or specific page. The whole export remains
available for bulk consumers, but is not the default reading recommendation.
The checked source manifest carries only its content-derived
`buildIdentity.sourceDigest`. The `snapback-guide-embed` leaf removes that
identity when it builds the inert artifact. At serve time, the server
reconstructs `buildIdentity` as exactly the content-derived `sourceDigest` plus
the enclosing binary's runtime-stamped `commit`; HTTP headers and MCP metadata
therefore give every whole or section projection the same guide content hash
and exact carrier commit without making the source record depend on the current
checkout commit.

## Running the checks in a fresh tree

`node scripts/check-guide.mjs` is the docs-only fast path; the local proof
runs the same checks. Snippet verification reads sources on disk, and some
cited sources are gitignored codegen outputs
(`demos/*/snapback/generated/*`), so a fresh checkout or worktree fails
with "snippet source does not exist" — plus a consequent stale-manifest
error — until demo codegen has run. That failure is the checker being
honest, not the corpus being broken. In a fresh tree, run
`bun install --frozen-lockfile`, then `scripts/check-generated-artifacts`
(node-only; regenerates every committed backend and verifies the committed
review manifests), or just the per-demo codegen for the demos the failing
snippets cite, e.g.
`node packages/snapback-codegen/index.mjs demos/todo-v2/snapback`.
For demos whose snippets use streamed or outbound actions (currently
`demos/competitive-checkpoint`), prefix the codegen command with
`SNAPBACK_OUTBOUND_ACTIONS=1` — codegen selects the outbound-actions
capability manifest only when that variable is set, and otherwise fails
with `SNAPBACK_CAPABILITY_UNSUPPORTED` because the base local target does
not declare `bounded_response_stream_v1`.
Regeneration writes only gitignored paths; the tracked tree stays clean.

## Freshness

Warning-only, but sound: the checker hashes each page's current `authorities:`
bytes and reports when they differ from `reviewed-authorities-digest`. Dates
and commit locations are never identity, so an unrelated rebase cannot change
the verdict. GAP review-date expiry is also warning-only and routes through the
scheduled backstop; structural failures, including closed or missing GAP issue
custody, still gate (LLP 0061 §Design 3).
