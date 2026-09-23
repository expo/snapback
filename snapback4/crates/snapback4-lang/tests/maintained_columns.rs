use snapback4_core::{engine::{Context, Engine, WriteState}, value::Value};
use std::collections::BTreeMap;

const MODEL: &str = include_str!("fixtures/maintained-columns.q");

fn compile(source: &str) -> snapback4_lang::Bound {
    let bound = snapback4_lang::compile(&[("schema.q".into(),source.into())]);
    assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    bound
}
fn engine(source: &str) -> Engine {
    let bound = compile(source);
    Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap()
}
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn context(args: &[(&str,Value)]) -> Context { Context::new("alice",args.iter().map(|(k,v)|(k.to_string(),v.clone())).collect()).at(1000) }
fn mutate(e: &mut Engine, op: &str, args: &[(&str,Value)]) -> Value {
    let outcome = e.mutate(op,None,context(args)).unwrap();
    match outcome.state { WriteState::Sent { result, .. } => result, other => panic!("{op}: {other:?}") }
}
fn post(e: &mut Engine, name: &str, at: i64) {
    let row = mutate(e,"post",&[("id",id(name)),("at",Value::Int(at))]);
    for field in ["likeCount","selected","total"] { assert!(row.field(field).is_err()); }
    assert_eq!(row.field("id").unwrap(),&id(name));
}
fn like(e: &mut Engine, name: &str, parent: Value, active: bool, amount: i64) {
    mutate(e,"like",&[("id",id(name)),("postId",parent),("active",Value::Bool(active)),("amount",Value::Int(amount))]);
}
fn totals(e: &mut Engine, parent: &str) -> (i64,i64,i64) {
    let row = e.query("postRow",context(&[("id",id(parent))])).unwrap().data;
    let n = |field|row.field(field).unwrap().as_int().unwrap();
    (n("likeCount"),n("selected"),n("total"))
}

#[test]
fn oracle_moves_filters_sums_birth_and_last_delete() {
    let mut e = engine(MODEL);
    let mut model = BTreeMap::<String,(String,bool,i64)>::new();
    like(&mut e,"early",id("p"),true,7);
    model.insert("early".into(),("p".into(),true,7));
    post(&mut e,"p",1); post(&mut e,"q",2);
    let check = |e: &mut Engine, model: &BTreeMap<String,(String,bool,i64)>| {
        for p in ["p","q"] {
            let rows: Vec<_> = model.values().filter(|(parent,_,_)|parent == p).collect();
            let expected = (rows.len() as i64,rows.iter().filter(|(_,a,_)|*a).count() as i64,rows.iter().filter(|(_,a,_)|*a).map(|(_,_,n)|n).sum());
            assert_eq!(totals(e,p),expected,"parent {p}");
        }
    };
    check(&mut e,&model);
    for n in 0..8 {
        let name = format!("l{n}");
        let p = if n % 2 == 0 { "p" } else { "q" };
        like(&mut e,&name,id(p),n % 3 == 0,n-4);
        model.insert(name,(p.into(),n % 3 == 0,n-4));
        check(&mut e,&model);
    }
    mutate(&mut e,"change",&[("id",id("early")),("postId",id("q")),("active",Value::Bool(false)),("amount",Value::Int(100))]);
    model.insert("early".into(),("q".into(),false,100));
    check(&mut e,&model);
    for name in model.keys().cloned().collect::<Vec<_>>() { mutate(&mut e,"unlike",&[("id",id(&name))]); model.remove(&name); check(&mut e,&model); }
}

#[test]
fn clique_pages_match_independent_count_time_model() {
    let mut e = engine(MODEL);
    let mut counts = BTreeMap::new();
    for (p,at) in [("a",10),("b",30),("c",20),("d",40),("e",5),("f",20)] { post(&mut e,p,at); counts.insert(p,(0,at)); }
    let check = |e: &mut Engine, counts: &BTreeMap<&str,(i64,i64)>| {
        let mut expected: Vec<_> = counts.iter().map(|(p,(n,at))|(*n,*at,p.to_string())).collect();
        expected.sort(); expected.reverse();
        let mut cursor = Value::Null;
        let mut actual = Vec::new();
        loop {
            let page = e.query("ranked",context(&[("c",cursor)])).unwrap();
            if let Value::Array(rows) = page.data { for row in rows.iter() { actual.push((row.field("likeCount").unwrap().as_int().unwrap(),row.field("at").unwrap().as_int().unwrap(),row.field("id").unwrap().as_str().unwrap().to_owned())); } }
            let Some(next) = page.next else { break };
            cursor = Value::String(next);
        }
        assert_eq!(actual,expected);
    };
    check(&mut e,&counts);
    for (n,p) in ["a","c","b","a","c","d"].iter().enumerate() {
        like(&mut e,&format!("l{n}"),id(p),true,1); counts.get_mut(p).unwrap().0 += 1; check(&mut e,&counts);
    }
    mutate(&mut e,"unlike",&[("id",id("l0"))]); counts.get_mut("a").unwrap().0 -= 1; check(&mut e,&counts);
    mutate(&mut e,"deletePost",&[("id",id("c"))]); counts.remove("c"); check(&mut e,&counts);
}

