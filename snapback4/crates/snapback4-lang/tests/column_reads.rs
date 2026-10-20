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
    short
        .seed([(
            "records".into(),
            object([("id", Value::Id("r".into())), ("nullable", Value::Null)]),
        )])
        .unwrap();
    long.seed([(
        "records".into(),
        object([
            ("id", Value::Id("r".into())),
            ("nullable", Value::String("private contact".into())),
        ]),
    )])
    .unwrap();
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
        c.args.insert(
            "document".into(),
            Value::Map(BTreeMap::from([("id".into(), Value::Id(a.id.clone()))]).into()),
        );
        let outcome = e.mutate("patch", None, c).unwrap();
        let WriteState::Failed { why, .. } = &outcome.state else {
            panic!("{outcome:?}")
        };
        assert_eq!(why.code, "E_ASSET_UNKNOWN");
        outcomes.push(serde_json::to_value(outcome).unwrap());
    }
    assert_eq!(outcomes[0], outcomes[1]);
}

#[test]
fn insert_and_insert_if_absent_bindings_never_expose_denied_cells() {
    let source = r#"table records:
  owner: principal
  title: text <=80
  secret: text <=80 read <- deny
  grouped: text <=80 default 'private default'
  read (grouped) <- deny
  unique title
  public
  insert <- allow
  online only
mutation add(title: text <=80, secret: text <=80):
  return insert records { owner: viewer, title, secret }
mutation once(title: text <=80, secret: text <=80):
  r = insert records { owner: viewer, title, secret } if absent
  return r
mutation scalar(title: text <=80, secret: text <=80):
  r = insert records { owner: viewer, title, secret }
  return r.secret
"#;
    let b = clean(source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    for (n, name) in ["add", "once", "scalar"].into_iter().enumerate() {
        let mut c = context("alice");
        c.args
            .insert("title".into(), Value::String(format!("{name}-{n}")));
        c.args.insert(
            "secret".into(),
            Value::String("supplied private value".into()),
        );
        let out = e.mutate(name, None, c).unwrap();
        let WriteState::Sent { result, .. } = out.state else {
            panic!("{out:?}")
        };
        if name == "scalar" {
            assert_eq!(result, Value::Null);
        } else {
            assert!(result.field("id").is_ok());
            assert!(result.field("secret").is_err(), "{name}: {result:?}");
            assert!(result.field("grouped").is_err(), "{name}: {result:?}");
        }
    }
}

#[test]
fn extrema_keep_optional_accessors_for_denied_and_mixed_audience_rows() {
    let source = r#"table records:
  owner: principal
  secret: int read <- .owner = viewer
  public
  online only
query page():
  rows = records first 20 by .id
  return { min: min(rows, .secret), max: max(rows, .secret), sum: sum(rows, .secret ?? 0), count: count(rows) }
query domain():
  return { min: min(records, .secret), max: max(records, .secret) }
"#;
    let b = clean(source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([
        (
            "records".into(),
            object([
                ("id", Value::Id("a".into())),
                ("owner", Value::Id("alice".into())),
                ("secret", Value::Int(7)),
            ]),
        ),
        (
            "records".into(),
            object([
                ("id", Value::Id("b".into())),
                ("owner", Value::Id("alice".into())),
                ("secret", Value::Int(-2)),
            ]),
        ),
        (
            "records".into(),
            object([
                ("id", Value::Id("c".into())),
                ("owner", Value::Id("bob".into())),
                ("secret", Value::Int(1000)),
            ]),
        ),
    ])
    .unwrap();
    for op in ["page", "domain"] {
        let a = e.query(op, context("alice")).unwrap();
        assert!(a.complete, "{a:?}");
        assert_eq!(a.data.field("min").unwrap(), &Value::Int(-2));
        assert_eq!(a.data.field("max").unwrap(), &Value::Int(7));
        let none = e.query(op, context("outsider")).unwrap();
        assert!(none.complete, "{none:?}");
        assert_eq!(none.data.field("min").unwrap(), &Value::Null);
        assert_eq!(none.data.field("max").unwrap(), &Value::Null);
        if op == "page" {
            assert_eq!(a.data.field("sum").unwrap(), &Value::Int(5));
            assert_eq!(none.data.field("count").unwrap(), &Value::Int(3));
        }
    }
}

#[test]
fn spreads_preserve_absent_cells_and_explicit_nulls_including_nested_overrides() {
    let source = format!("{SOURCE}\nquery spread(id: records):\n  r = records[id] ! else NOT_FOUND\n  s = {{ ...r, title: 'override' }}\n  return {{ ...s }}\nquery spreadScalar(id: records):\n  r = records[id] ! else NOT_FOUND\n  s = {{ ...r }}\n  return s.secret\n");
    let mut e = world(&source, "private");
    let hidden = e.query("spread", arg("bob")).unwrap().data;
    assert!(hidden.field("secret").is_err() && hidden.field("nullable").is_err());
    assert_eq!(hidden.field("title").unwrap(), &Value::String("override".into()));
    let allowed = e.query("spread", arg("alice")).unwrap().data;
    assert_eq!(allowed.field("secret").unwrap(), &Value::String("private".into()));
    assert_eq!(allowed.field("nullable").unwrap(), &Value::Null);
    assert_eq!(e.query("spreadScalar", arg("bob")).unwrap().data, Value::Null);
    let native = snapback4_lang::emit::rust(&clean(&source));
    assert!(native.contains("pub secret: Option<String>"), "{native}");
    assert!(native.contains("#[serde(default)]\n    pub secret:"));
}

#[test]
fn generated_native_rows_decode_audience_omissions() {
    use std::{fs, process::Command};
    // Reference the dependency so Cargo supplies its rlib to this test's deps directory.
    let _: snapback4_native::Row = Default::default();
    let deps = std::env::current_exe().unwrap().parent().unwrap().to_owned();
    let native = fs::read_dir(&deps).unwrap().filter_map(Result::ok).map(|e| e.path())
        .find(|p| p.file_name().unwrap().to_string_lossy().starts_with("libsnapback4_native-") && p.extension().is_some_and(|e| e == "rlib")).unwrap();
    let scratch = std::env::temp_dir().join(format!("colr-native-{}",std::process::id()));
    struct Cleanup(std::path::PathBuf);
    impl Drop for Cleanup { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    fs::create_dir_all(&scratch).unwrap(); let _cleanup = Cleanup(scratch.clone());
    let native_source = SOURCE.replace("  title: text <= 80", "  title: text <= 80\n  entries: count entries by record") + "\ntable entries:\n  record: records\n  public 'entries are shared'\n  online only\n";
    let generated = snapback4_lang::emit::rust(&clean(&native_source));
    let code = format!("{generated}\nfn main() {{ let r: Records = snapback4_native::from_row(snapback4_native::json!({{\"id\":\"r\",\"owner\":\"alice\",\"title\":\"shared\",\"entries\":0}}).as_object().unwrap().clone()).unwrap(); assert_eq!(r.secret,None); assert_eq!(r.nullable,None); let w: RecordsWrite = snapback4_native::from_row(snapback4_native::json!({{\"id\":\"r\",\"owner\":\"alice\",\"title\":\"shared\"}}).as_object().unwrap().clone()).unwrap(); assert_eq!(w.secret,None); assert_eq!(w.nullable,None); }}");
    fs::write(scratch.join("main.rs"),code).unwrap();
    let output = Command::new("rustc").args(["--edition=2024","--crate-name","colr_native"])
        .arg(scratch.join("main.rs")).arg("--extern").arg(format!("snapback4_native={}",native.display()))
        .arg("-L").arg(format!("dependency={}",deps.display())).arg("-o").arg(scratch.join("check")).output().unwrap();
    assert!(output.status.success(),"{}",String::from_utf8_lossy(&output.stderr));
    assert!(Command::new(scratch.join("check")).status().unwrap().success());
}

#[test]
fn absent_spread_properties_preserve_prior_values_and_destination_defaults() {
    let source = format!("{SOURCE}\nquery fallback(id: records):\n  r = records[id] ! else NOT_FOUND\n  return {{ secret: 'fallback', nullable: 'earlier', ...r }}\ntable copies:\n  owner: principal\n  title: text <=80\n  secret: text <=500 ? default 'destination default'\n  nullable: text <=80 ? default 'nullable default'\n  public 'explicit copies'\n  insert <- allow\n  online only\nmutation copy(id: records, newId: id):\n  r = records[id] ! else NOT_FOUND\n  return insert copies {{ ...r, id: newId }}\n");
    let mut e = world(&source,"private");
    let fallback = e.query("fallback",arg("bob")).unwrap().data;
    assert_eq!(fallback.field("secret").unwrap(),&Value::String("fallback".into()));
    assert_eq!(fallback.field("nullable").unwrap(),&Value::String("earlier".into()));
    let allowed = e.query("fallback",arg("alice")).unwrap().data;
    assert_eq!(allowed.field("secret").unwrap(),&Value::String("private".into()));
    assert_eq!(allowed.field("nullable").unwrap(),&Value::Null);
    for viewer in ["alice","bob"] {
        let mut c=arg(viewer);c.args.insert("newId".into(),Value::Id(format!("copy-{viewer}")));
        let WriteState::Sent {result,..}=e.mutate("copy",None,c).unwrap().state else {panic!("copy failed")};
        assert_eq!(result.field("secret").unwrap(),&Value::String(if viewer=="alice" {"private"} else {"destination default"}.into()));
        assert_eq!(result.field("nullable").unwrap(),&if viewer=="alice" {Value::Null} else {Value::String("nullable default".into())});
    }
}

#[test]
fn protected_insert_bindings_project_completed_captured_parent_authority() {
    let source="table parents:\n  owner: principal\n  immutable owner\n  read <- .owner = viewer\n  insert <- allow\n  online only\ntable children:\n  parent: parents\n  body: text <=80 read <- allow\n  entries: count childEntries by child\n  immutable parent\n  read through .parent\n  insert <- allow\n  online only\ntable childEntries:\n  child: children\n  public 'shared entries'\n  online only\nmutation add():\n  insert parents { id: 'p', owner: viewer }\n  return insert children { parent: 'p', body: 'authorized' }\nmutation maybe():\n  return insert children { id: 'fixed', parent: 'p', body: 'authorized' } if absent\n";
    let b=clean(source);let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    for op in ["add","maybe"] {
        let WriteState::Sent {result,..}=e.mutate(op,None,context("alice")).unwrap().state else {panic!("insert failed")};
        assert_eq!(result.field("body").unwrap(),&Value::String("authorized".into()));
        assert!(!serde_json::to_string(&result).unwrap().contains("$capture"));
        assert!(result.field("entries").is_err(), "write results omit maintained fields");
    }
}

#[test]
fn ordinary_nullable_probe_keys_keep_the_existing_complete_page_proof() {
    let source = r#"table items:
  owner: principal
  bucket: int
  read <- .owner = viewer or exists access[.bucket, viewer]
  insert <- .owner = viewer or exists access[.bucket, viewer]
  update <- .owner = viewer or exists access[.bucket, viewer]
  delete <- .owner = viewer or exists access[.bucket, viewer]
  online only

table access:
  bucket: int ?
  principal: principal
  unique byMember: bucket, principal
  unique byPrincipalOnly: principal
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where true last 1 by .id after c
"#;
    let b=clean(source);let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let mut c=context("bob");
    for (key,value) in [("key",Value::Id("missing".into())),("bucket",Value::Int(0)),("c",Value::Null),("n",Value::Null),("a",Value::Int(0)),("b",Value::Int(0))] { c.args.insert(key.into(),value); }
    let result=e.query("run",c).unwrap();
    assert!(result.complete,"{result:?}");
    assert_eq!(result.data.as_array().unwrap().len(),0);
}

#[test]
fn authorized_blind_inserts_commit_with_null_audience_results() {
    let source="table records:\n  owner: principal\n  secret: text <=80 read <- deny\n  read <- .owner = viewer\n  insert <- allow\n  online only\nmutation add(id: id):\n  return insert records { id, owner: 'alice', secret: 'supplied' }\nmutation maybe(id: id):\n  return insert records { id, owner: 'alice', secret: 'supplied' } if absent\n";
    let b=clean(source);let ts=snapback4_lang::emit::typescript(&b);
    assert!(ts.contains("null"),"{ts}");
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    for (viewer,op,id) in [("bob","add","b"),("bob","maybe","m"),("alice","add","a")] {
        let mut c=context(viewer);c.args.insert("id".into(),Value::Id(id.into()));
        let WriteState::Sent {result,..}=e.mutate(op,None,c).unwrap().state else {panic!("insert did not commit")};
        if viewer=="bob" { assert_eq!(result,Value::Null); }
        else { assert_eq!(result.field("id").unwrap(),&Value::Id(id.into()));assert!(result.field("secret").is_err()); }
    }
    assert_eq!(e.store().rows("records").unwrap().len(),3);
}

// @ref LLP 3000.015#2-sequence-by — insert-only principals cannot allocate hidden sequence counters.
#[test]
fn column_rules_preserve_the_preexisting_sequence_allocation_read_guard() {
    let source="table counterScopes:\n  public 'counter scopes'\n  online only\ntable records:\n  owner: principal\n  scope: counterScopes\n  ordinal: sequence by scope\n  secret: text <=80 read <- deny\n  read <- .owner = viewer\n  insert <- allow\n  online only\nmutation add(id: id):\n  return insert records { id, scope: 'scope', owner: 'alice', secret: 'supplied' }\nmutation discard(id: id):\n  insert records { id, scope: 'scope', owner: 'alice', secret: 'supplied' }\n";
    let b=clean(source);let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    e.seed([("counterScopes".into(), object([("id", Value::Id("scope".into()))]))]).unwrap();
    let mut outcomes=Vec::new();
    for op in ["add","discard"] {
        let mut c=context("bob");c.args.insert("id".into(),Value::Id("blind".into()));
        let outcome=e.mutate(op,None,c).unwrap();
        let WriteState::Failed {why,..}=&outcome.state else {panic!("hidden allocation was admitted: {outcome:?}")};
        assert_eq!(why.code,"E_RULE");outcomes.push(outcome);
    }
    assert_eq!(outcomes[0].metered,outcomes[1].metered);
    assert!(e.store().rows("records").unwrap().is_empty());
    let mut c=context("alice");c.args.insert("id".into(),Value::Id("allowed".into()));
    let WriteState::Sent {result,..}=e.mutate("add",None,c).unwrap().state else {panic!("owner allocation refused")};
    assert_eq!(result.field("ordinal").unwrap(),&Value::Int(1));
    assert!(result.field("secret").is_err());
}

#[test]
fn protected_scalar_rename_reverse_projection_and_argument_alias_survive_two_release_cycles(){
 let v1="table records:\n  owner: principal\n  body: text <=80\n  legacy: text <=80 ?\n  public\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  online only\nquery one(id: records):\n  return records[id]\nmutation add(reason: text <=80):\n  return insert records {owner: viewer,body: reason,legacy: null}\n";
 let v2="table records:\n  owner: principal\n  secret: text <=80 renamed from body read <- .owner = viewer\n  public\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  online only\nquery one(id: records):\n  return records[id]\nmutation add(explanation: text <=80 alias reason):\n  return insert records {owner: viewer,secret: explanation}\ndown records oldView(secret: text <=80): {legacy:secret}\ninvariant records.secret read only .owner = viewer\n";
 let b=clean(v1);let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
 let b=clean(v1);e.adopt_release_at(b.schema,b.programs.into_iter().map(|p|p.program),&snapback4_core::engine::release::ReleaseActivation::new(1,None),true,1_800_000_000_000).unwrap();
 for cycle in 0..2 {
  if cycle==0 {
  let b=clean(v2);let mut a=snapback4_core::engine::release::ReleaseActivation::new(2,Some(1));a.restore_dormant=true;
  e.adopt_release_at(b.schema,b.programs.into_iter().map(|p|p.program),&a,true,1_800_000_000_000).unwrap();
  }
  let text=format!("private-{cycle}");let mut ctx=context("alice");ctx.args.insert("reason".into(),Value::String(text.clone()));
  let sent=e.mutate("add",None,ctx).unwrap();let WriteState::Sent{result,..}=sent.state else{panic!("{sent:?}")};let key=result.field("id").unwrap().clone();
  let query=|viewer:&str|{let mut c=context(viewer);c.args.insert("id".into(),key.clone());c};
  assert!(e.query("one",query("bob")).unwrap().data.field("secret").is_err());
  let b=clean(v1);let mut a=snapback4_core::engine::release::ReleaseActivation::new(1,Some(2));a.restore_dormant=true;
  e.adopt_release_at(b.schema,b.programs.into_iter().map(|p|p.program),&a,true,1_800_000_000_000).unwrap();
  let old=e.query("one",query("bob")).unwrap().data;
  assert_eq!(old.field("body").unwrap(),&Value::String(text.clone()));assert_eq!(old.field("legacy").unwrap(),&Value::String(text.clone()));
  let mut ctx=context("alice");ctx.args.insert("reason".into(),Value::String(format!("old-{cycle}")));assert!(matches!(e.mutate("add",None,ctx).unwrap().state,WriteState::Sent{..}));
  let b=clean(v2);let mut a=snapback4_core::engine::release::ReleaseActivation::new(2,Some(1));a.restore_dormant=true;
  e.adopt_release_at(b.schema,b.programs.into_iter().map(|p|p.program),&a,true,1_800_000_000_000).unwrap();
  assert_eq!(e.query("one",query("alice")).unwrap().data.field("secret").unwrap(),&Value::String(text));
  assert!(e.query("one",query("bob")).unwrap().data.field("secret").is_err());
 }
}

#[test]
fn protected_spread_types_preserve_omission_nested_fields_and_fallback_presence(){
 let b=clean(&(SOURCE.to_owned()+"query spread(id: records):\n  r = records[id] ! else MISSING\n  s = {...r}\n  return {nested: {...s}}\nquery fallback(id: records):\n  r = records[id] ! else MISSING\n  return {secret: 'fallback', ...r}\nquery scalarSpread(id: records):\n  r = records[id] ! else MISSING\n  s = {...r}\n  return s.secret\n"));
 let spread=b.programs.iter().find(|p|p.program.name=="spread").unwrap();
 let ty=snapback4_lang::emit::ty_ts(&spread.result);assert!(ty.contains("secret?: string | null"),"{ty}");
 let fallback=b.programs.iter().find(|p|p.program.name=="fallback").unwrap();let ty=snapback4_lang::emit::ty_ts(&fallback.result);assert!(ty.contains("secret: string | null"),"{ty}");assert!(!ty.contains("secret?:"),"{ty}");
 let scalar=b.programs.iter().find(|p|p.program.name=="scalarSpread").unwrap();assert_eq!(snapback4_lang::emit::ty_ts(&scalar.result),"string | null");
}
