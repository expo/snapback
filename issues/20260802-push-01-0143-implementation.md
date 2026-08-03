# PUSH-01: LLP 0143 implementation — the Expo push-notification seam

**Status:** Open
**Systems:** Runtime, Storage, Auth, Wire Protocol, Client integration
**Related:** LLP 0143 (ACCEPTED 2026-08-02), the landed ctx.fetch egress
seam, LLP 0045 (outbox — sequencing OQ), the closed a4expo-f1 finding

Implement the three-piece seam LLP 0143 accepts, in its own order:

1. **Device-token registry** — platform-owned, custody + retirement wired
   to session end/rotation/`DeviceNotRegistered`; token bytes never
   exposed to app code.
2. **`ctx.push.send` action lane** — host-side audience→token resolution
   under a declared config grant over the ctx.fetch egress seam.
3. **Handoff ledger** — crash-safe
   `handed-to-expo`/`expo-accepted`/`expo-error`/`ambiguous` states with
   the doc's never-claims list intact.

The doc's nine open questions are implementation-resolvable; resolve each
with a dated note in the LLP as you go (surface naming first — it names
the capability id). Split this ticket into sub-tickets if the registry
lands separately from the send lane. Flip `notifications: false` only when
the full seam ships with its acceptance kit; add the GAP row meanwhile if
the guide gains a push page.

