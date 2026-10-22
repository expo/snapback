//! The closed-loop timing driver, network settings and Postgres collectors
//! shared by every cell.
use crate::proxy::Proxy;
use postgres::{Client, NoTls};
use serde_json::{Value as Json, json};
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Barrier,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

/// Every measured connection carries this application_name so the
/// wait-event sampler can tell it from the admin and sampler sessions.
pub const APP: &str = "sb4cp";

pub fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("set {name} (source the env file printed by scripts/cluster.sh start)"))
}

/// Direct Unix-socket connection for setup, WAL LSNs and sampling. Never
/// routed through the proxy, never measured.
pub fn admin() -> Client {
    let url = if std::env::var_os("CP_TUNNEL_PORTS").is_some() { tunnel_url("sb4cp_admin") } else { env("PG_UNIX_URL") };
    Client::connect(&url, NoTls).expect("admin connection")
}

/// A fresh, non-recycling allocation across ALL connections in this process,
/// including setup/admin/samplers. The runner serializes cell processes.
pub fn tunnel_url(application_name: &str) -> String {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let ports: Vec<u16> = env("CP_TUNNEL_PORTS").split(',').map(|s| s.parse().unwrap()).collect();
    let index = NEXT.fetch_add(1, Ordering::SeqCst);
    let port = ports.get(index).expect("tunnel pool exhausted; never share an SSH stream");
    // Never emit URLs: the runner reads the mode-600 password into PGPASSWORD.
    let password = env("PGPASSWORD").replace('\\', "\\\\").replace('\'', "\\'");
    format!("host=127.0.0.1 port={port} user=postgres dbname={} password='{password}' application_name={application_name}", env("PGDATABASE"))
}

/// A network setting: the Unix socket (reference) or the delay proxy in
/// front of Postgres's 127.0.0.1 port at a given round trip.
pub struct Net {
    pub label: String,
    pub rtt_us: Option<u64>,
    url: String,
    _proxy: Option<Proxy>,
}

impl Net {
    pub fn parse(label: &str) -> Net {
        if label == "rt5-external" {
            return Net { label: label.into(), rtt_us: None, url: env("RT5_CONNECTION"), _proxy: None };
        }
        if label == "tunnels" {
            return Net { label: label.into(), rtt_us: None, url: String::new(), _proxy: None };
        }
        if label == "unix" {
            return Net { label: label.into(), rtt_us: None, url: env("PG_UNIX_URL"), _proxy: None };
        }
        if label == "tcp" {
            // Direct loopback TCP, no proxy: separates TCP from proxy overhead.
            let (host, port) = env("PG_TCP_HOSTPORT").split_once(':').map(|(h, p)| (h.to_owned(), p.to_owned())).unwrap();
            return Net { label: label.into(), rtt_us: None, url: format!("host={host} port={port} user=sb4_eval dbname=postgres"), _proxy: None };
        }
        let rtt_us: u64 = label.strip_prefix("rtt").and_then(|s| s.parse().ok())
            .unwrap_or_else(|| panic!("network setting must be unix, tcp or rtt<microseconds>, got {label}"));
        let upstream = env("PG_TCP_HOSTPORT").parse().expect("PG_TCP_HOSTPORT");
        let proxy = Proxy::start(upstream, Duration::from_nanos(rtt_us * 500));
        Net { label: label.into(), rtt_us: Some(rtt_us), url: proxy.url(), _proxy: Some(proxy) }
    }

    pub fn url(&self) -> String {
        if self.label == "tunnels" { return tunnel_url(APP); }
        format!("{} application_name={APP}", self.url)
    }

    pub fn connect(&self) -> Client {
        Client::connect(&self.url(), NoTls).expect("measured connection")
    }

    pub fn describe(&self) -> Json {
        json!({"label": self.label, "proxy": self.rtt_us.is_some(), "added_rtt_us": self.rtt_us,
            "one_ssh_stream_per_connection": self.label == "tunnels"})
    }
}

pub fn wal_lsn(admin: &mut Client) -> i64 {
    admin.query_one("SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0')::bigint", &[]).unwrap().get(0)
}

pub fn pg_stat_wal(admin: &mut Client) -> Json {
    let row = admin.query_one("SELECT wal_records, wal_fpi, wal_bytes::bigint, wal_write, wal_sync FROM pg_stat_wal", &[]).unwrap();
    json!({"wal_records": row.get::<_, i64>(0), "wal_fpi": row.get::<_, i64>(1), "wal_bytes": row.get::<_, i64>(2),
        "wal_write": row.get::<_, i64>(3), "wal_sync": row.get::<_, i64>(4)})
}

