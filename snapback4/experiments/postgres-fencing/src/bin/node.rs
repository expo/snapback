//! One serving process of the fencing prototype, in either role:
//!
//! * `--role owner`   acquires a free (or expired) lease at once and serves;
//! * `--role standby` waits for the lease to expire on the database clock,
//!   terminates the old owner's backends, takes the token, and serves.
//!
//! Both roles run as the non-superuser `sb_core`. Serving uses one lease
//! connection (advisory lock + renewals), one committer connection (head
//! advances) and N session connections (non-head writes), all tagged
//! `application_name = sb-owner:<holder>:<token>`. `--late-conn` adds a
//! connection opened after the backends were registered, so it is NOT in
//! `_owner.backends` (witness 3).
//!
//! Events are printed one per line for the harness (`src/bin/witness.rs`).

use postgres::Client;
use snapback4_postgres_fencing::*;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::SeqCst};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const ROLE: &str = "sb_core";

#[derive(Clone, Debug)]
struct Opts {
    role: String,
    holder: String,
    lease_ms: u64,
    renew_ms: u64,
    poll_ms: u64,
    lock: LockMode,
    strategy: String, // pidlist | appname | blockers
    head_every_ms: u64,
    session_every_ms: u64,
    session_threads: usize,
    pause: Option<(String, u64, u64)>, // kind, nth, ms
    late_conn: bool,
    stop_after_ms: Option<u64>,
    after_loss: String, // exit | probe | probe-controls
    takeover_lock_timeout_ms: u64,
    advisory_wait: bool,
    head_first: bool,
    pg_options: String,
    quiet_renewals: bool,
}

fn parse() -> Opts {
    let mut o = Opts {
        role: "owner".into(),
        holder: "A".into(),
        lease_ms: 3000,
        renew_ms: 500,
        poll_ms: 100,
        lock: LockMode::Share,
        strategy: "pidlist".into(),
        head_every_ms: 10,
        session_every_ms: 25,
        session_threads: 1,
        pause: None,
        late_conn: false,
        stop_after_ms: None,
        after_loss: "probe".into(),
        takeover_lock_timeout_ms: 2000,
        advisory_wait: false,
        head_first: false,
        pg_options: String::new(),
        quiet_renewals: false,
    };
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        let flag = args[i].as_str();
        let mut val = || {
            i += 1;
            args.get(i).cloned().unwrap_or_else(|| panic!("{flag} needs a value"))
        };
        match flag {
            "--role" => o.role = val(),
            "--holder" => o.holder = val(),
            "--lease-ms" => o.lease_ms = val().parse().unwrap(),
            "--renew-ms" => o.renew_ms = val().parse().unwrap(),
            "--poll-ms" => o.poll_ms = val().parse().unwrap(),
            "--lock" => o.lock = LockMode::parse(&val()),
            "--strategy" => o.strategy = val(),
            "--head-every-ms" => o.head_every_ms = val().parse().unwrap(),
            "--session-every-ms" => o.session_every_ms = val().parse().unwrap(),
            "--session-threads" => o.session_threads = val().parse().unwrap(),
            "--pause" => {
                let v = val();
                let p: Vec<&str> = v.split(':').collect();
                o.pause = Some((p[0].to_string(), p[1].parse().unwrap(), p.get(2).map_or(0, |m| m.parse().unwrap())));
            }
            "--late-conn" => o.late_conn = true,
            "--stop-after-ms" => o.stop_after_ms = Some(val().parse().unwrap()),
            "--after-loss" => o.after_loss = val(),
            "--takeover-lock-timeout-ms" => o.takeover_lock_timeout_ms = val().parse().unwrap(),
            "--advisory-wait" => o.advisory_wait = true,
            "--head-first" => o.head_first = true,
            "--pg-options" => o.pg_options = val(),
            "--quiet-renewals" => o.quiet_renewals = true,
            other => panic!("unknown flag {other}"),
        }
        i += 1;
    }
    o
}

