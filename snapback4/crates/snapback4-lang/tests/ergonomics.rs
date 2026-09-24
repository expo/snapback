//! Inventory S07/S09–S12: verbatim offending builder lines in small schemas.
use snapback4_lang::{Bound, compile};
use snapback4_core::{Context, Engine, Value};
use std::collections::BTreeMap;

fn bind(file: &str, source: &str) -> Bound { compile(&[(file.into(), source.into())]) }
fn texts(bound: &Bound) -> Vec<String> { bound.diagnostics.iter().map(ToString::to_string).collect() }
fn clean(file: &str, source: &str) -> Bound {
    let bound = bind(file, source);
    assert!(bound.diagnostics.is_empty(), "{}", texts(&bound).join("\n\n"));
    bound
}
fn at_line(prefix: &str, line: usize, source: &str) -> String {
    format!("{prefix}{}{source}\n", "\n".repeat(line - prefix.lines().count() - 1))
}
const POSTS: &str = "table posts:\n  authorId: principal\n  parentId: posts ?\n  at: time\n  body: text <=100\n  by byAuthorTime: authorId, at, id\n  by byAuthor: authorId, at, id\n  public 'posts'\nshape postCard = { id, body }\n";
fn seeded(bound: Bound) -> Engine {
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("posts".into(), snapback4_core::value::object([("id", Value::Id("p1".into())), ("authorId", Value::Id("alice".into())), ("parentId", Value::Null), ("at", Value::Int(1)), ("body", Value::String("kept".into()))]))]).unwrap();
    engine
}
fn shape_case(argument: &str, index: &str, line: usize, name: &str) {
    let query = format!("query {name}({argument}: principal, c: cursor ?):\n  return posts[{argument}] after c last 20 by {index} where .parentId = null postCard");
    let source = at_line(POSTS, line - 1, &query);
    clean("social.q", &source);
    let mut engine = seeded(clean("social.q", &source.replace("null postCard", "null { ...postCard }")));
    let result = engine.query(&format!("social.{name}"), Context::new("alice", BTreeMap::from([(argument.into(), Value::Id("alice".into()))]))).unwrap();
    assert_eq!(result.data.as_array().unwrap().len(), 1);
    assert_eq!(result.data.as_array().unwrap()[0].field("body").unwrap(), &Value::String("kept".into()));
}
#[test] fn s07_l12() { shape_case("principal", "byAuthorTime", 83, "userPosts"); }
#[test] fn s07_l10a() { shape_case("authorId", "byAuthorTime", 85, "author"); }
#[test] fn s07_r9() { shape_case("principal", "byAuthor", 147, "userPosts"); }

#[test]
fn s07_valid_predicate_shapes_keep_their_meaning() {
    let source = format!("{POSTS}shape selected = {{ body }}\nquery compare(c: cursor ?):\n  candidate = {{ body: 'kept', extra: 1 }}\n  return posts['alice'] after c last 20 by byAuthor where ({{ body: .body }}) = candidate selected\n");
    let mut engine = seeded(clean("schema.q", &source));
    assert_eq!(engine.query("compare", Context::new("alice", BTreeMap::new())).unwrap().data.as_array().unwrap().len(), 1);
}

#[test]
fn s09_failed_bindings_keep_the_cause_and_independent_errors() {
    let source = "table messages:\n  body: text <=100\n  public 'messages'\nfn bad(setting: text <=1): setting\nmutation send(setting: enum('off', '24h', '7d')):\n  msg = insert messages { body: bad(setting) }\n  id = msg.id\n  require id != null else MISSING\n  other = missing\n  return msg { body }\n";
    let bound = bind("chat.q", source);
    println!("{}", texts(&bound).join("\n\n"));
    assert_eq!(bound.diagnostics.iter().map(|d| d.message.as_str()).collect::<Vec<_>>(), ["bad's setting is text <=1; got enum('off', '24h', '7d')", "unknown name missing"]);
    assert_eq!(bound.diagnostics[0].rewrite, "change bad's parameter to `setting: enum('off', '24h', '7d')`; not every variant fits text <=1");
    clean("chat.q", &source.replace("text <=1):", "text <=3):").replace("other = missing", "other = 1"));
}

