# Run record — Clique local-main Claude Sonnet 5

**Status: CALIBRATION — unpublished current-source evidence, not
claim-eligible.** Both requested profiles attempted all 8 milestones. The
two lanes used **different acceptance methodologies** (see below), so this
record does not support an Explicit-vs-Familiar efficiency comparison —
only two independent qualitative accounts of building the same brief on the
same unpublished commit.

## Results

| Lane | Milestones green | Verification | Wall | Output tokens | Tool uses | Correction loops |
|---|---|---|---:|---:|---:|---:|
| Explicit | M1–M4 full; M7 done (uncovered); M5/M6/M8 partial | Frozen two-browser Playwright choreography (`choreography.mjs`) | 3h44m (10:32Z–14:17Z) | 710,707 | 1,054 | 21 (3 `snapback-defect`, 3 `snapback-defect`-adjacent, 1 `environment`, 14 `agent-error`) |
| Familiar | All 8 reported green | Hand-authored headless acceptance suite (`acceptance.mjs`/`bun run prove`, 43 checks by M8) — **not** the frozen choreography | 1h58m (14:18Z–16:16Z) | 869,856 | 599 | 6 (1 `environment`, 4 `ambiguous`, 1 `agent-error`) |

Token/tool-use/duration figures are the Claude Code subagent-usage totals
for each lane's single builder-agent invocation (harness-reported
`subagent_tokens` / `tool_uses` / `duration_ms`), not a native per-turn
metering stream and not validated against the LLP 0201/protocol.md
watchdog schema — an informal, not cap-bearing or schema-validated, token
source. Wall-clock is the orchestrator's own `date -u` bracket around each
lane's Agent-tool invocation, cross-checked against each lane's internal,
`date -u`-sourced diary/run-log timestamps.

**Do not read "Familiar: all 8 green" against "Explicit: 4 of 8 green" as a
capability or efficiency comparison.** The Familiar lane's checks are real
(a live backend, real fixture personas/media, no mocking) but self-authored
and self-graded against its own understanding of the brief; the Explicit
lane's M1–M4 were independently verified by the same frozen two-browser
choreography a different builder/model would also be held to. The Familiar
lane disclosed this gap itself rather than claiming choreography parity it
didn't have.

## Milestone-by-milestone

See `diaries/0107-sonnet5-clique-explicit-local-main.diary.md` and
`diaries/0108-sonnet5-clique-familiar-local-main.diary.md` for full detail.
Summary:

| Milestone | Explicit | Familiar |
|---|---|---|
| M1 Accounts/profiles | Green (choreography) | Green (acceptance suite) |
| M2 Posts/follow graph | Green (choreography) | Green (acceptance suite) |
| M3 Messaging core | Green (choreography) | Green (acceptance suite) — **but shipped a disclosed public-read compromise on messages/receipts/reactions/conversationMembers**, see Findings |
| M4 Media/reactions/edit-delete | Green (choreography), after diagnosing a systemic asset-URL rendering bug live since M2 | Green (acceptance suite); message media also forced to `public-immutable` |
| M5 Ephemeral/chat-config/search | Partial — blocked by a verified `react-native-web`/frozen-kit accessibility-prop mismatch | Green (acceptance suite); found the likely root cause of the M3 compromise (a `v.principal()`/`v.id('users')` type confusion) while adding a missing authorization check |
| M6 Offline writes/push/custom API | Partial — offline writes blocked by the documented "no qualified Expo/web durable outbox" gap; push + custom API verified working | Green (acceptance suite, scope-reduced: no connection-aware push gating, no offline harness) |
| M7 Day-2 evolution | Done, manually verified — no frozen choreography segment exists for M7 at all | Green (acceptance suite), run in-place rather than as a genuinely fresh session |
| M8 Insights/digest/multi-device | Partial — 3/5 green with zero fixes (multi-device live messaging and cross-device read-state "fell out for free"); remaining 2 blocked by the same M6 gap | Green (acceptance suite, scope-reduced: digest is a callable sweep, not wall-clock-scheduled — Familiar has no cron primitive) |

## Findings