fn main() {
    let o = parse();
    // Evidence only (witness 5): what this process believes the wall clock is.
    // No protocol decision below reads SystemTime.
    let host_unix = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let mut lease = connect(ROLE, &format!("sb-{}:{}", o.role, o.holder), &o.pg_options).expect("connect lease");
    let db_unix: f64 = lease.query_one("SELECT extract(epoch FROM clock_timestamp())::float8", &[]).unwrap().get(0);
    event("HOST_CLOCK", &format!("role={} holder={} host_unix={host_unix} db_unix={} host_minus_db_s={}", o.role, o.holder, db_unix as u64, host_unix as i64 - db_unix as i64));
    let token = acquire(&mut lease, &o);
    serve(lease, token, o);
}

// ---------------------------------------------------------------- takeover

enum TakeoverError {
    LockTimeout,
    Changed(String),
    Db(postgres::Error),
}

/// Lease-driven acquisition (§5 "Takeover is lease-driven"). The owner role
/// runs the same procedure; on a fresh store the lease is already expired.
fn acquire(lease: &mut Client, o: &Opts) -> i64 {
    let my_pid = backend_pid(lease);
    event("STANDBY_WAITING", &format!("holder={} pid={my_pid} strategy={} advisory_wait={}", o.holder, o.strategy, o.advisory_wait));
    let started = Instant::now();
    let mut attempts = 0u32;
    loop {
        let row = lease
            .query_one(
                "SELECT token, holder, backends, lease_until::text, lease_until < clock_timestamp(), clock_timestamp()::text \
                 FROM _owner WHERE singleton",
                &[],
            )
            .expect("poll _owner");
        let (token, holder, backends, lease_until, expired, db_now): (i64, Option<String>, Vec<i32>, String, bool, String) =
            (row.get(0), row.get(1), row.get(2), row.get(3), row.get(4), row.get(5));
        if !expired {
            if o.advisory_wait {
                // Fast path: block on the owner's advisory lock for at most one
                // poll interval. A clean shutdown releases the lease and then
                // the lock, so this wakes at once.
                lease.batch_execute(&format!("SET lock_timeout = {}", o.poll_ms)).unwrap();
                match lease.query_one("SELECT pg_advisory_lock($1)", &[&ADVISORY_KEY]) {
                    Ok(_) => event("ADVISORY_ACQUIRED", &format!("waited_ms={}", started.elapsed().as_millis())),
                    Err(e) if is_lock_timeout(&e) => {}
                    Err(e) => panic!("advisory wait: {}", err_str(&e)),
                }
                lease.batch_execute("RESET lock_timeout").unwrap();
            } else {
                thread::sleep(Duration::from_millis(o.poll_ms));
            }
            continue;
        }
        attempts += 1;
        let holder_s = holder.clone().unwrap_or_default();
        event(
            "LEASE_EXPIRED",
            &format!("attempt={attempts} token={token} holder={holder_s} lease_until={} db_now={} backends={backends:?}", lease_until.replace(' ', "T"), db_now.replace(' ', "T")),
        );
        if token > 0 {
            match o.strategy.as_str() {
                "pidlist" => {
                    for pid in backends.iter().copied().filter(|p| *p != my_pid) {
                        terminate(lease, pid, "listed");
                    }
                }
                "appname" => terminate_tagged(lease, token),
                "blockers" => {} // a watcher terminates whatever blocks the FOR UPDATE below
                other => panic!("unknown strategy {other}"),
            }
        }
        let watcher = (o.strategy == "blockers" && token > 0).then(|| spawn_blocker_watcher(my_pid, token, o));
        let t0 = Instant::now();
        let result = takeover_tx(lease, o, token, holder.as_deref(), &lease_until, &db_now);
        if let Some((done, h)) = watcher {
            done.store(true, SeqCst);
            let _ = h.join();
        }
        match result {
            Ok(new_token) => {
                let row = lease.query_one("SELECT clock_timestamp()::text", &[]).unwrap();
                let at: String = row.get(0);
                event(
                    "TOOK_OVER",
                    &format!("holder={} token={new_token} from_token={token} from_holder={holder_s} tx_ms={} db_at={} attempts={attempts}", o.holder, t0.elapsed().as_millis(), at.replace(' ', "T")),
                );
                return new_token;
            }
            Err(TakeoverError::LockTimeout) => {
                event("LOCK_TIMEOUT", &format!("attempt={attempts} waited_ms={} total_ms={}", t0.elapsed().as_millis(), started.elapsed().as_millis()));
            }
            Err(TakeoverError::Changed(why)) => event("TAKEOVER_ABORTED", &format!("why={why}")),
            Err(TakeoverError::Db(e)) => panic!("takeover: {}", err_str(&e)),
        }
    }
}

