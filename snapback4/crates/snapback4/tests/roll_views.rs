//! ROLL at the shipped CLI boundary; private copies are removed on every exit.
use serde_json::{Value, json};
use std::{
    fs,
    path::PathBuf,
    process::{Command, Output},
    sync::atomic::{AtomicU64, Ordering},
};
const BIN: &str = env!("CARGO_BIN_EXE_snapback4");

#[test]
fn current_first_worker_dependency_cannot_disappear_from_an_intent_view() {
    let app=App::new();
    let old="table docs:\n  owner: principal\n  amount: int 0..10\n  public\n  online only\nmutation create():\n  return insert docs {owner:viewer,amount:1}\n";
    app.source(old);app.ok(&["deploy","deployment"]);
    app.source(&format!("{}invariant docs.read only true\n",old.replace("amount: int 0..10","amount: int 0..20")));
    fs::write(app.0.join("snapback/worker.mjs"),"export {};\n").unwrap();
    for check in [true,false] {
        let args=if check {vec!["deploy","deployment","--check"]}else{vec!["deploy","deployment"]};
        let out=app.run(&args);assert!(!out.status.success(),"{}",text(&out));
        assert!(text(&out).contains("authored worker bundle"),"{}",text(&out));
        assert_eq!(app.json(&["releases","deployment"])["current"],1);
    }
}
struct App(PathBuf);

#[test]
fn unchanged_quarry_cannot_roll_back_an_executable_only_policy_repair() {
    let app=App::new();
    app.source("table docs:\n  owner: principal\n  public\n  online only\ninvariant docs.read only true\n");
    let worker=app.0.join("snapback/worker.mjs");fs::write(&worker,"export {}; // original\n").unwrap();
    app.ok(&["deploy","deployment"]);
    app.ok(&["deploy","deployment"]); // Identical executable remains a no-op.
    assert_eq!(app.json(&["releases","deployment"])["current"],1);
    fs::write(&worker,"export {}; // policy repair with identical Quarry\n").unwrap();
    for check in [true,false] {
        let args=if check {vec!["deploy","deployment","--check"]}else{vec!["deploy","deployment"]};
        let out=app.run(&args);assert!(!out.status.success(),"{}",text(&out));
        assert!(text(&out).contains("authored worker bundle"),"{}",text(&out));
        assert_eq!(app.json(&["releases","deployment"])["current"],1);
    }
}
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
        let rows=rows.into_iter().map(|mut row| {
            if row.get("photos")==Some(&json!("fixture-image")) {
                let png=b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01";
                let asset=e.store_asset("alice",png,1000).unwrap();
                row["photos"]=json!([snapback4_core::wire::to_json(&asset.column_value())]);
            }
            (
                "items".into(),
                snapback4_core::wire::row_from_json(&schema.tables["items"], &row).unwrap(),
            )
        }).collect::<Vec<_>>();
        e.seed(rows)
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
    let next=old.replace("amount: int 100..50000", "amount: int 100..50000 ?").replace("viewer = 'alice'", "viewer = 'bob'").replace("  return insert payments", "  require a.amount != null else NO_AMOUNT\n  return insert payments");let next=next.replace("pay(id: items)","pay(item: items)").replace("  a = items[id]","  a = items[item]");app.source(&next);
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


