# Run record — Clique local-main Grok 4.6 xhigh

**Status: CALIBRATION — unpublished current-source evidence, not
claim-eligible.** The requested Explicit profile completed M1–M3 green.

## Results

| Lane | Outcome | Wall | Output tokens | Cost (harness) | Correction loops |
|---|---|---:|---:|---:|---:|
| grok-clique-explicit-local-main-r01 | M1–M3 green | 12,415s (3:26:55) | 335,746 | $20.36 | 7 snapback-defect + 6 agent-error + 3 environment |

Wall is from driver brief-delivery origin `2026-08-22T10:24:32.639Z`
(`startEpoch` 1787394272) to agent `end=1787406687`
(`2026-08-22T13:51:27Z`). The agent-logged start was nine seconds later
(1787394281); using that origin is 12,406s.

The lane passed its M1–M3 suite receipts, the frozen two-client choreography
greens (M1 3/3 required, M2 7/7 required with 2 optional media skips, M3
required DM + typing plus optional quote; 4 M3 semantic-driver checks skipped
unimplemented), and three iOS Hermes exports. Skips are the same frozen
instrument class as the 2026-08-20 Sol-high local-main run; they are not
turned into claims.

Raw grok streaming-json `end` usage (uncached input separate from cache
reads; reasoning is a subset of output):

| Channel | Count |
|---|---:|
| Fresh input | 2,746,099 |
| Cache reads | 116,780,928 |
| Cache writes | 0 |
| Output | 335,746 |
| Reasoning (inside output) | 311,287 |
| Model turns | 471 |
| Tool calls | 972 |

`tokens.source` for a scored social-messenger record would be `null` /
`unavailable` for grok. The figures above are diagnostic harness spend, not
a cap-bearing meter.

## Milestone wall to first green

| Lane | M1 | M2 | M3 |
|---|---:|---:|---:|
| Explicit | 3,057s | 7,285s | 1,910s |

M3 wall is m2-green → m3-green. Most of the cost was M2: live-query
blanking after inserts, a Metro HMR lifecycle reclaim, and a grok session
compaction at 1787398057 that forced run-log reconstruction.

## Live evidence (final green choreography)

- M1 profile live: first two 20s attempts missed; passing trial visible in
  184ms (other-client note 156ms).
- M2 live text post: 813–1,817ms visible; follow/unfollow 563–1,041ms;
  like 758–952ms; repost 634–749ms.
- M3 DM delivery: 807ms, 847ms, 827ms visible.
- M3 typing: visible 1,587–1,640ms, withdrawn 2,804–2,809ms.

## Findings

1. **Table live queries can publish empty after a same-table insert.**
   `postById` / `repliesForPost` (`eq('_id')` / parent filter) went empty
   after `writePost` even though the mutation succeeded and the parent
   reply count incremented. `messagesForConversation` had the same family
   of miss until it became a JS live query. Workaround: `defineJsLiveQuery`
   plus a local cache. Filed as
   `issues/20260822-guide-gap-table-live-query-blank-after-insert.md`.
2. **CanonicalClientValueV1 `maxNodes=4096` can refuse Expo boot.** Adding
   M3 queries grew `app.api.queries` to ~6,251 nodes and blanked the web
   app with `SNAPBACK_REACT_ARGS_INVALID`. Deleting unused queries and
   folding pagination `before` into optional args restored boot. This is a
   product ceiling, not a lane mistake. Filed as
   `issues/20260822-guide-gap-generated-app-canonical-node-ceiling.md`.
3. **Supervised Expo authority is one minted session.** Adopting
   `snapback-dev@localhost.invalid` collapsed Alice and Bob in two
   browsers. Clique two-client proof required
   `resolveSupervisedAuthority` to return unavailable. The start packet
   does not say so. Filed as
   `issues/20260822-guide-gap-supervised-expo-mint-two-client.md`.
4. **Guest reaping and `v.principal()` on non-owner edges still surprise
   generate.** Follow/post/like/repost tables needed `principalField`;
   `followeeId: v.principal()` failed and was stored as string.
5. **`clientMutationId` replay under a fresh IndexedDB session hit
   `SNAPBACK_AUTH_STALE_RESULT`.** The lane dropped transport IDs from
   seed replay and relied on application `mutationId`/`fixtureId`. This
   matches the 2026-08-20 local-main observation.
6. **`defineEphemeral` is not a `schema.mjs` export.** Exporting `typing`
   refused with `SNAPBACK_DEFINITION_IN_SCHEMA_MODULE`; the working path
   is `defineEphemeral({ typing })` in schema options. `defineSurface`
   presence bind then failed (`SNAPBACK_SURFACE_REFERENCE_UNKNOWN`);
   `useSnapbackActivityPresence` worked.
7. **Metro HMR under `snapback dev --expo` can close the lifecycle.**
   Restarting the same command on port 48100 preserved sqlite because the
   lane did not reset. Counted as environment.

## Interpretation

Unpublished `main` at `b70caf19ea` is Clique-completable on Grok 4.6
xhigh in the Explicit profile. The hard realtime paths (profile, feed
text, DM, typing) are green once the lane switches point/list reads off
the table live-query incrementalizer. The strongest product feedback is
the post-insert blank and the 4096-node generated-`app` ceiling — both
arrived as runtime refusals rather than generation-time or start-packet
warnings.

For a weak directional comparison only, the published 0.1.24 Grok xhigh
Explicit cell (diary 0096) was 4,336s / 141,020 output tokens. This
current-source run was 12,415s / 335,746 output tokens, with a mid-run
compaction and a different machine-load envelope (loadavg-1 ranged
1.25–10.04). Effort, source, and setup differ, so the deltas are
observations, not regressions.

The 2026-08-20 Sol-high Explicit local-main lane on an older commit was
4,055s / 123,561 output tokens at *high* effort. Cross-model token
counts are not comparable.

## Setup deviations and non-findings

- Orchestrator packed JS tarballs from current `main` and pointed
  `SNAPBACK_RUNTIME_BINARY` at the bootstrap-qualified debug binary
  (492,459,512 bytes, gitCommit `b70caf19ea`). The packed
  `@expo/snapback-runtime-darwin-arm64` tarball still contained an
  August 12 release binary and was **not** used.
- Scaffolding via `bun add -g @expo/snapback-cli` would have resolved
  public npm 0.1.0; the lane used the file: CLI tarball and
  `rewire-local.mjs`. That npm hit is an unpublished-run environment
  loop, not a product defect.
- Login PATH exposed Bun 1.3.14; the lane used vendor bun 1.3.12.
- One grok session compaction mid-M2 destroyed the on-disk run-log body;
  the reconstructed log is labeled as such.
- A `Read` deny on `/Users/ccheever/projects/snapback/**` did not block
  writes. An untracked `bun.lock` appeared in the live checkout's
  choreography directory during the run and was discarded; it is not
  part of this record.
