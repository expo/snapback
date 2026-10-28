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
fn scalar_key_rename_retains_an_explicit_legacy_lookup_on_default_rollback() {
    let app=App::new();
    let old="table items:\n  code: text <=20\n  n: int\n  unique byCode: code\n  public\n  online only\nquery legacyLookup(code: text <=20):\n  return items[code] by byCode\n";
    app.source(old);app.ok(&["deploy","deployment"]);
    app.seed(old,vec![json!({"id":"kept","n":1,"code":"a"})]);
    let current=old.replace("  code: text <=20", "  label: text <=20 renamed from code")
        .replace("unique byCode: code","unique byCurrentCode: label").replace("n: int", "n: int ?")
        .replace("query legacyLookup(code: text <=20):\n  return items[code] by byCode\n", "");
    app.source_with_presence(&current,"n");app.ok(&["deploy","deployment","--check"]);app.ok(&["deploy","deployment"]);
    let preview=app.json(&["rollback","deployment","--to","1","--check","--json"]);
    assert_eq!(preview["visibility"]["hiddenRows"],0);
    app.ok(&["rollback","deployment","--to","1"]);assert_eq!(app.count(),1);
    assert_eq!(app.json(&["sql","SELECT code FROM items","--release","deployment","--json"])["rows"][0][0],"a");
    app.ok(&["rollback","deployment","--to","latest"]);
    assert_eq!(app.json(&["sql","SELECT label FROM items","--release","deployment","--json"])["rows"][0][0],"a");
}

#[test]
fn equivalent_unique_labels_preserve_final_existence_in_default_rollback() {
    let app=App::new();
    let old="table items:\n  code: text <=20\n  n: int\n  unique byCode: code\n  public\n  online only\ntable records:\n  value: text <=20\n  public\n  after insert <- exists items[.value]\n  online only\nquery legacyLookup(code: text <=20):\n  return items[code] by byCode\n";
    app.source(old);app.ok(&["deploy","deployment"]);
    app.seed(old,vec![json!({"id":"kept","n":1,"code":"a"})]);
    let current=old.replace("n: int", "n: int ?").replace("unique byCode:","unique byCurrentCode:")
        .replace("query legacyLookup(code: text <=20):\n  return items[code] by byCode\n", "");
    app.source_with_presence(&current,"n");app.ok(&["deploy","deployment","--check"]);app.ok(&["deploy","deployment"]);
    let preview=app.json(&["rollback","deployment","--to","1","--check","--json"]);
    assert_eq!(preview["visibility"]["hiddenRows"],0);
    app.ok(&["rollback","deployment","--to","1"]);assert_eq!(app.count(),1);
    app.ok(&["rollback","deployment","--to","latest"]);assert_eq!(app.count(),1);
}

#[test]
fn equivalent_unique_index_rename_keeps_default_rollback_visible() {
    let app=App::new();
    let old="table items:\n  n: int\n  code: text <=20\n  unique byCode: code\n  public\n  online only\ntable retired:\n  value: int\n  public\n  online only\nquery lookup(code: text <=20):\n  return items[code]\n";
    app.source(old);app.ok(&["deploy","deployment"]);
    app.seed(old,vec![json!({"id":"kept","n":1,"code":"a"})]);
    let current=old.replace("n: int", "n: int ?").replace("unique byCode:","unique byCurrentCode:")
        .replace("table retired:\n  value: int\n  public\n  online only\n", "");
    app.source_with_presence(&current,"n");app.ok(&["deploy","deployment","--check"]);app.ok(&["deploy","deployment"]);
    let preview=app.json(&["rollback","deployment","--to","1","--check","--json"]);
    assert_eq!(preview["visibility"]["hiddenRows"],0);
    app.ok(&["rollback","deployment","--to","1"]);assert_eq!(app.count(),1);
    app.ok(&["rollback","deployment","--to","latest"]);assert_eq!(app.count(),1);
}