#[test]
fn writes_and_result_fields_refuse_and_brand_stays_a_write_key() {
    for body in [
        "insert posts { at: 0, likeCount: 0 }",
        "insert posts { at: 0, likeCount: 0 } if absent",
        "update posts['p'] { likeCount: 0 }",
        "upsert posts['p'] { at: 0, likeCount: 0 }",
    ].into_iter().flat_map(|body| ["likeCount","selected","total"].map(|field| body.replace("likeCount",field))) {
        let b = snapback4_lang::compile(&[("schema.q".into(),format!("{MODEL}\nmutation bad():\n  {body}\n"))]);
        assert!(b.programs.iter().all(|p|p.program.name != "bad"));
        assert!(b.diagnostics.iter().any(|d|d.code == "E_MAINTAINED_COLUMN"),"{body}: {:?}",b.diagnostics);
    }
    for body in ["return (insert posts { at: 0 }).likeCount","return (insert posts { at: 0 }) { likeCount }","return (update posts['p'] { at: 1 }).likeCount"].into_iter().flat_map(|body| ["likeCount","selected","total"].map(|field|body.replace("likeCount",field))) {
        let b = snapback4_lang::compile(&[("schema.q".into(),format!("{MODEL}\nmutation bad():\n  {body}\n"))]);
        assert!(b.programs.iter().all(|p|p.program.name != "bad"));
        assert!(b.diagnostics.iter().any(|d|d.code == "E_MAINTAINED_COLUMN_RESULT"),"{body}: {:?}",b.diagnostics);
    }
    let source = MODEL.replacen("  delete <- allow","  update <- allow\n  delete <- allow",1)
        + "\nmutation chained():\n  row = insert posts { at: 0 }\n  return update posts[row] { at: 1 }\n";
    let bound = compile(&source);
    let ts = snapback4_lang::emit::typescript(&bound);
    assert!(ts.lines().any(|line|line.contains("chained:") && line.contains("WriteRows[\"posts\"]")),"{ts}");
    assert!(!ts.contains("$column"));
    assert!(!snapback4_lang::emit::rust(&bound).contains("$column"));
    let mut e = engine(&source);
    let row = mutate(&mut e,"chained",&[]);
    assert_eq!(row.field("at").unwrap(),&Value::Int(1));
    for field in ["likeCount","selected","total"] { assert!(row.field(field).is_err()); }
}

#[test]
fn resolved_dependencies_and_private_projection() {
    for field in ["likeCount","selected","total"] {
    for line in ["  read <- .likeCount = 0","  immutable likeCount","  unique byCount: likeCount","  cap 1 by likeCount","  sync public last 2 by byLikes"] {
        let line=line.replace("likeCount",field);
        let model=MODEL.replace("by byLikes: likeCount",&format!("by byLikes: {field}"));
        let base = model.replace("  public\n  insert <- allow", "  insert <- allow");
        let base = if line.starts_with("  sync") { base.replacen("  online only","  public",1) } else { base };
        let source = base.replacen("  at: time",&format!("  at: time\n{line}"),1);
        let b = snapback4_lang::compile(&[("schema.q".into(),source)]);
        assert!(!b.diagnostics.is_empty(),"admitted {line}");
        assert!(b.diagnostics.iter().any(|d|d.code == "E_MAINTAINED_COLUMN" && d.message.contains(&format!("posts.{field}"))),"{line}: {:?}",b.diagnostics);
    }
    }
    let bound = compile(MODEL);
    assert!(bound.schema.maintain_for("posts").is_none());
    let projection = bound.schema.public_projection();
    assert_eq!(bound.schema.maintains.len(),3);
    for m in &bound.schema.maintains {
        let owner=m.private.as_ref().unwrap();
        assert_eq!(owner.table,"posts");
        assert!(["likeCount","selected","total"].contains(&owner.column.as_str()));
        assert_eq!(m.source,"likes");assert_eq!(m.by,["postId"]);
        assert_eq!(bound.schema.tables["posts"].maintained[&owner.column],m.derivation_identity());
        assert!(!bound.schema.visible(&m.target));
        assert!(bound.schema.tables[&m.target].sync.is_none());
        for text in [serde_json::to_string(&projection).unwrap(),snapback4_lang::emit::typescript(&bound),snapback4_lang::emit::rust(&bound)] {assert!(!text.contains(&m.target));}
    }
    let synced=compile(&MODEL.replace("  online only","  sync public"));
    assert_eq!(synced.schema.maintains.len(),3);
    assert!(synced.schema.tables["posts"].sync.is_some() && synced.schema.tables["likes"].sync.is_some());
    assert!(synced.schema.maintains.iter().all(|m|synced.schema.tables[&m.target].sync.is_none()));
    assert_eq!(projection.tables.len(),2);
    assert!(projection.maintains.is_empty());
    assert_eq!(projection.tables["posts"].maintained.len(),3);
    assert!(snapback4_core::schema::validate(&projection).is_empty());
    let mut raw = bound.schema.clone();
    raw.tables.get_mut("likes").unwrap().rules.insert = snapback4_core::schema::RuleExpr::Exists {
        table: raw.maintains[0].target.clone(),index:"byGroup".into(),key:vec![snapback4_core::schema::RuleTerm::Field("postId".into())],equalities:vec![],provenance:snapback4_core::ir::KeyProvenance::Computed,
    };
    let issues = snapback4_core::schema::validate(&raw);
    assert!(issues.iter().any(|i|i.message.contains("posts.likeCount")),"{issues:?}");
}

#[test]
fn activation_redefinitions_empty_admission_and_unchanged_preservation() {
    let mut e = engine(MODEL);
    post(&mut e,"p",1); like(&mut e,"l",id("p"),true,3);
    let before = totals(&mut e,"p");
    let b = compile(&(MODEL.to_string()+"\nquery extra():\n  return 1\n"));
    e.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    assert_eq!(totals(&mut e,"p"),before);
    for source in [
        MODEL.replace("likeCount: count likes by postId","likeCount: sum likes of amount by postId"),
        MODEL.replace("likeCount: count likes by postId","likeCount: count likes where .active by postId"),
        MODEL.replace("  active: bool","  active: bool default true"),
        MODEL.replace("likeCount: count likes by postId","likeCount: count likes by alternate").replace("  postId: posts ?","  postId: posts ?\n  alternate: posts ?"),
        format!("{}\ntable otherLikes:\n  postId: posts ?\n  public\n  online only\n",MODEL.replace("likeCount: count likes by postId","likeCount: count otherLikes by postId")),
        MODEL.replace("  likeCount: count likes by postId\n","").replace("  by byLikes: likeCount, at, id","  by byLikes: at, id").replace("{ id, at, likeCount }","{ id, at }"),
    ] {
        let b = compile(&source);
        e.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
        let row = e.query("postRow",context(&[("id",id("p"))])).unwrap().data;
        assert_eq!(row.field("selected").unwrap(), &Value::Int(1));
        assert_eq!(row.field("total").unwrap(), &Value::Int(3));
    }
    let bare = MODEL.replace("  likeCount: count likes by postId\n","").replace("  selected: count likes where .active by postId\n","").replace("  total: sum likes of amount where .active by postId\n","")
        .replace("  by byLikes: likeCount, at, id","  by byLikes: at, id").replace("{ id, at, likeCount }","{ id, at }");
    let mut empty = engine(&bare);
    like(&mut empty,"l",id("later"),true,8);
    let b = compile(MODEL);
    empty.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    post(&mut empty,"later",1);
    assert_eq!(totals(&mut empty,"later"),(1,1,8));
    let mut populated = engine(&bare);
    mutate(&mut populated,"post",&[("id",id("p")),("at",Value::Int(1))]);
    let b = compile(MODEL);
    populated.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    assert_eq!(totals(&mut populated,"p"),(0,0,0));
}