1. **A shipped, disclosed privacy regression, with an open root-cause
   question — the most important finding of this run.** The Familiar
   lane's `messages`, `messageReceipts`, `messageReactions`, and
   `conversationMembers` tables are public-read rather than
   membership-gated, after the lane could not get the documented membership-
   visibility read path (nor the sanctioned `requireRole`+`elevated.query`
   escape hatch, nor a bare `ctx.db.get`) to return rows to a genuine,
   bona-fide member across roughly a dozen isolated attempts. It later found
   a real bug of its own (`v.principal()` vs. `v.id('users')` type
   confusion in every membership-insert call site) that may fully explain
   the symptom, but explicitly did not re-test with corrected principals to
   find out before this report was written. Tracked in
   `issues/shelved/20260822-membership-visibility-read-denial-needs-reverify.md`,
   which also carries the lane's suggestion: a branded/nominal type for
   `Principal` vs. `Id<table>` would have caught its own bug at
   `snapback generate` time.
2. **"Choreography-green" is only as strong as what the frozen contract
   actually drives.** The Explicit lane's biggest bug — every image/video in
   the app rendering broken since M2 (a raw `v.assetRef` id passed straight
   into `<Image>` instead of resolved via `useSnapbackAssetUrl`) — went
   undetected for two milestones because M2's choreography has no compose
   media-picker test id, so a green M2 never actually loaded an image. Only
   M4's media-specific assertions caught it.
3. **The runtime-readiness checkout-root inference bug reproduced in both
   lanes independently**, each losing real setup time to it before finding
   the same class of workaround. Already tracked as
   `issues/shelved/20260817-0275-auto-qualify-packaged-runtime-in-prove.md`; this
   run adds corroborating, independent evidence.
4. **Two real, disclosed offline-capability gaps, both discoverable from the
   guide rather than hidden:** no qualified durable write-outbox on the
   Expo/web target (blocks required M6/M8 items in the Explicit lane), and
   no offline-resolution story for a brand-new live-query subscription
   (worked around client-side in Explicit's M5). Both lanes independently
   praised the platform for disclosing these in its own capability index
   rather than silently failing.
5. **A frozen third-party UI kit / installed `react-native-web` version
   mismatch blocked a required Explicit-lane item** (M5's chat-color-sync
   check) — the kit's accessibility props never reach the DOM under
   `react-native-web@0.21.2`, confirmed by reading the library source
   directly. Not a Snapback defect; a benchmark-fixture/scaffold dependency
   mismatch.
6. **Self-inflicted test-hygiene mattered more than either lane expected.**
   Explicit's hardest-to-diagnose flake (M4's video-viewer check) traced to
   144 accumulated messages from ten unreset choreography reruns against the
   same dev database, not a platform bug — degraded interaction latency
   looked exactly like a flake until the data was reset.
7. **Familiar's schema-migration mechanics (M7) were praised as a genuine
   ergonomic win** over a Postgres/Prisma migration-and-backfill dance: an
   additive optional field, one idempotent backfill mutation verified
   against a pre-migration snapshot, forward maintenance in existing write
   paths — no separate migration DSL or file.
8. **Both lanes independently identified the live-query/session model as
   Snapback's clearest structural strength for this app shape** — realtime
   feeds, messaging, receipts, reactions, and (Explicit's M8) multi-device
   read-state sync all worked with zero hand-written subscription or
   cache-invalidation code, including features neither lane specifically
   built for multi-device correctness.

## Setup deviations and non-findings

- `benchmarks/tools/lane-setup.mjs` could not generate either lane's
  orientation packet (fixture pack only covers M1–M3; the tool also refuses
  to overwrite the scaffold's own `AGENTS.md`). Both lanes received a
  hand-written orientation directly in their launch prompt instead — a real
  tooling gap at this brief's current pre-freeze state, not a lane defect.
- The local package-preparation step reused a pre-built local-source
  closure (including `@expo/snapback-cli` and `@expo/snapback-codegen` with
  their prepack steps already run) that concurrent same-day activity had
  already produced at the exact same commit in the shared scratch directory,
  rather than re-deriving it from `scripts/install-local-snapback-packages.mjs`
  (which is known, per the prior local-main run's own record, to miss the
  CLI/codegen packages). Faster and equally correct for this exact commit;
  not independently exercised as a fresh recipe by this run.
- Both lanes' builder agent was Claude Sonnet 5 via the Claude Code Agent
  tool, not a metered, schema-validated harness run — token/tool/duration
  figures above are the Agent tool's own usage accounting, explicitly not
  claimed as `tokens.source`-approved per `protocol.md`'s social-messenger
  amendment.
- One stray `snapback` dev-server process was left listening on the
  Explicit lane's port range after that lane's agent reported clean
  shutdown; the orchestrator killed it and confirmed the range clear before
  starting the Familiar lane. Not a data-affecting issue (Familiar used a
  disjoint port range throughout), but worth naming as a real, if minor,
  gap between "lane reported clean" and "lane was clean."
