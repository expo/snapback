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

fn without_export(source: &str, name: &str) -> String {
    let marker = format!("export const {name} =");
    let start = source
        .find(&marker)
        .unwrap_or_else(|| panic!("fixture had no {name} export"));
    let end = source[start + marker.len()..]
        .find("\nexport const ")
        .map(|offset| start + marker.len() + offset + 1)
        .unwrap_or(source.len());
    let mut output = source.to_owned();
    output.replace_range(start..end, "");
    output
}

#[test]
fn chat_template_receipt_tracks_the_effect_engine_and_lists_all_journeys() {
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
    assert_eq!(rules["detail"]["tables"]["memberships"]["probes"], 16);
    assert_eq!(rules["detail"]["tables"]["messages"]["probes"], 8);
    assert_eq!(rules["detail"]["tables"]["notifications"]["probes"], 4);
    assert_eq!(rules["detail"]["expectedBy"], "engine");
    assert_eq!(rules["detail"]["actualBy"], "data");
    for name in [
        "certify",
        "rules",
        "bounds",
        "invalidation",
        "replay",
        "live-revocation",
        "successor-policy-fence",
    ] {
        let derived = check(&receipt, name);
        assert_eq!(derived["verdict"], "pass", "{name}: {derived}");
    }

    let revocation = check(&receipt, "live-revocation");
    assert_eq!(revocation["detail"]["as"], "bob", "{revocation}");
    assert_eq!(
        revocation["detail"]["query"], "messages.thread",
        "{revocation}"
    );
    assert_eq!(
        revocation["detail"]["scope"], "conversation-1",
        "{revocation}"
    );
    assert_eq!(
        revocation["detail"]["mutation"], "groups.memberLeave",
        "{revocation}"
    );
    assert_eq!(revocation["detail"]["initialState"], "complete");
    assert_eq!(revocation["detail"]["deliveryState"], "denied");
    assert_eq!(
        revocation["detail"]["deliverySeq"],
        revocation["detail"]["mutationSeq"]
    );
    assert_eq!(revocation["detail"]["postDenialRows"], 0);
    assert_eq!(
        revocation["detail"]["protectedWrite"], "messages.send",
        "{revocation}"
    );
    assert_eq!(revocation["detail"]["protectedWriteAs"], "alice");
    assert_eq!(revocation["detail"]["protectedTable"], "messages");
    assert!(
        revocation["detail"]["protectedWriteSeq"]
            .as_u64()
            .zip(revocation["detail"]["mutationSeq"].as_u64())
            .is_some_and(|(write, revoke)| write > revoke),
        "{revocation}"
    );
    assert_eq!(revocation["detail"]["protectedRowsWritten"], 1);
    assert_eq!(
        revocation["detail"]["maintainedRowsWritten"]["messageCounts"], 1,
        "{revocation}"
    );
    assert_eq!(revocation["detail"]["postWriteDelivery"], "none");

    let fence = check(&receipt, "successor-policy-fence");
    assert_ne!(
        fence["detail"]["generationG"], fence["detail"]["generationG1"],
        "{fence}"
    );
    assert_ne!(
        fence["detail"]["generationG1"], fence["detail"]["generationG2"],
        "{fence}"
    );
    assert_eq!(
        fence["detail"]["generationG"], fence["detail"]["generationG2"],
        "{fence}"
    );
    assert_ne!(
        fence["detail"]["planHashG"], fence["detail"]["planHashG2"],
        "{fence}"
    );
    assert_eq!(fence["detail"]["generationScope"], "schema");
    assert_eq!(fence["detail"]["policyReplacement"], "Deny");
    assert_eq!(fence["detail"]["policyRetainedHandleState"], "complete");
    assert_eq!(fence["detail"]["policyRetainedHandleRows"], 0);
    assert_eq!(fence["detail"]["policyFreshInvocationState"], "complete");
    assert_eq!(fence["detail"]["policyFreshInvocationRows"], 0);
    let successor_rule = format!(
        "SNAPBACK2_TEST_SUCCESSOR_POLICY_FENCE:{}",
        fence["detail"]["generationG"].as_str().unwrap()
    );
    assert_eq!(fence["detail"]["successorDenialRule"], successor_rule);
    assert_eq!(fence["detail"]["retainedHandleState"], "denied");
    assert_eq!(fence["detail"]["retainedHandleRule"], successor_rule);
    assert_eq!(fence["detail"]["freshInvocationState"], "denied");
    assert_eq!(fence["detail"]["freshInvocationRule"], successor_rule);
    assert_eq!(
        fence["detail"]["activeManifestGeneration"],
        fence["detail"]["generationG2"]
    );

    let aba = check(&receipt, "grant-incarnation-aba");
    assert_eq!(aba["verdict"], "pass", "{aba}");
    assert_eq!(aba["detail"]["promoteMutation"], "groups.memberPromote");
    assert_eq!(aba["detail"]["removeMutation"], "groups.memberRemove");
    assert_eq!(aba["detail"]["addMutation"], "groups.memberAdd");
    assert_eq!(aba["detail"]["membership"]["capturedId"], "membership-2");
    assert_ne!(
        aba["detail"]["membership"]["capturedId"], aba["detail"]["replacementId"],
        "{aba}"
    );
    assert_eq!(aba["detail"]["staleReplayState"], "rejected", "{aba}");
    assert_eq!(
        aba["detail"]["successorAuthorityState"], "rejected",
        "{aba}"
    );
    assert!(
        aba["detail"]["successorAuthorityCode"]
            .as_str()
            .is_some_and(|code| code.contains("ADMIN_REQUIRED")),
        "{aba}"
    );
    assert_eq!(aba["detail"]["successorRole"], "member", "{aba}");

    let invalidation = check(&receipt, "invalidation");
    assert!(
        invalidation["detail"]["silenceProbes"]
            .as_u64()
            .is_some_and(|count| count > 0),
        "the chat receipt did not exercise an invalidation silence probe: {invalidation}"
    );
    assert!(
        invalidation["detail"]["overlapProbes"]
            .as_u64()
            .is_some_and(|count| count > 0),
        "the chat receipt did not exercise an exact trace-key overlap: {invalidation}"
    );
    assert!(
        invalidation["detail"]["deliveryProbes"]
            .as_u64()
            .is_some_and(|count| count > 0),
        "the chat receipt did not prove an exact-seq SSE delivery: {invalidation}"
    );
    let outcomes = invalidation["detail"]["outcomes"].as_array().unwrap();
    assert_eq!(
        outcomes.len() as u64,
        invalidation["detail"]["attempts"].as_u64().unwrap()
            + invalidation["detail"]["exclusions"].as_u64().unwrap(),
        "every attempted or excluded pair must remain auditable: {invalidation}"
    );
    for outcome in outcomes {
        for field in [
            "query",
            "queryArgs",
            "queryPersona",
            "mutation",
            "mutationArgs",
            "probeRole",
            "disposition",
            "selected",
        ] {
            assert!(outcome.get(field).is_some(), "missing {field}: {outcome}");
        }
        if outcome["disposition"] == "physical" {
            for field in [
                "seq",
                "overlaps",
                "changed",
                "invalidated",
                "delivered",
                "sseDelivered",
            ] {
                assert!(outcome.get(field).is_some(), "missing {field}: {outcome}");
            }
        }
    }
    assert!(outcomes.iter().any(|outcome| {
        outcome["disposition"] == "excluded"
            && outcome["mutation"] == "notifications.recordNotified"
            && outcome["reason"] == "system-only effect continuation"
    }));
    let bounds = check(&receipt, "bounds");
    let executions = bounds["detail"]["executions"].as_array().unwrap();
    assert_eq!(executions.len(), 18, "{bounds}");
    for operation in [
        "feeds.followingFeed",
        "feeds.globalFeed",
        "messages.summary",
        "messages.thread",
        "profiles.byHandle",
        "profiles.mine",
    ] {
        assert_eq!(
            executions
                .iter()
                .filter(|execution| execution["op"] == operation)
                .count(),
            3,
            "{operation}: {bounds}"
        );
    }
    for execution in executions
        .iter()
        .filter(|execution| execution["op"] == "messages.thread")
    {
        let admitted = execution["as"] != "charlie";
        assert_eq!(
            execution["examined"],
            serde_json::json!({ "actual": if admitted { 2 } else { 0 }, "ceiling": 10240 })
        );
        assert_eq!(
            execution["ruleProbes"],
            serde_json::json!({ "actual": if admitted { 2 } else { 0 }, "ceiling": 4 })
        );
        assert_eq!(
            execution["steps"],
            serde_json::json!({ "actual": if admitted { 7 } else { 4 }, "ceiling": 51203 })
        );
        assert_eq!(execution["readSites"].as_array().unwrap().len(), 2);
        assert_eq!(
            execution["readSites"][0]["calls"],
            serde_json::json!({
                "actual": 1,
                "ceiling": 1,
            })
        );
        assert_eq!(execution["readSites"][0]["take"], 1);
        assert_eq!(
            execution["readSites"][1]["calls"],
            serde_json::json!({
                "actual": if admitted { 1 } else { 0 },
                "ceiling": 1,
            })
        );
        assert_eq!(execution["readSites"][1]["take"], 50);
    }
    assert_eq!(
        checks
            .iter()
            .filter(|check| check["kind"] == "journey")
            .count(),
        7
    );
    for name in [
        "alice sends bob a message",
        "bob replies and alice's live thread updates",
        "profile ownership, uniqueness, and live public reads",
        "unfollow changes Following selection but not Global authorization",
        "group creation bootstraps one creator admin atomically",
        "conversation metadata stays inside membership",
        "scoped roles reject non-admin and stale membership authority",
    ] {
        let journey = check(&receipt, name);
        assert_eq!(journey["kind"], "journey", "{name}: {journey}");
        assert_eq!(journey["verdict"], "pass", "{name}: {journey}");
    }
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(receipt["verdict"], "blocked");
    if cfg!(feature = "hermes") {
        assert!(checks.iter().any(|check| {
            check["name"] == "effects"
                && check["verdict"] == "pass"
                && check["detail"]["engine"] == "ibex2 + vanilla hermes"
        }));
    } else {
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
    project.replace_backend_with_built_template("todos-ts");
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
    assert!(
        !receipt["checks"].as_array().unwrap().iter().any(|check| {
            matches!(
                check["name"].as_str(),
                Some("live-revocation" | "successor-policy-fence" | "grant-incarnation-aba")
            )
        }),
        "unrelated todos synthesized scoped-authorization proofs: {receipt}"
    );
}

#[test]
fn canonical_membership_without_a_probeable_named_delete_blocks_live_revocation() {
    let project = Project::new();
    assert!(project.init("chat", "none").status.success());
    project.replace_backend_with_built_template("chat-ts");
    let groups = project.path.join("snapback/groups.ts");
    let source = fs::read_to_string(&groups).unwrap();
    let without_admin_remove = without_export(&source, "memberRemove");
    let mut without_leave = without_export(&without_admin_remove, "memberLeave");
    assert_ne!(
        source, without_admin_remove,
        "chat fixture had no admin-remove surface"
    );
    assert_ne!(
        without_admin_remove, without_leave,
        "chat fixture had no self-leave surface"
    );
    without_leave.push_str(
        r#"
export const aaaUnprobeableLeave = mutation({
  orphanId: t.id(),
  membershipId: t.ref(memberships),
}, ({ db, args }) => {
  db.delete(memberships, args.membershipId);
  return null;
});

export const aabUnprobeableLeave = mutation({
  missingId: t.id(),
  membershipId: t.ref(memberships),
}, ({ db, args }) => {
  db.delete(memberships, args.membershipId);
  return null;
});
"#,
    );
    fs::write(groups, without_leave).unwrap();
    fs::remove_dir_all(project.path.join("snapback/tests")).unwrap();
    assert!(project.run(&["check", "--json"]).status.success());

    let output = project.run(&["test", "--derived-only", "--json"]);
    assert_eq!(output.status.code(), Some(1));
    let receipt = json_stdout(&output);
    let revocation = check(&receipt, "live-revocation");
    assert_eq!(revocation["verdict"], "blocked", "{revocation}");
    assert!(
        revocation["detail"]["reason"]
            .as_str()
            .is_some_and(|reason| reason.contains("no named mutation")),
        "{revocation}"
    );
    let candidates = revocation["detail"]["candidates"].as_array().unwrap();
    assert_eq!(candidates.len(), 2, "{revocation}");
    assert!(
        candidates[0]
            .as_str()
            .is_some_and(|reason| reason.contains("groups.aaaUnprobeableLeave")),
        "{revocation}"
    );
    assert!(
        candidates[1]
            .as_str()
            .is_some_and(|reason| reason.contains("groups.aabUnprobeableLeave")),
        "{revocation}"
    );
    let fence = check(&receipt, "successor-policy-fence");
    assert_eq!(fence["verdict"], "pass", "{fence}");
    let aba = check(&receipt, "grant-incarnation-aba");
    assert_eq!(aba["verdict"], "blocked", "{aba}");
}

#[test]
fn ref_based_pseudo_membership_is_refused_before_authority_proofs() {
    let project = Project::new();
    assert!(project.init("chat", "none").status.success());
    project.replace_backend_with_built_template("chat-ts");
    let schema = project.path.join("snapback/schema.ts");
    let source = fs::read_to_string(&schema).unwrap();
    let ref_based = source.replace("principal: t.principal(),", "principal: t.ref(profiles),");
    assert_ne!(
        source, ref_based,
        "chat fixture did not declare a nominal Principal membership"
    );
    fs::write(schema, ref_based).unwrap();
    let checked = project.run(&["check", "--json"]);
    assert_eq!(
        checked.status.code(),
        Some(1),
        "{}{}",
        String::from_utf8_lossy(&checked.stdout),
        String::from_utf8_lossy(&checked.stderr),
    );
    let output = String::from_utf8_lossy(&checked.stdout);
    assert!(
        output.contains("\"code\":\"E_RULE_INVALID\"")
            && output.contains("table memberships.principal is Ref<profiles>")
            && output.contains("must be Principal")
            && output.contains("\"rewrite\":"),
        "ref-based pseudo-membership was not refused with the nominal-axis diagnostic: {output}"
    );
}

#[test]
fn authority_proofs_skip_earlier_unprobeable_candidates() {
    let project = Project::new();
    assert!(project.init("chat", "none").status.success());
    project.replace_backend_with_built_template("chat-ts");
    let messages = project.path.join("snapback/messages.ts");
    let mut source = fs::read_to_string(&messages).unwrap();
    source.push_str(
        r#"
export const aaaUnprobeable = query({
  orphanId: t.id(),
  conversationId: t.ref(conversations),
}, ({ db, args }) =>
  db.scan(messages.byConvTime, [args.conversationId], { order: "desc", take: 50 }),
);

export const aaaUnprobeableLeave = mutation({
  orphanId: t.id(),
  membershipId: t.ref(memberships),
}, ({ db, args }) => {
  db.delete(memberships, args.membershipId);
  return null;
});
"#,
    );
    fs::write(messages, source).unwrap();
    let checked = project.run(&["check", "--json"]);
    assert!(
        checked.status.success(),
        "{}{}",
        String::from_utf8_lossy(&checked.stdout),
        String::from_utf8_lossy(&checked.stderr)
    );

    let output = project.run(&["test", "--derived-only", "--json"]);
    let receipt = json_stdout(&output);
    let revocation = check(&receipt, "live-revocation");
    assert_eq!(revocation["verdict"], "pass", "{revocation}");
    assert_eq!(revocation["detail"]["query"], "messages.thread");
    assert_eq!(revocation["detail"]["mutation"], "groups.memberLeave");
    let fence = check(&receipt, "successor-policy-fence");
    assert_eq!(fence["verdict"], "pass", "{fence}");
    assert_eq!(fence["detail"]["query"], "messages.thread");
    let aba = check(&receipt, "grant-incarnation-aba");
    assert_eq!(aba["verdict"], "pass", "{aba}");
    assert_eq!(aba["detail"]["staleReplayState"], "rejected", "{aba}");
    assert_eq!(
        aba["detail"]["successorAuthorityState"], "rejected",
        "{aba}"
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
    project.replace_backend_with_built_template("todos-ts");
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
        "no physical committing probe"
    );
    assert!(
        invalidation["detail"]["outcomes"]
            .as_array()
            .unwrap()
            .iter()
            .all(|outcome| outcome["disposition"] == "rejected"
                && !outcome["selected"].as_bool().unwrap())
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
    project.replace_backend_with_built_template("todos-ts");
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
            .any(|item| item["reason"] == "no physical concrete-disjoint probe for todos.list"),
        "{invalidation}"
    );
    assert!(
        invalidation["detail"]["outcomes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|outcome| {
                outcome["probeRole"] == "silence"
                    && outcome["disposition"] == "physical"
                    && outcome["overlaps"] == true
                    && outcome["delivered"] == true
                    && outcome["selected"] == false
            }),
        "{invalidation}"
    );
}

#[test]
fn rules_use_the_engine_verdict_when_one_synthetic_principal_is_admitted() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    project.replace_backend_with_built_template("todos-ts");
    fs::write(
        project.path.join("snapback/schema.ts"),
        r#"import { rule, schema, table, t } from "snapback2";
export const items = table({
  columns: { ownerId: t.principal(), label: t.text(20) },
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
export default seed({ personas: ["alice"], rows: { items: [{ id: "item-1", ownerId: "dev:alice", label: "one" }] } });
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
