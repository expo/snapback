//! Witness harness for the fencing prototype. Each witness resets the
//! schema, drives `node` processes (owner, standby) with signals, observes
//! the database as the superuser, and prints `RESULT` lines with evidence.
//!
//!   witness <w1|w2|w3|w4|w5|w6|w7|w8|w9|w10|all>
//!   witness <w11a|w11b|w11c|w11d|w11e|w11f|w11>          (the step-2 lease claim)
//!   witness <w2claim|w3claim|w8claim|w10claim|claim-reruns>
//!
//! Needs PGFENCE_HOST / PGFENCE_PORT / PGFENCE_DB (see scripts/cluster.sh).

use postgres::Client;
use snapback4_postgres_fencing::*;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::io::Write as _;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::OnceLock;
use std::sync::mpsc::{Receiver, channel};
use std::thread;
use std::time::{Duration, Instant};

const LEASE_MS: u64 = 3000;
/// Stated bound: a standby takes over within lease + BOUND_MS of the owner
/// stopping (poll interval 100 ms + termination wait + takeover transaction).
const BOUND_MS: u64 = 1000;

static START: OnceLock<Instant> = OnceLock::new();
fn secs() -> f64 {
    START.get_or_init(Instant::now).elapsed().as_secs_f64()
}
fn log(s: &str) {
    println!("[{:8.3}] {s}", secs());
}

// ------------------------------------------------------------------ results

struct Results(Vec<(String, String, String, String)>);
impl Results {
    fn add(&mut self, w: &str, case: &str, verdict: &str, detail: String) {
        println!("RESULT {w} {case} {verdict} :: {detail}");
        self.0.push((w.into(), case.into(), verdict.into(), detail));
    }
    fn pass(&mut self, w: &str, case: &str, ok: bool, detail: String) {
        self.add(w, case, if ok { "PASS" } else { "FAIL" }, detail);
    }
}

// --------------------------------------------------------------- processes

struct Proc {
    name: String,
    child: Child,
    stdin: Option<ChildStdin>,
    rx: Receiver<(Instant, String)>,
    seen: Vec<(Instant, String)>,
}

fn bin_dir() -> PathBuf {
    std::env::current_exe().unwrap().parent().unwrap().to_path_buf()
}

fn shim_path() -> PathBuf {
    std::env::var("SKEWCLOCK_SO").map(PathBuf::from).unwrap_or_else(|_| bin_dir().join("../skewclock.so"))
}

impl Proc {
    fn spawn(name: &str, args: &[&str], envs: &[(&str, String)]) -> Proc {
        let mut cmd = Command::new(bin_dir().join("node"));
        cmd.args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        for (k, v) in envs {
            cmd.env(k, v);
        }
        let mut child = cmd.spawn().expect("spawn node");
        let stdin = child.stdin.take();
        let (tx, rx) = channel();
        let out = child.stdout.take().unwrap();
        let err = child.stderr.take().unwrap();
        let t2 = tx.clone();
        thread::spawn(move || {
            for l in BufReader::new(out).lines().map_while(Result::ok) {
                let _ = tx.send((Instant::now(), l));
            }
        });
        thread::spawn(move || {
            for l in BufReader::new(err).lines().map_while(Result::ok) {
                let _ = t2.send((Instant::now(), format!("STDERR {l}")));
            }
        });
        log(&format!("spawned {name} pid={} args={}", child.id(), args.join(" ")));
        Proc { name: name.into(), child, stdin, rx, seen: vec![] }
    }
    /// Release a node blocked in a `--hold` hook (it reads one line from stdin).
    fn release(&mut self, label: &str) -> Instant {
        if let Some(s) = self.stdin.as_mut() {
            let _ = s.write_all(b"go\n");
            let _ = s.flush();
        }
        let at = Instant::now();
        log(&format!("RELEASE {label} -> {}", self.name));
        at
    }
    fn wait_hold(&mut self, at: &str, timeout: Duration) -> Option<(Instant, String)> {
        let want = format!("at={at}");
        self.wait_for(|l| l.starts_with("HOLD ") && l.split_whitespace().any(|t| t == want), timeout)
    }
    fn pid(&self) -> i32 {
        self.child.id() as i32
    }
    fn take(&mut self, at: Instant, l: String) -> (Instant, String) {
        let quiet = l.starts_with("RENEWED") && self.seen.iter().filter(|(_, s)| s.starts_with("RENEWED")).count() > 3;
        if !quiet {
            println!("[{:8.3}]   {:<8} {}", at.duration_since(*START.get().unwrap()).as_secs_f64(), self.name, l);
        }
        self.seen.push((at, l.clone()));
        (at, l)
    }
    fn wait_for(&mut self, pred: impl Fn(&str) -> bool, timeout: Duration) -> Option<(Instant, String)> {
        let deadline = Instant::now() + timeout;
        loop {
            let now = Instant::now();
            if now >= deadline {
                return None;
            }
            match self.rx.recv_timeout(deadline - now) {
                Ok((at, l)) => {
                    let (at, l) = self.take(at, l);
                    if pred(&l) {
                        return Some((at, l));
                    }
                }
                Err(_) => return None,
            }
        }
    }
    fn wait_ev(&mut self, prefix: &str, timeout: Duration) -> Option<(Instant, String)> {
        let p = format!("{prefix} ");
        self.wait_for(|l| l.starts_with(&p), timeout)
    }
    fn drain(&mut self) {
        while let Ok((at, l)) = self.rx.try_recv() {
            self.take(at, l);
        }
    }
    fn lines(&self, prefix: &str) -> Vec<String> {
        let p = format!("{prefix} ");
        self.seen.iter().filter(|(_, l)| l.starts_with(&p)).map(|(_, l)| l.clone()).collect()
    }
    fn sig(&self, s: i32, label: &str) -> Instant {
        unsafe { libc::kill(self.pid(), s) };
        let at = Instant::now();
        log(&format!("{label} -> {} (pid {})", self.name, self.pid()));
        at
    }
    fn wait_exit(&mut self, timeout: Duration) -> Option<i32> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            self.drain();
            if let Ok(Some(st)) = self.child.try_wait() {
                thread::sleep(Duration::from_millis(50));
                self.drain();
                return Some(st.code().unwrap_or(-1));
            }
            thread::sleep(Duration::from_millis(20));
        }
        None
    }
}

impl Drop for Proc {
    fn drop(&mut self) {
        unsafe {
            libc::kill(self.pid(), libc::SIGCONT);
            libc::kill(self.pid(), libc::SIGKILL);
        }
        let _ = self.child.wait();
        self.drain();
    }
}

// ---------------------------------------------------------------- database

fn su() -> Client {
    connect("sb_super", "witness-observer", "").expect("superuser connect")
}

fn reset(c: &mut Client) {
    // A previous witness 9 may have left synchronous replication armed.
    c.batch_execute("ALTER SYSTEM RESET synchronous_standby_names").unwrap();
    c.batch_execute("SELECT pg_reload_conf()").unwrap();
    // Leftover sessions from a previous witness (killed nodes) must not hold locks.
    c.batch_execute(
        "SELECT pg_terminate_backend(pid, 5000) FROM pg_stat_activity \
         WHERE datname = 'fence' AND pid <> pg_backend_pid() AND backend_type = 'client backend'",
    )
    .unwrap();
    c.batch_execute(RESET_SQL).unwrap();
}

fn activity(c: &mut Client, title: &str) {
    log(&format!("pg_stat_activity snapshot: {title}"));
    let rows = c
        .query(
            "SELECT a.pid, a.usename::text, a.application_name, coalesce(a.state, ''), \
                    coalesce(a.wait_event_type || ':' || a.wait_event, ''), \
                    coalesce(a.backend_xid::text, ''), pg_blocking_pids(a.pid)::text, \
                    left(regexp_replace(coalesce(a.query, ''), '\\s+', ' ', 'g'), 64), \
                    coalesce(round(extract(epoch FROM clock_timestamp() - a.state_change) * 1000)::text, '') \
             FROM pg_stat_activity a \
             WHERE a.datname = 'fence' AND a.backend_type = 'client backend' AND a.pid <> pg_backend_pid() \
             ORDER BY a.pid",
            &[],
        )
        .unwrap();
    println!("    {:>8} {:<9} {:<26} {:<20} {:<22} {:<7} {:<10} {:>7}  query", "pid", "role", "application_name", "state", "wait", "xid", "blockedby", "inst_ms");
    for r in rows {
        let (pid, u, app, st, w, xid, bl, q, ms): (i32, String, String, String, String, String, String, String, String) =
            (r.get(0), r.get(1), r.get(2), r.get(3), r.get(4), r.get(5), r.get(6), r.get(7), r.get(8));
        println!("    {pid:>8} {u:<9} {app:<26} {st:<20} {w:<22} {xid:<7} {bl:<10} {ms:>7}  {q}");
    }
    let o = c.query_one("SELECT token, coalesce(holder, ''), backends::text, lease_until::text, (lease_until < clock_timestamp())::text FROM _owner", &[]).unwrap();
    println!(
        "    _owner: token={} holder={} backends={} lease_until={} expired={}",
        o.get::<_, i64>(0),
        o.get::<_, String>(1),
        o.get::<_, String>(2),
        o.get::<_, String>(3),
        o.get::<_, String>(4)
    );
}

struct Check {
    ok: bool,
    summary: String,
}

/// Did anything the old owner(s) wrote commit after the takeover committed?
/// Commit order is read from `track_commit_timestamp`; the takeover's commit
/// timestamp is that of its `_takeovers` row.
fn late_commit_check(c: &mut Client, new: i64, paused_ids: &[String], paused_seq: Option<i64>) -> Check {
    let r = c
        .query_one(
            "WITH t AS (SELECT pg_xact_commit_timestamp(xmin) AS ts FROM _takeovers WHERE token = $1) \
             SELECT (SELECT ts FROM t)::text, \
               (SELECT count(*) FROM _log WHERE owner_token < $1 AND writer <> 'control'), \
               (SELECT count(*) FROM _log WHERE owner_token < $1 AND writer <> 'control' AND pg_xact_commit_timestamp(xmin) > (SELECT ts FROM t)), \
               (SELECT coalesce(max(pg_xact_commit_timestamp(xmin))::text, '-') FROM _log WHERE owner_token < $1 AND writer <> 'control'), \
               (SELECT count(*) FROM _log WHERE owner_token = $1), \
               (SELECT count(*) FROM _sessions WHERE minted_by_token < $1 AND writer <> 'control'), \
               (SELECT count(*) FROM _sessions WHERE minted_by_token < $1 AND writer <> 'control' AND pg_xact_commit_timestamp(xmin) > (SELECT ts FROM t)), \
               (SELECT coalesce(max(pg_xact_commit_timestamp(xmin))::text, '-') FROM _sessions WHERE minted_by_token < $1 AND writer <> 'control'), \
               (SELECT count(*) FROM _sessions WHERE minted_by_token = $1), \
               (SELECT seq FROM _head), (SELECT owner_token FROM _head), \
               (SELECT count(*) FROM _sessions WHERE id = ANY($2)), \
               (SELECT count(*) FROM _log WHERE seq = $3 AND owner_token < $1)",
            &[&new, &paused_ids, &paused_seq.unwrap_or(-1)],
        )
        .unwrap();
    let take_ts: Option<String> = r.get(0);
    let (old_log, late_log, last_old_log, new_log): (i64, i64, String, i64) = (r.get(1), r.get(2), r.get(3), r.get(4));
    let (old_s, late_s, last_old_s, new_s): (i64, i64, String, i64) = (r.get(5), r.get(6), r.get(7), r.get(8));
    let (head_seq, head_tok, paused_rows, paused_log): (i64, i64, i64, i64) = (r.get(9), r.get(10), r.get(11), r.get(12));
    let ok = take_ts.is_some() && late_log == 0 && late_s == 0 && head_tok == new && paused_rows == 0 && paused_log == 0 && new_log > 0;
    let summary = format!(
        "takeover_commit={} | _log: old-token rows={old_log} committed-after-takeover={late_log} last-old-commit={last_old_log} new-token rows={new_log} | \
         _sessions: old-token rows={old_s} committed-after-takeover={late_s} last-old-commit={last_old_s} new-token rows={new_s} | \
         head seq={head_seq} owner_token={head_tok} | paused-tx rows present: sessions={paused_rows} log={paused_log}",
        take_ts.unwrap_or_else(|| "NONE".into())
    );
    log(&format!("commit-order check: {summary}"));
    Check { ok, summary }
}

