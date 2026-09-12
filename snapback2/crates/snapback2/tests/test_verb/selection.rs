// @ref LLP 1002#7-test-and-the-receipt — selection must preserve actual body identity and literal names.
use super::*;

#[test]
fn selected_port_runs_the_full_suite_and_receipts_the_bound_owner() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let journey = project.path.join("snapback/tests/todos.test.ts");
    fs::write(
        &journey,
        format!(
            "{}\njourney('selected owner port', async ({{ url }}) => {{\n  if (url !== 'http://127.0.0.1:{port}') throw new Error('wrong owner: ' + url);\n}});\n",
            fs::read_to_string(&journey).unwrap(),
        ),
    ).unwrap();
    // Finish compilation while the selected port is reserved, then release it
    // immediately before launching the proof verb.
    assert!(project.run(&["check", "--json"]).status.success());
    drop(listener);
    let output = project.run(&["test", "--port", &port.to_string(), "--json"]);
    let receipt = json_stdout(&output);
    assert!(output.status.success(), "{receipt}");
    assert_eq!(receipt["verdict"], "pass");
    assert_eq!(receipt["owner"]["port"], port);
    let pid = receipt["owner"]["pid"].as_u64().unwrap();
    assert!(pid > 0 && pid != u64::from(std::process::id()));
    assert_eq!(
        receipt["commands"][0],
        format!("snapback2 dev --foreground --port {port}")
    );
    assert_eq!(
        receipt["commands"][2],
        format!("snapback2 test --port {port}")
    );
    for name in [
        "certify",
        "rules",
        "bounds",
        "invalidation",
        "replay",
        "todos round trip",
        "selected owner port",
    ] {
        assert_eq!(check(&receipt, name)["verdict"], "pass", "{receipt}");
    }
    assert_eq!(project.latest_receipt(), receipt);
    assert!(receipt["owner"].get("secret").is_none());
    #[cfg(unix)]
    {
        assert_eq!(
            unsafe { libc::kill(i32::try_from(pid).unwrap(), 0) },
            -1,
            "owner {pid} survived"
        );
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ESRCH)
        );
    }
}

#[test]
fn occupied_test_port_preserves_the_dev_refusal_without_fallback() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let output = project.run(&["test", &format!("--port={port}"), "--json"]);
    let receipt = json_stdout(&output);
    assert_eq!(output.status.code(), Some(1), "{receipt}");
    assert_eq!(receipt["verdict"], "fail");
    assert_eq!(
        check(&receipt, "owner")["detail"]["code"],
        "E_OWNER_PORT_TAKEN"
    );
    assert!(
        check(&receipt, "owner")["detail"]["message"]
            .as_str()
            .unwrap()
            .contains(&format!("127.0.0.1:{port}"))
    );
    assert_eq!(
        receipt["commands"],
        serde_json::json!([format!("snapback2 dev --foreground --port {port}")])
    );
    assert!(receipt.get("owner").is_none());
    assert!(
        receipt["checks"]
            .as_array()
            .unwrap()
            .iter()
            .all(|check| check["kind"] != "journey")
    );
    assert_eq!(project.latest_receipt(), receipt);
    assert!(
        fs::read_dir(project.path.join(".snapback"))
            .unwrap()
            .filter_map(Result::ok)
            .all(|entry| !entry.file_name().to_string_lossy().starts_with("test-"))
    );
}

#[test]
fn invalid_test_ports_fail_usage_before_starting_an_owner() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    for value in ["", "-1", "65536", "53200-53219", "not-a-port"] {
        let output = project.run(&["test", &format!("--port={value}"), "--json"]);
        assert_eq!(
            output.status.code(),
            Some(2),
            "port {value}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stderr).contains("[--port N]"));
    }
    assert!(!project.path.join(".snapback/receipts").exists());
}

#[test]
fn generated_rules_block_when_seeded_content_has_no_recipients() {
    let project = Project::new();
    assert!(project.init("chat", "none").status.success());
    let schema = project.path.join("snapback/schema.q");
    fs::write(&schema, fs::read_to_string(&schema).unwrap().replace("  after insert <- exists memberships[.id, .creatorId, 'admin']\n", "")).unwrap();
    let path = project.path.join("snapback/seed.ts");
    let source = fs::read_to_string(&path).unwrap();
    let source = source.lines().filter(|line| !["id: \"membership-1\"", "id: \"membership-2\"", "id: \"message-2\""]
        .iter().any(|id| line.contains(id))).collect::<Vec<_>>().join("\n");
    fs::write(path, source).unwrap();
    let receipt = json_stdout(&project.run(&["test", "--derived-only", "--json"]));
    let rules = check(&receipt, "rules");
    assert_eq!(rules["verdict"], "blocked", "{rules}");
    for table in ["deliveries", "deliveriesReceipts"] {
        assert_eq!(rules["detail"]["tables"][table]["probes"], 0, "{rules}");
        assert!(rules["detail"]["blocked"].as_array().unwrap().iter().any(|entry|
            entry["table"] == table && entry["reason"] == "no stored rows to probe"), "{rules}");
    }
}

