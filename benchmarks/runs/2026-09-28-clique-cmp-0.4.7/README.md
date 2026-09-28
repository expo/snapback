# Clique comparative, Grok wave — `snapback4@0.4.7` against Convex and Supabase

| Wave (builder and scorer) | Snapback 4 | Convex | Supabase |
|---|---:|---:|---:|
| **Grok** (grok-4.6 xhigh builder and scorer) | **78** | 80 | 55 |

The Snapback 4 lane is new, built cold on the published 0.4.7 release on expo-build-1000 (10,500 s, exit 0). The Convex and Supabase lanes are the Grok family's lanes from the 2026-09-16 full run, copied unchanged through the 0.4.3 comparative (packet `~/clique-cmp-20260926-042`) into this packet (`~/clique-cmp-20260928-047`); only the scorer re-read them. N=1 per cell, one family. This is supporting evidence beside [calibration #25](../2026-09-28-snapback4-clique-astra-0.4.7/README.md), not a calibration: there is no independent functional grade.

**Scorer variance is large.** The same unchanged Convex and Supabase narratives scored 73 and 50 in the 0.4.3 comparative and 80 and 55 here. Snapback 4 (a new lane each time) scored 82 on 0.4.3 and 78 here.

## Scores

| Category | Snapback 4 | Convex | Supabase |
|---|---:|---:|---:|
| **overall** | **78** | 80 | 55 |
| setup_and_docs | 84 | 72 | 64 |
| **data_modeling** | **90** | 78 | 86 |
| authorization | 91 | 60 | 56 |
| **queries_and_live** | **78** | 86 | 52 |
| writes_and_transactions | 84 | 70 | 76 |
| offline_sync | 80 | 54 | 44 |
| media_assets | 82 | 78 | 66 |
| **background_work** | **90** | 88 | 56 |
| **client_integration** | **64** | 74 | 48 |
| diagnostics_dev_loop | 84 | 66 | 62 |
| **scale_and_limits** | **46** | 40 | 30 |
| operations | 78 | 70 | 46 |

Scorer: grok-4.6 xhigh, 379 s, exit 0 ([prompt](./score-grok-prompt.md), [meta](./score-grok-meta.json), [scores](./scores-grok.json), [summary](./summary.md)).

Snapback 4 leads in 10 of 12 categories. It trails Convex in `queries_and_live` and `client_integration`, and overall by 2.

## What the scorer charged Snapback 4

- **Client integration (64):** "Refetch {loading:true} unmounted EnsureProfile and Expo Slot (diary M3). Guide says keep the signed-in tree; the hooks still make returning null easy." The builder's profile gate returned null when `myProfile` revalidated, which reset Expo Router to `/`. Lane LV (hook retention) takes this.
- **Queries and live (78):** live views greened M1–M2; later M3 choreography failed with "useQuery overload in ChatRail history" (per-row hooks), plus RN-web accessibility and list issues the builder attributed to itself.
- **Scale (46):** the `--fresh --replay` scale run matched the 10% checkpoint exactly (settledPrefix 24,777), then media uploads failed with "the server is unreachable" on two ports. Lane FU is investigating whether this is a Snapback defect.
- **Writes (84) and offline (80):** the builder declared likes, follows and reactions `online only`, so those toggles could not predict and needed a local intent journal.

What it credited: one 642-line Quarry file expressing identity, feeds, receipts, expiry, once-view media, digest jobs and effects, where Convex and Supabase reimplemented receipts, unread counts and expiry in TypeScript; built-in auth; the offline engine (held search, pending writes, custody).

## Packet and lifecycle

| Item | Record |
|---|---|
| Packet | `~/clique-cmp-20260928-047` on expo-build-1000, built from the 0.4.3 comparative packet: same instrument, templates and Convex/Supabase lanes; a fresh `grok-snapback4` lane on the published package, which resolves its own `snapback4-linux-x64` binary. |
| Builder | grok-4.6 xhigh, 2026-09-28 09:12Z to 12:07Z, 10,500.5 s, exit 0 ([narratives](./grok-snapback4/), [lifecycle](./lifecycle/)). |
| Score | grok-4.6 xhigh, 379 s, exit 0. |
