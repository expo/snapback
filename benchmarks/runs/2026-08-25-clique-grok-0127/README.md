# Clique grok-4.6 xhigh — published 0.1.27 — 2026-08-25

Author-requested Clique-only comparison (no Coterie) of Snapback Explicit,
Snapback Familiar, Convex, and Supabase, all on Grok 4.6 xhigh.

- **Model / harness:** Grok 4.6, grok CLI 1.0.5, `--reasoning-effort xhigh`,
  `--permission-mode bypassPermissions`, `--output-format streaming-json`.
- **Snapback:** published npm `0.1.27` (`fastpath-0-1-27-98681377721e`).
- **Convex:** `convex@1.45.0`, anonymous/local (`CONVEX_AGENT_MODE=anonymous`).
- **Supabase:** `@supabase/supabase-js@2.112.4` plus hosted project credentials
  in a lane-private `provider-secrets.env` (not retained in git).
- **Instrument:** `social-messenger@0.3.3-m8`, manifest SHA-256
  `2a94a0c627cbd4505620cd833a2b6a02ff8bc7eb8dc9d08c0a5dff87f14afcad`.
- **Scope:** M1–M3 only. Linux hosts: native iOS evidence is environment-null;
  web authoring green is suite + frozen two-client choreography.
- **Evidence level:** N=1 calibration/existence evidence. Not claim-eligible
  for magnitude (LLP 0201 D5). Grok tokens are harness-native but not
  cap-bearing (`unavailable` / advisory family).

## Hosts (author override of serial same-machine)

| Lane | Host | Ports |
|---|---|---|
| grok-clique-explicit | `expo-build-450a` (`100.84.186.119`) | 48100–48119 |
| grok-clique-familiar | `expo-build-450b` (`100.85.211.16`) | 48100–48119 |
| grok-clique-convex | Minisforum AI Series (`100.126.225.7`) | 48200–48219 |
| grok-clique-supabase | Minisforum AI Series (`100.126.225.7`) | 48300–48319 |

The Snapback pair runs in parallel on the two quiet Hetzner 450 boxes, per
author direction. Convex and Supabase share the quiet Minisforum box with
disjoint port blocks and an independence fence. Protocol serial-same-machine
is an explicit author override for this run; wall-clock comparisons across
hosts are observations, not scorecard claims.

Raw lane directories live outside git at
`/home/ccheever/clique-grok-0127-20260825/` on each execution host and
`/Users/ccheever/clique-grok-0127-20260825/` on the control plane.
