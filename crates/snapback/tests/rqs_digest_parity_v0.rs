//! Cross-language parity obligations for the RQS token/digest contract
//! (LLP 0091 §Conformance; rollout cluster 0A of LLP 0090) — Rust side.
//!
//! Both language arms assert byte-identical outputs against the SAME
//! committed corpus, `tests/fixtures/rqs-parity-v1.json` (the JS side is
//! `packages/snapback-client/rqs-digest-parity.test.mjs`). The corpus is
//! regenerated from this arm via the `#[ignore]`d `regenerate_parity_fixture`
//! test (`cargo test --test rqs_digest_parity_v0 -- --ignored`), so a
//! contract change shows up as a reviewable fixture diff plus a JS-side
//! failure — never a silent drift.
//!
//! @ref LLP 0091#conformance--parity-obligations — the five named
//!   obligations these tests discharge.

use serde_json::{Value, json};
use snapback::rqs::{
    DigestKind, MintRefusal, ResultDigest, ResumeTokenBody, jcs, leaf, mint_token_wire, row_hash,
    seq1_digest,
};

const FIXTURE_PATH: &str = "tests/fixtures/rqs-parity-v1.json";

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn corpus_values() -> Vec<Value> {
    vec![
        json!(null),
        json!(true),
        json!(false),
        json!(0),
        json!(-0.0_f64),
        json!(1),
        json!(-1.5),
        json!(0.3),
        json!(0.000001),
        json!(0.0000001),
        json!(1e21),
        json!(1.2e22),
        json!(9007199254740991_u64),
        json!(-9007199254740991_i64),
        json!(0.30000000000000004),
        json!(5e-324),
        json!(1.7976931348623157e308),
        json!("plain"),
        json!("</script><!--\u{2028}\u{2029}"),
        json!("quote\" backslash\\ \u{0008}\u{000b}\u{001f} tab\t"),
        // Adversarial key ordering: UTF-16 code-unit order puts the
        // supplementary character (surrogate D834...) BEFORE U+FB33.
        json!({ "\u{FB33}": 1, "\u{1D306}": 2, "1": "One", "\r": "CR", "\u{20AC}": "Euro" }),
        json!({ "b": [1, 2, { "z": null, "a": [] }], "a": { "nested": true } }),
        json!([{ "deep": { "keys": { "sort": "stable" } } }]),
    ]
}

fn corpus_rows() -> (Vec<Value>, Value) {
    let rows = vec![
        json!({ "_id": "a", "title": "first", "rank": 1 }),
        json!({ "_id": "ab", "title": "prefix-id \u{2028}", "rank": 2.5 }),
        json!({ "_id": "b", "nested": { "y": [1, 2], "x": null } }),
    ];
    let updated_b = json!({ "_id": "b", "nested": { "y": [1, 2, 3], "x": null } });
    (rows, updated_b)
}

fn fixture_token_body() -> ResumeTokenBody {
    ResumeTokenBody {
        app: "app_parity".to_owned(),
        generation: "gen1:0011223344".to_owned(),
        version_stream: "0198c0de-0000-7000-8000-000000000000".to_owned(),
        version: 42,
        query_artifact: "sha256:aa".to_owned(),
        args_hash: "sha256:bb".to_owned(),
        digest_kind: "mset1".to_owned(),
        content_digest: "mset1:cc".to_owned(),
        issued_at: 1_750_000_000_000,
        auth_partition: None,
    }
}

fn fixture_key() -> [u8; 32] {
    let mut key = [0_u8; 32];
    for (index, byte) in key.iter_mut().enumerate() {
        *byte = index as u8;
    }
    key
}

const FIXTURE_KEY_ID: &str = "sbrq_AAAAAAAAAAAAAAAAAAAAAA";

fn compute_fixture() -> Value {
    let jcs_cases: Vec<Value> = corpus_values()
        .into_iter()
        .map(|input| {
            let canonical = jcs(&input).expect("corpus value canonicalizes");
            json!({ "input": input, "canonical": canonical })
        })
        .collect();

    let (rows, updated_b) = corpus_rows();
    let leaves: Vec<Value> = rows
        .iter()
        .map(|row| {
            let id = row["_id"].as_str().unwrap();
            let hash = row_hash(row).unwrap();
            json!({
                "id": id,
                "row": row,
                "rowHash": hex(&hash),
                "leaf": hex(&leaf(id, &hash)),
            })
        })
        .collect();

    let empty_root = ResultDigest::from_rows(DigestKind::Mset1, &[])
        .unwrap()
        .published();
    let full_root = ResultDigest::from_rows(DigestKind::Mset1, &rows)
        .unwrap()
        .published();
    let mut subset = ResultDigest::from_rows(DigestKind::Mset1, &rows).unwrap();
    subset
        .apply_delta_ops(&[snapback::live_wire::LiveDeltaWireOp {
            op: snapback::live_wire::LiveDeltaOpKind::Update,
            id: "b".to_owned(),
            row: Some(updated_b.clone()),
        }])
        .unwrap();

    json!({
        "contract": "rqs-0A-v1",
        "jcs": jcs_cases,
        "leaves": leaves,
        "mset1": {
            "emptyRoot": empty_root,
            "rows": rows,
            "root": full_root,
            "subsetUpdate": { "id": "b", "row": updated_b, "root": subset.published() },
        },
        "seq1": {
            "rows": rows,
            "digest": seq1_digest(&rows).unwrap(),
            "reversedDigest": seq1_digest(&rows.iter().rev().cloned().collect::<Vec<_>>()).unwrap(),
        },
        "token": {
            "keyHex": hex(&fixture_key()),
            "keyId": FIXTURE_KEY_ID,
            "body": serde_json::to_value(fixture_token_body()).unwrap(),
            "wire": mint_token_wire(&fixture_key(), FIXTURE_KEY_ID, &fixture_token_body()),
        },
    })
}

