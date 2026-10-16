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

const CAUSES: &str = "table parents:\n  public\n  online only\ntable grants:\n  parent: parents\n  until: time\n  expire at .until\n  unique byParent: parent\n  read <- deny\n  online only\ntable members:\n  parent: parents\n  key: text <=20\n  owner: principal\n  author: principal\n  ordinal: sequence by parent\n  unique key\n  cap 1 by parent\n  read <- .owner = viewer\n  insert <- .author = viewer and (.key != 'budget' or exists grants[parent = .parent])\n  online only\nmutation add(parent: parents, key: text <=20, owner: principal, author: principal):\n  return insert members {parent, key, owner, author}\n";
fn cause_args(parent: &str, key: &str, owner: &str, author: &str) -> std::collections::BTreeMap<String,snapback4_core::Value> {
    use snapback4_core::Value;
    [("parent".into(),Value::Id(parent.into())),("key".into(),Value::String(key.into())),("owner".into(),Value::Id(owner.into())),("author".into(),Value::Id(author.into()))].into()
}

#[test]
fn query_and_capture_evidence_preserves_bytes_meters_and_the_authorizing_phase() {
    use snapback4_core::{engine::{runner::Runner, refusal_trace::RefusalTrace}, meter::{Meter, Ceilings, Cut}, Value};
    let source = "table parents:\n  read <- exists grants[parent = .id]\n  online only\ntable grants:\n  parent: parents\n  until: time\n  expire at .until\n  unique byParent: parent\n  read <- deny\n  online only\ntable children:\n  parent: parents\n  immutable parent\n  read through .parent\n  insert <- allow\n  online only\nquery point(id: parents):\n  return parents[id]\nmutation child(parent: parents):\n  return insert children {parent}\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut e = engine(source);
    load(&mut e, "parents", json!({"id":"p"}));
    e.load((0..8193).map(|n| ("grants".into(), wire::row_from_json(&e.schema().tables["grants"], &json!({"id":format!("g{n}"),"parent":"p","until":10000+n})).unwrap())).collect::<Vec<_>>()).unwrap();
    for (op, arg, phase, site) in [("point", "id", "read rule", "schema.q:2:3"), ("child", "parent", "read through capture", "schema.q:14:3")] {
        let mut pairs = Vec::new();
        for traced in [false, true] {
            let trace = RefusalTrace::default();
            let context = Context::new("alice", [(arg.into(), Value::Id("p".into()))].into()).at(100).with_ids(["child".into()]);
            let tx = e.store_mut().read_transaction().unwrap();
            let program = &bound.programs.iter().find(|p|p.program.name==op).unwrap().program;
            let mut runner = Runner::new(&tx, &bound.schema, if traced {context.with_refusal_trace(trace.clone())} else {context}, Meter::new(Ceilings::default(), if op=="point" {Cut::Cap} else {Cut::Abort}), 0);
            let why = runner.run(program).unwrap_err().refusal();
            assert_eq!(why.code, "E_RULE");
            pairs.push((serde_json::to_vec(&why).unwrap(), runner.metered()));
            if traced {
                let cause = trace.take().unwrap();
                assert_eq!(cause.phase, phase);
                assert_eq!(bound.refusal_sites[&(cause.table, cause.phase)], site);
            } else { assert!(trace.take().is_none()); }
        }
        assert_eq!(pairs[0], pairs[1], "{op}: trace cannot change bytes or meters");
    }
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
    // @ref LLP 3000.036.002#10 — generic layer/recipe help changes; private causes must remain indistinguishable.
    let mut expected: snapback4_core::Refusal = serde_json::from_str(include_str!("../../../reports/wave11-qdiag/public-rule.json")).unwrap();
    expected.message.insert_str(0, "table authorization layer: ");
    expected.rewrite = Some("a mutation require decides intent; each write still passes its table rule; see: guide rule-recipes role-workflow".into());
    assert_eq!(envelopes[0],serde_json::to_vec(&expected).unwrap());
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

#[test]
fn cross_group_sequence_witness_does_not_promise_first_insert_refusal() {
    let source = "table parents:\n  public\n  online only\ntable members:\n  parent: parents\n  access: parents\n  principal: principal\n  ordinal: sequence by parent\n  unique byAccess: access, principal\n  read <- exists members[access = .parent, principal = viewer]\n  insert <- allow\n  online only\nmutation add(parent: parents):\n  return insert members {parent, access: 'fresh', principal: viewer}\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert!(!b.notes.iter().any(|d| d.code == "N_SEQUENCE_READ"), "{:?}", b.notes);
    let mut e = engine(source);
    load(&mut e, "members", json!({"id":"other", "parent":"other", "access":"new", "principal":"alice"}));
    let out = e.mutate("add", None, Context::new("alice", [("parent".into(),snapback4_core::Value::Id("new".into()))].into())).unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
}

const THROUGH_CAUSE: &str = "table parents:\n  owner: principal\n  until: time\n  immutable owner, until\n  expire at .until\n  read <- .owner = viewer\n  online only\ntable children:\n  parent: parents\n  immutable parent\n  read through .parent\n  insert <- allow\n  online only\nmutation add(parent: parents):\n  return insert children {parent}\n";
#[test]
fn read_through_missing_parent_has_cause() { through_cause("missing", "read through parent missing or expired"); }
#[test]
fn read_through_expired_parent_has_cause() { through_cause("expired", "read through parent missing or expired"); }
#[test]
fn read_through_hidden_parent_has_cause() { through_cause("hidden", "insert into children needs unread parent parents through .parent"); }
fn through_cause(parent: &str, clause: &str) {
    use snapback4_core::engine::refusal_trace::RefusalTrace;
    {
        let mut pair = Vec::new();
        for traced in [false, true] {
            let mut e = engine(THROUGH_CAUSE);
            let now = snapback4_core::now_ms();
            load(&mut e, "parents", json!({"id":"expired", "owner":"alice", "until":now+50000}));
            load(&mut e, "parents", json!({"id":"hidden", "owner":"bob", "until":now+200000}));
            assert_eq!(e.store().rows("parents").unwrap().len(), 2, "expired parent is still physically stored");
            let trace = RefusalTrace::default();
            let context = Context::new("alice", [("parent".into(),snapback4_core::Value::Id(parent.into()))].into()).at(now+100000);
            let out = e.mutate("add", None, if traced { context.with_refusal_trace(trace.clone()) } else { context }).unwrap();
            let WriteState::Failed { why, .. } = out.state else { panic!("{out:?}") };
            assert_eq!(why.code, "E_RULE");
            pair.push((serde_json::to_vec(&why).unwrap(), out.metered));
            if traced {
                let cause = trace.take().expect("capture denial needs a developer cause");
                assert_eq!(cause.clause, clause);
                let b = snapback4_lang::compile(&[("schema.q".into(), THROUGH_CAUSE.into())]);
                if parent == "hidden" {
                    assert_eq!(cause.table, "parents");
                    assert_eq!(cause.phase, "read rule");
                    assert_eq!(b.refusal_sites[&(cause.table, cause.phase)], "schema.q:6:3");
                } else {
                    assert_eq!(cause.table, "children");
                    assert_eq!(b.refusal_sites[&(cause.table, cause.clause)], "schema.q:11:3");
                }
            } else { assert!(trace.take().is_none()); }
        }
        assert_eq!(pair[0], pair[1]);
    }
}

#[test]
fn aggregate_deadline_obeys_expiring_authorization_before_source_expiry() {
    let source = "table grants:\n  parent: parents\n  principal: principal\n  until: time\n  unique parent, principal\n  expire at .until\n  read <- .principal = viewer\n  online only\ntable parents:\n  until: time\n  immutable until\n  expire at .until\n  read <- exists grants[.id, viewer]\n  online only\ntable children:\n  parent: parents\n  kind: text <=20\n  cap 20 by parent\n  immutable parent\n  read through .parent\n  online only\nview totals: count children by .parent, .kind\n  online only\nquery totals(parent: parents):\n  return totals[parent = parent] by .kind\n";
    let mut e = engine(source);
    let clock = snapback4_core::now_ms();
    load(&mut e,"parents",json!({"id":"p","until":clock+500000}));
    load(&mut e,"grants",json!({"id":"g","parent":"p","principal":"alice","until":clock+100000}));
    load(&mut e,"children",json!({"id":"c","parent":"p","kind":"heart"}));
    let context = |now| Context::new("alice",[("parent".into(),snapback4_core::Value::Id("p".into()))].into()).at(now);
    let before = e.query("totals",context(clock+50000)).unwrap();
    assert!(before.complete);
    assert_eq!(before.data.as_array().unwrap().len(),1);
    assert_eq!(before.next_expiry,Some(clock+100000));
    let expired = e.query("totals",context(clock+100000)).unwrap();
    assert!(expired.data.as_array().unwrap().is_empty());
}

#[test]
fn hidden_write_rule_denials_record_causes_without_changing_not_found() {
    use snapback4_core::engine::refusal_trace::RefusalTrace;
    let source = "table parents:\n  owner: principal\n  n: int default 0\n  secret: int default 0 written by .owner\n  immutable owner\n  read <- .owner = viewer\n  update <- allow\n  delete <- allow\n  online only\ntable children:\n  parent: parents\n  immutable parent\n  read through .parent\n  online only\nmutation remove(id: parents):\n  delete parents[id]\nmutation conditional(id: parents):\n  update parents[id] { n: 1 } if .n = 0\nmutation private(id: parents):\n  update parents[id] { secret: 1 }\n";
    for (op, clause) in [("remove", "read rule"), ("conditional", "read rule"), ("private", "field authority secret")] {
        let mut pair = Vec::new();
        for traced in [false, true] {
            let mut e = engine(source);
            load(&mut e,"parents",json!({"id":"hidden","owner":"bob","n":0,"secret":0}));
            let trace = RefusalTrace::default();
            let context = Context::new("alice",[("id".into(),snapback4_core::Value::Id("hidden".into()))].into());
            let out = e.mutate(op,None,if traced {context.with_refusal_trace(trace.clone())} else {context}).unwrap();
            let WriteState::Failed {why,..} = out.state else {panic!("{op}: {out:?}")};
            assert_eq!(why.code,"NOT_FOUND");
            pair.push((serde_json::to_vec(&why).unwrap(),out.metered));
            if traced {
                let cause = trace.take().expect(op);
                assert_eq!(cause.clause,clause,"{op}");
                let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
                assert!(b.refusal_sites.contains_key(&(cause.table,cause.clause)));
            }
        }
        assert_eq!(pair[0],pair[1],"{op}");
    }
}

#[test]
fn sequence_note_uses_declared_column_and_never_marks_a_different_witness_table() {
    let source="table rooms:\n  public\n  online only\ntable members:\n  room: rooms\n  principal: principal\n  joinedAt: sequence by room\n  unique byGroup: room, principal\n  read <- exists members[room = .room, principal = viewer]\n  online only\ntable messages:\n  room: rooms\n  principal: principal\n  ordinal: sequence by room\n  unique byGroup: room, principal\n  read <- exists members[room = .room, principal = viewer]\n  online only\n";
    let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let notes=b.notes.iter().filter(|d|d.code=="N_SEQUENCE_READ").collect::<Vec<_>>();
    assert_eq!(notes.len(),1,"{notes:?}");
    let note=notes[0];assert_eq!(note.site.line,7);
    assert!(note.rewrite.contains("joinedAt: int"));assert!(note.rewrite.contains("on rooms"));
    assert!(!note.rewrite.contains("message"),"{}",note.rewrite);
    assert!(!note.rewrite.contains("(room, ordinal)"));
}

#[test]
fn missing_hidden_and_expired_aggregate_parents_have_identical_metadata() {
    let source="table parents:\n  owner: principal\n  until: time\n  immutable owner, until\n  expire at .until\n  read <- .owner = viewer\n  online only\ntable children:\n  parent: parents\n  kind: text <=20\n  immutable parent\n  cap 20 by parent\n  read through .parent\n  online only\nview totals: count children by .parent, .kind\n  online only\nquery groups(parent: parents):\n  return totals[parent = parent] by .kind\nquery point(parent: parents):\n  return totals[parent = parent, kind = 'heart']\nquery nested(parent: parents):\n  return {outer: {total: totals[parent = parent, kind = 'heart']}}\n";
    let mut e=engine(source);let now=snapback4_core::now_ms();
    for (id,owner,until) in [("hidden_","bob",now+200000),("expired","alice",now+50000),("readabl","alice",now+200000)] {
        load(&mut e,"parents",json!({"id":id,"owner":owner,"until":until}));
        load(&mut e,"children",json!({"id":id,"parent":id,"kind":"heart"}));
    }
    for op in ["groups", "point", "nested"] {
    let query=|e:&mut Engine,id:&str| e.query(op,Context::new("alice",[("parent".into(),snapback4_core::Value::Id(id.into()))].into()).at(now+100000)).unwrap();
    let missing=query(&mut e,"missing");
    assert_ne!(query(&mut e,"readabl").data, missing.data, "{op}: readable control");
    for id in ["hidden_","expired"] {
        let out=query(&mut e,id);
        assert_eq!(out.data,missing.data,"{id}");assert_eq!(out.metered,missing.metered,"{id}");
        assert_eq!(out.next,missing.next,"{id}");assert_eq!(out.next_expiry,missing.next_expiry,"{id}");
        assert_eq!(out.tables,missing.tables,"{id}");assert_eq!(out.complete,missing.complete,"{id}");
    }
}
}

#[test]
fn residual_sequence_parent_equality_proves_the_group_but_cross_group_does_not() {
    for (column, noted) in [("parent", true), ("access", false)] {
        let source=format!("table parents:\n  public\n  online only\ntable members:\n  parent: parents\n  access: parents\n  slot: text <=20\n  ordinal: sequence by parent\n  unique bySlot: slot\n  read <- exists members[slot = 'witness', {column} = .parent]\n  insert <- allow\n  online only\nmutation add(parent: parents):\n  return insert members {{parent, access: parent, slot: 'new'}}\n");
        let bound=snapback4_lang::compile(&[("schema.q".into(),source.clone())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        assert_eq!(bound.notes.iter().any(|d|d.code=="N_SEQUENCE_READ"),noted,"{column}: {:?}",bound.notes);
        let mut e=engine(&source);
        load(&mut e,"members",json!({"id":"witness","parent":"other","access":"empty","slot":"witness"}));
        let result=e.mutate("add",None,Context::new("alice",[("parent".into(),snapback4_core::Value::Id("empty".into()))].into())).unwrap();
        assert_eq!(matches!(result.state,WriteState::Failed {..}),noted,"{column}: {result:?}");
    }
    let why=snapback4_lang::guide::explain_code("N_SEQUENCE_READ").unwrap();
    assert!(why.contains("declared sequence column"));
    assert!(!why.contains("each message"));
}
