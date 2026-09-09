mod common;

use common::{Project, json_stdout};
use std::fs;

#[test]
fn help_is_successful_without_a_project_or_compiler_and_has_no_side_effects() {
    let project = Project::new();
    let before = common::snapshot(&project.path);
    for command in [
        "", "init", "dev", "check", "run", "test", "why", "trace", "data", "logs", "persona",
        "reset", "guide", "doctor", "version",
    ] {
        for flag in ["--help", "-h"] {
            let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_snapback2"));
            if !command.is_empty() {
                child.arg(command);
            }
            let output = child
                .arg(flag)
                .current_dir(&project.path)
                .env("SNAPBACK2_COMPILER", project.path.join("missing-compiler"))
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{command} {flag}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(output.stderr.is_empty(), "{command} {flag}");
            assert!(String::from_utf8_lossy(&output.stdout).starts_with("usage: snapback2"));
        }
    }
    for value_flag in ["--blocked", "--project"] {
        for help in ["-h", "--help"] {
            let output = std::process::Command::new(env!("CARGO_BIN_EXE_snapback2"))
                .args(["test", value_flag, help])
                .current_dir(&project.path)
                .env("SNAPBACK2_COMPILER", project.path.join("missing-compiler"))
                .output()
                .unwrap();
            assert!(output.status.success(), "{value_flag} {help}");
            assert!(output.stderr.is_empty());
            assert!(String::from_utf8_lossy(&output.stdout).starts_with("usage: snapback2 test"));
        }
    }
    assert_eq!(common::snapshot(&project.path), before);
    let unknown = std::process::Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .args(["does-not-exist", "--help"])
        .current_dir(&project.path)
        .output()
        .unwrap();
    assert_eq!(unknown.status.code(), Some(2));
}

#[test]
fn command_guides_explain_initialization_and_successor_recovery() {
    let project = Project::new();
    for (command, needle) in [
        (
            "init",
            "snapback2 init my-app --template chat --client react",
        ),
        (
            "init",
            "VITE_SNAPBACK_URL=\"${snapback_url#SNAPBACK_URL=}\" npm run dev",
        ),
        ("dev", "--apply-migration file"),
        ("check", "does not install"),
    ] {
        let output = project.run(&["guide", command, "--json"]);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
        let page = json_stdout(&output);
        assert_eq!(page["page"], command);
        assert!(page["content"].as_str().unwrap().contains(needle), "{page}");
    }
    let output = project.run(&["test", "--help"]);
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("--journey name"));
    assert!(String::from_utf8_lossy(&output.stdout).contains("--journey=--help"));
    let page = json_stdout(&project.run(&["guide", "testing", "--json"]));
    let content = page["content"].as_str().unwrap();
    for needle in [
        "--journey=--help",
        "--journey=-h",
        "registration drift",
        "Duplicates",
        "Five-second",
    ] {
        assert!(content.contains(needle), "{content}");
    }
    let output = project.run(&["guide", "E_SUCCESSOR_DESTRUCTIVE", "--json"]);
    assert!(output.status.success());
    let page = json_stdout(&output);
    let content = page["content"].as_str().unwrap();
    for needle in [
        "snapback2 dev --apply-migration .snapback/migration-GENERATION.json",
        "does not install",
        "snapback2 dev --status --json",
        "working directory",
    ] {
        assert!(content.contains(needle), "{content}");
    }
    assert!(content.contains("```sh"));
    assert!(!content.contains("```ts"));
}

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
    let output = project.run(&["guide", "E_UNBOUND_SCAN", "--json"]);
    assert!(output.status.success());
    let page = json_stdout(&output);
    let content = page["content"].as_str().unwrap();
    assert!(content.contains("return posts[]"));
    assert!(content.contains("return posts[] first 50 by byTime"));
}

