# What Snapback 2 Does Not Do

This is the most valuable file in the repository. It is longer than the doing-list on
purpose. Moving something off it means writing one line naming what it unblocks and
taking something off the doing-list in the same change.

## The bar that makes this list derivable

A fresh agent, with only the installed package and the task, builds Clique M1–M3
(accounts, feed, realtime chat) on the **published** snapback2 in under 1,200 s with at
most one Snapback-attributed correction loop, and `snapback2 test` proves it
(LLP 0329.016 §8). Everything not required by that does not exist yet.

## Not building

- **A second authoring profile, a plan algebra, or a JS handler lane.** One language —
  bounded data programs (LLP 0329.014.004) — one spelling. Familiar vs Explicit cost
  every v1 doc twice (LLP 0317 bundle 6).
- **JavaScript in the data plane.** Queries and mutations run in the Rust IR
  interpreter inside the SQLite transaction. Ibex 2 is linked only by
  `snapback2-effects`, only with `--features hermes`, only for effects.
- **Committed generated code.** Types by inference; IR, certificate, and stubs are a
  gitignored build cache. No `generated/`, no review manifest, no digest-named imports.
- **An auth *mode*.** Authentication is always on; development has personas (`--as`).
- **A supervised bundler.** The server never spawns, proxies, or watches Metro or Vite.
  The client contract is `SNAPBACK_URL`.
- **Client arms beyond React web, Expo, and Exact 2** — in that order. No Swift, no
  Kotlin, no Dart until the three are green on the bar.
- **Media collections, push, cron, vector/search, hosted control planes, multi-region,
  federation.** Assets (typed intent), one `channel` kind, one `schedule` kind, one
  hosted target: that is the feature list until the bar is met.
- **Offline beyond retention v1** (LLP 0329.014.007 F8). Hold sets, dependency-aware
  outbox, delta resume come after the bar, if the benchmark asks for them.
- **A guide.** `snapback2 guide` serves the compiler's facts, a one-screen grammar, and
  about twelve recipes with CI-executed snippets. No million-word corpus, no embedded
  20 MB guide in the binary, no calendar freshness dates.
- **WASM anywhere.** The client evaluator is the 9.5 KB gzip TypeScript twin
  (the RBAC-complete successor to spike S3's 7.8 KB measurement).

## Process not doing

- **No drift registries, inventories, line-pinned diagnostics registries, claim
  digests, or frozen-record gates.** They were 188 open / 623 closed v1 tickets by
  themselves (LLP 0329.016 §2.2 M8). Generated projections are built, not committed.
- **No gate bound to an exact commit; no push gated on a battery.** Five blocking
  checks, sixty seconds, run locally before push. Everything slower runs on a schedule
  and files a bounded set of issues.
- **No fresh worktrees per task.** Named lanes, reused, warm.
- **No `snapback2 <verb>` added without its row in LLP 0329.016 §5.11** and its entry in
  the measured loop.
- **No diagnostic code without a family, a site, a rewrite, and a page.** ~20 families,
  not 3,597 codes.
- **No spec without an implementer and a date; only implemented specs bind.** LLP
  0329.014.004 and 0329.016 are proposals until the code they describe runs here.
- **No files over 1,500 lines**, including ones we would like to steal from v1. Split
  them on the way in or leave them.

## Deliberately worse

- No backwards compatibility with Snapback 1 apps, packages, or on-disk formats.
- No API stability before promotion; every publish is `0.0.x`.
- Sparse prose documentation; the diagnostics and the recipes carry the load.
- One hosted target, one storage engine (SQLite), one platform binary at a time.

## Moving something off this list

Write one line naming what it unblocks, and take something off the doing-list in the same
PR. If nothing can come off, the answer is no.
