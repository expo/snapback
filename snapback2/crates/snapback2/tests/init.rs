mod common;

use common::{Project, snapshot};

#[test]
fn init_is_idempotent_and_second_run_is_a_content_noop() {
    let project = Project::new();
    let first = project.init("chat", "react");
    assert!(
        first.status.success(),
        "first init failed: {}{}",
        String::from_utf8_lossy(&first.stdout),
        String::from_utf8_lossy(&first.stderr)
    );
    let before = snapshot(&project.path);
    let second = project.init("chat", "react");
    assert!(
        second.status.success(),
        "second init failed: {}{}",
        String::from_utf8_lossy(&second.stdout),
        String::from_utf8_lossy(&second.stderr)
    );
    assert_eq!(before, snapshot(&project.path));
    let agents = std::fs::read_to_string(project.path.join("AGENTS.md")).unwrap();
    assert_eq!(agents.matches("<!-- snapback2:start -->").count(), 1);
    assert_eq!(agents.matches("<!-- snapback2:end -->").count(), 1);
}
