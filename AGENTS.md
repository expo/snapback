# Agent Instructions

**Building an app ON Snapback (not Snapback itself)?** Do not start from
this file's corpus: read your template's start packet under
[`guide/start/`](./guide/start/index.md) — or
[the mental model](./guide/start/mental-model.md) with no template — then
escalate one page at a time via `snapback guide <query>`. The capability
index is a lookup registry, not a first read (LLP 0259). The rest of this
file is for engineering Snapback itself.

This project uses **Linked Literate Programming (LLP)**. The upstream LLP
workflow is maintained at <https://github.com/ccheever/llp>; this repository
keeps its own LLP corpus under [`llp/`](./llp/).

## LLP documents

- LLP documents live in `llp/` and follow the numbering convention
  `NNNN(.NNN)*-slug.type.md`, for example `0001-storage-decision.rfc.md` or
  `0011.000-session-tokens.spec.md`. Sub-LLPs nest by dotted number; numbers
  are never reused, and a document is never renamed to re-parent it.
- `llp/current/` and `llp/foundation/` hold relative links only (symlinks, or
  regular files containing the relative path on checkouts without symlink
  support). `current/` is the declared working set: link a new or in-progress
  LLP there and remove the link when the work is done — that is the archive
  operation. `foundation/` is the kernel from which the design could be
  recreated; promote into it by folding settled decisions into a living
  `Active` document, then linking it. Orient by reading `foundation/`, then
  `current/`, then the `@ref`s in scope.
- The project root LLP is
  [`llp/0000-snapback.explainer.md`](./llp/0000-snapback.explainer.md).
- When creating a new LLP, use the next available number and include the
  standard metadata header: `Type`, `Status`, `Systems`, `Author`, `Date`,
  `Revised`, and `Related`. `llp-create` links new documents into
  `llp/current/`.
- Standard types: **RFC**, **Spec**, **Decision**, **Plan**, **Explainer**,
  **Principles**, **Guide**, **Issue**, and **Research**.
- Proposal statuses for RFCs, Specs, and Plans are **Draft**, **Review**,
  **Accepted**, **Implemented**, **Superseded**, **Shelved**, and
  **Withdrawn**. Explanatory documents usually use **Draft** or **Active**.
- LLP documents are living documents. Update them when the system evolves;
  mark wrong or replaced ones `Tombstoned`/`Superseded` in the header (files
  never move). Don't leave stale docs unmarked.

## @ref annotations

- When writing or modifying code that implements a non-obvious design decision
  documented in an LLP, add an `@ref` annotation:
  `// @ref LLP NNNN#section — short gloss`.
- When modifying code that already carries an `@ref`, check that the referenced
  section still applies. Update or remove it if it does not.
- Do not annotate mechanically. A reference should tell the reader something
  they would not know from the code and filename alone.
- Run `./ref-check --verbose` to validate references and metadata. CI runs the
  same check on pushes and pull requests.

## The Snapback Guide

- **Before building an app on Snapback, load
  [`guide/index.md`](./guide/index.md); before using a feature area, load its
  guide page.** The guide is the intent-indexed map of the authoring surface
  — schema/functions, live queries, ephemeral state, auth, the client arms,
  acceptance testing — with CI-verified code. Its
  [capability index](./guide/capabilities.md) lists everything Snapback has,
  including explicit GAP rows for what the guide doesn't cover yet.
- Guide checks run in the local proof; the docs-only fast path is
  `node scripts/check-guide.mjs`. Conventions (frontmatter, snippet classes,
  freshness, fresh-tree generator bootstrap) are in
  [`guide/conventions.md`](./guide/conventions.md); the governing design is
  LLP 0061.
- **Engineering Snapback itself: read the guide page for any authoring
  surface you are about to change or reason about.** The routing at the top
  of this file sends *app builders* to the guide and Snapback engineers to
  the LLP corpus. That is right for orientation and wrong for facts: the
  guide is where the **current paved form** of each surface is recorded, and
  the LLP corpus is where its *history of decisions* is. Reading only the
  corpus, the code, and `demos/` will give you a stale picture, because a
  demo may sit on a documented compatibility lane and an LLP may predate the
  surface it governs. Before proposing a change to authoring, codegen
  custody, diagnostics, or a client surface, read the corresponding guide
  page first — `guide/getting-started/your-first-backend.md`,
  `guide/getting-started/generated-artifacts.md`, `guide/reference/`,
  `guide/clients/`. Evidence: the LLP 0324 §2 review record, where a batch
  of proposals authored from code and corpus alone contradicted paved forms
  the guide states plainly.

