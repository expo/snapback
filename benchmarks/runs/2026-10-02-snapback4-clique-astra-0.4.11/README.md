# Clique calibration 29 — 0.4.11 (answers stay on screen, settled one-shots, declarative receipts, first-instinct Quarry, faster busy groups and native acquisition)

The eleventh calibration on the LLP 3000.013 forms. Its pins carry 0.4.11, which adds these to calibration #28's 0.4.10:
- **Mounted answers survive subscription pressure** (lanes PR and PRL, LLP 3000.023). Queue wait no longer withdraws answers, and removal withdraws only the affected audience. One evidence epoch and one authority revision fence every saved or remembered answer. 1,000 per-row hooks revalidate with zero loading renders. `client.inspect()` shows subscription pressure on demand.
- **An awaited one-shot `client.query()` always settles** (lane QS): ready data or a coded refusal, never `loading`.
- **Answers stay on screen unless a change can remove a row** (lane RV, LLP 3000.023 §12). The one-second withdrawal bound now applies only to change evidence that can remove a row or a disclosed field (deletes, rule and owner columns, unknown evidence); new rows and ordinary edits keep the answer `revalidating` until it is replaced.
- **A busy group renders faster** (lane BG, round 0): live delivery pages its count certification and the browser app makes one IndexedDB read per authority check (send-to-remote-render p95 753 → 470 ms on eb1000).
- **A job reads as its recipient** (lane JV, LLP 3000.007 §21.12): inside a sweep, `as p.principal:` applies that principal's rules, audiences, disclosure and expiry, and `all(query(...))` pages a viewer query, so a digest reuses the UI's own query instead of walking memberships by hand.
- **Declarative receipts** (lanes RX and RY, LLP 3000.022 §14): `receipts by .conversation, .ordinal from .sender to members` generates delivery and read accounting, allocates ordinals, join floors and recipient counts. Sends and joins still predict.
- **First-instinct Quarry** (lane QX): `sync to members[.message.conversation]` is accepted as read-through sugar, and reactions (upserts on read-through children) predict.
- **The guide opens with a checked Start here** on its eight most-read cards (lane GQ); `snapback4 guide start` is the paved path on one page.
- **Proving the envelope** (lane BN): `snapback4 witness acquire` proves the heaviest account's acquisition and cold-restart retention. Native heavy acquisition takes 13 s instead of 42 s (lane NA).
- Idle HTTP connections are not reused into resets (lane KA), and the test suite waits on state rather than wall-clock budgets (lanes TF and WB).

Pins: snapback4@0.4.11 and snapback4-expo@0.4.11.

Runs on the author's M1 Max workstation, the same host as calibrations #23–#28, after the 0.4.11 publication (qualified, signed and published from the M5) and after calibration #28's assessments have finished. This repository's launchd backstops are held off this host for the builder phase (`results/backstops-hold.py`), and the host-load sampler records the eight busiest processes each minute. Neither touches the instrument, prompts, templates or runner scripts. The phases run with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.

Instrument, prompt templates and all five runner/aggregator scripts are copied byte-for-byte from cal28 (which copied them from cal27, cal26, cal25, cal24, cal23, cal21, cal20, cal19, cal18, cal17 and cal16).
- Run only:
  - one cold Astra medium continuous M1–M6/M8 builder;
  - independent Claude Opus 5 grading;
  - Astra xhigh read-only holistic scoring.
- M7 and other builder lanes remain unrun.
- Hermes export is required; installed native proof keeps its optional status.
- No predictions or private LLP 3000.013 documents are supplied to any session.

The result is descriptive; it makes no causal claim about 0.4.11.

Only ports 49360–49379 belong to this packet.
- Each phase is launched under nohup in the background with recorded runner and child PIDs.
- Host-load sampling begins before the builder and continues through both assessments.
- Stop only recorded owned listeners.
- Preserve a complete APFS clone at attempts/builder-completed.
- Verify narrative, source and full-content manifests before assessments.
