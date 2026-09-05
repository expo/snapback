use super::*;
use snapback2_core::{ColumnType, ProjectJson};

fn boot(serve: bool) -> (PathBuf, PathBuf, ChildGuard, u16, String) {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let schema = root.join("snapback/schema.q");
    fs::write(
        &schema,
        fs::read_to_string(&schema).unwrap()
            + r#"

table adminNotes:
  conversationId: conversations
  note: text <=40 ?
  read <- exists memberships[.conversationId, viewer]
  insert <- deny
  update <- deny
  delete <- deny
"#,
    )
    .unwrap();
    fs::write(root.join("snapback/admin.q"), r#"mutation bookkeep():
  insert notifications { outboxId: 'operator-outbox', effect: 'repair', providerId: 'operator-provider' }
  return true

query notes():
  return adminNotes[] first 20 by byId

query hiddenPoint(id: adminNotes):
  return adminNotes[id]

query listMessages():
  return messages[] first 20 by byId

query mergedMessages(a: conversations, b: conversations):
  return merge messages first 20 by byConvTime:
    [a]
    [b]

query countMessages(conversationId: conversations):
  return #messageCounts[conversationId]

mutation fill(id: adminNotes):
  update adminNotes[id] { note: 'filled' }
  return true
"#).unwrap();
    let seed = root.join("snapback/seed.ts");
    fs::write(
        &seed,
        fs::read_to_string(&seed).unwrap().replace(
            "    notifications: [",
            r#"    adminNotes: [
      { id: "admin-1", conversationId: "conversation-1", note: null },
      { id: "admin-2", conversationId: "conversation-1" },
    ],
    notifications: ["#,
        ),
    )
    .unwrap();
    let compiler = compiler(&root);
    let checked = Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .args(["check", "--project"])
        .arg(&root)
        .env("SNAPBACK2_COMPILER", &compiler)
        .output()
        .unwrap();
    assert!(
        checked.status.success(),
        "{} {}",
        String::from_utf8_lossy(&checked.stdout),
        String::from_utf8_lossy(&checked.stderr)
    );
    let mut owner =
        ChildGuard::spawn_with(env!("CARGO_BIN_EXE_snapback2"), &compiler, &root, serve);
    let ready = owner.ready_line();
    let port = ready
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap_or_else(|| panic!("{ready}"))
        .parse()
        .unwrap();
    let record: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    (
        root,
        compiler,
        owner,
        port,
        record["secret"].as_str().unwrap().to_owned(),
    )
}
fn cli(root: &Path, compiler: &Path, args: &[&str]) -> (i32, Value) {
    let output = Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .args(args)
        .arg("--json")
        .arg("--project")
        .arg(root)
        .env("SNAPBACK2_COMPILER", compiler)
        .output()
        .unwrap();
    let body = serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "{error}: {} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    });
    (output.status.code().unwrap(), body)
}

#[test]
fn operator_cli_commits_with_attribution_and_reads_hidden_point_range_merge_and_maintain() {
    let (root, compiler, mut owner, port, secret) = boot(false);
    let (code, mutation) = cli(
        &root,
        &compiler,
        &["run", "admin.bookkeep", "--as", "system"],
    );
    assert_eq!(code, 0, "{mutation}");
    assert_eq!(mutation["state"], "committed");
    assert_eq!(mutation["principal"], "system");
    let (code, trace) = cli(&root, &compiler, &["trace", "latest"]);
    assert_eq!(code, 0, "{trace}");
    assert_eq!(trace["commit"]["kind"], "operator");
    assert_eq!(trace["commit"]["program"], "admin.bookkeep");
    assert_eq!(
        trace["commit"]["by"],
        std::env::var("USER").unwrap_or_else(|_| "operator".into())
    );
    let seq = mutation["seq"].clone();
    for (op, count, args) in [
        ("admin.notes", 2, "{}"),
        ("admin.listMessages", 2, "{}"),
        (
            "admin.mergedMessages",
            2,
            r#"{"a":"conversation-1","b":"conversation-2"}"#,
        ),
    ] {
        let (code, query) = cli(&root, &compiler, &["run", op, args, "--as", "system"]);
        assert_eq!(code, 0, "{query}");
        assert_eq!(query["state"], "complete", "{query}");
        assert_eq!(query["data"].as_array().unwrap().len(), count);
        assert_eq!(query["seq"], seq);
    }
    let (_, hidden) = cli(&root, &compiler, &["run", "admin.notes", "--as", "charlie"]);
    assert!(hidden["data"].as_array().unwrap().is_empty(), "{hidden}");
    let (_, point) = cli(
        &root,
        &compiler,
        &[
            "run",
            "admin.hiddenPoint",
            r#"{"id":"admin-1"}"#,
            "--as",
            "system",
        ],
    );
    assert_eq!(point["data"]["id"], "admin-1");
    let (_, count) = cli(
        &root,
        &compiler,
        &[
            "run",
            "admin.countMessages",
            r#"{"conversationId":"conversation-1"}"#,
            "--as",
            "system",
        ],
    );
    assert_eq!(count["data"], 1, "{count}");
    let (_, data) = cli(
        &root,
        &compiler,
        &["data", "messages", "--as", "system", "--limit", "1"],
    );
    assert_eq!(data["data"].as_array().unwrap().len(), 1);
    assert_eq!(data["principal"], "system");
    let (_, next) = cli(
        &root,
        &compiler,
        &[
            "data",
            "messages",
            "--as",
            "system",
            "--limit",
            "1",
            "--after",
            data["next"].as_str().unwrap(),
        ],
    );
    assert_eq!(next["data"].as_array().unwrap().len(), 1);
    assert_ne!(data["data"][0]["id"], next["data"][0]["id"]);
    let (_, why) = cli(&root, &compiler, &["why", "admin.notes", "--as", "system"]);
    assert_eq!(why["principal"], "system");
    assert_eq!(why["rowVerdicts"].as_array().unwrap().len(), 2);
    assert!(
        why["rowVerdicts"]
            .as_array()
            .unwrap()
            .iter()
            .all(|v| v["verdict"] == "system-visible")
    );
    assert!(why["ruleInputs"].as_array().unwrap().is_empty());
    let api = request(
        port,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", "system")],
        json!({ "op": "admin.bookkeep" }),
    );
    assert_eq!(api.status, 403);
    assert_eq!(api.body["code"], "E_OPERATOR_REQUIRED");
    let no_secret = request(
        port,
        "POST",
        "/control/execute",
        &[],
        json!({ "op": "admin.bookkeep", "as": "system" }),
    );
    assert_eq!(no_secret.status, 403);
    assert_eq!(no_secret.body["code"], "E_OWNER_CONTROL_SECRET");
    let logs = fs::read_to_string(root.join(".snapback/log.jsonl")).unwrap();
    assert!(
        logs.lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .any(|line| line["kind"] == "operator"
                && line["op"] == "admin.notes"
                && line["by"] == trace["commit"]["by"])
    );
    assert_eq!(status(port, &secret)["seq"], seq);
    assert!(
        !status(port, &secret)["personas"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["name"] == "system")
    );
    let (code, rejected) = cli(
        &root,
        &compiler,
        &["run", "admin.bookkeep", "--as", "system"],
    );
    assert_eq!(code, 1);
    assert_eq!(rejected["state"], "rejected");
    stop_owner(port, &secret, &mut owner, "operator proof complete");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn operator_narrowing_apply_refusal_is_in_status_then_fill_and_retry_preserve_rows() {
    let (root, compiler, mut owner, port, secret) = boot(false);
    let mut project: ProjectJson =
        serde_json::from_slice(&fs::read(root.join(".snapback/build/project.json")).unwrap())
            .unwrap();
    project
        .schema
        .tables
        .get_mut("adminNotes")
        .unwrap()
        .columns
        .insert("note".into(), ColumnType::Text { max: 40 });
    let headers = [("X-Snapback-Control", secret.as_str())];
    let generation = status(port, &secret)["generation"].clone();
    let refusal = request(
        port,
        "POST",
        "/control/apply",
        &headers,
        json!({ "project": project }),
    );
    assert_eq!(refusal.status, 400, "{}", refusal.body);
    assert_eq!(refusal.body["code"], "E_SUCCESSOR_NARROWING");
    assert_eq!(refusal.body["nullRows"], 2);
    assert_eq!(refusal.body["sample"], json!(["admin-1", "admin-2"]));
    assert_eq!(refusal.body["family"], "successor");
    assert_eq!(refusal.body["site"], "adminNotes.note");
    let migration = request(
        port,
        "POST",
        "/control/migrate",
        &headers,
        json!({ "project": project, "plan": { "drops": [] } }),
    );
    assert_eq!(migration.status, 400, "{}", migration.body);
    assert_eq!(migration.body, refusal.body);

    let (code, observed) = cli(&root, &compiler, &["dev", "--status"]);
    assert_eq!(code, 0, "{observed}");
    assert_eq!(observed["status"]["state"], "refused");
    assert_eq!(observed["status"]["refused"][0], refusal.body);
    assert_eq!(observed["generation"], generation);
    assert!(
        fs::read_to_string(root.join(".snapback/log.jsonl"))
            .unwrap()
            .contains("E_SUCCESSOR_NARROWING")
    );
    for id in ["admin-1", "admin-2"] {
        let args = json!({ "id": id }).to_string();
        let (code, fill) = cli(
            &root,
            &compiler,
            &["run", "admin.fill", &args, "--as", "system"],
        );
        assert_eq!(code, 0, "{fill}");
        assert_eq!(fill["state"], "committed");
    }
    let applied = request(
        port,
        "POST",
        "/control/apply",
        &headers,
        json!({ "project": project }),
    );
    assert_eq!(applied.status, 200, "{}", applied.body);
    assert_eq!(status(port, &secret)["status"], "ready");
    let (_, rows) = cli(&root, &compiler, &["data", "adminNotes", "--as", "system"]);
    assert_eq!(rows["data"].as_array().unwrap().len(), 2);
    assert!(
        rows["data"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["note"] == "filled")
    );
    stop_owner(port, &secret, &mut owner, "narrowing proof complete");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn operator_serve_refuses_all_three_cli_seat_adapters() {
    let (root, compiler, mut owner, port, secret) = boot(true);
    for args in [
        vec!["run", "admin.notes", "--as", "system"],
        vec!["data", "messages", "--as", "system"],
        vec!["why", "admin.notes", "--as", "system"],
    ] {
        let (code, refusal) = cli(&root, &compiler, &args);
        assert_eq!(code, 1, "{refusal}");
        assert_eq!(refusal["code"], "E_OPERATOR_REQUIRED");
        assert_eq!(refusal["family"], "operator");
        assert_eq!(refusal["guide"], "operator/seat");
    }
    stop_owner(port, &secret, &mut owner, "serve operator refusal complete");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn operator_narrowing_watcher_keeps_previous_generation_and_reports_the_store_refusal() {
    let (root, compiler, mut owner, port, secret) = boot(false);
    let previous = status(port, &secret)["generation"].clone();
    // Let the watcher capture its initial fingerprint before the edit.
    thread::sleep(Duration::from_millis(350));
    // Keep the new generation's seed valid while the existing store still has nulls.
    let seed = root.join("snapback/seed.ts");
    let seeded = fs::read_to_string(&seed)
        .unwrap()
        .replace(
            "conversationId: \"conversation-1\", note: null",
            "conversationId: \"conversation-1\", note: \"seed-filled\"",
        )
        .replace(
            "{ id: \"admin-2\", conversationId: \"conversation-1\" }",
            "{ id: \"admin-2\", conversationId: \"conversation-1\", note: \"seed-filled\" }",
        );
    fs::write(&seed, seeded).unwrap();
    let schema = root.join("snapback/schema.q");
    fs::write(
        &schema,
        fs::read_to_string(&schema)
            .unwrap()
            .replace("note: text <=40 ?", "note: text <=40"),
    )
    .unwrap();
    let refusal = wait_for(Duration::from_secs(6), || {
        let state = status(port, &secret);
        (state["status"]["refused"][0]["code"] == "E_SUCCESSOR_NARROWING").then_some(state)
    });
    assert_eq!(refusal["generation"], previous);
    assert_eq!(refusal["status"]["refused"][0]["nullRows"], 2);
    let (code, checked) = cli(&root, &compiler, &["check"]);
    assert_eq!(
        code, 0,
        "static check must not inspect stored nulls: {checked}"
    );
    assert!(
        fs::read_to_string(root.join(".snapback/log.jsonl"))
            .unwrap()
            .contains("E_SUCCESSOR_NARROWING")
    );
    stop_owner(port, &secret, &mut owner, "watcher narrowing complete");
    fs::remove_dir_all(root).unwrap();
}
