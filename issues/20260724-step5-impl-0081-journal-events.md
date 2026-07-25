# 0081: schema-transition journal events, 0053 activation, client handshake

**Status:** In progress (Wave 3a core landed 2026-07-25)
**Severity:** P2
**Systems:** Migrations, Storage, Live Queries, Auth
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0081 §4, LLP 0007 (amended journal grammar), LLP 0053
**Marker:** step5-impl

Implement the landed 0007 amendment: schema-resync/rollback-resync typed
events with the pinned payload, high-water counting, retention-floor raise in
the publication transaction, and head/journal-cut equality across events;
publication atomically fires 0053 activation obligations; posture-aware
client behavior (compatible resnapshot; stable upgrade-required refusal with
client-outbox quarantine and resync-before-replay); no pre-publication cursor
replays through the raised floor. M/L-sized.

**Progress (2026-07-25, Wave 3a):**

- Grammar formalized: `schema-resync`/`rollback-resync` are first-class
  typed operations (`SchemaTransitionEventBodyV1` + `SchemaTransitionKind`
  in `src/storage.rs`, committed schema
  `schemas/schema-transition.event.schema.json`). The vocabulary is closed
  — an unknown operation or non-decoding payload under the reserved
  pseudo-table is `SNAPBACK_STORAGE_VERSION_CORRUPT`. The append
  constructor enforces the amendment at write time (floor claim equals the
  publication version; forward publication advances the storage
  generation); events count toward the journal high-water exactly like
  data operations and head/journal-cut equality is witnessed across them
  (`schema_transition_events_are_first_class_and_closed`). The executor's
  publication row now carries `successorGeneration` and
  `compatibilityPosture` through the typed constructor.
- Floor enforcement (server half of the posture-aware client path): under
  a successor-only publication, an offline mutation whose read baseline
  predates the raised floor receives the stable
  `SNAPBACK_MIGRATION_RESYNC_REQUIRED` refusal (client-custodied payloads
  are neither silently replayed nor dropped); dual-compatible keeps the
  ordinary conflict rules
  (`successor_only_publication_gates_stale_replay_baselines`). Attest of
  predecessor artifacts after a successor-only publication refuses with
  the stable `SNAPBACK_MIGRATION_UPGRADE_REQUIRED`
  (`attest_refuses_predecessor_artifacts_after_successor_only_publication`).
  Resume tokens across publication are already fenced by the RQS
  generation digest (schema identity folds in → rung-3 refusal).
- Publication consequence on live state: every retained subscription is
  disposed with a clear-retained `resync_required`
  (`publication_retires_live_subscriptions_with_clear_retained_resync`);
  `migrate_apply_artifact` fails closed with
  `SNAPBACK_MIGRATION_PROFILE_UNSUPPORTED` when live auth-scoped
  subscriptions exist, rather than substituting a generic resync for the
  0053 durable dispositions.

**Residuals:** the sessions-profile durable auth-scoped dispositions at
publication (currently fail-closed above; wire into the activation
obligation machinery); the JS client-side quarantine UX; blind
(read-set-free) predecessor writes are undetectable without artifact
identity on the mutation wire (LLP 0093 adjacency); the auth-scoped
precheck ordering is covered by inspection pending the 0081 corpus, which
builds full artifacts and should add that case.

**Phase D closure (2026-07-25):** the sessions-profile publication tail
landed. Publication now fires LLP 0053's machinery for auth-scoped state
instead of the fail-closed refusal: every auth-scoped subscription gets a
durable `Delete` obligation raised with the publication witness, a
`terminalDelete` resolution with acknowledgement semantics (ackToken on
the projected frame), the obligation frame delivered durably, and an
authenticated scope retirement (`prepare/commit_scope_retirement`) — a
generic resync is never substituted. The only remaining refusal is the
inconsistent auth-scoped-subscriptions-without-invalidation-state case.
Witness: `publication_fires_durable_dispositions_for_auth_scoped_subscriptions`
(Sessions authorities via the activation fixture). Still fail-closed with
recorded reasons: blind read-set-free predecessor writes (needs
mutation-wire artifact identity — LLP 0093 adjacency) and the JS
client-side quarantine UX.
