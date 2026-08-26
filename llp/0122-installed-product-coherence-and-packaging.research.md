# LLP 0122: Installed-product coherence and packaging

**Type:** Research
**Status:** Active
**Systems:** Developer experience, Packaging, Tooling, Client integration, Documentation, Competitive evaluation
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:** 2026-08-07 (LLP 0189 alignment sweep: verification-cadence/claim-gating clauses re-scoped or annotated to the LLP 0189 D-3/D-6 defaults). 2026-08-06 (closure widens to ten at 0.1.10: sitting #4
ruling 2 adds `@expo/snapback-expo` to the publishable staging closure —
inventory/publish script/tests carry ten; the promotion vector stays nine
until the close-out's first-publication handling, LLP 0041). 2026-08-06 (second fast-path release: the nine-package closure
is live on npm `latest` at 0.1.9 from `7c16f6d0b8`, carrying the day's six
agent-efficiency landings; receipts in LLP 0041 §Fast-path pre-consumer
release). 2026-08-02 (decision-sitting propagation: Option 5 and OQ1 are
answered in favor of LLP 0074's parallel npm gate, with LLP 0134's maturity
bar governing the locally provable closure and hosted claims staying separately
gated; source: `issues/20260802-author-decision-packet.md`). 2026-07-30 (v0.3, round-2 delta corrections — round-2 delta
reviews in
`reviews/0122-installed-product-coherence-and-packaging.fable.md` and
`reviews/0122-installed-product-coherence-and-packaging.codex.md`, both
NOT READY on delta-only items, with all round-1 concerns recorded as
resolved or partially resolved; all five round-2 items verified against
the tree and applied: Option 7's rename recast from "re-proving is
mechanical" to a publication-authority/proof-system migration whose
hard-coded name boundaries — the protocol's nine-name table and scope
regex, the exact-name schema `const`s, the cold-install `ccheever`
scope-preset refusal — are named and their costs threaded into each
path; the admin-client custody costing corrected (credential authority
is server-side under every shape, subpath reachability distinguished
from browser-bundle inclusion, client-folding and CLI-folding costed
separately); a runtime-recovery-after-consolidation probe added to the
empirical agenda and the "closed list" claim qualified to
closed-by-review; the LLP 0123 cross-reference repointed to its
prebuilt-hermetic-runtime-distribution option, Option 3 after 0123's
same-day renumbering; the facet-3 snippet-location claim corrected —
the authoring-loop page anchors packages via `examples:` frontmatter,
and the package-sourced snippet fences live on other guide pages.)
2026-07-30 (v0.2, round-1 dual-family review corrections —
verbatim reviews in
`reviews/0122-installed-product-coherence-and-packaging.fable.md` and
`reviews/0122-installed-product-coherence-and-packaging.codex.md`; all 13
concerns verified against the tree, 13 applied, 0 rejected: the
guide-dialect diagnosis reframed as source-corpus/page-composition rather
than a structural limit of LLP 0061's mechanism; a per-option
no-evidence-regression analysis added against 0115's governing constraint
1, with the admin client's privileged-authority surface and the helpers'
checkout entanglement decomposed against current code; naming-transition
paths added as Option 7 with the ledger/`latest`-continuity interaction;
the artifact-gap blocking claim split (any arm vs. Dispatch vs. full CV-1
exit); Option 1/Option 2 framing conditioned on current owners; the
empirical agenda closed into §Empirical questions; the client declaration
enumeration corrected to five declared subpaths; the 0041 tenth-package
paraphrase requoted verbatim; the `templates/` path qualified; Diary 0029
added to Related; the `ex_hermes_create_no_eval()` attribution split
between Diary 0038's incident and 0115 CV-2/Diary 0039's symbol name.)
**Related:** LLP 0041, LLP 0062, LLP 0074, LLP 0111, LLP 0113, LLP 0114, LLP 0115, LLP 0116, LLP 0123, Diary 0022, Diary 0027, Diary 0028, Diary 0029, Diary 0031, Diary 0038, Diary 0039

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
image-bound by design (0041: "not a tenth public package in this
closure"); and `snapback-publication-authority` is internal release
tooling.

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

**What the flagship rerun consumed: none of the public closure.** All
seven Snapback rerun arms import codegen, clients, and the acceptance
helpers through paths into the sibling Snapback checkout and invoke its
binary directly; Dispatch's acceptance additionally imports the admin
client for authenticated cron inspection (Diary 0039 P0-1; Diary 0038
§External consumption; scope corrected by 0115 v0.3 — seven arms, and the
admin client is Dispatch-specific). Diary 0038's phrasing is exact:
"External consumption is still a source-checkout exercise." The scope of
the claim matters: the staged package confirmations below did consume
package-only artifacts; the flagship matrix did not.

**The two named artifact gaps (LLP 0115 CV-1).** (1) The admin client is
inventoried by 0041 but excluded from the closure. (2) The acceptance test
helpers every arm imports — `demos/_kit/server-process.mjs` and
`demos/_kit/harness.mjs` (server lifecycle, vacuous-pass-guarded checks) —
are published by no document. Their blocking scopes differ. The helper gap
blocks *any* external workout arm, since every arm's acceptance imports
the helpers. The admin-client gap blocks Dispatch specifically: 0115
CV-1's exit lets the first external arm be Campfire or Streak Lab, with
"the admin-client proof rides Dispatch or a separate fixture." Closing
CV-1 as written needs both custody decisions (0041 §Open Questions,
2026-07-30 entry); a first published-artifacts arm needs only the helper
decision.

**The seams the Linux/package diaries recorded.** The 2026-07-29 staged
`0.1.1-llp0102.1` confirmations (Diaries 0027, 0028, 0031) proved the
package-only loop carries real apps, and recorded exactly where it stops
feeling like a product:

- `@snapback/client/online` is a published export with no TypeScript
  declaration; external builds fail with TS7016. Found independently in
  three apps (Todo, Diary 0027; Chat, Diary 0028; Linear, Diary 0029), and
  tracked in `issues/closed/20260729-external-package-lifecycle-gaps.md`.
  Spot-checked 2026-07-30: still unfixed on current main —
  `packages/snapback-client/package.json` maps `"./online": "./online.mjs"`
  with no `types` condition and no `online.d.mts` exists (five subpaths
  carry declarations — `.`, `./app-data`, `./canonical-client-value`,
  `./external-store`, and `./search`; `./agent-authority`,
  `./hosted-browser`, and the `./rqs*` subpaths share `./online`'s
  declarationless state). `online.mjs` is a twelve-line re-export of
  declared symbols from `index.mjs`, so the fix is one small declaration
  file plus an export-map condition.
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
complaint; `packages/snapback-cli/templates/` ships `react` and
`todo-contract`; the packaged doctor executes a full disposable
VM/bundle/query/mutation/live/shutdown slice; and manifest-only custody
means committed generated bytes are now *smaller* than Convex's committed
tree (Diary 0039 §Quantitative shape).

**The guide speaks the checkout dialect — by corpus choice, not by
mechanism.** The guide's own getting-started page
(`guide/getting-started/your-first-backend.md`) teaches
`node packages/snapback-codegen/index.mjs myapp/snapback` and imports
`defineSchema` from `'../../_kit/define.mjs'` — the source-checkout dialect
— on the same page that mentions `snapback new my-app --template react`.
The cause is narrower than the symptom. LLP 0061's snippet checker accepts
any CI-exercised source file — "a demo acceptance suite, package test, or
proof script" (`guide/conventions.md`) — and the authoring-loop page
already lists the packaged templates and a package test among its examples
while teaching installed commands. The first-backend page's dialect is a
source-corpus and page-composition choice: its transcluded snippets were
all selected from the checkout-resident todo demo. The effect on an
external reader is unchanged — they are taught to be a monorepo resident —
but the repair is corpus recomposition, not an LLP 0061 amendment.

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
dialect. Snapback's guide is CI-verified — a real advantage — but its
first-hour pages transclude from checkout-resident demos, so they teach
the checkout dialect. That is corpus selection, not the mechanism:
LLP 0061's checker accepts any CI-exercised source; the authoring-loop
page already anchors the packaged templates and a package test through
its `examples:` frontmatter; and package-sourced snippet fences are
already live elsewhere in the guide —
`guide/backend/standard-patterns.md` transcludes four snippets from
`packages/snapback-codegen/standard-patterns.test.mjs`, with more on the
client and auth pages. That corrected placement is stronger evidence,
not weaker: the mechanism does not merely permit installed-dialect
sources in principle, it verifiably renders them on guide pages today.
A coherence program that ships packages but leaves the guide
teaching `../../_kit/define.mjs` has not shipped coherence.

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
passed (the incident is Diary 0038's, phrased there as promise-rejection
checkpoint tracking being unavailable; the symbol name is LLP 0115
CV-2's and Diary 0039 P0-2's), Hermes-from-source fallbacks. An
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
6) and the npm-gating decision (Option 5) are made. Under the current
owners — 0041's closure architecture and 0115 CV-1's exit as written —
this is the required floor, not the whole answer; a genuine single-binary
or consolidation decision (Options 2–3) would amend those owners and could
make parts of this exact nine-package/default-channel path transitional.