#[test]
fn chat_count_journey_refuses_matching_unusable_inboxes() {
    let project = Project::new();
    assert!(project.init("chat", "none").status.success());
    let path = project.path.join("snapback/messages.q");
    let original = fs::read_to_string(&path).unwrap();
    fs::write(&path, original.replace(
        "query inbox(c: cursor ?):\n  page = deliveries[viewer] after c first 50 by byRecipient\n  return page { *, message: messages[.row] }",
        "query inbox(c: cursor ?):\n  return null",
    )).unwrap();
    let receipt = json_stdout(&project.run(&[
        "test", "--journey", "conversation metadata stays inside membership", "--json",
    ]));
    let journey = check(&receipt, "conversation metadata stays inside membership");
    assert_eq!(journey["verdict"], "fail", "matching null inboxes were accepted: {journey}");
    assert!(journey["detail"]["error"].as_str().unwrap().contains("inbox was not a usable array"), "{journey}");
}

#[test]
fn focused_registration_drift_fails_before_any_body_runs() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    let marker = project.path.join("body-ran");
    let marker_literal = serde_json::to_string(&marker).unwrap();
    for (discovered, executed) in [
        (vec!["target", "other"], vec!["other", "target"]),
        (vec!["target"], vec!["target", "target"]),
        (vec!["target", "target"], vec!["target"]),
    ] {
        fs::write(
            project.path.join("snapback/tests/todos.test.ts"),
            format!(
                r#"import {{ journey }} from "snapback2/test";
declare const process: {{
  argv: string[];
  getBuiltinModule(name: "fs"): {{ writeFileSync(path: string, data: string): void }};
}};
const names = process.argv.includes("--list") ? {} : {};
for (const name of names) journey(name, async () => {{
  process.getBuiltinModule("fs").writeFileSync({marker_literal}, name);
  if (name === "target") throw new Error("target body failed");
}});
"#,
                serde_json::to_string(&discovered).unwrap(),
                serde_json::to_string(&executed).unwrap(),
            ),
        )
        .unwrap();
        let output = project.run(&["test", "--journey", "target", "--json"]);
        let receipt = json_stdout(&output);
        assert_eq!(output.status.code(), Some(1), "{receipt}");
        assert_eq!(receipt["scope"]["journey"], "target");
        let checks = receipt["checks"].as_array().unwrap();
        assert_eq!(
            checks.len(),
            discovered.iter().filter(|n| **n == "target").count()
        );
        for check in checks {
            assert_eq!(check["kind"], "journey", "{receipt}");
            assert_eq!(check["verdict"], "fail", "{receipt}");
            assert!(
                check["detail"]
                    .to_string()
                    .contains("journey registrations changed between discovery and execution"),
                "{receipt}"
            );
        }
        assert!(
            !marker.exists(),
            "a body ran despite registration drift: {receipt}"
        );
        assert_eq!(project.latest_receipt(), receipt);
    }
}