fn terminate(c: &mut Client, pid: i32, why: &str) {
    let t0 = Instant::now();
    // PG14+: wait up to 5 s for the backend to exit, so its locks are gone
    // before the FOR UPDATE below.
    match c.query_one("SELECT pg_terminate_backend($1, 5000)", &[&pid]) {
        Ok(r) => event("TERMINATE", &format!("pid={pid} why={why} ok={} ms={}", r.get::<_, bool>(0), t0.elapsed().as_millis())),
        Err(e) => event("TERMINATE", &format!("pid={pid} why={why} ok=false err={}", err_str(&e))),
    }
}

/// application_name tagging: terminate every same-role backend tagged as an
/// owner of a generation no newer than the token observed expired. The
/// token bound keeps a slow standby from killing a newer owner's sessions.
fn terminate_tagged(c: &mut Client, observed_token: i64) {
    let rows = c
        .query(
            "SELECT pid, application_name, state FROM pg_stat_activity \
             WHERE usename = current_user AND pid <> pg_backend_pid() \
               AND application_name LIKE 'sb-owner:%' \
               AND split_part(application_name, ':', 3) ~ '^[0-9]+$' \
               AND split_part(application_name, ':', 3)::bigint <= $1",
            &[&observed_token],
        )
        .unwrap();
    for r in rows {
        let (pid, app, state): (i32, String, Option<String>) = (r.get(0), r.get(1), r.get(2));
        terminate(c, pid, &format!("tag:{app}:{}", state.unwrap_or_default().replace(' ', "_")));
    }
}

/// pg_blocking_pids variant: no registration at all. While the takeover
/// transaction waits for `_owner FOR UPDATE`, a second connection asks the
/// server who blocks it and terminates those that are same-role owner
/// sessions of a generation no newer than the one observed expired.
fn spawn_blocker_watcher(waiter_pid: i32, observed_token: i64, o: &Opts) -> (Arc<AtomicBool>, thread::JoinHandle<()>) {
    let done = Arc::new(AtomicBool::new(false));
    let d = done.clone();
    let mut w = connect(ROLE, &format!("sb-standby-watch:{}", o.holder), &o.pg_options).expect("watch conn");
    let h = thread::spawn(move || {
        while !d.load(SeqCst) {
            let rows = w
                .query(
                    "SELECT a.pid, a.application_name, a.usename = current_user \
                     FROM pg_stat_activity a WHERE a.pid = ANY (pg_blocking_pids($1))",
                    &[&waiter_pid],
                )
                .unwrap_or_default();
            for r in rows {
                let (pid, app, same): (i32, Option<String>, bool) = (r.get(0), r.get(1), r.get(2));
                let app = app.unwrap_or_default();
                let gen_ok = app
                    .strip_prefix("sb-owner:")
                    .and_then(|rest| rest.rsplit(':').next())
                    .and_then(|t| t.parse::<i64>().ok())
                    .is_some_and(|t| t <= observed_token);
                if same && gen_ok {
                    terminate(&mut w, pid, &format!("blocker:{app}"));
                } else {
                    event("BLOCKER_SKIPPED", &format!("pid={pid} app={app} same_role={same}"));
                }
            }
            thread::sleep(Duration::from_millis(50));
        }
    });
    (done, h)
}

