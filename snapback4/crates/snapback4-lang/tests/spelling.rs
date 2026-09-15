//! W5f: dense-query spelling, exercised against the engine as well as the binder.
use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::{Bound, compile};
use std::collections::BTreeMap;

const SCHEMA: &str = "table posts:\n  author: principal\n  body: text <=100\n  hidden: bool\n  by byAuthor: author, id\n  public 'posts'\ntable follows:\n  follower: principal\n  followed: principal\n  unique byPair: follower, followed\n  by byFollowed: followed, follower\n  public 'follows'\nshape card = { id, body }\n";

fn bound(source: &str) -> Bound { compile(&[("schema.q".into(), source.into())]) }
fn clean(source: &str) -> Bound {
    let b = bound(source);
    assert!(b.diagnostics.is_empty(), "{}", b.diagnostics.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n"));
    b
}
fn engine(b: Bound) -> Engine {
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed((1..=3).map(|i| ("posts".into(), object([("id", Value::Id(format!("p{i}"))), ("author", Value::Id("bob".into())), ("body", Value::String(format!("post {i}"))), ("hidden", Value::Bool(i == 2))])))).unwrap();
    e.seed([("follows".into(), object([("id", Value::Id("f1".into())), ("follower", Value::Id("alice".into())), ("followed", Value::Id("bob".into()))]))]).unwrap();
    e
}
fn context() -> Context { Context::new("alice", BTreeMap::new()) }

#[test]
fn nested_predicate_read_does_not_capture_outer_modifiers() {
    for predicate in ["exists follows[follower = viewer, followed = .author]", "follows[viewer, .author] != null"] {
        let source = format!("{SCHEMA}query page(c: cursor ?):\n  return posts['bob'] where {predicate} after c last 1 by byAuthor\n");
        let mut e = engine(clean(&source));
        let first = e.query("page", context()).unwrap();
        assert_eq!(first.data.as_array().unwrap()[0].field("id").unwrap(), &Value::Id("p3".into()));
        assert!(first.complete);
        let next = e.query("page", Context::new("alice", BTreeMap::from([("c".into(), Value::String(first.next.unwrap()))]))).unwrap();
        assert_eq!(next.data.as_array().unwrap()[0].field("id").unwrap(), &Value::Id("p2".into()));
    }
}

#[test]
fn all_24_page_modifier_orders_have_the_same_result() {
    let modifiers = ["after c", "last 1", "by byAuthor", "where not .hidden"];
    let mut count = 0;
    for a in 0..4 { for b in 0..4 { for c in 0..4 { for d in 0..4 {
        let mut order = [a, b, c, d];
        order.sort();
        if order != [0, 1, 2, 3] { continue; }
        let spelling = [a, b, c, d].map(|i| modifiers[i]).join(" ");
        let source = format!("{SCHEMA}query page(c: cursor ?):\n  return posts['bob'] {spelling} card\n");
        let mut e = engine(clean(&source));
        assert_eq!(e.query("page", context()).unwrap().data.as_array().unwrap()[0].field("id").unwrap(), &Value::Id("p3".into()));
        count += 1;
    }}}}
    assert_eq!(count, 24);
    println!("modifier permutations: {count} passed");
}

#[test]
fn declared_shapes_after_scalar_predicates_shape_the_page() {
    for predicate in ["not .hidden", ".hidden = false", "not (.hidden)", "(.hidden = false)", "true if .hidden = false else false", "exists follows[follower = viewer, followed = .author]"] {
        let source = format!("{SCHEMA}query page(c: cursor ?):\n  return posts['bob'] after c last 1 by byAuthor where {predicate} card\n");
        let mut e = engine(clean(&source));
        let row = e.query("page", context()).unwrap().data.as_array().unwrap()[0].clone();
        assert_eq!(row.field("body").unwrap(), &Value::String("post 3".into()));
        assert!(row.field("author").is_err());
    }
    let source = format!("{SCHEMA}query page(c: cursor ?):\n  return posts['bob'] after c last 1 by byAuthor where not .hidden card\n");
    let sources = [("schema.q".into(), source.replace("shape card = { id, body }\n", "")), ("shapes.q".into(), "shape card = { id, body }\n".into())];
    assert!(compile(&sources).diagnostics.is_empty(), "shapes may be declared in another file");
}

#[test]
fn unique_positional_probe_prefers_the_full_unique_key() {
    let source = format!("{SCHEMA}query followed():\n  return exists follows[viewer, 'bob']\nquery reversed():\n  return exists follows[viewer, 'bob'] by byFollowed\n");
    let mut e = engine(clean(&source));
    assert_eq!(e.query("followed", context()).unwrap().data, Value::Bool(true));
    assert_eq!(e.query("reversed", context()).unwrap().data, Value::Bool(false));
}

#[test]
fn optional_chain_on_a_call_has_a_mechanical_single_evaluation_rewrite() {
    let source = "fn make(): { b: 1 }\nquery q():\n  return make()?.b\n";
    let b = bound(source);
    assert_eq!(b.diagnostics[0].to_string(), "schema.q:3:16 — E_QUARRY_UNSUPPORTED: ?. is not part of Snapback 4; field access already returns null for a null base\n  rewrite: . — check --fix applies it\n  guide: language");
    assert!(b.diagnostics[0].mechanical);
    let fixed = clean(&source.replace("?.", "."));
    let mut e = Engine::memory(fixed.schema, fixed.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(e.query("q", context()).unwrap().data, Value::Int(1));
}

#[test]
fn parenthesized_inner_reads_and_helper_predicates_keep_their_scope() {
    for predicate in ["(exists follows[viewer, .author] by byPair)", "count(posts['bob'] first 2 by byAuthor) = 2", "followed(.author)"] {
        let source = format!("{SCHEMA}fn followed(author: principal): exists follows[viewer, author]\nquery page(c: cursor ?):\n  return posts['bob'] where {predicate} last 1 by byAuthor after c card\n");
        let mut e = engine(clean(&source));
        assert_eq!(e.query("page", context()).unwrap().data.as_array().unwrap()[0].field("id").unwrap(), &Value::Id("p3".into()));
    }
}

#[test]
fn unresolved_index_choices_keep_the_exact_mechanical_refusal() {
    for indexes in [SCHEMA.replace("unique byPair", "by byPair"), SCHEMA.replace("by byFollowed", "unique byFollowed")] {
        let source = format!("{indexes}query followed():\n  return exists follows[viewer, 'bob']\n");
        let b = bound(&source);
        assert_eq!(b.diagnostics.len(), 1);
        assert_eq!(b.diagnostics[0].to_string(), "schema.q:15:17 — E_QUARRY_AMBIGUOUS: follows has 2 indexes matching this key: byPair, byFollowed; choose one\n  rewrite: follows[viewer, 'bob'] by byPair — check --fix applies it\n  guide: indexes");
        let mut e = engine(clean(&source.replace("follows[viewer, 'bob']", &b.diagnostics[0].rewrite)));
        assert_eq!(e.query("followed", context()).unwrap().data, Value::Bool(true));
    }
}

#[test]
fn rule_probes_also_prefer_the_full_unique_positional_key() {
    let source = format!("{}query page(c: cursor ?):\n  return posts['bob'] after c first 1 by byAuthor\n", SCHEMA.replace("public 'posts'", "read <- exists follows[viewer, .author]"));
    let mut e = engine(clean(&source));
    assert_eq!(e.query("page", context()).unwrap().data.as_array().unwrap().len(), 1);
    assert!(e.query("page", Context::new("mallory", BTreeMap::new())).unwrap().data.as_array().unwrap().is_empty());
}

#[test]
fn repeated_modifiers_require_a_choice_and_never_offer_to_drop_one() {
    let b = bound(&format!("{SCHEMA}query page():\n  return posts['bob'] first 1 last 2 by byAuthor\n"));
    assert_eq!(b.diagnostics[0].to_string(), "schema.q:15:31 — E_QUARRY_SYNTAX: read modifier last is repeated; choose one value\n  rewrite: write each modifier once: [matching q] [after c] first|last N by index [where predicate]\n  guide: language");
    assert!(!b.diagnostics[0].mechanical);
}

#[test]
fn matching_can_appear_after_the_other_page_modifiers() {
    let source = format!("{}query page(c: cursor ?):\n  return posts['bob'] where not .hidden by byWords last 1 after c matching 'post' card\n", SCHEMA.replace("by byAuthor: author, id", "by byAuthor: author, id\n  by byWords: author, words(body), id"));
    let mut e = engine(clean(&source));
    assert_eq!(e.query("page", context()).unwrap().data.as_array().unwrap()[0].field("id").unwrap(), &Value::Id("p3".into()));
}

#[test]
fn scalar_tail_shapes_match_explicit_spreads_in_loops_and_expression_positions() {
    let source = format!("{SCHEMA}query collect():\n  bodies = []\n  for p in posts['bob'] first 3 by byAuthor where not .hidden card:\n    bodies = bodies + [p.body]\n  return bodies\nquery countPage():\n  return count(posts['bob'] first 3 by byAuthor where not .hidden card)\n");
    let bare = clean(&source);
    let explicit = clean(&source.replace("where not .hidden card", "where not .hidden { ...card }"));
    assert_eq!(serde_json::to_value(bare.programs.iter().map(|p| &p.program).collect::<Vec<_>>()).unwrap(), serde_json::to_value(explicit.programs.iter().map(|p| &p.program).collect::<Vec<_>>()).unwrap());
    let mut e = engine(bare);
    assert_eq!(e.query("collect", context()).unwrap().data, Value::Array(vec![Value::String("post 1".into()), Value::String("post 3".into())]));
    assert_eq!(e.query("countPage", context()).unwrap().data, Value::Int(2));
}

#[test]
fn optional_chain_on_a_bound_row_has_a_clean_field_rewrite() {
    let source = format!("{SCHEMA}query title(id: posts):\n  row = posts[id]\n  return row?.body\n");
    let b = bound(&source);
    assert_eq!(b.diagnostics.len(), 1);
    assert_eq!(b.diagnostics[0].to_string(), "schema.q:16:13 — E_QUARRY_UNSUPPORTED: ?. is not part of Snapback 4; field access already returns null for a null base\n  rewrite: . — check --fix applies it\n  guide: language");
    let mut e = engine(clean(&source.replace("?.", &b.diagnostics[0].rewrite)));
    for (id, expected) in [("p1", Value::String("post 1".into())), ("missing", Value::Null)] {
        assert_eq!(e.query("title", Context::new("alice", BTreeMap::from([("id".into(), Value::Id(id.into()))]))).unwrap().data, expected);
    }
}

#[test]
fn optional_read_and_writing_helper_rewrites_evaluate_the_base_once() {
    let source = format!("{SCHEMA}query title(id: posts):\n  return (posts[id])?.body\n");
    assert!(bound(&source).diagnostics[0].mechanical);
    let mut e = engine(clean(&source.replace("?.", ".")));
    let result = e.query("title", Context::new("alice", BTreeMap::from([("id".into(), Value::Id("p1".into()))]))).unwrap();
    assert_eq!(result.data, Value::String("post 1".into()));
    assert_eq!(result.metered.examined, 1);
    let source = "table items:\n  n: int\n  public 'items'\n  insert <- allow\nfn make(): insert items { n: 7 }\nmutation create():\n  return make()?.n\n";
    assert!(bound(source).diagnostics[0].mechanical);
    let fixed = clean(&source.replace("?.", "."));
    let mut e = Engine::memory(fixed.schema, fixed.programs.into_iter().map(|p| p.program)).unwrap();
    let write = e.mutate("create", None, context()).unwrap();
    assert!(matches!(write.state, snapback4_core::WriteState::Sent { result: Value::Int(7), .. }), "{write:?}");
    assert_eq!(e.store().rows("items").unwrap().len(), 1);
    println!("optional bases: examined=1, inserted=1");
}
