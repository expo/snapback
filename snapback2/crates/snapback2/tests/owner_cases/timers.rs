use super::*;

const HOUR: i64 = 3_600_000;
const DAY: i64 = 24 * HOUR;

fn boot_schedules() -> (PathBuf, PathBuf, ChildGuard, u16, String) {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let schedules_fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/compiler/fixtures/quarry-schedules/snapback");
    fs::copy(
        schedules_fixture.join("push.ts"),
        root.join("snapback/push.ts"),
    )
    .unwrap();
    fs::write(
        root.join("snapback/admin.q"),
        r#"effect digest from push

job digestSweep():
  chunk p in profiles first 100 by byId:
    if p.displayName != '':
      emit digest { to: p.principal, newFollowers: 1, unreadMessages: 0 }

schedule dailyDigest every 24h: digestSweep()

mutation sendExpiring(conversationId: conversations, body: text <=4000, expiresAt: time ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body, photo: null, clip: null, expiresAt, at: now }
  return { id: row.id }
"#,
    )
    .unwrap();
    let compiler = compiler(&root);
    let checked = Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .args(["check", "--json", "--project"])
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
    let check: Value = serde_json::from_slice(&checked.stdout).unwrap();
    assert_eq!(
        check["schemaCertificate"]["schedules"]
            .as_array()
            .unwrap()
            .len(),
        2,
        "{check}"
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
fn control(port: u16, secret: &str, method: &str, path: &str, body: Value) -> Value {
    let r = request(port, method, path, &[("X-Snapback-Control", secret)], body);
    assert_eq!(r.status, 200, "{path}: {}", r.body);
    r.body
}
fn cli(root: &Path, compiler: &Path, args: &[&str]) -> (i32, Vec<Value>) {
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
        .map(|l| serde_json::from_str(l).unwrap_or_else(|_| panic!("{l}")))
        .collect();
    (output.status.code().unwrap(), lines)
}
fn wall_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}
fn owner_now(port: u16, secret: &str) -> i64 {
    let clock = control(
        port,
        secret,
        "POST",
        "/control/clock",
        json!({"advanceMs": 0}),
    );
    wall_now() + clock["offsetMs"].as_i64().unwrap()
}
fn per_schedule<'a>(timers: &'a Value, name: &str) -> Option<&'a Value> {
    timers["schedules"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["schedule"] == name)
}
fn send_expiring(port: u16, body: &str, expires_at: i64) -> String {
    let r = request(
        port,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", "alice")],
        json!({"op":"admin.sendExpiring","args":{"conversationId":"conversation-1","body":body,"expiresAt":expires_at}}),
    );
    assert_eq!(r.body["state"], "committed", "{}", r.body);
    r.body["data"]["id"].as_str().unwrap().to_owned()
}
fn thread_ids(port: u16) -> Vec<String> {
    let r = request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "alice")],
        json!({"op":"messages.thread","args":{"conversationId":"conversation-1","c":null}}),
    );
    assert_eq!(r.status, 200, "{}", r.body);
    r.body["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].as_str().unwrap().to_owned())
        .collect()
}

