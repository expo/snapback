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
    let args = std::collections::BTreeMap::from([("seat_principal".into(), Value::Id("user:real".into()))]);
    let result = engine.mutate("bootstrapstaffRole1", None, Context::new("user:outsider", args.clone())).unwrap();
    assert!(format!("{result:?}").contains("NOT_OPERATOR"), "{result:?}");
    let result = engine.mutate("bootstrapstaffRole1", None, Context::new("service:ops", args)).unwrap();
    assert!(format!("{result:?}").contains("Sent"), "{result:?}");
}

#[test]
fn multiple_modules_rosters_roles_collisions_and_multiline_rules_compile() {
    let app = App::new(&format!("{}\nmutation bootstrapstaffRole1():\n  return 1\n", ROSTER.replace("read <- .principal = viewer", "read <- (\n    .principal = viewer -- preserve this explanation\n  )")));
    fs::write(app.0.join("snapback/other.q"), "table reviewers:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\nmutation bootstrapstaffRole1():\n  return 1\n").unwrap();
    let output = app.run(true); assert!(output.status.success(), "{output:?}");
    assert!(app.source().contains("mutation bootstrapstaffRole12("));
    assert!(app.source().contains("mutation bootstrapreviewers("));
    assert!(app.source().contains("-- preserve this explanation"));
    assert!(app.source().contains("role: 'admin'") && app.source().contains("role: 'reviewer'"));
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
    for (index, role) in ["admin", "reviewer"].iter().enumerate() {
        let args = std::collections::BTreeMap::from([("seat_principal".into(), Value::Id(format!("user:{role}")))]);
        let result = engine.mutate(&format!("bootstrapstaffRole{}", index + 1), None, Context::new("service:ops", args)).unwrap();
        assert!(format!("{result:?}").contains("Sent"), "{result:?}");
    }
}

#[test]
fn typed_roster_references_do_not_add_unrelated_parent_read_grants() {
    let app = App::new("use personas alice\ntable teams:\n  owner: principal\n  read <- .owner = viewer\n  online only\ntable members:\n  team: teams\n  principal: principal\n  unique team, principal\n  read <- .principal = viewer\n  online only\n");
    let output = app.run(true); assert!(output.status.success(), "{output:?}");
    let text = app.source();
    assert_eq!(text.matches("viewer = 'service:ops'").count(), 3, "only member read/insert and mutation guard: {text}");
    let bound = snapback4_lang::compile(&[("schema.q".into(), text)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("teams".into(), snapback4_core::value::object([("id", Value::Id("private-team".into())), ("owner", Value::Id("user:owner".into()))]))]).unwrap();
    let args = std::collections::BTreeMap::from([("seat_principal".into(), Value::Id("user:member".into())), ("seat_team".into(), Value::Id("private-team".into()))]);
    let result = engine.mutate("bootstrapmembers", None, Context::new("service:ops", args)).unwrap();
    assert!(format!("{result:?}").contains("Sent"), "{result:?}");
}


#[test]
fn principal_scan_excludes_hidden_and_test_sources_but_keeps_runtime_scripts() {
    let app = App::new(ROSTER);
    for path in [".checkpoint/src/App.tsx", ".scratch/nested/generator.mjs", "scripts/acceptance.mjs", "scripts/make-fixtures.mjs", "scripts/frontend-proof.mjs", "src/App.test.tsx", "src/nested/__tests__/picker.ts", "tests/client.mjs"] {
        let target = app.0.join(path);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(target, "const expected = 'dev:alice';\n").unwrap();
    }
    fs::write(app.0.join("scripts/server.mjs"), "const runtime = 'dev:alice';\n").unwrap();
    let output = app.run(false); assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8_lossy(&output.stdout);
    let findings: Vec<_> = text.lines().filter(|line| line.contains("hard-coded dev: principal")).collect();
    assert_eq!(findings.len(), 2, "{text}");
    assert!(findings.iter().any(|line| line.contains("src/App.tsx:1:")), "{text}");
    assert!(findings.iter().any(|line| line.contains("scripts/server.mjs:1:")), "{text}");
}


#[test]
fn custom_persona_entry_without_literal_principals_gets_a_runnable_recipe_pointer() {
    let app = App::new(ROSTER);
    fs::write(app.0.join("src/App.tsx"), "const app = usePersonaApp(selected, open);\n").unwrap();
    let output = app.run(false); assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8_lossy(&output.stdout);
    assert!(text.contains("src/App.tsx:1: custom persona entry hint"), "{text}");
    assert!(text.contains("Password plus development personas"), "{text}");
    assert!(text.contains("A guest session is a session") && text.contains("guests-only"), "{text}");
}

