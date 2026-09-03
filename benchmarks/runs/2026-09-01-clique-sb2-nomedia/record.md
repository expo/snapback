# Run record — Clique text-only, Snapback 2 vs Convex vs Supabase

**Status: CALIBRATION — N=1, not claim-eligible for magnitude (LLP 0201 D5).**
Author-requested reduced Clique (M1–M3, no media uploads, no M4–M8, no native,
no scale) on Grok 4.6 xhigh.

Raw lanes (outside git): `/Users/ccheever/clique-sb2-nomedia-20260901/`
Snapback 2 source pin: `112ff7121` (`SNAPBACK_COMMIT` in the run root).

## Results

Scoring rule used here (SKIP overlay): a milestone is green when the in-scope
suite-required assertions pass **and** every in-scope required choreography
check the frozen harness can still drive without media/avatars passes. Frozen
`feed-image-post-live-update` / `feed-video-post-live-update` remain
`required: true` in choreography 0.3.6-m8 and fail `ENOENT` on a media path
this snapshot does not ship. Those two checks are **instrument skips**, not
passes. Harness `segment-summary.green` is therefore `false` for M2 on every
lane that hit them; M2 is still counted green **under the overlay** when all
text/social checks passed.

| Lane | Greens | Wall | Fresh in | Cache read | Output (reasoning) | Stop |
|---|---|---:|---:|---:|---:|---|
| grok-clique-snapback2 | **1/3** (M1 only) | 4042s (67.4 min) | 958,918 | 34,044,800 | 153,206 (135,269) | `end_turn` |
| grok-clique-convex | **3/3** (M2 via overlay) | 3600s (60.0 min) | 1,388,182 | 29,413,248 | 127,920 (117,168) | `end_turn` |
| grok-clique-supabase | **3/3** (M2 via overlay) | 4533s (75.6 min) | 581,743 | 31,244,544 | 140,960 (126,078) | `end_turn` |

Program wall (first `start=` to last `end=`): **4538s (75.6 min)**, same-machine
parallel on `Charlies-MacBook-Pro-M5Max-Black`. Grok tokens are advisory
(`unavailable` / not cap-bearing).

### Milestone first-green (suite + in-scope choreo)

| Lane | M1 | M2 | M3 |
|---|---:|---:|---:|
| snapback2 | ~3300s (suite+choreo) | suite only; choreo red (`repost-following-feed-surface` + media skip) | suite only; choreo red (receipts / group compose / quote jump) |
| convex | 2158s | 990s after M1 (overlay) | 315s after M2 |
| supabase | 2507s | 485s after M1 (overlay; harness not green) | 1239s after M2 |

## What each lane actually shipped

**Snapback 2** (`lanes/snapback2/`). Kernel snapshot plus a **lane-local**
axum wrapper (`Engine::memory` / `Checker` / `execute`), argon2id bearer
sessions, Vite + react-native-web client, 350–400ms polling for “live.”
`platform/` was **not** forked. `programs.ts` + a Rust `Schema` (schema is not
consumed from TypeScript on this snapshot). Suites M1–M3 pass. Only M1
choreography is harness-green.

**Convex** (`lanes/convex/`). `convex@1.45.0` anonymous local, Expo Router web,
app-edge scrypt sessions (no first-party password table). Live queries carried
M2/M3. Dashboard stuck on 6790 (CLI has no pin). M1 and M3 harness-green; M2
overlay-green.

**Supabase** (`lanes/supabase/`). Hosted project (no Docker), namespace
`sb2clq01_`, `@supabase/supabase-js@2.112.4`, Expo Router web, built-in GoTrue
plus an autoconfirm trigger. SQL constraints were easy; recursive RLS
(`42P17`) and hosted Realtime SLA were not — they polled as well. M1 and M3
harness-green; M2 overlay-green.

## Comparison (from the three independent essays)

These are the lanes’ own qualitative claims, not a scored rubric.

1. **Missing kinds dominated Snapback 2, not the data language.** The essay:
   “Snapback 2, in this packet, is not a backend you adopt. It is a certified
   data plane you embed.” Auth, HTTP, live transport, and assets were wrapper
   work. Unique indexes and literal `take` bounds were the part that felt
   like a product. That matches LLP 0329.014.007’s line that the language
   does not move Clique without the loop.

2. **Convex’s bet paid on liveness.** `useQuery` made likes, follows, DMs, and
   typing appear in the other browser without a second realtime stack. Cost:
   token-as-arg identity, typing/receipts as durable rows plus client timers,
   uniqueness as index+check rather than a refused constraint.

3. **Supabase’s bet paid on the relational model.** Handle uniqueness, one DM
   per pair, membership-at-send-time are ordinary SQL. Cost: GoTrue
   confirm-email, recursive RLS, Realtime not trusted for a 2s typing window
   (polling anyway), Expo/Metro kit resolution.

4. **Shared non-backend tax (all three).** Frozen choreography imports
   `metering/observations.mjs` and `lib/json-schema.mjs` that this instrument
   snapshot does not ship (in-lane shims). RN-web 0.21 does not map
   `accessibilityValue.text` → `aria-valuetext`. M2 image/video checks are
   still `required: true` and look for media files outside the snapshot.
   Expo `CI=true` froze Metro on at least the Supabase lane.

5. **Wall-clock on this host is not a backend ranking.** Convex 60 min,
   Snapback 2 67 min, Supabase 76 min, in parallel on one M5 Max. Snapback 2
   spent that hour building the process Convex/Supabase already have, and
   still missed M2/M3 choreography. Faster Snapback 2 wall with fewer greens
   is not a win.

## Independence and protocol

- Cold grok-4.6 xhigh sessions, `--cwd` per lane, `--max-turns 600`,
  `--permission-mode bypassPermissions`.
- Fence: no Snapback 1 checkout, no sibling lanes, no prior Clique trees.
- Author override of serial-same-machine: parallel on one box, disjoint ports
  48100–48119 / 48200–48219 / 48300–48319.
- Evidence: each lane’s `run-log.md`, `diary.md`, `essay.md`,
  `final-report.md`, suite JSON, choreography JSONL.

## Non-claims

This does not accept LLP 0329.014.004 or promote Snapback 2. It does not
compare Snapback 1. It does not score O/B dimensions. M7 native and O5 scale
were out of scope by construction.
