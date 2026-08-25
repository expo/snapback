# Final report — grok-clique-supabase

Essay is in `essay.md` (written before these totals).

## Clocks

| mark | epoch | ISO (UTC) |
| --- | --- | --- |
| start | 1787656060 | 2026-08-25T11:07:40Z |
| first-product-edit | 1787656569 | 2026-08-25T11:16:09Z |
| M1 first green | 1787658560 | 2026-08-25T11:49:20Z |
| M2 first green | 1787659202 | 2026-08-25T12:00:02Z |
| M3 first green | 1787660263 | 2026-08-25T12:17:43Z |

Wall by milestone (authoring clock, first green minus previous boundary):

| milestone | wall_s | wall_min |
| --- | ---: | ---: |
| M1 (start → first green) | 2500 | 41.7 |
| M2 (M1 green → M2 green) | 641 | 10.7 |
| M3 (M2 green → M3 green) | 1061 | 17.7 |
| M1–M3 total | 4203 | 70.1 |

iOS Simulator / Xcode / Hermes export: **environment-null** (Linux x86_64 host). Not a product failure.

## Suite and choreography

Entrypoint: `npm run acceptance -- --milestone mN`. Instrument pin `social-messenger@0.3.3-m8`.

| milestone | suite | choreography | green | receipts |
| --- | --- | --- | --- | --- |
| M1 | pass (7/7 suite-required) | pass (3/3 required implemented) | true | `receipts/m1-suite-receipt.json`, `receipts/m1-choreo.jsonl` |
| M2 | pass (22/22 suite-required) | pass (7/7 required implemented; 2 optional skipped) | true | `receipts/m2-suite-receipt.json`, `receipts/m2-choreo.jsonl` |
| M3 | pass (7/7 suite-required) | pass (2/2 required implemented; 4 optional skipped including quoted-reply which also passed) | true | `receipts/m3-suite-receipt.json`, `receipts/m3-choreo.jsonl` |

`suite-status.json` links each milestone to its suite receipt. Choreography observations sidecars: `receipts/mN-choreo.jsonl.observations.jsonl`. Coverage: `coverage.json` (`clique-coverage-manifest.v1`).

Starter logs `starter-m1.log` / `starter-m2.log` / `starter-m3.log` replay through the app RPCs (`scripts/replay-core.mjs`).

## Correction loops (attribution)

1. **Expo web DevTools sandbox crash** (host/Expo) — `expo start --web` aborted on chrome-sandbox; switched to `expo export` + static server on 48300.
2. **`expo-router` Link asChild CSSStyleDeclaration crash** (Expo/RN-web) — authenticated shell blanked; nav uses `router.push`.
3. **M1 duplicate-email mapping** (Supabase Auth) — existing-email signup returned no session; mapped failed password sign-in to a visible “email already registered”.
4. **M1 profile save with empty handle** (lane) — edit form saved before profile hydrate; wait for fetch, then save.
5. **M1 avatar assertion** (RN-web Image) — `data-testid="sm-avatar"` is a wrapper `div`; inner `img` holds bytes. Upload via storage + `grokclq25_upsert_profile`.
6. **M2 feed tabs vanished after profile navigation** (lane chrome) — moved `FeedTabs` into authenticated shell.
7. **M2 author display name** (kit layout) — own-profile `sm-profile` innerText started with “Edit profile”; wrapper emits display name first.
8. **M2 viewer-repost vs follow projection** (lane state) — stale Global cards survived tab switch; clear the list on tab change.
9. **M3 suite login / quote UI** (Playwright + RN-web) — `fill` before hydrate; `networkidle` + click-then-fill.
10. **M3 live DM send disabled / slow history** (lane SQL + RN-web) — simplified `grokclq25_list_messages`; capturing `input` listener on `sm-convo-input`.

No frozen-harness structural green ceiling was hit. Optional M2 media-picker and M3 receipt/member-lifecycle skips are the instrument’s own unimplemented set (`required: false`).

## Resolved pins

- `@supabase/supabase-js` **2.112.4** (required)
- `expo` **57.0.16**, `expo-router` **57.0.16**
- `react` **19.2.3**, `react-native` **0.86.2**, `react-native-web` **0.21.2**
- `playwright` **1.62.1**, `ajv` **8.20.0** (choreography)
- UI kit vendored from instrument `0.3.1-m8` (`vendor/social-ui`)
- Hosted Supabase (no local Docker/CLI; default local ports would leave 48300–48319)
- Namespace `grokclq25_` on tables, RPCs, buckets, Realtime channels

## Tokens

Grok family: metering adapter is `unavailable`. No token totals, phases, or cap charges in this lane.

## Servers

Recorded PIDs (killed by exact PID at end, no pkill): static-web **856229**, **856232** on port **48300**. `CHOREO_BASE_URL=http://127.0.0.1:48300`.

## Gaps

- No local/anonymous Supabase in the allowed port band.
- Realtime liveness needed poll fallbacks; typing is broadcast + client expiry, not a server ephemeral primitive.
- RN-web + Playwright `fill` vs controlled kit inputs.
- iOS Hermes / simulator environment-null.
- Receipt aggregate SQL was too heavy and was simplified for live path (suite still covers DM reuse, groups, quotes, non-admin deny, seed idempotency).
- M4–M8 not in scope.

end=1787660369
