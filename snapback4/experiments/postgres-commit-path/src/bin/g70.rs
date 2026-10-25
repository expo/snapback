//! G7.0: harness-only ordered, early-release and independent-tail probes.
// @ref LLP 3000.009.001.000.000.002#8-increments-and-evidence — G7.0 measures before product design.
use postgres::{Client, SimpleQueryMessage};
use serde_json::{Value as Json, json};
use std::{
    collections::VecDeque,
    fs::OpenOptions,
    io::Write,
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
#[path = "../g70_fixture.rs"]
mod fixture;

fn guard() {
    let mut s = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    assert_eq!(
        unsafe { libc::statvfs(c"/home".as_ptr(), s.as_mut_ptr()) },
        0
    );
    let s = unsafe { s.assume_init() };
    assert!(
        s.f_bavail as u128 * s.f_frsize as u128 >= 25 * 1024u128.pow(3),
        "/home below 25 GiB"
    );
}
fn quote(s: &str) -> String {
    format!("'{}'", s.replace("'", "''"))
}
fn raw(source: &str, name: &str) -> String {
    let marker = format!("const {name}: &str = r#\"");
    source
        .split_once(&marker)
        .expect(name)
        .1
        .split_once("\"#;")
        .unwrap()
        .0
        .into()
}
fn summary(x: &[f64]) -> Json {
    if x.is_empty() {
        return Json::Null;
    }
    let mut v = x.to_vec();
    v.sort_by(f64::total_cmp);
    json!({"n":v.len(),"mean":v.iter().sum::<f64>()/v.len() as f64,"p50":v[v.len()/2],"p99":v[(v.len()*99/100).min(v.len()-1)]})
}
fn query(c: &mut Client, s: &str) -> Vec<SimpleQueryMessage> {
    c.simple_query(s).unwrap()
}
fn assert_tail(rows: &[SimpleQueryMessage], n: usize, logs: usize) {
    let rows: Vec<_> = rows
        .iter()
        .filter_map(|r| {
            if let SimpleQueryMessage::Row(r) = r {
                Some(r)
            } else {
                None
            }
        })
        .collect();
    let r = rows.iter().find(|r| r.len() == 8).expect("tail result");
    for (i, want) in [1, n, n, logs, 0, 0, 0, n].iter().enumerate() {
        assert_eq!(
            r.get(i).unwrap().parse::<usize>().unwrap(),
            *want,
            "tail column {i}"
        );
    }
}
struct Sql {
    tail: String,
    auth: String,
    receipts: String,
    level: String,
}
impl Sql {
    fn load() -> Self {
        let b = include_str!("../../../../crates/snapback4-core/src/engine/postgres/batch.rs");
        let prefix = b
            .split_once("concat!(r#\"")
            .unwrap()
            .1
            .split_once("\"#, $sessions, r#\"")
            .unwrap();
        let suffix = prefix.1.split_once("\"#) }; }").unwrap().0;
        let sessions = "SELECT principal,family,kind,token_digest,expires_at,0 AS scope,NULL::bigint AS cap_expires_at,NULL::bigint AS principal_generation FROM _sessions UNION ALL SELECT principal,family,kind,token_digest,expires_at,1,cap_expires_at,principal_generation FROM _read_sessions";
        Self {
            tail: raw(
                include_str!("../../../../crates/snapback4-core/src/engine/postgres/group_tail.rs"),
                "SQL",
            ),
            auth: format!("{}{}{}", prefix.0, sessions, suffix),
            receipts: raw(b, "RECEIPTS"),
            level: raw(b, "LEVEL"),
        }
    }
    fn prepare(&self, c: &mut Client, arm: &str) {
        let mut tail = if arm == "C" {
            self.tail.replace(
                "head AS (UPDATE _head SET seq=$3 WHERE singleton AND seq=$2 RETURNING seq)",
                "head AS (SELECT $3::bigint AS seq)",
            )
        } else if arm != "serial" {
            self.tail.replace("head AS (UPDATE _head SET seq=$3 WHERE singleton AND seq=$2 RETURNING seq)","head AS (UPDATE _head SET seq=$3,revision=revision+($3-$2) WHERE singleton AND seq=$2 AND revision=$2 RETURNING seq)")
        } else {
            self.tail.clone()
        };
        if arm != "serial" {
            tail = tail.replace(
                "WHERE seq <= $3-1000",
                "WHERE seq > $2-1000 AND seq <= $3-1000",
            );
        }
        // SQL PREPARE + literal EXECUTE matches the product's serving transport.
        c.batch_execute(&format!("PREPARE gtail(text,bigint,bigint) AS {tail}; PREPARE gauth(text) AS {}; PREPARE greceipts(text) AS {}; PREPARE glevel(text) AS {};",self.auth,self.receipts,self.level)).unwrap();
    }
}
#[derive(Clone)]
struct Job {
    k: u64,
    lo: i64,
    ids: Vec<usize>,
    enqueued: Vec<Instant>,
    admitted: Vec<Instant>,
}
struct Done {
    slot: usize,
    job: Job,
    phases: [f64; 7],
    end: Instant,
}
enum Event {
    Ready,
    Opened,
    Done(Done),
}
fn run_worker(
    slot: usize,
    arm: String,
    rx: mpsc::Receiver<Option<Job>>,
    tx: mpsc::Sender<Event>,
    templates: Vec<(Json, Vec<Json>)>,
    split: bool,
) {
    unsafe {
        let mut mask: libc::cpu_set_t = std::mem::zeroed();
        libc::CPU_ZERO(&mut mask);
        for cpu in [3, 4, 9, 10] {
            libc::CPU_SET(cpu, &mut mask);
        }
        assert_eq!(
            libc::sched_setaffinity(0, std::mem::size_of_val(&mask), &mask),
            0
        );
    }
    let sql = Sql::load();
    let mut c = fixture::connect(false);
    sql.prepare(&mut c, &arm);
    tx.send(Event::Ready).unwrap();
    while let Some(job) = rx.recv().unwrap() {
        let start = Instant::now();
        let n = job.ids.len();
        let lo = job.lo;
        let hi = lo + n as i64;
        let ticket = 1_000_000 + job.k;
        let prev = ticket - 1;
        let owner = "SELECT store_id,token FROM _owner WHERE singleton FOR KEY SHARE;";
        let lock = if arm == "serial" {
            "SELECT seq FROM _head WHERE singleton FOR UPDATE;".into()
        } else if arm != "C" {
            format!("SELECT pg_advisory_xact_lock({ticket});")
        } else {
            String::new()
        };
        let requests=serde_json::to_string(&job.ids.iter().map(|u|json!({"digest":format!("g70-{u}"),"principal":format!("bench:{u}"),"id":null})).collect::<Vec<_>>()).unwrap();
        let levels=serde_json::to_string(&job.ids.iter().enumerate().map(|(i,u)|json!({"n":i,"t":"counters","ix":"byId","id":format!("c{u:04}"),"lo":"","hi":""})).collect::<Vec<_>>()).unwrap();
        let facts = format!(
            "SELECT generation FROM _backend WHERE singleton; EXECUTE gauth({}); EXECUTE greceipts({}); EXECUTE glevel({});",
            quote(&requests),
            quote(&requests),
            quote(&levels)
        );
        let begin = format!(
            "BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE; SET LOCAL synchronous_commit={};{owner}{lock}",
            if arm == "E" { "off" } else { "on" }
        );
        let mut opener_end = start;
        let rows = if split {
            query(
                &mut c,
                &format!(
                    "BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE; SET LOCAL synchronous_commit=on;{owner}"
                ),
            );
            query(&mut c, &lock);
            opener_end = Instant::now();
            query(&mut c, &facts)
        } else {
            query(&mut c, &format!("{begin}{facts}"))
        };
        let opened = Instant::now();
        tx.send(Event::Opened).unwrap();
        // W4 has no dependent-level flight. Decode real point images, perform
        // disjoint increments, and use templates from real Engine mutations.
        let mut images = vec![];
        let mut commits = vec![];
        let mut log = vec![];
        let point_rows: Vec<_> = rows
            .iter()
            .filter_map(|r| {
                if let SimpleQueryMessage::Row(r) = r {
                    if r.len() == 2 { Some(r) } else { None }
                } else {
                    None
                }
            })
            .collect();
        let point_rows = &point_rows[point_rows.len() - n..];
        assert_eq!(point_rows.len(), n);
        for (i, u) in job.ids.iter().enumerate() {
            let mut data: Json = serde_json::from_str(point_rows[i].get(1).unwrap()).unwrap();
            let v = data["Row"]["n"]["Int"].as_i64().unwrap();
            data["Row"]["n"]["Int"] = json!(v + 1);
            let data = serde_json::to_string(&data).unwrap();
            let seq = lo + i as i64 + 1;
            let (template, logs) = &templates[*u];
            let mut commit = template.clone();
            commit["seq"] = json!(seq);
            commit["at"] = json!(1700000000000_i64 + seq);
            commits.push(commit);
            if logs.is_empty() && std::env::var_os("G70_LOG_ONE").is_some() {
                log.push(json!({"partition":"g70-sensitivity","seq":seq,"ord":0,"t":"counters","kind":"put","id":format!("c{u:04}"),"data":data}));
            }
            for l in logs {
                let mut l = l.clone();
                l["seq"] = json!(seq);
                l["data"] = json!(data);
                log.push(l);
            }
            images.push(json!({"t":"counters","id":format!("c{u:04}"),"data":data}));
        }
        let payload = json!({"images":images,"commits":commits,"log":log,"effects":[],"presence":[],"receipts":[]});
        let encoded = serde_json::to_string(&payload).unwrap();
        let encoded_at = Instant::now();
        let wait = if arm == "S" || arm == "E" {
            format!("SELECT pg_advisory_xact_lock({prev});")
        } else {
            String::new()
        };
        let revision = if arm != "serial" {
            String::new()
        } else {
            format!("UPDATE _head SET revision=revision+{n} WHERE singleton;")
        };
        let check = format!(
            "DO $g70$ BEGIN IF (SELECT count(*) FROM _commits WHERE seq>{lo} AND seq<={hi})<>{n} THEN RAISE EXCEPTION 'G70 tail count mismatch'; END IF; END $g70$;"
        );
        let folded = if arm == "S" || arm == "E" {
            "SELECT h.revision,h.seq,b.generation,(SELECT value FROM _meta WHERE key='store_id'),(SELECT value FROM _meta WHERE key='schema_hash'),(SELECT value FROM _meta WHERE key='activation_hash') FROM _head h CROSS JOIN _backend b WHERE h.singleton AND b.singleton;"
        } else {
            ""
        };
        let apply = format!(
            "{wait}{revision}EXECUTE gtail({},{lo},{hi});{check}{folded}",
            quote(&encoded)
        );
        let (applied, published, end) = if split || arm == "S" {
            let result = query(&mut c, &apply);
            assert_tail(&result, n, payload["log"].as_array().unwrap().len());
            let t = Instant::now();
            if split {
                query(
                    &mut c,
                    "SELECT h.revision,h.seq,b.generation,(SELECT value FROM _meta WHERE key='store_id'),(SELECT value FROM _meta WHERE key='schema_hash'),(SELECT value FROM _meta WHERE key='activation_hash') FROM _head h CROSS JOIN _backend b WHERE h.singleton AND b.singleton",
                );
            }
            let p = Instant::now();
            query(&mut c, "COMMIT");
            (t, p, Instant::now())
        } else {
            let completion = if arm == "E" {
                format!(
                    "COMMIT;BEGIN;SET LOCAL synchronous_commit=on;UPDATE _durable SET n=n+1 WHERE slot={slot};COMMIT;"
                )
            } else {
                "COMMIT;".into()
            };
            let result = query(&mut c, &format!("{apply}{completion}"));
            assert_tail(&result, n, payload["log"].as_array().unwrap().len());
            let t = Instant::now();
            (t, t, t)
        };
        tx.send(Event::Done(Done {
            slot,
            job,
            phases: [
                if split {
                    opener_end.duration_since(start).as_secs_f64() * 1000.
                } else {
                    opened.duration_since(start).as_secs_f64() * 1000.
                },
                if split {
                    opened.duration_since(opener_end).as_secs_f64() * 1000.
                } else {
                    0.
                },
                0.,
                encoded_at.duration_since(opened).as_secs_f64() * 1000.,
                applied.duration_since(encoded_at).as_secs_f64() * 1000.,
                published.duration_since(applied).as_secs_f64() * 1000.,
                end.duration_since(published).as_secs_f64() * 1000.,
            ],
            end,
        }))
        .unwrap();
    }
    c.batch_execute("SELECT pg_stat_force_next_flush()")
        .unwrap();
}
fn wal(c: &mut Client) -> Json {
    c.query_one("SELECT to_jsonb(w) FROM pg_stat_wal w", &[])
        .unwrap()
        .get(0)
}
fn run(args: &[String]) {
    let opt = |key: &str, default: &str| {
        args.iter()
            .position(|s| s == key)
            .map(|i| args[i + 1].clone())
            .unwrap_or(default.into())
    };
    let arm = opt("--arm", "serial");
    let n: usize = opt("--n", "16").parse().unwrap();
    let connections: usize = opt("--connections", "1").parse().unwrap();
    let depth: usize = opt("--depth", "1").parse().unwrap();
    assert!([8, 16, 32].contains(&n));
    assert!((1..=4).contains(&connections));
    let slots = connections.min(depth).min(32 / n);
    assert!(arm != "serial" || slots == 1);
    let warm: f64 = opt("--warmup", "2").parse().unwrap();
    let seconds: f64 = opt("--seconds", "8").parse().unwrap();
    let rate: f64 = opt("--rate", "0").parse().unwrap();
    let split = arm == "serial";
    let mut c = fixture::connect(true);
    let templates: Vec<_> = c
        .query("SELECT commit,logs FROM _g70_template ORDER BY slot", &[])
        .unwrap()
        .iter()
        .map(|r| {
            let logs: Json = r.get(1);
            (r.get::<_, Json>(0), logs.as_array().unwrap().clone())
        })
        .collect();
    let (tx, rx) = mpsc::channel();
    let mut sends = vec![];
    let mut threads = vec![];
    for slot in 0..connections {
        let (jtx, jrx) = mpsc::channel();
        sends.push(jtx);
        let etx = tx.clone();
        let a = arm.clone();
        let t = templates.clone();
        threads.push(thread::spawn(move || {
            run_worker(slot, a, jrx, etx, t, split)
        }));
    }
    for _ in 0..connections {
        assert!(matches!(rx.recv().unwrap(), Event::Ready));
    }
    guard();
    let deadlocks_before: i64 = c
        .query_one(
            "SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()",
            &[],
        )
        .unwrap()
        .get(0);
    let before = wal(&mut c);
    let start = Instant::now();
    let t0 = start + Duration::from_secs_f64(warm);
    let t1 = t0 + Duration::from_secs_f64(seconds);
    println!(
        "{}",
        json!({"event":"start","connections":connections,"active_slots":slots,"n":n})
    );
    std::io::stdout().flush().unwrap();
    let ack_path = std::env::var("G70_ACK").ok();
    let mut ack = ack_path.map(|p| {
        OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(p)
            .unwrap()
    });
    let mut ready: VecDeque<_> = (0..32).map(|id| (id, start)).collect();
    let mut free: Vec<_> = (0..slots).rev().collect();
    let mut active = 0;
    let mut opening = false;
    let mut k = 0;
    let mut done = vec![];
    let mut total = 0;
    let mut assigned_writes = 0_i64;
    let mut intended = VecDeque::new();
    let mut collected: VecDeque<(usize, Instant, Instant)> = VecDeque::new();
    let mut next = 0_u64;
    let arrivals = (rate * (warm + seconds)).ceil() as u64;
    let mut expired = Vec::new();
    loop {
        let now = Instant::now();
        if rate > 0. {
            while next < arrivals {
                let at = start + Duration::from_secs_f64(next as f64 / rate);
                if at > now {
                    break;
                }
                intended.push_back(at);
                next += 1;
            }
            while intended
                .front()
                .is_some_and(|at| now.duration_since(*at) >= Duration::from_secs(1))
            {
                expired.push(intended.pop_front().unwrap());
            }
            while collected
                .front()
                .is_some_and(|r| now.duration_since(r.1) >= Duration::from_secs(1))
            {
                let r = collected.pop_front().unwrap();
                expired.push(r.1);
                ready.push_back((r.0, now));
            }
            while !intended.is_empty() && !ready.is_empty() {
                collected.push_back((
                    ready.pop_front().unwrap().0,
                    intended.pop_front().unwrap(),
                    now,
                ));
            }
            if now >= t1 && active == 0 && intended.is_empty() && collected.is_empty() {
                break;
            }
        }
        let next_size = if rate > 0. && now >= t1 {
            n.min(collected.len())
        } else {
            n
        };
        while !opening
            && active < slots
            && next_size > 0
            && (if rate > 0. {
                collected.len() >= next_size
            } else {
                ready.len() >= next_size && Instant::now() < t1
            })
        {
            guard();
            k += 1;
            let members: Vec<_> = (0..next_size)
                .map(|_| {
                    if rate > 0. {
                        collected.pop_front().unwrap()
                    } else {
                        let r = ready.pop_front().unwrap();
                        (r.0, r.1, r.1)
                    }
                })
                .collect();
            let job = Job {
                k,
                lo: fixture::BASE + assigned_writes,
                ids: members.iter().map(|x| x.0).collect(),
                enqueued: members.iter().map(|x| x.1).collect(),
                admitted: members.iter().map(|x| x.2).collect(),
            };
            assigned_writes += next_size as i64;
            let slot = free.pop().unwrap();
            sends[slot].send(Some(job)).unwrap();
            active += 1;
            opening = arm != "C";
        }
        if rate == 0. && active == 0 {
            break;
        }
        let event = if rate > 0. {
            match rx.recv_timeout(Duration::from_micros(100)) {
                Ok(e) => e,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(e) => panic!("writer progress: {e}"),
            }
        } else {
            rx.recv_timeout(Duration::from_secs(15))
                .expect("writer progress")
        };
        match event {
            Event::Opened => opening = false,
            Event::Done(d) => {
                active -= 1;
                free.push(d.slot);
                total += 1;
                if let Some(f) = &mut ack {
                    writeln!(
                        f,
                        "{}",
                        json!({"k":d.job.k,"hi":d.job.lo+d.job.ids.len() as i64-fixture::BASE})
                    )
                    .unwrap();
                    f.sync_data().unwrap();
                }
                for id in &d.job.ids {
                    ready.push_back((*id, d.end));
                }
                done.push(d);
            }
            Event::Ready => unreachable!(),
        }
    }
    for s in &sends {
        s.send(None).unwrap();
    }
    for t in threads {
        t.join().unwrap();
    }
    // Stats are published on backend exit; avoid stale PG statistics snapshots.
    c.batch_execute("SELECT pg_stat_clear_snapshot()").unwrap();
    let after = wal(&mut c);
    let deadlocks_after: i64 = c
        .query_one(
            "SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()",
            &[],
        )
        .unwrap()
        .get(0);
    assert_eq!(deadlocks_before, deadlocks_after);
    if let Ok(path) = std::env::var("G70_TRACE") {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .unwrap();
        for d in &done {
            writeln!(f,"{}",json!({"k":d.job.k,"slot":d.slot,"n":d.job.ids.len(),"end_ms":d.end.duration_since(start).as_secs_f64()*1000.,"phases_ms":d.phases,"latency_ms":d.job.enqueued.iter().map(|t|d.end.duration_since(*t).as_secs_f64()*1000.).collect::<Vec<_>>()})).unwrap();
        }
    }
    let measured: Vec<_> = done
        .iter()
        .filter(|d| {
            if rate > 0. {
                d.job.enqueued.iter().any(|t| *t >= t0 && *t < t1)
            } else {
                d.end >= t0 && d.end < t1
            }
        })
        .collect();
    let lat: Vec<_> = measured
        .iter()
        .flat_map(|d| {
            d.job
                .enqueued
                .iter()
                .filter(move |t| rate == 0. || (**t >= t0 && **t < t1))
                .map(move |t| d.end.duration_since(*t).as_secs_f64() * 1000.)
        })
        .collect();
    let expired_measured = expired
        .iter()
        .chain(intended.iter())
        .filter(|t| **t >= t0 && **t < t1)
        .count();
    let late = lat.iter().filter(|v| **v > 1000.).count();
    let mut all_latency = lat.clone();
    all_latency.extend(std::iter::repeat_n(1000., expired_measured));
    let error_count = expired_measured + late;
    let client_service: Vec<_> = measured
        .iter()
        .flat_map(|d| {
            d.job
                .admitted
                .iter()
                .zip(&d.job.enqueued)
                .filter(move |(_, t)| rate == 0. || (**t >= t0 && **t < t1))
                .map(move |(t, _)| d.end.duration_since(*t).as_secs_f64() * 1000.)
        })
        .collect();
    let service: Vec<_> = measured.iter().map(|d| d.phases.iter().sum()).collect();
    let phases: Vec<_> = (0..7)
        .map(|i| summary(&measured.iter().map(|d| d.phases[i]).collect::<Vec<_>>()))
        .collect();
    let sum:i64=c.query_one("SELECT sum((data::jsonb->'Row'->'n'->>'Int')::bigint)::bigint FROM r WHERE t='counters'",&[]).unwrap().get(0);
    let counts=c.query_one("SELECT (SELECT count(*) FROM _commits WHERE seq>1000000),(SELECT count(*) FROM _log),(SELECT seq-1000000 FROM _head WHERE singleton),(SELECT revision-1000000 FROM _head WHERE singleton)",&[]).unwrap();
    assert_eq!(sum, assigned_writes);
    assert_eq!(counts.get::<_, i64>(0), sum);
    if arm != "C" {
        assert_eq!(counts.get::<_, i64>(2), sum);
        assert_eq!(counts.get::<_, i64>(3), sum);
    }
    let syncs = after["wal_sync"].as_i64().unwrap() - before["wal_sync"].as_i64().unwrap();
    let sync_ms =
        after["wal_sync_time"].as_f64().unwrap() - before["wal_sync_time"].as_f64().unwrap();
    println!(
        "{}",
        json!({"deadlocks":deadlocks_after-deadlocks_before,"log_one":std::env::var_os("G70_LOG_ONE").is_some(),"arm":arm,"n":n,"connections":connections,"depth":depth,"active_slots":slots,"warmup_s":warm,"seconds":seconds,"measured_batches":measured.len(),"total_batches":total,"offered_per_s":rate,"expired":expired_measured,"late_ack":late,"error_count":error_count,"writes_per_s":(lat.len()-late) as f64/seconds,"latency_ms":summary(&all_latency),"successful_latency_ms":summary(&lat),"client_service_ms":summary(&client_service),"service_ms":summary(&service),"phase_names":["opener_or_fused_facts","facts","levels","K_encode","apply_tail_or_combined_completion","publication","COMMIT"],"phases_ms":phases,"wal_before":before,"wal_after":after,"syncs_per_batch":syncs as f64/total as f64,"wal_sync_mean_ms":sync_ms/syncs as f64,"counter_check":{"sum":sum,"acknowledged":assigned_writes,"commits":counts.get::<_,i64>(0),"logs":counts.get::<_,i64>(1),"ok":true}})
    );
}
fn main() {
    guard();
    let a: Vec<_> = std::env::args().collect();
    match a[1].as_str() {
        "setup" => fixture::setup(),
        "reset" => fixture::reset(),
        "history" => fixture::history(),
        "run" => run(&a[2..]),
        _ => panic!("setup|reset|run"),
    }
}