#[test]
fn s10_enum_widens_totally_to_bounded_text() {
    let source = "fn disappearance(setting: text <=10):\n  return 86400000 if setting = '24h' else 604800000 if setting = '7d' else null\nquery ttl(setting: enum('off', '24h', '7d')):\n  return disappearance(setting)\n";
    let bound = clean("config.q", source);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    for (setting, expected) in [("off", Value::Null), ("24h", Value::Int(86400000)), ("7d", Value::Int(604800000))] {
        assert_eq!(engine.query("config.ttl", Context::new("alice", BTreeMap::from([("setting".into(), Value::String(setting.into()))]))).unwrap().data, expected);
    }
    clean("schema.q", "fn take(t: text <=1 ?): t\nquery q(t: enum('é', '猫') ?):\n  return take(t)\n");
    let refused = bind("schema.q", "fn take(t: text <=1): t\nquery q(t: enum('é', 'long')):\n  return take(t)\n");
    assert_eq!(refused.diagnostics.len(), 1);
    assert_eq!(refused.diagnostics[0].rewrite, "change take's parameter to `t: enum('é', 'long')`; not every variant fits text <=1");
    let optional = bind("schema.q", "fn take(t: text <=3): t\nquery q(t: enum('off', 'on') ?):\n  return take(t)\n");
    assert_eq!(optional.diagnostics[0].rewrite, "guard `t != null` before calling take, or make its parameter `t: text <=3 ?`");
    clean("schema.q", "fn take(t: text <=3): t\nquery q(t: enum('off', 'on') ?):\n  require t != null else MISSING\n  return take(t)\n");
}

#[test]
fn s10_time_scaling_names_the_actual_expression_and_conversion() {
    for operand in ["now", "m.at", "d", "r"] {
        let source = format!("table messages:\n  at: time\n  public 'messages'\nquery scale(messageId: messages, d: time, r: time):\n  m = messages[messageId] ! else NOT_FOUND\n  return {operand} * 1000\n");
        let bound = bind("order.q", &source);
        println!("{}", texts(&bound).join("\n\n"));
        assert_eq!(bound.diagnostics.len(), 1);
        assert_eq!(bound.diagnostics[0].message, "* cannot scale a time; use an int number of milliseconds");
        assert_eq!(bound.diagnostics[0].rewrite, format!("({operand} / 1) * 1000 — `/ 1` turns a time into int milliseconds; store the scaled count as int. For a server-arrival order keep a per-conversation counter instead: `snapback4 guide arrival`"));
        let good = clean("order.q", &source.replace(&format!("{operand} * 1000"), &format!("({operand} / 1) * 1000")));
        assert!(good.programs.iter().all(|p| p.result == snapback4_lang::types::Ty::Int));
    }
}

#[test]
fn s11_emit_spread_names_explicit_payload_fields() {
    let prefix = "table profiles:\n  principal: principal\n  public 'profiles'\neffect notify\n";
    let source = at_line(prefix, 86, "job dailyDigest(periodStart: time, periodEnd: time):\n  chunk p in profiles first 1 by byId:\n    counts = { newFollowers: 1, newPostsInFollowing: 2, unreadMessages: 3, unreadChats: 4 }\n    if true:\n      if true:\n        emit notify { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, ...counts }");
    let bound = bind("insights.q", &source);
    println!("{}", texts(&bound).join("\n\n"));
    assert_eq!(texts(&bound), ["insights.q:91:90 — E_QUARRY_SYNTAX: expected an object field name, got spread ...counts; objects list fields explicitly\n  rewrite: replace ...counts with field: counts.field for each payload field\n  guide: language"]);
    clean("insights.q", &source.replace("...counts", "newFollowers: counts.newFollowers, newPostsInFollowing: counts.newPostsInFollowing, unreadMessages: counts.unreadMessages, unreadChats: counts.unreadChats"));
    assert!(snapback4_lang::guide::explain_code("E_QUARRY_SYNTAX").unwrap().contains("Object fields use name: expression"));
}

