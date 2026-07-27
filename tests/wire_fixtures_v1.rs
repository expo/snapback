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

/// Every fixture's `schemaValid` claim agrees with the committed family
/// schema. Family-less fixtures (unknown-kind negatives) must claim invalid.
#[test]
fn fixture_schema_valid_claims_are_proven_against_committed_schemas() {
    for fixture in fixtures() {
        let name = fixture["name"].as_str().expect("fixture has a name");
        let claim = fixture["schemaValid"]
            .as_bool()
            .unwrap_or_else(|| panic!("{name}: fixture has a schemaValid bool"));
        let frames: Vec<&Value> = if let Some(steps) = fixture["steps"].as_array() {
            assert!(!steps.is_empty(), "{name}: steps must not be empty");
            steps
                .iter()
                .map(|step| {
                    let frame = &step["frame"];
                    assert!(frame.is_object(), "{name}: every step carries a frame object");
                    frame
                })
                .collect()
        } else {
            let frame = &fixture["frame"];
            assert!(frame.is_object(), "{name}: fixture carries a frame object");
            vec![frame]
        };
        match fixture["family"].as_str() {
            Some(family) => {
                let schema = committed(family);
                let validator = jsonschema::validator_for(&schema)
                    .unwrap_or_else(|error| panic!("compile {family}: {error}"));
                for (index, frame) in frames.iter().enumerate() {
                    let valid = validator.is_valid(frame);
                    assert_eq!(
                        valid, claim,
                        "{name}: schemaValid claims {claim} but {family} says {valid} for frame {index}"
                    );
                }
                // batchContext members share the fixture's family.
                if let Some(batch) = fixture["batchContext"].as_array() {
                    for (index, member) in batch.iter().enumerate() {
                        assert!(
                            validator.is_valid(member),
                            "{name}: batchContext[{index}] does not validate against {family}"
                        );
                    }
                }
            }
            None => {
                assert!(
                    !claim,
                    "{name}: a fixture without a family cannot claim schemaValid"
                );
                // An unknown-kind negative must really be unknown to BOTH
                // live-wire families (the known-kind/unknown-kind distinction
                // fact 2b turns on).
                for family in [
                    "live.envelope.schema.json",
                    "live.socket-server.schema.json",
                ] {
                    let schema = committed(family);
                    let validator = jsonschema::validator_for(&schema)
                        .unwrap_or_else(|error| panic!("compile {family}: {error}"));
                    for frame in &frames {
                        assert!(
                            !validator.is_valid(frame),
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
}

/// Format v2 removes the arbitrary-population and row-identity ambiguities
/// found by independent clean-room clients.
#[test]
fn format_v2_pins_connection_populations_and_row_identity() {
    let fixtures = fixtures();
    for fixture in &fixtures {
        let name = fixture["name"].as_str().expect("fixture name");
        if fixture["given"]["connection"].is_object() {
            let subscriptions = fixture["given"]["subscriptions"]
                .as_array()
                .unwrap_or_else(|| panic!("{name}: connection fixture must pin subscriptions"));
            assert!(
                !subscriptions.is_empty(),
                "{name}: connection population cannot be vacuous"
            );
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
    assert_eq!(
        sequence["steps"][1]["expect"]["ackToken"],
        "ack_fixture_1"
    );

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
        same_version["steps"][0]["frame"],
        same_version["steps"][1]["frame"],
        "duplicate re-ACK must repeat the exact frame identity"
    );
    assert_eq!(
        same_version["steps"][1]["expect"]["ackToken"],
        "ack_fixture_same_version_1"
    );

    let terminal = fixtures
        .iter()
        .find(|fixture| {
            fixture["name"] == "auth.live.invalidation_terminal_delete_apply_then_ack"
        })
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
        terminal["steps"][0]["frame"],
        terminal["steps"][1]["frame"],
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

    for fixture in fixtures
        .iter()
        .filter(|fixture| fixture["profiles"][0] == "auth/live")
    {
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
    assert_eq!(
        no_resurrection["steps"][1]["frame"]["kind"],
        "live_replace"
    );
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
    assert_eq!(
        high_water["steps"][0]["frame"]["obligation"]["revision"],
        2
    );
    assert_eq!(
        high_water["steps"][0]["frame"]["obligation"]["witness"]["data"]["minCommitVersion"],
        44
    );
    assert_eq!(
        high_water["steps"][1]["frame"]["obligation"]["revision"],
        1
    );
    assert_eq!(
        high_water["steps"][1]["expect"]["actions"],
        serde_json::json!(["surface_protocol_diagnostic", "ignore_frame"])
    );

    let mismatched = fixtures
        .iter()
        .find(|fixture| {
            fixture["name"]
                == "auth.live.invalidation_owned_id_mismatched_scope_never_acknowledged"
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
        below_floor["snapshot"]["version"].as_u64().expect("snapshot version")
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
