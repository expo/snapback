//! The preview must be a usable, explicit authority change on real source.
use std::{fs, path::PathBuf, process::Command, sync::atomic::{AtomicUsize, Ordering}};
use snapback4_core::{Engine, Context, Value};
const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
struct App(PathBuf);
impl App {
    fn new(source: &str) -> Self {
        static SERIAL: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!("sb4-production-{}-{}", std::process::id(), SERIAL.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(root.join("snapback")).unwrap();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("snapback/schema.q"), source).unwrap();
        fs::write(root.join("src/App.tsx"), "export const principal = 'dev:alice';\n").unwrap();
        Self(root)
    }
    fn run(&self, apply: bool) -> std::process::Output {
        let mut command = Command::new(BIN);
        command.args(["init", "--adapt", "--production"]);
        if apply { command.arg("--apply"); }
        command.current_dir(&self.0).output().unwrap()
    }
    fn source(&self) -> String { fs::read_to_string(self.0.join("snapback/schema.q")).unwrap() }
}
impl Drop for App { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
const ROSTER: &str = "use personas alice, bob\ntable staff:\n  principal: principal default viewer\n  role: enum('admin', 'reviewer')\n  unique principal\n  immutable principal\n  read <- .principal = viewer\n  insert <- exists staff[viewer]\n  sync\nquery who():\n  return viewer\nquery mine():\n  return staff[viewer]\n";

#[test]
fn preview_apply_and_service_writes_preserve_application_ownership() {
    let app = App::new(ROSTER);
    fs::create_dir(app.0.join("fixtures")).unwrap();
    fs::write(app.0.join("fixtures/staff.jsonl"), "fixture-owned\n").unwrap();
    let output = app.run(false);
    assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8_lossy(&output.stdout);
    assert!(text.contains("N_NO_PRODUCTION_WRITER tables") && text.contains("bootstrapstaff"), "{text}");
    assert!(text.contains("src/App.tsx:1: hard-coded dev:"), "{text}");
    assert_eq!(app.source(), ROSTER);
    let output = app.run(true); assert!(output.status.success(), "{output:?}");
    let revised = app.source(); assert!(revised.starts_with("use identity\n"));
    assert_eq!(fs::read_to_string(app.0.join("src/App.tsx")).unwrap(), "export const principal = 'dev:alice';\n");
    assert_eq!(fs::read_to_string(app.0.join("fixtures/staff.jsonl")).unwrap(), "fixture-owned\n");
    assert!(app.run(true).status.success()); assert_eq!(app.source(), revised, "idempotent apply");
    let bound = snapback4_lang::compile(&[("schema.q".into(), revised)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.schema.auth.password && bound.schema.auth.guests);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let args = std::collections::BTreeMap::from([("seat_principal".into(), Value::Id("user:real".into())), ("seat_role".into(), Value::String("admin".into()))]);
    let result = engine.mutate("bootstrapstaff", None, Context::new("user:outsider", args.clone())).unwrap();
    assert!(format!("{result:?}").contains("NOT_OPERATOR"), "{result:?}");
    let result = engine.mutate("bootstrapstaff", None, Context::new("service:ops", args)).unwrap();
    assert!(format!("{result:?}").contains("Sent"), "{result:?}");
}

#[test]
fn multiple_modules_rosters_roles_collisions_and_multiline_rules_compile() {
    let app = App::new(&format!("{}\nmutation bootstrapstaff():\n  return 1\n", ROSTER.replace("read <- .principal = viewer", "read <- (\n    .principal = viewer -- preserve this explanation\n  )")));
    fs::write(app.0.join("snapback/other.q"), "table reviewers:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\nmutation bootstrapstaff():\n  return 1\n").unwrap();
    let output = app.run(true); assert!(output.status.success(), "{output:?}");
    assert!(app.source().contains("mutation bootstrapstaff2("));
    assert!(app.source().contains("mutation bootstrapreviewers("));
    assert!(app.source().contains("-- preserve this explanation"));
    assert!(app.source().contains("seat_role: enum('admin', 'reviewer')"));
    let sources = ["schema.q", "other.q"].map(|file| (file.into(), fs::read_to_string(app.0.join("snapback").join(file)).unwrap()));
    let bound = snapback4_lang::compile(&sources);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
}

#[test]
fn identity_methods_and_non_roster_roots_are_explicit() {
    for method in ["password", "guests"] {
        let source = format!("use identity {method}\n{ROSTER}\ntable catalogue:\n  title: text <=40\n  public 'catalogue'\n  online only\n");
        let app = App::new(&source);
        let output = app.run(true); assert!(output.status.success(), "{output:?}");
        let text = String::from_utf8_lossy(&output.stdout);
        assert!(text.contains("catalogue: review an application-specific first writer"), "{text}");
        assert_eq!(app.source().matches("use identity").count(), 1);
        assert!(app.source().starts_with(&format!("use identity {method}\n")));
    }
}

#[test]
fn malformed_schema_and_flags_write_nothing() {
    let app = App::new("table broken:\n  x: noSuchType\n");
    let before = app.source(); assert!(!app.run(true).status.success()); assert_eq!(app.source(), before);
    for flags in [vec!["init", "--production"], vec!["init", "--adapt", "--production", "--dry-run", "--apply"]] {
        let output = Command::new(BIN).args(flags).current_dir(&app.0).output().unwrap();
        assert!(!output.status.success()); assert_eq!(app.source(), before);
    }
}

#[cfg(unix)]
#[test]
fn source_symlinks_are_refused_and_frontend_symlinks_not_followed() {
    let app = App::new(ROSTER);
    fs::rename(app.0.join("snapback/schema.q"), app.0.join("original.q")).unwrap();
    std::os::unix::fs::symlink(app.0.join("original.q"), app.0.join("snapback/schema.q")).unwrap();
    let output = app.run(true); assert!(!output.status.success(), "{output:?}");
    assert_eq!(fs::read_to_string(app.0.join("original.q")).unwrap(), ROSTER);
    fs::remove_file(app.0.join("snapback/schema.q")).unwrap();
    fs::rename(app.0.join("original.q"), app.0.join("snapback/schema.q")).unwrap();
    std::os::unix::fs::symlink(app.0.join("src"), app.0.join("src/loop")).unwrap();
    assert!(app.run(false).status.success());
}


#[test]
fn default_roles_and_conditional_seat_rules_bootstrap_an_empty_store() {
    let app = App::new(&ROSTER.replace("role: enum('admin', 'reviewer')", "role: enum('admin', 'reviewer') default 'reviewer'")
        .replace("insert <- exists staff[viewer]", "insert <- viewer = 'service:ops' and exists staff[viewer]"));
    let output = app.run(true); assert!(output.status.success(), "{output:?}");
    let bound = snapback4_lang::compile(&[("schema.q".into(), app.source())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    for role in ["admin", "reviewer"] {
        let args = std::collections::BTreeMap::from([("seat_principal".into(), Value::Id(format!("user:{role}"))), ("seat_role".into(), Value::String(role.into()))]);
        let result = engine.mutate("bootstrapstaff", None, Context::new("service:ops", args)).unwrap();
        assert!(format!("{result:?}").contains("Sent"), "{result:?}");
    }
}