#[test]
fn s12_profiles_range_pins_the_whole_unique_key() {
    let schema = "table profiles:\n  principal: principal\n  unique byPrincipal: principal\n  immutable principal\n  public 'profiles'\n";
    let job = "-- CLI-only, system job for the acceptance clock boundary. Never exposed as a client mutation.\njob ancientPost(author: principal, postId: id, timestamp: time):\n  chunk p in profiles[author] first 1 by byPrincipal:\n    return\n";
    let bound = compile(&[("schema.q".into(), schema.into()), ("test-fixtures.q".into(), job.into())]);
    println!("{}", texts(&bound).join("\n\n"));
    assert_eq!(texts(&bound), ["test-fixtures.q:3:14 — E_QUARRY_TYPE: profiles.byPrincipal takes (principal: principal); supplied (author: principal) pins every key, leaving no column to range over\n  rewrite: use profiles[author] by byPrincipal for one row; in a chunk, use `chunk row in profiles first 1 by byId:` then `if row.principal != author: continue`\n  guide: indexes"]);
    let fixed = compile(&[("schema.q".into(), schema.into()), ("test-fixtures.q".into(), job.replace("profiles[author] first 1 by byPrincipal:", "profiles first 1 by byId:\n    if p.principal != author:\n      continue"))]);
    assert!(fixed.diagnostics.is_empty(), "{:?}", fixed.diagnostics);
    clean("schema.q", &format!("{schema}query one(author: principal):\n  return profiles[author] by byPrincipal\n"));
}

#[test]
fn s12_text_handle_is_not_a_conversation_id() {
    let source = "table conversations:\n  slug: text <=100\n  unique bySlug: slug\n  public 'conversations'\nquery resolve(handle: text <=100, group: bool):\n  if group:\n    direct = conversations[handle] by byId\n    if direct != null:\n      return direct\n  return null\n";
    let (schema, query) = source.split_once("query resolve").unwrap();
    let source = at_line(schema, 190, &format!("query resolve{query}"));
    let bound = bind("chat.q", &source);
    println!("{}", texts(&bound).join("\n\n"));
    assert_eq!(bound.diagnostics.len(), 1);
    assert_eq!(bound.diagnostics[0].message, "conversations.byId takes (id: a conversations reference); supplied (handle: text <=100) has the wrong key type");
    assert_eq!(bound.diagnostics[0].rewrite, "conversations[handle] by bySlug — this index accepts the supplied key; for byId, pass a conversations reference instead of text <=100");
    clean("chat.q", &source.replace("by byId", "by bySlug"));
    clean("chat.q", &source.replace("handle: text <=100", "handle: conversations"));
}

#[test]
fn s09_s10_l12_two_enum_errors_do_not_hide_optional_call_narrowing() {
    let source = include_str!("fixtures/ergonomics-m5.q");
    let bound = bind("chat.q", source);
    println!("L12 m5:\n{}", texts(&bound).join("\n\n"));
    assert_eq!(bound.diagnostics.len(), 2);
    for d in &bound.diagnostics {
        assert_eq!(d.message, "+ needs present numbers; got time and int ?");
        assert_eq!(d.rewrite, "bind the optional call once: `ttl = disappearance(c.disappearing)`; use `now + ttl if ttl != null else null`");
    }
    let fixed = source.replace("  msg = insert", "  ttl = disappearance(c.disappearing)\n  msg = insert").replace("now + disappearance(c.disappearing) if disappearance(c.disappearing) != null else null", "now + ttl if ttl != null else null");
    let bound = clean("chat.q", &fixed);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("conversations".into(), snapback4_core::value::object([("id", Value::Id("c1".into())), ("disappearing", Value::String("24h".into())), ("lastOrdinal", Value::Int(0)), ("lastMessageId", Value::Null)]))]).unwrap();
    let result = engine.mutate("chat.send", Some("write"), Context::new("alice", BTreeMap::from([("messageId".into(), Value::Id("m1".into())), ("conversationId".into(), Value::Id("c1".into())), ("body".into(), Value::String("hello".into()))])).at(1000)).unwrap();
    assert!(matches!(result.state, snapback4_core::WriteState::Sent { .. }), "{:?}", result.state);
}

