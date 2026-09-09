use super::*;

fn boot_jobs() -> (PathBuf, PathBuf, ChildGuard, u16, String) {
    boot_jobs_rows(350)
}
pub(super) fn boot_jobs_rows(count: usize) -> (PathBuf, PathBuf, ChildGuard, u16, String) {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let schema = root.join("snapback/schema.q");
    fs::write(
        &schema,
        fs::read_to_string(&schema).unwrap()
            + r#"

table jobRows:
  value: text <=40 ?
  ok: bool
  public
  insert <- allow
  update <- allow
  delete <- allow
"#,
    )
    .unwrap();
    fs::write(
        root.join("snapback/jobs.q"),
        r#"job fill():
  chunk p in jobRows first 100 by byId:
    update jobRows[p.id] { value: p.value ?? 'filled' }

job guarded():
  chunk p in jobRows first 100 by byId:
    require p.ok else FIX_ROW
    update jobRows[p.id] { value: 'guarded' }

job one():
  chunk p in jobRows first 1 by byId:
    update jobRows[p.id] { value: 'one' }

job tens():
  chunk p in jobRows first 10 by byId:
    update jobRows[p.id] { value: 'tens' }

mutation send(id: jobRows):
  update jobRows[id] { ok: true }
  return true

mutation setOk(id: jobRows, ok: bool):
  update jobRows[id] { ok }
  return true
"#,
    )
    .unwrap();
    let seed = root.join("snapback/seed.ts");
    let rows = (0..count)
        .map(|n| format!(r#"{{ id: "job-{n:03}", value: null, ok: true }}"#))
        .collect::<Vec<_>>()
        .join(",");
    fs::write(
        &seed,
        fs::read_to_string(&seed).unwrap().replace(
            "    notifications: [",
            &format!("    jobRows: [{rows}],\n    notifications: ["),
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
    let mut owner = ChildGuard::spawn(env!("CARGO_BIN_EXE_snapback2"), &compiler, &root);
    let ready = owner.ready_line();
    let port = ready
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap_or_else(|| panic!("owner start: {ready}"))
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
pub(super) fn control_job(port: u16, secret: &str, method: &str, path: &str, body: Value) -> Value {
    let r = request(port, method, path, &[("X-Snapback-Control", secret)], body);
    assert_eq!(r.status, 200, "{}", r.body);
    r.body
}
pub(super) fn cli_jobs(root: &Path, compiler: &Path, args: &[&str]) -> (i32, Vec<Value>) {
    let output = Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .args(args)
        .args(["--json", "--project"])
        .arg(root)
        .env("SNAPBACK2_COMPILER", compiler)
        .output()
        .unwrap();
    let lines = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| {
            serde_json::from_str(l).unwrap_or_else(|_| {
                panic!(
                    "{} {}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                )
            })
        })
        .collect();
    (output.status.code().unwrap(), lines)
}
#[test]
fn jobs_350_rows_finish_under_client_load_and_park_resume_through_owner() {
    let (root, compiler, mut owner, port, secret) = boot_jobs();
    let finished = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let finished_sender = finished.clone();
    let worker = thread::spawn(move || {
        let mut latencies = Vec::new();
        while latencies.len() < 100 || !finished_sender.load(std::sync::atomic::Ordering::Relaxed) {
            let start = Instant::now();
            let r = request(
                port,
                "POST",
                "/api/mutation",
                &[("X-Snapback-As", "alice")],
                json!({"op":"messages.send","args":{"conversationId":"conversation-1","recipientId":"profile-bob","body":format!("during fill {}",latencies.len())}}),
            );
            assert_eq!(r.status, 200, "{}", r.body);
            assert_eq!(r.body["state"], "committed", "{}", r.body);
            latencies.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        latencies.sort_by(f64::total_cmp);
        println!(
            "J1b client median during fill: {:.3} ms ({} chat sends committed)",
            latencies[latencies.len() / 2],
            latencies.len()
        );
    });
    let plan = cli_jobs(
        &root,
        &compiler,
        &["run", "fill", "--as", "system", "--plan"],
    );
    assert_eq!(plan.0, 0, "{plan:?}");
    assert_eq!(plan.1[0]["sweeps"][0]["entries"], 350);
    assert_eq!(plan.1[0]["sweeps"][0]["impliedChunks"], 4);
    assert!(
        control_job(port, &secret, "GET", "/control/jobs", json!({}))["jobs"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let (code, lines) = cli_jobs(
        &root,
        &compiler,
        &["run", "fill", "--as", "system", "--wait"],
    );
    assert_eq!(code, 0, "{lines:?}");
    // --wait --json: one envelope per chunk, then the job's final envelope, its receipt.
    assert_eq!(
        lines.len(),
        5,
        "four chunk lines and the receipt: {lines:?}"
    );
    for (i, line) in lines[..4].iter().enumerate() {
        assert_eq!(line["chunk"], i as u64 + 1, "{line}");
        assert_eq!(line["commit"]["kind"], "job", "{line}");
    }
    let receipt = lines.last().unwrap();
    assert!(
        receipt.get("commit").is_none() && receipt["state"] == "done",
        "the last line is the job receipt(): {receipt}"
    );
    assert_eq!(receipt["chunks"], 4);
    assert_eq!(receipt["rowsWritten"]["jobRows"], 350);
    finished.store(true, std::sync::atomic::Ordering::Relaxed);
    worker.join().unwrap();
    let id = lines.last().unwrap()["id"].as_str().unwrap();
    let trace = cli_jobs(&root, &compiler, &["trace", id]);
    assert_eq!(trace.0, 0);
    assert_eq!(trace.1[0]["name"], "jobs.fill");
    assert_eq!(trace.1[0]["commits"].as_array().unwrap().len(), 4);
    let seq = trace.1[0]["commits"][0]["seq"]
        .as_u64()
        .unwrap()
        .to_string();
    let commit = cli_jobs(&root, &compiler, &["trace", &seq]);
    assert_eq!(commit.1[0]["commit"]["job"], id);
    let queued = (0..2)
        .map(|_| {
            control_job(
                port,
                &secret,
                "POST",
                "/control/job",
                json!({"name":"jobs.fill","args":{},"as":"system"}),
            )["id"]
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect::<Vec<_>>();
    let completed = wait_for(Duration::from_secs(5), || {
        let rows = queued
            .iter()
            .map(|id| {
                control_job(
                    port,
                    &secret,
                    "GET",
                    &format!("/control/job/{id}"),
                    json!({}),
                )
            })
            .collect::<Vec<_>>();
        rows.iter().all(|r| r["state"] == "done").then_some(rows)
    });
    // FIFO, not merely serialized: every commit of the earlier-enqueued job precedes
    // every commit of the later one.
    let seqs = |job: &Value| {
        job["commits"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["seq"].as_u64().unwrap())
            .collect::<Vec<_>>()
    };
    let (earlier, later) = (seqs(&completed[0]), seqs(&completed[1]));
    assert_eq!((earlier.len(), later.len()), (4, 4), "{completed:?}");
    assert!(completed[0]["createdAt"].as_i64() <= completed[1]["createdAt"].as_i64());
    assert!(
        earlier.iter().max() < later.iter().min(),
        "the earlier-enqueued job's commits all precede the later one's: {earlier:?} then {later:?}"
    );
    let denied = cli_jobs(&root, &compiler, &["run", "fill", "--as", "alice"]);
    assert_eq!(denied.0, 1);
    assert_eq!(denied.1[0]["code"], "E_OPERATOR_REQUIRED");
    let api = request(
        port,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", "alice")],
        json!({"op":"jobs.fill","args":{}}),
    );
    assert_eq!(api.body["code"], "E_OPERATOR_REQUIRED");
    let malformed = request(
        port,
        "POST",
        "/control/job",
        &[("X-Snapback-Control", &secret)],
        json!({"name":"jobs.fill","args":{"bad":1},"as":"system"}),
    );
    assert_eq!(malformed.body["code"], "E_JOB_ARGS");
    assert_eq!(malformed.body["rewrite"], "job fill():", "{}", malformed.body);
    assert_eq!(malformed.body["family"], "job");
    control_job(
        port,
        &secret,
        "POST",
        "/control/execute",
        json!({"op":"jobs.setOk","args":{"id":"job-000","ok":false},"as":"system"}),
    );
    let parked = cli_jobs(
        &root,
        &compiler,
        &["run", "guarded", "--as", "system", "--wait"],
    );
    assert_eq!(parked.0, 1, "{parked:?}");
    let parked_id = parked.1.last().unwrap()["id"].as_str().unwrap();
    assert_eq!(parked.1.last().unwrap()["state"], "parked");
    let s = control_job(port, &secret, "GET", "/control/status", json!({}));
    assert_eq!(s["jobs"]["parked"], 1);
    control_job(
        port,
        &secret,
        "POST",
        "/control/execute",
        json!({"op":"jobs.setOk","args":{"id":"job-000","ok":true},"as":"system"}),
    );
    assert_eq!(
        cli_jobs(
            &root,
            &compiler,
            &["run", "--resume", parked_id, "--as", "system"]
        )
        .0,
        0
    );
    wait_for(Duration::from_secs(5), || {
        let s = control_job(
            port,
            &secret,
            "GET",
            &format!("/control/job/{parked_id}"),
            json!({}),
        );
        (s["state"] == "done").then_some(())
    });
    control_job(
        port,
        &secret,
        "POST",
        "/control/execute",
        json!({"op":"jobs.setOk","args":{"id":"job-000","ok":false},"as":"system"}),
    );
    let p = cli_jobs(
        &root,
        &compiler,
        &["run", "guarded", "--as", "system", "--wait"],
    );
    let cancel_id = p.1.last().unwrap()["id"].as_str().unwrap();
    let cancelled = cli_jobs(
        &root,
        &compiler,
        &["run", "--cancel", cancel_id, "--as", "system"],
    );
    assert_eq!(cancelled.1[0]["state"], "cancelled");
    assert_eq!(
        cli_jobs(
            &root,
            &compiler,
            &["run", "--resume", cancel_id, "--as", "system"]
        )
        .0,
        1
    );
    stop_owner(port, &secret, &mut owner, "jobs load test");
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn run_file_query_mutation_job_and_deleted_adapters_through_binary() {
    let (root, compiler, mut owner, port, secret) = boot_jobs();
    let page = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/snapback2/guide/job.md"),
    )
    .unwrap();
    let recipe = page
        .split("```q\n")
        .nth(1)
        .unwrap()
        .split("\n```")
        .next()
        .unwrap();
    for (source, wait) in [
        (
            "query inspect():\n  return jobRows[] first 2 by byId\n",
            false,
        ),
        (
            "mutation fix(id: jobRows):\n  update jobRows[id] { value: 'operator' }\n",
            false,
        ),
        (recipe, true),
    ] {
        let path = root.join("repair.q");
        fs::write(&path, source).unwrap();
        let mut args = vec!["run", "--file", path.to_str().unwrap()];
        if source.starts_with("mutation") {
            args.push(r#"{"id":"job-000"}"#);
        }
        args.extend(["--as", "system"]);
        if wait {
            args.push("--wait");
        }
        if source.starts_with("query") {
            let mut invalid = args.clone();
            invalid.push("--plan");
            assert_eq!(cli_jobs(&root, &compiler, &invalid).0, 2);
        }
        let (code, lines) = cli_jobs(&root, &compiler, &args);
        assert_eq!(code, 0, "{lines:?}");
        assert!(lines.last().unwrap()["sourceHash"].is_string(), "{lines:?}");
        if wait {
            assert_eq!(lines.last().unwrap()["state"], "done");
            assert!(
                lines.last().unwrap()["rowsWritten"]["profiles"]
                    .as_u64()
                    .unwrap()
                    > 0
            );
        }
    }
    let path = root.join("large.q");
    fs::write(&path, "x".repeat(65537)).unwrap();
    let too_big = cli_jobs(
        &root,
        &compiler,
        &["run", "--file", path.to_str().unwrap(), "--as", "system"],
    );
    assert_eq!(too_big.1[0]["code"], "E_ADHOC_SIZE");
    let gone = Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .arg("fork")
        .output()
        .unwrap();
    assert_eq!(gone.status.code(), Some(2));
    assert!(!String::from_utf8_lossy(&gone.stderr).contains(" | fork |"));
    assert_eq!(
        cli_jobs(&root, &compiler, &["persona", "create", "someone"]).0,
        2
    );
    stop_owner(port, &secret, &mut owner, "jobs file test");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
#[ignore = "LLP 1016 measurements, explicitly run outside the blocking suite"]
fn measure_job_turn_with_50_live_and_client_p95() {
    let (root, compiler, mut owner, port, secret) = boot_jobs_rows(1200);
    // Install a small live query through the same owner successor route the watcher uses.
    let mut project: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/build/project.json")).unwrap())
            .unwrap();
    let query = json!({"name":"jobs.live","kind":"Query","args":{},"read_time_granularity_ms":null,"body":[{"Return":{"Scan":{"site":"live","table":"jobRows","index":"byId","prefix":[],"order":"Asc","take":{"Literal":100},"after":null,"before":null,"range":null,"merge_site":null,"provenance":"Const"}}}]});
    project["programs"].as_array_mut().unwrap().push(query);
    control_job(
        port,
        &secret,
        "POST",
        "/control/apply",
        json!({"project":project}),
    );
    let mut stream = Sse::live(port, "alice");
    let session = stream.event()["session"].clone();
    let adds = (0..50)
        .map(|id| json!({"id":format!("q{id}"),"path":"/api/subscribe?op=jobs.live&args=%7B%7D"}))
        .collect::<Vec<_>>();
    let subscribed = request(
        port,
        "POST",
        "/api/live/control",
        &[("X-Snapback-As", "alice")],
        json!({"session":session,"add":adds}),
    );
    assert_eq!(subscribed.status, 200, "{}", subscribed.body);
    for _ in 0..50 {
        assert!(stream.event()["data"]["state"].as_str().is_some());
    }
    let baseline_senders = (0..8)
        .map(|_| {
            thread::spawn(move || {
                (0..5)
                    .map(|_| {
                        let began = Instant::now();
                        let r = request(
                            port,
                            "POST",
                            "/api/mutation",
                            &[("X-Snapback-As", "alice")],
                            json!({"op":"jobs.send","args":{"id":"job-349"}}),
                        );
                        assert_eq!(r.body["state"], "committed", "{}", r.body);
                        began.elapsed().as_secs_f64() * 1000.0
                    })
                    .collect::<Vec<_>>()
            })
        })
        .collect::<Vec<_>>();
    let mut baseline = baseline_senders
        .into_iter()
        .flat_map(|s| s.join().unwrap())
        .collect::<Vec<_>>();
    baseline.sort_by(f64::total_cmp);
    let baseline_p95 = baseline[(baseline.len() * 95 / 100).min(baseline.len() - 1)];
    let row = control_job(
        port,
        &secret,
        "POST",
        "/control/job",
        json!({"name":"jobs.fill","args":{},"as":"system"}),
    );
    let id = row["id"].as_str().unwrap();
    let finished = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let senders = (0..8)
        .map(|_| {
            let finished = finished.clone();
            thread::spawn(move || {
                let mut times = Vec::new();
                while !finished.load(std::sync::atomic::Ordering::Relaxed) {
                    let began = Instant::now();
                    let r = request(
                        port,
                        "POST",
                        "/api/mutation",
                        &[("X-Snapback-As", "alice")],
                        json!({"op":"jobs.send","args":{"id":"job-349"}}),
                    );
                    assert_eq!(r.body["state"], "committed", "{}", r.body);
                    times.push(began.elapsed().as_secs_f64() * 1000.0);
                }
                times
            })
        })
        .collect::<Vec<_>>();
    loop {
        let current = control_job(
            port,
            &secret,
            "GET",
            &format!("/control/job/{id}"),
            json!({}),
        );
        if current["state"] == "done" {
            break;
        }
        assert_ne!(current["state"], "parked", "{current}");
        thread::sleep(Duration::from_millis(10));
    }
    finished.store(true, std::sync::atomic::Ordering::Relaxed);
    let mut during = senders
        .into_iter()
        .flat_map(|s| s.join().unwrap())
        .collect::<Vec<_>>();
    during.sort_by(f64::total_cmp);
    let during_p95 = during[(during.len() * 95 / 100).min(during.len() - 1)];
    let log = fs::read_to_string(root.join(".snapback/log.jsonl")).unwrap();
    // Whole turns, and the split the RFC's §8 budget needs: the chunk's execution including
    // its commit (`chunkMs`) versus the live reruns that fill the rest of the turn.
    let lines = log
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|l| l["job"] == id && l["state"] != "done")
        .collect::<Vec<_>>();
    let turns = lines
        .iter()
        .filter_map(|l| l["ms"].as_f64())
        .collect::<Vec<_>>();
    let chunks = lines
        .iter()
        .filter_map(|l| l["chunkMs"].as_f64())
        .collect::<Vec<_>>();
    let reruns = turns
        .iter()
        .zip(&chunks)
        .map(|(t, c)| t - c)
        .collect::<Vec<_>>();
    assert_eq!((turns.len(), chunks.len()), (11, 11));
    let median = |values: &[f64]| {
        let mut sorted = values.to_vec();
        sorted.sort_by(f64::total_cmp);
        sorted[sorted.len() / 2]
    };
    println!(
        "J1B_METRIC {}",
        json!({"metric":"background_turn_100_rows_50_live","profile":if cfg!(debug_assertions) { "debug" } else { "release" },
        "milliseconds":turns,"chunkMilliseconds":chunks,"rerunMilliseconds":reruns,
        "medianMilliseconds":median(&turns),"medianChunkMilliseconds":median(&chunks),"medianRerunMilliseconds":median(&reruns),
        "budgetMilliseconds":30,"method":"real owner writer log; ms is the whole turn including after_commit live reruns, chunkMs the chunk execution including its commit; 50 live queries of 100 rows"})
    );
    println!(
        "J1B_METRIC {}",
        json!({"metric":"client_p95_during_fill","baselineMilliseconds":baseline_p95,"duringMilliseconds":during_p95,"ratio":during_p95/baseline_p95,"budgetRatio":2,"baselineSamples":baseline.len(),"duringSamples":during.len(),"method":"real HTTP mutation round trips, 50 live subscriptions, 1200-row fill, eight HTTP senders both idle and during fill, plus status polls"})
    );
    drop(stream);
    let _ = compiler;
    stop_owner(port, &secret, &mut owner, "jobs measurements");
    fs::remove_dir_all(root).unwrap();
}
