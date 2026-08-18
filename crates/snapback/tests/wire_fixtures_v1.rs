//! LLP 0095 §2-§3: the conformance fixture corpus is committed, drift-gated
//! (`tests/artifact_schemas_v0.rs` walks `artifact_instances()`, which now
//! emits it), and internally honest — every fixture's `schemaValid` claim is
//! proven here against the committed family schema, so the corpus can never
//! teach an implementer an emission claim the schemas contradict.
//!
//! The acceptance grammar (what a client must DO with each frame) is the
//! `expect` member, judged against the LLP 0095 §1 abstract state machine by
//! per-client conformance harnesses — deliberately not re-judged here.
//!
//! @ref LLP 0095#3-fixture-emission-mechanics-closes-llp-0093-oq3 — emission
//!   rides artifact_instances(); this test is the schemaValid honesty gate.

use serde_json::Value;
use std::fs;
use std::path::PathBuf;

use snapback::wire_fixtures::{
    DURABLE_BYTES_RESYNC_REASON, WIRE_FIXTURES_FILE, WIRE_FIXTURES_FORMAT_VERSION,
    wire_fixture_corpus,
};

fn committed(file: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("schemas")
        .join(file);
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("{file} is missing; regenerate with snapback-schemagen"));
    serde_json::from_str(&text).unwrap_or_else(|error| panic!("parse committed {file}: {error}"))
}

fn fixtures() -> Vec<Value> {
    let corpus = wire_fixture_corpus();
    assert_eq!(
        corpus["formatVersion"],
        Value::from(WIRE_FIXTURES_FORMAT_VERSION)
    );
    assert_eq!(corpus["wireVersion"], Value::from("snapback.v1"));
    assert_eq!(
        committed(WIRE_FIXTURES_FILE)["artifactKind"],
        Value::from("liveWireFixtureCorpus"),
        "the committed corpus file is missing or mislabeled"
    );
    corpus["fixtures"]
        .as_array()
        .expect("corpus has a fixtures array")
        .clone()
}

/// A request-carrying container (a `client_to_server` fixture or one of its
/// steps): checks the v3 request/refusal shape and returns the body to
/// validate, when one is present.
fn checked_request_body<'a>(name: &str, container: &'a Value) -> Option<&'a Value> {
    let request = &container["request"];
    assert!(
        request["route"].is_string() && request["method"].is_string(),
        "{name}: a client_to_server unit pins method and route"
    );
    let refusal = &container["refusal"];
    let response = &container["response"];
    assert!(
        refusal.is_object() ^ response.is_object(),
        "{name}: a client_to_server unit pins exactly one of refusal/response"
    );
    if refusal.is_object() {
        assert!(
            refusal["status"].is_u64(),
            "{name}: refusal pins an HTTP status"
        );
        let code = refusal["code"]
            .as_str()
            .unwrap_or_else(|| panic!("{name}: refusal pins a code"));
        assert!(
            code.starts_with("SNAPBACK_"),
            "{name}: refusal code {code} is not a SNAPBACK_* code"
        );
    } else {
        assert!(
            response["status"].is_u64(),
            "{name}: response pins an HTTP status"
        );
    }
    let body = &request["body"];
    body.is_object().then_some(body)
}