fn takeover_tx(c: &mut Client, o: &Opts, observed: i64, from_holder: Option<&str>, lease_until: &str, decided_at: &str) -> Result<i64, TakeoverError> {
    let map = |e: postgres::Error| if is_lock_timeout(&e) { TakeoverError::LockTimeout } else { TakeoverError::Db(e) };
    let mut tx = c.transaction().map_err(map)?;
    tx.batch_execute(&format!("SET LOCAL lock_timeout = {}", o.takeover_lock_timeout_ms)).map_err(map)?;
    let row = tx
        .query_one("SELECT token, lease_until < clock_timestamp() FROM _owner WHERE singleton FOR UPDATE", &[])
        .map_err(map)?;
    let (token, expired): (i64, bool) = (row.get(0), row.get(1));
    if token != observed {
        return Err(TakeoverError::Changed(format!("token_moved_{observed}_to_{token}")));
    }
    if !expired {
        return Err(TakeoverError::Changed("owner_renewed".into()));
    }
    let new = token + 1;
    // Session-level SET inside the transaction: rolled back if the takeover aborts.
    tx.batch_execute(&format!("SET application_name = '{}'", owner_tag(&o.holder, new))).map_err(map)?;
    tx.execute(
        "UPDATE _owner SET token = $1, holder = $2, lease_until = clock_timestamp() + make_interval(secs => $3), \
         backends = ARRAY[pg_backend_pid()] WHERE singleton",
        &[&new, &o.holder, &(o.lease_ms as f64 / 1000.0)],
    )
    .map_err(map)?;
    tx.execute("UPDATE _head SET owner_token = $1 WHERE singleton", &[&new]).map_err(map)?;
    tx.execute(
        "INSERT INTO _takeovers (token, holder, from_token, from_holder, lease_until_was, decided_at, strategy) \
         VALUES ($1, $2, $3, $4, $5::text::timestamptz, $6::text::timestamptz, $7)",
        &[&new, &o.holder, &observed, &from_holder, &lease_until, &decided_at, &o.strategy],
    )
    .map_err(map)?;
    tx.commit().map_err(map)?;
    Ok(new)
}

// ------------------------------------------------------------------ serving

struct Shared {
    o: Opts,
    token: i64,
    lost: AtomicBool,
    stop_workers: AtomicBool,
    release: AtomicBool,
    reason: Mutex<String>,
    head_commits: AtomicU64,
    session_commits: AtomicU64,
}

impl Shared {
    fn lose(&self, why: String) {
        if !self.lost.swap(true, SeqCst) {
            event("LOST", &format!("token={} {why}", self.token));
            *self.reason.lock().unwrap() = why;
        }
    }
    fn running(&self) -> bool {
        !self.lost.load(SeqCst) && !self.stop_workers.load(SeqCst)
    }
    fn pause_matches(&self, kind: &str, n: u64) -> Option<u64> {
        match &self.o.pause {
            Some((k, nth, ms)) if k == kind && *nth == n => Some(*ms),
            _ => None,
        }
    }
}

