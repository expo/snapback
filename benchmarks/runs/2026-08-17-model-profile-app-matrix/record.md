# Run record — model × profile × app matrix, 2026-08-17/18

**Status: CALIBRATION — exploratory evidence only, not claim-eligible.**
N=1 per cell; shared-machine load contamination disclosed in README.md.

## Results

Wall = launcher meta epochs (process segments summed). Tokens preserve each
harness's raw accounting fields (see README metering notes). Cost: opus =
harness-reported; sol/grok = computed from public list prices, approximate.

| Lane | Outcome | Wall | Output tokens | Cost (USD) |
|---|---|---:|---:|---:|
| sol-clique-explicit | M1–M3 green | 3,720s | 120,825 | 28.98 |
| sol-clique-familiar | M1–M3 green | 4,748s | 139,934 | 34.36 |
| sol-coterie-explicit | M1–M3 green | 5,212s | 159,445 | 43.04 |
| sol-coterie-familiar | M1+M3 green; M2 choreo non-green (exact-defect) | 7,631s | 152,614 | 39.04 |
| grok-clique-explicit | M1–M3 green | 4,336s | 141,020 | 28.51 |
| grok-clique-familiar | M1–M3 green | 19,346s¹ | 188,471 | 35.49 |
| grok-coterie-explicit | M1–M3 green | 7,664s | 263,396 | 57.06 |
| grok-coterie-familiar | M1–M3 green | 7,002s | 196,650 | 40.64 |
| opus-clique-explicit | M1–M3 green | 27,282s² | 387,583 | 135.19 |
| opus-clique-familiar | M1–M3 green | 12,367s | 430,232 | 163.60 |
| opus-coterie-explicit | M1–M3 green | 13,504s | 365,823 | 115.56 |
| opus-coterie-familiar | M1–M3 green | 8,283s | 333,058 | 84.90 |

¹ Ran concurrently with the heaviest machine load of the run (opus 7h lane +
fleet); one mid-run session compaction.
² Three process segments: a transient Anthropic API 500 killed segment 1;
resumed in the same session. The lane's own log documents choreography
locator waits failing at loadavg ~150–250 and passing at ~6.

Full raw fields per lane (input/cached/cache-read/reasoning splits) are in
`meta/final-metrics.json` in the retained run workspace; the twelve diaries
carry each lane's numbers in their headers.

## Headline observations (calibration-grade)

1. **35 of 36 milestone-cells green.** Every model completed both apps and
   both profiles on the published 0.1.24 surface except one cell:
   sol-coterie-familiar's M2 choreography (suite itself 22/22 green).
   Compare 2026-08-13 (grok familiar M3 never green, familiar unpublished,
   source-checkout diagnostics only): the published surface is now
   completable by three model families with zero source-checkout escapes.
2. **The single red is an Exact finding, not Snapback.** Frozen-choreography
   navigation intermittently detaches Exact SPA links mid-route, wedging the
   shared browser page for later attempts. 1 reproduction / 2 clean passes
   across the three coterie-familiar-adjacent lanes; filed as
   `issues/shelved/20260818-exact-spa-link-detachment-under-choreography.md`.
3. **Explicit vs familiar (within model, clique):** sol 3,720s vs 4,748s;
   grok 4,336s vs 19,346s (load-contaminated); opus 27,282s (contaminated +
   API interruption) vs 12,367s. No stable profile ordering at N=1; token
   spend is consistently higher on familiar for sol/grok clique lanes.
4. **Coterie (fresh Exact/Contract client + Snapback backend) is buildable
   in one lane** by all three models: 1.4–3.75h to M1–M3 green. The
   presentation-port rule (sm-* vocabulary) let the frozen Clique
   choreography drive brand-new non-React clients unmodified.
5. **Convergent friction (three independent lanes each):** the pinned-port /
   fixed-origin dev attach path; auth-custody lifecycle discoverability
   (storagePartition process-global default, custody-store-is-not-one-file,
   Expo web reload posture); background writes during authorization
   transitions; presence publish-vs-heartbeat semantics; guide search
   fuzziness. Filed as guide-gap tickets (see the 2026-08-18 ticket batch).
6. **Convergent praise:** typed refusal quality ("named exactly what was
   stale"), server-homed domain invariants, zero-transport-code live
   two-client behavior, the ephemeral TTL primitive, fixture replay through
   the app's own write path, and generated exact references.
7. **Release-gate value:** none of the six defect families fixed in the
   pre-cut gate program (live subscriptions, auth queue-store isolation,
   expo wasm export, visibility stragglers) appeared in any lane — every one
   of them sat on paths these lanes exercised.

## Deviations and environment incidents

- The first pilot attempt ran under the codex seatbelt sandbox and was
  aborted by browser SIGABRT (archived as `attempts/` in the run workspace);
  a second attempt was invalidated by a surviving first-attempt agent
  rebuilding into the recreated lane directory. The recorded
  sol-clique-explicit lane is attempt 3, launched from a verified-clean
  directory. Neither discarded attempt contributes numbers.
- opus-clique-explicit: transient API 500 + same-session resume (segments
  summed).
- Machine-wide process kill waves killed launcher/monitor infrastructure
  twice; lanes themselves were re-verified alive or relaunched clean.
