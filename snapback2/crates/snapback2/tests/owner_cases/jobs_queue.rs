//! LLP 1016 J1b fix round 1: the queue, paging, cadence, state refusals, the narrowing paste,
//! and a chunk-time executable mismatch, all through the real binary.
use super::jobs::{boot_jobs_rows, cli_jobs, control_job};
use super::*;
use snapback2_core::Store;

fn job_state(port: u16, secret: &str, id: &str) -> Value {
    control_job(
        port,
        secret,
        "GET",
        &format!("/control/job/{id}"),
        json!({}),
    )
}
fn wait_done(port: u16, secret: &str, id: &str, timeout: Duration) -> Value {
    wait_for(timeout, || {
        let row = job_state(port, secret, id);
        assert_ne!(row["state"], "parked", "{row}");
        (row["state"] == "done").then_some(row)
    })
}

#[test]
fn jobs_queue_position_paging_beyond_500_commits_receipt_plan_and_state_refusals() {
    let (root, compiler, mut owner, port, secret) = boot_jobs_rows(510);
    // --plan carries the ceilings and the engine writes, not only the entry counts.
    let plan = cli_jobs(
        &root,
        &compiler,
        &["run", "one", "--as", "system", "--plan"],
    );
    assert_eq!(plan.0, 0, "{plan:?}");
    let plan = &plan.1[0];
    assert_eq!(plan["engineWrites"], json!(["_jobs"]));
    assert_eq!(plan["chunks"], "unbounded");
    assert_eq!(plan["sweeps"][0]["impliedChunks"], 510);
    let ceilings = &plan["sweeps"][0]["ceilings"];
    assert!(ceilings["max_steps"].as_u64().unwrap() > 0, "{plan}");
    assert!(ceilings["max_examined"].as_u64().unwrap() >= 1, "{plan}");
    let sites = ceilings["write_sites"].as_array().unwrap();
    assert_eq!(sites.last().unwrap()["table"], "_jobs", "{plan}");
    assert_eq!(sites[0]["table"], "jobRows", "{plan}");

    // queuePosition on enqueue: the head is 1, the next is 2.
    let started = Instant::now();
    let first = control_job(
        port,
        &secret,
        "POST",
        "/control/job",
        json!({"name":"jobs.one","args":{},"as":"system"}),
    );
    assert_eq!(first["queuePosition"], 1, "{first}");
    let second = control_job(
        port,
        &secret,
        "POST",
        "/control/job",
        json!({"name":"jobs.fill","args":{},"as":"system"}),
    );
    assert_eq!(second["queuePosition"], 2, "{second}");
    let (one, fill) = (
        first["id"].as_str().unwrap(),
        second["id"].as_str().unwrap(),
    );
    // Idle, the writer polls with a zero timeout: 510 one-row chunks finish back to back
    // (1.7–1.8 s measured, LLP 1016 §12), not one per session/asset poll (≥ 510 s at the
    // 1 s session poll). The bound is ten seconds — under 20 ms a chunk, which no poll
    // interval in the loop could produce — so the claim is pinned without a flake under
    // the parallel gate; the measured number is printed beside it.
    let done = wait_done(port, &secret, one, Duration::from_secs(60));
    let idle_seconds = started.elapsed().as_secs_f64();
    println!("J1b 510 idle chunks in {idle_seconds:.2}s");
    assert!(
        idle_seconds < 10.0,
        "idle chunks must run back to back: {idle_seconds}s"
    );
    assert_eq!(done["chunks"], 510);

    // Paging beyond 500 commits: the aggregates cover the whole ledger, the pages join up.
    let trace = cli_jobs(&root, &compiler, &["trace", one]);
    assert_eq!(trace.0, 0);
    let page = &trace.1[0];
    let commits = page["commits"].as_array().unwrap();
    assert_eq!(commits.len(), 500, "{page}");
    assert_eq!(page["hasMoreCommits"], true);
    assert_eq!(page["retainedChunks"], 510);
    assert_eq!(page["sweepChunks"]["0"], 510);
    let (from, to) = (
        page["commitRange"]["from"].as_u64().unwrap(),
        page["commitRange"]["to"].as_u64().unwrap(),
    );
    assert_eq!(commits[0]["seq"], from);
    let after = commits[499]["seq"].as_u64().unwrap();
    let rest = control_job(
        port,
        &secret,
        "GET",
        &format!("/control/job/{one}?after={after}"),
        json!({}),
    );
    let tail = rest["commits"].as_array().unwrap();
    assert_eq!(tail.len(), 10, "{rest}");
    assert_eq!(rest["hasMoreCommits"], false);
    assert_eq!(tail.last().unwrap()["seq"], to);
    assert_eq!(tail[0]["jobChunk"]["chunk"], 501, "{rest}");
    assert!(
        tail.iter()
            .zip(&commits[499..])
            .all(|(t, c)| t["seq"].as_u64() > c["seq"].as_u64())
    );

    // FIFO: the second job started only after the first finished.
    let fill_done = wait_done(port, &secret, fill, Duration::from_secs(30));
    assert!(
        fill_done["commitRange"]["from"].as_u64().unwrap() > to,
        "{fill_done}"
    );

    // cancel and resume on a finished job are typed refusals in the job family, never silent.
    let cancel = cli_jobs(
        &root,
        &compiler,
        &["run", "--cancel", one, "--as", "system"],
    );
    assert_eq!(cancel.0, 1, "{cancel:?}");
    assert_eq!(cancel.1[0]["code"], "E_JOB_STATE");
    assert_eq!(cancel.1[0]["family"], "job");
    assert!(
        cancel.1[0]["message"].as_str().unwrap().contains("is done"),
        "{cancel:?}"
    );
    let resume = cli_jobs(
        &root,
        &compiler,
        &["run", "--resume", one, "--as", "system"],
    );
    assert_eq!(
        (resume.0, resume.1[0]["code"].as_str()),
        (1, Some("E_JOB_STATE")),
        "{resume:?}"
    );
    assert_eq!(job_state(port, &secret, one)["state"], "done");
    stop_owner(port, &secret, &mut owner, "jobs queue test");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn jobs_advance_at_least_one_chunk_per_nine_turns_under_a_saturated_channel() {
    let (root, _compiler, mut owner, port, secret) = boot_jobs_rows(350);
    let finished = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let senders = (0..8)
        .map(|_| {
            let finished = finished.clone();
            thread::spawn(move || {
                let mut sent = 0_u64;
                while !finished.load(std::sync::atomic::Ordering::Relaxed) {
                    let r = request(
                        port,
                        "POST",
                        "/api/mutation",
                        &[("X-Snapback-As", "alice")],
                        json!({"op":"jobs.send","args":{"id":"job-000"}}),
                    );
                    assert_eq!(r.body["state"], "committed", "{}", r.body);
                    sent += 1;
                }
                sent
            })
        })
        .collect::<Vec<_>>();
    let row = control_job(
        port,
        &secret,
        "POST",
        "/control/job",
        json!({"name":"jobs.tens","args":{},"as":"system"}),
    );
    let id = row["id"].as_str().unwrap().to_owned();
    let done = wait_done(port, &secret, &id, Duration::from_secs(120));
    assert_eq!(done["chunks"], 35, "{done}");
    finished.store(true, std::sync::atomic::Ordering::Relaxed);
    let sent: u64 = senders.into_iter().map(|s| s.join().unwrap()).sum();
    let log = fs::read_to_string(root.join(".snapback/log.jsonl")).unwrap();
    let turns = log
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|l| l["kind"] == "job" && l["job"] == id)
        .collect::<Vec<_>>();
    assert_eq!(turns.len(), 35, "one log line per chunk");
    assert!(
        turns
            .iter()
            .all(|t| t["chunkMs"].as_f64().unwrap() <= t["ms"].as_f64().unwrap()),
        "chunk execution (including its commit) is part of the turn"
    );
    stop_owner(port, &secret, &mut owner, "jobs cadence test");
    // The ledger, read from the stopped store: between two consecutive chunk commits the writer
    // served at most eight client turns, so at most eight client commits.
    let store = Store::open(&root.join(".snapback/store.sqlite")).unwrap();
    let ledger = store.commits_since(0, 100_000).unwrap();
    drop(store);
    let chunk_seqs = ledger
        .iter()
        .filter(|c| c.job.as_deref() == Some(&id))
        .map(|c| c.seq)
        .collect::<Vec<_>>();
    assert_eq!(chunk_seqs.len(), 35);
    let mut max_between = 0;
    for pair in chunk_seqs.windows(2) {
        let between = ledger
            .iter()
            .filter(|c| c.seq > pair[0] && c.seq < pair[1] && c.kind != "job")
            .count();
        max_between = max_between.max(between);
    }
    let during = ledger
        .iter()
        .filter(|c| c.seq > chunk_seqs[0] && c.seq < chunk_seqs[34] && c.kind != "job")
        .count();
    println!(
        "J1b cadence: {sent} client sends, {during} client commits during the fill, at most {max_between} between chunks"
    );
    assert!(
        max_between <= 8,
        "a chunk at least every nine turns: {max_between} client commits between two chunks"
    );
    assert!(
        during >= 35,
        "the channel was not saturated: {during} client commits during 35 chunks"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn narrowing_paste_runs_as_a_file_then_the_narrowing_applies_and_adhoc_rows_ledger_their_hash() {
    let (root, compiler, mut owner, port, secret) = boot_jobs_rows(350);
    // An ad hoc mutation ledgers kind operator under adhoc:<source hash>.
    let path = root.join("fix.q");
    fs::write(
        &path,
        "mutation fix(id: jobRows):\n  update jobRows[id] { value: 'operator' }\n",
    )
    .unwrap();
    let (code, lines) = cli_jobs(
        &root,
        &compiler,
        &[
            "run",
            "--file",
            path.to_str().unwrap(),
            r#"{"id":"job-000"}"#,
            "--as",
            "system",
        ],
    );
    assert_eq!(code, 0, "{lines:?}");
    let fixed = lines.last().unwrap();
    let hash = fixed["sourceHash"].as_str().unwrap();
    let seq = fixed["seq"].as_u64().unwrap().to_string();
    let commit = &cli_jobs(&root, &compiler, &["trace", &seq]).1[0]["commit"];
    assert_eq!(commit["kind"], "operator", "{commit}");
    assert_eq!(commit["program"], format!("adhoc:{hash}"), "{commit}");
    assert!(
        commit["by"].as_str().is_some_and(|by| !by.is_empty()),
        "{commit}"
    );

    // Narrowing link (null in the seed) refuses with the paste; the paste fills; the narrowing applies.
    let mut project: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/build/project.json")).unwrap())
            .unwrap();
    assert_eq!(
        project["schema"]["tables"]["profiles"]["columns"]["link"],
        json!({"Optional":{"Text":{"max":2048}}})
    );
    project["schema"]["tables"]["profiles"]["columns"]["link"] = json!({"Text":{"max":2048}});
    let refused = request(
        port,
        "POST",
        "/control/apply",
        &[("X-Snapback-Control", &secret)],
        json!({"project": project}),
    );
    assert_eq!(refused.status, 400, "{}", refused.body);
    let refusal = refused
        .body
        .get("refusals")
        .and_then(|r| r.get(0))
        .cloned()
        .unwrap_or(refused.body.clone());
    assert_eq!(refusal["code"], "E_SUCCESSOR_NARROWING", "{refusal}");
    let paste = refusal["rewrite"].as_str().unwrap();
    assert!(paste.starts_with("-- keep profiles.link optional and apply, then fill it:\njob fill_profiles_link(value: text <=2048):"), "{paste}");
    let fill = root.join("fill.q");
    fs::write(&fill, paste).unwrap();
    let (code, lines) = cli_jobs(
        &root,
        &compiler,
        &[
            "run",
            "--file",
            fill.to_str().unwrap(),
            r#"{"value":"https://example.com/none"}"#,
            "--as",
            "system",
            "--wait",
        ],
    );
    assert_eq!(code, 0, "{lines:?}");
    let receipt = lines.last().unwrap();
    assert_eq!(receipt["state"], "done", "{receipt}");
    assert_eq!(receipt["rowsWritten"]["profiles"], 2, "{receipt}");
    // The ad hoc job's enqueue receipt carries the same hash.
    let enqueue = (receipt["commitRange"]["from"].as_u64().unwrap() - 1).to_string();
    let commit = &cli_jobs(&root, &compiler, &["trace", &enqueue]).1[0]["commit"];
    assert_eq!(commit["kind"], "operator");
    assert_eq!(
        commit["program"],
        format!("enqueue:adhoc:{}", receipt["sourceHash"].as_str().unwrap()),
        "{commit}"
    );
    let applied = request(
        port,
        "POST",
        "/control/apply",
        &[("X-Snapback-Control", &secret)],
        json!({"project": project}),
    );
    assert_eq!(applied.status, 200, "{}", applied.body);
    stop_owner(port, &secret, &mut owner, "narrowing paste test");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn executable_mismatch_at_chunk_time_parks_the_job_and_the_owner_keeps_serving() {
    let (root, compiler, mut owner, port, secret) = boot_jobs_rows(350);
    let path = root.join("slow.q");
    fs::write(&path, "job slow():\n  chunk p in jobRows first 1 by byId:\n    update jobRows[p.id] { value: 'slow' }\n").unwrap();
    let (code, lines) = cli_jobs(
        &root,
        &compiler,
        &["run", "--file", path.to_str().unwrap(), "--as", "system"],
    );
    assert_eq!(code, 0, "{lines:?}");
    let id = lines.last().unwrap()["id"].as_str().unwrap().to_owned();
    let plan_key = format!(
        "job_plan:{}",
        lines.last().unwrap()["programHash"].as_str().unwrap()
    );
    stop_owner(port, &secret, &mut owner, "mismatch test");
    // Reconciliation never sees this: the persisted executable changes underneath a queued job.
    let store_path = root.join(".snapback/store.sqlite");
    let mut store = Store::open(&store_path).unwrap();
    let mut plan: Value = serde_json::from_str(&store.meta(&plan_key).unwrap().unwrap()).unwrap();
    plan[0]["body"][0]["For"]["body"]
        .as_array_mut()
        .unwrap()
        .clear();
    store.set_meta(&plan_key, &plan.to_string()).unwrap();
    drop(store);
    let mut owner = ChildGuard::spawn(env!("CARGO_BIN_EXE_snapback2"), &compiler, &root);
    let port: u16 = owner
        .ready_line()
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap()
        .parse()
        .unwrap();
    let record: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = record["secret"].as_str().unwrap().to_owned();
    let parked = wait_for(Duration::from_secs(10), || {
        let row = job_state(port, &secret, &id);
        (row["state"] == "parked").then_some(row)
    });
    let error = &parked["lastError"];
    assert_eq!(error["code"], "E_JOB_GENERATION", "{parked}");
    assert_eq!(error["family"], "job");
    assert_eq!(error["job"], id);
    assert!(error["chunk"].as_u64().is_some(), "{parked}");
    // The owner keeps serving: a client mutation commits, status counts the park, trace shows it.
    let r = request(
        port,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", "alice")],
        json!({"op":"jobs.send","args":{"id":"job-000"}}),
    );
    assert_eq!(r.body["state"], "committed", "{}", r.body);
    assert_eq!(
        control_job(port, &secret, "GET", "/control/status", json!({}))["jobs"]["parked"],
        1
    );
    let trace = cli_jobs(&root, &compiler, &["trace", &id]);
    assert_eq!(trace.0, 0);
    assert_eq!(trace.1[0]["lastError"]["code"], "E_JOB_GENERATION");
    let log = fs::read_to_string(root.join(".snapback/log.jsonl")).unwrap();
    assert!(!log.contains("background turn failed"), "{log}");
    stop_owner(port, &secret, &mut owner, "mismatch test done");
    fs::remove_dir_all(root).unwrap();
}
