mod common;

use common::{Project, json_stdout};
use std::fs;

#[test]
fn package_consumers_and_isolated_compiler_use_complete_private_snapshots() {
    let project = Project::new();
    let snapshot_root = project.package_snapshot_root();
    let shared_dist = common::shared_package_dist();
    let consumers = project.package_consumer_paths();
    let compiler_root = project.path.join("isolated-compiler-package");
    let compiler = common::isolated_compiler(&compiler_root);

    assert_eq!(consumers.len(), 4, "package fixture consumer set changed");
    for (name, path) in consumers {
        assert!(
            path.starts_with(snapshot_root),
            "{name} escaped private package snapshot: {}",
            path.display()
        );
        assert!(
            !path.starts_with(&shared_dist),
            "{name} still consumes shared dist: {}",
            path.display()
        );
    }

    assert!(
        compiler.starts_with(&compiler_root),
        "isolated compiler escaped private package snapshot: {}",
        compiler.display()
    );
    assert!(
        !compiler.starts_with(&shared_dist),
        "isolated compiler still consumes shared dist: {}",
        compiler.display()
    );

    let (shared_files, private_files) = project.package_dist_snapshots();
    assert!(!shared_files.is_empty(), "shared package dist is empty");
    assert_eq!(
        private_files, shared_files,
        "private package snapshot does not match the complete shared dist"
    );

    let (shared_files, compiler_files) = common::package_dist_snapshots(&compiler_root);
    assert!(!shared_files.is_empty(), "shared package dist is empty");
    assert_eq!(
        compiler_files, shared_files,
        "isolated compiler snapshot does not match the complete shared dist"
    );
}

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
