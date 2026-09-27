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
    setup_source(groups,words,SOURCE)
}
fn setup_source(groups: usize, words: usize, source: &str) -> Engine {
    let b = snapback4_lang::compile(&[("schema.q".into(),source.into())]);
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
        assert!(why.message.contains("envelope")); assert!(why.rewrite.unwrap().starts_with("return members["));
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
    for source in [SOURCE.to_owned(),SOURCE.replace("  expire at .until\n", "")] {
        let mut e = setup_source(3,1,&source);
        let p = e.query("newest",cx("cof",None)).unwrap();
        e.mutate("leave",None,Context::new("alice",[("id".into(),id("r002"))].into())).unwrap();
        let next = e.query("newest",cx("cof",p.next)).unwrap();
        assert!(next.data.as_array().unwrap().iter().all(|r|r.field("room").unwrap()!=&id("r002")));
    }
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

#[test]
fn oversized_declaration_with_tiny_payload_keeps_existing_complete_answer() {
    // Both sides of Grok's admission boundary and the old 16/24 MiB cutoffs.
    for bound in [1_023_556, 1_023_557, 1_026_000, 1_027_327, 1_027_328, 1_551_615, 1_551_616, 2_000_000] {
        tiny_declared_payload(bound, None, &[16 << 20]);
    }
}

#[test]
fn message_and_rule_witness_declarations_do_not_share_a_decode_reservation() {
    tiny_declared_payload(600_000, Some(600_000), &[16 << 20, 10 << 20]);
}

#[test]
fn actual_size_admission_uses_the_active_heap_ceiling() {
    for bound in [1_023_556,1_023_557,1_026_000,2_000_000] {
        tiny_declared_payload(bound,None,&[128 << 10]);
    }
}

#[test]
fn private_payload_sizes_do_not_select_actual_size_admission() {
    let source = SOURCE.replace("  expire at .until\n", "")
        .replace("  payload: text <=20000", "  owner: principal\n  payload: text <=20000 default '' written by .owner");
    let mut answers = Vec::new();
    for size in [0,20_000] {
        let b=snapback4_lang::compile(&[("schema.q".into(),source.clone())]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
        e.seed_at(vec![
            ("members".into(),object([("id",id("m")),("room",id("r")),("principal",id("alice"))])),
            ("messages".into(),object([("id",id("hit")),("room",id("r")),("body",Value::String("coffee".into())),
                ("owner",id("bob")),("payload",Value::String("x".repeat(size))),("at",Value::Int(1)),("tombstone",Value::Bool(false)),("until",Value::Null)])),
        ],100).unwrap();
        let page=e.query("newest",cx("cof",None)).unwrap();
        assert!(page.complete,"{page:?}");
        assert_eq!(ids(&page.data),["hit"]);
        assert!(page.data.as_array().unwrap()[0].field("payload").is_err());
        answers.push(serde_json::to_value(page).unwrap());
    }
    assert_eq!(answers[0],answers[1]);
}

fn tiny_declared_payload(body: u32, witness: Option<u32>, heaps: &[u64]) {
    let mut source = SOURCE.replace("text <=4000", &format!("text <={body}")).replace("  expire at .until\n", "");
    if let Some(witness) = witness { source = source.replace("  principal: principal", &format!("  info: text <={witness}\n  principal: principal")); }
    let b = snapback4_lang::compile(&[("schema.q".into(),source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let newest = &b.programs.iter().find(|p|p.program.name == "newest").unwrap().program;
    assert!(snapback4_lang::bind::merges(&newest.body).iter().any(|m|snapback4_core::search_plan::eligible(&b.schema,m)), "wide declarations still use compact admission");
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
    let mut member = object([("id",id("m")),("room",id("r")),("principal",id("alice"))]);
    if witness.is_some() { if let Value::Row(fields) = &mut member { fields.insert("info".into(),Value::String("tiny".into())); } }
    e.seed_at(vec![
        ("members".into(),member),
        ("messages".into(),object([("id",id("hit")),("room",id("r")),("body",Value::String("coffee".into())),
            ("payload",Value::String("tiny".into())),("at",Value::Int(1)),("tombstone",Value::Bool(false)),("until",Value::Null)])),
    ],100).unwrap();
    // A smaller active ceiling must not be confused with the default. The
    // wide witness still needs its own declared scratch, separately from rows.
    for &heap in heaps {
        e.set_ceilings(Ceilings { heap_bytes: heap,..Ceilings::default() });
        let old = e.query("control",cx("cof",None)).unwrap();
        let new = e.query("newest",cx("cof",None)).unwrap();
        assert!(old.complete && new.complete, "body={body} witness={witness:?} heap={heap}: old={old:?} new={new:?}");
        assert_eq!(ids(&new.data), ["hit"]);
        assert_eq!(old.data,new.data);
        assert_eq!(old.next,new.next);
        assert!(new.metered.heap_bytes < 100_000, "{:?}", new.metered);
        eprintln!("body={body} witness={witness:?} heap={heap}: complete hit; old_heap={} compact_heap={}",old.metered.heap_bytes,new.metered.heap_bytes);
    }
}

#[test]
fn refusal_counts_authorized_keys_exactly_without_hidden_memberships() {
    for (ceilings, count, unfinished) in [
        (Ceilings { examined: 2,..Ceilings::default() }, 2, " (lower bound; total is unknown because discovery did not finish)"),
        (Ceilings { index_entries: 2,..Ceilings::default() }, 4, ""),
    ] {
        let mut e = setup(4,1);
        e.set_ceilings(ceilings);
        let before = e.query("newest",cx("cof",None)).unwrap_err();
        assert!(before.message.starts_with(&format!("E_SEARCH_OPEN: {count} authorized membership keys discovered{unfinished};")), "{before:?}");
        e.set_ceilings(Ceilings::default());
        e.seed_at((0..100).map(|n| ("members".into(),object([
            ("id",id(&format!("hidden{n}"))),("room",id(&format!("hidden{n}"))),("principal",id("bob"))
        ]))).collect::<Vec<_>>(),100).unwrap();
        e.set_ceilings(ceilings);
        let after = e.query("newest",cx("cof",None)).unwrap_err();
        assert_eq!(serde_json::to_value(before).unwrap(),serde_json::to_value(after).unwrap());
    }
}

#[test]
fn later_word_head_can_win_in_either_output_direction() {
    // Index word discovery is ascending: chat then coffee. Exercise both
    // requested example and its converse so ignoring later words cannot pass.
    for (chat, coffee) in [(100,1),(1,100)] {
        let source = SOURCE.replace("last 2 by", "last 1 by") + &SOURCE[SOURCE.find("query newest").unwrap()..SOURCE.find("query control").unwrap()]
            .replace("newest", "oldest").replace("last 2", "first 1");
        let b = snapback4_lang::compile(&[("schema.q".into(),source)]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut e = Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
        let mut rows = vec![("members".into(),object([("id",id("m")),("room",id("r")),("principal",id("alice"))]))];
        for (word,at) in [("chat",chat),("coffee",coffee)] {
            rows.push(("messages".into(),object([("id",id(word)),("room",id("r")),("body",Value::String(word.into())),
                ("payload",Value::String("tiny".into())),("at",Value::Int(at)),("tombstone",Value::Bool(false)),("until",Value::Null)])));
        }
        e.seed_at(rows,100).unwrap();
        for (op,winner) in [("newest",if chat>coffee {"chat"}else{"coffee"}), ("oldest",if chat<coffee {"chat"}else{"coffee"})] {
            let p = e.query(op,cx("c",None)).unwrap();
            assert!(p.complete);
            assert_eq!(ids(&p.data),[winner]);
            let p2 = e.query(op,cx("c",p.next)).unwrap();
            assert!(p2.complete);
            assert_eq!(ids(&p2.data),[if winner=="chat" {"coffee"}else{"chat"}]);
        }
    }
}

#[test]
fn refusal_rewrite_compiles_on_its_schema_and_keeps_filters_in_both_searches() {
    for (membership, messages, room) in [("members","messages","room"),("roster","posts","roomId")] {
      for predicate in [".at > 0", "count(.body) > 3 and .at > 0", "(.body + 'x') != 'hidden' and .at > 0"] {
        let source = SOURCE.replace("members",membership).replace("messages",messages).replace("room",room)
            .replace("not .tombstone and exists", &format!("not .tombstone and {predicate} and exists"));
        let b=snapback4_lang::compile(&[("schema.q".into(),source.clone())]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
        let mut rows=Vec::new();
        for (group,deleted,at) in [("live",false,5),("deleted",true,100),("too-old",false,0)] {
            rows.push((membership.into(),object([("id",id(group)),(room,id(group)),("principal",id("alice"))])));
            rows.push((messages.into(),object([("id",id(group)),(room,id(group)),("body",Value::String("coffee".into())),
                ("payload",Value::String("tiny".into())),("at",Value::Int(at)),("tombstone",Value::Bool(deleted)),("until",Value::Null)])));
        }
        // A deleted candidate in the live chat must also be absent from preview.
        rows.push((messages.into(),object([("id",id("deleted-preview")),(room,id("live")),("body",Value::String("coffee".into())),
            ("payload",Value::String("tiny".into())),("at",Value::Int(1000)),("tombstone",Value::Bool(true)),("until",Value::Null)])));
        for n in 1..=3 {
            rows.push((messages.into(),object([("id",id(&format!("preview{n}"))),(room,id("live")),("body",Value::String("coffee".into())),
                ("payload",Value::String("tiny".into())),("at",Value::Int(n)),("tombstone",Value::Bool(false)),("until",Value::Null)])));
        }
        e.seed_at(rows.clone(),100).unwrap();e.set_ceilings(Ceilings {index_entries:1,..Ceilings::default()});
        let why=e.query("newest",cx("cof",None)).unwrap_err();
        let rewrite=why.rewrite.unwrap();
        assert!(rewrite.contains("last 3 by .at"),"{rewrite}");
        let source=source.split("query newest").next().unwrap();
        let repaired=format!("{source}\nquery repaired(q: text <=100, c: cursor ?):\n  {rewrite}\n");
        let b=snapback4_lang::compile(&[("schema.q".into(),repaired)]);
        assert!(b.diagnostics.is_empty() && b.notes.is_empty(),"{rewrite}\n{:?}\n{:?}",b.diagnostics,b.notes);
        let mut repaired=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
        repaired.seed_at(rows,100).unwrap();
        let page=repaired.query("repaired",cx("cof",None)).unwrap();
        assert!(page.complete,"{page:?}");
        let groups=page.data.as_array().unwrap();assert_eq!(groups.len(),1,"{rewrite}\n{page:?}");
        assert_eq!(groups[0].field(room).unwrap(),&id("live"));
        assert_eq!(ids(groups[0].field("hits").unwrap()),["live","preview3","preview2"]);
      }
    }
}