### Option 2 — Single-binary distribution

One `snapback` binary embedding runtime, CLI, and codegen; `npx`-able via a
thin wrapper package, or fetched directly. On the naming and silent-runtime
facets this is the strongest story on offer — one artifact, one name, and
the runtime disappears into the product the way Convex's local backend
does — but as an overall ranking that is a hypothesis until the facets it
does not obviously help (TypeScript imports, editor types, browser
delivery, attestation, runtime recovery) are compared. The intermediate
shape — runtime fetched on demand behind the CLI, Convex's literal model —
is LLP 0123's prebuilt-hermetic-runtime-distribution option (Option 3
after 0123's v0.2 renumbering) and is not re-analyzed here.

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

*Tradeoffs:* scaffold-first onboarding is the delivery model Convex, Next,
and Expo use for their first hour (general industry background, not
diary-verified), and it enlarges the installed-dialect corpus the guide
can verify against — though facet 3 does not require it: LLP 0061's
mechanism already accepts the existing packed fixtures as snippet
sources. The risk is masking rather than fixing: a scaffold can hide
incoherent seams that then resurface at
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

**Answered 2026-08-02.** Adopt LLP 0074's parallel gate. The locally
provable nine-package closure may promote to `latest` when it satisfies LLP
0134's maturity bar (as re-scoped by LLP 0189 D-6); that promotion does not
advertise or qualify any hosted capability. LLP 0111's hosted-serialized ordering is superseded on this point
only, and its hosted evidence gates remain in force. Source:
`issues/20260802-author-decision-packet.md`.

