//! Independent payload worlds and structural refusal witnesses for COLR.
// @ref LLP 3000.036#228-exact-admission-and-observation-boundary-round-one-clarification — hidden payloads cannot select observable outcomes.
use snapback4_core::value::object;
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_lang::{Bound, compile};
use std::collections::BTreeMap;

fn clean(source: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(
        bound.diagnostics.is_empty(),
        "{:#?}\n{source}",
        bound.diagnostics
    );
    bound
}
fn context(viewer: &str) -> Context {
    Context::new(viewer, BTreeMap::new()).at(1_800_000_000_000)
}
const SOURCE: &str = r#"
table records:
  owner: principal
  title: text <= 80
  secret: text <= 500 read <- .owner = viewer
  nullable: text <= 80 ? default null
  read (nullable) <- .owner = viewer
  public 'record identity and title are shared'
  insert <- allow
  update <- allow
  online only
query one(id: records):
  return records[id]
query scalar(id: records):
  r = records[id] ! else NOT_FOUND
  return r.secret
query page():
  return records first 20 by .id
query shaped():
  return records first 20 by .id { id, title, secret, nullable }
query total():
  return count(records)
mutation edit(id: records, title: text <= 80):
  return update records[id] { title }
mutation add(title: text <= 80, secret: text <= 500):
  return insert records { owner: 'alice', title, secret }
"#;

