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
