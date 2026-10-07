# Clique calibration 31 — 0.4.13 (sends predict under receipts, Quarry ergonomics, one-row point lookups, fast live delivery under load, in-chat search, worker files, quoted messages, faster adoption, faster live publication)

The thirteenth calibration on the LLP 3000.013 forms, the Astra wave. Its pins carry 0.4.13, which adds these to calibration #30's 0.4.12:

- **Sends keep predicting with a receipt-derived unread count** (lane RP). Before 0.4.13, the guide's row-keyed unread count over receipt fields made `send`, `sendMedia`, `createGroup` and `addMember` never predict, and calibration #30's builder used durable-intent fallbacks instead. Receipt-derived counts now keep their settled values, marked incomplete only for the groups a pending write touches. The device charges exactly what the server charges, so a prediction is never refused on resources.
- **Quarry ergonomics** (lane QE2), from calibration #30's data-modeling charge:
  - insert results read null for omitted optional columns, which removes a runtime `E_FIELD`;
  - write rules can follow one reference (`.message.conversation`);
  - `require exists t[k]` and `if t[k] != null` narrow later lookups of the same key.
- **Point lookups mean one row on every host** (lane NL): named unique-key lookups plan like positional ones; a point lookup with a possibly-null nullable-unique key is refused at compile time with the guard to add; and every printed rewrite compiles.
- **Live delivery under load** (lane LU): a new delivery no longer waits behind Following backfills (calibration #30's d-03). Heavy-load repost p95 fell from 36.4 s to 0.89 s.
- **Matching live replies publish in about 100 ms** (lane OP): a matching live reply no longer waits about a second for an evidence-free moment; idle repost p95 fell from 709 ms to 105 ms in the three-browser fixture.
- **In-chat search has a paved form** (lane MS), from calibration #30's Grok builder: `guide search` shows one conversation's messages matching a query, newest first and paged. An index that cannot serve `matching` gets `E_QUARRY_MATCHING_INDEX` with a rewrite that compiles.
- **Worker files and quoted messages** (lane DG), from calibration #30:
  - workers have published file and module rules, plus `SNAPBACK_PROJECT_DIR` for project-relative output;
  - the social starter ships a `QuotedMessage` component that keeps a placeholder while loading and says "unavailable" only for a proven absence.
- **Retained history never flashes empty** (lane RH): after a member leaves a chat, the device's retained history no longer briefly shows the server's empty answer first.
- **Schema adoption on a populated store** (lane AP), from calibration #30's operations charge: adoption is about 2.3x faster with identical results, and `check`, dev and deploy print `N_ADOPTION_PAUSE`, an estimate of the write pause, before it happens.
- **Store inspection and sync windows** (lane SX), from calibration #30's Grok builder: `snapback4 sql '\dt'` and `'\d <table>'` list tables, columns, indexes and row counts read-only, and the sync guides say up front that `last N` bounds the device's working set, not the server's history.
- **Reliability**: witness cleanup on busy Macs (lane WD), the client test runner (lanes QF and QF2), capability-free schemas staying readable by published engines (lane RPF), and fixture races fixed for loaded hosts (lanes FX, SU and FY).

Pins: snapback4@0.4.13 and snapback4-expo@0.4.13.

Runs on the author's M1 Max workstation, the same host as calibrations #23–#30, after the 0.4.13 publication (qualified, signed and published from the M5). This repository's launchd backstops are held off this host for the builder phase (`results/backstops-hold.py`), and the host-load sampler records the eight busiest processes each minute. Neither touches the instrument, prompts, templates or runner scripts. The phases run with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.

The instrument, prompt templates and all five runner and aggregator scripts are copied byte-for-byte from cal30 (193 files verified), which copied them from cal29 and so on back to cal16.
- Run only:
  - one cold Astra medium continuous M1–M6/M8 builder;
  - independent Claude Opus 5 grading;
  - Astra xhigh read-only holistic scoring.
- M7 and other builder lanes remain unrun.
- Hermes export is required; installed native proof keeps its optional status.
- No predictions or private LLP 3000.013 documents are supplied to any session.

The result is descriptive; it makes no causal claim about 0.4.13.