## Demo application diaries

- When building or substantially changing a demo application with Snapback,
  create or update a diary in `diaries/`.
- Diary files use the same numeric convention as LLP documents:
  `NNNN-slug.diary.md`, for example `0001-todo-demo.diary.md`. Use the next
  available number for a new demo; append dated entries to an existing diary
  when continuing work on the same demo.
- The 11 duplicate prefixes baselined in `scripts/check-diary-identity.mjs`
  are canonical aliases; references to those IDs require both number and slug,
  while bare `Diary NNNN` remains authoritative for non-colliding IDs. New
  collisions are blocked by that check and must not be added to the baseline.
- Each diary should capture the agent's concrete build experience: what felt
  good or easy, what felt bad or hard, where Snapback was ergonomic or
  surprising, and what workarounds were needed.
- When the demo also uses Exact or Contract, include observations about those
  tools separately from Snapback where useful.
- Compare the experience against familiar alternatives when relevant, including
  React plus Convex or Supabase, or any other applicable comparison. Call out
  where Snapback, Exact, or Contract reduced friction, added friction, or
  changed the shape of the work.
- Land the diary update with the demo change that produced the observations.
- When a diary entry records friction the guide should have prevented —
  knowledge you needed and couldn't find in `guide/` — file it as a filesystem
  ticket under `issues/` with `guide-gap` in the title so a page or
  capability-index row absorbs it (LLP 0061 §5). If it needs PM coordination,
  graduate it to Linear in the Exact project with a Snapback label.

## Agent skills

<!-- BEGIN LLP SKILLS MANAGED BLOCK -->
Before editing a subsystem with documented design, orient first: read its
governing LLP, and for non-trivial work invoke `llp-orient` to assemble a
context pack of the constraints the change must respect.

Skills: orient = context before coding · create = author one LLP · review =
LLP 0005 loop, scaled to stakes · adopt = set up LLP in any repo,
install/update the skills · maintain = drift / pre-PR / reconcile / retire /
curate (promote → archive → realign, LLP 0011.000) · super-refine =
dual-model refine-until-ready · ship = tasks done end to end.
<!-- END LLP SKILLS MANAGED BLOCK -->

Project skills are aggregated under `skills/` and mirrored into each agent's
project-local skill discovery path:

- Codex and shared Agent Skills: `.agents/skills`
- Claude: `.claude/skills`
- Cursor Agent: `.cursor/skills`
- Pi: `.pi/skills`
- OpenCode: `.opencode/skills`

The aggregate entries are symlinks into `vendor/llp` and
`vendor/ccheever-skills`. Run `scripts/sync-agent-skills` after pulling upstream
skill changes; this repo also uses tracked Git hooks in `.githooks/` to refresh
them after normal checkout/merge operations in this local clone.

