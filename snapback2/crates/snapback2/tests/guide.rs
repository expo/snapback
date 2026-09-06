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
    let quarry = include_str!("../../../packages/snapback2/guide/quarry.md");
    assert!(quarry.contains("`share`, and `words`"));
    assert!(quarry.contains("rather than redrawn"));
    let search = include_str!("../../../packages/snapback2/guide/live-query.md");
    assert!(search.contains("`words(a ?? b)` uses the larger declared text\nmaximum"));
    assert!(search.contains("already-lowercased ASCII word"));
    assert!(search.contains("unindexed nonempty body refuses `NOT_FOUND`"));
    let definitions = [
        ("maintain", "count/sum"),
        ("cap", "holds every group at N rows"),
        (
            "unique",
            "declares a named unique ordering and its uniqueness constraint",
        ),
        ("immutable", "forbids changes to those columns"),
        ("public", "accepts an optional reason string"),
        ("merge", "fan-ins one or more"),
        ("shape", "splices"),
        ("retain", "keeps rows that went hidden"),
        ("channel", "ephemeral events"),
        ("connected", "read-only virtual table"),
        ("schedule", "declares two triggers, one kind"),
        ("job", "A job can have several independent chunks"),
        (
            "chunk",
            "reads current rows in index order through the upper key",
        ),
        ("after", "`after` follows scan order"),
        ("first", "`first N` scans ascending"),
        ("last", "`last N` scans descending"),
        ("require", "aborts when false"),
        ("match", "branches on presence"),
        (
            "for",
            "iterates only a bounded list/page/range/tokens/words result",
        ),
        (
            "emit",
            "durably queues an effect in the mutation's transaction",
        ),
        ("tokens", "extracts `@` mentions"),
        ("words", "bounded ASCII whole words"),
        ("divmod", "remainder is nonnegative"),
    ];
    let grammar = project.run(&["guide", "grammar", "--json"]);
    assert!(grammar.status.success());
    let grammar = json_stdout(&grammar);
    let lines: Vec<_> = grammar["content"]
        .as_str()
        .unwrap()
        .lines()
        .filter_map(|line| {
            line.strip_prefix("- `").and_then(|rest| {
                rest.split_once("`: ")
                    .map(|(keyword, _)| (keyword, &line[2..]))
            })
        })
        .collect();
    assert_eq!(
        lines.len(),
        definitions.len(),
        "cover every grammar construct"
    );
    assert!(lines.iter().find(|(name, _)| *name == "for").unwrap().1.contains("tokens/words"));
    for (keyword, definition) in definitions {
        let output = project.run(&["guide", keyword, "--json"]);
        let page = json_stdout(&output);
        assert!(output.status.success(), "{keyword}: {page}");
        assert_eq!(page["page"], keyword);
        let content = page["content"].as_str().unwrap();
        if keyword == "words" {
            assert!(content.contains("refuses `+`/template-built text"));
            assert!(content.contains("body: text <=N"));
        }
        assert_eq!(
            content
                .lines()
                .filter(|line| line.starts_with("# "))
                .count(),
            1,
            "{keyword}: {content}"
        );
        let grammar_line = lines.iter().find(|(name, _)| *name == keyword).unwrap().1;
        // Page lookup deliberately wins for these two construct names (LLP 1002 §8).
        let paragraph = if ["job", "schedule"].contains(&keyword) {
            content
        } else {
            assert!(content.contains(grammar_line), "{keyword}: {content}");
            let (_, excerpt) = content.split_once("\n\n## ").expect("definition heading");
            let (_, paragraph) = excerpt.split_once("\n\n").expect("defining paragraph");
            assert!(
                paragraph.contains(&format!("`{keyword}")),
                "{keyword}: {paragraph}"
            );
            paragraph
        };
        let paragraph = paragraph.split_whitespace().collect::<Vec<_>>().join(" ");
        assert!(paragraph.contains(definition), "{keyword}: {paragraph}");
        if keyword == "connected" {
            assert!(content.contains("## live-query: Connected\n"), "{content}");
            for needle in ["immutable snapshot per program run", "next execute", "up to 1 s", "--as"] {
                assert!(paragraph.contains(needle), "connected lacks {needle}: {paragraph}");
            }
        }
        if keyword == "channel" {
            for needle in [
                "recent activity",
                "heartbeat interval plus the expiry",
                "Do not gate delivery",
                "durable receipts",
                "workaround",
            ] {
                assert!(
                    paragraph.contains(needle),
                    "channel lacks {needle}: {paragraph}"
                );
            }
        }
        if keyword == "for" {
            assert!(paragraph.contains("E_STRUCTURAL_FANOUT"), "{paragraph}");
        }
        if keyword == "emit" {
            assert!(
                paragraph.ends_with('.'),
                "dangling emit lead-in: {paragraph}"
            );
        }
        assert!(
            !content.contains("## Refused platform gaps"),
            "whole page: {content}"
        );
    }
    let text = project.run(&["guide", "maintain"]);
    assert!(text.status.success());
    assert!(String::from_utf8_lossy(&text.stdout).contains("count/sum"));
    for keyword in ["channel", "merge", "divmod", "emit"] {
        let text = project.run(&["guide", keyword]);
        assert!(text.status.success());
        let content = String::from_utf8_lossy(&text.stdout);
        assert!(content.contains("export function"), "{content}");
        assert!(content.contains(&format!("`{keyword}`:")), "{content}");
        assert_eq!(
            content.matches(&format!("# `{keyword}`")).count(),
            1,
            "{content}"
        );
    }
}

