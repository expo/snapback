//! Explicit HTTP latency witness; run with --release --ignored --nocapture.
//! SNAPBACK4_BENCH_BIN can select the packaged production-profile binary.
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, Store, Value, WriteState};
use std::{fs, io::{BufRead, BufReader, Read, Write}, net::TcpStream, path::PathBuf,
    process::{Child, Command, Stdio}, time::{Duration, Instant}};

struct Fixture { path: PathBuf }
impl Fixture {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!("sb4-maintenance-{}-{label}", std::process::id()));
        fs::create_dir_all(path.join("snapback")).unwrap();
        fs::create_dir_all(path.join(".snapback4")).unwrap();
        let card = include_str!("../../snapback4-lang/src/guide/feeds.md");
        let program = card.split_once("```quarry\n").unwrap().1.split_once("```").unwrap().0;
        let source = format!("use personas small, big, small0, big0\n{program}");
        fs::write(path.join("snapback/schema.q"), &source).unwrap();
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        assert!(bound.notes.is_empty(), "{:?}", bound.notes);
        let mut engine = Engine::new(Store::open(&path.join(".snapback4/store.sqlite")).unwrap(), bound.schema,
            bound.programs.into_iter().map(|p| p.program)).unwrap();
        for (actor, followers) in [("small", 5), ("big", 900)] {
            for n in 0..followers {
                let result = engine.mutate("follow", None, Context::new(format!("dev:{actor}{n}"),
                    [("actor".into(), Value::Id(format!("dev:{actor}")))].into()).at(1)).unwrap();
                assert!(matches!(result.state, WriteState::Sent { .. }), "{result:?}");
            }
        }
        Self { path }
    }
    fn engine(&self) -> Engine { Engine::open(Store::open(&self.path.join(".snapback4/store.sqlite")).unwrap()).unwrap() }
    fn start(&self) -> Host {
        let binary = std::env::var("SNAPBACK4_BENCH_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_snapback4").into());
        let mut child = Command::new(binary).current_dir(&self.path)
            .args(["dev", "--no-watch", "--hold-schedules", "--port", "0"])
            .stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
        let address = line.trim().strip_prefix("http://").expect("server address").to_owned();
        Host { child, address }
    }
    fn copies(&self, event: &str) -> usize {
        let engine = self.engine();
        engine.store().conn().query_row("SELECT count(*) FROM r JOIN _catalog c ON c.num = r.t WHERE c.name = 'followingFeed' AND json_extract(data, '$.Row.eventId.Id') = ?1", [event], |r| r.get::<_, i64>(0)).unwrap() as usize
    }
}
impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.path); } }
struct Host { child: Child, address: String }
impl Drop for Host { fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); } }
fn request(address: &str, persona: &str, path: &str, body: Json) -> Json {
    let body = body.to_string();
    let mut stream = TcpStream::connect(address).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(30))).unwrap();
    write!(stream, "POST {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: {persona}\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
    let mut reply = String::new(); stream.read_to_string(&mut reply).unwrap();
    serde_json::from_str(reply.split_once("\r\n\r\n").unwrap().1).unwrap_or_else(|e| panic!("{e}: {reply}"))
}
fn percentile(samples: &[f64], p: usize) -> f64 {
    let mut sorted = samples.to_vec(); sorted.sort_by(f64::total_cmp);
    sorted[(sorted.len() * p).div_ceil(100) - 1]
}
fn report(label: &str, samples: &[f64]) {
    println!("MEASURE {label} n={} p50_ms={:.3} p95_ms={:.3} max_ms={:.3}", samples.len(), percentile(samples, 50), percentile(samples, 95), percentile(samples, 100));
}

#[test]
#[ignore = "20 sequential HTTP posts at both follower counts; explicit latency qualification"]
fn following_http_latency() {
    let fixture = Fixture::new("http");
    let host = fixture.start();
    let mut write_p95 = Vec::new();
    for (actor, followers) in [("small", 5), ("big", 900)] {
        let mut samples = Vec::new();
        let started = Instant::now();
        for n in 0..20 {
            let start = Instant::now();
            let result = request(&host.address, actor, "/m/post", json!({"id":format!("{actor}-write-{n}"), "args":{"postId":format!("{actor}-{n}"),"parentId":null}}));
            samples.push(start.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(result["state"], "sent", "{result}");
        }
        report(&format!("post followers={followers}"), &samples);
        write_p95.push(percentile(&samples, 95));
        let drain = Instant::now();
        while fixture.copies(&format!("{actor}-19")) != followers + 1 {
            assert!(started.elapsed() < Duration::from_secs(120), "delivery stalled");
            std::thread::sleep(Duration::from_millis(10));
        }
        // Count every event, not just the last task, to detect skipped cursors.
        for n in 0..20 { assert_eq!(fixture.copies(&format!("{actor}-{n}")), followers + 1); }
        println!("MEASURE delivery followers={followers} posts=20 total_ms={:.3} after_last_ack_ms={:.3}", started.elapsed().as_secs_f64()*1000.0, drain.elapsed().as_secs_f64()*1000.0);
    }
    for reader in ["small0", "big0"] {
        let mut samples = Vec::new();
        for _ in 0..20 {
            let start = Instant::now();
            let page = request(&host.address, reader, "/q/home", json!({"args":{"c":null}}));
            samples.push(start.elapsed().as_secs_f64()*1000.0);
            assert_eq!(page["data"].as_array().unwrap().len(), 20, "{page}");
        }
        report(&format!("home reader={reader}"), &samples);
    }
    // Baseline runs record the miss without turning the witness into a false pass.
    println!("MEASURE target ratio={:.3} under_50ms={} within_3x={}", write_p95[1]/write_p95[0], write_p95[1]<50.0, write_p95[1]<=3.0*write_p95[0]);
    if std::env::var_os("SNAPBACK4_BENCH_ASSERT").is_some() {
        assert!(write_p95[1] < 50.0 && write_p95[1] <= 3.0*write_p95[0], "post p95: {write_p95:?}");
    }
}

#[test]
#[ignore = "isolated delivery cost, no HTTP or waiter notifications"]
fn following_chunk_cost() {
    let fixture = Fixture::new("chunk");
    let mut engine = fixture.engine();
    let result = engine.mutate("post", None, Context::new("dev:big", [("postId".into(), Value::Id("profile".into())), ("parentId".into(), Value::Null)].into()).at(2)).unwrap();
    assert!(matches!(result.state, WriteState::Sent { .. }));
    let mut total = Duration::ZERO;
    let mut copies = 0;
    while let Some((meter, elapsed)) = {
        let start = Instant::now();
        engine.run_timeline_chunk(3).unwrap().map(|m| (m, start.elapsed()))
    } {
        let delivered = meter.rows_written - 1;
        println!("MEASURE chunk copies={delivered} elapsed_ms={:.3} us_per_copy={:.3}", elapsed.as_secs_f64()*1000.0, elapsed.as_secs_f64()*1e6/delivered.max(1) as f64);
        total += elapsed; copies += delivered;
    }
    assert_eq!(copies, 900);
    println!("MEASURE chunk_total copies={copies} elapsed_ms={:.3} us_per_copy={:.3}", total.as_secs_f64()*1000.0, total.as_secs_f64()*1e6/copies as f64);
}