/// Every fixture's `schemaValid` claim agrees with the committed family
/// schema — for `server_to_client` fixtures the frames, for
/// `client_to_server` fixtures the request bodies. Family-less
/// frame-carrying fixtures (unknown-kind negatives) must claim invalid and
/// be unknown to both live-wire families.
#[test]
fn fixture_schema_valid_claims_are_proven_against_committed_schemas() {
    for fixture in fixtures() {
        let name = fixture["name"].as_str().expect("fixture has a name");
        let claim = fixture["schemaValid"]
            .as_bool()
            .unwrap_or_else(|| panic!("{name}: fixture has a schemaValid bool"));
        let direction = fixture["direction"]
            .as_str()
            .unwrap_or_else(|| panic!("{name}: fixture pins a direction"));
        assert!(
            ["server_to_client", "client_to_server", "client_lifecycle"].contains(&direction),
            "{name}: unknown direction {direction}"
        );
        // Validation units: (value, per-step family override). Frames for
        // server_to_client, request bodies for client_to_server.
        let mut units: Vec<(&Value, Option<&str>)> = Vec::new();
        if let Some(steps) = fixture["steps"].as_array() {
            assert!(!steps.is_empty(), "{name}: steps must not be empty");
            for step in steps {
                let has_frame = step["frame"].is_object() || step["frame"].is_array();
                let has_request = step["request"].is_object();
                let has_advance = step["advanceVirtualTimeMs"].is_u64();
                let has_event = step["event"].is_object();
                assert_eq!(
                    [has_frame, has_request, has_advance, has_event]
                        .iter()
                        .filter(|present| **present)
                        .count(),
                    1,
                    "{name}: every step carries exactly one of frame/request/advanceVirtualTimeMs/event"
                );
                assert!(
                    step["expect"].is_object(),
                    "{name}: every step carries an expect object"
                );
                if has_frame {
                    assert_eq!(
                        direction, "server_to_client",
                        "{name}: frame steps belong to server_to_client fixtures"
                    );
                    units.push((&step["frame"], step["family"].as_str()));
                }
                if has_request {
                    assert_eq!(
                        direction, "client_to_server",
                        "{name}: request steps belong to client_to_server fixtures"
                    );
                    if let Some(body) = checked_request_body(name, step) {
                        units.push((body, step["family"].as_str()));
                    }
                }
                if has_advance {
                    assert_eq!(
                        fixture["clock"], "virtual",
                        "{name}: advance steps require clock: virtual"
                    );
                    assert!(
                        step["advanceVirtualTimeMs"].as_u64().expect("advance ms") > 0,
                        "{name}: virtual-time advances must be positive"
                    );
                }
                if has_event {
                    assert!(
                        step["event"]["kind"].is_string(),
                        "{name}: event steps pin a kind"
                    );
                }
            }
        } else if fixture["request"].is_object() {
            assert_eq!(
                direction, "client_to_server",
                "{name}: request fixtures are client_to_server"
            );
            if let Some(body) = checked_request_body(name, &fixture) {
                units.push((body, None));
            }
        } else {
            let frame = &fixture["frame"];
            assert!(
                frame.is_object() || frame.is_array(),
                "{name}: fixture carries a frame"
            );
            assert_eq!(
                direction, "server_to_client",
                "{name}: single-frame fixtures are server_to_client"
            );
            units.push((frame, None));
        }
        if direction == "client_lifecycle" {
            assert!(
                units.is_empty() && fixture["family"].is_null(),
                "{name}: client_lifecycle fixtures carry no wire frames and no family"
            );
        }
        let fixture_family = fixture["family"].as_str();
        let any_family = fixture_family.is_some()
            || units
                .iter()
                .any(|(_, override_family)| override_family.is_some());
        if any_family {
            for (index, (unit, override_family)) in units.iter().enumerate() {
                let Some(family) = override_family.or(fixture_family) else {
                    panic!("{name}: unit {index} has no family to validate against");
                };
                let schema = committed(family);
                let validator = jsonschema::validator_for(&schema)
                    .unwrap_or_else(|error| panic!("compile {family}: {error}"));
                let valid = validator.is_valid(unit);
                assert_eq!(
                    valid, claim,
                    "{name}: schemaValid claims {claim} but {family} says {valid} for unit {index}"
                );
            }
            // batchContext members share the fixture's family.
            if let Some(batch) = fixture["batchContext"].as_array() {
                let family = fixture_family.expect("batchContext requires a fixture family");
                let schema = committed(family);
                let validator = jsonschema::validator_for(&schema)
                    .unwrap_or_else(|error| panic!("compile {family}: {error}"));
                for (index, member) in batch.iter().enumerate() {
                    assert!(
                        validator.is_valid(member),
                        "{name}: batchContext[{index}] does not validate against {family}"
                    );
                }
            }
        } else {
            assert!(
                !claim,
                "{name}: a fixture without a family cannot claim schemaValid"
            );
            // A family-less frame-carrying negative must really be unknown to
            // BOTH live-wire families (the known-kind/unknown-kind
            // distinction fact 2b turns on). Request/lifecycle fixtures have
            // no frames to check.
            if direction == "server_to_client" {
                for family in [
                    "live.envelope.schema.json",
                    "live.socket-server.schema.json",
                ] {
                    let schema = committed(family);
                    let validator = jsonschema::validator_for(&schema)
                        .unwrap_or_else(|error| panic!("compile {family}: {error}"));
                    for (unit, _) in &units {
                        assert!(
                            !validator.is_valid(unit),
                            "{name}: claimed family-less but validates against {family}"
                        );
                    }
                }
            }
        }
    }
}

