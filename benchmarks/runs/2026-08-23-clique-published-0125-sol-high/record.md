# Clique full-run record — published 0.1.25, Sol high

**Status: CALIBRATION — N=1 per profile, not claim-eligible for magnitude
(LLP 0201 D5).** Both profiles reached receipt-backed web authoring-green for
M1–M6, M8, and fresh-session M7 on published Snapback **0.1.25**. Explicit
completed the scale replay; Familiar did not. No grader session ran, so no
O-dimension or full product-completion claim is made.

## Configuration

- **Model/harness:** `gpt-5.6-sol`, Codex CLI 0.149.0, `high` reasoning,
  unsandboxed.
- **Published closure:** all 14 public `@expo/snapback-*` packages verified at
  0.1.25 from npm before launch.
- **Instrument:** `social-messenger@0.3.2-m8`; manifest SHA-256
  `3438c84b8831239ab95e167eed79675a2127d7d63b3cb0f1ce72811872e2898e`.
- **Scale log:** 167,157 actions; SHA-256
  `b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9`.
- **Machine:** fleet entry `expo-build-450b`, endpoint hostname
  `expose-builder-pixel-a`; Linux x86-64, AMD Ryzen 5 3600 (6 cores/12
  threads), 125 GiB RAM. The host was idle before launch and lanes ran serially.
- **Ports:** Explicit 48100–48159, Familiar 48160–48219, Explicit M7
  48300–48359, Familiar M7 48360–48419.
- **Protocol:** one continuous M1–M6+M8 session per profile, then one fresh M7
  session per profile. Same model/effort; no user steering inside a lane.
- **Native posture:** Linux has no Xcode/iOS Simulator. M6/M8 native evidence
  is honestly null and is non-gating under the web authoring rule.

## Outcome

| Lane | M1–M6/M8 | M7 | Scale | Continuous runner wall | M7 runner wall |
|---|---|---|---|---:|---:|
| **Explicit** | all green | green | **167,157/167,157 green** | 18,766s (5:12:46) | 1,948s (32:28) |
| **Familiar** | all green | green | **capability-failure, 2,620/167,157** | 9,737s (2:42:17) | 2,499s (41:39) |

The total wall row is not a profile speed comparison: Explicit spent 11,314s
completing scale, while Familiar terminated scale after 404.627 active seconds.
For the comparable product-authoring milestones, Explicit summed to 6,270s and
Familiar to 7,961s. Explicit was also first-green on M7 in 1,076s versus
Familiar's 2,049s. These are observations from one pair, not magnitude claims.

## Milestone walls to first green

| Lane | M1 | M2 | M3 | M4 | M5 | M6 | M8 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Explicit | 2,183s | 380s | 1,468s | 268s | 1,420s | 143s | 408s |
| Familiar | 2,069s | 882s | 3,015s | 1,005s | 409s | 145s | 436s |

All listed greens have a passing suite receipt and a green required-web
choreography segment summary. M2's two media-compose checks and several M3
checks are instrument-declared optional where the frozen control contract
cannot drive them honestly.

## Token usage

Cached input is a subset of input.

| Session | Input | Cached input | Output | Reasoning |
|---|---:|---:|---:|---:|
| Explicit continuous | 175,559,887 | 173,759,488 | 287,079 | 59,929 |
| Familiar continuous | 89,340,348 | 87,856,384 | 213,895 | 55,379 |
| Explicit M7 | 25,397,088 | 24,996,864 | 61,649 | 19,128 |
| Familiar M7 | 18,174,003 | 17,862,656 | 55,210 | 16,007 |
| **Explicit total** | **200,956,975** | **198,756,352** | **348,728** | **79,057** |
| **Familiar total** | **107,514,351** | **105,719,040** | **269,105** | **71,386** |

The token totals include scale work and therefore inherit the unequal scale
outcome. They are useful metrology, not evidence that Familiar completed the
same work with fewer tokens.

## Scale replay

### Explicit

Explicit's first fresh attempt reached 8,873 actions and hit
`SNAPBACK_CLIENT_MUTATION_RETENTION_FULL` because one-shot replay calls retained
transport mutation IDs. The corrected adapter used `clientMutationId: null`
for sequential one-shot transport custody while preserving application intent
IDs, started from another fresh starter-only backend, and completed:

- 167,157/167,157 actions, settle-before-next;
- 11,314.113 active seconds (3:08:34);
- 10% and 50% checkpoint pauses retained;
- all seven reconciliation groups green;
- final counts include 1,008 users, 50,228 posts, 1,002 conversations,
  100,015 messages, and 2,000 active reactions;
- settlement ledger SHA-256
  `7e33f0dc4b7ddb95348526d023d9db48c9da8d6d4f71874bdbff2c585728844a`.

### Familiar

