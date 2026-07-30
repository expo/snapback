# LLP 0122: Installed-product coherence and packaging

**Type:** Research
**Status:** Review
**Systems:** Developer experience, Packaging, Tooling, Client integration, Documentation, Competitive evaluation
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:**
**Related:** LLP 0041, LLP 0062, LLP 0074, LLP 0111, LLP 0113, LLP 0114, LLP 0115, LLP 0116, LLP 0123, Diary 0022, Diary 0027, Diary 0028, Diary 0031, Diary 0038, Diary 0039

## Summary

Across every bakeoff diary, the single most repeated Convex preference is not
a feature. It is that Convex feels like one installed product: schema,
validators, functions, generated types, React hooks, local deployment, and
auth arrive as parts of one coherent loop behind `npm install convex` and a
single CLI. The matching Snapback complaint is equally stable: "The app still
imports authoring helpers and the client through monorepo-relative paths. It
felt like developing Snapback itself, not installing Snapback" (Diary 0022);
"Convex's best quality is coherence… Snapback must match Convex's coherence,
not merely its checklist" (Diary 0027).

The 2026-07-30 rerun (Diary 0039) sharpened the problem statement. The
eight-package `0.1.0` public closure went live under `latest` on 2026-07-26
with a byte-bound publication ledger and two-platform clean-machine proof
(LLP 0041), yet the seven-arm matrix ran on sibling-checkout imports three
days later. The problem is no longer "publish"; it is "make the published
closure actually usable and used" (LLP 0115 CV-1). This Research document
collects the evidence, decomposes "coherence" into facets that are more than
packaging, inventories the current package reality against the diaries'
complaints, and lays out the option space. It makes no decision; the custody
and gating calls it surfaces belong to the author and to LLP 0115's open
questions.

## What Convex does

Two evidence classes are deliberately kept separate here: general Convex
background (product facts not re-verified in the diaries) and diary-observed
behavior from the bakeoff matrices.

**General Convex background.** One npm package, `convex`, carries the server
validator vocabulary, function builders, React hooks, and browser/HTTP
clients as subpath exports of a single name. One CLI verb family
(`npx convex dev`) runs codegen, typechecks, starts or attaches the local
backend, and pushes functions in one loop. Code generation emits into the
application's own `convex/_generated/` directory, imported by app-relative
paths and committed alongside the app; the generated artifacts read as owned
by the application, not the framework. The documentation is written in
exactly the dialect an installed user types — the package name, the CLI
verbs, and the generated import paths in the docs are the ones on the user's
disk.

**Diary-observed.** The coherent TypeScript loop was the recurring verdict:
"Schema, functions, and client references formed the most coherent TypeScript
loop. There was little translation between database operation and React call"
(Diary 0022, Convex arm). Diary 0027's final ergonomics assessment names the
same property and adds that the loop extends to transactions, generated
types, hooks, local deployment, and auth. Diary 0038 measured functions ready
in 121 ms under anonymous local mode. The diaries also recorded the price and
the rough edges honestly: the coherence bundles an integrated runtime and
deployment model you must accept wholesale (Diary 0022); anonymous local
setup is beta — it prompted in a PTY despite agent-mode documentation,
downloaded backend and dashboard binaries, and required port coordination
across parallel projects (Diaries 0027, 0039); and the documented Auth.js
dependency carried a critical npm advisory at the time (Diary 0027). Notably,
when the first command shape failed, the agent discovered the working
`CONVEX_AGENT_MODE=anonymous` path "from installed source/CLI diagnostics"
(Diary 0022) — the installed product carried its own recovery path, which is
itself a coherence property.

## What Snapback does today

**Package inventory (spot-checked 2026-07-30).** `packages/` holds thirteen
directories. Nine form the public closure LLP 0041 enumerates, published
under `@ccheever/snapback-*` aliases because the `@snapback` npm scope is
controlled by someone else (`@snapback/cli` is an unrelated public 3.x
package): the two platform runtimes (`snapback-runtime-darwin-arm64`,
`snapback-runtime-linux-x64`), `snapback-contract`, `snapback-client`,
`snapback-codegen`, `snapback-vite`, `snapback-react`, `snapback-app-cli`,
and `snapback-cli`. Four sit outside it: `snapback-admin-client` is
`"private": true` and unversioned, consumed in-repo and served at
`/_snapback/admin/client.mjs`; `snapback-harness` is a directory of workerd
runtime assets, not an npm package at all; `snapback-hosted-supervisor` is
image-bound by design (0041: "not an unlisted tenth registry package"); and
`snapback-publication-authority` is internal release tooling.

