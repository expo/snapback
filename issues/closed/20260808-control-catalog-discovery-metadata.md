# Control catalog discovery metadata is hollow (intents/anchors/titles) and rule 4 is unenforced

**Status:** Open
**Opened:** 2026-08-08 · **Severity:** P1 · **Area:** control-catalog / generate-control-catalog.mjs / CLI / MCP

From the 2026-08-08 agentic surface audit (LLP 0202 theme 1); found
independently by three auditors.

The catalog machinery (digest binding, projection parity, CI drift gate) is
sound, but the metadata that makes it *searchable* was never filled in, so the
"search the catalog by intent before guessing names" ritual that
`guide/operating/agent-controls.md:22` prescribes returns nothing for common
intents.

Measured against `control-catalog/generated/control-catalog.v1.json`:

- 90 of 114 rows have empty `intents` — including all 41 `native` rows and
  all 45 MCP-projected rows. `snapback controls list --intent "slow network"`
  (LLP 0184's own worked example, `llp/0184:803`; the RFC specifies intents
  for that exact row at `llp/0184:412`), `--intent upload`,
  `--intent "reset the database"`, and `--intent "mint session"` all match
  zero rows. The matcher is substring AND over `operation + title + intents`
  (`src/control_catalog.rs:59-94`), so empty intents means id-guessing only.
- 77 of 114 rows have `guide: null`, including 20 of 45 MCP-projected rows —
  LLP 0184 rules 4/5 (`llp/0184:659-666`) require a Guide anchor on every
  `native`/`cliOnly`/`mcpOnly`/`apiOnly` row.
- 44 rows have a placeholder `title` equal to the operation id (e.g.
  `asset.put`).
- 36 of 38 `apiOnly` rows have no invocation recipe anywhere
  (`guide/operating/agent-controls.md:221` documents exactly two), and 33 of
  38 are `operability: direct` with an empty `cliDeferralReason` — the
  generator only auto-stamps deferral reasons for `cliOnly`/`mcpOnly`
  (`scripts/generate-control-catalog.mjs:325-334`), so `apiOnly` silently
  escapes rule 5.
- The generator (`scripts/generate-control-catalog.mjs:605-700`) enforces
  rules 3, 5-deferral, 6, 7, 8 — there is no rule-4 completeness check, which
  is why none of the above fails CI.
- The packaged CLI verbs (`verify`, `deploy`, `hosted`, `accept`,
  `runtime-qualify`, `new`, `generate`, `doctor`, …) have no catalog rows at
  all — `control-catalog/cli-only-operations.json:2` scopes itself to the
  Rust CLI enums — while `acceptance.run` sits in the catalog marked
  `status: unbuilt` / `operability: unavailable`, so an agent searching
  "acceptance" finds an unimplemented op and reasonably concludes the
  done-oracle does not exist. Their lifecycle/output/exits/recovery are
  already machine-readable in `PACKAGED_CLI_COMMANDS`
  (`packages/snapback-cli/index.mjs:2935-3049`).
- Text output of `snapback controls list` drops `title` and
  `projections.cli` (`src/cli.rs:5417-5426`), so even a search hit yields no
  runnable command in text mode.

## Fix

1. Backfill `title`, `intents`, and `guide` via
   `control-catalog/operability-overrides.json` (the override hook exists:
   `scripts/generate-control-catalog.mjs:231`), starting with the 45
   MCP-projected and 38 `apiOnly` rows.
2. Add rule-4 generator gates: non-empty `intents`, non-null `guide` for
   `native`/`cliOnly`/`mcpOnly`/`apiOnly`, `title !== operation`; require an
   authored recipe anchor or deferral reason on `apiOnly` rows.
3. Extend `cli-only-operations.json` with rows for the packaged verbs,
   sourced from `PACKAGED_CLI_COMMANDS`, plus a generator check that every
   packaged command name has a row or a declared deferral.
4. Add TITLE and CLI columns to the `controls list` text projection.

Record the rule-4 enforcement decision as a dated amendment to LLP 0184 when
this lands (LLP 0189 landing discipline).

## Resolution (2026-08-08)

Resolved by backfilling authored discovery metadata in
`control-catalog/operability-overrides.json`, enforcing rule 4 and packaged
CLI completeness in the generator and schema, inventorying every packaged
root verb, correcting `acceptance.run` to the shipped `snapback verify`
oracle, and adding TITLE and CLI to `snapback controls list`. The catalog and
Guide derivatives were regenerated, generator regression tests cover the new
gates, and LLP 0184 records the enforcement decision.
