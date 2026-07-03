# Agent Instructions

This project uses **Linked Literate Programming (LLP)**. The upstream LLP
workflow is maintained at <https://github.com/ccheever/llp>; this repository
keeps its own LLP corpus under [`llp/`](./llp/).

## LLP documents

- LLP documents live in `llp/` and follow the numbering convention
  `NNNN-slug.type.md`, for example `0001-storage-decision.rfc.md`.
- The project root LLP is
  [`llp/0000-snapback.explainer.md`](./llp/0000-snapback.explainer.md).
- When creating a new LLP, use the next available number and include the
  standard metadata header: `Type`, `Status`, `Systems`, `Author`, `Date`,
  `Revised`, and `Related`.
- Standard types: **RFC**, **Spec**, **Decision**, **Plan**, **Explainer**,
  **Principles**, **Guide**, **Issue**, and **Research**.
- Proposal statuses for RFCs, Specs, and Plans are **Draft**, **Review**,
  **Accepted**, **Implemented**, **Superseded**, **Shelved**, and
  **Withdrawn**. Explanatory documents usually use **Draft** or **Active**.
- LLP documents are living documents. Update them when the system evolves; move
  historical-but-useful documents to `llp/tombstones/` and mark them
  `Tombstoned`.

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

## Demo application diaries

- When building or substantially changing a demo application with Snapback,
  create or update a diary in `diaries/`.
- Diary files use the same numeric convention as LLP documents:
  `NNNN-slug.diary.md`, for example `0001-todo-demo.diary.md`. Use the next
  available number for a new demo; append dated entries to an existing diary
  when continuing work on the same demo.
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

## Agent skills

<!-- BEGIN LLP SKILLS MANAGED BLOCK -->
Before editing a subsystem with documented design, orient first: read its
governing LLP, and for non-trivial work invoke `llp-orient` to assemble a
context pack of the constraints the change must respect.

Skills: orient = context before coding; create = author one LLP; review = LLP
review loop scaled to stakes; adopt = set up LLP in any repo; maintain = drift,
pre-PR, reconcile, and retirement checks.
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

## Working on this project

- Read relevant LLP documents before implementing features or fixing bugs in
  the areas they cover.
- If you make a design decision worth preserving, write or update an LLP for it.
- Prefer updating an existing LLP over creating a new one when the topic is
  already covered.
- Land doc updates in the same commit as the code change that motivated them.
- Run the LLP corpus audit (`llp-maintain`-style) before each demo lands and
  after each LLP 0032 phase completes (LLP 0016's reconcile cadence).
- Before running `cargo build`, `cargo test`, or `cargo run` on a clean checkout,
  run `scripts/bootstrap-ibex-runtime`. Snapback links the vendored
  `ibex-runtime` crate, which needs ignored Hermes headers/frameworks and tools.
  The bootstrap script first initializes the `vendor/ibex` submodule if a fresh
  clone or worktree has not done so yet (it refuses with
  `SNAPBACK_IBEX_SUBMODULE_WEDGED` and recovery steps if stray files already
  occupy the uninitialized path), then uses prepared artifacts from the sibling
  `../ibex` checkout when available, then falls back to the vendored Ibex setup
  script. Set `SNAPBACK_IBEX_CHECKOUT=/path/to/ibex` if the prepared checkout
  lives somewhere else. Do not start by building Hermes from source unless you
  are specifically changing Ibex or Hermes. When the runtime state looks wrong,
  run `scripts/ibex-doctor` for a read-only coded diagnosis before repairing
  anything by hand.
