use snapback4_lang::compile;

#[test]
fn predicate_indexes_and_durations_compile() {
    let source = "table posts:\n  author: principal\n  at: time\n  removed: bool\n  public 'posts'\nquery page(owner: principal, c: cursor ?):\n  return posts where owner = .author and not .removed and .at >= now - 24h last 20 by .at after c\nquery durations():\n  return [500ms, 30s, 15m, 24h, 7d, bucket(now, 2m)]\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:#?}", bound.notes);
    assert!(bound.schema.tables["posts"].indexes.keys().any(|name| name.starts_with("$intent:byAuthorRemovedAt:")));
}

#[test]
fn schema_intent_compiles_without_index_names() {
    let source = "table members:\n  room: id\n  principal: principal\n  role: text <=20\n  unique room, principal\n  cap 50 by room\n  read <- exists members[.room, viewer]\n  insert <- exists members[room = .room, principal = viewer, role = 'admin']\n  sync to members[.room]\ntable messages:\n  room: id\n  body: text <=500\n  at: time\n  expiresAt: time ?\n  search body\n  read <- exists members[.room, viewer]\n  expire at .expiresAt\n  sync to members[.room] last 50 by .at\nquery page(room: id, q: text <=100, c: cursor ?):\n  return messages where .room = room matching q last 20 by .at after c\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    assert!(bound.schema.tables["messages"].indexes.keys().any(|name| name.starts_with("$intent:byRoomWordsBodyAt:")));
}