#[test]
fn null_references_are_excluded_before_sum_and_import_recounts() {
    let mut e = engine(MODEL);
    for name in ["n1","n2"] { like(&mut e,name,Value::Null,true,snapback4_core::value::I53_MAX); }
    post(&mut e,"p",1);
    assert_eq!(totals(&mut e,"p"),(0,0,0));
    e.load_mode([("posts".into(),snapback4_core::value::object([("id",id("p")),("at",Value::Int(1))]))],snapback4_core::engine::LoadMode::Restore).unwrap();
    let stored=e.store().rows("posts").unwrap();
    let head=e.seq().unwrap();
    assert_eq!(e.load(std::iter::empty()).unwrap(),0);
    assert_eq!(e.seq().unwrap(),head);
    assert_eq!(e.store().rows("posts").unwrap(),stored,"an empty import cannot mirror without a row event");
    let row = snapback4_core::value::object([("id",id("p")),("at",Value::Int(1)),("likeCount",Value::Int(999)),("total",Value::Int(999))]);
    e.load([("posts".into(),row)]).unwrap();
    assert_eq!(totals(&mut e,"p"),(0,0,0));
    mutate(&mut e,"change",&[("id",id("n1")),("postId",id("p")),("active",Value::Bool(true)),("amount",Value::Int(2))]);
    assert_eq!(totals(&mut e,"p"),(1,1,2));
}

#[test]
fn paired_parent_worlds_have_equal_replies_receipts_meters_and_invalidations() {
    use snapback4_core::{meter::Ceilings,value::object,engine::LoadMode};
    let source = MODEL.replacen("  at: time","  owner: principal default viewer\n  by byOwner: owner, id\n  until: time ?\n  by byUntil: until, id\n  expire at .until\n  at: time",1)
        .replacen("  public","  read <- .owner = viewer",1).replacen("  online only","  sync to .owner",1);
    let observe = |world: u8, ceilings: Ceilings, system: bool| {
        let mut e = engine(&source);
        // Keep the same commit head in all four worlds.
        let parent = if world == 0 { "other" } else { "p" };
        e.load_mode([("posts".into(),object([("id",id(parent)),("at",Value::Int(1)),("owner",id("bob")),("until",if world == 3 {Value::Int(1)} else {Value::Null}),
            ("likeCount",Value::Int(if world == 2 {77} else {0})),("selected",Value::Int(0)),("total",Value::Int(0))]))],LoadMode::Restore).unwrap();
        let start = e.seq().unwrap();
        e.set_ceilings(ceilings);
        let args = [("id",id("l")),("postId",id("p")),("active",Value::Bool(true)),("amount",Value::Int(1))];
        let context = if system { let mut c = Context::system().at(1000); c.args = args.iter().map(|(k,v)|(k.to_string(),v.clone())).collect(); c } else { context(&args) };
        let result = e.mutate("like",Some("write"),context.clone()).unwrap();
        let retry = e.mutate("like",Some("write"),context).unwrap();
        let events = e.stream("alice",start,100).unwrap().events;
        let snapshot = e.snapshot_at("alice",1000).unwrap();
        (result.reply(Some("write")),result.receipt(Some("write")),result.metered,result.tables,retry.reply(Some("write")),events,snapshot)
    };
    for system in [false,true] {
        let expected = observe(0,Ceilings::default(),system);
        assert_eq!(expected.3,vec!["likes","posts"]);
        for world in 1..4 { assert_eq!(observe(world,Ceilings::default(),system),expected,"world {world}, system {system}"); }
        let m = expected.2;
        for kind in 0..7 {
            let mut ceiling = Ceilings::default();
            match kind {
                0 => ceiling.examined=m.examined.saturating_sub(1),
                1 => ceiling.index_entries=m.index_entries.saturating_sub(1),
                2 => ceiling.rows_written=m.rows_written.saturating_sub(1),
                3 => ceiling.steps=m.steps.saturating_sub(1),
                4 => {
                    let (mut low,mut high)=(0,Ceilings::default().heap_bytes);
                    while low < high { let mid=(low+high)/2; let c=Ceilings {heap_bytes:mid,..Ceilings::default()};
                        if observe(0,c,system).0["state"] == "sent" {high=mid} else {low=mid+1}
                    }
                    ceiling.heap_bytes=low-1;
                },
                5 => ceiling.output_bytes=m.output_bytes.saturating_sub(1),
                _ => { if m.rule_probes == 0 { continue } ceiling.rule_probes=m.rule_probes-1; },
            }
            let expected = observe(0,ceiling,system);
            assert_eq!(expected.0["state"],"failed","ceiling {kind}");
            for world in 1..4 { assert_eq!(observe(world,ceiling,system),expected,"cut {kind}, world {world}, system {system}"); }
        }
    }
}

