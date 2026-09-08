mod common;

use common::{OwnerGuard, Project, json_stdout};
use std::fs;

#[test]
fn why_has_per_row_verdicts_and_trace_has_the_emitted_outbox_row() {
    let project = Project::new();
    assert!(project.init("chat", "none").status.success());
    let messages = project.path.join("snapback/messages.q");
    let source = fs::read_to_string(&messages).unwrap()
        + r#"

mutation maybeNotify(shouldNotify: bool):
  if shouldNotify:
    emit notify { to: 'nobody@example.com', body: 'conditional' }
  return null
"#;
    fs::write(&messages, source).unwrap();
    assert!(project.run(&["check", "--json"]).status.success());
    let _owner = OwnerGuard::start(&project);
    let skipped = project.run(&[
        "run",
        "messages.maybeNotify",
        r#"{"shouldNotify":false}"#,
        "--as",
        "alice",
        "--json",
    ]);
    assert!(skipped.status.success());
    let skipped_trace = project.run(&["trace", "latest", "--json"]);
    assert!(skipped_trace.status.success());
    assert!(
        json_stdout(&skipped_trace)["outboxRows"]
            .as_array()
            .unwrap()
            .is_empty()
    );

    let mutation = project.run(&[
        "run",
        "messages.send",
        r#"{"conversationId":"conversation-1","body":"trace test"}"#,
        "--as",
        "alice",
        "--json",
    ]);
    assert!(mutation.status.success());
    let why = project.run(&[
        "why",
        "messages.thread",
        r#"{"conversationId":"conversation-1","c":null}"#,
        "--as",
        "alice",
        "--json",
    ]);
    assert!(why.status.success());
    let why = json_stdout(&why);
    assert!(
        why["rowVerdicts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["verdict"] == "allow")
    );
    assert!(!why["ruleInputs"].as_array().unwrap().is_empty());

    let trace = project.run(&["trace", "latest", "--json"]);
    assert!(trace.status.success());
    let trace = json_stdout(&trace);
    assert_eq!(trace["commit"]["program"], "messages.send");
    assert_eq!(trace["outboxRows"][0]["effect"], "delivery.notify");
    assert_eq!(trace["outboxRows"][0]["state"], "queued");
}

#[test]
fn why_keeps_rule_admission_separate_from_the_page_cut() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::write(
        project.path.join("snapback/schema.q"),
        "use identity\n\ntable items:\n  label: text <=20\n  public 'public'\n  insert <- allow\n  update <- allow\n  delete <- allow\n",
    )
    .unwrap();
    fs::write(
        project.path.join("snapback/todos.q"),
        "query list():\n  return items[] first 1 by byId\n",
    )
    .unwrap();
    fs::write(
        project.path.join("snapback/seed.ts"),
        r#"import { seed } from "snapback2";
export default seed({ personas: ["alice"], rows: { items: [
  { id: "item-1", label: "one" },
  { id: "item-2", label: "two" },
  { id: "item-3", label: "three" },
] } });
"#,
    )
    .unwrap();
    fs::remove_dir_all(project.path.join("snapback/tests")).unwrap();
    assert!(project.run(&["check", "--json"]).status.success());
    let _owner = OwnerGuard::start(&project);

    let why = project.run(&["why", "todos.list", "--as", "alice", "--json"]);
    assert!(
        why.status.success(),
        "{}",
        String::from_utf8_lossy(&why.stderr)
    );
    let verdicts = json_stdout(&why)["rowVerdicts"].as_array().unwrap().clone();
    assert_eq!(verdicts.len(), 3, "{verdicts:?}");
    assert!(verdicts.iter().all(|row| row["verdict"] == "allow"));
    assert_eq!(
        verdicts.iter().filter(|row| row["cut"] == true).count(),
        2,
        "{verdicts:?}"
    );
}