fn wal_delta(before: &Json, after: &Json) -> Json {
    let mut out = serde_json::Map::new();
    for key in ["wal_records", "wal_fpi", "wal_bytes", "wal_write", "wal_sync"] {
        out.insert(key.into(), json!(after[key].as_i64().unwrap() - before[key].as_i64().unwrap()));
    }
    Json::Object(out)
}

/// One completed operation as seen by its caller.
#[derive(Clone, Copy)]
pub struct Op {
    pub end: Instant,
    pub latency_us: f64,
    /// Database calls the operation made, where the protocol counts them.
    pub calls: u64,
}

pub struct Timing {
    pub warmup: Duration,
    pub measure: Duration,
}

impl Timing {
    pub fn from_env() -> Timing {
        let ms = |name: &str, default: u64| std::env::var(name).ok().map_or(default, |v| v.parse().expect(name));
        Timing { warmup: Duration::from_millis(ms("CP_WARMUP_MS", 1000)), measure: Duration::from_millis(ms("CP_MEASURE_MS", 4000)) }
    }
}

fn percentile(sorted: &[f64], p: f64) -> Option<f64> {
    if sorted.is_empty() {
        return None;
    }
    Some(sorted[((sorted.len() as f64 * p) as usize).min(sorted.len() - 1)])
}

/// Closed loop: `writers` threads each build their state, meet at a barrier,
/// then call `op` until stopped. The window is [warmup, warmup + measure];
/// an operation counts if it completed inside it. Writers are always joined,
/// and a writer error ends that writer and fails the run (no retry here).
/// `pg`: Some(sample_waits) collects WAL deltas (and optionally wait events)
/// from the private cluster; None for the SQLite cells.
pub fn closed_loop<S, F, O>(writers: usize, timing: &Timing, pg: Option<bool>, setup: F, op: O) -> Json
where
    F: Fn(usize) -> S + Send + Sync + 'static,
    O: Fn(&mut S, usize, u64) -> Result<u64, String> + Send + Sync + 'static,
{
    let setup = Arc::new(setup);
    let op = Arc::new(op);
    let stop = Arc::new(AtomicBool::new(false));
    let gate = Arc::new(Barrier::new(writers + 1));
    let handles: Vec<_> = (0..writers)
        .map(|w| {
            let (setup, op, stop, gate) = (setup.clone(), op.clone(), stop.clone(), gate.clone());
            thread::spawn(move || {
                let mut state = setup(w);
                gate.wait();
                let mut ops = Vec::with_capacity(4096);
                let mut error = None;
                let mut i = 0u64;
                while !stop.load(Ordering::Relaxed) {
                    let start = Instant::now();
                    match op(&mut state, w, i) {
                        Ok(calls) => {
                            let end = Instant::now();
                            ops.push(Op { end, latency_us: (end - start).as_secs_f64() * 1e6, calls });
                        }
                        Err(e) => {
                            error = Some(e);
                            break;
                        }
                    }
                    i += 1;
                }
                drop(state);
                (ops, error)
            })
        })
        .collect();
    let mut admin = pg.map(|_| admin());
    gate.wait();
    thread::sleep(timing.warmup);
    let sampler = (pg == Some(true)).then(WaitSampler::start);
    let wal0 = admin.as_mut().map(pg_stat_wal);
    let lsn0 = admin.as_mut().map(wal_lsn);
    let t0 = Instant::now();
    thread::sleep(timing.measure);
    let t1 = Instant::now();
    let lsn1 = admin.as_mut().map(wal_lsn);
    let wal1 = admin.as_mut().map(pg_stat_wal);
    let waits = sampler.map(WaitSampler::finish);
    stop.store(true, Ordering::Relaxed);
    let mut all = Vec::new();
    let mut errors = Vec::new();
    let mut per_writer = Vec::new();
    for h in handles {
        let (ops, error) = h.join().expect("writer panicked");
        per_writer.push(ops.iter().filter(|o| o.end >= t0 && o.end <= t1).count());
        all.extend(ops);
        if let Some(e) = error {
            errors.push(e);
        }
    }
    let wal_bytes = lsn0.zip(lsn1).map(|(a, b)| b - a);
    let wal = wal0.zip(wal1).map(|(a, b)| wal_delta(&a, &b));
    summarize(&all, t0, t1, wal_bytes, wal, per_writer, errors, waits)
}

