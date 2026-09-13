# Snapback3 pause handoff

On 2026-09-12, Charlie asked whether to stop Snapback3 and focus on Snapback4.
Codex recommended doing so and stopped the active S3 implementation and review
agents. The platform goal is paused. The experiment remains available beside
its siblings; it has not completed the full Clique benchmark.

The strongest work to consider reusing is:

- **Acquisition measurements and controls.** The archived v8 Linux package
  reached a 2.807-second median for the fixed 10,000-row case with durable
  storage and physical offline reopening; one of ten runs exceeded three
  seconds. This excludes the full application's receipt, search, media and
  native work. Preserve the control and apply a matched measurement to S4.
  See [the acquisition record](benchmarks/acquisition-target/README.md).
- **Native persistence and its actual witness.** The frozen native SDK passed
  the final component reviews. The subsequent unchanged-SDK Expo/Hermes run
  verified durable FIFO operations across real app process deaths, exact
  acquisition links and complete requests, and package-to-Metro byte identity.
  The hardened instrument's separate final review was queued, not completed.
  See [the native record](benchmarks/native-platform/README.md).
- **Worker recovery and operational failure cases.** The last implementation
  passed 44 Node owner tests, 11 worker tests and the affected core checks.
  It covers lost committed replies, committed project custody, interrupted
  first seed, nonfatal local backpressure and indexed redacted job discovery.
  Its final review was interrupted; this is tested work pending final review.
- **Media lifecycle controls.** The preceding component run passed 33 focused
  Node tests and real private-video playback. Two final reviewers still found
  public-carrier behavior wrong; root also reproduced three codec-validation
  defects. The combined repair was interrupted before qualification.

The current working tree also contains partial pending-query prediction and
an isolated effect runner that has not been integrated into the owner. Do not
infer their correctness from earlier native or owner results. In particular,
the current client source has moved beyond the frozen, tested native snapshot.

Still incomplete: media contract repair and SDK upload/cache/native rendering;
pending-query prediction; delivered-history retention and automatic durable
acknowledgements; effect integration and claim fencing; presence/channels;
complete authoring/search/evolution paths; final installed distribution; the
full Astra-medium Clique M1–M8 build and independent grading; full native
journeys; and receipt-enabled scale/acquisition qualification. No full-product
or current-working-tree qualification is claimed.

The private work and evidence remain under
`.llp/ship-runs/20260912-snapback3-full-clique/`. Its `run.json`, per-lane status
and process receipts, frozen `reviews/` packets and raw benchmark records
preserve exact progress. `user-pause-processes.json` records the three owned
agent interruptions and absence of all their recorded descendants.
`user-pause-source/` preserves the changed source files, a binary-capable Git
patch, source hashes and the base commit for recovery. No changes were stashed,
reverted, committed, pushed or published as part of pausing. Commonroom and its
existing owner were left running; the owned simulator remains available.

The immediate S4 evaluation priorities are the same complete Clique scope and
an explicit cold-acquisition target. The architectural preference for S4 is
provisional; its reduced builder results do not prove those larger outcomes.