#[test]
fn invariant_apps_keep_ordinary_rename_split_and_required_field_upgrades() {
    // Small independent shapes from wave-25 002/004/020/024/036/044.
    // Real row images, an uploaded image and default rollback exercise storage,
    // rather than relying on a successful check of empty source alone.
    let base="table items:\n  owner: principal\n  immutable owner\n  label: text 1..100\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nquery all():\n  return items first 10 by .id\nmutation create(label: text 1..100):\n  return insert items {owner:viewer,label}\ninvariant items.read only .owner = viewer\n";
    let rename=base.replace("  label: text 1..100","  title: text 1..100 renamed from label read <- .owner = viewer")
        .replace("create(label: text 1..100)","create(title: text 1..100 alias label)")
        .replace("{owner:viewer,label}","{owner:viewer,title}")
        +"invariant items.title read only .owner = viewer\n";
    let split=base.replace("  label: text 1..100","  invitation: text 1..100\n  envelope: text 1..100")
        .replace("create(label: text 1..100)","create(invitation: text 1..100, envelope: text 1..100)")
        .replace("{owner:viewer,label}","{owner:viewer,invitation,envelope}")
        +"backfill items invitationFromLabel(label: text 1..100): {invitation:label}\nbackfill items envelopeFromLabel(label: text 1..100): {envelope:label}\ndown items oldLabel(invitation: text 1..100): {label:invitation}\ninvariant items.invitation read only .owner = viewer\n";
    let reference=base.replace("table items:","table records renamed from items:")
        .replace("return items","return records").replace("insert items","insert records")
        .replace("invariant items.","invariant records.")
        +"table attachments:\n  parent: records\n  immutable parent\n  read through .parent\n  online only\n";
    let asset_old=base.replace("  label: text 1..100","  label: text 1..100\n  photos: [image <=1000] 1..4")
        .replace("mutation create(label: text 1..100):\n  return insert items {owner:viewer,label}\n","");
    let asset_split=asset_old.replace("  photos: [image <=1000] 1..4\n","")
        +"table surveys:\n  parent: items\n  photos: [image <=1000] 1..4\n  immutable parent\n  read through .parent\n  online only\nextract surveys from items via parent: {photos:photos}\n";
    let alias=reference.replace("mutation create(label:","mutation openRecord(title:")
        .replace("text 1..100):\n  return insert records {owner:viewer,label}","text 1..100 alias label):\n  return insert records {owner:viewer,label:title}")
        +"alias create = openRecord\n";
    let required=base.replace("  label: text 1..100","  label: text 1..100\n  priority: int 1..9 default 3");
    for(name,old,next,row)in [
        ("column rename",base.to_owned(),rename,json!({"id":"kept","owner":"alice","label":"original"})),
        ("split with truthful down",base.to_owned(),split,json!({"id":"kept","owner":"alice","label":"original"})),
        ("nominal rename and child reference",base.to_owned(),reference,json!({"id":"kept","owner":"alice","label":"original"})),
        ("required image to child",asset_old,asset_split,json!({"id":"kept","owner":"alice","label":"original","photos":"fixture-image"})),
        ("table operation and parameter aliases",base.to_owned(),alias,json!({"id":"kept","owner":"alice","label":"original"})),
        ("add required with authored default",base.to_owned(),required,json!({"id":"kept","owner":"alice","label":"original"})),
    ] {
        let app=App::new();app.source(&old);app.ok(&["deploy","deployment"]);app.seed(&old,vec![row]);
        app.source(&next);
        let deployed=app.run(&["deploy","deployment","--json"]);
        assert!(deployed.status.success(),"{name}: {}",text(&deployed));
        let preview=app.json(&["rollback","deployment","--to","1","--check","--json"]);
        assert_eq!(preview["visibility"]["hiddenRows"],0,"{name}: {preview}");
        let rollback=app.run(&["rollback","deployment","--to","1"]);
        assert!(rollback.status.success(),"{name}: {}",text(&rollback));
        assert_eq!(app.count(),1,"{name}");
        let rows=app.json(&["sql","SELECT label FROM items","--release","deployment","--json"]);
        assert_eq!(rows["rows"][0][0],"original","{name}: {rows}");
        app.ok(&["rollback","deployment","--to","latest"]);
    }
}

#[test]
fn pre_view_release_refusal_names_exact_selection_and_registration_upgrade() {
    let app=App::new();app.source(OLD);app.ok(&["deploy","deployment"]);
    let next=newer();app.source(&next);app.ok(&["deploy","deployment"]);
    app.seed(&next,vec![json!({"id":"pending","amount":null})]);
    // A pre-0.4.39 parent has no registration manifest. Its immutable original
    // source and SQLite history are otherwise the same release contract.
    fs::remove_file(app.0.join("deployment/releases/2/rollback-views.json")).unwrap();
    for check in [true,false] {
        let args=if check{vec!["rollback","deployment","--to","1","--check"]}else{vec!["rollback","deployment","--to","1"]};
        let refused=app.run(&args);assert!(!refused.status.success(),"{}",text(&refused));
        assert!(text(&refused).contains("--to 1 --exact"),"{}",text(&refused));
        assert!(text(&refused).contains("redeploy with 0.4.39 to register a view"),"{}",text(&refused));
        assert_eq!(app.count(),1,"refusal must retain the active population");
    }
    app.ok(&["deploy","deployment"]);
    app.ok(&["rollback","deployment","--to","1"]);assert_eq!(app.count(),1);
}

