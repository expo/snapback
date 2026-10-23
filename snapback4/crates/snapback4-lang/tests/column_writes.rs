//! Every authored write arm shares payload authority and preimage freezing.
// @ref LLP 3000.036.004.000#2-column-write-authority — creation is a column write too.
use snapback4_core::{Context,Engine,Value,WriteState};
use std::collections::BTreeMap;

const SOURCE:&str=r#"
table docs:
  owner: principal
  cell: text ? write <- .owner = viewer
  approved: bool default false
  immutable cell when .approved = true
  public 'test records'
  insert <- allow
  update <- allow
  online only
mutation add(owner: principal, cell: text ?):
  return insert docs { owner, cell }
mutation absent(owner: principal, cell: text ?):
  return insert docs { owner, cell } if absent
mutation put(id: docs, owner: principal, cell: text ?):
  return upsert docs[id] { owner, cell }
mutation edit(id: docs, owner: principal, cell: text ?):
  return update docs[id] { owner, cell }
mutation approve(id: docs):
  return update docs[id] { approved: true }
mutation thaw(id: docs, cell: text ?):
  return update docs[id] { approved: false, cell }
"#;
fn engine(source:&str)->Engine{
    let b=snapback4_lang::compile(&[("schema.q".into(),source.to_owned())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap()
}
fn args(viewer:&str,cell:Value)->Context{
    Context::new(viewer,BTreeMap::from([("id".into(),Value::Id("doc".into())),("owner".into(),Value::Id("alice".into())),("cell".into(),cell)])).at(1_800_000_000_000)
}
fn sent(e:&mut Engine,op:&str,mut c:Context)->bool{
    c.args.retain(|name,_|match op {"add"|"absent"=>name!="id","approve"=>name=="id","thaw"=>name!="owner",_=>true});
    e.mutate(op,None,c).is_ok_and(|r|matches!(r.state,WriteState::Sent{..}))
}
#[test]
fn outside_actors_cannot_write_any_arm_or_transfer_the_owner(){
    for actor in ["bob","service:bob","account:outsider"] {
        for op in ["add","absent","put"] {
            let mut e=engine(SOURCE);
            assert!(!sent(&mut e,op,args(actor,Value::String("forged".into()))),"{actor} {op}");
            assert!(sent(&mut e,op,args(actor,Value::Null)),"nullable empty creation {op}");
        }
        for op in ["edit","put"] {
            for value in [Value::Null,Value::String("replaced".into())] {
                let mut e=engine(SOURCE);
                assert!(sent(&mut e,"put",args("alice",Value::String("original".into()))));
                assert!(!sent(&mut e,op,args(actor,value.clone())),"{actor} {op} {value:?}");
                let mut takeover=args(actor,value);takeover.args.insert("owner".into(),Value::Id(actor.into()));
                assert!(!sent(&mut e,op,takeover),"owner takeover {actor} {op}");
            }
        }
    }
}
#[test]
fn approval_freezes_replacement_and_removal_even_in_a_thawing_patch(){
    for op in ["edit","put","thaw"] {for value in [Value::Null,Value::String("new".into())]{
        let mut e=engine(SOURCE);
        assert!(sent(&mut e,"put",args("alice",Value::String("original".into()))));
        assert!(sent(&mut e,"approve",args("alice",Value::Null)));
        assert!(!sent(&mut e,op,args("alice",value)),"{op}");
        assert!(sent(&mut e,"edit",args("alice",Value::String("original".into()))));
    }}
}
#[test]
fn defaults_are_writes_and_the_schema_carries_a_capability(){
    let source=SOURCE.replace("cell: text ? write", "cell: text ? default 'initial' write")+"\nmutation defaults(owner: principal):\n  return insert docs {owner}\n";
    let b=snapback4_lang::compile(&[("schema.q".into(),source.clone())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    assert!(b.schema.required_capabilities().contains("column-write-v1"));
    let mut e=engine(&source);
    for (viewer,expected) in [("bob",false),("alice",true)]{
        let result=e.mutate("defaults",None,Context::new(viewer,BTreeMap::from([("owner".into(),Value::Id("alice".into()))])).at(1_800_000_000_000)).unwrap();
        assert_eq!(matches!(result.state,WriteState::Sent{..}),expected,"default grant as {viewer}: {result:?}");
    }
    let mut raw=serde_json::to_value(&b.schema).unwrap();
    raw["tables"]["docs"]["column_writes"]["cell"]=serde_json::json!("Deny");
    let schema: snapback4_core::schema::Schema=serde_json::from_value(raw).unwrap();
    assert!(snapback4_core::schema::validate(&schema).is_empty());
}

#[test]
fn trusted_system_mutations_and_import_replacements_still_freeze(){
    use snapback4_core::value::object;
    let mut e=engine(SOURCE);
    let row=|cell:&str|object([("id",Value::Id("doc".into())),("owner",Value::Id("alice".into())),("cell",Value::String(cell.into())),("approved",Value::Bool(true))]);
    e.seed([("docs".into(),row("original"))]).unwrap();
    assert!(e.seed([("docs".into(),row("replacement"))]).is_err());
    assert!(e.load([("docs".into(),row("replacement"))]).is_err());
    // Explicit persistence restoration is the existing trusted raw-image boundary.
    e.load_trusted([("docs".into(),row("replacement"))]).unwrap();
}
#[test]
fn unreadable_guarded_payloads_do_not_offer_a_guessing_oracle(){
    let source=SOURCE.replace("public 'test records'","read <- .owner = viewer");
    for guess in ["original","wrong"]{
        let mut e=engine(&source);
        assert!(sent(&mut e,"put",args("alice",Value::String("original".into()))));
        let existing=e.mutate("edit",None,args("bob",Value::String(guess.into()))).unwrap();
        let mut missing=args("bob",Value::String(guess.into()));missing.args.insert("id".into(),Value::Id("missing".into()));
        let absent=e.mutate("edit",None,missing).unwrap();
        assert_eq!(serde_json::to_value(existing.state).unwrap(),serde_json::to_value(absent.state).unwrap());
    }
}
