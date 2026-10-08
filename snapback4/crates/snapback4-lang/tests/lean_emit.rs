//! The Lean case emitter (`emit::lean`, LLP 3000.035 §5.2): the documented
//! expansions of `snapback4/lean/Quarry/Syntax.lean`, and a named reason for
//! everything outside the model's core fragment.
use serde_json::{Value, json};
use snapback4_lang::emit::lean::{LeanError, LeanModule, lean};

fn module(source: &str) -> LeanModule {
    match lean(&[("schema.q".into(), source.into())]) {
        Ok(m) => m,
        Err(e) => panic!("{e:?}"),
    }
}

fn table<'a>(m: &'a LeanModule, name: &str) -> &'a Value {
    m.schema["tables"].as_array().unwrap().iter().find(|t| t["name"] == name).unwrap()
}

fn body(m: &LeanModule, name: &str) -> Value {
    m.program(name).unwrap()["body"].clone()
}

fn reason(m: &LeanModule, name: &str) -> String {
    m.program(name).unwrap_err().reason
}

const ROOMS: &str = "table members:
  roomId: id
  principal: principal
  unique roomId, principal else MEMBER_EXISTS
  read <- exists members[.roomId, viewer]
  insert <- .principal = viewer
  update <- .principal = viewer
  online only
table notes:
  ownerId: principal
  roomId: id
  title: text <=20
  score: int
  done: bool
  read <- .ownerId = viewer or exists members[.roomId, viewer]
  insert <- .ownerId = viewer
  update (old, next) <- old.ownerId = viewer and next.ownerId = viewer
  delete <- viewer = 'service:janitor'
  online only
table labels:
  name: text <=20
  public 'labels are shared'
fn twice(x: int): x + x
query page(roomId: id, c: cursor ?):
  return notes where .roomId = roomId and .score > 0 and .done = false first 5 by .title after c
query one(key: id):
  n = notes[key]
  return n.title if n != null else 'none'
query member(roomId: id):
  return { here: exists members[roomId, viewer], count: count(members where .roomId = roomId) }
mutation add(key: id, roomId: id, title: text <=20):
  require twice(1) = 2 else MATH
  return insert notes { id: key, ownerId: viewer, roomId, title, score: 0, done: false }
mutation rename(key: id, title: text <=20):
  update notes[key] { title } if .done = false
  delete notes[key]
  return true
";

#[test]
fn schema_expansions_follow_syntax_lean() {
    let m = module(ROOMS);
    let members = table(&m, "members");
    // A positional rule probe resolves to the one unique key accepting (id, principal).
    assert_eq!(members["read"], json!({"probe": {"table": "members", "key": [["roomId", {"col": ["self", "roomId"]}], ["principal", "viewer"]]}}));
    // An unnamed update rule judges both images (OPEN R2).
    assert_eq!(members["update"], json!({"and": [{"eq": [{"col": ["old", "principal"]}, "viewer"]}, {"eq": [{"col": ["next", "principal"]}, "viewer"]}]}));
    // Omitted rules deny; uniques carry their `else` code.
    assert_eq!(members["delete"], json!("deny"));
    assert_eq!(members["uniques"], json!([["roomId", "principal"]]));
    assert_eq!(members["uniqueCodes"], json!(["MEMBER_EXISTS"]));
    let notes = table(&m, "notes");
    assert_eq!(notes["update"], json!({"and": [{"eq": [{"col": ["old", "ownerId"]}, "viewer"]}, {"eq": [{"col": ["next", "ownerId"]}, "viewer"]}]}));
    // A text literal beside a principal is an id (OPEN V1).
    assert_eq!(notes["delete"], json!({"eq": ["viewer", {"lit": {"id": "service:janitor"}}]}));
    // `public` is `read <- allow`.
    assert_eq!(table(&m, "labels")["read"], json!("allow"));
    assert_eq!(m.helpers, json!([{"name": "twice", "params": ["x"], "body": {"bin": ["add", {"var": "x"}, {"var": "x"}]}}]));
}

#[test]
fn reads_split_pins_from_the_residual_filter() {
    let m = module(ROOMS);
    assert_eq!(
        body(&m, "page"),
        json!([{"ret": {"page": {"table": "notes", "pins": [["roomId", {"var": "roomId"}], ["done", {"lit": {"bool": false}}]],
            "filter": {"bin": ["gt", {"dot": "score"}, {"lit": {"int": "0"}}]}, "order": ["title"], "desc": false, "take": 5, "after": {"var": "c"}}}}])
    );
    assert_eq!(
        body(&m, "one"),
        json!([{"assign": ["n", {"point": {"table": "notes", "key": [["id", {"var": "key"}]]}}]},
               {"ret": {"cond": [{"bin": ["ne", {"var": "n"}, {"lit": {"null": null}}]}, {"field": [{"var": "n"}, "title"]}, {"lit": {"text": "none"}}]}}])
    );
    assert_eq!(
        body(&m, "member"),
        json!([{"ret": {"record": [
            ["here", {"exists": {"table": "members", "pins": [["roomId", {"var": "roomId"}], ["principal", "viewer"]], "filter": null}}],
            ["count", {"count": {"table": "members", "pins": [["roomId", {"var": "roomId"}]], "filter": null}}]]}}])
    );
}