fn committed_fixture() -> Value {
    let path = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../..")).join(FIXTURE_PATH);
    let bytes = std::fs::read(&path).expect("committed parity fixture exists");
    serde_json::from_slice(&bytes).expect("parity fixture parses")
}

/// Dev tool, not a gate: rewrite the committed corpus from this arm.
#[test]
#[ignore = "regenerates tests/fixtures/rqs-parity-v1.json; run explicitly after a contract change"]
fn regenerate_parity_fixture() {
    let path = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../..")).join(FIXTURE_PATH);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut bytes = serde_json::to_vec_pretty(&compute_fixture()).unwrap();
    bytes.push(b'\n');
    std::fs::write(&path, bytes).unwrap();
}

/// Obligation 1 — canonical encoding parity: identical RFC 8785 (JCS) bytes
/// for the shared corpus, and identical mint-time refusals; negative zero
/// serializes as `0`. (Lone surrogates cannot exist in a Rust `String`; that
/// refusal arm is JS-side-only by construction.)
#[test]
fn canonical_encoding_parity_v1() {
    let committed = committed_fixture();
    let computed = compute_fixture();
    assert_eq!(committed["jcs"], computed["jcs"]);
    assert_eq!(jcs(&json!(-0.0_f64)).unwrap(), "0");
    assert_eq!(
        jcs(&json!(9007199254740992_u64)),
        Err(MintRefusal::UnsafeInteger)
    );
    assert_eq!(
        jcs(&json!(-9007199254740992_i64)),
        Err(MintRefusal::UnsafeInteger)
    );
    // The shared integral-double band (see src/rqs.rs jcs_into).
    assert_eq!(jcs(&json!(1e20)), Err(MintRefusal::UnsafeInteger));
    assert_eq!(
        ResultDigest::from_rows(DigestKind::Mset1, &[json!({ "v": 1 })]).err(),
        Some(MintRefusal::RowIdMissing)
    );
    assert_eq!(
        ResultDigest::from_rows(
            DigestKind::Mset1,
            &[json!({ "_id": "a" }), json!({ "_id": "a" })]
        )
        .err(),
        Some(MintRefusal::RowIdDuplicate)
    );
}

/// Obligation 2 — leaf parity, including row ids that are prefixes of one
/// another (the length-framing injectivity check: "a" vs "ab" in the corpus).
#[test]
fn leaf_construction_parity_v1() {
    let committed = committed_fixture();
    let computed = compute_fixture();
    assert_eq!(committed["leaves"], computed["leaves"]);
    let hash = [7_u8; 32];
    assert_ne!(leaf("a", &hash), leaf("ab", &hash));
}

/// Obligation 3 — multiset digest parity: identical roots; commutativity;
/// incremental equals recompute; a strict-subset change preserves untouched
/// leaves.
#[test]
fn multiset_digest_parity_v1() {
    let committed = committed_fixture();
    let computed = compute_fixture();
    assert_eq!(committed["mset1"], computed["mset1"]);

    let (rows, updated_b) = corpus_rows();
    let reversed: Vec<Value> = rows.iter().rev().cloned().collect();
    assert_eq!(
        ResultDigest::from_rows(DigestKind::Mset1, &rows)
            .unwrap()
            .published(),
        ResultDigest::from_rows(DigestKind::Mset1, &reversed)
            .unwrap()
            .published(),
    );
    let recomputed = ResultDigest::from_rows(
        DigestKind::Mset1,
        &[rows[0].clone(), rows[1].clone(), updated_b],
    )
    .unwrap();
    assert_eq!(
        committed["mset1"]["subsetUpdate"]["root"],
        json!(recomputed.published()),
        "incremental subset update equals from-scratch recomputation"
    );
}

/// Obligation 4 — sequence digest parity; permuted order changes the digest.
#[test]
fn sequence_digest_parity_v1() {
    let committed = committed_fixture();
    let computed = compute_fixture();
    assert_eq!(committed["seq1"], computed["seq1"]);
    assert_ne!(
        committed["seq1"]["digest"],
        committed["seq1"]["reversedDigest"]
    );
}

/// Obligation 5 — token MAC transcript parity: identical `tokenWire` (which
/// pins both the length-framed transcript and the HMAC tag) for the fixture
/// key. The per-cause refusal vectors are Rust-side admission behavior and
/// live in `src/rqs.rs` unit tests plus the `src/local.rs` acceptance suite;
/// the JS arm never verifies MACs (servers do), so its half of this
/// obligation is byte-identical minting.
#[test]
fn token_mac_transcript_parity_v1() {
    let committed = committed_fixture();
    let computed = compute_fixture();
    assert_eq!(committed["token"], computed["token"]);
}
