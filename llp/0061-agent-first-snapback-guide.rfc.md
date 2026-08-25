# RFC 0061: The Snapback Guide — Agent-First Documentation for Building on Snapback

**Type:** RFC
**Status:** Review
**Systems:** Docs, Developer experience, Tooling, Client integration, API, Testing
**Author:** Charlie Cheever / Claude Fable 5
**Date:** 2026-07-15
**Revised:** 2026-08-25 (GAP review routing amendment: expired and
soon-expiring review dates are warning-only in the push-time Guide check;
closed or missing issue custody is a hard consistency error; the scheduled
drift backstop files one owner-routed, row-keyed ticket for each expired GAP.)
**Revised:** 2026-08-15 (LLP 0259 Rung A first-read amendment: the served
funnel and every first-read carrier now lead with the `guide/start/` tier —
a shared ≤3 KiB mental-model page, full start packets for `react` and
`expo-chat`, and ≤1 KiB stubs for the other shipped templates, each with a
checked `FirstReadProfileV1` (`guide/start/first-read-profiles.json`,
`scripts/check-first-read.mjs`: 16 KiB deduped steering ceiling, component
caps, digest-bound `AGENTS.md` transclusion, negative-vocabulary fence).
`/llms.txt`, the instance home, MCP instructions, bare `snapback guide`
channels, template `AGENTS.md`, the published funnel READMEs, the docs-site
`/llms.txt`, and the authoring skill demote the capability index to a
lookup registry; it remains the completeness and GAP authority. Recorded
here the same way T4/T5 were; LLP 0259 Design 1 owns the edit list.)
2026-08-12 (LLP 0232 D-2 freshness-identity amendment: page
review anchors now bind the declared authority bytes directly instead of a
commit containing them; source-generated Guide, symbol, and diagnostic
records carry content digests only, while `build.rs` still adds the exact
carrier commit to the embedded runtime manifest.) 2026-08-10 (reachability amendment: §Design 5 names the
sophisticated-variant-only anti-pattern — a page teaching only the advanced
variant of a capability makes the base variant look unsupported, so the
search terminates in a wrong conclusion — with Diary 0074's three guide-gap
tickets as the replicated instances, states the base-variant/composition
authoring rule reviewed on the LLP 0016 reconcile line, and reconciles §5's
filing sentence with the repo's filesystem-ticket-first policy; the page
fixes, ticket closures, and the corresponding retrieval-eval seed cases land
separately.) 2026-08-09 (tiered projection amendment: implements the disposition of `issues/closed/20260806-guide-flat-projection-oversize.md`, raised by LLP 0187 OQ4 and decided by the program orchestrator on 2026-08-09. The honest one-request claim now belongs to the budgeted capability-index + surface-map entry tier; the generator emits and checks one flat per top-level section; the roughly 2.5 MiB whole-corpus flat remains a labeled bulk export; and HTTP, MCP, `/llms.txt`, Guide, README, CLI, and instance-home discovery preserve one hash/build identity while recommending the bounded tiers. The disposition named a 40 KiB capability budget; the implementation reports about 50 KiB because the enforced budget had deliberately advanced to 51 KiB as capability rows landed, while the surface-map budget remains 16 KiB.) 2026-08-08 (served-guide witness names the explicit `snapback start` server projection); 2026-08-06 (LLP 0187 T4 installed the first out-of-repo discovery funnel over the existing build-bound projections: published-package orientation uses served URLs plus `snapback mcp`; the native `snapback guide [query]` carrier lists channels and searches embedded sections; and every current `snapback new` template carries a short consumer AGENTS.md. This records source-current carrier behavior without claiming that an npm closure containing it has been promoted). 2026-08-06 (routing conventions amendment from accepted LLP 0187 T1: paved-alternative links at the point of choice, the alias column's grep-vocabulary charter — workload terms, plausible wrong-guess symbol names, and LLP 0186 W2's competitor rosetta rows — schema-side/client-side vocabulary splits classified as guide defects, and LLP 0187 T7's standing rule that every replicated discoverability miss produces a retrieval-eval seed case when fixed; recorded in §Design 1 with the executable forms in `guide/conventions.md` and `guide/retrieval-eval.md`). 2026-08-03 (the 40 KiB trigger fired while classifying LLP 0017's claim-link routes; implemented the recorded split of the mechanical route/host-op surface map into `guide/surface-map.md` with its own 16 KiB budget while preserving the closed checker join). 2026-07-16 (r10 — ENG-25111 implemented Phase 2b as the resource-first `snapback mcp` stdio server: manifest, flat guide, and every manifest-named page are build-bound read-only resources; each carries the same guide hash/build commit; the consistency check validates exact resource membership and page hashes; host-operation tools remain explicitly absent). 2026-07-16 (r9 — ENG-25113 completed the reciprocal Exact seam: both corpora use `repo(<repository>):<path>`, Exact's `data.snapback` external-authority row points back to this guide without a fake local witness, and Snapback's checker now validates the generic form.) 2026-07-16 (r8 — ENG-25112 implemented optional Phase 3: the Contract admin console has a Docs tab whose navigation comes from the served generated manifest, whose page reads must match the manifest response's content-hash/build-commit identity, and whose console-owned Markdown block renderer emits text leaves only. The conditional dependency check found `@exact/markdown` source in the sibling Exact workspace but no supported published dependency in the admin package set, so this uses the RFC's pattern-reuse branch rather than creating a source-tree dependency.) 2026-07-15 (r7 — the public, content-negotiated instance home at `/` now advertises the guide index to humans and the one-request flat projection in its HTML and machine-readable renderings.) 2026-07-15 (r6 — ENG-25102 implemented Phase 2a: the generator emits and hash-stamps the capability-first flat projection; `build.rs` embeds the checked corpus with eval evidence excluded; the LLP 0031 registry serves index, files, and `flat.md` with content-hash/build-commit headers; memory-server acceptance pins the bytes and identity; and the capability row is shipped for out-of-repo readers.) 2026-07-15 (r5 — implementation program filed: ENG-25100
(umbrella) + ENG-25101 (eval intents 2–3, the formal Phase 1 exit),
ENG-25102 (Phase 2a served guide), ENG-25103–25110 (the eight GAP-page
issues), ENG-25111 (Phase 2b MCP, blocked on ENG-25102 + the LLP 0042
surface), ENG-25112 (Phase 3 console tab), and ENG-25113 (the Exact-side
seam item, resolving §Relationship's one-directional caveat and open
question 2's coordination half).) 2026-07-15 (r4 — the served guide: resolved open question 3 as
**embedded-in-binary, always served** — every Snapback server build embeds
the corpus and serves it read-only at `/_snapback/guide` (index, pages, and
a flattened single-file projection `flat.md` generated from the manifest),
with responses carrying the guide content hash + server build identity;
this gives out-of-repo authors a channel that needs nothing but a running
server, makes the version binding structural (the server is the version
authority), and becomes the corpus source the Phase 2 MCP projection
re-serves. Amended §Design 4 (new 4a), split the plan's Phase 2, and added
the `operating.served-guide` design-only row to the capability index.
Decided as an amendment rather than a new LLP: it resolves this RFC's own
open question and extends its distribution design — one authority for guide
distribution.) 2026-07-15 (r3 — status Draft → Review by author adjudication:
Charlie ordered implementation after the single authorized super-refine round
ended with split verdicts (fable READY / codex NOT READY, both concerns
reconciled in r2), ending the loop; same revision decides the corpus location
as **`guide/` at the repository root** rather than `docs/guide/` — this repo's
first-class corpora already live at the root (`llp/`, `diaries/`, `demos/`),
the guide is a product surface rather than repo documentation, and `docs/`
remains the internal-engineering shelf; the shape stays 0365-compatible via
the conventions/schema/manifest, which never depended on the path. Phase 1
implementation lands with this revision.) 2026-07-15 (r2 — reconciled round-1 fable + codex reviews: replaced
date-based freshness with a commit-pinned review baseline (superseded by the
2026-08-12 content-digest amendment); replaced the informal
Phase 1 exit with a pinned cold-agent retrieval eval (diaries stay a
complementary source); scoped the guide's Phase 1 audience honestly to
checkout/adjacent authors and corrected the Summary's overstatement of the MCP
surface (LLP 0042 is Draft, unimplemented); added the Phase 1 generated guide
manifest as the single projection interface and the build-identity handshake
question for Phase 2; fixed the unsafe stale-port anti-pattern to the
provenance/OS-assigned-port discipline the kit actually implements; added
required witnesses + two day-one inventory joins to the capability index and
reworded Goal 1's completeness claim honestly; extended `targets:` to every
page and added checked `maturity:`, with auth pages restricted to
acceptance-witnessed behavior (0055/0056 material stays GAP); named page
ownership and the LLP 0016 reconcile line; made the seam one-directional for
Phase 1 with a filed Exact-side coordination item; kept `examples:` instead of
renaming it; made transclusion-from-demos the Phase 1 default snippet
mechanism; corrected motivation evidence (diary 0010 was a deliberate React
control arm; the diary 0008 exhibit was Exact-side and historical — removed;
demos are documented-but-fragmented, not silent; count/status fixes); decided
the `docs/contract-exact-integration.md` disposition; added sync/offline and
diagnostics pages to the outline; conditioned Phase 3 renderer reuse on a
supported dependency boundary). 2026-07-15 (initial draft)
**Related:** LLP 0000 (root), LLP 0004 (application data API), LLP 0005
(Contract/Exact/React integration), LLP 0010 (agent DX and acceptance),
LLP 0012 (headless integration contract), LLP 0013 (ephemeral realtime state),
LLP 0015 (demo application suite), LLP 0016 (diary-driven change program),
LLP 0017 (admin console inspection surface), LLP 0019 (agentic readiness),
LLP 0024 (agent operating surface), LLP 0031 (server route taxonomy),
LLP 0036 (app secrets and config), LLP 0041 (packaged dev loop),
LLP 0042 (agent MCP surface), LLP 0039/0053/0055–0060 (auth program),
LLP 0186 (agent authoring efficiency program; W2 context injection),
LLP 0187 (agent discoverability — routing over coverage),
Exact LLP 0365 (the agent-first Exact guide — the sibling-repo pattern this
adapts; `~/projects/exact/llp/0365-agent-first-exact-guide.rfc.md`)

## Summary

Create **the Snapback Guide**: a curated tree of markdown documents under
`guide/` at the repository root that teaches an agent (primarily) and a human
(secondarily) how
to build an application **on** Snapback — schema and functions, queries and
mutations, live queries, ephemeral realtime, sync and offline behavior, auth,
secrets, the Contract/Exact adapter, the headless surface, acceptance testing,
and deployment — with verified code for all of it.

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

1. **Runnable snippets are verified by execution.** Snapback's local target is
   cheap to start (`--memory`, scale-to-zero); the guide's runnable snippets
   are transcluded from or executed through the same harness the demo
   acceptance suites use, not merely compiled. For that class, the trust
   property is "this ran", one level stronger than the Exact guide's "this
   compiled" (other snippet classes carry the weaker properties §Design 3
   assigns them).