#[test]
fn scalar_renamed_unique_keys_keep_their_identity_in_default_rollback() {
    for (kind, value) in [("text <=20", json!("alice")), ("int", json!(7))] {
        for strengthen in [false,true] {
        let app=App::new();
        let old=format!("table items:\n  n: int\n  code: {kind}\n  memo: text <=20 ?\n  by byN: n, id\n  public\n  online only\ntable retired:\n  value: int\n  public\n  online only\nquery ordered():\n  return items first 10 by byN\n");
        let old=if strengthen {old.replace("  by byN: n, id", "  by byN: n, id\n  by byCustomer: code")} else {old};
        app.source(&old);app.ok(&["deploy","deployment"]);
        app.seed(&old,vec![json!({"id":"kept","n":1,"code":value,"memo":null})]);
        let next=format!("table items:\n  n: int ?\n  label: {kind} renamed from code\n  count: int default 7\n  by byCount: count, label, id\n  unique byCustomer: label\n  public\n  online only\nquery ordered():\n  return items where .count = 7 first 10 by byCount\n");
        app.source_with_presence(&next,"n");
        app.ok(&["deploy","deployment","--check"]);app.ok(&["deploy","deployment"]);
        let preview=app.json(&["rollback","deployment","--to","1","--check","--json"]);
        assert_eq!(preview["visibility"]["hiddenRows"],0);
        app.ok(&["rollback","deployment","--to","1"]);
        let data=app.json(&["sql","SELECT code FROM items","--release","deployment","--json"]);
        assert_eq!(data["rows"][0][0],value);
        assert_eq!(app.count(),1);
        app.ok(&["rollback","deployment","--to","latest"]);
        let forward=app.json(&["sql","SELECT label FROM items","--release","deployment","--json"]);
        assert_eq!(forward["rows"][0][0],value);
        }
    }
}

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
    // These fixtures deliberately permit pending values. Record only that
    // column's rule-bound decision; do not add independent workflow intent.
    fn source_with_presence(&self, s: &str, column: &str) {
        self.ok(&["check"]); // retain the successful predecessor baseline
        self.source(s);
        let out=self.run(&["check","--json"]);
        let value:Value=serde_json::from_slice(&out.stdout).unwrap();
        let notes=value["security"]["notes"].as_array().unwrap();
        let sites=notes.iter().filter(|n|n["code"]=="N_PRESENCE_LOOSENING"&&n["message"].as_str().unwrap().starts_with(&format!("items.{column}:"))).map(|n|format!("{}:{}:{}",n["site"]["file"].as_str().unwrap(),n["site"]["line"],n["site"]["col"])).collect::<Vec<_>>();
        let decisions=value["securityReviews"].as_array().unwrap();
        let selected=decisions.iter().filter(|d|d["code"]=="N_PRESENCE_LOOSENING"&&sites.iter().any(|s|d["site"]==s.as_str())).collect::<Vec<_>>();
        assert_eq!(selected.len(),1,"expected this deliberate presence review: {value}");
        self.source(&format!("{s}\ninvariant items always .{column} = null or .{column} != null\n"));
        self.ok(&["check"]);
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
        let mut flags=args.to_vec();if !flags.contains(&"--json") {flags.push("--json");}
        let o = self.ok(&flags);
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
        let mut e = snapback4_core::Engine::attach_release_at(store,n,snapback4_core::now_ms()).unwrap();
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
    app.source_with_presence(&next,"amount");
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
    app.source_with_presence(next,"amount");
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
    app.source_with_presence(&next,"amount");
    let out = app.ok(&["deploy", "deployment", "--schema", "snapback", "--check"]);
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stdout.starts_with("deploy: READY preview"), "{stdout}");
    assert!(stdout.lines().count()+stderr.lines().count()<=3,"{stdout}{stderr}");
    assert!(!stderr.contains("decision "), "advisory decisions require --review: {stderr}");
    assert!(fs::read_to_string(app.0.join(".snapback4/last/deploy.txt")).unwrap().contains("advisories (don't block):"));
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
fn incompatible_write_input_pauses_instead_of_restoring_an_unsafe_workflow(){
    let app=App::new();let old=OLD.replace("mutation pay", "fn permitted():\n  return viewer = 'alice'\nmutation pay").replace("  a = items[id]", "  require permitted() else FORBIDDEN\n  a = items[id]");
    app.source(&old);app.ok(&["deploy","deployment","--json"]);
    let next=old.replace("amount: int 100..50000", "amount: int 100..50000 ?").replace("viewer = 'alice'", "viewer = 'bob'").replace("  return insert payments", "  require a.amount != null else NO_AMOUNT\n  return insert payments");let next=next.replace("pay(id: items)","pay(item: items)").replace("  a = items[id]","  a = items[item]");app.source_with_presence(&next,"amount");
    let preview=app.json(&["deploy","deployment","--check","--json"]);
    assert_eq!(preview["rollbackViews"].as_array().unwrap().len(),1);
    app.ok(&["deploy","deployment"]);
    let selected=app.json(&["rollback","deployment","--to","1","--json"])["release"].as_u64().unwrap();
    let source=fs::read_to_string(app.0.join(format!("deployment/releases/{selected}/snapback/schema.q"))).unwrap();
    let bound=snapback4_lang::compile(&[("schema.q".into(),source)]);
    assert!(bound.diagnostics.is_empty());
    assert!(!bound.programs.iter().any(|p|p.program.name=="pay"));
    assert!(bound.programs.iter().any(|p|p.program.name=="read"));
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
    let mut engine=snapback4_core::Engine::attach_release_at(store,selected,snapback4_core::now_ms()).unwrap();
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
    app.source_with_presence(&private,"amount");let parent=app.json(&["deploy","deployment","--json"])["release"].as_u64().unwrap();
    app.seed(&private,vec![json!({"id":"pending","owner":"alice","amount":null})]);
    let public=private.replacen("  read <- .owner = viewer","  public 'fixture'",1);app.source(&public);app.ok(&["deploy","deployment","--json"]);
    app.ok(&["rollback","deployment","--to",&parent.to_string(),"--exact","--json"]);
    let selected=app.json(&["rollback","deployment","--to","1","--json"]);assert_eq!(selected["rollbackView"]["parent"],parent);
    let release=selected["release"].as_u64().unwrap();let source=fs::read_to_string(app.0.join(format!("deployment/releases/{release}/snapback/schema.q"))).unwrap();
    let b=snapback4_lang::compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty());let store=snapback4_core::store_port::AnyStore::open(&app.0.join("deployment/store.sqlite")).unwrap();
    let mut e=snapback4_core::Engine::attach_release_at(store,release,snapback4_core::now_ms()).unwrap();
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
    let next=newer();app.source_with_presence(&next,"amount");app.ok(&["deploy","deployment"]);
    app.seed(&next,vec![json!({"id":"pending","amount":null})]);
    // A pre-0.4.39 parent has no registration manifest. Its immutable original
    // source and SQLite history are otherwise the same release contract.
    fs::remove_file(app.0.join("deployment/releases/2/rollback-views.json")).unwrap();
    fs::write(app.0.join("deployment/releases/2/provenance.json"),serde_json::to_vec(&json!({"cliVersion":"0.4.38"})).unwrap()).unwrap();
    for check in [true,false] {
        let args=if check{vec!["rollback","deployment","--to","1","--check"]}else{vec!["rollback","deployment","--to","1"]};
        let refused=app.run(&args);assert!(!refused.status.success(),"{}",text(&refused));
        assert!(text(&refused).contains("--to 1 --exact"),"{}",text(&refused));
        assert!(text(&refused).contains("this parent predates rollback views"),"{}",text(&refused));
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
    app.source_with_presence(&next,"amount");let preview=app.json(&["deploy","deployment","--check","--json"]);
    assert_eq!(preview["rollbackViews"].as_array().unwrap().len(),1);
    app.ok(&["deploy","deployment"]);
    app.seed(&next,vec![json!({"id":"pending","amount":null})]);
    let selected=app.json(&["rollback","deployment","--to","1","--json"])["release"].as_u64().unwrap();
    assert_eq!(app.count(),1);
    let root=app.0.join(format!("deployment/releases/{selected}/snapback"));
    let sources=fs::read_dir(root).unwrap().map(|entry|{let p=entry.unwrap().path();(p.file_name().unwrap().to_str().unwrap().to_owned(),fs::read_to_string(p).unwrap())}).collect::<Vec<_>>();
    let compiled=snapback4_lang::compile(&sources);assert!(compiled.diagnostics.is_empty(),"{:?}",compiled.diagnostics);
    assert_eq!(compiled.invariants.len(),2); // retained read policy and explicit optional-presence allowance
    assert!(sources.iter().any(|(_,s)|s.contains("NO_AMOUNT")));
    let store=snapback4_core::store_port::AnyStore::open(&app.0.join("deployment/store.sqlite")).unwrap();
    let mut engine=snapback4_core::Engine::attach_release_at(store,selected,snapback4_core::now_ms()).unwrap();
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

#[test]
fn changed_computed_unique_key_registers_before_rows_and_rolls_back_visibly() {
    let app=App::new();
    let old="table items:\n  at: time\n  other: time\n  unique byDay: day(at)\n  public\n  insert <- allow\n  online only\nmutation add(at: time, other: time):\n  return insert items {at, other}\n";
    app.source(old);app.ok(&["deploy","deployment"]);
    let current=old.replace("day(at)","day(other)");app.source(&current);
    let plan=app.json(&["deploy","deployment","--check","--json"]);
    assert_eq!(plan["rollbackViews"].as_array().unwrap().len(),1,"{plan}");
    app.ok(&["deploy","deployment"]);
    app.seed(&current,vec![json!({"id":"a","at":0,"other":0}),json!({"id":"b","at":1,"other":86400000})]);
    let plan=app.json(&["rollback","deployment","--to","1","--check","--json"]);
    assert_eq!(plan["visibility"]["hiddenRows"],0,"{plan}");
    app.ok(&["rollback","deployment","--to","1"]);assert_eq!(app.count(),2);
    app.ok(&["rollback","deployment","--to","latest"]);assert_eq!(app.count(),2);
}

#[test]
fn default_view_keeps_new_column_write_and_freeze_authority() {
    let app=App::new();
    let old="table items:\n  owner: principal\n  approved: bool default false\n  body: text <=40 ?\n  read <- allow\n  insert <- .owner = viewer\n  update <- allow\n  online only\nmutation create(body: text <=40 ?):\n  return insert items {owner:viewer,body}\n";
    app.source(old);app.ok(&["deploy","deployment"]);
    app.seed(old,vec![json!({"id":"kept","owner":"alice","approved":true,"body":"original"})]);
    let next=old.replace("  body: text <=40 ?", "  body: text <=80 ? write <- .owner = viewer")
        .replace("  online only", "  immutable body when .approved = true\n  online only");
    app.source(&next);app.ok(&["deploy","deployment"]);
    app.ok(&["rollback","deployment","--to","1"]);
    assert_eq!(app.count(),1);
    let status=app.json(&["releases","deployment"]);
    let active=status["current"].as_u64().unwrap();assert!(active>2,"{status}");
    let source=fs::read_to_string(app.0.join(format!("deployment/releases/{active}/snapback/schema.q"))).unwrap();
    let actual=snapback4_lang::compile(&[("schema.q".into(),source)]);
    let expected=snapback4_lang::compile(&[("schema.q".into(),next)]);
    assert_eq!(actual.schema.tables["items"].column_writes,expected.schema.tables["items"].column_writes);
    assert_eq!(actual.schema.tables["items"].frozen_columns,expected.schema.tables["items"].frozen_columns);
    app.ok(&["rollback","deployment","--to","latest"]);assert_eq!(app.count(),1);
}

#[test]
fn forward_deploy_selects_ordinary_source_after_rollback_view() {
    let app=App::new();app.source(OLD);app.ok(&["deploy","deployment"]);
    let next=newer();app.source_with_presence(&next,"amount");
    let parent=app.json(&["deploy","deployment","--json"])["release"].as_u64().unwrap();
    app.seed(&next,vec![json!({"id":"pending","amount":null})]);
    for _ in 0..2 {
        let out=app.run(&["rollback","deployment","--to","1"]);assert!(out.status.success(),"{}",text(&out));
        assert!(text(&out).contains("rollback: release") && text(&out).contains("rollback view of release 1"),"{}",text(&out));
        let live=app.json(&["releases","deployment","--json"])["live"].clone();
        assert_eq!(live["source"],1);assert_eq!(live["parent"],parent);assert_eq!(live["exact"],false);assert_eq!(live["target"],1);
        let selected=app.json(&["deploy","deployment","--json"]);
        assert_eq!(selected["release"],parent,"{selected}");
        assert_eq!(selected["live"]["exact"],true);assert!(selected["live"]["view"].is_null());
        assert_eq!(app.count(),1);
    }
}

#[test]
fn column_write_adoption_with_rename_split_and_removed_input_needs_no_view() {
    let base="table items:\n  owner: principal\n  label: text <=80\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nmutation create(label: text <=80):\n  return insert items {owner:viewer,label}\n";
    for next in [
        base.replace("table items:","table records renamed from items:").replace("insert items","insert records").replace("label: text <=80\n","label: text <=80 write <- .owner = viewer\n"),
        base.replace("  label: text <=80","  title: text <=80 write <- .owner = viewer").replace("create(label: text <=80)","create(title: text <=80)").replace("{owner:viewer,label}","{owner:viewer,title}")+"backfill items titleFromLabel(label: text <=80): {title:label}\ndown items oldLabel(title: text <=80): {label:title}\n",
        base.replace("  label: text <=80","  label: text <=80 write <- .owner = viewer").replace("create(label: text <=80)","create(title: text <=80)").replace("{owner:viewer,label}","{owner:viewer,label:title}"),
    ] {
        let app=App::new();app.source(base);app.ok(&["deploy","deployment"]);app.seed(base,vec![json!({"id":"kept","owner":"alice","label":"value"})]);
        app.source(&next);let preview=app.json(&["deploy","deployment","--check","--json"]);
        assert_eq!(preview["rollbackViews"],json!([]),"{preview}");app.ok(&["deploy","deployment"]);
        let table=if next.contains("table records"){"records"}else{"items"};
        assert_eq!(app.json(&["sql",&format!("SELECT COUNT(*) FROM {table}"),"--release","deployment","--json"])["rows"][0][0],1);
    }
}

#[test]
fn release_commands_refuse_extra_positionals_before_store_work() {
    let app=App::new();
    for args in [vec!["deploy","deployment","ignored"],vec!["rollback","deployment","ignored"],vec!["releases","deployment","latest","ignored"]] {
        let out=app.run(&args);assert!(!out.status.success());assert!(text(&out).contains("extra positional"),"{}",text(&out));
        assert!(!app.0.join("deployment").exists());
    }
}

#[test]
fn check_compiles_needed_views_and_names_the_incompatible_query_argument() {
    let app=App::new();app.source(OLD);app.ok(&["deploy","deployment"]);
    let next=newer().replace("query read(id: items)","query read(id: items, mode: text <=20)")+"invariant items.read only true\n";
    app.source_with_presence(&next,"amount");
    let checked=app.run(&["check","--store","deployment/store.sqlite","--json"]);
    assert!(!checked.status.success(),"{}",text(&checked));
    assert!(text(&checked).contains("mode")&&text(&checked).contains("read"),"{}",text(&checked));
    assert!(!text(&checked).contains(":0:0"),"{}",text(&checked));
    let refused=app.run(&["deploy","deployment"]);assert!(!refused.status.success());let message=text(&refused);
    let failure=message.find("deploy: E_ADOPT:").expect("concrete refusal");
    assert!(failure<message.find("REVIEW").unwrap_or(message.len()),"{message}");

    assert_eq!(app.json(&["releases","deployment"])["current"],1);
    assert_eq!(fs::read_dir(app.0.join("deployment/releases")).unwrap().count(),1);
}

#[test]
fn saved_versions_keep_generated_siblings_and_saved_deploy_leaves_working_codegen() {
    let app=App::new();app.source(OLD);app.ok(&["check"]);
    fs::write(app.0.join("snapback/generated/sibling.ts"),"export const saved = true;\n").unwrap();
    app.ok(&["deploy","deployment","--save-version","versions/v1"]);
    for file in ["api.ts","server.ts","package.json","sibling.ts"] {assert!(app.0.join("versions/v1/generated").join(file).is_file(),"{file}");}
    app.source_with_presence(&newer(),"amount");app.ok(&["deploy","deployment"]);
    let api=app.0.join("snapback/generated/api.ts");fs::write(&api,"// working client sentinel\n").unwrap();
    app.ok(&["deploy","deployment","--schema","versions/v1"]);
    assert_eq!(fs::read_to_string(api).unwrap(),"// working client sentinel\n");
}

fn publication_media()->(&'static str,String) {
    // Consume the exact packed proof's fixtures: reference-key renames create
    // compiler-owned $reference labels that a scalar stand-in does not cover.
    let proof=include_str!("../../../scripts/publication-roll.mjs");
    let old=proof.split("  const media=`").nth(1).unwrap().split("`;").next().unwrap();
    let child=proof.split("+`table scans:").nth(1).unwrap().split("`;").next().unwrap();
    let current=old.replace("  buyer: customers","  customer: customers renamed from buyer")
        .replace("  scan: file <=1000\n","")
        .replace("mutation add(buyer: customers, scan: file <=1000):\n  return insert orders {owner:viewer,buyer,scan}\n","")
        +"table scans:"+child;
    (old,current)
}

#[test]
fn native_singleton_projects_to_exact_shape_and_keeps_its_forward_identity() {
    let(old,current)=publication_media();let app=App::new();app.source(old);app.ok(&["deploy","deployment"]);
    app.source(&current);app.ok(&["deploy","deployment"]);
    let b=snapback4_lang::compile(&[("schema.q".into(),current.clone())]);
    let store=snapback4_core::store_port::AnyStore::open(&app.0.join("deployment/store.sqlite")).unwrap();let schema=b.schema.clone();
    let mut engine=snapback4_core::Engine::attach_release_at(store,2,snapback4_core::now_ms()).unwrap();
    let asset=engine.store_file("alice",b"native singleton",Some("text/plain"),"native.txt",1000).unwrap();let scan=snapback4_core::wire::to_json(&asset.column_value());
    let rows=[("customers",json!({"id":"customer"})),("orders",json!({"id":"native-parent","owner":"alice","customer":"customer"})),("scans",json!({"id":"native-child","order":"native-parent","scan":scan}))];
    engine.seed(rows.into_iter().map(|(t,row)|(t.into(),snapback4_core::wire::row_from_json(&schema.tables[t],&row).unwrap())).collect::<Vec<_>>()).unwrap();drop(engine);
    let receipts=||{let conn=rusqlite::Connection::open_with_flags(app.0.join("deployment/store.sqlite"),rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();conn.query_row("SELECT COUNT(*) FROM _extraction_rows WHERE child_id='native-child'",[],|r|r.get::<_,i64>(0)).unwrap()};
    assert_eq!(receipts(),0,"this native singleton has lifetime evidence but no extraction receipt");
    for cycle in 0..2 {
        let preview=app.json(&["rollback","deployment","--to","1","--check","--json"]);
        assert_eq!(preview["rowShape"]["matchesTarget"],true);
        assert_eq!(receipts(),if cycle==0{0}else{1},"private preview never changes live receipts");
        let selected=app.json(&["rollback","deployment","--to","1","--json"]);assert_eq!(selected["release"],1);
        assert_eq!(receipts(),1,"real reverse adoption records the proven projection");
        let values=app.json(&["sql","SELECT scan FROM orders","--release","deployment","--json"]);
        let restored:snapback4_core::Value=serde_json::from_str(values["rows"][0][0].as_str().unwrap()).unwrap();
        assert_eq!(snapback4_core::wire::to_json(&restored),scan);
        app.ok(&["rollback","deployment","--to","latest"]);
        let b=snapback4_lang::compile(&[("schema.q".into(),current.clone())]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let store=snapback4_core::store_port::AnyStore::open(&app.0.join("deployment/store.sqlite")).unwrap();let mut engine=snapback4_core::Engine::attach_release_at(store,2,snapback4_core::now_ms()).unwrap();
        for viewer in ["alice","bob"] {
            let out=engine.query("scan",snapback4_core::Context::new(viewer,std::collections::BTreeMap::from([("id".into(),snapback4_core::Value::Id("native-child".into()))]))).unwrap();let data=snapback4_core::wire::to_json(&out.data);
            if viewer=="alice"{assert_eq!(data["id"],"native-child");assert_eq!(data["order"],"native-parent");assert_eq!(data["scan"],scan);}else{assert_eq!(data,json!(null));}
        }
    }
}

#[test]
fn fitting_extraction_with_rename_restores_predecessor_shape_twice() {
    let(old,current)=publication_media();
    let app=App::new();app.source(old);app.ok(&["deploy","deployment"]);
    let b=snapback4_lang::compile(&[("schema.q".into(),old.into())]);
    let store=snapback4_core::store_port::AnyStore::open(&app.0.join("deployment/store.sqlite")).unwrap();
    let schema=b.schema.clone();
    let mut engine=snapback4_core::Engine::attach_release_at(store,1,snapback4_core::now_ms()).unwrap();
    let asset=engine.store_file("alice",b"retained scan",Some("text/plain"),"scan.txt",1000).unwrap();
    let scan=snapback4_core::wire::to_json(&asset.column_value());
    engine.seed(vec![("customers".into(),snapback4_core::wire::row_from_json(&schema.tables["customers"],&json!({"id":"customer"})).unwrap()),("orders".into(),snapback4_core::wire::row_from_json(&schema.tables["orders"],&json!({"id":"kept","owner":"alice","buyer":"customer","scan":scan})).unwrap())]).unwrap();
    drop(engine);
    app.source(&current);app.ok(&["deploy","deployment"]);
    for _ in 0..2 {
        let preview=app.json(&["rollback","deployment","--to","1","--check","--json"]);
        assert_eq!(preview["visibility"]["hiddenRows"],0);
        assert_eq!(preview["rowShape"]["matchesTarget"],true);
        let selected=app.json(&["rollback","deployment","--to","1","--json"]);
        assert_eq!(selected["release"],1,"a fitting reverse extraction keeps the old query shape");
        let b=snapback4_lang::compile(&[("schema.q".into(),old.into())]);
        let store=snapback4_core::store_port::AnyStore::open(&app.0.join("deployment/store.sqlite")).unwrap();
        let mut engine=snapback4_core::Engine::attach_release_at(store,1,snapback4_core::now_ms()).unwrap();
        for viewer in ["alice","bob"] {
            let outcome=engine.query("order",snapback4_core::Context::new(viewer,std::collections::BTreeMap::from([("id".into(),snapback4_core::Value::Id("kept".into()))]))).unwrap();
            let data=snapback4_core::wire::to_json(&outcome.data);
            if viewer=="alice" {assert_eq!(data["scan"],scan);assert_eq!(data["buyer"],"customer");assert!(data.get("customer").is_none());}
            else {assert_eq!(data,json!(null));}
        }
        drop(engine);app.ok(&["rollback","deployment","--to","latest"]);
    }
    // An extra independent child of this same receipt-owning old parent must
    // keep the registered view, even though its original child fits v1.
    let b=snapback4_lang::compile(&[("schema.q".into(),current)]);
    let store=snapback4_core::store_port::AnyStore::open(&app.0.join("deployment/store.sqlite")).unwrap();
    let schema=b.schema.clone();
    let mut engine=snapback4_core::Engine::attach_release_at(store,2,snapback4_core::now_ms()).unwrap();
    let asset=engine.store_file("alice",b"independent scan",Some("text/plain"),"extra.txt",1000).unwrap();
    engine.seed(vec![("scans".into(),snapback4_core::wire::row_from_json(&schema.tables["scans"],&json!({"id":"native","order":"kept","scan":snapback4_core::wire::to_json(&asset.column_value())})).unwrap())]).unwrap();
    drop(engine);
    let selected=app.json(&["rollback","deployment","--to","1","--json"]);
    assert_eq!(selected["live"]["rowShape"]["matchesTarget"],false);
    assert_eq!(app.json(&["releases","deployment","--json"])["rowShape"]["matchesTarget"],false);
    assert_eq!(selected["rollbackView"]["target"],1,"independent children keep the current population visible");
    assert_eq!(app.json(&["sql","SELECT COUNT(*) FROM scans","--release","deployment","--json"])["rows"][0][0],2);
}

#[test]
fn extraction_view_keeps_multiple_native_children_and_bridge_is_written_on_refusal() {
    let old="table items:\n  owner: principal\n  photos: [image <=1000] 1..4\n  label: text <=40\n  public 'fixture'\n  online only\n";
    let current="table items:\n  owner: principal\n  label: text <=40\n  public 'fixture'\n  online only\ntable photos:\n  item: items on delete cascade\n  photos: [image <=1000] 1..4\n  public 'fixture'\n  online only\nextract photos from items via item: {photos:photos}\n";
    let app=App::new();app.source(old);app.ok(&["deploy","deployment"]);
    app.seed(old,vec![json!({"id":"kept","owner":"alice","label":"kept","photos":"fixture-image"})]);
    app.source(current);let parent=app.json(&["deploy","deployment","--json"])["release"].as_u64().unwrap();
    // A v2-born parent with two real independently homed children.
    let b=snapback4_lang::compile(&[("schema.q".into(),current.into())]);
    let store=snapback4_core::store_port::AnyStore::open(&app.0.join("deployment/store.sqlite")).unwrap();
    let mut e=snapback4_core::Engine::attach_release_at(store,parent,snapback4_core::now_ms()).unwrap();
    let mut rows=vec![("items".into(),snapback4_core::wire::row_from_json(&b.schema.tables["items"],&json!({"id":"native","owner":"alice","label":"native"})).unwrap())];
    for id in ["a","b"] {
        let asset=e.store_asset("alice",b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01",1000).unwrap();
        rows.push(("photos".into(),snapback4_core::wire::row_from_json(&b.schema.tables["photos"],&json!({"id":id,"item":"native","photos":[snapback4_core::wire::to_json(&asset.column_value())]})).unwrap()));
    }
    e.seed(rows).unwrap();drop(e);
    for _ in 0..2 {app.ok(&["rollback","deployment","--to","1"]);assert_eq!(app.count(),2);app.ok(&["rollback","deployment","--to","latest"]);}
    let refused=app.run(&["rollback","deployment","--to","1","--exact","--check","--bridge","repair"]);
    assert!(!refused.status.success());assert!(app.0.join("repair/schema.q").is_file());
    let checklist=fs::read_to_string(app.0.join("repair/ROLLBACK-CHECKLIST.md")).unwrap();assert!(checklist.contains("photos")&&checklist.contains("authorized mutation"),"{checklist}");
}

#[test]
fn equal_historical_source_cannot_bypass_authority_by_registering_new_views() {
    let app=App::new();
    let old="table items:\n  amount: int ?\n  body: text <=40\n  public\n  insert <- allow\n  online only\nmutation add(body: text <=40):\n  return insert items {amount:1,body}\ninvariant items always .amount = null or .amount != null\n";
    app.source(old);app.ok(&["deploy","deployment"]);
    let current=old.replace("amount: int ?","amount: int").replace("body: text <=40\n","body: text <=40 write <- viewer = 'service:operator'\n");
    app.source(&current);app.ok(&["deploy","deployment"]);
    let active=app.json(&["releases","deployment"])["current"].clone();
    app.source(old);
    for check in [true,false] {
        let args=if check{vec!["deploy","deployment","--check"]}else{vec!["deploy","deployment"]};let out=app.run(&args);
        assert!(!out.status.success(),"{}",text(&out));
        assert!(text(&out).contains("items.body")&&text(&out).contains("write <-"),"{}",text(&out));
        assert_eq!(app.json(&["releases","deployment"])["current"],active);
    }
}

#[test]
fn extraction_exact_selection_ignores_invariants_sites_and_immutable_grouping_but_keeps_guards() {
    let (old,current)=publication_media();
    for split in [false,true] {
        let old=old.replace("  buyer: customers", "  immutable buyer\n  buyer: customers")
            +"invariant orders.read only .owner = viewer\n";
        let current=current.replace("  customer: customers", "  immutable customer\n  customer: customers")
            +"invariant orders.read only .owner = viewer\ninvariant scans.read only .order.owner = viewer\n";
        let current=if split{current.replace("  immutable owner\n", "  immutable owner, customer\n").replace("  immutable customer\n", "")}else{current};
        let old=old.replace("query order(id: orders):\n", "query order(id: orders):\n  require viewer != 'blocked' else BLOCKED\n");
        let current=current.replace("query order(id: orders):\n", "query order(id: orders):\n  require viewer != 'blocked' else BLOCKED\n");
        assert!(snapback4_lang::release_bridge::extraction_preserves_predecessor(&[("schema.q".into(),old.clone())],&[("schema.q".into(),current.clone())]));
        let app=App::new();app.source(&old);app.ok(&["deploy","deployment"]);app.source(&current);app.ok(&["deploy","deployment"]);
        let preview=app.json(&["rollback","deployment","--to","1","--check","--json"]);
        assert_eq!(preview["rowShape"]["matchesTarget"],true,"{preview}");
        assert_eq!(app.json(&["rollback","deployment","--to","1","--json"])["release"],1);
        app.ok(&["deploy","deployment"]);
        let guarded=current.replace("require viewer != 'blocked' else BLOCKED", "require viewer = 'alice' else BLOCKED");
        assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&[("schema.q".into(),old)],&[("schema.q".into(),guarded)]));
    }
}

#[test]
fn alternating_deploys_reuse_guarded_sources_and_resolve_qualification_aliases() {
    let app=App::new();
    let a="table items:\n  n: int\n  public 'identity regression'\n  online only\ninvariant items.read only true\nquery value():\n  return 1\n";
    let b=a.replace("return 1","return 2");
    app.source(a);app.ok(&["deploy","deployment"]);
    app.seed(a,vec![json!({"id":"retained","n":1})]);
    app.source(&b);let b_id=app.json(&["deploy","deployment","--json"])["release"].as_u64().unwrap();
    app.source(a);let a_id=app.json(&["deploy","deployment","--json"])["release"].as_u64().unwrap();
    assert_ne!(a_id,1,"a genuinely new rollback registry qualifies the retained source once");
    let leaves=fs::read_dir(app.0.join("deployment/releases")).unwrap().count();
    if let Ok(binary)=std::env::var("REL2_PRE_ALIAS_BIN") {
        app.source(&b);
        let before=Command::new(binary).current_dir(&app.0).args(["deploy","deployment","--check","--json"]).output().unwrap();
        assert!(before.status.success(),"{}",text(&before));
        let planned:Value=serde_json::from_slice(&before.stdout).unwrap();
        assert!(planned["plan"]["release"].as_u64().unwrap()>a_id,"the ID-only registry must demonstrate another qualification parent: {planned}");
        assert_eq!(app.json(&["releases","deployment","--json"])["current"],a_id);
    }
    for _ in 0..3 {
        for (source,id) in [(&b[..],b_id),(a,a_id)] {
            app.source(source);let deployed=app.json(&["deploy","deployment","--json"]);
            assert_eq!(deployed["release"],id,"{deployed}");
            assert_eq!(app.count(),1);
            assert_eq!(fs::read_dir(app.0.join("deployment/releases")).unwrap().count(),leaves);
        }
    }
    for (target,canonical,source) in [(1,1,&b[..]),(b_id,b_id,a),(a_id,1,&b[..])] {
        app.source(source);let parent=app.json(&["deploy","deployment","--json"])["release"].clone();
        let target=target.to_string();
        let check=app.json(&["rollback","deployment","--to",&target,"--check","--json"]);
        assert_eq!(check["rowShape"]["matchesTarget"],true,"{check}");
        let rolled=app.json(&["rollback","deployment","--to",&target,"--json"]);
        assert_eq!(rolled["live"]["exact"],false,"{rolled}");
        assert_eq!(rolled["live"]["parent"],parent,"{rolled}");
        assert_eq!(rolled["live"]["target"],canonical,"{rolled}");
        assert_eq!(app.count(),1);
    }
    assert_eq!(fs::read_dir(app.0.join("deployment/releases")).unwrap().count(),leaves);
    // A legacy registry with a different hiding acknowledgement cannot lend
    // that authority to an equivalent physical target, or fall back to exact.
    app.source(&b);app.ok(&["deploy","deployment"]);
    let parent=app.0.join(format!("deployment/releases/{b_id}"));
    let mut registry:Value=serde_json::from_slice(&fs::read(parent.join("rollback-views.json")).unwrap()).unwrap();
    let view=registry.as_array_mut().unwrap().iter_mut().find(|view|view["target"]==1).unwrap();
    view["hides"]=json!(["items where n = null because legacy different policy"]);
    fs::write(app.0.join(format!("deployment/releases/{}/rollback-view.json",view["release"].as_u64().unwrap())),serde_json::to_vec(view).unwrap()).unwrap();
    fs::write(parent.join("rollback-views.json"),serde_json::to_vec(&registry).unwrap()).unwrap();
    let generation=app.json(&["releases","deployment","--json"])["generation"].clone();
    let alias=a_id.to_string();let refused=app.run(&["rollback","deployment","--to",&alias,"--check"]);
    assert!(!refused.status.success(),"{}",text(&refused));
    assert!(text(&refused).contains("registration with matching hiding policy"),"{}",text(&refused));
    assert_eq!(app.json(&["releases","deployment","--json"])["generation"],generation);
    assert_eq!(app.count(),1);
}

#[test]
fn source_reactivation_restores_dormant_rows_and_keeps_intervening_rollback_guards() {
    let app=App::new();
    let wide="table items:\n  n: enum('kept','wide')\n  public 'restoration regression'\n  online only\nquery list():\n  return items first 10 by .id\n";
    app.source(wide);app.ok(&["deploy","deployment"]);
    app.seed(wide,vec![json!({"id":"retained","n":"wide"})]);
    app.source(&wide.replace("enum('kept','wide')","enum('kept')"));
    app.ok(&["deploy","deployment"]);assert_eq!(app.count(),0);
    app.source(wide);
    if let Ok(binary)=std::env::var("REL2_CUTOFF_BIN") {
        let before=Command::new(binary).current_dir(&app.0).args(["deploy","deployment","--check"]).output().unwrap();
        assert!(!before.status.success(),"the source-origin cutoff unexpectedly admits restoration");
        assert!(text(&before).contains("would hide 1 old-table rows on rollback to release 2"),"{}",text(&before));
    }
    app.ok(&["deploy","deployment","--check"]);
    let restored=app.json(&["deploy","deployment","--json"]);
    assert_eq!(restored["sourceRelease"],1);assert_eq!(app.count(),1);
    let selected=restored["release"].as_u64().unwrap();
    let views:Value=serde_json::from_slice(&fs::read(app.0.join(format!("deployment/releases/{selected}/rollback-views.json"))).unwrap()).unwrap();
    assert!(views.as_array().unwrap().iter().any(|view|view["target"]==2),"{views}");
    let latest=app.json(&["releases","deployment","--json"])["latest"].clone();
    for _ in 0..2 {
        app.ok(&["rollback","deployment","--to","2"]);assert_eq!(app.count(),1);
        let redeployed=app.json(&["deploy","deployment","--json"]);
        assert_eq!(redeployed["release"],selected);assert_eq!(app.count(),1);
        assert_eq!(app.json(&["releases","deployment","--json"])["latest"],latest);
    }
}

#[test]
fn source_reactivation_dedupes_path_forms_without_new_registration_parents() {
    let app=App::new();app.source(OLD);app.ok(&["deploy","deployment","--save-version","versions/v1"]);
    app.source_with_presence(&newer(),"amount");app.ok(&["deploy","deployment"]);
    for path in ["versions/v1/schema.q","versions/v1","./versions/v1/schema.q"] {
        let result=app.json(&["deploy","deployment","--schema",path,"--json"]);
        assert_eq!(result["release"],1,"{result}");
        assert_eq!(app.json(&["releases","deployment","--json"])["latest"],2);
        app.ok(&["deploy","deployment"]);
    }
}

#[test]
fn populated_extraction_accepts_inclusive_list_bounds_and_reverse_checks_new_values() {
    let (base,current)=publication_media();
    let old=base.replace("  scan: file <=1000\n", "  scan: file <=1000\n  kinds: [text <=20] 1..12\n  immutable kinds\n")
        .replace("scan: file <=1000):", "scan: file <=1000, kinds: [text <=20] 1..12):")
        .replace("{owner:viewer,buyer,scan}", "{owner:viewer,buyer,scan,kinds}");
    let current=current.replace("  scan: file <=1000\n", "  scan: file <=1000\n  kinds: [text <=20] <=12\n  immutable kinds\n")
        .replace("{scan:scan}", "{scan:scan,kinds:kinds}");
    let app=App::new();app.source(&old);app.ok(&["deploy","deployment"]);
    let b=snapback4_lang::compile(&[("schema.q".into(),old.clone())]);let schema=b.schema.clone();
    let store=snapback4_core::store_port::AnyStore::open(&app.0.join("deployment/store.sqlite")).unwrap();
    let mut engine=snapback4_core::Engine::attach_release_at(store,1,snapback4_core::now_ms()).unwrap();
    let asset=engine.store_file("alice",b"photo",Some("text/plain"),"photo.txt",1000).unwrap();
    engine.seed(vec![("customers".into(),snapback4_core::wire::row_from_json(&schema.tables["customers"],&json!({"id":"customer"})).unwrap()),("orders".into(),snapback4_core::wire::row_from_json(&schema.tables["orders"],&json!({"id":"kept","owner":"alice","buyer":"customer","scan":snapback4_core::wire::to_json(&asset.column_value()),"kinds":["a"]})).unwrap())]).unwrap();drop(engine);
    app.source(&current);
    if let Ok(binary)=std::env::var("REL2_BASELINE_BIN") {
        let before=Command::new(binary).current_dir(&app.0).args(["deploy","deployment","--check"]).output().unwrap();
        assert!(!before.status.success(),"baseline unexpectedly admitted the original one-step widening");
        assert!(text(&before).contains("requires identical authoritative types"),"{}",text(&before));
    }
    app.ok(&["deploy","deployment"]);
    assert_eq!(app.json(&["sql","SELECT kinds FROM scans","--release","deployment","--json"])["rows"][0][0],json!(r#"{"Array":[{"String":"a"}]}"#));
    app.ok(&["rollback","deployment","--to","1","--exact","--check"]);
}

#[test]
fn extraction_proof_checks_alias_guards_and_never_rebinds_child_focal_fields() {
    let (base,current)=publication_media();
    let audit="table audit:\n  n: int\n  public\n  online only\n";
    let old=base.to_owned()+audit+"mutation create():\n  return insert audit {n:1}\nalias protected = create\n";
    let next=current.clone()+audit+"mutation protected():\n  require viewer = 'service:ops' else OPS\n  return insert audit {n:1}\n";
    for source in [&old,&next]{assert!(snapback4_lang::compile(&[("schema.q".into(),source.to_string())]).diagnostics.is_empty());}
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&[("schema.q".into(),old)],&[("schema.q".into(),next)]));
    let next=current.replace("table scans:\n","table scans:\n  owner: principal ?\n  insert <- .owner = viewer\n");
    assert!(snapback4_lang::compile(&[("schema.q".into(),next.clone())]).diagnostics.is_empty());
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&[("schema.q".into(),base.into())],&[("schema.q".into(),next)]));
    let next=current.replace("table scans:\n","table scans:\n  insert <- deny\n");
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&[("schema.q".into(),base.into())],&[("schema.q".into(),next)]));
}

