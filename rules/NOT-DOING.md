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
  1007 §4b) — one spelling. Quarry binds directly to typed IR. TypeScript is limited to
  seeds, journeys, and effect bodies, never a lowering target or a way to author tables,
  rules, queries, or mutations. Familiar vs Explicit cost every v1 doc twice (LLP 0317
  bundle 6).
- **JavaScript in the data plane.** Queries and mutations run in the Rust IR
  interpreter inside the SQLite transaction. Ibex 2 is linked only by
  `snapback2-effects`, only with `--features hermes`, only for effects.
- **Committed generated code.** Types by inference; IR, certificate, and stubs are a
  gitignored build cache. No `generated/`, no review manifest, no digest-named imports.
- **An auth *mode*.** Authentication is always on; development has personas (`--as`).
- **A supervised bundler.** The server never spawns, proxies, or watches Metro or Vite.
  The client contract is `SNAPBACK_URL`.
- **Exact 2 until Unicode prefix search qualifies on React web and Expo**, and
  client arms beyond those three. The 2026-09-06 session-delegated move below
  postpones Exact 2 to fund coherent indexed online/offline search. No Swift,
  Kotlin, or Dart.
- **Media collections, push, cron, vector/ranked search, hosted control planes,
  multi-region, federation.** Exact Unicode word-prefix indexing is the narrow
  2026-09-06 search exception below. Assets (typed intent), one `channel` kind, one `schedule` kind, one
  hosted target: that is the feature list until the bar is met. Exception (author ruling 2026-09-05, LLP 1015 §7, §8.7): lane H0 of the
  control plane — `deploy` to a directory, the release ledger, snapshots, `rollback`,
  `secret`, and token admission in `serve` mode; no provider, no registry — may start
  before the loop bar. The hosted lanes H1–H3 still wait for it and for LLP 1015 §11.
- **Offline beyond local-first v1** (LLP 1012, author rulings 2026-09-04). v1 is the
  result cache over a durable per-principal range store, `until-revoked` and
  `delivered-history` retention, digest-checked re-authorization at reconnect, a
  FIFO outbox settled by OCC, local evaluation by the twin, and asset bytes under
  the owning row's lease. Not built until a brief's number asks (LLP 1012 §11):
  hold sets, the dependency-aware outbox, per-row delta resume with tombstones,
  per-field `unheld`, a store budget with eviction priority,
  cancel/`asOf`, `purge-on-block`, `all-owned`, `merge` modes and `sequence`, any
  at-rest encryption claim, and device-to-device sync.
- **Observability and analytics beyond `why`, `trace`, `logs`, and `data`** (LLP
  1009, shelved 2026-09-04). Slid off the doing-list to pay for local-first v1
  (LLP 1012 §13); returns when the offline bar is met.
- **A guide.** `snapback2 guide` serves the compiler's facts, a one-screen grammar, and
  focused topic/keyword cards with CI-executed snippets inside one package byte
  allocation; no fixed page count. No million-word corpus, no embedded
  20 MB guide in the binary, no calendar freshness dates.
- **WASM anywhere.** The client evaluator is the TypeScript twin. The complete
  local runtime has an **85,000-byte gzip ceiling**, **80,000 the target**,
  explicitly approved **2026-09-09 by the author** to land the six small-items
  changes, superseding the 2026-09-08 allocation of 84,000. A feature that does not fit is
  descoped or paid for by deletion. The five-root measurement uses Node 24.18.0,
  esbuild 0.25.9, gzip level 9; all normalization data, decoding, indexes,
  incremental state, prediction and local cursors participate. Relocating
  required bytes does not count as a saving. Measurements remain in
  `snapback2/metrics/twin.jsonl`; the allocation does not establish qualification.

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
- 2026-09-05 — **on:** the control-plane contract, lane H0 (LLP 1015 §7); unblocks a
  backup/export story and the static-stability test before any hosted target exists.
  **off:** the browser admin console (author ruling; a user-focused console comes after
  the hosted version, on the same `/control/*` routes).

- 2026-09-05 — **on:** the administrative plane (LLP 1016 revision (a): the system
  principal as the store's owner, jobs as certified sweeps, narrowing at successor
  application, `schedule … at` and `every <duration>`, the operator seat, a rehearsal
  runtime) — author ruling to implement now, ahead of the loop bar; unblocks server-side
  expiry (brief M5), the schedule-driven digest (M8), backfills of non-maintained columns,
  and operator repair without a raw write path. **off:** the `system` rule word (it could
  only mean `deny`), the client-invoked `purgeExpired` recipe, the `fork` CLI adapter
  (LLP 1007 §7's ruled deletion, executed), and `persona create` (personas are created on
  first use). "Cron" on the not-building list still means a service, expressions, or
  calendar syntax; one duration on the one `schedule` kind is inside the line.
- 2026-09-05 — Native view-once video returns on the author's explicit request
  to fix playback. The in-memory native view completes the existing asset arm;
  temp-file playback, new media formats, and additional client arms stay out.

- 2026-09-06 — **on:** engine-maintained Unicode `wordPrefixes` indexing and the
  persistent indexed twin, including exact held-search reads and local cursors;
  unblocks the same named search on already-synced messages warm and cold offline
  (brief M5/M6). **off:** Exact 2 until this search qualifies on React web and
  Expo. **Budget:** 34,000 bytes gzip total twin, 30,000 target (historical;
  superseded by the freeze above); the 1M-step,
  4 MiB closure, 8 MiB heap and 1 MiB output ceilings stay. **Build exception:**
  one ordinary `snapback2-core/build.rs` for pinned Unicode inputs to ignored
  build artifacts, coordinated with existing `build.mjs`; no new Unicode crate,
  gate, registry, service or runtime generator. These are decisions made in the
  current session under the user's explicit delegation, not earlier author
  rulings. The foundation implements shared Unicode/key primitives first;
  engine, compiler and held-twin integration/qualification follow.

- 2026-09-08 — Ceiling history (superseded by the freeze above): 34,000 → 50,000 → 66,000 → 82,000 → 82,500 → 84,000 bytes gzip.
- 2026-09-09 — Quarry `slice(text, start, end)` exposes the existing Unicode-scalar IR primitive; it unblocks one 80-character stored-and-emitted push preview without a new runtime feature, service, or dependency.
- 2026-09-09 — Period `.periodStart`/`.periodEnd` bindings complete LLP 1016 D5's existing period-value contract; they unblock one cutoff across digest and prune sweeps without a new scheduler kind, service, state table, or dependency.
- 2026-09-10 — **on:** `deliver` (LLP 1019 D1/D3): the grammar gains `deliver`, `to`, `as`,
  `with`, `receipts`, `bootstrap`; unblocks engine-derived per-recipient custody — the
  send-time audience, tombstones as events, receipts — without an authored log table or a
  fan-out proc in every app. **off:** the `tombstones` declaration, which leaves the
  grammar at the chat template's cutover to the derived log (LLP 1019 D6): until D2's
  writes exist the shipped template's offline eviction rides on it, so that line is the
  offset this move owes.
