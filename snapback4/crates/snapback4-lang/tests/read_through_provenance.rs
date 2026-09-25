//! Fallback identities come from authorized source rows, never their projection.
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, Value, meter::Ceilings, value::object, wire};

const SOURCE: &str = r#"table docs:
  owner: principal
  body: text <=40
  immutable owner
  read <- .owner = viewer
  sync

table other:
  body: text <=40
  public

table children:
  parent: docs
  immutable parent
  read through .parent
  retain delivered-history
  sync

query point():
  docs['x']
query page():
  docs where .owner = viewer first 10 by .id {body}
query shaped():
  docs['x'] {id: 'projected', body}
query spread():
  a = docs['x'] ! else MISSING
  return {...a, body: 'projected'}
query same():
  a = docs['x'] ! else MISSING
  return {...a, ...a}
query ambiguous():
  a = docs['x'] ! else MISSING
  b = other['x'] ! else MISSING
  return {...a, ...b}
query nested():
  return {row: docs['x'] {body}}
query equality():
  a = docs['x'] {body}
  b = other['x'] {body}
  return a = b
"#;

fn engine() -> Engine {
    let b = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed(vec![
        (
            "docs".into(),
            object([
                ("id", Value::Id("x".into())),
                ("owner", Value::Id("alice".into())),
                ("body", Value::String("same".into())),
            ]),
        ),
        (
            "other".into(),
            object([
                ("id", Value::Id("x".into())),
                ("body", Value::String("same".into())),
            ]),
        ),
    ])
    .unwrap();
    e
}
fn mask(data: &Value) -> Json {
    wire::to_json(&data.retained_rows_mask())
}
fn context(viewer: &str, provenance: bool) -> Context {
    let context = Context::new(viewer, Default::default()).at(100);
    if provenance {
        context.with_row_provenance()
    } else {
        context
    }
}

#[test]
fn source_identity_survives_shapes_and_agreeing_spreads_without_changing_values() {
    let mut e = engine();
    for name in [
        "point",
        "page",
        "shaped",
        "spread",
        "same",
        "ambiguous",
        "nested",
        "equality",
    ] {
        let plain = e.query(name, context("alice", false)).unwrap();
        let with = e.query(name, context("alice", true)).unwrap();
        assert!(
            plain.complete && with.complete && !plain.unavailable && !with.unavailable,
            "{name}: {plain:?} / {with:?}"
        );
        assert_eq!(
            plain.data, with.data,
            "metadata cannot change Quarry equality: {name}"
        );
        assert_eq!(wire::to_json(&plain.data), wire::to_json(&with.data));
        let provenance = mask(&with.data);
        match name {
            "page" => assert_eq!(provenance[0]["source"], json!(["docs", "x"])),
            "nested" => {
                assert_eq!(provenance["source"], Json::Null);
                assert_eq!(provenance["fields"]["row"]["source"], json!(["docs", "x"]));
            }
            "ambiguous" => assert_eq!(
                provenance["source"],
                Json::Null,
                "two tables sharing an ID are not one source"
            ),
            "equality" => assert_eq!(with.data, Value::Bool(true)),
            _ => assert_eq!(
                provenance["source"],
                json!(["docs", "x"]),
                "{name}: {provenance}"
            ),
        }
        if name == "shaped" {
            assert_eq!(
                with.data.field("id").unwrap(),
                &Value::String("projected".into())
            );
        }
        // Durable/application decoding carries data only, not engine provenance.
        let decoded: Value =
            serde_json::from_str(&serde_json::to_string(&with.data).unwrap()).unwrap();
        assert_eq!(mask(&decoded), mask(&plain.data));
    }
}

#[test]
fn denied_rows_have_no_identity_and_envelopes_pay_output_and_heap() {
    let mut e = engine();
    for name in ["point", "page", "shaped", "nested"] {
        let hidden = e.query(name, context("bob", true)).unwrap();
        assert!(hidden.complete && !hidden.unavailable, "{name}: {hidden:?}");
        let provenance = mask(&hidden.data);
        assert!(
            !provenance.to_string().contains("docs"),
            "hidden identity: {provenance}"
        );
    }
    let plain = e.query("point", context("alice", false)).unwrap();
    let with = e.query("point", context("alice", true)).unwrap();
    assert!(with.metered.output_bytes > plain.metered.output_bytes);
    assert!(with.metered.heap_bytes > plain.metered.heap_bytes);
    assert!(with.metered.steps > plain.metered.steps);
    e.set_ceilings(Ceilings {
        output_bytes: plain.metered.output_bytes,
        ..Ceilings::default()
    });
    assert!(e.query("point", context("alice", false)).unwrap().complete);
    assert_eq!(
        e.query("point", context("alice", true)).unwrap_err().code,
        "E_BOUND"
    );
    e.set_ceilings(Ceilings {
        heap_bytes: with.metered.heap_bytes - 1,
        ..Ceilings::default()
    });
    assert_eq!(
        e.query("point", context("alice", true)).unwrap_err().code,
        "E_BOUND"
    );
}
