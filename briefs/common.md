# Common brief for every implementation lane (Snapback 2 elegance program, 2026-09-08)

You are GPT-6 Astra at xhigh, implementing one lane of a program the author commissioned on
2026-09-08 to make Snapback 2's backend language and client elegant. The program plan is
`/Users/ccheever/projects/snapback-el-20260908/plan.md` — read it first: it quotes the
commission, records the evidence, and states the rulings your lane implements. Your lane brief
names your items; nothing else is in scope.

## Where you are

- Repository root: the worktree you were started in (`git rev-parse --show-toplevel`). Snapback 2
  lives under `snapback2/` and is fenced: read `snapback2/AGENTS.md`, `rules/RULES.md`,
  `rules/NOT-DOING.md`, `llp/1000-snapback2.explainer.md`, then the LLPs your lane names.
- Run cargo/bun from `snapback2/`. Real node 24 is first on PATH (never the volta shim; the
  compiler worker hangs behind it). Build first: `cargo build` (also `cargo build -p snapback2-media`
  when tests need the media helper) and `(cd packages/snapback2 && node build.mjs)`; the binary and
  the package tests load `dist/`, so rebuild after every compiler/package edit.
  Rust tests: `NEXTEST_TEST_THREADS=8 cargo nextest run --config-file ../.config/nextest.toml
  --profile local-proof --workspace --no-fail-fast`. Everything blocking: `scripts/test.sh`
  (~60–90 s warm). Package tests: `(cd packages/snapback2 && node --test tests/<file>.test.ts)`.
  Compiler tests: `(cd packages/compiler && npm test)` or as `package.json` says.
- The corpus under `snapback2/corpus/` is shared by the Rust engine, the TS evaluator, and the
  compiler; regenerate with `cargo run -p snapback2-core --bin export_corpus` when you add or change
  a case, and fix the pinned count in `spike.rs` if it changes.
- Guide pages are `snapback2/packages/snapback2/guide/*.md` with byte budgets enforced by
  `build.mjs` (quarry.md 15,872; grammar.md 3,584; offline.md 4,352; others 4,096). `guide.rs`
  pins a definition substring per keyword — check that table before rewording a construct's
  sentence. Deletions free bytes; raise no budget. Diagnostics need a family, a site, a rewrite,
  and a page (`guide/families.source.json`).
- `caps` (`node scripts/caps.mjs` at the repo root) refuses files over 1,500 lines: split on the
  way in. No new checks, scripts, registries, config files, or design docs (RULES: agents add no
  apparatus). Delete; do not deprecate: no compat shims, no "deprecated" aliases, no old names
  kept "for now".
- Scaffolding a project to try things: from `snapback2/`,
  `SNAPBACK2_COMPILER=$PWD/packages/snapback2/dist/compiler.mjs SNAPBACK2_TEMPLATES=$PWD/packages/snapback2/templates ./target/debug/snapback2 init /tmp/<name> --template chat --client react`,
  then `check`, `dev`, `run`, `why`, `test` inside it (`snapback2 dev --stop` when done; kill only
  PIDs you started).

## How to work

1. Read the rulings for your lane and the code they name. Reproduce each wart first on the base
   commit; keep the before output for your report.
2. Implement. Every behavior change has a test that fails before and passes after (Rust unit or
   nextest, compiler `src/test.ts` cases, package `tests/*.test.ts`, or a corpus case). Every
   user-visible rule gets its sentence on the guide page the ruling names, in the same change.
3. Keep `@ref LLP NNNN#section` annotations current where you touch code that carries one; add
   one only where the reader could not know the reason from the code. Templates carry none.
4. Revise the LLP your lane names: add the ruling text (from plan.md, your lane's section) under a
   dated `Revised:` entry and a section named as the plan names it; mark superseded sentences.
5. Run `scripts/test.sh` from `snapback2/`; read the summary lines; fix what is red. Owner-stop
   tests that need `ps` fail inside a sandbox that denies it — note them as sandbox artifacts and
   move on (the orchestrator re-runs outside).
6. Do NOT `git commit`, `git stash`, or touch branches (linked worktree: the orchestrator commits).
   Do not modify files outside your lane's named areas without saying so in the report.
7. Write your report to `REPORT-<lane>.md` at the repository root: what you changed (files), the
   tests you added and their results (verbatim counts), the before/after outputs for the reproduced
   warts, every deviation from the plan and why, and every open question. Claims, not prose.

## What "done" means

Every ruling in your lane implemented with its test and its guide sentence; `scripts/test.sh`
green apart from sandbox artifacts; the LLP revised; the report written; no file over 1,500
lines; nothing outside your lane touched without a note.