#[test]
fn extraction_keeps_retained_intent_named_shape_guards_and_write_repairs() {
    let(base,current)=publication_media();
    let source=|s:String|vec![("schema.q".into(),s)];
    let strengthened=current.clone()+"invariant orders.read only viewer = 'alice'\n";
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&source(base.into()),&source(strengthened)));
    let existence=current.replace("  immutable order\n","  immutable order\n  unique order\n")+"invariant orders always exists scans[order = .id]\n";
    assert!(snapback4_lang::compile(&source(existence.clone())).diagnostics.is_empty());
    assert!(snapback4_lang::release_bridge::extraction_preserves_predecessor(&source(base.into()),&source(existence)));
    let shared="table documents:\n  owner: principal\n  amount: int\n  public\n  online only\nshape access = { allowed: true }\nmutation change(id: documents):\n  row = documents[id] ! else MISSING\n  gate = row access\n  require gate.allowed else FORBIDDEN\n  update documents[id] {amount:1}\n";
    let old=base.to_owned()+shared;
    let changed=current.clone()+&shared.replace("allowed: true","allowed: .owner = viewer");
    assert!(snapback4_lang::compile(&source(old.clone())).diagnostics.is_empty());
    assert!(snapback4_lang::compile(&source(changed.clone())).diagnostics.is_empty());
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&source(old.clone()),&source(changed)));
    let repaired=current+&shared.replace("amount:1}","amount:2}");
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&source(old),&source(repaired)));
}

