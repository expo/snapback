//! Cross-language sender-proof acceptance: the browser-side WebCrypto
//! implementation signs a live vector and the Rust hosted boundary verifies
//! the same protocol bytes.

use serde::Deserialize;
use snapback::auth::sender_proof::{SenderProofExpectation, verify_sender_proof};
use std::process::Command;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BrowserVector {
    proof: String,
    method: String,
    canonical_external_uri: String,
    access_token: String,
    nonce: String,
    issued_at_seconds: u64,
    thumbprint: String,
}

#[test]
fn webcrypto_es256_proof_verifies_in_rust() {
    let output = Command::new("node")
        .arg("packages/snapback-client/sender-proof.vector.mjs")
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("launch Node sender-proof vector");
    assert!(
        output.status.success(),
        "Node vector failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let vector: BrowserVector =
        serde_json::from_slice(&output.stdout).expect("parse closed browser vector");
    let verified = verify_sender_proof(
        &vector.proof,
        &SenderProofExpectation {
            method: &vector.method,
            canonical_external_uri: &vector.canonical_external_uri,
            access_token: vector.access_token.as_bytes(),
            nonce: &vector.nonce,
            family_jwk_thumbprint: &vector.thumbprint,
            server_unix_seconds: vector.issued_at_seconds,
        },
    )
    .expect("Rust accepts WebCrypto proof");
    assert_eq!(verified.proof_id, [23_u8; 16]);
}