fn serve(mut lease: Client, token: i64, o: Opts) {
    let tag = owner_tag(&o.holder, token);
    let lease_pid = backend_pid(&mut lease);
    let adv: bool = lease.query_one("SELECT pg_try_advisory_lock($1)", &[&ADVISORY_KEY]).unwrap().get(0);
    event("ACQUIRED", &format!("holder={} token={token} lease_pid={lease_pid} advisory={adv} lock={:?}", o.holder, o.lock));

    let mut head_c = connect(ROLE, &tag, &o.pg_options).expect("committer conn");
    let head_pid = backend_pid(&mut head_c);
    let mut sess: Vec<(Client, i32)> = (0..o.session_threads)
        .map(|_| {
            let mut c = connect(ROLE, &tag, &o.pg_options).expect("session conn");
            let p = backend_pid(&mut c);
            (c, p)
        })
        .collect();
    let mut pids = vec![lease_pid, head_pid];
    pids.extend(sess.iter().map(|(_, p)| *p));
    let n = lease
        .execute("UPDATE _owner SET backends = $1 WHERE singleton AND token = $2", &[&pids, &token])
        .unwrap();
    event("REGISTERED", &format!("token={token} backends={pids:?} ok={}", n == 1));

    let sh = Arc::new(Shared {
        o: o.clone(),
        token,
        lost: AtomicBool::new(n != 1),
        stop_workers: AtomicBool::new(false),
        release: AtomicBool::new(false),
        reason: Mutex::new(String::new()),
        head_commits: AtomicU64::new(0),
        session_commits: AtomicU64::new(0),
    });

    let mut workers = Vec::new();
    {
        let sh = sh.clone();
        workers.push(thread::spawn(move || head_loop(&mut head_c, head_pid, &sh)));
    }
    for (i, (mut c, p)) in sess.drain(..).enumerate() {
        let sh = sh.clone();
        workers.push(thread::spawn(move || session_loop(&mut c, p, &sh, if i == 0 { "session" } else { "session-extra" }, &format!("s{i}"))));
    }
    if o.late_conn {
        // Opened after REGISTERED: a pooled reconnect or a lazily opened
        // connection the pid list never learns about.
        let mut c = connect(ROLE, &tag, &o.pg_options).expect("late conn");
        let p = backend_pid(&mut c);
        event("LATE_CONN", &format!("pid={p} listed=false"));
        let sh = sh.clone();
        workers.push(thread::spawn(move || session_loop(&mut c, p, &sh, "late", "late")));
    }
    let lease_thread = {
        let sh = sh.clone();
        thread::spawn(move || lease_loop(&mut lease, &sh))
    };

    let started = Instant::now();
    loop {
        if sh.lost.load(SeqCst) {
            break;
        }
        if let Some(ms) = o.stop_after_ms {
            if started.elapsed() >= Duration::from_millis(ms) {
                sh.stop_workers.store(true, SeqCst);
                break;
            }
        }
        thread::sleep(Duration::from_millis(10));
    }
    for w in workers {
        let _ = w.join();
    }
    if !sh.lost.load(SeqCst) {
        // Clean shutdown: release the lease, then the advisory lock.
        sh.release.store(true, SeqCst);
        let _ = lease_thread.join();
        event("EXIT", &format!("clean=true head_commits={} session_commits={}", sh.head_commits.load(SeqCst), sh.session_commits.load(SeqCst)));
        return;
    }
    let _ = lease_thread.join();
    event("EXIT_SERVING", &format!("head_commits={} session_commits={} reason={}", sh.head_commits.load(SeqCst), sh.session_commits.load(SeqCst), sh.reason.lock().unwrap()));
    if o.after_loss.starts_with("probe") {
        probe(&sh);
    }
    std::process::exit(3);
}

fn lease_loop(c: &mut Client, sh: &Shared) {
    let period = Duration::from_millis(sh.o.renew_ms);
    // Deadline-driven on the host's monotonic clock, as a real timer would
    // be. A slow or skewed host clock can only make renewals late (an early
    // takeover), never unsafe: fencing reads no clock.
    let mut next = Instant::now() + period;
    let mut n = 0u64;
    loop {
        if sh.lost.load(SeqCst) {
            return;
        }
        if sh.release.load(SeqCst) {
            let r = c.query_one(
                "WITH r AS (UPDATE _owner SET lease_until = '-infinity', backends = '{}' WHERE singleton AND token = $1 RETURNING 1) \
                 SELECT count(*) FROM r",
                &[&sh.token],
            );
            let at: String = c.query_one("SELECT pg_advisory_unlock($1)::text || '@' || clock_timestamp()::text", &[&ADVISORY_KEY]).unwrap().get(0);
            event("RELEASED", &format!("lease_rows={} unlock_at={}", r.map(|r| r.get::<_, i64>(0)).unwrap_or(-1), at.replace(' ', "T")));
            return;
        }
        let now = Instant::now();
        if now < next {
            thread::sleep((next - now).min(Duration::from_millis(20)));
            continue;
        }
        next += period;
        if next < now {
            next = now + period;
        }
        n += 1;
        let t0 = Instant::now();
        match c.query_opt(
            "UPDATE _owner SET lease_until = clock_timestamp() + make_interval(secs => $1) \
             WHERE singleton AND token = $2 RETURNING lease_until::text",
            &[&(sh.o.lease_ms as f64 / 1000.0), &sh.token],
        ) {
            Ok(Some(r)) => {
                let took = t0.elapsed().as_millis();
                if !sh.o.quiet_renewals || took > 100 {
                    event("RENEWED", &format!("n={n} took_ms={took} lease_until={}", r.get::<_, String>(0).replace(' ', "T")));
                }
            }
            Ok(None) => sh.lose("renewal_refused_token_moved".into()),
            Err(e) => sh.lose(format!("renewal_failed err={}", err_str(&e))),
        }
    }
}