// @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — the two customers through the real binary: expiry with no client attached, and the digest firing once after an outage.
#[test]
fn schedules_fire_on_the_dev_clock_with_clients_closed_and_the_digest_fires_once_after_a_gap() {
    let (root, compiler, mut owner, port, secret) = boot_schedules();
    let timers = control(port, &secret, "GET", "/control/timers", json!({}));
    assert_eq!(timers["schedules"].as_array().unwrap().len(), 2, "{timers}");
    assert_eq!(
        per_schedule(&timers, "expireMessage").unwrap(),
        &json!({"schedule": "expireMessage", "count": 0, "due": 0, "next_at": null}),
        "a declared schedule with no due row is listed at zero: {timers}"
    );
    let daily = per_schedule(&timers, "dailyDigest").unwrap();
    assert_eq!(
        (daily["count"].as_i64(), daily["due"].as_i64()),
        (Some(1), Some(0))
    );
    let period = timers["next"].clone();
    let period_id = period["id"].as_str().unwrap().to_owned();
    let period_start = period["periodStart"].as_i64().unwrap();
    assert_eq!(period["at"].as_i64().unwrap(), period_start + DAY);
    assert!(period["rowId"].is_null());
    let status = control(port, &secret, "GET", "/control/status", json!({}));
    assert_eq!(status["timers"]["due"], 0);
    assert_eq!(status["timers"]["next_at"], period_start + DAY);
    assert_eq!(status["timers"]["rejected"], 0);
    assert_eq!(
        status["schedules"],
        json!({"fired": 0, "late": 0, "rejected": 0})
    );

    // Expiry: the row timer is written with the row; every request below is a
    // closed HTTP exchange, so no client exists when the purge fires.
    let now = owner_now(port, &secret);
    let message = send_expiring(port, "gone in an hour", now + HOUR);
    let timers = control(port, &secret, "GET", "/control/timers", json!({}));
    let expire = per_schedule(&timers, "expireMessage").unwrap();
    assert_eq!(
        (expire["count"].as_i64(), expire["due"].as_i64()),
        (Some(1), Some(0))
    );
    assert_eq!(timers["next"]["rowId"], message);
    let row_timer = timers["next"]["id"].as_str().unwrap().to_owned();
    assert!(thread_ids(port).contains(&message));
    control(
        port,
        &secret,
        "POST",
        "/control/clock",
        json!({"advanceMs": HOUR + 1_000}),
    );
    wait_for(Duration::from_secs(5), || {
        let timers = control(port, &secret, "GET", "/control/timers", json!({}));
        (per_schedule(&timers, "expireMessage").unwrap()["count"] == 0).then_some(())
    });
    assert!(
        !thread_ids(port).contains(&message),
        "the expired body survived"
    );
    let trace = cli(&root, &compiler, &["trace", &format!("timer:{row_timer}")]);
    assert_eq!(trace.0, 0, "{trace:?}");
    let firing = &trace.1[0]["firings"][0];
    assert!(trace.1[0]["timer"].is_null());
    assert_eq!(firing["schedule"], "expireMessage");
    assert_eq!(firing["target"], "deliveries.purgeMessage");
    assert_eq!(firing["rowId"], message);
    assert_eq!(
        firing["occurrence"],
        json!(["expireMessage", message, now + HOUR])
    );
    assert_eq!(firing["outcome"]["state"], "committed");
    assert!(firing["latenessMs"].as_i64().unwrap() >= 1_000);
    assert!(firing["seq"].as_u64().unwrap() > 0);
    let commit = cli(&root, &compiler, &["trace", &firing["seq"].to_string()]);
    assert_eq!(commit.1[0]["commit"]["kind"], "schedule");
    assert_eq!(commit.1[0]["commit"]["schedule"], "expireMessage");
    let status = control(port, &secret, "GET", "/control/status", json!({}));
    assert_eq!(status["schedules"]["fired"], 1);
    assert_eq!(status["schedules"]["late"], 1);
    assert_eq!(status["timers"]["due"], 0);
    let logs = control(port, &secret, "GET", "/control/logs?limit=200", json!({}));
    assert!(
        logs["lines"].as_array().unwrap().iter().any(|line| {
            line["kind"] == "schedule" && line["firing"]["schedule"] == "expireMessage"
        }),
        "{logs}"
    );
    let unknown = cli(&root, &compiler, &["trace", "timer:t_nope"]);
    assert_eq!(unknown.0, 1);
    assert_eq!(unknown.1[0]["code"], "E_INPUT_TRACE_UNKNOWN");
    assert_eq!(unknown.1[0]["guide"], "schedule");

    // The digest after a simulated two-day outage: one firing, one job, the
    // period re-armed to the schedule's anchor and the skipped period recorded.
    control(
        port,
        &secret,
        "POST",
        "/control/clock",
        json!({"advanceMs": 2 * DAY}),
    );
    let jobs = wait_for(Duration::from_secs(5), || {
        let jobs = control(port, &secret, "GET", "/control/jobs", json!({}));
        let rows = jobs["jobs"].as_array().unwrap();
        (rows.len() == 1 && rows[0]["state"] == "done").then(|| rows[0].clone())
    });
    assert_eq!(jobs["name"], "admin.digestSweep");
    assert_eq!(jobs["enqueuedBy"], format!("timer:{period_id}"));
    let job_id = jobs["id"].as_str().unwrap().to_owned();
    assert!(job_id.starts_with("job_timer_"));
    let detail = control(
        port,
        &secret,
        "GET",
        &format!("/control/job/{job_id}"),
        json!({}),
    );
    assert_eq!(
        detail["commits"][0]["emits"], 2,
        "one effect per profile: {detail}"
    );
    let trace = cli(&root, &compiler, &["trace", &format!("timer:{period_id}")]);
    assert_eq!(trace.0, 0);
    let firings = trace.1[0]["firings"].as_array().unwrap();
    assert_eq!(firings.len(), 1);
    assert_eq!(firings[0]["skipped"], 1);
    assert_eq!(
        firings[0]["occurrence"],
        json!(["dailyDigest", period_start + DAY])
    );
    assert_eq!(
        firings[0]["outcome"],
        json!({"state": "queued", "job": job_id})
    );
    assert_eq!(trace.1[0]["timer"]["periodStart"], period_start + 2 * DAY);
    assert_eq!(trace.1[0]["timer"]["at"], period_start + 3 * DAY);
    let timers = control(port, &secret, "GET", "/control/timers", json!({}));
    assert_eq!(timers["next"]["id"], period_id);
    assert_eq!(timers["next"]["at"], period_start + 3 * DAY);
    control(
        port,
        &secret,
        "POST",
        "/control/clock",
        json!({"advanceMs": DAY}),
    );
    wait_for(Duration::from_secs(5), || {
        let jobs = control(port, &secret, "GET", "/control/jobs", json!({}));
        (jobs["jobs"].as_array().unwrap().len() == 2).then_some(())
    });
    let status = control(port, &secret, "GET", "/control/status", json!({}));
    assert_eq!(status["schedules"]["fired"], 3);
    assert_eq!(
        status["jobs"],
        json!({"parked": 0, "queued": 0, "running": 0}),
        "{status}"
    );
    assert_eq!(
        status["effects"]["queued"], 4,
        "one effect per profile per digest: {status}"
    );

    // A schedule target is a system program: `/api/*` refuses it like a job, on the schedule
    // page and naming the schedule; the operator seat runs it by hand; the schedule keeps it.
    let by_hand = send_expiring(port, "purge me by hand", owner_now(port, &secret) + HOUR);
    let refused = request(
        port,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", "alice")],
        json!({"op":"deliveries.purgeMessage","args":{"messageId":by_hand}}),
    );
    assert!(refused.status >= 400, "{}", refused.body);
    assert_eq!(
        refused.body["code"], "E_OPERATOR_REQUIRED",
        "{}",
        refused.body
    );
    assert_eq!(refused.body["family"], "operator");
    assert_eq!(refused.body["guide"], "schedule");
    assert_eq!(refused.body["site"], "schedule expireMessage");
    assert!(
        thread_ids(port).contains(&by_hand),
        "a refused purge changed nothing"
    );
    let (code, purged) = cli(
        &root,
        &compiler,
        &[
            "run",
            "deliveries.purgeMessage",
            &json!({"messageId": by_hand}).to_string(),
            "--as",
            "system",
        ],
    );
    assert_eq!(code, 0, "{purged:?}");
    assert_eq!(purged[0]["state"], "committed", "{purged:?}");
    assert!(!thread_ids(port).contains(&by_hand));
    let timers = control(port, &secret, "GET", "/control/timers", json!({}));
    assert_eq!(
        per_schedule(&timers, "expireMessage").unwrap()["count"],
        0,
        "the by-hand purge cancelled its own timer: {timers}"
    );

    // The writer's 64-per-turn bound, observed through the owner. The re-armed period (older,
    // its target the digest job) and seventy row timers come due together: the turn fires the
    // period first (enqueuing the job), then 63 rows, runs the job's one chunk, and the next
    // turn fires the remaining 7 — so exactly 63 expiry commits precede the chunk's and 7 follow.
    let earlier: Vec<String> = control(port, &secret, "GET", "/control/jobs", json!({}))["jobs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|job| job["id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(earlier.len(), 2);
    let fired_before =
        control(port, &secret, "GET", "/control/status", json!({}))["schedules"]["fired"]
            .as_u64()
            .unwrap();
    let deadline = period_start + 4 * DAY + HOUR;
    let ids: Vec<String> = (0..70)
        .map(|n| send_expiring(port, &format!("batch {n}"), deadline))
        .collect();
    let timers = control(port, &secret, "GET", "/control/timers", json!({}));
    assert_eq!(
        per_schedule(&timers, "expireMessage").unwrap()["count"],
        70,
        "{timers}"
    );
    assert_eq!(
        timers["next"]["id"], period_id,
        "the period is the oldest due timer: {timers}"
    );
    let advance = deadline + 1_000 - owner_now(port, &secret);
    control(
        port,
        &secret,
        "POST",
        "/control/clock",
        json!({"advanceMs": advance}),
    );
    wait_for(Duration::from_secs(20), || {
        let status = control(port, &secret, "GET", "/control/status", json!({}));
        (status["schedules"]["fired"].as_u64() == Some(fired_before + 71)
            && status["jobs"] == json!({"parked": 0, "queued": 0, "running": 0}))
        .then_some(())
    });
    let jobs = control(port, &secret, "GET", "/control/jobs", json!({}));
    let batch_job = jobs["jobs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|job| !earlier.contains(&job["id"].as_str().unwrap().to_owned()))
        .unwrap_or_else(|| panic!("{jobs}"))["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let detail = control(
        port,
        &secret,
        "GET",
        &format!("/control/job/{batch_job}"),
        json!({}),
    );
    let chunk_seq = detail["commits"][0]["seq"].as_u64().unwrap();
    let commits = control(
        port,
        &secret,
        "GET",
        "/control/logs?since=0&limit=500",
        json!({}),
    )["commits"]
        .clone();
    let batch: Vec<u64> = commits
        .as_array()
        .unwrap()
        .iter()
        .filter(|commit| {
            commit["kind"] == "schedule"
                && commit["schedule"] == "expireMessage"
                && commit["rowId"]
                    .as_str()
                    .is_some_and(|id| ids.iter().any(|sent| sent == id))
        })
        .map(|commit| commit["seq"].as_u64().unwrap())
        .collect();
    assert_eq!(batch.len(), 70, "{commits}");
    assert_eq!(
        batch.iter().filter(|seq| **seq < chunk_seq).count(),
        63,
        "63 expiry firings share the period's turn before the chunk at {chunk_seq}: {batch:?}"
    );
    assert_eq!(batch.iter().filter(|seq| **seq > chunk_seq).count(), 7);

    // A successor installed under the advanced clock anchors its new period to the owner's
    // clock, and so does a reset: neither reads wall time.
    let wall = wall_now();
    let owner_before = owner_now(port, &secret);
    assert!(
        owner_before > wall + 4 * DAY,
        "the dev clock is days ahead of wall time"
    );
    let admin = fs::read_to_string(root.join("snapback/admin.q")).unwrap();
    fs::write(
        root.join("snapback/admin.q"),
        format!("{admin}\nschedule weeklyDigest every 48h: digestSweep()\n"),
    )
    .unwrap();
    let checked = Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .args(["check", "--json", "--project"])
        .arg(&root)
        .env("SNAPBACK2_COMPILER", &compiler)
        .output()
        .unwrap();
    assert!(
        checked.status.success(),
        "{}",
        String::from_utf8_lossy(&checked.stdout)
    );
    let project: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/build/project.json")).unwrap())
            .unwrap();
    let applied = request(
        port,
        "POST",
        "/control/apply",
        &[("X-Snapback-Control", &secret)],
        json!({"project": project}),
    );
    assert_eq!(applied.status, 200, "{}", applied.body);
    let timers = control(port, &secret, "GET", "/control/timers", json!({}));
    let weekly_at = per_schedule(&timers, "weeklyDigest").unwrap()["next_at"]
        .as_i64()
        .unwrap();
    assert!(
        weekly_at >= owner_before + 2 * DAY && weekly_at <= owner_now(port, &secret) + 2 * DAY,
        "the new period is anchored to the owner's clock, not wall time: {timers}"
    );
    control(port, &secret, "POST", "/control/reset", json!({}));
    let timers = control(port, &secret, "GET", "/control/timers", json!({}));
    assert_eq!(
        per_schedule(&timers, "expireMessage").unwrap()["count"],
        0,
        "{timers}"
    );
    let daily_at = per_schedule(&timers, "dailyDigest").unwrap()["next_at"]
        .as_i64()
        .unwrap();
    assert!(
        daily_at >= owner_before + DAY && daily_at <= owner_now(port, &secret) + DAY,
        "reset re-arms on the owner's clock: {timers}"
    );
    stop_owner(port, &secret, &mut owner, "schedules test");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
#[ignore = "LLP 1016 measurements, explicitly run outside the blocking suite"]
fn measure_row_timer_lateness_p99_while_the_owner_serves_sends() {
    let (root, _compiler, mut owner, port, secret) = boot_schedules();
    let now = owner_now(port, &secret);
    let count = 200;
    for n in 0..count {
        send_expiring(port, &format!("expiring {n}"), now + 1_500 + n * 10);
    }
    let finished = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let senders = (0..4)
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
                        json!({"op":"messages.send","args":{"conversationId":"conversation-1","recipientId":"profile-bob","body":"busy owner"}}),
                    );
                    assert_eq!(r.body["state"], "committed", "{}", r.body);
                    sent += 1;
                }
                sent
            })
        })
        .collect::<Vec<_>>();
    wait_for(Duration::from_secs(20), || {
        let timers = control(port, &secret, "GET", "/control/timers", json!({}));
        // Declared schedules are listed at zero since the J2 fix round; "drained"
        // means no rows and nothing due, not absence from the listing.
        per_schedule(&timers, "expireMessage").and_then(|schedule| {
            (schedule["count"].as_i64() == Some(0) && schedule["due"].as_i64() == Some(0))
                .then_some(())
        })
    });
    finished.store(true, std::sync::atomic::Ordering::Relaxed);
    let sends = senders.into_iter().map(|s| s.join().unwrap()).sum::<u64>();
    let logs = control(port, &secret, "GET", "/control/logs?limit=500", json!({}));
    let mut lateness = logs["lines"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|line| line["kind"] == "schedule" && line["firing"]["schedule"] == "expireMessage")
        .map(|line| line["firing"]["latenessMs"].as_i64().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(lateness.len(), count as usize, "{logs}");
    lateness.sort_unstable();
    let p50 = lateness[lateness.len() / 2];
    let p99 = lateness[(lateness.len() * 99 / 100).min(lateness.len() - 1)];
    println!(
        "{}",
        json!({"metric":"row_timer_lateness_p99_owner_busy","p50Milliseconds":p50,"p99Milliseconds":p99,"maxMilliseconds":lateness.last(),"budgetMilliseconds":1500,"samples":count,"clientSends":sends,"method":"200 row timers due over two seconds of wall clock while four HTTP senders commit chat sends continuously; lateness read from the owner's schedule log lines"})
    );
    stop_owner(port, &secret, &mut owner, "timer lateness measurement");
    fs::remove_dir_all(root).unwrap();
}