#[test]
fn trace_marks_pre_restart_commit_ledgers_unavailable() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    let committed_seq = {
        let _owner = OwnerGuard::start(&project);
        let mutation = project.run(&[
            "run",
            "todos.add",
            r#"{"title":"before restart"}"#,
            "--as",
            "alice",
            "--json",
        ]);
        assert!(mutation.status.success());
        json_stdout(&mutation)["seq"].as_u64().unwrap()
    };

    let _restarted = OwnerGuard::start(&project);
    let trace = project.run(&["trace", &committed_seq.to_string(), "--json"]);
    assert!(trace.status.success());
    let trace = json_stdout(&trace);
    assert!(
        trace["ledger"]
            .as_str()
            .is_some_and(|value| value.starts_with("unavailable (owner restarted at ")),
        "{trace}"
    );
    assert!(trace.get("invalidated").is_none(), "{trace}");
    assert!(trace.get("deliveries").is_none(), "{trace}");
}

#[test]
fn why_refuses_missing_corrupt_and_incomplete_certificates_as_stale() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    let certificate_path = project.path.join(".snapback/build/certificates.json");
    let valid = fs::read(&certificate_path).unwrap();
    let _owner = OwnerGuard::start(&project);

    let corruptions = [
        None,
        Some(b"{not json".to_vec()),
        Some(serde_json::to_vec(&serde_json::json!({})).unwrap()),
        Some({
            let mut stale: serde_json::Value = serde_json::from_slice(&valid).unwrap();
            stale["todos.list"]["plan_hash"] = serde_json::json!("predecessor-plan");
            serde_json::to_vec(&stale).unwrap()
        }),
    ];
    for bytes in corruptions {
        match bytes {
            Some(bytes) => fs::write(&certificate_path, bytes).unwrap(),
            None => fs::remove_file(&certificate_path).unwrap(),
        }
        let why = project.run(&["why", "todos.list", "--as", "alice", "--json"]);
        assert_eq!(
            why.status.code(),
            Some(1),
            "{}",
            String::from_utf8_lossy(&why.stdout)
        );
        let refusal = json_stdout(&why);
        assert_eq!(refusal["code"], "E_WHY_STALE", "{refusal}");
        assert_eq!(refusal["rewrite"], "run snapback2 check", "{refusal}");
        fs::write(&certificate_path, &valid).unwrap();
    }
}