#[test]
fn literal_option_names_and_duplicate_bodies_keep_their_exact_receipts() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::write(
        project.path.join("snapback/tests/todos.test.ts"),
        r#"import { journey } from "snapback2/test";
journey("--help", async () => {});
journey("--help", async () => { throw new Error("second duplicate body failed"); });
for (const name of ["-h", "--list", "--blocked", "name=part"]) {
  journey(name, async () => {});
}
"#,
    )
    .unwrap();
    let duplicate = project.run(&["test", "--journey=--help", "--json"]);
    let receipt = json_stdout(&duplicate);
    assert_eq!(duplicate.status.code(), Some(1), "{receipt}");
    assert_eq!(receipt["scope"]["journey"], "--help");
    assert!(
        receipt["commands"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("snapback2 test --journey='--help'"))
    );
    let checks = receipt["checks"].as_array().unwrap();
    assert_eq!(checks.len(), 2, "{receipt}");
    assert!(
        checks
            .iter()
            .all(|c| c["name"] == "--help" && c["kind"] == "journey")
    );
    assert_eq!(checks[0]["verdict"], "pass");
    assert_eq!(checks[1]["verdict"], "fail");
    assert!(
        checks[1]["detail"]
            .to_string()
            .contains("second duplicate body failed")
    );
    assert_eq!(project.latest_receipt(), receipt);

    for name in ["-h", "--list", "--blocked", "name=part"] {
        let option = format!("--journey={name}");
        let output = project.run(&["test", &option, "--json"]);
        let receipt = json_stdout(&output);
        assert!(output.status.success(), "{receipt}");
        assert_eq!(receipt["scope"]["journey"], name);
        assert_eq!(receipt["checks"].as_array().unwrap().len(), 1);
        assert_eq!(check(&receipt, name)["verdict"], "pass");
        assert_eq!(project.latest_receipt(), receipt);
    }
    // -h is also a valid separated value: it must not be consumed as help.
    let output = project.run(&["test", "--journey", "-h", "--json"]);
    assert!(output.status.success());
    assert_eq!(json_stdout(&output)["scope"]["journey"], "-h");

    let last = project.latest_receipt();
    for args in [
        vec!["test", "--help"],
        vec!["test", "-h"],
        vec!["test", "--journey=-h", "--help"],
    ] {
        let output = project.run(&args);
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("usage: snapback2 test"));
        assert_eq!(
            project.latest_receipt(),
            last,
            "help must not run a journey"
        );
    }
    for args in [
        vec!["test", "--journey=", "--json"],
        vec!["test", "--journey=-h", "--journey", "-h", "--json"],
        vec!["test", "--journey=-h", "--derived-only", "--json"],
        vec!["test", "--journey", "--help", "--json"],
    ] {
        let output = project.run(&args);
        assert_eq!(output.status.code(), Some(2), "{args:?}");
        assert_eq!(
            project.latest_receipt(),
            last,
            "usage must not run a journey"
        );
    }
}

#[test]
fn same_name_distinct_body_swap_refuses_instead_of_running_one_body_twice() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    let marker = project.path.join("bodies-ran");
    let marker_literal = serde_json::to_string(&marker).unwrap();
    let source = format!(
        r#"import {{ journey }} from "snapback2/test";
declare const process: {{
  argv: string[];
  getBuiltinModule(name: "fs"): {{ appendFileSync(path: string, data: string): void }};
}};
const pass = async () => {{ process.getBuiltinModule("fs").appendFileSync({marker_literal}, "pass\n"); }};
const fail = async () => {{
  process.getBuiltinModule("fs").appendFileSync({marker_literal}, "fail\n");
  throw new Error("duplicate failure");
}};
const flag = process.argv.indexOf("--journey-index");
const second = flag >= 0 && process.argv[flag + 1] === "1";
for (const body of second ? [fail, pass] : [pass, fail]) journey("target", body);
"#
    );
    let file = project.path.join("snapback/tests/todos.test.ts");
    fs::write(&file, &source).unwrap();
    let output = project.run(&["test", "--journey=target", "--json"]);
    let receipt = json_stdout(&output);
    assert_eq!(output.status.code(), Some(1), "{receipt}");
    assert_eq!(receipt["scope"]["journey"], "target");
    let checks = receipt["checks"].as_array().unwrap();
    assert_eq!(checks.len(), 2, "{receipt}");
    assert_eq!(checks[0]["name"], "target");
    assert_eq!(checks[0]["verdict"], "pass");
    assert_eq!(checks[1]["kind"], "journey");
    assert_eq!(checks[1]["verdict"], "fail");
    assert!(
        checks[1]["detail"]
            .to_string()
            .contains("journey registrations changed"),
        "{receipt}"
    );
    assert_eq!(fs::read_to_string(&marker).unwrap(), "pass\n");
    assert_eq!(project.latest_receipt(), receipt);

    // Both stable duplicate bodies still execute, including the failure.
    fs::remove_file(&marker).unwrap();
    fs::write(
        file,
        source.replace("second ? [fail, pass] : [pass, fail]", "[pass, fail]"),
    )
    .unwrap();
    let output = project.run(&["test", "--journey=target", "--json"]);
    let receipt = json_stdout(&output);
    assert_eq!(output.status.code(), Some(1), "{receipt}");
    let checks = receipt["checks"].as_array().unwrap();
    assert_eq!(checks.len(), 2, "{receipt}");
    assert!(
        checks
            .iter()
            .all(|c| c["name"] == "target" && c["kind"] == "journey")
    );
    assert_eq!(checks[0]["verdict"], "pass");
    assert_eq!(checks[1]["verdict"], "fail");
    assert!(
        checks[1]["detail"]
            .to_string()
            .contains("duplicate failure")
    );
    assert_eq!(fs::read_to_string(&marker).unwrap(), "pass\nfail\n");
}