### Option 6 — Admin-client and test-helper custody

Per artifact, three shapes each (0041 §Open Questions):

- *Admin client:* first, what it is. Not an ordinary client module but
  privileged credential-handling code: master admin tokens,
  console-credential exchange, memory-only secret-read leases, and
  credential redaction (`packages/snapback-admin-client/index.mjs`).
  One boundary fact frames every shape: the credential authority is
  server-side — tokens are validated by the server under all of the
  shapes below, and the served `/_snapback/admin/client.mjs` is the
  same package file byte-for-byte (`crates/snapback/src/admin.rs` embeds it with
  `include_str!`) — so no custody choice moves the authority; what the
  shapes vary is discoverability, typing, and where the privileged
  client code is resolvable from. The shapes: (a) admit
  `@snapback/admin-client` to the closure as a tenth package — clean
  separation but grows the public API surface and its compatibility
  promise; (b1) fold it into `@snapback/client` — fewer names, but
  couples admin-protocol churn to the app-client version and makes the
  privileged operations resolvable from every app dependency graph; a
  subpath export is reachability and audit surface, not automatic
  browser-bundle inclusion — an application must import it before any
  bundler ships it; (b2) fold it into the CLI — keeps admin operations
  out of app dependency graphs entirely (the CLI is a dev-time tool,
  not a bundler input) at the price of a command-shaped rather than
  importable admin surface; its cost profile is materially different
  from (b1), so the two fold-in variants must be weighed separately;
  (c) endorse the served path for external use — zero packaging cost
  and always version-matched to the running server (this shape changes
  delivery, not authority), but undiscoverable, untypeable without a
  published declaration, and unavailable before the server is up (most
  admin operations need a running server anyway; the sharper limit is
  tooling that wants types or imports at build time). The
  implementation already describes the served path as an
  external-tooling surface (`crates/snapback/src/admin.rs`); the custody decision is
  whether that implementation intent becomes a normatively endorsed
  public contract.
