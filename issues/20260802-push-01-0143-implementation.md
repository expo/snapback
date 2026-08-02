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
