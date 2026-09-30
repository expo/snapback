//! Kill a real host at reproducible pseudo-random persistence instructions.
//! SQLite interrupts include the interior of replacement/index/coverage SQL.
//! The memory host models the web's indivisible save with fsync + atomic rename.
mod common;
use common::*;
use snapback4_core::{Value, value::object};
use snapback4_device::{call::call, device::{Backend, Device, StreamPage}, store::DeviceStore, memory::{Change, MemoryStore}};
use std::{fs, io::{BufRead, BufReader, Write}, path::{Path, PathBuf}, process::{Command, Stdio},
    sync::{Arc, atomic::{AtomicU64, Ordering::SeqCst}}, time::Duration};

#[derive(serde::Serialize, serde::Deserialize)]
struct Fixture { backend: Backend, old: Vec<StreamPage>, new: Vec<StreamPage> }

fn fixture() -> Fixture {
    let (mut engine, backend) = compile(&CHAT.replace("  by byConvTime:", "  search body\n  by byConvTime:"));
    let mut rows = Vec::new();
    for g in 0..12 {
        let group = format!("g{g:02}");
        rows.push(("conversations".into(), object([("id", id(&group)), ("title", Value::String(group.clone())), ("creatorId", id("dev:alice"))])));
        rows.push(("memberships".into(), object([("id", id(&format!("m{g:02}"))), ("conversationId", id(&group)), ("principal", id("dev:alice")), ("role", Value::String("admin".into())), ("joinedAt", Value::Int(0))])));
    }
    let messages = |start, end| (0..12).flat_map(move |g| (start..end).map(move |n| ("messages".into(), object([
        ("id", id(&format!("msg{g:02}-{n:04}"))), ("conversationId", id(&format!("g{g:02}"))), ("authorId", id("dev:alice")),
        ("body", Value::String(format!("durable acquired index coverage random crash message {g} {n}"))), ("at", Value::Int(n)),
    ])))).collect::<Vec<_>>();
    rows.extend(messages(0, 30)); engine.seed(rows).unwrap();
    let old = snapshot_pages(&mut engine, "dev:alice", 73);
    engine.seed(messages(30, 130)).unwrap();
    let new = snapshot_pages(&mut engine, "dev:alice", 137);
    Fixture { backend, old, new }
}

fn apply<S: DeviceStore>(d: &mut Device<S>, pages: &[StreamPage], mut save: impl FnMut(&Device<S>)) {
    let was_acquired = d.sync_state_read().unwrap().acquired;
    for (n, page) in pages.iter().enumerate() {
        d.apply(page, n == 0).unwrap(); save(d);
        assert_eq!(d.sync_state_read().unwrap().acquired, was_acquired || n+1 == pages.len(), "no early acquired");
    }
}

trait Physical: DeviceStore { fn images(&self, names: &[String]) -> Vec<(String,Value)>; }
impl Physical for snapback4_core::store::Store {
    fn images(&self, names: &[String]) -> Vec<(String,Value)> {
        names.iter().flat_map(|name| self.rows(name).unwrap().into_iter().map(|row| (name.clone(),row))).collect()
    }
}
impl Physical for MemoryStore {
    fn images(&self, _: &[String]) -> Vec<(String,Value)> {
        self.export().into_iter().filter(|c| c.s == 'r').map(|c| {
            let (table,_): (String,String) = serde_json::from_str(&c.k).unwrap();
            (table,serde_json::from_str(&c.v.unwrap()).unwrap())
        }).collect()
    }
}
fn image<S: Physical>(d: &mut Device<S>) -> serde_json::Value {
    let coverage = call(d, serde_json::json!({"op":"witness_coverage","viewer":"dev:alice"}));
    assert!(coverage.get("denied").is_none(), "{coverage}");
    let names: Vec<_> = d.schema().tables.keys().cloned().collect();
    let state = d.sync_state_read().unwrap();
    let rows = d.store().images(&names);
    serde_json::json!({"acquired":state.acquired,"watermark":state.watermark,
        "coverage":snapback4_core::value::digest(&coverage),"rows":snapback4_core::value::digest(&rows)})
}

