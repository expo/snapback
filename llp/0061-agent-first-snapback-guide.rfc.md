# RFC 0061: The Snapback Guide — Agent-First Documentation for Building on Snapback

**Type:** RFC
**Status:** Draft
**Systems:** Docs, Developer experience, Tooling, Client integration, API, Testing
**Author:** Charlie Cheever / Claude Fable 5
**Date:** 2026-07-15
**Revised:** 2026-07-15 (initial draft)
**Related:** LLP 0000 (root), LLP 0004 (application data API), LLP 0005
(Contract/Exact/React integration), LLP 0010 (agent DX and acceptance),
LLP 0012 (headless integration contract), LLP 0013 (ephemeral realtime state),
LLP 0015 (demo application suite), LLP 0016 (diary-driven change program),
LLP 0017 (admin console inspection surface), LLP 0019 (agentic readiness),
LLP 0024 (agent operating surface), LLP 0036 (app secrets and config),
LLP 0042 (agent MCP surface), LLP 0039/0053/0055–0060 (auth program),
Exact LLP 0365 (the agent-first Exact guide — the sibling-repo pattern this
adapts; `~/projects/exact/llp/0365-agent-first-exact-guide.rfc.md`)

## Summary

Create **the Snapback Guide**: a curated tree of markdown documents under
`docs/guide/` that teaches an agent (primarily) and a human (secondarily) how
to build an application **on** Snapback — schema and functions, queries and
mutations, live queries, ephemeral realtime, auth, secrets, the Contract/Exact
adapter, the headless surface, acceptance testing, and deployment — with
verified code for all of it.

This is the Snapback counterpart to **Exact LLP 0365** (the agent-first Exact
guide, Accepted 2026-07-14). It deliberately **adopts 0365's pattern and
conventions while keeping the corpus independent** (§Relationship to the Exact
Guide): the two repos have different authorities, different check ecosystems,
different maturity, and different distribution channels, so sharing the *shape*
— frontmatter schema, link policy, snippet classes, capability index with gap
rows, intent-first headings — buys consistency for agents that work in both
repos, while sharing the *artifact* would couple release cadences for no
reader benefit.

Two things are Snapback-shaped rather than copied:

1. **Snippets are verified against a live server.** Snapback's local target is
   cheap to start (`--memory`, scale-to-zero); guide snippets are executed
   through the same harness the demo acceptance suites use, not merely
   compiled. The guide's trust property is "this ran", one level stronger than
   the Exact guide's "this compiled".
2. **The server is a distribution channel.** Out-of-repo authors talk to a
   running Snapback server, so the guide projects through surfaces Snapback
   already owns — the admin console (LLP 0017) and the MCP surface (LLP 0042)
   — instead of standing up an npm package as the primary out-of-repo channel.

Governance is proportionate to Snapback's stage: an authored capability index
with explicit gap rows and harness-verified snippets from day one; the heavier
0365 machinery (registry inventory joins, review-lock hashes, PR-line policy,
retrieval evals) is named as adopt-on-trigger, not cloned.

## Motivation

### The evidence: agents already build around Snapback's product surface

Snapback's primary consumers today are agents building demo applications
(LLP 0015), and the diary corpus (LLP 0016) is a standing ledger of exactly
the failure the Exact guide calls the Motion incident — shipped surface that
an author could not discover, so they built around it:

- Diary 0010 (All Aboard red-team rerun): connection-state semantics "had no
  React-facing documentation; I had to read the Contract [source]", and the
  same diary weighs "direct `client.mutate` vs generated mutation binding;
  hand-wired handles vs" the product path — an author adjudicating between
  paved road and hand-rolling because nothing taught the paved road.
- ENG-22218 (graffiti-board prerequisites) exists because the demo would
  otherwise use "hand-wired HTTP glue" instead of "product-shaped Snapback
  APIs" — the carrier work shipped, but nothing turned it into teachable
  surface.