#[test]
fn live_writer_rechecks_projection_for_a_parent_born_after_a_fitting_preview() {
    let (base,current)=publication_media();
    let old=base.replace("scan: file <=1000","scan: file <=1000 ?");
    let current=current.replace("scan: file <=1000","scan: file <=1000 ?");
    let app=App::new();app.source(&old);app.ok(&["deploy","deployment"]);app.source(&current);app.ok(&["deploy","deployment"]);
    let preview=app.json(&["rollback","deployment","--to","1","--check","--json"]);
    assert_eq!(preview["rowShape"]["matchesTarget"],true);
    let b=snapback4_lang::compile(&[("schema.q".into(),current)]);let schema=b.schema.clone();
    let store=snapback4_core::store_port::AnyStore::open(&app.0.join("deployment/store.sqlite")).unwrap();
    let mut engine=snapback4_core::Engine::attach_release_at(store,2,snapback4_core::now_ms()).unwrap();
    engine.seed(vec![("customers".into(),snapback4_core::wire::row_from_json(&schema.tables["customers"],&json!({"id":"customer"})).unwrap()),("orders".into(),snapback4_core::wire::row_from_json(&schema.tables["orders"],&json!({"id":"late","owner":"alice","customer":"customer"})).unwrap())]).unwrap();drop(engine);
    let b=snapback4_lang::compile(&[("schema.q".into(),old)]);
    let store=snapback4_core::store_port::AnyStore::open(&app.0.join("deployment/store.sqlite")).unwrap();
    let mut activation=snapback4_core::engine::release::ReleaseActivation::new(1,Some(2));activation.visibility=Some(Default::default());
    let result=snapback4_core::Engine::new_release_prepared_at(store,b.schema,b.programs.into_iter().map(|p|p.program),&activation,false,snapback4_core::now_ms());
    let Err(error)=result else{panic!("writer admitted an invented predecessor cell")};
    assert!(error.to_string().contains("without a validated child projection"),"{error}");
    assert_eq!(app.json(&["releases","deployment"])["current"],2);
    assert_eq!(app.json(&["rollback","deployment","--to","1","--json"])["live"]["rowShape"]["matchesTarget"],false);
}

