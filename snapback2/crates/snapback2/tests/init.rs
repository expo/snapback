mod common;

use common::{Project, snapshot};
use serde_json::Value as Json;

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

#[test]
fn todos_is_the_minimal_one_table_two_operation_template() {
    let project = Project::new();
    let initialized = project.init("todos", "none");
    assert!(
        initialized.status.success(),
        "init failed: {}{}",
        String::from_utf8_lossy(&initialized.stdout),
        String::from_utf8_lossy(&initialized.stderr)
    );
    let compiled: Json = serde_json::from_slice(
        &std::fs::read(project.path.join(".snapback/build/project.json")).unwrap(),
    )
    .unwrap();
    let tables = compiled["schema"]["tables"].as_object().unwrap();
    let operations = compiled["programs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|program| program["name"].as_str().unwrap())
        .collect::<Vec<_>>();

    assert_eq!(tables.keys().collect::<Vec<_>>(), vec!["todos"]);
    assert_eq!(operations, vec!["todos.add", "todos.list"]);
    assert!(project.path.join("snapback/seed.ts").is_file());
    assert!(project.path.join("snapback/tests/todos.test.ts").is_file());
}
