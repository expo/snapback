use snapback4_lang::{compile, Bound, client_contracts::compare, emit};
use snapback4_core::{Context, Engine, Value};
use std::collections::BTreeMap;
fn checked(source: &str) -> Bound {
    let b=compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b
}
#[test]
fn literal_defaults_aliases_and_deprecated_inputs_execute_the_shared_ir() {
    let b=checked("query current(n: int 0..10 default 4 alias oldN, old: text <=8 deprecated):\n  require n != 9 else NINE\n  return n\nmutation rename(explanation: text 1..500 alias reason):\n  return explanation\nalias original = current\n");
    let current=b.programs.iter().find(|p|p.program.name=="current").unwrap();
    assert_eq!(current.program.arg_aliases,BTreeMap::from([("oldN".into(),"n".into())]));
    let api=emit::typescript(&b);
    assert!(api.contains("({ n?: number | null; oldN?: never } | { n?: never; oldN?: number | null })"),"{api}");
    assert!(api.contains("({ explanation: string; reason?: never } | { explanation?: never; reason: string })"),"{api}");
    assert!(api.contains(r#", JSON.parse("{\"oldN\":\"n\"}"))"#),"aliased availability carries the legacy-to-canonical map: {api}");
    let mut engine=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    for name in ["current","original"] {
        for args in [BTreeMap::new(),BTreeMap::from([("n".into(),Value::Null)]),BTreeMap::from([("oldN".into(),Value::Null)]),BTreeMap::from([("old".into(),Value::String("legacy".into()))])] {
            assert_eq!(engine.query(name,Context::new("user:a",args)).unwrap().data,Value::Int(4));
        }
        assert_eq!(engine.query(name,Context::new("user:a",BTreeMap::from([("oldN".into(),Value::Int(6))]))).unwrap().data,Value::Int(6));
        assert_eq!(engine.query(name,Context::new("user:a",BTreeMap::from([("n".into(),Value::Int(6))]))).unwrap().data,Value::Int(6));
        assert!(engine.query(name,Context::new("user:a",BTreeMap::from([("n".into(),Value::Int(11))]))).is_err());
        assert!(engine.query(name,Context::new("user:a",BTreeMap::from([("n".into(),Value::Int(9))]))).is_err());
        assert!(engine.query(name,Context::new("user:a",BTreeMap::from([("old".into(),Value::Int(2))]))).is_err());
        for values in [(6,6),(6,7)] {assert!(engine.query(name,Context::new("user:a",BTreeMap::from([("n".into(),Value::Int(values.0)),("oldN".into(),Value::Int(values.1))]))).is_err());}
    }
    let sent=engine.mutate("rename",None,Context::new("user:a",BTreeMap::from([("reason".into(),Value::String("word for word".into()))]))).unwrap();
    assert!(matches!(sent.state,snapback4_core::WriteState::Sent{result:Value::String(ref text),..} if text=="word for word"),"{sent:?}");
}
#[test]
fn invalid_modifiers_and_aliases_refuse_without_silent_semantic_changes() {
    for source in [
        "query q(n: int default 11):\n  return n\n".replace("int default", "int 0..10 default"),
        "query q(n: int default now):\n  return n\n".into(),
        "query q(n: int default null):\n  return n\n".into(),
        "query q(n: int default 1 deprecated):\n  return 1\n".into(),
        "query q(n: int alias old deprecated):\n  return 1\n".into(),
        "query q(n: int alias old, old: int):\n  return n\n".into(),
        "query q(a: int alias old, b: int alias old):\n  return a\n".into(),
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
    let b=checked("query q(n: int default -4 alias oldN, old: bool deprecated):\n  return n\nmutation rename(explanation: text 1..500 alias reason):\n  return explanation\nalias legacy = q\n");
    assert!(snapback4_core::device_protocol::compatibility(&b.schema).capabilities.contains(&"argument-alias-v1".into()));
    assert!(!snapback4_core::device_protocol::compatibility(&checked("query q(n: int):\n  return n\n").schema).capabilities.contains(&"argument-alias-v1".into()));
    let backend=Backend{generation:1,schema:b.schema,programs:b.programs.into_iter().map(|p|p.program).collect()};
    let encoded=serde_json::to_string(&backend).unwrap();
    let decoded:Backend=snapback4_core::json_codec::from_text(&encoded).unwrap();
    let mut device=Device::open_store(MemoryStore::new(),Some(decoded)).unwrap();
    for op in ["q","legacy"] {
        for args in [serde_json::json!({}),serde_json::json!({"n":null,"old":true}),serde_json::json!({"oldN":null})] {
            assert_eq!(device.query(op,"user:a",&args,0).unwrap().data,Value::Int(-4));
        }
        assert_eq!(device.query(op,"user:a",&serde_json::json!({"oldN":7}),0).unwrap().data,Value::Int(7));
        assert_eq!(device.query(op,"user:a",&serde_json::json!({"n":7}),0).unwrap().data,Value::Int(7));
        assert!(device.query(op,"user:a",&serde_json::json!({"n":"bad"}),0).is_err());
        assert!(device.query(op,"user:a",&serde_json::json!({"n":7,"oldN":7}),0).is_err());
    }
    let predicted=device.predict("rename","user:a",&serde_json::json!({"reason":"word for word"}),0,vec![],1).unwrap();
    assert_eq!(predicted.result,serde_json::json!("word for word"));
}

#[test]
fn aliases_validate_the_canonical_type_and_contract_comparison_recognizes_renames() {
    let next=checked("query inspect(explanation: text 1..500 alias reason):\n  return explanation\n");
    let program=&next.programs[0].program;
    let typed=snapback4_core::wire::arguments_from_json(program,&serde_json::json!({"reason":"kept"})).unwrap();
    assert_eq!(typed,BTreeMap::from([("explanation".into(),Value::String("kept".into()))]));
    for bad in [serde_json::json!({"reason":7}),serde_json::json!({"reason":"x".repeat(501)}),serde_json::json!({"reason":"same","explanation":"same"})] {
        let error=snapback4_core::wire::arguments_from_json(program,&bad).and_then(|mut args|snapback4_core::engine::validate::validate_inputs(&next.schema,program,&mut args)).unwrap_err();
        assert_eq!(error.refusal().code,"E_INPUT","{bad}: {error}");
    }
    let old=checked("query inspect(reason: text 1..500):\n  return reason\n");
    assert!(compare(&old,&next,"release 1").is_empty(),"{:?}",compare(&old,&next,"release 1"));
    let narrowed=checked("query inspect(explanation: text 1..499 ? alias reason):\n  return explanation\n");
    assert!(compare(&old,&narrowed,"release 1").iter().any(|line|line.contains("narrows the old input domain")),"{:?}",compare(&old,&narrowed,"release 1"));
    let missing=checked("query inspect(explanation: text 1..500):\n  return explanation\n");
    let report=compare(&old,&missing,"release 1").join("\n");
    assert!(report.contains("explanation: <new type> alias reason"),"{report}");
    assert!(!report.contains("reason: <old type> deprecated"),"{report}");
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

#[test]
fn projected_pages_and_accumulated_lists_keep_declared_result_domains() {
    let table="table items:\n  n: int 0..10\n  label: text 1..20\n  unused: int 0..10\n  public\n";
    for body in ["query q():\n  return items first 10 by .id {n, label}\n", "query q():\n  out = []\n  for row in items first 10 by .id:\n    out = out + [{n: row.n, label: row.label}]\n  return out\n"] {
        let source=format!("{table}{body}");let old=checked(&source);
        for (from,to,field) in [("n: int 0..10","n: int 0..20","items.n"),("text 1..20","text 0..20","items.label")] {
            let new=checked(&source.replace(from,to));let report=compare(&old,&new,"release 1");
            assert!(report.iter().any(|line|line.contains("RESULT REVIEW")&&line.contains(field)),"{body}: {report:?}");
        }
        let unused=checked(&source.replace("unused: int 0..10","unused: int 0..100"));
        assert!(compare(&old,&unused,"release 1").is_empty(),"{body}");
    }
}

#[test]
fn writes_walks_and_aggregate_selectors_keep_result_domains() {
    let table="table items:\n  n: int 0..10\n  label: text 1..20\n  unused: int 0..10\n  parent: items ?\n  public\n  insert <- allow\n  update <- allow\n";
    for body in [
        "mutation q(id: items):\n  row = update items[id] {label: 'x'}\n  return {n: row.n, label: row.label}\n",
        "query q(id: items):\n  chain = walk items[id] up .parent depth 8\n  return chain {n, label}\n",
        "query q():\n  page = items first 10 by .id\n  return {n: min(page, .n), label: min(page, .label)}\n",
    ] {
        let source=format!("{table}{body}");let old=checked(&source);
        for (from,to,field) in [("n: int 0..10","n: int 0..20","items.n"),("text 1..20","text 0..20","items.label")] {
            let new=checked(&source.replace(from,to));let report=compare(&old,&new,"release 1");
            assert!(report.iter().any(|line|line.contains("RESULT REVIEW")&&line.contains(field)),"{body}: {report:?}");
        }
        let unused=checked(&source.replace("unused: int 0..10","unused: int 0..100"));
        assert!(compare(&old,&unused,"release 1").is_empty(),"{body}: {:?}",compare(&old,&unused,"release 1"));
    }
}
#[test]
fn declared_action_results_keep_bounds_that_typescript_erases() {
    let source="use server\naction fetch() returns {n: int 0..10, label: text 1..20}\n";
    let old=checked(source);
    for changed in [source.replace("int 0..10","int 0..20"),source.replace("text 1..20","text 0..20")] {
        assert!(compare(&old,&checked(&changed),"release 1").iter().any(|line|line.contains("RESULT REVIEW")));
    }
}

#[test]
fn whole_rows_and_write_images_keep_declared_text_minima() {
    let table="table items:\n  n: int 0..10\n  label: text 1..20\n  public\n  update <- allow\n";
    for body in ["query q(id: items):\n  return items[id]\n", "query q():\n  return items first 10 by .id\n", "mutation q(id: items):\n  return update items[id] {n: 1}\n"] {
        let source=format!("{table}{body}");let old=checked(&source);let new=checked(&source.replace("text 1..20","text 0..20"));
        assert!(compare(&old,&new,"release 1").iter().any(|line|line.contains("RESULT REVIEW")),"{body}");
    }
}

#[test]
fn scalar_returning_writes_keep_their_payload_and_lookup_domains() {
    let table="table items:\n  n: int 0..10\n  label: text 1..20\n  unused: int ?\n  unique label\n  public\n  insert <- allow\n  update <- allow\n";
    for body in ["mutation q(n: int, label: text <=20):\n  insert items {n, label}\n  return true\n", "mutation q(id: items, n: int, label: text <=20):\n  update items[id] {n, label}\n  return true\n", "mutation q(label: text <=20, n: int):\n  upsert items[label = label] {n}\n  return true\n"] {
        let source=format!("{table}{body}");let old=checked(&source);
        for (from,to,field) in [("n: int 0..10","n: int 0..20","items.n"),("text 1..20","text 0..20","items.label")] {
            let new=checked(&source.replace(from,to));assert!(compare(&old,&new,"release 1").iter().any(|line|line.contains("RESULT REVIEW")&&line.contains(field)),"{body}: {:?}",compare(&old,&new,"release 1"));
        }
        let unused=checked(&source.replace("unused: int ?","unused: int 0..100 ?"));
        assert!(compare(&old,&unused,"release 1").is_empty(),"{body}: {:?}",compare(&old,&unused,"release 1"));
    }
}

#[test]
fn word_search_indexes_include_their_actual_source_domains() {
    let source="table items:\n  label: enum('old')\n  unused: int 0..10\n  search label\n  public\nquery q(s: text <=20):\n  return items matching s first 10 by .id {id}\n";
    let old=checked(source);let new=checked(&source.replace("enum('old')","enum('old','new')"));
    assert!(compare(&old,&new,"release 1").iter().any(|line|line.contains("RESULT REVIEW")&&line.contains("items.label")));
    let unused=checked(&source.replace("unused: int 0..10","unused: int 0..100"));
    assert!(compare(&old,&unused,"release 1").is_empty());
}

#[test]
fn removing_or_narrowing_a_previous_argument_alias_warns_old_callers(){
 let before=checked("query q(x: int alias oldX):\n  return x\n");
 let after=checked("query q(x: int):\n  return x\n");
 assert!(compare(&before,&after,"release 1").iter().any(|s|s.contains("removed argument alias oldX")));
 let narrowed=checked("query q(x: int, y: int 0..10 default 0 alias oldX):\n  return x\n");
 assert!(compare(&before,&narrowed,"release 1").iter().any(|s|s.contains("alias oldX retyped or narrowed")));
}

#[test]
fn consolidating_two_independent_arguments_into_one_alias_is_an_input_break(){
 let old=checked("query q(a: int, b: int):\n  return 1\n");let next=checked("query q(b: int alias a):\n  return 1\n");
 assert!(compare(&old,&next,"release 1").iter().any(|s|s.contains("independent arguments")&&s.contains("get E_INPUT")));
}

#[test]
fn declared_table_renames_preserve_reference_input_identity(){
 let old=checked("table commissions:\n  label: text <=20\n  public\nquery q(item: commissions):\n  return item\n");
 let new=checked("table sculptureOrders renamed from commissions:\n  label: text <=20\n  public\nquery q(item: sculptureOrders):\n  return item\n");
 let report=compare(&old,&new,"release 1");
 assert!(!report.iter().any(|line|line.contains("INPUT BREAK")),"{report:?}");
}

#[test]
fn additive_result_fields_are_notes_while_changed_fields_still_require_review(){
 let source="table items:\n  label: text <=20\n  public\nquery q(id: items):\n  return items[id]\n";
 let old=checked(source);
 let added=checked(&source.replace("  public\n","  detail: text <=40 ?\n  public\n"));
 let report=compare(&old,&added,"release 1");
 assert!(report.iter().any(|line|line.contains("RESULT NOTE")&&snapback4_lang::client_contracts::is_note(line)),"{report:?}");
 assert!(!report.iter().any(|line|line.contains("RESULT REVIEW")),"{report:?}");
 let changed=checked(&source.replace("text <=20","text <=10"));
 assert!(compare(&old,&changed,"release 1").iter().any(|line|line.contains("RESULT REVIEW")));
}