#[derive(Clone)]
struct Cuts { count: Arc<AtomicU64>, target: u64 }
impl Cuts {
    fn tick(&self) {
        let n = self.count.fetch_add(1, SeqCst)+1;
        if n == self.target {
            println!("NA_KILL {n}"); std::io::stdout().flush().unwrap();
            loop { std::thread::park(); }
        }
    }
}

fn save_memory(d: &Device<MemoryStore>, dir: &Path, cuts: &Cuts) {
    let bytes = serde_json::to_vec(&d.store().export()).unwrap();
    let mut file = fs::File::create(dir.join("image.tmp")).unwrap();
    for chunk in bytes.chunks(4096) { cuts.tick(); file.write_all(chunk).unwrap(); }
    cuts.tick(); file.sync_all().unwrap(); cuts.tick();
    fs::rename(dir.join("image.tmp"), dir.join("image.json")).unwrap();
    cuts.tick(); fs::File::open(dir).unwrap().sync_all().unwrap(); cuts.tick();
}
fn open_memory(dir: &Path, backend: Backend) -> Device<MemoryStore> {
    let mut store = MemoryStore::new();
    if let Ok(bytes) = fs::read(dir.join("image.json")) { store.load(serde_json::from_slice::<Vec<Change>>(&bytes).unwrap()).unwrap(); }
    Device::open_store(store, Some(backend)).unwrap()
}

// Spawned only by the model below; returning here adds no skipped case.
#[test]
fn acquisition_crash_worker() {
    let Ok(dir) = std::env::var("NA_CRASH_DIR") else { return; };
    let dir = Path::new(&dir);
    let f: Fixture = serde_json::from_slice(&fs::read(dir.join("fixture.json")).unwrap()).unwrap();
    let cuts = Cuts { count: Arc::new(AtomicU64::new(0)), target: std::env::var("NA_CRASH_CUT").unwrap().parse().unwrap() };
    if std::env::var("NA_CRASH_TIER").unwrap() == "sqlite" {
        let mut d = snapback4_device::native::Device::open(&dir.join("store.sqlite"), Some(f.backend)).unwrap();
        let hook = cuts.clone();
        d.store().conn().progress_handler(200, Some(move || { hook.tick(); false })).unwrap();
        apply(&mut d, &f.new, |_| {});
        d.store().conn().progress_handler(0, None::<fn() -> bool>).unwrap();
    } else {
        let mut d = open_memory(dir, f.backend);
        apply(&mut d, &f.new, |d| save_memory(d, dir, &cuts));
    }
    println!("NA_DONE {}", cuts.count.load(SeqCst));
}

fn child(dir: &Path, tier: &str, target: u64) -> u64 {
    let mut child = Command::new(std::env::current_exe().unwrap()).args(["--exact", "acquisition_crash_worker", "--nocapture"])
        .env("NA_CRASH_DIR", dir).env("NA_CRASH_TIER", tier).env("NA_CRASH_CUT", target.to_string())
        .stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
    let stdout = child.stdout.take().unwrap();
    let (send, receive) = std::sync::mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let line = line.unwrap();
            if line.starts_with("NA_") { send.send(line).unwrap(); }
        }
    });
    let line = match receive.recv_timeout(Duration::from_secs(60)) {
        Ok(line) => line,
        Err(error) => { let _ = child.kill(); let _ = child.wait(); panic!("crash child {tier}/{target}: {error}"); }
    };
    if target != 0 {
        assert_eq!(line, format!("NA_KILL {target}"));
        child.kill().unwrap(); // SIGKILL on Unix: no destructors or SQLite close.
        assert!(!child.wait().unwrap().success());
    } else { assert!(child.wait().unwrap().success()); }
    reader.join().unwrap();
    line.split_whitespace().nth(1).unwrap().parse().unwrap()
}

