//! Server-authoritative column values, through the same reader on both stores.
use super::super::common::*;
use snapback4_core::{Value,WriteState};
use snapback4_device::device::{Backend,Queued};
use serde_json::json;

const SOURCE: &str = include_str!("../../../snapback4-lang/tests/fixtures/maintained-columns.q");
fn queued(name: &str, op: &str, args: serde_json::Value, n: u64) -> Queued {
    Queued { id:name.into(),seq:n,op:op.into(),args,viewer:"alice".into(),now:1000,new_ids:vec![],predicted:vec![],predictable:true,sent_seq:None,receipt_store:None,observed_seq:None }
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
    for (i,page) in snapshot_pages(&mut server,"alice",1).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    let query = |device: &mut snapback4_device::device::Device<H::Store>, p: &str| {
        device.query("postRow","alice",&json!({"id":p}),1000).unwrap().data
    };
    let prediction = device.admit(queued("like1","like",json!({"id":"l1","postId":"p","active":true,"amount":3}),1)).unwrap();
    assert!(prediction.predictable,"{}: {prediction:?}",host.label());
    assert!(prediction.predicted.iter().all(|p|!p.starts_with("posts/")));
    assert_eq!(query(&mut device,"p").field("likeCount").unwrap(),&Value::Int(0));
    let from = server.seq().unwrap();
    let result = server.mutate("like",Some("like1"),context("alice",&[("id",id("l1")),("postId",id("p")),("active",Value::Bool(true)),("amount",Value::Int(3))]).at(1000)).unwrap();
    let WriteState::Sent { seq,.. } = result.state else { panic!("{result:?}") };
    device.settle("like1",Some(seq)).unwrap();
    let page = stream_page(&mut server,"alice",from);
    assert!(!serde_json::to_string(&page).unwrap().contains("$column"));
    device.apply(&page,false).unwrap();
    assert_eq!(query(&mut device,"p"),server.query("postRow",context("alice",&[("id",id("p"))]).at(1000)).unwrap().data);
    host.close("columns",device);
    let mut device = host.open("columns",None).unwrap();
    assert_eq!(query(&mut device,"p").field("likeCount").unwrap(),&Value::Int(1));
    assert_eq!(query(&mut device,"p").field("total").unwrap(),&Value::Int(3));
    // Read through filters, reference moves, deletes and a reopened page application.
    for (op,args_json,args_typed) in [
        ("change",json!({"id":"l1","postId":"p","active":false,"amount":7}),vec![("id",id("l1")),("postId",id("p")),("active",Value::Bool(false)),("amount",Value::Int(7))]),
        ("change",json!({"id":"l1","postId":"q","active":true,"amount":2}),vec![("id",id("l1")),("postId",id("q")),("active",Value::Bool(true)),("amount",Value::Int(2))]),
    ] {
        let _ = args_json;
        let from = server.seq().unwrap();
        let result = server.mutate(op,None,context("alice",&args_typed).at(1000)).unwrap();
        assert!(matches!(result.state,WriteState::Sent { .. }),"{result:?}");
        device.apply(&stream_page(&mut server,"alice",from),false).unwrap();
        assert_eq!(query(&mut device,"p"),server.query("postRow",context("alice",&[("id",id("p"))]).at(1000)).unwrap().data);
    }
    let pending = device.admit(queued("parent","post",json!({"id":"q","at":2}),2)).unwrap();
    assert!(pending.predictable,"{pending:?}");
    let row = query(&mut device,"q");
    assert_eq!(row.field("likeCount").unwrap(),&Value::Int(0));
    assert_eq!(row.field("pending").unwrap(),&Value::Bool(true));
    let from = server.seq().unwrap();
    let result = server.mutate("post",Some("parent"),context("alice",&[("id",id("q")),("at",Value::Int(2))]).at(1000)).unwrap();
    let WriteState::Sent { seq,.. } = result.state else { panic!("{result:?}") };
    device.settle("parent",Some(seq)).unwrap();
    device.apply(&stream_page(&mut server,"alice",from),false).unwrap();
    assert_eq!(query(&mut device,"q").field("likeCount").unwrap(),&Value::Int(1));
    host.close("columns",device);
    let mut device = host.open("columns",None).unwrap();
    assert_eq!(query(&mut device,"q").field("total").unwrap(),&Value::Int(2));
    let from = server.seq().unwrap();
    server.mutate("unlike",None,context("alice",&[("id",id("l1"))]).at(1000)).unwrap();
    device.apply(&stream_page(&mut server,"alice",from),false).unwrap();
    assert_eq!(query(&mut device,"q").field("likeCount").unwrap(),&Value::Int(0));
    host.close("columns",device);
}

#[test]
fn columns_are_server_values_on_both_device_stores() { run(&mut Sqlite::new("columns")); run(&mut Memory::new()); }

fn forged<H:Host>(host:&mut H) {
    use snapback4_core::{ir::{Expr,Stmt},value::object};
    for arm in ["insert","if_absent","update","upsert"] {
        let (mut server,mut backend)=compile(&SOURCE.replace("  online only","  sync public"));
        server.mutate("post",None,context("alice",&[("id",id("p")),("at",Value::Int(1))]).at(1000)).unwrap();
        backend.schema=backend.schema.public_projection();
        backend.schema.operations.clear();
        let row=object([("id",id("p")),("at",Value::Int(1)),("likeCount",Value::Int(0))]);
        backend.programs.iter_mut().find(|p|p.name=="post").unwrap().body=vec![match arm {
            "if_absent"=>Stmt::InsertIfAbsent {table:"posts".into(),row:Expr::Literal(row),result:"r".into()},
            "update"=>Stmt::Update {table:"posts".into(),key:Expr::Literal(id("p")),patch:Expr::Literal(object([("likeCount",Value::Int(0))]))},
            "upsert"=>Stmt::Upsert {table:"posts".into(),key:Expr::Literal(id("p")),row:Expr::Literal(row)},
            _=>Stmt::Insert {table:"posts".into(),row:Expr::Literal(row)},
        }];
        let mut device=host.open(arm,Some(backend)).unwrap();
        for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate(){device.apply(page,i==0).unwrap();}
        assert_eq!(device.admit(queued("forged","post",json!({"id":"p","at":1}),1)).unwrap_err().refusal().code,"E_MAINTAINED_COLUMN","{arm}");
        assert!(device.queued().unwrap().is_empty());
        host.close(arm,device);
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
    for (i,page) in snapshot_pages(&mut server,"alice",1).iter().enumerate(){device.apply(page,i==0).unwrap();}
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
        device.apply(&stream_page(&mut server,"alice",from),false).unwrap();
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