#[test]
fn extraction_preserves_expression_guards_argument_defaults_and_parent_dataflow() {
    let(base,current)=publication_media();let source=|text:String|vec![("schema.q".into(),text)];
    let audit="table audit:\n  n: int\n  public\n  online only\n";
    let old=base.to_owned()+audit+"mutation protected():\n  return (insert audit {n:1}) if true else null\n";
    let next=current.clone()+audit+"mutation protected():\n  return (insert audit {n:1}) if viewer = 'alice' else null\n";
    for text in [&old,&next]{let b=snapback4_lang::compile(&source(text.clone()));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);}
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&source(old),&source(next)));
    let mutation="mutation protected(approved: bool default true):\n  require approved else FORBIDDEN\n  return insert audit {n:1}\n";
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&source(base.to_owned()+audit+mutation),&source(current.clone()+audit+&mutation.replace("default true","default false"))));
    let links="table links:\n  order: orders\n  public\n  online only\n";
    let head="mutation linked(buyer: customers, x: file <=1000, y: file <=1000):\n";
    let old=base.to_owned()+links+head+"  a = insert orders {owner:viewer,buyer,scan:x}\n  b = insert orders {owner:viewer,buyer,scan:y}\n  return insert links {order:a.id}\n";
    let current=current.replace("customer: customers renamed from buyer","buyer: customers").replace("table scans:\n","table scans:\n  insert <- allow\n");
    let next=current+links+head+"  b = insert orders {owner:viewer,buyer}\n  insert scans {order:b.id,scan:x}\n  a = insert orders {owner:viewer,buyer}\n  insert scans {order:a.id,scan:y}\n  return insert links {order:a.id}\n";
    for text in [&old,&next]{let b=snapback4_lang::compile(&source(text.clone()));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);}
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&source(old.clone()),&source(next.clone())));
    let short_old=old.replace("  order: orders\n","  a: orders\n").replace("return insert links {order:a.id}","return insert links {a}");
    let short_next=next.replace("  order: orders\n","  a: orders\n").replace("return insert links {order:a.id}","return insert links {a}");
    for text in [&short_old,&short_next]{assert!(snapback4_lang::compile(&source(text.clone())).diagnostics.is_empty());}
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&source(short_old),&source(short_next)));
    for result in ["a.id","{order:a.id}","{a}"] {
        let old_return=old.replace("return insert links {order:a.id}",&format!("return {result}"));
        let next_return=next.replace("return insert links {order:a.id}",&format!("return {result}"));
        assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&source(old_return),&source(next_return)),"return parent identity: {result}");
    }
    let equivalent=next.replace("return insert links {order:a.id}","return insert links {order:b.id}");
    assert!(snapback4_lang::release_bridge::extraction_preserves_predecessor(&source(old),&source(equivalent)));
}

