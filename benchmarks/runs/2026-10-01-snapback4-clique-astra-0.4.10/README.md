# Clique calibration 28 — 0.4.10 (paved native smoke, honest follow window, a suite that holds under load)

The tenth calibration on the LLP 3000.013 forms. Its pins carry 0.4.10, which adds these to calibration #27's 0.4.9:
- **`npm run native:smoke`** (lane NS, LLP 3000.030): both Expo starters build the Release app, pick or create a simulator that the tool owns, install the app and run the SDK's installed-app smoke, and write a receipt. The starters carry the pinned Expo 57 UIScene plugin that the iOS 27 SDK requires.
- **A follower's feed says "Updating"** (lane FW) until the reader's own follow is reflected, instead of publishing a complete, fresh, empty answer.
- **A suite that holds under host contention** (lane SL): state barriers instead of sleeps, work-scaled hang guards, controlled clocks. Test-only, apart from one preformatted refusal line.

Pins: snapback4@0.4.10 and snapback4-expo@0.4.10.

Runs on the author's M1 Max workstation, the same host as calibrations #23–#27. It starts only after the 0.4.10 publication has finished. 0.4.10 was qualified on this M1 (its full suite passed with the backstops held) and signed and published from the M5, because this host holds no Developer ID signing identity. The phases run with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.

**Host hygiene (new in #28, operator-side only).** Calibration #27's three scale midpoint misses coincided with this repository's own drift backstop (launchd, every two hours), which ran on this host during the 10% and 50% checkpoints: load 15 and 34, against 2–5 at the final checkpoint. For the builder phase only, `results/backstops-hold.py hold` waits until no backstop run is in progress, boots out both launchd backstops, and starts a detached watchdog. The watchdog restores them when the builder ends, or after 8 hours. The host-load sampler now also records the eight busiest processes each minute. Neither change touches the instrument, prompts, templates or runner scripts.

Instrument, prompt templates and all five runner/aggregator scripts are copied byte-for-byte from cal27 (which copied them from cal26, cal25, cal24, cal23, cal21, cal20, cal19, cal18, cal17 and cal16).
- Run only:
  - one cold Astra medium continuous M1–M6/M8 builder;
  - independent Claude Opus 5 grading;
  - Astra xhigh read-only holistic scoring.
- M7 and other builder lanes remain unrun.
- Hermes export is required; installed native proof keeps its optional status.
- No predictions or private LLP 3000.013 documents are supplied to any session.

The result is descriptive; it makes no causal claim about 0.4.10.

Only ports 49360–49379 belong to this packet.
- Each phase is launched under nohup in the background with recorded runner and child PIDs.
- Host-load sampling begins before the builder and continues through both assessments.
- Stop only recorded owned listeners.
- Preserve a complete APFS clone at attempts/builder-completed.
- Verify narrative, source and full-content manifests before assessments.
