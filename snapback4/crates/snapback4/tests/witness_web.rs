//! The public binary routes the packaged web helper even outside a project.
use std::process::Command;
const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
#[test]
fn web_witness_help_and_invalid_input() {
    let help = Command::new(BIN).args(["witness", "web", "--help"]).output().unwrap();
    assert!(help.status.success(), "{help:?}");
    let text = String::from_utf8_lossy(&help.stdout);
    assert!(text.contains("--mutation") && text.contains("SNAPBACK4_CHROMIUM"));
    let refused = Command::new(BIN).args(["witness", "web", "--timeout", "zero"]).output().unwrap();
    assert!(!refused.status.success());
    assert!(String::from_utf8_lossy(&refused.stderr).contains("E_INPUT"));
}