**Publication state (per LLP 0041 headers, corrected in 0115 v0.3).** The
eight-package `0.1.0` closure has been public under `latest` since 2026-07-26,
with a ledger binding every staged tarball byte-for-byte to registry
artifacts, and GitHub-hosted macOS/arm64 and Linux/x64 clean-machine installs
whose aggregate satisfied the packaged-loop claim with no nonclaims. The
nine-package `0.1.1` candidate promotion (adding `@ccheever/snapback-react`,
a first-publish package) is in active flight behind 0041's publication state
machine — leases, propagation barriers, dependency-first CLI-root-last
promotion. Publication engineering is not the bottleneck; it is arguably the
most hardened subsystem in this space.

**What consumed it: nothing.** All seven Snapback rerun arms import codegen,
clients, and the acceptance helpers through paths into the sibling Snapback
checkout and invoke its binary directly; Dispatch's acceptance additionally
imports the admin client for authenticated cron inspection (Diary 0039 P0-1;
Diary 0038 §External consumption; scope corrected by 0115 v0.3 — seven arms,
and the admin client is Dispatch-specific). Diary 0038's phrasing is exact:
"External consumption is still a source-checkout exercise."

**The two named artifact gaps (LLP 0115 CV-1).** (1) The admin client is
inventoried by 0041 but excluded from the closure. (2) The acceptance test
helpers every arm imports — `demos/_kit/server-process.mjs` and
`demos/_kit/harness.mjs` (server lifecycle, vacuous-pass-guarded checks) —
are published by no document. Until both custody decisions are made, a clean
external repository cannot run a workout-arm-grade acceptance suite from
published artifacts (0041 §Open Questions, 2026-07-30 entry).

**The seams the Linux/package diaries recorded.** The 2026-07-29 staged
`0.1.1-llp0102.1` confirmations (Diaries 0027, 0028, 0031) proved the
package-only loop carries real apps, and recorded exactly where it stops
feeling like a product:

- `@snapback/client/online` is a published export with no TypeScript
  declaration; external builds fail with TS7016. Found independently in
  three apps (Todo, Diary 0027; Chat, Diary 0028; Linear, Diary 0029), and
  tracked in `issues/20260729-external-package-lifecycle-gaps.md`.
  Spot-checked 2026-07-30: still unfixed on current main —
  `packages/snapback-client/package.json` maps `"./online": "./online.mjs"`
  with no `types` condition and no `online.d.mts` exists (only
  `index`, `search`, `external-store`, and `canonical-client-value` carry
  `.d.mts` files; the `./rqs*` subpaths are in the same declarationless
  state). `online.mjs` is a twelve-line re-export of declared symbols from
  `index.mjs`, so the fix is one small declaration file plus an export-map
  condition.
- The first dry run under isolated HOME could not find Volta's Node until
  `VOLTA_HOME` was bound explicitly (Diary 0027).
- A collaborative `0002` umask produced a group-writable startup carrier
  that Snapback correctly refused — but the diagnostic did not name the
  failed mode, ownership, or ACL predicate (Diaries 0027, 0028).
- Installed `snapback stop` retires the server, ready marker, and
  impersonation carrier but leaves its owner-only `.secret-read-root` for
  the caller to clean up (Diaries 0027, 0028).
- Hermes-from-source was "by far the most expensive prerequisite for a small
  demo" when no prepared artifact matched (Diary 0028); Linux preparation
  needed lane-local ICU/curl development files and the exact Hermes patch
  stack (Diary 0027).
- "The clean-project path is still not boring": the external Research Room
  copy had to invoke the installed codegen module because the CLI then had
  no `generate` subcommand, rewrite define/client/contract/harness imports,
  supply the sessions inspection protocol by hand, and change a hardcoded
  effect receiver port; fresh-worktree setup required a repository-root
  `bun install` because ordinary `npm install` fails on the workspace
  protocol (Diary 0031).

