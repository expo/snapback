# Clique calibration 30 — 0.4.12 (client-contract helpers, export:ios proves native, scale advice, decorated search, fast busy groups)

The twelfth calibration on the LLP 3000.013 forms, the Astra wave beside sb5's Grok wave on the Apartment mini. **Predictions are pre-registered in LLP 3000.032 §7 (commit 484c94733c), before the release was cut.** Its pins carry 0.4.12, which adds these to calibration #29's 0.4.11:
- **Client contract, built from LLP 3000.032:**
  - `useSeen` and generated receipt-family bindings (lane R);
  - `usePendingItems` and `usePendingState` present durable intents through settlement (lane B);
  - `readPresentation` derives screen flags from the read contract (lane A);
  - a route-owned observation recipe for screen lifetimes (lane L).
- **`npm run export:ios` also proves the app runs on iOS** (lane NX, LLP 3000.030 §15). When Xcode and a runtime are present, the exported bundle is installed and launched on a simulator, and success is reported only from a verified publication. The CLI also now exits with its binary's signal status.
- **Authoring-time scale advice** (lane UB): `check` reports `N_SHAPE_METER` when a returned shape's read can outgrow the read meter (calibration #29's d-01).
- **Histories with `once` columns stay on screen** under the bytes-once contract (lane ON2; calibration #29's empty-list flash). Live removals are measured fast under load (lane LM).
- **Search hits that carry presentation fields keep the bare search's current-and-retained guarantees** (lane SJ, LLP 3000.028 §3.3.1).
- **A busy group renders a remote send fast** (lane BG rounds 1–9): p95 222.5 ms idle and 339.8 ms under 96 CPU burners, against calibration #28's 4.16 s. Reads hold up under host contention (lane CT).
- **Following** keeps its 1,000-event window, and older history is on the profile (lane FD, ruled). Expo apps launch on Xcode 27 through the published scene plugin (lane X27R). Startup banners reach the log before serving (lane DR). The server raises its descriptor limits (FDL). Fault injection is deterministic and the test fixtures are fixed (FIM, QF).

Pins: snapback4@0.4.12 and snapback4-expo@0.4.12.

Runs on the author's M1 Max workstation, the same host as calibrations #23–#29, after the 0.4.12 publication (qualified, signed and published from the M5). This repository's launchd backstops are held off this host for the builder phase (`results/backstops-hold.py`), and the host-load sampler records the eight busiest processes each minute. Neither touches the instrument, prompts, templates or runner scripts. The phases run with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.

Instrument, prompt templates and all five runner/aggregator scripts are copied byte-for-byte from cal29 (which copied them from cal28, cal27, cal26, cal25, cal24, cal23, cal21, cal20, cal19, cal18, cal17 and cal16).
- Run only:
  - one cold Astra medium continuous M1–M6/M8 builder;
  - independent Claude Opus 5 grading;
  - Astra xhigh read-only holistic scoring.
- M7 and other builder lanes remain unrun.
- Hermes export is required; installed native proof keeps its optional status.
- No predictions or private LLP 3000.013 documents are supplied to any session.

The result is descriptive; it makes no causal claim about 0.4.12.

Only ports 49360–49379 belong to this packet.
