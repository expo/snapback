//! The LLP 0093 P-1 conformance fixture corpus (LLP 0095).
//!
//! Canonical frames in, expected client transitions/actions out, judged
//! against the abstract client state machine of LLP 0095 §1 — never against
//! any one implementation's internals. The corpus is emitted through
//! [`crate::schema_export::artifact_instances`] (the least-drift path LLP
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
    AuthorizationInvalidationSnapshot, LiveDeltaOpKind, LiveDeltaWireOp, LiveEnvelope,
    LiveSocketServerFrame, ResumeMeta, ResumeWire,
};
use crate::storage::AuthorizationVersion;

/// Corpus format version — the shape of the corpus file itself, not the wire
/// version (which every fixture pins as `snapback.v1`).
pub const WIRE_FIXTURES_FORMAT_VERSION: u32 = 2;

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
        subscription_id: "sub_fixture_1".to_owned(),
        function: "listTodos".to_owned(),
        version: 41,
        rows: vec![json!({ "_id": "todo_1", "title": "current row" })],
        resume: None,
    }
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

    let delta = wire(&LiveEnvelope::LiveDelta {
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
        resume: None,
    });

    let resync_subscription = wire(&LiveEnvelope::ResyncRequired {
        reason: "live_refresh_failed".to_owned(),
        subscription_id: Some("sub_fixture_1".to_owned()),
        scope: None,
        epoch: None,
        clear_retained: false,
    });

    let resync_connection_wide = wire(&LiveEnvelope::ResyncRequired {
        reason: "outbox_overflow".to_owned(),
        subscription_id: None,
        scope: None,
        epoch: None,
        clear_retained: true,
    });

    let durable_bytes = wire(&LiveSocketServerFrame::DurableBytes {
        payload: vec![0xff, 0xfe],
    });
    let current_as_of = wire(&LiveEnvelope::CurrentAsOf {
        subscription_id: "sub_fixture_1".to_owned(),
        function: "listTodos".to_owned(),
        version: 43,
        resume: resume_wire(43),
    });
    let authorization_invalidation = wire(&invalidation_envelope(
        "sub_fixture_1",
        43,
        1,
        InvalidationDisposition::Quarantine,
        Some((ResolutionKind::Snapshot, "ack_fixture_1")),
        Some("authorized row"),
    ));
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
        Some((
            ResolutionKind::Snapshot,
            "ack_fixture_same_version_1",
        )),
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

    // Lane-P framing: the SAME durable envelope, wrapped in the drain's
    // `{"Durable":{"payload":[u8…]}}` form (the wrapper asymmetry of
    // src/live_wire.rs — wrapped over HTTP, unwrapped over the socket).
    let wrapped_replace = wire(&RealtimeEnvelope::Durable(DurableMessage::new(
        serde_json::to_vec(&replace_envelope()).expect("envelope serializes"),
    )));
    // A wrapper whose payload bytes are NOT decodable JSON. Valid at the
    // wrapper layer (family realtime.envelope) — the loss happens at the
    // inner decode, after the ownership cut has already consumed the batch.
    let wrapped_malformed = wire(&RealtimeEnvelope::Durable(DurableMessage::new(vec![
        0xff, 0xfe, 0x00,
    ])));

    let fixtures = json!([
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

    json!({
        "artifactKind": "liveWireFixtureCorpus",
        "formatVersion": WIRE_FIXTURES_FORMAT_VERSION,
        "wireVersion": "snapback.v1",
        "judgedAgainst": "LLP 0095 §1 (abstract client state machine)",
        "coverage": "format-v2 seed — all five committed LiveEnvelope kinds, replace-to-delta `_id` continuity, auth/live apply-before-ack, exact scope/expectation binding, equal-data-version authorization replacement, pending high-water, terminal delete and no-resurrection, resolution floor/shape rejection, quarantine, and exact duplicate re-ACK, durable_bytes, connection-wide resync, wrapper framing, and first negatives; remaining malformed-offer, cancelled-drain, arm-mismatch, grant-loss, and virtual-time coverage is tracked by issues/20260725-0093-p1-fixture-corpus-coverage.md",
        "fixtures": fixtures,
    })
}