#[test]
fn s09_s10_l10a_order_helper_and_mark_keep_only_independent_causes() {
    let schema = "table conversations:\n  public 'conversations'\ntable members:\n  conversationId: conversations\n  principal: principal\n  unique byPair: conversationId, principal\n  by byPrincipal: principal, conversationId\n  immutable conversationId, principal\n  public 'members'\ntable messages:\n  conversationId: conversations\n  at: time\n  arrival: time ?\n  public 'messages'\n  update <- public\ntable readStates:\n  conversationId: conversations\n  principal: principal\n  deliveredAt: time\n  readAt: time\n  deliveredArrival: time ?\n  readArrival: time ?\n  unique byPair: conversationId, principal\n  public 'states'\n";
    let order = include_str!("fixtures/ergonomics-order.q");
    let schema = schema.replace("  arrival: time ?", "  arrival: time ?\n  senderId: principal\n  text: text <=2000\n  replyToId: messages ?\n  recipients: [principal] <=50\n  expiresAt: time ?\n  photo: image <=10485760 ?\n  oncePhoto: image <=10485760 once ?\n  video: video <=52428800 ?\n  kind: enum('text', 'image', 'video') default 'text'");
    let files = vec![("schema.q".into(), schema), ("order.q".into(), order.into()), ("chat.q".into(), include_str!("fixtures/ergonomics-chat-order.q").into()), ("media.q".into(), include_str!("fixtures/ergonomics-media-order.q").into())];
    let bound = compile(&files);
    println!("L10a order:\n{}", texts(&bound).join("\n\n"));
    assert_eq!(bound.diagnostics.len(), 5, "{:?}", texts(&bound));
    assert!(bound.diagnostics.iter().all(|d| d.message == "* cannot scale a time; use an int number of milliseconds"));
    let fixed = files.into_iter().map(|(name, source): (String, String)| (name, source.replace("arrival: time", "arrival: int").replace("Arrival: time", "Arrival: int").replace("last: time", "last: int").replace("now * 1000", "(now / 1) * 1000").replace("m.at * 1000", "(m.at / 1) * 1000").replace("d * 1000", "(d / 1) * 1000").replace("r * 1000", "(r / 1) * 1000"))).collect::<Vec<_>>();
    assert!(compile(&fixed).diagnostics.is_empty(), "{:?}", texts(&compile(&fixed)));
}

#[test]
fn s09_failed_bindings_in_nested_blocks_and_tuples_keep_independent_errors() {
    let source = "query q():\n  if true:\n    (a, b) = divmod('wrong', 1)\n    x = a + b\n    independent = missing\n    return x\n  return 0\n";
    let bound = bind("schema.q", source);
    println!("{}", texts(&bound).join("\n\n"));
    assert_eq!(bound.diagnostics.len(), 2);
    assert!(bound.diagnostics[0].message.starts_with("divmod takes two present numbers"));
    assert_eq!(bound.diagnostics[1].message, "unknown name missing");
    clean("schema.q", &source.replace("'wrong'", "4").replace("missing", "1"));
}

