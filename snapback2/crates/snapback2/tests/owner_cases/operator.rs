use super::*;
use snapback2_core::{ColumnType, ProjectJson};

fn boot(serve: bool) -> (PathBuf, PathBuf, ChildGuard, u16, String) {
    boot_with_user(serve, None)
}

fn boot_with_user(serve: bool, user: Option<&str>) -> (PathBuf, PathBuf, ChildGuard, u16, String) {
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
  legacy: int ?
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

mutation breakImmutable(id: profiles, principal: principal):
  update profiles[id] { principal }
  return true

query pagedNotes(c: cursor ?):
  return adminNotes[] after c first 20 by byId

query deniedRead():
  require false else OPERATOR_READ_REFUSED
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
  return messageCounts[conversationId]

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
    let mut owner = ChildGuard::spawn_with_user(
        env!("CARGO_BIN_EXE_snapback2"),
        &compiler,
        &root,
        serve,
        user,
    );
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
    let (root, compiler, mut owner, port, secret) = boot_with_user(false, Some("alice.smith"));
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
    assert_eq!(trace["commit"]["by"], "alice-smith");
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
    let mut multi_column = project.clone();
    multi_column
        .schema
        .tables
        .get_mut("adminNotes")
        .unwrap()
        .columns
        .insert("legacy".into(), ColumnType::Int);
    let multi = request(
        port,
        "POST",
        "/control/apply",
        &headers,
        json!({ "project": multi_column }),
    );
    assert_eq!(multi.status, 400, "{}", multi.body);
    assert_eq!(multi.body["code"], "E_SUCCESSOR_NARROWING");
    assert_eq!(multi.body["narrowings"].as_array().unwrap().len(), 2);
    // BTreeMap column order, independent of which column was narrowed first.
    assert_eq!(multi.body["site"], "adminNotes.legacy");
    assert_eq!(multi.body["column"], "legacy");
    assert_eq!(multi.body["narrowings"][0]["column"], "legacy");
    assert_eq!(multi.body["narrowings"][1]["column"], "note");
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

#[test]
fn operator_explicit_by_reaches_commit_trace_and_log_without_minting_a_persona() {
    let (root, _, mut owner, port, secret) = boot(false);
    let headers = [("X-Snapback-Control", secret.as_str())];
    let by = "repair-operator_42";
    let before = status(port, &secret)["personas"].clone();
    let read = request(
        port,
        "POST",
        "/control/execute",
        &headers,
        json!({ "op": "admin.notes", "as": "system", "by": by }),
    );
    assert_eq!(read.status, 200, "{}", read.body);
    assert_eq!(read.body["data"].as_array().unwrap().len(), 2);
    assert_eq!(status(port, &secret)["personas"], before);
    let write = request(
        port,
        "POST",
        "/control/execute",
        &headers,
        json!({ "op": "admin.fill", "args": { "id": "admin-1" }, "as": "system", "by": by }),
    );
    assert_eq!(write.body["state"], "committed", "{}", write.body);
    let trace = request(port, "GET", "/control/trace", &headers, json!({}));
    assert_eq!(trace.body["commit"]["by"], by);
    assert_eq!(trace.body["commit"]["kind"], "operator");
    assert_eq!(status(port, &secret)["personas"], before);
    let logs = request(port, "GET", "/control/logs", &headers, json!({}));
    assert!(
        logs.body["lines"]
            .as_array()
            .unwrap()
            .iter()
            .any(|line| line["kind"] == "operator"
                && line["action"] == "read"
                && line["op"] == "admin.notes"
                && line["by"] == by)
    );
    stop_owner(port, &secret, &mut owner, "explicit attribution complete");
    let db = rusqlite::Connection::open(root.join(".snapback/store.sqlite")).unwrap();
    let count: i64 = db
        .query_row(
            "SELECT count(*) FROM _principals WHERE name = ?1 OR id = ?2",
            [by, &format!("dev:{by}")],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0, "operator attribution minted a persona");
    let recorded: String = db
        .query_row(
            "SELECT by FROM _commits WHERE seq = ?1",
            [write.body["seq"].as_u64().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(recorded, by);
    drop(db);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn operator_by_rejects_reserved_and_invalid_names_through_every_control_adapter() {
    let (root, _, mut owner, port, secret) = boot(false);
    let headers = [("X-Snapback-Control", secret.as_str())];
    let before = status(port, &secret);
    for by in [
        json!("system"),
        json!(""),
        json!("bad/name"),
        json!("alice.smith"),
        json!("with space"),
        json!("é"),
        json!("a".repeat(81)),
        json!(7),
        Value::Null,
    ] {
        for (route, mut body) in [
            (
                "/control/execute",
                json!({ "op": "admin.fill", "args": { "id": "admin-1" } }),
            ),
            ("/control/why", json!({ "op": "admin.notes" })),
            ("/control/data", json!({ "table": "adminNotes" })),
        ] {
            body["as"] = json!("system");
            body["by"] = by.clone();
            let refusal = request(port, "POST", route, &headers, body);
            assert_eq!(refusal.status, 400, "{}", refusal.body);
            let (code, family) = if by == "system" {
                ("E_AUTH_RESERVED", "auth")
            } else {
                ("E_ARGS_NAME", "args")
            };
            assert_eq!(refusal.body["code"], code, "{}", refusal.body);
            assert_eq!(refusal.body["family"], family);
            assert!(
                refusal.body["rewrite"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty())
            );
            assert!(
                refusal.body["guide"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty())
            );
            if family == "args" {
                assert_eq!(refusal.body["site"], "by");
                assert_eq!(refusal.body["guide"], "operator");
            }
        }
    }
    assert_eq!(status(port, &secret)["seq"], before["seq"]);
    assert_eq!(status(port, &secret)["personas"], before["personas"]);
    stop_owner(port, &secret, &mut owner, "invalid attribution complete");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn destructive_apply_refusal_is_preserved_in_owner_status_and_log() {
    let (root, _, mut owner, port, secret) = boot(false);
    let mut project: ProjectJson =
        serde_json::from_slice(&fs::read(root.join(".snapback/build/project.json")).unwrap())
            .unwrap();
    project
        .schema
        .tables
        .get_mut("adminNotes")
        .unwrap()
        .columns
        .remove("legacy");
    let headers = [("X-Snapback-Control", secret.as_str())];
    let before = status(port, &secret);
    let refusal = request(
        port,
        "POST",
        "/control/apply",
        &headers,
        json!({ "project": project }),
    );
    assert_eq!(refusal.status, 400, "{}", refusal.body);
    assert_eq!(refusal.body["code"], "E_SUCCESSOR_DESTRUCTIVE");
    assert!(!refusal.body["plan"]["drops"].as_array().unwrap().is_empty());
    let after = status(port, &secret);
    assert_eq!(after["status"]["state"], "refused");
    assert_eq!(after["status"]["refused"][0], refusal.body);
    assert_eq!(after["generation"], before["generation"]);
    assert_eq!(after["seq"], before["seq"]);
    assert!(
        fs::read_to_string(root.join(".snapback/log.jsonl"))
            .unwrap()
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .any(|line| line["state"] == "refused" && line["refused"][0] == refusal.body)
    );
    stop_owner(port, &secret, &mut owner, "destructive refusal complete");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn operator_read_logs_only_successful_execution_on_run_why_and_data() {
    let (root, _, mut owner, port, secret) = boot(false);
    let headers = [("X-Snapback-Control", secret.as_str())];
    let preflight = request(port, "OPTIONS", "/control/data", &[], json!({}));
    assert_eq!(preflight.status, 403);
    assert_eq!(preflight.body["code"], "E_OWNER_CONTROL_SECRET");
    for route in ["/control/execute", "/control/why", "/control/data"] {
        let refused = request(
            port,
            "POST",
            route,
            &headers,
            json!({
                "op": "admin.pagedNotes", "table": "adminNotes", "args": { "c": "bad-cursor" },
                "after": "bad-cursor", "as": "system", "by": "failed-reader",
            }),
        );
        assert_eq!(refused.status, 400, "{}", refused.body);
        assert_eq!(refused.body["code"], "E_INPUT");
        let accepted = request(
            port,
            "POST",
            route,
            &headers,
            json!({
                "op": "admin.notes", "table": "adminNotes", "as": "system", "by": "successful-reader",
            }),
        );
        assert_eq!(accepted.status, 200, "{}", accepted.body);
    }
    let denied = request(
        port,
        "POST",
        "/control/execute",
        &headers,
        json!({ "op": "admin.deniedRead", "as": "system", "by": "failed-reader" }),
    );
    assert_eq!(denied.body["state"], "denied");
    let records = fs::read_to_string(root.join(".snapback/log.jsonl"))
        .unwrap()
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect::<Vec<_>>();
    assert!(
        !records
            .iter()
            .any(|line| line["action"] == "read" && line["by"] == "failed-reader")
    );
    assert_eq!(
        records
            .iter()
            .filter(|line| line["action"] == "read" && line["by"] == "successful-reader")
            .count(),
        3
    );
    stop_owner(port, &secret, &mut owner, "read logging complete");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn operator_narrowing_malformed_row_has_family_site_rewrite_and_guide_on_the_wire() {
    let (root, compiler, mut owner, port, secret) = boot(false);
    stop_owner(port, &secret, &mut owner, "prepare malformed stored row");
    // Corrupt the fixture only after its exclusive owner has stopped.
    let store = rusqlite::Connection::open(root.join(".snapback/store.sqlite")).unwrap();
    store.execute("UPDATE rows SET data = 'not-json' WHERE table_name = 'adminNotes' AND row_id = 'admin-1'", []).unwrap();
    drop(store);
    let mut owner = ChildGuard::spawn(env!("CARGO_BIN_EXE_snapback2"), &compiler, &root);
    let ready = owner.ready_line();
    assert!(ready.starts_with("SNAPBACK_URL="), "{ready}");
    let record: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let port = record["port"].as_u64().unwrap() as u16;
    let secret = record["secret"].as_str().unwrap();
    let headers = [("X-Snapback-Control", secret)];
    let before = status(port, secret)["generation"].clone();
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
    for route in ["/control/apply", "/control/migrate"] {
        let refusal = request(
            port,
            "POST",
            route,
            &headers,
            json!({ "project": project, "plan": { "drops": [] } }),
        );
        assert_eq!(refusal.status, 400, "{}", refusal.body);
        assert_eq!(refusal.body["code"], "E_SUCCESSOR_ROW_INVALID");
        assert_eq!(refusal.body["family"], "successor");
        assert_eq!(refusal.body["site"], "adminNotes.admin-1");
        assert_eq!(refusal.body["guide"], "successor/migrations");
        assert!(
            refusal.body["rewrite"]
                .as_str()
                .unwrap()
                .contains("repair or remove stored row adminNotes.admin-1")
        );
    }
    assert_eq!(status(port, secret)["generation"], before);
    stop_owner(port, secret, &mut owner, "malformed row proof complete");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejected_operator_update_retains_attempted_write_in_trace_latest_and_log() {
    let (root, compiler, mut owner, port, secret) = boot(false);
    let headers = [("X-Snapback-Control", secret.as_str())];
    let before = status(port, &secret)["seq"].clone();
    let rejected = request(
        port,
        "POST",
        "/control/execute",
        &headers,
        json!({
            "op": "admin.breakImmutable", "args": { "id": "profile-alice", "principal": "dev:bob" },
            "as": "system", "by": "repair-author",
        }),
    );
    assert_eq!(rejected.body["state"], "rejected", "{}", rejected.body);
    assert_eq!(rejected.body["code"], "E_CONSTRAINT");
    let (code, trace) = cli(&root, &compiler, &["trace", "latest"]);
    assert_eq!(code, 0, "{trace}");
    assert_eq!(trace["by"], "repair-author");
    assert_eq!(trace["op"], "admin.breakImmutable");
    assert_eq!(trace["result"]["code"], "E_CONSTRAINT");
    assert_eq!(trace["trace"]["last_write_attempt"]["table"], "profiles");
    assert_eq!(trace["trace"]["last_write_attempt"]["kind"], "Update");
    assert_eq!(trace["trace"]["last_write_attempt"]["max_rows"], 1);
    assert!(trace["trace"]["steps"].as_u64().unwrap() > 0);
    assert_eq!(status(port, &secret)["seq"], before);
    let committed = request(
        port,
        "GET",
        &format!("/control/trace?seq={}", before.as_u64().unwrap()),
        &headers,
        json!({}),
    );
    assert_eq!(committed.body["commit"]["seq"], before);
    assert!(
        fs::read_to_string(root.join(".snapback/log.jsonl"))
            .unwrap()
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .any(|line| line == trace)
    );
    let fill = request(
        port,
        "POST",
        "/control/execute",
        &headers,
        json!({ "op": "admin.fill", "args": { "id": "admin-1" }, "as": "system" }),
    );
    let latest = request(port, "GET", "/control/trace", &headers, json!({}));
    assert_eq!(latest.body["commit"]["seq"], fill.body["seq"]);
    stop_owner(port, &secret, &mut owner, "rejection trace complete");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn query_and_sse_subscription_refuse_the_system_persona_header() {
    let (root, _, mut owner, port, secret) = boot(false);
    for (method, route) in [
        ("POST", "/api/query"),
        ("GET", "/api/subscribe?op=admin.notes&args=%7B%7D"),
    ] {
        let refusal = request(
            port,
            method,
            route,
            &[("X-Snapback-As", "system")],
            json!({ "op": "admin.notes" }),
        );
        assert_eq!(refusal.status, 403, "{}", refusal.body);
        assert_eq!(refusal.body["code"], "E_OPERATOR_REQUIRED");
        assert_eq!(refusal.body["family"], "operator");
        assert_eq!(refusal.body["site"], "--as system");
        assert!(
            refusal.body["rewrite"]
                .as_str()
                .is_some_and(|s| !s.is_empty())
        );
        assert_eq!(refusal.body["guide"], "operator/seat");
    }
    stop_owner(
        port,
        &secret,
        &mut owner,
        "query subscription seat refusal complete",
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn data_cli_persona_is_empty_where_system_sees_the_gated_rows() {
    let (root, compiler, mut owner, port, secret) = boot(false);
    let (code, viewer) = cli(&root, &compiler, &["data", "adminNotes", "--as", "charlie"]);
    assert_eq!(code, 0, "{viewer}");
    assert!(viewer["data"].as_array().unwrap().is_empty());
    let (code, system) = cli(&root, &compiler, &["data", "adminNotes", "--as", "system"]);
    assert_eq!(code, 0, "{system}");
    assert_eq!(system["data"].as_array().unwrap().len(), 2);
    stop_owner(port, &secret, &mut owner, "data visibility complete");
    fs::remove_dir_all(root).unwrap();
}