#[test]
fn raw_ir_system_and_seed_guard_and_overflow_are_owned_by_column() {
    use snapback4_core::{ir::*,value::object};
    let b = compile(MODEL);
    let row = object([("id",id("p")),("at",Value::Int(1)),("likeCount",Value::Int(0))]);
    for stmt in [
        Stmt::Insert {table:"posts".into(),row:Expr::Literal(row.clone())},
        Stmt::InsertIfAbsent {table:"posts".into(),row:Expr::Literal(row.clone()),result:"r".into()},
        Stmt::Upsert {table:"posts".into(),key:Expr::Literal(id("p")),row:Expr::Literal(row.clone())},
        Stmt::Update {table:"posts".into(),key:Expr::Literal(id("p")),patch:Expr::Literal(object([("likeCount",Value::Int(0))]))},
    ] {
        let p = Program {name:"bad".into(),kind:ProgramKind::Mutation,args:BTreeMap::new(),read_time_granularity_ms:None,body:vec![stmt],native:false,returned_shapes:Default::default()};
        let mut e = Engine::memory(b.schema.clone(),[p]).unwrap();
        e.load_mode([("posts".into(), object([("id",id("p")),("at",Value::Int(1))]))],snapback4_core::engine::LoadMode::Restore).unwrap();
        let snapshot = |e: &Engine| (e.seq().unwrap(), e.schema().tables.keys().map(|t| (t.clone(),e.store().rows(t).unwrap())).collect::<BTreeMap<_,_>>());
        let before=snapshot(&e);
        for context in [context(&[]),Context::system().at(1000)] {
            let result = e.mutate("bad",None,context).unwrap();
            let WriteState::Failed {why,..}=result.state else {panic!("{result:?}")};
            assert_eq!(why.code,"E_MAINTAINED_COLUMN");
            assert_eq!(snapshot(&e),before);
        }
        assert_eq!(e.seed([("posts".into(),row.clone())]).unwrap_err().refusal().code,"E_MAINTAINED_COLUMN");
        assert_eq!(snapshot(&e),before);
    }
    let mut e = engine(MODEL);
    like(&mut e,"max",id("hidden"),true,snapback4_core::value::I53_MAX);
    let out = e.mutate("like",None,context(&[("id",id("overflow")),("postId",id("hidden")),("active",Value::Bool(true)),("amount",Value::Int(1))])).unwrap();
    let WriteState::Failed {why,..}=out.state else {panic!("{out:?}")};
    assert_eq!(why.code,"E_OVERFLOW");
    assert!(why.message.contains("posts") && why.message.contains("total"));
    assert!(!why.message.contains("$column"));
    post(&mut e,"hidden",1);
    assert_eq!(totals(&mut e,"hidden"),(1,1,snapback4_core::value::I53_MAX));
}

#[test]
fn birth_recreation_expiry_and_transaction_rollback_follow_the_source() {
    let source = MODEL.replacen("  at: time", "  until: time ?\n  by byUntil: until, id\n  expire at .until\n  at: time",1);
    let mut e = engine(&source);
    like(&mut e,"l1",id("p"),true,3);
    post(&mut e,"p",1);
    mutate(&mut e,"deletePost",&[("id",id("p"))]);
    like(&mut e,"l2",id("p"),true,4);
    post(&mut e,"p",2);
    assert_eq!(totals(&mut e,"p"),(2,2,7));
    e.seed_at([("posts".into(),snapback4_core::value::object([("id",id("p")),("until",Value::Int(900))]))],800).unwrap();
    like(&mut e,"l3",id("p"),false,50);
    assert_eq!(e.query("postRow",context(&[("id",id("p"))])).unwrap().data,Value::Null);
    assert_eq!(e.sweep_expired(1000,100).unwrap(),1);
    like(&mut e,"l4",id("p"),true,5);
    post(&mut e,"p",3);
    assert_eq!(totals(&mut e,"p"),(4,3,12));
    let b = compile(&format!("{MODEL}\nmutation abort():\n  insert likes {{ id: 'nope', postId: 'p', active: true, amount: 100 }}\n  require false else STOP\n"));
    let mut e = Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    post(&mut e,"p",0);
    assert!(matches!(e.mutate("abort",None,context(&[])).unwrap().state,WriteState::Failed{..}));
    assert_eq!(totals(&mut e,"p"),(0,0,0));
    like(&mut e,"nope",id("p"),true,2);
    assert_eq!(totals(&mut e,"p"),(1,1,2));
}

#[test]
fn self_reference_both_orders_and_reference_named_value() {
    for child_first in [false,true] {
        let body = if child_first {"insert nodes { id: 'c', value: 'p' }\n  insert nodes { id: 'p', value: null }"} else {"insert nodes { id: 'p', value: null }\n  insert nodes { id: 'c', value: 'p' }"};
        let source = format!("table nodes:\n  value: nodes ?\n  children: count nodes by value\n  public\n  insert <- allow\n  online only\nmutation create():\n  {body}\nquery parent():\n  return nodes['p']\n");
        let mut e = engine(&source);
        mutate(&mut e,"create",&[]);
        assert_eq!(e.query("parent",context(&[])).unwrap().data.field("children").unwrap(),&Value::Int(1));
    }
}

#[test]
fn notes_name_disclosure_order_and_full_parent_stream_at_the_declaration() {
    let source = MODEL.replacen("  online only","  sync public",1).replacen("table likes:\n", "table likes:\n  owner: principal default viewer\n",1)
        .replacen("  public\n  insert <- allow\n  update <- allow", "  read <- .owner = viewer\n  insert <- .owner = viewer\n  update <- .owner = viewer",1);
    let b = compile(&source);
    let notes:Vec<_> = b.notes.iter().filter(|n| n.code.starts_with("N_MAINTAINED_COLUMN")).collect();
    assert_eq!(notes.len(),4,"{notes:?}");
    assert_eq!(notes.iter().filter(|n|n.code=="N_MAINTAINED_COLUMN_DISCLOSURE").count(),3);
    for field in ["likeCount","selected","total"] {
        assert_eq!(notes.iter().filter(|n|n.code=="N_MAINTAINED_COLUMN_DISCLOSURE" && n.message.starts_with(&format!("posts.{field} "))).count(),1);
    }
    for m in &b.schema.maintains { assert!(!serde_json::to_string(&notes).unwrap().contains(&m.target)); }
    let stream = notes.iter().find(|n|n.code == "N_MAINTAINED_COLUMN_STREAM").unwrap();
    assert_eq!(source.lines().nth((stream.site.line-1) as usize).unwrap().trim(),"sync public");
    assert!(stream.message.contains("posts") && stream.message.contains("whole parent image") && stream.message.contains("4,000"));
    assert!(notes.iter().any(|n|n.message.contains("sum of predicate-selected") && n.message.contains("overflow")));
    assert!(notes.iter().any(|n|n.message.contains("index discloses relative order")));
    assert!(compile(MODEL).notes.iter().all(|n|!n.code.starts_with("N_MAINTAINED_COLUMN")));
}

