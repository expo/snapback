//! Small Clique-shaped coverage witnesses, shared with both device stores.
#![allow(dead_code)]
use snapback4_core::{Value, value::object};

pub const LINE: &str = "    horizon-free source coverage — all sources sync without a horizon; answer completeness still depends on runtime authorization, limits and continuation";

pub fn source(case: &str) -> String {
    let source = r#"table members:
  conversationId: id
  principal: principal
  until: time ?
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId, id
  by byExpiry: until, id
  read <- exists members[.conversationId, viewer]
  sync to members[.conversationId]
table messages:
  conversationId: id
  body: text <=100
  at: time
  by byConversationTime: conversationId, at, id
  by byWords: words(body), at, id
  read <- exists members[.conversationId, viewer]
  sync to members[.conversationId]
query searchHeld(q: text <=100, c: cursor ?) held:
  return messages matching q after c first 10 by byWords
query firstHeld() held:
  return messages first 1 by byId
query constantHeld() held:
  return 7
"#;
    match case {
        "temporary" => source.replace("  by byExpiry: until, id", "  by byExpiry: until, id\n  expire at .until"),
        "horizon" => source.replace("  sync to members[.conversationId]\nquery searchHeld", "  sync to members[.conversationId] last 1 by byConversationTime\nquery searchHeld"),
        "online" => source.replace("  sync to members[.conversationId]\nquery searchHeld", "  online only\nquery searchHeld"),
        "full" => source.into(),
        _ => panic!("unknown coverage case: {case}"),
    }
}

pub fn seed() -> Vec<(String, Value)> {
    let id = |value: &str| Value::Id(value.into());
    vec![
        ("members".into(), object([("id", id("member")), ("conversationId", id("chat")), ("principal", id("alice")), ("until", Value::Int(10_000))])),
        ("messages".into(), object([("id", id("m1")), ("conversationId", id("chat")), ("body", Value::String("coffee".into())), ("at", Value::Int(1))])),
        ("messages".into(), object([("id", id("m2")), ("conversationId", id("chat")), ("body", Value::String("coffee".into())), ("at", Value::Int(2))])),
    ]
}

pub fn assert_line(schema: &snapback4_core::schema::Schema, op: &str, covered: bool) {
    let line = snapback4_lang::bind::residency::operation_lines(op, &schema.operations[op]);
    assert!(!line.contains("complete over held rows"), "{line}");
    assert_eq!(line.lines().any(|line| line == LINE), covered, "{line}");
}

pub fn nested_source(case: &str) -> String {
    let residency = match case { "online" => "online only", "horizon" => "sync last 1 by byId", "full" => "sync", _ => panic!("unknown nested case: {case}") };
    format!(r#"table messages:
  body: text <=100
  by byWords: words(body), id
  public 'messages'
  sync
table terms:
  public 'terms'
  {residency}
query nestedSearch() held:
  return messages matching slice('coffee', 0, count(terms first 1 by byId)) first 10 by byWords
"#)
}

pub fn nested_seed() -> Vec<(String, Value)> {
    vec![
        ("messages".into(), object([("id", Value::Id("m1".into())), ("body", Value::String("coffee".into()))])),
        ("terms".into(), object([("id", Value::Id("t1".into()))])),
    ]
}

pub fn assert_nested(schema: &snapback4_core::schema::Schema, case: &str) {
    use snapback4_core::schema::SiteClass;
    let fact = &schema.operations["nestedSearch"];
    let line = snapback4_lang::bind::residency::operation_lines("nestedSearch", fact);
    println!("W9R2 case={case} sites={}\n{line}", fact.sites.len());
    assert_eq!(fact.sites.len(), 3, "both variants and the matching expression's source must be retained: {line}");
    assert!(fact.sites.iter().any(|site| site.table == "messages" && site.class == SiteClass::Held));
    let class = match case { "online" => SiteClass::Server, "horizon" => SiteClass::Horizon, "full" => SiteClass::Held, _ => unreachable!() };
    assert!(fact.sites.iter().any(|site| site.table == "terms" && site.class == class && site.site.contains("schema.q:10:")), "{line}");
    assert_line(schema, "nestedSearch", case == "full");
}

pub fn assert_nested_read(read: &snapback4_core::QueryOutcome, case: &str) {
    let count = read.data.as_array().unwrap().len();
    assert_eq!(count, 1, "{read:?}");
    assert_eq!(read.complete, case == "full", "{read:?}");
    assert!(read.next.is_none() && read.capped_at.is_none() && read.word_cut_at.is_none());
    println!("W9R2 case={case} rows={count} complete={} examined={} index_entries={} probes={} steps={} heap_bytes={} output_bytes={} rows_written={}",
        read.complete, read.metered.examined, read.metered.index_entries, read.metered.rule_probes, read.metered.steps, read.metered.heap_bytes, read.metered.output_bytes, read.metered.rows_written);
}