#[test]
fn s10_s11_evidence_already_repaired_at_the_base_keeps_positive_cases() {
    // R9 m5-check.txt: the exact argument list, with once at column 158.
    let once = "mutation send(id: id, conversationId: conversations, body: text <=2000, quoteId: messages ?, photo: image <=10000000 ?, clip: video <=50000000 ?, oncePhoto: image <=10000000 once ?):\n  return null\n";
    let source = at_line("table conversations:\n  public 'chats'\ntable messages:\n  public 'messages'\n", 160, once);
    let bad = bind("chat.q", &source);
    assert_eq!(bad.diagnostics.len(), 1);
    assert!(bad.diagnostics[0].mechanical);
    println!("R9 once:\n{}", texts(&bad).join("\n"));
    clean("chat.q", &source.replace("10000000 once ?):", "10000000 ?):"));
    // R9 m8-check1.txt: all three empty headers. The catch-up already supplies --fix.
    for (header, line) in [("query insights", 41), ("query trending", 49), ("job backfill", 52)] {
        let body = if header.starts_with("job") { "\n  chunk p in posts first 100 by byId:\n    return" } else { "\n  return null" };
        let source = at_line(POSTS, line, &format!("{header}:{body}"));
        let bad = bind("analytics.q", &source);
        assert_eq!(bad.diagnostics.len(), 1);
        assert_eq!(bad.diagnostics[0].rewrite, format!("{header}():"));
        assert!(bad.diagnostics[0].mechanical);
        println!("R9 empty args:\n{}", texts(&bad).join("\n"));
        clean("analytics.q", &source.replace(&format!("{header}:"), &format!("{header}():")));
    }
    // R9 m8-check4.txt: the dotted schedule target is already accepted.
    clean("digest.q", "table profiles:\n  public 'profiles'\njob daily():\n  chunk p in profiles first 1 by byId:\n    return\nschedule dailyDigest every 2m at 00:00: digest.daily\n");
    // R9 m3-check.txt: a table-typed helper keeps the actual row at each call.
    let schema = "table profiles:\n  principal: principal\n  unique byPrincipal: principal\n  public 'profiles'\ntable conversations:\n  public 'chats'\ntable members:\n  conversationId: conversations\n  principal: principal\n  unique byPair: conversationId, principal\n  public 'members'\ntable receipts:\n  conversationId: conversations\n  principal: principal\n  deliveredAt: time\n  readAt: time\n  unique byPair: conversationId, principal\n  public 'receipts'\ntable messages:\n  body: text <=2000\n  senderId: principal\n  quoteId: messages ?\n  recipients: [principal] <=50\n  conversationId: conversations\n  at: time\n  public 'messages'\n";
    let helper = r#"fn state(m: messages):
  delivered = true
  read = true
  for p in m.recipients:
    if exists members[m.conversationId, p]:
      r = receipts[m.conversationId, p]
      if r = null:
        delivered = false
        read = false
      else:
        if r.deliveredAt < m.at:
          delivered = false
        if r.readAt < m.at:
          read = false
  return 'read' if read else 'delivered' if delivered else 'sent'

shape messageCard = { *, sender: profiles[principal = .senderId], quote: messages[.quoteId] { id, body, sender: profiles[principal = .senderId] }, receipt: state(.) }
query history(id: messages):
  return messages[id] messageCard
"#;
    clean("chat.q", &at_line(schema, 89, helper));
    let reference = bind("chat.q", "table messages:\n  body: text <=100\n  public 'messages'\nfn state(m: messages): m.body\nquery q(id: messages):\n  return state(id)\n");
    assert_eq!(reference.diagnostics.len(), 1);
    assert_eq!(reference.diagnostics[0].message, "a messages reference has no fields");
    assert!(reference.diagnostics[0].rewrite.contains("messages[m] ! else NOT_FOUND"));
    // S11's residency syntax is owned by B2: its message names inheritance
    // and the `online only` opt-out; the builder's removal stays clean.
    let source = at_line("table likes:\n  postId: id\n  public 'likes'\n", 70, "maintain likeCounts: count likes by postId\n  read <- allow\n  sync public last 2000 by byId");
    let bad = bind("social.q", &source);
    assert_eq!(texts(&bad), ["social.q:72:3 — E_QUARRY_SYNTAX: a maintain inherits its source's sync; `online only` opts out\n  rewrite: remove this sync line to inherit, or replace it with `online only`\n  guide: residency"]);
    clean("social.q", &source.replace("  sync public last 2000 by byId\n", ""));
}

#[test]
fn s09_a_poisoned_field_does_not_hide_an_independent_sibling() {
    for expression in ["{ msg, other: absent }", "[msg, absent]"] {
        let source = format!("query q():\n  msg = missing\n  return {expression}\n");
        let bound = bind("schema.q", &source);
        assert_eq!(bound.diagnostics.iter().map(|d| d.message.as_str()).collect::<Vec<_>>(), ["unknown name missing", "unknown name absent"]);
        clean("schema.q", &source.replace("missing", "1").replace("absent", "2"));
    }
}