2. **The server is the first out-of-repo distribution channel.** Out-of-repo
   authors talk to a running Snapback server, so the guide's out-of-repo
   projections go through surfaces Snapback owns or has designed: the admin
   console (LLP 0017, shipped) and the MCP surface (LLP 0042; the read-only
   guide resource slice is shipped, while host-operation tools remain Draft).
   Phase 1 is therefore honest about its audience: the
   corpus serves authors working in or adjacent to a Snapback checkout;
   the first out-of-repo channel is the **served guide** (§Design 4a, r4):
   every server build embeds the corpus and serves it — pages, one generated
   flat per top-level section, and a whole-corpus bulk flat — with the version
   binding structural because the server is the version authority. A Phase 1 generated
   **guide manifest** is the single interface every projection consumes.

Governance is proportionate to Snapback's stage: an authored capability index
with required witnesses, two day-one inventory joins, and explicit gap rows;
harness-verified snippets; a small pinned retrieval eval. The heavier 0365
machinery (the full registry JSON with joins over every enumerable surface,
review-lock tooling, PR-line policy) is named as adopt-on-trigger, not cloned.

## Motivation

### The evidence: the knowledge exists, and authors can't find it

Snapback's primary consumers today are agents building demo applications
(LLP 0015), and the diary corpus (LLP 0016) records what they needed and
where they had to go to get it:

