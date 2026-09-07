// @ref LLP 1002#7-test-and-the-receipt — selection must preserve actual body identity and literal names.
use super::*;

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
