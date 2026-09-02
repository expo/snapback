mod common;

use common::{Project, json_stdout, shared_package_dist, snapshot};
use serde_json::Value as Json;
use std::path::Path;

#[cfg(unix)]
use std::os::unix::fs::{PermissionsExt, symlink};

fn built_template_precondition(rendering: &str, schema: &str) {
    let path = shared_package_dist()
        .join("templates")
        .join(rendering)
        .join("snapback")
        .join(schema);
    assert!(
        path.is_file(),
        "precondition: built template is missing at {}; run (cd packages/snapback2 && node build.mjs)",
        path.display()
    );
}

fn assert_rendering(template: &str, typescript: bool, chat: bool) {
    let rendering = if typescript {
        format!("{template}-ts")
    } else {
        template.to_owned()
    };
    built_template_precondition(
        &rendering,
        if typescript { "schema.ts" } else { "schema.q" },
    );
    let project = Project::new();
    let initialized = if typescript {
        project.init_ts(template, "none")
    } else {
        project.init(template, "none")
    };
    assert!(
        initialized.status.success(),
        "init failed: {}{}",
        String::from_utf8_lossy(&initialized.stdout),
        String::from_utf8_lossy(&initialized.stderr)
    );
    let stale_inspection = project.path.join(".snapback/build/quarry/stale.ts");
    if !typescript && template == "todos" {
        std::fs::write(&stale_inspection, "stale").expect("write stale inspection fixture");
    }
    let checked = project.run(&["check", "--json"]);
    assert!(
        checked.status.success(),
        "check failed: {}{}",
        String::from_utf8_lossy(&checked.stdout),
        String::from_utf8_lossy(&checked.stderr)
    );

    if !typescript && template == "todos" {
        assert!(
            !stale_inspection.exists(),
            "check retained a stale Quarry inspection entry"
        );
        for generated in ["schema.ts", "todos.ts"] {
            let source = std::fs::read_to_string(
                project.path.join(".snapback/build/quarry").join(generated),
            )
            .unwrap_or_else(|error| panic!("missing Quarry inspection copy {generated}: {error}"));
            assert!(source.starts_with("// GENERATED"), "{generated}: {source}");
        }
    }

    let tested = project.run(&["test", "--json"]);
    let receipt = json_stdout(&tested);
    if chat {
        assert_eq!(tested.status.code(), Some(1), "{receipt}");
        assert_eq!(receipt["verdict"], "blocked", "{receipt}");
        let checks = receipt["checks"].as_array().unwrap();
        for check in checks.iter().filter(|check| check["kind"] == "derived") {
            if check["name"] == "effects" {
                assert_eq!(check["verdict"], "blocked", "{check}");
                assert_eq!(
                    check["detail"]["reason"], "no engine in this build",
                    "{check}"
                );
            } else {
                assert_eq!(check["verdict"], "pass", "{check}");
            }
        }
        let journeys = checks
            .iter()
            .filter(|check| check["kind"] == "journey")
            .collect::<Vec<_>>();
        assert_eq!(journeys.len(), 7, "{receipt}");
        assert!(
            journeys.iter().all(|check| check["verdict"] == "pass"),
            "{receipt}"
        );
    } else {
        assert!(
            tested.status.success(),
            "test failed: {}{}",
            String::from_utf8_lossy(&tested.stdout),
            String::from_utf8_lossy(&tested.stderr)
        );
        assert_eq!(receipt["verdict"], "pass", "{receipt}");
    }
}

#[test]
fn quarry_todos_init_check_and_test_end_to_end() {
    assert_rendering("todos", false, false);
}

#[test]
fn quarry_chat_init_check_and_test_end_to_end() {
    assert_rendering("chat", false, true);
}

#[test]
fn typescript_todos_init_check_and_test_end_to_end() {
    assert_rendering("todos", true, false);
}

#[test]
fn typescript_chat_init_check_and_test_end_to_end() {
    assert_rendering("chat", true, true);
}

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

#[test]
fn chat_template_ships_exactly_its_complete_owned_tree() {
    fn files(root: &Path, directory: &Path, output: &mut Vec<String>) {
        for entry in std::fs::read_dir(directory).unwrap().flatten() {
            if entry.path().is_dir() {
                files(root, &entry.path(), output);
            } else {
                output.push(
                    entry
                        .path()
                        .strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
            }
        }
    }

    let project = Project::new();
    let initialized = project.init("chat", "none");
    assert!(
        initialized.status.success(),
        "init failed: {}{}",
        String::from_utf8_lossy(&initialized.stdout),
        String::from_utf8_lossy(&initialized.stderr)
    );
    let snapback = project.path.join("snapback");
    let mut shipped = Vec::new();
    files(&snapback, &snapback, &mut shipped);
    shipped.sort();
    assert_eq!(
        shipped,
        [
            "feeds.q",
            "follows.q",
            "groups.q",
            "messages.q",
            "notifications.ts",
            "posts.q",
            "profiles.q",
            "schema.q",
            "seed.ts",
            "tests/chat.test.ts",
        ]
    );
}

#[cfg(unix)]
#[test]
fn init_refuses_managed_symlinks_without_writing_through_them() {
    let project = Project::new();
    let outside_file = project.path.parent().unwrap().join("outside-agents");
    let original = b"leave me alone\n";
    std::fs::write(&outside_file, original).unwrap();
    symlink(&outside_file, project.path.join("AGENTS.md")).unwrap();

    let file_result = project.init("todos", "none");
    assert!(!file_result.status.success());
    assert_eq!(std::fs::read(&outside_file).unwrap(), original);

    std::fs::remove_file(project.path.join("AGENTS.md")).unwrap();
    let outside_directory = project.path.parent().unwrap().join("outside-snapback");
    std::fs::create_dir(&outside_directory).unwrap();
    symlink(&outside_directory, project.path.join("snapback")).unwrap();

    let directory_result = project.init("todos", "none");
    assert!(!directory_result.status.success());
    assert_eq!(std::fs::read_dir(outside_directory).unwrap().count(), 0);
}

#[test]
fn init_refuses_non_utf8_managed_text_without_changing_bytes() {
    for name in ["AGENTS.md", ".gitignore"] {
        let project = Project::new();
        let path = project.path.join(name);
        let original = b"preserve\xffbytes\n";
        std::fs::write(&path, original).unwrap();

        let output = project.init("todos", "none");
        assert!(
            !output.status.success(),
            "init unexpectedly accepted {name}"
        );
        assert_eq!(std::fs::read(path).unwrap(), original, "changed {name}");
    }
}

#[cfg(unix)]
#[test]
fn init_refuses_unreadable_managed_text_without_changing_bytes() {
    let project = Project::new();
    let path = project.path.join("AGENTS.md");
    let original = b"write-only but existing\n";
    std::fs::write(&path, original).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o200)).unwrap();

    let output = project.init("todos", "none");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    assert!(!output.status.success());
    assert_eq!(std::fs::read(path).unwrap(), original);
}
