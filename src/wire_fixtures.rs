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

use crate::ephemeral::{DurableMessage, RealtimeEnvelope};
use crate::live_wire::{LiveDeltaOpKind, LiveDeltaWireOp, LiveEnvelope, LiveSocketServerFrame};

/// Corpus format version — the shape of the corpus file itself, not the wire
/// version (which every fixture pins as `snapback.v1`).
pub const WIRE_FIXTURES_FORMAT_VERSION: u32 = 1;

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
        rows: vec![json!({ "id": "todo_1", "title": "current row" })],
        resume: None,
    }
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
                row: Some(json!({ "id": "todo_2", "title": "added row" })),
            },
            LiveDeltaWireOp {
                op: LiveDeltaOpKind::Update,
                id: "todo_1".to_owned(),
                row: Some(json!({ "id": "todo_1", "title": "updated row" })),
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
            "given": { "connection": { "state": "attached" } },
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
            "given": { "connection": { "state": "attached" } },
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
            "given": { "connection": { "state": "attached" } },
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
            "given": { "connection": { "state": "attached" } },
            "expect": {
                "transitions": [{ "connection": "all_subscriptions", "to": "resync_pending" }],
                "actions": [
                    "deliver_batch_remainder",
                    "surface_decode_diagnostic",
                    "resubscribe_all",
                    "clear_retained_overlays"
                ]
            },
            "notes": "The poll-lane analogue of fact 2b (LLP 0095 §1.4 T-DB-P): after the ownership cut the malformed item is lost exactly like a durable_bytes payload, so it forces the same connection-wide resync class — and must never abort the remainder of the acknowledged batch."
        },
    ]);

    json!({
        "artifactKind": "liveWireFixtureCorpus",
        "formatVersion": WIRE_FIXTURES_FORMAT_VERSION,
        "wireVersion": "snapback.v1",
        "judgedAgainst": "LLP 0095 §1 (abstract client state machine)",
        "coverage": "seed — the durable-envelope families, durable_bytes, connection-wide resync, wrapper framing, and first negatives; the remaining LLP 0093 negative-fixture inventory is tracked by issues/20260725-0093-p1-fixture-corpus-coverage.md",
        "fixtures": fixtures,
    })
}
