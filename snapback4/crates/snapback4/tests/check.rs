//! check's read-only assessment of the active dev generation and its rows.
use snapback4_core::{Engine, Store, wire};
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};

const SOURCE: &str = "table messages:\n  body: text <=100\n  read <- allow\nquery all():\n  return messages[] first 10 by byId\n";
const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
struct Project(PathBuf);
impl Project {
    fn new() -> Self {
        static SERIAL: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!("sb4-cu4-check-{}-{}", std::process::id(), SERIAL.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(dir.join("snapback")).unwrap();
        let project = Self(dir);
        project.source(SOURCE);
        project
    }
    fn source(&self, source: &str) { fs::write(self.0.join("snapback/schema.q"), source).unwrap(); }
    fn store(&self) -> PathBuf { self.0.join(".snapback4/store.sqlite") }
    fn run(&self, args: &[&str]) -> Output { Command::new(BIN).current_dir(&self.0).args(args).output().unwrap() }
    fn seed(&self, path: &Path, count: usize) -> Engine {
        let b = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
        let mut engine = Engine::new(Store::open(path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        let table = engine.schema().tables["messages"].clone();
        engine.seed((0..count).map(|i| ("messages".into(), wire::row_from_json(&table, &json!({"id": format!("m{i}"), "body": "old"})).unwrap()))).unwrap();
        engine
    }
}
impl Drop for Project { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
fn parsed(output: &Output) -> Value { serde_json::from_slice(&output.stdout).unwrap_or_else(|_| panic!("{output:?}")) }

#[test]
fn check_without_a_store_and_additive_or_fitting_adoption_are_quiet() {
    let p = Project::new();
    assert!(p.run(&["check", "--json"]).status.success());
    assert!(!p.store().exists());
    let e = p.seed(&p.store(), 3);
    let before = e.store().rows("messages").unwrap();
    let seq = e.seq().unwrap();
    for source in [SOURCE.to_owned(), SOURCE.replace("  read", "  tombstone: bool default false\n  by byTombstone: tombstone, id\n  read"), SOURCE.replace("<=100", "<=3")] {
        p.source(&source);
        let output = p.run(&["check", "--json"]);
        assert!(output.status.success(), "{output:?}");
        assert_eq!(parsed(&output)["ok"], true);
        assert!(parsed(&output).get("problems").is_none());
        assert!(!String::from_utf8_lossy(&output.stdout).contains("E_ADOPT"));
        assert!(output.stderr.is_empty());
        assert_eq!(e.store().meta("generation").unwrap().as_deref(), Some("1"));
        assert_eq!(e.store().rows("messages").unwrap(), before);
        assert_eq!(e.seq().unwrap(), seq);
    }
    let readonly = Store::open_read_only(&p.store()).unwrap();
    assert!(readonly.set_meta("cu4-must-not-write", "1").is_err());
}

#[test]
fn check_reports_all_narrowing_sites_in_text_and_json_without_adopting() {
    let p = Project::new();
    let e = p.seed(&p.store(), 3);
    p.source(&SOURCE.replace("  read", "  at: time default now\n  author: principal default viewer\n  read"));
    let output = p.run(&["check", "--json"]);
    assert_eq!(output.status.code(), Some(1));
    let report = parsed(&output);
    assert_eq!(report["ok"], false);
    assert_eq!(report["problems"].as_array().unwrap().len(), 2);
    for (i, column, kind, word, noun, line) in [(0, "at", "time", "now", "clock", 3), (1, "author", "principal", "viewer", "viewer", 4)] {
        let d = &report["problems"][i];
        assert_eq!(d["code"], "E_ADOPT");
        assert_eq!(d["site"], json!({"file": "schema.q", "line": line, "col": 3}));
        assert_eq!(d["message"], format!("column messages.{column} is added as required with default {word}; existing rows would read the adoption's {noun}"));
        assert_eq!(d["rewrite"], format!("{column}: {kind} ? or {column}: {kind} default <literal>; otherwise backfill existing rows before making the column required"));
        assert_eq!(d["guide"], "types");
    }
    p.source(&SOURCE.replace("  read", "  at: time default now\n  read"));
    let output = p.run(&["check"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    let text = String::from_utf8(output.stderr).unwrap();
    assert_eq!(text, "schema.q:3:3 — E_ADOPT: column messages.at is added as required with default now; existing rows would read the adoption's clock\n  rewrite: at: time ? or at: time default <literal>; otherwise backfill existing rows before making the column required\n  guide: types\n\ncheck: 1 problem\n");
    println!("{text}");
    assert_eq!(e.store().meta("generation").unwrap().as_deref(), Some("1"));
    assert_eq!(e.store().rows("messages").unwrap().len(), 3);
}

#[test]
fn check_uses_explicit_store_and_locates_index_and_table_refusals() {
    let p = Project::new();
    let path = p.0.join("other/store.sqlite");
    let _e = p.seed(&path, 3);
    for (extra, line) in [("  unique byBody: body\n", 3), ("  by byBody: body\n  cap 2 by body\n", 1)] {
        p.source(&SOURCE.replace("  read", &format!("{extra}  read")));
        assert!(p.run(&["check", "--json"]).status.success(), "no default dev store");
        let output = p.run(&["check", "--store", path.to_str().unwrap(), "--json"]);
        assert_eq!(output.status.code(), Some(1), "{output:?}");
        let d = parsed(&output)["problems"][0].clone();
        assert_eq!(d["code"], "E_ADOPT");
        assert_eq!(d["site"]["line"], line);
    }
    let missing = p.0.join("missing.sqlite");
    assert_eq!(p.run(&["check", "--store", missing.to_str().unwrap()]).status.code(), Some(2));
    assert!(!missing.exists());
}

#[test]
fn check_accepts_contextual_defaults_for_an_empty_dev_table() {
    let p = Project::new();
    let _e = p.seed(&p.store(), 0);
    p.source(&SOURCE.replace("  read", "  at: time default now\n  author: principal default viewer\n  read"));
    let output = p.run(&["check", "--json"]);
    assert!(output.status.success(), "{output:?}");
    assert!(parsed(&output).get("problems").is_none());
}

#[test]
fn inspection_materializes_required_literals_but_not_optional_defaults() {
    let p = Project::new();
    let mut e = p.seed(&p.store(), 1);
    let source = SOURCE.replace("  read", "  tombstone: bool default false\n  score: int default -7\n  label: text <=20 default \"O'Reilly\"\n  role: enum('member', 'admin') default 'member'\n  amount: decimal 2 default 125\n  room: id default 'r'\n  optional: bool ? default true\n  read");
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    // The working source remains old: inspection must use the stored generation.
    let sql = p.run(&["sql", "SELECT tombstone, score, label, role, amount, room, optional FROM messages", "--json"]);
    assert!(sql.status.success(), "{sql:?}");
    let data = p.run(&["data", "messages"]);
    println!("inspection SQL={} data={}", String::from_utf8_lossy(&sql.stdout), String::from_utf8_lossy(&data.stdout));
    assert_eq!(parsed(&sql)["rows"], json!([[0, -7, "O'Reilly", "member", 125, "r", null]]));
    assert!(data.status.success(), "{data:?}");
    assert_eq!(parsed(&data), json!({"id":"m0", "body":"old", "tombstone":false,"score":-7,"label":"O'Reilly","role":"member","amount":125,"room":"r","optional":null}));
    assert!(e.store().rows("messages").unwrap()[0].field("tombstone").is_err());
    let explicit = json!({"id":"explicit", "body":"new", "tombstone":true,"score":0,"label":"","role":"admin","amount":0,"room":"other","optional":false});
    let row = wire::row_from_json(&e.schema().tables["messages"], &explicit).unwrap();
    e.seed([("messages".into(), row)]).unwrap();
    let sql = p.run(&["sql", "SELECT tombstone, score, label, role, amount, room, optional FROM messages WHERE id = 'explicit'", "--json"]);
    assert_eq!(parsed(&sql)["rows"], json!([[1, 0, "", "admin", 0, "other", 0]]));
    let data = p.run(&["data", "messages"]);
    let lines: Vec<Value> = String::from_utf8(data.stdout).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
    assert!(lines.contains(&explicit), "explicit values win over defaults");
}

fn invariant_default_project(unique: bool, collides: bool) -> Project {
    let p = Project::new();
    let mut e = p.seed(&p.store(), 1);
    let index = if unique { "  unique byFlag: flag\n" } else { "  by byFlag: flag, id\n  cap 1 by flag\n" };
    let source = SOURCE.replace("  read", &format!("  flag: bool default false\n{index}  read"));
    let b = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    if collides {
        let table = &e.schema().tables["messages"];
        let row = wire::row_from_json(table, &json!({"id":"explicit", "body":"new", "flag":true})).unwrap();
        e.seed([("messages".into(), row)]).unwrap();
    }
    p.source(&source.replace("default false", "default true"));
    p
}

fn changed_default_refuses(unique: bool) {
    let p = invariant_default_project(unique, true);
    let output = p.run(&["check", "--json"]);
    let dev = p.run(&["dev", "--no-watch", "--port", "0"]);
    println!("dev unique={unique}: {}", String::from_utf8_lossy(&dev.stderr));
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let report = parsed(&output);
    assert_eq!(report["problems"].as_array().unwrap().len(), 1);
    let d = &report["problems"][0];
    assert_eq!(d["code"], "E_ADOPT");
    assert_eq!(d["site"], json!({"file":"schema.q", "line":3, "col":3}));
    assert_eq!(d["message"], "column messages.flag changes its default; existing rows must fit the new definition");
    assert!(!dev.status.success());
    let text = String::from_utf8(dev.stderr).unwrap();
    let reason: String = serde_json::from_str(text.split_once("reason=").unwrap().1.trim()).unwrap();
    assert_eq!(reason, format!("E_ADOPT: {}\n  rewrite: {}", d["message"].as_str().unwrap(), d["rewrite"].as_str().unwrap()));
    println!("changed default unique={unique}: check exit=1, dev refusal={text}");
}
#[test]
fn changed_default_rechecks_unchanged_unique_index() { changed_default_refuses(true); }
#[test]
fn changed_default_rechecks_unchanged_cap() { changed_default_refuses(false); }
#[test]
fn changed_default_that_still_fits_existing_groups_is_adoptable() {
    for unique in [true, false] {
        let p = invariant_default_project(unique, false);
        assert!(p.run(&["check", "--json"]).status.success());
        let source = fs::read_to_string(p.0.join("snapback/schema.q")).unwrap();
        let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
        let mut e = Engine::open(Store::open(&p.store()).unwrap()).unwrap();
        e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        assert_eq!(e.query("all", snapback4_core::Context::new("alice", Default::default())).unwrap().data.as_array().unwrap()[0].field("flag").unwrap(), &snapback4_core::Value::Bool(true));
    }
}

struct Dev(std::process::Child);
impl Drop for Dev { fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); } }
fn start_dev(p: &Project) -> Dev {
    use std::time::{Duration, Instant};
    let stdout = p.0.join("dev.stdout");
    let stderr = p.0.join("dev.stderr");
    let mut dev = Dev(Command::new(BIN).args(["dev", "--no-watch", "--port", "0"]).current_dir(&p.0)
        .stdout(fs::File::create(&stdout).unwrap()).stderr(fs::File::create(&stderr).unwrap()).spawn().unwrap());
    let until = Instant::now() + Duration::from_secs(15);
    while !fs::read_to_string(&stdout).unwrap().contains('\n') {
        assert!(dev.0.try_wait().unwrap().is_none(), "{}", fs::read_to_string(&stderr).unwrap());
        assert!(Instant::now() < until, "dev launch timed out: {}", fs::read_to_string(&stderr).unwrap());
        std::thread::sleep(Duration::from_millis(10));
    }
    dev
}
fn durable_bytes(p: &Project) -> Vec<(usize, String)> {
    use sha2::{Digest, Sha256};
    ["", "-wal"].iter().map(|suffix| {
        let bytes = fs::read(format!("{}{suffix}", p.store().display())).unwrap();
        (bytes.len(), format!("{:x}", Sha256::digest(&bytes)))
    }).collect()
}
#[test]
fn check_preserves_database_and_wal_bytes_with_live_and_stopped_dev() {
    let p = Project::new();
    drop(p.seed(&p.store(), 3));
    let mut dev = start_dev(&p);
    // Make a durable WAL frame while dev holds the store, with no background writes.
    {
        let store = Store::open(&p.store()).unwrap();
        store.set_meta("wal-readonly-control", "1").unwrap();
    }
    for state in ["live", "stopped", "stopped-without-shm"] {
        if state == "stopped" { dev.0.kill().unwrap(); dev.0.wait().unwrap(); }
        if state == "stopped-without-shm" { fs::remove_file(format!("{}-shm", p.store().display())).unwrap(); }
        let before = durable_bytes(&p);
        assert!(before[1].0 > 0, "exercise WAL frames");
        let output = p.run(&["check", "--json"]);
        assert!(output.status.success(), "{output:?}");
        assert_eq!(durable_bytes(&p), before, "{state}: check changed durable SQLite bytes");
        let shm = PathBuf::from(format!("{}-shm", p.store().display())).exists();
        println!("WAL {state}: db_bytes={} wal_bytes={} db_sha256={} wal_sha256={} unchanged=true shm_present={shm}", before[0].0, before[1].0, before[0].1, before[1].1);
        if state == "stopped-without-shm" && shm {
            // SQLite's normal WAL reader may create its shared read-lock index.
            // It is transient coordination, never a database or WAL write.
            assert_eq!(durable_bytes(&p), before);
        } else if state == "stopped-without-shm" { assert!(!shm); }
    }
}
