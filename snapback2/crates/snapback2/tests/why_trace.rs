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
        r#"{"conversationId":"conversation-1","recipientId":"profile-bob","body":"trace test"}"#,
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