- Diary 0008 (All Aboard) records load-bearing behavior that is
  "…and undocumented; if someone adds a dynamic attr to `board-content`, the
  drag…" — working code whose constraints live only in the diary that
  discovered them.

Each new demo re-derives the same knowledge: how to author a backend, run the
server, wire the adapter, structure acceptance tests. The diaries prove the
knowledge exists and prove it is not where an author looks.

### What exists and why it isn't enough

| Surface | Audience | Why it doesn't solve this |
| --- | --- | --- |
| `AGENTS.md` / `CLAUDE.md` | agents working **on** Snapback | A repo-contributor primer: LLP process, bootstrap, toolchain authority. It teaches you to change Snapback, not to build on it. |
| `README.md` | new humans | Vision, architecture, repo setup, toolchain pins. Its "Demos" section is the closest thing to author documentation and is three paragraphs of pointers. |
| `docs/contract-exact-integration.md` | authors | One page, one seam. The only file in `docs/`. |
| The LLP corpus (61 documents) | designers | Design authorities with revision histories and adjudication notes — the wrong genre to teach from, and organized by decision, not by intent. |
| `demos/` + `demos/_kit` | copy-from corpus | The de-facto guide. Excellent but silent: no index from "I want live queries" to the demo and files that show them, and demos carry app-specific noise a fresh author must strip. |
| Diaries | nobody prospectively | Friction records — evidence for this RFC, unreadable as a tutorial, and explicitly not maintained as current truth. |

The gap is the same one 0365 names: a **single, complete, current,
agent-optimized map from intent ("I want to do X") to the paved-road
technique**, with code the author can trust without re-deriving it.

### Why now

The auth program (LLPs 0055–0060) just multiplied the author-facing surface —
sessions, principals, grants, invalidation barriers, authorized leases — and
the card-game demo (diary 0013) shows how much of it an author must hold to
use it correctly. That knowledge currently lives in five specs and one diary.
Every capability Snapback ships from here either lands in a teaching surface
or joins the hand-wiring ledger above.

## Goals

1. **Complete capability awareness.** An agent that loads the guide's
   capability index knows every author-facing feature area Snapback has —
   including the ones the guide doesn't cover yet, which appear as explicit
   gap rows rather than silence.
2. **Paved-road teaching.** Each page teaches the current product-shaped
   technique, names the LLP and code authorities it derives from, and links
   the demo that exercises it.
3. **Ran-in-CI code.** Every runnable snippet executes against a real
   `--memory` server in CI through the demo harness. Agents paste without
   re-deriving.
4. **Honesty about the boundary.** Snapback documents local-target guarantees
   that are deliberately not hosted guarantees (LLP 0060; the README's
   must-not-claim posture). Guide pages inherit that obligation: every page
   that touches a target-dependent behavior says which target it describes.
5. **Consistent shape with the Exact guide.** An agent that has used either
   guide can navigate the other: same frontmatter fields, same link classes,
   same snippet-class markers, same index shape.
6. **Proportionate governance.** Day-one checks are cheap and few; the heavy
   apparatus has named adoption triggers instead of speculative installation.

### Non-goals

- Replacing the LLP corpus — LLPs remain the design authorities; the guide is
  a derived teaching surface and says so on every page.
- Replacing `AGENTS.md`/`README.md` — they remain the contributor primer and
  the human introduction; each gains a pointer.
- Documenting how to build Snapback itself — bootstrap, toolchain authority,
  and repo development stay in the README/AGENTS.md.
- Teaching Contract/Exact authoring — that is the Exact guide's corpus; the
  seam is defined below.
- Building a rendered docs website. The admin-console projection (§Design 4)
  is a later phase; the markdown corpus is the value.

## Relationship to the Exact Guide (the shared-vs-independent decision)

**Decision proposed here: independent corpus, shared pattern, explicit seam.**

