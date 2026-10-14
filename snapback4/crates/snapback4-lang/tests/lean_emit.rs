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
  cap 16 by principal
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
    assert_eq!(members["read"], json!({"probe": {"table": "members", "point": ["roomId", "principal"], "key": [["roomId", {"col": ["self", "roomId"]}], ["principal", "viewer"]]}}));
    // An unnamed update rule judges both images (OPEN R2).
    assert_eq!(members["update"], json!({"and": [{"eq": [{"col": ["old", "principal"]}, "viewer"]}, {"eq": [{"col": ["next", "principal"]}, "viewer"]}]}));
    // Omitted rules deny; uniques carry their `else` code.
    assert_eq!(members["delete"], json!("deny"));
    assert_eq!(members["uniques"], json!([["roomId", "principal"]]));
    assert_eq!(members["uniqueCodes"], json!(["MEMBER_EXISTS"]));
    assert_eq!(members["caps"], json!([{"by": ["principal"], "max": 16}]));
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
            // `exists t[key]` is the point read compared with null (`Syntax.lean`).
            ["here", {"bin": ["ne", {"point": {"table": "members", "key": [["roomId", {"var": "roomId"}], ["principal", "viewer"]]}}, {"lit": {"null": null}}]}],
            ["count", {"count": {"table": "members", "pins": [["roomId", {"var": "roomId"}]], "filter": null}}]]}}])
    );
}

/// LLP 3000.036 §12.1, §15.4 and §15.12: a readable grant is translated (the
/// model decides it per caller), a returned page's row-independent `where`
/// test is the compiler's `if`, and a search `exists` is the model's `exists`.
const CONSOLE: &str = "table staff:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
table tickets:
  owner: principal
  open: bool
  read <- .owner = viewer or exists staff[viewer]
  online only
query guarded(c: cursor ?):
  return tickets where exists staff[viewer] and .open = true first 5 by .id after c
query either(c: cursor ?):
  return tickets where .open = true or exists staff[viewer] first 5 by .id after c
query anyOpen():
  return exists tickets where .open = true
query presence(o: bool ?, c: cursor ?):
  return tickets where (o = null or .open = o) and exists staff[viewer] first 5 by .id after c
";