#[test]
fn raw_private_reads_and_every_resolved_dependency_are_refused() {
    use snapback4_core::{ir::*,schema::*};
    let b = compile(MODEL);
    let private = b.schema.maintains[0].target.clone();
    let point=Read {table:private.clone(),index:"byId".into(),key:vec![Expr::Literal(id("p"))],site:"private".into(),provenance:KeyProvenance::Computed};
    let scan=Scan {table:private.clone(),index:"byId".into(),prefix:vec![],order:Order::Asc,take:Bound::Literal(1),site:"private".into(),provenance:KeyProvenance::Computed,existence:false,after:None,before:None,range:None,filter:None,opaque_cursor:false,merge_site:None};
    for expression in [Expr::Get(point.clone()),Expr::Exists(point),Expr::Scan(scan)] {
        let program = Program { name:"private".into(),kind:ProgramKind::Query,args:BTreeMap::new(),read_time_granularity_ms:None,native:false,returned_shapes:Default::default(),body:vec![Stmt::Return(expression)] };
        let error = Engine::memory(b.schema.clone(),[program]).err().unwrap();
        assert_eq!(error.refusal().code,"E_MAINTAINED_COLUMN_PRIVATE");
        assert!(error.to_string().contains("posts.likeCount"));
    }
    for field in ["likeCount","selected","total"] {
    let variants = [
        RuleExpr::Eq(RuleTerm::OldField(field.into()),RuleTerm::Literal(Value::Int(0))),
        RuleExpr::Eq(RuleTerm::NextField(field.into()),RuleTerm::Literal(Value::Int(0))),
        RuleExpr::Exists {table:"posts".into(),index:"byLikes".into(),key:vec![RuleTerm::Literal(Value::Int(0))],equalities:vec![],provenance:KeyProvenance::Computed},
        RuleExpr::Exists {table:"posts".into(),index:"byId".into(),key:vec![],equalities:vec![(field.into(),RuleTerm::Literal(Value::Int(0)))],provenance:KeyProvenance::Computed},
    ];
    for rule in variants {
        for arm in ["insert","update","delete"] {
            let mut schema = b.schema.clone();
            schema.tables.get_mut("posts").unwrap().indexes.insert("byLikes".into(),Index::of(&[field,"at","id"],false));
            let rules=&mut schema.tables.get_mut("posts").unwrap().rules;
            match arm {"insert"=>rules.insert=rule.clone(),"delete"=>rules.delete=rule.clone(),_=>rules.update=rule.clone()}
            let issues = snapback4_core::schema::validate(&schema);
            assert!(issues.iter().any(|i|i.message.contains(&format!("posts.{field}")) && i.message.contains(&format!("rules.{arm}")) && i.message.contains("use an ordinary column")),"{issues:?}");
        }
    }
    }
    for source in [
        MODEL.replace("  amount: int","  amount: int\n  expiry: time ?\n  by byExpiry: expiry\n  expire at .expiry"),
        MODEL.replace("  total: sum likes of amount where .active by postId","  total: sum posts of likeCount by id"),
        format!("{MODEL}\nmaintain cascade: sum posts of likeCount by at\n  online only\n  read <- allow\n"),
    ] {
        let b = snapback4_lang::compile(&[("schema.q".into(),source)]);
        assert!(!b.diagnostics.is_empty());
        assert!(b.diagnostics.iter().any(|d|d.guide == "maintains"),"{:?}",b.diagnostics);
    }
}

#[test]
fn creators_cannot_observe_hidden_totals_in_write_results_or_budgets() {
    for readable in [false,true] {
        let source = if readable { MODEL.to_string() } else {MODEL.replacen("  public","  read <- deny",1)};
        let observe = |nonzero:bool, ceilings:snapback4_core::meter::Ceilings| {
            let mut e = engine(&source);
            like(&mut e,"l",if nonzero {id("p")} else {id("other")},true,4);
            e.set_ceilings(ceilings);
            let out = e.mutate("post",Some("create"),context(&[("id",id("p")),("at",Value::Int(1))])).unwrap();
            let public=serde_json::json!([out.reply(Some("create")),out.receipt(Some("create")),out.tables]).to_string();
            for m in &e.schema().maintains { assert!(!public.contains(&m.target)); }
            if matches!(out.state,WriteState::Sent {..}) {
                let row=e.store().rows("posts").unwrap().into_iter().find(|r|r.field("id").unwrap()==&id("p")).unwrap();
                let n=i64::from(nonzero);
                assert_eq!(["likeCount","selected","total"].map(|field|row.field(field).unwrap().as_int().unwrap()),[n,n,n*4]);
                assert_eq!(out.tables,["posts"]);
                for m in &e.schema().maintains {assert!(!format!("{out:?}").contains(&m.target));}
            }
            (out.reply(Some("create")),out.receipt(Some("create")),out.metered,out.tables)
        };
        let control = observe(false,Default::default());
        assert_eq!(control.0["state"],"sent");
        assert_eq!(observe(true,Default::default()),control);
        assert!(control.0["result"].get("likeCount").is_none());
        for c in [snapback4_core::meter::Ceilings {examined:control.2.examined-1,..Default::default()},snapback4_core::meter::Ceilings {heap_bytes:1,..Default::default()}] {
            let refused=observe(false,c);
            assert_eq!(refused.0["state"],"failed");
            assert_eq!(refused,observe(true,c));
        }
    }
}