**Why not one shared corpus or package:** the two guides have different
authorities (Snapback LLPs + Rust/JS code vs Exact LLPs + Contract compiler),
different verification substrates (`scripts/verify-local-proof` + the demo
harness vs `exact-verify.json` lanes), different release cadences, and
different owners. A shared artifact would force cross-repo coordination on
every page edit and give readers nothing they don't get from links. The
repos are already siblings in practice; the guides cross-link instead.

**What is deliberately shared (the pattern):**

| Reused from Exact LLP 0365 | Form of reuse |
| --- | --- |
| Page conventions: frontmatter fields (`id`, `capabilities`, `authorities`, `examples`, `status`, `reviewed`), intent-first headings, complete inventories, named anti-patterns | Copied into `docs/guide/conventions.md`, adapted where Snapback differs (e.g. `targets:` frontmatter for the local/hosted honesty boundary — Goal 4) |
| Link policy: relative corpus-internal links; marked `repo:` references for out-of-corpus authorities | Copied verbatim |
| Snippet classes: runnable / fixture-backed / explicitly-partial-with-reason | Copied, with the runnable class upgraded from "compiles" to "executes against a `--memory` server" |
| Capability index with explicit GAP rows and a size budget | Copied as an authored index (registry-lite; see §Design 2) |
| Discovery wiring order: primer pointer first, index second | Copied, plus Snapback-specific channels (MCP, admin console) |

