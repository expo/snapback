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
fn quarry_keywords_print_grammar_and_definitions_beside_symbol_help() {
    let project = Project::new();
    for (keyword, definition) in [
        ("maintain", "count/sum"),
        ("cap", "holds every group at N rows"),
        ("merge", "fan-ins one or more"),
        ("shape", "splices"),
        ("retain", "keeps rows that went hidden"),
        ("channel", "ephemeral"),
    ] {
        let output = project.run(&["guide", keyword, "--json"]);
        let page = json_stdout(&output);
        assert!(output.status.success(), "{keyword}: {page}");
        assert_eq!(page["page"], keyword);
        let content = page["content"].as_str().unwrap();
        assert!(content.contains(definition), "{keyword}: {content}");
        assert!(content.contains(&format!("`{keyword}`:")), "{content}");
        assert!(
            !content.contains("## Refused platform gaps"),
            "whole page: {content}"
        );
    }
    let text = project.run(&["guide", "maintain"]);
    assert!(text.status.success());
    assert!(String::from_utf8_lossy(&text.stdout).contains("count/sum"));
    // The same names still serve their existing TypeScript declaration.
    for keyword in ["channel", "merge"] {
        let text = project.run(&["guide", keyword]);
        assert!(String::from_utf8_lossy(&text.stdout).contains("export function"));
    }
}

#[test]
fn quarry_grammar_and_refusal_guides_ship_without_double_fences() {
    let project = Project::new();
    let quarry = project.run(&["guide", "quarry"]);
    assert!(quarry.status.success());
    assert!(
        String::from_utf8_lossy(&quarry.stdout)
            .contains("Quarry is Snapback 2's only backend authoring language")
    );
    for page in ["grammar"] {
        assert!(project.run(&["guide", page]).status.success(), "{page}");
    }
    let removed = project.run(&["guide", "typescript", "--json"]);
    assert_eq!(removed.status.code(), Some(1));
    assert_eq!(json_stdout(&removed)["code"], "E_GUIDE_UNKNOWN");
    let refusal = project.run(&["guide", "E_QUARRY_TYPE"]);
    let content = String::from_utf8_lossy(&refusal.stdout);
    assert!(refusal.status.success(), "{content}");
    assert_eq!(content.matches("```q").count(), 2, "{content}");
    assert!(!content.contains("```ts\n```q"), "{content}");

    let unknown = project.run(&["guide", "does-not-exist", "--json"]);
    assert_eq!(unknown.status.code(), Some(1));
    let refusal = json_stdout(&unknown);
    assert_eq!(refusal["code"], "E_GUIDE_UNKNOWN");
    let rewrite = refusal["rewrite"].as_str().unwrap();
    for page in ["grammar", "quarry", "live-query", "schedule", "job"] {
        assert!(rewrite.contains(page), "{rewrite}");
    }
    let message = refusal["message"].as_str().unwrap_or_default();
    assert!(message.contains("available:") && message.contains("quarry"));
}

#[test]
fn offline_guide_page_respects_its_budget_and_its_codes_have_pages() {
    let project = Project::new();
    let output = project.run(&["guide", "offline", "--json"]);
    assert!(output.status.success());
    let page = json_stdout(&output);
    let content = page["content"].as_str().unwrap();
    assert!(
        // LLP 1017 adds the complete-by-cap explanation beside the edit recipe.
        content.len() <= 4_352,
        "offline guide is {} bytes",
        content.len()
    );
    assert!(
        content.contains("fetch `/api/program`,\nre-resume."),
        "reset recovery must resume before replay"
    );
    assert!(!content.contains("cold-drain"));
    for needle in [
        "receipt",
        "/api/resume",
        "grant",
        "replay",
        "conflict",
        "fenceDays",
        "mutation edit(",
        "E_OFFLINE_RESET",
        "E_OFFLINE_RESUME",
        "E_OFFLINE_INTENT_EXPIRED",
        "E_OFFLINE_INTENT_REUSE",
        "E_OFFLINE_ID_BLOCK",
        "E_OFFLINE_AUTHORITY",
    ] {
        assert!(content.contains(needle), "offline guide lacks {needle}");
    }
    for code in [
        "E_OFFLINE_RESET",
        "E_OFFLINE_RESUME",
        "E_OFFLINE_INTENT_EXPIRED",
        "E_OFFLINE_INTENT_REUSE",
        "E_OFFLINE_ID_BLOCK",
        "E_OFFLINE_AUTHORITY",
    ] {
        let refusal = project.run(&["guide", code]);
        let text = String::from_utf8_lossy(&refusal.stdout);
        assert!(refusal.status.success(), "{code}: {text}");
        assert!(text.contains("Family: `offline`"), "{code}: {text}");
    }
    let listed = project.run(&["guide", "does-not-exist", "--json"]);
    assert!(
        json_stdout(&listed)["message"]
            .as_str()
            .is_some_and(|message| message.contains("offline"))
    );
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
