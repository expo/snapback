//! Emit or drift-check LLP 0157 §D8's Rust-owned `sbsb2` parity corpus.
//!
//! Usage:
//!   cargo run --bin snapback-sbsb2-vectors -- --write
//!   cargo run --bin snapback-sbsb2-vectors -- --check

use std::path::PathBuf;

fn main() {
    let value = snapback::snapshot_batch_cursor_v2::reference_parity_fixture()
        .expect("sbsb2 reference vectors render");
    let rendered = format!(
        "{}\n",
        serde_json::to_string_pretty(&value).expect("sbsb2 fixture is JSON")
    );
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/snapshot-batch-sbsb2-parity-v1.json");
    if std::env::args().any(|argument| argument == "--write") {
        std::fs::write(&path, rendered).expect("write sbsb2 parity fixture");
        println!("wrote {}", path.display());
    } else if std::env::args().any(|argument| argument == "--check") {
        let committed = std::fs::read_to_string(&path).expect("read sbsb2 parity fixture");
        assert_eq!(committed, rendered, "sbsb2 parity fixture drifted");
        println!("sbsb2 parity fixture: ok");
    } else {
        print!("{rendered}");
    }
}