fn ms(d: Duration) -> u128 {
    d.as_millis()
}

// ------------------------------------------------- the takeover scenario

struct Scenario<'a> {
    owner: Vec<&'a str>,
    standby: Vec<&'a str>,
    owner_env: Vec<(&'a str, String)>,
    standby_env: Vec<(&'a str, String)>,
    /// SIGSTOP the owner when it prints `PAUSING kind=<this>`; None = after 1 s; Some("") = never.
    stop_on: Option<&'a str>,
    /// How long to wait for the standby before declaring it blocked.
    cap: Duration,
    /// Superuser statements run before the processes start (witness 9).
    before: Vec<&'a str>,
}

struct Outcome {
    took_over_after_stop: Option<Duration>,
    new_token: i64,
    check: Option<Check>,
    owner: Proc,
    standby: Proc,
    paused_line: Option<String>,
}

fn run_scenario(db: &mut Client, s: &Scenario) -> Outcome {
    reset(db);
    for q in &s.before {
        db.batch_execute(q).unwrap();
    }
    let mut owner_args = vec!["--role", "owner", "--holder", "A", "--quiet-renewals"];
    owner_args.extend(&s.owner);
    let mut owner = Proc::spawn("owner", &owner_args, &s.owner_env);
    owner.wait_ev("REGISTERED", Duration::from_secs(10)).expect("owner registered");
    let mut standby_args = vec!["--role", "standby", "--holder", "B", "--after-loss", "exit", "--quiet-renewals"];
    standby_args.extend(&s.standby);
    let mut standby = Proc::spawn("standby", &standby_args, &s.standby_env);
    standby.wait_ev("STANDBY_WAITING", Duration::from_secs(10)).expect("standby waiting");

    let (t_stop, paused_line) = match s.stop_on {
        Some("") => (Instant::now(), None),
        Some(kind) => {
            let want = format!("kind={kind} ");
            let (_, line) = owner.wait_for(|l| l.starts_with("PAUSING ") && l.contains(&want), Duration::from_secs(15)).expect("owner reached pause point");
            (owner.sig(libc::SIGSTOP, "SIGSTOP"), Some(line))
        }
        None => {
            thread::sleep(Duration::from_millis(1000));
            owner.drain();
            (owner.sig(libc::SIGSTOP, "SIGSTOP"), None)
        }
    };
    thread::sleep(Duration::from_millis(300));
    activity(db, "owner stopped (or paused), standby waiting");

    let took = standby.wait_ev("TOOK_OVER", s.cap);
    let mut out = Outcome { took_over_after_stop: None, new_token: 0, check: None, owner, standby, paused_line };
    match took {
        None => {
            log(&format!("standby did NOT take over within {} ms", ms(s.cap)));
            activity(db, "standby blocked");
        }
        Some((at, line)) => {
            out.took_over_after_stop = Some(at.saturating_duration_since(t_stop));
            out.new_token = kv(&line, "token").unwrap().parse().unwrap();
            log(&format!("standby took over {} ms after SIGSTOP", ms(at.saturating_duration_since(t_stop))));
            thread::sleep(Duration::from_millis(1000)); // new owner serves
            if s.stop_on != Some("") {
                out.owner.sig(libc::SIGCONT, "SIGCONT");
            }
            let code = out.owner.wait_exit(Duration::from_secs(15));
            log(&format!("old owner exit code {code:?}"));
            thread::sleep(Duration::from_millis(500));
            out.standby.drain();
            activity(db, "after old owner resumed and exited");
            let ids: Vec<String> = out.paused_line.iter().filter_map(|l| kv(l, "id").map(String::from)).collect();
            let seq = out.paused_line.as_deref().and_then(|l| kv(l, "seq")).map(|s| s.parse().unwrap());
            out.check = Some(late_commit_check(db, out.new_token, &ids, seq));
        }
    }
    out
}

fn bound() -> Duration {
    Duration::from_millis(LEASE_MS + BOUND_MS)
}

fn takeover_verdict(r: &mut Results, w: &str, case: &str, o: &Outcome) {
    let within = o.took_over_after_stop.is_some_and(|d| d <= bound());
    let fenced = o.check.as_ref().is_some_and(|c| c.ok);
    r.pass(
        w,
        case,
        within && fenced,
        format!(
            "took_over_after_stop={} (bound {} ms) | {}",
            o.took_over_after_stop.map_or("NEVER".into(), |d| format!("{} ms", ms(d))),
            ms(bound()),
            o.check.as_ref().map_or("no takeover, no check".into(), |c| c.summary.clone())
        ),
    );
}

// ---------------------------------------------------------------- witnesses

fn try_terminate(actor: &mut Client, pid: i32) -> String {
    match actor.query_one("SELECT pg_terminate_backend($1)", &[&pid]) {
        Ok(r) => format!("ok={}", r.get::<_, bool>(0)),
        Err(e) => format!("DENIED({})", err_str(&e)),
    }
}

fn alive(db: &mut Client, pid: i32) -> bool {
    thread::sleep(Duration::from_millis(200));
    db.query_one("SELECT count(*) FROM pg_stat_activity WHERE pid = $1", &[&pid]).unwrap().get::<_, i64>(0) == 1
}

fn w1(db: &mut Client, r: &mut Results) {
    log("=== W1 same-role termination without superuser");
    reset(db);
    let c = |u: &str, app: &str| -> (Client, i32) {
        let mut c = connect(u, app, "").unwrap();
        let p = backend_pid(&mut c);
        (c, p)
    };
    let (mut core_a, _) = c("sb_core", "w1-actor-core");
    let (_core_b, core_b) = c("sb_core", "w1-victim-core");
    let (_other, other) = c("sb_other", "w1-victim-other");
    let (_sup, sup) = c("sb_super", "w1-victim-super");
    let (mut signal, _) = c("sb_signal", "w1-actor-signal");
    let (_other2, other2) = c("sb_other", "w1-victim-other2");
    let (_core_c, core_c) = c("sb_core", "w1-victim-core2");
    let (mut member, member_pid) = c("sb_core_member", "w1-actor-member");
    let (_core_d, core_d) = c("sb_core", "w1-victim-core3");
    let (mut inspect, _) = c("sb_inspect", "w1-inspect");

    let a_b = try_terminate(&mut core_a, core_b);
    let b_dead = !alive(db, core_b);
    let a_other = try_terminate(&mut core_a, other);
    let a_sup = try_terminate(&mut core_a, sup);
    let a_member = try_terminate(&mut core_a, member_pid);
    let s_other = try_terminate(&mut signal, other2);
    let s_sup = try_terminate(&mut signal, sup);
    let s_core = try_terminate(&mut signal, core_c);
    let m_core = try_terminate(&mut member, core_d);
    log(&format!("sb_core -> sb_core: {a_b} (victim gone: {b_dead})"));
    log(&format!("sb_core -> sb_other: {a_other}"));
    log(&format!("sb_core -> superuser: {a_sup}"));
    log(&format!("sb_core -> sb_core_member (a role that is a member OF sb_core): {a_member}"));
    log(&format!("sb_signal (pg_signal_backend) -> sb_other: {s_other}"));
    log(&format!("sb_signal (pg_signal_backend) -> superuser: {s_sup}"));
    log(&format!("sb_signal (pg_signal_backend) -> sb_core: {s_core}"));
    log(&format!("sb_core_member (member of sb_core) -> sb_core: {m_core}"));

    // Visibility of another role's session to sb_core.
    let v = core_a
        .query_one(
            "SELECT coalesce(application_name, '<null>'), coalesce(state, '<null>'), coalesce(query, '<null>'), coalesce(backend_xid::text, '<null>'), coalesce(client_port::text, '<null>') \
             FROM pg_stat_activity WHERE pid = $1",
            &[&sup],
        )
        .unwrap();
    log(&format!(
        "sb_core sees superuser backend: application_name={} state={} query={} backend_xid={} client_port={}",
        v.get::<_, String>(0),
        v.get::<_, String>(1),
        v.get::<_, String>(2),
        v.get::<_, String>(3),
        v.get::<_, String>(4)
    ));
    let exec: bool = core_a.query_one("SELECT has_function_privilege('sb_core', 'pg_terminate_backend(integer, bigint)', 'EXECUTE')", &[]).unwrap().get(0);
    log(&format!("sb_core has EXECUTE on pg_terminate_backend(int, bigint): {exec}"));
    let share = inspect.query_one("SELECT token FROM _owner FOR KEY SHARE", &[]).map(|_| "ok".to_string()).unwrap_or_else(|e| format!("DENIED({})", err_str(&e)));
    log(&format!("sb_inspect (SELECT only) SELECT ... FOR KEY SHARE on _owner: {share}"));

    let ok = a_b == "ok=true" && b_dead && a_other.starts_with("DENIED") && a_sup.starts_with("DENIED") && s_other == "ok=true" && s_sup.starts_with("DENIED");
    r.pass(
        "W1",
        "same-role-termination",
        ok,
        format!("core->core {a_b}; core->other {a_other}; core->super {a_sup}; signal->other {s_other}; signal->super {s_sup}; signal->core {s_core}; member->core {m_core}; core->member {a_member}"),
    );
    r.add("W1", "row-lock-privilege", "NOTE", format!("FOR SHARE/KEY SHARE needs UPDATE privilege: sb_inspect got {share}"));
}

fn owner_base() -> Vec<&'static str> {
    vec!["--lease-ms", "3000", "--renew-ms", "500"]
}

fn w2(db: &mut Client, r: &mut Results, lock: &'static str, w: &str) {
    w2_with(db, r, lock, w, "pidlist")
}

fn w2_with(db: &mut Client, r: &mut Results, lock: &'static str, w: &str, strategy: &'static str) {
    for (kind, pause) in [("head", "head:30:3000"), ("session", "session:12:3000")] {
        log(&format!("=== {w} SIGSTOP takeover, owner paused inside a fenced {kind} transaction, lock={lock}, standby strategy={strategy}"));
        let mut owner = owner_base();
        owner.extend(["--lock", lock, "--pause", pause, "--after-loss", "probe"]);
        let o = run_scenario(
            db,
            &Scenario {
                owner,
                standby: vec!["--lease-ms", "3000", "--renew-ms", "500", "--lock", lock, "--strategy", strategy],
                owner_env: vec![],
                standby_env: vec![],
                stop_on: Some(kind),
                cap: Duration::from_secs(10),
                before: vec![],
            },
        );
        let case = if strategy == "pidlist" { format!("pause-in-{kind}-tx/{lock}") } else { format!("pause-in-{kind}-tx/{lock}/{strategy}") };
        takeover_verdict(r, w, &case, &o);
        if strategy == "claim" {
            r.add(w, &format!("{case}/standby-events"), "NOTE", format!("{:?} {:?} {:?}", o.standby.lines("CLAIM"), o.standby.lines("FOR_UPDATE"), o.standby.lines("TERMINATE")));
        }
    }
}

