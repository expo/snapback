use super::*;

fn boot(serve: bool) -> (PathBuf, PathBuf, ChildGuard, u16, String) {
    boot_with(serve, |_, compiler| compiler.to_path_buf())
}
/// `worker` chooses the `SNAPBACK2_COMPILER` the owner boots with, given the project
/// root and the isolated real compiler; the default is the real compiler itself.
fn boot_with(
    serve: bool,
    worker: impl FnOnce(&Path, &Path) -> PathBuf,
) -> (PathBuf, PathBuf, ChildGuard, u16, String) {
    let root = temp_root();
    fs::create_dir_all(root.join("snapback")).unwrap();
    fs::write(root.join("snapback/schema.q"), "table items:\n  n: int\n  read <- deny\n  insert <- deny\n  update <- deny\n  delete <- deny\n").unwrap();
    fs::write(
        root.join("snapback/admin.q"),
        r#"job fill():
  chunk p in items first 100 by byId:
    update items[p.id] { n: 42 }

job guarded():
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
    let worker = worker(&root, &compiler);
    let mut owner = ChildGuard::spawn_with(env!("CARGO_BIN_EXE_snapback2"), &worker, &root, serve);
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
fn refused(port: u16, secret: &str, path: &str, body: Value) -> Value {
    let r = request(port, "POST", path, &[("X-Snapback-Control", secret)], body);
    assert_eq!(r.status, 400, "{}", r.body);
    r.body
}
fn job_count(port: u16, secret: &str) -> usize {
    let r = request(
        port,
        "GET",
        "/control/jobs",
        &[("X-Snapback-Control", secret)],
        json!({}),
    );
    r.body["jobs"].as_array().unwrap().len()
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
    for control in ["--cancel", "--resume"] {
        assert_eq!(
            run(
                &root,
                &["run", control, "job_x", "--as", "system", "--dry-run"]
            )
            .0,
            2,
            "{control} --dry-run is usage"
        );
    }
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
    // Not exactly one declaration is usage (exit 2), as --plan on a non-job is.
    let two = root.join("two.q");
    fs::write(
        &two,
        "query a():\n  return now\n\nquery b():\n  return now\n",
    )
    .unwrap();
    let usage = run(
        &root,
        &[
            "run",
            "--file",
            two.to_str().unwrap(),
            "--as",
            "system",
            "--dry-run",
        ],
    );
    assert_eq!(usage.0, 2, "{usage:?}");
    assert_eq!(usage.1["code"], "E_INPUT");
    assert_eq!(usage.1["site"], "source");
    // Admission happens on the live runtime before any copy: an unknown program or
    // untyped arguments refuse with the seat's own envelope and never pause the writer.
    for (body, code) in [
        (json!({"name":"nosuch","dryRun":true}), "E_OP_UNKNOWN"),
        (
            json!({"name":"admin.fill","args":{"bogus":1},"dryRun":true}),
            "E_JOB_ARGS",
        ),
    ] {
        let r = refused(port, &secret, "/control/job", body);
        assert_eq!(r["code"], code, "{r}");
    }
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
    control(
        port,
        &secret,
        "/control/clock",
        json!({"advanceMs":86400000}),
    );
    let clock = control(
        port,
        &secret,
        "/control/run",
        json!({"source":"query inspect():\n  return now\n","mode":"run"}),
    );
    assert_eq!(clock["state"], "complete");
    let wall_now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    assert!(clock["data"].as_i64().unwrap() > wall_now + 86000000);
    let source =
        "job repair():\n  chunk p in items first 100 by byId:\n    update items[p.id] { n: 9 }\n";
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
        json!({"source":"mutation fix(id: items, n: int):\n  update items[id] { n }\n  return now\n","args":{"id":"item-000","n":10},"mode":"run"}),
    );
    assert_eq!(mutation["state"], "committed");
    assert!(mutation["data"].as_i64().unwrap() >= clock["data"].as_i64().unwrap());
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
        let r = refused(port, &secret, "/control/run", body);
        assert_eq!(r["code"], code, "{r}");
    }
    // A rehearsal flag is a JSON boolean or refused: no spelling of "true" runs for real.
    let jobs_before = job_count(port, &secret);
    let seq_before = status(port, &secret)["seq"].clone();
    for (path, body, site) in [
        (
            "/control/job",
            json!({"name":"admin.fill","dryRun":"true"}),
            "dryRun",
        ),
        (
            "/control/execute",
            json!({"op":"admin.clock","as":"system","dryRun":"true"}),
            "dryRun",
        ),
        (
            "/control/job",
            json!({"name":"admin.fill","dryRun":1}),
            "dryRun",
        ),
        (
            "/control/job",
            json!({"name":"admin.fill","mode":true}),
            "mode",
        ),
        (
            "/control/execute",
            json!({"op":"admin.clock","as":"system","mode":"dryrun"}),
            "mode",
        ),
        (
            "/control/job",
            json!({"name":"admin.fill","dryRun":true,"mode":"run"}),
            "dryRun",
        ),
        (
            "/control/job",
            json!({"name":"admin.fill","plan":"true"}),
            "plan",
        ),
        (
            "/control/job",
            json!({"name":"admin.fill","dryRun":true,"plan":true}),
            "plan",
        ),
        (
            "/control/job",
            json!({"name":"admin.fill","mode":"dry-run","wait":true}),
            "wait",
        ),
        (
            "/control/job",
            json!({"name":"admin.fill","mode":"run","wait":true}),
            "wait",
        ),
        ("/control/run", json!({"source":source,"mode":true}), "mode"),
        (
            "/control/run",
            json!({"source":source,"mode":"run","wait":"true"}),
            "wait",
        ),
        // A flag that disagrees with `mode`, or with the other flag, refuses at the flag's
        // site on the source route too: `{ mode: "run", dryRun: true }` never runs for real.
        (
            "/control/run",
            json!({"source":source,"mode":"run","dryRun":true}),
            "dryRun",
        ),
        (
            "/control/run",
            json!({"source":source,"mode":"plan","dryRun":true}),
            "dryRun",
        ),
        (
            "/control/run",
            json!({"source":source,"mode":"dry-run","dryRun":false}),
            "dryRun",
        ),
        (
            "/control/run",
            json!({"source":source,"mode":"dry-run","plan":true}),
            "plan",
        ),
        (
            "/control/run",
            json!({"source":source,"mode":"run","plan":true}),
            "plan",
        ),
        (
            "/control/run",
            json!({"source":source,"dryRun":true,"plan":true}),
            "plan",
        ),
        (
            "/control/run",
            json!({"source":source,"dryRun":true,"wait":true}),
            "wait",
        ),
    ] {
        let r = refused(port, &secret, path, body);
        assert_eq!(r["code"], "E_INPUT", "{path}: {r}");
        assert_eq!(r["site"], site, "{path}: {r}");
        assert!(r["rewrite"].is_string());
    }
    assert_eq!(
        job_count(port, &secret),
        jobs_before,
        "a refused flag enqueued"
    );
    assert_eq!(
        status(port, &secret)["seq"],
        seq_before,
        "a refused flag ran"
    );
    let accepted_false = control(
        port,
        &secret,
        "/control/job",
        json!({"name":"admin.fill","mode":"plan","wait":false}),
    );
    assert_eq!(accepted_false["engineWrites"], json!(["_jobs"]), "{accepted_false}");
    // The flags alone are honoured, not ignored: `dryRun: true` rehearses, `plan: true`
    // plans, and `mode: "plan"` on the declared route is the plan flag.
    let rehearsed = control(
        port,
        &secret,
        "/control/run",
        json!({"source":source,"dryRun":true}),
    );
    assert_eq!(rehearsed["dryRun"], true, "{rehearsed}");
    assert_eq!(rehearsed["chunks"], 3);
    assert_eq!(
        status(port, &secret)["seq"],
        seq_before,
        "dryRun: true ran for real"
    );
    let planned = control(
        port,
        &secret,
        "/control/run",
        json!({"source":source,"plan":true}),
    );
    assert_eq!(planned["sweeps"][0]["entries"], 205, "{planned}");
    let planned = control(
        port,
        &secret,
        "/control/job",
        json!({"name":"admin.fill","mode":"plan"}),
    );
    assert_eq!(planned["engineWrites"], json!(["_jobs"]), "{planned}");
    assert_eq!(job_count(port, &secret), jobs_before, "a plan enqueued");
    let sneaky = refused(
        port,
        &secret,
        "/control/execute",
        json!({"op":"admin.clock","as":"system","plan":true}),
    );
    assert_eq!(sneaky["code"], "E_OP_KIND", "{sneaky}");
    assert_eq!(sneaky["site"], "mode");
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
fn control_run_compiles_with_the_owners_worker_and_spawns_no_second_compiler() {
    let (root, _, mut owner, port, secret) = boot_with(false, |root, compiler| {
        // Every worker start appends one line, then the real bundled compiler takes over.
        let log = root.join("compiler-spawns.log");
        write_worker(
            root,
            "counting-compiler.mjs",
            &format!(
                "import {{ appendFileSync }} from \"node:fs\";\nimport {{ pathToFileURL }} from \"node:url\";\nappendFileSync({}, \"spawn\\n\");\nawait import(pathToFileURL({}).href);\n",
                serde_json::to_string(log.to_str().unwrap()).unwrap(),
                serde_json::to_string(compiler.to_str().unwrap()).unwrap(),
            ),
        )
    });
    let log = root.join("compiler-spawns.log");
    let spawns = || fs::read_to_string(&log).unwrap().lines().count();
    assert_eq!(spawns(), 1, "the owner boots exactly one compiler worker");
    let source =
        "job repair():\n  chunk p in items first 100 by byId:\n    update items[p.id] { n: 9 }\n";
    // Each request compiles for real with the owner's worker; the slowest round trip is
    // printed and must fit the CLI client's bound for ad hoc plan/run (the compiler's
    // 30 s request timeout plus a 5 s margin, `client::read_timeout`).
    let mut slowest = Duration::ZERO;
    for mode in ["plan", "dry-run", "plan", "run"] {
        let began = Instant::now();
        let r = control(
            port,
            &secret,
            "/control/run",
            json!({"source":source,"args":{},"mode":mode}),
        );
        slowest = slowest.max(began.elapsed());
        assert!(r.is_object(), "{mode}: {r}");
    }
    println!("Closing round: slowest ad hoc /control/run compile round trip {slowest:?}");
    assert!(
        slowest < Duration::from_secs(35),
        "an ad hoc compile must fit the client's bound: {slowest:?}"
    );
    let broken = refused(
        port,
        &secret,
        "/control/run",
        json!({"source":"not Quarry","mode":"plan"}),
    );
    assert_eq!(
        broken["code"]
            .as_str()
            .unwrap_or_default()
            .starts_with("E_"),
        true
    );
    assert_eq!(
        spawns(),
        1,
        "/control/run spawned its own compiler worker instead of using the owner's"
    );
    stop_owner(port, &secret, &mut owner, "shared compiler worker");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn serve_refuses_run_job_and_execute_before_body_compilation_or_secret_validation() {
    let (root, _, mut owner, port, secret) = boot(true);
    for (path, body) in [
        (
            "/control/run",
            json!({"source":"not Quarry","mode":"dry-run"}),
        ),
        ("/control/job", json!({"name":"admin.fill","dryRun":true})),
        (
            "/control/execute",
            json!({"op":"admin.clock","as":"system","dryRun":true}),
        ),
        ("/control/execute", json!({"op":"admin.clock","as":"alice"})),
    ] {
        for headers in [vec![], vec![("X-Snapback-Control", secret.as_str())]] {
            let r = request(port, "POST", path, &headers, body.clone());
            assert_eq!(r.status, 403, "{path}: {}", r.body);
            assert_eq!(r.body["code"], "E_OPERATOR_REQUIRED", "{path}: {}", r.body);
            assert_eq!(r.body["family"], "operator");
            assert!(r.body["site"].is_string());
            assert!(r.body["rewrite"].is_string());
            assert!(r.body["guide"].is_string());
        }
    }
    stop_owner(port, &secret, &mut owner, "serve operator route fence");
    fs::remove_dir_all(root).unwrap();
}