- Diary 0010 (All Aboard red-team rerun): connection-state semantics "had no
  React-facing documentation; I had to read the Contract [source]". The
  exercise was a deliberate React control arm — the author chose hand-wiring
  as the experiment — but the documentation finding stands on its own: the
  React/DataProvider arm's connection-state and generated-mutation-binding
  material was discoverable only by reading source.
- ENG-22218 (graffiti-board prerequisites) shipped the carrier work that lets
  a demo use "product-shaped Snapback APIs" instead of "hand-wired HTTP
  glue". The graffiti README then documented those paths *for that demo* —
  but the technique lives in a demo README, findable only by an author who
  already knows which demo answers their question.
- Every demo re-derives the same starting knowledge: how to author a backend,
  run the server, wire the adapter, structure acceptance tests. The demo
  READMEs are individually substantial; collectively they are fragmented,
  uneven, and indexed by app name rather than by intent.

The failure mode is the one Exact LLP 0365 documents as the Motion incident —
shipped surface an author cannot discover from where they stand. Snapback's
version is milder (the demos document more than Exact's examples did) but
structural: the teaching material is scattered across six demo READMEs, a
one-file `docs/`, a contributor primer, and 61 prior design documents, with
no map from "I want to do X" to the paved-road technique.

### What exists and why it isn't enough

| Surface | Audience | Why it doesn't solve this |
| --- | --- | --- |
| `AGENTS.md` / `CLAUDE.md` | agents working **on** Snapback | A repo-contributor primer: LLP process, bootstrap, toolchain authority. It teaches you to change Snapback, not to build on it. |
| `README.md` | new humans | Vision, architecture, repo setup, toolchain pins. Its "Demos" section is the closest thing to author documentation and is three paragraphs of pointers. |
| `docs/contract-exact-integration.md` | authors | One page, one seam. The only file in `docs/`. |
| The LLP corpus (61 prior documents) | designers | Design authorities with revision histories and adjudication notes — the wrong genre to teach from, and organized by decision, not by intent. |
| `demos/` READMEs + `demos/_kit` | copy-from corpus | The de-facto guide, and individually good — but organized per-app, uneven in coverage, and with no index from "I want live queries" to the demo and files that show them. Demos also carry app-specific noise a fresh author must strip. |
| Diaries | nobody prospectively | Friction records — evidence for this RFC, unreadable as a tutorial, and explicitly not maintained as current truth. |

The gap is the same one 0365 names: a **single, current, agent-optimized map
from intent ("I want to do X") to the paved-road technique**, with code the
author can trust without re-deriving it.

### Why now

The auth program (LLPs 0055–0060 — three RFCs and three Specs; 0057–0060
ratified, 0055/0056 still in Review) just multiplied the author-facing
surface — sessions, principals, grants, invalidation barriers, authorized
leases — and the card-game demo (diary 0013) shows how much of it an author
must hold to use it correctly. That knowledge currently lives in six design
documents and one diary. Every capability Snapback ships from here either
lands in a teaching surface or joins the fragmentation ledger above.

## Goals

1. **Capability awareness, honestly scoped.** An agent that loads the guide's
   capability index sees every author-facing capability enumerable from the
   surfaces the index joins day one (the declared route registry and the
   host-ops surface — §Design 2), each shipped row backed by a code witness —
   plus hand-authored rows for everything else, where coverage is best-effort
   with a named escalation trigger. Uncovered capabilities appear as explicit
   gap rows with owners, never as silence.
2. **Paved-road teaching.** Each page teaches the current product-shaped
   technique, names the LLP and code authorities it derives from, and links
   the demo that exercises it.
3. **Ran-in-CI code.** Every runnable snippet executes against a real
   `--memory` server in CI — by transclusion from already-verified demo and
   fixture code wherever possible (§Design 3). Agents paste without
   re-deriving.
4. **Honesty about targets and maturity.** Snapback documents local-target
   guarantees that are deliberately not hosted guarantees (LLP 0060; the
   README's must-not-claim posture), and parts of the auth surface are
   activation-fenced or still in design review. Every guide page carries
   checked `targets:` and `maturity:` metadata (§Design 1), and auth pages
   teach only behavior witnessed by an acceptance test or the server's own
   capability reporting.
5. **Consistent shape with the Exact guide.** An agent that has used either
   guide can navigate the other: a compatible frontmatter core, the same link
   classes, the same snippet-class markers, the same index shape.
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
- Enabling out-of-repo application development by itself. The `@snapback/*`
  packages are private and the demos invoke codegen by repository-relative
  paths; until a supported acquisition path exists (LLP 0041's packaged CLI
  is the natural carrier), the guide serves checkout-based authors and says
  so (§Design 4).
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
| Page conventions: frontmatter core (`title`, `id`, `order`, `audience`, `capabilities`, `authorities`, `examples`, `status`, `reviewed`), intent-first headings, complete inventories, named anti-patterns | Adopted as a **compatible core plus Snapback extensions** (`targets:`, `maturity:`, `reviewed-authorities-digest:` — §Design 1), defined in a schema artifact that is a Phase 1 deliverable. `examples:` keeps its name and points at demo paths. |
| Link policy: relative corpus-internal links; marked `repo:` references for out-of-corpus authorities | Copied verbatim for the in-repo classes; the cross-repo reference form is new and coordinated (§seam below) |
| Snippet classes: runnable / fixture-backed / explicitly-partial-with-reason | Copied, with the runnable class upgraded from "compiles" to "executes against a `--memory` server" and transclusion-from-verified-code as the default mechanism (§Design 3) |
| Capability index with explicit GAP rows and a size budget | Adopted with required witnesses for shipped rows and two day-one inventory joins (§Design 2) |
| Discovery wiring order: primer pointer first, index second | Copied, plus Snapback-specific channels (MCP, admin console) in later phases |

If a third repo adopts the same shape, extracting the conventions into the
upstream LLP repo (<https://github.com/ccheever/llp>) becomes worth doing;
until then, copying a ~200-line conventions file is cheaper than maintaining
a shared dependency (rule of three).

**The seam (who teaches what):**

- The **Exact guide** teaches Contract/Exact authoring: language, components,
  styling, motion, routing, verification with Acto.
- The **Snapback guide** teaches the backend and the integration from the
  backend side: authoring schema/functions, data semantics, realtime, sync
  and offline behavior, auth, and the `@snapback/contract` adapter +
  generated bindings — including the connection-state and
  generated-mutation-binding material diary 0010 could only get from source,
  and the React/DataProvider arm (LLP 0005's three-surface story).
- **The seam is reciprocal (ENG-25113, 2026-07-16):** Snapback's
  client-authoring rows point at the Exact guide, and Exact's
  `data.snapback` external-authority row points back to this guide. Exact LLP
  0365 makes that row a distinct class with no local witness or local page,
  so it cannot weaken the local-witness rule for Exact-owned capability.
- Cross-repo references name the repository explicitly and degrade honestly:
  an agent with both checkouts resolves them as paths; an agent without gets
  prose naming the repo and document. Both corpora use
  `repo(<repository>):<repo-root-relative-path>`.

**Styling/rendering:** if and when the Snapback guide gets a rendered form,
the preference is to reuse the Exact guide app's machinery (the
`js/src/guide/` pattern and `@exact/markdown`, per 0365 §2) — but literal
reuse is conditional on a supported dependency boundary existing (a published
or vendorable `@exact/markdown`); absent one, Phase 3 is pattern reuse, not a
package dependency. Deferred to Phase 3 either way.

## Design

### 1. The corpus: `guide/`

At the repository root, beside `llp/`, `diaries/`, and `demos/` — the
location this repo gives its first-class corpora (decided in r3). The guide
is a product surface, not repo documentation, and `docs/` remains the
internal-engineering shelf; the shape stays 0365-compatible through the
conventions, schema, and manifest, which never depended on the path. The
subtree gets its own conventions and checks because guide pages are product
documentation with obligations the rest of the repo doesn't carry.

Proposed initial shape (illustrative; the outline is Phase 1 work):

```text
guide/
|-- index.md                       # the map: what Snapback is to an app author
|-- capabilities.md                # AUTHORED capability index incl. GAP rows (§2)
|-- conventions.md                 # page/frontmatter/link/snippet rules (from 0365)
|-- frontmatter.schema.json        # the schema artifact (compatible core + extensions)
|-- guide-manifest.generated.json  # GENERATED: nav, frontmatter, hashes, versions (§4)
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
|-- sync/
|   `-- offline-and-retention.md   # retained queries, leases, outbox, optimistic overlays
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
|   |-- diagnostics.md             # stable SNAPBACK_* codes and what to do with them
|   |-- secrets-and-config.md      # LLP 0036
|   |-- admin-console.md           # inspection surface as an author's debugger
|   `-- host-ops.md                # CLI/HTTP/MCP operating surface (LLP 0024/0042)
|-- testing/
|   `-- acceptance.md              # harness, headless-first, server lifecycle hygiene
|-- deploying/
|   `-- cloudflare.md              # the hosted target as far as it is real (LLP 0040/0049)
`-- recipes/
    |-- presence-cursors.md        # the cursors-web demo, distilled
    |-- hidden-hands.md            # per-principal query scoping (card-game)
    `-- ...
```

Page conventions are 0365 §1's, with these Snapback deltas:

- **`targets:` frontmatter on every page** (`[local]`, `[local, cloudflare]`,
  or `[all]` for genuinely target-independent material), with a rendered
  banner line when a page's technique is local-only. `guide-consistency`
  requires the field everywhere — target-dependence is the rule in this
  product, not the exception — so the honesty boundary (Goal 4) is mechanical
  corpus-wide, not per-directory.
- **`maturity:` frontmatter** (`shipped` | `partial` | `design-only`),
  checked against the capability index. A page may teach `shipped` behavior
  normally; `partial` requires naming what works and what doesn't;
  `design-only` material may exist only as an explicitly marked
  design-reference section, never as a technique. Auth pages additionally
  teach only behavior witnessed by an acceptance test or the server's own
  capability/inspect reporting — the mechanical form of the activation-fence
  rule; LLP 0055/0056 material stays a GAP row until an author can exercise
  it.
- **`reviewed:` + `reviewed-authorities-digest:`** — the page's last
  intentional review date (display metadata) and the SHA-256 digest of its
  declared authority bytes at that review (identity — §3).
- **`examples:` frontmatter** points at demo directories and specific files;
  the consistency check verifies the paths. The field keeps 0365's name for
  schema compatibility.
- **Anti-patterns sections** seed from the diaries and the kit's actual
  discipline: "do not hand-wire HTTP glue for app data; the generated client
  exists", "do not poll a query you can subscribe to", "do not assert
  `userId` from the client" (LLP 0039's one idea), and for tests: "do not
  claim a fixed port and kill whatever holds it — request an OS-assigned
  port (or an isolated one), verify server provenance before reusing
  anything, and stop only processes your own harness started"
  (`demos/_kit/server-process.mjs` is the transcludable reference for this).
- **Routing conventions (added 2026-08-06, from accepted LLP 0187 T1 — the
  routing-over-coverage diagnosis whose evidence is the replicated 2026-08-04/05
  bakeoff misses).** (i) Anti-pattern and "hard way" teaching content must
  link its paved alternative at the point of choice, with the paved road's
  honest boundary — a worked hard-way example with no adjacent pointer is a
  guide defect. (ii) The capability index's alias column's charter includes
  grep vocabulary: the literal strings an agent would plausibly search for —
  workload terms and plausible wrong-guess symbol names, whichever register
  they come from, including competitor vocabulary (LLP 0186 W2's rosetta
  rows). A miss caused by a reasonable grep that returned nothing is a guide
  defect with a mechanical fix: add the string. (iii) A vocabulary split
  between a feature's schema side and its client side is a guide defect;
  each side's page names the other side's vocabulary. (iv) LLP 0187 T7's
  standing rule: every replicated discoverability miss must produce a
  retrieval-eval seed case when fixed, so the fix cannot silently regress.
  The executable forms live in `guide/conventions.md` (§Routing) and
  `guide/retrieval-eval.md` (seed cases 4–7 are the initial regression
  seeds).

### 2. The capability index (registry-lite, with witnesses)

One **authored** file, `guide/capabilities.md`: a table of every
author-facing capability — id, one-liner, intent aliases, `targets` +
`maturity`, owning authorities (LLP + code), a **required code witness for
every shipped row** (a route in the declared registry, a host-op id, a
package export, a generated-manifest field, or a CLI command that proves the
capability exists), and the guide page or an explicit **GAP** row naming an
owner and a review date, with the filing pointer.

Two **day-one inventory joins**, run by `guide-consistency` (§3), keep the
index honest where the repo already has declared, machine-readable
enumerations: the **server route registry** (LLP 0031's declared registry
with enforcement tests) and the **host-ops operation list** (LLP 0024).
Every entry in those enumerations must map to a capability id or carry a
`notAuthorFacing` classification in the index. Other surfaces (package
exports, codegen declarations, CLI flags) are seeded by the Phase 1 sweep
and maintained by hand; index ids are stable and are reserved now as the
resource ids any later projection (MCP, console) uses.

**Size budget raised to 40 KiB (2026-08-02).** The budget bounds what an
agent pays to load the index (§Plan's ~15-tool-use budget), and it started at
32 KiB. Classifying LLP 0062's two `/app-api` routes — mandatory, since the
route join refuses any unclassified declared route — put the page 88 bytes
over, with no slack left to reclaim: no trailing whitespace, no double blank
lines, and no duplicated `notAuthorFacing` rationales to merge. Raised to
40960 bytes in `scripts/guide-lib.mjs` rather than dropping required rows.
Note the two halves of the page grow differently: the authored capability
table is roughly stable, while the surface map grows with every route the
server declares. That trigger fired on 2026-08-03 when LLP 0017's four claim
routes were classified. The mechanical map now lives in
`guide/surface-map.md` under its own 16 KiB budget; the checker still joins it
to the capability table and both declared registries. The capability-index
budget was not raised a second time in that change.

**Size budget raised to 42 KiB (2026-08-06).** LLP 0184's required
`operating.data-patch` classification arrived when the authored index was only
seven bytes below its 40 KiB limit. No required classification row could be
dropped, so the authored-index budget is now 43008 bytes. The separate
mechanical surface map remains bounded at 16 KiB.

Deliberately still deferred from 0365: the JSON registry file, joins over
*every* enumerable surface, and the deferral-exception ledger.
**Escalation trigger:** if the hand-maintained portion misses a shipped
capability twice — a diary or guide-gap issue records an author building
around something the index should have listed — the full 0365 registry
machinery becomes the recorded next step, not a new debate. (The joined
surfaces don't wait for that trigger; they are closed from day one.)

### 3. Verification: snippets that ran

Registered in the local proof (`scripts/verify-local-proof`), not as a bare
loose script, and kept honest by the same headless-first posture as
LLP 0010/0012:

- **`guide-snippets`** — verifies every fenced snippet under `guide/`
  under its declared class:
  - **Transclusion is the default.** Runnable snippets are marked regions
    transcluded at check time from demo and fixture code that CI already
    executes end-to-end — behavioral drift becomes structural breakage, and
    "this ran" is inherited rather than rebuilt. Pages hand-copy nothing the
    demos already prove.
  - *Standalone-runnable* snippets (for techniques no demo exercises) are
    assembled into a scratch app via the codegen + harness path and executed
    against a `--memory` server on an OS-assigned port — queries return,
    mutations commit, subscriptions deliver, with semantic assertions rather
    than mere invocation success. The scratch-app assembler is built only
    for this minority class.
  - *Fixture-backed* snippets declare sibling fixture files compiled/run with
    them.
  - *Partial* fences carry a reason (`snippet-fragment reason="excerpt"`), so
    unrunnable code is a tracked class, not an escape hatch.
  - **Exact-dependent snippets:** merge/release CI runs `guide-snippets`
    with `SNAPBACK_VERIFY_EXACT=1`, so Contract-arm snippets are always
    verified before landing; the local runner may skip Contract fences when
    Exact dependencies are absent, and skipped-vs-verified status is
    recorded per snippet in the guide manifest. ("Core-only iteration" here
    refers narrowly to the local guide runner, not to the full local proof,
    whose required-surface gate has its own Exact behavior.)
- **`guide-consistency`** — frontmatter validates against
  `frontmatter.schema.json`; `authorities:` and `examples:` paths exist;
  capability ids in pages exist in the index and index page-links resolve;
  the §2 inventory joins hold; GAP rows carry owner + review date plus a live
  `issues/` pointer; closed or missing issue pointers fail, while expired and
  seven-day-soon review dates are reported as warnings; every page reachable from `index.md`;
  the index within its size budget; `targets:` and `maturity:` present and
  consistent with the index; the generated manifest (§4) not stale.
- **Freshness** — warning-only, but sound: the check compares each page's
  `reviewed-authorities-digest:` with a digest over its current declared
  authority paths and bytes, so any authority byte change since the page's
  last intentional review is visible regardless of dates, same-day revisions,
  commit topology, or how many edits landed. Refreshing the digest is a
  deliberate act in a review pass; ordinary Guide regeneration never changes
  authored review anchors. This adopts 0365's dates-are-not-identity principle
  while making the verdict invariant under gate-disjoint rebases, as required
  by LLP 0232 D-2. **Day-one gates:** snippet failures and consistency
  failures, including join violations and closed/missing GAP issue custody.
  Authority drift and GAP review-date expiry stay warnings. The scheduled
  `scripts/drift-prone-gates.mjs backstop` converts each expired GAP row into
  one owner-routed filesystem ticket keyed by stable capability id, so the
  review prompt reaches its owner without making the next pusher renew it.

**Implementation note (2026-08-06).** The published-closure fence is now a
registered guide-consistency check: page or section `since:` / `unreleased:`
claims join against `guide/published-closure.json`, and stale or missing fences
fail locally without consulting the network. The mechanism was prompted by
`issues/20260804-guide-gap-published-closure-drift.md`, where source-tree guide
claims had outrun the npm closure.

### 4. Distribution and discovery

**Audience honesty first:** the `@snapback/*` packages are private, and demo
tooling invokes codegen by repository-relative paths; there is no supported
out-of-repo acquisition path today. Phase 1 therefore serves authors working
**in or adjacent to a Snapback checkout**, and the guide's index page says
so. Out-of-repo channels arrive with the phases that make them real; the
packaged CLI (LLP 0041) is the natural future carrier for both an installed
guide bundle and a `snapback guide` command, and is named in §Open questions
rather than promised here.

**The guide manifest** — `guide/guide-manifest.generated.json`,
generated in Phase 1: nav tree, per-page frontmatter, content hashes,
capability-index join (including GAP state), per-snippet
verified/skipped status, and the Snapback build identity the snippets were
verified against. Every later projection — MCP, admin console, CLI, any
package — consumes the manifest rather than re-parsing the tree, so all
projections share one shape and one version stamp.

**4a. The served guide (r4; resolves former open question 3).** Every
Snapback server build **embeds the guide corpus and serves it**:

- **Embedding:** `build.rs` packs `guide/**` (pages, `capabilities.md`, the
  manifest, every generated flat below, and build-bound reference resources;
  `eval-runs/` excluded) into the binary — the admin console's built-snapshot
  pattern applied to markdown. The original ~130 KiB corpus has grown well
  beyond that historical size; embedding remains the chosen version-authority
  mechanism, while retrieval is budgeted by the tiers below.
- **Routes** (registered in the LLP 0031 registry as system-static,
  public read-only — documentation is a public projection):
  `GET /_snapback/guide` (the index), `GET /_snapback/guide/{*path}`
  (pages and generated section flats, served as markdown), and
  `GET /_snapback/guide/flat.md` — the **whole-corpus bulk projection**
  (capability index first, then pages in nav order), generated at
  `guide/guide-flat.generated.md`. The honest one-request reading claim is the
  entry tier: `capabilities.md` (about 50 KiB under the current enforced
  budget) plus `surface-map.md` (about 12 KiB under its 16 KiB budget).
  `guide-flat.<section>.generated.md` is the next tier, one file per top-level
  manifest section. The whole flat remains available at roughly 2.5 MiB for
  consumers that deliberately want the full corpus. The generator and checker
  record and validate every flat's path, byte count, SHA-256, served path, and
  MCP URI through the same manifest machinery.
- **Identity:** responses carry the guide content hash and the server
  build identity (both already stamped in the manifest), so a consumer can
  detect a mismatch between the docs it cached and the server it is
  talking to. The Phase 2 MCP increment re-serves this same embedded
  corpus and inherits the handshake — the bytes question is solved once.
- **Honesty properties:** the served corpus matches the *build*, not the
  working tree — which is the right claim for its audience (out-of-repo
  authors talking to a running server); checkout authors read the files.
  Registering the routes forces their own classification in the
  capability-index surface map via the §3 join — the guide must document
  the routes that serve the guide.
- The shipped surface carries an acceptance witness: the suite asserts the
  whole and section projections, manifest identity, and hash header against
  the real `snapback start --memory` serve path; `operating.served-guide` is
  therefore classified as shipped.

Discovery wiring, in order of leverage:

1. **`AGENTS.md` pointer** (and the CLAUDE.md mirror): "Before building an
   app on Snapback, load `guide/index.md`; before using a feature area,
   load its guide page." Sits next to the existing diary instruction, which
   gains the loop-closing line: *when a diary entry records friction the
   guide should have prevented, file it as a guide gap* (§5).
2. **`README.md`** — the Demos section gains a "building on Snapback starts
   at `guide/`" row.
3. **`demos/_kit` README** — created in Phase 1 (the kit has none today)
   with a pointer, since every demo author lands there.
4. **The instance home (`GET /`).** Every negotiated rendering advertises the
   guide index and labels the roughly 2.5 MiB whole flat as a bulk projection;
   browsers direct context-limited agents to the tiered `/llms.txt` index,
   while YAML/JSON/Markdown clients keep the same URLs in the public `links`
   projection.
5. **The served guide (§4a)** — the always-available channel: any running
   server hands an agent the corpus, version-matched to the build.
6. **MCP guide resources (implemented 2026-07-16).** `snapback mcp` re-serves
   the §4a embedded corpus as read-only MCP resources, inheriting the identity
   handshake — consumers surface hash/build mismatches rather than silently
   combining versions. This resource-first slice exposes no tools and does not
   claim LLP 0042's broader host-operation surface.
6. **Admin console (LLP 0017)** — a docs tab rendering the same tree from
   the manifest, following the console's existing built-snapshot pattern
   for where the bytes live. Renderer reuse per §Relationship
   (conditional on a supported dependency boundary).

Phase 1 ships 1–3 plus the manifest (files only); 4–6 are Phases 2–3 and
depend on the corpus, not the reverse.

### 5. Keeping it current: ownership, the diary loop, and a small eval

**Ownership and review.** Each capability-index row and each GAP row names
an owner. Guide prose rides ordinary PR review, and the guide corpus gets
its own line in the LLP 0016 reconcile audit (run before each demo lands):
*did this demo's diary record friction a guide page should absorb, and did
any recently landed surface change what a page teaches?* Structure is
checked mechanically (§3); claims are reviewed by people/agents on this
cadence — a snippet that runs can still teach an anti-pattern, so checked
structure does not substitute for reviewed prose.

**The diary loop.** A diary entry recording knowledge the author needed and
couldn't find is a **guide gap**: filed as a filesystem ticket under
`issues/` with `guide-gap` in the title (graduating to Linear — Exact
project, Snapback label — only when it needs PM coordination, per the repo's
ticket policy), linked from the capability index's filing pointer, and
normally fixed by a page or an index row. Diaries are a rich source of *new cases*; they are complementary to —
not a substitute for — the eval below, because they are post hoc,
uncontrolled, and only required when a demo is built or substantially
changed. (A cheap optional extension once the corpus exists: periodically
replay an old diary workaround as a cold-agent intent against the current
guide — a "friction replay" that tests currentness and discoverability
together.)

**The reachability anti-pattern (sophisticated-variant-only pages).** Three
of Diary 0074's guide gaps (2026-08-10: the browser-sessions mailbox relay
for a non-React Contract surface, Contract-native presence publishing, and
the Contract `invariant` grammar ceiling) shared one failure shape, distinct
from a missing page: the owning page documented only the *sophisticated*
variant of a capability — pointer channels but not plain presence
publishing; React browser auth but not a non-React sessions boot; keyed
scopes and ephemeral channels as sibling bullets with their composition
unstated — so a reader who found the page concluded the ordinary variant was
unsupported. That search terminates in a confident wrong conclusion rather
than in "not found", which costs the workaround, then the wrong
architecture, then a diary note asserting the wrong limit that later readers
copy. The shape can also be pure reachability: in the `invariant` case the
reference material existed in Exact's own guide (the clause inventory in its
contract-blocks page), but the expressiveness ceiling was unstated and
nothing on the Snapback side pointed there. The authoring rule, checked in
review on the LLP 0016 reconcile line: **a page that teaches variant N of a
capability must also teach the base variant, link to where it lives, or
carry an explicit GAP row — and a page presenting two features on the same
surface must state whether their composition is supported.** Per the LLP
0187 T7 standing rule, each such replicated miss adds a seed case to
`guide/retrieval-eval.md` when its page fix lands.

**The retrieval eval (pinned, small).** The Phase 1 exit criterion, kept
repeatable rather than anecdotal, sized to this repo:

- *Fixture:* a fresh agent context, cold-started in the checkout with
  `AGENTS.md` as the only steer.
- *Seed intents* (at least three, across feature areas): "add a live-updating
  list to an app" (realtime), "let two users see each other's cursors"
  (ephemeral), "scope a query to the signed-in user" (auth).
- *Budget:* the relevant guide page loaded within the first ~15 tool uses.
- *Rubric:* the agent (a) loads the relevant page(s), (b) plans with the
  paved technique, (c) does not reach for the named anti-patterns
  (hand-wired HTTP glue, polling a subscribable query, client-asserted
  identity).
- *Evidence:* the transcript is retained with the check's artifacts.
- *Owner and cadence:* the guide's named owner; at Phase 1 exit and after
  any discovery-wiring change.

**New capability programs** (the next LLP 0032-style phase, new RFC
implementations) treat "guide page or explicit index GAP row" as part of
landing author-facing surface. This is convention in this RFC — the 0365
`Guide:` PR-line machinery with parsing epochs is the adopt-on-trigger
upgrade if convention visibly leaks.

## Plan

**Phase 1 — corpus + index + manifest + checks (the value phase).**
Create `guide/` with `index.md` (including the audience statement),
`conventions.md` + `frontmatter.schema.json` (adapted from 0365; compatible
core + Snapback extensions), and `capabilities.md` seeded by the
shipped-surface sweep with witnesses, owners, and the two day-one joins.
First pages in priority order: **getting-started** (both pages),
**clients/contract-adapter + react-dataprovider** (the diary-0010 gap),
**realtime/live-queries**, **testing/acceptance**,
**auth/sessions-and-principals + targets** (shipped-and-witnessed material
only; protecting-data follows as its witnesses land), and two recipes
(presence-cursors, hidden-hands). Land `guide-snippets` (transclusion-first)
and `guide-consistency` wired into `scripts/verify-local-proof`, the
`generate:guide-manifest` generator, the AGENTS.md / README pointers, the
`demos/_kit` README, the diary-loop line in AGENTS.md, and the retrieval-eval
protocol + fixtures.
*Exit criterion: the §5 retrieval eval passes on its seed intents, and the
`docs/contract-exact-integration.md` absorption (below) has landed.*

`docs/contract-exact-integration.md` is **absorbed** into `clients/` when
those pages land, leaving a pointer stub in the same change (0365 §6's
standing rule, adopted here as the standing rule for any future
author-facing doc a guide page replaces).

**Phase 2a — the served guide (§Design 4a; r4) — implemented 2026-07-15 (ENG-25102).**
`generate-guide-manifest.mjs` emits `guide/guide-flat.generated.md` plus one
`guide-flat.<section>.generated.md` per top-level manifest section (all
staleness-checked like the manifest); `build.rs` embeds the corpus and
restamps the embedded manifest to the exact server build; the
three `/_snapback/guide` routes carry their LLP 0031 registration and
hash/build-identity response headers; memory-server acceptance witnesses
the flat bytes and hash; and `operating.served-guide` is shipped with all
three routes classified in the surface map. This slice remains independent
of LLP 0042.

**Phase 2b — MCP projection — implemented 2026-07-16 (ENG-25111).**
`snapback mcp` re-serves the §4a embedded manifest, section flats,
whole-corpus bulk flat, and every manifest-named page as versioned read-only
resources over stdio. Resource
metadata repeats the guide hash and build commit, and `guide-consistency`
verifies the exact projection membership and page hashes against the manifest.
The server advertises no tools; LLP 0042's host-operation projection remains a
separate implementation slice.

**Phase 3 — admin console rendering.**
Implemented 2026-07-16 (ENG-25112). The Docs tab consumes the served generated
manifest and pages, rejects a page
whose content-hash/build-commit response identity differs from the manifest,
and renders a safe scalar block model with the console's own Contract
machinery. The conditional dependency check found no supported published
`@exact/markdown` boundary in the admin package set, so the implementation
does not couple Snapback to the sibling Exact source tree. Optional; the corpus
and served/MCP forms carry the agent-facing value.

**Ongoing.** The diary loop and reconcile-audit line (§5); the retrieval
eval re-run on discovery-wiring changes; the capability index updated as
programs land, with the joins keeping the joined surfaces closed; drift
warnings reviewed at the LLP 0016 reconcile cadence; escalation triggers
(§2, §5) fire the named 0365 upgrades if the light mechanisms leak.

## Open questions

1. **How much of the auth surface is teachable now.** The `maturity:` rule
   and the acceptance-witness requirement (§Design 1) bound this
   mechanically, but the Phase 1 page/spec boundary for `protecting-data.md`
   — which grant/barrier/lease behaviors have executable witnesses today —
   needs the sweep to answer precisely.
2. **Cross-repo link mechanics.** The seam rows need a reference form that
   works for an agent with both checkouts and degrades honestly for one
   without. Coordinate the convention with the Exact guide (and file the
   Exact-side reciprocal-row item under the 0365 program) so both sides use
   the same form; this is the one conventions change worth pushing upstream
   early.
3. **Where the guide bytes live off-checkout — resolved (r4): embedded in
   the binary and always served** (§Design 4a). The remaining sub-question
   is dev-mode freshness: whether a checkout-run server should serve the
   working-tree corpus instead of the embedded one (hash header
   disambiguating). v1 ships embedded-only; decide the override if the
   staleness ever bites (checkout authors read the files directly).
4. **A published-package form.** If Snapback's `@snapback/*` packages get a
   real npm publish closure, `@snapback/guide` following 0365 §3's ephemeral
   staging pattern becomes cheap, and would ride the same LLP 0041 decision
   as question 3. Not proposed now.
5. **A fast docs-only entry point.** Whether `guide-snippets` +
   `guide-consistency` get a standalone runner for docs-only edits, so the
   guide's edit loop doesn't pay the full local proof (clippy + cargo test +
   acceptance). Likely yes; decide when registering the checks.

## Alternatives considered

- **One shared guide (or shared package) across Exact and Snapback.**
  Rejected: different authorities, verification substrates, owners, and
  cadences; readers get the same value from cross-links at the seam. The
  shape is shared instead, and the rendering machinery may be shared later
  (§Relationship).
- **Clone 0365's full governance day one.** Rejected as disproportionate —
  but revised from r1: the parts of that governance that are load-bearing
  for honesty (witnesses, sound freshness identity, a repeatable eval, the
  joins over already-declared registries) are adopted in right-sized form
  now; only the heavy tooling (registry JSON over all surfaces, lock files,
  PR-line parsing) waits for its named triggers.
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