#[test]
fn fixture_only_roles_are_literal_even_with_service_rules_and_no_lint_cycle() {
    let source = ROSTER.replace("insert <- exists staff[viewer]", "insert <- viewer = 'service:ops'");
    let app = App::new(&source);
    let output = app.run(true); assert!(output.status.success(), "{output:?}");
    let revised = app.source();
    assert!(revised.contains("bootstrapstaffRole1(seat_principal: principal)"), "{revised}");
    assert!(revised.contains("role: 'admin'") && revised.contains("role: 'reviewer'"));
    assert!(!revised.contains("seat_role"), "role is fixed by each operation");
    assert!(app.run(true).status.success());assert_eq!(app.source(), revised);
    let bound = snapback4_lang::compile(&[("schema.q".into(), revised)]);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    for (i, role) in ["admin", "reviewer"].iter().enumerate() {
        let op = format!("bootstrapstaffRole{}", i + 1);
        let args = std::collections::BTreeMap::from([("seat_principal".into(), Value::Id(format!("user:{role}")))]);
        for outsider in ["user:outsider", "dev:alice"] {
            assert!(format!("{:?}", engine.mutate(&op, None, Context::new(outsider, args.clone())).unwrap()).contains("NOT_OPERATOR"));
        }
        assert!(format!("{:?}", engine.mutate(&op, None, Context::new("service:ops", args)).unwrap()).contains("Sent"));
    }
    let same_principal = std::collections::BTreeMap::from([("seat_principal".into(), Value::Id("user:admin".into()))]);
    assert!(format!("{:?}", engine.mutate("bootstrapstaffRole2", None, Context::new("service:ops", same_principal)).unwrap()).contains("E_UNIQUE"), "role provisioning must preserve one-role-per-principal constraints");
}


#[test]
fn production_mode_refuses_silently_ignored_starter_flags() {
    let app = App::new(ROSTER);
    for flag in ["--web", "--expo", "--day2"] {
        let output = Command::new(BIN).args(["init", "--adapt", "--production", flag]).current_dir(&app.0).output().unwrap();
        assert_eq!(output.status.code(), Some(2));
        assert!(String::from_utf8_lossy(&output.stderr).contains("--production does not take"), "{output:?}");
        assert_eq!(app.source(), ROSTER);
    }
}

#[test]
fn blocked_roster_with_existing_writer_retains_enum_argument_bootstrap_policy() {
    let writer = "\nmutation inviteMember(principal: principal):\n  require viewer = 'dev:alice' else DEV_ONLY\n  return insert staff {principal, role: 'reviewer'}\n";
    let app = App::new(&format!("{ROSTER}{writer}"));
    let output=app.run(true);assert!(output.status.success(), "{output:?}");
    let source=app.source();assert!(source.contains(writer), "authored writer stays byte-identical");
    assert!(source.contains("mutation bootstrapstaff(seat_principal: principal, seat_role: enum('admin', 'reviewer'))"), "{source}");
    assert!(!source.contains("mutation bootstrapstaffRole"));
    let bound=snapback4_lang::compile(&[("schema.q".into(),source.clone())]);assert!(bound.diagnostics.is_empty());
    let mut engine=Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
    let args=std::collections::BTreeMap::from([("seat_principal".into(),Value::Id("user:real".into())),("seat_role".into(),Value::String("admin".into()))]);
    assert!(format!("{:?}",engine.mutate("bootstrapstaff",None,Context::new("service:ops",args.clone())).unwrap()).contains("Sent"));
    assert!(format!("{:?}",engine.mutate("bootstrapstaff",None,Context::new("user:outsider",args)).unwrap()).contains("NOT_OPERATOR"));
    assert!(app.run(true).status.success());assert_eq!(app.source(),source);
}


#[test]
fn role_name_without_a_principal_column_is_a_review_message_not_a_grant() {
    let source="use personas alice\ntable preferences:\n  owner: text <=40\n  role: enum('light','dark')\n  unique owner\n  public 'preferences'\n  online only\n";
    let app=App::new(source);let output=app.run(true);assert!(output.status.success(),"{output:?}");
    assert!(String::from_utf8_lossy(&output.stdout).contains("preferences: review an application-specific first writer"));
    assert!(!app.source().contains("mutation bootstrap") && !app.source().contains("service:ops"));
}

#[test]
fn multi_role_unique_identity_keeps_coexisting_roles() {
    let app=App::new("use personas alice\ntable staff:\n  principal: principal\n  role: enum('admin','reviewer')\n  unique principal, role\n  read <- .principal = viewer\n  insert <- viewer = 'service:ops'\n  online only\n");
    let output=app.run(true);assert!(output.status.success(),"{output:?}");
    let bound=snapback4_lang::compile(&[("schema.q".into(),app.source())]);assert!(bound.diagnostics.is_empty());
    let mut engine=Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
    for number in 1..=2 {
        let args=std::collections::BTreeMap::from([("seat_principal".into(),Value::Id("user:both".into()))]);
        let reply=engine.mutate(&format!("bootstrapstaffRole{number}"),None,Context::new("service:ops",args)).unwrap();
        assert!(format!("{reply:?}").contains("Sent"),"{reply:?}");
    }
}
