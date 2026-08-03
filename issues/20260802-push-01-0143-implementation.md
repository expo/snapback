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
  real-device receipt. The D6 app-readable ledger projection is also retained
  as an explicit partial-capability GAP rather than being implied by the
  protected internal ledger.

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