#[test]
fn writes_and_statements() {
    let m = module(ROOMS);
    assert_eq!(
        body(&m, "add"),
        json!([{"require": [{"bin": ["eq", {"call": ["twice", [{"lit": {"int": "1"}}]]}, {"lit": {"int": "2"}}]}, "MATH"]},
               {"write": {"bind": "__lean_returned", "op": {"insert": {"table": "notes", "ifAbsent": false, "fields": [
                   ["id", {"var": "key"}], ["ownerId", "viewer"], ["roomId", {"var": "roomId"}], ["title", {"var": "title"}],
                   ["score", {"lit": {"int": "0"}}], ["done", {"lit": {"bool": false}}]]}}}},
               {"ret": {"var": "__lean_returned"}}])
    );
    assert_eq!(
        body(&m, "rename"),
        json!([{"write": {"bind": null, "op": {"update": {"table": "notes", "key": [["id", {"var": "key"}]], "patch": [["title", {"var": "title"}]],
                   "cond": {"bin": ["eq", {"dot": "done"}, {"lit": {"bool": false}}]}}}}},
               {"write": {"bind": null, "op": {"delete": {"table": "notes", "key": [["id", {"var": "key"}]]}}}},
               {"ret": {"lit": {"bool": true}}}])
    );
}

#[test]
fn cases_tag_inputs_by_declared_type() {
    let m = module(ROOMS);
    let store = m.store(&[("notes".into(), json!({"id": "n1", "ownerId": "alice", "roomId": "r1", "title": "a", "score": 3, "done": false}))]).unwrap();
    assert_eq!(store["notes"], json!([{"id": "n1", "cols": {"ownerId": {"id": "alice"}, "roomId": {"id": "r1"}, "title": {"text": "a"}, "score": {"int": "3"}, "done": {"bool": false}}}]));
    assert_eq!(store["members"], json!([]));
    let args = m.tag_args("page", &json!({"roomId": "r1", "c": null})).unwrap();
    assert_eq!(Value::Object(args.clone()), json!({"roomId": {"id": "r1"}, "c": {"null": null}}));
    let case = m.case("page", store, "alice", args, None).unwrap();
    assert_eq!(case["version"], 1);
    assert_eq!(case["viewer"], "alice");
    // Inputs the model could misjudge are refused, never passed through.
    assert_eq!(m.tag_args("page", &json!({"roomId": "r1", "c": "opaque"})).unwrap_err().reason, "engine-cursor");
    assert_eq!(m.store(&[("notes".into(), json!({"id": "n1", "ownerId": "a", "roomId": "r", "title": "x".repeat(21), "score": 0, "done": false}))]).unwrap_err().reason, "text-bound");
    assert_eq!(m.store(&[("notes".into(), json!({"id": "n1", "ownerId": "a", "roomId": "r", "title": "x", "score": 0, "done": false, "extra": 1}))]).unwrap_err().reason, "row-column");
}

#[test]
fn every_construct_outside_the_fragment_is_named() {
    let base = "table t:\n  owner: principal\n  n: int\n  at: time\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\n";
    for (program, expected) in [
        ("query q():\n  return sum(t where .owner = viewer, .n)\n", "call-sum"),
        ("query q():\n  return now\n", "now"),
        ("mutation m():\n  for row in t where .owner = viewer first 5 by .n:\n    require row.n > 0 else BAD\n  return true\n", "loop"),
        ("query q(xs: [int] <=3):\n  return xs\n", "type-list"),
        ("query q(s: text <=5):\n  return s in ['a', 'b']\n", "binary-operator"),
    ] {
        let source = format!("{base}{program}");
        match lean(&[("schema.q".into(), source.clone())]) {
            Ok(m) => assert_eq!(reason(&m, m.programs.keys().next().unwrap()), expected, "{source}"),
            // A form the checker refuses never reaches the emitter.
            Err(LeanError::Diagnostics(d)) => panic!("fixture does not compile: {source}\n{d:?}"),
            Err(e) => panic!("{e:?}"),
        }
    }
    for (schema, expected) in [
        ("table t:\n  n: int\n  expiresAt: time ?\n  expire at .expiresAt\n  read <- allow\n  online only\n", "table-expiry"),
        ("table t:\n  n: int default 3\n  read <- allow\n  online only\n", "column-default"),
        ("table t:\n  price: money USD\n  read <- allow\n  online only\n", "type-money"),
    ] {
        match lean(&[("schema.q".into(), schema.into())]) {
            Err(LeanError::Unsupported(u)) => assert_eq!(u.reason, expected, "{schema}"),
            other => panic!("{schema}: {other:?}"),
        }
    }
    assert!(matches!(lean(&[("schema.q".into(), "table t:\n  read <- nonsense\n".into())]), Err(LeanError::Diagnostics(_))));
}

#[test]
fn module_json_lists_supported_and_unsupported_programs() {
    let m = module("table t:\n  n: int\n  read <- allow\n  online only\nquery a():\n  return 1\nquery b():\n  return now\n");
    let j = m.to_json();
    assert_eq!(j["programs"]["a"]["body"], json!([{"ret": {"lit": {"int": "1"}}}]));
    assert_eq!(j["unsupported"]["b"]["reason"], "now");
}
