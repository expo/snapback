use super::*;

fn boot(serve: bool) -> (PathBuf, PathBuf, ChildGuard, u16, String) {
    let root = temp_root();
    fs::create_dir_all(root.join("snapback")).unwrap();
    fs::write(root.join("snapback/schema.q"), "table items:\n  n: int\n  read <- deny\n  insert <- deny\n  update <- deny\n  delete <- deny\n").unwrap();
    fs::write(
        root.join("snapback/admin.q"),
        r#"job fill:
  chunk p in items first 100 by byId:
    update items[p.id] { n: 42 }

job guarded:
  chunk p in items first 100 by byId:
    update items[p.id] { n: 42 }
    require p.n = 0 else FIX_ROW

query clock():
  return now

mutation reject(id: items):
  update items[id] { n: 88 }
  require false else STOP
  return true
"#,
    )
    .unwrap();
    let rows = (0..205)
        .map(|i| json!({"id":format!("item-{i:03}"),"n":if i == 150 { 1 } else { 0 }}))
        .collect::<Vec<_>>();
    fs::write(root.join("snapback/seed.ts"), format!("import {{seed}} from 'snapback2';\nexport default seed({{ personas: [], rows: {{ items: {} }} }});", json!(rows))).unwrap();
    let compiler = compiler(&root);
    let mut owner =
        ChildGuard::spawn_with(env!("CARGO_BIN_EXE_snapback2"), &compiler, &root, serve);
    let port = owner
        .ready_line()
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap()
        .parse()
        .unwrap();
    let record: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    (
        root,
        compiler,
        owner,
        port,
        record["secret"].as_str().unwrap().into(),
    )
}
fn control(port: u16, secret: &str, path: &str, body: Value) -> Value {
    let r = request(port, "POST", path, &[("X-Snapback-Control", secret)], body);
    assert_eq!(r.status, 200, "{}", r.body);
    r.body
}
fn run(root: &Path, args: &[&str]) -> (i32, Value) {
    let output = Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .args(args)
        .args(["--project"])
        .arg(root)
        .arg("--json")
        .output()
        .unwrap();
    let code = output.status.code().unwrap();
    let result = if output.stdout.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&output.stdout).unwrap_or_else(|e| {
            panic!(
                "{e}: {} {}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            )
        })
    };
    (code, result)
}