fn head_loop(c: &mut Client, pid: i32, sh: &Shared) {
    let mut n = 0u64;
    while sh.running() {
        n += 1;
        match head_write(c, pid, sh, n, true) {
            Ok(_) => {
                sh.head_commits.fetch_add(1, SeqCst);
            }
            Err(e) => {
                event("COMMIT_FAILED", &format!("kind=head n={n} pid={pid} {e}"));
                sh.lose(format!("head_write_failed n={n}"));
                return;
            }
        }
        thread::sleep(Duration::from_millis(sh.o.head_every_ms));
    }
}

/// A head-advancing write: fence first, then the head row lock (the order
/// every transaction must share, see witness notes on `--head-first`),
/// then the `owner_token` predicate as defense in depth.
fn head_write(c: &mut Client, pid: i32, sh: &Shared, n: u64, hooks: bool) -> Result<i64, WriteError> {
    let mut tx = c.transaction()?;
    let mut seq = None;
    if sh.o.head_first {
        seq = Some(tx.query_one("SELECT seq FROM _head WHERE singleton FOR UPDATE", &[])?.get::<_, i64>(0));
    }
    fence(&mut tx, sh.o.lock, sh.token)?;
    let seq = match seq {
        Some(s) => s,
        None => tx.query_one("SELECT seq FROM _head WHERE singleton FOR UPDATE", &[])?.get::<_, i64>(0),
    } + 1;
    tx.execute("INSERT INTO _log (seq, owner_token, writer) VALUES ($1, $2, $3)", &[&seq, &sh.token, &sh.o.holder])?;
    let k = tx.execute("UPDATE _head SET seq = $1 WHERE singleton AND owner_token = $2", &[&seq, &sh.token])?;
    if k != 1 {
        return Err(WriteError::Refused("head_owner_token_predicate".into()));
    }
    if hooks {
        if let Some(ms) = sh.pause_matches("head", n) {
            event("PAUSING", &format!("kind=head n={n} seq={seq} token={} pid={pid} holds=_owner:{:?},_head:FOR_UPDATE sleep_ms={ms}", sh.token, sh.o.lock));
            thread::sleep(Duration::from_millis(ms));
            event("RESUMED", &format!("kind=head n={n} seq={seq}"));
        }
    }
    tx.commit()?;
    Ok(seq)
}

fn session_loop(c: &mut Client, pid: i32, sh: &Shared, kind: &str, prefix: &str) {
    let mut n = 0u64;
    while sh.running() {
        n += 1;
        match session_write(c, pid, sh, kind, prefix, n, true) {
            Ok(_) => {
                sh.session_commits.fetch_add(1, SeqCst);
            }
            Err(e) => {
                event("COMMIT_FAILED", &format!("kind={kind} n={n} pid={pid} {e}"));
                sh.lose(format!("{kind}_write_failed n={n}"));
                return;
            }
        }
        if sh.o.session_every_ms > 0 {
            thread::sleep(Duration::from_millis(sh.o.session_every_ms));
        }
    }
}

