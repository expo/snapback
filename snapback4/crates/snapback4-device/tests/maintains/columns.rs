//! Server-authoritative column values, through the same reader on both stores.
use super::super::common::*;
use snapback4_core::{Value,WriteState};
use snapback4_device::device::{Backend,Queued,StreamPage};
use serde_json::json;

const SOURCE: &str = include_str!("../../../snapback4-lang/tests/fixtures/maintained-columns.q");
fn queued(name: &str, op: &str, args: serde_json::Value, n: u64) -> Queued {
    Queued { id:name.into(),seq:n,op:op.into(),args,viewer:"alice".into(),now:1000,new_ids:vec![],predicted:vec![],predictable:true,sent_seq:None,receipt_store:None,observed_seq:None }
}

fn public_page(page: &StreamPage) -> &StreamPage {
    assert!(page.events.iter().all(|event| matches!(event.table.as_str(), "posts" | "likes")), "{page:?}");
    assert!(!serde_json::to_string(page).unwrap().contains("$column"));
    page
}
fn triple(row: &Value) -> [i64; 3] {
    assert!(!serde_json::to_string(row).unwrap().contains("$column"));
    ["likeCount", "selected", "total"].map(|field| row.field(field).unwrap().as_int().unwrap())
}

fn run<H: Host>(host: &mut H) {
    let (mut server, backend) = compile(&SOURCE.replace("  online only","  sync public"));
    let projection = backend.schema.public_projection();
    assert!(projection.maintains.is_empty());
    assert_eq!(projection.tables.len(),2);
    let payload = serde_json::to_string(&Backend { schema:projection,..backend }).unwrap();
    assert!(!payload.contains("$column"));
    let projected: Backend = snapback4_core::json_codec::from_text(&payload).unwrap();
    let mut device = host.open("columns",Some(projected)).unwrap();
    server.mutate("post",None,context("alice",&[("id",id("p")),("at",Value::Int(1))]).at(1000)).unwrap();
    for (i,page) in snapshot_pages(&mut server,"alice",1).iter().enumerate() { device.apply(public_page(page),i==0).unwrap(); }
    let query = |device: &mut snapback4_device::device::Device<H::Store>, p: &str| {
        let row=device.query("postRow","alice",&json!({"id":p}),1000).unwrap().data;
        assert!(!serde_json::to_string(&row).unwrap().contains("$column"));
        row
    };
    let prediction = device.admit(queued("like1","like",json!({"id":"l1","postId":"p","active":true,"amount":3}),1)).unwrap();
    assert!(prediction.predictable,"{}: {prediction:?}",host.label());
    assert_eq!(prediction.predicted,["likes/l1"]);
    assert_eq!(triple(&query(&mut device,"p")),[0,0,0]);
    let from = server.seq().unwrap();
    let result = server.mutate("like",Some("like1"),context("alice",&[("id",id("l1")),("postId",id("p")),("active",Value::Bool(true)),("amount",Value::Int(3))]).at(1000)).unwrap();
    let WriteState::Sent { seq,.. } = result.state else { panic!("{result:?}") };
    device.settle("like1",Some(seq)).unwrap();
    let page = stream_page(&mut server,"alice",from);
    assert!(!serde_json::to_string(&page).unwrap().contains("$column"));
    device.apply(public_page(&page),false).unwrap();
    assert_eq!(query(&mut device,"p"),server.query("postRow",context("alice",&[("id",id("p"))]).at(1000)).unwrap().data);
    host.close("columns",device);
    let mut device = host.open("columns",None).unwrap();
    assert_eq!(query(&mut device,"p").field("likeCount").unwrap(),&Value::Int(1));
    assert_eq!(query(&mut device,"p").field("total").unwrap(),&Value::Int(3));
    // Read through filters, reference moves, deletes and a reopened page application.
    for (step,(op,args_json,args_typed)) in [
        ("change",json!({"id":"l1","postId":"p","active":false,"amount":7}),vec![("id",id("l1")),("postId",id("p")),("active",Value::Bool(false)),("amount",Value::Int(7))]),
        ("change",json!({"id":"l1","postId":"q","active":true,"amount":2}),vec![("id",id("l1")),("postId",id("q")),("active",Value::Bool(true)),("amount",Value::Int(2))]),
    ].into_iter().enumerate() {
        let before = query(&mut device,"p");
        let queued_id = format!("change{step}");
        let prediction = device.admit(queued(&queued_id,op,args_json,2+step as u64)).unwrap();
        assert!(prediction.predictable);
        assert!(prediction.predicted.iter().all(|path|path.starts_with("likes/")));
        assert_eq!(query(&mut device,"p"), before, "prediction preserves all confirmed columns");
        let from = server.seq().unwrap();
        let result = server.mutate(op,Some(&queued_id),context("alice",&args_typed).at(1000)).unwrap();
        let WriteState::Sent { seq, .. } = result.state else { panic!("{result:?}") };
        device.settle(&queued_id,Some(seq)).unwrap();
        device.apply(public_page(&stream_page(&mut server,"alice",from)),false).unwrap();
        assert_eq!(query(&mut device,"p"),server.query("postRow",context("alice",&[("id",id("p"))]).at(1000)).unwrap().data);
    }
    let pending = device.admit(queued("parent","post",json!({"id":"q","at":2}),4)).unwrap();
    assert!(pending.predictable,"{pending:?}");
    let row = query(&mut device,"q");
    assert_eq!(triple(&row),[0,0,0]);
    assert_eq!(row.field("pending").unwrap(),&Value::Bool(true));
    let from = server.seq().unwrap();
    let result = server.mutate("post",Some("parent"),context("alice",&[("id",id("q")),("at",Value::Int(2))]).at(1000)).unwrap();
    let WriteState::Sent { seq,.. } = result.state else { panic!("{result:?}") };
    device.settle("parent",Some(seq)).unwrap();
    device.apply(public_page(&stream_page(&mut server,"alice",from)),false).unwrap();
    assert_eq!(triple(&query(&mut device,"q")),[1,1,2]);
    host.close("columns",device);
    let mut device = host.open("columns",None).unwrap();
    assert_eq!(query(&mut device,"q").field("total").unwrap(),&Value::Int(2));
    let from = server.seq().unwrap();
    device.admit(queued("unlike","unlike",json!({"id":"l1"}),5)).unwrap();
    assert_eq!(triple(&query(&mut device,"q")),[1,1,2]);
    let result=server.mutate("unlike",Some("unlike"),context("alice",&[("id",id("l1"))]).at(1000)).unwrap();
    let WriteState::Sent {seq,..}=result.state else {panic!("{result:?}")};
    device.settle("unlike",Some(seq)).unwrap();
    device.apply(public_page(&stream_page(&mut server,"alice",from)),false).unwrap();
    assert_eq!(triple(&query(&mut device,"q")),[0,0,0]);
    assert!(device.queued().unwrap().is_empty());
    host.close("columns",device);
    let mut device=host.open("columns",None).unwrap();
    assert_eq!(triple(&query(&mut device,"q")),[0,0,0]);
    host.close("columns",device);
}

