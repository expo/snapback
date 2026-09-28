use snapback4_core::{Context, Engine, WriteState, wire};
use serde_json::json;
#[test]
fn sequence_first_membership_reproduces_before_changes() {
    let source = include_str!("../../../reports/20260928-mp-modeling-papercuts/reproduction/sequence/snapback/schema.q");
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let profile = wire::row_from_json(&e.schema().tables["profiles"], &json!({"id":"profile", "principal":"bob", "displayName":"Bob", "handle":"bob", "bio":"", "location":""})).unwrap();
    e.load(vec![("profiles".into(), profile)]).unwrap();
    let args = [("id".into(), snapback4_core::Value::Id("chat".into())), ("other".into(), snapback4_core::Value::Id("bob".into())), ("title".into(), snapback4_core::Value::String("Chat".into())), ("description".into(), snapback4_core::Value::String("".into()))].into();
    let result = e.mutate("createGroup", None, Context::new("alice", args).at(100)).unwrap();
    let WriteState::Failed { why, .. } = result.state else { panic!("{result:?}") };
    assert_eq!(why.code, "E_RULE");
    println!("{}", serde_json::to_string(&why).unwrap());
    assert!(e.store().rows("members").unwrap().is_empty());
    assert!(e.store().rows("conversations").unwrap().is_empty());
}

