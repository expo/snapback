mod common;

use common::{OwnerGuard, Project, json_stdout};
use std::fs;

fn check<'a>(receipt: &'a serde_json::Value, name: &str) -> &'a serde_json::Value {
    receipt["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|check| check["name"] == name)
        .unwrap_or_else(|| panic!("missing {name} check in {receipt}"))
}

#[test]
fn chat_template_receipt_tracks_the_effect_engine_and_lists_both_journeys() {
    let project = Project::new();
    let initialized = project.init("chat", "none");
    assert!(
        initialized.status.success(),
        "init failed: {}{}",
        String::from_utf8_lossy(&initialized.stdout),
        String::from_utf8_lossy(&initialized.stderr)
    );
    let output = project.run(&["test", "--json"]);
    let receipt = json_stdout(&output);
    let checks = receipt["checks"].as_array().unwrap();
    let rules = check(&receipt, "rules");
    assert_eq!(rules["verdict"], "pass", "{rules}");
    assert_eq!(rules["detail"]["tables"]["memberships"]["probes"], 9);
    assert_eq!(rules["detail"]["tables"]["messages"]["probes"], 6);
    assert_eq!(rules["detail"]["tables"]["notifications"]["probes"], 3);
    assert_eq!(rules["detail"]["expectedBy"], "engine");
    assert_eq!(rules["detail"]["actualBy"], "data");
    for name in ["certify", "rules", "bounds", "invalidation", "replay"] {
        let derived = check(&receipt, name);
        assert_eq!(derived["verdict"], "pass", "{name}: {derived}");
    }

    let invalidation = check(&receipt, "invalidation");
    assert!(
        invalidation["detail"]["silenceProbes"]
            .as_u64()
            .is_some_and(|count| count > 0),
        "the chat receipt did not exercise an invalidation silence probe: {invalidation}"
    );
    assert_eq!(
        invalidation["detail"]["revocationWhileLive"]["status"], "pass",
        "the chat receipt did not prove live membership revocation: {invalidation}"
    );
    assert_eq!(
        invalidation["detail"]["staleHandle"]["status"], "pass",
        "the chat receipt did not prove successor handle replanning: {invalidation}"
    );
    let bounds = check(&receipt, "bounds");
    let executions = bounds["detail"]["executions"].as_array().unwrap();
    assert_eq!(executions.len(), 2, "{bounds}");
    for execution in executions {
        assert_eq!(execution["op"], "messages.thread", "{execution}");
        assert_eq!(
            execution["examined"],
            serde_json::json!({ "actual": 1, "ceiling": 52 })
        );
        assert_eq!(
            execution["ruleProbes"],
            serde_json::json!({ "actual": 1, "ceiling": 1 })
        );
        assert_eq!(
            execution["steps"],
            serde_json::json!({ "actual": 3, "ceiling": 262 })
        );
        assert_eq!(
            execution["readSites"][0]["calls"],
            serde_json::json!({ "actual": 1, "ceiling": 1 })
        );
        assert_eq!(execution["readSites"][0]["take"], 50);
    }
    assert_eq!(
        checks
            .iter()
            .filter(|check| check["kind"] == "journey")
            .count(),
        2
    );
    for name in [
        "alice sends bob a message",
        "bob replies and alice's live thread updates",
    ] {
        let journey = check(&receipt, name);
        assert_eq!(journey["kind"], "journey", "{name}: {journey}");
        assert_eq!(journey["verdict"], "pass", "{name}: {journey}");
    }
    if cfg!(feature = "hermes") {
        assert!(checks.iter().any(|check| {
            check["name"] == "effects"
                && check["verdict"] == "pass"
                && check["detail"]["engine"] == "ibex2 + vanilla hermes"
        }));
    } else {
        assert_eq!(output.status.code(), Some(1));
        assert_eq!(receipt["verdict"], "blocked");
        assert!(checks.iter().any(|check| {
            check["name"] == "effects"
                && check["verdict"] == "blocked"
                && check["detail"]["reason"] == "no engine in this build"
        }));
    }
    let scratch = fs::read_dir(project.path.join(".snapback"))
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with("test-") || name.starts_with("test-run-"))
        .collect::<Vec<_>>();
    assert!(
        scratch.is_empty(),
        "test left temporary stores behind: {scratch:?}"
    );
}

#[test]
fn unmatched_bare_id_blocks_with_the_operation_and_argument_name() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::write(
        project.path.join("snapback/todos.ts"),
        r#"import { query, t } from "snapback2";
export const byOwner = query({ ownerId: t.id() }, ({ args }) => args.ownerId);
"#,
    )
    .unwrap();
    fs::remove_dir_all(project.path.join("snapback/tests")).unwrap();
    assert!(project.run(&["check", "--json"]).status.success());

    let tested = project.run(&["test", "--derived-only", "--json"]);
    assert_eq!(tested.status.code(), Some(1));
    let receipt = json_stdout(&tested);
    let bounds = check(&receipt, "bounds");
    assert_eq!(bounds["verdict"], "blocked", "{bounds}");
    assert_eq!(
        bounds["detail"]["blocked"][0]["reason"],
        "cannot choose a seed id for todos.byOwner.ownerId",
        "{bounds}"
    );
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
fn owner_start_does_not_compile_journey_sources() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::write(
        project.path.join("snapback/tests/todos.test.ts"),
        r#"import { journey } from "snapback2/test";
journey("bad after check", async () => { const n: number = "wrong"; void n; });
"#,
    )
    .unwrap();

    let _owner = OwnerGuard::start(&project);
}