#[test]
fn columns_are_server_values_on_both_device_stores() { run(&mut Sqlite::new("columns")); run(&mut Memory::new()); }

fn forged<H:Host>(host:&mut H) {
    use snapback4_core::{ir::{Expr,Stmt},value::object};
    for (arm,field) in ["insert","if_absent","update","upsert"].into_iter().flat_map(|arm| ["likeCount","selected","total"].map(|field| (arm,field))) {
        let (mut server,mut backend)=compile(&SOURCE.replace("  online only","  sync public"));
        server.mutate("post",None,context("alice",&[("id",id("p")),("at",Value::Int(1))]).at(1000)).unwrap();
        backend.schema=backend.schema.public_projection();
        backend.schema.operations.clear();
        let row=object([("id",id("p")),("at",Value::Int(1)),(field,Value::Int(9))]);
        backend.programs.iter_mut().find(|p|p.name=="post").unwrap().body=vec![match arm {
            "if_absent"=>Stmt::InsertIfAbsent {table:"posts".into(),row:Expr::Literal(row),result:"r".into()},
            "update"=>Stmt::Update {table:"posts".into(),key:Expr::Literal(id("p")),patch:Expr::Literal(object([(field,Value::Int(9))]))},
            "upsert"=>Stmt::Upsert {table:"posts".into(),key:Expr::Literal(id("p")),row:Expr::Literal(row)},
            _=>Stmt::Insert {table:"posts".into(),row:Expr::Literal(row)},
        }];
        let backend = snapback4_core::json_codec::from_text(&serde_json::to_string(&backend).unwrap()).unwrap();
        let name=format!("{arm}-{field}");
        let mut device=host.open(&name,Some(backend)).unwrap();
        for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate(){device.apply(public_page(page),i==0).unwrap();}
        let before=device.query("postRow","alice",&json!({"id":"p"}),1000).unwrap().data;
        assert_eq!(triple(&before),[0,0,0]);
        assert_eq!(device.admit(queued("forged","post",json!({"id":"p","at":1}),1)).unwrap_err().refusal().code,"E_MAINTAINED_COLUMN","{arm}");
        assert!(device.queued().unwrap().is_empty());
        assert_eq!(device.query("postRow","alice",&json!({"id":"p"}),1000).unwrap().data,before);
        host.close(&name,device);
    }
}
#[test]
fn projected_metadata_refuses_every_forged_write_arm_on_both_stores() {forged(&mut Sqlite::new("column-forgery"));forged(&mut Memory::new());}

