use super::*;

const MINUTE: i64 = 60_000;
const HOUR: i64 = 3_600_000;
const DAY: i64 = 24 * HOUR;

fn boot_schedules() -> (PathBuf, PathBuf, ChildGuard, u16, String) {
    boot_schedules_with_period("24h")
}

fn boot_schedules_with_period(period: &str) -> (PathBuf, PathBuf, ChildGuard, u16, String) {
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
"#.replace("every 24h", &format!("every {period}")),
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

fn restart_owner(root: &Path, compiler: &Path) -> (ChildGuard, u16, String) {
    let mut owner = ChildGuard::spawn(env!("CARGO_BIN_EXE_snapback2"), compiler, root);
    let port = owner
        .ready_line()
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap()
        .parse()
        .unwrap();
    let info: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    (owner, port, info["secret"].as_str().unwrap().to_owned())
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
fn advance_owner_to_daily_phase(port: u16, secret: &str, phase: i64) -> i64 {
    let now = owner_now(port, secret);
    let mut target = now.div_euclid(DAY) * DAY + phase;
    if target <= now {
        target += DAY;
    }
    control(
        port,
        secret,
        "POST",
        "/control/clock",
        json!({"advanceMs": target - now}),
    );
    let observed = owner_now(port, secret);
    assert!(
        observed >= target && observed < target + 5_000,
        "owner clock did not reach requested daily phase: target={target} observed={observed}"
    );
    observed
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

// @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — a
// whole-minute schedule persists across a real owner stop/start and emits its one occurrence.
#[cfg(not(feature = "hermes"))]
#[test]
fn one_minute_digest_aligns_and_emits_exactly_once_after_owner_restart() {
    let (root, compiler, mut owner, mut port, mut secret) = boot_schedules_with_period("1m");
    let initial = control(port, &secret, "GET", "/control/timers", json!({}));
    let initial_timer = initial["next"].clone();
    let timer_id = initial_timer["id"].as_str().unwrap().to_owned();
    let initial_start = initial_timer["periodStart"].as_i64().unwrap();
    let initial_at = initial_timer["at"].as_i64().unwrap();
    assert_eq!(initial_start.rem_euclid(MINUTE), 0, "{initial}");
    assert_eq!(initial_at, initial_start + MINUTE, "{initial}");

    // Put the owner clock six real seconds before its next whole-minute boundary, then reset
    // through the public route so the authored schedule is reinstalled on that clock.
    let before = owner_now(port, &secret);
    let advance_ms = (MINUTE - 6_000 - before.rem_euclid(MINUTE)).rem_euclid(MINUTE);
    control(
        port,
        &secret,
        "POST",
        "/control/clock",
        json!({"advanceMs": advance_ms}),
    );
    control(port, &secret, "POST", "/control/reset", json!({}));
    let armed = control(port, &secret, "GET", "/control/timers", json!({}));
    let armed_timer = armed["next"].clone();
    let armed_at = armed_timer["at"].as_i64().unwrap();
    assert_eq!(armed_at.rem_euclid(MINUTE), 0, "{armed}");
    assert_eq!(
        armed_timer["periodStart"].as_i64().unwrap(),
        armed_at - MINUTE,
        "{armed}"
    );
    let remaining = armed_at - owner_now(port, &secret);
    assert!(remaining > 0 && remaining <= 6_000, "{armed}");
    assert_eq!(
        control(port, &secret, "GET", "/control/status", json!({}))["schedules"]["fired"],
        0
    );

    stop_owner(port, &secret, &mut owner, "period restart witness");
    (owner, port, secret) = restart_owner(&root, &compiler);
    control(
        port,
        &secret,
        "POST",
        "/control/clock",
        json!({"advanceMs": advance_ms}),
    );
    let status = wait_for(Duration::from_secs(8), || {
        let status = control(port, &secret, "GET", "/control/status", json!({}));
        let effects = [
            "queued",
            "running",
            "thenPending",
            "sent",
            "failed",
            "sentUnknown",
        ]
        .iter()
        .map(|state| status["effects"][state].as_u64().unwrap_or(0))
        .sum::<u64>();
        (status["schedules"]["fired"].as_u64().unwrap_or(0) >= 1 && effects >= 2)
            .then_some((status, effects))
    });
    assert_eq!(status.0["schedules"]["fired"], 1, "{}", status.0);
    assert_eq!(
        status.1, 2,
        "one effect for each seeded profile: {}",
        status.0
    );
    let trace = cli(&root, &compiler, &["trace", &format!("timer:{timer_id}")]);
    assert_eq!(trace.0, 0, "{trace:?}");
    assert_eq!(
        trace.1[0]["firings"].as_array().unwrap().len(),
        1,
        "{trace:?}"
    );
    assert_eq!(trace.1[0]["firings"][0]["scheduledAt"], armed_at);
    stop_owner(port, &secret, &mut owner, "period restart witness complete");
    fs::remove_dir_all(root).unwrap();
}

// @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — the two customers through the real binary: expiry with no client attached, and the digest firing once after an outage.
#[test]
fn schedules_fire_on_the_dev_clock_with_clients_closed_and_the_digest_fires_once_after_a_gap() {
    let (root, compiler, mut owner, port, secret) = boot_schedules();

    // Stabilize the whole fixture at 00:30 on the owner's public clock. Reaching 23:30 can
    // cross the initially armed deadline, and the following hour intentionally does; resets at
    // both phases prove that preliminary work is cleared before any counters below are captured.
    let phase_2330 = 23 * HOUR + 30 * MINUTE;
    let at_2330 = advance_owner_to_daily_phase(port, &secret, phase_2330);
    assert_eq!(at_2330.rem_euclid(DAY) / MINUTE, 23 * 60 + 30);
    control(port, &secret, "POST", "/control/reset", json!({}));
    let clean_2330 = control(port, &secret, "GET", "/control/status", json!({}));
    assert_eq!(clean_2330["schedules"]["fired"], 0, "{clean_2330}");
    control(
        port,
        &secret,
        "POST",
        "/control/clock",
        json!({"advanceMs": HOUR}),
    );
    let preliminary = wait_for(Duration::from_secs(5), || {
        let status = control(port, &secret, "GET", "/control/status", json!({}));
        (status["schedules"]["fired"] == 1
            && status["jobs"] == json!({"parked": 0, "queued": 0, "running": 0}))
        .then_some(status)
    });
    assert_eq!(
        owner_now(port, &secret).rem_euclid(DAY) / MINUTE,
        30,
        "the public clock crossed from 23:30 to 00:30"
    );
    assert_eq!(preliminary["schedules"]["fired"], 1, "{preliminary}");
    control(port, &secret, "POST", "/control/reset", json!({}));
    let clean_0030 = control(port, &secret, "GET", "/control/status", json!({}));
    assert_eq!(clean_0030["schedules"]["fired"], 0, "{clean_0030}");
    assert_eq!(
        clean_0030["jobs"],
        json!({"parked": 0, "queued": 0, "running": 0}),
        "{clean_0030}"
    );
    assert_eq!(
        [
            "queued",
            "running",
            "thenPending",
            "sent",
            "failed",
            "sentUnknown",
        ]
        .iter()
        .map(|state| clean_0030["effects"][state].as_u64().unwrap_or(0))
        .sum::<u64>(),
        0,
        "reset did not clear preliminary effects: {clean_0030}"
    );

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
    assert!(
        now + HOUR + 1_000 < period_start + DAY,
        "the expiry phase must not cross the daily boundary"
    );
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
    let manifest = request(port, "GET", "/api/manifest", &[], json!({}));
    assert_eq!(manifest.status, 200, "{}", manifest.body);
    assert!(
        manifest.body["ops"].get("deliveries.purgeMessage").is_none(),
        "a schedule-only target leaked into the client manifest: {}",
        manifest.body
    );
    assert_eq!(
        manifest.body["ops"]["admin.digestSweep"]["kind"],
        "job",
        "operator-discoverable jobs remain in the manifest: {}",
        manifest.body
    );
    let operator_manifest = request(
        port,
        "GET",
        "/api/manifest",
        &[("X-Snapback-Control", &secret)],
        json!({}),
    );
    assert_eq!(operator_manifest.status, 200, "{}", operator_manifest.body);
    assert_eq!(
        operator_manifest.body["ops"]["deliveries.purgeMessage"]["kind"],
        "mutation",
        "the authenticated operator sees the schedule target: {}",
        operator_manifest.body
    );
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
    let until_deadline = deadline - owner_now(port, &secret);
    assert!(
        until_deadline > 23 * HOUR && until_deadline < DAY,
        "00:30 setup must leave the batch deadline safely ahead: {until_deadline}"
    );
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

    // A successor installed under the advanced clock aligns its new period on the owner's
    // clock, and so does a reset: neither reads wall time.
    let wall = wall_now();
    let owner_before = owner_now(port, &secret);
    assert!(
        owner_before >= deadline + 1_000,
        "the owner retained the observed advance through the timer batch"
    );
    assert!(
        owner_before > wall + 2 * DAY,
        "the dev clock is far enough ahead to distinguish a 48h wall-clock period"
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
    assert_eq!(weekly_at.rem_euclid(2 * DAY), 0, "{timers}");
    assert!(
        weekly_at > owner_before && weekly_at <= owner_now(port, &secret) + 2 * DAY,
        "the new period uses the next whole boundary on the owner's clock: {timers}"
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
    assert_eq!(daily_at.rem_euclid(DAY), 0, "{timers}");
    assert!(
        daily_at > owner_before && daily_at <= owner_now(port, &secret) + DAY,
        "reset re-arms at the next whole boundary on the owner's clock: {timers}"
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

#[test]
fn reset_reports_seed_and_empty_survives_restart_with_schedules() {
    fn restart(root: &Path, compiler: &Path) -> (ChildGuard, u16, String) {
        let mut owner = ChildGuard::spawn(env!("CARGO_BIN_EXE_snapback2"), compiler, root);
        let port = owner
            .ready_line()
            .trim()
            .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
            .unwrap()
            .parse()
            .unwrap();
        let info: Value =
            serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
        (owner, port, info["secret"].as_str().unwrap().to_owned())
    }
    let (root, compiler, mut owner, mut port, mut secret) = boot_schedules();
    let signup = request(
        port,
        "POST",
        "/api/auth/signup",
        &[],
        json!({"email":"reset@example.com", "password":"test-password-reset"}),
    );
    assert_eq!(signup.status, 200, "{}", signup.body);
    let mut token = format!("Bearer {}", signup.body["token"].as_str().unwrap());
    let reset = cli(&root, &compiler, &["reset"]);
    assert_eq!(reset.0, 0, "{reset:?}");
    assert_eq!(reset.1[0]["seed"], json!({"rows":18,"personas":3}));
    stop_owner(port, &secret, &mut owner, "reset restart");
    (owner, port, secret) = restart(&root, &compiler);
    assert_eq!(
        per_schedule(
            &control(port, &secret, "GET", "/control/timers", json!({})),
            "dailyDigest"
        )
        .unwrap()["count"],
        1
    );
    send_expiring(
        port,
        "before empty reset",
        owner_now(port, &secret) + 3 * DAY,
    );
    // Keep the same auth epoch alive while crossing the daily schedule: the
    // bearer now expires after 24 hours, independent of application resets.
    control(port, &secret, "POST", "/control/clock", json!({"advanceMs": DAY / 2}));
    let renewed = request(port, "POST", "/api/auth/refresh", &[("Authorization", &token)], json!({}));
    assert_eq!(renewed.status, 200, "{}", renewed.body);
    token = format!("Bearer {}", renewed.body["token"].as_str().unwrap());
    control(port, &secret, "POST", "/control/clock", json!({"advanceMs": DAY / 2 + 1_000}));
    // The digest schedule emitted two rows; the Hermes build may already have
    // claimed or retried them, so count every outbox state rather than `queued`.
    wait_for(Duration::from_secs(5), || {
        let status = control(port, &secret, "GET", "/control/status", json!({}));
        let rows = [
            "queued",
            "running",
            "thenPending",
            "sent",
            "failed",
            "sentUnknown",
        ]
        .iter()
        .map(|state| status["effects"][state].as_u64().unwrap_or(0))
        .sum::<u64>();
        (rows >= 2).then_some(())
    });
    let empty = cli(&root, &compiler, &["reset", "--empty"]);
    assert_eq!(empty.0, 0, "{empty:?}");
    assert_eq!(empty.1[0]["seed"], "skipped");
    assert_eq!(empty.1[0]["seq"], 0);
    stop_owner(port, &secret, &mut owner, "empty restart");
    (owner, port, secret) = restart(&root, &compiler);
    let timers = control(port, &secret, "GET", "/control/timers", json!({}));
    assert_eq!(timers["next"], Value::Null, "{timers}");
    let clean = control(port, &secret, "GET", "/control/status", json!({}));
    assert_eq!(clean["jobs"], json!({"parked":0,"queued":0,"running":0}));
    for state in [
        "queued",
        "running",
        "thenPending",
        "sent",
        "failed",
        "sentUnknown",
    ] {
        assert_eq!(clean["effects"][state], 0, "{clean}");
    }
    assert_eq!(
        control(port, &secret, "GET", "/control/jobs", json!({}))["jobs"],
        json!([])
    );
    let data = cli(&root, &compiler, &["data", "profiles", "--as", "system"]);
    assert_eq!(data.0, 0, "{data:?}");
    assert_eq!(data.1[0]["data"], json!([]));
    let mine = request(
        port,
        "POST",
        "/api/query",
        &[("Authorization", &token)],
        json!({"op":"profiles.mine", "args":{}}),
    );
    assert_eq!(mine.status, 200, "{}", mine.body);
    assert_eq!(mine.body["data"], Value::Null);
    let human = Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .args(["reset", "--empty", "--project"])
        .arg(&root)
        .env("SNAPBACK2_COMPILER", &compiler)
        .output()
        .unwrap();
    assert!(human.status.success());
    assert_eq!(
        String::from_utf8(human.stdout).unwrap().trim(),
        "reset: cleared application data; seed: skipped"
    );
    let created = request(
        port,
        "POST",
        "/api/mutation",
        &[("Authorization", &token)],
        json!({"op":"profiles.createMyProfile", "args":{"displayName":"Real", "handle":"real", "bio":"", "location":""}}),
    );
    assert_eq!(created.body["state"], "committed", "{}", created.body);
    let timers = control(port, &secret, "GET", "/control/timers", json!({}));
    assert_eq!(
        per_schedule(&timers, "dailyDigest").unwrap()["count"],
        1,
        "{timers}"
    );
    let human = Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .args(["reset", "--project"])
        .arg(&root)
        .env("SNAPBACK2_COMPILER", &compiler)
        .output()
        .unwrap();
    assert!(human.status.success());
    assert_eq!(
        String::from_utf8(human.stdout).unwrap().trim(),
        "reset: cleared application data; seed: 18 rows, 3 personas"
    );
    stop_owner(port, &secret, &mut owner, "empty completed");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
fn effects_settle_includes_emissions_from_the_tick_advanced_background_turn() {
    let (root, _compiler, mut owner, port, secret) = boot_schedules();
    control(
        port,
        &secret,
        "POST",
        "/control/clock",
        json!({"advanceMs":DAY}),
    );
    let response = control(
        port,
        &secret,
        "POST",
        "/control/effects/settle",
        json!({"budgetMs":100}),
    );
    let rows = response["rows"].as_array().unwrap();
    assert!(
        rows.iter().any(|row| row["effect"] == "push.digest"),
        "{response}"
    );
    assert_eq!(response["settled"], false);
    assert!(
        response["remaining"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["reason"] == "engine:none")
    );
    stop_owner(port, &secret, &mut owner, "settle background complete");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
fn effects_settle_with_defaulted_arguments_covers_the_tick_advanced_turn() {
    let (root, _compiler, mut owner, port, secret) = boot_schedules();
    control(
        port,
        &secret,
        "POST",
        "/control/clock",
        json!({"advanceMs":DAY}),
    );
    let started = Instant::now();
    // `upTo` defaults to the seq after the background turn; `budgetMs` to 1000.
    let response = control(port, &secret, "POST", "/control/effects/settle", json!({}));
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "a defaulted budget must not spin without an engine"
    );
    let rows = response["rows"].as_array().unwrap();
    assert!(
        rows.iter().any(|row| row["effect"] == "push.digest"),
        "{response}"
    );
    assert_eq!(response["settled"], false);
    let remaining = response["remaining"].as_array().unwrap();
    assert_eq!(remaining.len(), rows.len(), "{response}");
    assert!(remaining.iter().all(|row| row["reason"] == "engine:none"));
    stop_owner(port, &secret, &mut owner, "defaulted settle complete");
    fs::remove_dir_all(root).unwrap();
}