#[test]
fn test_runs_check_to_restore_a_missing_built_journey_before_owner_start() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::remove_dir_all(project.path.join(".snapback/build/tests")).unwrap();

    let output = project.run(&["test", "--journeys-only", "--json"]);

    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let receipt = json_stdout(&output);
    assert_eq!(receipt["checks"][0]["name"], "todos round trip");
    assert_eq!(receipt["checks"][0]["verdict"], "pass");
    assert!(
        project
            .path
            .join(".snapback/build/tests/todos.mjs")
            .is_file()
    );
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
  db.insert(todos, { id: ctx.newId(), title: "never", done: false, ownerId: ctx.viewer });
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
    let replay = check(&receipt, "replay");
    assert_eq!(replay["verdict"], "blocked");
    assert_eq!(
        replay["detail"]["blocked"][0]["reason"],
        "no committing probe for todos.add"
    );
}

#[test]
fn invalidation_blocks_when_a_query_has_no_disjoint_committing_probe() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::write(
        project.path.join("snapback/schema.ts"),
        r#"import { rule, schema, table, t } from "snapback2";
export const items = table({
  columns: { label: t.text(20) },
  rules: { read: rule.public("public"), insert: rule.allow(), update: rule.allow(), delete: rule.allow() },
});
export default schema({ auth: { password: true, guests: true }, tables: { items } });
"#,
    )
    .unwrap();
    fs::write(
        project.path.join("snapback/todos.ts"),
        r#"import { mutation, query, t } from "snapback2";
import { items } from "./schema";
export const list = query({}, ({ db }) => db.scan(items.byId, [], { take: 50 }));
export const add = mutation({ label: t.text(20) }, ({ db, ctx, args }) => {
  db.insert(items, { id: ctx.newId(), label: args.label });
  return null;
});
"#,
    )
    .unwrap();
    fs::write(
        project.path.join("snapback/seed.ts"),
        r#"import { seed } from "snapback2";
export default seed({ personas: ["alice"], rows: { items: [{ id: "item-1", label: "one" }] } });
"#,
    )
    .unwrap();
    fs::remove_dir_all(project.path.join("snapback/tests")).unwrap();
    assert!(project.run(&["check", "--json"]).status.success());

    let output = project.run(&["test", "--derived-only", "--json"]);
    assert_eq!(output.status.code(), Some(1));
    let receipt = json_stdout(&output);
    let invalidation = check(&receipt, "invalidation");
    assert_eq!(invalidation["verdict"], "blocked", "{invalidation}");
    assert!(
        invalidation["detail"]["blocked"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["reason"] == "no disjoint committing probe for todos.list"),
        "{invalidation}"
    );
}

#[test]
fn rules_use_the_engine_verdict_when_the_synthetic_persona_is_admitted() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::write(
        project.path.join("snapback/schema.ts"),
        r#"import { rule, schema, table, t } from "snapback2";
export const items = table({
  columns: { label: t.text(20), ownerId: t.id() },
  rules: { read: rule.viewerIs("ownerId"), insert: rule.allow(), update: rule.allow(), delete: rule.allow() },
});
export default schema({ auth: { password: true, guests: true }, tables: { items } });
"#,
    )
    .unwrap();
    fs::write(
        project.path.join("snapback/todos.ts"),
        r#"import { query } from "snapback2";
import { items } from "./schema";
export const list = query({}, ({ db }) => db.scan(items.byId, [], { take: 50 }));
"#,
    )
    .unwrap();
    fs::write(
        project.path.join("snapback/seed.ts"),
        r#"import { seed } from "snapback2";
export default seed({ personas: ["alice"], rows: { items: [{ id: "item-1", label: "one", ownerId: "dev:alice" }] } });
"#,
    )
    .unwrap();
    fs::remove_dir_all(project.path.join("snapback/tests")).unwrap();
    assert!(project.run(&["check", "--json"]).status.success());

    let output = project.run(&["test", "--derived-only", "--json"]);
    let receipt = json_stdout(&output);
    let rules = check(&receipt, "rules");
    assert_eq!(rules["verdict"], "pass", "{rules}");
    assert_eq!(rules["detail"]["tables"]["items"]["personas"], 2);
    assert_eq!(rules["detail"]["tables"]["items"]["probes"], 2);
}

#[test]
fn rules_block_and_name_a_rule_bearing_table_with_no_seed_rows() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::write(
        project.path.join("snapback/seed.ts"),
        r#"import { seed } from "snapback2";
export default seed({ personas: ["alice"], rows: { todos: [] } });
"#,
    )
    .unwrap();
    assert!(project.run(&["check", "--json"]).status.success());

    let output = project.run(&["test", "--derived-only", "--json"]);
    assert_eq!(output.status.code(), Some(1));
    let receipt = json_stdout(&output);
    let rules = check(&receipt, "rules");
    assert_eq!(rules["verdict"], "blocked");
    assert_eq!(
        rules["detail"]["blocked"][0]["reason"],
        "no seed rows for todos"
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

#[test]
fn blocked_without_a_reason_is_usage() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());

    let output = project.run(&["test", "--blocked"]);

    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("--blocked reason"));
}