If a third repo adopts the same shape, extracting the conventions into the
upstream LLP repo (<https://github.com/ccheever/llp>) becomes worth doing;
until then, copying a ~200-line conventions file is cheaper than maintaining
a shared dependency (rule of three).

**The seam (who teaches what):**

- The **Exact guide** teaches Contract/Exact authoring: language, components,
  styling, motion, routing, verification with Acto.
- The **Snapback guide** teaches the backend and the integration from the
  backend side: authoring schema/functions, data semantics, realtime, auth,
  and the `@snapback/contract` adapter + generated bindings — including the
  connection-state and generated-mutation-binding material diary 0010 could
  not find, and the React/DataProvider arm (LLP 0005's three-surface story).
- Each guide's capability index carries a **cross-repo row** at the seam:
  Exact's data-layer row points at the Snapback guide; Snapback's
  client-authoring row points at the Exact guide. Cross-repo links use
  explicit repository-qualified references (a `repo:` link resolves within
  one repo only; cross-repo references name the repo and are understood to
  require the sibling checkout or its published rendering).

**Styling/rendering:** if and when the Snapback guide gets a rendered form,
it should be rendered by the same machinery as the Exact guide (the
`js/src/guide/` app pattern and `@exact/markdown`, per 0365 §2) rather than a
Snapback-local renderer — that is the one place literal code sharing is
cheap, because Snapback's admin console is already an Exact app. Deferred to
Phase 3.

## Design

### 1. The corpus: `docs/guide/`

Same location convention as the Exact guide. `docs/` currently holds one
file, so there is no drowning problem; the subtree still gets its own
conventions and checks because guide pages are product documentation with
obligations the rest of the repo doesn't carry.

Proposed initial shape (illustrative; the outline is Phase 1 work):

```text
docs/guide/
|-- index.md                       # the map: what Snapback is to an app author
|-- capabilities.md                # AUTHORED capability index incl. GAP rows (§2)
|-- conventions.md                 # page/frontmatter/link/snippet rules (from 0365)
|-- getting-started/
|   |-- your-first-backend.md      # schema + functions + codegen + run + query
|   `-- the-authoring-loop.md      # edit -> codegen -> acceptance test -> inspect
|-- backend/
|   |-- schema-and-seed.md         # tables, schema application, reset, seed
|   |-- queries.md                 # query functions, read sets, snapshots
|   |-- mutations.md               # server-authoritative writes, commit versions, conflicts
|   |-- actions-and-fetch.md       # actions, gated outbound fetch
|   `-- cron.md                    # scheduled execution (LLP 0028)
|-- realtime/
|   |-- live-queries.md            # subscriptions, replace updates, connection state
|   `-- ephemeral-state.md         # rooms, presence/cursors, TTL, overlays (LLP 0013)
|-- auth/
|   |-- sessions-and-principals.md # server-derived identity, ctx.auth
|   |-- protecting-data.md         # grants, invalidation barriers, leases
|   `-- targets.md                 # local vs hosted: what each target does/does not claim
|-- clients/
|   |-- contract-adapter.md        # @snapback/contract, generated bindings, live seam
|   |-- react-dataprovider.md      # the React arm; connection state semantics
|   `-- headless.md                # the required headless surface (LLP 0012)
|-- operating/
|   |-- running-the-server.md      # ports, --memory/--db, sidecar lock, inspect
|   |-- secrets-and-config.md      # LLP 0036
|   |-- admin-console.md           # inspection surface as an author's debugger
|   `-- host-ops.md                # CLI/HTTP/MCP operating surface (LLP 0024/0042)
|-- testing/
|   `-- acceptance.md              # harness, headless-first, fixed-port hygiene
|-- deploying/
|   `-- cloudflare.md              # the hosted target as far as it is real (LLP 0040/0049)
`-- recipes/
    |-- presence-cursors.md        # the cursors-web demo, distilled
    |-- hidden-hands.md            # per-principal query scoping (card-game)
    `-- ...
```

Page conventions are 0365 §1's, with these Snapback deltas:

- **`targets:` frontmatter** (`[local]`, `[local, cloudflare]`) on every page
  describing target-dependent behavior, and a rendered banner line when a
  page's technique is local-only. This is Goal 4 made mechanical — the guide
  must never generalize a local-target guarantee into a hosted claim
  (LLP 0060's posture).
- **`demos:` frontmatter** instead of 0365's `examples:` — pointing at demo
  directories and specific files; the consistency check verifies the paths.
- **Anti-patterns sections** seed directly from the diaries: "do not
  hand-wire HTTP glue for app data; the generated client exists", "do not
  poll a query you can subscribe to", "do not assert `userId` from the
  client" (LLP 0039's one idea), "do not reuse a fixed acceptance port
  without killing the stale server".

### 2. The capability index (registry-lite)

One **authored** file, `docs/guide/capabilities.md`: a table of every
author-facing capability — id, one-liner, intent aliases, target coverage,
owning authorities (LLP + code), the guide page or an explicit **GAP** row
with a filing pointer. Phase 1 seeds it with a sweep of the shipped surface:
the route registry (LLP 0031), the generated manifests/codegen surface, the
`packages/` public APIs, the host-ops surface (LLP 0024), and the README's
"Implemented now" list.

Deliberately **not** copied from 0365 day one: the JSON registry with
mechanical inventory joins, surface witnesses, and deferral-exception
records. Snapback's author-facing surface is currently enumerable by hand
(one route registry, four packages, one demo kit) and changes through a
small number of LLP-governed programs. **Adoption trigger:** when the index
misses a shipped capability twice — i.e. a diary or guide-gap issue records
an author building around something the index should have listed — the 0365
registry machinery (authored JSON + generated index + inventory joins)
becomes the recorded next step, not a new debate.

### 3. Verification: snippets that ran

Registered in the local proof (`scripts/verify-local-proof`), not as a bare
loose script, and kept honest by the same headless-first posture as
LLP 0010/0012:

- **`guide-snippets`** — extracts fenced snippets under `docs/guide/` and
  verifies each under its declared class:
  - *Runnable* JS/schema snippets are assembled into a scratch app (via the
    same codegen + harness path the demos use), loaded into a `--memory`
    server, and executed — queries return, mutations commit, subscriptions
    deliver. This is stronger than compile-checking and is cheap precisely
    because of Snapback's scale-to-zero local target.
  - *Fixture-backed* snippets declare sibling fixture files compiled/run with
    them.
  - *Partial* fences carry a reason (`snippet-fragment reason="excerpt"`), so
    unrunnable code is a tracked class, not an escape hatch.
  - Contract-arm snippets on `clients/` pages follow the acceptance suites'
    existing Exact-availability gating (`SNAPBACK_VERIFY_EXACT`), so the
    core-only local iteration stays core-only.
- **`guide-consistency`** — frontmatter schema valid; `authorities:` and
  `demos:` paths exist; capability ids in pages exist in the index and index
  page-links resolve; every page reachable from `index.md`; the index within
  its size budget; `targets:` present on pages under `auth/`, `realtime/`,
  `deploying/`, and `operating/`.
- **Freshness** — warning-only at first, one signal: a guide page whose
  `authorities:` files changed since the page's `reviewed:` date (computed
  from git, reported by the consistency check). The 0365 review-lock hash
  machinery is the recorded upgrade path if date-based reporting proves too
  noisy or too weak. **Day-one gate:** none beyond snippet/consistency
  failures — proportionality per Goal 6.

### 4. Distribution and discovery

In order of leverage:

1. **`AGENTS.md` pointer** (and the CLAUDE.md mirror): "Before building an
   app on Snapback, load `docs/guide/index.md`; before using a feature area,
   load its guide page." Sits next to the existing diary instruction, which
   gains the loop-closing line: *when a diary entry records friction the
   guide should have prevented, file it as a guide gap* (§5).
2. **`README.md`** — the Demos section gains a "building on Snapback starts
   at `docs/guide/`" row.
3. **`demos/_kit` pointer** — a short note in the kit README, since every
   demo author lands there.
4. **MCP surface (LLP 0042)** — the guide index and pages exposed as MCP
   resources (read-only, server-versioned), so an out-of-repo agent connected
   to a running Snapback server can load the guide for exactly the server
   version it is talking to. This is Snapback's analog of 0365's npm
   package: the server, not a package registry, is the natural channel to an
   out-of-repo author. Scoped as an increment of the LLP 0042 surface, not a
   parallel mechanism.
5. **Admin console (LLP 0017)** — a docs tab rendering the same tree, using
   the Exact guide app's rendering machinery (§Relationship). The console is
   already the author's inspection surface; putting "how do I" next to
   "what is happening" is the console equivalent of docs-next-to-code.

Phase 1 ships 1–3 (files only); 4 and 5 are Phases 2–3 and depend on the
corpus, not the reverse.

### 5. Keeping it current: the diary loop

Snapback already has what 0365 had to invent a retrieval eval to
approximate: **every demo build produces a diary whose explicit job is to
record friction** (LLP 0016). The guide closes that loop:

- A diary entry recording knowledge the author needed and couldn't find is a
  **guide gap**: filed as a Linear issue (Exact project, Snapback label,
  `guide-gap` in the title or label), linked from the capability index's
  filing pointer, and normally fixed by a page or an index row.
- The LLP 0016 reconcile cadence (corpus audit before each demo lands) adds
  one question: *did this demo's diary record friction a guide page should
  absorb?*
- New capability programs (the next LLP 0032-style phase, new RFC
  implementations) treat "guide page or explicit index GAP row" as part of
  landing author-facing surface. This is convention in this RFC — the 0365
  `Guide:` PR-line machinery with parsing epochs is the adopt-on-trigger
  upgrade if convention visibly leaks.

## Plan

**Phase 1 — corpus + index + checks (the value phase).**
Create `docs/guide/` with `index.md`, `conventions.md` (adapted from 0365),
and `capabilities.md` seeded by the shipped-surface sweep. First pages in
priority order: **getting-started** (both pages), **clients/contract-adapter
+ react-dataprovider** (the diary-0010 gap), **realtime/live-queries**,
**auth/sessions-and-principals + protecting-data + targets** (the freshly
multiplied surface), **testing/acceptance**, and two recipes
(presence-cursors, hidden-hands). Land `guide-snippets` and
`guide-consistency` wired into `scripts/verify-local-proof`, the AGENTS.md /
README / `demos/_kit` pointers, and the diary-loop line in AGENTS.md.
*Exit criterion: a fresh agent given "build a realtime multiplayer demo on
Snapback" and only the AGENTS.md pointer loads the relevant guide pages and
uses the generated client, live queries, and ephemeral store instead of
hand-wiring HTTP glue — checked informally against the next real demo build
and its diary, which is the eval this repo already runs.*

**Phase 2 — MCP projection.**
Expose the guide tree through the LLP 0042 MCP surface as versioned
read-only resources; extend `guide-consistency` to verify the projection
manifest. Depends on the 0042 surface existing; adds no new corpus rules.

**Phase 3 — admin console rendering.**
A docs tab in the admin console rendering the corpus, reusing the Exact
guide app's content pipeline and renderer rather than building one here.
Optional; the corpus and MCP forms carry the agent-facing value.

**Ongoing.** The diary loop (§5); the capability index updated as programs
land; freshness warnings reviewed at the LLP 0016 reconcile cadence;
adoption triggers (§2, §3, §5) fire the named 0365 upgrades if the light
mechanisms leak.

## Open questions

1. **Snippet-harness shape.** Whether `guide-snippets` assembles scratch
   apps per page or maintains one guide fixture app whose pages transclude
   marked regions (0365's transclusion idea, which makes behavioral drift
   structural). Decide when building the check; transclusion from the demos
   themselves is attractive since they are already CI-verified.
2. **How much of the auth surface is teachable now.** LLPs 0057–0060 are
   ratified but parts are activation-fenced; the `auth/` pages must teach
   only what an author can actually exercise. The `targets:` convention
   helps, but the page/spec boundary needs care in Phase 1.
3. **Cross-repo link mechanics.** The seam rows need a reference form that
   works for an agent with both checkouts and degrades honestly for one
   without (name-the-repo prose vs a `repo(exact):` scheme). Coordinate the
   convention with the Exact guide so both sides use the same form; this is
   the one conventions change worth pushing upstream early.
4. **Whether `docs/contract-exact-integration.md` is absorbed or bridged.**
   It predates the guide and overlaps `clients/`; default is absorb-with-
   pointer-stub per 0365 §6's standing rule, decided when `clients/` lands.
5. **A published-package form.** If Snapback's `@snapback/*` packages get a
   real npm publish closure, `@snapback/guide` following 0365 §3's ephemeral
   staging pattern becomes cheap. Not proposed now; the MCP channel covers
   the out-of-repo case first.

## Alternatives considered

- **One shared guide (or shared package) across Exact and Snapback.**
  Rejected: different authorities, verification substrates, owners, and
  cadences; readers get the same value from cross-links at the seam. The
  shape is shared instead, and the rendering machinery may be shared later
  (§Relationship).
- **Clone 0365's full governance day one.** Rejected as disproportionate:
  Snapback's author-facing surface is hand-enumerable and its change traffic
  flows through a few LLP-governed programs. Each heavy mechanism is named
  with an adoption trigger instead.
- **Just improve README + AGENTS.md.** Rejected: both are primers with the
  wrong audience (repo contributors) and hard size pressure; the builder-
  facing map needs its own boundary, conventions, and checks — the same
  reasoning as 0365, with less content to drown in but the same genre
  mismatch.
- **Generate the guide from LLPs.** Rejected for the same reason as 0365:
  LLPs are decision documents, the wrong genre to teach from. The guide
  derives authority from LLPs via frontmatter and freshness reporting but is
  hand-authored teaching prose.
- **Docs website first.** Rejected: the markdown corpus is the value; the
  console tab is presentation and comes last.