#[test]
fn extraction_rejects_shadowed_arguments_and_preserves_shared_child_defaults() {
    let(base,current)=publication_media();let source=|text:String|vec![("schema.q".into(),text)];
    let current=current.replace("customer: customers renamed from buyer","buyer: customers");
    let head="mutation shadow(a: id, b: id, buyer: customers, photo: file <=1000):\n";
    let old=base.to_owned()+head+"  a = insert orders {id:a,owner:viewer,buyer,scan:photo}\n  return a\n";
    let next=current.clone().replace("table scans:\n","table scans:\n  insert <- allow\n")+head+"  b = insert orders {id:b,owner:viewer,buyer}\n  insert scans {order:b.id,scan:photo}\n  return b\n";
    for text in [&old,&next]{let b=snapback4_lang::compile(&source(text.clone()));assert!(b.diagnostics.iter().any(|d|d.message.contains("cannot shadow arguments")),"{:?}",b.diagnostics);}
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&source(old),&source(next)));
    let head="mutation deferred(m: orders, buyer: customers, photo: file <=1000):\n";
    let old=base.to_owned()+head+"  m = insert orders {owner:viewer,buyer,scan:photo}\n  return m\n";
    let next=current.clone().replace("table scans:\n","table scans:\n  insert <- allow\n")+head+"  insert scans {order:m,scan:photo}\n  m = insert orders {owner:viewer,buyer}\n  return m\n";
    for text in [&old,&next]{let b=snapback4_lang::compile(&source(text.clone()));assert!(b.diagnostics.iter().any(|d|d.message.contains("cannot shadow arguments")),"{:?}",b.diagnostics);}
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&source(old),&source(next)));
    let head="mutation shared(buyer: customers, photo: file <=1000):\n";
    let old=base.to_owned()+head+"  return insert orders {owner:viewer,buyer,scan:photo}\n";
    let next=current+head+"  m = insert orders {owner:viewer,buyer}\n  insert scans {order:m,scan:photo}\n  return m\n";
    for text in [&old,&next]{assert!(snapback4_lang::compile(&source(text.clone())).diagnostics.is_empty());}
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&source(old),&source(next)),"the shared current workflow's default deny must survive");
}

#[test]
fn original_input_domains_remain_inside_current_safety_domains() {
    let(base,current)=publication_media();let source=|text:String|vec![("schema.q".into(),text)];
    let audit="table audit:\n  label: text <=20\n  public\n  online only\n";
    let narrow="mutation record(label: text <=10):\n  return insert audit {label}\n";
    let wide=narrow.replace("text <=10","text <=20");
    assert!(snapback4_lang::release_bridge::extraction_preserves_predecessor(&source(base.to_owned()+audit+narrow),&source(current.clone()+audit+&wide)),"original inputs fit current guards; v2-only inputs may refuse on exact v1");
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&source(base.to_owned()+audit+&wide),&source(current+audit+narrow)),"old broader input cannot bypass a current domain guard");
}

#[test]
fn extracted_null_is_existing_empty_evidence_and_restores_exact_shape_twice() {
    let(base,current)=publication_media();let old=base.replace("scan: file <=1000","scan: file <=1000 ?");let current=current.replace("scan: file <=1000","scan: file <=1000 ?");
    let app=App::new();app.source(&old);app.ok(&["deploy","deployment"]);
    let b=snapback4_lang::compile(&[("schema.q".into(),old)]);let schema=b.schema.clone();
    let store=snapback4_core::store_port::AnyStore::open(&app.0.join("deployment/store.sqlite")).unwrap();
    let mut engine=snapback4_core::Engine::attach_release_at(store,1,snapback4_core::now_ms()).unwrap();
    engine.seed(vec![("customers".into(),snapback4_core::wire::row_from_json(&schema.tables["customers"],&json!({"id":"customer"})).unwrap()),("orders".into(),snapback4_core::wire::row_from_json(&schema.tables["orders"],&json!({"id":"kept","owner":"alice","buyer":"customer","scan":null})).unwrap())]).unwrap();drop(engine);
    app.source(&current);app.ok(&["deploy","deployment"]);
    for _ in 0..2 {
        let preview=app.json(&["rollback","deployment","--to","1","--check","--json"]);
        assert_eq!(preview["rowShape"]["matchesTarget"],true,"{preview}");
        assert_eq!(preview["visibility"]["newlyEmptyCells"],0);assert_eq!(preview["visibility"]["retainedEmptyCells"],1);
        assert_eq!(app.json(&["rollback","deployment","--to","1","--json"])["release"],1);
        assert_eq!(app.json(&["sql","SELECT scan FROM orders","--release","deployment","--json"])["rows"][0][0],json!(null));
        app.ok(&["rollback","deployment","--to","latest"]);
    }
}

