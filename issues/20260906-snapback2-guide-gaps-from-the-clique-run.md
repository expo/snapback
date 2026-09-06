# snapback2 guide gaps the Clique builders hit (guide-gap)

**Filed:** 2026-09-06 by Claude Fable 5.1 from the Clique full run (benchmarks/runs/2026-09-05-clique-full-3x3), builder evidence as cited; raw lanes at /Users/ccheever/clique-full-20260905/lanes/.
**Status:** open · **Severity:** documentation, each one cost a correction loop

1. The package README still says the offline outbox is deferred; `dist/guide/offline.md` and the client types say it shipped. (`/Users/ccheever/clique-full-20260905/lanes/astra-snapback2/run-log.md` 1788626083)
2. `snapback2 guide maintain` answers `E_GUIDE_UNKNOWN`; the index lists the schema page instead. (`/Users/ccheever/clique-full-20260905/lanes/astra-snapback2/run-log.md` 1788631133, `/Users/ccheever/clique-full-20260905/lanes/astra-snapback2/evidence/maintain-guide.txt`)
3. A literal `byId` point read is refused although the guide's wording suggests it; the builder used a text-key singleton. (`/Users/ccheever/clique-full-20260905/lanes/astra-snapback2/run-log.md` 1788627893, `/Users/ccheever/clique-full-20260905/lanes/astra-snapback2/evidence/m4-check*.txt`)
4. No text-prefix search primitive is documented; `mentionTokens`/`range`/`channel` were the closest. A general search aggregate refuses `E_STRUCTURAL_COUNT`. (`/Users/ccheever/clique-full-20260905/lanes/astra-snapback2/run-log.md` 1788628707, 1788629491)
5. Token restoration after a cut connection: the React hook showed sign-in with a valid stored token; the retry path is not documented. (`/Users/ccheever/clique-full-20260905/lanes/astra-snapback2/diary.md` M3)
6. No documented connection or presence primitive; builders fall back to a heartbeat with a 20 s disconnect lag. (`/Users/ccheever/clique-full-20260905/lanes/astra-snapback2/diary.md` M6)
7. `divmod(now)` is not available for time bucketing (M8 seven-day bars). (`/Users/ccheever/clique-full-20260905/lanes/grok-snapback2/final-report.md` gap 5)

## Fix shape
One guide page per item or a capability-index row; the README outbox sentence is a one-line fix today.

## Second batch (from the finished astra and grok lanes' M8 diaries and essays)

8. `0 + now` is accepted as a numeric epoch while `now - at` is refused; nothing documents either. Tracked as its own ticket, `20260906-snapback2-time-arithmetic-is-inconsistent-and-undocumented.md`; the guide needs the accepted/refused forms side by side.
9. Bounded list syntax `[text <=N] <=M` was found by trial (grok M1); the grammar page should show it next to the first list example.
10. An `effect` grant needs a URL even for a provider that is a placeholder; the push seam is "a table plus an effect with a dummy `https://api.example.com` grant" (grok M6). The effects page should show the no-provider development recipe.
11. Offline conflict detection is not the brief's server-arrival last-write-wins; the app must retry conflict-refused intents through the ordinary authenticated write path (astra essay). The offline page should state the conflict policy and the retry pattern.
12. The chat template's dev seed personas occupy handles the fixture pack uses (`alice`), so real signup fails until they are renamed (grok M1). The template should namespace its dev personas or the guide should say to.
13. The backend re-encodes uploaded PNGs; byte-for-byte comparisons fail while decoded pixels match, and video bytes are exact (astra scale verification). The assets page should say which formats are normalized.
14. The choreography-visible cost of `E_ASSET_IN_USE` single-cell custody and the cap-times-inserts metering are tracked in their own tickets; both need a guide sentence at the point of first use (assets page, cap page).

## Partly addressed (2026-09-06, Clique findings program)

items 1–3 (README outbox line, `guide maintain`, `byId` literal) wave 1 L4/L2; item 4 (text search) L9 `words` + the channels-page recipe; item 5 (token restoration retry) L7 + the auth page; item 6 (presence) L12 `connected`; item 7 (`divmod(now)`) L9. Open: 8–14.