#[test]
fn moving_key_cursor_is_a_key_boundary_not_a_frozen_ranking() {
    let mut e = engine(MODEL);
    for (p,at) in [("a",1),("b",2),("c",3)] {post(&mut e,p,at)}
    let first=e.query("ranked",context(&[("c",Value::Null)])).unwrap();
    let cursor=first.next.unwrap(); // c then b; boundary (0,2,b).
    like(&mut e,"l",id("a"),true,1); // a moves ahead of the saved boundary.
    let continuation=e.query("ranked",context(&[("c",Value::String(cursor))])).unwrap();
    assert_eq!(continuation.data,Value::Array(vec![].into()));
    let fresh=e.query("ranked",context(&[("c",Value::Null)])).unwrap();
    assert_eq!(fresh.data.as_array().unwrap()[0].field("id").unwrap(),&id("a"));
}

#[test]
fn adapter_failures_after_private_write_and_between_mirrors_roll_back_every_image() {
    for column in ["likeCount","selected"] {
        let mut e=engine(MODEL);
        post(&mut e,"p",1);
        let seq=e.seq().unwrap();
        // BEFORE the private INSERT's matching parent write (first or second mirror).
        // r holds tagged row JSON. A failed adapter operation aborts the real transaction.
        let condition=if column=="likeCount" {"1"} else {"json_extract(NEW.data, '$.Row.likeCount.Int') = 1 AND json_extract(NEW.data, '$.Row.selected.Int') = 1"};
        e.store().conn().execute_batch(&format!("CREATE TRIGGER fail_mirror BEFORE UPDATE ON r WHEN NEW.t = (SELECT num FROM _catalog WHERE name = 'posts') AND {condition} BEGIN SELECT RAISE(ABORT, 'injected mirror failure'); END;")).unwrap();
        let result=e.mutate("like",None,context(&[("id",id("l")),("postId",id("p")),("active",Value::Bool(true)),("amount",Value::Int(5))]));
        assert!(format!("{result:?}").contains("injected mirror failure"),"{result:?}");
        assert_eq!(e.seq().unwrap(),seq);
        assert_eq!(totals(&mut e,"p"),(0,0,0));
        assert!(e.store().rows("likes").unwrap().is_empty());
        for m in &e.schema().maintains {assert!(e.store().rows(&m.target).unwrap().is_empty());}
        e.store().conn().execute_batch("DROP TRIGGER fail_mirror").unwrap();
        assert_eq!(e.seq().unwrap(),seq);
        assert_eq!(totals(&mut e,"p"),(0,0,0));
        like(&mut e,"l",id("p"),true,5);
        assert_eq!(totals(&mut e,"p"),(1,1,5));
    }
}

#[test]
fn hidden_total_transitions_and_noop_reservation_lifetime_are_constant() {
    use snapback4_core::{value::object,meter::Ceilings};
    let source=format!("{MODEL}\nmutation absentTwice():\n  insert likes {{ id: 'same', postId: 'p', active: true, amount: 1 }} if absent\n  insert likes {{ id: 'same', postId: 'p', active: true, amount: 1 }} if absent\nmutation put(id: likes):\n  upsert likes[id] {{ postId: 'p', active: true, amount: 1 }}\n");
    let observe=|n:usize,delete:bool,ceilings:Ceilings| {
        let mut e=engine(&source);
        let rows=std::iter::once(("posts".into(),object([("id",id("p")),("at",Value::Int(1))])))
            .chain((0..n).map(|i|("likes".into(),object([("id",id(&format!("old{i}"))),("postId",id("p")),("active",Value::Bool(true)),("amount",Value::Int(1))]))));
        e.seed_at(rows,1000).unwrap();
        e.set_ceilings(ceilings);
        let args=if delete {vec![("id",id("old0"))]} else {vec![("id",id("new")),("postId",id("p")),("active",Value::Bool(true)),("amount",Value::Int(1))]};
        let op=if delete {"unlike"} else {"like"};
        let out=e.mutate(op,Some("mutation"),context(&args)).unwrap();
        (out.reply(Some("mutation")),out.receipt(Some("mutation")),out.metered,out.tables)
    };
    for delete in [false,true] {
        let min=usize::from(delete);
        let reference=observe(min,delete,Default::default());
        for n in [min+1,7] {assert_eq!(observe(n,delete,Default::default()),reference)}
        for c in [Ceilings {rows_written:reference.2.rows_written-1,..Default::default()},Ceilings {index_entries:reference.2.index_entries-1,..Default::default()},Ceilings {steps:reference.2.steps-1,..Default::default()},Ceilings {examined:reference.2.examined-1,..Default::default()},Ceilings {heap_bytes:1,..Default::default()}] {
            for n in [min+1,7] {assert_eq!(observe(n,delete,c),observe(min,delete,c))}
        }
    }
    let mut e=engine(&source);
    post(&mut e,"p",1);
    let insert=e.mutate("like",None,context(&[("id",id("l")),("postId",id("p")),("active",Value::Bool(true)),("amount",Value::Int(1))])).unwrap();
    let upsert=e.mutate("put",None,context(&[("id",id("new"))])).unwrap();
    assert_eq!(upsert.metered.rows_written,insert.metered.rows_written,"upsert reserves only once");
    let double=e.mutate("absentTwice",None,context(&[])).unwrap();
    assert!(matches!(double.state,WriteState::Sent{..}));
    assert_eq!(double.metered.rows_written,2*(insert.metered.rows_written-1)+1,"the no-op attempt has its own reservation");
    assert_eq!(totals(&mut e,"p"),(3,3,3));
}