**What has already improved on current main.** Several diary complaints are
fixed and must not drive the option choice: the packaged CLI now dispatches
`new`, `generate`, `dev` (with the `--client` arm), `doctor`, and `deploy`
(`packages/snapback-cli/index.mjs`), closing Diary 0031's missing-`generate`
complaint; `templates/` ships `react` and `todo-contract`; the packaged
doctor executes a full disposable VM/bundle/query/mutation/live/shutdown
slice; and manifest-only custody means committed generated bytes are now
*smaller* than Convex's committed tree (Diary 0039 §Quantitative shape).

**The guide speaks the checkout dialect.** The guide's own getting-started
page (`guide/getting-started/your-first-backend.md`) teaches
`node packages/snapback-codegen/index.mjs myapp/snapback` and imports
`defineSchema` from `'../../_kit/define.mjs'` — the source-checkout dialect
— on the same page that mentions `snapback new my-app --template react`. The
CI-verified snippet mechanism (LLP 0061) pins guide code to repo-resident
demos, which structurally biases every page toward checkout-relative paths.
An external reader is taught to be a monorepo resident.

## How they differ, and why agents preferred Convex

Coherence is commonly reduced to "publish packages." The diaries support a
richer decomposition; the nine-package closure addresses mainly the first
facet.

**1. Naming unity.** Convex has one name that is simultaneously the install
name, the import name, the CLI name, and the documentation vocabulary.
Snapback currently has three dialects for the same thing: the authoring
identity (`@snapback/*`), the install identity (`@ccheever/snapback-*`
aliases, because the brand scope is squatted), and the repo dialect
(`demos/_kit/...`, `packages/snapback-codegen/index.mjs`, sibling-checkout
binaries) that the guide and every existing app actually use. Aliases keep
authored imports stable — a real design win of 0041 — but the seam is
visible wherever a user reads a package.json or an install command.

**2. One CLI entry point.** `npx convex dev` is the whole loop. Snapback
splits across the `snapback` developer-loop CLI, the distinct
`@snapback/app-cli` artifact-driven application/agent command (LLP 0062),
direct invocation of the codegen module (still what Diary 0039's arms and
the guide do), and `scripts/bootstrap-ibex-runtime` for anyone inside the
repo. The packaged CLI has genuinely converged — the verbs exist now — but
none of the flagship evidence (the matrix, the guide) routes through it yet.

**3. One documentation surface.** Convex's docs are written in the installed
dialect. Snapback's guide is CI-verified — a real advantage — but verified
against checkout-resident demos, so its truth-anchoring mechanism currently
*prevents* it from being written in the dialect an external user types. A
coherence program that ships packages but leaves the guide teaching
`../../_kit/define.mjs` has not shipped coherence.

**4. Generated artifacts that feel owned by the app.** Convex's
`_generated/` sits inside the app and is the entire consumption surface.
Snapback's generated artifacts also live in the app tree, and manifest-only
custody made their footprint honest — but the generated app graph must be
combined with framework packages, a native binary, and (today) a sibling
checkout to be usable. The app owns its manifest; it does not yet own its
whole consumption story.

**5. The runtime as silent substrate.** Convex downloads its local backend
binary behind the CLI and the diaries barely mention it. Snapback's native
Hermes framework is a visible, load-bearing seam: bootstrap ordering, relink
incidents, `ex_hermes_create_no_eval()` refusals after link-and-launch
passed (Diary 0038; LLP 0115 CV-2/CV-3), Hermes-from-source fallbacks. An
installed product hides its runtime unless the runtime has something to say.
This facet is owned by the sibling research document LLP 0123
(runtime-readiness and operational edges); it is listed here because users
experience it as an installation property, not an operations property.