fn oracle<H:Host>(host:&mut H) {
    use std::collections::BTreeMap;
    let (mut server,mut backend)=compile(&SOURCE.replace("  online only","  sync public"));
    backend.schema=backend.schema.public_projection();
    let mut device=host.open("oracle",Some(backend)).unwrap();
    for p in ["a","b","c"] {
        server.mutate("post",None,context("alice",&[("id",id(p)),("at",Value::Int(1))]).at(1000)).unwrap();
    }
    for (i,page) in snapshot_pages(&mut server,"alice",1).iter().enumerate(){device.apply(public_page(page),i==0).unwrap();}
    let mut model=BTreeMap::<usize,(Option<String>,bool,i64)>::new();
    for step in 0..36 {
        let n=step%12;
        let key=format!("l{n}");
        let parent=match (n+usize::from(step>=12))%4 {0=>Some("a"),1=>Some("b"),2=>Some("c"),_=>None};
        let active=step%3!=0;
        let amount=step as i64-10;
        let (op,args)=if step<24 {
            model.insert(n,(parent.map(str::to_owned),active,amount));
            (if step<12 {"like"} else {"change"},vec![("id",id(&key)),("postId",parent.map(id).unwrap_or(Value::Null)),("active",Value::Bool(active)),("amount",Value::Int(amount))])
        } else {model.remove(&n);("unlike",vec![("id",id(&key))])};
        let from=server.seq().unwrap();
        let out=server.mutate(op,None,context("alice",&args).at(1000)).unwrap();
        assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");
        device.apply(public_page(&stream_page(&mut server,"alice",from)),false).unwrap();
        for p in ["a","b","c"] {
            let rows=model.values().filter(|(parent,_,_)|parent.as_deref()==Some(p)).collect::<Vec<_>>();
            let expected=[rows.len() as i64,rows.iter().filter(|(_,active,_)|*active).count() as i64,rows.iter().filter(|(_,active,_)|*active).map(|(_,_,n)|*n).sum()];
            let row=device.query("postRow","alice",&json!({"id":p}),1000).unwrap().data;
            let actual=["likeCount","selected","total"].map(|field|row.field(field).unwrap().as_int().unwrap());
            assert_eq!(actual,expected,"{} step {step} parent {p}",host.label());
        }
        if step==18 {host.close("oracle",device);device=host.open("oracle",None).unwrap();}
    }
    host.close("oracle",device);
}
#[test]
fn independent_source_model_matches_both_device_readers() {oracle(&mut Sqlite::new("column-oracle"));oracle(&mut Memory::new());}

