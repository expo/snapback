# Rules

**Snapback 2 optimizes the edit-to-verified loop — the agent's building an app on it, and ours building it.**

Speed is the constraint. Everything below exists to keep the edit-to-verified loop short
and to stop this repository accreting apparatus faster than anyone can remove it. These
rules bind `snapback2/` and the LLPs numbered 1000 and up; Snapback 1 is baselined, not
exempt, and its numbers may only fall.

Each rule is **[check]** (enforced by `caps`) or **[review]** (enforced by a human).

## Budgets — every budget is a trade, not a limit

- **5 blocking checks, 60s total.** A sixth requires deleting one, in the same PR. **[check]**
- **59 documents in the working set** (`llp/current/`). Today's count. A 60th requires
  archiving one — which is just removing the link. Snapback 2 aims to leave this at 15;
  Snapback 1's links are archived at promotion. **[check]**
- **12 documents in the foundation** (`llp/foundation/`). **[check]**
- **This file: 700 words.** If it grows, something becomes a check or stops being a rule. **[check]**
- **1,500 lines per source file, baseline 204.** Generated files exempt — and generated
  files are built, not committed; so are benchmark run records under `benchmarks/runs/`,
  which are evidence, not source. The baseline is Snapback 1's oversize count on the day
  the rule landed; it may not grow, and `snapback2/` contributes zero to it. **[check]**

## Blocking checks

`caps` · `ref-check` · `snapback2/scripts/test.sh` · `snapback2/scripts/measure.mjs --check` · `check-inventories`

## Loop shape

- **Every check reports all failures in one run.** Fail-fast is banned. **[check]**
- **Nothing blocks on anything slower than 60 seconds.** Slow verification runs on a
  schedule, attributed to the breaking commit, and files a bounded set of issues. **[review]**
- **Fix loops get 3 rounds.** Then stop: escalate to a human or descope. **[review]**

## Time budgets

Tracked every run of `snapback2/scripts/measure.mjs` (appends `snapback2/metrics/loop.jsonl`).
A regression is a P0 with a name on it.

| | budget |
|---|---|
| Incremental rebuild after a one-line edit | 15s |
| Test what you just changed | 30s |
| Blocking gate suite | 60s |
| Full build, warm cache | 5 min |
| **`snapback2 check` on a program (the agent's product latency)** | **1s** |
| **`snapback2 doctor` boot-to-ready** | **0.5s** |

## Scope

- **`NOT-DOING.md` is binding.** Moving something onto the doing-list means writing why
  and taking something off. **[review]**
- **Delete; don't deprecate.** No compat shims or migration paths before promotion. **[review]**
- **Nothing is compiled, transpiled, or generated at runtime that could be built ahead of
  time.** **[review]**
- **A spec needs an implementer and a date, or it isn't written.** **[review]**
- **Only implemented specs bind.** A document with no running code behind it is a
  proposal, and a proposal cannot block a PR or justify a check. **[review]**

## Agents

- **Agents remove apparatus freely and add none.** An agent PR that adds a check, script,
  registry, config file, or design doc needs explicit human approval saying so. **[review]**
- **2026-09-06 session exception:** the user delegated the search implementation
  decisions; one `snapback2-core/build.rs` may generate pinned Unicode tables at
  build time, alongside the existing package build. No new gate, registry,
  runtime generator, or Unicode dependency is authorized by this exception. **[review]**
- **Snapback 2 LLPs are numbered 1000 and up**; `llp-create` must be told. **[review]**
- **Snapback 4 LLPs are numbered 3000 and up** (`snapback4/`, LLP 3000); it adopts these budgets
  and loop shape as its own and keeps its scope in `snapback4/NOT-DOING.md`. **[review]**

## Shared machines

- Warm, named lanes, one per stream of work. Never clone fresh; reuse the worktree.
- **Never `git stash`.** Use a temporary commit.
- Kill only PIDs you recorded at launch. Never by name or pattern.