#[test]
fn grants_guards_and_search_exists() {
    let m = module(CONSOLE);
    assert_eq!(table(&m, "tickets")["read"], json!({"or": [{"eq": [{"col": ["self", "owner"]}, "viewer"]}, {"probe": {"table": "staff", "point": ["principal"], "key": [["principal", "viewer"]]}}]}));
    let staff = json!({"bin": ["ne", {"point": {"table": "staff", "key": [["principal", "viewer"]]}}, {"lit": {"null": null}}]});
    let page = |pins: Value| json!({"page": {"table": "tickets", "pins": pins, "filter": null, "order": [], "desc": false, "take": 5, "after": {"var": "c"}}});
    let open = json!([["open", {"lit": {"bool": true}}]]);
    assert_eq!(body(&m, "guarded"), json!([{"ite": [staff.clone(), [{"ret": page(open.clone())}], [{"ret": {"arr": []}}]]}]));
    assert_eq!(body(&m, "either"), json!([{"ite": [staff, [{"ret": page(json!([]))}], [{"ret": page(open.clone())}]]}]));
    assert_eq!(body(&m, "anyOpen"), json!([{"ret": {"exists": {"table": "tickets", "pins": open, "filter": null}}}]));
    // Presence variants expand first in the compiler; that pair is not translated.
    assert_eq!(reason(&m, "presence"), "where-guard-presence");
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
fn expiry_is_emitted_as_a_modeled_table_lifecycle() {
    let source = "table t:\n  n: int\n  expiresAt: time ?\n  expire at .expiresAt\n  read <- allow\n  online only\nquery witness():\n  return 1\n";
    let m = module(source);
    assert_eq!(table(&m, "t")["expire"], "expiresAt");
    let case = m.case_at_sweep("witness", m.store(&[]).unwrap(), "alice", Default::default(), None, 10, true).unwrap();
    assert_eq!(case["sweep"], true);
}

#[test]
fn module_json_lists_supported_and_unsupported_programs() {
    let m = module("table t:\n  n: int\n  read <- allow\n  online only\nquery a():\n  return 1\nquery b():\n  return now\n");
    let j = m.to_json();
    assert_eq!(j["programs"]["a"]["body"], json!([{"ret": {"lit": {"int": "1"}}}]));
    assert_eq!(j["unsupported"]["b"]["reason"], "now");
}

#[test]
fn nonportable_membership_page_keys_are_unsupported_before_the_oracle() {
    let source = |bound| format!("table memberships:
  parent: text <={bound}
  principal: principal
  unique parent, principal
  cap 16 by principal
  read <- .principal = viewer
  online only
table documents:
  owner: principal
  parent: text <={bound}
  at: int
  read <- .owner = viewer or exists memberships[.parent, viewer]
  online only
query documents(c: cursor ?):
  return documents last 2 by .at after c
");
    assert!(module(&source(40)).program("documents").is_ok());
    assert_eq!(reason(&module(&source(435)), "documents"), "page-membership-key-bound");

    // The authored one-row source index carries only `principal`; wide fixed
    // equalities remain residuals and do not make that physical key oversized.
    let one_row_residual = "table memberships:\n  parent: text <=40 ?\n  slot: text <=435 ?\n  principal: principal\n  unique principal\n  cap 16 by principal\n  read <- .principal = viewer\n  online only\ntable documents:\n  owner: principal\n  parent: text <=40 ?\n  at: int\n  read <- .owner = viewer or exists memberships[parent = .parent, slot = 'member', principal = viewer]\n  online only\nquery documents(c: cursor ?):\n  return documents last 2 by .at after c\n";
    assert!(module(one_row_residual).program("documents").is_ok());

    // A shorter one-row index that omits the cap/read pin is ineligible. The
    // ordinary synthesized discovery key remains the physical source.
    let inadmissible_one_row = one_row_residual
        .replace("slot: text <=435 ?", "slot: text <=40")
        .replace("unique principal", "unique slot");
    assert!(module(&inadmissible_one_row).program("documents").is_ok());
}

#[test]
fn set_null_cap_cannot_admit_membership_discovery_to_the_model() {
    let source = "table parents:\n  read <- allow\n  delete <- allow\ntable documents:\n  home: parents\n  read <- exists members[folder = .home, document = .id]\n  online only\ntable members:\n  folder: parents ? on delete set null\n  document: documents\n  unique folder, document\n  cap 5 by folder\n  read <- allow\n  online only\nquery documents(c: cursor ?):\n  return documents first 2 by .id after c\n";
    let Err(LeanError::Diagnostics(diagnostics)) = lean(&[("schema.q".into(), source.into())]) else {
        panic!("set-null cap must fail before Lean membership classification")
    };
    assert!(diagnostics.iter().any(|diagnostic| diagnostic.starts_with("E_REFERENCE_ACTION:")), "{diagnostics:#?}");
}

#[test]
fn reordered_named_membership_key_emits_the_same_page_fragment() {
    let source = |probe| format!("table memberships:
  parent: text <=40
  principal: principal
  unique parent, principal
  cap 16 by principal
  read <- .principal = viewer
  online only
table documents:
  owner: principal
  parent: text <=40
  at: int
  read <- .owner = viewer or exists memberships[{probe}]
  online only
query documents(c: cursor ?):
  return documents last 2 by .at after c
");
    let positional = module(&source(".parent, viewer"));
    let named = module(&source("principal = viewer, parent = .parent"));
    assert_eq!(body(&named, "documents"), body(&positional, "documents"));
}

#[test]
fn membership_page_gate_prices_filter_pins_and_synthesized_labels() {
    let filtered = |folder_bound| format!("table memberships:
  parent: text <=100
  principal: principal
  unique parent, principal
  cap 16 by principal
  read <- .principal = viewer
  online only
table documents:
  owner: principal
  parent: text <=100
  folder: text <={folder_bound}
  at: int
  read <- .owner = viewer or exists memberships[.parent, viewer]
  online only
query documents(folder: text <={folder_bound}, c: cursor ?):
  return documents where .folder = folder last 2 by .at after c
");
    assert!(module(&filtered(300)).program("documents").is_ok());
    assert_eq!(reason(&module(&filtered(400)), "documents"), "page-membership-key-bound");

    let owner = "o".repeat(480);
    let long_label = format!("table memberships:
  parent: text <=40
  principal: principal
  unique parent, principal
  cap 16 by principal
  read <- .principal = viewer
  online only
table documents:
  {owner}: principal
  parent: text <=40
  at: int
  read <- .{owner} = viewer or exists memberships[.parent, viewer]
  online only
query documents(c: cursor ?):
  return documents last 2 by .at after c
");
    assert_eq!(reason(&module(&long_label), "documents"), "page-membership-key-bound");
}

#[test]
fn live_reference_predicate_emits_an_authorized_point_read_before_the_field() {
    let m = module("table tags:\n  rank: int\n  read <- allow\n  online only\ntable items:\n  tag: tags\n  read <- allow\n  online only\nquery q():\n  return items where .tag.rank = 1 first 2 by .id\n");
    let b = body(&m, "q");
    assert_eq!(b[0]["ret"]["page"]["filter"], json!({"bin":["eq",{"field":[{"point":{"table":"tags","key":[["id",{"dot":"tag"}]]}},"rank"]},{"lit":{"int":"1"}}]}));
}

#[test]
fn a_helper_reference_with_unknown_return_type_is_named_unsupported() {
    let m = module("table tags:\n  rank: int\n  read <- allow\n  online only\nfn same(x: tags): x\nquery q(t: tags):\n  return same(t).rank\n");
    assert_eq!(reason(&m, "q"), "member-type");
}

#[test]
fn page3_four_variant_non_null_enum_is_named_unsupported_at_schema_translation() {
    let source = "table docs:\n  owner: principal\n  species: enum('a', 'b', 'c', 'd') ?\n  at: int\n  read <- .owner = viewer or .species != null\n  online only\nquery docs(c: cursor ?):\n  return docs where .species != null first 1 by .at after c\n";
    let Err(LeanError::Unsupported(unsupported)) = lean(&[("schema.q".into(), source.into())]) else { panic!("enum must not be certified Supported") };
    assert_eq!(unsupported.reason, "type-enum");
}
#[test]
fn page3_null_exempt_cap_cannot_supply_an_implicit_model_page() {
    let source = "table groups:\n  public\n  online only\ntable docs:\n  group: groups ? on delete set null\n  owner: principal\n  helper: principal\n  cap 5 by group\n  read <- .owner = viewer or .helper = viewer\n  online only\nquery docs(g: groups ?):\n  return docs where .group = g\n";
    let Err(LeanError::Diagnostics(diagnostics)) = lean(&[("schema.q".into(), source.into())]) else { panic!("checked path must reject the set-null cap") };
    assert!(diagnostics.iter().any(|diagnostic| diagnostic.starts_with("E_REFERENCE_ACTION:") || diagnostic.starts_with("E_QUARRY_BOUND:")), "{diagnostics:?}");
    let (document, errors) = snapback4_lang::parse_document("schema.q", source);
    assert!(errors.is_empty());
    let unchecked = snapback4_lang::emit::lean::from_documents(&[document]).unwrap();
    assert_eq!(unchecked.program("docs").unwrap_err().reason, "read-unbounded");
}

#[test]
fn contextual_reference_projection_is_independent_and_unresolved_helpers_are_named(){
 let source="table parents:\n  name: text <=20\n  public\n  insert <- allow\ntable kids:\n  parent: parents on delete keep\n  public\n  insert <- allow\nmutation add(id: id):\n  parent = insert parents {id,name:'parent'}\n  insert kids {id:'child',parent}\n  return parent.id\n";
 let implicit=body(&module(source),"add");
 let explicit=body(&module(&source.replace("id:'child',parent}","id:'child',parent:parent.id}")),"add");
 assert_eq!(implicit,explicit);
 let helper=source.replace("mutation add(id: id):","fn same(p: parents): p\nmutation add(id: id):").replace("id:'child',parent}","id:'child',parent:same(parent)}");
 assert_eq!(reason(&module(&helper),"add"),"reference-expression-type");
}
