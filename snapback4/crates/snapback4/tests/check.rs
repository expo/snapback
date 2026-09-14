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