- *Test helpers (`demos/_kit/server-process.mjs`, `harness.mjs`):* first,
  what they are. `server-process.mjs` is not a portable helper awaiting a
  package name: it imports checkout scripts
  (`scripts/lib/process-tree.mjs`, `scripts/runtime-link-smoke.mjs`),
  checkout provenance readers, and CLI internals
  (`packages/snapback-cli/runtime-recovery.mjs`), and carries a
  `cargo run` source-tree fallback rung. A packaged acceptance surface
  also already exists: `snapback accept comparator`, configured with
  `defineComparatorProfile` from `@snapback/cli/comparator`, runs the
  five-property comparator from an application root
  (`guide/testing/acceptance.md` §The backend-comparator profile). The
  shapes: (a) publish a test-helper package — makes workout-grade
  acceptance a supported external activity, but hides a substantial
  boundary decomposition (each checkout import above must be cut,
  replaced, or published); (b) fold server lifecycle into the CLI — a
  `snapback test`-adjacent verb or an extension of the existing
  comparator surface, possibly with a portable lifecycle SDK beneath it —
  and keep assertion helpers thin; (c) endorse vendoring, or the Codex
  pre-implementation review's variant: keep the helpers a digest-pinned
  evaluation instrument, deliberately not public API — honest about
  support cost, but then external users get no paved acceptance story
  beyond the comparator, and the diaries suggest agents specifically want
  one (the vacuous-pass guards were repeatedly praised).

The cross-cutting consideration: CV-1's exit needs *a* decision more than it
needs any particular one.

### Option 7 — Naming-transition paths (facet 1)

Facet 1 is the one facet no option above targets directly; OQ3 names the
decision. The analyzable paths:

- *(a) Accept `@ccheever/snapback-*` as durable.* Zero evidence and zero
  migration cost: the byte-bound ledger, the clean-machine receipts, and
  `latest` continuity all stay bound to the names they were minted for,
  and the name-bound proof machinery (below) is untouched. The cost is the seam
  itself — a personal scope as public brand, visible in every
  package.json and install command — and the authoring/install split
  persisting indefinitely.
- *(b) Acquire the `@snapback` scope.* npm operates a public dispute
  process for name and scope conflicts (general industry background; its
  applicability to this specific squat is unprobed), and private
  negotiation with the current holder is also possible. Outcome and
  timeline are outside the project's control; the path can run in the
  background while (a) holds. Winning the scope only opens the migration
  priced below — it does not finish it.
- *(c) Secure a fresh unsquatted organization scope.* Available on demand
  and organization-owned, but forks the public identity: the brand
  becomes a third name that is neither the authoring identity nor the
  current install identity. Pays the same migration price as (b).
- *(d) An unscoped `snapback` or create-name for the front door only.*
  Pairs with Options 3–4: one unscoped meta or scaffold name over the
  scoped closure. Additive rather than migratory — the scoped closure
  and its proof machinery are untouched unless the new name joins the
  promoted closure. Gated on the unrun registry probe (§Empirical
  questions).

The evidence interaction is the load-bearing part. 0041 designed the alias
so the brand scope "may replace this public alias without changing
authored imports" — import churn is solved. Nothing else about a scope
change is mechanical. First, history: the publication ledger and the
two-platform clean-machine receipts bind `@ccheever/snapback-*` tarballs
byte-for-byte, and new names start with empty version history and no
`latest` continuity. Under LLP 0115's no-evidence-regression constraint,
receipts describing packages users no longer install have regressed in
force even though no byte changed, so a rename obliges re-running the
public-proof suite under the new names. Second, the machinery that would
run that suite is itself name-bound, not name-parametric: the
publication authority hard-codes the nine `@ccheever/snapback-*` names
and enforces the scope by regex
(`packages/snapback-publication-authority/protocol.mjs`), its
lease-request schema pins each package name as an exact-name `const`,
and the cold-install proof refuses any publication ledger whose scope
preset is not `ccheever`, deriving every expected alias from that scope
(`scripts/snapback-package-cold-install-lib.mjs`). A scope change is
therefore a publication-authority and proof-system migration — protocol
name table and scope regex, schema regeneration, cold-install-preset
change, and re-anchoring of ledger lineage across the name boundary —
followed by the re-proof, and it amends LLP 0041 and the 0113-owned
authority. That is the cost paths (b) and (c) buy into and path (a)
avoids; path (d) sidesteps it only while the front-door name stays
outside the promoted closure. Sequencing follows: a rename costs least
while the receipt corpus is small, and every additional proof bound to
the alias raises the price of moving. Which price to pay, and when, is
OQ3's author decision.

