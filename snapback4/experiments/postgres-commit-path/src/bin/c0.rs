//! C0′ experimental final messages; no serving/product changes.
// @ref LLP 3000.009.001.000.000.003#35-stage-c0-the-product-shaped-harness-and-its-gate — correlated CPU-contending replay, holds inside residence, S1 decides.
use postgres::{Client, SimpleQueryMessage};
use serde_json::{Value as Json, json};
pub use snapback4_core::RuntimeError;
use std::{
    collections::{BTreeMap, VecDeque},
    fs::OpenOptions,
    io::Write,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicI64, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};
#[path = "../g70_fixture.rs"]
mod fixture;
#[path = "../c0/sql.rs"]
mod sql;
#[path = "../c0/witness.rs"]
mod witness;
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
fn pin(app: bool) {
    unsafe {
        let mut m: libc::cpu_set_t = std::mem::zeroed();
        libc::CPU_ZERO(&mut m);
        for c in if app { vec![3, 4, 9, 10] } else { vec![5, 11] } {
            libc::CPU_SET(c, &mut m);
        }
        assert_eq!(libc::sched_setaffinity(0, std::mem::size_of_val(&m), &m), 0);
    }
}
fn cpu() -> f64 {
    unsafe {
        let mut t: libc::timespec = std::mem::zeroed();
        assert_eq!(
            libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t),
            0
        );
        t.tv_sec as f64 * 1e3 + t.tv_nsec as f64 / 1e6
    }
}
fn burn(ms: f64) {
    let until = cpu() + ms.max(0.);
    let mut x = 0x12345678u64;
    while cpu() < until {
        for _ in 0..64 {
            x = x.wrapping_mul(6364136223846793005).wrapping_add(1);
            std::hint::black_box(x);
        }
    }
}
fn delay(ms: f64) {
    if ms > 0. {
        thread::sleep(Duration::from_secs_f64(ms / 1e3));
    }
}
fn replay(wall: f64, budget: f64) {
    let s = Instant::now();
    burn(budget);
    delay((wall - s.elapsed().as_secs_f64() * 1e3).max(0.));
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
fn wal(c: &mut Client) -> Json {
    c.query_one("SELECT to_jsonb(w) FROM pg_stat_wal w", &[])
        .unwrap()
        .get(0)
}
#[derive(Clone)]
struct Sample {
    source: usize,
    n: f64,
    prep: f64,
    fill: f64,
    post: f64,
    members: Vec<[f64; 6]>,
}
fn load_samples(path: &str) -> Vec<Sample> {
    let j: Json = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    j.as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(source, x)| Sample {
            source,
            n: x["n"].as_f64().unwrap(),
            prep: x["prep_ms"].as_f64().unwrap() + x["parallel_ms"].as_f64().unwrap(),
            fill: x["fill_ms"].as_f64().unwrap(),
            post: x["post_cpu_ms"].as_f64().unwrap(),
            members: x["members"]
                .as_array()
                .unwrap()
                .iter()
                .map(|a| std::array::from_fn(|i| a[i].as_f64().unwrap()))
                .collect(),
        })
        .collect()
}
#[derive(Clone)]
struct Request {
    id: usize,
    at: Instant,
    admitted: Instant,
    queued: Instant,
    sample: Arc<Sample>,
    member: usize,
}
struct Job {
    k: u64,
    lo: i64,
    wm: i64,
    req: Vec<Request>,
    values: Vec<i64>,
    dispatched: Instant,
}
struct Done {
    slot: usize,
    job: Job,
    confirmed: Instant,
    sql_ms: f64,
    prep_cpu: f64,
    wire_bytes: usize,
}
enum Event {
    Queued(Request),
    Done(Done),
    Released(Done),
    Finished(Request, Instant),
    Opened,
    Ready,
}
fn setup() {
    let mut c = fixture::connect(true);
    c.batch_execute(include_str!("../c0/checks.sql")).unwrap();
    c.batch_execute(r#"
UPDATE _owner SET store_id='00000000000000000000000000000000';
ALTER TABLE r ADD COLUMN IF NOT EXISTS orev bigint,ADD COLUMN IF NOT EXISTS owm bigint,ADD COLUMN IF NOT EXISTS odata text;
CREATE TABLE _batches(rev_lo bigint PRIMARY KEY,rev_hi bigint NOT NULL,seq_lo bigint NOT NULL,seq_hi bigint NOT NULL,attempt text NOT NULL,state text NOT NULL CHECK(state IN ('committed','void')),at bigint NOT NULL);
CREATE FUNCTION sb4_assert(ok bool) RETURNS bigint LANGUAGE plpgsql VOLATILE AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'C0 assertion' USING ERRCODE='S4003'; END IF; RETURN 1; END$$;
CREATE FUNCTION sb4_stale(rev bigint) RETURNS text LANGUAGE plpgsql STABLE AS $$BEGIN RAISE EXCEPTION 'C0 stale %',rev USING ERRCODE='S4004'; END$$;
CREATE TABLE _c0_authority AS SELECT s.token_digest,to_jsonb(s) AS session,coalesce(g.generation,0) AS generation FROM _sessions s LEFT JOIN _principal_generations g USING(principal);
CREATE TABLE _c0_meta AS SELECT key,value FROM _meta WHERE key IN ('worker:session-family','worker:session-revision','generation','store_id','schema_hash','activation_hash','device_generation') OR key LIKE 'worker:family:%';
CREATE TABLE _c0_backend AS SELECT generation FROM _backend;
"#).unwrap();
    println!(
        "{}",
        json!({"setup":"Stage P exact check bodies; typed tail; two images; batch records"})
    );
}
fn reset() {
    fixture::reset();
    let mut c = fixture::connect(true);
    // fixture::reset uses jsonb::text; canonical product images have compact,
    // sorted tagged JSON. Restore those bytes before warm-fact equality.
    let rows = c
        .query("SELECT id,data::jsonb FROM r WHERE t='counters'", &[])
        .unwrap();
    for r in rows {
        let id: String = r.get(0);
        let image: Json = r.get(1);
        c.execute(
            "UPDATE r SET data=$1 WHERE t='counters' AND id=$2",
            &[&serde_json::to_string(&image).unwrap(), &id],
        )
        .unwrap();
    }
    c.batch_execute("TRUNCATE _batches; UPDATE _head SET attempt='c0-0'; UPDATE r SET orev=NULL,owm=NULL,odata=NULL WHERE t='counters'; SELECT pg_stat_force_next_flush()").unwrap();
}
fn raw(source: &str, name: &str) -> String {
    source
        .split_once(&format!("const {name}: &str = r#\""))
        .unwrap()
        .1
        .split_once("\"#;")
        .unwrap()
        .0
        .into()
}
fn prepare_facts(c: &mut Client, arm: &str) {
    let b = include_str!("../../../../crates/snapback4-core/src/engine/postgres/batch.rs");
    let (p, s) = b
        .split_once("concat!(r#\"")
        .unwrap()
        .1
        .split_once("\"#, $sessions, r#\"")
        .unwrap();
    let s = s.split_once("\"#) }; }").unwrap().0;
    let auth = format!(
        "{p}SELECT principal,family,kind,token_digest,expires_at,0 AS scope,NULL::bigint AS cap_expires_at,NULL::bigint AS principal_generation FROM _sessions UNION ALL SELECT principal,family,kind,token_digest,expires_at,1,cap_expires_at,principal_generation FROM _read_sessions{s}"
    );
    let mut level = raw(b, "LEVEL");
    if arm == "OC" {
        level=level.replace("r.data","CASE WHEN r.orev IS NULL OR r.orev<=GREATEST($2,(SELECT revision FROM _head WHERE singleton)) THEN r.data WHEN r.owm<=GREATEST($2,(SELECT revision FROM _head WHERE singleton)) THEN r.odata ELSE sb4_stale(r.orev) END AS data");
    }
    c.batch_execute(&format!("PREPARE c0_auth(text) AS {auth}; PREPARE c0_receipts(text) AS {}; PREPARE c0_level({}) AS {level};",raw(b,"RECEIPTS"),if arm=="OC"{"text,bigint"}else{"text"})).unwrap();
}
fn validation(c: &mut Client, arm: &str) {
    let image = if arm == "C" || arm == "OC" {
        "CASE WHEN r.orev IS NULL OR r.orev<=GREATEST($4,(SELECT revision FROM _head WHERE singleton)) THEN r.data WHEN r.owm<=GREATEST($4,(SELECT revision FROM _head WHERE singleton)) THEN r.odata ELSE sb4_stale(r.orev) END"
    } else {
        "r.data"
    };
    let v = format!(
        r#"WITH q AS(SELECT * FROM unnest($1::text[],$2::text[],$3::text[]) AS q(id,expected,digest)), locked AS MATERIALIZED(SELECT r.id,{image} AS image,q.expected FROM r JOIN q ON r.t='counters' AND r.id=q.id FOR UPDATE OF r), sessions AS(SELECT s.*,q.digest FROM q JOIN _sessions s ON s.token_digest=q.digest)
SELECT sb4_assert((SELECT count(*) FROM locked WHERE image=expected)=(SELECT count(*) FROM q)
AND (SELECT count(*) FROM sessions s JOIN _c0_authority a ON a.token_digest=s.token_digest WHERE to_jsonb(s)-'digest'=a.session AND coalesce((SELECT generation FROM _principal_generations WHERE principal=s.principal),0)=a.generation)=(SELECT count(*) FROM q)
AND NOT EXISTS(SELECT 1 FROM _read_sessions s JOIN q ON s.token_digest=q.digest)
AND NOT EXISTS((SELECT key,value FROM _c0_meta EXCEPT SELECT key,value FROM _meta) UNION ALL (SELECT key,value FROM _meta WHERE key IN ('worker:session-family','worker:session-revision','generation','store_id','schema_hash','activation_hash','device_generation') OR key LIKE 'worker:family:%' EXCEPT SELECT key,value FROM _c0_meta))
AND (SELECT generation FROM _backend)=(SELECT generation FROM _c0_backend));"#
    );
    c.batch_execute(&format!("PREPARE c0_validate(text[],text[],text[],bigint) AS {v}; PREPARE c0_deadline(bigint) AS SELECT sb4_assert(extract(epoch FROM clock_timestamp())*1000 < $1);" )).unwrap();
}
fn input_array(v: &[String]) -> String {
    let j = v
        .iter()
        .map(|x| format!("\"{}\"", x.replace('\\', "\\\\").replace('"', "\\\"")))
        .collect::<Vec<_>>()
        .join(",");
    format!("{}::pg_catalog.text[]", sql::literal(&format!("{{{j}}}")))
}
fn worker(
    slot: usize,
    arm: String,
    rx: mpsc::Receiver<Option<Job>>,
    tx: mpsc::Sender<Event>,
    templates: Vec<Json>,
    images: Vec<Json>,
) {
    pin(true);
    let mut c = fixture::connect(false);
    c.batch_execute(
        "SET extra_float_digits=3; SET bytea_output=hex; SET plan_cache_mode=force_generic_plan",
    )
    .unwrap();
    prepare_facts(&mut c, &arm);
    validation(&mut c, &arm);
    let mut prepared = false;
    tx.send(Event::Ready).unwrap();
    while let Some(job) = rx.recv().unwrap() {
        let cpu_before = cpu();
        let ids: Vec<_> = job.req.iter().map(|q| q.id).collect();
        let n = ids.len();
        let hi = job.lo + n as i64;
        let begin = format!(
            "BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE;{} SET LOCAL statement_timeout=1000; SET LOCAL lock_timeout=1000;{}SET LOCAL synchronous_commit={};",
            sql::GUARD,
            sql::FENCE,
            if arm == "OC" { "off" } else { "on" }
        );
        let ticket = if arm == "O1" || arm == "OC" {
            format!("SELECT pg_advisory_xact_lock({});", 1_000_000 + job.k)
        } else {
            String::new()
        };
        if arm == "O1" || arm == "OC" {
            let requests=serde_json::to_string(&ids.iter().map(|u|json!({"digest":format!("g70-{u}"),"principal":format!("bench:{u}"),"id":null})).collect::<Vec<_>>()).unwrap();
            let levels=serde_json::to_string(&ids.iter().enumerate().map(|(i,u)|json!({"n":i,"t":"counters","ix":"byId","id":format!("c{u:04}"),"lo":"","hi":""})).collect::<Vec<_>>()).unwrap();
            query(
                &mut c,
                &format!(
                    "{begin}{ticket}SELECT seq,revision,attempt,pg_catalog.pg_current_xact_id()::text,(SELECT generation FROM _backend WHERE singleton),(SELECT value FROM _meta WHERE key='store_id') FROM _head WHERE singleton;EXECUTE c0_auth({});EXECUTE c0_receipts({});EXECUTE c0_level({}{});",
                    sql::literal(&requests),
                    sql::literal(&requests),
                    sql::literal(&levels),
                    if arm == "OC" {
                        format!(",{}", job.wm)
                    } else {
                        String::new()
                    }
                ),
            );
            tx.send(Event::Opened).unwrap();
        }
        let prep = job
            .req
            .iter()
            .map(|q| q.sample.prep / q.sample.n)
            .sum::<f64>();
        let fill = job.req.iter().map(|q| q.sample.fill).sum::<f64>() / n as f64;
        let (tail, args) = sql::tail(
            &templates,
            &images,
            &ids,
            &job.values,
            job.lo,
            job.k,
            job.wm,
            &arm,
        );
        let raising = sql::raising_tail(&tail, n);
        // The tail changes shape only with presence of families; N changes
        // parameters and expected counts. Use parameterized expected counts.
        let raising = raising.replace(
            &format!("ARRAY[1,{n},{n},0,0,0,0,{n}]::bigint[]"),
            "ARRAY[1,$18,$18,0,0,0,0,$18]::bigint[]",
        );
        if !prepared {
            sql::prepare(&mut c, "c0_tail", &raising, &args);
            prepared = true;
        }
        let mut args = args;
        args.push(format!("('{n}')::pg_catalog.int8"));
        args.push(format!("('{}')::pg_catalog.int8", job.wm));
        let mut final_msg = if arm == "O1" || arm == "OC" {
            format!("{}", sql::GUARD)
        } else {
            format!("{begin}{ticket}")
        };
        if arm == "O1" || arm == "OC" {
            final_msg.push_str(&format!("SELECT pg_advisory_xact_lock({});SELECT generation,(SELECT value FROM _meta WHERE key='store_id') FROM _backend WHERE singleton;",999_999+job.k));
        }
        if arm == "C" {
            final_msg.push_str(&format!(
                "INSERT INTO _batches VALUES({}, {}, {}, {}, 'c0-{}','committed',1700000000000);",
                job.lo + 1,
                hi,
                job.lo + 1,
                hi,
                job.k
            ));
        }
        if arm != "O1" {
            let expected = ids
                .iter()
                .zip(&job.values)
                .map(|(u, v)| {
                    let mut j = images[*u].clone();
                    j["Row"]["n"]["Int"] = json!(v - 1);
                    serde_json::to_string(&j).unwrap()
                })
                .collect::<Vec<_>>();
            final_msg.push_str(&format!(
                "EXECUTE c0_validate({},{},{},{});EXECUTE c0_deadline(8999999999999950);",
                input_array(&ids.iter().map(|u| format!("c{u:04}")).collect::<Vec<_>>()),
                input_array(&expected),
                input_array(&ids.iter().map(|u| format!("g70-{u}")).collect::<Vec<_>>()),
                job.wm
            ));
        }
        final_msg.push_str(&sql::execute("c0_tail", &args));
        final_msg.push_str("SET LOCAL statement_timeout=0;SET LOCAL lock_timeout=0;COMMIT;");
        if arm == "OC" {
            final_msg.push_str(&format!("BEGIN;{}SET LOCAL synchronous_commit=on;{}UPDATE _head SET seq={hi},revision={hi},attempt='c0-{}' WHERE singleton AND seq<{hi};SET LOCAL statement_timeout=0;SET LOCAL lock_timeout=0;COMMIT;",sql::GUARD,sql::FENCE,job.k));
        }
        burn((prep + fill - (cpu() - cpu_before)).max(0.));
        let prep_cpu = cpu() - cpu_before;
        let bytes = final_msg.len();
        let s = Instant::now();
        let result = query(&mut c, &final_msg);
        assert!(matches!(
            result.last(),
            Some(SimpleQueryMessage::CommandComplete(_))
        ));
        let confirmed = Instant::now();
        tx.send(Event::Done(Done {
            slot,
            job,
            confirmed,
            sql_ms: s.elapsed().as_secs_f64() * 1e3,
            prep_cpu,
            wire_bytes: bytes,
        }))
        .unwrap();
    }
    c.batch_execute("SELECT pg_stat_force_next_flush()")
        .unwrap();
}
fn run(args: &[String]) {
    let opt = |key: &str, default: &str| {
        args.iter()
            .position(|a| a == key)
            .map(|i| args[i + 1].clone())
            .unwrap_or(default.into())
    };
    let arm = opt("--arm", "C");
    assert!(["O1", "C", "OC"].contains(&arm.as_str()));
    let n: usize = opt("--n", "16").parse().unwrap();
    let k: usize = opt("--k", "2").parse().unwrap();
    let h: f64 = opt("--hold-ms", "0.3").parse().unwrap();
    let rate: f64 = opt("--rate", "4525").parse().unwrap();
    let warm: f64 = opt("--warmup", "1").parse().unwrap();
    let seconds: f64 = opt("--seconds", "4").parse().unwrap();
    let seed: u64 = opt("--seed", "1").parse().unwrap();
    assert!([4, 8, 16, 32].contains(&n) && (1..=4).contains(&k));
    assert!(arm != "O1" || k <= 2);
    let samples = load_samples(&opt("--samples", ""));
    let mut rng = seed;
    let target = n.min(32_usize.div_ceil(k));
    let mut c = fixture::connect(true);
    let templates: Vec<Json> = c
        .query("SELECT commit FROM _g70_template ORDER BY slot", &[])
        .unwrap()
        .iter()
        .map(|r| r.get(0))
        .collect();
    let images: Vec<Json> = c
        .query(
            "SELECT data::jsonb FROM r WHERE t='counters' AND id<'c0032' ORDER BY id",
            &[],
        )
        .unwrap()
        .iter()
        .map(|r| r.get(0))
        .collect();
    assert_eq!(images.len(), 32);
    let wm = Arc::new(AtomicI64::new(fixture::BASE));
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, rx) = mpsc::channel();
    let mut writers = vec![];
    let mut joins = vec![];
    for slot in 0..k {
        let (jtx, jrx) = mpsc::channel();
        writers.push(jtx);
        let tx = tx.clone();
        let a = arm.clone();
        let t = templates.clone();
        let im = images.clone();
        joins.push(thread::spawn(move || worker(slot, a, jrx, tx, t, im)));
    }
    for _ in 0..k {
        assert!(matches!(
            rx.recv_timeout(Duration::from_secs(15)).unwrap(),
            Event::Ready
        ));
    }
    let (release_tx, release_rx) = mpsc::channel::<Option<Done>>();
    let release_events = tx.clone();
    let release_thread = thread::spawn(move || {
        pin(true);
        while let Some(d) = release_rx.recv().unwrap() {
            burn(
                d.job
                    .req
                    .iter()
                    .map(|q| q.sample.post / q.sample.n)
                    .sum::<f64>(),
            );
            release_events.send(Event::Released(d)).unwrap();
        }
    });
    let mut requests = vec![];
    let mut completions = vec![];
    for _ in 0..32 {
        let (itx, irx) = mpsc::channel::<Option<Request>>();
        let (otx, orx) = mpsc::channel::<()>();
        requests.push(itx);
        completions.push(otx);
        let etx = tx.clone();
        let ordered = arm == "OC";
        joins.push(thread::spawn(move || {
            pin(true);
            while let Some(mut q) = irx.recv().unwrap() {
                let m = q.sample.members[q.member];
                replay(m[0], m[3] * 0.5);
                q.queued = Instant::now();
                etx.send(Event::Queued(q.clone())).unwrap();
                orx.recv().unwrap();
                let release = if ordered { (m[2] - m[4]).max(0.) } else { m[2] };
                replay(release + m[1], m[3] * 0.5 + m[5]);
                etx.send(Event::Finished(q, Instant::now())).unwrap();
            }
        }));
    }
    // Own dedicated maintenance slot; ordinary batch slots cannot starve it.
    let maint = {
        let wm = wm.clone();
        let stop = stop.clone();
        let a = arm.clone();
        thread::spawn(move || {
            pin(true);
            let mut c = fixture::connect(false);
            c.batch_execute("SET extra_float_digits=3;SET bytea_output=hex")
                .unwrap();
            let mut count = 0;
            let mut last = fixture::BASE;
            let mut renew = Instant::now();
            while !stop.load(Ordering::Acquire) {
                thread::sleep(Duration::from_millis(100));
                let w = wm.load(Ordering::Acquire);
                if renew.elapsed().as_secs_f64() >= 1. {
                    query(
                        &mut c,
                        &format!(
                            "BEGIN;{}{}UPDATE _owner SET lease_until=clock_timestamp()+interval '10 seconds' WHERE singleton;COMMIT;",
                            sql::GUARD,
                            sql::FENCE
                        ),
                    );
                    renew = Instant::now();
                }
                if w > last {
                    let update = if a == "C" {
                        format!(
                            "UPDATE _head SET seq={w},revision={w},attempt='catchup-{w}' WHERE singleton AND revision<={w};"
                        )
                    } else {
                        String::new()
                    };
                    query(
                        &mut c,
                        &format!(
                            "BEGIN;{}{}SET LOCAL synchronous_commit=on;{update}DELETE FROM _change_evidence WHERE seq>{} AND seq<={};COMMIT;",
                            sql::GUARD,
                            sql::FENCE,
                            last - 1000,
                            w - 1000
                        ),
                    );
                    last = w;
                    count += 1;
                }
            }
            c.batch_execute("SELECT pg_stat_force_next_flush()")
                .unwrap();
            count
        })
    };
    let hammer = if args.iter().any(|x| x == "--prefix-hammer") {
        let wm = wm.clone();
        let stop = stop.clone();
        Some(thread::spawn(move || {
            pin(true);
            let mut c = fixture::connect(false);
            let mut samples = vec![];
            let mut stale = 0;
            while !stop.load(Ordering::Acquire) {
                let w = wm.load(Ordering::Acquire);
                let begin = Instant::now();
                let result=c.query("WITH v AS MATERIALIZED(SELECT GREATEST($1,(SELECT revision FROM _head WHERE singleton)) AS rev), images AS MATERIALIZED(SELECT CASE WHEN r.orev IS NULL OR r.orev<=v.rev THEN r.data WHEN r.owm<=v.rev THEN r.odata ELSE sb4_stale(r.orev) END AS image FROM r CROSS JOIN v WHERE t='counters') SELECT (SELECT rev FROM v),sum((image::jsonb->'Row'->'n'->>'Int')::bigint)::bigint FROM images",&[&w]);
                match result {
                    Ok(rows) => {
                        let revision: i64 = rows[0].get(0);
                        let sum: i64 = rows[0].get(1);
                        assert_eq!(sum, revision - fixture::BASE, "prefix violation");
                        samples.push(begin.elapsed().as_secs_f64() * 1e3);
                    }
                    Err(e) if e.code().is_some_and(|c| c.code() == "S4004") => stale += 1,
                    Err(e) => panic!("prefix query: {e}"),
                };
                delay(1.);
            }
            json!({"reader_ms":summary(&samples),"stale_restarts":stale,"violations":0})
        }))
    } else {
        None
    };
    guard();
    pin(false);
    let before = wal(&mut c);
    let start = Instant::now();
    let t0 = start + Duration::from_secs_f64(warm);
    let t1 = t0 + Duration::from_secs_f64(seconds);
    let arrivals = (rate * (warm + seconds)).ceil() as u64;
    let mut next = 0;
    let mut intended = VecDeque::new();
    let mut free: VecDeque<usize> = (0..32).collect();
    let mut queued = VecDeque::new();
    let mut slots: Vec<usize> = (0..k).rev().collect();
    let mut freed = vec![start; k];
    let mut inflight = 0;
    let mut assigned = 0i64;
    let mut values = vec![0i64; 32];
    let mut batch = 0u64;
    let mut release_next = 1u64;
    let mut pending = BTreeMap::new();
    let mut done = vec![];
    let mut finished = vec![];
    let mut expired = vec![];
    let mut trace = std::env::var("C0_TRACE").ok().map(|p| {
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(p)
            .unwrap()
    });
    let mut opening = false;
    let mut bundle = Arc::new(samples[0].clone());
    let mut bundle_left = 0;
    let mut member = 0;
    println!(
        "{}",
        json!({"event":"start","arm":arm,"n":n,"k":k,"cohort_target":target,"hold_ms":h,"samples":samples.len()})
    );
    std::io::stdout().flush().unwrap();
    loop {
        assert!(
            !joins.iter().any(|j| j.is_finished()),
            "request/writer thread exited unexpectedly"
        );
        let now = Instant::now();
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
            .is_some_and(|at| now.duration_since(*at).as_secs_f64() >= 1.)
        {
            expired.push(intended.pop_front().unwrap());
        }
        while !free.is_empty() && !intended.is_empty() {
            if bundle_left == 0 {
                rng ^= rng << 13;
                rng ^= rng >> 7;
                rng ^= rng << 17;
                bundle = Arc::new(samples[(rng as usize) % samples.len()].clone());
                bundle_left = target;
                member = 0;
            }
            let id = free.pop_front().unwrap();
            let q = Request {
                id,
                at: intended.pop_front().unwrap(),
                admitted: now,
                queued: now,
                sample: bundle.clone(),
                member: member % bundle.members.len(),
            };
            member += 1;
            bundle_left -= 1;
            requests[id].send(Some(q)).unwrap();
            inflight += 1;
        }
        // Timer starts at slot confirmation, including time spent in release
        // and ingress. N is a cap; approximately 32/K members form a cohort.
        while !opening && !slots.is_empty() && !queued.is_empty() {
            let position = (0..slots.len()).min_by_key(|i| freed[slots[*i]]).unwrap();
            let slot = slots[position];
            if queued.len() < target
                && now.duration_since(freed[slot]).as_secs_f64() * 1e3 < h
                && now < t1
            {
                break;
            }
            let size = n.min(queued.len());
            let req: Vec<Request> = (0..size).map(|_| queued.pop_front().unwrap()).collect();
            batch += 1;
            let mut nextvalues = vec![];
            for q in &req {
                values[q.id] += 1;
                nextvalues.push(values[q.id]);
            }
            let job = Job {
                k: batch,
                lo: fixture::BASE + assigned,
                wm: wm.load(Ordering::Acquire),
                req,
                values: nextvalues,
                dispatched: Instant::now(),
            };
            assigned += size as i64;
            slots.swap_remove(position);
            writers[slot].send(Some(job)).unwrap();
            opening = arm != "C";
        }
        if now >= t1 && inflight == 0 && intended.is_empty() {
            break;
        }
        match rx.recv_timeout(Duration::from_micros(25)) {
            Ok(Event::Queued(q)) => queued.push_back(q),
            Ok(Event::Done(d)) => {
                freed[d.slot] = d.confirmed;
                slots.push(d.slot);
                pending.insert(d.job.k, d);
                while let Some(d) = pending.remove(&release_next) {
                    release_tx.send(Some(d)).unwrap();
                    release_next += 1;
                }
            }
            Ok(Event::Released(d)) => {
                wm.store(d.job.lo + d.job.req.len() as i64, Ordering::Release);
                for q in &d.job.req {
                    completions[q.id].send(()).unwrap();
                }
                if let Some(f) = &mut trace {
                    writeln!(f,"{}",json!({"batch":d.job.k,"lo":d.job.lo,"n":d.job.req.len(),"wm":d.job.wm,"confirmed_ms":d.confirmed.duration_since(start).as_secs_f64()*1e3,"dispatch_ms":d.job.dispatched.duration_since(start).as_secs_f64()*1e3,"sql_ms":d.sql_ms,"prep_cpu_ms":d.prep_cpu,"wire_bytes":d.wire_bytes,"ids":d.job.req.iter().map(|q|q.id).collect::<Vec<_>>()})).unwrap();
                }
                done.push(d);
            }
            Ok(Event::Finished(q, end)) => {
                inflight -= 1;
                free.push_back(q.id);
                finished.push((q, end));
            }
            Ok(Event::Opened) => opening = false,
            Ok(Event::Ready) => unreachable!(),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(e) => panic!("{e}"),
        }
    }
    release_tx.send(None).unwrap();
    release_thread.join().unwrap();
    for tx in writers {
        tx.send(None).unwrap();
    }
    for tx in requests {
        tx.send(None).unwrap();
    }
    for j in joins {
        j.join().unwrap();
    }
    stop.store(true, Ordering::Release);
    let maintenance = maint.join().unwrap();
    let prefix = hammer.map(|j| j.join().unwrap());
    if let Ok(path) = std::env::var("C0_TRACE") {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(format!("{path}.requests.jsonl"))
            .unwrap();
        for (q, e) in &finished {
            writeln!(f,"{}",json!({"id":q.id,"at_ms":q.at.duration_since(start).as_secs_f64()*1e3,"admitted_ms":q.admitted.duration_since(start).as_secs_f64()*1e3,"queued_ms":q.queued.duration_since(start).as_secs_f64()*1e3,"end_ms":e.duration_since(start).as_secs_f64()*1e3,"source_n":q.sample.n,"source_sample":q.sample.source,"source_member":q.member})).unwrap();
        }
        for at in &expired {
            writeln!(
                f,
                "{}",
                json!({"expired_at_ms":at.duration_since(start).as_secs_f64()*1e3})
            )
            .unwrap();
        }
    }
    c.batch_execute("SELECT pg_stat_clear_snapshot()").unwrap();
    let after = wal(&mut c);
    let syncs = after["wal_sync"].as_f64().unwrap() - before["wal_sync"].as_f64().unwrap();
    let synctime =
        after["wal_sync_time"].as_f64().unwrap() - before["wal_sync_time"].as_f64().unwrap();
    let measured: Vec<_> = finished
        .iter()
        .filter(|(q, _)| q.at >= t0 && q.at < t1)
        .collect();
    let intended_lat: Vec<_> = measured
        .iter()
        .map(|(q, e)| e.duration_since(q.at).as_secs_f64() * 1e3)
        .collect();
    let sent_lat: Vec<_> = measured
        .iter()
        .map(|(q, e)| e.duration_since(q.admitted).as_secs_f64() * 1e3)
        .collect();
    let late = intended_lat.iter().filter(|x| **x > 1000.).count();
    let exp = expired.iter().filter(|at| **at >= t0 && **at < t1).count();
    let mut all = intended_lat.clone();
    all.extend(std::iter::repeat_n(1000., exp));
    let scheduled = all.len();
    let errors = exp + late;
    let sum:i64=c.query_one("SELECT sum((data::jsonb->'Row'->'n'->>'Int')::bigint)::bigint FROM r WHERE t='counters'",&[]).unwrap().get(0);
    let commits: i64 = c
        .query_one("SELECT count(*) FROM _commits WHERE seq>1000000", &[])
        .unwrap()
        .get(0);
    assert_eq!(sum, assigned);
    assert_eq!(commits, assigned);
    assert_eq!(finished.len() as i64, assigned);
    let slo = errors as f64 / scheduled as f64 <= 0.001
        && all.iter().filter(|x| **x <= 100.).count() as f64 / all.len() as f64 >= 0.99
        && (measured.len() - late) as f64 / seconds >= rate * 0.999;
    println!(
        "{}",
        json!({"arm":arm,"n":n,"k":k,"hold_ms":h,"cohort_target":target,"rate":rate,"warmup_s":warm,"seconds":seconds,"scheduled":scheduled,"success":measured.len()-late,"expired":exp,"late":late,"error_count":errors,"error_fraction":errors as f64/scheduled as f64,"writes_per_s":(measured.len()-late) as f64/seconds,"slo_pass":slo,"intended_ms":summary(&all),"client_ms":summary(&sent_lat),"mean_batch_n":assigned as f64/done.len() as f64,"total_batches":done.len(),"syncs_per_batch":syncs/done.len() as f64,"wal_sync_mean_ms":synctime/syncs,"wal_before":before,"wal_after":after,"maintenance":maintenance,"prefix_hammer":prefix,"mean_prep_cpu_ms":done.iter().map(|d|d.prep_cpu).sum::<f64>()/done.len() as f64,"counter_check":{"ok":true,"assigned":assigned,"sum":sum,"commits":commits},"cpu_basis":"current staging CPU + parallel critical wall replayed as CPU; L-prime stand-in, not measured L-prime"})
    );
}
fn main() {
    guard();
    let a: Vec<_> = std::env::args().collect();
    match a.get(1).map(String::as_str) {
        Some("witness") => witness::run(),
        Some("fixture") => fixture::setup(),
        Some("history") => fixture::history(),
        Some("setup") => setup(),
        Some("reset") => reset(),
        Some("run") => run(&a[2..]),
        _ => panic!("fixture|history|setup|reset|run"),
    }
}
