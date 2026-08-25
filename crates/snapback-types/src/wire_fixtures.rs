//! The LLP 0093 P-1 conformance fixture corpus (LLP 0095).
//!
//! Canonical frames in, expected client transitions/actions out, judged
//! against the abstract client state machine of LLP 0095 §1 — never against
//! any one implementation's internals. The corpus is emitted through
//! the façade's `schema_export::artifact_instances` (the least-drift path LLP
//! 0093 OQ3 chose: the existing drift gate already walks the instances) and
//! committed as `schemas/live.wire-fixtures.v1.json`, so a wire-type change
//! that skips regeneration fails `tests/artifact_schemas_v0.rs`, and
//! `tests/wire_fixtures_v1.rs` proves every fixture's `schemaValid` claim
//! against the committed family schema.
//!
//! Positive frames are constructed through the serde wire types themselves,
//! so a fixture can never drift from the wire it claims to exemplify.
//! Negative frames are raw JSON by design: they exist to pin the acceptance
//! grammar (skip-not-crash, known-kind-with-required-action) that the
//! emission-describing schemas deliberately do not express.
//!
//! **Format v3** grows the v2 shape in three ways (each documented in LLP
//! 0095 §2.1):
//!
//! - `direction: "client_to_server"` fixtures pin the refusal half of the
//!   negotiation/offer surface. They carry a `request`
//!   (`{method, route, headers?, subprotocols?, body?}`) instead of a
//!   `frame`; `family` (when non-null) is the committed schema the request
//!   *body* instantiates, and `refusal` (`{status, code, details?}`) or
//!   `response` (`{status}`) pins the shipped server answer the client's
//!   `expect` obligations are judged against. Multi-step request fixtures
//!   put `request`/`refusal`/`response` on each step; a step may override
//!   `family` when its body instantiates a different committed schema.
//! - `direction: "client_lifecycle"` fixtures carry no wire frames at all;
//!   their steps are advance/event steps only.
//! - Steps may be, besides `{frame, expect}`: virtual-clock advances
//!   (`{"advanceVirtualTimeMs": N, "expect": …}`, only in fixtures declaring
//!   `"clock": "virtual"`) and named client-observable lifecycle events
//!   (`{"event": {"kind": …}, "expect": …}`). During an advance interval
//!   `expect.actions` stays the exact *set* of action kinds emitted; timer
//!   actions (`send_ping`, `attempt_reconnect`) may repeat within it, and an
//!   optional `expect.pacing` bounds their spacing.
//!
//! @ref LLP 0095#2-the-conformance-fixture-corpus-contract — corpus format,
//!   tuple routing, and the schemaValid-vs-acceptance split.
//! @ref LLP 0093#d2--client-conformance-classes — fixtures are the normative
//!   client contract; arm × lane tuples route them.

use serde_json::{Value, json};

use crate::auth::invalidation::{
    CompositeWitness, DataWitness, InvalidationDisposition, IssuerId, QueryNamespace,
    ResolutionKind, ResolutionTicket, ResyncObligation, ScopeId,
};
use crate::ephemeral::{DurableMessage, RealtimeEnvelope};
use crate::live_wire::{
    AuthorizationInvalidationSnapshot, LiveAuthErrorCode, LiveAuthErrorReason,
    LiveAuthorityDisposition, LiveDeltaOpKind, LiveDeltaWireOp, LiveEnvelope,
    LiveSocketServerFrame, ResumeMeta, ResumeWire,
};
use crate::storage::AuthorizationVersion;

/// Corpus format version — the shape of the corpus file itself, not the wire
/// version (which every fixture pins as `snapback.v1`). v3 adds the
/// `client_to_server` / `client_lifecycle` directions and the
/// advance/event step forms; a v2 consumer would misjudge those fixtures
/// (its judgment assumes every fixture feeds a server frame to the client),
/// so this is a version bump, not an additive drift.
pub const WIRE_FIXTURES_FORMAT_VERSION: u32 = 3;

/// Committed file name under `schemas/`.
pub const WIRE_FIXTURES_FILE: &str = "live.wire-fixtures.v1.json";

/// The reason string the reference client synthesizes for the D3 fact-2b
/// forced resync. Client-synthesized, NEVER wire-emitted — the server's
/// `resync_required.reason` namespace does not contain it (LLP 0095 §1.4
/// T-DB; LLP 0093 v0.10).
pub const DURABLE_BYTES_RESYNC_REASON: &str = "durable_bytes_undecodable";

fn wire<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).expect("wire type serializes to JSON")
}

fn replace_envelope() -> LiveEnvelope {
    LiveEnvelope::LiveReplace {
        network_profile: None,
        subscription_id: "sub_fixture_1".to_owned(),
        function: "listTodos".to_owned(),
        version: 41,
        rows: vec![json!({ "_id": "todo_1", "title": "current row" })],
        resume: None,
    }
}

fn delta_envelope() -> LiveEnvelope {
    LiveEnvelope::LiveDelta {
        network_profile: None,
        subscription_id: "sub_fixture_1".to_owned(),
        function: "listTodos".to_owned(),
        version: 42,
        ops: vec![
            LiveDeltaWireOp {
                op: LiveDeltaOpKind::Add,
                id: "todo_2".to_owned(),
                row: Some(json!({ "_id": "todo_2", "title": "added row" })),
            },
            LiveDeltaWireOp {
                op: LiveDeltaOpKind::Update,
                id: "todo_1".to_owned(),
                row: Some(json!({ "_id": "todo_1", "title": "updated row" })),
            },
            LiveDeltaWireOp {
                op: LiveDeltaOpKind::Remove,
                id: "todo_0".to_owned(),
                row: None,
            },
        ],
        graph: None,
        resume: None,
    }
}

fn resync_subscription_envelope() -> LiveEnvelope {
    LiveEnvelope::ResyncRequired {
        network_profile: None,
        reason: "live_refresh_failed".to_owned(),
        subscription_id: Some("sub_fixture_1".to_owned()),
        scope: None,
        epoch: None,
        clear_retained: false,
    }
}

fn resync_connection_wide_envelope() -> LiveEnvelope {
    LiveEnvelope::ResyncRequired {
        network_profile: None,
        reason: "outbox_overflow".to_owned(),
        subscription_id: None,
        scope: None,
        epoch: None,
        clear_retained: true,
    }
}

fn current_as_of_envelope() -> LiveEnvelope {
    LiveEnvelope::CurrentAsOf {
        network_profile: None,
        subscription_id: "sub_fixture_1".to_owned(),
        function: "listTodos".to_owned(),
        version: 43,
        resume: Some(resume_wire(43)),
    }
}

/// Lane-P framing: the SAME durable envelope, wrapped in the drain's
/// `{"Durable":{"payload":[u8…]}}` form (the wrapper asymmetry of
/// src/live_wire.rs — wrapped over HTTP, unwrapped over the socket).
fn wrapped(envelope: &LiveEnvelope) -> Value {
    wire(&RealtimeEnvelope::Durable(DurableMessage::new(
        serde_json::to_vec(envelope).expect("envelope serializes"),
    )))
}

fn resume_wire(version: u64) -> ResumeWire {
    ResumeWire {
        token: format!("sbrt1.fixture-{version}"),
        meta: ResumeMeta {
            app: "fixture-app".to_owned(),
            version,
            content_digest: "mset1:fixture".to_owned(),
            generation: "sha256:fixture-generation".to_owned(),
            version_stream: "fixture-stream".to_owned(),
            query_artifact: "sha256:fixture-query".to_owned(),
            args_hash: "sha256:fixture-args".to_owned(),
        },
    }
}

fn fixture_invalidation_issuer() -> IssuerId {
    IssuerId {
        authorization_incarnation: "0198c7aa-1234-7000-8000-000000000001".to_owned(),
        boot_sequence: 1,
        boot_nonce: "AAAAAAAAAAAAAAAAAAAAAA".to_owned(),
    }
}

fn fixture_invalidation_namespace(query_instance_id: u64) -> QueryNamespace {
    QueryNamespace {
        client_store_id: "store-fixture".to_owned(),
        query_key: "listTodos:{}".to_owned(),
        query_instance_id,
    }
}

fn fixture_invalidation_scope(subscription_id: &str, query_instance_id: u64) -> ScopeId {
    ScopeId::Subscription {
        issuer_id: fixture_invalidation_issuer(),
        namespace: fixture_invalidation_namespace(query_instance_id),
        scope_sequence: 1,
        connection_generation: 1,
        subscription_id: subscription_id.to_owned(),
    }
}

fn fixture_authorization_expectation(epoch: u64) -> Value {
    json!({
        "issuerId": wire(&fixture_invalidation_issuer()),
        "connectionGeneration": 1,
        "authorization": {
            "incarnation": "0198c7aa-1234-7000-8000-000000000001",
            "epoch": epoch
        },
        "versionStream": "fixture-stream"
    })
}

fn invalidation_envelope(
    subscription_id: &str,
    version: u64,
    authorization_epoch: u64,
    max_disposition: InvalidationDisposition,
    resolution: Option<(ResolutionKind, &str)>,
    snapshot_title: Option<&str>,
) -> LiveEnvelope {
    invalidation_envelope_custom(
        subscription_id,
        1,
        1,
        version,
        authorization_epoch,
        max_disposition,
        resolution,
        snapshot_title.map(|title| (version, title)),
    )
}

#[allow(clippy::too_many_arguments)]
fn invalidation_envelope_custom(
    subscription_id: &str,
    query_instance_id: u64,
    revision: u64,
    witness_floor: u64,
    authorization_epoch: u64,
    max_disposition: InvalidationDisposition,
    resolution: Option<(ResolutionKind, &str)>,
    snapshot: Option<(u64, &str)>,
) -> LiveEnvelope {
    let scope_id = fixture_invalidation_scope(subscription_id, query_instance_id);
    let witness = CompositeWitness {
        authorization: AuthorizationVersion {
            incarnation: "0198c7aa-1234-7000-8000-000000000001".to_owned(),
            epoch: authorization_epoch,
        },
        data: Some(DataWitness {
            version_stream: "fixture-stream".to_owned(),
            min_commit_version: witness_floor,
        }),
    };
    let owner_continuity_id = Some("owner_fixture_1".to_owned());
    let obligation = ResyncObligation {
        protocol_version: 1,
        scope_id: scope_id.clone(),
        revision,
        max_disposition,
        witness: witness.clone(),
        retry_episode_id: None,
        owner_continuity_id: owner_continuity_id.clone(),
    };
    let resolution = resolution.map(|(kind, ack_token)| ResolutionTicket {
        protocol_version: 1,
        kind,
        scope_id,
        revision,
        witness,
        max_disposition,
        ack_token: ack_token.to_owned(),
        owner_continuity_id,
    });
    let snapshot = snapshot.map(|(version, title)| AuthorizationInvalidationSnapshot {
        subscription_id: subscription_id.to_owned(),
        function: "listTodos".to_owned(),
        version,
        rows: vec![json!({ "_id": "todo_1", "title": title })],
    });
    LiveEnvelope::authorization_invalidation(obligation, resolution, snapshot)
}