#[test]
fn core_refusal_examples_preserve_markdown_preambles_and_json_fences() {
    let project = Project::new();
    let families: serde_json::Value = serde_json::from_str(include_str!(
        "../../../packages/snapback2/guide/families.source.json"
    )).unwrap();
    let mut count = 0;
    for entry in families.as_array().unwrap() {
        if !entry["wrong"].as_str().unwrap().contains("`snapback2 check --ir`") { continue; }
        count += 1;
        let code = entry["code"].as_str().unwrap();
        let output = project.run(&["guide", code]);
        assert!(output.status.success());
        let expected = format!("# {code}\n\nFamily: `{}`\n\nWrong:\n\n{}\n\nRight:\n\n{}\n",
            entry["family"].as_str().unwrap(), entry["wrong"].as_str().unwrap(), entry["right"].as_str().unwrap());
        let content = String::from_utf8(output.stdout).unwrap();
        assert_eq!(content, expected, "{code}");
        let fences: Vec<_> = content.lines().filter(|line| line.starts_with("```")).collect();
        assert_eq!(fences, ["```json", "```", "```json", "```"], "{code}");
    }
    assert_eq!(count, 6);
}

#[test]
fn quarry_keywords_print_grammar_and_definitions_beside_symbol_help() {
    let project = Project::new();
    let quarry = include_str!("../../../packages/snapback2/guide/quarry.md");
    assert!(quarry.contains("`wordPrefixes(field)` index"));
    assert!(quarry.contains("there is no\npublic `words()` value function"));
    assert!(quarry.contains("rather than redrawn"));
    let search = include_str!("../../../packages/snapback2/guide/live-query.md");
    assert!(search.contains("`by bySearch: conversationId, wordPrefixes(body), at, id`"));
    assert!(search.contains("query search(term: text <=128, c: cursor ?):"));
    assert!(search.contains("must normalize to exactly one word"));
    assert!(search.contains("Its held twin uses\nthe same index"));
    let definitions = [
        ("proc", "statement helper"),
        ("maintain", "count/sum"),
        ("cap", "holds every group at N rows"),
        (
            "unique",
            "declares a named unique ordering and its uniqueness constraint",
        ),
        ("immutable", "forbids changes to those columns"),
        ("public", "accepts an optional reason string"),
        ("merge", "combines structurally distinct"),
        ("shape", "splices"),
        ("retain", "keeps rows that went hidden"),
        ("channel", "typed latest state"),
        ("connected", "read-only virtual table"),
        ("schedule", "declares two triggers, one kind"),
        ("job", "A job can have several independent chunks"),
        (
            "chunk",
            "reads current rows in index order through the upper key",
        ),
        ("after", "`after` follows scan order"),
        ("first", "`first` is ascending"),
        ("last", "`last` is descending"),
        ("require", "aborts when false"),
        ("match", "branches on presence"),
        ("for", "`for` needs a bounded list/page/range/tokens result"),
        (
            "emit",
            "durably queues an effect in the mutation's transaction",
        ),
        ("tokens", "extracts `@` mentions"),
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
    for (keyword, definition) in definitions {
        let output = project.run(&["guide", keyword, "--json"]);
        let page = json_stdout(&output);
        assert!(output.status.success(), "{keyword}: {page}");
        assert_eq!(page["page"], keyword);
        let content = page["content"].as_str().unwrap();
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
            for needle in [
                "immutable snapshot per program run",
                "next execute",
                "up to 1 s",
                "--as",
            ] {
                assert!(
                    paragraph.contains(needle),
                    "connected lacks {needle}: {paragraph}"
                );
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
        // The fallback is declaration-backed symbol help, independent of the
        // generated keyword index. Keep this list on the public functions.
        for keyword in ["decimal", "effect", "seed"] {
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
    assert!(String::from_utf8_lossy(&quarry.stdout).contains("Quarry is the backend language"));
    assert!(String::from_utf8_lossy(&quarry.stdout)
        .contains("`check` compiles in memory; inspection goes in\n`.snapback/build/quarry/`, never `snapback/`"));
    for page in ["grammar"] {
        let output = project.run(&["guide", page]);
        assert!(output.status.success(), "{page}");
        let content = String::from_utf8_lossy(&output.stdout);
        assert!(
            content.contains("`shape`, `fn`, `proc`, and `cursor` are reserved bindings"),
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

    let fanout = project.run(&["guide", "E_STRUCTURAL_FANOUT"]);
    let content = String::from_utf8_lossy(&fanout.stdout);
    assert!(fanout.status.success(), "{content}");
    assert!(content.contains("# E_STRUCTURAL_FANOUT"), "{content}");
    assert!(content.contains("Family: `bound`"), "{content}");
    assert!(content.contains("cap 50 by conversationId"), "{content}");
    assert_eq!(content.matches("```q").count(), 2, "{content}");

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
        // LLP 1017's reviewed complete-by-cap and offline edit recipes share this budget.
        content.len() <= 4_864,
        "offline guide is {} bytes",
        content.len()
    );
    assert!(
        content.contains("drop coverage, keep outbox, fetch program, re-resume"),
        "reset recovery must preserve queued writes and resume before replay"
    );
    assert!(!content.contains("cold-drain"));
    for needle in [
        "receipt",
        "/api/resume",
        "grant",
        "replay",
        "conflict",
        "fenceDays",
        "intent: \"inbox:<key>\"",
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
fn app_guide_uses_chat_expo_operations_without_internal_timer_bindings() {
    let project = Project::new();
    let initialized = project.init("chat", "expo");
    assert!(
        initialized.status.success(),
        "{}",
        json_stdout(&initialized)
    );
    let build = project.path.join(".snapback/build");
    for refresh in [false, true] {
        if refresh {
            let checked = project.run(&["check", "--json"]);
            assert!(checked.status.success(), "{}", json_stdout(&checked));
        }
        let cached: serde_json::Value =
            serde_json::from_slice(&fs::read(build.join("project.json")).unwrap()).unwrap();
        let certificates: serde_json::Value =
            serde_json::from_slice(&fs::read(build.join("certificates.json")).unwrap()).unwrap();
        let schedule = cached["schema"]["schedules"]
            .as_array()
            .unwrap()
            .iter()
            .find(|schedule| schedule["name"] == "expireMessage")
            .unwrap();
        let binding = schedule["binding"].as_str().unwrap();
        assert_eq!(binding, "deliveries._timerBinding_expireMessage");
        assert!(
            cached["programs"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p["name"] == binding)
        );
        assert!(certificates.get(binding).is_none());

        let before = common::snapshot(&build);
        let output = project.run(&["guide", "app", "--json"]);
        let page = json_stdout(&output);
        assert!(output.status.success(), "after check={refresh}: {page}");
        assert_eq!(page["page"], "app");
        let app: serde_json::Value =
            serde_json::from_str(page["content"].as_str().unwrap()).unwrap();
        let operations = app["operations"].as_object().unwrap();
        assert!(!operations.contains_key(binding));
        assert!(operations.contains_key("deliveries.purgeMessage"));
        assert!(operations.contains_key("deliveries.post"));
        assert_eq!(
            operations.keys().collect::<Vec<_>>(),
            certificates.as_object().unwrap().keys().collect::<Vec<_>>()
        );
        for (name, certificate) in certificates.as_object().unwrap() {
            let op = &operations[name];
            assert_eq!(op["readSites"], certificate["read_sites"], "{name}");
            assert_eq!(op["writeSites"], certificate["write_sites"], "{name}");
            assert_eq!(
                op["bounds"]["maxExamined"], certificate["max_examined"],
                "{name}"
            );
            assert_eq!(op["bounds"]["maxSteps"], certificate["max_steps"], "{name}");
            let program = cached["programs"]
                .as_array()
                .unwrap()
                .iter()
                .find(|p| p["name"] == *name)
                .unwrap();
            assert_eq!(op["kind"], program["kind"], "{name}");
            assert_eq!(op["args"], program["args"], "{name}");
        }
        assert_eq!(
            app["tables"].as_object().unwrap().len(),
            cached["schema"]["tables"].as_object().unwrap().len()
        );
        for (name, table) in app["tables"].as_object().unwrap() {
            for field in ["columns", "indexes", "rules", "constraints"] {
                assert_eq!(
                    table[field], cached["schema"]["tables"][name][field],
                    "{name}.{field}"
                );
            }
        }
        assert_eq!(
            app["generation"],
            certificates["deliveries.post"]["schema_hash"]
        );
        assert_eq!(app["channels"], cached["schema"]["channels"]);
        assert!(
            app["personas"]
                .as_array()
                .unwrap()
                .contains(&serde_json::json!("alice"))
        );
        assert_eq!(common::snapshot(&build), before);
    }
}

#[test]
fn app_guide_requires_exposed_operations_even_with_timer_binding_names() {
    let project = Project::new();
    assert!(project.init("chat", "none").status.success());
    fs::write(
        project.path.join("snapback/adversarial.q"),
        "query _timerBinding_exposed():\n  return viewer\n",
    )
    .unwrap();
    let checked = project.run(&["check", "--json"]);
    assert!(checked.status.success(), "{}", json_stdout(&checked));
    let output = project.run(&["guide", "app", "--json"]);
    let page = json_stdout(&output);
    assert!(output.status.success(), "{page}");
    let app: serde_json::Value = serde_json::from_str(page["content"].as_str().unwrap()).unwrap();
    let exposed = "adversarial._timerBinding_exposed";
    assert!(app["operations"].get(exposed).is_some());
    let certificate_path = project.path.join(".snapback/build/certificates.json");
    let valid = fs::read(&certificate_path).unwrap();
    for missing in [exposed, "deliveries.post", "deliveries.purgeMessage"] {
        let mut certificates: serde_json::Value = serde_json::from_slice(&valid).unwrap();
        assert!(
            certificates
                .as_object_mut()
                .unwrap()
                .remove(missing)
                .is_some()
        );
        fs::write(
            &certificate_path,
            serde_json::to_vec(&certificates).unwrap(),
        )
        .unwrap();
        let output = project.run(&["guide", "app", "--json"]);
        let refusal = json_stdout(&output);
        assert_eq!(output.status.code(), Some(1), "{refusal}");
        assert_eq!(refusal["code"], "E_GUIDE_STALE", "{refusal}");
        assert!(
            refusal["message"].as_str().unwrap().contains(missing),
            "{refusal}"
        );
        assert_eq!(refusal["rewrite"], "run snapback2 check");
    }
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
    let valid = fs::read(&certificate_path).unwrap();
    for corrupt in [serde_json::Value::Null, serde_json::json!({}), {
        let mut certificate: serde_json::Value = serde_json::from_slice(&valid).unwrap();
        certificate["todos.list"]["max_steps"] = serde_json::json!(0);
        certificate["todos.list"].take()
    }] {
        let mut certificates: serde_json::Value = serde_json::from_slice(&valid).unwrap();
        certificates["todos.list"] = corrupt;
        fs::write(
            &certificate_path,
            serde_json::to_vec(&certificates).unwrap(),
        )
        .unwrap();
        let output = project.run(&["guide", "app", "--json"]);
        let refusal = json_stdout(&output);
        assert_eq!(output.status.code(), Some(1), "{refusal}");
        assert_eq!(refusal["code"], "E_GUIDE_STALE", "{refusal}");
        assert!(
            refusal["message"].as_str().unwrap().contains("todos.list"),
            "{refusal}"
        );
        assert_eq!(refusal["rewrite"], "run snapback2 check");
    }
    fs::write(&certificate_path, valid).unwrap();
    fs::write(
        project.path.join("snapback/seed.ts"),
        "export default { personas: 'wrong', rows: [] };\n",
    )
    .unwrap();
    let refused_seed = project.run(&["guide", "app", "--json"]);
    assert_eq!(refused_seed.status.code(), Some(1));
    assert_eq!(json_stdout(&refused_seed)["code"], "E_GUIDE_STALE");
}