fn world(source: &str, secret: &str) -> Engine {
    let b = clean(source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([(
        "records".into(),
        object([
            ("id", Value::Id("r".into())),
            ("owner", Value::Id("alice".into())),
            ("title", Value::String("shared".into())),
            ("secret", Value::String(secret.into())),
            ("nullable", Value::Null),
        ]),
    )])
    .unwrap();
    e
}
fn arg(viewer: &str) -> Context {
    let mut c = context(viewer);
    c.args.insert("id".into(), Value::Id("r".into()));
    c
}

#[test]
fn whole_rows_scalars_shapes_and_mutation_returns_disclose_only_the_allowed_cells() {
    let mut e = world(SOURCE, "secret");
    let allowed = e.query("one", arg("alice")).unwrap();
    assert_eq!(
        allowed.data.field("secret").unwrap(),
        &Value::String("secret".into())
    );
    assert_eq!(allowed.data.field("nullable").unwrap(), &Value::Null);
    let denied = e.query("one", arg("bob")).unwrap();
    assert!(denied.data.field("secret").is_err(), "{denied:?}");
    assert!(denied.data.field("nullable").is_err());
    assert_eq!(
        denied.data.field("title").unwrap(),
        &Value::String("shared".into())
    );
    assert_eq!(e.query("scalar", arg("bob")).unwrap().data, Value::Null);
    let shaped = e.query("shaped", context("bob")).unwrap();
    assert_eq!(
        shaped.data.as_array().unwrap()[0].field("secret").unwrap(),
        &Value::Null
    );
    assert_eq!(
        e.query("total", context("bob")).unwrap().data,
        Value::Int(1)
    );
    let mut c = arg("bob");
    c.args
        .insert("title".into(), Value::String("edited".into()));
    let changed = e.mutate("edit", None, c).unwrap();
    let WriteState::Sent { result, .. } = changed.state else {
        panic!("{changed:?}")
    };
    assert!(result.field("secret").is_err(), "{result:?}");
    assert_eq!(
        e.query("scalar", arg("alice")).unwrap().data,
        Value::String("secret".into())
    );
}

#[test]
fn hidden_payload_length_and_nullness_do_not_change_data_meter_or_dependency_envelopes() {
    let mut short = world(SOURCE, "x");
    let mut long = world(SOURCE, &"\\\"".repeat(200));
    for name in ["one", "scalar", "page", "shaped", "total"] {
        let c = if matches!(name, "one" | "scalar") {
            arg("bob")
        } else {
            context("bob")
        };
        let a = short.query(name, c.clone()).unwrap();
        let b = long.query(name, c).unwrap();
        assert_eq!(
            serde_json::to_value(a).unwrap(),
            serde_json::to_value(b).unwrap(),
            "{name}"
        );
    }
    let mut c = arg("bob");
    c.args.insert("title".into(), Value::String("same".into()));
    assert_eq!(
        serde_json::to_value(short.mutate("edit", None, c.clone()).unwrap()).unwrap(),
        serde_json::to_value(long.mutate("edit", None, c).unwrap()).unwrap()
    );
}

#[test]
fn probe_rules_are_authoritative_and_register_the_witness_even_for_an_empty_read() {
    let source = SOURCE.replace(".owner = viewer", "exists roles[viewer, role = 'staff']")
        + r#"
table roles:
  principal: principal
  role: enum('staff', 'visitor')
  unique principal
  read <- .principal = viewer
  online only
"#;
    let mut e = world(&source, "private");
    assert!(
        e.query("one", arg("alice"))
            .unwrap()
            .data
            .field("secret")
            .is_err()
    );
    e.seed([(
        "roles".into(),
        object([
            ("id", Value::Id("role".into())),
            ("principal", Value::Id("alice".into())),
            ("role", Value::String("staff".into())),
        ]),
    )])
    .unwrap();
    assert_eq!(
        e.query("scalar", arg("alice")).unwrap().data,
        Value::String("private".into())
    );
    let mut empty = arg("bob");
    empty.args.insert("id".into(), Value::Id("missing".into()));
    let read = e.query("one", empty).unwrap();
    assert!(read.tables.iter().any(|t| t == "roles"), "{read:?}");
    assert_eq!(
        clean(&source).schema.operations["one"].runs.as_deref(),
        Some("server")
    );
}

#[test]
fn raw_and_inferred_structural_uses_refuse_before_installation() {
    for clause in [
        "immutable secret",
        "unique secret",
        "by bySecret: secret, id",
        "read (id) <- allow",
        "read (missing) <- allow",
        "read (secret) <- deny",
    ] {
        let source = SOURCE.replace("  online only\n", &format!("  {clause}\n  online only\n"));
        let b = compile(&[("schema.q".into(), source)]);
        assert!(
            b.diagnostics.iter().any(|d| d.code == "E_COLUMN_READ"),
            "{clause}: {:#?}",
            b.diagnostics
        );
    }
    for query in [
        "query leak():\n  return records[secret = 'guess']\n",
        "query leak():\n  return records first 20 by .secret\n",
        "view leak: sum records of .secret by .owner\n",
    ] {
        let b = compile(&[("schema.q".into(), format!("{SOURCE}{query}"))]);
        assert!(!b.diagnostics.is_empty(), "{query}");
    }
    let b = clean(SOURCE);
    let mut raw = b.schema;
    raw.tables.get_mut("records").unwrap().indexes.insert(
        "forged".into(),
        snapback4_core::schema::Index::of(&["secret"], false),
    );
    assert!(Engine::memory(raw, Vec::new()).is_err());
}

#[test]
fn generated_types_capability_and_column_invariant_use_effective_payload_authority() {
    let b = clean(&(SOURCE.to_owned() + "invariant records.secret read only .owner = viewer\n"));
    let ts = snapback4_lang::emit::typescript(&b);
    assert!(ts.contains("secret?: string"), "{ts}");
    assert!(b.schema.required_capabilities().contains("column-read-v1"));
    let report = snapback4_lang::security::analyze(&b);
    assert_eq!(
        report.invariants[0].direct_rule,
        snapback4_lang::security::Status::Proved
    );
    let json = serde_json::to_string(&report).unwrap();
    assert!(json.contains("secret"));
    assert!(
        report
            .exposures
            .iter()
            .any(|e| e.column_audiences["secret"].contains("owner"))
    );
}

#[test]
fn existing_column_rules_adopt_normally_and_new_cells_go_dormant_without_hiding_rows() {
    let mut e = world(SOURCE, "survives");
    let start = clean(SOURCE);
    e.adopt_release_at(
        start.schema,
        start.programs.into_iter().map(|p| p.program),
        &snapback4_core::engine::release::ReleaseActivation::new(1, None),
        true,
        1_800_000_000_000,
    )
    .unwrap();
    let before = clean(
        &SOURCE
            .replace(" read <- .owner = viewer", "")
            .replace("  read (nullable) <- .owner = viewer\n", ""),
    );
    e.adopt_at(
        before.schema,
        before.programs.into_iter().map(|p| p.program),
        1_800_000_000_000,
    )
    .unwrap();
    assert_eq!(
        e.query("scalar", arg("bob")).unwrap().data,
        Value::String("survives".into())
    );
    let protected = clean(SOURCE);
    e.adopt_at(
        protected.schema,
        protected.programs.into_iter().map(|p| p.program),
        1_800_000_000_000,
    )
    .unwrap();
    assert_eq!(e.query("scalar", arg("bob")).unwrap().data, Value::Null);
    let v1 = clean(
        "table records:\n  owner: principal\n  title: text <= 80\n  public\n  online only\nquery one(id: records):\n  return records[id]\n",
    );
    e.adopt_at(
        v1.schema,
        v1.programs.into_iter().map(|p| p.program),
        1_800_000_000_000,
    )
    .unwrap();
    let old = e.query("one", arg("bob")).unwrap().data;
    assert_eq!(old.field("id").unwrap(), &Value::Id("r".into()));
    assert!(old.field("secret").is_err());
    let v2 = clean(SOURCE);
    let mut forward = snapback4_core::engine::release::ReleaseActivation::new(2, Some(1));
    forward.restore_dormant = true;
    e.adopt_release_at(
        v2.schema,
        v2.programs.into_iter().map(|p| p.program),
        &forward,
        true,
        1_800_000_000_000,
    )
    .unwrap();
    assert_eq!(
        e.query("scalar", arg("alice")).unwrap().data,
        Value::String("survives".into())
    );
}

#[test]
fn a_column_rule_does_not_change_captured_parent_identity() {
    let source = "table parents:\n  owner: principal\n  immutable owner\n  read <- .owner = viewer\n  online only\ntable children:\n  parent: parents\n  body: text <= 80\n  immutable parent\n  read through .parent\n  online only\nquery child(id: children):\n  return children[id]\n";
    let b = clean(source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([
        (
            "parents".into(),
            object([
                ("id", Value::Id("p".into())),
                ("owner", Value::Id("alice".into())),
            ]),
        ),
        (
            "children".into(),
            object([
                ("id", Value::Id("r".into())),
                ("parent", Value::Id("p".into())),
                ("body", Value::String("private".into())),
            ]),
        ),
    ])
    .unwrap();
    let next = clean(&source.replace("body: text <= 80", "body: text <= 80 read <- deny"));
    e.adopt_at(
        next.schema,
        next.programs.into_iter().map(|p| p.program),
        1_800_000_000_000,
    )
    .unwrap();
    let result = e.query("child", arg("alice")).unwrap();
    assert!(result.data.field("body").is_err());
    assert!(result.data.field("id").is_ok());
}

#[test]
fn protected_asset_downloads_and_equal_or_unequal_blind_assignments_share_the_denial() {
    let source = r#"table docs:
  owner: principal
  document: file <=1000 ('application/pdf') read <- .owner = viewer
  public
  insert <- allow
  update <- allow
  online only
mutation add(document: file <=1000 ('application/pdf')):
  return insert docs { owner: viewer, document }
mutation patch(id: docs, document: file <=1000 ('application/pdf')):
  return update docs[id] { document }
"#;
    let b = clean(source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let a = e
        .store_file(
            "alice",
            b"%PDF-1.7\n%%EOF\n",
            Some("application/pdf"),
            "private.pdf",
            1_800_000_000_000,
        )
        .unwrap();
    let b = e
        .store_file(
            "alice",
            b"%PDF-1.7\n%%EOF\n",
            Some("application/pdf"),
            "other.pdf",
            1_800_000_000_000,
        )
        .unwrap();
    let mut c = context("alice");
    c.args.insert("document".into(), a.column_value());
    let WriteState::Sent { result, .. } = e.mutate("add", None, c).unwrap().state else {
        panic!("insert failed")
    };
    let id = result.field("id").unwrap().clone();
    assert!(e.asset_access("alice", &a.id, 1_800_000_000_000).is_ok());
    for range in [false, true] {
        assert_eq!(
            e.asset_access_request("bob", &a.id, 1_800_000_000_000, range)
                .unwrap_err()
                .code(),
            "E_ASSET_UNKNOWN"
        );
    }
    let mut outcomes = Vec::new();
    for next in [None, Some(&b)] {
        if let Some(next) = next {
            let mut c = Context::system().at(1_800_000_000_000);
            c.args.insert("id".into(), id.clone());
            c.args.insert("document".into(), next.column_value());
            assert!(matches!(
                e.mutate("patch", None, c).unwrap().state,
                WriteState::Sent { .. }
            ));
        }
        let mut c = context("bob");
        c.args.insert("id".into(), id.clone());
        c.args
            .insert("document".into(), Value::Map(BTreeMap::from([("id".into(), Value::Id(a.id.clone()))]).into()));
        let outcome = e.mutate("patch", None, c).unwrap();
        let WriteState::Failed { why, .. } = &outcome.state else {
            panic!("{outcome:?}")
        };
        assert_eq!(why.code, "E_ASSET_UNKNOWN");
        outcomes.push(serde_json::to_value(outcome).unwrap());
    }
    assert_eq!(outcomes[0], outcomes[1]);
}