#[test]
fn extracted_child_row_insert_audience_applies_to_null_and_omitted_payloads() {
    let source=|text:String|vec![("schema.q".into(),text)];
    for (before,after) in [("{scan:null}","{item:p,scan:null}"),("{}","{item:p}")] {
        let old=format!("table items:\n  scan: file <=1000 ?\n  read <- allow\n  insert <- allow\n  online only\nmutation add():\n  return insert items {before}\n");
        for gate in ["  insert <- deny\n","","  insert <- allow\n"] {
            let current=format!("table items:\n  read <- allow\n  insert <- allow\n  online only\ntable scans:\n  item: items on delete cascade\n  scan: file <=1000 ?\n  immutable item\n  read through .item\n{gate}  online only\nextract scans from items via item: {{scan:scan}}\nmutation add():\n  p = insert items {{}}\n  insert scans {after}\n  return p\n");
            let old=source(old.clone());let current=source(current);
            for sources in [&old,&current] {let bound=snapback4_lang::compile(sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);}
            assert_eq!(snapback4_lang::release_bridge::extraction_preserves_predecessor(&old,&current),gate.contains("allow")&&before!="{}","payload {before}, gate {gate:?}");
        }
    }
}

#[test]
fn extracted_child_authority_cannot_reuse_a_parent_gate_after_its_dependency_changes() {
    let common="table roles:\n  member: principal\n  unique member\n  read <- allow\n  delete <- allow\n  online only\n";
    let old=format!("{common}table items:\n  scan: file <=1000 ?\n  insert <- exists roles[viewer]\n  online only\nmutation add():\n  p = insert items {{scan:null}}\n  delete roles[viewer]\n  return p\n");
    let current=format!("{common}table items:\n  insert <- exists roles[viewer]\n  online only\ntable scans:\n  item: items on delete cascade\n  scan: file <=1000 ?\n  immutable item\n  read through .item\n  insert <- exists roles[viewer]\n  online only\nextract scans from items via item: {{scan:scan}}\nmutation add():\n  p = insert items {{}}\n  delete roles[viewer]\n  insert scans {{item:p,scan:null}}\n  return p\n");
    let source=|text:String|vec![("schema.q".into(),text)];let old=source(old);let current=source(current);
    for sources in [&old,&current] {let bound=snapback4_lang::compile(sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);}
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&old,&current));
}

#[test]
fn extracted_child_constraints_and_restrict_lifetime_keep_the_guarded_view() {
    let(base,current)=publication_media();let source=|text:String|vec![("schema.q".into(),text)];
    for guarded in [current.replace("immutable order","immutable order, scan"),current.replace("immutable order","immutable order\n  cap 1")] {
        let guarded=source(guarded);let bound=snapback4_lang::compile(&guarded);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
        assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&source(base.into()),&guarded));
    }
    let old=base.replace("  insert <- .owner = viewer","  insert <- .owner = viewer\n  delete <- .owner = viewer")+"mutation remove(id: orders):\n  delete orders[id]\n";
    let current=current.replace("  insert <- .owner = viewer","  insert <- .owner = viewer\n  delete <- .owner = viewer").replace("on delete cascade","on delete restrict")+"mutation remove(id: orders):\n  delete orders[id]\n";
    let old=source(old);let current=source(current);
    for sources in [&old,&current] {let bound=snapback4_lang::compile(sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);}
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&old,&current));
}

#[test]
fn wave29_040_exact_projection_preserves_the_real_guarded_scheduled_workflow() {
    let source=|text:&str|vec![("schema.q".into(),text.into())];
    let old=source(include_str!("fixtures/rel2/wave29-040-v1.q"));let current=source(include_str!("fixtures/rel2/wave29-040-v2.q"));
    for sources in [&old,&current] {let b=snapback4_lang::compile(sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);}
    assert!(snapback4_lang::release_bridge::extraction_preserves_predecessor(&old,&current));
}

#[test]
fn a_child_wide_invariant_is_not_an_inactive_new_endpoint() {
    let(base,current)=publication_media();let source=|text:String|vec![("schema.q".into(),text)];
    let guarded=current.clone().replace("scan: file <=1000","scan: file <=1000 ?")+"invariant scans always .scan != null\n";
    let old=source(base.replace("scan: file <=1000","scan: file <=1000 ?"));let guarded=source(guarded);
    assert!(snapback4_lang::compile(&guarded).diagnostics.is_empty());
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&old,&guarded),"child-wide intent needs a proof even when its table is new");
    let read=current.replace("scan: file <=1000","scan: file <=1000 ?")+"invariant scans.read only .order.owner = viewer\n";
    assert!(snapback4_lang::release_bridge::extraction_preserves_predecessor(&old,&source(read)),"read-through projects to the existing parent audience");
}

#[test]
fn ancestor_expiry_cannot_remove_an_extracted_child_restrict_guard() {
    let old="table groups:\n  until: time\n  immutable until\n  expire at .until\n  read <- allow\n  online only\ntable items:\n  group: groups on delete cascade\n  cap 1 by group\n  scan: file <=1000 ?\n  read <- allow\n  online only\n";
    let current=old.replace("  scan: file <=1000 ?\n","")+"table scans:\n  item: items on delete restrict\n  scan: file <=1000 ?\n  immutable item\n  read through .item\n  online only\nextract scans from items via item: {scan:scan}\n";
    let old=vec![("schema.q".into(),old.into())];let current=vec![("schema.q".into(),current)];
    for sources in [&old,&current] {let b=snapback4_lang::compile(sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);}
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&old,&current));
}

#[test]
fn projected_child_intent_uses_its_own_proof_in_a_multifile_source() {
    let old="table items:\n  scan: file <=1000 ?\n  read <- allow\n  online only\n";
    let current=old.replace("  scan: file <=1000 ?\n","")+"table scans:\n  item: items on delete cascade\n  scan: file <=1000 ?\n  immutable item\n  read through .item\n  online only\nextract scans from items via item: {scan:scan}\ninvariant scans.read only deny\n";
    let extra="table extras:\n  read <- allow\n  online only\ninvariant extras.read only allow\n";
    let source=|text:String|vec![("schema.q".into(),text),("z.q".into(),extra.into())];let old=source(old.into());let current=source(current);
    for sources in [&old,&current] {let b=snapback4_lang::compile(sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);}
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&old,&current));
}

#[test]
fn child_intent_never_confuses_child_columns_with_parent_fields() {
    let old="table items:\n  owner: principal\n  immutable owner\n  scan: file <=1000 ?\n  read <- .owner = viewer\n  online only\n";
    let current=old.replace("  scan: file <=1000 ?\n","")+"table scans:\n  item: items on delete cascade\n  owner: principal ?\n  scan: file <=1000 ?\n  immutable item\n  read through .item\n  online only\nextract scans from items via item: {scan:scan}\ninvariant scans.read only .owner = viewer\n";
    let old=vec![("schema.q".into(),old.into())];let current=vec![("schema.q".into(),current)];
    for sources in [&old,&current] {let b=snapback4_lang::compile(sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);}
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&old,&current));
    let mut repeated=current.clone();repeated[0].1=repeated[0].1.replace("  item: items", "  owner: items").replace("  owner: principal ?\n", "").replace("immutable item", "immutable owner").replace("through .item", "through .owner").replace("via item:", "via owner:").replace("only .owner = viewer", "only .owner.owner = viewer");
    let b=snapback4_lang::compile(&repeated);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    assert!(snapback4_lang::release_bridge::extraction_preserves_predecessor(&old,&repeated),"only the original reference leaf projects; the parent owner field remains");
}

#[test]
fn row_keyed_member_write_must_preserve_the_view() {
    let common = r#"table groups:
  read <- allow
  online only
table members:
  group: groups
  immutable group
  cap 10 by group
  read <- allow
  insert <- allow
  online only
table messages:
  group: groups
  immutable group
  read <- allow
  online only
view badges: count messages by members m
  where .group = m.group
  online only
"#;
    let old = common.to_owned() + r#"table items:
  scan: file <=1000 ?
  read <- allow
  insert <- not exists badges[member = 'm']
  online only
mutation add():
  p = insert items {scan:null}
  insert members {id:'m',group:'g'}
  return p
"#;
    let current = common.to_owned() + r#"table items:
  read <- allow
  insert <- not exists badges[member = 'm']
  online only
table scans:
  item: items on delete cascade
  scan: file <=1000 ?
  immutable item
  read through .item
  insert <- not exists badges[member = 'm']
  online only
extract scans from items via item: {scan:scan}
mutation add():
  p = insert items {}
  insert members {id:'m',group:'g'}
  insert scans {item:p,scan:null}
  return p
"#;
    let sources = |s: String| vec![("schema.q".into(), s)];
    let old = sources(old);
    let current = sources(current);
    for s in [&old, &current] {
        let b = snapback4_lang::compile(s);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    }
    assert!(
        !snapback4_lang::release_bridge::extraction_preserves_predecessor(
            &old, &current
        ),
        "member insertion changes the child audience through badges"
    );
}

#[test]
fn child_insert_preserves_its_implicit_parent_read_audience_for_null_payloads() {
    for read in ["allow","deny"] {
        let old=format!("table items:\n  scan: file <=1000 ?\n  read <- {read}\n  insert <- allow\n  online only\nmutation add():\n  return insert items {{scan:null}}\n");
        let current=format!("table items:\n  read <- {read}\n  insert <- allow\n  online only\ntable scans:\n  item: items on delete cascade\n  scan: file <=1000 ?\n  immutable item\n  read through .item\n  insert <- allow\n  online only\nextract scans from items via item: {{scan:scan}}\nmutation add():\n  p = insert items {{}}\n  insert scans {{item:p,scan:null}}\n  return p\n");
        let source=|s:String|vec![("schema.q".into(),s)];let old=source(old);let current=source(current);
        for sources in [&old,&current] {let b=snapback4_lang::compile(sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);}
        assert_eq!(snapback4_lang::release_bridge::extraction_preserves_predecessor(&old,&current),read=="allow");
    }
}