**Exit:** the seam demonstrated against a fake-Expo fixture (OQ7's kit)
plus one real Expo push receipt on a dev build; capability manifest
updated honestly; dated implementation-record amendment on the LLP.

## Running log

- **2026-08-03 — OQ2 ratified; real-receipt block narrowed but not cleared.**
  LLP 0143 now records the author-ratified device-scoped installation store
  exactly: logout keeps the identity and unbinds the principal, account switch
  keeps it and rebinds, and app-data reset or reinstall mints a fresh identity.
  A read-only environment recheck now finds Charlie's paired, unlocked iPhone
  and an installed `dev.allaboard.sbexpo` developer app whose local source is
  linked to an EAS project. That EAS project has no recorded iOS development
  build, and the app has neither `expo-notifications` nor notification native
  configuration or a Snapback PUSH-01 receipt harness. Repository demos remain
  unlinked and unconfigured for notifications. No external project was
  changed, no build was started, and no push was sent. The minimum remaining
  human action is approval to use and modify the existing All Aboard SB-EXPO
  project for this witness (then keep the iPhone available during the
  build/run/send). Until a real Expo receipt is captured, this ticket stays
  Open and `notifications: false` remains the honest manifest claim.

- **2026-08-02 — real-device Exit witness is externally blocked.** The local
  machine is authenticated to EAS, but neither repository Expo demo is linked
  to an EAS project or configured with `expo-notifications`; the only attached
  physical iPhone reports offline, no Android device is attached, and the
  available simulators cannot mint an Expo push token. The local secrets file
  contains no pre-provisioned Expo project or push token. Completing the last
  Exit witness therefore requires a human to reconnect a physical device and
  select/configure an EAS project plus development build. No external project
  was created and no demo was expanded merely to manufacture the receipt;
  this ticket remains Open until the real receipt is recorded.

- **2026-08-02 late — repository exit is staged; Apple signing remains the
  sole blocker.** Rebased on current `origin/main` (`2356bde1`), the exact
  runtime bootstrap/handler-VM qualification passes; the Rust library sweep is
  1,800 passed / 1 intentionally ignored / 0 failed; all 19 push-module tests,
  the six-test capability-registry integration, all-target Clippy, the complete
  client package suite, the 36-profile bundle ratchet, and the packaged
  fake-Expo acceptance pass. The first-run bundle receipt for the separate
  Expo installation adapter is frozen prospectively at `553a9bc1`; the older
  push-registry ledger remains unchanged. A fresh non-interactive EAS
  development build still refuses because the Expo account has no iOS
  credential suitable for internal distribution. Charlie must complete
  <https://dash.tuft.dev/expo/setup> for Apple team `C8D8QTF339`; after that,
  the staged external probe can build, install on one of the registered
  iPhones, mint a real Expo token, and retain the final provider receipt. No
  Apple credential or token is in this repository. Until that witness exists,
  the capability row remains `partial`, the broader LLP 0045 `notifications`
  flag remains false, and this ticket remains Open.

- **2026-08-02 — OQ2 ratification implemented; physical receipt remains.**
  Charlie closed the author-decision veto window, so the delegated
  device-scoped default now ships in the additive client module. Apps inject
  `expo-file-system`; Snapback owns the dedicated
  `snapback-push/installation.v1.json` member through the separate
  `push-installation-expo` subpath; the retained storage adapter's `clear()` is
  the full app-data custody wipe. Ordinary
  logout and account switch preserve the id, successor registration rebinds
  it, and reset/reinstall mint a fresh id. Concurrent first use converges by a
  first-writer-wins file plus committed-value re-read; every operation re-reads
  custody after reset, RQS remains separate, missing
  custody refuses, and custom native storage still works. The dated LLP 0143
  amendment records the ratified reset matrix. Per the wave policy this
  landing deliberately does not regenerate global drift artifacts. The
  structured `notifications.expoPushSeam` target fact remains the honest seam
  claim; LLP 0143 D4 and Draft LLP 0045 still keep the broader
  `notifications` outbox boolean false. PUSH-01 stays Open for the real
  dev-build Expo receipt.

- **2026-08-02 — canonical local proof isolates the external receipt
  blocker.** Under the repository-pinned Node 24.18.0 toolchain, the push
  package fixture, all 26 push-module tests, capability-maturity check,
  generated-artifact gate, guide check, package inventory, publication
  carrier, Cloudflare identity, client/codegen/contract suites, demo workouts,
  and Swift suite pass. The exhaustive HTTP inventory contains every PUSH-01
  code. The first keep-going run also exposed concurrent proof-lane failures;
  after rebasing their repairs, current main records all-target Clippy, the
  1,779-test Rust library suite, every integration suite, and the LLP audit as
  green. The app-CLI custody test intentionally rejects this recovery
  worktree's `/private/tmp` credential ancestor, while the complete suite
  passes with an owner-only private test root. A final required rebase onto
  D-05 commit `96f56cb6` then introduced eight non-push diagnostic-inventory
  omissions and four `src/telemetry.rs` Clippy findings; the concurrent D-05
  lane owns those semantics, while all 26 push tests and both established
  diagnostic-mapping tests remain green. The real-device Exit receipt remains
  blocked solely on human Apple signing setup, so this ticket remains Open.

- **2026-08-02 — packaged fake-Expo exit is green; physical receipt remains.**
  The shared `@expo/snapback-cli/testing/fake-expo-push` export now drives the
  packaged fixture through authorization-before-provider-I/O, ticket and
  receipt success, same-key no-op, ticket- and receipt-stage
  `DeviceNotRegistered`, socket-drop ambiguity, explicit duplicate-risk
  re-drive, and zero-target retirement. The generated ledger query repeats the
  current audience authorization and exposes lifecycle facts only. During the
  D3b reconciliation, the pre-transmit recovery path was found to reset an
  expired claim without giving a worker ownership of it; maintenance now
  claims only fence-proven recovered batches, rebuilds the exact protected
  payload, shares live-send pacing, and commits a fresh transmit marker before
  I/O. Fresh action reservations cannot race that lane. The local capability
  descriptor and guide page name `notifications.expoPushSeam`; per LLP 0143
  D4, the distinct LLP 0045 `notifications` boolean remains `false`. All nine
  implementation-resolvable OQs have dated dispositions in the LLP. The ticket
  stays open for the real dev-build Expo receipt and final proof sweep.

- **2026-08-02 — real-device Exit witness awaits Apple signing setup.** A
  temporary, repository-external Expo development-client probe is linked to
  `@expo/snapback-ci`, and two enabled physical iPhones are registered for the
  Apple team. EAS is authenticated, but no usable internal-distribution
  signing credentials exist yet; non-interactive build refuses and the
  browser-only Tuft/Apple setup requires a human account step. No Apple
  password or push token was requested or logged. This ticket remains Open
  until the build is installed and a real Expo receipt is recorded.

- **2026-08-02 — deterministic seam acceptance and publication facts now
  complete.** The shared fake-Expo carrier runs the production bounded HTTP
  path across a mixed ticket batch and receipt poll, including ticket- and
  receipt-stage `DeviceNotRegistered`, provider-prose dropping, dedupe,
  zero-target, direct authorization refusal, and a socket close after request
  bytes. The lost response settles ambiguous, never auto-redrives, and requires
  `redriveAmbiguous: true` to mint attempt 2 with `previous_ambiguous` evidence.
  Generated send-capable action contexts now carry declaration-derived
  audience/reference types; registry-only schemas do not. LLP 0143 resolves
  all nine implementation questions in a dated amendment, the guide has an
  honest local/partial page, and the local capability manifest has a distinct
  structured `notifications.expoPushSeam` descriptor while
  `notifications: false` remains. Remaining PUSH-01 Exit work is the external
  real-device receipt. Its then-open D6 app-readable-ledger GAP is closed by
  the later packaged fixture/projection entry above.

- **2026-08-02 — send/ledger recovery branch completed through the local
  deterministic proof.** `ctx.push.send` now owns reserve → claim → durable
  transmit marker → bounded Expo handoff → allowlisted settlement. Deferred
  job sends capture an exact host-only grant from
  `ctx.jobs.enqueue(..., { pushGrant: { to, dedupeKey } })`, persist it in the
  producing mutation, and revalidate the producer's current declared
  membership before the system-authority job may consume it; explicit
  principal lists remain unavailable in that lane. The ordinary maintenance
  sweep recovers expired claims and polls/settles Expo receipts without holding
  the app lock over network I/O. Receipt fixtures cover the closed success/error
  vocabulary and refusal of raw prose/unknown codes. This is still a progress
  checkpoint, not Exit: the shared fake-Expo ticket + receipt + socket-drop
  acceptance kit, one real dev-build receipt, the guide page, and the honest
  capability-manifest update remain open, so `notifications: false` stays put.

- **2026-08-02 — main-proof greening handoff.** Gate 8 currently reports
  `clippy::too_many_arguments` on the test-only `register` helper in
  `src/push.rs` (landed by `769e7139`). The main-proof lane is leaving this
  actively owned file untouched to avoid colliding with PUSH-01 send/ledger
  work; please absorb the warning in the next push landing or signal that the
  seam is free.

- **2026-08-02 — registry slice implemented, pending landing; send and ledger
  remain.** Prepared PUSH-01a as
  `issues/closed/20260802-push-01a-0143-device-token-registry.md`. The pending
  implementation declares `definePushSeam`'s app scope and idle-retention rule,
  installs storage and auth-lifecycle triggers only for declaring applications,
  exposes session-only register/unregister routes and the injected-custody
  `client.push` surface, and keeps token bytes out of diagnostics, inspection,
  auth backup, and app rows. The tested DeviceNotRegistered transition is a
  reserved registry primitive; provider tickets/receipts cannot reach it until
  the send lane lands. `notifications` therefore remains `false`, and the guide
  records a partial registry GAP rather than the full seam. Remaining in this
  ticket: `ctx.push.send`, audience authorization, the handoff ledger and
  receipt poll, the complete fake-Expo fixture, a real dev-build receipt, and
  the full capability identity/manifest row.
- **2026-08-02 — proof notes.** Adding `definePushSeam` changes the codegen
  implementation input hash even for applications that do not declare push;
  the resulting review-manifest/API hash churn across committed demos and the
  comparator fixture is intentional and reproduced exactly by
  `scripts/check-generated-artifacts`. After the OBS-01 prerequisite landing,
  full Rust library proof reaches 1,716 passed / 1 ignored with four failures:
  the OBS-01 CLI target-descriptor subprocess test reports a missing telemetry
  table only under the parallel full-suite run and passes immediately alone;
  the three pre-existing live-delta expectations
  (`rqs_mutation_after_answer_and_register_loses_no_ops`,
  `rqs_tokens_refresh_across_delta_replace_and_current_as_of`, and
  `standard_pattern_live_is_conservative_and_recorded`) fail alone on the
  rebased main and are already recorded by the observability/settlement wave
  tickets and still reproduce in the full run. PUSH-01a does not touch their
  matcher path or the telemetry store.
- **2026-08-02 — protected-catalog audit hardened.** The registry no longer
  trusts `CREATE IF NOT EXISTS` plus trigger text. Declared activation, reopen,
  and operator inspection compare the table, PK autoindex, four named indexes,
  and three lifecycle triggers with a once-built reference catalog, including
  physical table/index pragma shape. Negatives cover a preexisting lookalike
  table, a wrong physical index whose `sqlite_schema.sql` is forged back to the
  expected text, and a replaced trigger. Undeclared apps still run no registry
  inventory query.
- **2026-08-02 — client closure corrected.** PUSH-01b moved the optional JS
  registry to `@expo/snapback-client/push-registry`; the root namespace,
  constructor, type, and ordinary client instance are push-free again. The
  package-private request bridge preserves bearer-transition fencing without
  exporting a generic request surface. LLP 0145's immutable primary baseline
  was not rewritten: all 24 profiles pass, while a versioned prospective
  ledger frozen to `91a0a718` owns the explicit subpath, attachment, and
  root-negative profiles. This is still the registry slice only;
  `notifications: false`, the GAP row, and every send/ledger remainder above
  remain unchanged.