#[test]
fn column_predicates_reuse_engine_recorded_attribution() {
    let source=MODEL.replacen("  at: time","  parentId: posts ?\n  immutable parentId\n  at: time",1)
        .replace("selected: count likes where .active by postId","selected: count likes where postId.parentId = null by postId")
        .replace("  active: bool","  immutable postId\n  active: bool");
    let b=compile(&source);
    assert!(b.schema.tables["likes"].recorded.contains_key("postId.parentId"));
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    post(&mut e,"p",1);like(&mut e,"l",id("p"),true,3);
    let captured=e.store().rows("likes").unwrap();
    assert_eq!(captured[0].field("postId.parentId").unwrap(),&Value::Null);
    let private=e.schema().maintains.iter().map(|m|(m.target.clone(),e.store().rows(&m.target).unwrap())).collect::<BTreeMap<_,_>>();
    assert_eq!(totals(&mut e,"p"),(1,1,3));
    mutate(&mut e,"deletePost",&[("id",id("p"))]);
    assert_eq!(e.store().rows("likes").unwrap(),captured);
    for (target,rows) in &private {assert_eq!(e.store().rows(target).unwrap(),*rows);}
    e.seed_at([("posts".into(),snapback4_core::value::object([("id",id("p")),("at",Value::Int(2)),("parentId",id("other"))]))],1000).unwrap();
    // The live parent now differs from the captured null without rewriting the like.
    assert_eq!(totals(&mut e,"p"),(1,1,3));
    assert_eq!(e.store().rows("likes").unwrap(),captured);
    for (target,rows) in &private {assert_eq!(e.store().rows(target).unwrap(),*rows);}
    let parent=e.query("postRow",context(&[("id",id("p"))])).unwrap().data;
    assert_eq!(parent.field("parentId").unwrap(),&id("other"));
    assert!(!e.schema().tables["posts"].expired(&parent,1000));
    post(&mut e,"other",3);
    assert_eq!(totals(&mut e,"other"),(0,0,0));
}

#[test]
fn word_index_order_is_in_the_reserved_mirror_budget() {
    let source=MODEL.replacen("  at: time","  body: text <=80 default 'one two three'\n  by byWords: words(body), likeCount, id\n  at: time",1);
    let mut e=engine(&source);post(&mut e,"p",1);
    let result=e.mutate("like",None,context(&[("id",id("l")),("postId",id("p")),("active",Value::Bool(true)),("amount",Value::Int(1))])).unwrap();
    assert!(matches!(result.state,WriteState::Sent{..}));
    assert!(result.metered.index_entries>=3*4*80,"word-entry ceiling is included for all three private declarations: {:?}",result.metered);
    assert_eq!(totals(&mut e,"p"),(1,1,1));
}

#[test]
fn projected_derivation_identity_prevents_literal_default_image_retention() {
    let base=MODEL.replace("  postId: posts ?","  postId: posts ?\n  alternate: posts ?")+"\ntable otherLikes:\n  postId: posts ?\n  public\n  online only\n";
    let old=compile(&base).schema.public_projection();
    let added=base.replacen("  at: time","  caption: text <=8 default ''\n  at: time",1);
    let keeps=snapback4_core::successor::keeps_literal_default_images;
    assert!(keeps(&old,&compile(&added).schema.public_projection()));
    for declaration in ["sum likes of amount by postId","count otherLikes by postId","count likes where .active by postId","count likes by alternate"] {
        let next=compile(&added.replace("count likes by postId",declaration)).schema.public_projection();
        assert_ne!(old.tables["posts"].maintained["likeCount"],next.tables["posts"].maintained["likeCount"]);
        assert!(!keeps(&old,&next),"{declaration}");
    }
}

#[test]
fn one_parent_image_per_commit_has_the_hand_kept_columns_log_cost() {
    let mut e=engine(&MODEL.replace("  online only","  sync public"));
    post(&mut e,"p",1);
    let from=e.seq().unwrap();
    like(&mut e,"l",id("p"),true,4);
    let rows:Vec<(String,String)>=e.store().conn().prepare("SELECT t,kind FROM _log WHERE seq > ?1 ORDER BY t").unwrap()
        .query_map([from as i64],|r|Ok((r.get(0)?,r.get(1)?))).unwrap().map(Result::unwrap).collect();
    assert_eq!(rows.len(),2,"one source image and one full parent image: {rows:?}");
    assert_eq!(rows.iter().map(|(t,_)|t.as_str()).collect::<Vec<_>>(),["likes","posts"]);
    let page=e.stream_at("alice",from,100,1000).unwrap();
    assert_eq!(page.events.iter().filter(|event|event.table=="posts").count(),1);
    assert!(page.events.iter().all(|event|e.schema().visible(&event.table)));
    for m in &e.schema().maintains {assert!(!serde_json::to_string(&page).unwrap().contains(&m.target));}
    let parent=page.events.iter().find(|event|event.table=="posts").unwrap();
    assert_eq!(parent.kind,"put");
    let image=parent.data.as_ref().unwrap();
    assert_eq!(["likeCount","selected","total"].map(|f|image.field(f).unwrap().as_int().unwrap()),[1,1,4]);
    assert!(!serde_json::to_string(&page).unwrap().contains("$column:"));
    assert_eq!(totals(&mut e,"p"),(1,1,4));
    mutate(&mut e,"unlike",&[("id",id("l"))]);
    assert_eq!(totals(&mut e,"p"),(0,0,0));
}

#[test]
fn a_public_ranking_cannot_be_moved_outside_source_write_authority() {
    let source = MODEL.replace("table likes:\n", "table likes:\n  owner: principal default viewer\n")
        .replace("  update <- allow\n  delete <- allow", "  update <- .owner = viewer\n  delete <- .owner = viewer");
    let mut e = engine(&source);
    post(&mut e,"p",1); post(&mut e,"q",2);
    like(&mut e,"l",id("p"),true,3);
    for (op,args) in [
        ("change",vec![("id",id("l")),("postId",id("q")),("active",Value::Bool(true)),("amount",Value::Int(100))]),
        ("unlike",vec![("id",id("l"))]),
    ] {
        let mut c=context(&args); c.viewer="bob".into();
        assert!(matches!(e.mutate(op,None,c).unwrap().state,WriteState::Failed{..}));
        assert_eq!(totals(&mut e,"p"),(1,1,3));
        assert_eq!(totals(&mut e,"q"),(0,0,0));
    }
}

