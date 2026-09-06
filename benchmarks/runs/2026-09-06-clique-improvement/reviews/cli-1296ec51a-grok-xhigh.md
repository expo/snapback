I'll review this Snapback2 CLI help/migration delta in place: first the review skill and snapshot, then the patch and load-bearing callers without running tests or editing.This is a read-only delta review of the snapshot itself, not the `/review` write-to-disk flow. I'll load the prompt, rules, patch, and LLP 1002, then the ten changed files.The prompt is a delta review of this snapshot; next I’ll read the rest of the patch and the ten changed files.The patch lists nine files; I'll confirm the tenth against `31fb3f386` and read the changed sources plus load-bearing callers.**READY**

Read-only review of `change.patch` (9 files; the prompt said 10) against the stated main cases. I did not run tests, edit files, or use the network. Passing-test claims below are only what those tests **assert in source**, not execution evidence.

## Main cases

**Top/command `-h` / `--help` before project lookup.** `main.rs:47-59` returns before any verb, `locate_root`, compiler, or owner action. Empty args, `--help`, and `-h` print `TOP_HELP` on stdout and exit 0. `snapback2 <command> --help|-h` uses `command_help` when the first token is a known verb. `reset --help` / `init --help` / `dev --apply-migration … --help` cannot reset, scaffold, or migrate. Unknown `does-not-exist --help` still falls through to exit 2 (`main.rs:100-103`). `tests/guide.rs:6-40` covers missing compiler, no tree mutation, and unknown+help → 2; it only checks that stdout starts with `usage: snapback2`, so it would not catch always-printing top help.

**`guide init|dev|check` routing.** `guide.rs:43-46` serves `command_help` before grammar/app/recipes/symbols/`E_*`. JSON stays `{ page, content }`. `available` / `unknown` list the new pages. `tests/guide.rs:44-62` checks those pages and the `E_SUCCESSOR_DESTRUCTIVE` needles.

**Existing `migrationFile` + executable shell-quoted absolute `applyCommand`.** After a successful plan write, `watch.rs:170-188` sets `migrationFile`, POSIX-quoted `applyCommand` (`'` / `'\''`), rewrite, and `guide: E_SUCCESSOR_DESTRUCTIVE`, then `Action::Refused` so `/control/status` carries the enriched refusal. `locate_root` canonicalizes, so those paths are absolute. Apply still POSTs the **file** body (`owner.rs:72-89` → `control.rs:137-147` `body.project` + `body.plan`), not a disk recompile. Engine `apply_migration` still requires the supplied plan to match current→next (`registry.rs:1008-1014`). `check` is compile+cache only (`check.rs:454-475`); migrate does not start an owner.

**Apostrophes/spaces, replacement binding, status, check vs install.** `wire_lifecycle.rs:6-8` renames the project to `*.quoted 'project'` (space + apostrophe). It waits until `status.refused[0].applyCommand` is a string, reads that `migrationFile`, asserts `check` matches `plan.generation` while the owner stays on the old generation, then runs the **exact** `applyCommand` via `sh -c` from `temp_dir` (so relative paths would fail). After apply, status is `ready` and generation is the plan’s. Quoting, absolute paths, and file binding are implied by that procedure, not spelled out as string asserts.

## Material findings

None that should block this delta.

Help for init/dev/check matches the implemented flags and the check-vs-install split. `applyCommand` is emitted only after `fs::write` succeeds; a write failure rewrites without offering apply (`watch.rs:160-168`). `fs::read` of `--apply-migration` is CWD-relative even with `--project`, as the spec says. Literal `migration-GENERATION.json` cannot apply. `--help` is intercepted before `reset` / apply.

## Optional (non-blocking)

**Help lie (not a main-case path).** `verbs.rs:111-112` documents `snapback2 version [--json]`. `main.rs:62-72` accepts `--json` and still prints `snapback2 {VERSION}` as plain text.

**`guide init|dev|check` still requires the package.** `guide.rs:39-46` calls `guide_root()` before built-in help. `SNAPBACK2_GUIDE` missing/wrong fails `guide init` even though the text is in the binary; `init --help` does not. `guide.rs:494-498` `usage()` still omits `init|dev|check` (extra-arg path only).

**Brief status gap.** `Action::Apply` marks `refused` before the watcher writes the plan and calls `Action::Refused` (`writer.rs:709-711`, `watch.rs:94-97`). Fast polls can see refused without `applyCommand`; the owner test waits on the field (`wire_lifecycle.rs:503-507`).

**LLP 1002 table drift (same spec file).** §6 still has `guide [grammar | app | …]` and `init --client react|none`; §5/§8 and the CLI help include `guide init|dev|check` and Expo.

## Coverage (from tests as written, not runs)

- Help: prefix + exit 0 + no side effects + unknown+help → 2. No assert that `init --help` is init-specific vs `TOP_HELP`.
- Guide: init/dev/check needles + `E_SUCCESSOR_DESTRUCTIVE` sh block / “does not install”.
- Owner: apostrophe/space path, real file, `sh -c applyCommand` from another cwd, check does not install, apply installs plan generation.
- Not covered: failed plan write (no `applyCommand`); migrate after disk has moved off the saved project; `guide init` with no guide package.

I did not run the reported 11 guide / 86 owner tests.
