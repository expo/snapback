mod common;

use common::{Project, json_stdout};

#[test]
fn chat_template_passes_derived_checks_and_a_journey() {
    let project = Project::new();
    let initialized = project.init("chat", "none");
    assert!(
        initialized.status.success(),
        "init failed: {}{}",
        String::from_utf8_lossy(&initialized.stdout),
        String::from_utf8_lossy(&initialized.stderr)
    );
    let output = project.run(&["test", "--json"]);
    assert!(
        output.status.success(),
        "test failed: {}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let receipt = json_stdout(&output);
    assert_eq!(receipt["verdict"], "pass");
    let checks = receipt["checks"].as_array().unwrap();
    assert!(
        checks
            .iter()
            .filter(|check| check["kind"] == "derived")
            .count()
            >= 6
    );
    assert!(checks.iter().any(|check| check["kind"] == "journey"));
}

#[test]
fn explicit_block_writes_a_blocked_receipt_and_exits_one() {
    let project = Project::new();
    let initialized = project.init("todos", "none");
    assert!(
        initialized.status.success(),
        "init failed: {}{}",
        String::from_utf8_lossy(&initialized.stdout),
        String::from_utf8_lossy(&initialized.stderr)
    );
    let output = project.run(&["test", "--blocked", "waiting for provider", "--json"]);
    assert_eq!(output.status.code(), Some(1));
    let receipt = project.latest_receipt();
    assert_eq!(receipt["verdict"], "blocked");
    assert_eq!(
        receipt["checks"][0]["detail"]["reason"],
        "waiting for provider"
    );
}