fn w3(db: &mut Client, r: &mut Results) {
    w3_with(db, r, &["pidlist", "appname", "blockers"], "share")
}

fn w3_with(db: &mut Client, r: &mut Results, strategies: &[&'static str], lock: &'static str) {
    for &strategy in strategies {
        log(&format!("=== W3 unlisted backend paused holding _owner (lock={lock}); standby strategy={strategy}"));
        let mut owner = owner_base();
        owner.extend(["--late-conn", "--pause", "late:12:8000", "--after-loss", "probe", "--lock", lock]);
        let cap = if strategy == "pidlist" { Duration::from_secs(20) } else { Duration::from_secs(10) };
        let o = run_scenario(
            db,
            &Scenario {
                owner,
                // `claim-hygiene-off`: the claim strategy with only blocker termination (no tag sweep).
                standby: if strategy == "claim-hygiene-off" {
                    vec!["--lease-ms", "3000", "--renew-ms", "500", "--strategy", "claim", "--hygiene", "off", "--lock", lock]
                } else {
                    vec!["--lease-ms", "3000", "--renew-ms", "500", "--strategy", strategy, "--lock", lock]
                },
                owner_env: vec![],
                standby_env: vec![],
                stop_on: Some("late"),
                cap,
                before: vec![],
            },
        );
        let timeouts = o.standby.lines("LOCK_TIMEOUT").len();
        let mut detail_extra = format!(" | standby lock timeouts={timeouts}, terminations={:?}", o.standby.lines("TERMINATE"));
        if o.took_over_after_stop.is_none() {
            detail_extra = format!(" | BLOCKED: no takeover in {} ms{detail_extra}", ms(cap));
        }
        let within = o.took_over_after_stop.is_some_and(|d| d <= bound());
        let fenced = o.check.as_ref().is_some_and(|c| c.ok);
        r.pass(
            "W3",
            &format!("unlisted-backend/{strategy}{}", if lock == "share" { String::new() } else { format!("/{lock}") }),
            within && fenced,
            format!(
                "took_over_after_stop={}{detail_extra} | {}",
                o.took_over_after_stop.map_or("NEVER".into(), |d| format!("{} ms", ms(d))),
                o.check.as_ref().map_or("-".into(), |c| c.summary.clone())
            ),
        );
    }
}

fn w4(db: &mut Client, r: &mut Results) {
    log("=== W4 the old owner reconnects with a stale token");
    let mut owner = owner_base();
    owner.extend(["--pause", "session:12:3000", "--after-loss", "probe-controls"]);
    let o = run_scenario(
        db,
        &Scenario {
            owner,
            standby: vec!["--lease-ms", "3000", "--renew-ms", "500", "--strategy", "pidlist"],
            owner_env: vec![],
            standby_env: vec![],
            stop_on: Some("session"),
            cap: Duration::from_secs(10),
            before: vec![],
        },
    );
    let probes = o.owner.lines("PROBE");
    let fenced: Vec<&String> = probes.iter().filter(|l| l.contains("fenced=true")).collect();
    let refused = fenced.len() == 2 && fenced.iter().all(|l| l.contains("result=REFUSED"));
    let controls: Vec<&String> = probes.iter().filter(|l| l.contains("control")).collect();
    let fenced_ok = o.check.as_ref().is_some_and(|c| c.ok);
    r.pass("W4", "stale-token-reconnect", refused && fenced_ok, format!("fenced probes: {fenced:?} | db: {}", o.check.as_ref().map_or("-".into(), |c| c.summary.clone())));
    r.add("W4", "controls-without-fence", "NOTE", format!("{controls:?}"));
    drop(o);

    // Isolation corollary: a transaction that began before the increment and
    // fences after it. READ COMMITTED re-reads the new token; REPEATABLE READ
    // raises a serialization failure. Both refuse.
    reset(db);
    for iso in ["READ COMMITTED", "REPEATABLE READ"] {
        let mut s1 = connect("sb_core", "w4-iso-old", "").unwrap();
        let mut s2 = connect("sb_core", "w4-iso-new", "").unwrap();
        s1.batch_execute(&format!("BEGIN ISOLATION LEVEL {iso}; SELECT count(*) FROM _sessions")).unwrap();
        s2.batch_execute("UPDATE _owner SET token = token + 1").unwrap();
        let res = s1.query_one("SELECT token FROM _owner WHERE singleton FOR SHARE", &[]);
        let desc = match res {
            Ok(row) => format!("fence read token={} (stale token 0 would be refused)", row.get::<_, i64>(0)),
            Err(e) => format!("error {}", err_str(&e)),
        };
        let _ = s1.batch_execute("ROLLBACK");
        r.add("W4", &format!("isolation/{}", iso.replace(' ', "_")), "NOTE", desc);
    }
}

fn w5(db: &mut Client, r: &mut Results) {
    let shim = shim_path();
    if !shim.exists() {
        r.add("W5", "lease-clock", "NOT-RUN", format!("shim missing at {}", shim.display()));
        return;
    }
    let pre = shim.to_string_lossy().to_string();
    let mut lags = vec![];
    for (case, oenv, senv) in [
        ("baseline", vec![], vec![]),
        (
            "realtime-skew(owner+1d,standby-1d)",
            vec![("LD_PRELOAD", pre.clone()), ("SKEW_REALTIME_S", "86400".to_string())],
            vec![("LD_PRELOAD", pre.clone()), ("SKEW_REALTIME_S", "-86400".to_string())],
        ),
    ] {
        log(&format!("=== W5 lease clock: {case}"));
        let o = run_scenario(
            db,
            &Scenario {
                owner: owner_base(),
                standby: vec!["--lease-ms", "3000", "--renew-ms", "500", "--strategy", "pidlist"],
                owner_env: oenv,
                standby_env: senv,
                stop_on: None,
                cap: Duration::from_secs(10),
                before: vec![],
            },
        );
        let lag: f64 = db
            .query_one(
                "SELECT extract(epoch FROM pg_xact_commit_timestamp(xmin) - lease_until_was)::float8 * 1000 FROM _takeovers WHERE token = $1",
                &[&o.new_token],
            )
            .map(|r| r.get(0))
            .unwrap_or(f64::NAN);
        let clocks: Vec<String> = o.owner.lines("HOST_CLOCK").into_iter().chain(o.standby.lines("HOST_CLOCK")).collect();
        log(&format!("{case}: takeover committed {lag:.0} ms after lease_until (DB clock); host clocks {clocks:?}"));
        lags.push(lag);
        takeover_verdict(r, "W5", case, &o);
        r.add("W5", &format!("{case}/lag"), "NOTE", format!("takeover_commit - lease_until = {lag:.0} ms (DB clock); {clocks:?}"));
    }
    // A host whose monotonic clock runs at 1/10 speed renews late. Expected:
    // an early takeover of a live, unpaused owner, and still nothing committed
    // by it afterwards.
    log("=== W5 lease clock: owner monotonic clock at 0.1x (renewals late), no SIGSTOP");
    let o = run_scenario(
        db,
        &Scenario {
            owner: owner_base(),
            standby: vec!["--lease-ms", "3000", "--renew-ms", "500", "--strategy", "pidlist"],
            owner_env: vec![("LD_PRELOAD", pre.clone()), ("SKEW_MONO_RATE", "0.1".to_string())],
            standby_env: vec![],
            stop_on: Some(""),
            cap: Duration::from_secs(12),
            before: vec![],
        },
    );
    let fenced = o.check.as_ref().is_some_and(|c| c.ok);
    r.pass(
        "W5",
        "slow-monotonic-owner",
        o.took_over_after_stop.is_some() && fenced,
        format!(
            "takeover of a live owner after {} | {}",
            o.took_over_after_stop.map_or("NEVER".into(), |d| format!("{} ms from start", ms(d))),
            o.check.as_ref().map_or("-".into(), |c| c.summary.clone())
        ),
    );
    let _ = lags;
}

fn w6(db: &mut Client, r: &mut Results) {
    log("=== W6a clean shutdown: advisory-lock fast path");
    for (case, adv) in [("advisory-wait/poll-1000ms", true), ("lease-poll-only/poll-1000ms", false)] {
        reset(db);
        let mut owner = Proc::spawn("owner", &["--role", "owner", "--holder", "A", "--stop-after-ms", "2500", "--quiet-renewals"], &[]);
        owner.wait_ev("REGISTERED", Duration::from_secs(10)).unwrap();
        let mut sargs = vec!["--role", "standby", "--holder", "B", "--poll-ms", "1000", "--quiet-renewals"];
        if adv {
            sargs.push("--advisory-wait");
        }
        let mut standby = Proc::spawn("standby", &sargs, &[]);
        let rel = owner.wait_ev("RELEASED", Duration::from_secs(10));
        let took = standby.wait_ev("TOOK_OVER", Duration::from_secs(10));
        let _ = owner.wait_exit(Duration::from_secs(5));
        let lag: f64 = db
            .query_one(
                "SELECT extract(epoch FROM (SELECT pg_xact_commit_timestamp(xmin) FROM _takeovers WHERE token = 2) - \
                 (SELECT max(pg_xact_commit_timestamp(xmin)) FROM _log WHERE owner_token = 1))::float8 * 1000",
                &[],
            )
            .map(|r| r.get::<_, Option<f64>>(0).unwrap_or(f64::NAN))
            .unwrap_or(f64::NAN);
        let host_lag = match (&rel, &took) {
            (Some((a, _)), Some((b, _))) => b.saturating_duration_since(*a).as_millis() as i64,
            _ => -1,
        };
        log(&format!("{case}: RELEASED -> TOOK_OVER {host_lag} ms (host); last old commit -> takeover commit {lag:.0} ms (DB)"));
        if adv {
            r.pass("W6", "clean-shutdown-fast-path", took.is_some() && host_lag >= 0 && host_lag < 200, format!("release->takeover {host_lag} ms with --advisory-wait (lease poll 1000 ms, lease 3000 ms); last-old-commit->takeover {lag:.0} ms"));
        } else {
            r.add("W6", "clean-shutdown-poll-only", "NOTE", format!("release->takeover {host_lag} ms without the advisory wait (bounded by the 1000 ms poll)"));
        }
    }

    log("=== W6b the first draft: standby gates on pg_advisory_lock while the owner is SIGSTOPped");
    reset(db);
    let mut owner = Proc::spawn("owner", &["--role", "owner", "--holder", "A", "--pause", "head:30:60000", "--quiet-renewals"], &[]);
    owner.wait_ev("REGISTERED", Duration::from_secs(10)).unwrap();
    owner.wait_for(|l| l.starts_with("PAUSING "), Duration::from_secs(10)).unwrap();
    owner.sig(libc::SIGSTOP, "SIGSTOP");
    let mut old = connect("sb_core", "w6-old-design-standby", "").unwrap();
    old.batch_execute("SET statement_timeout = 15000").unwrap();
    let t0 = Instant::now();
    let res = old.query_one("SELECT pg_advisory_lock($1)", &[&ADVISORY_KEY]);
    let waited = t0.elapsed();
    let blocked = res.is_err();
    log(&format!("old-design pg_advisory_lock: {} after {} ms", res.as_ref().map(|_| "ACQUIRED".to_string()).unwrap_or_else(|e| err_str(e)), ms(waited)));
    activity(db, "old design: advisory waiter vs stopped owner");
    // The new protocol's step 1 frees it: terminate the holder's lease backend (same role).
    let lease_pid: i32 = db.query_one("SELECT backends[1] FROM _owner", &[]).unwrap().get(0);
    old.batch_execute("RESET statement_timeout").unwrap();
    let term = try_terminate(&mut old, lease_pid);
    old.batch_execute("SET statement_timeout = 5000").unwrap();
    let t1 = Instant::now();
    let after = old.query_one("SELECT pg_advisory_lock($1)", &[&ADVISORY_KEY]).map(|_| "ACQUIRED".to_string()).unwrap_or_else(|e| err_str(&e));
    log(&format!("after sb_core terminated lease backend {lease_pid} ({term}): pg_advisory_lock {after} in {} ms", ms(t1.elapsed())));
    r.add(
        "W6",
        "old-design-advisory-gate",
        if blocked { "FAIL(expected)" } else { "UNEXPECTED" },
        format!("standby blocked on pg_advisory_lock for {} ms until statement_timeout; after terminating the lease backend: {after} in {} ms", ms(waited), ms(t1.elapsed())),
    );
    drop(owner);
}

fn w7(db: &mut Client, r: &mut Results) {
    log("=== W7a idle_in_transaction_session_timeout as a net under the pid-list design (unlisted paused backend)");
    let mut owner = owner_base();
    owner.extend(["--late-conn", "--pause", "late:12:8000", "--pg-options", "-c idle_in_transaction_session_timeout=2000"]);
    let o = run_scenario(
        db,
        &Scenario {
            owner,
            standby: vec!["--lease-ms", "3000", "--renew-ms", "500", "--strategy", "pidlist"],
            owner_env: vec![],
            standby_env: vec![],
            stop_on: Some("late"),
            cap: Duration::from_secs(10),
            before: vec![],
        },
    );
    takeover_verdict(r, "W7", "idle-in-tx-timeout-2s/pidlist", &o);
    drop(o);

    log("=== W7b paused owner while its backend is blocked in ClientWrite (large result, client stopped)");
    reset(db);
    let mut owner = Proc::spawn(
        "owner",
        &["--role", "owner", "--holder", "A", "--pause", "bigread:12", "--quiet-renewals", "--pg-options", "-c idle_in_transaction_session_timeout=2000 -c statement_timeout=2000"],
        &[],
    );
    owner.wait_ev("REGISTERED", Duration::from_secs(10)).unwrap();
    let (_, line) = owner.wait_for(|l| l.starts_with("PAUSING ") && l.contains("kind=bigread"), Duration::from_secs(15)).unwrap();
    owner.sig(libc::SIGSTOP, "SIGSTOP");
    let pid: i32 = kv(&line, "pid").unwrap().parse().unwrap();
    thread::sleep(Duration::from_millis(6000));
    activity(db, "6 s after SIGSTOP; statement_timeout=2s and idle_in_transaction_session_timeout=2s on the owner's sessions");
    let st = db
        .query_opt("SELECT state, coalesce(wait_event, '') FROM pg_stat_activity WHERE pid = $1", &[&pid])
        .unwrap()
        .map(|r| format!("{}/{}", r.get::<_, String>(0), r.get::<_, String>(1)))
        .unwrap_or_else(|| "gone".into());
    let mut core = connect("sb_core", "w7-terminator", "").unwrap();
    let t0 = Instant::now();
    let term = core.query_one("SELECT pg_terminate_backend($1, 5000)", &[&pid]).map(|r| r.get::<_, bool>(0).to_string()).unwrap_or_else(|e| err_str(&e));
    let took = ms(t0.elapsed());
    let gone = !alive(db, pid);
    r.add(
        "W7",
        "clientwrite-timeouts",
        "NOTE",
        format!("6 s after SIGSTOP the backend is {st} (timeouts 2 s did not fire); sb_core pg_terminate_backend(pid,5000)={term} in {took} ms, gone={gone}"),
    );
    drop(owner);

    log("=== W7c TCP keepalives vs a stopped (not dead) client");
    reset(db);
    let mut owner = Proc::spawn(
        "owner",
        &[
            "--role", "owner", "--holder", "A", "--pause", "session:12:600000", "--quiet-renewals",
            "--pg-options", "-c tcp_keepalives_idle=1 -c tcp_keepalives_interval=1 -c tcp_keepalives_count=2 -c tcp_user_timeout=3000",
        ],
        &[("PGFENCE_TCP", "1".into())],
    );
    owner.wait_ev("REGISTERED", Duration::from_secs(10)).unwrap();
    owner.wait_for(|l| l.starts_with("PAUSING "), Duration::from_secs(15)).unwrap();
    owner.sig(libc::SIGSTOP, "SIGSTOP");
    thread::sleep(Duration::from_millis(10000));
    activity(db, "10 s after SIGSTOP over TCP with keepalives idle=1 interval=1 count=2, tcp_user_timeout=3s");
    let n: i64 = db.query_one("SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'sb-owner:A:%' AND client_addr IS NOT NULL", &[]).unwrap().get(0);
    r.add("W7", "tcp-keepalive-stopped-client", "NOTE", format!("{n} owner TCP backends still alive 10 s after SIGSTOP (keepalive window ~3 s): the stopped process's kernel answers probes"));
    let t0 = owner.sig(libc::SIGKILL, "SIGKILL");
    let mut gone_ms = None;
    for _ in 0..100 {
        let n: i64 = db.query_one("SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'sb-owner:A:%'", &[]).unwrap().get(0);
        if n == 0 {
            gone_ms = Some(ms(t0.elapsed()));
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
    r.add("W7", "tcp-killed-client", "NOTE", format!("after SIGKILL all owner backends gone in {gone_ms:?} ms (the kernel closes the sockets)"));
    drop(owner);
}

fn w8(db: &mut Client, r: &mut Results) {
    log("=== W8a lock matrix: fence lock vs renewal UPDATE vs takeover FOR UPDATE");
    reset(db);
    for mode in [LockMode::Share, LockMode::KeyShare] {
        let mut s1 = connect("sb_core", "w8-fenced-tx", "").unwrap();
        let mut s2 = connect("sb_core", "w8-renewal", "").unwrap();
        let mut s3 = connect("sb_core", "w8-takeover", "").unwrap();
        s1.batch_execute("BEGIN").unwrap();
        s1.query_one(mode.fence_sql(), &[]).unwrap();
        s2.batch_execute("SET lock_timeout = 1000").unwrap();
        let t0 = Instant::now();
        let renew = s2
            .execute("UPDATE _owner SET lease_until = clock_timestamp() + interval '3 s' WHERE singleton AND token = 0", &[])
            .map(|n| format!("renewed({n}) in {} ms", ms(t0.elapsed())))
            .unwrap_or_else(|e| format!("blocked: {} after {} ms", err_str(&e), ms(t0.elapsed())));
        s3.batch_execute("BEGIN; SET LOCAL lock_timeout = 1000").unwrap();
        let t0 = Instant::now();
        let take = s3
            .query_one("SELECT token FROM _owner WHERE singleton FOR UPDATE", &[])
            .map(|_| format!("ACQUIRED in {} ms (fence broken)", ms(t0.elapsed())))
            .unwrap_or_else(|e| format!("blocked: {} after {} ms", err_str(&e), ms(t0.elapsed())));
        s3.batch_execute("ROLLBACK").unwrap();
        s1.batch_execute("COMMIT").unwrap();
        log(&format!("{mode:?}: renewal while a fenced tx is open: {renew}; takeover FOR UPDATE: {take}"));
        let ok = take.starts_with("blocked");
        r.pass("W8", &format!("lock-matrix/{mode:?}"), ok, format!("renewal: {renew}; takeover FOR UPDATE (after the renewal): {take}"));
    }

    log("=== W8b renewal latency under continuous fenced writes (8 session threads, no sleep)");
    for lock in ["share", "keyshare"] {
        reset(db);
        let mut owner = Proc::spawn(
            "owner",
            &["--role", "owner", "--holder", "A", "--lock", lock, "--session-threads", "8", "--session-every-ms", "0", "--head-every-ms", "0", "--stop-after-ms", "6000"],
            &[],
        );
        let _ = owner.wait_exit(Duration::from_secs(20));
        let took: Vec<u64> = owner.lines("RENEWED").iter().filter_map(|l| kv(l, "took_ms").and_then(|v| v.parse().ok())).collect();
        let max = took.iter().max().copied().unwrap_or(0);
        let mean = if took.is_empty() { 0.0 } else { took.iter().sum::<u64>() as f64 / took.len() as f64 };
        let commits = owner.lines("EXIT").join(" ");
        r.add("W8", &format!("renewal-latency/{lock}"), "NOTE", format!("{} renewals, mean {mean:.1} ms, max {max} ms over 6 s; {commits}", took.len()));
    }

    log("=== W8c slow-but-alive owner: one fenced transaction lasts 7 s (> lease), no SIGSTOP");
    for lock in ["share", "keyshare"] {
        let mut owner = owner_base();
        owner.extend(["--lock", lock, "--pause", "session:12:7000", "--after-loss", "exit"]);
        let o = run_scenario(
            db,
            &Scenario {
                owner,
                standby: vec!["--lease-ms", "3000", "--renew-ms", "500", "--lock", lock, "--strategy", "pidlist"],
                owner_env: vec![],
                standby_env: vec![],
                stop_on: Some(""),
                cap: Duration::from_secs(10),
                before: vec![],
            },
        );
        let mut o = o;
        if o.took_over_after_stop.is_none() {
            // Let the 7 s transaction finish, then look at what it committed.
            let _ = o.owner.wait_ev("RESUMED", Duration::from_secs(10));
            thread::sleep(Duration::from_millis(1500));
            o.owner.drain();
        }
        let resumed = o.owner.lines("RESUMED").len();
        let id = o.owner.lines("PAUSING").first().and_then(|l| kv(l, "id").map(String::from)).unwrap_or_default();
        let db_state = db
            .query_one(
                "SELECT (SELECT token FROM _owner), (SELECT count(*) FROM _sessions WHERE id = $1), \
                 (SELECT count(*) FROM _sessions WHERE minted_by_token = 1)",
                &[&id],
            )
            .map(|r| format!("_owner.token={} slow-tx row committed={} token-1 session rows={}", r.get::<_, i64>(0), r.get::<_, i64>(1), r.get::<_, i64>(2)))
            .unwrap_or_default();
        let still_owner = resumed > 0 && o.owner.lines("LOST").is_empty();
        let detail = format!(
            "takeover={} owner_resumed_and_still_serving={still_owner} | {db_state} | renewals>100ms: {:?} | {}",
            o.took_over_after_stop.map_or("none in 10 s".into(), |d| format!("after {} ms", ms(d))),
            o.owner.lines("RENEWED"),
            o.check.as_ref().map_or("-".into(), |c| c.summary.clone())
        );
        if lock == "keyshare" {
            r.pass("W8", "slow-owner/keyshare", o.took_over_after_stop.is_none() && still_owner, detail);
        } else {
            r.add("W8", "slow-owner/share", if o.took_over_after_stop.is_some() { "SPURIOUS-TAKEOVER" } else { "NO-TAKEOVER" }, detail);
        }
    }
    w2(db, r, "keyshare", "W8");
}

fn w9(db: &mut Client, r: &mut Results) {
    log("=== W9 in-flight COMMIT racing termination (commit waiting for a synchronous standby that never answers)");
    let mut owner = owner_base();
    owner.extend(["--pause", "synccommit:12", "--after-loss", "exit", "--pg-options", "-c synchronous_commit=local"]);
    let o = run_scenario(
        db,
        &Scenario {
            owner,
            standby: vec!["--lease-ms", "3000", "--renew-ms", "500", "--strategy", "pidlist", "--pg-options", "-c synchronous_commit=local"],
            owner_env: vec![],
            standby_env: vec![],
            stop_on: Some("synccommit"),
            cap: Duration::from_secs(10),
            before: vec!["ALTER SYSTEM SET synchronous_standby_names = 'phantom'", "SELECT pg_reload_conf()"],
        },
    );
    db.batch_execute("ALTER SYSTEM RESET synchronous_standby_names").unwrap();
    db.batch_execute("SELECT pg_reload_conf()").unwrap();
    let id = o.paused_line.as_deref().and_then(|l| kv(l, "id")).unwrap_or("").to_string();
    let row = db
        .query_opt(
            "SELECT pg_xact_commit_timestamp(s.xmin)::text, (pg_xact_commit_timestamp(s.xmin) < (SELECT pg_xact_commit_timestamp(xmin) FROM _takeovers WHERE token = $2)) \
             FROM _sessions s WHERE id = $1",
            &[&id, &o.new_token],
        )
        .unwrap();
    let failed = o.owner.lines("COMMIT_FAILED").into_iter().find(|l| l.contains("kind=session")).unwrap_or_default();
    // The paused row legitimately exists here, so check commit order directly
    // rather than with late_commit_check's "paused row absent" clause.
    let late: i64 = db
        .query_one(
            "SELECT (SELECT count(*) FROM _sessions WHERE minted_by_token < $1 AND pg_xact_commit_timestamp(xmin) > t.ts) + \
                    (SELECT count(*) FROM _log WHERE owner_token < $1 AND pg_xact_commit_timestamp(xmin) > t.ts) \
             FROM (SELECT pg_xact_commit_timestamp(xmin) AS ts FROM _takeovers WHERE token = $1) t",
            &[&o.new_token],
        )
        .map(|r| r.get(0))
        .unwrap_or(-1);
    let within = o.took_over_after_stop.is_some_and(|d| d <= bound());
    r.pass(
        "W9",
        "commit-in-flight-at-termination",
        within && late == 0,
        format!(
            "took_over_after_stop={:?} ms; old-owner commits after takeover={late}; the in-flight row {id}: {}; old owner saw: {}",
            o.took_over_after_stop.map(ms),
            row.map_or("ABSENT (rolled back)".to_string(), |r| format!("PRESENT, committed at {} before-takeover={}", r.get::<_, String>(0), r.get::<_, bool>(1))),
            failed
        ),
    );
}

fn w10(db: &mut Client, r: &mut Results) {
    log("=== W10 lock order: the adapter takes _head FOR UPDATE first today; what if the fence comes second?");
    for order in ["fence-first", "head-first"] {
        reset(db);
        let mut owner = connect("sb_core", "w10-owner-tx", "").unwrap();
        let mut take = connect("sb_core", "w10-takeover", "").unwrap();
        owner.batch_execute("BEGIN").unwrap();
        if order == "fence-first" {
            owner.query_one("SELECT token FROM _owner WHERE singleton FOR SHARE", &[]).unwrap();
        }
        owner.query_one("SELECT seq FROM _head WHERE singleton FOR UPDATE", &[]).unwrap();
        // The takeover transaction (as in node.rs): _owner FOR UPDATE, then _head.
        let h = thread::spawn(move || {
            let t0 = Instant::now();
            let res = (|| -> Result<(), postgres::Error> {
                take.batch_execute("BEGIN; SET LOCAL lock_timeout = 5000")?;
                take.query_one("SELECT token FROM _owner WHERE singleton FOR UPDATE", &[])?;
                take.execute("UPDATE _owner SET token = token + 1", &[])?;
                take.execute("UPDATE _head SET owner_token = 1", &[])?;
                take.batch_execute("COMMIT")
            })();
            format!("{} after {} ms", res.map(|_| "committed".to_string()).unwrap_or_else(|e| err_str(&e)), ms(t0.elapsed()))
        });
        thread::sleep(Duration::from_millis(300));
        let t0 = Instant::now();
        let mine = if order == "head-first" {
            owner
                .query_one("SELECT token FROM _owner WHERE singleton FOR SHARE", &[])
                .map(|row| format!("fence read token={}", row.get::<_, i64>(0)))
                .unwrap_or_else(|e| err_str(&e))
        } else {
            "fence already held".to_string()
        };
        let mine = format!("{mine} after {} ms", ms(t0.elapsed()));
        let _ = owner.batch_execute("ROLLBACK");
        let theirs = h.join().unwrap();
        log(&format!("{order}: owner tx: {mine}; takeover tx: {theirs}"));
        let deadlock = mine.contains("40P01") || theirs.contains("40P01");
        r.add("W10", order, if deadlock { "DEADLOCK" } else { "NO-DEADLOCK" }, format!("owner tx: {mine}; takeover tx: {theirs}"));
    }
}

// ------------------------------------------------- W11: the step-2 lease claim
//
// §5.2 revision 5: takeover runs in one transaction and, before terminating
// anything, claims the expired lease with a no-op UPDATE (FOR NO KEY UPDATE)
// that the owner's renewal conflicts with but its FOR KEY SHARE fences do not.
// All W11 owners and standbys fence with FOR KEY SHARE, as §5.1 specifies; the
// claim is only meaningful under KEY SHARE (under FOR SHARE the claim itself
// would wait on every in-flight fence).

fn spawn_owner(extra: &[&str]) -> Proc {
    let mut a = vec!["--role", "owner", "--holder", "A", "--quiet-renewals", "--lease-ms", "3000", "--renew-ms", "500", "--lock", "keyshare"];
    a.extend(extra);
    Proc::spawn("owner", &a, &[])
}

fn spawn_standby(name: &str, holder: &str, extra: &[&str]) -> Proc {
    let mut a = vec!["--role", "standby", "--holder", holder, "--after-loss", "exit", "--quiet-renewals", "--lease-ms", "3000", "--renew-ms", "500", "--lock", "keyshare"];
    a.extend(extra);
    Proc::spawn(name, &a, &[])
}

fn tagged_pids(db: &mut Client, tag: &str) -> Vec<i32> {
    db.query("SELECT pid FROM pg_stat_activity WHERE application_name = $1 ORDER BY pid", &[&tag]).unwrap().iter().map(|r| r.get(0)).collect()
}

fn alive_of(db: &mut Client, pids: &[i32]) -> Vec<i32> {
    db.query("SELECT pid FROM pg_stat_activity WHERE pid = ANY($1) ORDER BY pid", &[&pids]).unwrap().iter().map(|r| r.get(0)).collect()
}

/// Poll (superuser) until `_owner` shows `token` with an unexpired lease:
/// i.e. a renewal by that token's owner has committed.
fn wait_renewed(db: &mut Client, token: i64, timeout: Duration) -> Option<(Instant, String)> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let r = db.query_one("SELECT token, lease_until > clock_timestamp(), lease_until::text FROM _owner", &[]).unwrap();
        if r.get::<_, i64>(0) == token && r.get::<_, bool>(1) {
            let lu: String = r.get(2);
            log(&format!("renewal committed: token={token} lease_until={lu} (now in the future)"));
            return Some((Instant::now(), lu));
        }
        thread::sleep(Duration::from_millis(10));
    }
    None
}

/// The owner's lease-renewal statement, if it is currently waiting on a lock.
/// Returns (description, blocked_by_pid).
fn renewal_state(db: &mut Client, tag: &str, blocker: i32) -> (String, bool) {
    let rows = db
        .query(
            "SELECT pid, coalesce(wait_event_type || ':' || wait_event, '-'), pg_blocking_pids(pid), \
                    round(extract(epoch FROM clock_timestamp() - query_start) * 1000)::bigint \
             FROM pg_stat_activity WHERE application_name = $1 AND state = 'active' \
               AND query LIKE 'UPDATE _owner SET lease_until = clock_timestamp()%'",
            &[&tag],
        )
        .unwrap();
    match rows.first() {
        None => ("renewal not in flight".into(), false),
        Some(r) => {
            let (pid, w, bl, ms): (i32, String, Vec<i32>, i64) = (r.get(0), r.get(1), r.get(2), r.get(3));
            (format!("renewal pid={pid} wait={w} blocked_by={bl:?} waiting_for={ms}ms"), w.starts_with("Lock:") && bl.contains(&blocker))
        }
    }
}

fn server_log() -> PathBuf {
    let dir = std::env::var("PGFENCE_DIR").unwrap_or_else(|_| {
        format!("{}/pgfence-{}", std::env::var("TMPDIR").unwrap_or_else(|_| "/tmp".into()), std::env::var("USER").unwrap_or_default())
    });
    PathBuf::from(dir).join("server.log")
}

fn log_len() -> u64 {
    std::fs::metadata(server_log()).map(|m| m.len()).unwrap_or(0)
}

/// Server-log lines appended since `off` that record a backend terminated by
/// pg_terminate_backend ("terminating connection due to administrator command").
/// Independent of the node's own TERMINATE events.
fn admin_terminations_since(off: u64) -> Vec<String> {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(server_log()) else { return vec!["<server.log unreadable>".into()] };
    let _ = f.seek(SeekFrom::Start(off));
    let mut buf = String::new();
    let _ = f.read_to_string(&mut buf);
    buf.lines().filter(|l| l.contains("terminating connection due to administrator command")).map(String::from).collect()
}

fn w11a(db: &mut Client, r: &mut Results) {
    log("=== W11a renewal commits between the standby's poll (step 1) and its claim (step 2)");
    reset(db);
    let mut owner = spawn_owner(&["--pause", "session:12:10000", "--after-loss", "probe"]);
    owner.wait_ev("REGISTERED", Duration::from_secs(10)).expect("owner registered");
    let mut standby = spawn_standby("standby", "B", &["--strategy", "claim", "--hold", "after_poll"]);
    standby.wait_ev("STANDBY_WAITING", Duration::from_secs(10)).expect("standby waiting");
    let (_, paused) = owner.wait_for(|l| l.starts_with("PAUSING ") && l.contains("kind=session "), Duration::from_secs(15)).expect("pause");
    owner.sig(libc::SIGSTOP, "SIGSTOP (lets the lease lapse; the owner stays inside a fenced session tx)");
    if standby.wait_hold("after_poll", Duration::from_secs(10)).is_none() {
        r.pass("W11a", "renewal-between-poll-and-claim", false, "standby never observed the expiry".into());
        return;
    }
    let before = tagged_pids(db, "sb-owner:A:1");
    let off = log_len();
    owner.sig(libc::SIGCONT, "SIGCONT (the owner's lease thread renews at once)");
    let renewed = wait_renewed(db, 1, Duration::from_secs(3));
    activity(db, "renewal committed; standby held after step 1, before step 2");
    standby.release("after_poll");
    let claim = standby.wait_ev("CLAIM", Duration::from_secs(5)).map(|x| x.1).unwrap_or_default();
    let aborted = standby.wait_ev("TAKEOVER_ABORTED", Duration::from_secs(2)).map(|x| x.1).unwrap_or_default();
    thread::sleep(Duration::from_millis(1500));
    standby.drain();
    let after = alive_of(db, &before);
    // The paused fenced tx (whose backend would have been the step-4 victim) finishes and commits.
    let resumed = owner.wait_ev("RESUMED", Duration::from_secs(10)).is_some();
    thread::sleep(Duration::from_millis(500));
    owner.drain();
    standby.drain();
    let id = kv(&paused, "id").unwrap_or("").to_string();
    let committed: i64 = db.query_one("SELECT count(*) FROM _sessions WHERE id = $1", &[&id]).unwrap().get(0);
    let token: i64 = db.query_one("SELECT token FROM _owner", &[]).unwrap().get(0);
    let terms = standby.lines("TERMINATE");
    let logged = admin_terminations_since(off);
    let lost = owner.lines("LOST");
    let ok = renewed.is_some()
        && claim.contains("rows=0")
        && aborted.contains("claim_zero_rows")
        && terms.is_empty()
        && logged.is_empty()
        && before.len() >= 3
        && after == before
        && lost.is_empty()
        && resumed
        && committed == 1
        && token == 1
        && standby.lines("TOOK_OVER").is_empty();
    r.pass(
        "W11a",
        "renewal-between-poll-and-claim",
        ok,
        format!(
            "renewal_committed_before_claim={} | standby: {claim} ; {aborted} | standby TERMINATE events={} | server-log terminations in window={} | \
             owner backends before={before:?} after={after:?} | owner LOST={lost:?} | paused fenced tx resumed={resumed} committed={committed} | _owner.token={token}",
            renewed.as_ref().map_or("NO".to_string(), |x| format!("yes lease_until={}", x.1)),
            terms.len(),
            logged.len()
        ),
    );
}

fn w11c(db: &mut Client, r: &mut Results) {
    log("=== W11c the same race under revision 3/4's unlocked re-read (strategy reread)");
    reset(db);
    let mut owner = spawn_owner(&["--pause", "session:12:10000", "--after-loss", "probe"]);
    owner.wait_ev("REGISTERED", Duration::from_secs(10)).expect("owner registered");
    let mut standby = spawn_standby("standby", "B", &["--strategy", "reread", "--hold", "after_reread", "--takeover-lock-timeout-ms", "10000"]);
    standby.wait_ev("STANDBY_WAITING", Duration::from_secs(10)).expect("standby waiting");
    let (_, paused) = owner.wait_for(|l| l.starts_with("PAUSING ") && l.contains("kind=session "), Duration::from_secs(15)).expect("pause");
    let paused_pid: i32 = kv(&paused, "pid").unwrap().parse().unwrap();
    owner.sig(libc::SIGSTOP, "SIGSTOP");
    let Some((_, reread)) = standby.wait_hold("after_reread", Duration::from_secs(10)) else {
        r.add("W11c", "renewal-after-unlocked-reread", "NOT-REPRODUCED", "the reread watcher never reached its hold".into());
        return;
    };
    let _ = reread;
    let before = tagged_pids(db, "sb-owner:A:1");
    let off = log_len();
    owner.sig(libc::SIGCONT, "SIGCONT (the owner renews while the standby's FOR UPDATE waits)");
    let renewed = wait_renewed(db, 1, Duration::from_secs(3));
    activity(db, "renewal committed after the standby's unlocked re-read; FOR UPDATE still waiting");
    standby.release("after_reread");
    let term = standby.wait_ev("TERMINATE", Duration::from_secs(3)).map(|x| x.1).unwrap_or_default();
    let aborted = standby.wait_ev("TAKEOVER_ABORTED", Duration::from_secs(5)).map(|x| x.1).unwrap_or_default();
    let failed = owner.wait_ev("COMMIT_FAILED", Duration::from_secs(12)).map(|x| x.1).unwrap_or_default();
    thread::sleep(Duration::from_millis(300));
    owner.drain();
    standby.drain();
    let after = alive_of(db, &before);
    let logged = admin_terminations_since(off);
    let terms = standby.lines("TERMINATE");
    let killed_owner_pids: Vec<i32> = terms.iter().filter(|l| l.contains("ok=true")).filter_map(|l| kv(l, "pid").and_then(|p| p.parse().ok())).filter(|p| before.contains(p)).collect();
    let reproduced = renewed.is_some() && !killed_owner_pids.is_empty();
    r.add(
        "W11c",
        "renewal-after-unlocked-reread",
        if reproduced { "HAZARD-REPRODUCED" } else { "NOT-REPRODUCED" },
        format!(
            "renewal committed after the re-read and before termination={} | standby: {term} ; {aborted} | live-owner backends terminated={killed_owner_pids:?} (paused fenced tx pid={paused_pid}) | \
             server-log terminations in window={} | owner backends before={before:?} after={after:?} | owner: {failed} ; LOST={:?}",
            renewed.as_ref().map_or("NO".to_string(), |x| format!("yes lease_until={}", x.1)),
            logged.len(),
            owner.lines("LOST")
        ),
    );
}

fn w11bd(db: &mut Client, r: &mut Results, hygiene: &'static str) {
    log(&format!("=== W11b/W11d claim first, then the owner's renewal and fences (hygiene={hygiene})"));
    reset(db);
    let mut owner = spawn_owner(&["--pause", "session:12:10000", "--after-loss", "probe"]);
    owner.wait_ev("REGISTERED", Duration::from_secs(10)).expect("owner registered");
    let mut standby = spawn_standby("standby", "B", &["--strategy", "claim", "--hold", "after_claim", "--hygiene", hygiene]);
    let (_, wl) = standby.wait_ev("STANDBY_WAITING", Duration::from_secs(10)).expect("standby waiting");
    let standby_pid: i32 = kv(&wl, "pid").unwrap().parse().unwrap();
    let (_, paused) = owner.wait_for(|l| l.starts_with("PAUSING ") && l.contains("kind=session "), Duration::from_secs(15)).expect("pause");
    owner.sig(libc::SIGSTOP, "SIGSTOP");
    if standby.wait_hold("after_claim", Duration::from_secs(10)).is_none() {
        r.pass("W11b", &format!("claim-then-renewal/hygiene-{hygiene}"), false, format!("no claim: {:?}", standby.lines("CLAIM")));
        return;
    }
    let claim_at = standby.lines("CLAIM").last().and_then(|l| kv(l, "db_at").map(|s| s.replace('T', " "))).unwrap_or_default();
    let t_cont = owner.sig(libc::SIGCONT, "SIGCONT (claim held: renewal should block, fences should not)");
    thread::sleep(Duration::from_millis(200));
    // W11d: fenced transactions on a separate same-role connection while the claim is held.
    let mut probe = connect("sb_core", "w11d-probe-fence", "").unwrap();
    let mut lat_us = vec![];
    let mut toks = vec![];
    for _ in 0..20 {
        let t0 = Instant::now();
        probe.batch_execute("BEGIN").unwrap();
        let tok: i64 = probe.query_one("SELECT token FROM _owner WHERE singleton FOR KEY SHARE", &[]).unwrap().get(0);
        probe.batch_execute("COMMIT").unwrap();
        lat_us.push(t0.elapsed().as_micros() as u64);
        toks.push(tok);
        thread::sleep(Duration::from_millis(25));
    }
    drop(probe);
    thread::sleep(Duration::from_millis(300));
    let (rstate, rblocked) = renewal_state(db, "sb-owner:A:1", standby_pid);
    log(&format!("while the claim is held: {rstate}"));
    activity(db, "claim held by the standby; owner resumed");
    let during: i64 = db
        .query_one(
            "SELECT (SELECT count(*) FROM _log WHERE owner_token = 1 AND pg_xact_commit_timestamp(xmin) > $1::text::timestamptz) + \
                    (SELECT count(*) FROM _sessions WHERE minted_by_token = 1 AND pg_xact_commit_timestamp(xmin) > $1::text::timestamptz)",
            &[&claim_at],
        )
        .unwrap()
        .get(0);
    let t_rel = standby.release("after_claim");
    let hold_ms = ms(t_rel.saturating_duration_since(t_cont));
    let took = standby.wait_ev("TOOK_OVER", Duration::from_secs(10));
    let release_to_takeover = took.as_ref().map(|(at, _)| ms(at.saturating_duration_since(t_rel)));
    let renewal = owner.wait_ev("RENEWAL", Duration::from_secs(5)).map(|x| x.1).unwrap_or_default();
    thread::sleep(Duration::from_millis(1000));
    let _ = owner.wait_exit(Duration::from_secs(15));
    standby.drain();
    let new_token = took.as_ref().and_then(|(_, l)| kv(l, "token")).and_then(|t| t.parse().ok()).unwrap_or(0);
    let ids: Vec<String> = kv(&paused, "id").into_iter().map(String::from).collect();
    let check = late_commit_check(db, new_token, &ids, None);
    let renewal_ms: u128 = kv(&renewal, "took_ms").and_then(|v| v.parse().ok()).unwrap_or(0);
    let renewed_after_claim = owner.lines("RENEWED");
    let expect_rows = if hygiene == "loop" { "rows=error" } else { "rows=0" };
    let ok_b = rblocked && renewal.contains(expect_rows) && renewal_ms >= hold_ms.saturating_sub(300) && renewed_after_claim.is_empty() && took.is_some() && check.ok;
    r.pass(
        "W11b",
        &format!("claim-then-renewal/hygiene-{hygiene}"),
        ok_b,
        format!(
            "during claim: {rstate} | owner renewal outcome: {renewal} (claim held {hold_ms} ms after SIGCONT; expected {expect_rows}) | RENEWED lines={renewed_after_claim:?} | \
             takeover {} ms after release, standby {:?} | {}",
            release_to_takeover.map_or("NEVER".into(), |m| m.to_string()),
            standby.lines("FOR_UPDATE"),
            check.summary
        ),
    );
    if hygiene == "after" {
        let max = lat_us.iter().max().copied().unwrap_or(0);
        let mean = lat_us.iter().sum::<u64>() as f64 / lat_us.len().max(1) as f64;
        let ok_d = toks.iter().all(|t| *t == 1) && max < 100_000 && during > 0 && took.is_some() && check.ok;
        r.pass(
            "W11d",
            "fences-flow-during-claim",
            ok_d,
            format!(
                "{} probe fences (FOR KEY SHARE) while the claim was held: all granted, token read={:?}, mean {:.0} us, max {} us | \
                 owner fenced commits with token 1 after the claim and before release={during} | claim held {hold_ms} ms after SIGCONT | \
                 release -> takeover commit {} ms ({:?}, terminations {:?}) | old-token commits after takeover: see W11b",
                lat_us.len(),
                toks.iter().collect::<std::collections::BTreeSet<_>>(),
                mean,
                max,
                release_to_takeover.map_or("NEVER".into(), |m| m.to_string()),
                standby.lines("FOR_UPDATE"),
                standby.lines("TERMINATE").len()
            ),
        );
    }
}

fn w11e(db: &mut Client, r: &mut Results) {
    log("=== W11e savepoint retention: force 55P03 in step 3; the claim must survive ROLLBACK TO SAVEPOINT");
    reset(db);
    db.batch_execute("UPDATE _owner SET token = 1, holder = 'A', lease_until = clock_timestamp() - interval '1 s'").unwrap();
    // A blocker the standby will not terminate (same role, not owner-tagged), so step 3 times out.
    let mut blocker = connect("sb_core", "w11e-untagged-blocker", "").unwrap();
    blocker.batch_execute("BEGIN").unwrap();
    blocker.query_one("SELECT token FROM _owner WHERE singleton FOR KEY SHARE", &[]).unwrap();
    let mut standby = spawn_standby("standby", "B", &["--strategy", "claim", "--hold", "after_claim,after_savepoint_rollback", "--takeover-lock-timeout-ms", "300"]);
    let (_, wl) = standby.wait_ev("STANDBY_WAITING", Duration::from_secs(10)).expect("standby waiting");
    let standby_pid: i32 = kv(&wl, "pid").unwrap().parse().unwrap();
    if standby.wait_hold("after_claim", Duration::from_secs(5)).is_none() {
        r.pass("W11e", "savepoint-retention", false, format!("no claim: {:?}", standby.lines("CLAIM")));
        return;
    }
    // A renewal by the (token 1) owner, issued after the claim.
    let mut ren = connect("sb_core", "w11e-renewal", "").unwrap();
    let ren_h = thread::spawn(move || {
        let t0 = Instant::now();
        let res = ren
            .execute("UPDATE _owner SET lease_until = clock_timestamp() + interval '3 s' WHERE singleton AND token = 1", &[])
            .map(|n| format!("rows={n}"))
            .unwrap_or_else(|e| format!("error {}", err_str(&e)));
        (Instant::now(), ms(t0.elapsed()), res)
    });
    thread::sleep(Duration::from_millis(300));
    let renewal_tag = "w11e-renewal";
    let state = |db: &mut Client| -> (String, bool) {
        let r = db
            .query_opt(
                "SELECT coalesce(wait_event_type || ':' || wait_event, '-'), pg_blocking_pids(pid), state FROM pg_stat_activity WHERE application_name = $1",
                &[&renewal_tag],
            )
            .unwrap();
        match r {
            None => ("renewal connection gone".into(), false),
            Some(r) => {
                let (w, bl, st): (String, Vec<i32>, String) = (r.get(0), r.get(1), r.get(2));
                (format!("renewal state={st} wait={w} blocked_by={bl:?}"), st == "active" && w.starts_with("Lock:") && bl.contains(&standby_pid))
            }
        }
    };
    let (s0, b0) = state(db);
    log(&format!("after the claim: {s0}"));
    standby.release("after_claim");
    let held2 = standby.wait_hold("after_savepoint_rollback", Duration::from_secs(5));
    // The standby now sits idle in its transaction right after 55P03 + ROLLBACK TO SAVEPOINT.
    let (s1, b1) = state(db);
    let sb = db
        .query_one(
            "SELECT coalesce(state, ''), coalesce(backend_xid::text, '-'), (SELECT xmax::text FROM fence._owner) FROM pg_stat_activity WHERE pid = $1",
            &[&standby_pid],
        )
        .unwrap();
    let (sb_state, sb_xid, row_xmax): (String, String, String) = (sb.get(0), sb.get(1), sb.get(2));
    // With a key-share locker present when the claim updated the row, the
    // committed version's xmax is a MultiXactId; expand it. (The first W11e run
    // compared xmax to the xid directly and failed on that harness assumption.)
    let members = db
        .query_one("SELECT coalesce(string_agg(xid::text || ':' || mode, ','), '') FROM pg_get_multixact_members($1::text::xid)", &[&row_xmax])
        .map(|r| r.get::<_, String>(0))
        .unwrap_or_else(|e| format!("not-a-multixact({})", err_str(&e)));
    let claim_lock_owned = row_xmax == sb_xid || members.split(',').any(|m| m == format!("{sb_xid}:nokeyupd"));
    let mut pr = connect("sb_core", "w11e-probe", "").unwrap();
    pr.batch_execute("SET lock_timeout = 300").unwrap();
    let probe = pr
        .execute("UPDATE _owner SET lease_until = lease_until WHERE singleton", &[])
        .map(|n| format!("UPDATED({n}) -- claim lost"))
        .unwrap_or_else(|e| err_str(&e));
    log(&format!("after ROLLBACK TO SAVEPOINT: {s1}; standby state={sb_state} xid={sb_xid}; committed _owner row xmax={row_xmax} multixact members=[{members}]; probe update: {probe}"));
    activity(db, "standby idle in tx after 55P03 + ROLLBACK TO SAVEPOINT");
    standby.release("after_savepoint_rollback");
    thread::sleep(Duration::from_millis(1200));
    standby.drain();
    let (s2, b2) = state(db);
    log(&format!("after further step-3 timeouts: {s2}"));
    let timeouts_before_release = standby.lines("LOCK_TIMEOUT").len();
    let t_commit = Instant::now();
    blocker.batch_execute("COMMIT").unwrap();
    let took = standby.wait_ev("TOOK_OVER", Duration::from_secs(5));
    let (ren_end, ren_ms, ren_res) = ren_h.join().unwrap();
    standby.drain();
    let ren_after_takeover = took.as_ref().is_some_and(|(at, _)| ren_end + Duration::from_millis(50) >= *at) && ren_end >= t_commit;
    let ok = held2.is_some() && timeouts_before_release >= 2 && b0 && b1 && b2 && probe.starts_with("55P03") && claim_lock_owned && ren_res == "rows=0" && ren_after_takeover && took.is_some();
    r.pass(
        "W11e",
        "savepoint-retention",
        ok,
        format!(
            "step-3 55P03 count before the blocker released={timeouts_before_release} | after claim: {s0} | after ROLLBACK TO SAVEPOINT: {s1}; standby {sb_state} xid={sb_xid}, committed _owner xmax={row_xmax} members=[{members}] (claim lock owned by the standby's top-level xid={claim_lock_owned}); \
             concurrent probe UPDATE: {probe} | after more timeouts: {s2} | renewal finished {ren_res} after {ren_ms} ms, after the takeover commit={ren_after_takeover} | {:?}",
            standby.lines("FOR_UPDATE")
        ),
    );
}

fn w11f(db: &mut Client, r: &mut Results) {
    log("=== W11f two standbys racing with the claim strategy (deterministic interleaving)");
    reset(db);
    let mut owner = spawn_owner(&["--pause", "session:12:10000", "--after-loss", "probe"]);
    owner.wait_ev("REGISTERED", Duration::from_secs(10)).expect("owner registered");
    let mut b = spawn_standby("standbyB", "B", &["--strategy", "claim", "--hold", "after_poll,after_claim"]);
    b.wait_ev("STANDBY_WAITING", Duration::from_secs(10)).expect("B waiting");
    let mut c = spawn_standby("standbyC", "C", &["--strategy", "claim", "--hold", "after_poll,after_claim", "--claim-lock-timeout-ms", "5000"]);
    let (_, cw) = c.wait_ev("STANDBY_WAITING", Duration::from_secs(10)).expect("C waiting");
    let c_pid: i32 = kv(&cw, "pid").unwrap().parse().unwrap();
    let b_pid: i32 = kv(&b.lines("STANDBY_WAITING")[0], "pid").unwrap().parse().unwrap();
    let (_, paused) = owner.wait_for(|l| l.starts_with("PAUSING ") && l.contains("kind=session "), Duration::from_secs(15)).expect("pause");
    owner.sig(libc::SIGSTOP, "SIGSTOP");
    let hb = b.wait_hold("after_poll", Duration::from_secs(10)).is_some();
    let hc = c.wait_hold("after_poll", Duration::from_secs(10)).is_some();
    b.release("after_poll");
    let bclaim = b.wait_hold("after_claim", Duration::from_secs(5)).is_some();
    c.release("after_poll");
    thread::sleep(Duration::from_millis(500));
    let row = db
        .query_one("SELECT coalesce(wait_event_type || ':' || wait_event, '-'), pg_blocking_pids(pid), left(query, 40) FROM pg_stat_activity WHERE pid = $1", &[&c_pid])
        .unwrap();
    let (cw_ev, c_bl, c_q): (String, Vec<i32>, String) = (row.get(0), row.get(1), row.get(2));
    let c_blocked = cw_ev.starts_with("Lock:") && c_bl.contains(&b_pid);
    log(&format!("C's claim while B holds its claim: wait={cw_ev} blocked_by={c_bl:?} (B={b_pid}) query={c_q}"));
    b.release("after_claim");
    let took = b.wait_ev("TOOK_OVER", Duration::from_secs(10));
    let cclaim = c.wait_ev("CLAIM", Duration::from_secs(6)).map(|x| x.1).unwrap_or_default();
    thread::sleep(Duration::from_millis(300));
    let b_tag = owner_tag("B", 2);
    let b_before = tagged_pids(db, &b_tag);
    thread::sleep(Duration::from_millis(2000));
    b.drain();
    c.drain();
    let b_after = alive_of(db, &b_before);
    owner.sig(libc::SIGCONT, "SIGCONT");
    let _ = owner.wait_exit(Duration::from_secs(15));
    let ids: Vec<String> = kv(&paused, "id").into_iter().map(String::from).collect();
    let check = late_commit_check(db, 2, &ids, None);
    let takeovers: Vec<String> = db.query("SELECT token::text || ':' || holder FROM _takeovers ORDER BY token", &[]).unwrap().iter().map(|r| r.get(0)).collect();
    let c_terms = c.lines("TERMINATE");
    let ok = hb && hc && bclaim && c_blocked && took.is_some() && cclaim.contains("rows=0") && c_terms.is_empty() && !b_before.is_empty() && b_after == b_before && b.lines("LOST").is_empty() && c.lines("TOOK_OVER").is_empty() && check.ok;
    r.pass(
        "W11f",
        "two-standbys/deterministic",
        ok,
        format!(
            "C's claim blocked behind B's claim={c_blocked} (wait={cw_ev} blocked_by={c_bl:?}) | C: {cclaim} | C TERMINATE events={} | B ({b_tag}) backends before={b_before:?} after 2 s={b_after:?} | \
             B LOST={:?} | _takeovers={takeovers:?} | B terminations={} | {}",
            c_terms.len(),
            b.lines("LOST"),
            b.lines("TERMINATE").len(),
            check.summary
        ),
    );
    drop(b);
    drop(c);
    drop(owner);

    for round in 1..=3 {
        log(&format!("=== W11f free race, round {round}: two claim standbys released together, no holds"));
        reset(db);
        let mut owner = spawn_owner(&["--pause", "session:12:10000", "--after-loss", "probe"]);
        owner.wait_ev("REGISTERED", Duration::from_secs(10)).expect("owner registered");
        let mut b = spawn_standby("standbyB", "B", &["--strategy", "claim"]);
        let mut c = spawn_standby("standbyC", "C", &["--strategy", "claim"]);
        b.wait_ev("STANDBY_WAITING", Duration::from_secs(10)).expect("B");
        c.wait_ev("STANDBY_WAITING", Duration::from_secs(10)).expect("C");
        let (_, paused) = owner.wait_for(|l| l.starts_with("PAUSING ") && l.contains("kind=session "), Duration::from_secs(15)).expect("pause");
        owner.sig(libc::SIGSTOP, "SIGSTOP");
        let deadline = Instant::now() + Duration::from_secs(8);
        while Instant::now() < deadline && b.lines("TOOK_OVER").is_empty() && c.lines("TOOK_OVER").is_empty() {
            b.drain();
            c.drain();
            thread::sleep(Duration::from_millis(20));
        }
        thread::sleep(Duration::from_millis(300));
        b.drain();
        c.drain();
        let (winner, loser, wh) = if !b.lines("TOOK_OVER").is_empty() { (&mut b, &mut c, "B") } else { (&mut c, &mut b, "C") };
        let tag = owner_tag(wh, 2);
        let wbefore = tagged_pids(db, &tag);
        thread::sleep(Duration::from_millis(1500));
        winner.drain();
        loser.drain();
        let wafter = alive_of(db, &wbefore);
        let lterms = loser.lines("TERMINATE");
        let lclaims = loser.lines("CLAIM");
        let wins = winner.lines("TOOK_OVER").len() + loser.lines("TOOK_OVER").len();
        owner.sig(libc::SIGCONT, "SIGCONT");
        let _ = owner.wait_exit(Duration::from_secs(15));
        let ids: Vec<String> = kv(&paused, "id").into_iter().map(String::from).collect();
        let check = late_commit_check(db, 2, &ids, None);
        let ok = wins == 1 && lterms.is_empty() && !wbefore.is_empty() && wafter == wbefore && check.ok;
        r.pass(
            "W11f",
            &format!("two-standbys/free-race-{round}"),
            ok,
            format!(
                "winner={wh} takeovers={wins} | loser claims={lclaims:?} loser LEASE_EXPIRED={} loser TERMINATE={} | winner backends before={wbefore:?} after 1.5 s={wafter:?} | {}",
                loser.lines("LEASE_EXPIRED").len(),
                lterms.len(),
                check.summary
            ),
        );
    }
}

/// W8a's lock matrix, extended with the step-2 claim.
fn w8_claim_matrix(db: &mut Client, r: &mut Results) {
    log("=== W8a-claim lock matrix with the claim (KEY SHARE fences)");
    reset(db);
    let try_ = |c: &mut Client, sql: &str| -> String {
        let t0 = Instant::now();
        match c.query(sql, &[]) {
            Ok(rows) => format!("ok({} rows) {} ms", rows.len(), ms(t0.elapsed())),
            Err(e) => format!("{} after {} ms", err_str(&e), ms(t0.elapsed())),
        }
    };
    let mut f1 = connect("sb_core", "w8c-fence-before-claim", "").unwrap();
    let mut f2 = connect("sb_core", "w8c-fence-during-claim", "").unwrap();
    let mut ren = connect("sb_core", "w8c-renewal", "").unwrap();
    let mut tk = connect("sb_core", "w8c-takeover", "").unwrap();
    ren.batch_execute("SET lock_timeout = 1000").unwrap();
    f2.batch_execute("SET lock_timeout = 1000").unwrap();
    f1.batch_execute("BEGIN").unwrap();
    let a = try_(&mut f1, "SELECT token FROM _owner WHERE singleton FOR KEY SHARE");
    tk.batch_execute("BEGIN; SET LOCAL lock_timeout = 1000").unwrap();
    let claim = try_(&mut tk, "UPDATE _owner SET lease_until = lease_until WHERE singleton AND token = 0 AND lease_until < clock_timestamp() RETURNING token");
    let renew = try_(&mut ren, "UPDATE _owner SET lease_until = clock_timestamp() + interval '3 s' WHERE singleton AND token = 0");
    f2.batch_execute("BEGIN").unwrap();
    let fence2 = try_(&mut f2, "SELECT token FROM _owner WHERE singleton FOR KEY SHARE");
    tk.batch_execute("SAVEPOINT s3").unwrap();
    let fu1 = try_(&mut tk, "SELECT token FROM _owner WHERE singleton FOR UPDATE");
    tk.batch_execute("ROLLBACK TO SAVEPOINT s3").unwrap();
    let renew2 = try_(&mut ren, "UPDATE _owner SET lease_until = clock_timestamp() + interval '3 s' WHERE singleton AND token = 0");
    f1.batch_execute("COMMIT").unwrap();
    // Only the fence taken DURING the claim is still open: does FOR UPDATE wait for it?
    tk.batch_execute("SAVEPOINT s3").unwrap();
    let fu2 = try_(&mut tk, "SELECT token FROM _owner WHERE singleton FOR UPDATE");
    tk.batch_execute("ROLLBACK TO SAVEPOINT s3").unwrap();
    f2.batch_execute("COMMIT").unwrap();
    tk.batch_execute("SAVEPOINT s3").unwrap();
    let fu3 = try_(&mut tk, "SELECT token FROM _owner WHERE singleton FOR UPDATE");
    tk.batch_execute("UPDATE _owner SET token = token + 1; COMMIT").unwrap();
    ren.batch_execute("RESET lock_timeout").unwrap();
    let renew3 = try_(&mut ren, "UPDATE _owner SET lease_until = clock_timestamp() + interval '3 s' WHERE singleton AND token = 0 RETURNING 1");
    let rows = [
        ("fence before the claim", a.clone()),
        ("claim (no-op UPDATE) with that fence open", claim.clone()),
        ("renewal while the claim is held", renew.clone()),
        ("new fence while the claim is held", fence2.clone()),
        ("FOR UPDATE with both fences open", fu1.clone()),
        ("renewal after ROLLBACK TO SAVEPOINT", renew2.clone()),
        ("FOR UPDATE with only the during-claim fence open", fu2.clone()),
        ("FOR UPDATE with no fence open", fu3.clone()),
        ("renewal (token 0) after the takeover commits", renew3.clone()),
    ];
    for (k, v) in &rows {
        log(&format!("  {k:<52} {v}"));
    }
    let ok = claim.starts_with("ok(1")
        && renew.starts_with("55P03")
        && fence2.starts_with("ok(1")
        && fu1.starts_with("55P03")
        && renew2.starts_with("55P03")
        && fu2.starts_with("55P03")
        && fu3.starts_with("ok(1")
        && renew3.starts_with("ok(0");
    r.pass("W8", "lock-matrix/claim", ok, rows.iter().map(|(k, v)| format!("{k}: {v}")).collect::<Vec<_>>().join("; "));
}

fn w8_claim(db: &mut Client, r: &mut Results) {
    w8_claim_matrix(db, r);
    log("=== W8c-claim slow-but-alive owner (one 7 s fenced tx), KEY SHARE, claim standby");
    let mut owner = owner_base();
    owner.extend(["--lock", "keyshare", "--pause", "session:12:7000", "--after-loss", "exit"]);
    let mut o = run_scenario(
        db,
        &Scenario {
            owner,
            standby: vec!["--lease-ms", "3000", "--renew-ms", "500", "--lock", "keyshare", "--strategy", "claim"],
            owner_env: vec![],
            standby_env: vec![],
            stop_on: Some(""),
            cap: Duration::from_secs(10),
            before: vec![],
        },
    );
    if o.took_over_after_stop.is_none() {
        let _ = o.owner.wait_ev("RESUMED", Duration::from_secs(10));
        thread::sleep(Duration::from_millis(1500));
        o.owner.drain();
    }
    o.standby.drain();
    let resumed = o.owner.lines("RESUMED").len();
    let id = o.owner.lines("PAUSING").first().and_then(|l| kv(l, "id").map(String::from)).unwrap_or_default();
    let committed: i64 = db.query_one("SELECT count(*) FROM _sessions WHERE id = $1", &[&id]).unwrap().get(0);
    let still_owner = resumed > 0 && o.owner.lines("LOST").is_empty();
    r.pass(
        "W8",
        "slow-owner/keyshare/claim",
        o.took_over_after_stop.is_none() && still_owner && committed == 1,
        format!(
            "takeover={} owner_resumed_and_still_serving={still_owner} slow-tx row committed={committed} | standby CLAIM={:?} TERMINATE={:?} | slow renewals={:?}",
            o.took_over_after_stop.map_or("none in 10 s".into(), |d| format!("after {} ms", ms(d))),
            o.standby.lines("CLAIM"),
            o.standby.lines("TERMINATE"),
            o.owner.lines("RENEWED")
        ),
    );
}

fn w10_claim(db: &mut Client, r: &mut Results) {
    log("=== W10-claim lock order against the claim takeover (KEY SHARE fence)");
    for order in ["fence-first", "head-first"] {
        reset(db);
        let mut owner = connect("sb_core", "w10c-owner-tx", "").unwrap();
        let mut take = connect("sb_core", "w10c-takeover", "").unwrap();
        owner.batch_execute("BEGIN").unwrap();
        if order == "fence-first" {
            owner.query_one("SELECT token FROM _owner WHERE singleton FOR KEY SHARE", &[]).unwrap();
        }
        owner.query_one("SELECT seq FROM _head WHERE singleton FOR UPDATE", &[]).unwrap();
        let h = thread::spawn(move || {
            let t0 = Instant::now();
            let res = (|| -> Result<(), postgres::Error> {
                take.batch_execute("BEGIN; SET LOCAL lock_timeout = 5000")?;
                take.query_one("UPDATE _owner SET lease_until = lease_until WHERE singleton AND token = 0 AND lease_until < clock_timestamp() RETURNING token", &[])?;
                take.batch_execute("SAVEPOINT s3")?;
                take.query_one("SELECT token FROM _owner WHERE singleton FOR UPDATE", &[])?;
                take.execute("UPDATE _owner SET token = token + 1", &[])?;
                take.execute("UPDATE _head SET owner_token = 1", &[])?;
                take.batch_execute("COMMIT")
            })();
            format!("{} after {} ms", res.map(|_| "committed".to_string()).unwrap_or_else(|e| err_str(&e)), ms(t0.elapsed()))
        });
        thread::sleep(Duration::from_millis(300));
        let t0 = Instant::now();
        let mine = if order == "head-first" {
            owner
                .query_one("SELECT token FROM _owner WHERE singleton FOR KEY SHARE", &[])
                .map(|row| format!("fence read token={}", row.get::<_, i64>(0)))
                .unwrap_or_else(|e| err_str(&e))
        } else {
            "fence already held".to_string()
        };
        let mine = format!("{mine} after {} ms", ms(t0.elapsed()));
        let _ = owner.batch_execute("ROLLBACK");
        let theirs = h.join().unwrap();
        log(&format!("{order}: owner tx: {mine}; claim takeover tx: {theirs}"));
        let deadlock = mine.contains("40P01") || theirs.contains("40P01");
        r.add("W10", &format!("{order}/claim"), if deadlock { "DEADLOCK" } else { "NO-DEADLOCK" }, format!("owner tx: {mine}; takeover tx: {theirs}"));
    }
}

fn main() {
    START.get_or_init(Instant::now);
    let which: Vec<String> = std::env::args().skip(1).collect();
    let which: Vec<&str> = if which.is_empty() || which.iter().any(|w| w == "all") {
        vec!["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9", "w10"]
    } else {
        which
            .iter()
            .flat_map(|s| match s.as_str() {
                "w11" => vec!["w11a", "w11b", "w11c", "w11e", "w11f"],
                "claim-reruns" => vec!["w2claim", "w3claim", "w8claim", "w10claim"],
                other => vec![other],
            })
            .collect()
    };
    let mut db = su();
    let v: String = db.query_one("SELECT version()", &[]).unwrap().get(0);
    log(&format!("server: {v}"));
    let mut r = Results(vec![]);
    for w in which {
        match w {
            "w1" => w1(&mut db, &mut r),
            "w2" => w2(&mut db, &mut r, "share", "W2"),
            "w3" => w3(&mut db, &mut r),
            "w4" => w4(&mut db, &mut r),
            "w5" => w5(&mut db, &mut r),
            "w6" => w6(&mut db, &mut r),
            "w7" => w7(&mut db, &mut r),
            "w8" => w8(&mut db, &mut r),
            "w9" => w9(&mut db, &mut r),
            "w10" => w10(&mut db, &mut r),
            "w11a" => w11a(&mut db, &mut r),
            // W11b and W11d share one run (hygiene after commit), plus a W11b variant with hygiene in the loop.
            "w11b" | "w11d" => {
                w11bd(&mut db, &mut r, "after");
                w11bd(&mut db, &mut r, "loop");
            }
            "w11c" => w11c(&mut db, &mut r),
            "w11e" => w11e(&mut db, &mut r),
            "w11f" => w11f(&mut db, &mut r),
            "w2claim" => w2_with(&mut db, &mut r, "keyshare", "W2", "claim"),
            "w3claim" => w3_with(&mut db, &mut r, &["claim", "claim-hygiene-off"], "keyshare"),
            "w8claim" => w8_claim(&mut db, &mut r),
            "w10claim" => w10_claim(&mut db, &mut r),
            other => panic!("unknown witness {other}"),
        }
    }
    reset(&mut db);
    println!("\n==================== SUMMARY ====================");
    for (w, c, v, _) in &r.0 {
        println!("{w:<4} {c:<44} {v}");
    }
}
