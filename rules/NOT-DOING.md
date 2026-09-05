# What Snapback 2 Does Not Do

This is the most valuable file in the repository. It is longer than the doing-list on
purpose. Moving something off it means writing one line naming what it unblocks and
taking something off the doing-list in the same change.

## The bars that make this list derivable

Three bars, named separately so one name never covers two objects (LLP 1007 §4a;
the author delegated the first two to the orchestrator on 2026-09-02 and added
the third on 2026-09-04, LLP 1012 §12):

- **The loop bar.** A fresh agent, with only the installed package and the task,
  builds the reduced Clique M1–M3 (accounts, feed, realtime chat; React web; no
  media) on the **published** snapback2 in under 1,200 s with at most one
  Snapback-attributed correction loop, and `snapback2 test` proves it
  (LLP 0329.016 §8). Everything not required by this bar does not exist yet.
- **The capability bar.** `benchmarks/briefs/social-messenger.md` M1–M3 as
  written: Expo on iOS, Android, and web; an avatar; one to four images and one
  video; no external I/O. It starts only after the loop bar is met on a
  published package. When it starts, LLP 1006's first slice is the brief's
  formats **plus HEIC and QuickTime MOV** (author ruling 2026-09-03, held over
  a 2–1 panel recommendation): iPhone cameras produce both, and the brief's
  own real-phone acceptance cannot pass without them. The offsetting item is
  non-media `file` columns, which LLP 1006 §13a designs and defers to a later
  slice. Until then the media and Expo slice stays on this list.
- **The offline bar.** `benchmarks/briefs/social-messenger.md` M5 acceptance 5,
  M6 acceptance 1 and 2, LLP 1012 §10's physical process-kill witness, and
  one acceptance only the client twin can pass (a never-opened chat renders
  offline through its query; an offline send is predicted into that thread),
  green on the Expo iOS simulator and React web on a **published** package
  (author ruling 2026-09-04, LLP 1012 §12; the twin acceptance from the
  author's principle the same day: go straight to the ideal, no staging). It starts when the loop bar is met
  and runs alongside the capability bar's Expo arm, which shares the carrier.
  Until then local-first v1 is specified, not built.

## Not building

- **A second authoring profile, a plan algebra, or a JS handler lane.** One language —
  Quarry (LLP 1004; the TypeScript authoring surface was deleted on 2026-09-02, LLP
  1007 §4b) — one spelling. TypeScript is the lowering target and the harness language
  (seeds, journeys, effect bodies), never a way to author tables, rules, queries, or
  mutations. Familiar vs Explicit cost every v1 doc twice (LLP 0317 bundle 6).
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
- **Offline beyond local-first v1** (LLP 1012, author rulings 2026-09-04). v1 is the
  result cache over a durable per-principal range store, `until-revoked` and
  `delivered-history` retention, digest-checked re-authorization at reconnect, a
  FIFO outbox settled by OCC, local evaluation by the twin, and asset bytes under
  the owning row's lease. Not built until a brief's number asks (LLP 1012 §11):
  hold sets, the dependency-aware outbox, per-row delta resume with tombstones, a
  local token index, per-field `unheld`, a store budget with eviction priority,
  cancel/`asOf`, `purge-on-block`, `all-owned`, `merge` modes and `sequence`, any
  at-rest encryption claim, and device-to-device sync.
- **Observability and analytics beyond `why`, `trace`, `logs`, and `data`** (LLP
  1009, shelved 2026-09-04). Slid off the doing-list to pay for local-first v1
  (LLP 1012 §13); returns when the offline bar is met.
- **A guide.** `snapback2 guide` serves the compiler's facts, a one-screen grammar, and
  about twelve recipes with CI-executed snippets. No million-word corpus, no embedded
  20 MB guide in the binary, no calendar freshness dates.
- **Native view-once video playback (v1).** AVPlayer opens files and URLs, not memory, and a
  view-once clip never touches disk (LLP 1013 decision 7, amended by the device 2026-09-05);
  the native player refuses the clip up front and consumes nothing. Returns with the author's
  ruling on the path (resource-loader module, WebView, or a temp file the spec forbids).
- **WASM anywhere.** The client evaluator is the TypeScript twin, under a **30 KB gzip
  ceiling** (author ruling 2026-09-04): 19.7 KB measured at landings 5–6 of LLP 1012
  (`snapback2/metrics/twin.jsonl`, with the method; the RBAC-complete, trace-producing
  successor to spike S3's 7.8 KB and the 9.7 KB first measurement). A lane that would
  cross 30 KB files the move here first.

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

## Moves

- 2026-09-04 — **on:** local-first v1 (LLP 1012); unblocks the offline bar. **off:**
  LLP 1009 observability and analytics (author ruling; returns when the offline bar
  is met).