#[test]
fn incomplete_current_shape_uses_a_guarded_bridge_with_current_intent() {
    let app=App::new();
    let old=OLD.replace("  amount: int 100..50000","  legacy: text <=20 ?\n  amount: int 100..50000")+"invariant items.read only true\n";
    app.source(&old);app.ok(&["deploy","deployment"]);
    let next=old.replace("  legacy: text <=20 ?\n","").replace("amount: int 100..50000","amount: int 100..50000 ?")
        .replace("  return insert payments","  require a.amount != null else NO_AMOUNT\n  return insert payments");
    app.source(&next);let preview=app.json(&["deploy","deployment","--check","--json"]);
    assert_eq!(preview["rollbackViews"].as_array().unwrap().len(),1);
    app.ok(&["deploy","deployment"]);
    app.seed(&next,vec![json!({"id":"pending","amount":null})]);
    let selected=app.json(&["rollback","deployment","--to","1","--json"])["release"].as_u64().unwrap();
    assert_eq!(app.count(),1);
    let root=app.0.join(format!("deployment/releases/{selected}/snapback"));
    let sources=fs::read_dir(root).unwrap().map(|entry|{let p=entry.unwrap().path();(p.file_name().unwrap().to_str().unwrap().to_owned(),fs::read_to_string(p).unwrap())}).collect::<Vec<_>>();
    let compiled=snapback4_lang::compile(&sources);assert!(compiled.diagnostics.is_empty(),"{:?}",compiled.diagnostics);
    assert_eq!(compiled.invariants.len(),1);
    assert!(sources.iter().any(|(_,s)|s.contains("NO_AMOUNT")));
    let store=snapback4_core::store_port::AnyStore::open(&app.0.join("deployment/store.sqlite")).unwrap();
    let mut engine=snapback4_core::Engine::new_release(store,compiled.schema,compiled.programs.into_iter().map(|p|p.program),selected,Some(selected)).unwrap();
    let out=engine.mutate("pay",None,snapback4_core::Context::new("alice",std::collections::BTreeMap::from([("id".into(),snapback4_core::Value::Id("pending".into()))]))).unwrap();
    assert!(matches!(out.state,snapback4_core::WriteState::Failed{..}),"{out:?}");
    assert_eq!(engine.store().count("payments").unwrap(),0);
}


#[test]
fn ordinary_quota_tightening_with_an_unchanged_worker_needs_no_view() {
    let app=App::new();
    let old="table items:\n  owner: principal\n  amount: int\n  cap 2 by owner\n  public 'fixture'\n  online only\ninvariant items.read only true\n";
    app.source(old);fs::write(app.0.join("snapback/worker.mjs"),"export {};\n").unwrap();
    app.ok(&["deploy","deployment"]);app.seed(old,vec![json!({"id":"kept","owner":"alice","amount":1})]);
    app.source(&old.replace("cap 2 by owner","cap 1 by owner"));
    let plan=app.json(&["deploy","deployment","--check","--json"]);
    assert_eq!(plan["rollbackViews"].as_array().unwrap().len(),0);
    app.ok(&["deploy","deployment"]);app.ok(&["rollback","deployment","--to","1"]);assert_eq!(app.count(),1);
}


#[test]
fn a_required_column_rename_does_not_block_an_unrelated_widening_view() {
    let app=App::new();let old=OLD.replace("  amount: int 100..50000","  state: enum('old') default 'old'\n  amount: int 100..50000")+"invariant items.read only true\n";
    app.source(&old);app.ok(&["deploy","deployment"]);
    let next=old.replace("state: enum('old')","state: enum('old','new')")
        .replace("  amount: int 100..50000","  quotedAmount: int 100..50000 renamed from amount")
        .replace("amount:a.amount","amount:a.quotedAmount");
    app.source(&next);app.ok(&["deploy","deployment"]);
    app.seed(&next,vec![json!({"id":"kept","state":"new","quotedAmount":123})]);
    let preview=app.json(&["rollback","deployment","--to","1","--check","--json"]);assert_eq!(preview["visibility"]["hiddenRows"],0);
    app.ok(&["rollback","deployment","--to","1"]);assert_eq!(app.count(),1);
    let data=app.json(&["sql","SELECT quotedAmount FROM items","--release","deployment","--json"]);assert_eq!(data["rows"][0][0],123);
}

#[test]
fn ordinary_constraint_rename_with_unchanged_worker_does_not_require_a_view() {
    let app=App::new();
    let old="table codes:\n  code: text <=20\n  unique code\n  public\n  online only\ntable records:\n  value: text <=20\n  public\n  after insert <- exists codes[code = .value]\n  online only\ninvariant records.read only true\n";
    app.source(old);fs::write(app.0.join("snapback/worker.mjs"),"export {};\n").unwrap();
    app.ok(&["deploy","deployment"]);
    let next=old.replace("table codes:","table catalog renamed from codes:")
        .replace("exists codes[","exists catalog[");
    app.source(&next);
    let plan=app.json(&["deploy","deployment","--check","--json"]);
    assert_eq!(plan["rollbackViews"].as_array().unwrap().len(),0);
    app.ok(&["deploy","deployment"]);
    let plan=app.json(&["rollback","deployment","--to","1","--check","--json"]);
    assert_eq!(plan["visibility"]["hiddenRows"],0);
    app.ok(&["rollback","deployment","--to","1"]);
}
