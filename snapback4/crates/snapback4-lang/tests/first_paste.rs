//! First attempts reconstructed from cal23–25 and the comparative Clique builder.
use serde_json::json;
use snapback4_core::{Context, Engine, Value, WriteState, wire};
use snapback4_lang::{Bound, compile};

const AGGREGATE: &str = include_str!("fixtures/ag/aggregate.q");
const UPSERT: &str = include_str!("fixtures/ag/upsert.q");

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
    let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_UNKNOWN").unwrap();
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
fn cal23_to_cal25_upsert_reason_and_verbatim_expression_keep_insert_and_update() {
    for fields in ["emoji", "message, principal: viewer, emoji"] {
        let original = UPSERT.replace("{ emoji }", &format!("{{ {fields} }}"));
        let b = clean(&original);
        let summary = snapback4_lang::bind::residency::prediction_summary(&b).unwrap();
        assert!(summary.contains("upsert on a read-through child queues without a row"), "{summary}");
        assert!(!summary.contains("online-only table reactions"));
        let site = b.schema.operations["setReaction"].sites.iter().find(|s| s.kind == "upsert").unwrap();
        assert!(site.rewrite.contains("else (insert reactions"), "{site:?}");
        let fixed = original.replace(&format!("upsert reactions[message, viewer] {{ {fields} }}"), &site.rewrite);
        assert_eq!(clean(&fixed).schema.operations["setReaction"].predicts.as_deref(), Some("eligible"));
        for source in [&original, &fixed] {
            let mut e = engine(source);
            chat(&mut e, "ours", "alice");
            for emoji in ["heart", "laugh"] {
                let mut ctx = message_context(); ctx.args.insert("emoji".into(), Value::String(emoji.into()));
                let out = e.mutate("setReaction", None, ctx).unwrap();
                assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
                let rows = e.store().rows("reactions").unwrap();
                assert_eq!(rows.len(), 1);
                assert_eq!(rows[0].field("emoji").unwrap(), &Value::String(emoji.into()));
            }
        }
    }
    // An update-only patch has no compilable direct-insert equivalent.
    let b = clean(&UPSERT.replace("  emoji: text 1..32", "  required: int\n  emoji: text 1..32"));
    assert!(b.schema.operations["setReaction"].sites.iter().find(|s| s.kind == "upsert").unwrap().rewrite.is_empty());
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
    let mut e = engine("fn length(n: int): n + 1\nquery custom():\n  return length(41)\n");
    assert_eq!(e.query("custom", context()).unwrap().data, Value::Int(42));
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
        .replace("    result = digestCounts(member.principal)", "    result = digestCounts(member.principal)\n    emit notify { principal: member.principal, total: result }");
    let b = bound(&first);
    let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_BOUND").unwrap();
    assert!(!d.mechanical, "removing a query is a product choice");
    assert!(d.message.contains("entire unused viewer query"), "{d}");
    let fixed = first.replace("query digestPreview():\n  return digestCounts(viewer)", &d.rewrite);
    let mut e = engine(&fixed);
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
