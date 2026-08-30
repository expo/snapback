mod common;

use common::{Project, json_stdout};
use std::fs;

#[test]
fn refusal_code_guide_prints_the_wrong_and_right_pair() {
    let project = Project::new();
    let output = project.run(&["guide", "E_BOUND_TAKE_REQUIRED", "--json"]);
    assert!(output.status.success());
    let page = json_stdout(&output);
    let content = page["content"].as_str().unwrap();
    assert!(content.contains("db.scan(todos.byOwner, [ctx.viewer])"));
    assert!(content.contains("{ take: 50 }"));
}

#[test]
fn app_guide_refuses_missing_certificates_and_failed_seed_facts_as_stale() {
    let project = Project::new();
    let initialized = project.init("todos", "none");
    assert!(
        initialized.status.success(),
        "init failed: {}{}",
        String::from_utf8_lossy(&initialized.stdout),
        String::from_utf8_lossy(&initialized.stderr)
    );
    fs::remove_file(project.path.join(".snapback/build/certificates.json")).unwrap();
    let missing = project.run(&["guide", "app", "--json"]);
    assert_eq!(missing.status.code(), Some(1));
    let refusal = json_stdout(&missing);
    assert_eq!(refusal["code"], "E_GUIDE_STALE");
    assert_eq!(refusal["rewrite"], "run snapback2 check");

    assert!(project.run(&["check", "--json"]).status.success());
    let certificate_path = project.path.join(".snapback/build/certificates.json");
    let mut certificates: serde_json::Value =
        serde_json::from_slice(&fs::read(&certificate_path).unwrap()).unwrap();
    certificates.as_object_mut().unwrap().remove("todos.list");
    fs::write(
        &certificate_path,
        serde_json::to_vec(&certificates).unwrap(),
    )
    .unwrap();
    let incomplete = project.run(&["guide", "app", "--json"]);
    assert_eq!(incomplete.status.code(), Some(1));
    let refusal = json_stdout(&incomplete);
    assert_eq!(refusal["code"], "E_GUIDE_STALE");
    assert!(
        refusal["message"]
            .as_str()
            .unwrap_or_default()
            .contains("todos.list"),
        "{refusal}"
    );
    assert_eq!(refusal["rewrite"], "run snapback2 check");

    assert!(project.run(&["check", "--json"]).status.success());
    fs::write(
        project.path.join(".snapback/build/certificates.json"),
        "{not json",
    )
    .unwrap();
    let corrupt = project.run(&["guide", "app", "--json"]);
    assert_eq!(corrupt.status.code(), Some(1));
    assert_eq!(json_stdout(&corrupt)["code"], "E_GUIDE_STALE");

    assert!(project.run(&["check", "--json"]).status.success());
    fs::write(
        project.path.join("snapback/seed.ts"),
        "export default { personas: 'wrong', rows: [] };\n",
    )
    .unwrap();
    let refused_seed = project.run(&["guide", "app", "--json"]);
    assert_eq!(refused_seed.status.code(), Some(1));
    assert_eq!(json_stdout(&refused_seed)["code"], "E_GUIDE_STALE");
}
