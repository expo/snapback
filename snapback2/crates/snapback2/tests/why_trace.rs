mod common;

use common::{OwnerGuard, Project, json_stdout};
use std::fs;

#[test]
fn why_has_per_row_verdicts_and_trace_has_the_emitted_outbox_row() {
    let project = Project::new();
    assert!(project.init("chat", "none").status.success());
    let messages = project.path.join("snapback/messages.ts");
    let source = fs::read_to_string(&messages).unwrap()
        + r#"

export const maybeNotify = mutation({ notify: t.bool() }, ({ args }) => {
  if (args.notify) emit(notify, { to: "nobody@example.com", body: "conditional" });
  return null;
});
"#;
    fs::write(&messages, source).unwrap();
    assert!(project.run(&["check", "--json"]).status.success());
    let _owner = OwnerGuard::start(&project);
    let skipped = project.run(&[
        "run",
        "messages.maybeNotify",
        r#"{"notify":false}"#,
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
        r#"{"conversationId":"conversation-1","recipientId":"dev:bob","body":"trace test"}"#,
        "--as",
        "alice",
        "--json",
    ]);
    assert!(mutation.status.success());
    let why = project.run(&[
        "why",
        "messages.thread",
        r#"{"conversationId":"conversation-1"}"#,
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
    assert_eq!(trace["outboxRows"][0]["effect"], "notifications.notify");
    assert_eq!(trace["outboxRows"][0]["state"], "queued");
}