use snapback4_core::{Context, Engine, Value};
use std::collections::BTreeMap;
fn args(c: Option<String>) -> BTreeMap<String, Value> { BTreeMap::from([("c".into(), c.map(Value::String).unwrap_or(Value::Null))]) }
fn row(id: &str, at: i64, field: &str, actor: &str) -> Value {
    Value::Row(BTreeMap::from([("id".into(), Value::Id(id.into())), ("at".into(), Value::Int(at)), (field.into(), Value::Id(actor.into()))]).into())
}
const UNION: &str = "table posts:\n  author: principal\n  at: time\n  public 'posts'\n  sync public\ntable reposts:\n  actor: principal\n  time: time\n  read <- .actor = viewer\n  sync to .actor\nview activity:\n  posts { actor: .author, at, repost: false }\n  reposts where .actor = viewer { actor, at: .time, repost: true }\nquery page(c: cursor ?):\n  return activity last 2 by .at after c\nquery shaped(c: cursor ?):\n  return activity last 2 by .at after c { id, at, actor }\n";
#[test]
fn union_pages_translate_column_names_and_authorize_each_source() {
    let bound = compile(&[("schema.q".into(), UNION.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    assert!(snapback4_lang::emit::typescript(&bound).contains("activity:"));
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(vec![row("a", 1, "author", "alice"), row("c", 2, "author", "alice"), row("e", 3, "author", "alice")].into_iter().map(|row| ("posts".into(), row))).unwrap();
    let repost = |id: &str, at: i64, actor: &str| Value::Row(BTreeMap::from([("id".into(), Value::Id(id.into())), ("time".into(), Value::Int(at)), ("actor".into(), Value::Id(actor.into()))]).into());
    engine.seed(vec![repost("b", 1, "alice"), repost("d", 2, "alice"), repost("f", 100, "bob")].into_iter().map(|row| ("reposts".into(), row))).unwrap();
    let mut cursor = None;
    let mut ids = Vec::new();
    for _ in 0..5 {
        let result = engine.query("page", Context::new("alice", args(cursor))).unwrap();
        ids.extend(result.data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()));
        cursor = result.next;
        if cursor.is_none() { break; }
    }
    assert_eq!(ids, ["e", "d", "c", "b", "a"]);
}

#[test]
fn in_and_membership_predicates_become_metered_lanes() {
    let source = "table members:\n  room: id\n  principal: principal\n  unique room, principal\n  read <- .principal = viewer\ntable messages:\n  room: id\n  at: time\n  body: text <=100\n  search body\n  read <- exists members[.room, viewer]\nquery search(q: text <=100, c: cursor ?):\n  return messages matching q where exists members[.room, viewer] last 2 by .at after c\nquery list(rooms: [id] <=10, c: cursor ?):\n  return messages where .room in rooms last 2 by .at after c\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let member = |id: &str, room: &str| ("members".into(), Value::Row(BTreeMap::from([("id".into(), Value::Id(id.into())), ("room".into(), Value::Id(room.into())), ("principal".into(), Value::Id("alice".into()))]).into()));
    let message = |id: &str, room: &str, at: i64| ("messages".into(), Value::Row(BTreeMap::from([("id".into(), Value::Id(id.into())), ("room".into(), Value::Id(room.into())), ("at".into(), Value::Int(at)), ("body".into(), Value::String("hello world".into()))]).into()));
    engine.seed([member("m1", "r1"), member("m2", "r2"), message("a", "r1", 1), message("b", "r2", 2), message("c", "r1", 3), message("hidden", "r3", 99)]).unwrap();
    let mut input = args(None); input.insert("q".into(), Value::String("hello".into()));
    let result = engine.query("search", Context::new("alice", input)).unwrap();
    assert_eq!(result.data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap()).collect::<Vec<_>>(), ["c", "b"]);
    assert!(result.complete);
    assert!(result.next.is_some());
    let mut input = args(None); input.insert("rooms".into(), Value::Array(vec![Value::Id("r1".into()), Value::Id("r2".into()), Value::Id("r1".into())]));
    let result = engine.query("list", Context::new("alice", input)).unwrap();
    assert_eq!(result.data.as_array().unwrap().len(), 2);
}

#[test]
fn view_cursor_keeps_equal_ids_across_tables_and_same_table_branches() {
    let source = "table a:\n  at: time\n  public 'a'\ntable b:\n  at: time\n  public 'b'\nview events:\n  a { at, kind: 'one' }\n  b { at, kind: 'two' }\n  a { at, kind: 'three' }\nquery page(c: cursor ?):\n  return events first 1 by .at after c { id, kind }\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let data = Value::Row(BTreeMap::from([("id".into(), Value::Id("same".into())), ("at".into(), Value::Int(1))]).into());
    engine.seed([("a".into(), data.clone()), ("b".into(), data)]).unwrap();
    let mut cursor = None;
    let mut kinds = Vec::new();
    for _ in 0..5 {
        let result = engine.query("page", Context::new("alice", args(cursor))).unwrap();
        assert!(result.complete, "{result:?}");
        kinds.extend(result.data.as_array().unwrap().iter().map(|row| row.field("kind").unwrap().as_str().unwrap().to_owned()));
        cursor = result.next;
        if cursor.is_none() { break; }
    }
    assert_eq!(kinds, ["one", "two", "three"]);
}

#[test]
fn finite_windows_match_manual_trending_and_include_future_buckets() {
    let source = "table posts:\n  at: time\n  likeCount: int\n  removed: bool\n  by byHourLikes: hour(at), likeCount, at, id\n  public 'posts'\nquery planned(c: cursor ?):\n  return posts where .at > now - 24h and .at <= now and not .removed last 3 by .likeCount, .at after c\nquery manual(c: cursor ?):\n  return merge posts after c last 3 by byHourLikes where .at > now - 24h and .at <= now and not .removed:\n    [h] for h in range(hour(now) - 24, hour(now) + 1)\nquery future(c: cursor ?):\n  return posts where .at > now - 24h and .at <= now + 3h last 20 by .likeCount, .at after c\nquery unbounded(c: cursor ?):\n  return posts where .at > now - 24h last 20 by .likeCount, .at after c\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    assert!(bound.notes.iter().any(|note| note.code == "N_SPARSE_FILTER" && note.rewrite.contains(".at <= now")));
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let now = 48 * 3_600_000 + 30 * 60_000;
    let data = |id: &str, at, likes, removed| ("posts".into(), Value::Row(BTreeMap::from([("id".into(), Value::Id(id.into())), ("at".into(), Value::Int(at)), ("likeCount".into(), Value::Int(likes)), ("removed".into(), Value::Bool(removed))]).into()));
    engine.seed([data("old", now - 24 * 3_600_000 - 1, 999, false), data("a", now - 24 * 3_600_000 + 1, 5, false), data("b", now, 5, false), data("c", now, 5, false), data("removed", now, 99, true), data("future1", now + 3_600_000, 8, false), data("future2", now + 2 * 3_600_000, 9, false), data("future3", now + 3 * 3_600_000, 10, false)]).unwrap();
    let planned = engine.query("planned", Context::new("alice", args(None)).at(now)).unwrap();
    let manual = engine.query("manual", Context::new("alice", args(None)).at(now)).unwrap();
    assert_eq!(planned.data, manual.data);
    assert!(planned.complete && manual.complete);
    let future = engine.query("future", Context::new("alice", args(None)).at(now)).unwrap();
    let unbounded = engine.query("unbounded", Context::new("alice", args(None)).at(now)).unwrap();
    assert_eq!(future.data, unbounded.data);
    assert_eq!(future.data.as_array().unwrap().len(), 7);
}

#[test]
fn indexes_are_stable_and_positional_keys_never_guess() {
    let schema = "table members:\n  room: id\n  principal: principal\n  invitedBy: principal\n  unique room, principal\n  unique room, invitedBy\n  public 'members'\n";
    let a = "query a(room: id):\n  return members where .room = room and .principal = viewer first 20 by .invitedBy\n";
    let b = "query b(room: id):\n  return members where .principal = viewer and .room = room first 20 by .invitedBy\n";
    let compile = |body: String| snapback4_lang::compile(&[("schema.q".into(), body)]);
    let first = compile(format!("{schema}{a}{b}"));
    let reversed = compile(format!("{schema}{b}{a}"));
    assert!(first.diagnostics.is_empty(), "{:?}", first.diagnostics);
    assert_eq!(first.schema.tables, reversed.schema.tables);
    assert_eq!(first.schema.tables["members"].indexes.len(), 4);
    let ambiguous = "query probe(room: id):\n  return exists members[room, viewer]\n";
    for planned in ["", a] {
        let bound = compile(format!("{schema}{planned}{ambiguous}"));
        assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_POSITIONAL_SCAN"));
    }
    let named = compile(format!("{schema}query probe(room: id):\n  return exists members[room = room, principal = viewer]\n"));
    assert!(named.diagnostics.is_empty(), "{:?}", named.diagnostics);
}

#[test]
fn unused_views_are_checked_and_have_types() {
    let source = "table a:\n  n: int\n  public 'a'\nview values:\n  a { n }\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.programs.is_empty());
    assert!(snapback4_lang::emit::typescript(&bound).contains("values:"));
    let bad = source.replace("  a { n }", "  a { n }\n  a { n: true }");
    assert!(compile(&[("schema.q".into(), bad)]).diagnostics.iter().any(|d| d.message.contains("conflicts")));
}

#[test]
fn clique_acceptance_subset_compiles_without_authored_indexes() {
    let source = include_str!("fixtures/intent-clique.q");
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    assert!(bound.notes.iter().all(|n| matches!(n.code.as_str(), "N_NO_HORIZON" | "N_NO_CURSOR" | "N_MAINTAINED_COLUMN_STREAM")), "{:?}", bound.notes);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let seeds = [
        ("profiles", serde_json::json!({"id":"profile", "principal":"alice", "displayName":"Hello Alice", "handle":"hello", "bio":"", "location":"", "link":null, "avatar":null, "createdAt":1})),
        ("members", serde_json::json!({"id":"member", "conversationId":"room", "principal":"alice", "role":"member", "readOrdinal":0})),
        ("members", serde_json::json!({"id":"hidden-member", "conversationId":"hidden-room", "principal":"bob", "role":"member", "readOrdinal":0})),
        ("messages", serde_json::json!({"id":"message", "conversationId":"room", "senderId":"alice", "body":"hello world", "ordinal":1, "tombstone":false, "at":3, "expiresAt":null})),
        ("messages", serde_json::json!({"id":"hidden-message", "conversationId":"hidden-room", "senderId":"bob", "body":"hello world", "ordinal":1, "tombstone":false, "at":3, "expiresAt":null})),
    ];
    let rows: Vec<_> = seeds.into_iter().map(|(table, data)| (table.into(), snapback4_core::wire::row_from_json(&engine.schema().tables[table], &data).unwrap())).collect();
    engine.seed(rows).unwrap();
    for (id, parent, at) in [("p", Value::Null, 1), ("reply", Value::Id("p".into()), 2)] {
        let outcome = engine.mutate("createPost", Some(id), Context::new("alice", BTreeMap::from([
            ("postId".into(), Value::Id(id.into())), ("body".into(), Value::String("hello".into())), ("parentId".into(), parent),
        ])).at(at)).unwrap();
        assert!(matches!(outcome.state, snapback4_core::WriteState::Sent { .. }), "{outcome:?}");
    }
    for (query, input) in [("global", args(None)), ("trending", BTreeMap::new()), ("userPosts", { let mut a=args(None); a.insert("owner".into(), Value::Id("alice".into())); a }),
        ("thread", { let mut a=args(None); a.insert("postId".into(), Value::Id("p".into())); a })] {
        let page=engine.query(query, Context::new("alice", input).at(10)).unwrap();
        assert!(page.complete, "{query}: {page:?}");
        assert_eq!(page.data.as_array().unwrap().len(), 1, "{query}");
    }
    for (query, expected) in [("people", "profile"), ("searchAll", "message")] {
        let mut input=args(None); input.insert("q".into(), Value::String("hello".into()));
        let page = engine.query(query, Context::new("alice", input).at(10)).unwrap();
        assert!(page.complete, "{query}: {page:?}");
        let rows = page.data.as_array().unwrap();
        assert_eq!(rows.len(), 1, "{query}: {rows:?}");
        assert_eq!(rows[0].field("id").unwrap().as_str().unwrap(), expected);
    }
}

#[test]
fn membership_sources_authorize_before_enumerating_and_cuts_have_no_cursor() {
    let source = "table members:\n  room: id\n  principal: principal\n  visible: bool\n  unique room, principal\n  cap 2 by principal\n  read <- .visible = true\ntable messages:\n  room: id\n  at: time\n  public 'messages'\nquery page(c: cursor ?):\n  return messages where exists members[.room, viewer] first 1 by .at after c\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let member = |room: &str, visible| ("members".into(), snapback4_core::value::object([("id", Value::Id(room.into())), ("room", Value::Id(room.into())), ("principal", Value::Id("alice".into())), ("visible", Value::Bool(visible))]));
    engine.seed([member("visible", true), member("hidden", false), ("messages".into(), row("allowed", 2, "room", "visible")), ("messages".into(), row("denied", 1, "room", "hidden"))]).unwrap();
    let page = engine.query("page", Context::new("alice", args(None))).unwrap();
    assert_eq!(page.data.as_array().unwrap()[0].field("id").unwrap(), &Value::Id("allowed".into()));
    assert!(!page.complete);
    assert!(page.next.is_none());
    engine.set_ceilings(snapback4_core::Ceilings { examined: 1, ..Default::default() });
    let cut = engine.query("page", Context::new("alice", args(None))).unwrap();
    assert!(!cut.complete && cut.next.is_none(), "{cut:?}");
}

#[test]
fn union_cursor_uses_projected_keys_and_handles_inserts_and_order_pins() {
    let source = "table a:\n  at: time\n  public 'a'\ntable b:\n  time: time\n  public 'b'\nview events:\n  a { source: .id, at }\n  b { source: .id, at: .time }\nquery page(c: cursor ?):\n  return events first 1 by .source after c\nquery pinned(c: cursor ?):\n  return events where .at = 1 first 1 by .at after c\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("a".into(), snapback4_core::value::object([("id", Value::Id("a".into())), ("at", Value::Int(1))])), ("b".into(), snapback4_core::value::object([("id", Value::Id("b".into())), ("time", Value::Int(1))]))]).unwrap();
    let first = engine.query("page", Context::new("alice", args(None))).unwrap();
    assert_eq!(first.tables, ["a", "b"]);
    engine.seed([("a".into(), snapback4_core::value::object([("id", Value::Id("aa".into())), ("at", Value::Int(1))]))]).unwrap();
    let mut cursor = first.next;
    for id in ["aa", "b"] {
        let next = engine.query("page", Context::new("alice", args(cursor))).unwrap();
        assert_eq!(next.data.as_array().unwrap()[0].field("id").unwrap(), &Value::Id(id.into()));
        cursor = next.next;
    }
    assert!(cursor.is_none());
    assert!(engine.query("pinned", Context::new("alice", args(None))).unwrap().next.is_some());
    engine.set_ceilings(snapback4_core::Ceilings { examined: 1, ..Default::default() });
    let cut = engine.query("pinned", Context::new("alice", args(None))).unwrap();
    assert!(!cut.complete && cut.next.is_none(), "{cut:?}");
}

#[test]
fn domains_views_and_aggregates_keep_scan_admission() {
    let base = "table posts:\n  owner: principal\n  public 'posts'\nview activity:\n  posts { actor: .owner }\n";
    for body in ["return count(posts where .owner in [viewer])", "return count(activity)", "return count(activity where .actor = 'alice')"] {
        let b = compile(&[("schema.q".into(), format!("{base}query q():\n  {body}\n"))]);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_BOUND"), "{body}: {:?}", b.diagnostics);
    }
    for body in ["return exists activity where .actor = 'alice'", "for row in activity:\n    return row.id\n  return null", "for row in activity where .actor = 'alice':\n    return row.id\n  return null"] {
        let b = compile(&[("schema.q".into(), format!("{base}query q():\n  {body}\n"))]);
        assert!(b.diagnostics.is_empty(), "{body}: {:?}", b.diagnostics);
    }
    let capped = base.replace("  public", "  cap 20\n  public");
    let b = compile(&[("schema.q".into(), format!("{capped}query q():\n  return count(activity)\n"))]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
}

#[test]
fn aggregate_and_feed_view_syntax_has_the_shared_ast() {
    let source = "table posts:\n  owner: principal\n  body: text <=80\nview totals: count posts by .owner\nview nested: sum posts of amount by .parent.owner\nview following: activity where .actor = viewer\n";
    let (doc, errors) = snapback4_lang::parse_document("schema.q", source);
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(doc.maintains.len(), 2);
    assert_eq!(doc.feed_views[0].source, "activity");
    let b = compile(&[("schema.q".into(), "view following: activity where .actor = viewer\n".into())]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_VIEW_FEED_PENDING" && d.guide == "feeds"));
}

#[test]
fn audience_indexes_follow_probe_order_and_inferred_horizons() {
    let source = "table members:\n  roomKey: id\n  principal: principal\n  unique roomKey, principal\n  read <- .principal = viewer\n  sync\ntable messages:\n  room: id\n  at: time\n  read <- exists members[roomKey = .room, principal = viewer]\n  sync last 20 by .at\n";
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let audience = snapback4_core::schema::audience_binding(&b.schema, "messages", &b.schema.tables["messages"], b.schema.tables["messages"].sync.as_ref().unwrap()).unwrap();
    assert_eq!(audience.columns, ["roomKey"]);
    assert_eq!(b.schema.tables["members"].indexes[&audience.group_index].columns(), ["roomKey", "principal"]);
    assert_eq!(b.schema.tables["members"].indexes[&audience.principal_index].columns(), ["principal", "roomKey"]);
    let named_probe = "table grants:\n  z: id\n  a: principal\n  read <- deny\ntable posts:\n  group: id\n  read <- exists grants[z = .group, a = viewer]\n";
    let b = compile(&[("schema.q".into(), named_probe.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    if let snapback4_core::schema::RuleExpr::Exists { index, .. } = &b.schema.tables["posts"].rules.read {
        assert_eq!(b.schema.tables["grants"].indexes[index].columns(), ["z", "a"]);
    } else { panic!("exact rule probe"); }
}

#[test]
fn projected_predicates_respect_focal_scope_and_field_visibility() {
    let base = "table posts:\n  author: principal\n  secret: bool\n  public 'posts'\ntable likes:\n  actor: principal\n  public 'likes'\nview activity:\n  posts { id, actor: .author }\n";
    let bad = compile(&[("schema.q".into(), format!("{base}query q():\n  return activity where .secret first 5\n"))]);
    assert!(bad.diagnostics.iter().any(|d| d.message.contains("no projected field secret")));
    let b = compile(&[("schema.q".into(), format!("{base}query q():\n  return activity where exists (likes where .actor = viewer) first 5\n"))]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("posts".into(), snapback4_core::value::object([("id", Value::Id("p".into())), ("author", Value::Id("alice".into())), ("secret", Value::Bool(true))])),
        ("likes".into(), snapback4_core::value::object([("id", Value::Id("l".into())), ("actor", Value::Id("alice".into()))]))]).unwrap();
    let page = engine.query("q", Context::new("alice", BTreeMap::new())).unwrap();
    assert_eq!(page.data.as_array().unwrap().len(), 1);
}

#[test]
fn union_positions_survive_empty_pruning_nullable_keys_and_unequal_caps() {
    let source = "table a:\n  at: time\n  cap 1\n  public 'a'\ntable b:\n  at: time ?\n  cap 5\n  public 'b'\nview events:\n  a { at, kind: 'a' }\n  b { at, kind: 'b' }\nquery page(c: cursor ?):\n  return events first 1 by .at after c\nquery empty(c: cursor ?):\n  return events where .kind = 'absent' first 1 by .at after c\nquery all():\n  return count(events)\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("a".into(), snapback4_core::value::object([("id", Value::Id("a".into())), ("at", Value::Int(1))])),
        ("b".into(), snapback4_core::value::object([("id", Value::Id("b".into())), ("at", Value::Null)])),
        ("b".into(), snapback4_core::value::object([("id", Value::Id("c".into())), ("at", Value::Int(2))]))]).unwrap();
    let mut cursor = None;
    for id in ["b", "a", "c"] {
        let page = engine.query("page", Context::new("alice", args(cursor))).unwrap();
        assert!(page.complete, "{page:?}");
        assert_eq!(page.data.as_array().unwrap()[0].field("id").unwrap(), &Value::Id(id.into()));
        if id == "b" {
            let empty = engine.query("empty", Context::new("alice", args(page.next.clone()))).unwrap();
            assert!(empty.complete && empty.next.is_none() && empty.data.as_array().unwrap().is_empty());
        }
        cursor = page.next;
    }
    assert!(cursor.is_none());
    assert!(engine.query("empty", Context::new("alice", args(Some("invalid".into())))).is_err());
    let all = engine.query("all", Context::new("alice", BTreeMap::new())).unwrap();
    assert_eq!(all.data, Value::Int(3));
    assert!(all.complete);
}

#[test]
fn declared_indexes_are_preferred_and_ambiguous_definitions_refuse() {
    let base = "table posts:\n  owner: principal\n  at: time\n  by byOwnerAt: owner, at\n  public 'posts'\nquery q():\n  return posts where .owner = viewer last 20 by .at\n";
    let b = compile(&[("schema.q".into(), base.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let scan = snapback4_core::ir::scans(&b.programs[0].program)[0];
    assert_eq!(scan.index, "byOwnerAt");
    assert_eq!(b.schema.tables["posts"].indexes.len(), 2);
    let ambiguous = base.replace("  public", "  by another: owner, at, id\n  public");
    let b = compile(&[("schema.q".into(), ambiguous)]);
    assert!(b.diagnostics.iter().any(|d| d.message.contains("several declared indexes")), "{:?}", b.diagnostics);
    let words = "table posts:\n  title: text <=100\n  body: text <=100\n  by byTitle: words(title), id\n  by byBody: words(body), id\n  public 'posts'\nquery q(q: text <=30):\n  return posts matching q first 10\n";
    let b = compile(&[("schema.q".into(), words.into())]);
    assert!(b.diagnostics.iter().any(|d| d.message.contains("multiple words definitions")), "{:?}", b.diagnostics);
}

#[test]
fn value_lanes_skip_null_before_opening_and_deduplicate() {
    let source = "table posts:\n  owner: principal ?\n  public 'posts'\nquery q(c: cursor ?):\n  return posts where .owner in [null, viewer, viewer] first 10 after c\n";
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("posts".into(), snapback4_core::value::object([("id", Value::Id("a".into())), ("owner", Value::Id("alice".into()))])),
        ("posts".into(), snapback4_core::value::object([("id", Value::Id("b".into())), ("owner", Value::Null)]))]).unwrap();
    let page = engine.query("q", Context::new("alice", args(None))).unwrap();
    assert!(page.complete);
    assert_eq!(page.data.as_array().unwrap().len(), 1);
    assert_eq!(page.data.as_array().unwrap()[0].field("id").unwrap(), &Value::Id("a".into()));
}

#[test]
fn capped_membership_discovery_never_certifies_a_prefix_of_values() {
    let source = "table members:\n  room: id\n  principal: principal\n  unique room, principal\n  read <- .principal = viewer\ntable posts:\n  room: id\n  public 'posts'\nquery q(c: cursor ?):\n  return posts where exists members[.room, viewer] first 1 after c\n";
    let mut b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    // Exercise the runtime contract even when the producer's bound is lower
    // than the population; ordinary schema caps cannot be exceeded by writes.
    for stmt in &mut b.programs[0].program.body {
        if let snapback4_core::ir::Stmt::Return(snapback4_core::ir::Expr::Merge(merge)) = stmt {
            if let Some(snapback4_core::ir::LaneSource::Scan(scan)) = &mut merge.lanes[0].source {
                scan.take = snapback4_core::ir::Bound::Literal(1);
            } else { panic!("membership source scan"); }
        }
    }
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    for room in ["a", "b"] {
        engine.seed([("members".into(), snapback4_core::value::object([("id", Value::Id(room.into())), ("room", Value::Id(room.into())), ("principal", Value::Id("alice".into()))])),
            ("posts".into(), snapback4_core::value::object([("id", Value::Id(room.into())), ("room", Value::Id(room.into()))]))]).unwrap();
    }
    let page = engine.query("q", Context::new("alice", args(None))).unwrap();
    assert!(!page.complete && page.next.is_none(), "{page:?}");
}
