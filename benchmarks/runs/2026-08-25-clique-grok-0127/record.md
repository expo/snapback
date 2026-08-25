# Run record — Clique grok-4.6 xhigh published 0.1.27

**Status: COMPLETE (N=1 calibration).** Not claim-eligible for magnitude
(LLP 0201 D5). Grok tokens are harness-native but advisory/`unavailable`.
Author override of serial same-machine: four cold lanes in parallel on
quiet Linux hosts.

## Configuration

- **Model/harness:** Grok 4.6, grok CLI 1.0.5, `--reasoning-effort xhigh`,
  `--permission-mode bypassPermissions`, `--output-format streaming-json`.
- **Snapback:** published npm `0.1.27` (`fastpath-0-1-27-98681377721e`).
- **Convex:** `convex@1.45.0`, `CONVEX_AGENT_MODE=anonymous`.
- **Supabase:** `@supabase/supabase-js@2.112.4` plus hosted DDL credentials
  (lane-private, not in git), object namespace `grokclq25_`.
- **Instrument:** `social-messenger@0.3.3-m8`.
- **Scope:** Clique M1–M3 only. No Coterie. Linux: native iOS evidence is
  environment-null; web authoring green is suite + required two-client
  choreography.

## Hosts

| Lane | Host | Ports |
|---|---|---|
| grok-clique-explicit | expo-build-450a | 48100–48119 |
| grok-clique-familiar | expo-build-450b | 48100–48119 |
| grok-clique-convex | Minisforum | 48200–48219 |
| grok-clique-supabase | Minisforum | 48300–48319 |

Raw evidence: `/home/ccheever/clique-grok-0127-20260825/` on each host.
Compact reports: `cells/` in this directory.

## Outcomes

| Lane | M1 | M2 | M3 | Wall start→end | Output tokens | Cost (USD) | Turns |
|---|---|---|---|---:|---:|---:|---:|
| Snapback explicit | green | capability-failure | blocked-by-M2 | 3,189s (53:09) | 130,009 | 8.02 | 187 |
| Snapback familiar | green | green | **green** | 6,121s (1:42:01) | 217,353 | 10.52 | 286 |
| Convex | green | green | suite pass; required typing choreo fail | 5,000s (1:23:20) | 171,670 | 8.33 | 188 |
| Supabase | **green** | **green** | **green** | 4,309s (1:11:49) | 165,573 | 5.92 | 136 |

Supabase wall in the lane report is 4,203s start→M3 first-green; start→end is
`end=1787660369` − `start=1787656060` = 4,309s. Familiar M3 first-green is
5,943s from lane start; start→end is 6,121s.

### Milestone walls to first green (seconds)

| Lane | M1 | M2 | M3 |
|---|---:|---:|---:|
| Snapback explicit | 2,044 | 1,145 (fail) | — |
| Snapback familiar | 2,113 | 1,547 | 1,800 |
| Convex | 2,716 | 530 | 775 (not green) |
| Supabase | 2,500 | 641 | 1,061 |

## What this N=1 run shows

1. **Published 0.1.27 familiar is Clique-completable** on Grok 4.6 xhigh.
   Suite + required choreography are green for M1–M3, including live DM and
   the 2s/5s typing check after isolating the composer.
2. **Published 0.1.27 explicit is not**, on this launch. M1 was green. The
   M2 additive schema successor activated on the backend
   (`startup-successor-activated`, accounts/sessions preserved) and the Expo
   web arm refused with `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` because the
   integration receipt still named the M1 descriptor. `snapback dev` stdin
   was `/dev/null`, so reload could not be sent.
3. **Familiar survived the successor that killed explicit** by restarting
   the same `snapback dev` owner against existing `dev.sqlite3` after two
   `SNAPBACK_EXPO_METRO_EXITED` events (codegen tmp ENOENT). That restart
   path is a Snapback defect, not a lane win.
4. **Supabase is the only competitor with full M1–M3 authoring-green.**
   Hosted project + DDL credentials; Expo DevTools sandbox forced static
   `expo export`. Fastest complete green and cheapest advisory spend.
5. **Convex reached M1–M2 green quickly**, then failed the required M3
   typing clock (`visibleMs ≈ 3.2s` vs 2.0s). The lane recorded that as an
   instrument measurement failure: Playwright `pressSequentially` of a
   45-character run id already exceeds 2s. Familiar hit the same clock at
   2.3–2.7s and passed after isolating `MessageComposer` (~1261ms). Same
   check, different product outcome.
6. Cross-host walls are observations. Tokens are not cap-bearing.

## Product findings (Snapback 0.1.27)

- Supervised Expo web does not inject `EXPO_PUBLIC_SNAPBACK_URL` but does
  mint a session; URL-first `SnapbackProvider` was the working password path.
- `snapback generate` under `snapback dev --expo` can kill Metro
  (`SNAPBACK_EXPO_METRO_EXITED`).
- Explicit Expo extra/integration receipt does not follow an in-lifecycle
  schema successor.
- `@expo/snapback-expo` activity presence needs Expo lifecycle context that
  URL-first web does not have; `@expo/snapback-react` does.
- `touch()` is generation-fenced; per-keystroke publish cancels in-flight
  presence.

## Cell reports

- [explicit](./cells/grok-clique-explicit/final-report.md)
- [familiar](./cells/grok-clique-familiar/final-report.md)
- [convex](./cells/grok-clique-convex/final-report.md)
- [supabase](./cells/grok-clique-supabase/final-report.md)
