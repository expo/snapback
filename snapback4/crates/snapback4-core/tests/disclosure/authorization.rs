//! Row authority and witness verdicts precede all result-dependent accounting.
use super::{Operation, Pair, Seed};
use serde_json::{json, Value as Json};

pub fn witness(observer: &str, rule: &str, expires: bool, mode: &str, n: u64) -> Pair {
    let expiry = if expires { "  expires: time default 10000\n  expire at .expires\n" } else { "" };
    let source = format!(r#"
table access:
  tag: int
  approved: bool
  reader: principal default 'hidden'
  owner: principal
  secret: text <=100000 default '' written by .owner
{expiry}  unique tag
  read <- .reader = viewer
  sync to .reader
table notes:
  reader: principal
  label: int default 0
  read <- {rule}
  update <- {rule}
  online only
mutation refresh(id: notes):
  update notes[id] {{ label: 1 }}
  return true
mutation probe(n: int):
  for i in range(0, n):
    require notes['note'] != null else MISSING
  return true
query one(id: notes):
  return notes[id]
"#);
    let base: Seed = vec![("notes".into(), json!({"id":"note","reader":observer}))];
    let seeds = [0,1].map(|world| {
        let mut rows = base.clone();
        if mode != "presence" || world == 1 {
            rows.push(("access".into(), json!({"id":"w","tag":0,"approved":false,"owner": if mode == "owner" { observer } else { "hidden" },"secret":"x".repeat(if world == 0 { 0 } else { 100000 })})));
        }
        rows
    });
    Pair::new(source,seeds,observer,Operation::new("probe",json!({"n":n}),observer))
        .then(Operation::new("refresh",json!({"id":"note"}),observer)).query("one",json!({"id":"note"}))
}

pub fn point(observer: &str, mode: &str, expires: bool) -> Pair {
    let expiry = if expires { "  expires: time default 10000\n  expire at .expires\n" } else { "" };
    let body_bound = if mode == "presence" {1000000} else {0};
    let secret_type = if mode == "presence" {"int default 0"} else {"text <=1000000 default ''"};
    let source = format!("table records:\n  owner: principal\n  reader: principal\n  body: text <={body_bound} default ''\n  secret: {secret_type} written by .owner\n{expiry}  read <- .reader = viewer\n  sync to .reader\nquery one(id: records):\n  return records[id]\nmutation noop():\n  return true\n");
    let seeds = [0,1].map(|world| {
        if mode == "presence" && world == 0 { return vec![]; }
        vec![("records".into(),json!({"id":"r","owner":if mode=="owner" {observer}else{"hidden"},"reader":"hidden","body":"x".repeat(if world == 1 {body_bound}else{0}),"secret":if mode=="presence" {json!(0)}else{json!("x".repeat(if world == 1 {1000000}else{0}))}}))]
    });
    Pair::new(source,seeds,observer,Operation::new("noop",json!({}),observer)).query("one",json!({"id":"r"}))
}

pub fn expiring(observer: &str) -> Pair {
    let source = "table records:\n  owner: principal\n  expires: time default 10000\n  expire at .expires\n  secret: text <=100000 default '' written by .owner\n  public\n  sync public\nquery one(id: records):\n  return records[id]\nmutation noop():\n  return true\n";
    let seeds = [0,10000].map(|n|vec![("records".into(),json!({"id":"r","owner":"hidden","secret":"x".repeat(n)}))]);
    Pair::new(source,seeds,observer,Operation::new("noop",json!({}),observer)).query("one",json!({"id":"r"}))
}

pub fn write_target(observer: &str, expires: bool, owned: bool) -> Pair {
    let expiry = if expires { "  expires: time default 10000\n  expire at .expires\n" } else { "" };
    let source = format!("table records:\n  owner: principal\n  reader: principal default 'hidden'\n  body: text <=100000 default ''\n  secret: text <=100000 default '' written by .owner\n  label: int default 0\n{expiry}  read <- .reader = viewer\n  update <- allow\n  sync to .reader\nmutation refresh():\n  update records['r'] {{ label: 1 }}\n  return true\nquery one():\n  return records['r']\n");
    let seeds = [0,100000].map(|n|vec![("records".into(),json!({"id":"r","owner":if owned {observer}else{"hidden"},"body":"x".repeat(if owned {0}else{n}),"secret":"x".repeat(if owned {n}else{0})}))]);
    Pair::new(source,seeds,observer,Operation::new("refresh",json!({}),observer)).query("one",json!({}))
}

pub fn visit(send: &mut impl FnMut(String, Pair, bool)) {
    super::round7::visit(send);
    for observer in ["alice", "bob", "carol"] {
        for expires in [false,true] {
            for owned in [false,true] {
                send(format!("authorization/write-target/{observer}/{expires}/{owned}"),write_target(observer,expires,owned),false);
            }
            for mode in ["presence","payload","owner"] {
                send(format!("authorization/point/{observer}/{expires}/{mode}"),point(observer,mode,expires),false);
                for rule in ["exists access[tag = 0, approved = true] or .reader = viewer",
                    ".reader = viewer or exists access[tag = 0, approved = true]",
                    "(exists access[tag = 0, approved = true] and .reader != viewer) or .reader = viewer"] {
                    for n in [1,400,8192,8193] {
                        send(format!("authorization/witness/{observer}/{expires}/{mode}/{rule}/{n}"),witness(observer,rule,expires,mode,n),false);
                    }
                }
            }
        }
        send(format!("authorization/expiry/{observer}"),expiring(observer),false);
        for (escaped,token) in [(false,false),(true,false),(false,true)] {
            send(format!("authorization/shapes-delete/{observer}/{escaped}/{token}"),shapes(observer,escaped,token),false);
        }
    }
}

#[test]
fn unreadable_row_large_ordinary_and_owned_fields() {
    for mode in ["presence","owner"] {
        let pair = point("alice",mode,false);
        pair.assert_equal();
        for world in 0..2 {
            let mut e = pair.engine(world);
            let args = super::inputs(&e,"one",&json!({"id":"r"}));
            let out = e.query("one",snapback4_core::Context::new("alice",args).at(super::NOW)).unwrap();
            assert!(out.complete && out.data == snapback4_core::Value::Null,"{out:?}");
        }
    }
}

#[test]
fn unreadable_witness_presence_payload_and_repeated_reads() {
    for mode in ["presence","payload","owner"] {
        let pair = witness("alice","exists access[tag = 0, approved = true] or .reader = viewer",false,mode,400);
        pair.assert_equal();
        for world in 0..2 {
            let mut e = pair.engine(world);
            let args = super::inputs(&e,"probe",&json!({"n":400}));
            let out = e.mutate("probe",None,snapback4_core::Context::new("alice",args).at(super::NOW)).unwrap();
            assert!(matches!(out.state,snapback4_core::WriteState::Sent{..}),"{out:?}");
        }
    }
}

#[test]
fn expiring_private_text_pair() { expiring("alice").assert_equal(); }

#[test]
fn unreadable_write_target_retains_only_declared_copy_charges() {
    for owned in [false,true] {
        let pair=write_target("alice",false,owned);
        pair.assert_equal();
        for world in 0..2 {
            let mut e=pair.engine(world);
            let out=e.mutate("refresh",None,snapback4_core::Context::new("alice",Default::default()).at(super::NOW)).unwrap();
            assert!(matches!(out.state,snapback4_core::WriteState::Sent{..}),"{out:?}");
        }
    }
}

#[test]
fn repeated_witness_default_probe_boundary() {
    use snapback4_core::{Context, Ceilings, WriteState};
    let mut pair = witness("carol","exists access[tag = 0, approved = true] or .reader = viewer",false,"presence",1);
    for n in [Ceilings::default().rule_probes,Ceilings::default().rule_probes+1] {
        pair.operations.truncate(1);
        pair.operations[0].args["n"] = Json::from(n);
        pair.assert_equal();
        for world in 0..2 {
            let mut e=pair.engine(world);
            let args=super::inputs(&e,"probe",&json!({"n":n}));
            let out=e.mutate("probe",None,Context::new("carol",args).at(super::NOW)).unwrap();
            assert_eq!(matches!(out.state,WriteState::Sent{..}),n<=Ceilings::default().rule_probes,"{n}: {out:?}");
        }
    }
}

#[test]
fn authorization_regressions_on_disk_sqlite() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../target/r6-authorization-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    for (case, pair) in [point("bob","presence",false), point("bob","owner",false),
        witness("carol","exists access[tag = 0, approved = true] or .reader = viewer",true,"presence",400),expiring("alice")].into_iter().enumerate() {
        let mut observations = Vec::new();
        for world in 0..2 {
            let path = dir.join(format!("{case}-{world}.sqlite"));
            let mut e = pair.engine_in(world,snapback4_core::Store::open(&path).unwrap());
            let mut transcript=super::Transcript::new();
            super::observe_queries(&mut e,&pair.principal,&pair.queries,"initial",&mut transcript);
            for (n,op) in pair.operations.iter().enumerate() {
                let args=super::inputs(&e,&op.name,&op.args);
                let out=e.mutate(&op.name,None,snapback4_core::Context::new(&op.principal,args).at(super::NOW)).unwrap();
                transcript.insert(format!("write/{n}"),json!(out));
            }
            drop(e);
            let mut reopened=snapback4_core::Engine::open(snapback4_core::Store::open(&path).unwrap()).unwrap();
            super::observe_queries(&mut reopened,&pair.principal,&pair.queries,"reopened",&mut transcript);
            observations.push(transcript);
        }
        assert_eq!(observations[0],observations[1],"case {case}");
    }
    std::fs::remove_dir_all(dir).unwrap();
}