/// The seeded behavior classes LLP 0095 names are present, tuple routing
/// never claims `poll/hosted`, and the fact-2b fixture pins its equivalence
/// class with a client-synthesized (never wire-emitted) reason.
#[test]
fn fixture_corpus_covers_the_seeded_classes_and_routes_tuples_correctly() {
    let fixtures = fixtures();
    let names: Vec<&str> = fixtures
        .iter()
        .map(|fixture| fixture["name"].as_str().expect("fixture name"))
        .collect();
    for required in [
        "durable.live_replace.basic",
        "socket.durable.live_replace.network_profile_marker",
        "durable.live_delta.apply_by_id",
        "durable.replace_then_delta.identity_continuity",
        "durable.current_as_of.adopts_token_without_rows",
        "auth.live.invalidation_snapshot_apply_then_ack",
        "auth.live.invalidation_authorization_snapshot_same_data_version",
        "auth.live.invalidation_terminal_delete_apply_then_ack",
        "auth.live.invalidation_terminal_delete_blocks_ordinary_live_reuse",
        "auth.live.invalidation_newer_pending_rejects_older_resolution",
        "auth.live.invalidation_owned_id_mismatched_scope_never_acknowledged",
        "auth.live.invalidation_invalid_resolution_never_acknowledged",
        "auth.live.invalidation_without_snapshot_quarantines",
        "auth.live.foreign_obligation_never_acknowledged",
        "durable.resync_required.connection_wide_clear_retained",
        "socket.durable_bytes.forced_resync",
        "negative.unknown_kind.skipped",
        "poll.wrapped_durable.unwrap",
        "poll.acknowledged_batch.malformed_item_forces_resync",
        // Format-v3 P-1 extensions (issues/closed/20260725-0093-p1-fixture-corpus-coverage.md).
        "negotiation.open.unknown_wire_version_refused",
        "negotiation.open.unknown_auth_invalidation_protocol_refused",
        "negotiation.socket.wire_version_required",
        "negotiation.socket.unknown_wire_version_refused",
        "poll.drain_cancel.redelivered_duplicates_tolerated",
        "arm.hosted_subscribe_requires_socket",
        "arm.live_hosted_drain_declared_empty_blackout",
        "arm.socket_loss_mid_subscribe",
        "grant.connection_token_invalid_reopens_everything",
        "poll.wrapped_live_delta.unwrap",
        "poll.wrapped_resync_required.subscription_scoped",
        "poll.wrapped_resync_required.connection_wide_clear_retained",
        "poll.wrapped_current_as_of.adopts_token_without_rows",
        "timing.heartbeat.ping_and_pong_freshness",
        "timing.freshness.budget_exhausted_forces_loss",
        "timing.reconnect.backoff_bounds",
        // Format-v3 P-3 auth-profile classes (LLP 0096 §8.4;
        // issues/closed/20260725-0093-p3-profile-fixture-classes.md).
        "auth.rr.offer_refusal_surfaced",
        "auth.live.subscribe_missing_invalidation_offer_refused",
        "auth.live.ack_requires_negotiated_connection",
        "auth.live.ack_needs_no_descriptor_offer",
        "auth.live.terminal_auth_carrier_disposition",
        "auth.live.terminal_auth_durable_delete_disposition",
        "auth.replay.descriptor_offer_required",
        "auth.replay.duplicate_settlement_idempotent",
        "auth.replay.predecessor_queue_suspends",
        "auth.lease.offer_pair_required",
        "auth.lease.expiry_fences_retained_rows",
        "poll.wrapped_authorization_invalidation.apply_then_ack",
    ] {
        assert!(
            names.contains(&required),
            "corpus lost seed class {required}"
        );
    }

    let valid_tuples = ["poll/local", "live/local", "live/hosted"];
    for fixture in &fixtures {
        let name = fixture["name"].as_str().expect("fixture name");
        let tuples = fixture["tuples"].as_array().expect("fixture tuples");
        assert!(!tuples.is_empty(), "{name}: fixture binds no tuples");
        for tuple in tuples {
            let tuple = tuple.as_str().expect("tuple is a string");
            assert!(
                valid_tuples.contains(&tuple),
                "{name}: tuple {tuple} is not claimable in v1 (poll/hosted is a named gap)"
            );
        }
        // Wrapper-framing fixtures are lane-assigned, never core (LLP 0093 D2).
        if fixture["lane"] == "poll" {
            assert!(
                !tuples.iter().any(|tuple| tuple == "live/hosted"),
                "{name}: a poll-lane framing fixture cannot bind a live tuple"
            );
        }
        // Every auth-profile fixture is a local-arm tuple: the hosted arm
        // has no sessions surface, so no profile is negotiable there
        // (LLP 0096 §2.6).
        if fixture["profiles"].is_array() {
            assert!(
                tuples
                    .iter()
                    .all(|tuple| tuple == "poll/local" || tuple == "live/local"),
                "{name}: profile fixtures must stay local-arm (LLP 0096 §2.6)"
            );
        }
    }

    let fact_2b = fixtures
        .iter()
        .find(|fixture| fixture["name"] == "socket.durable_bytes.forced_resync")
        .expect("fact-2b fixture present");
    let class = &fact_2b["expect"]["equivalenceClass"];
    let reference = class["reference"].as_str().expect("reference behavior");
    assert!(reference.contains(DURABLE_BYTES_RESYNC_REASON));
    assert!(reference.contains("client-synthesized"));
    assert!(class["permittedEquivalent"].is_string());

    let profiled = fixture(
        &fixtures,
        "socket.durable.live_replace.network_profile_marker",
    );
    assert_eq!(profiled["frame"]["network_profile"], "fixture-slow");
    assert_eq!(
        profiled["tuples"],
        serde_json::json!(["live/local", "live/hosted"])
    );
    assert!(
        fixture(&fixtures, "durable.live_replace.basic")["frame"]
            .get("network_profile")
            .is_none(),
        "the normal fixture remains byte-shape compatible"
    );
}

