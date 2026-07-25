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
        let frame = &fixture["frame"];
        assert!(frame.is_object(), "{name}: fixture carries a frame object");
        match fixture["family"].as_str() {
            Some(family) => {
                let schema = committed(family);
                let validator = jsonschema::validator_for(&schema)
                    .unwrap_or_else(|error| panic!("compile {family}: {error}"));
                let valid = validator.is_valid(frame);
                assert_eq!(
                    valid, claim,
                    "{name}: schemaValid claims {claim} but {family} says {valid}"
                );
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
                    assert!(
                        !validator.is_valid(frame),
                        "{name}: claimed family-less but validates against {family}"
                    );
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