### Options against the no-evidence-regression constraint

LLP 0115's first governing constraint — ergonomic work must not weaken an
evidence boundary — was not applied option-by-option in v0.1; this
subsection closes that gap. Dimensions evaluated: install/import
coherence, authority and credential separation, exact version/runtime
matching, package and binary provenance (ledger lineage), clean-machine
proof, compatibility/version skew, offline and pre-launch behavior,
browser bundle exposure, the workout-evidence-versus-supported-testing
boundary, and required amendments to owning LLPs.

- *Option 1 (finish CV-1):* evidence-neutral or evidence-positive on
  every dimension — it exercises the existing ledger, receipts, and
  clean-machine proofs rather than changing them. Its only evidence risk
  is inherited from Option 6's custody choices. No owner amendments.
- *Option 2 (single binary):* the heavy case. Per-package tarball
  digests, platform-filtered optional runtime edges, and dependency-first
  promotion collapse into one artifact lane — simpler to consume, coarser
  to attest. Component digests, platform-runtime attribution, rollback
  granularity, and candidate-to-promoted ledger lineage all need
  re-derivation, and the two-platform clean-machine proof must re-run
  against the new artifact. Amends 0041 and touches 0111/0113's
  promotion machinery.
- *Option 3 (meta-package):* near-neutral in its cheap form — a
  meta-package over the unchanged closure adds one name and one export
  map to the ledger without disturbing existing receipts. Each added
  package is another surface that can ship a declaration gap (the
  `online.d.mts` class), and the meta-package's dependency pins must not
  blur exact-version matching. Amends 0041's closure enumeration.
- *Option 4 (create-first onboarding):* evidence-neutral for the
  packages; the risk is a template drifting from the packages it names,
  which the packed cold-install gates (LLP 0114) already guard. A
  scaffold that hides seams does not weaken evidence, but it can weaken
  the diagnostic story if failures surface past the scaffold boundary.
  No owner amendments beyond 0114.
