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
reviewed: 2026-08-03
reviewed-commit: f9ae0083ef41bfc9d07f033da440f96048919613
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
| `authorities` | yes | Repo paths (LLPs and code) this page derives from. Freshness compares these against `reviewed-commit`. |
| `examples` | yes | Demo directories/files that exercise what the page teaches (`[]` if none). |
| `status` | yes | `draft` \| `current` \| `deprecated` — authored lifecycle. |
| `targets` | yes | `[local]`, `[local, cloudflare]`, or `[all]` for genuinely target-independent material. Local-only pages render a banner line (see below). |
| `maturity` | yes | `shipped` \| `partial` \| `design-only`, consistent with the capability index. |
| `reviewed` | yes | Date of the last intentional review — display metadata only. |
| `reviewed-commit` | yes | The commit the page was last reviewed at — the freshness **identity**. Bumping it is a deliberate act in a review pass; no tool regenerates it. `HEAD` is permitted only in the same change that creates or fully revises the page. |

`targets:` and `maturity:` are the honesty boundary made mechanical
(LLP 0060's posture): a page must never generalize a local-target guarantee
into a hosted claim. A `maturity: partial` page names what works and what
doesn't. `design-only` material may appear only inside an explicitly marked
**Design reference** section, never as a technique. Auth pages teach only
behavior witnessed by an acceptance test or the server's own
capability/inspect reporting.

### Banner

Pages with `targets: [local]` start the body with:

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](./auth/targets.md).

## Headings

Intent-first: name sections for what the reader wants to do ("Subscribe to a
query", "Scope a query to the signed-in user"), not for internal subsystem
names, so grep-by-goal works. Where a page covers an enumerable surface, it
lists **all** of it — sampling is how capabilities go undiscovered. Each
teaching page ends with an **Anti-patterns** section naming what not to
hand-roll.

## Links

Two classes, checked:

- **Corpus-internal links** are relative paths within `guide/`
  (`../realtime/live-queries.md`). They must resolve.
- **Out-of-corpus references** — `authorities:`, `examples:`, and inline
  bridges into `llp/`, `demos/`, `src/`, etc. — use repo-root paths in
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
naming an owner and a review date. The authored
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

The same command emits [`guide-flat.generated.md`](./guide-flat.generated.md):
the capability index first, then every page exactly once in manifest nav
order. Its SHA-256 is the manifest's `contentHash`. The guide checker rejects
either generated file when stale. At server compile time, `build.rs` restamps
the embedded manifest's `buildIdentity.commit` to the exact binary build; the
checked source manifest remains the corpus-generation record.

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

Warning-only, but sound: the checker reports pages whose `authorities:`
changed between `reviewed-commit` and `HEAD` (via `git diff`). Dates are
never identity. Expired GAP review dates and check failures gate; drift
warnings don't (LLP 0061 §Design 3).