pub fn shapes(observer: &str, escaped: bool, token: bool) -> Pair {
    let source = r#"
table records:
  owner: principal
  secret: text <=100000 default '' written by .owner
  title: text <=20 default 'public'
  by byWords: words(title), id
  public
  update <- allow
  delete <- allow
  sync public
query spread():
  return records['r'] { * }
query page():
  return records first 20 { * }
query grouped():
  return group(records first 20, 'secret')
query sorted():
  return sort(records first 20, 'secret')
query privateToken():
  return records matching 'zebraplain' first 20
query filtered():
  n = 0
  for r in records first 20:
    if r.secret = 'zebraplain':
      n = n + 1
  return n
mutation retitle():
  update records['r'] { title: 'changed' }
mutation remove():
  delete records['r']
"#;
    let seeds=[0,1].map(|world| {
        let secret=if world==0 { "x".repeat(100000) } else if escaped { "\"".repeat(100000) }
            else if token { format!("zebraplain{}","x".repeat(99990)) } else { String::new() };
        vec![("records".into(),json!({"id":"r","owner":"hidden","secret":secret}))]
    });
    Pair::new(source,seeds,observer,Operation::new("retitle",json!({}),observer))
        .then(Operation::new("remove",json!({}),observer))
}

#[test]
fn spread_succeeds_for_owner_and_nonowner_and_delete_commits() {
    for observer in ["hidden","carol"] {
        let pair=shapes(observer,false,false);
        let mut e=pair.engine(0);
        for query in ["spread","page"] {
            let out=e.query(query,snapback4_core::Context::new(observer,Default::default()).at(super::NOW)).unwrap();
            assert!(out.complete,"{out:?}");
            let row=if query=="page" { &out.data.as_array().unwrap()[0] } else { &out.data };
            let secret=row.field("secret").unwrap();
            if observer=="hidden" { assert_eq!(secret.as_str().unwrap().len(),100000); }
            else { assert_eq!(secret,&snapback4_core::Value::Null); }
        }
        let out=e.mutate("remove",None,snapback4_core::Context::new(observer,Default::default()).at(super::NOW)).unwrap();
        assert!(matches!(out.state,snapback4_core::WriteState::Sent {..}),"{out:?}");
        assert!(e.store().rows("records").unwrap().is_empty());
    }
}
