//! First attempts reconstructed from cal23–25 and the comparative Clique builder.
use serde_json::json;
use snapback4_core::{Context, Engine, Value, WriteState, wire};
use snapback4_lang::{Bound, compile};

const AGGREGATE: &str = include_str!("fixtures/ag/aggregate.q");

fn bound(source: &str) -> Bound { compile(&[("schema.q".into(), source.into())]) }
fn clean(source: &str) -> Bound {
    let b = bound(source);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn engine(source: &str) -> Engine {
    let b = clean(source);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn load(e: &mut Engine, table: &str, value: serde_json::Value) {
    let row = wire::row_from_json(&e.schema().tables[table], &value).unwrap();
    e.seed(vec![(table.into(), row)]).unwrap();
}
fn chat(e: &mut Engine, id: &str, principal: &str) {
    load(e, "conversations", json!({"id":id,"title":"General","kind":"group"}));
    load(e, "members", json!({"id":format!("member-{id}"),"conversation":id,"principal":principal}));
    load(e, "messages", json!({"id":format!("message-{id}"),"conversation":id}));
}
fn reaction(e: &mut Engine, id: &str, principal: &str, emoji: &str) {
    load(e, "reactions", json!({"id":id,"message":"message-ours","principal":principal,"emoji":emoji}));
}
fn context() -> Context { Context::new("alice", Default::default()).at(100) }
fn message_context() -> Context {
    Context::new("alice", [("message".into(), Value::Id("message-ours".into()))].into()).at(100)
}

#[test]
fn cal25_parent_pinned_first_attempt_already_works_and_count_shorthand_matches() {
    for source in [AGGREGATE.to_owned(), AGGREGATE.replace("count: .value", "count")] {
        let mut e = engine(&source);
        chat(&mut e, "ours", "alice");
        chat(&mut e, "hidden", "bob");
        reaction(&mut e, "r1", "alice", "heart");
        reaction(&mut e, "r2", "bob", "heart");
        reaction(&mut e, "r3", "carol", "laugh");
        let q = e.query("totals", message_context()).unwrap();
        assert!(q.complete, "{q:?}");
        // Aggregate ids are opaque digests; the fixture asks for its visible
        // emoji order instead of inheriting the internal byId order.
        assert_eq!(wire::to_json(&q.data), json!([
            {"emoji":"heart","count":2,"mine":true}, {"emoji":"laugh","count":1,"mine":false}
        ]));
        for id in ["message-hidden", "missing"] {
            let why = e.query("totals", Context::new("alice", [("message".into(), Value::Id(id.into()))].into()).at(100)).unwrap_err();
            assert_eq!(why.code, "NOT_FOUND");
        }
    }
    // A real grouping column named count retains its own value.
    let mut e = engine("table items:\n  count: int\n  public\nview totals: count items by .count\nquery all():\n  return totals first 10 { count, value }\n");
    load(&mut e, "items", json!({"id":"one","count":7}));
    assert_eq!(wire::to_json(&e.query("all", context()).unwrap().data), json!([{"count":7,"value":1}]));
    let b = bound(&AGGREGATE.replace(" where .message = m.id", ""));
    assert!(b.diagnostics.iter().any(|d| d.code == "E_READ_THROUGH_SCAN"));
}

#[test]
fn cal25_parent_traversal_repair_is_the_entire_redundant_rule_and_preserves_authority() {
    let first = include_str!("fixtures/ag/rule-hop.q");
    let b = bound(first);
    let d = b.diagnostics.iter().find(|d| d.code == "E_REDUNDANT_RULE").unwrap();
    assert!(d.mechanical, "{d}");
    assert!(d.message.contains("parent's rule"), "{d}");
    assert_ne!(d.rewrite, ".conversation");
    let fixed = first.replace("read <- exists members[.message.conversation, viewer]", &d.rewrite);
    let source = fixed + "\nquery totals(message: messages):\n  return reactionCounts where .message = message { emoji, count }\n";
    let mut e = engine(&source);
    chat(&mut e, "ours", "alice"); chat(&mut e, "hidden", "bob");
    reaction(&mut e, "r1", "alice", "heart");
    assert_eq!(wire::to_json(&e.query("totals", message_context()).unwrap().data), json!([{"emoji":"heart","count":1}]));
    assert_eq!(wire::to_json(&e.query("totals", Context::new("bob", [("message".into(), Value::Id("message-ours".into()))].into()).at(100)).unwrap().data), json!([]));
    // A narrower rule is not a mechanical authorization change.
    let b = bound(&first.replace(".message.conversation, viewer]", ".message.conversation, viewer] and .emoji = 'heart'"));
    assert!(b.diagnostics.iter().all(|d| !d.mechanical));
    let ambiguous = first.replace("table messages:\n", "table messages:\n  message: text\n")
        .replace("immutable conversation\n  read <- exists members[.conversation, viewer]", "immutable conversation\n  read <- exists members[.conversation, viewer] and .message = 'x'")
        .replace("read <- exists members[.message.conversation, viewer]", "read <- exists members[.message.conversation, viewer] and .message = 'x'");
    assert!(bound(&ambiguous).diagnostics.iter().all(|d| !d.mechanical), "the direct group reference is not the parent's same-named column");
}

#[test]
fn count_alias_predicates_and_keys_keep_real_group_column_precedence() {
    for field in ["category", "count"] {
        for read in [
            "totals where .count = 2 first 10 by .count",
            "totals where 2 = .count first 10 by .count",
            "totals where .count = 2 first 10 by .id",
            "totals[count = 2] first 10 by .id",
            "totals where .count >= 2 first 10 by .count",
        ] {
            let alias = if field == "category" { ", count" } else { "" };
            let source = format!("table items:\n  {field}: int\n  public\nview totals: count items by .{field}\nquery selected():\n  return {read} {{ {field}, value{alias} }}\n");
            if field == "category" && read.ends_with("by .id") {
                // These value-pinned rankings are deliberately refused even
                // with .value. Alias planning must preserve that refusal.
                let canonical = source.replace(".count", ".value").replace("[count =", "[value =");
                let actual = bound(&source);
                let expected = bound(&canonical);
                assert!(!expected.diagnostics.is_empty());
                let messages = |b: &Bound| b.diagnostics.iter().map(|d| (d.code.clone(), d.message.clone())).collect::<Vec<_>>();
                assert_eq!(messages(&actual), messages(&expected), "{source}");
                continue;
            }
            let mut e = engine(&source);
            for (id, value) in [("a1", 7), ("a2", 7), ("b1", 2)] {
                load(&mut e, "items", json!({"id":id, field:value}));
            }
            let q = e.query("selected", context()).unwrap();
            let expected = if field == "category" { json!([{"category":7,"count":2,"value":2}]) }
                else if read.contains(">=") { json!([{"count":2,"value":1},{"count":7,"value":2}]) }
                else { json!([{"count":2,"value":1}]) };
            assert_eq!(wire::to_json(&q.data), expected, "{source}");
            if field == "category" {
                let canonical = source.replace(".count", ".value").replace("[count =", "[value =");
                let mut other = engine(&canonical);
                for (id, value) in [("a1", 7), ("a2", 7), ("b1", 2)] { load(&mut other, "items", json!({"id":id, field:value})); }
                let other = other.query("selected", context()).unwrap();
                assert_eq!(q.data, other.data);
                assert_eq!(q.metered, other.metered);
            }
        }
    }
}

#[test]
fn count_alias_orders_aggregate_rows_before_index_planning() {
    for (column, a, z, expected) in [
        ("category: text <=20", json!("a"), json!("z"), json!([1, 2])),
        ("count: int", json!(7), json!(9), json!([2, 1])),
    ] {
        let field = column.split(':').next().unwrap();
        let source = format!("table items:\n  {column}\n  public\nview totals: count items by .{field}\nquery ordered():\n  return totals first 10 by .count {{ value }}\n");
        let mut e = engine(&source);
        for (id, value) in [("a1", &a), ("a2", &a), ("z1", &z)] {
            load(&mut e, "items", json!({"id":id, field:value}));
        }
        let q = e.query("ordered", context()).unwrap();
        let values: Vec<_> = wire::to_json(&q.data).as_array().unwrap().iter().map(|row| row["value"].clone()).collect();
        assert_eq!(json!(values), expected);
        if field == "category" {
            let mut canonical = engine(&source.replace("by .count", "by .value"));
            for (id, value) in [("a1", &a), ("a2", &a), ("z1", &z)] {
                load(&mut canonical, "items", json!({"id":id, field:value}));
            }
            let canonical = canonical.query("ordered", context()).unwrap();
            assert_eq!(q.data, canonical.data);
            assert_eq!(q.metered, canonical.metered);
        }
    }
}

#[test]
fn cal24_length_guesses_share_unicode_list_and_meter_semantics() {
    for source in [include_str!("fixtures/ag/len.q"), include_str!("fixtures/ag/length.q")] {
        let mut e = engine(source);
        let q = e.query("preview", Context::new("alice", [("text".into(), Value::String("é🙂".into()))].into()).at(100)).unwrap();
        let mut canonical = engine(&source.replace("len(", "count(").replace("length(", "count("));
        let count = canonical.query("preview", Context::new("alice", [("text".into(), Value::String("é🙂".into()))].into()).at(100)).unwrap();
        assert_eq!(q.data, Value::Int(2)); assert_eq!(q.metered, count.metered);
    }
    let mut e = engine("query sizes():\n  return [len([1, 2]), length([3]), count([])]\n");
    assert_eq!(wire::to_json(&e.query("sizes", context()).unwrap().data), json!([2,1,0]));
    for alias in ["len", "length"] {
        let mut e = engine(&format!("fn {alias}(n: int): n + 1\nquery custom():\n  return {alias}(41)\n"));
        assert_eq!(e.query("custom", context()).unwrap().data, Value::Int(42), "{alias}");
    }
}

#[test]
fn comparative_public_view_and_cal24_effect_helper_first_attempts_execute() {
    let mut e = engine(include_str!("fixtures/ag/public.q"));
    load(&mut e, "posts", json!({"id":"one","author":"alice"}));
    let q = e.query("total", Context::new("bob", [("author".into(), Value::Id("alice".into()))].into()).at(100)).unwrap();
    assert_eq!(q.data, Value::Int(1));
    let mut e = engine(include_str!("fixtures/ag/helper-return.q"));
    let out = e.mutate("send", None, context()).unwrap();
    assert!(matches!(out.state, WriteState::Sent { result: Value::Null, .. }), "{out:?}");
    assert_eq!(e.effects(None, 10).unwrap().len(), 1);
}

#[test]
fn cal24_shape_on_rewrite_replaces_the_reported_tokens_verbatim() {
    let first = include_str!("fixtures/ag/shape-on.q");
    let b = bound(first);
    let d = b.diagnostics.iter().find(|d| d.message.contains("shapes infer")).unwrap();
    assert!(d.mechanical);
    let mut e = engine(&first.replace("on messages =", &d.rewrite));
    load(&mut e, "messages", json!({"id":"m","body":"hello"}));
    let q = e.query("message", Context::new("alice", [("id".into(), Value::Id("m".into()))].into())).unwrap();
    assert_eq!(wire::to_json(&q.data), json!({"body":"hello"}));
}

#[test]
fn cal24_complete_job_is_preserved_by_pasting_the_unused_preview_replacement() {
    let first = include_str!("fixtures/ag/bound.q").replace("view reactionCounts:", "effect notify\nview reactionCounts:")
        .replace("    result = digestCounts(member.principal)", "    result = digestCounts(member.principal)\n    emit notify { principal: member.principal, total: result }")
        + "\nquery untouched():\n  return 42\n";
    let b = bound(&first);
    let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_BOUND").unwrap();
    assert!(!d.mechanical, "removing a query is a product choice");
    assert!(d.message.contains("entire unused viewer query"), "{d}");
    let lines: Vec<_> = first.lines().collect();
    let start = d.site.line as usize - 1;
    assert_eq!(d.site.file, "schema.q"); assert_eq!(d.site.col, 1);
    assert_eq!(lines[start], "query digestPreview():", "the caret must identify the declaration to replace");
    let range = d.message.split("replace lines ").nth(1).expect("full declaration line range")
        .split_whitespace().next().unwrap();
    let (from, through) = range.split_once('-').unwrap();
    assert_eq!(from.parse::<usize>().unwrap(), start + 1);
    let end = through.parse::<usize>().unwrap();
    let fixed = lines[..start].iter().copied().chain(std::iter::once(d.rewrite.as_str()))
        .chain(lines[end..].iter().copied()).collect::<Vec<_>>().join("\n") + "\n";
    let mut e = engine(&fixed);
    assert_eq!(e.query("untouched", context()).unwrap().data, Value::Int(42));
    chat(&mut e, "ours", "alice"); chat(&mut e, "another", "alice"); chat(&mut e, "hidden", "bob");
    let job = e.run_job("digest", Default::default(), 100).unwrap();
    assert_eq!(job.state, snapback4_core::JobState::Done, "{job:?}");
    let effects = e.effects(None, 10).unwrap();
    assert_eq!(effects.len(), 3);
    for effect in effects {
        let expected = if effect.payload.field("principal").unwrap() == &Value::Id("alice".into()) { 2 } else { 1 };
        assert_eq!(effect.payload.field("total").unwrap(), &Value::Int(expected));
    }
}

#[test]
fn name_lookups_keep_duplicates_and_print_a_complete_held_operation() {
    let first = include_str!("fixtures/ag/name.q");
    let b = clean(first);
    let notes = b.notes.iter().filter(|d| d.code == "N_NEVER_COMPLETE").collect::<Vec<_>>();
    assert_eq!(notes.len(), 2);
    for note in notes {
        assert!(note.message.contains("no server fallback"));
        assert!(note.rewrite.contains(" held:\n"));
        assert!(!note.mechanical);
        let start = first.find(if note.rewrite.starts_with("query groupByTitle") { "query groupByTitle" } else { "query groupNamed" }).unwrap();
        let end = first[start+1..].find("\nquery ").map_or(first.len(), |n| start + 1 + n);
        clean(&format!("{}{}\n{}", &first[..start], note.rewrite, &first[end..]));
    }
    let mut e = engine(first);
    chat(&mut e, "ours", "alice"); chat(&mut e, "another", "alice"); chat(&mut e, "hidden", "bob");
    let q = e.query("groupNamed", Context::new("alice", [("title".into(), Value::String("General".into()))].into())).unwrap();
    assert!(!q.complete); assert_eq!(q.data.as_array().unwrap().len(), 2);
}
