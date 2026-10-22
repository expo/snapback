//! ROLL at the shipped CLI boundary; private copies are removed on every exit.
use serde_json::{Value, json};
use std::{
    fs,
    path::PathBuf,
    process::{Command, Output},
    sync::atomic::{AtomicU64, Ordering},
};
const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
struct App(PathBuf);
impl App {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let p = std::env::temp_dir().join(format!(
            "sb4-roll-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(p.join("snapback")).unwrap();
        Self(p)
    }
    fn source(&self, s: &str) {
        fs::write(self.0.join("snapback/schema.q"), s).unwrap();
    }
    fn run(&self, args: &[&str]) -> Output {
        Command::new(BIN)
            .args(args)
            .current_dir(&self.0)
            .env_remove("PORT_LO")
            .env_remove("PORT_HI")
            .output()
            .unwrap()
    }
    fn ok(&self, args: &[&str]) -> Output {
        let o = self.run(args);
        assert!(o.status.success(), "{}", text(&o));
        o
    }
    fn json(&self, args: &[&str]) -> Value {
        let o = self.ok(args);
        serde_json::from_slice(&o.stdout).unwrap_or_else(|e| panic!("{e}: {}", text(&o)))
    }
    fn seed(&self, source: &str, rows: Vec<Value>) {
        let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        let store =
            snapback4_core::store_port::AnyStore::open(&self.0.join("deployment/store.sqlite"))
                .unwrap();
        let n = store.release_value().unwrap().unwrap().parse().unwrap();
        let schema = b.schema.clone();
        let mut e = snapback4_core::Engine::new_release(
            store,
            b.schema,
            b.programs.into_iter().map(|p| p.program),
            n,
            Some(n),
        )
        .unwrap();
        e.seed(rows.into_iter().map(|row| {
            (
                "items".into(),
                snapback4_core::wire::row_from_json(&schema.tables["items"], &row).unwrap(),
            )
        }))
        .unwrap();
    }
    fn count(&self) -> u64 {
        self.json(&[
            "sql",
            "SELECT COUNT(*) FROM items",
            "--release",
            "deployment",
            "--json",
        ])["rows"][0][0]
            .as_u64()
            .unwrap()
    }
}
impl Drop for App {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn text(o: &Output) -> String {
    format!(
        "{}\n{}",
        String::from_utf8_lossy(&o.stdout),
        String::from_utf8_lossy(&o.stderr)
    )
}
const OLD: &str = "table items:\n  amount: int 100..50000\n  public 'fixture'\n  online only\ntable payments:\n  amount: int\n  public 'fixture'\n  insert <- allow\n  online only\nmutation pay(id: items):\n  a = items[id] ! else MISSING\n  return insert payments {amount:a.amount}\nquery read(id: items):\n  return items[id]\n";
fn newer() -> String {
    OLD.replace("amount: int 100..50000","amount: int 100..50000 ?").replace("  return insert payments","  require a.amount != null else NO_AMOUNT 'Amount to follow must not become a zero payment.'\n  return insert payments")
}

#[test]
fn default_rollback_uses_a_compiled_guarded_view_and_exact_remains_explicit() {
    let app = App::new();
    app.source(OLD);
    app.ok(&["deploy", "deployment", "--json"]);
    let original = fs::read(app.0.join("deployment/releases/1/snapback/schema.q")).unwrap();
    let next = newer();
    app.source(&next);
    let preview = app.json(&["deploy", "deployment", "--check", "--json"]);
    assert_eq!(preview["rollbackViews"].as_array().unwrap().len(), 1);
    assert_eq!(
        preview["rollbackViewEffects"][0]["visibility"]["hiddenRows"],
        0
    );
    assert_eq!(
        fs::read_dir(app.0.join("deployment/releases"))
            .unwrap()
            .count(),
        1,
        "preview leaves no prepared source"
    );
    let deployed = app.json(&["deploy", "deployment", "--json"]);
    assert_eq!(deployed["release"], 2);
    assert!(deployed["preview"]["clientCompatibility"].is_array());
    app.seed(&next, vec![json!({"id":"pending","amount":null})]);
    for _ in 0..2 {
        let rollback = app.json(&["rollback", "deployment", "--to", "1", "--json"]);
        assert_eq!(rollback["rollbackView"]["target"], 1);
        assert!(rollback["release"].as_u64().unwrap() > 2);
        assert_eq!(app.count(), 1);
        let selected = rollback["release"].as_u64().unwrap();
        let bridge = fs::read_to_string(
            app.0
                .join(format!("deployment/releases/{selected}/snapback/schema.q")),
        )
        .unwrap();
        assert!(
            bridge.contains("require (a.amount != null)")
                || bridge.contains("require a.amount != null"),
            "{bridge}"
        );
        assert!(!bridge.contains("?? 0"));
        app.ok(&["rollback", "deployment", "--to", "latest", "--json"]);
        assert_eq!(app.count(), 1);
    }
    let exact = app.json(&[
        "rollback",
        "deployment",
        "--to",
        "1",
        "--exact",
        "--check",
        "--json",
    ]);
    assert_eq!(exact["visibility"]["hiddenRows"], 1);
    app.ok(&["rollback", "deployment", "--to", "1", "--exact", "--json"]);
    assert_eq!(app.count(), 0);
    app.ok(&["rollback", "deployment", "--to", "latest", "--json"]);
    assert_eq!(app.count(), 1);
    assert_eq!(
        fs::read(app.0.join("deployment/releases/1/snapback/schema.q")).unwrap(),
        original
    );
    let releases = app.json(&["releases", "deployment"]);
    assert_eq!(releases["latest"], 2);
    assert_eq!(releases["rollbackViews"][0]["target"], 1);
    let unchanged = app.json(&["deploy", "deployment", "--json"]);
    assert_eq!(unchanged["unchanged"], true);
}

#[test]
fn hiding_acknowledges_only_null_and_keeps_widened_nonnull_values_visible() {
    let app = App::new();
    let old = "table items:\n  amount: int 0..100\n  public 'fixture'\n  online only\n";
    app.source(old);
    app.ok(&["deploy", "deployment", "--json"]);
    let next = "table items:\n  amount: int 0..1000 ?\n  public 'fixture'\n  online only\nrollback 1 hides items where amount = null because 'Fee to follow must not read as free.'\n";
    app.source(next);
    app.ok(&["deploy", "deployment", "--json"]);
    app.seed(
        next,
        vec![
            json!({"id":"pending","amount":null}),
            json!({"id":"quoted","amount":200}),
        ],
    );
    let preview = app.json(&["rollback", "deployment", "--to", "1", "--check", "--json"]);
    assert_eq!(preview["visibility"]["hiddenRows"], 1);
    let out = app.ok(&["rollback", "deployment", "--to", "1", "--json"]);
    assert!(text(&out).contains("Fee to follow must not read as free"));
    assert_eq!(app.count(), 1);
    let values = app.json(&[
        "sql",
        "SELECT amount FROM items",
        "--release",
        "deployment",
        "--json",
    ]);
    assert_eq!(values["rows"][0][0], 200);
    app.ok(&["rollback", "deployment", "--to", "latest", "--json"]);
    assert_eq!(app.count(), 2);
}

#[test]
fn deploy_verdict_leads_scoped_security_is_last_and_json_keeps_all_notes() {
    let app = App::new();
    let mut old = OLD.to_owned();
    for n in 0..8 {
        old.push_str(&format!(
            "table unchanged{n}:\n  read <- allow\n  online only\n"
        ));
    }
    fs::create_dir_all(app.0.join("versions/v1")).unwrap();
    fs::write(app.0.join("versions/v1/schema.q"), &old).unwrap();
    fs::write(
        app.0.join("snapback/client-compatibility.json"),
        r#"{"baseline":"versions/v1","since_release":2}"#,
    )
    .unwrap();
    app.source(&old);
    app.ok(&["deploy", "deployment", "--json"]);
    let next = old
        .replace("amount: int 100..50000", "amount: int 100..50000 ?")
        .replace(
            "  return insert payments",
            "  require a.amount != null else NO_AMOUNT\n  return insert payments",
        );
    app.source(&next);
    let out = app.ok(&["deploy", "deployment", "--schema", "snapback", "--check"]);
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stdout.starts_with("deploy verdict: READY"), "{stdout}");
    assert!(
        stderr
            .lines()
            .last()
            .unwrap()
            .starts_with("deploy verdict: READY"),
        "{stderr}"
    );
    let full = app.json(&[
        "deploy",
        "deployment",
        "--schema",
        "snapback",
        "--check",
        "--json",
    ]);
    assert!(
        full["security"]["report"]["notes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["message"].as_str().unwrap().contains("unchanged0"))
    );
    assert!(
        !full["security"]["notice"]
            .as_str()
            .unwrap()
            .contains("unchanged0"),
        "{}",
        full["security"]["notice"]
    );
    assert!(full["clientCompatibility"].as_array().unwrap().len() > 1);
}

#[test]
fn failed_guard_transport_does_not_register_or_leave_prepared_views(){
    let app=App::new();let old=OLD.replace("mutation pay", "fn permitted():\n  return viewer = 'alice'\nmutation pay").replace("  a = items[id]", "  require permitted() else FORBIDDEN\n  a = items[id]");
    app.source(&old);app.ok(&["deploy","deployment","--json"]);
    let next=old.replace("amount: int 100..50000", "amount: int 100..50000 ?").replace("viewer = 'alice'", "viewer = 'bob'").replace("  return insert payments", "  require a.amount != null else NO_AMOUNT\n  return insert payments");app.source(&next);
    for check in [true,false]{let args=if check{vec!["deploy","deployment","--check","--json"]}else{vec!["deploy","deployment","--json"]};let out=app.run(&args);assert!(!out.status.success(),"{}",text(&out));assert!(text(&out).contains("guard dependency"));assert_eq!(fs::read_dir(app.0.join("deployment/releases")).unwrap().count(),1);assert_eq!(app.json(&["releases","deployment"])["current"],1);}
}

#[test]
fn text_minimum_widening_registers_a_view_that_keeps_the_current_quota() {
    let app=App::new();
    let old="table items:\n  owner: principal\n  body: text 4..100\n  cap 2 by owner\n  public 'fixture'\n  insert <- allow\n  online only\nmutation add():\n  return insert items {owner:viewer,body:'kept'}\nquery all():\n  return items first 10 by .id\n";
    app.source(old);app.ok(&["deploy","deployment","--json"]);
    let next=old.replace("text 4..100","text <=100").replace("public 'fixture'","read <- .owner = viewer").replace("cap 2 by owner","cap 1 by owner\n  immutable owner");
    app.source(&next);let preview=app.json(&["deploy","deployment","--check","--json"]);
    assert_eq!(preview["rollbackViews"].as_array().unwrap().len(),1);
    app.ok(&["deploy","deployment","--json"]);app.seed(&next,vec![json!({"id":"short","owner":"alice","body":"x"})]);
    let selected=app.json(&["rollback","deployment","--to","1","--json"])["release"].as_u64().unwrap();assert_eq!(app.count(),1);
    let source=fs::read_to_string(app.0.join(format!("deployment/releases/{selected}/snapback/schema.q"))).unwrap();
    let b=snapback4_lang::compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty());
    let store=snapback4_core::store_port::AnyStore::open(&app.0.join("deployment/store.sqlite")).unwrap();
    let mut engine=snapback4_core::Engine::new_release(store,b.schema,b.programs.into_iter().map(|p|p.program),selected,Some(selected)).unwrap();
    let hidden=engine.query("all",snapback4_core::Context::new("bob",Default::default())).unwrap();assert_eq!(snapback4_core::wire::to_json(&hidden.data),json!([]));
    let write=engine.mutate("add",None,snapback4_core::Context::new("alice",Default::default())).unwrap();
    assert!(matches!(write.state,snapback4_core::WriteState::Failed{..}),"old quota would have admitted this second row: {write:?}");
    assert_eq!(engine.store().count("items").unwrap(),1);
}

#[test]
fn rollback_uses_active_source_context_after_a_later_branch_changed_privacy() {
    let app=App::new();let old=OLD.replacen("  amount: int 100..50000","  owner: principal\n  amount: int 100..50000",1);
    app.source(&old);app.ok(&["deploy","deployment","--json"]);
    let private=old.replace("amount: int 100..50000","amount: int 100..50000 ?").replacen("  public 'fixture'","  read <- .owner = viewer",1).replace("  return insert payments","  require a.amount != null else NO_AMOUNT\n  return insert payments");
    app.source(&private);let parent=app.json(&["deploy","deployment","--json"])["release"].as_u64().unwrap();
    app.seed(&private,vec![json!({"id":"pending","owner":"alice","amount":null})]);
    let public=private.replacen("  read <- .owner = viewer","  public 'fixture'",1);app.source(&public);app.ok(&["deploy","deployment","--json"]);
    app.ok(&["rollback","deployment","--to",&parent.to_string(),"--exact","--json"]);
    let selected=app.json(&["rollback","deployment","--to","1","--json"]);assert_eq!(selected["rollbackView"]["parent"],parent);
    let release=selected["release"].as_u64().unwrap();let source=fs::read_to_string(app.0.join(format!("deployment/releases/{release}/snapback/schema.q"))).unwrap();
    let b=snapback4_lang::compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty());let store=snapback4_core::store_port::AnyStore::open(&app.0.join("deployment/store.sqlite")).unwrap();
    let mut e=snapback4_core::Engine::new_release(store,b.schema,b.programs.into_iter().map(|p|p.program),release,Some(release)).unwrap();
    let outcome=e.query("read",snapback4_core::Context::new("bob",std::collections::BTreeMap::from([("id".into(),snapback4_core::Value::Id("pending".into()))]))).unwrap();
    assert_eq!(snapback4_core::wire::to_json(&outcome.data),json!(null));
}