/// A non-head durable write (a session mint): fenced, never touches `_head`.
fn session_write(c: &mut Client, pid: i32, sh: &Shared, kind: &str, prefix: &str, n: u64, hooks: bool) -> Result<String, WriteError> {
    let mut tx = c.transaction()?;
    fence(&mut tx, sh.o.lock, sh.token)?;
    let id = format!("{}-{}-{prefix}-{n}", sh.o.holder, sh.token);
    tx.execute("INSERT INTO _sessions (id, minted_by_token, writer) VALUES ($1, $2, $3)", &[&id, &sh.token, &sh.o.holder])?;
    if hooks && kind == "session" {
        if sh.pause_matches("bigread", n).is_some() {
            // Leave the server blocked writing a large result to a client
            // that stops reading (witness 7b: wait_event ClientWrite).
            use postgres::fallible_iterator::FallibleIterator;
            let mut it = tx.query_raw("SELECT repeat('x', 1000) FROM generate_series(1, 400000)", std::iter::empty::<i32>())?;
            let _first = it.next()?;
            event("PAUSING", &format!("kind=bigread n={n} id={id} token={} pid={pid}", sh.token));
            thread::sleep(Duration::from_secs(3600));
        }
        if sh.pause_matches("synccommit", n).is_some() {
            // This commit waits for a synchronous standby that never answers
            // (witness 9): committed locally, never acknowledged.
            tx.batch_execute("SET LOCAL synchronous_commit = on")?;
            event("PAUSING", &format!("kind=synccommit n={n} id={id} token={} pid={pid}", sh.token));
        }
    }
    if hooks {
        if let Some(ms) = sh.pause_matches(kind, n) {
            event("PAUSING", &format!("kind={kind} n={n} id={id} token={} pid={pid} holds=_owner:{:?} sleep_ms={ms}", sh.token, sh.o.lock));
            thread::sleep(Duration::from_millis(ms));
            event("RESUMED", &format!("kind={kind} n={n} id={id}"));
        }
    }
    tx.commit()?;
    Ok(id)
}

/// After losing ownership: reconnect (as a pool would, with the stale token
/// still in hand) and try both write kinds (witness 4).
fn probe(sh: &Shared) {
    let tag = owner_tag(&sh.o.holder, sh.token);
    let mut c = None;
    for _ in 0..50 {
        match connect(ROLE, &tag, &sh.o.pg_options) {
            Ok(x) => {
                c = Some(x);
                break;
            }
            Err(_) => thread::sleep(Duration::from_millis(100)),
        }
    }
    let Some(mut c) = c else {
        event("PROBE", "kind=connect result=ERROR");
        return;
    };
    let pid = backend_pid(&mut c);
    event("PROBE_START", &format!("token={} pid={pid}", sh.token));
    let r = head_write(&mut c, pid, sh, u64::MAX, false);
    event("PROBE", &format!("kind=head fenced=true result={}", outcome(&r)));
    let r = session_write(&mut c, pid, sh, "probe", "probe", 1, false);
    event("PROBE", &format!("kind=session fenced=true result={}", outcome(&r)));
    if sh.o.after_loss == "probe-controls" {
        // Controls: the same writes without the fence. The head keeps its
        // owner_token predicate; the session mint has nothing.
        let r = (|| -> Result<i64, WriteError> {
            let mut tx = c.transaction()?;
            let seq: i64 = tx.query_one("SELECT seq FROM _head WHERE singleton FOR UPDATE", &[])?.get::<_, i64>(0) + 1;
            let k = tx.execute("UPDATE _head SET seq = $1 WHERE singleton AND owner_token = $2", &[&seq, &sh.token])?;
            if k != 1 {
                return Err(WriteError::Refused("head_owner_token_predicate".into()));
            }
            tx.execute("INSERT INTO _log (seq, owner_token, writer) VALUES ($1, $2, 'control')", &[&seq, &sh.token])?;
            tx.commit()?;
            Ok(seq)
        })();
        event("PROBE", &format!("kind=head fenced=false(control) result={}", outcome(&r)));
        let id = format!("control-{}-{}", sh.o.holder, sh.token);
        let r = c
            .execute("INSERT INTO _sessions (id, minted_by_token, writer) VALUES ($1, $2, 'control')", &[&id, &sh.token])
            .map(|_| id)
            .map_err(WriteError::Db);
        event("PROBE", &format!("kind=session fenced=false(control) result={}", outcome(&r)));
    }
}

fn outcome<T: std::fmt::Debug>(r: &Result<T, WriteError>) -> String {
    match r {
        Ok(v) => format!("COMMITTED value={v:?}"),
        Err(e) => e.to_string(),
    }
}
