mod common;

use common::{Project, json_stdout};
use std::fs;

#[test]
fn chat_template_is_blocked_without_an_effect_engine_and_lists_both_journeys() {
    let project = Project::new();
    let initialized = project.init("chat", "none");
    assert!(
        initialized.status.success(),
        "init failed: {}{}",
        String::from_utf8_lossy(&initialized.stdout),
        String::from_utf8_lossy(&initialized.stderr)
    );
    let output = project.run(&["test", "--json"]);
    assert_eq!(output.status.code(), Some(1));
    let receipt = json_stdout(&output);
    assert_eq!(receipt["verdict"], "blocked");
    let checks = receipt["checks"].as_array().unwrap();
    assert!(
        checks
            .iter()
            .filter(|check| check["kind"] == "derived")
            .count()
            >= 6
    );
    assert_eq!(
        checks
            .iter()
            .filter(|check| check["kind"] == "journey")
            .count(),
        2
    );
    assert!(checks.iter().any(|check| {
        check["name"] == "effects"
            && check["verdict"] == "blocked"
            && check["detail"]["reason"] == "no engine in this build"
    }));
}

#[test]
fn todos_template_passes_without_an_effects_check() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    let output = project.run(&["test", "--json"]);
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let receipt = json_stdout(&output);
    assert_eq!(receipt["verdict"], "pass");
    assert!(
        !receipt["checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|check| check["name"] == "effects")
    );
}

#[test]
fn zero_journeys_is_optional_but_zero_total_checks_still_fails() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::remove_file(project.path.join("snapback/tests/todos.test.ts")).unwrap();
    assert!(project.run(&["check", "--json"]).status.success());

    let derived = project.run(&["test", "--json"]);
    assert!(derived.status.success());
    let receipt = json_stdout(&derived);
    assert_eq!(receipt["verdict"], "pass");
    assert!(
        receipt["checks"]
            .as_array()
            .unwrap()
            .iter()
            .all(|check| check["kind"] == "derived")
    );

    let empty = project.run(&["test", "--journeys-only", "--json"]);
    assert_eq!(empty.status.code(), Some(1));
    let receipt = json_stdout(&empty);
    assert_eq!(receipt["verdict"], "fail");
    assert!(receipt["checks"].as_array().unwrap().is_empty());
}

#[test]
fn check_refuses_a_journey_type_error_before_test_runtime() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::write(
        project.path.join("snapback/tests/todos.test.ts"),
        r#"import { journey } from "snapback2/test";
journey("bad types", async () => { const n: number = "wrong"; void n; });
"#,
    )
    .unwrap();

    let checked = project.run(&["check", "--json"]);
    assert_eq!(checked.status.code(), Some(1));
    let stdout = String::from_utf8_lossy(&checked.stdout);
    assert!(
        stdout.contains("not assignable to type 'number'"),
        "{stdout}"
    );
    assert!(stdout.contains("snapback/tests/todos.test.ts"), "{stdout}");
}

#[test]
fn invalidation_blocks_when_every_intersecting_probe_is_rejected() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::remove_file(project.path.join("snapback/tests/todos.test.ts")).unwrap();
    fs::write(
        project.path.join("snapback/todos.ts"),
        r#"import { mutation, query } from "snapback2";
import { todos } from "./schema";
export const list = query({}, ({ db, ctx }) => db.scan(todos.byOwner, [ctx.viewer], { take: 50 }));
export const add = mutation({}, ({ db, ctx }) => {
  db.require(false, "ALWAYS_REJECT");
  db.insert(todos, { id: ctx.newId(), title: "never", done: false, ownerId: ctx.viewer, price: 100, status: "open" });
  return null;
});
"#,
    )
    .unwrap();
    assert!(project.run(&["check", "--json"]).status.success());

    let output = project.run(&["test", "--derived-only", "--json"]);
    assert_eq!(output.status.code(), Some(1));
    let receipt = json_stdout(&output);
    let invalidation = receipt["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|check| check["name"] == "invalidation")
        .unwrap();
    assert_eq!(invalidation["verdict"], "blocked");
    assert_eq!(
        invalidation["detail"]["blocked"][0]["reason"],
        "no committing probe"
    );
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