#[test]
fn auth_recipe_executes_scoped_admin_reads_and_diagnoses_owner_only_absence() {
    for scoped_roster in [false, true] {
        let project = Project::new();
        assert!(project.init("chat", "none").status.success());
        let guide = json_stdout(&project.run(&["guide", "auth", "--json"]));
        let content = guide["content"].as_str().unwrap();
        assert!(content.len() <= 4_096);
        assert!(!content.contains("```ts"));
        let snippets = content
            .split("```q\n")
            .skip(1)
            .map(|part| part.split("\n```").next().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(snippets.len(), 4);

        let schema_path = project.path.join("snapback/schema.q");
        let schema = fs::read_to_string(&schema_path).unwrap();
        let rest = schema.split("table conversations:").nth(1).unwrap();
        let mut schema = format!(
            "{}\n\n{}\n\ntable conversations:{}",
            snippets[0], snippets[1], rest
        );
        let membership_start = schema.find("table memberships:").unwrap();
        let membership_end = schema.find("table messages:").unwrap();
        let membership = schema[membership_start..membership_end].to_owned();
        assert!(membership.contains(snippets[2]));
        let read_rule = if scoped_roster {
            snippets[2]
        } else {
            "  read <- .principal = viewer"
        };
        schema.replace_range(
            membership_start..membership_end,
            &membership.replace(snippets[2], read_rule),
        );
        fs::write(&schema_path, schema).unwrap();
        // Compile and execute the shipped promotion snippet, not a copied fixture.
        fs::write(project.path.join("snapback/groups.q"), format!(
            "fn isAdmin from access\n\n{}\n\nquery inspectMembership(membershipId: memberships):\n  return memberships[membershipId]\n", snippets[3]
        )).unwrap();
        // This fixture changes roster visibility; remove unrelated delivery fanout
        // operations that require the template's uniform roster read policy.
        fs::remove_file(project.path.join("snapback/messages.q")).unwrap();
        fs::remove_dir_all(project.path.join("snapback/tests")).unwrap();
        let checked = project.run(&["check", "--json"]);
        assert!(
            checked.status.success(),
            "{}{}",
            String::from_utf8_lossy(&checked.stdout),
            String::from_utf8_lossy(&checked.stderr)
        );
        let _owner = OwnerGuard::start(&project);
        let run = |op: &str, args: &str, persona: &str| {
            json_stdout(&project.run(&["run", op, args, "--as", persona, "--json"]))
        };
        let bob_args = r#"{"conversationId":"conversation-1","membershipId":"membership-2"}"#;
        let ordinary = run(
            "groups.inspectMembership",
            r#"{"membershipId":"membership-2"}"#,
            "alice",
        );
        let why = json_stdout(&project.run(&[
            "why",
            "groups.inspectMembership",
            r#"{"membershipId":"membership-2"}"#,
            "--as",
            "alice",
            "--json",
        ]));
        let mutation_why = project.run(&[
            "why",
            "groups.memberPromote",
            bob_args,
            "--as",
            "alice",
            "--json",
        ]);
        assert_eq!(mutation_why.status.code(), Some(1));
        let refusal = json_stdout(&mutation_why);
        assert_eq!(refusal["code"], "E_OP_KIND");
        assert_eq!(refusal["family"], "op");
        assert_eq!(refusal["site"], "groups.memberPromote");
        assert_eq!(refusal["guide"], "auth");
        let after_why = run(
            "groups.inspectMembership",
            r#"{"membershipId":"membership-2"}"#,
            "alice",
        );
        assert_eq!(
            after_why, ordinary,
            "why must not mutate rows or advance commit seq"
        );
        let promoted = run("groups.memberPromote", bob_args, "alice");
        if scoped_roster {
            assert_eq!(ordinary["data"]["principal"], "dev:bob");
            assert!(why["diagnostics"].as_array().unwrap().is_empty());
            assert_eq!(promoted["state"], "committed", "{promoted}");
            let bob = run(
                "groups.inspectMembership",
                r#"{"membershipId":"membership-2"}"#,
                "alice",
            );
            assert_eq!(bob["data"]["role"], "admin");
            let cross_scope = run(
                "groups.memberPromote",
                r#"{"conversationId":"conversation-1","membershipId":"membership-4"}"#,
                "alice",
            );
            assert_eq!(cross_scope["code"], "MEMBERSHIP_SCOPE_REQUIRED");
            let outsider = run("groups.memberPromote", bob_args, "charlie");
            assert_eq!(outsider["code"], "ADMIN_REQUIRED");
        } else {
            let missing = run(
                "groups.inspectMembership",
                r#"{"membershipId":"absent"}"#,
                "alice",
            );
            assert_eq!(
                ordinary, missing,
                "ordinary reads must not reveal hidden-row existence"
            );
            assert_eq!(promoted["code"], "MEMBERSHIP_REQUIRED", "{promoted}");
            let missing = run(
                "groups.memberPromote",
                r#"{"conversationId":"conversation-1","membershipId":"absent"}"#,
                "alice",
            );
            assert_eq!(
                promoted, missing,
                "mutation refusals must not reveal hidden-row existence"
            );
            assert!(promoted.get("diagnostics").is_none());
            let diagnostic = &why["diagnostics"][0];
            assert_eq!(diagnostic["code"], "E_RULE");
            assert_eq!(diagnostic["family"], "rule");
            assert_eq!(diagnostic["guide"], "auth");
            assert_eq!(diagnostic["table"], "memberships");
            assert!(
                diagnostic["site"]
                    .as_str()
                    .is_some_and(|site| !site.is_empty())
            );
            assert!(
                diagnostic["rewrite"]
                    .as_str()
                    .unwrap()
                    .contains("snapback2 guide auth")
            );
            let missing_why = json_stdout(&project.run(&[
                "why",
                "groups.inspectMembership",
                r#"{"membershipId":"absent"}"#,
                "--as",
                "alice",
                "--json",
            ]));
            assert!(missing_why["diagnostics"].as_array().unwrap().is_empty());
            let bob = run(
                "groups.inspectMembership",
                r#"{"membershipId":"membership-2"}"#,
                "bob",
            );
            assert_eq!(
                bob["data"]["role"], "member",
                "failed promotion must not write"
            );
        }
    }
}
