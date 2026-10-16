//! Wave-13 saved source, contemporary fixtures and inherited scaffold regressions.
use std::{fs, path::PathBuf, process::{Command, Output}, sync::atomic::{AtomicUsize, Ordering}};
const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct App(PathBuf);
impl App {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("sb4-day3-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&path).unwrap(); Self(path)
    }
    fn run(&self, args: &[&str]) -> Output { self.command(args).output().unwrap() }
    fn command(&self, args: &[&str]) -> Command {
        let mut command = Command::new(BIN); command.args(args).current_dir(&self.0).env_remove("PORT_LO").env_remove("PORT_HI"); command
    }
    fn write(&self, path: &str, text: &str) { fs::create_dir_all(self.0.join(path).parent().unwrap()).unwrap(); fs::write(self.0.join(path), text).unwrap(); }
    fn text(&self, path: &str) -> String { fs::read_to_string(self.0.join(path)).unwrap() }
}
impl Drop for App { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
fn ok(output: Output) -> String { assert!(output.status.success(), "{output:?}"); String::from_utf8(output.stdout).unwrap() }
const V1: &str = "use personas alice\ntable notes:\n  title: text <=80\n  public 'test'\nquery list():\n  return notes first 20 by .id\n";
#[test]
fn saved_directory_and_file_prefer_contemporary_fixtures_and_strict_overrides() {
    let app = App::new(); app.write("snapback/schema.q", V1);
    app.write("versions/v1/schema.q", V1);
    app.write("versions/v1/fixtures/notes.jsonl", "{\"id\":\"old\",\"title\":\"contemporary\"}\n");
    app.write("versions/v1/fixtures/test.cases.jsonl", "{\"as\":\"alice\",\"op\":\"list\",\"count\":1,\"match\":[{\"title\":\"contemporary\"}]}\n");
    app.write("fixtures/later.jsonl", "not json\n");
    app.write("fixtures/test.cases.jsonl", "{\"as\":\"alice\",\"op\":\"laterOnly\"}\n");
    for source in ["versions/v1", "versions/v1/schema.q"] {
        let output = app.run(&["test", "--source", source]);
        assert!(String::from_utf8_lossy(&output.stderr).contains("contemporary fixtures"), "{output:?}"); ok(output);
        let strict = app.run(&["test", "--source", source, "--fixture", "fixtures"]);
        assert!(!strict.status.success(), "explicit working fixtures stay strict");
    }
    app.write("versions/legacy.q", V1);
    app.write("versions/legacy-fixtures/notes.jsonl", "{\"id\":\"legacy\",\"title\":\"legacy fixtures\"}\n");
    assert!(ok(app.run(&["test", "--source", "versions/legacy.q"])).contains("loaded 1 rows"));
}
#[test]
fn fallback_names_unknown_files_and_cases_but_never_drops_unknown_fields() {
    let app = App::new(); app.write("snapback/schema.q", V1); app.write("versions/v1.q", V1);
    app.write("fixtures/later.jsonl", "bad later data\n");
    app.write("fixtures/notes.jsonl", "{\"id\":\"one\",\"title\":\"old\"}\n");
    app.write("fixtures/test.cases.jsonl", "{\"op\":\"laterOnly\"}\n");
    let output = app.run(&["test", "--source", "versions/v1.q"]);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("skipped") && stderr.contains("later.jsonl") && stderr.contains("test.cases.jsonl") && stderr.contains("pass --fixture"), "{output:?}");
    assert!(ok(output).contains("loaded 1 rows"));
    app.write("fixtures/notes.jsonl", "{\"id\":\"one\",\"title\":\"old\",\"newField\":true}\n");
    assert!(!app.run(&["test", "--source", "versions/v1.q"]).status.success());
}
#[test]
fn check_detects_inherited_day2_script_and_preview_shows_its_replacement() {
    let app = App::new(); ok(app.run(&["init", "--web"]));
    let mut package: serde_json::Value = serde_json::from_str(&app.text("package.json")).unwrap();
    package["scripts"]["day2:proof"] = "node scripts/day2-proof.mjs".into();
    app.write("package.json", &serde_json::to_string_pretty(&package).unwrap());
    let check = ok(app.run(&["check"]));
    assert!(check.contains("info:") && check.contains("day2:proof passes no saved versions") && check.contains("init --adapt"), "{check}");
    let preview = ok(app.run(&["init", "--adapt"]));
    assert!(preview.contains("scripts.day2:proof:") && preview.contains("versions/v1 versions/v2") && preview.contains("preview only"), "{preview}");
    ok(app.run(&["init", "--adapt", "--apply"]));
    assert!(app.text("package.json").contains("node scripts/day2-proof.mjs versions/v1 versions/v2"));
    assert!(app.0.join("versions/v1/fixtures").is_dir());
    assert!(app.text("scripts/day2-proof.mjs").contains("assert.fail(`day2:proof needs a business assertion"));
    assert!(app.text("scripts/frontend-proof.mjs").contains("command(\"npm\", [\"run\", \"build\"]"));
}
#[test]
fn init_bakes_environment_ports_and_explicit_flags_win_without_client_reinference() {
    for mode in ["--web", "--expo"] {
        let app = App::new();
        let output = ok(app.command(&["init", mode]).env("PORT_LO", "29120").env("PORT_HI", "29129").output().unwrap());
        for path in ["src/client.ts", "README.md", "scripts/launch.mjs"] {
            assert!(!app.text(path).contains("127.0.0.1:4400"), "{mode}: {path}");
        }
        assert!(output.contains("http://127.0.0.1:29120") && output.contains("localhost:29121"), "{output}");
        let launcher = app.text("scripts/launch.mjs");
        app.write("src/client.ts", "// application owned URL at 127.0.0.1:4999\n");
        ok(app.run(&["init", "--adapt", "--apply"]));
        assert_eq!(app.text("scripts/launch.mjs"), launcher, "adapt preserves managed launcher defaults");
        let explicit = App::new();
        let output = ok(explicit.command(&["init", mode, "--port", "29124"]).env("PORT_LO", "29120").env("PORT_HI", "29129").output().unwrap());
        assert!(output.contains("http://127.0.0.1:29124") && output.contains("localhost:29125"), "{output}");
        assert!(explicit.text("src/client.ts").contains("http://127.0.0.1:29124"));
    }
}
#[test]
fn zero_sync_expo_writes_the_online_client_for_both_identity_modes() {
    for identity in ["use personas alice\n", "use identity password\n"] {
        let app = App::new(); app.write("snapback/schema.q", &format!("{identity}table notes:\n  title: text <=80\n  public 'test'\n"));
        ok(app.run(&["init", "--expo"]));
        let client = app.text("src/client.ts");
        assert!(client.contains("writes: \"online\"") && client.contains("tier = \"online\""), "{client}");
        assert!(!client.contains("webDevice") && !client.contains("nativeAvailable") && !client.contains("nativeDevice"), "{client}");
    }
}
#[test]
fn init_snapshots_modules_with_original_names_and_tests_the_saved_namespace() {
    let app = App::new(); app.write("snapback/schema.q", "use personas alice\n");
    app.write("snapback/notes.q", "table notes:\n  title: text <=80\n  public 'test'\nquery list():\n  return notes first 20 by .id\n");
    app.write("fixtures/test.cases.jsonl", "{\"as\":\"alice\",\"op\":\"notes.list\",\"count\":0}\n");
    ok(app.run(&["init", "--web"]));
    assert_eq!(app.text("versions/v1/notes.q"), app.text("snapback/notes.q"));
    assert_eq!(app.text("versions/v1/schema.q"), "use personas alice\n");
    let output = ok(app.run(&["test", "--source", "versions/v1"]));
    assert!(output.contains("notes.list"), "{output}");
}
#[test]
fn doctor_reports_and_repairs_missing_expiry_parent_using_stored_schema() {
    use snapback4_core::{Engine, Store, Value, value::object};
    let app = App::new();
    let source = "table parents:\n  until: time\n  public 'test'\n  expire at .until\ntable children:\n  parent: parents on delete cascade\n  cap 5 by parent\n  public 'test'\n";
    app.write("snapback/schema.q", source);
    fs::create_dir_all(app.0.join(".snapback4")).unwrap();
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty());
    let path = app.0.join(".snapback4/store.sqlite");
    let mut engine = Engine::new_at(Store::open(&path).unwrap(), bound.schema, [], 0).unwrap();
    engine.seed_at(vec![
        ("parents".into(), object([("id", Value::Id("p".into())), ("until", Value::Int(10))])),
        ("children".into(), object([("id", Value::Id("c".into())), ("parent", Value::Id("p".into()))])),
    ], 0).unwrap();
    let table = engine.schema().tables["parents"].clone();
    { let tx = engine.store_mut().transaction().unwrap(); let row = tx.get("parents", "p").unwrap().unwrap(); tx.delete("parents", &table, &row).unwrap(); tx.commit().unwrap(); }
    drop(engine);
    // An unrelated broken working edit must not choose or alter the repair policy.
    app.write("snapback/schema.q", "invalid working source");
    let finding = app.run(&["doctor"]);
    assert!(!finding.status.success());
    let text = String::from_utf8_lossy(&finding.stdout);
    assert!(text.contains("E_EXPIRY_ORPHAN") && text.contains("--repair-expiry-orphan 'parents:p'"), "{finding:?}");
    let repaired = ok(app.run(&["doctor", "--repair-expiry-orphan", "parents:p"]));
    assert!(repaired.contains("1 rows written"), "{repaired}");
    assert!(ok(app.run(&["doctor", "--repair-expiry-orphan", "parents:p"])).contains("0 rows written"));
    let engine = Engine::open(Store::open(&path).unwrap()).unwrap();
    assert!(engine.store().rows("children").unwrap().is_empty());
    assert_eq!(app.text("snapback/schema.q"), "invalid working source");
}
#[test]
fn adapting_never_extends_historical_versions_with_current_modules_or_fixtures() {
    let app = App::new(); ok(app.run(&["init", "--web"]));
    fn tree(path: &std::path::Path) -> Vec<(PathBuf, Vec<u8>)> {
        let mut found = Vec::new();
        for entry in fs::read_dir(path).unwrap() {
            let entry = entry.unwrap();
            if entry.path().is_dir() { found.extend(tree(&entry.path())); }
            else { found.push((entry.path(), fs::read(entry.path()).unwrap())); }
        }
        found.sort(); found
    }
    let before = tree(&app.0.join("versions"));
    app.write("snapback/newer.q", "query added():\n  return true\n");
    app.write("fixtures/newer.jsonl", "{\"id\":\"later fixture\"}\n");
    ok(app.run(&["init", "--adapt", "--apply"]));
    assert_eq!(tree(&app.0.join("versions")), before);
    ok(app.run(&["init", "--web", "--skip-existing"]));
    assert_eq!(tree(&app.0.join("versions")), before);
}
#[test]
fn every_baseline_failure_reports_absolute_location_and_original_root() {
    let app = App::new(); app.write("snapback/schema.q", V1);
    app.write("snapback/client-compatibility.json", "{\"baseline\":\"versions/v1\",\"since_release\":2}");
    fs::create_dir_all(app.0.join("versions/v1")).unwrap();
    for invalid_source in [None, Some("invalid saved source")] {
        if let Some(source) = invalid_source { app.write("versions/v1/schema.q", source); }
        let result = app.run(&["check"]);
        assert!(!result.status.success());
        let text = String::from_utf8_lossy(&result.stderr);
        assert!(text.contains(app.0.join("versions/v1").to_str().unwrap()) && text.contains("resolved from") && text.contains("snapback/client-compatibility.json") && text.contains("project root"), "{result:?}");
    }
}
#[test]
fn explicit_saved_source_fixtures_never_skip_even_exact_starter_sample_rows() {
    let app = App::new(); app.write("snapback/schema.q", V1); app.write("versions/v1/schema.q", V1);
    app.write("chosen/todos.jsonl", include_str!("../src/verbs/init/starter/fixtures/todos.jsonl"));
    let output = app.run(&["test", "--source", "versions/v1", "--fixture", "chosen"]);
    assert!(!output.status.success(), "{output:?}");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("todos.jsonl") && stderr.contains("nothing was run"), "{output:?}");
}
#[test]
fn actual_router_social_starter_repairs_inherited_proofs_without_touching_routes() {
    let app = App::new(); ok(app.run(&["init", "--template", "social"]));
    assert!(app.0.join("app/_layout.tsx").exists() && !app.0.join("App.tsx").exists());
    let route = app.text("app/_layout.tsx"); let profile = app.text("src/Profile.tsx");
    let previous = include_str!("../src/verbs/init/previous/frontend-proof-0.4.29.mjs")
        .replace("// TEMPLATE_READY", "await page.getByText(\"Profile\", { exact: true }).click();")
        .replace("getByLabel(\"Task\"", "getByLabel(\"Display name\"")
        .replace("name: \"Add\"", "name: \"Save profile\"")
        .replace("beginForm(\"add\", { title }", "beginForm(\"saveProfile\", { name: title }");
    app.write("scripts/frontend-proof.mjs", &previous);
    let mut package: serde_json::Value = serde_json::from_str(&app.text("package.json")).unwrap();
    package["scripts"]["day2:proof"] = "node scripts/day2-proof.mjs".into();
    app.write("package.json", &serde_json::to_string_pretty(&package).unwrap());
    assert!(ok(app.run(&["check"])).contains("day2:proof passes no saved versions"));
    let preview = ok(app.run(&["init", "--adapt"]));
    assert!(preview.contains("replace scripts/frontend-proof.mjs"), "{preview}");
    assert_eq!(app.text("scripts/frontend-proof.mjs"), previous, "preview writes nothing");
    ok(app.run(&["init", "--adapt", "--apply"]));
    let proof = app.text("scripts/frontend-proof.mjs");
    assert!(proof.contains("[\"run\", \"build:web\"]") && proof.contains("Save profile") && proof.contains("getByText(\"Profile\""), "{proof}");
    assert!(app.text("package.json").contains("day2-proof.mjs versions/v1 versions/v2"));
    assert_eq!(app.text("app/_layout.tsx"), route); assert_eq!(app.text("src/Profile.tsx"), profile);
}