Familiar's fresh backend settled 2,620 contiguous actions (1.5674%), ending on
source line 2,620 (`u0116 follow`). Its first adapter correction cached settled
entity identifiers rather than opening a live reference query before every
mutation. The remaining topology created a synchronized public replica for
each new authenticated actor; at about 116 retained post-resume clients the
replay process was about 759 MB and per-action settlement was degrading. The
lane terminated before 10%, retained the exact partial ledger, and correctly
recorded `finalStateConforms: false` with no checkpoint claim.

This is a lane capability-failure, not proof that Snapback itself cannot serve
the fixture. The adapter did not demonstrate a dispose/re-authenticate topology
or otherwise complete the instrument, so the result should route future
adapter/product investigation rather than a backend magnitude claim.

## M7 day-2 evolution

Both fresh sessions added group polls and a maintained/backfilled conversation
message count on a fresh starter-only backend without losing prior data.

| Lane | First green | Report wall | Suite | Migration intactness | Official choreography |
|---|---:|---:|---|---|---|
| Explicit | 1,076s | 1,871s | 6/6 + 58/58 regression | 8 personas green | unavailable; 3/3 lane supplement |
| Familiar | 2,049s | 2,302s | green + all prior milestones | 48 projections green | unavailable; headless two-client evidence |

Explicit used expand/backfill/tighten plus a five-second server maintenance
cron so an already-open count converges after clock-driven expiry. Familiar
used the same additive/backfill/tighten shape, but its profile cannot author
cron; expiry counts reconcile through authenticated settings/backfill paths.

Familiar also reproduced a published capability contradiction. The generated
target manifest lists `offline_mutation_replay` as experimental, but the
Familiar schema required-capability union rejects it as unknown and the binding
does not offer the settlement ledger. Native offline dispatch therefore fails
closed with `SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED`. The lane used
an app-owned localStorage set-state queue instead. This is filed as
[`issues/20260824-familiar-offline-replay-capability-unathorable.md`](../../../issues/20260824-familiar-offline-replay-capability-unathorable.md).

The Explicit handoff also omitted `personas.json`, reproducing the existing
relocatability ticket
[`issues/20260822-m7-handoff-not-self-contained.md`](../../../issues/20260822-m7-handoff-not-self-contained.md).

## Builder-experience self-scores

B1–B7 and B9–B11 come from each continuous lane; B8 comes from its fresh M7
session. These are builder self-scores, not grader outcomes or a weighted total.

| Dimension | Explicit | Familiar |
|---|---:|---:|
| B1 schema/data | 82 | 74 |
| B2 auth | 72 | 64 |
| B3 realtime | 68 | 71 |
| B4 offline/sync | 36 | 49 |
| B5 media/storage | 34 | 45 |
| B6 search | 38 | 47 |
| B7 push/actions | 70 | 28 |
| B8 day-2 evolution | 84 | 78 |
| B9 DX/docs | 62 | 56 |
| B10 diagnostics | 44 | 39 |
| B11 operations | 58 | 63 |
| Continuous holistic | 68 | 58 |
| M7 holistic | 91 | 76 |

Explicit logged 42 continuous correction loops (40 agent-error, 1 ambiguous,
1 environment) plus 7 M7 loops. Familiar logged 37 continuous loops (25
agent-error, 7 Snapback-defect, 4 ambiguous, 1 environment) plus 5 M7 loops.
Counts are instrumentation observations, not an additive quality score.

## Findings

1. **Explicit is the completing profile for this instrument on 0.1.25.** It
   completed scale and the scheduled M8 digest; Familiar completed neither.
2. **Familiar's core authoring shape remains attractive, but this run was not
   faster to the comparable green product surface.** M3 typing dominated after
   the builder separated ephemeral transport latency from React rendering.
3. **Familiar offline capability authoring is internally inconsistent.** The
   target/client know the capability, but Familiar cannot declare it and the
   binding omits it. The resulting refusal is safe, but forces an app-owned
   queue for M7.
4. **Supervised Expo still does not meet the benchmark's fixed-port topology.**
   Both lanes used the documented external-client topology after the supervisor
   selected undeclared ports. This is a benchmark integration cost, not a
   production capability claim.
5. **Hot module/binding freshness remains visible.** Both profiles needed clean
   Metro restarts after generated descriptor/module changes; Familiar also
   refreshed an expected one-hour dev binding during final audit.
6. **M7 handoff relocatability is still incomplete.** The prior open ticket was
   reproduced rather than duplicated.
7. **Native and grader-owned claims remain absent.** Linux recorded simulator
   evidence as null, and no independent grader scored O dimensions or the
   Familiar scheduled-digest obligation.

## Raw materials

Compact raw artifacts are at
`/Users/ccheever/clique-published-0125-sol-high-20260823/`. They retain prompts,
event streams, authored source, reports, and receipts while excluding
`node_modules`, SQLite databases, Expo caches, and git metadata. The unfiltered
4.8 GiB source remains on fleet machine `expo-build-450b` at
`/home/ccheever/clique-published-0125-sol-high-20260823/`.