#[test]
fn s11_token_expectations_explain_the_required_spelling() {
    for (source, expected) in [
        ("query q(n int):\n  return n\n", "put : after a declaration or block header; parameters use name: type, and object fields use name: expression"),
        ("query q(n: text <=):\n  return n\n", "write an integer literal here, for example first 50 or text <=100"),
        ("query q(n: enum(off, 'on')):\n  return n\n", "quote the text with ' or \"; enum variants are quoted strings, for example enum('off', 'on')"),
        ("query q():\nreturn 1\n", "indent the body beneath its header with spaces, for example query q(): followed by an indented return null"),
        ("query q():\n  return { a: 1 b: 2 }\n", "separate fields with commas and close the object or shape with }"),
    ] {
        let bound = bind("schema.q", source);
        assert_eq!(bound.diagnostics[0].rewrite, expected);
        println!("expected-token: {}", bound.diagnostics[0]);
    }
    clean("schema.q", "query q(n: int, text: text <=10, setting: enum('off', 'on')):\n  return { n, text, setting }\n");
}

#[test]
fn s09_recovery_does_not_duplicate_a_relocated_helper_error() {
    let source = "fn mint():\n  id = new\n  return id\nquery q():\n  return mint()\n";
    let bound = bind("schema.q", source);
    assert_eq!(texts(&bound), ["schema.q:5:14 — E_QUARRY_PLACEMENT: fn mint: queries cannot mint ids (at schema.q:2:8)\n  rewrite: mint ids in a mutation\n  guide: programs"]);
    clean("schema.q", &source.replace("query q", "mutation q"));
}

#[test]
fn s09_recovery_clears_a_reassigned_bindings_error_type() {
    let source = "query q():\n  msg = missing\n  msg = 1\n  return msg.body\n";
    let bound = bind("schema.q", source);
    assert_eq!(bound.diagnostics.iter().map(|d| d.message.as_str()).collect::<Vec<_>>(), ["unknown name missing", "int has no fields"]);
    clean("schema.q", &source.replace("missing", "1").replace("msg.body", "msg"));
}

#[test]
fn enum_widening_respects_text_character_domain() {
    let source = "table labels:\n  label: text <=1\n  unique byLabel: label\n  public 'labels'\n  insert <- allow\nfn take(t: text <=1): t\n";
    for body in ["return take(t)", "return insert labels { label: t }", "return labels[label = take(t)]"] {
        let bound = bind("schema.q", &format!("{source}mutation bad(t: enum('é', '\u{0001}')):\n  {body}\n"));
        assert!(!bound.diagnostics.is_empty(), "control-character enum widened through {body}");
        assert!(bound.diagnostics.iter().all(|d| d.code == "E_QUARRY_TYPE"), "{:?}", bound.diagnostics);
    }
}