#[test]
fn rehearsal_cli_jobs_queries_mutations_receipts_and_usage_exits() {
    let (root, _, mut owner, port, secret) = boot(false);
    let before = status(port, &secret);
    for (op, chunks, rows, state) in [
        ("fill", 3, 205, "done"),
        ("guarded", 1, 100, "parked"),
        ("reject", 0, 0, "rejected"),
        ("clock", 0, 0, "done"),
    ] {
        let mut args = vec!["run", op];
        if op == "reject" {
            args.push(r#"{"id":"item-000"}"#);
        }
        args.extend(["--as", "system", "--dry-run"]);
        let (code, report) = run(&root, &args);
        assert_eq!(code, 0, "{report}");
        assert_eq!(report["dryRun"], true);
        assert_eq!(report["state"], state, "{report}");
        assert_eq!(report["chunks"], chunks);
        assert_eq!(report["rowsWritten"]["items"].as_u64().unwrap_or(0), rows);
        assert_eq!(report["copyDiscarded"], true);
        if op == "clock" {
            assert_eq!(report["result"]["data"], report["now"]);
        }
        if state != "done" {
            assert!(report["refusals"][0]["code"].is_string());
        }
    }
    for extra in ["--wait", "--plan"] {
        assert_eq!(
            run(
                &root,
                &["run", "fill", "--as", "system", "--dry-run", extra]
            )
            .0,
            2
        );
    }
    let denied = run(&root, &["run", "fill", "--as", "alice", "--dry-run"]);
    assert_eq!(denied.0, 1);
    assert_eq!(denied.1["code"], "E_OPERATOR_REQUIRED");
    assert_eq!(
        run(
            &root,
            &["run", "--cancel", "job_x", "--as", "system", "--dry-run"]
        )
        .0,
        2
    );
    let source = "mutation fix(id: items):\n  update items[id] { n: 7 }\n  return true\n";
    let file = root.join("repair.q");
    fs::write(&file, source).unwrap();
    let rehearsal = run(
        &root,
        &[
            "run",
            "--file",
            file.to_str().unwrap(),
            r#"{"id":"item-000"}"#,
            "--as",
            "system",
            "--dry-run",
        ],
    );
    assert_eq!(rehearsal.0, 0, "{rehearsal:?}");
    assert_eq!(rehearsal.1["rowsWritten"]["items"], 1);
    assert!(rehearsal.1["sourceHash"].is_string());
    assert_eq!(
        run(
            &root,
            &[
                "run",
                "--file",
                file.to_str().unwrap(),
                "--as",
                "system",
                "--plan"
            ]
        )
        .0,
        2
    );
    let after = status(port, &secret);
    assert_eq!(after["seq"], before["seq"]);
    assert_eq!(after["jobs"], before["jobs"]);
    assert_eq!(after["effects"], before["effects"]);
    assert_eq!(
        fs::read_dir(root.join(".snapback/rehearsals"))
            .unwrap()
            .count(),
        0
    );
    // An infrastructure failure is exit 1, separately from the successful refusal above.
    fs::remove_dir(root.join(".snapback/rehearsals")).unwrap();
    fs::write(root.join(".snapback/rehearsals"), "blocks copy creation").unwrap();
    let failed = run(&root, &["run", "fill", "--as", "system", "--dry-run"]);
    assert_eq!(failed.0, 1);
    assert_eq!(failed.1["code"], "E_REHEARSAL");
    stop_owner(port, &secret, &mut owner, "rehearsal CLI proof");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn control_run_source_modes_and_declared_job_route_share_operator_admission() {
    let (root, _, mut owner, port, secret) = boot(false);
    let source =
        "job repair:\n  chunk p in items first 100 by byId:\n    update items[p.id] { n: 9 }\n";
    let before = status(port, &secret)["seq"].clone();
    let plan = control(
        port,
        &secret,
        "/control/run",
        json!({"source":source,"args":{},"mode":"plan"}),
    );
    assert_eq!(plan["sweeps"][0]["entries"], 205);
    let report = control(
        port,
        &secret,
        "/control/run",
        json!({"source":source,"args":{},"mode":"dry-run"}),
    );
    assert_eq!(report["chunks"], 3);
    assert_eq!(report["rowsWritten"]["items"], 205);
    assert_eq!(status(port, &secret)["seq"], before);
    let query = control(
        port,
        &secret,
        "/control/run",
        json!({"source":"query inspect():\n  return now\n","mode":"dry-run"}),
    );
    assert_eq!(query["result"]["data"], query["now"]);
    let mutation = control(
        port,
        &secret,
        "/control/run",
        json!({"source":"mutation fix(id: items, n: int):\n  update items[id] { n }\n  return true\n","args":{"id":"item-000","n":10},"mode":"run"}),
    );
    assert_eq!(mutation["state"], "committed");
    let queued = control(
        port,
        &secret,
        "/control/run",
        json!({"source":source,"mode":"run"}),
    );
    let id = queued["id"].as_str().unwrap();
    wait_for(Duration::from_secs(5), || {
        let r = request(
            port,
            "GET",
            &format!("/control/job/{id}"),
            &[("X-Snapback-Control", &secret)],
            json!({}),
        );
        (r.body["state"] == "done").then_some(())
    });
    let declared = control(
        port,
        &secret,
        "/control/job",
        json!({"name":"admin.fill","args":{}}),
    );
    assert!(declared["id"].is_string());
    for (body, code) in [
        (json!({"source":source,"mode":"bad"}), "E_INPUT"),
        (
            json!({"source":source,"mode":"dry-run","wait":true}),
            "E_INPUT",
        ),
        (
            json!({"source":"x".repeat(65537),"mode":"run"}),
            "E_ADHOC_SIZE",
        ),
        (
            json!({"source":source,"mode":"run","as":"alice"}),
            "E_OPERATOR_REQUIRED",
        ),
    ] {
        let r = request(
            port,
            "POST",
            "/control/run",
            &[("X-Snapback-Control", &secret)],
            body,
        );
        assert_eq!(r.status, 400);
        assert_eq!(r.body["code"], code, "{}", r.body);
    }
    let untrusted = request(
        port,
        "POST",
        "/control/run",
        &[],
        json!({"source":source,"mode":"run"}),
    );
    assert_eq!(untrusted.status, 403);
    assert_eq!(untrusted.body["code"], "E_OWNER_CONTROL_SECRET");
    stop_owner(port, &secret, &mut owner, "control source routes");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn serve_refuses_run_and_job_before_body_compilation_or_secret_validation() {
    let (root, _, mut owner, port, secret) = boot(true);
    for path in ["/control/run", "/control/job"] {
        for headers in [vec![], vec![("X-Snapback-Control", secret.as_str())]] {
            let r = request(
                port,
                "POST",
                path,
                &headers,
                json!({"source":"not Quarry","mode":"dry-run"}),
            );
            assert_eq!(r.status, 403);
            assert_eq!(r.body["code"], "E_OPERATOR_REQUIRED");
            assert_eq!(r.body["family"], "operator");
            assert!(r.body["site"].is_string());
            assert!(r.body["rewrite"].is_string());
            assert!(r.body["guide"].is_string());
        }
    }
    stop_owner(port, &secret, &mut owner, "serve operator route fence");
    fs::remove_dir_all(root).unwrap();
}
