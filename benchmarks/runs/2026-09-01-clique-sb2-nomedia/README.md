# Clique text-only — Snapback 2 vs Convex vs Supabase — 2026-09-01

Author-requested reduced Clique (M1–M3, no media uploads, no M4–M8, no native,
no scale) comparing **Snapback 2**, **Convex**, and **Supabase**, all on
Grok 4.6 xhigh.

- **Model / harness:** Grok 4.6, grok CLI 1.0.13, `--reasoning-effort xhigh`,
  `--permission-mode bypassPermissions`, `--output-format streaming-json`.
- **Snapback 2:** in-tree source snapshot (commit in the run root
  `SNAPBACK_COMMIT`), not Snapback 1 npm.
- **Convex:** `convex@1.45.0`, anonymous/local preferred
  (`CONVEX_AGENT_MODE=anonymous`).
- **Supabase:** `@supabase/supabase-js@2.112.4` plus hosted project credentials
  in a lane-private `provider-secrets.env` (not retained in git).
- **Scope:** M1–M3 text-only. Skipped: avatar upload/render, image/video posts,
  sender avatars, M4–M8, native, scale. Seed uses `starter-m2-text.log`.
- **Evidence level:** N=1 calibration. Not claim-eligible for magnitude
  (LLP 0201 D5). Grok tokens are advisory (`unavailable`).

## Hosts

Same-machine parallel on `Charlies-MacBook-Pro-M5Max-Black` (author override of
serial execution so all three share hardware and grok auth).

| Lane | Ports |
|---|---|
| grok-clique-snapback2 | 48100–48119 |
| grok-clique-convex | 48200–48219 |
| grok-clique-supabase | 48300–48319 |

Raw lane directories live outside git at
`/Users/ccheever/clique-sb2-nomedia-20260901/`.

## Outcome (sealed)

Scored record: [`record.md`](./record.md). All three grok sessions stopped
`end_turn` with `final-report.md`.

| Lane | Greens (SKIP overlay) | Wall |
|---|---|---:|
| snapback2 | 1/3 (M1 only) | 67.4 min |
| convex | 3/3 | 60.0 min |
| supabase | 3/3 | 75.6 min |

Program wall ~75.6 min, same-machine parallel. N=1 calibration.
