//! Lane X: failed builder guesses either bind as intended or have one repair.
use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::{Bound, compile};

const MODEL: &str = r#"
table members:
  conversation: id
  principal: principal
  active: bool
  unique conversation, principal
  cap 50 by conversation
  public
  sync public
query roster(c: cursor ?):
  return members where .principal = viewer first 20 by .conversation after c { conversation, roster: members[conversation = .conversation] }
query repeated(chat: id, c: cursor ?):
  return members where .conversation = chat where .active first 20 by .principal after c
query conjunction(chat: id, c: cursor ?):
  return members where .conversation = chat and .active first 20 by .principal after c
query qualified(x: int):
  return m.twice(x)
query bare(x: int):
  return twice(x)
query grouped(chat: id, c: cursor ?):
  return members where .active or .principal = 'bob' where .conversation = chat first 20 by .principal after c
fn nestedTwice(x: int): m.twice(m.twice(x))
query nestedHelper(x: int):
  return schema.nestedTwice(x)
"#;
fn compile_model(extra: &str) -> Bound {
    compile(&[("schema.q".into(), format!("{MODEL}\n{extra}")), ("m.q".into(), "fn twice(x: int): x + x\n".into())])
}
fn clean(extra: &str) -> Bound {
    let b = compile_model(extra);
    assert!(b.diagnostics.is_empty(), "{:#?}", b.diagnostics);
    b
}
fn diagnostic(source: &str, code: &str, repair: &str) {
    let b = compile_model(source);
    let d = b.diagnostics.iter().find(|d| d.code == code).unwrap_or_else(|| panic!("{source}: {:?}", b.diagnostics));
    assert!(d.rewrite.contains(repair), "{d:?}");
    assert!(d.site.line > 0 && d.site.col > 0 && !d.site.file.is_empty(), "{d:?}");
}
#[test]
fn nested_roster_binds_the_enclosing_conversation_and_repeated_where_is_and() {
    let b = clean("");
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([("a", "one", "alice", true), ("b", "one", "bob", false), ("c", "two", "alice", true), ("d", "two", "carol", true)]
        .map(|(id, chat, who, active)| ("members".into(), object([("id", Value::Id(id.into())), ("conversation", Value::Id(chat.into())), ("principal", Value::Id(who.into())), ("active", Value::Bool(active))])))).unwrap();
    let roster = e.query("roster", Context::new("alice", Default::default())).unwrap();
    assert!(roster.complete);
    for row in roster.data.as_array().unwrap() {
        let inner = row.field("roster").unwrap().as_array().unwrap();
        assert_eq!(inner.len(), 2);
        assert!(inner.iter().all(|r| r.field("conversation").unwrap() == row.field("conversation").unwrap()));
    }
    let context = || Context::new("alice", [("chat".into(), Value::Id("one".into()))].into());
    let repeated = e.query("repeated", context()).unwrap();
    let conjunction = e.query("conjunction", context()).unwrap();
    assert_eq!(repeated.data, conjunction.data);
    assert_eq!(repeated.metered, conjunction.metered);
    assert_eq!(repeated.data.as_array().unwrap().len(), 1);
    assert_eq!(e.query("grouped", context()).unwrap().data.as_array().unwrap().len(), 2);
    assert_eq!(e.query("nestedHelper", Context::new("alice", [("x".into(), Value::Int(3))].into())).unwrap().data, Value::Int(12));
    for op in ["qualified", "bare"] {
        assert_eq!(e.query(op, Context::new("alice", [("x".into(), Value::Int(3))].into())).unwrap().data, Value::Int(6));
    }
}
#[test]
fn self_equalities_are_refused_in_predicate_scopes_only() {
    for predicate in [".conversation = .conversation", "true and (.conversation = .conversation)", "not (.conversation = .conversation)", "({ same: .conversation = .conversation }).same"] {
        diagnostic(&format!("query bad(c: cursor ?):\n  return members first 20 after c where {predicate}\n"), "E_QUARRY_SELF_EQUALITY", ".conversation = conversation");
    }
    diagnostic("view tautology:\n  members where .conversation = .conversation { conversation }\n", "E_QUARRY_SELF_EQUALITY", "where true");
    clean("query explicit(chat: id, c: cursor ?):\n  return members where .conversation = chat first 20 after c\nquery ordinary(x: int):\n  return x = x\n");
}
#[test]
fn repeated_where_keeps_precedence_short_circuiting_and_other_modifier_refusals() {
    let b = clean("query safe(d: int):\n  return count(members where d != 0 where 10 / d > 1)\n");
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([("members".into(), object([("id", Value::Id("a".into())), ("conversation", Value::Id("one".into())), ("principal", Value::Id("alice".into())), ("active", Value::Bool(true))]))]).unwrap();
    assert_eq!(e.query("safe", Context::new("alice", [("d".into(), Value::Int(0))].into())).unwrap().data, Value::Int(0));
    for mods in ["first 2 last 3", "after c after c", "by .principal by .conversation"] {
        diagnostic(&format!("query bad(c: cursor ?):\n  return members {mods}\n"), "E_QUARRY_SYNTAX", "write each modifier once");
    }
}
#[test]
fn qualification_checks_the_declaration_file_and_cannot_change_placement() {
    diagnostic("query wrong():\n  return other.twice(3)\n", "E_QUARRY_UNKNOWN", "m.twice(3)");
    let b = compile(&[("schema.q".into(), "table t:\n  n: int\n  public\nquery bad():\n  return m.write()\n".into()), ("m.q".into(), "fn write():\n  return insert t { n: 1 }\n".into())]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_PLACEMENT"), "{:?}", b.diagnostics);
    let b = compile(&[("schema.q".into(), "query bad():\n  return m.a()\n".into()), ("m.q".into(), "fn a(): m.a()\n".into())]);
    assert!(b.diagnostics.iter().any(|d| d.message.contains("eight")), "{:?}", b.diagnostics);
}
#[test]
fn foreign_spellings_are_refused_and_canonical_repairs_compile() {
    for (source, repair) in [
        ("query bad(x: text):\n  return x.length\n", "count(x)"),
        ("query bad():\n  return count(*)\n", "count(members)"),
        ("query bad(c: cursor ?):\n  return members where .principal = viewer limit 20\n", "first 20"),
        ("aggregate totals: count members by .conversation\n", "view totals: count members by .conversation"),
    ] { diagnostic(source, "E_QUARRY_UNSUPPORTED", repair); }
    clean("query size(x: text):\n  return count(x)\nquery total():\n  return count(members)\nview totals: count members by .conversation\nquery limited(c: cursor ?):\n  return members where .principal = viewer first 20 after c\nquery field():\n  return { length: 2 }.length\n");
}
#[test]
fn nullable_helper_argument_and_duplicate_sync_have_local_repairs() {
    diagnostic("fn label(p: members): p.principal\nquery bad(id: members):\n  return label(members[id])\n", "E_QUARRY_TYPE", "(members[id]) ! else NOT_FOUND");
    clean("fn label(p: members): p.principal\nquery repaired(id: members):\n  return label(members[id] ! else NOT_FOUND)\n");
    diagnostic("table duplicate:\n  owner: principal\n  read <- .owner = viewer\n  sync to .owner\n  sync public\n", "E_QUARRY_SYNTAX", "keep one sync line matching the read rule");
}
