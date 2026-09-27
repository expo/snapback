//! Compact membership opening, refusals and live continuation correctness.
use snapback4_core::{Context, Engine, Value, Ceilings, value::object};
use std::collections::BTreeMap;
const SOURCE: &str = r#"
table members:
  room: id
  principal: principal
  unique room, principal
  read <- exists members[.room, viewer]
  delete <- .principal = viewer
table messages:
  room: id
  body: text <=4000
  payload: text <=20000
  at: time
  tombstone: bool
  until: time ?
  expire at .until
  search body
  by byWords: room, tombstone, words(body), at, id
  read <- exists members[.room, viewer]
query newest(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone and exists members[.room, viewer] last 2 by .at after c
query control(q: text <=100, c: cursor ?):
  return merge messages matching q after c last 2 by byWords:
    [m.room, false] for m in members[principal = viewer] first 100 by .room
mutation leave(id: id):
  delete members[id]
"#;
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn setup(groups: usize, words: usize) -> Engine {
    let b = snapback4_lang::compile(&[("schema.q".into(),SOURCE.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let mut engine = Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let mut rows = Vec::new();
    for g in 0..=groups {
        let room = format!("r{g:03}");
        rows.push(("members".into(),object([("id",id(&room)),("room",id(&room)),("principal",id(if g == groups {"bob"}else{"alice"}))])));
        for n in 0..6 {
            rows.push(("messages".into(),object([
                ("id",id(&format!("{room}-{n}"))),("room",id(&room)),
                ("body",Value::String((0..words).map(|w|format!("coffee{w} ")).collect::<String>() + if n % 2 == 0 {"zebra"}else{"tea"})),
                ("payload",Value::String("x".repeat(if n == 0 {20000}else{4}))),
                ("at",Value::Int(n + if g == groups {1000}else{0})),
                ("tombstone",Value::Bool(n == 5)),("until",if n == 4 {Value::Int(50)}else{Value::Null})])));
        }
    }
    engine.seed_at(rows,100).unwrap(); engine
}
fn cx(q: &str,c: Option<String>) -> Context { Context::new("alice",BTreeMap::from([("q".into(),Value::String(q.into())),("c".into(),c.map(Value::String).unwrap_or(Value::Null))])).at(100) }
fn ids(v: &Value) -> Vec<String> { v.as_array().unwrap().iter().map(|r|r.field("id").unwrap().as_str().unwrap().into()).collect() }
fn walk(e: &mut Engine,name: &str,q: &str) -> Vec<Value> {
    let mut out = vec![]; let mut c = None;
    for _ in 0..100 {
        let p = e.query(name,cx(q,c)).unwrap();
        assert!(p.complete,"{p:?}"); out.extend(p.data.as_array().unwrap().iter().cloned());
        c = p.next; if c.is_none() { return out; }
    }
    panic!("no progress")
}
#[test]
fn matches_existing_completed_answers_with_ties_words_expiry_and_unused_payload() {
    let mut e = setup(4,3);
    for q in ["cof","cof zeb"] {
        let expected = walk(&mut e,"control",q);
        assert_eq!(walk(&mut e,"newest",q),expected);
    }
}
#[test]
fn forty_overlapping_words_keep_one_result_per_id_and_charge_rescans() {
    let mut e = setup(2,40);
    let p = e.query("newest",cx("cof",None)).unwrap();
    assert!(p.complete);
    assert!(p.metered.index_entries > 2*41, "refills repeat word expansion");
    assert_eq!(ids(&p.data),["r001-3","r000-3"]);
    let all = walk(&mut e,"newest","cof zeb");
    assert_eq!(ids(&Value::Array(all)),["r001-2","r000-2","r001-0","r000-0"]);
}
#[test]
fn opening_refusal_names_visible_count_site_envelope_and_grouped_rewrite() {
    for ceilings in [Ceilings { examined: 2,..Ceilings::default() },Ceilings { heap_bytes: 2000,..Ceilings::default() },Ceilings { steps: 30,..Ceilings::default() },Ceilings { index_entries: 2,..Ceilings::default() },Ceilings { rule_probes: 2,..Ceilings::default() }] {
        let mut e = setup(4,1); e.set_ceilings(ceilings);
        let why = e.query("newest",cx("cof",None)).unwrap_err();
        assert_eq!(why.code,"E_SEARCH_OPEN","{why}");
        assert!(why.site.is_some()); assert!(why.message.contains("membership"));
        assert!(why.message.contains("envelope")); assert!(why.rewrite.unwrap().contains("grouped"));
    }
}
#[test]
fn drain_cut_keeps_a_cursor_after_fully_emitted_hits() {
    let mut e = setup(4,1);
    // 4 memberships + 4 heads (expiry can add candidates) then emitted reads.
    let complete = e.query("newest",cx("cof",None)).unwrap();
    e.set_ceilings(Ceilings { examined: complete.metered.examined - 1, ..Ceilings::default() });
    let p = e.query("newest",cx("cof",None)).unwrap();
    assert!(!p.complete && p.next.is_some(),"{p:?}");
    e.set_ceilings(Ceilings::default());
    let next = e.query("newest",cx("cof",p.next)).unwrap();
    let mut both = ids(&p.data); both.extend(ids(&next.data));
    assert!(both.windows(2).all(|p|p[0]!=p[1]));
}
#[test]
fn membership_revocation_between_pages_rechecks_authority() {
    let mut e = setup(3,1);
    let p = e.query("newest",cx("cof",None)).unwrap();
    e.mutate("leave",None,Context::new("alice",[("id".into(),id("r002"))].into())).unwrap();
    let next = e.query("newest",cx("cof",p.next)).unwrap();
    assert!(next.data.as_array().unwrap().iter().all(|r|r.field("room").unwrap()!=&id("r002")));
}

#[test]
fn every_examined_cut_either_explains_opening_or_advances() {
    let mut e = setup(4,1);
    let complete = e.query("newest",cx("cof",None)).unwrap();
    for limit in 1..complete.metered.examined {
        e.set_ceilings(Ceilings { examined: limit,..Ceilings::default() });
        match e.query("newest",cx("cof",None)) {
            Err(why) => assert_eq!(why.code,"E_SEARCH_OPEN","limit={limit}: {why}"),
            Ok(page) => assert!(!page.data.as_array().unwrap().is_empty() && page.next.is_some(),"limit={limit}: {page:?}"),
        }
    }
}