pub fn summarize(all: &[Op], t0: Instant, t1: Instant, wal_bytes: Option<i64>, wal: Option<Json>, per_writer: Vec<usize>, errors: Vec<String>, waits: Option<Json>) -> Json {
    let window: Vec<&Op> = all.iter().filter(|o| o.end >= t0 && o.end <= t1).collect();
    let seconds = (t1 - t0).as_secs_f64();
    let mut lat: Vec<f64> = window.iter().map(|o| o.latency_us).collect();
    lat.sort_by(f64::total_cmp);
    let n = window.len();
    let calls: u64 = window.iter().map(|o| o.calls).sum();
    let status = if errors.is_empty() { "complete" } else { "failed" };
    json!({
        "status": status, "errors": errors,
        "commits": n, "total_ops": all.len(), "seconds": seconds,
        "commits_per_s": (errors.is_empty()).then_some(n as f64 / seconds),
        "p50_ms": percentile(&lat, 0.50).map(|v| v / 1000.0),
        "p99_ms": percentile(&lat, 0.99).map(|v| v / 1000.0),
        "calls_per_op": (n > 0 && calls > 0).then(|| calls as f64 / n as f64),
        "wal_bytes_per_commit": wal_bytes.filter(|_| n > 0).map(|b| b as f64 / n as f64),
        "mean_ms": (n > 0).then(|| lat.iter().sum::<f64>() / n as f64 / 1000.0),
        "pg_stat_wal_delta": wal, "per_writer_commits": per_writer, "wait_events": waits,
    })
}

/// Samples pg_stat_activity for the measured sessions every 2 ms and
/// counts (wait_event_type, wait_event, state) triples.
pub struct WaitSampler {
    stop: Arc<AtomicBool>,
    handle: thread::JoinHandle<Json>,
}

impl WaitSampler {
    pub fn start() -> WaitSampler {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let handle = thread::spawn(move || {
            let mut client = admin();
            let statement = client.prepare(&format!("SELECT coalesce(wait_event_type,'CPU'), coalesce(wait_event,'-'), coalesce(state,'-') FROM pg_stat_activity WHERE application_name = '{APP}' AND datname = current_database()")).unwrap();
            let mut counts: BTreeMap<String, u64> = BTreeMap::new();
            let mut samples = 0u64;
            while !flag.load(Ordering::Relaxed) {
                for row in client.query(&statement, &[]).unwrap() {
                    *counts.entry(format!("{}:{}:{}", row.get::<_, &str>(0), row.get::<_, &str>(1), row.get::<_, &str>(2))).or_default() += 1;
                }
                samples += 1;
                thread::sleep(Duration::from_millis(2));
            }
            json!({"samples": samples, "session_states": counts})
        });
        WaitSampler { stop, handle }
    }
    pub fn finish(self) -> Json {
        self.stop.store(true, Ordering::Relaxed);
        self.handle.join().unwrap()
    }
}

/// Median of a cell's runs, and the spread. A failed run makes the cell
/// failed; no throughput is reported for it.
pub fn aggregate(runs: &[Json]) -> Json {
    let failed = runs.iter().any(|r| r["status"] != "complete");
    let mut cps: Vec<f64> = runs.iter().filter_map(|r| r["commits_per_s"].as_f64()).collect();
    cps.sort_by(f64::total_cmp);
    let med = |key: &str| {
        let mut v: Vec<f64> = runs.iter().filter_map(|r| r[key].as_f64()).collect();
        v.sort_by(f64::total_cmp);
        (!v.is_empty()).then(|| v[v.len() / 2])
    };
    json!({
        "status": if failed { "failed" } else { "complete" },
        "commits_per_s_median": (!failed && !cps.is_empty()).then(|| cps[cps.len() / 2]),
        "commits_per_s_min": cps.first(), "commits_per_s_max": cps.last(),
        "p50_ms_median": med("p50_ms"), "p99_ms_median": med("p99_ms"),
        "calls_per_op_median": med("calls_per_op"), "wal_bytes_per_commit_median": med("wal_bytes_per_commit"),
    })
}

pub fn loadavg() -> Json {
    let text = std::fs::read_to_string("/proc/loadavg").unwrap_or_default();
    let parts: Vec<f64> = text.split_whitespace().take(3).filter_map(|s| s.parse().ok()).collect();
    json!(parts)
}

pub fn now_iso() -> String {
    let out = std::process::Command::new("date").arg("-u").arg("+%Y-%m-%dT%H:%M:%SZ").output().unwrap();
    String::from_utf8_lossy(&out.stdout).trim().to_owned()
}
