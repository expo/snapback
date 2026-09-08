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

## Fresh 0.0.6 Astra-medium run (2026-09-06)

15. `snapback2 init --help` and `dev --help` reject the help flag; the top-level
    help only lists verbs. `guide init` responds with the symbol catalog rather
    than the initialization recipe. The builder used the README to initialize.
16. Replacing a unique index correctly triggers `E_SUCCESSOR_DESTRUCTIVE`, but
    `guide E_SUCCESSOR_DESTRUCTIVE` says to apply the plan without showing the
    executable command. After rejected `--apply` and `--migration` guesses,
    the builder inspected strings in the installed binary to discover
    `--apply-migration`. `check` accepted the new project while the running
    owner retained its prior generation; the builder needed `dev --status`
    to discover that state. The recovery diagnostic should show the exact
    existing application command and distinguish validation from installation.

Evidence: office M1
`/Users/ccheever/clique-improvement/lanes/astra-snapback2-006/diaries/run.md`,
M1 setup and M2 platform experience; `evidence/m2-migration.log` and
`evidence/m2-owner-status.json`. This is a cold published-only build; no
repository source or previous app was supplied to the builder.

## CLI discovery resolution (2026-09-06)

Items 15–16 are addressed: top-level and command `--help`/`-h` return usable
help without project side effects; `guide init` gives the initialization sequence.
The migration guide names `dev --apply-migration`, and the watcher's destructive
refusal includes the saved `migrationFile` and an executable `applyCommand` with
quoted absolute paths. Help and recovery explain that `check` validates and
refreshes the build cache while `dev --status` identifies the installed generation.
The owner migration test runs that emitted command, including paths with spaces
and quotes, after proving a passing check leaves the prior generation active.
Other unresolved items in this ticket remain open.

## Fresh 0.0.8 Astra-medium run (2026-09-06)

17. On the untouched chat Expo template, `guide app` refuses with
    `E_GUIDE_STALE`: `certificates.json is missing operation(s):
    deliveries._timerBinding_expireMessage`. Its suggested `check` succeeds
    but does not repair the guide. The builder reads installed guide files
    instead. Repair is underway in `s2/clique-guide`; retain stale-cache
    refusals for genuinely missing public certificates and invalid seed facts.

Evidence: M5 `/Users/ccheever/clique-full-008-20260906/logs/astra-snapback2.ndjson`,
initial `guide app` and subsequent `check`/`guide app` command records.
The standalone `evidence/guide-app.txt` is empty because the refusal went to
stderr; the captured command records retain the actual diagnostic.

18. Independent grading of the frozen 0.0.6 app found duplicate-handle signup
    leaving an authenticated session with no visible profile error, and a
    missing-profile edit screen stuck loading. The auth guide now explains
    that signup and profile creation are separate, profile mutation rejection
    must be shown, and the existing account can retry onboarding without
    signing up again. This documents the current contract; it does not claim
    to repair or requalify the frozen application. Evidence:
    `/Users/ccheever/clique-improvement/grading/astra-006/grader-report.md`,
    defects d-01/d-02 and the isolated duplicate-email correction.

## App guide resolution (2026-09-06)

Item 17 is repaired in authored revision `f7c7b10611` (integrated `4fd1a1918`).
The guide uses the certified public operation inventory shared with the cache
writer and checks each certificate against fresh certification. Internal timer
bindings are excluded by declaration identity; public timer targets and exposed
operations with timer-like names remain required. Missing or corrupt public
certificates and invalid seed facts still refuse. The untouched chat Expo cache
now works without rewriting it. Thirteen guide tests, six project tests, and
nine private owner/cache assertions pass; both independent Astra xhigh and
Grok 4.6 xhigh reviews are READY. See the run's `evidence/guide-timer/`.
This source repair is not yet in the published 0.0.8 benchmark installation.

Item 17 publication verification: published0.0.9 now passes the untouched
chat Expo guide trigger before and after check, with all26 certified public
operations, the public purge target retained, and unchanged cache/backend
hashes. The ongoing0.0.8 benchmark remains pinned to its original package.
Evidence: `benchmarks/runs/2026-09-06-clique-improvement/evidence/npm-0.0.9/`.

## Remaining scope — reconciled 2026-09-08

Reconcile the checklist with current packaged guides: item 8 time arithmetic is addressed by `guide/grammar.md`; item 11 conflict/new-intent recovery by `guide/offline.md`; cap reserve accounting is also documented in the grammar. Preserve prior item resolutions and the actual published 0.0.9 evidence for item 17. Remaining work includes the concrete bounded-list example, provider-placeholder development recipe, seed-handle collision guidance, PNG/video normalization explanation and first-use asset-custody explanation. Architecture completion does not close this umbrella.

Read-only source and recorded-execution audit against main `2ac15dc2c`; no new test execution or publication is claimed by this update.

## Exact 0.0.19 asset and scheduled-purge audit — 2026-09-08

Read-only audit of published source `c170e53f9b78e7fae6d26f4c7aa92ff5265ea799`;
these observations were withheld from the continuing cold builder and its fresh
assessor. They are source findings, not newly executed application failures.
Relevant paths below are under `snapback2/packages/snapback2/` unless stated.

19. Scheduled deletion has a shipped recipe, but no one guide connects its four
    parts: row timer (`guide/schedule.md:3`), retained message history and a
    recipient log with `tombstones` (`templates/chat/snapback/schema.q:59`),
    timer target emitting expiry events (`templates/chat/snapback/deliveries.q:51`),
    and an ascending drained client query (`guide/offline.md:25`). Link this
    complete recipe from the schedule guide. The template's purge loop covers
    members returned at purge time; do not promise historical-recipient expiry
    beyond that set. Existing expiry journey checks deletion/log emission;
    the already-cached row/byte eviction journey uses the analogous `removed`
    event. An executed reconnect-after-expiry case is still distinct evidence.
20. Click-to-open view-once images require a conditional mount of `AssetImage`.
    Both shipped chat clients demonstrate it (`react/src/Thread.tsx:173` and
    `expo/src/screens/Thread.tsx:69` under the chat template), while README's
    generic asset example mounts immediately. Document the click gate beside
    that example. Imperative once-image reads additionally require a stable
    opaque `viewing` token for the consumer lifetime (`src/client-assets.ts:99`);
    describe that only where the imperative recipe is offered.
21. Asset refusals prescribe `guide: "assets/client"`
    (`src/client-assets.ts:101`, `src/client-upload.ts:414`, native components),
    but no packaged page or CLI recipe resolves that path. Route the refusal
    to an existing useful recipe or deliberately provide the missing recipe;
    retain the actual CLI diagnostic as verification when repairing it.
22. README's native view-once video section (`README.md:162`) describes a real
    native memory player, but the public Quarry parser explicitly rejects
    `video ... once` (`snapback2/packages/compiler/src/quarry/parser.ts:586`).
    The Quarry guide also says image-only. Reconcile the supported authoring
    path with the playback claim. This does not reopen or disprove the native
    player qualification in
    [the closed playback ruling](closed/20260905-snapback2-native-view-once-video-ruling.md);
    that evidence and reachable public schema authoring are separate scopes.

The parser rejection and missing route persist at observed main `a9acb134a`.
No package, compiler, guide, or frozen benchmark was changed by this audit.