#[test]
fn a_raw_schema_cannot_assign_two_derivations_to_a_generated_parents_value() {
    use snapback4_core::schema::*;
    let mut schema=compile("table parents:\n  group: int\n  value: count children by parent\n  unique byGroup: group\n  public\n  online only\ntable children:\n  parent: parents\n  public\n  online only\n").schema;
    schema.tables.insert("bases".into(),public_table(
        BTreeMap::from([("id".into(),ColumnType::Id),("group".into(),ColumnType::Int)]),
        BTreeMap::from([("byId".into(),Index::of(&["id"],true))])));
    schema.maintains.push(Maintain {private:None,filter:None,computed:Default::default(),residency:Default::default(),kind:MaintainKind::Count,source:"bases".into(),by:vec!["group".into()],target:"parents".into(),readable:None});
    let error=Engine::memory(schema,[]).err().expect("raw dual derivation must be refused");
    assert!(error.to_string().contains("parents.value"),"{error}");
    assert!(error.to_string().contains("ordinary parent"),"{error}");
}

#[test]
fn raw_dependency_walk_covers_lifetime_delivery_constraints_and_capture() {
    use snapback4_core::{schema::*,ir::KeyProvenance};
    let base=compile(MODEL).schema;
    for (case,path) in [(0,"constraint"),(1,"rules.insert"),(2,"default"),(3,"expire"),(4,"sync"),(5,"sync"),(6,"indexes"),(7,"recorded"),(8,"indexes")] {
        let mut schema=base.clone();
        let posts=schema.tables.get_mut("posts").unwrap();
        match case {
            0=>posts.constraints.push(Constraint::FinalExistsOnInsert {table:"posts".into(),index:"byLikes".into(),key:vec![RuleTerm::Literal(Value::Int(0))]}),
            1=>posts.rules.insert=RuleExpr::Created {table:"posts".into(),index:"byLikes".into(),key:vec![RuleTerm::Literal(Value::Int(0))],equalities:vec![],provenance:KeyProvenance::Computed},
            2=>{posts.defaults.insert("likeCount".into(),ColumnDefault::Literal(Value::Int(0)));},
            3=>posts.expire=Some("likeCount".into()),
            4=>posts.sync=Some(Sync {audience:Audience::Column("likeCount".into()),horizon:None}),
            5=>schema.tables.get_mut("likes").unwrap().sync=Some(Sync {audience:Audience::Target {table:"posts".into(),prefix:vec!["likeCount".into()],principal:"at".into()},horizon:None}),
            6=>{posts.indexes.insert("byWords".into(),Index {components:vec![IndexComponent::WordPrefixes {fields:vec!["likeCount".into()],contract:Default::default()},IndexComponent::Column("id".into())],unique:false});},
            7=>{
                let likes=schema.tables.get_mut("likes").unwrap();
                likes.columns.insert("postId.likeCount".into(),ColumnType::Optional(Box::new(ColumnType::Int)));
                likes.recorded.insert("postId.likeCount".into(),RecordedField {reference:"postId".into(),table:"posts".into(),column:"likeCount".into()});
            },
            _=>{posts.indexes.insert("hidden".into(),Index {components:vec![IndexComponent::Contribution(Box::new(schema.maintains[0].clone()))],unique:false});},
        }
        let issues=columns::validate(&schema);
        assert!(issues.iter().any(|i|i.path.contains(path)&&i.message.contains("posts.likeCount")&&i.message.contains("use an ordinary column")),"case {case}: {issues:?}");
        assert!(Engine::memory(schema,[]).is_err(),"case {case}");
    }
}

#[test]
fn a_generated_source_is_refused_even_in_an_otherwise_well_typed_raw_schema() {
    use snapback4_core::schema::*;
    let mut schema=compile(MODEL).schema;
    let source_kind=schema.tables["likes"].columns["postId"].clone();
    schema.tables.insert("grouped".into(),public_table(
        BTreeMap::from([("id".into(),ColumnType::Id),("postId".into(),source_kind),("value".into(),ColumnType::Int)]),
        BTreeMap::from([("byId".into(),Index::of(&["id"],true)),("byGroup".into(),Index::of(&["postId"],true))])));
    let private=schema.maintains.iter_mut().find(|m|m.private.as_ref().is_some_and(|o|o.column=="likeCount")).unwrap();
    private.source="grouped".into();
    schema.tables.get_mut("posts").unwrap().maintained.insert("likeCount".into(),private.derivation_identity());
    schema.maintains.push(Maintain {private:None,filter:None,computed:Default::default(),residency:Default::default(),kind:MaintainKind::Count,source:"likes".into(),by:vec!["postId".into()],target:"grouped".into(),readable:None});
    let error=Engine::memory(schema,[]).err().expect("generated sources cannot feed column aggregates");
    let message=error.to_string();
    assert!(message.contains("posts.likeCount")&&message.contains("generated source grouped")&&message.contains("ordinary source"),"{message}");
}

#[test]
fn private_targets_stay_bounded_for_long_table_and_column_names() {
    let parent="p".repeat(300);
    let column="c".repeat(300);
    let source=MODEL.replace("posts",&parent).replace("likeCount",&column);
    let bound=compile(&source);
    assert_eq!(bound.schema.maintains.len(),3);
    for m in &bound.schema.maintains {
        assert_eq!(m.private.as_ref().unwrap().table,parent);
        assert!(!bound.schema.visible(&m.target));
        assert!(m.target.len()+"byGroup".len()<=snapback4_core::rows::MAX_INDEX_LABEL_BYTES);
    }
    let mut e=engine(&source);
    like(&mut e,"before",id("p"),true,1);
    assert!(e.store().rows(&parent).unwrap().is_empty());
    post(&mut e,"p",1);
    assert_eq!(e.query("postRow",context(&[("id",id("p"))])).unwrap().data.field(&column).unwrap(),&Value::Int(1));
    like(&mut e,"after",id("p"),true,2);
    let row=e.query("postRow",context(&[("id",id("p"))])).unwrap().data;
    assert_eq!(row.field(&column).unwrap(),&Value::Int(2));
}

#[path = "maintained_columns/review.rs"]
mod review;
#[path = "maintained_columns/meter_review.rs"]
mod meter_review;

#[path = "maintained_columns/activation.rs"]
mod activation;