fn provisional_parent<H: Host>(mut host: H) {
    let source = r#"
table posts:
  reader: principal
  likeCount: count likes by postId
  by byReader: reader, id
  read <- .reader = viewer
  insert <- allow
  update <- allow
  sync to .reader
table likes:
  postId: posts
  public
  sync public
mutation post(id: id, reader: principal):
  insert posts { id, reader }
mutation hide(id: posts):
  update posts[id] { reader: 'bob' }
query postRow(id: posts):
  return posts[id]
query rows(reader: principal):
  return posts[reader] first 10 by byReader { * }
"#;
    let (mut server, mut backend) = compile(source);
    backend.schema = backend.schema.public_projection();
    assert!(backend.schema.maintains.is_empty());
    assert!(!serde_json::to_string(&backend).unwrap().contains("$column"));
    let mut device = host.open("provisional-parent", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "alice", 100).iter().enumerate() { device.apply(public_page(page), i == 0).unwrap(); }
    for (seq, parent, reader) in [(1, "readable", "alice"), (2, "hidden", "bob"), (3, "control", "alice")] {
        let prediction = device.admit(queued(parent, "post", json!({"id":parent,"reader":reader}), seq)).unwrap();
        assert!(prediction.predictable && prediction.predicted.len() == 1, "{prediction:?}");
    }
    let readable = device.query("postRow", "alice", &json!({"id":"readable"}), 1000).unwrap().data;
    assert_eq!(readable.field("likeCount").unwrap(), &Value::Int(0));
    assert_eq!(readable.field("pending").unwrap(), &Value::Bool(true));
    assert_eq!(device.query("postRow", "alice", &json!({"id":"hidden"}), 1000).unwrap().data, Value::Null);
    assert_eq!(device.query("rows", "alice", &json!({"reader":"alice"}), 1000).unwrap().data.as_array().unwrap().len(), 2);
    assert!(device.query("rows", "alice", &json!({"reader":"bob"}), 1000).unwrap().data.as_array().unwrap().is_empty());
    let hidden = device.admit(queued("hide", "hide", json!({"id":"readable"}), 4)).unwrap();
    assert!(hidden.predictable, "{hidden:?}");
    assert_eq!(hidden.predicted,["posts/readable"]);
    assert_eq!(device.query("postRow","alice",&json!({"id":"readable"}),1000).unwrap().data,Value::Null);
    host.close("provisional-parent", device);
    let mut device = host.open("provisional-parent", None).unwrap();
    assert_eq!(device.queued().unwrap().len(), 4, "hidden parents remain predicted and queued");
    for parent in ["readable", "hidden"] {
        assert_eq!(device.query("postRow", "alice", &json!({"id":parent}), 1000).unwrap().data, Value::Null);
    }
    let control=device.query("postRow","alice",&json!({"id":"control"}),1000).unwrap().data;
    assert_eq!(control.field("pending").unwrap(),&Value::Bool(true));
    assert_eq!(control.field("likeCount").unwrap(),&Value::Int(0));
    assert_eq!(device.query("rows","alice",&json!({"reader":"alice"}),1000).unwrap().data.as_array().unwrap().as_ref(), &[control]);
    assert!(device.query("rows","alice",&json!({"reader":"bob"}),1000).unwrap().data.as_array().unwrap().is_empty());
    host.close("provisional-parent", device);
}