/// The seeded fixture corpus. Every fixture carries:
///
/// - `family`: the committed schema file the frame is an instance of
///   (`null` for frames no schema defines, i.e. unknown-kind negatives);
/// - `lane`: `core`, `live` (Lane L framing) or `poll` (Lane P framing —
///   wrapper fixtures are lane-assigned, never core, per LLP 0093 D2);
/// - `tuples`: the arm × lane conformance tuples the fixture binds
///   (`poll/hosted` never appears — it is not claimable in v1);
/// - `schemaValid`: whether the frame validates against `family` — the
///   *emission* claim. The *acceptance* claim lives in `expect` and may
///   diverge (unknown fields/kinds are accepted-tolerantly even where the
///   committed schema rejects them);
/// - `given`: abstract client-state preconditions (LLP 0095 §1 states);
/// - `expect`: the transitions/actions the state machine requires.
pub fn wire_fixture_corpus() -> Value {
    let replace = wire(&replace_envelope());
    let profiled_replace =
        wire(&replace_envelope().with_network_profile("fixture-slow".to_owned()));

    let delta = wire(&delta_envelope());

    let resync_subscription = wire(&resync_subscription_envelope());

    let resync_connection_wide = wire(&resync_connection_wide_envelope());

    let durable_bytes = wire(&LiveSocketServerFrame::DurableBytes {
        payload: vec![0xff, 0xfe],
    });
    let current_as_of = wire(&current_as_of_envelope());
    let invalidation_for_wrap = invalidation_envelope(
        "sub_fixture_1",
        43,
        1,
        InvalidationDisposition::Quarantine,
        Some((ResolutionKind::Snapshot, "ack_fixture_1")),
        Some("authorized row"),
    );
    let authorization_invalidation = wire(&invalidation_for_wrap);
    // Lane-P framing of the exact core invalidation envelope (parity is
    // gate-enforced byte-exact in tests/wire_fixtures_v1.rs).
    let wrapped_authorization_invalidation = wrapped(&invalidation_for_wrap);
    let authorization_invalidation_without_snapshot = wire(&invalidation_envelope(
        "sub_fixture_1",
        43,
        1,
        InvalidationDisposition::Quarantine,
        None,
        None,
    ));
    let foreign_authorization_invalidation = wire(&invalidation_envelope(
        "sub_fixture_foreign",
        43,
        1,
        InvalidationDisposition::Quarantine,
        Some((ResolutionKind::Snapshot, "ack_fixture_1")),
        Some("authorized row"),
    ));
    let same_version_authorization_invalidation = wire(&invalidation_envelope(
        "sub_fixture_1",
        42,
        2,
        InvalidationDisposition::Quarantine,
        Some((ResolutionKind::Snapshot, "ack_fixture_same_version_1")),
        Some("authorized at new epoch"),
    ));
    let terminal_delete_authorization_invalidation = wire(&invalidation_envelope(
        "sub_fixture_1",
        43,
        2,
        InvalidationDisposition::Delete,
        Some((
            ResolutionKind::TerminalDelete,
            "ack_fixture_terminal_delete_1",
        )),
        None,
    ));
    let held_authorization_scope = wire(&fixture_invalidation_scope("sub_fixture_1", 1));
    let held_authorization_namespace = wire(&fixture_invalidation_namespace(1));
    let mismatched_authorization_namespace = wire(&fixture_invalidation_namespace(2));
    let authorization_expectation_epoch_1 = fixture_authorization_expectation(1);
    let authorization_expectation_epoch_2 = fixture_authorization_expectation(2);
    let post_terminal_replace = wire(&LiveEnvelope::LiveReplace {
        network_profile: None,
        subscription_id: "sub_fixture_1".to_owned(),
        function: "listTodos".to_owned(),
        version: 44,
        rows: vec![json!({ "_id": "todo_1", "title": "must not resurrect" })],
        resume: None,
    });
    let newer_unresolved_invalidation = wire(&invalidation_envelope_custom(
        "sub_fixture_1",
        1,
        2,
        44,
        2,
        InvalidationDisposition::Quarantine,
        None,
        None,
    ));
    let older_resolved_invalidation = wire(&invalidation_envelope_custom(
        "sub_fixture_1",
        1,
        1,
        43,
        2,
        InvalidationDisposition::Quarantine,
        Some((ResolutionKind::Snapshot, "ack_fixture_stale_revision_1")),
        Some((43, "stale resolved row")),
    ));
    let mismatched_scope_invalidation = wire(&invalidation_envelope_custom(
        "sub_fixture_1",
        2,
        1,
        43,
        2,
        InvalidationDisposition::Quarantine,
        Some((ResolutionKind::Snapshot, "ack_fixture_mismatched_scope_1")),
        Some((43, "foreign namespace row")),
    ));
    let below_floor_invalidation = wire(&invalidation_envelope_custom(
        "sub_fixture_1",
        1,
        1,
        45,
        2,
        InvalidationDisposition::Quarantine,
        Some((ResolutionKind::Snapshot, "ack_fixture_below_floor_1")),
        Some((44, "below witness floor")),
    ));
    let terminal_delete_with_snapshot_invalidation = wire(&invalidation_envelope_custom(
        "sub_fixture_1",
        1,
        1,
        45,
        2,
        InvalidationDisposition::Quarantine,
        Some((
            ResolutionKind::TerminalDelete,
            "ack_fixture_terminal_with_snapshot_1",
        )),
        Some((45, "terminal delete must not carry rows")),
    ));

    let wrapped_replace = wrapped(&replace_envelope());
    // A wrapper whose payload bytes are NOT decodable JSON. Valid at the
    // wrapper layer (family realtime.envelope) — the loss happens at the
    // inner decode, after the ownership cut has already consumed the batch.
    let wrapped_malformed = wire(&RealtimeEnvelope::Durable(DurableMessage::new(vec![
        0xff, 0xfe, 0x00,
    ])));
    // Wrapped/unwrapped parity for the remaining durable families: the exact
    // envelope value each core fixture carries, re-framed for the drain.
    let wrapped_delta = wrapped(&delta_envelope());
    let wrapped_resync_subscription = wrapped(&resync_subscription_envelope());
    let wrapped_resync_connection_wide = wrapped(&resync_connection_wide_envelope());
    let wrapped_current_as_of = wrapped(&current_as_of_envelope());
    // The liveness probe answer (LLP 0034 D0/D1) for the virtual-time
    // heartbeat fixture.
    let pong = wire(&LiveSocketServerFrame::Pong {
        request_id: Some("ping_fixture_1".to_owned()),
        server_time_ms: 5_000,
    });
    // T-AUTH-TERM frames: the identifier-free typed terminal closure with
    // its authorityDisposition distinction (LLP 0059; src/live_wire.rs).
    let auth_error_carrier = wire(&LiveSocketServerFrame::AuthError {
        code: LiveAuthErrorCode::SessionExpired,
        reason: LiveAuthErrorReason::Expired,
        authority_disposition: LiveAuthorityDisposition::Carrier,
    });
    let auth_error_durable_delete = wire(&LiveSocketServerFrame::AuthError {
        code: LiveAuthErrorCode::ScopedTokenInvalid,
        reason: LiveAuthErrorReason::Revoked,
        authority_disposition: LiveAuthorityDisposition::DurableDelete,
    });

    let seeded = json!([
        {
            "name": "durable.live_replace.basic",
            "family": "live.envelope.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local", "live/hosted"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": replace,
            "given": { "subscription": { "id": "sub_fixture_1", "state": "live", "version": 40 } },
            "expect": {
                "transitions": [{ "subscription": "sub_fixture_1", "to": "live", "version": 41 }],
                "actions": ["replace_rows"]
            },
            "notes": "Whole-result refresh; the wire default. Version guard admits 41 > 40."
        },
        {
            "name": "socket.durable.live_replace.network_profile_marker",
            "family": "live.envelope.schema.json",
            "lane": "live",
            "tuples": ["live/local", "live/hosted"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": profiled_replace,
            "given": { "subscription": { "id": "sub_fixture_1", "state": "live", "version": 40 } },
            "expect": {
                "transitions": [{ "subscription": "sub_fixture_1", "to": "live", "version": 41 }],
                "actions": ["replace_rows"]
            },
            "notes": "Compatible v1 optional-field addition: the socket frame surfaces the non-normal admission snapshot name without changing ordinary live_replace application. The marker is absent under normal."
        },
        {
            "name": "durable.live_delta.apply_by_id",
            "family": "live.envelope.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local", "live/hosted"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": delta,
            "given": { "subscription": { "id": "sub_fixture_1", "state": "live", "version": 41 } },
            "expect": {
                "transitions": [{ "subscription": "sub_fixture_1", "to": "live", "version": 42 }],
                "actions": ["apply_delta_by_id"]
            },
            "notes": "Delta-vs-replace is the server's choice (D3 fact 4): a conformant client implements both and never infers query shape from which arrives."
        },
        {
            "name": "durable.live_delta.stale_version_dropped",
            "family": "live.envelope.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local", "live/hosted"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": delta,
            "given": { "subscription": { "id": "sub_fixture_1", "state": "live", "version": 42 } },
            "expect": {
                "transitions": [],
                "actions": ["drop_stale"]
            },
            "notes": "Version guard: a frame at or below the held version is dropped without effect (LLP 0095 §1.3)."
        },
        {
            "name": "durable.replace_then_delta.identity_continuity",
            "family": "live.envelope.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local", "live/hosted"],
            "direction": "server_to_client",
            "schemaValid": true,
            "steps": [
                {
                    "frame": replace,
                    "expect": {
                        "transitions": [{ "subscription": "sub_fixture_1", "to": "live", "version": 41 }],
                        "actions": ["replace_rows"]
                    }
                },
                {
                    "frame": delta,
                    "expect": {
                        "transitions": [{ "subscription": "sub_fixture_1", "to": "live", "version": 42 }],
                        "actions": ["apply_delta_by_id"]
                    }
                }
            ],
            "given": {
                "subscriptions": [
                    { "id": "sub_fixture_1", "state": "live", "version": 40, "rows": [] }
                ]
            },
            "expect": {
                "transitions": [{ "subscription": "sub_fixture_1", "to": "live", "version": 42 }],
                "actions": ["replace_rows", "apply_delta_by_id"],
                "rowIdentity": {
                    "member": "_id",
                    "deltaId": "todo_1",
                    "finalTitle": "updated row",
                    "finalIds": ["todo_1", "todo_2"]
                }
            },
            "notes": "Format-v2 multi-step witness: live_replace establishes `_id` todo_1, then live_delta id todo_1 updates that exact row. A corpus client keyed on user field `id` cannot pass."
        },
        {
            "name": "durable.current_as_of.adopts_token_without_rows",
            "family": "live.envelope.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local", "live/hosted"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": current_as_of,
            "given": {
                "subscription": {
                    "id": "sub_fixture_1",
                    "state": "live",
                    "version": 42,
                    "rows": [{ "_id": "todo_1", "title": "held row" }]
                }
            },
            "expect": {
                "transitions": [{ "subscription": "sub_fixture_1", "to": "live", "version": 43 }],
                "actions": ["adopt_resume_token"],
                "rows": "unchanged"
            },
            "notes": "Known CurrentAsOf obligation: advance version and adopt the mandatory fresh token without replacing or mutating held rows (LLP 0091 §0B.2)."
        },
        {
            "name": "auth.live.invalidation_snapshot_apply_then_ack",
            "family": "live.envelope.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local"],
            "profiles": ["auth/live"],
            "direction": "server_to_client",
            "schemaValid": true,
            "steps": [
                {
                    "frame": authorization_invalidation,
                    "expect": {
                        "transitions": [{ "subscription": "sub_fixture_1", "to": "live", "version": 43 }],
                        "actions": [
                            "quarantine_rows",
                            "apply_invalidation_snapshot",
                            "acknowledge_obligation"
                        ],
                        "orderedActions": [
                            "quarantine_rows",
                            "apply_invalidation_snapshot",
                            "acknowledge_obligation"
                        ]
                    }
                },
                {
                    "frame": authorization_invalidation,
                    "expect": {
                        "transitions": [],
                        "actions": ["acknowledge_obligation"],
                        "ackToken": "ack_fixture_1"
                    }
                }
            ],
            "given": {
                "authorizationExpectation": authorization_expectation_epoch_1,
                "subscriptions": [
                    {
                        "id": "sub_fixture_1",
                        "state": "live",
                        "version": 42,
                        "authorizationScope": held_authorization_scope,
                        "authorizationNamespace": held_authorization_namespace,
                        "acceptedAuthorization": {
                            "incarnation": "0198c7aa-1234-7000-8000-000000000001",
                            "epoch": 1
                        },
                        "rows": [{ "_id": "todo_1", "title": "pre-invalidation row" }]
                    }
                ]
            },
            "expect": {
                "transitions": [{ "subscription": "sub_fixture_1", "to": "live", "version": 43 }],
                "actions": [
                    "quarantine_rows",
                    "apply_invalidation_snapshot",
                    "acknowledge_obligation"
                ],
                "acknowledgeAfter": "apply_invalidation_snapshot",
                "redelivery": "re-acknowledge the same token without reapplying the snapshot"
            },
            "notes": "Format-v2 level-triggered sequence: quarantine first, atomically apply the superseding snapshot, only then release the exact ackToken. A redelivery remains acknowledgeable and never re-applies equal-version rows."
        },
        {
            "name": "auth.live.invalidation_authorization_snapshot_same_data_version",
            "family": "live.envelope.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local"],
            "profiles": ["auth/live"],
            "direction": "server_to_client",
            "schemaValid": true,
            "steps": [
                {
                    "frame": same_version_authorization_invalidation,
                    "expect": {
                        "transitions": [{
                            "subscription": "sub_fixture_1",
                            "to": "live",
                            "version": 42,
                            "authorizationEpoch": 2
                        }],
                        "actions": [
                            "quarantine_rows",
                            "apply_invalidation_snapshot",
                            "acknowledge_obligation"
                        ],
                        "orderedActions": [
                            "quarantine_rows",
                            "apply_invalidation_snapshot",
                            "acknowledge_obligation"
                        ]
                    }
                },
                {
                    "frame": same_version_authorization_invalidation,
                    "expect": {
                        "transitions": [],
                        "actions": ["acknowledge_obligation"],
                        "ackToken": "ack_fixture_same_version_1"
                    }
                }
            ],
            "given": {
                "authorizationExpectation": authorization_expectation_epoch_2,
                "subscriptions": [
                    {
                        "id": "sub_fixture_1",
                        "state": "live",
                        "version": 42,
                        "authorizationScope": held_authorization_scope,
                        "authorizationNamespace": held_authorization_namespace,
                        "acceptedAuthorization": {
                            "incarnation": "0198c7aa-1234-7000-8000-000000000001",
                            "epoch": 1
                        },
                        "rows": [{ "_id": "todo_1", "title": "pre-authorization row" }]
                    }
                ]
            },
            "expect": {
                "transitions": [{
                    "subscription": "sub_fixture_1",
                    "to": "live",
                    "version": 42,
                    "authorizationEpoch": 2
                }],
                "actions": [
                    "quarantine_rows",
                    "apply_invalidation_snapshot",
                    "acknowledge_obligation"
                ],
                "acknowledgeAfter": "apply_invalidation_snapshot",
                "redelivery": "re-acknowledge the same token without reapplying the snapshot"
            },
            "notes": "Authorization and data versions are orthogonal. A first-seen exact resolution at the authenticated new authorization epoch atomically replaces rows and becomes acknowledgeable even when its snapshot data version equals the held version; the ordinary live-frame strict-greater version guard does not apply. Only an exact redelivery may skip reapplication and re-acknowledge the same token."
        },
        {
            "name": "auth.live.invalidation_terminal_delete_apply_then_ack",
            "family": "live.envelope.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local"],
            "profiles": ["auth/live"],
            "direction": "server_to_client",
            "schemaValid": true,
            "steps": [
                {
                    "frame": terminal_delete_authorization_invalidation,
                    "expect": {
                        "transitions": [{
                            "subscription": "sub_fixture_1",
                            "to": "terminal_deleted",
                            "rows": "destroyed"
                        }],
                        "actions": [
                            "quarantine_rows",
                            "apply_invalidation_terminal_delete",
                            "acknowledge_obligation"
                        ],
                        "orderedActions": [
                            "quarantine_rows",
                            "apply_invalidation_terminal_delete",
                            "acknowledge_obligation"
                        ]
                    }
                },
                {
                    "frame": terminal_delete_authorization_invalidation,
                    "expect": {
                        "transitions": [],
                        "actions": ["acknowledge_obligation"],
                        "ackToken": "ack_fixture_terminal_delete_1"
                    }
                }
            ],
            "given": {
                "authorizationExpectation": authorization_expectation_epoch_2,
                "subscriptions": [
                    {
                        "id": "sub_fixture_1",
                        "state": "live",
                        "version": 42,
                        "authorizationScope": held_authorization_scope,
                        "authorizationNamespace": held_authorization_namespace,
                        "acceptedAuthorization": {
                            "incarnation": "0198c7aa-1234-7000-8000-000000000001",
                            "epoch": 1
                        },
                        "rows": [{ "_id": "todo_1", "title": "must be destroyed" }]
                    }
                ]
            },
            "expect": {
                "transitions": [{
                    "subscription": "sub_fixture_1",
                    "to": "terminal_deleted",
                    "rows": "destroyed"
                }],
                "actions": [
                    "quarantine_rows",
                    "apply_invalidation_terminal_delete",
                    "acknowledge_obligation"
                ],
                "acknowledgeAfter": "apply_invalidation_terminal_delete",
                "redelivery": "re-acknowledge the same token without repeating the terminal delete"
            },
            "notes": "A terminalDelete resolution carries no snapshot (wire omission and JSON null both decode as absent). The client first makes rows unreadable, atomically destroys the exact materialization and installs its terminal fence, and only then acknowledges the exact token. Exact redelivery re-acknowledges without repeating destruction."
        },
        {
            "name": "auth.live.invalidation_terminal_delete_blocks_ordinary_live_reuse",
            "family": "live.envelope.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local"],
            "profiles": ["auth/live"],
            "direction": "server_to_client",
            "schemaValid": true,
            "steps": [
                {
                    "frame": terminal_delete_authorization_invalidation,
                    "expect": {
                        "transitions": [{
                            "subscription": "sub_fixture_1",
                            "to": "terminal_deleted",
                            "rows": "destroyed"
                        }],
                        "actions": [
                            "quarantine_rows",
                            "apply_invalidation_terminal_delete",
                            "acknowledge_obligation"
                        ],
                        "orderedActions": [
                            "quarantine_rows",
                            "apply_invalidation_terminal_delete",
                            "acknowledge_obligation"
                        ]
                    }
                },
                {
                    "frame": post_terminal_replace,
                    "expect": {
                        "transitions": [],
                        "actions": ["surface_protocol_diagnostic", "ignore_frame"],
                        "forbiddenActions": ["replace_rows"]
                    }
                }
            ],
            "given": {
                "authorizationExpectation": authorization_expectation_epoch_2,
                "subscriptions": [{
                    "id": "sub_fixture_1",
                    "state": "live",
                    "version": 42,
                    "authorizationScope": held_authorization_scope,
                    "authorizationNamespace": held_authorization_namespace,
                    "acceptedAuthorization": {
                        "incarnation": "0198c7aa-1234-7000-8000-000000000001",
                        "epoch": 1
                    },
                    "rows": [{ "_id": "todo_1", "title": "must be destroyed" }]
                }]
            },
            "expect": {
                "transitions": [{
                    "subscription": "sub_fixture_1",
                    "to": "terminal_deleted",
                    "rows": "destroyed"
                }],
                "actions": [
                    "quarantine_rows",
                    "apply_invalidation_terminal_delete",
                    "acknowledge_obligation",
                    "surface_protocol_diagnostic",
                    "ignore_frame"
                ],
                "forbiddenActions": ["replace_rows"]
            },
            "notes": "TERMINAL_DELETED is a one-way materialization fence. Even a numerically newer ordinary live_replace for the same subscription id is diagnosed and ignored; it cannot resurrect rows. Recreating the query requires a fresh queryInstanceId and fresh subscribe."
        },
        {
            "name": "auth.live.invalidation_newer_pending_rejects_older_resolution",
            "family": "live.envelope.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local"],
            "profiles": ["auth/live"],
            "direction": "server_to_client",
            "schemaValid": true,
            "steps": [
                {
                    "frame": newer_unresolved_invalidation,
                    "expect": {
                        "transitions": [{
                            "subscription": "sub_fixture_1",
                            "to": "resync_pending",
                            "rows": "retained_unreadable",
                            "pendingRevision": 2,
                            "pendingWitnessFloor": 44
                        }],
                        "actions": ["quarantine_rows"]
                    }
                },
                {
                    "frame": older_resolved_invalidation,
                    "expect": {
                        "transitions": [],
                        "actions": ["surface_protocol_diagnostic", "ignore_frame"],
                        "forbiddenActions": [
                            "apply_invalidation_snapshot",
                            "acknowledge_obligation"
                        ]
                    }
                }
            ],
            "given": {
                "authorizationExpectation": authorization_expectation_epoch_2,
                "subscriptions": [{
                    "id": "sub_fixture_1",
                    "state": "live",
                    "version": 42,
                    "authorizationScope": held_authorization_scope,
                    "authorizationNamespace": held_authorization_namespace,
                    "acceptedAuthorization": {
                        "incarnation": "0198c7aa-1234-7000-8000-000000000001",
                        "epoch": 1
                    },
                    "rows": [{ "_id": "todo_1", "title": "held pending row" }]
                }]
            },
            "expect": {
                "transitions": [{
                    "subscription": "sub_fixture_1",
                    "to": "resync_pending",
                    "rows": "retained_unreadable",
                    "pendingRevision": 2,
                    "pendingWitnessFloor": 44
                }],
                "actions": [
                    "quarantine_rows",
                    "surface_protocol_diagnostic",
                    "ignore_frame"
                ],
                "forbiddenActions": [
                    "apply_invalidation_snapshot",
                    "acknowledge_obligation"
                ]
            },
            "notes": "Accepting revision 2 persists the exact scope/revision/witness high-water before quarantine. A later revision-1 frame with an apparently complete resolution is stale: it cannot apply rows, lower the pending floor, or acknowledge."
        },
        {
            "name": "auth.live.invalidation_owned_id_mismatched_scope_never_acknowledged",
            "family": "live.envelope.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local"],
            "profiles": ["auth/live"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": mismatched_scope_invalidation,
            "given": {
                "authorizationExpectation": authorization_expectation_epoch_2,
                "subscriptions": [{
                    "id": "sub_fixture_1",
                    "state": "live",
                    "version": 42,
                    "authorizationScope": held_authorization_scope,
                    "authorizationNamespace": held_authorization_namespace,
                    "acceptedAuthorization": {
                        "incarnation": "0198c7aa-1234-7000-8000-000000000001",
                        "epoch": 1
                    },
                    "rows": [{ "_id": "todo_1", "title": "owned row" }]
                }]
            },
            "expect": {
                "transitions": [],
                "actions": ["surface_protocol_diagnostic", "ignore_frame"],
                "forbiddenActions": [
                    "quarantine_rows",
                    "apply_invalidation_snapshot",
                    "acknowledge_obligation"
                ],
                "mismatchedNamespace": mismatched_authorization_namespace
            },
            "notes": "Matching subscriptionId is insufficient. The frame's full scope names queryInstanceId 2 while the held subscription owns queryInstanceId 1, so the client diagnoses and ignores it without changing or acknowledging the owned materialization."
        },
        {
            "name": "auth.live.invalidation_invalid_resolution_never_acknowledged",
            "family": "live.envelope.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local"],
            "profiles": ["auth/live"],
            "direction": "server_to_client",
            "schemaValid": true,
            "steps": [
                {
                    "frame": below_floor_invalidation,
                    "expect": {
                        "transitions": [{
                            "subscription": "sub_fixture_1",
                            "to": "resync_pending",
                            "rows": "retained_unreadable",
                            "pendingRevision": 1,
                            "pendingWitnessFloor": 45
                        }],
                        "actions": ["quarantine_rows", "surface_protocol_diagnostic"],
                        "forbiddenActions": [
                            "apply_invalidation_snapshot",
                            "acknowledge_obligation"
                        ]
                    }
                },
                {
                    "frame": terminal_delete_with_snapshot_invalidation,
                    "expect": {
                        "transitions": [],
                        "actions": ["surface_protocol_diagnostic", "ignore_frame"],
                        "forbiddenActions": [
                            "apply_invalidation_terminal_delete",
                            "acknowledge_obligation"
                        ]
                    }
                }
            ],
            "given": {
                "authorizationExpectation": authorization_expectation_epoch_2,
                "subscriptions": [{
                    "id": "sub_fixture_1",
                    "state": "live",
                    "version": 42,
                    "authorizationScope": held_authorization_scope,
                    "authorizationNamespace": held_authorization_namespace,
                    "acceptedAuthorization": {
                        "incarnation": "0198c7aa-1234-7000-8000-000000000001",
                        "epoch": 1
                    },
                    "rows": [{ "_id": "todo_1", "title": "must stay unreadable" }]
                }]
            },
            "expect": {
                "transitions": [{
                    "subscription": "sub_fixture_1",
                    "to": "resync_pending",
                    "rows": "retained_unreadable",
                    "pendingRevision": 1,
                    "pendingWitnessFloor": 45
                }],
                "actions": [
                    "quarantine_rows",
                    "surface_protocol_diagnostic",
                    "ignore_frame"
                ],
                "forbiddenActions": [
                    "apply_invalidation_snapshot",
                    "apply_invalidation_terminal_delete",
                    "acknowledge_obligation"
                ]
            },
            "notes": "Step 1 accepts the valid obligation and quarantines, but its snapshot version 44 is below witness floor 45, so the resolution is diagnosed and not applied or acknowledged. Step 2 keeps that quarantine: terminalDelete plus a snapshot violates the kind/snapshot relation and the whole conflicting resolution frame is diagnosed and ignored."
        },
        {
            "name": "auth.live.invalidation_without_snapshot_quarantines",
            "family": "live.envelope.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local"],
            "profiles": ["auth/live"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": authorization_invalidation_without_snapshot,
            "given": {
                "authorizationExpectation": authorization_expectation_epoch_1,
                "subscriptions": [{
                    "id": "sub_fixture_1",
                    "state": "live",
                    "version": 42,
                    "authorizationScope": held_authorization_scope,
                    "authorizationNamespace": held_authorization_namespace,
                    "acceptedAuthorization": {
                        "incarnation": "0198c7aa-1234-7000-8000-000000000001",
                        "epoch": 1
                    }
                }]
            },
            "expect": {
                "transitions": [{ "subscription": "sub_fixture_1", "to": "resync_pending", "rows": "retained_unreadable" }],
                "actions": ["quarantine_rows"],
                "forbiddenActions": ["acknowledge_obligation"]
            },
            "notes": "An obligation without a satisfying snapshot makes held rows unreadable and is not acknowledged. Level-triggered delivery continues until a resolution can be applied."
        },
        {
            "name": "auth.live.foreign_obligation_never_acknowledged",
            "family": "live.envelope.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local"],
            "profiles": ["auth/live"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": foreign_authorization_invalidation,
            "given": {
                "authorizationExpectation": authorization_expectation_epoch_1,
                "subscriptions": [{
                    "id": "sub_fixture_1",
                    "state": "live",
                    "version": 42,
                    "authorizationScope": held_authorization_scope,
                    "authorizationNamespace": held_authorization_namespace,
                    "acceptedAuthorization": {
                        "incarnation": "0198c7aa-1234-7000-8000-000000000001",
                        "epoch": 1
                    }
                }]
            },
            "expect": {
                "transitions": [],
                "actions": ["surface_protocol_diagnostic", "ignore_frame"],
                "forbiddenActions": ["acknowledge_obligation"]
            },
            "notes": "The full obligation scope names a subscription this client does not hold. It is surfaced and ignored, never acknowledged on behalf of a foreign live owner."
        },
        {
            "name": "durable.resync_required.subscription_scoped",
            "family": "live.envelope.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local", "live/hosted"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": resync_subscription,
            "given": { "subscription": { "id": "sub_fixture_1", "state": "live", "version": 42 } },
            "expect": {
                "transitions": [{ "subscription": "sub_fixture_1", "to": "resync_pending" }],
                "actions": ["resubscribe_subscription"]
            },
            "notes": "Reason strings are an open set: recovery is identical for every reason, and an unknown reason must not change the transition."
        },
        {
            "name": "durable.resync_required.connection_wide_clear_retained",
            "family": "live.envelope.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local", "live/hosted"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": resync_connection_wide,
            "given": {
                "connection": { "state": "attached" },
                "subscriptions": [
                    { "id": "sub_fixture_1", "state": "live", "version": 42 },
                    { "id": "sub_fixture_2", "state": "live", "version": 7 }
                ]
            },
            "expect": {
                "transitions": [{ "connection": "all_subscriptions", "to": "resync_pending" }],
                "actions": ["resubscribe_all", "clear_retained_overlays"]
            },
            "notes": "No subscription_id + clear_retained: the whole outbox is untrusted (overflow class). The frame crosses the lane boundary: retained ephemeral overlays blank too (LLP 0059 cross-lane rule)."
        },
        {
            "name": "socket.durable_bytes.forced_resync",
            "family": "live.socket-server.schema.json",
            "lane": "live",
            "tuples": ["live/local", "live/hosted"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": durable_bytes,
            "given": {
                "connection": { "state": "attached" },
                "subscriptions": [
                    { "id": "sub_fixture_1", "state": "live", "version": 42 },
                    { "id": "sub_fixture_2", "state": "live", "version": 7 }
                ]
            },
            "expect": {
                "transitions": [{ "connection": "all_subscriptions", "to": "resync_pending" }],
                "actions": ["resubscribe_all", "clear_retained_overlays"],
                "equivalenceClass": {
                    "reference": "in-place synthesized connection-wide clear-retained resync sentinel (reason durable_bytes_undecodable, client-synthesized, never wire-emitted)",
                    "permittedEquivalent": "socket close/reconnect with fresh subscribe achieving the same transitions"
                }
            },
            "notes": "D3 fact 2b: a KNOWN kind with a REQUIRED recovery action. The payload's outbox lease was released at socket handoff; ignoring this frame is non-conformant (silent permanent staleness)."
        },
        {
            "name": "negative.unknown_kind.skipped",
            "family": null,
            "lane": "core",
            "tuples": ["poll/local", "live/local", "live/hosted"],
            "direction": "server_to_client",
            "schemaValid": false,
            "frame": { "kind": "hologram_snapshot_v9", "payload": { "future": true } },
            "given": {
                "connection": { "state": "attached" },
                "subscriptions": [
                    { "id": "sub_fixture_1", "state": "live", "version": 42 },
                    { "id": "sub_fixture_2", "state": "live", "version": 7 }
                ]
            },
            "expect": {
                "transitions": [],
                "actions": ["ignore_frame"]
            },
            "notes": "Unknown kinds are skip-not-crash defense-in-depth (new kinds are always offer-gated, so a conformant server never sends one ungated). Contrast socket.durable_bytes.forced_resync: KNOWN kind, required action."
        },
        {
            "name": "negative.unknown_field.tolerated",
            "family": "live.envelope.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local", "live/hosted"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": {
                "kind": "live_replace",
                "subscription_id": "sub_fixture_1",
                "function": "listTodos",
                "version": 43,
                "rows": [],
                "sparkle_hint": { "unknown": true }
            },
            "given": { "subscription": { "id": "sub_fixture_1", "state": "live", "version": 42 } },
            "expect": {
                "transitions": [{ "subscription": "sub_fixture_1", "to": "live", "version": 43 }],
                "actions": ["replace_rows", "ignore_unknown_fields"]
            },
            "notes": "Unknown fields on known kinds are ignored, never fatal (the acceptance grammar wins over schema closure where they diverge — LLP 0093 D1)."
        },
        {
            "name": "poll.wrapped_durable.unwrap",
            "family": "realtime.envelope.schema.json",
            "lane": "poll",
            "tuples": ["poll/local"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": wrapped_replace,
            "given": { "subscription": { "id": "sub_fixture_1", "state": "live", "version": 40 } },
            "expect": {
                "transitions": [{ "subscription": "sub_fixture_1", "to": "live", "version": 41 }],
                "actions": ["unwrap_durable", "replace_rows"]
            },
            "notes": "Lane-P framing: durable envelopes arrive wrapped ({\"Durable\":{\"payload\":[u8…]}}) over the HTTP drain and unwrapped over the socket. Wrapper handling is a lane obligation, not core."
        },
        {
            "name": "poll.acknowledged_batch.malformed_item_forces_resync",
            "family": "realtime.envelope.schema.json",
            "lane": "poll",
            "tuples": ["poll/local"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": wrapped_malformed,
            "batchContext": [wrapped_replace],
            "given": {
                "connection": { "state": "attached" },
                "subscriptions": [
                    { "id": "sub_fixture_1", "state": "live", "version": 40 },
                    { "id": "sub_fixture_2", "state": "live", "version": 7 }
                ]
            },
            "expect": {
                "transitions": [{ "connection": "all_subscriptions", "to": "resync_pending" }],
                "actions": [
                    "deliver_batch_remainder",
                    "surface_decode_diagnostic",
                    "resubscribe_all",
                    "clear_retained_overlays"
                ]
            },
            "notes": "The poll-lane analogue of fact 2b (LLP 0095 §1.4 T-DB-P): after the ownership cut the malformed item is lost exactly like a durable_bytes payload, so it forces the same connection-wide resync class — and must never abort the remainder. Format v2 pins sub_fixture_1 in the population and subsumes the remainder item's actions AND transitions under deliver_batch_remainder."
        },
    ]);

    // ---- Format-v3 P-1 extensions: negotiation refusals, drain-cancel
    // duplicate tolerance, arm-mismatch, grant loss, wrapped/unwrapped
    // parity, and virtual-time heartbeat/freshness/backoff.
    // @ref LLP 0094#0b3-the-wireversion-open-time-offer — the open-time
    //   offer matrix the negotiation fixtures pin: known binds, unknown
    //   refuses, absent degrades to legacy.
    let p1_extensions = json!([
        {
            "name": "negotiation.open.unknown_wire_version_refused",
            "family": "connection.open.input.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local", "live/hosted"],
            "direction": "client_to_server",
            "schemaValid": true,
            "request": {
                "method": "POST",
                "route": "/connection/open",
                "body": { "wireVersion": "snapback.v2" }
            },
            "refusal": {
                "status": 400,
                "code": "SNAPBACK_WIRE_VERSION_UNSUPPORTED"
            },
            "given": { "connection": { "state": "idle" } },
            "expect": {
                "transitions": [],
                "actions": ["surface_capability_diagnostic"],
                "forbiddenActions": ["retry_unchanged"]
            },
            "notes": "LLP 0094 §0B.3: a present unknown wireVersion refuses — a v2-needing client must never be interpreted under v1. On this refusal the client surfaces a structured capability diagnostic; silently re-opening without the offer would be exactly the undeclared degradation the refusal exists to prevent (absent-offer legacy opens are sanctioned only for clients that never needed the version)."
        },
        {
            "name": "negotiation.open.unknown_auth_invalidation_protocol_refused",
            "family": "connection.open.input.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local", "live/hosted"],
            "direction": "client_to_server",
            "schemaValid": true,
            "request": {
                "method": "POST",
                "route": "/connection/open",
                "body": { "authInvalidationProtocol": 2 }
            },
            "refusal": {
                "status": 400,
                "code": "SNAPBACK_AUTH_INVALIDATION_PROTOCOL_UNSUPPORTED"
            },
            "given": { "connection": { "state": "idle" } },
            "expect": {
                "transitions": [],
                "actions": ["surface_capability_diagnostic"],
                "forbiddenActions": ["retry_unchanged"]
            },
            "notes": "LLP 0094 §0C.5: both open-time offer fields follow one matrix — known binds, unknown refuses, absent degrades to legacy. Both arms enforce this (crates/snapback-server/src/server.rs open_connection; targets/cloudflare/src/coordinator.js kitOpenConnection)."
        },
        {
            "name": "negotiation.socket.wire_version_required",
            "family": null,
            "lane": "live",
            "tuples": ["live/local", "live/hosted"],
            "direction": "client_to_server",
            "schemaValid": false,
            "request": {
                "method": "GET",
                "route": "/live/{connection_id}/stream",
                "upgrade": true,
                "subprotocols": ["snapback.connection-token.sct_fixture_1"]
            },
            "refusal": {
                "status": 400,
                "code": "SNAPBACK_WIRE_VERSION_REQUIRED"
            },
            "given": { "connection": { "state": "granted" } },
            "expect": {
                "transitions": [],
                "actions": ["surface_capability_diagnostic"],
                "forbiddenActions": ["retry_unchanged"]
            },
            "notes": "LLP 0094 §0B.4/§0B.5 B3: the offerless-upgrade bridge is closed — kit-stream upgrades must offer the bound `snapback.v1` subprotocol. The bearer carrier is excluded before candidate matching and never counts as a version offer. The repair is offering the bound version, not retrying unchanged."
        },
        {
            "name": "negotiation.socket.unknown_wire_version_refused",
            "family": null,
            "lane": "live",
            "tuples": ["live/local", "live/hosted"],
            "direction": "client_to_server",
            "schemaValid": false,
            "request": {
                "method": "GET",
                "route": "/live/{connection_id}/stream",
                "upgrade": true,
                "subprotocols": [
                    "snapback.v2",
                    "snapback.v1.0",
                    "snapback.connection-token.sct_fixture_1"
                ]
            },
            "refusal": {
                "status": 400,
                "code": "SNAPBACK_WIRE_VERSION_UNSUPPORTED"
            },
            "given": { "connection": { "state": "granted" } },
            "expect": {
                "transitions": [],
                "actions": ["surface_capability_diagnostic"],
                "forbiddenActions": ["retry_unchanged"]
            },
            "notes": "LLP 0094 §0B.4: classification precedes equality — an offer set with version candidates but no known token refuses SNAPBACK_WIRE_VERSION_UNSUPPORTED, never MISMATCH, and is never silently interpreted under v1."
        },
        {
            "name": "poll.drain_cancel.redelivered_duplicates_tolerated",
            "family": "realtime.envelope.schema.json",
            "lane": "poll",
            "tuples": ["poll/local"],
            "direction": "server_to_client",
            "schemaValid": true,
            "steps": [
                {
                    "frame": wrapped_replace,
                    "expect": {
                        "transitions": [{ "subscription": "sub_fixture_1", "to": "live", "version": 41 }],
                        "actions": ["unwrap_durable", "replace_rows"]
                    }
                },
                {
                    "frame": wrapped_replace,
                    "expect": {
                        "transitions": [],
                        "actions": ["unwrap_durable", "drop_stale"]
                    }
                },
                {
                    "frame": wrapped_delta,
                    "expect": {
                        "transitions": [{ "subscription": "sub_fixture_1", "to": "live", "version": 42 }],
                        "actions": ["unwrap_durable", "apply_delta_by_id"]
                    }
                }
            ],
            "given": {
                "subscriptions": [
                    { "id": "sub_fixture_1", "state": "live", "version": 40, "rows": [] }
                ]
            },
            "expect": {
                "transitions": [{ "subscription": "sub_fixture_1", "to": "live", "version": 42 }],
                "actions": ["unwrap_durable", "replace_rows", "drop_stale", "apply_delta_by_id"]
            },
            "notes": "T-DRAIN (LLP 0095 §1.4 / LLP 0059): the drain is a leased batch with an ownership-transfer cut. A drain cancelled before the cut releases its lease and its entries redeliver, so step 2 is the exact byte-identical wrapper of step 1 arriving again. Clients MUST be duplicate-tolerant: the version guard drops the redelivered replace without effect and delivery resumes with the next version."
        },
        {
            "name": "arm.hosted_subscribe_requires_socket",
            "family": "live.subscribe.input.schema.json",
            "lane": "core",
            "tuples": ["live/hosted"],
            "direction": "client_to_server",
            "schemaValid": true,
            "request": {
                "method": "POST",
                "route": "/live/listTodos/subscribe",
                "body": {
                    "connection_id": "conn_fixture_1",
                    "input": { "args": {} }
                }
            },
            "refusal": {
                "status": 409,
                "code": "SNAPBACK_CONNECTION_SOCKET_REQUIRED"
            },
            "given": { "connection": { "state": "granted" } },
            "expect": {
                "transitions": [],
                "actions": ["surface_capability_diagnostic", "establish_live_socket"],
                "forbiddenActions": ["retry_unchanged"]
            },
            "notes": "T-SUB on the hosted arm (LLP 0095 §1.4; LLP 0090): subscribe refuses without a current authenticated socket session — socketless HTTP cannot arm hosted demand. The repair is establishing the managed socket first, then subscribing; retrying the socketless subscribe unchanged cannot succeed."
        },
        {
            "name": "arm.live_hosted_drain_declared_empty_blackout",
            "family": "live.outbox-drain.output.schema.json",
            "lane": "live",
            "tuples": ["live/hosted"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": [],
            "given": {
                "connection": { "state": "recovering" },
                "subscriptions": [
                    { "id": "sub_fixture_1", "state": "dropped", "version": 42 },
                    { "id": "sub_fixture_2", "state": "dropped", "version": 7 }
                ]
            },
            "expect": {
                "transitions": [],
                "actions": []
            },
            "notes": "T-BLACKOUT (D3 fact 2a): the hosted arm has no durable outbox — the drain is declared-empty in the capability manifest and always answers []. During a hosted socket outage the drain delivers NOTHING; a live/hosted client must not treat drain polling as a delivery or recovery lane (this is why poll/hosted is not a claimable tuple). Reconnect-resubscribe is the only recovery lane, and the empty drain is not evidence that no updates were missed."
        },
        {
            "name": "arm.socket_loss_mid_subscribe",
            "family": null,
            "lane": "live",
            "tuples": ["live/local", "live/hosted"],
            "direction": "client_lifecycle",
            "schemaValid": false,
            "steps": [
                {
                    "event": { "kind": "socket_lost" },
                    "expect": {
                        "transitions": [
                            { "connection": "state", "to": "recovering" },
                            { "subscription": "sub_fixture_1", "to": "dropped" },
                            { "subscription": "sub_fixture_pending", "to": "dropped" }
                        ],
                        "actions": []
                    }
                }
            ],
            "given": {
                "connection": { "state": "attached" },
                "subscriptions": [
                    {
                        "id": "sub_fixture_1",
                        "state": "live",
                        "version": 41,
                        "rows": [{ "_id": "todo_1", "title": "held row" }]
                    },
                    { "id": "sub_fixture_pending", "state": "pending" }
                ]
            },
            "expect": {
                "transitions": [
                    { "connection": "state", "to": "recovering" },
                    { "connection": "all_subscriptions", "to": "dropped" }
                ],
                "actions": ["attempt_reconnect", "resubscribe_all"],
                "supersession": {
                    "sub_fixture_1": "fresh_subscribe_with_supersedes",
                    "sub_fixture_pending": "fresh_subscribe_without_supersession_assumption"
                }
            },
            "notes": "T-LOSS + T-RECONNECT (D3 fact 2): socket loss drops the connection's durable subscriptions server-side, including one whose subscribe was still in flight — the ambiguous in-flight outcome resolves to DROPPED and is never assumed established. Recovery is bounded-backoff reconnect then fresh subscribe: with `supersedes` (and the mandatory superseded/supersessionRefusal response witness) for the established id, and a plain fresh subscribe for the never-established one."
        },
        {
            "name": "grant.connection_token_invalid_reopens_everything",
            "family": null,
            "lane": "core",
            "tuples": ["poll/local", "live/local", "live/hosted"],
            "direction": "client_to_server",
            "schemaValid": false,
            "request": {
                "method": "GET",
                "route": "/outbox/{connection_id}",
                "headers": { "x-snapback-connection-token": "sct_fixture_reaped_1" }
            },
            "refusal": {
                "status": 403,
                "code": "SNAPBACK_CONNECTION_TOKEN_INVALID"
            },
            "given": {
                "connection": { "state": "attached" },
                "subscriptions": [
                    { "id": "sub_fixture_1", "state": "live", "version": 42 },
                    { "id": "sub_fixture_2", "state": "live", "version": 7 }
                ]
            },
            "expect": {
                "transitions": [
                    { "connection": "state", "to": "grant_lost" },
                    { "connection": "all_subscriptions", "to": "resync_pending" }
                ],
                "actions": ["reopen_connection", "resubscribe_all", "clear_retained_overlays"],
                "forbiddenActions": ["retry_unchanged"]
            },
            "notes": "T-GRANT-LOSS (LLP 0095 §1.4/§4.4): SNAPBACK_CONNECTION_TOKEN_INVALID covers both the local idle reap and hosted grant expiry — the client cannot distinguish them at the refusal, and the recovery is identical: re-open the connection (a fresh grant is a fresh connection identity) and re-establish EVERY subscription, treating retained overlays as void. Grant-refresh-only recovery would resurrect the fake-healthy-handle defect class."
        },
        {
            "name": "poll.wrapped_live_delta.unwrap",
            "family": "realtime.envelope.schema.json",
            "lane": "poll",
            "tuples": ["poll/local"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": wrapped_delta,
            "given": { "subscription": { "id": "sub_fixture_1", "state": "live", "version": 41 } },
            "expect": {
                "transitions": [{ "subscription": "sub_fixture_1", "to": "live", "version": 42 }],
                "actions": ["unwrap_durable", "apply_delta_by_id"]
            },
            "notes": "Wrapped/unwrapped parity: the exact live_delta envelope of durable.live_delta.apply_by_id in Lane-P framing. Unwrapping is a lane obligation; the inner judgment is identical to the core fixture."
        },
        {
            "name": "poll.wrapped_resync_required.subscription_scoped",
            "family": "realtime.envelope.schema.json",
            "lane": "poll",
            "tuples": ["poll/local"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": wrapped_resync_subscription,
            "given": { "subscription": { "id": "sub_fixture_1", "state": "live", "version": 42 } },
            "expect": {
                "transitions": [{ "subscription": "sub_fixture_1", "to": "resync_pending" }],
                "actions": ["unwrap_durable", "resubscribe_subscription"]
            },
            "notes": "Wrapped/unwrapped parity for durable.resync_required.subscription_scoped: reason strings stay an open set and the transition is reason-independent in either framing."
        },
        {
            "name": "poll.wrapped_resync_required.connection_wide_clear_retained",
            "family": "realtime.envelope.schema.json",
            "lane": "poll",
            "tuples": ["poll/local"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": wrapped_resync_connection_wide,
            "given": {
                "connection": { "state": "attached" },
                "subscriptions": [
                    { "id": "sub_fixture_1", "state": "live", "version": 42 },
                    { "id": "sub_fixture_2", "state": "live", "version": 7 }
                ]
            },
            "expect": {
                "transitions": [{ "connection": "all_subscriptions", "to": "resync_pending" }],
                "actions": ["unwrap_durable", "resubscribe_all", "clear_retained_overlays"]
            },
            "notes": "Wrapped/unwrapped parity for durable.resync_required.connection_wide_clear_retained: the cross-lane clear-retained rule (LLP 0059) is framing-independent — retained ephemeral overlays blank in Lane-P framing too."
        },
        {
            "name": "poll.wrapped_current_as_of.adopts_token_without_rows",
            "family": "realtime.envelope.schema.json",
            "lane": "poll",
            "tuples": ["poll/local"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": wrapped_current_as_of,
            "given": {
                "subscription": {
                    "id": "sub_fixture_1",
                    "state": "live",
                    "version": 42,
                    "rows": [{ "_id": "todo_1", "title": "held row" }]
                }
            },
            "expect": {
                "transitions": [{ "subscription": "sub_fixture_1", "to": "live", "version": 43 }],
                "actions": ["unwrap_durable", "adopt_resume_token"],
                "rows": "unchanged"
            },
            "notes": "Wrapped/unwrapped parity for durable.current_as_of.adopts_token_without_rows: adopt the mandatory fresh token and advance the version without touching held rows, in Lane-P framing."
        },
        {
            "name": "timing.heartbeat.ping_and_pong_freshness",
            "family": "live.socket-server.schema.json",
            "lane": "live",
            "tuples": ["live/local", "live/hosted"],
            "direction": "server_to_client",
            "clock": "virtual",
            "schemaValid": true,
            "steps": [
                {
                    "advanceVirtualTimeMs": 5000,
                    "expect": { "transitions": [], "actions": ["send_ping"] }
                },
                {
                    "frame": pong,
                    "expect": { "transitions": [], "actions": [] }
                },
                {
                    "advanceVirtualTimeMs": 9999,
                    "expect": { "transitions": [], "actions": ["send_ping"] }
                }
            ],
            "given": {
                "connection": { "state": "attached", "lastServerActivityVirtualMs": 0 },
                "subscriptions": [
                    { "id": "sub_fixture_1", "state": "live", "version": 42 }
                ]
            },
            "expect": {
                "transitions": [],
                "actions": ["send_ping"]
            },
            "notes": "T-HB (LLP 0095 §1.4; LLP 0034 D0/D1): 5 s heartbeat ping, 15 s freshness budget. The advance to t=5000 obligates a liveness probe; the pong refreshes the freshness budget, so the further advance to t=14999 obligates more pings (send_ping repeats within an interval under the rule-4 set judgment) but never the loss path — the budget from the last server activity is not exhausted."
        },
        {
            "name": "timing.freshness.budget_exhausted_forces_loss",
            "family": null,
            "lane": "live",
            "tuples": ["live/local", "live/hosted"],
            "direction": "client_lifecycle",
            "clock": "virtual",
            "schemaValid": false,
            "steps": [
                {
                    "advanceVirtualTimeMs": 15001,
                    "expect": {
                        "transitions": [
                            { "connection": "state", "to": "recovering" },
                            { "connection": "all_subscriptions", "to": "dropped" }
                        ],
                        "actions": ["send_ping", "force_socket_loss"]
                    }
                }
            ],
            "given": {
                "connection": { "state": "attached", "lastServerActivityVirtualMs": 0 },
                "subscriptions": [
                    { "id": "sub_fixture_1", "state": "live", "version": 42 },
                    { "id": "sub_fixture_2", "state": "live", "version": 7 }
                ]
            },
            "expect": {
                "transitions": [
                    { "connection": "state", "to": "recovering" },
                    { "connection": "all_subscriptions", "to": "dropped" }
                ],
                "actions": ["send_ping", "force_socket_loss"]
            },
            "notes": "T-HB's loss half (LLP 0095 §1.4; LLP 0034 D0/D1): no server activity for the whole 15 s freshness budget while the socket still claims open forces the loss path — the client declares the socket lost (force_socket_loss) rather than trusting a silent TCP session, and every durable subscription drops per T-LOSS. Pings during the interval repeat under the rule-4 set judgment."
        },
        {
            "name": "timing.reconnect.backoff_bounds",
            "family": null,
            "lane": "live",
            "tuples": ["live/local", "live/hosted"],
            "direction": "client_lifecycle",
            "clock": "virtual",
            "schemaValid": false,
            "steps": [
                {
                    "advanceVirtualTimeMs": 249,
                    "expect": {
                        "transitions": [],
                        "actions": [],
                        "forbiddenActions": ["attempt_reconnect"]
                    }
                },
                {
                    "advanceVirtualTimeMs": 59751,
                    "expect": {
                        "transitions": [],
                        "actions": ["attempt_reconnect"],
                        "pacing": { "action": "attempt_reconnect", "maxIntervalMs": 10000 }
                    }
                }
            ],
            "given": {
                "connection": { "state": "recovering", "socketLostAtVirtualMs": 0 },
                "subscriptions": [
                    { "id": "sub_fixture_1", "state": "dropped", "version": 42 }
                ]
            },
            "expect": {
                "transitions": [],
                "actions": ["attempt_reconnect"]
            },
            "notes": "T-LOSS backoff (LLP 0095 §1.4; LLP 0034 D0/D1): bounded backoff 250 ms → 10 s. No reconnect attempt may fire before 250 ms after the loss; thereafter attempts repeat with growing delays capped at 10 s, so over the second interval consecutive attempts are never more than pacing.maxIntervalMs apart. Each successful attempt is T-RECONNECT's fresh subscribe with supersedes — not judged here, since a fixture carries no live server."
        },
    ]);

    // ---- Format-v3 P-3 extensions: the LLP 0096 auth-profile fixture
    // classes. Every profile fixture is a local-arm tuple (LLP 0096 §2.6 —
    // no hosted sessions surface exists; gate-enforced in
    // tests/wire_fixtures_v1.rs). `auth/sender` is deliberately absent
    // until the off-browser custody story exists (LLP 0096 §5): the corpus
    // must not encode browser-custody obligations as if they bound native
    // clients.
    // @ref LLP 0096#2-per-profile-contract — carriers, refusal codes, and
    //   the conformance obligations each profile claim takes on.
    let p3_extensions = json!([
        {
            "name": "auth.rr.offer_refusal_surfaced",
            "family": "query.input.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local"],
            "profiles": ["auth/rr"],
            "direction": "client_to_server",
            "schemaValid": true,
            "steps": [
                {
                    "request": {
                        "method": "POST",
                        "route": "/query/listTodos",
                        "headers": { "x-snapback-auth-client-protocol": "1" },
                        "body": { "args": {} }
                    },
                    "refusal": {
                        "status": 503,
                        "code": "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                        "details": { "capability": "onlineRequestResponse" }
                    },
                    "expect": {
                        "transitions": [],
                        "actions": ["surface_capability_diagnostic"]
                    }
                },
                {
                    "request": {
                        "method": "POST",
                        "route": "/query/listTodos",
                        "headers": {},
                        "body": { "args": {} }
                    },
                    "refusal": {
                        "status": 400,
                        "code": "SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED",
                        "details": {
                            "capability": "onlineRequestResponse",
                            "minimumAuthClientProtocol": 1
                        }
                    },
                    "expect": {
                        "transitions": [],
                        "actions": ["surface_capability_diagnostic"],
                        "forbiddenActions": ["retry_unchanged"]
                    }
                },
                {
                    "request": {
                        "method": "POST",
                        "route": "/query/listTodos",
                        "headers": { "x-snapback-auth-client-protocol": "2" },
                        "body": { "args": {} }
                    },
                    "refusal": {
                        "status": 400,
                        "code": "SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED",
                        "details": {
                            "capability": "onlineRequestResponse",
                            "minimumAuthClientProtocol": 1
                        }
                    },
                    "expect": {
                        "transitions": [],
                        "actions": ["surface_capability_diagnostic"],
                        "forbiddenActions": ["retry_unchanged"]
                    }
                }
            ],
            "given": { "authMode": "sessions" },
            "expect": {
                "transitions": [],
                "actions": ["surface_capability_diagnostic"]
            },
            "notes": "LLP 0096 §2.1: per-request gating for auth/rr. Step 1 is the readiness refusal (503 — a structured capability diagnostic; bounded readiness backoff is permitted, a retry storm is not). Steps 2-3 are the malformed-offer negatives: a missing offer and an unknown integer both refuse 400 non-retryably — an unknown integer is no valid offer, never silent degradation, and a malformed header never falls through to the subprotocol carrier."
        },
        {
            "name": "auth.live.subscribe_missing_invalidation_offer_refused",
            "family": "live.subscribe.input.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local"],
            "profiles": ["auth/live"],
            "direction": "client_to_server",
            "schemaValid": true,
            "request": {
                "method": "POST",
                "route": "/live/listTodos/subscribe",
                "headers": { "x-snapback-auth-client-protocol": "1" },
                "body": {
                    "connection_id": "conn_fixture_1",
                    "authorizationNamespace": {
                        "clientStoreId": "store-fixture",
                        "queryKey": "listTodos:{}",
                        "queryInstanceId": 1
                    },
                    "input": { "args": {} }
                }
            },
            "refusal": {
                "status": 400,
                "code": "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
                "details": {
                    "capability": "authScopedLive",
                    "minimumAuthInvalidationProtocol": 1
                }
            },
            "given": { "authMode": "sessions", "connection": { "state": "granted" } },
            "expect": {
                "transitions": [],
                "actions": ["surface_capability_diagnostic"],
                "forbiddenActions": ["retry_unchanged"]
            },
            "notes": "LLP 0096 §2.2 carrier 2 (the live-lifecycle half): every sessions-mode subscribe/unsubscribe repeats `x-snapback-auth-invalidation-protocol: 1`. Authority independence is a compiled server fact not projected to clients, so always offering is the conformant rule; a missing offer refuses non-retryably."
        },
        {
            "name": "auth.live.ack_requires_negotiated_connection",
            "family": "authorization-invalidation.ack.input.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local"],
            "profiles": ["auth/live"],
            "direction": "client_to_server",
            "schemaValid": true,
            "request": {
                "method": "POST",
                "route": "/live/authorization-invalidation/acknowledge",
                "headers": { "x-snapback-auth-invalidation-protocol": "1" },
                "body": {
                    "connectionId": "conn_fixture_legacy_1",
                    "ackToken": "ack_fixture_unnegotiated_1"
                }
            },
            "refusal": {
                "status": 400,
                "code": "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED"
            },
            "given": {
                "connection": { "state": "attached", "authInvalidationNegotiated": false },
                "subscriptions": [
                    { "id": "sub_fixture_1", "state": "resync_pending", "version": 42 }
                ]
            },
            "expect": {
                "transitions": [],
                "actions": ["surface_capability_diagnostic", "reopen_connection"],
                "forbiddenActions": ["retry_unchanged"]
            },
            "notes": "LLP 0096 §2.2: the acknowledge routes consult the OPEN-TIME binding — a connection opened without `authInvalidationProtocol: 1` is legacy, and the per-request header cannot substitute for the missing open-time half. Unchanged retry cannot succeed; the obligation stays held (level-triggered) and discharge requires re-opening a correctly negotiated connection and re-establishing the subscription."
        },
        {
            "name": "auth.live.ack_needs_no_descriptor_offer",
            "family": "authorization-invalidation.ack.input.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local"],
            "profiles": ["auth/live"],
            "direction": "client_to_server",
            "schemaValid": true,
            "request": {
                "method": "POST",
                "route": "/live/authorization-invalidation/acknowledge",
                "headers": { "x-snapback-auth-invalidation-protocol": "1" },
                "body": {
                    "connectionId": "conn_fixture_1",
                    "ackToken": "ack_fixture_1"
                }
            },
            "response": { "status": 200 },
            "given": {
                "connection": { "state": "attached", "authInvalidationNegotiated": true },
                "subscriptions": [
                    { "id": "sub_fixture_1", "state": "live", "version": 43 }
                ]
            },
            "expect": {
                "transitions": [],
                "actions": []
            },
            "notes": "Descriptor independence, ratified 2026-07-25 (LLP 0096 §2.2/§8.1; issues/closed/20260725-0093-p3-invalidation-ack-descriptor-coupling.md): the invalidation-ack routes classify InvocationSource::InvalidationAcknowledgement, outside the queued-replay fence — a client claiming only auth/live discharges obligations without ever sending `x-snapback-authority-descriptor-protocol`. A descriptor offer sent anyway is ignored, not required."
        },
        {
            "name": "auth.live.terminal_auth_carrier_disposition",
            "family": "live.socket-server.schema.json",
            "lane": "live",
            "tuples": ["live/local"],
            "profiles": ["auth/live"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": auth_error_carrier,
            "given": {
                "authorizationExpectation": authorization_expectation_epoch_1,
                "connection": { "state": "attached" },
                "subscriptions": [{
                    "id": "sub_fixture_1",
                    "state": "live",
                    "version": 42,
                    "authorizationScope": held_authorization_scope,
                    "authorizationNamespace": held_authorization_namespace,
                    "acceptedAuthorization": {
                        "incarnation": "0198c7aa-1234-7000-8000-000000000001",
                        "epoch": 1
                    }
                }]
            },
            "expect": {
                "transitions": [{ "connection": "state", "to": "terminal_auth" }],
                "actions": ["surface_terminal_auth"],
                "forbiddenActions": ["attempt_reconnect"]
            },
            "notes": "T-AUTH-TERM (LLP 0095 §1.4; LLP 0059's typed terminal closure): auth_error / close 4401 is terminal, never reconnectable with the presented credential. `authorityDisposition: carrier` means only the presented carrier ended — the client may obtain a fresh credential and open a fresh connection, and local durable authority state is retained."
        },
        {
            "name": "auth.live.terminal_auth_durable_delete_disposition",
            "family": "live.socket-server.schema.json",
            "lane": "live",
            "tuples": ["live/local"],
            "profiles": ["auth/live"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": auth_error_durable_delete,
            "given": {
                "authorizationExpectation": authorization_expectation_epoch_1,
                "connection": { "state": "attached" },
                "subscriptions": [{
                    "id": "sub_fixture_1",
                    "state": "live",
                    "version": 42,
                    "authorizationScope": held_authorization_scope,
                    "authorizationNamespace": held_authorization_namespace,
                    "acceptedAuthorization": {
                        "incarnation": "0198c7aa-1234-7000-8000-000000000001",
                        "epoch": 1
                    }
                }]
            },
            "expect": {
                "transitions": [{ "connection": "state", "to": "terminal_auth" }],
                "actions": ["surface_terminal_auth", "delete_local_durable_authority"],
                "forbiddenActions": ["attempt_reconnect"]
            },
            "notes": "T-AUTH-TERM's durable half: `authorityDisposition: durableDelete` reflects a durable authority deletion, not mere carrier loss — the client must additionally delete local durable authority state (crates/snapback-types/src/live_wire.rs LiveAuthorityDisposition doc). The disposition distinction is the whole reason this frame is not just a close code."
        },
        {
            "name": "auth.replay.descriptor_offer_required",
            "family": "mutation.input.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local"],
            "profiles": ["auth/replay"],
            "direction": "client_to_server",
            "schemaValid": true,
            "steps": [
                {
                    "request": {
                        "method": "POST",
                        "route": "/mutation/addTodo",
                        "headers": { "x-snapback-auth-client-protocol": "1" },
                        "body": {
                            "args": { "title": "fixture todo" },
                            "clientMutationId": "cmid_fixture_1"
                        }
                    },
                    "refusal": {
                        "status": 400,
                        "code": "SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED",
                        "details": {
                            "capability": "queuedReplay",
                            "minimumAuthorityDescriptorProtocol": 1
                        }
                    },
                    "expect": {
                        "transitions": [],
                        "actions": ["surface_capability_diagnostic"],
                        "forbiddenActions": ["retry_unchanged"]
                    }
                },
                {
                    "family": "client-mutation.ack.input.schema.json",
                    "request": {
                        "method": "POST",
                        "route": "/client-mutations/acknowledge",
                        "headers": { "x-snapback-auth-client-protocol": "1" },
                        "body": {
                            "auth": {},
                            "clientMutationIds": ["cmid_fixture_1"]
                        }
                    },
                    "refusal": {
                        "status": 400,
                        "code": "SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED",
                        "details": {
                            "capability": "queuedReplay",
                            "minimumAuthorityDescriptorProtocol": 1
                        }
                    },
                    "expect": {
                        "transitions": [],
                        "actions": ["surface_capability_diagnostic"],
                        "forbiddenActions": ["retry_unchanged"]
                    }
                }
            ],
            "given": { "authMode": "sessions" },
            "expect": {
                "transitions": [],
                "actions": ["surface_capability_diagnostic"]
            },
            "notes": "LLP 0096 §2.3: the descriptor gate binds exactly the replay-requesting surfaces — a mutation body carrying clientMutationId/acknowledgedClientMutationIds and the standalone settlement acknowledgement (InvocationSource::MutationSettlementAcknowledgement, the deliberate half of the §8.1 split). Post-split it does NOT bind the invalidation-ack routes: see auth.live.ack_needs_no_descriptor_offer."
        },
        {
            "name": "auth.replay.duplicate_settlement_idempotent",
            "family": "mutation.input.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local"],
            "profiles": ["auth/replay"],
            "direction": "client_to_server",
            "schemaValid": true,
            "steps": [
                {
                    "request": {
                        "method": "POST",
                        "route": "/mutation/addTodo",
                        "headers": {
                            "x-snapback-auth-client-protocol": "1",
                            "x-snapback-authority-descriptor-protocol": "1"
                        },
                        "body": {
                            "args": { "title": "fixture todo" },
                            "clientMutationId": "cmid_fixture_2"
                        }
                    },
                    "response": { "status": 200 },
                    "expect": {
                        "transitions": [],
                        "actions": ["settle_client_mutation"]
                    }
                },
                {
                    "request": {
                        "method": "POST",
                        "route": "/mutation/addTodo",
                        "headers": {
                            "x-snapback-auth-client-protocol": "1",
                            "x-snapback-authority-descriptor-protocol": "1"
                        },
                        "body": {
                            "args": { "title": "fixture todo" },
                            "clientMutationId": "cmid_fixture_2"
                        }
                    },
                    "response": { "status": 200 },
                    "expect": {
                        "transitions": [],
                        "actions": ["discard_duplicate_settlement"],
                        "forbiddenActions": ["settle_client_mutation"]
                    }
                }
            ],
            "given": { "authMode": "sessions" },
            "expect": {
                "transitions": [],
                "actions": ["settle_client_mutation", "discard_duplicate_settlement"],
                "settlement": { "clientMutationId": "cmid_fixture_2", "appliedOnce": true }
            },
            "notes": "LLP 0043 (via LLP 0096 §2.3): the durable ordered queue redelivers idempotently under the retained clientMutationId — step 2 is the exact same request after a crash/redelivery, and the server settles the retained result rather than re-executing. The client resolves its queue entry exactly once; re-applying the duplicate settlement is non-conformant."
        },
        {
            "name": "auth.replay.predecessor_queue_suspends",
            "family": null,
            "lane": "core",
            "tuples": ["poll/local", "live/local"],
            "profiles": ["auth/replay"],
            "direction": "client_lifecycle",
            "schemaValid": false,
            "steps": [
                {
                    "event": {
                        "kind": "authority_instance_changed",
                        "from": "authinst_fixture_a",
                        "to": "authinst_fixture_b"
                    },
                    "expect": {
                        "transitions": [{ "replayQueue": "authinst_fixture_a", "to": "suspended" }],
                        "actions": ["suspend_predecessor_queue"],
                        "forbiddenActions": ["replay_queued_mutations"]
                    }
                }
            ],
            "given": {
                "replayQueue": {
                    "authorityInstance": "authinst_fixture_a",
                    "pending": [{ "clientMutationId": "cmid_fixture_9" }]
                }
            },
            "expect": {
                "transitions": [{ "replayQueue": "authinst_fixture_a", "to": "suspended" }],
                "actions": ["suspend_predecessor_queue"],
                "forbiddenActions": ["replay_queued_mutations"]
            },
            "notes": "LLP 0064 §4 (via LLP 0096 §2.3): a queue retained under a predecessor authority instance suspends on authority-instance mismatch and is NEVER replayed under successor authority. Resumption requires re-establishing the original authority or explicit user-mediated abandonment — silent replay under the new principal is the defect class this fixture pins out."
        },
        {
            "name": "auth.lease.offer_pair_required",
            "family": "authorized-lease.query.input.schema.json",
            "lane": "core",
            "tuples": ["poll/local", "live/local"],
            "profiles": ["auth/lease"],
            "direction": "client_to_server",
            "schemaValid": true,
            "request": {
                "method": "POST",
                "route": "/query/listTodos/authorized-lease",
                "headers": {
                    "x-snapback-auth-client-protocol": "1",
                    "x-snapback-authorized-lease-protocol": "1"
                },
                "body": {
                    "leaseRequestId": "lease_req_fixture_1",
                    "clientStoreId": "store-fixture",
                    "queryKey": "listTodos:{}",
                    "queryInstanceId": 1,
                    "args": {}
                }
            },
            "refusal": {
                "status": 400,
                "code": "SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED"
            },
            "given": { "authMode": "sessions" },
            "expect": {
                "transitions": [],
                "actions": ["surface_capability_diagnostic"],
                "forbiddenActions": ["retry_unchanged"]
            },
            "notes": "LLP 0096 §1.2/§2.4 declared composition: authorized retained reads require the lease offer AND the invalidation offer together (`RetainedReadAvailability` carries both minima). This request offers only the lease half, so it refuses exactly like an offerless request. Offers ride the decimal headers on the HTTP-only parser (the §8.2 divergence is fixed); readiness failure is the separate 503 SNAPBACK_AUTH_POLICY_UNAVAILABLE."
        },
        {
            "name": "auth.lease.expiry_fences_retained_rows",
            "family": null,
            "lane": "core",
            "tuples": ["poll/local", "live/local"],
            "profiles": ["auth/lease"],
            "direction": "client_lifecycle",
            "clock": "virtual",
            "schemaValid": false,
            "steps": [
                {
                    "advanceVirtualTimeMs": 59999,
                    "expect": { "transitions": [], "actions": [] }
                },
                {
                    "advanceVirtualTimeMs": 2,
                    "expect": {
                        "transitions": [{ "retainedRead": "listTodos:{}", "to": "fenced" }],
                        "actions": ["fence_retained_rows"]
                    }
                }
            ],
            "given": {
                "virtualNowServerMs": 0,
                "retainedRead": {
                    "queryKey": "listTodos:{}",
                    "queryInstanceId": 1,
                    "rows": [{ "_id": "todo_1", "title": "retained row" }],
                    "lease": { "authorizedLeaseProtocol": 1, "expiresAtServerMs": 60000 }
                }
            },
            "expect": {
                "transitions": [{ "retainedRead": "listTodos:{}", "to": "fenced" }],
                "actions": ["fence_retained_rows"]
            },
            "notes": "LLP 0059's transition table owns the semantics (cited, not restated): retention exists only under a current exact signed lease. At expiry — with NO wire event — the retained material is fenced/deleted; rows must not be readable at any virtual instant past expiresAtServerMs. Retention is never inferred from a matching user id or from being online (the axis-independence rule)."
        },
        {
            "name": "poll.wrapped_authorization_invalidation.apply_then_ack",
            "family": "realtime.envelope.schema.json",
            "lane": "poll",
            "tuples": ["poll/local"],
            "profiles": ["auth/live"],
            "direction": "server_to_client",
            "schemaValid": true,
            "frame": wrapped_authorization_invalidation,
            "given": {
                "authorizationExpectation": authorization_expectation_epoch_1,
                "subscriptions": [
                    {
                        "id": "sub_fixture_1",
                        "state": "live",
                        "version": 42,
                        "authorizationScope": held_authorization_scope,
                        "authorizationNamespace": held_authorization_namespace,
                        "acceptedAuthorization": {
                            "incarnation": "0198c7aa-1234-7000-8000-000000000001",
                            "epoch": 1
                        },
                        "rows": [{ "_id": "todo_1", "title": "pre-invalidation row" }]
                    }
                ]
            },
            "expect": {
                "transitions": [{ "subscription": "sub_fixture_1", "to": "live", "version": 43 }],
                "actions": [
                    "unwrap_durable",
                    "quarantine_rows",
                    "apply_invalidation_snapshot",
                    "acknowledge_obligation"
                ],
                "orderedActions": [
                    "unwrap_durable",
                    "quarantine_rows",
                    "apply_invalidation_snapshot",
                    "acknowledge_obligation"
                ],
                "acknowledgeAfter": "apply_invalidation_snapshot"
            },
            "notes": "Wrapped/unwrapped parity for the authorization_invalidation family: the byte-exact envelope of auth.live.invalidation_snapshot_apply_then_ack step 1 in Lane-P framing. Unwrapping precedes the T-AUTH-INVALIDATION judgment, which is framing-independent — quarantine, atomic apply, then release the exact ackToken."
        },
    ]);

    let mut fixtures = seeded
        .as_array()
        .expect("seeded fixtures are an array")
        .clone();
    fixtures.extend(
        p1_extensions
            .as_array()
            .expect("P-1 extension fixtures are an array")
            .iter()
            .cloned(),
    );
    fixtures.extend(
        p3_extensions
            .as_array()
            .expect("P-3 extension fixtures are an array")
            .iter()
            .cloned(),
    );

    json!({
        "artifactKind": "liveWireFixtureCorpus",
        "formatVersion": WIRE_FIXTURES_FORMAT_VERSION,
        "wireVersion": "snapback.v1",
        "judgedAgainst": "LLP 0095 §1 (abstract client state machine)",
        "coverage": "format-v3 — all five committed LiveEnvelope kinds with wrapped/unwrapped parity, the optional socket network-profile marker, replace-to-delta `_id` continuity, auth/live apply-before-ack, exact scope/expectation binding, equal-data-version authorization replacement, pending high-water, terminal delete and no-resurrection, resolution floor/shape rejection, quarantine, exact duplicate re-ACK, durable_bytes and its poll-lane analogue, connection-wide resync, tolerance negatives, negotiation/offer refusals (client_to_server), drain-cancel duplicate tolerance, arm-mismatch and grant-loss recovery, virtual-time heartbeat/freshness/backoff, and the LLP 0096 auth-profile classes (auth/rr, auth/live incl. terminal dispositions, auth/replay incl. the post-split descriptor fence, auth/lease; auth/sender deliberately deferred per LLP 0096 §5)",
        "fixtures": fixtures,
    })
}