Activate the tracked hooks with `git config core.hooksPath .githooks` (a
relative path keeps each linked worktree on its own checked-out hook). The
pre-push hook selects frozen-record gates from the committed paths being
pushed and reports them. Revisions targeting `origin/main` ordinarily defer
execution to the scheduled backstop; non-main refs run nothing and make no
scheduled-main claim until they later land on `origin/main`. Use
`SNAPBACK_DRIFT_GATES_STRICT=1 git push ...` for synchronous
enforcement; add `SNAPBACK_DRIFT_GATES_FULL=1` for the complete registry.
`FULL=1` alone remains a compatible strict/full spelling. The legacy
`SNAPBACK_DRIFT_GATES_BYPASS=1 git push ...` spelling remains accepted and
loud but is redundant for an ordinary deferred push. Never put any of these
variables in shell startup files. In strict mode, baseline-proven inherited
reds and corroborated infrastructure proceed under LLP 0232; introduced
content reds and nondeterminism block. The independent main detector is
`node scripts/drift-prone-gates.mjs backstop`; it repeats clean content reds,
files one open `issues/` ticket per normalized stale/nondeterministic signature,
and does not duplicate a still-open signature. The complete
suite runs every two hours on the `com.snapback.drift-backstop` launchd
schedule; install or refresh it with `scripts/install-drift-backstop-schedule`.
(That backstop covers the frozen-record drift registry only; it is not the
LLP 0189 D-1 complete battery. The separate six-hour
`com.snapback.local-proof-backstop` launchd schedule runs the complete
canonical proof inventory of LLP 0175 D2.3 and durably commits/pushes D-1
signature-ticket state; install or refresh it with
`scripts/install-local-proof-backstop-schedule`. GitHub's scheduled complete
workflow remains report-only.

The skills sync (and therefore the checkout/merge hooks) initializes only the
small `vendor/llp` and `vendor/ccheever-skills` submodules. It deliberately does
**not** auto-initialize `vendor/ibex`, which is a full Ibex runtime checkout that
most Snapback work never needs — cloning it on every checkout would be
disproportionate. When `vendor/ibex` is uninitialized the sync prints a one-line
hint pointing at `scripts/bootstrap-ibex-runtime`, which initializes the
submodule safely on demand (ENG-22595); it does not leave a fresh worktree as a
silent wedge trap (ENG-22659).

## Working on this project

- Read relevant LLP documents before implementing features or fixing bugs in
  the areas they cover.
- Landings that add test files, metadata-declared demos, or generated
  publication leaves run `node scripts/check-inventories.mjs` before pushing.
  So do landings that merely **move** Rust code: the diagnostics registry records
  emitting *sites*, not just codes, so shifting line numbers invalidates
  `guide/reference/diagnostics-registry.json` even when no new `SNAPBACK_` code is
  introduced. The generated artifacts also chain — the guide manifest embeds the
  registry — so regenerating one can leave the next stale. Grepping the diff for
  new codes is **not** a sufficient check; run the generators and confirm
  `check-inventories` passes, which is the only step that sees the whole chain.
- **Publication posture (author ruling 2026-08-08, recorded in LLP
  0041):** publish to npm rapidly and often — whenever `main` carries
  meaningful surface changes and the qualified publication path passes.
  No current users depend on stability; expected users are agents who
  read the docs. Do not batch changes waiting for a big release; treat
  landed-but-unpublished surface fixes as a liability.
- **`main` moves fast — often continuously for days.** Many concurrent agent
  sessions push to it around the clock. Do not design processes, gates, or
  qualification loops that depend on `main` being quiet for hours at a time
  (for example, "review, then re-verify against exact HEAD, then measure
  before landing" — newer commits will land mid-loop and starve it; the
  Track B C27–C33 loop of 2026-08-05/06 is the cautionary case). Prefer
  designs that land promptly after review and run remaining verification
  against the landed commit, keeping any capability claim gated on its
  scoped post-landing evidence plus the LLP 0189 D-6 battery reference.
  Expect to `git fetch` + rebase right before every push, and to retry.
- **Optimistic landing is the ordinary default (author ruling 2026-08-13,
  LLP 0232).** If affected tests passed in the branch/worktree, the tested
  semantic delta survives integration unchanged, and merge/rebase adds no
  semantic conflict resolution, land immediately. Do not rerun expensive
  checks merely because `main` advanced. Rerun checks whose semantic inputs
  changed; address known failing affected product tests before landing.
  Frozen-record drift verdicts are scheduled fix-forward work by default, not
  an ambient landing veto. This does not relax publication/promotion,
  destructive migration, urgent-security, active-corruption, or similar
  irreversible/high-danger protocols.
- **Verification cadence and claim gating follow LLP 0189.** Landings run
  fast/affected checks only; the complete battery runs on schedule (at least
  twice daily) and its reds become fix-forward tickets, not retroactive
  invalidation of unrelated work. Capability claims and publications are
  snapshots bound to a scoped, claim-relevant qualification digest —
  wave-shared proof/metrology files carry their own drift gates instead of
  living inside claim digests — and reviews bind content, not HEAD. Do not
  design new gates that require a complete proof at an exact commit.
- Agents may use the machine fleet documented in
  `~/Dropbox/APIKeys/MACHINE_FLEET.md` to speed up development. Read that file
  for current availability, capabilities, and SSH commands. Prefer an
  appropriate remote machine when builds or tests are resource-intensive, or
  when controlled browsers, simulators, or macOS apps would steal focus and
  make the primary computer difficult to use. Account for repository state and
  platform requirements before dispatching work, and do not copy credentials
  or other secrets into the repository or logs.
- If `.agent-local-secrets.md` exists at the project root, read it when a task
  needs local credentials or API keys. It is intentionally ignored by git and
  must not be copied into LLPs, logs, commits, or generated artifacts.
- If you make a design decision worth preserving, write or update an LLP for it.
- Prefer updating an existing LLP over creating a new one when the topic is
  already covered.
- Land doc updates in the same commit as the code change that motivated them.
- Prefer filesystem tickets under `issues/` over Linear for repository-scoped
  bugs, follow-ups, papercuts, and maintenance work. Use
  `issues/YYYYMMDD-slug.md` for open tickets; when resolved, record the
  resolution and move the file to `issues/closed/`. Linear is a good tracker,
  but reserve it for work that benefits from human project-management state,
  assignment, cycles, or cross-repository coordination. When a filesystem
  ticket grows into that kind of work, graduate it to Linear, record the Linear
  pointer in the file, and close the filesystem ticket rather than tracking the
  same live state in both places. New Linear issues for this repository default
  to the Exact project; add a Snapback label when useful.
- Run the affected-scope LLP corpus audit (`llp-maintain`-style, limited to
  the docs the demo touches) before each demo lands; the complete corpus
  audit runs on LLP 0016's reconcile cadence and after each LLP 0032 phase,
  not as a landing precondition (LLP 0189 D-2).
- A fresh checkout or worktree needs `bun install --frozen-lockfile` and
  `scripts/check-generated-artifacts` before
  `node scripts/generate-guide-manifest.mjs` will succeed. The full
  `node scripts/check-guide.mjs` pass also cannot succeed until then; without
  deps it still runs, prints the missing-install precondition, skips
  dependency-backed checks, and exits nonzero. The named sequence is in
  [`guide/conventions.md`](./guide/conventions.md) ("Running the checks in a
  fresh tree"). This is the JS counterpart of `scripts/bootstrap-ibex-runtime`
  below.
- Before running `cargo build`, `cargo test`, or `cargo run` on a clean checkout,
  run `scripts/bootstrap-ibex-runtime`. Snapback links the vendored
  `ibex-runtime` crate, which needs ignored Hermes headers/frameworks and tools.
  The bootstrap script first initializes the `vendor/ibex` submodule if a fresh
  clone or worktree has not done so yet (if stray files already occupy the
  uninitialized path it attempts the init anyway and refuses with
  `SNAPBACK_IBEX_SUBMODULE_WEDGED` plus recovery steps only when git cannot
  complete it), then uses prepared artifacts from the sibling
  `../ibex` checkout when available, then falls back to the vendored Ibex setup
  script. Set `SNAPBACK_IBEX_CHECKOUT=/path/to/ibex` if the prepared checkout
  lives somewhere else. Do not start by building Hermes from source unless you
  are specifically changing Ibex or Hermes. When the runtime state looks wrong,
  run `scripts/ibex-doctor` for a read-only coded diagnosis before repairing
  anything by hand.
- The bootstrap validates by building, launching, and handler-VM-qualifying
  the `snapback` binary (with `DYLD_*` scrubbed on macOS), not just
  `cargo check`, so both the macOS framework-load wedge and a Hermes
  framework whose runtime contract mismatches the linked glue are caught at
  bootstrap time (`snapback runtime-qualify` creates the same restricted
  no-eval VM every JS handler uses), and it persists the qualification as a
  digest-bound readiness receipt (`<binary>.runtime-readiness.json`) that
  doctor, the demo harness rungs, and `scripts/verify-local-proof` re-verify
  before trusting a served binary. On macOS the binary carries
  an `LC_RPATH` emitted by `crates/snapback/build.rs`, so `cargo run` finds
  `hermesvm.framework` without `DYLD_FRAMEWORK_PATH` even under SIP. Every
  bootstrap failure path fails with a stable `SNAPBACK_*` code (see LLP 0010,
  "Bootstrap diagnostic codes"): the submodule states, plus
  `SNAPBACK_DEV_IDENTITY_CONFIG_FORBIDDEN`,
  `SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING`, `SNAPBACK_IBEX_HERMES_DOWNLOAD_FAILED`,
  `SNAPBACK_IBEX_HERMES_ARTIFACTS_UNUSABLE`,
  `SNAPBACK_IBEX_CARGO_NOT_FOUND`, `SNAPBACK_IBEX_CARGO_BUILD_FAILED`,
  `SNAPBACK_IBEX_RUNTIME_LINK_FAILED`,
  `SNAPBACK_IBEX_RUNTIME_LINK_TIMEOUT`, `SNAPBACK_IBEX_RUNTIME_LINK_INTERRUPTED`,
  `SNAPBACK_IBEX_RUNTIME_LINK_PROBE_FAILED`,
  `SNAPBACK_IBEX_RUNTIME_LOAD_FAILED`,
  `SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED`,
  `SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID`, and
  `SNAPBACK_IBEX_HOST_UNSUPPORTED`.