/// Format v2 removes the arbitrary-population and row-identity ambiguities
/// found by independent clean-room clients.
#[test]
fn format_v2_pins_connection_populations_and_row_identity() {
    let fixtures = fixtures();
    for fixture in &fixtures {
        let name = fixture["name"].as_str().expect("fixture name");
        if fixture["given"]["connection"].is_object() {
            // Populated connection states pin an explicit population. The
            // v3 pre-population states (idle/granted, where no subscription
            // can exist yet) are exempt by construction.
            let state = fixture["given"]["connection"]["state"]
                .as_str()
                .unwrap_or_else(|| panic!("{name}: connection precondition pins a state"));
            if ["attached", "recovering"].contains(&state) {
                let subscriptions = fixture["given"]["subscriptions"]
                    .as_array()
                    .unwrap_or_else(|| panic!("{name}: connection fixture must pin subscriptions"));
                assert!(
                    !subscriptions.is_empty(),
                    "{name}: connection population cannot be vacuous"
                );
            }
        }
    }

    let identity = fixtures
        .iter()
        .find(|fixture| fixture["name"] == "durable.replace_then_delta.identity_continuity")
        .expect("identity-continuity fixture");
    assert_eq!(identity["expect"]["rowIdentity"]["member"], "_id");
    assert_eq!(
        identity["expect"]["rowIdentity"]["finalIds"],
        serde_json::json!(["todo_1", "todo_2"])
    );
    let steps = identity["steps"].as_array().expect("multi-step fixture");
    let replace_row = &steps[0]["frame"]["rows"][0];
    assert_eq!(replace_row["_id"], "todo_1");
    assert!(replace_row.get("id").is_none());
    assert_eq!(steps[1]["frame"]["ops"][1]["id"], "todo_1");

    // Every emitted replacement/delta row in the corpus uses the same
    // system identity member the live matcher uses.
    for fixture in &fixtures {
        let frames: Vec<&Value> = fixture["steps"]
            .as_array()
            .map(|steps| steps.iter().map(|step| &step["frame"]).collect())
            .unwrap_or_else(|| vec![&fixture["frame"]]);
        for frame in frames {
            if frame["kind"] == "live_replace" {
                for row in frame["rows"].as_array().expect("replace rows") {
                    assert!(row["_id"].is_string(), "replacement row lacks _id");
                }
            }
            if frame["kind"] == "live_delta" {
                for op in frame["ops"].as_array().expect("delta ops") {
                    if let Some(row) = op.get("row") {
                        assert_eq!(
                            row["_id"], op["id"],
                            "delta row _id and operation id diverge"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn auth_live_fixtures_pin_apply_delete_before_ack_and_exact_redelivery() {
    let fixtures = fixtures();
    let sequence = fixtures
        .iter()
        .find(|fixture| fixture["name"] == "auth.live.invalidation_snapshot_apply_then_ack")
        .expect("auth/live sequence");
    let ordered = sequence["steps"][0]["expect"]["orderedActions"]
        .as_array()
        .expect("ordered actions");
    assert_eq!(
        ordered,
        &[
            Value::from("quarantine_rows"),
            Value::from("apply_invalidation_snapshot"),
            Value::from("acknowledge_obligation"),
        ]
    );
    assert_eq!(sequence["steps"][1]["expect"]["ackToken"], "ack_fixture_1");

    let same_version = fixtures
        .iter()
        .find(|fixture| {
            fixture["name"] == "auth.live.invalidation_authorization_snapshot_same_data_version"
        })
        .expect("equal-data-version auth/live sequence");
    assert_eq!(
        same_version["given"]["subscriptions"][0]["version"],
        same_version["steps"][0]["frame"]["snapshot"]["version"],
        "a first-seen authorization resolution must cover the equal-data-version case"
    );
    assert_eq!(
        same_version["given"]["subscriptions"][0]["acceptedAuthorization"]["epoch"],
        1
    );
    assert_eq!(
        same_version["given"]["authorizationExpectation"]["authorization"]["epoch"],
        2
    );
    assert_eq!(
        same_version["steps"][0]["frame"]["resolution"]["witness"]["authorization"]["epoch"],
        2
    );
    assert_eq!(
        same_version["steps"][0]["frame"], same_version["steps"][1]["frame"],
        "duplicate re-ACK must repeat the exact frame identity"
    );
    assert_eq!(
        same_version["steps"][1]["expect"]["ackToken"],
        "ack_fixture_same_version_1"
    );

    let terminal = fixtures
        .iter()
        .find(|fixture| fixture["name"] == "auth.live.invalidation_terminal_delete_apply_then_ack")
        .expect("terminal-delete auth/live sequence");
    let terminal_frame = &terminal["steps"][0]["frame"];
    assert_eq!(terminal_frame["resolution"]["kind"], "terminalDelete");
    assert_eq!(terminal_frame["obligation"]["maxDisposition"], "delete");
    assert!(
        terminal_frame.get("snapshot").is_none_or(Value::is_null),
        "terminalDelete must carry no snapshot"
    );
    assert_eq!(
        terminal["steps"][0]["expect"]["orderedActions"],
        serde_json::json!([
            "quarantine_rows",
            "apply_invalidation_terminal_delete",
            "acknowledge_obligation"
        ])
    );
    assert_eq!(
        terminal["steps"][0]["expect"]["transitions"][0],
        serde_json::json!({
            "subscription": "sub_fixture_1",
            "to": "terminal_deleted",
            "rows": "destroyed"
        })
    );
    assert_eq!(
        terminal["steps"][0]["frame"], terminal["steps"][1]["frame"],
        "terminal duplicate re-ACK must repeat the exact frame identity"
    );
    assert_eq!(
        terminal["steps"][1]["expect"]["ackToken"],
        "ack_fixture_terminal_delete_1"
    );

    for fixture in [sequence, same_version, terminal] {
        let frame = &fixture["steps"][0]["frame"];
        let obligation = &frame["obligation"];
        let resolution = &frame["resolution"];
        for field in [
            "protocolVersion",
            "scopeId",
            "revision",
            "witness",
            "maxDisposition",
            "ownerContinuityId",
        ] {
            assert_eq!(
                obligation[field], resolution[field],
                "{}: resolution field {field} must bind the exact obligation",
                fixture["name"]
            );
        }
        assert!(
            resolution["ackToken"].is_string(),
            "{}: exact re-ACK identity requires a token",
            fixture["name"]
        );
    }

    let foreign = fixtures
        .iter()
        .find(|fixture| fixture["name"] == "auth.live.foreign_obligation_never_acknowledged")
        .expect("foreign-scope fixture");
    assert!(
        foreign["expect"]["forbiddenActions"]
            .as_array()
            .expect("forbidden actions")
            .contains(&Value::from("acknowledge_obligation"))
    );
}

#[test]
fn auth_live_adversarial_fixtures_pin_scope_high_water_and_no_resurrection() {
    let fixtures = fixtures();

    for fixture in fixtures.iter().filter(|fixture| {
        // The strict held-scope pinning applies to the frame-carrying
        // invalidation fixtures; client_to_server offer/refusal fixtures pin
        // request/refusal shapes instead.
        fixture["profiles"][0] == "auth/live" && fixture["direction"] == "server_to_client"
    }) {
        let name = fixture["name"].as_str().expect("auth/live fixture name");
        let expectation = &fixture["given"]["authorizationExpectation"];
        assert!(
            expectation["issuerId"].is_object()
                && expectation["connectionGeneration"].is_u64()
                && expectation["authorization"].is_object()
                && expectation["versionStream"].is_string(),
            "{name}: auth/live fixture must pin the full authenticated expectation"
        );
        for subscription in fixture["given"]["subscriptions"]
            .as_array()
            .unwrap_or_else(|| panic!("{name}: auth/live fixture must pin subscriptions"))
        {
            assert!(
                subscription["authorizationScope"].is_object()
                    && subscription["authorizationNamespace"].is_object()
                    && subscription["acceptedAuthorization"].is_object(),
                "{name}: held auth/live subscription must pin scope, namespace, and accepted authorization"
            );
        }
    }

    let no_resurrection = fixtures
        .iter()
        .find(|fixture| {
            fixture["name"] == "auth.live.invalidation_terminal_delete_blocks_ordinary_live_reuse"
        })
        .expect("terminal no-resurrection fixture");
    assert_eq!(no_resurrection["steps"][1]["frame"]["kind"], "live_replace");
    assert_eq!(
        no_resurrection["steps"][1]["expect"]["actions"],
        serde_json::json!(["surface_protocol_diagnostic", "ignore_frame"])
    );
    assert_eq!(
        no_resurrection["expect"]["transitions"][0]["to"],
        "terminal_deleted"
    );

    let high_water = fixtures
        .iter()
        .find(|fixture| {
            fixture["name"] == "auth.live.invalidation_newer_pending_rejects_older_resolution"
        })
        .expect("pending high-water fixture");
    assert_eq!(high_water["steps"][0]["frame"]["obligation"]["revision"], 2);
    assert_eq!(
        high_water["steps"][0]["frame"]["obligation"]["witness"]["data"]["minCommitVersion"],
        44
    );
    assert_eq!(high_water["steps"][1]["frame"]["obligation"]["revision"], 1);
    assert_eq!(
        high_water["steps"][1]["expect"]["actions"],
        serde_json::json!(["surface_protocol_diagnostic", "ignore_frame"])
    );

    let mismatched = fixtures
        .iter()
        .find(|fixture| {
            fixture["name"] == "auth.live.invalidation_owned_id_mismatched_scope_never_acknowledged"
        })
        .expect("owned-id mismatched-scope fixture");
    assert_eq!(
        mismatched["frame"]["obligation"]["scopeId"]["subscriptionId"],
        mismatched["given"]["subscriptions"][0]["id"]
    );
    assert_ne!(
        mismatched["frame"]["obligation"]["scopeId"]["namespace"],
        mismatched["given"]["subscriptions"][0]["authorizationNamespace"]
    );
    assert_eq!(
        mismatched["expect"]["actions"],
        serde_json::json!(["surface_protocol_diagnostic", "ignore_frame"])
    );

    let invalid = fixtures
        .iter()
        .find(|fixture| {
            fixture["name"] == "auth.live.invalidation_invalid_resolution_never_acknowledged"
        })
        .expect("invalid resolution fixture");
    let below_floor = &invalid["steps"][0]["frame"];
    assert!(
        below_floor["snapshot"]["version"]
            .as_u64()
            .expect("snapshot version")
            < below_floor["resolution"]["witness"]["data"]["minCommitVersion"]
                .as_u64()
                .expect("resolution floor")
    );
    assert_eq!(
        invalid["steps"][0]["expect"]["actions"],
        serde_json::json!(["quarantine_rows", "surface_protocol_diagnostic"])
    );
    let terminal_with_snapshot = &invalid["steps"][1]["frame"];
    assert_eq!(
        terminal_with_snapshot["resolution"]["kind"],
        "terminalDelete"
    );
    assert!(terminal_with_snapshot["snapshot"].is_object());
    assert_eq!(
        invalid["steps"][1]["expect"]["actions"],
        serde_json::json!(["surface_protocol_diagnostic", "ignore_frame"])
    );
}

/// Decode a Lane-P `{"Durable":{"payload":[u8…]}}` wrapper back to the inner
/// durable envelope value.
fn unwrapped_payload(name: &str, frame: &Value) -> Value {
    let payload = frame["Durable"]["payload"]
        .as_array()
        .unwrap_or_else(|| panic!("{name}: wrapped frame carries Durable.payload"));
    let bytes: Vec<u8> = payload
        .iter()
        .map(|byte| byte.as_u64().expect("payload byte") as u8)
        .collect();
    serde_json::from_slice(&bytes)
        .unwrap_or_else(|error| panic!("{name}: payload decodes: {error}"))
}

fn fixture<'a>(fixtures: &'a [Value], name: &str) -> &'a Value {
    fixtures
        .iter()
        .find(|fixture| fixture["name"] == name)
        .unwrap_or_else(|| panic!("corpus lost fixture {name}"))
}

/// Format-v3 P-1 extensions: wrapped/unwrapped parity carries the EXACT core
/// envelope, drain-cancel redelivery is byte-identical, the negotiation and
/// grant-loss refusals pin the shipped codes, and the virtual-time fixtures
/// pin the T-HB/T-LOSS numbers.
#[test]
fn format_v3_pins_parity_negotiation_grant_loss_and_timing() {
    let fixtures = fixtures();

    // Wrapped/unwrapped parity: every durable family's wrapped fixture
    // carries exactly the envelope its core sibling carries.
    for (wrapped_name, core_name) in [
        ("poll.wrapped_durable.unwrap", "durable.live_replace.basic"),
        (
            "poll.wrapped_live_delta.unwrap",
            "durable.live_delta.apply_by_id",
        ),
        (
            "poll.wrapped_resync_required.subscription_scoped",
            "durable.resync_required.subscription_scoped",
        ),
        (
            "poll.wrapped_resync_required.connection_wide_clear_retained",
            "durable.resync_required.connection_wide_clear_retained",
        ),
        (
            "poll.wrapped_current_as_of.adopts_token_without_rows",
            "durable.current_as_of.adopts_token_without_rows",
        ),
    ] {
        let wrapped = fixture(&fixtures, wrapped_name);
        let core = fixture(&fixtures, core_name);
        assert_eq!(
            unwrapped_payload(wrapped_name, &wrapped["frame"]),
            core["frame"],
            "{wrapped_name}: wrapped payload must be the exact {core_name} envelope"
        );
        assert_eq!(wrapped["lane"], "poll");
        assert_eq!(wrapped["tuples"], serde_json::json!(["poll/local"]));
        assert!(
            wrapped["expect"]["actions"]
                .as_array()
                .expect("wrapped actions")
                .contains(&Value::from("unwrap_durable")),
            "{wrapped_name}: unwrapping is the lane obligation"
        );
    }

    // Drain-cancel duplicate tolerance: the redelivered entry is the exact
    // wrapper bytes, dropped by the version guard, and the batch continues.
    let drain_cancel = fixture(
        &fixtures,
        "poll.drain_cancel.redelivered_duplicates_tolerated",
    );
    let steps = drain_cancel["steps"]
        .as_array()
        .expect("drain-cancel steps");
    assert_eq!(
        steps[0]["frame"], steps[1]["frame"],
        "the redelivered entry must repeat the exact wrapper"
    );
    assert!(
        steps[1]["expect"]["actions"]
            .as_array()
            .expect("duplicate-step actions")
            .contains(&Value::from("drop_stale"))
    );
    assert_eq!(
        unwrapped_payload("drain_cancel step 2", &steps[2]["frame"])["kind"],
        "live_delta"
    );

    // Negotiation/offer and grant-loss refusals pin the shipped codes and
    // statuses (src/wire_version.rs; src/server.rs; cloudflare coordinator).
    for (name, status, code) in [
        (
            "negotiation.open.unknown_wire_version_refused",
            400,
            "SNAPBACK_WIRE_VERSION_UNSUPPORTED",
        ),
        (
            "negotiation.open.unknown_auth_invalidation_protocol_refused",
            400,
            "SNAPBACK_AUTH_INVALIDATION_PROTOCOL_UNSUPPORTED",
        ),
        (
            "negotiation.socket.wire_version_required",
            400,
            "SNAPBACK_WIRE_VERSION_REQUIRED",
        ),
        (
            "negotiation.socket.unknown_wire_version_refused",
            400,
            "SNAPBACK_WIRE_VERSION_UNSUPPORTED",
        ),
        (
            "arm.hosted_subscribe_requires_socket",
            409,
            "SNAPBACK_CONNECTION_SOCKET_REQUIRED",
        ),
        (
            "grant.connection_token_invalid_reopens_everything",
            403,
            "SNAPBACK_CONNECTION_TOKEN_INVALID",
        ),
    ] {
        let refused = fixture(&fixtures, name);
        assert_eq!(refused["direction"], "client_to_server", "{name}");
        assert_eq!(refused["refusal"]["status"], status, "{name}");
        assert_eq!(refused["refusal"]["code"], code, "{name}");
        let forbidden = refused["expect"]["forbiddenActions"]
            .as_array()
            .unwrap_or_else(|| panic!("{name}: refusal fixtures forbid blind retry"));
        assert!(
            forbidden.contains(&Value::from("retry_unchanged")),
            "{name}"
        );
    }

    // The socket offer sets never count the bearer carrier as a version
    // candidate, and the unknown set carries no supported token.
    let required = fixture(&fixtures, "negotiation.socket.wire_version_required");
    for entry in required["request"]["subprotocols"]
        .as_array()
        .expect("subprotocols")
    {
        assert!(
            entry
                .as_str()
                .expect("entry")
                .starts_with("snapback.connection-token."),
            "the REQUIRED offer set must contain only non-version entries"
        );
    }
    let unknown = fixture(&fixtures, "negotiation.socket.unknown_wire_version_refused");
    assert!(
        unknown["request"]["subprotocols"]
            .as_array()
            .expect("subprotocols")
            .iter()
            .all(|entry| entry != "snapback.v1"),
        "the UNSUPPORTED offer set must not contain the supported token"
    );

    // Grant loss: recovery is re-open and re-establish everything (§4.4).
    let grant_loss = fixture(
        &fixtures,
        "grant.connection_token_invalid_reopens_everything",
    );
    assert_eq!(
        grant_loss["expect"]["actions"],
        serde_json::json!([
            "reopen_connection",
            "resubscribe_all",
            "clear_retained_overlays"
        ])
    );

    // Arm mismatch: the hosted drain blackout is a declared-empty array on
    // the live/hosted tuple, with no transitions and no actions.
    let blackout = fixture(&fixtures, "arm.live_hosted_drain_declared_empty_blackout");
    assert_eq!(blackout["frame"], serde_json::json!([]));
    assert_eq!(blackout["tuples"], serde_json::json!(["live/hosted"]));
    assert_eq!(blackout["expect"]["actions"], serde_json::json!([]));

    // Socket loss mid-subscribe: the event fixture pins a pending
    // subscription that resolves DROPPED without an establishment assumption.
    let mid_subscribe = fixture(&fixtures, "arm.socket_loss_mid_subscribe");
    assert_eq!(mid_subscribe["steps"][0]["event"]["kind"], "socket_lost");
    assert!(
        mid_subscribe["given"]["subscriptions"]
            .as_array()
            .expect("populations")
            .iter()
            .any(|subscription| subscription["state"] == "pending")
    );
    assert_eq!(
        mid_subscribe["expect"]["supersession"]["sub_fixture_pending"],
        "fresh_subscribe_without_supersession_assumption"
    );

    // Virtual time: the timing fixtures pin the normative T-HB/T-LOSS
    // numbers — 5 s ping, 15 s freshness budget, 250 ms → 10 s backoff.
    let heartbeat = fixture(&fixtures, "timing.heartbeat.ping_and_pong_freshness");
    assert_eq!(heartbeat["clock"], "virtual");
    assert_eq!(heartbeat["steps"][0]["advanceVirtualTimeMs"], 5000);
    assert_eq!(
        heartbeat["steps"][0]["expect"]["actions"],
        serde_json::json!(["send_ping"])
    );
    assert_eq!(heartbeat["steps"][1]["frame"]["kind"], "pong");

    let freshness = fixture(&fixtures, "timing.freshness.budget_exhausted_forces_loss");
    assert!(
        freshness["steps"][0]["advanceVirtualTimeMs"]
            .as_u64()
            .expect("freshness advance")
            > 15000,
        "the loss step must exhaust the whole 15 s freshness budget"
    );
    assert!(
        freshness["steps"][0]["expect"]["actions"]
            .as_array()
            .expect("loss actions")
            .contains(&Value::from("force_socket_loss"))
    );

    let backoff = fixture(&fixtures, "timing.reconnect.backoff_bounds");
    assert!(
        backoff["steps"][0]["advanceVirtualTimeMs"]
            .as_u64()
            .expect("backoff floor advance")
            < 250,
        "the first advance must stay below the 250 ms backoff floor"
    );
    assert!(
        backoff["steps"][0]["expect"]["forbiddenActions"]
            .as_array()
            .expect("backoff floor forbids")
            .contains(&Value::from("attempt_reconnect"))
    );
    assert_eq!(
        backoff["steps"][1]["expect"]["pacing"],
        serde_json::json!({ "action": "attempt_reconnect", "maxIntervalMs": 10000 })
    );
}

/// The LLP 0096 auth-profile classes: shipped refusal codes per profile,
/// the post-split descriptor fence, terminal authorityDisposition
/// distinctions, lease-pair composition, and invalidation wrapped parity.
#[test]
fn auth_profile_fixtures_pin_refusals_split_dispositions_and_lease_rules() {
    let fixtures = fixtures();

    // auth/rr: readiness 503, then the two malformed-offer 400s.
    let rr = fixture(&fixtures, "auth.rr.offer_refusal_surfaced");
    let rr_steps = rr["steps"].as_array().expect("rr steps");
    assert_eq!(rr_steps[0]["refusal"]["status"], 503);
    assert_eq!(
        rr_steps[0]["refusal"]["code"],
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
    );
    for step in &rr_steps[1..] {
        assert_eq!(step["refusal"]["status"], 400);
        assert_eq!(
            step["refusal"]["code"],
            "SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED"
        );
        assert_eq!(step["refusal"]["details"]["minimumAuthClientProtocol"], 1);
    }
    assert_eq!(
        rr_steps[1]["request"]["headers"],
        serde_json::json!({}),
        "the missing-offer negative carries no offer header"
    );
    assert_eq!(
        rr_steps[2]["request"]["headers"]["x-snapback-auth-client-protocol"], "2",
        "the unknown-integer negative offers a non-v1 value"
    );

    // auth/live: the subscribe-time and open-time halves refuse the same
    // code from different gates, and the negotiated ack needs no
    // descriptor offer (the §8.1 split).
    let subscribe_offer = fixture(
        &fixtures,
        "auth.live.subscribe_missing_invalidation_offer_refused",
    );
    assert_eq!(
        subscribe_offer["refusal"]["code"],
        "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED"
    );
    assert!(
        subscribe_offer["request"]["body"]["authorizationNamespace"].is_object(),
        "the subscribe negative still carries the namespace: only the offer is missing"
    );

    let ack_negotiation = fixture(&fixtures, "auth.live.ack_requires_negotiated_connection");
    assert_eq!(
        ack_negotiation["refusal"]["code"],
        "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED"
    );
    assert_eq!(
        ack_negotiation["given"]["connection"]["authInvalidationNegotiated"],
        false
    );
    assert_eq!(
        ack_negotiation["request"]["headers"]["x-snapback-auth-invalidation-protocol"], "1",
        "the per-request header must be present so the fixture isolates the open-time half"
    );
    assert!(
        ack_negotiation["expect"]["actions"]
            .as_array()
            .expect("ack actions")
            .contains(&Value::from("reopen_connection"))
    );

    let ack_no_descriptor = fixture(&fixtures, "auth.live.ack_needs_no_descriptor_offer");
    assert_eq!(ack_no_descriptor["response"]["status"], 200);
    assert!(
        ack_no_descriptor["request"]["headers"]
            .get("x-snapback-authority-descriptor-protocol")
            .is_none(),
        "the accepted ack must not carry the descriptor offer"
    );

    // Terminal dispositions: carrier retains durable authority state,
    // durableDelete deletes it; both are terminal and never reconnect.
    let carrier = fixture(&fixtures, "auth.live.terminal_auth_carrier_disposition");
    assert_eq!(carrier["frame"]["kind"], "auth_error");
    assert_eq!(carrier["frame"]["authorityDisposition"], "carrier");
    assert_eq!(
        carrier["expect"]["actions"],
        serde_json::json!(["surface_terminal_auth"])
    );
    let durable_delete = fixture(
        &fixtures,
        "auth.live.terminal_auth_durable_delete_disposition",
    );
    assert_eq!(
        durable_delete["frame"]["authorityDisposition"],
        "durableDelete"
    );
    assert!(
        durable_delete["expect"]["actions"]
            .as_array()
            .expect("durableDelete actions")
            .contains(&Value::from("delete_local_durable_authority"))
    );
    for terminal in [carrier, durable_delete] {
        assert!(
            terminal["expect"]["forbiddenActions"]
                .as_array()
                .expect("terminal forbids")
                .contains(&Value::from("attempt_reconnect")),
            "terminal auth is never reconnectable with the presented credential"
        );
    }

    // auth/replay: the descriptor fence binds the replay-requesting
    // surfaces and only those.
    let descriptor = fixture(&fixtures, "auth.replay.descriptor_offer_required");
    let descriptor_steps = descriptor["steps"].as_array().expect("descriptor steps");
    assert!(
        descriptor_steps[0]["request"]["route"]
            .as_str()
            .expect("route")
            .starts_with("/mutation/")
    );
    assert!(descriptor_steps[0]["request"]["body"]["clientMutationId"].is_string());
    assert_eq!(
        descriptor_steps[1]["request"]["route"],
        "/client-mutations/acknowledge"
    );
    assert_eq!(
        descriptor_steps[1]["family"],
        "client-mutation.ack.input.schema.json"
    );
    for step in descriptor_steps {
        assert_eq!(
            step["refusal"]["details"]["capability"], "queuedReplay",
            "the descriptor refusal names its axis"
        );
    }

    let duplicate = fixture(&fixtures, "auth.replay.duplicate_settlement_idempotent");
    let duplicate_steps = duplicate["steps"].as_array().expect("duplicate steps");
    assert_eq!(
        duplicate_steps[0]["request"], duplicate_steps[1]["request"],
        "the redelivered settlement must repeat the exact request"
    );
    assert!(
        duplicate_steps[1]["expect"]["forbiddenActions"]
            .as_array()
            .expect("duplicate forbids")
            .contains(&Value::from("settle_client_mutation"))
    );

    let predecessor = fixture(&fixtures, "auth.replay.predecessor_queue_suspends");
    assert_eq!(
        predecessor["steps"][0]["event"]["kind"],
        "authority_instance_changed"
    );
    assert_eq!(
        predecessor["steps"][0]["event"]["from"],
        predecessor["given"]["replayQueue"]["authorityInstance"]
    );
    assert!(
        predecessor["expect"]["forbiddenActions"]
            .as_array()
            .expect("predecessor forbids")
            .contains(&Value::from("replay_queued_mutations"))
    );

    // auth/lease: the pair rule and the expiry fence.
    let lease_pair = fixture(&fixtures, "auth.lease.offer_pair_required");
    let lease_headers = &lease_pair["request"]["headers"];
    assert_eq!(lease_headers["x-snapback-authorized-lease-protocol"], "1");
    assert!(
        lease_headers
            .get("x-snapback-auth-invalidation-protocol")
            .is_none(),
        "the pair negative offers only the lease half"
    );
    assert_eq!(
        lease_pair["refusal"]["code"],
        "SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED"
    );

    let lease_expiry = fixture(&fixtures, "auth.lease.expiry_fences_retained_rows");
    assert_eq!(lease_expiry["clock"], "virtual");
    let expiry = lease_expiry["given"]["retainedRead"]["lease"]["expiresAtServerMs"]
        .as_u64()
        .expect("lease expiry");
    let advanced: u64 = lease_expiry["steps"]
        .as_array()
        .expect("expiry steps")
        .iter()
        .map(|step| step["advanceVirtualTimeMs"].as_u64().unwrap_or(0))
        .sum();
    assert!(
        advanced > expiry,
        "the fixture must advance the virtual clock past lease expiry"
    );
    assert!(
        lease_expiry["steps"][0]["advanceVirtualTimeMs"]
            .as_u64()
            .expect("pre-expiry advance")
            < expiry,
        "the first advance must stay inside the lease so the fence is expiry-triggered"
    );

    // Wrapped invalidation parity: byte-exact against the core step frame.
    let wrapped_invalidation = fixture(
        &fixtures,
        "poll.wrapped_authorization_invalidation.apply_then_ack",
    );
    let core_invalidation = fixture(&fixtures, "auth.live.invalidation_snapshot_apply_then_ack");
    assert_eq!(
        unwrapped_payload(
            "poll.wrapped_authorization_invalidation.apply_then_ack",
            &wrapped_invalidation["frame"]
        ),
        core_invalidation["steps"][0]["frame"],
        "the wrapped invalidation must carry the exact core envelope"
    );
    assert_eq!(
        wrapped_invalidation["expect"]["orderedActions"][0], "unwrap_durable",
        "unwrapping precedes the invalidation judgment"
    );
}