fn prepare(dir: &Path, f: &Fixture, tier: &str, refresh: bool) -> serde_json::Value {
    fs::create_dir_all(dir).unwrap();
    fs::write(dir.join("fixture.json"), serde_json::to_vec(f).unwrap()).unwrap();
    if tier == "sqlite" {
        let mut d = snapback4_device::native::Device::open(&dir.join("store.sqlite"), Some(f.backend.clone())).unwrap();
        if refresh { apply(&mut d, &f.old, |_| {}); }
        image(&mut d)
    } else {
        let mut d = open_memory(dir, f.backend.clone());
        let cuts = Cuts { count: Arc::new(AtomicU64::new(0)), target: 0 };
        if refresh { apply(&mut d, &f.old, |d| save_memory(d,dir,&cuts)); }
        save_memory(&d,dir,&cuts);
        image(&mut d)
    }
}

fn verify<S: Physical>(d: &mut Device<S>, f: &Fixture, before: &serde_json::Value, expected: &serde_json::Value) {
    let interrupted = image(d);
    assert!(interrupted == *before || interrupted == *expected, "torn published partition: {interrupted} != {before} or {expected}");
    // A fresh owner cannot continue another owner's private snapshot. The
    // first page restarts staging while preserving any previously acquired image.
    if interrupted != *expected {
        if f.new.len() > 1 { assert!(d.apply(&f.new[1], false).is_err(), "orphan continuation acquired ownership"); }
        apply(d, &f.new, |_| {});
    }
    assert_eq!(image(d), *expected, "restart restores rows and coverage digest");
}

#[test]
fn random_process_kills_preserve_atomic_acquisition_on_both_stores() {
    let f = fixture();
    let root = std::env::temp_dir().join(format!("na-acquisition-crash-{}",std::process::id()));
    struct Cleanup(PathBuf);
    impl Drop for Cleanup { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    let _cleanup = Cleanup(root.clone());
    let mut random = 0xdce14a7258b9036fu64;
    for tier in ["sqlite", "memory"] { for refresh in [false,true] {
        let census = root.join(format!("{tier}-{refresh}-census"));
        prepare(&census,&f,tier,refresh);
        let count = child(&census,tier,0);
        let expected = if tier == "sqlite" {
            image(&mut snapback4_device::native::Device::open(&census.join("store.sqlite"),None).unwrap())
        } else { image(&mut open_memory(&census,f.backend.clone())) };
        for seed in 0..12 {
            random ^= random << 13; random ^= random >> 7; random ^= random << 17;
            let cut = match seed { 0 => 1, 1 => count, _ => 1+random%count };
            let dir = root.join(format!("{tier}-{refresh}-{seed}"));
            let before = prepare(&dir,&f,tier,refresh);
            child(&dir,tier,cut);
            if tier == "sqlite" {
                let mut d = snapback4_device::native::Device::open(&dir.join("store.sqlite"),None).unwrap();
                assert_eq!(d.store().conn().query_row("PRAGMA integrity_check",[],|r| r.get::<_,String>(0)).unwrap(),"ok");
                verify(&mut d,&f,&before,&expected);
                drop(d);
                assert_eq!(image(&mut snapback4_device::native::Device::open(&dir.join("store.sqlite"),None).unwrap()), expected);
            } else {
                let mut d = open_memory(&dir,f.backend.clone());
                verify(&mut d,&f,&before,&expected);
                save_memory(&d,&dir,&Cuts { count: Arc::new(AtomicU64::new(0)), target: 0 });
                drop(d);
                assert_eq!(image(&mut open_memory(&dir,f.backend.clone())), expected);
            }
            fs::remove_dir_all(dir).unwrap();
        }
        println!("{tier}, refresh={refresh}: 12 process kills, {count} persistence cuts");
    } }
}
