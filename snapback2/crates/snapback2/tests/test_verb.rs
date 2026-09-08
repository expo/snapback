mod common;

#[path = "test_verb/selection.rs"]
mod selection;

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

fn without_operation(source: &str, name: &str) -> String {
    let marker = format!("mutation {name}(");
    let start = source
        .find(&marker)
        .unwrap_or_else(|| panic!("fixture had no {name} export"));
    let tail = &source[start + marker.len()..];
    let end = [tail.find("\nquery "), tail.find("\nmutation ")]
        .into_iter()
        .flatten()
        .min()
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
    assert_eq!(rules["detail"]["tables"]["memberCounts"]["probes"], 8);
    assert_eq!(rules["detail"]["tables"]["messages"]["probes"], 8);
    assert_eq!(rules["detail"]["tables"]["notifications"]["probes"], 4);
    assert_eq!(rules["detail"]["expectedBy"], "engine");
    assert_eq!(rules["detail"]["actualBy"], "data");
    // @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — the receipt carries
    // the owner's schedule counts, and the expiry journey fired the purge at least once.
    assert!(
        receipt["schedules"]["fired"]
            .as_u64()
            .is_some_and(|fired| fired >= 1),
        "{}",
        receipt["schedules"]
    );
    assert_eq!(
        receipt["schedules"]["rejected"], 0,
        "{}",
        receipt["schedules"]
    );
    for name in [
        "certify",
        "rules",
        "bounds",
        "live-revocation",
        "successor-policy-fence",
    ] {
        let derived = check(&receipt, name);
        assert_eq!(derived["verdict"], "pass", "{name}: {derived}");
    }
    // @ref LLP 1006#6-the-write-validated-not-stamped — generic derived probes
    // cannot forge ready ledger rows; the authored asset journey supplies the
    // physical upload/claim proof instead, so this is a pass-with-note.
    for name in ["invalidation", "replay"] {
        let derived = check(&receipt, name);
        assert_eq!(derived["verdict"], "pass", "{name}: {derived}");
        let skipped = derived["detail"]["skipped"].as_array().unwrap();
        for operation in ["messages.sendPhoto", "messages.sendClip"] {
            let note = skipped
                .iter()
                .find(|item| item["op"] == operation)
                .unwrap_or_else(|| panic!("{name} did not skip {operation}: {derived}"));
            assert_eq!(note["reason"], "E_ASSET_PROBE_NEEDS_UPLOAD");
            assert_eq!(
                note["note"],
                "asset-typed arguments are proven by an upload journey, not the generic prover"
            );
        }
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
    assert_eq!(fence["detail"]["policyRetiredHeldSearchDescriptors"], 1);
    assert_eq!(fence["detail"]["staleHeldSearchDescriptorRefused"], true);
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
    assert_eq!(executions.len(), 24, "{bounds}");
    for operation in [
        "messages.conversationView",
        "messages.inbox",
        "messages.thread",
        "feeds.followingFeed",
        "feeds.globalFeed",
        "messages.search",
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
            serde_json::json!({ "actual": if admitted { 2 } else { 0 }, "ceiling": 53 })
        );
        assert_eq!(
            execution["ruleProbes"],
            serde_json::json!({ "actual": if admitted { 2 } else { 0 }, "ceiling": 4 })
        );
        assert_eq!(
            execution["steps"],
            serde_json::json!({ "actual": if admitted { 14 } else { 10 }, "ceiling": 278 })
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
        15
    );
    for name in [
        "alice posts to the room and a non-member cannot",
        "bob replies and alice's live log thread updates",
        "profile ownership, uniqueness, and live public reads",
        "unfollow changes Following selection but not Global authorization",
        "group creation bootstraps one creator admin atomically",
        "conversation metadata stays inside membership",
        "scoped roles reject non-admin and stale membership authority",
        "alice sends and reads back a JPEG photo and MP4 clip",
        "offline drain removes an unsent body and survives a cold restart",
        "viewed photos render from the byte cache offline; a view-once photo and an unsent row do not",
        "offline sends queue, survive a restart, replay in order, and a 503 after a commit is exactly once",
        "offline edits reject stale reads by trace, and past-fence edits by the program CONFLICT",
        "a never-opened chat renders offline from the drained log and an offline send is predicted into it in order",
        "a send queued offline into a three-member group shows one bubble, keeps its message id, leaves no duplicate delivery, and reaches both other members once",
        "an expiring message is purged by the owner's schedule with every client closed",
    ] {
        let journey = check(&receipt, name);
        assert_eq!(journey["kind"], "journey", "{name}: {journey}");
        assert_eq!(journey["verdict"], "pass", "{name}: {journey}");
    }
    if cfg!(feature = "hermes") {
        assert_eq!(output.status.code(), Some(0));
        assert_eq!(receipt["verdict"], "pass");
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
fn chat_delivery_log_caps_members_and_evicts_unsent_departed_body() {
    let project = Project::new();
    let initialized = project.init("chat", "none");
    assert!(
        initialized.status.success(),
        "init failed: {}{}",
        String::from_utf8_lossy(&initialized.stdout),
        String::from_utf8_lossy(&initialized.stderr)
    );
    let _owner = OwnerGuard::start(&project);
    let run = |persona: &str, operation: &str, arguments: serde_json::Value| {
        let arguments = arguments.to_string();
        json_stdout(&project.run(&["run", operation, &arguments, "--as", persona, "--json"]))
    };

    let initial_members = (1..=48)
        .map(|number| format!("dev:capacity-{number}"))
        .collect::<Vec<_>>();
    let capacity_group = run(
        "alice",
        "groups.groupCreate",
        serde_json::json!({ "title": "Capacity", "members": initial_members }),
    );
    assert_eq!(capacity_group["state"], "committed", "{capacity_group}");
    let capacity_id = capacity_group["data"]["id"].as_str().unwrap();
    let fiftieth = run(
        "alice",
        "groups.memberAdd",
        serde_json::json!({ "conversationId": capacity_id, "principal": "dev:capacity-49" }),
    );
    assert_eq!(fiftieth["state"], "committed", "{fiftieth}");
    let fifty_first = run(
        "alice",
        "groups.memberAdd",
        serde_json::json!({ "conversationId": capacity_id, "principal": "dev:capacity-50" }),
    );
    assert_eq!(fifty_first["state"], "rejected", "{fifty_first}");
    assert_eq!(fifty_first["code"], "GROUP_FULL", "{fifty_first}");
    let capacity_post = run(
        "alice",
        "messages.send",
        serde_json::json!({ "conversationId": capacity_id, "body": "all fifty" }),
    );
    assert_eq!(capacity_post["state"], "committed", "{capacity_post}");
    let capacity_seq = capacity_post["seq"].as_u64().unwrap().to_string();
    let capacity_trace = json_stdout(&project.run(&["trace", &capacity_seq, "--json"]));
    assert_eq!(
        capacity_trace["commit"]["writes"]["deliveries"], 50,
        "{capacity_trace}"
    );

    let recipient_group = run(
        "alice",
        "groups.groupCreate",
        serde_json::json!({ "title": "Original recipients", "members": ["dev:recipient-charlie"] }),
    );
    assert_eq!(recipient_group["state"], "committed", "{recipient_group}");
    let recipient_group_id = recipient_group["data"]["id"].as_str().unwrap();
    let bob_membership = run(
        "alice",
        "groups.memberAdd",
        serde_json::json!({ "conversationId": recipient_group_id, "principal": "dev:bob" }),
    );
    assert_eq!(bob_membership["state"], "committed", "{bob_membership}");
    let bob_membership_id = bob_membership["data"]["id"].as_str().unwrap();
    let edited_post = run(
        "alice",
        "messages.send",
        serde_json::json!({ "conversationId": recipient_group_id, "body": "before edit" }),
    );
    assert_eq!(edited_post["state"], "committed", "{edited_post}");
    let edited_message = edited_post["data"]["id"].as_str().unwrap();
    let unsent_send = run(
        "alice",
        "messages.send",
        serde_json::json!({
            "conversationId": recipient_group_id,

            "body": "before unsend"
        }),
    );
    assert_eq!(unsent_send["state"], "committed", "{unsent_send}");
    let unsent_message = unsent_send["data"]["id"].as_str().unwrap();
    let left = run(
        "bob",
        "groups.memberLeave",
        serde_json::json!({ "conversationId": recipient_group_id, "membershipId": bob_membership_id }),
    );
    assert_eq!(left["state"], "committed", "{left}");
    let edited = run(
        "alice",
        "messages.edit",
        serde_json::json!({ "messageId": edited_message, "body": "after edit", "baseBody": "before edit" }),
    );
    assert_eq!(edited["state"], "committed", "{edited}");
    let unsent = run(
        "alice",
        "messages.unsend",
        serde_json::json!({ "messageId": unsent_message }),
    );
    assert_eq!(unsent["state"], "committed", "{unsent}");

    let outsider_deliveries = json_stdout(&project.run(&[
        "data",
        "deliveries",
        "--as",
        "mallory",
        "--limit",
        "500",
        "--json",
    ]));
    assert!(
        outsider_deliveries["data"].as_array().unwrap().is_empty(),
        "{outsider_deliveries}"
    );

    let visible_deliveries = ["alice", "bob", "recipient-charlie"]
        .into_iter()
        .flat_map(|persona| {
            json_stdout(&project.run(&[
                "data",
                "deliveries",
                "--as",
                persona,
                "--limit",
                "500",
                "--json",
            ]))["data"]
                .as_array()
                .unwrap()
                .clone()
        })
        .collect::<Vec<_>>();
    let count = |message: &str, kind: &str| {
        visible_deliveries
            .iter()
            .filter(|row| row["messageId"] == message && row["kind"] == kind)
            .count()
    };
    assert_eq!(
        count(edited_message, "message"),
        3,
        "{visible_deliveries:?}"
    );
    assert_eq!(count(edited_message, "edit"), 2, "{visible_deliveries:?}");
    assert_eq!(
        count(unsent_message, "message"),
        3,
        "{visible_deliveries:?}"
    );
    assert_eq!(
        count(unsent_message, "removed"),
        2,
        "{visible_deliveries:?}"
    );

    for persona in ["alice", "recipient-charlie"] {
        let inbox = run(persona, "messages.inbox", serde_json::json!({ "c": null }));
        let inbox_rows = inbox["data"].as_array().unwrap();
        assert!(
            inbox_rows
                .iter()
                .any(|row| { row["messageId"] == edited_message && row["kind"] == "edit" }),
            "{persona} did not receive the edit after bob left: {inbox}"
        );
        assert!(
            inbox_rows
                .iter()
                .any(|row| { row["messageId"] == unsent_message && row["kind"] == "removed" }),
            "{persona} did not receive the removal after bob left: {inbox}"
        );
    }

    let bob_inbox = run("bob", "messages.inbox", serde_json::json!({ "c": null }));
    let bob_rows = bob_inbox["data"].as_array().unwrap();
    assert!(
        bob_rows
            .iter()
            .any(|row| row["messageId"] == unsent_message && row["kind"] == "message"),
        "bob lost the page that must revalidate the deleted body: {bob_inbox}"
    );
    assert!(
        bob_rows.iter().all(|row| {
            row["messageId"] != edited_message && row["messageId"] != unsent_message
                || row["kind"] == "message"
        }),
        "departed bob received a post-departure delivery: {bob_inbox}"
    );

    let why = json_stdout(&project.run(&[
        "why",
        "messages.inbox",
        r#"{"c":null}"#,
        "--as",
        "bob",
        "--json",
    ]));
    let absences = why["authoritativeTrace"]["absences"].as_array().unwrap();
    let absent_message = |message: &str| {
        absences.iter().any(|absence| {
            absence[0] == "messages" && absence[1] == "byId" && absence[2][0]["Id"] == message
        })
    };
    assert!(
        absent_message(unsent_message),
        "bob's next page revalidation did not prove the unsent body absent: {why}"
    );
    assert!(
        !absent_message(edited_message),
        "a hidden edited body was incorrectly reported absent: {why}"
    );
}

#[test]
fn derived_rules_read_every_visible_row_at_and_beyond_one_control_page() {
    for count in [500, 501] {
        let project = Project::new();
        assert!(project.init("todos", "none").status.success());
        let rows = (0..count)
            .map(|index| {
                format!(
                    r#"{{ id: "todo-{index:03}", title: "row {index}", done: false, ownerId: "dev:alice" }}"#
                )
            })
            .collect::<Vec<_>>()
            .join(",\n");
        fs::write(
            project.path.join("snapback/seed.ts"),
            format!(
                "import {{ seed }} from \"snapback2\";\nexport default seed({{ personas: [\"alice\"], rows: {{ todos: [{rows}] }} }});\n"
            ),
        )
        .unwrap();

        let output = project.run(&["test", "--derived-only", "--json"]);
        let receipt = json_stdout(&output);
        let rules = check(&receipt, "rules");
        assert_eq!(rules["verdict"], "pass", "{count} rows: {rules}");
        assert_eq!(
            rules["detail"]["tables"]["todos"]["probes"],
            serde_json::json!(count * 2),
            "{count} rows: {rules}"
        );
    }
}

#[test]
fn unmatched_bare_id_blocks_with_the_operation_and_argument_name() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::write(
        project.path.join("snapback/todos.q"),
        "query byOwner(ownerId: id):\n  return ownerId\n",
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
    let groups = project.path.join("snapback/groups.q");
    let source = fs::read_to_string(&groups).unwrap();
    let without_admin_remove = without_operation(&source, "memberRemove");
    let mut without_leave = without_operation(&without_admin_remove, "memberLeave");
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
mutation aaaUnprobeableLeave(orphanId: id, membershipId: memberships):
  delete memberships[membershipId]
  return null

mutation aabUnprobeableLeave(missingId: id, membershipId: memberships):
  delete memberships[membershipId]
  return null
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
    let schema = project.path.join("snapback/schema.q");
    let source = fs::read_to_string(&schema).unwrap();
    let ref_based = source.replace(
        "table memberships:\n  conversationId: conversations\n  principal: principal",
        "table memberships:\n  conversationId: conversations\n  principal: profiles",
    );
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
    let refusals: Vec<serde_json::Value> = String::from_utf8(checked.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert!(
        refusals.iter().any(|refusal| {
            refusal["code"] == "E_QUARRY_TYPE"
                && refusal["message"].as_str().is_some_and(|message| message.starts_with("recipient expects principal, got profiles (from a shape, fn, or proc used at snapback/messages.q:"))
                && refusal["site"] == "snapback/access.q:9:25"
                && refusal["rewrite"]
                    .as_str()
                    .is_some_and(|value| !value.is_empty())
        }),
        "the ref-based recipient axis was not refused directly: {refusals:?}"
    );
    assert!(
        refusals.iter().any(|refusal| {
            refusal["code"] == "E_QUARRY_UNKNOWN"
                && refusal["message"]
                    == "memberships.byPrincipalConversation expects reference to profiles for principal, got principal"
                && refusal["site"] == "snapback/messages.q:11:51"
                && refusal["rewrite"]
                    .as_str()
                    .is_some_and(|value| !value.is_empty())
        }),
        "the nominal membership index was not refused directly: {refusals:?}"
    );
}

#[test]
fn authority_proofs_skip_earlier_unprobeable_candidates() {
    let project = Project::new();
    assert!(project.init("chat", "none").status.success());
    let messages = project.path.join("snapback/messages.q");
    let mut source = fs::read_to_string(&messages).unwrap();
    source.push_str(
        r#"
query aaaUnprobeable(orphanId: id, conversationId: conversations):
  return messages[conversationId] last 50

mutation aaaUnprobeableLeave(orphanId: id, membershipId: memberships):
  delete memberships[membershipId]
  return null
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
fn synchronous_loop_times_out_and_a_leaked_handle_cannot_hold_the_runner() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::write(
        project.path.join("snapback/tests/todos.test.ts"),
        r#"import { journey } from "snapback2/test";
journey("synchronous loop", () => { while (true) {} });
journey("leaked handle", () => { setInterval(() => {}, 1000); });
"#,
    )
    .unwrap();

    let started = std::time::Instant::now();
    let output = project.run(&["test", "--journeys-only", "--json"]);
    assert!(started.elapsed() < std::time::Duration::from_secs(12));
    assert_eq!(output.status.code(), Some(1));
    let receipt = json_stdout(&output);
    let timed_out = check(&receipt, "synchronous loop");
    assert_eq!(timed_out["verdict"], "fail", "{timed_out}");
    assert!(
        timed_out["detail"]["error"]
            .as_str()
            .is_some_and(|message| message.contains("5000 ms host deadline")),
        "{timed_out}"
    );
    let leaked = check(&receipt, "leaked handle");
    assert_eq!(leaked["verdict"], "pass", "{leaked}");
}

#[test]
fn invalidation_blocks_when_every_intersecting_probe_is_rejected() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::remove_file(project.path.join("snapback/tests/todos.test.ts")).unwrap();
    fs::write(
        project.path.join("snapback/todos.q"),
        "query list():\n  return todos[viewer] first 50\n\nmutation add():\n  require false else ALWAYS_REJECT\n  insert todos { title: 'never', done: false, ownerId: viewer }\n  return null\n",
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
    fs::write(
        project.path.join("snapback/schema.q"),
        "use identity\n\ntable items:\n  label: text <=20\n  public 'public'\n  insert <- allow\n  update <- allow\n  delete <- allow\n",
    )
    .unwrap();
    fs::write(
        project.path.join("snapback/todos.q"),
        "query list():\n  return items[] first 50 by byId\n\nmutation add(label: text <=20):\n  insert items { label }\n  return null\n",
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
    fs::write(
        project.path.join("snapback/schema.q"),
        "use identity\n\ntable items:\n  ownerId: principal\n  label: text <=20\n  read <- .ownerId = viewer\n  insert <- allow\n  update <- allow\n  delete <- allow\n",
    )
    .unwrap();
    fs::write(
        project.path.join("snapback/todos.q"),
        "query list():\n  return items[] first 50 by byId\n",
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

#[test]
fn clique_sized_seed_and_71_operations_have_bounded_honest_derived_coverage() {
    let project = Project::new();
    assert!(project.init("chat", "none").status.success());
    // The reduced Clique bar has no external I/O. Retain the real template's
    // scoped rules, maintained counts, feeds and authorization proofs.
    let messages = project.path.join("snapback/messages.q");
    let source = fs::read_to_string(&messages)
        .unwrap()
        .replace("effect notify from delivery\n", "")
        .replace("  for member in conversationMembers(conversationId):\n    if member.principal != viewer:\n      emit notify { to: member.principal, body }\n", "");
    fs::write(messages, source).unwrap();
    fs::remove_file(project.path.join("snapback/delivery.ts")).unwrap();
    fs::remove_file(project.path.join("snapback/notifications.q")).unwrap();
    fs::remove_dir_all(project.path.join("snapback/tests")).unwrap();
    let mut operations = String::new();
    for index in 0..47 {
        operations.push_str(&format!("\nmutation send{index}(conversationId: conversations, body: text <=4000):\n  require exists memberships[conversationId, viewer] else NOT_MEMBER\n  row = insert messages {{ conversationId, authorId: viewer, body, at: now }}\n  return {{ id: row.id }}\n"));
    }
    fs::write(project.path.join("snapback/scale.q"), operations).unwrap();
    let seed = project.path.join("snapback/seed.ts");
    let mut source = fs::read_to_string(&seed).unwrap();
    let conversations = (3..=4)
        .map(|n| {
            format!("{{ id: 'conversation-{n}', title: 'Room {n}', creatorId: 'dev:alice' }},")
        })
        .collect::<String>();
    let memberships = (3..=4).map(|n| format!("{{ id: 'membership-extra-{n}', conversationId: 'conversation-{n}', principal: 'dev:alice', role: 'admin', joinedAt: 0 }},")).collect::<String>();
    let messages = (0..30).map(|n| format!("{{ id: 'extra-{n}', conversationId: 'conversation-{}', authorId: 'dev:alice', body: 'seeded chat', at: {} }},", n % 4 + 1, n + 2)).collect::<String>();
    // Keep the original two scope rows first for the declared candidate order.
    source = source.replace(
        "    ],\n    memberships:",
        &format!("{conversations}    ],\n    memberships:"),
    );
    source = source.replace(
        "    ],\n    messages:",
        &format!("{memberships}    ],\n    messages:"),
    );
    source = source.replace(
        "    ],\n    deliveries:",
        &format!("{messages}    ],\n    deliveries:"),
    );
    fs::write(seed, source).unwrap();

    let started = std::time::Instant::now();
    let output = project.run(&["test", "--derived-only", "--json"]);
    let elapsed = started.elapsed();
    let receipt = json_stdout(&output);
    assert!(output.status.success(), "{receipt}");
    // 27 template operations after removing notifications, plus 44 sends.
    assert_eq!(check(&receipt, "certify")["detail"]["operations"], 71);
    let rules = check(&receipt, "rules");
    assert_eq!(rules["detail"]["tables"]["messages"]["probes"], 32 * 4);
    let invalidation = check(&receipt, "invalidation");
    assert!(
        invalidation["detail"]["attempts"].as_u64().unwrap() < 150,
        "{invalidation}"
    );
    assert!(
        invalidation["detail"]["groups"]
            .as_array()
            .unwrap()
            .iter()
            .all(|group| group["witnessed"] == true)
    );
    for name in [
        "replay",
        "live-revocation",
        "successor-policy-fence",
        "grant-incarnation-aba",
    ] {
        assert_eq!(check(&receipt, name)["verdict"], "pass", "{receipt}");
    }
    eprintln!(
        "Clique-sized derived receipt: {} ms, rules {} ms, invalidation {} ms, attempts {}",
        elapsed.as_millis(),
        rules["ms"],
        invalidation["ms"],
        invalidation["detail"]["attempts"]
    );
    assert!(elapsed < std::time::Duration::from_secs(60), "{elapsed:?}");
}

#[test]
fn oversized_policy_seed_blocks_without_claiming_a_sample_passed() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    let rows = (0..500)
        .map(|n| format!("{{ id: 'todo-{n}', title: 'seed', done: false, ownerId: 'dev:alice' }}"))
        .collect::<Vec<_>>()
        .join(",");
    let personas = (0..33)
        .map(|n| format!("'viewer{n}'"))
        .collect::<Vec<_>>()
        .join(",");
    fs::write(project.path.join("snapback/seed.ts"), format!("import {{ seed }} from 'snapback2';\nexport default seed({{ personas: [{personas}], rows: {{ todos: [{rows}] }} }});")).unwrap();
    let output = project.run(&["test", "--derived-only", "--json"]);
    let receipt = json_stdout(&output);
    assert_eq!(output.status.code(), Some(1));
    let rules = check(&receipt, "rules");
    assert_eq!(rules["verdict"], "blocked", "{rules}");
    assert_eq!(rules["detail"]["probes"], 0);
    assert_eq!(
        rules["detail"]["blocked"][0]["reason"],
        "rule probe budget exhausted"
    );
    assert_eq!(check(&receipt, "bounds")["verdict"], "pass");
}

#[test]
fn isolated_owner_preserves_its_startup_refusal() {
    let project = Project::new();
    assert!(project.init("chat", "none").status.success());
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .args(["test", "--derived-only", "--json", "--project"])
        .arg(&project.path)
        .env(
            "SNAPBACK2_COMPILER",
            project.package_snapshot_root().join("dist/compiler.mjs"),
        )
        .env("SNAPBACK2_MEDIA", project.path.join("missing-media-helper"))
        .output()
        .unwrap();
    let receipt = json_stdout(&output);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(
        check(&receipt, "owner")["detail"]["code"],
        "E_ASSET_NOT_READY",
        "{receipt}"
    );
    assert!(
        check(&receipt, "owner")["detail"]["message"]
            .as_str()
            .unwrap()
            .contains("missing-media-helper")
    );
}

#[test]
fn named_journey_selection_is_exact_scoped_and_does_not_hide_full_suite_failures() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::write(
        project.path.join("snapback/tests/todos.test.ts"),
        r#"
import { journey } from "snapback2/test";
journey("focused", async () => {});
journey("focused extra", async () => { throw new Error("unselected failure"); });
"#,
    )
    .unwrap();
    fs::write(
        project.path.join("snapback/tests/other.test.ts"),
        r#"
import { journey } from "snapback2/test";
journey("focused", async () => {});
"#,
    )
    .unwrap();
    let selected = project.run(&["test", "--journey", "focused", "--json"]);
    assert!(
        selected.status.success(),
        "{}",
        String::from_utf8_lossy(&selected.stdout)
    );
    let receipt = json_stdout(&selected);
    assert_eq!(receipt["scope"]["journey"], "focused");
    assert_eq!(receipt["scope"]["changed"], serde_json::json!([]));
    let checks = receipt["checks"].as_array().unwrap();
    assert_eq!(
        checks.len(),
        2,
        "all exact-name registrations must run: {receipt}"
    );
    assert!(
        checks
            .iter()
            .all(|c| c["name"] == "focused" && c["kind"] == "journey" && c["verdict"] == "pass")
    );
    assert_eq!(project.latest_receipt(), receipt);

    let missing = project.run(&["test", "--journey", "focus", "--json"]);
    assert_eq!(missing.status.code(), Some(1));
    let missing = json_stdout(&missing);
    assert_eq!(missing["scope"]["journey"], "focus");
    let refusal = check(&missing, "journey selection");
    assert_eq!(refusal["verdict"], "fail");
    assert!(
        refusal["detail"]["available"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("focused"))
    );

    let full = project.run(&["test", "--json"]);
    assert_eq!(full.status.code(), Some(1));
    let full = json_stdout(&full);
    assert!(full["scope"].get("journey").is_none());
    assert_eq!(check(&full, "focused extra")["verdict"], "fail");
    assert_eq!(check(&full, "certify")["verdict"], "pass");

    // Selection must preserve a selected failing outcome too.
    let failing = project.run(&["test", "--journey", "focused extra", "--json"]);
    assert_eq!(failing.status.code(), Some(1));
    assert_eq!(
        check(&json_stdout(&failing), "focused extra")["verdict"],
        "fail"
    );
}

#[test]
fn named_journey_selection_rejects_invalid_modes_and_preserves_compile_failures() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    for args in [
        vec!["test", "--journey", ""],
        vec!["test", "--journey", "todos round trip", "--derived-only"],
        vec![
            "test",
            "--journey",
            "todos round trip",
            "--blocked",
            "reason",
        ],
    ] {
        assert_eq!(project.run(&args).status.code(), Some(2), "{args:?}");
    }
    fs::write(
        project.path.join("snapback/todos.q"),
        "query list():\n  return unknownName\n",
    )
    .unwrap();
    let output = project.run(&["test", "--journey", "todos round trip", "--json"]);
    assert_eq!(output.status.code(), Some(1));
    let receipt = json_stdout(&output);
    assert_eq!(receipt["scope"]["journey"], "todos round trip");
    assert_eq!(check(&receipt, "certify")["verdict"], "fail");
}