#[test]
fn a_passing_body_receipt_cannot_hide_an_unsuccessful_runner_exit() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    for (body, status, selected) in [
        ("process.exitCode = 1;", 1, true),
        (
            "process.once('beforeExit', () => { process.exitCode = 2; });",
            2,
            true,
        ),
        ("process.exitCode = 1;", 1, false),
    ] {
        fs::write(
            project.path.join("snapback/tests/todos.test.ts"),
            format!(
                r#"
import {{ journey }} from "snapback2/test";
declare const process: {{ exitCode: number; once(event: string, body: () => void): void }};
journey("target", async () => {{ {body} }});
"#
            ),
        )
        .unwrap();
        let args = if selected {
            vec!["test", "--journey=target", "--json"]
        } else {
            vec!["test", "--json"]
        };
        let output = project.run(&args);
        let receipt = json_stdout(&output);
        assert_eq!(output.status.code(), Some(1), "{receipt}");
        assert_eq!(receipt["verdict"], "fail", "{receipt}");
        if selected {
            assert_eq!(receipt["scope"]["journey"], "target");
        } else {
            assert!(receipt["scope"].get("journey").is_none());
            assert_eq!(check(&receipt, "certify")["verdict"], "pass");
        }
        let checks = receipt["checks"].as_array().unwrap();
        assert!(
            checks
                .iter()
                .any(|c| c["name"] == "target" && c["verdict"] == "pass"),
            "retain the body receipt: {receipt}"
        );
        let failed = checks
            .iter()
            .find(|c| c["name"] == "target" && c["verdict"] == "fail")
            .unwrap();
        assert_eq!(failed["detail"]["status"], status, "{receipt}");
        assert!(
            failed["detail"]["error"]
                .as_str()
                .unwrap()
                .contains("exited unsuccessfully")
        );
        assert_eq!(project.latest_receipt(), receipt);
    }
}

#[test]
fn unsuccessful_discovery_cannot_admit_a_selected_body() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::write(
        project.path.join("snapback/tests/todos.test.ts"),
        r#"
import { journey } from "snapback2/test";
declare const process: { argv: string[]; exitCode: number };
if (process.argv.includes("--list")) process.exitCode = 3;
journey("target", async () => { throw new Error("body must not run"); });
"#,
    )
    .unwrap();
    let output = project.run(&["test", "--journey=target", "--json"]);
    let receipt = json_stdout(&output);
    assert_eq!(output.status.code(), Some(1), "{receipt}");
    assert_eq!(receipt["scope"]["journey"], "target");
    let failure = check(&receipt, "journey runner");
    assert_eq!(failure["detail"]["status"], 3);
    assert_eq!(
        failure["detail"]["error"],
        "journey discovery exited unsuccessfully"
    );
    assert!(
        !receipt["checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["name"] == "target"),
        "{receipt}"
    );
    assert_eq!(project.latest_receipt(), receipt);
}

#[test]
fn focused_identity_does_not_exhaust_argv_on_unselected_registrations() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::write(project.path.join("snapback/tests/todos.test.ts"), r#"
import { journey } from "snapback2/test";
journey("target", async () => {});
for (let i = 0; i < 2000; i++) journey("other", async () => { throw new Error("unselected body"); });
"#).unwrap();
    let output = project.run(&["test", "--journey=target", "--json"]);
    let receipt = json_stdout(&output);
    assert!(output.status.success(), "{receipt}");
    assert_eq!(receipt["scope"]["journey"], "target");
    assert_eq!(receipt["checks"].as_array().unwrap().len(), 1);
    assert_eq!(check(&receipt, "target")["verdict"], "pass");
}

#[test]
fn journey_fixtures_resolve_from_authored_tests_in_full_and_selected_runs() {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    let tests = project.path.join("snapback/tests");
    fs::create_dir(tests.join("fixtures")).unwrap();
    fs::write(tests.join("fixtures/message.txt"), "authored fixture").unwrap();
    // The same name at the project root must not win over the authored directory.
    fs::create_dir(project.path.join("fixtures")).unwrap();
    fs::write(project.path.join("fixtures/message.txt"), "wrong directory").unwrap();
    fs::write(
        tests.join("todos.test.ts"),
        r#"
import { fixture, journey } from "snapback2/test";
const registered = await fixture("fixtures/message.txt");
journey("fixture custody", async () => {
  await Promise.resolve();
  const loaded = await fixture("fixtures/message.txt");
  for (const bytes of [registered, loaded]) {
    if (new TextDecoder().decode(bytes) !== "authored fixture") throw new Error("wrong fixture");
  }
});
"#,
    )
    .unwrap();
    for args in [
        vec!["test", "--journeys-only", "--json"],
        vec!["test", "--journey", "fixture custody", "--json"],
    ] {
        let output = project.run(&args);
        let receipt = json_stdout(&output);
        assert!(output.status.success(), "{receipt}");
        assert_eq!(check(&receipt, "fixture custody")["verdict"], "pass");
    }
}
