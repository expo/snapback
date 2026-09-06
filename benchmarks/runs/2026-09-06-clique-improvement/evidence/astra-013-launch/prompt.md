You are a senior product engineer building a production-shaped app from scratch, alone and timed. Work fully autonomously; there is no human to ask. Work only in the lane directory supplied as your current directory: /Users/ccheever/clique-full-astra-next-primary-20260906/lanes/astra-snapback2

This is an independent cold build. Do not inspect:
- sibling lanes under /Users/ccheever/clique-full-astra-next-primary-20260906/lanes/ (except this one)
- /Users/ccheever/projects/snapback or any other Snapback/Exact checkout, or any Snapback source anywhere
- any prior Clique or Coterie implementation, diary, essay, or benchmark run on this machine

Build Clique on **Snapback 2**. Install and use ONLY `snapback2@0.0.13` from the public npm registry (exact pin; it installs its platform binary for this host), its README, the guide it serves (`npx snapback2 guide`, and the guide files inside the installed package), and its generated types. Discover everything else from that installed package: `snapback2 init`, `check`, `dev`, `run`, `test`, `why`, `trace`, `data`, `persona`. The backend is authored in Quarry (`snapback/*.q`); seeds, tests, and effect bodies are TypeScript. The client is an Expo Router app (web, plus the iOS Hermes bundle export) using the package's React and Expo client arms as its guide documents. Never read the Snapback source repository. If the package cannot express something the brief requires, record it as a platform gap with the exact diagnostic and continue.

The authoritative instrument is `./instrument/` (also at /Users/ccheever/clique-full-astra-next-primary-20260906/instrument/). Read `ENVIRONMENT.md` first — it wins over the brief on environment facts — then `social-messenger.md` in full, `CONTRACT.md`, `schema/social-messenger/assertions.json`, the fixtures README and `action-schema.md`, the UI kit, and the choreography README. Read `protocol.md` for how results are recorded.

This is the **full run**: build **M1 → M2 → M3 → M4 → M5 → M6 → M8** in that order in this one continuous session. Do not attempt M7 (it is a separate fresh session run later). Implement every milestone as the brief specifies, including media (images and video from `fixtures/media/`), reactions, edit/delete windows from the config files, disappearing and view-once, search, offline writes and the push seam, the custom-client API, the M6 replay adapter and the scale replay on its own clock against a fresh instance, insights, digest, and multi-device offline. Every milestone also produces an iOS Hermes bundle export as a build artifact; M6 and M8 simulator proofs are separately recorded native artifacts (attempt them; never fake them).

Green bar: `ENVIRONMENT.md`. Ship `npm run acceptance -- --milestone mN` with a coverage manifest, and `npm run seed -- --segment mN` for each starter segment (idempotent per installed segment). Copy `instrument/choreography` into this lane, install it there, and run each milestone's choreography segment with `CHOREO_BASE_URL` pointing at your web client; keep the JSONL receipts in this lane. A milestone is green only when both the suite and all implemented required choreography checks pass. If the frozen harness itself makes a check structurally impossible, record the exact instrument skip rather than relabeling it.

This host is macOS arm64 (Apple M1 Max). Use only ports **52300–52319**. Tell choreography `CHOREO_BASE_URL`. Record every server PID and kill only those PIDs at the end; never pkill/killall/pattern kills. Other development and verification processes share this machine; ports outside your range are reserved. Do not inspect other lanes. Record actual contention honestly. Use the explicit Node/Xcode environment described in ENVIRONMENT.md, with headless browsers/simulators that do not steal focus.

Safety limit: four hours of wall clock per milestone. On exhaustion record `capability-failure` for that milestone and continue with the next milestone that is not blocked by it. Two consecutive capability failures end the lane: write the final report and stop.

Create `run-log.md` immediately. First lines must record:
lane id astra-clique-snapback2
model gpt-6-astra
effort=medium
backend=snapback2-0.0.13
start=<unix epoch seconds>

Append timestamped lines at every milestone start, green/failure, error, retry, workaround, knowledge lookup (source: model knowledge, published docs, package README/guide, package source, diagnostic, fixture, or web), and correction loop with attribution (snapback2-defect, agent-error, environment, or ambiguous) plus an evidence pointer. Record the scale replay's own start/end epochs and its verification result against the invariant manifest.

At each milestone boundary append to `diary.md`: what you built, what felt easy, what fought you, what prior familiarity saved, what capability or docs were missing, and how this backend compared to the alternatives you know at that step.

After M8, before tallying numbers, write a 2–3 page `essay.md` comparing this experience to Convex, Supabase and any other backend you know: where this backend reduced friction, added friction, or changed the shape of the work. Then write `final-report.md` with raw start/end epochs and wall by milestone, first-green times, each milestone's status (`green`, `capability-failure`, `aborted`, `blocked-by-M{n}`, `not-run`), correction loops and attribution, suite and choreography results per milestone, native artifacts produced, the scale replay clock and verification, resolved package pins, hand-authored line counts by file, and a candid gap list. End with `end=<epoch>`.