#[test]
fn enum_text_helpers_storage_indexes_and_wire_keep_the_same_domain() {
    let source = "table labels:\n  label: text <=1\n  unique byLabel: label\n  public 'labels'\n  insert <- allow\nfn take(t: text <=1): t\nmutation put(t: enum('é', '猫', '\t')):\n  return insert labels { label: take(t) }\nquery get(t: enum('é', '猫', '\t')):\n  return labels[label = t]\nmutation raw(t: text <=1):\n  return insert labels { label: t }\n";
    let bound = clean("schema.q", source);
    let enum_arg = bound.programs.iter().find(|p| p.program.name == "put").unwrap().program.args["t"].clone();
    let text_arg = bound.programs.iter().find(|p| p.program.name == "raw").unwrap().program.args["t"].clone();
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    for text in ["é", "猫", "\t"] {
        let value = snapback4_core::wire::from_json(&enum_arg, &serde_json::json!(text)).unwrap();
        let context = || Context::new("alice", BTreeMap::from([("t".into(), value.clone())]));
        let sent = engine.mutate("put", None, context()).unwrap();
        assert!(matches!(sent.state, snapback4_core::WriteState::Sent { .. }), "{sent:?}");
        let row = engine.query("get", context()).unwrap().data;
        assert_eq!(row.field("label").unwrap(), &value);
        assert_eq!(snapback4_core::wire::to_json(row.field("label").unwrap()), serde_json::json!(text));
    }
    for text in ["\u{0001}", "\u{007f}", "\u{0085}"] {
        let value = snapback4_core::wire::from_json(&text_arg, &serde_json::json!(text)).unwrap();
        let outcome = engine.mutate("raw", None, Context::new("alice", BTreeMap::from([("t".into(), value)]))).unwrap();
        let snapback4_core::WriteState::Failed { why, .. } = outcome.state else { panic!("control character admitted"); };
        assert_eq!(why.code, "E_INPUT");
        assert!(!snapback4_lang::types::Ty::Enum(vec![text.into()]).assignable_to(&snapback4_lang::types::Ty::Text(1)));
    }
    // Enum membership itself is unchanged: only a widening into text is refused.
    let bound = clean("schema.q", "table labels:\n  label: enum('é', '\u{0001}')\n  unique byLabel: label\n  public 'labels'\n  insert <- allow\nfn take(t: enum('é', '\u{0001}')): t\nmutation put(t: enum('é', '\u{0001}')):\n  return insert labels { label: take(t) }\nquery get(t: enum('é', '\u{0001}')):\n  return labels[label = t]\n");
    let enum_arg = bound.programs.iter().find(|p| p.program.name == "put").unwrap().program.args["t"].clone();
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let value = snapback4_core::wire::from_json(&enum_arg, &serde_json::json!("\u{0001}")).unwrap();
    let context = || Context::new("alice", BTreeMap::from([("t".into(), value.clone())]));
    engine.mutate("put", None, context()).unwrap();
    assert_eq!(engine.query("get", context()).unwrap().data.field("label").unwrap(), &value);
}

/// A scalar already *is* the value, so the repair is to drop the field access, not to
/// go and find a row. `int has no fields` was the most frequent compile error of the
/// 0.2.28 calibration — 20 of its 32 `E_QUARRY_TYPE` — on a full group-key `maintain`
/// lookup the builder had written `.value` on. The old rewrite, "read a row or an
/// object before selecting a field", pointed away from the fix.
#[test]
fn w16h_a_scalar_field_access_is_told_to_drop_the_field_not_to_read_a_row() {
    let source = "query q():\n  n = 1\n  return n.value\n";
    let bound = bind("schema.q", source);
    let diagnostic = &bound.diagnostics[0];
    assert_eq!(diagnostic.message, "int has no fields");
    assert_eq!(diagnostic.rewrite, "this is already a value — remove `.value`");
    // An id is the one case where a row read really is what is missing: it keeps the
    // older advice, so this change narrows the generic arm rather than replacing it.
    clean("schema.q", &source.replace("n.value", "n"));
}

/// `x != null` is the right repair for most optionals and a trap for `bool ?`: it is
/// also true when the value is `false`, so an author who follows it gets a condition
/// that compiles, passes `check`, and silently inverts their intent on every
/// explicitly-false row. Both spellings compiled green before this, so the rewrite was
/// the only place the difference could be caught. The 0.2.28 calibration hit the class
/// six times.
#[test]
fn w16h_a_bool_optional_condition_is_not_told_to_compare_against_null() {
    let schema = "table prefs:\n  owner: principal\n  muted: bool ?\n  nickname: text <=40 ?\n  unique byOwner: owner\n  public 'p'\n  insert <- .owner = viewer\n  sync public last 500 by byOwner\n";
    let query = |field: &str| format!("{schema}query q(who: principal):\n  p = prefs[owner = who] ! else NOT_FOUND\n  if p.{field}:\n    return 1\n  return 0\n");

    let optional_bool = bind("schema.q", &query("muted"));
    assert_eq!(optional_bool.diagnostics[0].message, "if needs a bool condition, got bool ?");
    assert_eq!(optional_bool.diagnostics[0].rewrite, "compare the value: `if x = true:` — `x != null` is also true when x is false");

    // Every other optional keeps the advice that is correct for it.
    let optional_text = bind("schema.q", &query("nickname"));
    assert_eq!(optional_text.diagnostics[0].rewrite, "compare the value: `if x != null:`");

    clean("schema.q", &query("muted").replace("if p.muted:", "if p.muted = true:"));
}