const REWRITTEN: &str = include_str!("fixtures/mp/builder.q");
fn engine(source: &str) -> Engine {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn load(e: &mut Engine, table: &str, row: serde_json::Value) {
    let row = wire::row_from_json(&e.schema().tables[table], &row).unwrap();
    e.load(vec![(table.into(),row)]).unwrap();
}
fn chat(e: &mut Engine, name: &str, owner: &str) {
    load(e, "conversations", json!({"id":name,"kind":"group","title":"Chat","description":"","creator":owner}));
    load(e, "members", json!({"id":format!("member-{name}"),"conversation":name,"principal":owner,"role":"admin","joinedOrdinal":0}));
    load(e, "messages", json!({"id":format!("message-{name}"),"conversation":name,"sender":"sender","ordinal":1,"recipients":1,"text":"Hello","at":1,"expiresAt":null}));
}
fn react(e: &mut Engine, id: &str, parent: &str, owner: &str, emoji: &str) {
    load(e,"reactions",json!({"id":id,"message":format!("message-{parent}"),"conversation":parent,"principal":owner,"emoji":emoji}));
}
#[test]
fn rewritten_builder_returns_each_messages_emoji_totals_in_one_page() {
    let mut e = engine(REWRITTEN);
    chat(&mut e,"ours","alice"); chat(&mut e,"hidden","bob");
    react(&mut e,"r1","ours","alice","heart"); react(&mut e,"r2","ours","bob","heart"); react(&mut e,"r3","ours","carol","laugh");
    for n in 0..25 { react(&mut e,&format!("hidden{n}"),"hidden",&format!("u{n}"),"hidden"); }
    let q = e.query("apiHistory", Context::new("alice", [("conversation".into(),snapback4_core::Value::Id("ours".into()))].into()).at(10)).unwrap();
    assert!(q.complete, "{q:?}");
    let rows = wire::to_json(&q.data);
    assert_eq!(rows[0]["reactions"], json!([{"emoji":"heart","count":2,"mine":true},{"emoji":"laugh","count":1,"mine":false}]));
    println!("rewritten builder reactions: {}", rows[0]["reactions"]);
}
#[test]
fn parent_denials_hide_other_groups_and_unpinned_scan_still_refuses() {
    let source = format!("{REWRITTEN}\nquery totals(message: messages):\n  return reactionTotals[message = message] by .emoji\n");
    let mut e = engine(&source);
    let query = |e: &mut Engine, id: &str| e.query("totals",Context::new("alice",[("message".into(),snapback4_core::Value::Id(id.into()))].into()).at(10)).unwrap();
    let absent = query(&mut e,"message-hidden");
    chat(&mut e,"hidden","bob");
    let empty_hidden = query(&mut e,"message-hidden");
    for n in 0..25 { react(&mut e,&format!("hidden{n}"),"hidden",&format!("u{n}"),&format!("e{n}")); }
    let hidden = query(&mut e,"message-hidden");
    assert_eq!(wire::to_json(&absent.data),json!([]));
    for q in [empty_hidden,hidden] { assert_eq!(q.data,absent.data); assert_eq!(q.metered,absent.metered); assert_eq!(q.next,absent.next); assert_eq!(q.next_expiry,absent.next_expiry); }
    let b = snapback4_lang::compile(&[("schema.q".into(),format!("{REWRITTEN}\nquery bad(c: cursor ?):\n  return reactionTotals first 20 by .emoji after c\n"))]);
    let d=b.diagnostics.iter().find(|d|d.code=="E_READ_THROUGH_SCAN").expect("refused");
    assert!(d.rewrite.contains("reactionTotals[message = .id]"),"{d:?}");
}

const CAUSES: &str = "table parents:\n  public\n  online only\ntable grants:\n  parent: parents\n  until: time\n  expire at .until\n  by byParent: parent\n  read <- deny\n  online only\ntable members:\n  parent: parents\n  key: text <=20\n  owner: principal\n  author: principal\n  ordinal: sequence by parent\n  unique key\n  cap 1 by parent\n  read <- .owner = viewer\n  insert <- .author = viewer and (.key != 'budget' or exists grants[parent = .parent])\n  online only\nmutation add(parent: parents, key: text <=20, owner: principal, author: principal):\n  return insert members {parent, key, owner, author}\n";
fn cause_args(parent: &str, key: &str, owner: &str, author: &str) -> std::collections::BTreeMap<String,snapback4_core::Value> {
    use snapback4_core::Value;
    [("parent".into(),Value::Id(parent.into())),("key".into(),Value::String(key.into())),("owner".into(),Value::Id(owner.into())),("author".into(),Value::Id(author.into()))].into()
}
#[test]
fn developer_gets_each_cause_without_changing_one_byte_of_the_refusal() {
    use snapback4_core::engine::refusal_trace::RefusalTrace;
    let mut envelopes = Vec::new();
    for (expected,parent,key,owner,author) in [
        ("insert rule","none","new","alice","bob"),
        ("sequence read authority","none","new","bob","alice"),
        ("unique key","none","taken","alice","alice"),
        ("cap parent","used","new","alice","alice"),
        ("authorization allowance (insert)","budget","budget","alice","alice"),
    ] {
        let mut pair = Vec::new();
        for traced in [false,true] {
            let mut e = engine(CAUSES);
            load(&mut e,"members",json!({"id":"private","parent":"used","key":"taken","owner":"bob","author":"bob"}));
            if parent == "budget" {
                let rows = (0..8193).map(|n| ("grants".into(),wire::row_from_json(&e.schema().tables["grants"],&json!({"id":format!("g{n}"),"parent":"budget","until":10000+n})).unwrap())).collect::<Vec<_>>();
                e.load(rows).unwrap();
            }
            let trace = RefusalTrace::default();
            let context = Context::new("alice",cause_args(parent,key,owner,author)).at(100).with_ids(["candidate".into()]);
            let result = e.mutate("add", None, if traced {context.with_refusal_trace(trace.clone())} else {context}).unwrap();
            let WriteState::Failed {why,..} = result.state else {panic!("{expected}: {result:?}")};
            assert_eq!(why.code,"E_RULE","{expected}: {why:?}");
            pair.push((serde_json::to_vec(&why).unwrap(),result.metered));
            if traced {
                let cause = trace.take().unwrap();
                assert_eq!(cause.clause,expected);
                assert_eq!(cause.table,"members");
                if !expected.starts_with("authorization allowance") {
                    let b=snapback4_lang::compile(&[("schema.q".into(),CAUSES.into())]);
                    assert!(b.refusal_sites.contains_key(&(cause.table.clone(),cause.clause.clone())),"source coordinate for {cause:?}: {:?}",b.refusal_sites);
                }
                assert!(!cause.site.is_empty());
                println!("developer cause: {cause:?}");
            } else { assert!(trace.take().is_none()); }
        }
        assert_eq!(pair[0],pair[1],"collector cannot alter wire bytes or meters");
        envelopes.push(pair[0].0.clone());
    }
    assert_eq!(envelopes[0],include_str!("../../../reports/20260928-mp-modeling-papercuts/baseline-rule.json").trim().as_bytes());
    assert!(envelopes.windows(2).all(|p|p[0]==p[1]),"every private cause keeps the identical caller envelope");
}

#[test]
fn first_member_note_is_located_and_the_manual_rewrite_works() {
    let source = include_str!("../../../reports/20260928-mp-modeling-papercuts/reproduction/sequence/snapback/schema.q");
    let b = snapback4_lang::compile(&[("schema.q".into(),source.into())]);
    let d=b.notes.iter().find(|d|d.code=="N_SEQUENCE_READ").unwrap();
    assert_eq!(d.site.line, source.lines().position(|l|l.contains("joinedOrdinal: sequence")).unwrap() as u32 + 1);
    assert!(d.message.contains("first membership")); assert!(d.rewrite.contains("lastOrdinal"));
    let mut e=engine(REWRITTEN);
    load(&mut e,"profiles",json!({"id":"bob","principal":"bob","handle":"bobby","displayName":"Bob","bio":"","location":""}));
    let args=[("id".into(),snapback4_core::Value::Id("new".into())),("other".into(),snapback4_core::Value::Id("bob".into())),("title".into(),snapback4_core::Value::String("Chat".into())),("description".into(),snapback4_core::Value::String("".into()))].into();
    let out=e.mutate("createGroup",None,Context::new("alice",args).at(100)).unwrap();
    assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");
    assert_eq!(e.store().rows("members").unwrap().len(),2);
}

#[test]
fn created_parent_and_empty_group_do_not_prove_a_fresh_shared_counter() {
    let source="table parents:\n  public\n  insert <- allow\n  online only\ntable history:\n  parent: parents\n  ordinal: sequence by parent\n  public\n  insert <- allow\n  delete <- allow\n  online only\ntable members:\n  parent: parents\n  principal: principal\n  ordinal: sequence by parent\n  unique parent, principal\n  read <- exists members[.parent, viewer]\n  insert <- created parents[.parent]\n  online only\nmutation old(parent: parents):\n  return insert history {parent}\nmutation erase(id: history):\n  delete history[id]\nmutation first(parent: id):\n  insert parents {id: parent}\n  return insert members {parent, principal: viewer}\n";
    let mut e=engine(source);
    let old=e.mutate("old",None,Context::new("alice",[("parent".into(),snapback4_core::Value::Id("future".into()))].into())).unwrap();
    let WriteState::Sent{result,..}=old.state else {panic!("{old:?}")};
    assert_eq!(result.field("ordinal").unwrap(),&snapback4_core::Value::Int(1));
    e.mutate("erase",None,Context::new("alice",[("id".into(),result.field("id").unwrap().clone())].into())).unwrap();
    assert!(e.store().rows("history").unwrap().is_empty());
    let trace=snapback4_core::engine::refusal_trace::RefusalTrace::default();
    let refused=e.mutate("first",None,Context::new("alice",[("parent".into(),snapback4_core::Value::Id("future".into()))].into()).with_refusal_trace(trace.clone())).unwrap();
    assert!(matches!(refused.state,WriteState::Failed{..}));
    assert_eq!(trace.take().unwrap().clause,"sequence read authority");
    assert!(e.store().rows("parents").unwrap().is_empty());
    let next=e.mutate("old",None,Context::new("alice",[("parent".into(),snapback4_core::Value::Id("future".into()))].into())).unwrap();
    let WriteState::Sent{result,..}=next.state else {panic!("{next:?}")};
    assert_eq!(result.field("ordinal").unwrap(),&snapback4_core::Value::Int(2));
}

#[test]
fn parent_totals_keep_live_counts_and_never_emit_a_partial_count_at_a_meter_cut() {
    let source=format!("{REWRITTEN}\nquery totals(message: messages):\n  return reactionTotals[message = message] by .emoji\n");
    let mut e=engine(&source);chat(&mut e,"ours","alice");
    for n in 0..20 {react(&mut e,&format!("r{n}"),"ours",&format!("u{n}"),"heart");}
    let context=||Context::new("alice",[("message".into(),snapback4_core::Value::Id("message-ours".into()))].into()).at(10);
    let all=e.query("totals",context()).unwrap();assert!(all.complete);
    assert_eq!(all.data.as_array().unwrap()[0].field("value").unwrap(),&snapback4_core::Value::Int(20));
    for budget in 0..=all.metered.examined {
        let mut ceilings=e.ceilings();ceilings.examined=budget;e.set_ceilings(ceilings);
        let q=e.query("totals",context()).unwrap();
        if let Ok(rows)=q.data.as_array() {for row in rows {assert_eq!(row.field("value").unwrap(),&snapback4_core::Value::Int(20));}}
        if budget < all.metered.examined { assert!(!q.complete,"{q:?}"); }
    }
}

#[test]
fn raw_ir_cannot_enumerate_unpinned_parent_groups() {
    use snapback4_core::ir::{self,Expr,Stmt};
    let source=format!("{REWRITTEN}\nquery totals(message: messages):\n  return reactionTotals[message = message] by .emoji\n");
    let b=snapback4_lang::compile(&[("schema.q".into(),source)]);
    assert!(b.diagnostics.is_empty());
    let mut program=b.programs.iter().find(|p|p.program.name=="totals").unwrap().program.clone();
    let mut scan=ir::scans(&program).into_iter().find(|s|s.table=="reactionTotals").unwrap().clone();
    scan.prefix.clear();
    program.body=vec![Stmt::Return(Expr::Scan(scan))];
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program).filter(|p|p.name!="totals").chain([program])).unwrap();
    let why=e.query("totals",Context::new("alice",[("message".into(),snapback4_core::Value::Id("m".into()))].into())).unwrap_err();
    assert_eq!(why.code,"E_READ_THROUGH_SCAN");
}