#[test]
fn provisional_parents_authorize_implicit_zero_at_read_time_on_both_stores() {
    provisional_parent(Sqlite::new("column-readauth"));
    provisional_parent(Memory::new());
}

fn recorded_projection<H: Host>(mut host: H) {
    use snapback4_core::schema::Constraint;
    use snapback4_core::{ir::{Expr,Stmt},value::object};
    let source = SOURCE.replace("  online only", "  sync public")
        .replacen("  at: time", "  parentId: posts ?\n  immutable parentId\n  at: time", 1)
        .replace("selected: count likes where .active by postId", "selected: count likes where postId.parentId = null by postId")
        .replace("  active: bool", "  immutable postId\n  active: bool");
    let (mut server, mut backend) = compile(&source);
    backend.schema = backend.schema.public_projection();
    assert!(backend.schema.maintains.is_empty());
    let payload = snapback4_core::json_codec::to_text(&backend).unwrap();
    assert!(!payload.contains("$column"));
    assert!(payload.contains(r#""Capabilities":["maintained-column","recorded-attribution"]"#));
    assert!(!payload.contains(r#""Recorded""#));
    let mut backend: Backend = snapback4_core::json_codec::from_text(&payload).unwrap();
    assert_eq!(backend.schema.required_capabilities(), ["maintained-column".into(), "recorded-attribution".into()].into());
    assert!(backend.schema.tables.values().all(|table| table.constraints.iter().all(|c|
        !matches!(c, Constraint::Recorded | Constraint::Capabilities(_)))));
    assert!(backend.schema.tables["likes"].recorded.contains_key("postId.parentId"));
    backend.schema.operations.clear();
    for update in [false,true] {
        let mut program=backend.programs.iter().find(|p|p.name=="like").unwrap().clone();
        program.name=if update {"forgeUpdate"} else {"forgeInsert"}.into();
        let patch=object([("postId.parentId",id("forged"))]);
        program.body=vec![if update {Stmt::Update {table:"likes".into(),key:Expr::Literal(id("l")),patch:Expr::Literal(patch)}} else {
            Stmt::Insert {table:"likes".into(),row:Expr::Literal(object([("id",id("forged")),("postId",id("p")),("active",Value::Bool(true)),("amount",Value::Int(3)),("postId.parentId",id("forged"))]))}
        }];
        backend.programs.push(program);
    }
    let mut device = host.open("recorded-columns", Some(backend)).unwrap();
    server.mutate("post", None, context("alice", &[("id", id("p")), ("at", Value::Int(1))]).at(1000)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "alice", 100).iter().enumerate() { device.apply(public_page(page), i == 0).unwrap(); }
    let prediction = device.admit(queued("like", "like", json!({"id":"l","postId":"p","active":true,"amount":3}), 1)).unwrap();
    assert!(prediction.predictable && prediction.predicted == ["likes/l"], "{prediction:?}");
    let likes=device.store().raw_rows("likes");
    assert_eq!(likes.len(),1);
    assert_eq!(likes[0].field("postId.parentId").unwrap(),&Value::Null);
    for (n,op) in [(2,"forgeInsert"),(3,"forgeUpdate")] {
        let args=json!({"id":"forged","postId":"p","active":true,"amount":3});
        assert_eq!(device.admit(queued(op,op,args,n)).unwrap_err().refusal().code,"E_RECORDED_FIELD");
        assert_eq!(device.store().raw_rows("likes"),likes);
    }
    let row = device.query("postRow", "alice", &json!({"id":"p"}), 1000).unwrap().data;
    assert_eq!(triple(&row), [0, 0, 0], "recording predicts the source, never its maintained parent");
    host.close("recorded-columns", device);
}

#[test]
fn projected_columns_keep_recorded_decoder_fence_and_capture_on_both_stores() {
    recorded_projection(Sqlite::new("column-recorded"));
    recorded_projection(Memory::new());
}