**6. The agent lens.** Every diary was written by an AI agent building an
app, which makes "boring" measurable: exactly one documented noninteractive
path per task (Diary 0027's explicit lesson); diagnostics that name the
failed predicate rather than the failed vibe (the umask refusal); commands
in the docs that equal the commands on disk; no environment archaeology
(`VOLTA_HOME`); cleanup that is idempotent and total (`.secret-read-root`).
Snapback's evidence culture — stable `SNAPBACK_*` codes, receipts, refusal
over guessing — is an asset here that Convex does not match, but several
diary cases show the codes stopping at refusal instead of continuing to
repair. Convex's best agent moment was the reverse: the product's own
diagnostics taught the agent the working invocation.

## Option space

No option below is selected. Several are complementary rather than
exclusive; the final shape is an author decision that LLP 0115 CV-1 and its
open question 5 partially gate.

### Option 1 — Finish the CV-1 path as specified

Complete the in-flight nine-package promotion under 0041's gates, close the
two artifact-custody gaps, rebuild at least one full workout arm in a clean
external repository from published artifacts only, and give the matrix
harness an install-from-published-channel mode.

*What it buys:* the published closure becomes exercised instead of merely
existing; future reruns measure the product external users get; the
fixture-level proofs 0041/0111/0114 already ran get workout-arm-scale
confirmation. *What it does not buy:* naming unity (still `@ccheever/*`
aliases), the guide dialect, or the runtime seam; and its exit is
unsatisfiable until the admin-client/test-helper custody decisions (Option
6) and the npm-gating decision (Option 5) are made. This is the necessary
floor, not the whole answer.

### Option 2 — Single-binary distribution

One `snapback` binary embedding runtime, CLI, and codegen; `npx`-able via a
thin wrapper package, or fetched directly. This is the strongest coherence
story available: one artifact, one name, and the runtime disappears into the
product the way Convex's local backend does.

*Tradeoffs:* codegen and the dev loop are JavaScript running under Node
today; embedding them means either bundling a JS runtime for tooling into
the native binary or keeping a two-artifact story (binary + one package),
which is already close to what the runtime packages do. On macOS the binary
dynamically loads `hermesvm.framework` via `LC_RPATH` — the single-file
ideal collides directly with the native framework problem, and the CV-2
incident class (framework refreshed after link) is an argument both ways:
fewer moving parts if truly embedded, but the embedding work is exactly the
runtime-readiness surface LLP 0123 documents. It also cuts against the
nine-package custody machinery: per-package digests, dependency-ordered
promotion, and platform-split optional dependencies would collapse into one
release lane — simpler to consume, coarser to attest.

### Option 3 — Collapse the package count

Fewer, fatter packages: for example one `snapback` meta-package whose
dependencies pull client, codegen, contract, react, and the platform
runtime, mirroring how `convex` exposes subpaths of one name.

*Tradeoffs:* the diaries never complained about the count — they complained
about names, paths, and missing declarations — so the count may be the wrong
variable. A meta-package can sit on top of the existing closure without
changing it (npm dependency resolution does the work), buying the
`npm install snapback`-shaped first command cheaply if a suitable unscoped
or scoped name can be secured. Against consolidation: the closure's custody
granularity (per-package tarball digests, platform-filtered optional
runtime edges, dependency-first promotion) is built and battle-tested.
For consolidation: every additional package is another export map that can
ship without a `types` condition — the `online.d.mts` class of defect
scales with surface count.

### Option 4 — `create-snapback-app` as the primary onboarding artifact

Make scaffolding the front door: one create command that emits an app whose
imports are published package names, whose scripts call the packaged CLI,
and whose acceptance uses whatever Option 6 decides for helpers. LLP 0114's
React starter and packed cold-install gate are most of this; the option is
to promote that fixture to the documented default entry point and write the
guide's first hour against it.

*Tradeoffs:* this is how Convex, Next, and Expo actually deliver their
first-hour coherence, and it gives the guide an installed-dialect corpus to
verify against (fixing facet 3 structurally). The risk is masking rather
than fixing: a scaffold can hide incoherent seams that then resurface at
the first non-scaffolded step; and a scaffold whose template drifted from
the packages is worse than none. Mitigation exists in-house: the packed
cold-install gates already exercise templates from tarballs. The create
name itself needs a registry probe before anything relies on it, given the
`@snapback` squatting history.

### Option 5 — Decide the npm-gating question (LLP 0115 OQ5)

Not a packaging design but the decision that gates every option's exit.
LLP 0111 serializes default-channel (`latest`) promotion of the nine-package
closure behind the complete hosted Fly qualification journey; LLP 0074
makes public npm publication a parallel gate independent of hosted
milestones. Both cannot govern the next promotion.

*For 0111's serialization:* one qualification spine — the capability
carrier binds the post-promotion ledger, so promoting `latest` early risks
advertising a closure whose hosted claims lag; and a `latest` that changes
more often than qualification completes weakens the receipt story.
*For 0074's parallel gate:* the rerun ranked a boring public install as the
top P0 lever, and the local closure's value does not depend on hosted
milestones — Diary 0039's arms needed exactly zero hosted capability;
serializing repeats the pattern where Snapback's strongest local story
waits on its weakest hosted one. *The fact pattern:* the eight-package
`0.1.0` closure reached `latest` on 2026-07-26, the day before 0111's gate
was written — so the conflict is live for `0.1.1` and every closure after.
Exact-version candidate-tag installs are available pre-hosted under 0111
steps 1–2, but a pinned candidate tag is not the boring default install the
diaries describe. This document lays out both sides and stops; the call is
the author's.

### Option 6 — Admin-client and test-helper custody

Per artifact, three shapes each (0041 §Open Questions):

- *Admin client:* (a) admit `@snapback/admin-client` to the closure as a
  tenth package — clean but grows the public API surface and its
  compatibility promise; (b) fold it into `@snapback/client` or the CLI —
  fewer names, but couples admin-protocol churn to the app-client version;
  (c) endorse the served `/_snapback/admin/client.mjs` path for external
  use — zero packaging cost and always version-matched to the running
  server, but undiscoverable, untypeable without a published declaration,
  and unusable offline.
- *Test helpers (`demos/_kit/server-process.mjs`, `harness.mjs`):*
  (a) publish a test-helper package — makes workout-grade acceptance a
  supported external activity; (b) fold server lifecycle into the CLI
  (a `snapback test`-adjacent verb) and keep assertion helpers thin;
  (c) endorse vendoring, or the Codex pre-implementation review's variant:
  keep the helpers a digest-pinned evaluation instrument, deliberately not
  public API — honest about support cost, but then external users get no
  paved acceptance story, which the diaries suggest agents specifically
  want (the vacuous-pass guards were repeatedly praised).

The cross-cutting consideration: CV-1's exit needs *a* decision more than it
needs any particular one.

### Cheap moves under every option

Whichever shape wins, some fixes are option-independent and already
ticketed: a `types` condition and declaration for every public export
(`issues/20260729-external-package-lifecycle-gaps.md`); `snapback stop`
retiring every sidecar it created or returning a typed cleanup plan; secure
refusals naming the failed inode predicate; and rewriting the guide's first
hour in the installed dialect (adjacent to LLP 0115 CV-13). These are small,
and the diaries suggest their coherence yield is disproportionate: an agent
that hits TS7016 on the first import does not care that the publication
state machine has Ed25519-signed leases.

## Findings

1. **Coherence is the most durable cross-diary Convex preference, and it
   survived the feature catch-up.** After search, inline handlers, result
   contracts, pagination, and custody all landed, the rerun still names the
   "installed, coherent TypeScript workflow" as Convex's first advantage
   (Diary 0039). The complaint is stable from Diary 0022 through 0039.
2. **The problem moved from publication to adoption.** The `0.1.0` closure
   was public, ledger-bound, and clean-machine-proven three days before the
   matrix ran on sibling-checkout imports. Nothing in the repo's own
   flagship evidence consumes what it publishes. CV-1's sharpened framing
   ("make the published closure actually usable and used") is correct.
3. **Coherence decomposes into at least five facets — naming unity, one CLI
   entry point, one documentation dialect, app-owned artifacts, and a
   silent runtime — and the nine-package closure addresses mainly the
   install facet.** The guide teaching `../../_kit/define.mjs` and the
   `@ccheever/*` alias seam persist after promotion completes.
4. **Two named artifacts block workout-grade external acceptance and are
   custody decisions, not engineering:** the private admin client and the
   `demos/_kit` server/harness helpers (0041 §Open Questions; 0115 CV-1).
5. **The known small defects are still live on current main.** The
   `@snapback/client/online` declaration gap — found independently in three
   apps — remains unfixed as of 2026-07-30 (`"./online": "./online.mjs"`
   with no `types` condition; no `online.d.mts`), and the `./rqs*` subpaths
   share the pattern. The guide's first-backend page still teaches the
   checkout dialect.
6. **Several diary complaints are already fixed and must not drive the
   option choice:** the packaged CLI now owns `new`/`generate`/`dev`/
   `doctor`/`deploy`, templates exist, the packaged doctor runs a full
   vertical slice, and committed generated custody is smaller than
   Convex's.
7. **The 0111-vs-0074 npm-gating conflict gates every option's exit.** No
   packaging shape can deliver "boring default install" while which
   document governs `latest` promotion is undecided. It is the single
   highest-leverage author decision in this space (LLP 0115 OQ5).
8. **Agent-boring is a distinct, specifiable requirement.** The diaries'
   authors are agents; one noninteractive path per task, predicate-naming
   diagnostics, doc commands identical to installed commands, and total
   cleanup are part of coherence. Snapback's evidence culture is an asset
   here when pointed at repair, not only refusal.

## Confidence

- **High:** the publication state, package inventory, export-map and
  declaration facts, CLI verb dispatch, and guide dialect were all checked
  against the working tree on 2026-07-30; diary quotes are verbatim with
  file citations.
- **Medium:** the general Convex background facts (single package, CLI
  behavior, `_generated/` custody) are consistent with the diaries but were
  not re-verified against current Convex releases; Convex's anonymous local
  mode is beta and its edges may move (0115 watch item).
- **Medium-low:** the option tradeoff judgments. No registry probe was run
  for a `create-snapback-app` or unscoped meta-package name; no
  scaffold-to-first-row timing exists for the packaged path (LLP 0074's
  preregistered comparison remains the instrument that would measure it);
  and the single-binary option's feasibility is asserted from the known
  framework layout, not a spike.

## Open questions

1. Which document governs default-channel promotion — 0111's hosted-gated
   ordering or 0074's parallel gate? (Restates LLP 0115 OQ5; author
   decision.)