#[test]
fn symbol_help_survives_missing_corrupt_and_unreadable_keyword_indexes() {
    let project = Project::new();
    let guide = project.package_snapshot_root().join("dist/guide");
    let index = guide.join("keywords.json");
    fs::remove_file(&index).unwrap();
    for (state, code) in [
        ("missing", "E_GUIDE_UNKNOWN"),
        ("corrupt", "E_OWNER_GUIDE"),
        ("unreadable", "E_OWNER_GUIDE"),
    ] {
        if state == "corrupt" {
            fs::write(&index, "{not json").unwrap();
        }
        if state == "unreadable" {
            fs::remove_file(&index).unwrap();
            fs::create_dir(&index).unwrap();
        }
        for keyword in ["decimal", "channel", "merge", "divmod", "emit"] {
            let output = project.run(&["guide", keyword, "--json"]);
            let page = json_stdout(&output);
            assert!(output.status.success(), "{state} {keyword}: {page}");
            assert_eq!(page["page"], keyword);
            assert!(
                page["content"]
                    .as_str()
                    .unwrap()
                    .contains("export function"),
                "{page}"
            );
        }
        let output = project.run(&["guide", "maintain", "--json"]);
        assert_eq!(output.status.code(), Some(1));
        let refusal = json_stdout(&output);
        assert_eq!(refusal["code"], code, "{state}: {refusal}");
        assert!(
            refusal["rewrite"]
                .as_str()
                .is_some_and(|text| !text.is_empty())
        );
        if code == "E_OWNER_GUIDE" {
            assert!(refusal["rewrite"].as_str().unwrap().contains("reinstall"));
        }
    }
}

#[test]
fn source_checkout_without_keyword_index_still_serves_lib_symbols() {
    let source =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/snapback2/guide");
    assert!(!source.join("keywords.json").exists());
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .env("SNAPBACK2_GUIDE", source)
        .args(["guide", "decimal", "--json"])
        .output()
        .unwrap();
    let page = json_stdout(&output);
    assert!(output.status.success(), "{page}");
    assert_eq!(page["page"], "decimal");
    assert!(
        page["content"]
            .as_str()
            .unwrap()
            .contains("export function decimal")
    );
}

#[test]
fn live_query_guide_explains_connected_and_the_activity_workaround() {
    let project = Project::new();
    let output = project.run(&["guide", "live-query", "--json"]);
    assert!(output.status.success());
    let page = json_stdout(&output);
    let content = page["content"].as_str().unwrap();
    for needle in [
        "recent activity",
        "heartbeat interval plus the expiry",
        "seen late",
        "read-only virtual table",
        "`#connected[p]`",
        "`hydrating` and never predicted",
        "live reruns wait up to 1 s",
        "durable receipts",
        "workaround",
    ] {
        assert!(
            content.contains(needle),
            "live-query lacks {needle}: {content}"
        );
    }
}

#[test]
fn quarry_grammar_and_refusal_guides_ship_without_double_fences() {
    let project = Project::new();
    let quarry = project.run(&["guide", "quarry"]);
    assert!(quarry.status.success());
    assert!(
        String::from_utf8_lossy(&quarry.stdout)
            .contains("Quarry is the only backend language")
    );
    assert!(String::from_utf8_lossy(&quarry.stdout)
        .contains("puts no generated files in `snapback/`"));
    for page in ["grammar"] {
        let output = project.run(&["guide", page]);
        assert!(output.status.success(), "{page}");
        let content = String::from_utf8_lossy(&output.stdout);
        assert!(
            content.contains("`shape`, `fn`, and `cursor` are reserved bindings"),
            "{content}"
        );
        for line in content.lines().filter(|line| line.starts_with("- `")) {
            assert!(
                line.ends_with('.'),
                "construct lacks closing period: {line}"
            );
        }
    }
    let removed = project.run(&["guide", "typescript", "--json"]);
    assert_eq!(removed.status.code(), Some(1));
    assert_eq!(json_stdout(&removed)["code"], "E_GUIDE_UNKNOWN");
    let refusal = project.run(&["guide", "E_QUARRY_TYPE"]);
    let content = String::from_utf8_lossy(&refusal.stdout);
    assert!(refusal.status.success(), "{content}");
    assert_eq!(content.matches("```q").count(), 2, "{content}");
    assert!(!content.contains("```ts\n```q"), "{content}");

    let unknown = project.run(&["guide", "maintan", "--json"]);
    assert_eq!(unknown.status.code(), Some(1));
    let refusal = json_stdout(&unknown);
    assert_eq!(refusal["code"], "E_GUIDE_UNKNOWN");
    assert_eq!(refusal["family"], "input");
    assert_eq!(refusal["guide"], "input/guide");
    let rewrite = refusal["rewrite"].as_str().unwrap();
    for page in ["grammar", "quarry", "live-query", "schedule", "job"] {
        assert!(rewrite.contains(page), "{rewrite}");
    }
    let message = refusal["message"].as_str().unwrap_or_default();
    assert!(message.contains("available:") && message.contains("quarry"));
    assert!(
        message
            .split("available: ")
            .nth(1)
            .unwrap()
            .split(", ")
            .any(|name| name == "maintain"),
        "{message}"
    );
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
