use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::{Bound, compile};
use std::collections::BTreeMap;

fn source(nullable: bool, reverse_unique: bool) -> String {
    let parent = if nullable { "text <=40 ?" } else { "text <=40" };
    let reverse_unique = if reverse_unique {
        "  unique principal, parent\n"
    } else {
        ""
    };
    format!(
        "table members:
  parent: {parent}
  principal: principal
  unique parent, principal
{reverse_unique}  cap 16 by principal
  read <- .principal = viewer
  online only

table documents:
  parent: {parent}
  owner: principal
  at: int
  read <- .owner = viewer or exists members[id = 'm1', parent = .parent, principal = viewer]
  online only

query documents(c: cursor ?):
  return documents last 10 by .at after c

query byId(id: documents):
  return documents[id]
"
    )
}

fn clean(source: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    bound
}

fn row(table: &str, fields: impl IntoIterator<Item = (&'static str, Value)>) -> (String, Value) {
    (table.into(), object(fields))
}

fn id(value: &str) -> Value {
    Value::Id(value.into())
}

fn answers(bound: Bound, rows: Vec<(String, Value)>) -> (Vec<String>, bool) {
    let mut engine = Engine::memory(
        bound.schema,
        bound.programs.into_iter().map(|program| program.program),
    )
    .unwrap();
    engine.seed(rows).unwrap();
    let page = engine
        .query(
            "documents",
            Context::new("alice", BTreeMap::from([("c".into(), Value::Null)])),
        )
        .unwrap();
    let ids = page
        .data
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row.field("id").unwrap().as_str().unwrap().to_owned())
        .collect();
    let point = engine
        .query(
            "byId",
            Context::new("alice", BTreeMap::from([("id".into(), id("shared"))])),
        )
        .unwrap();
    (ids, point.data != Value::Null)
}

fn run(nullable: bool, reverse_unique: bool, exact_member: bool) -> (Vec<String>, bool) {
    let source = source(nullable, reverse_unique);
    let bound = clean(&source);
    let page_program = &bound
        .programs
        .iter()
        .find(|program| program.program.name == "documents")
        .unwrap()
        .program;
    let merge = snapback4_core::ir::body_merges(&page_program.body)
        .into_iter()
        .find(|merge| merge.branches())
        .expect("owner-or-membership branch merge");
    let membership = merge
        .lanes
        .iter()
        .find(|lane| lane.membership())
        .expect("one membership lane");
    assert_eq!(
        merge.lanes.iter().filter(|lane| lane.membership()).count(),
        1,
        "{merge:#?}"
    );
    let source_scan = membership
        .source
        .as_ref()
        .and_then(snapback4_core::ir::LaneSource::scan)
        .unwrap();
    let source_index = &bound.schema.tables["members"].indexes[&source_scan.index];
    if reverse_unique {
        assert_eq!(source_index.columns(), ["principal", "parent"]);
        assert!(
            source_index.unique,
            "the audit must exercise the authored reverse unique"
        );
    } else {
        assert_eq!(source_index.columns(), ["principal", "parent", "id"]);
        assert!(
            !source_index.unique,
            "nullable natural-key ties need the id-bearing discovery index"
        );
    }

    let parent = if nullable {
        Value::Null
    } else {
        Value::String("p1".into())
    };
    let mut rows = vec![
        row(
            "members",
            [
                ("id", id("m0")),
                ("parent", parent.clone()),
                ("principal", id("alice")),
            ],
        ),
        row(
            "documents",
            [
                ("id", id("owned")),
                ("parent", parent.clone()),
                ("owner", id("alice")),
                ("at", Value::Int(1)),
            ],
        ),
        row(
            "documents",
            [
                ("id", id("shared")),
                ("parent", parent.clone()),
                ("owner", id("bob")),
                ("at", Value::Int(2)),
            ],
        ),
    ];
    if exact_member {
        let exact_parent = if nullable {
            Value::Null
        } else {
            Value::String("p1".into())
        };
        if !nullable {
            rows[0] = row(
                "members",
                [
                    ("id", id("m0")),
                    ("parent", Value::String("p0".into())),
                    ("principal", id("alice")),
                ],
            );
        }
        rows.push(row(
            "members",
            [
                ("id", id("m1")),
                ("parent", exact_parent),
                ("principal", id("alice")),
            ],
        ));
    }

    answers(bound, rows)
}

#[test]
fn fixed_membership_id_preserves_nullable_natural_key_authorization() {
    for nullable in [true, false] {
        let (present_page, present_point) = run(nullable, false, true);
        assert_eq!(
            present_page.contains(&"shared".into()),
            present_point,
            "nullable={nullable}, exact m1 present"
        );
        assert!(present_point, "the exact m1 witness authorizes both reads");

        let (missing_page, missing_point) = run(nullable, false, false);
        assert_eq!(
            missing_page.contains(&"shared".into()),
            missing_point,
            "nullable={nullable}, exact m1 missing"
        );
        assert!(!missing_point, "nullable={nullable}");
        assert!(
            present_page.contains(&"owned".into()) && missing_page.contains(&"owned".into()),
            "the owner branch remains readable"
        );
    }
}

#[test]
fn authored_reverse_unique_preserves_nullable_fixed_id_authorization() {
    let (present_page, present_point) = run(true, true, true);
    assert_eq!(present_page.contains(&"shared".into()), present_point);
    assert!(present_point, "the exact m1 witness authorizes both reads");

    let (missing_page, missing_point) = run(true, true, false);
    assert_eq!(missing_page.contains(&"shared".into()), missing_point);
    assert!(
        !missing_point,
        "m0 must not stand in for the fixed m1 witness"
    );
}

#[test]
fn nullable_natural_key_probes_do_not_gain_a_null_membership_lane() {
    let source = source(true, false).replace("id = 'm1', ", "");
    let bound = compile(&[("schema.q".into(), source)]);
    assert!(
        bound
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "E_QUARRY_NULL_KEY"),
        "{:#?}",
        bound.diagnostics
    );
}

#[test]
fn a_fixed_null_natural_key_component_does_not_open_a_required_parent_lane() {
    let source = "table members:
  parent: text <=40
  slot: text <=40 ?
  principal: principal
  unique parent, slot, principal
  cap 16 by principal
  read <- .principal = viewer
  online only

table documents:
  parent: text <=40
  owner: principal
  at: int
  read <- .owner = viewer or exists members[parent = .parent, slot = null, principal = viewer]
  online only

query documents(c: cursor ?):
  return documents last 10 by .at after c

query byId(id: documents):
  return documents[id]
";
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(
        bound
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "E_QUARRY_NULL_KEY"),
        "{:#?}",
        bound.diagnostics
    );
}