#[test]
fn exact_source_does_not_restore_values_outside_the_current_child_domain() {
    let(base,current)=publication_media();let source=|s:String|vec![("schema.q".into(),s)];
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&source(base.replace("scan: file <=1000","scan: file <=1000 ?")),&source(current.clone())),"an empty store does not prove future historical null writes satisfy the current required child");
    assert!(snapback4_lang::release_bridge::extraction_preserves_predecessor(&source(base.into()),&source(current.replace("scan: file <=1000","scan: file <=1000 ?"))));
}

#[test]
fn read_through_capture_requires_a_live_parent_even_under_allow_rules() {
    let old="table items:\n  until: time\n  immutable until\n  expire at .until\n  scan: file <=1000 ?\n  read <- allow\n  insert <- allow\n  online only\nmutation add():\n  return insert items {until:0,scan:null}\n";
    let current=old.replace("  scan: file <=1000 ?\n","").replace("  return insert items {until:0,scan:null}","  p = insert items {until:0}\n  insert scans {item:p,scan:null}\n  return p")+"table scans:\n  item: items on delete restrict\n  scan: file <=1000 ?\n  immutable item\n  read through .item\n  insert <- allow\n  online only\nextract scans from items via item: {scan:scan}\n";
    let old=vec![("schema.q".into(),old.into())];let current=vec![("schema.q".into(),current)];
    for sources in [&old,&current] {let b=snapback4_lang::compile(sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);}
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&old,&current));
}

#[test]
fn extraction_payloads_are_inputs_and_capture_precedes_intervening_effects() {
    let parent=|payload:bool|format!("table items:\n{}  read <- allow\n  insert <- allow\n  delete <- allow\n  online only\n",if payload{"  scan: file <=1000 ?\n"}else{""});
    let child="table scans:\n  item: items on delete cascade\n  scan: file <=1000 ?\n  immutable item\n  unique item\n  read through .item\n  insert <- allow\n  online only\nextract scans from items via item: {scan:scan}\n";
    let old=parent(true)+"mutation add(photo: file <=1000):\n  payload = null\n  p = insert items {scan:payload}\n  payload = photo\n  return p\n";
    let current=parent(false)+child+"mutation add(photo: file <=1000):\n  payload = null\n  p = insert items {}\n  payload = photo\n  insert scans {item:p,scan:payload}\n  return p\n";
    let audit="table audit:\n  n: int\n  public\n  online only\n";
    let deleted=parent(true)+audit+"mutation add():\n  p = insert items {scan:null}\n  delete items[p.id]\n  insert audit {n:1}\n  return null\n";
    let missing=parent(false)+child+audit+"mutation add():\n  p = insert items {}\n  delete items[p.id]\n  insert scans {item:p,scan:null}\n  insert audit {n:1}\n  return null\n";
    for (old,current) in [(old,current),(deleted,missing)] {
        let source=|s:String|vec![("schema.q".into(),s)];let old=source(old);let current=source(current);
        for sources in [&old,&current] {let b=snapback4_lang::compile(sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);}
        assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&old,&current));
    }
}

#[test]
fn exact_projection_cannot_restore_a_broader_parent_read_rule() {
    let common="table roles:\n  member: principal\n  unique member\n  read <- allow\n  insert <- allow\n  online only\n";
    let old=common.to_owned()+"table items:\n  scan: file <=1000 ?\n  read <- allow\n  insert <- allow\n  online only\nmutation add():\n  return insert items {scan:null}\n";
    let current=common.to_owned()+"table items:\n  read <- exists roles[viewer]\n  insert <- allow\n  online only\ntable scans:\n  item: items on delete cascade\n  scan: file <=1000 ?\n  immutable item\n  read through .item\n  insert <- allow\n  online only\nextract scans from items via item: {scan:scan}\nmutation add():\n  p = insert items {}\n  insert scans {item:p,scan:null}\n  return p\n";
    let old=vec![("schema.q".into(),old)];let current=vec![("schema.q".into(),current)];
    for sources in [&old,&current] {let b=snapback4_lang::compile(sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);}
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&old,&current));
}

#[test]
fn unmapped_child_lifetime_edges_keep_the_view() {
    let(old,current)=publication_media();
    let old=old.replace("  insert <- allow\n", "  insert <- allow\n  delete <- allow\n")+"mutation removeCustomer(id: customers):\n  delete customers[id]\n";
    let current=current.replace("  insert <- allow\n", "  insert <- allow\n  delete <- allow\n").replace("  order: orders on delete cascade", "  order: orders on delete cascade\n  hold: customers ? on delete restrict")+"mutation removeCustomer(id: customers):\n  delete customers[id]\n";
    let old=vec![("schema.q".into(),old)];let current=vec![("schema.q".into(),current)];
    for sources in [&old,&current] {let b=snapback4_lang::compile(sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);}
    assert!(!snapback4_lang::release_bridge::extraction_preserves_predecessor(&old,&current));
}

#[test]
fn default_extraction_preserves_input_guards_and_exact_keeps_its_documented_contract() {
    let old="table items:\n  scan: file <=1000 ?\n  read <- allow\n  online only\ntable audit:\n  n: int\n  read <- allow\n  insert <- allow\n  online only\nmutation record(n: int):\n  return insert audit {n}\n";
    let current=old.replace("  scan: file <=1000 ?\n","").replace("record(n: int)","record(n: int 1..10)")+"table scans:\n  item: items on delete cascade\n  scan: file <=1000 ?\n  immutable item\n  read through .item\n  online only\nextract scans from items via item: {scan:scan}\n";
    let app=App::new();app.source(old);app.ok(&["deploy","deployment"]);app.source(&current);app.ok(&["deploy","deployment"]);
    let selected=app.json(&["rollback","deployment","--to","1","--json"]);
    assert_eq!(selected["live"]["exact"],false);assert_eq!(selected["live"]["rowShape"]["matchesTarget"],false);
    let id=selected["release"].as_u64().unwrap();let source=fs::read_to_string(app.0.join(format!("deployment/releases/{id}/snapback/schema.q"))).unwrap();
    let b=snapback4_lang::compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty());
    let mut engine=snapback4_core::Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let inputs=||snapback4_core::Context::new("alice",std::collections::BTreeMap::from([("n".into(),snapback4_core::Value::Int(0))]));
    match engine.mutate("record",None,inputs()) {
        Ok(out)=>assert!(matches!(out.state,snapback4_core::engine::WriteState::Failed{..})),
        Err(snapback4_core::RuntimeError::UnknownOp(name))=>assert_eq!(name,"record"),Err(error)=>panic!("{error}"),
    }
    // Explicit selection remains the deliberate original workflow from guide deploy.
    let exact=app.json(&["rollback","deployment","--to","1","--exact","--json"]);assert_eq!(exact["live"]["exact"],true);
    let b=snapback4_lang::compile(&[("schema.q".into(),old.into())]);let mut engine=snapback4_core::Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    assert!(matches!(engine.mutate("record",None,inputs()).unwrap().state,snapback4_core::engine::WriteState::Sent{..}));
}

#[test]
fn a_truthful_enum_down_keeps_the_original_wire_spelling_and_workflow() {
    let old="table items:\n  stage: enum('queued', 'done')\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation setStage(id: items, next: enum('queued', 'done')):\n  update items[id] {stage:next}\n  return items[id]\n";
    let current=old.replace("stage: enum('queued', 'done')", "stage: enum('queued', 'done', 'work completed')").replace("next: enum('queued', 'done')", "next: enum('queued', 'work completed')")+"down items originalStage(stage: enum('queued', 'done', 'work completed')): {stage:'done' if stage = 'work completed' else stage}\n";
    let app=App::new();app.source(old);app.ok(&["deploy","deployment"]);app.source(&current);app.ok(&["deploy","deployment"]);
    app.seed(&current,vec![json!({"id":"kept","stage":"work completed"})]);
    let selected=app.json(&["rollback","deployment","--to","1","--json"]);assert_eq!(selected["live"]["exact"],true);assert_eq!(selected["live"]["rowShape"]["matchesTarget"],true);
    assert_eq!(app.json(&["sql","SELECT stage FROM items","--release","deployment","--json"])["rows"][0][0],"done");
    let b=snapback4_lang::compile(&[("schema.q".into(),old.into())]);
    let store=snapback4_core::store_port::AnyStore::open(&app.0.join("deployment/store.sqlite")).unwrap();
    let mut engine=snapback4_core::Engine::attach_release_at(store,1,snapback4_core::now_ms()).unwrap();
    let outcome=engine.mutate("setStage",None,snapback4_core::Context::new("alice",std::collections::BTreeMap::from([("id".into(),snapback4_core::Value::Id("kept".into())),("next".into(),snapback4_core::Value::String("done".into()))]))).unwrap();
    assert!(matches!(outcome.state,snapback4_core::engine::WriteState::Sent{..}));drop(engine);
    app.ok(&["deploy","deployment"]);
}