- *Option 5 (npm gating):* pure governance — it decides *when* evidence
  is presented as `latest`, not what evidence exists. The regression risk
  is advertising a `latest` whose hosted claims lag (0111's argument),
  weighed against a candidate-tag-only install external users never
  exercise (0074's argument). Either way the receipts themselves are
  unchanged.
- *Option 6 (custody):* for the admin client, the credential authority
  boundary is server-side under every shape — no custody choice moves
  it (see the option's own analysis); what the shapes vary is where the
  privileged client code is resolvable from: client-folding makes it
  reachable from ordinary app dependency graphs (imported, not
  auto-bundled), CLI-folding keeps it out of them, the tenth-package
  shape isolates it behind one more compatibility promise, and the
  served shape trades build-time types for guaranteed version match.
  For the helpers, the
  workout-evidence boundary dominates: publishing them converts an
  evaluation instrument into supported API, and the
  digest-pinned-instrument variant exists precisely to keep workout
  evidence from being reshaped by user-support pressure. Amends 0041
  either way.
- *Option 7 (naming):* see the option itself — the ledger and receipts
  bind published names, so a rename is the one move here that can
  silently orphan existing evidence if re-proof is skipped, and the
  re-proof itself rides a proof-system migration through name-bound
  machinery. Amends 0041 and the 0113-owned publication authority.

### Cheap moves under every option

Whichever shape wins, some fixes are option-independent and already
ticketed: a `types` condition and declaration for every public export
(`issues/closed/20260729-external-package-lifecycle-gaps.md`); `snapback stop`
retiring every sidecar it created or returning a typed cleanup plan; secure
refusals naming the failed inode predicate; and rewriting the guide's first
hour in the installed dialect (adjacent to LLP 0115 CV-13). These are small,
and the diaries suggest their coherence yield is disproportionate: an agent
that hits TS7016 on the first import does not care that the publication
state machine has Ed25519-signed leases.

## Empirical questions

The option analysis above leans on claims only probes or spikes can
settle. This list is closed by review, not by construction — the round-2
delta review found one omission (probe 8) after v0.2 first called it
closed — so the operative rule is the falsifiable half: an option-space
claim not grounded here or in the cited documents should be read as
hypothesis, and a probe this list is found to be missing is a defect in
the list.

1. **Registry names.** Is unscoped `snapback` available or squatted? Is
   `create-snapback-app` (or equivalent) available? What does the
   `@snapback` holder situation actually permit? (Gates Options 3, 4, and
   7d; one `npm view` sweep.)
2. **Cold external install.** Commands and wall-clock time from an empty
   directory to a first rendered row on a machine with no checkout —
   LLP 0074's preregistered comparison is the designed instrument.
3. **Typecheck and bundle.** Does a generated project typecheck strictly
   and bundle for the browser using only published artifacts?
4. **Declaration resolution.** Does every published subpath export
   resolve with type declarations under the resolution modes external
   apps use? (The `./online` class in §What Snapback does today.)
5. **Single-binary feasibility.** Size, launch time, code signing, update
   story, and Hermes-framework embedding on both supported tuples — the
   joint spike with LLP 0123 that open question 5 proposes.
6. **Provenance survival.** Which evidence properties survive a binary or
   meta-package consolidation or a rename: component digests,
   platform-runtime attribution, rollback granularity, candidate-ledger
   lineage? (Partly desk-analyzable against 0041's ledger design; the
   residue is empirical.)
7. **Discoverability.** Can an agent with no source checkout find the
   documented noninteractive path for each first-hour task — install,
   scaffold, generate, run, accept — without source archaeology? (A
   diary-style probe against the docs alone.)
8. **Runtime recovery after consolidation.** Under a single-binary or
   meta-package consolidation (Options 2–3), does missing- or
   corrupt-runtime detection still fire, does repair and relaunch still
   work, and does the repaired runtime retain its provenance?
   Probe 6 covers what provenance a consolidation preserves at rest;
   this probe covers whether the recovery machinery — owned on the
   runtime side by LLP 0123 — survives the packaging change. (Joint
   surface with the LLP 0123 spike in probe 5.)

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
4. **Two named artifacts gate CV-1's exit, with different blast radii.**
   The `demos/_kit` server/harness helpers block any external workout arm;
   the private admin client blocks Dispatch specifically — 0115 CV-1's
   exit lets the first arm be Campfire or Streak Lab. Both need custody
   decisions first, and the helper path additionally hides a real
   checkout-decoupling engineering job (§Option 6) (0041 §Open Questions;
   0115 CV-1).
5. **The known small defects are still live on current main.** The
   `@snapback/client/online` declaration gap — found independently in three
   apps — remains unfixed as of 2026-07-30 (`"./online": "./online.mjs"`
   with no `types` condition; no `online.d.mts`), and the
   `./agent-authority`, `./hosted-browser`, and `./rqs*` subpaths share
   the pattern. The guide's first-backend page still teaches the checkout
   dialect.
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
- **Medium-low:** the option tradeoff judgments. §Empirical questions
  lists the unrun probes behind them — registry names, cold-install
  timing, typecheck/bundle success, declaration resolution,
  single-binary feasibility, provenance survival, discoverability, and
  runtime recovery after consolidation — closed by review rather than
  by construction, and none of those probes has been run.

## Open questions

1. **Answered 2026-08-02:** LLP 0074's parallel gate governs the locally
   provable closure, with LLP 0134's maturity bar; LLP 0111 continues to
   govern hosted claims and their qualification. (Restates LLP 0115 OQ5;
   source: `issues/20260802-author-decision-packet.md`.)
2. What custody do the admin client and the acceptance helpers get —
   publish, fold, or endorse served/vendored paths? (Restates 0041's
   2026-07-30 open question; author decision that CV-1's exit requires.)
3. Is `@ccheever/snapback-*` an acceptable durable public brand, or should
   an organization-owned scope be secured before coherence is marketed?
   0041 designed the alias to be swappable without import churn; the
   question is when, not whether it is possible.
4. Should the guide's first-hour pages be recomposed around
   installed-dialect snippet sources — e.g., the packed starter fixtures,
   which LLP 0061's mechanism already accepts — and should installed-user
   and repository-contributor command tracks be split? (The mechanism
   needs no amendment; the corpus and page composition do.)
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
guide snippet mechanism, under which question 4's corpus recomposition
would land (no mechanism amendment appears required). Substantive design
changes land in those documents, not here.

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
