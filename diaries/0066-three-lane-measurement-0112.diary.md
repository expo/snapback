# Diary 0066: Three-lane measurement — published 0.1.12, bare vs skill-equipped vs Convex

**Date:** 2026-08-07
**Demos:** scratchpad-built (not mirrored; proof scripts and build logs
retained per lane — paths in each lane report); measurement record below is
the durable artifact.
**Method:** same brief and discipline as Diary 0065 (which see for the
basis rules): three cold-context builder agents, serial, same machine, same
model (Fable), token counts from the orchestration harness. Lane 1 =
Snapback from npm `latest` (0.1.12), published surfaces only. Lane 2 =
identical plus the `snapback-authoring` skill exactly as a 0.1.12 scaffold
emits it (the consumer form). Lane 3 = Convex. All lanes shipped every
proof in the brief.

## The table

| Metric | S-bare | S-skill | Convex | 0065 S (0.1.10) | 0065 C |
|---|---:|---:|---:|---:|---:|
| Wall | 80m33s | 64m00s | 14m01s | 36m33s | 12m27s |
| Tokens | 340,706 | 328,948 | 111,423 | 330,034 | 101,281 |
| Tool uses | 248 | 250 | 62 | 174 | 57 |
| Loops (fw/self/tool) | 12 (7/4/1) | 15 (8/4/3) | 4 (3/1/0) | 8 (4/2/2) | 3 (2/1/0) |
| Wall ratio vs Convex | 5.75x | 4.57x | 1x | 2.94x | 1x |
| Token ratio vs Convex | 3.06x | 2.95x | 1x | 3.26x | 1x |

## Reading the numbers honestly

**The four 0065 walls did not recur.** Closure install, dev loop,
discovery, TUS CORS on the asset lane, strict-URL rendering, and the
retention gate were all absent from both Snapback lanes' friction lists —
the fix-measure loop closed them. Lane 2 reached the paved platform
offline path end to end from npm (`rqsEligible` derived from
`public` + `authorityIndependent`, cold start on `persisted-receipt`,
4/4 stable) — the exact capability no published consumer could touch
three days ago.

**Wall-clock got worse anyway, and the reason is structural, not
regression.** Both 0.1.12 lanes took the *new* supervised-Expo road
(`expo-chat` template, supervisor bootstrap) that did not exist for the
0065 lane, and drove it onto the **web carrier, which is unpaved**: the
bootstrap exchange serves no CORS, the provider deep-imports
`react-native/Libraries/AppState` (breaks react-native-web), and the
packaged picker adapter refuses web `blob:` URIs. Both lanes replicated
all three independently and each hand-built the same workarounds. They
also went *deeper* than 0065 — real platform retention, sessions custody,
comparator receipts — so they bought more surface and met the next layer
of walls. Wall-clock across runs is additionally muddied by machine load;
tokens are the better cross-run metric, and there the trend is right:
3.26x → 2.95x (skill lane).

**The skill earned its keep and its gaps are enumerable.** 20% wall
reduction, three traps that changed the design up front, the done-oracle
prediction verbatim, and the routing that got lane 2 onto the paved
retention path lane 1 never found. Its four named gaps (doesn't mention
the `expo-chat` template; silent that app-side uploads require sessions
mode; silent on the web carrier's state; missing the optional-input trap)
are ticketed.

**Convex held its shape.** 14 minutes, 4 loops, zero doc fetches — the
model's prior familiarity is still the whole story, and its offline story
remains ~40 lines of app-owned cache plus browser HTTP cache for images,
which its own lane flagged. Snapback's offline proof is categorically
stronger; it also cost half of lane 1's build.

## New findings (all ticketed 2026-08-07)

1. **Web carrier of the supervised Expo flow is unpaved** — bootstrap CORS,
   AppState deep-import, picker URI schemes; replicated by both lanes.
2. **Surface-bound commands materialize omitted optional inputs as
   `undefined`**, refused by the canonical-value gate; both lanes hit it,
   both worked around with split commands. (The 0178 V1 class, one layer
   up: the contradiction is knowable at generation.)
3. **Declarative plan mutation over a sessions bearer client misroutes to
   the offline queue** (`SNAPBACK_OUTBOX_NOT_WRITER` /
   `SNAPBACK_OFFLINE_QUEUE_DISABLED`) while a JS mutation on the same
   client commits — minimal repro retained from lane 2. Real bug.
4. **`SNAPBACK_AUTH_STREAM_RESET` boot flake** (~50% on fresh anonymous
   clients immediately after server start) — lane 2 needed bounded retries.
5. **Supervised environment has no offline persisted-receipt fallback**
   (`SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE` on cold boot) — both lanes built
   app-level shells around it.
6. **Arg-filtered live queries classify retention `none`** and the
   retention mechanisms (resume channel / registrations / materialization
   store) read as a maze — lane 1 burned half its build here; the guide
   example implies eligibility the classifier refuses.
7. **Skill content gaps** (the four above).

## For the W1 ratchet

New baseline, published-consumer basis, 0.1.12: **bare 5.75x wall /
3.06x tokens; skill 4.57x / 2.95x**. The wall numbers are dominated by
the unpaved web carrier and the offline-proof depth asymmetry — the next
measurement after tickets 1/2/3 land should be run with the same brief
and should also add an explicit native-carrier lane (iOS simulator) where
the supervised path is actually paved, so the golden path is measured on
the carrier it was built for. Formalizing the run harness + record under
`benchmarks/` remains open W1 work.