2. What custody do the admin client and the acceptance helpers get —
   publish, fold, or endorse served/vendored paths? (Restates 0041's
   2026-07-30 open question; author decision that CV-1's exit requires.)
3. Is `@ccheever/snapback-*` an acceptable durable public brand, or should
   an organization-owned scope be secured before coherence is marketed?
   0041 designed the alias to be swappable without import churn; the
   question is when, not whether it is possible.
4. Should the guide's snippet-authority mechanism (LLP 0061) admit an
   installed-dialect corpus — e.g., the packed starter fixtures — so pages
   can be CI-verified in the dialect external users actually type?
5. Does the single-binary option warrant a joint spike with LLP 0123's
   runtime-readiness work, since both live on the same Hermes-framework
   seam?
6. Where does `@snapback/app-cli` (LLP 0062) fit a one-CLI story — a
   subcommand namespace of `snapback`, a peer with a clearly divided
   audience, or an internal surface not marketed to app authors?

## Relationship to LLP 0115 and owning documents

LLP 0115 CV-1 is the execution owner of the external install path, and this
document is research input to it: evidence consolidation and option
analysis, no decisions. LLP 0041 remains the lead owner of packaging, the
package closure, and the publication state machine; LLP 0111 owns hosted
sequencing and the channel-gating position that conflicts with LLP 0074's;
LLP 0113 owns qualification/publication authority (and by design cannot mint
stable maturity); LLP 0114 owns the React starter and its packed
cold-install gate; LLP 0062 owns the generated app CLI; LLP 0061 owns the
guide mechanism that question 4 would amend. Substantive design changes land
in those documents, not here.

This document is part of the Convex-parity research series:

| LLP | Topic |
| --- | --- |
| 0116 | Convex-parity research series (overview) |
| 0117 | TypeScript type flow parity |
| 0118 | Handler composition and helper reuse |
| 0119 | Reactive-by-default and live search |
| 0120 | Relational composition and aggregation |
| 0121 | Transactional one-off scheduling |
| 0122 | Installed-product coherence and packaging (this document) |
| 0123 | Runtime readiness and operational edges |
| 0124 | Product breadth: storage and vector search |
| 0125 | Concurrency and conflict ergonomics |
