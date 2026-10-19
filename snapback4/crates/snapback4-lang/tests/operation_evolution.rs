use snapback4_lang::{compile, Bound, client_contracts::compare, emit};
use snapback4_core::{Context, Engine, Value};
use std::collections::BTreeMap;
fn checked(source: &str) -> Bound {
    let b=compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b
}
#[test]
fn literal_defaults_aliases_and_deprecated_inputs_execute_the_shared_ir() {
    let b=checked("query current(n: int 0..10 default 4, old: text <=8 deprecated):\n  require n != 9 else NINE\n  return n\nalias original = current\n");
    let mut engine=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    for name in ["current","original"] {
        for args in [BTreeMap::new(),BTreeMap::from([("n".into(),Value::Null)]),BTreeMap::from([("old".into(),Value::String("legacy".into()))])] {
            assert_eq!(engine.query(name,Context::new("user:a",args)).unwrap().data,Value::Int(4));
        }
        assert_eq!(engine.query(name,Context::new("user:a",BTreeMap::from([("n".into(),Value::Int(6))]))).unwrap().data,Value::Int(6));
        assert!(engine.query(name,Context::new("user:a",BTreeMap::from([("n".into(),Value::Int(11))]))).is_err());
        assert!(engine.query(name,Context::new("user:a",BTreeMap::from([("n".into(),Value::Int(9))]))).is_err());
        assert!(engine.query(name,Context::new("user:a",BTreeMap::from([("old".into(),Value::Int(2))]))).is_err());
    }
}
#[test]
fn invalid_modifiers_and_aliases_refuse_without_silent_semantic_changes() {
    for source in [
        "query q(n: int default 11):\n  return n\n".replace("int default", "int 0..10 default"),
        "query q(n: int default now):\n  return n\n".into(),
        "query q(n: int default null):\n  return n\n".into(),
        "query q(n: int default 1 deprecated):\n  return 1\n".into(),
        "query q(n: int deprecated):\n  return n\n".into(),
        "fn f(n: int default 1):\n  return n\nquery q():\n  return f(1)\n".into(),
        "job j(n: int default 1): native\n".into(),
        "query q():\n  return 1\nalias a = q\nalias b = a\n".into(),
        "query q():\n  return 1\nalias q = q\n".into(),
        "alias a = b\nalias b = a\n".into(),
    ] {assert!(!compile(&[("schema.q".into(),source.clone())]).diagnostics.is_empty(),"{source}");}
}
#[test]
fn reports_old_input_breaks_results_and_refusals_and_keeps_required_types() {
    let old=checked("query removed():\n  return true\nquery q(n: int 0..10, obsolete: text <=20):\n  require n != 0 else ZERO\n  return {n}\n");
    let new=checked("query q(n: int 1..9, added: bool):\n  require n != 1 else ONE\n  return {value: n}\n");
    let report=compare(&old,&new,"release 1").join("\n");
    for text in ["removed operation","new required argument added","removed argument obsolete","argument n retyped or narrowed","RESULT REVIEW","BEHAVIOR REVIEW","release 1"] {assert!(report.contains(text),"{text}: {report}");}
    let api=emit::typescript_spanning(&new,&old,2);
    assert!(api.contains("*/ added: boolean"),"{api}");assert!(!api.contains("added?:"));
    let safe=checked("query current(n: int 0..20, obsolete: text <=20 deprecated, added: bool default false):\n  require n != 0 else ZERO\n  return {n}\nalias q = current\nalias removed = constant\nquery constant():\n  return true\n");
    assert!(compare(&old,&safe,"release 1").is_empty(),"{:?}",compare(&old,&safe,"release 1"));
}
#[test]
fn same_named_nominal_rows_still_report_changed_result_fields() {
    let old=checked("table items:\n  n: int\n  public\nquery q(id: items):\n  return items[id]\n");
    let new=checked("table items:\n  n: int\n  label: text <=20 default ''\n  public\nquery q(id: items):\n  return items[id]\n");
    assert!(compare(&old,&new,"release 1").iter().any(|s|s.contains("RESULT REVIEW")));
}

#[test]
fn defaults_and_aliases_have_device_parity_after_backend_json_roundtrip() {
    use snapback4_device::{device::{Backend,Device},memory::MemoryStore};
    let b=checked("query q(n: int default -4, old: bool deprecated):\n  return n\nalias legacy = q\n");
    let backend=Backend{generation:1,schema:b.schema,programs:b.programs.into_iter().map(|p|p.program).collect()};
    let encoded=serde_json::to_string(&backend).unwrap();
    let decoded:Backend=snapback4_core::json_codec::from_text(&encoded).unwrap();
    let mut device=Device::open_store(MemoryStore::new(),Some(decoded)).unwrap();
    for op in ["q","legacy"] {
        for args in [serde_json::json!({}),serde_json::json!({"n":null,"old":true})] {
            assert_eq!(device.query(op,"user:a",&args,0).unwrap().data,Value::Int(-4));
        }
        assert_eq!(device.query(op,"user:a",&serde_json::json!({"n":7}),0).unwrap().data,Value::Int(7));
        assert!(device.query(op,"user:a",&serde_json::json!({"n":"bad"}),0).is_err());
    }
}

#[test]
fn projected_results_keep_declared_integer_and_text_domains() {
    let source="table items:\n  n: int 0..10\n  label: text 1..20\n  unused: int 0..10\n  public\nquery q(id: items):\n  row = items[id]! else NOT_FOUND\n  return {n: row.n, label: row.label}\n";
    let old=checked(source);
    for (from,to,field) in [("int 0..10","int 0..20","items.n"),("text 1..20","text 0..40","items.label")] {
        let new=checked(&source.replacen(from,to,1));
        assert!(compare(&old,&new,"release 1").iter().any(|line|line.contains("RESULT REVIEW")&&line.contains(field)),"{:?}",compare(&old,&new,"release 1"));
    }
    let unused=checked(&source.replace("unused: int 0..10","unused: int 0..100"));
    assert!(compare(&old,&unused,"release 1").is_empty(),"{:?}",compare(&old,&unused,"release 1"));
}
