//! The new payload projection is modelled independently from binder IR.
// @ref LLP 3000.036#226-required-evidence — point/page/scalar/count and valued writes cross the formal oracle.
use serde_json::json;
use snapback4_core::{Context, Engine};
use snapback4_difftest::lean;

#[test]
fn column_disclosure_agrees_with_the_lean_oracle() {
    lean::refresh().unwrap();
    if !lean::oracle_path().is_file() {
        assert!(
            std::env::var_os("SNAPBACK4_REQUIRE_LEAN").is_none(),
            "Lean oracle is required"
        );
        eprintln!("SKIPPED: build the Lean oracle to compare column disclosure");
        return;
    }
    let source = r#"table records:
  owner: principal
  title: text <=80
  secret: text <=80 read <- .owner = viewer
  public
  insert <- allow
  update <- allow
  online only
query point(id: records):
  return records[id]
query scalar(id: records):
  r = records[id] ! else NOT_FOUND
  return r.secret
query page():
  return records first 20 by .id
query total():
  return count(records)
mutation edit(id: records, title: text <=80):
  return update records[id] { title }
"#;
    for rule in [".owner = viewer", "exists roles[viewer]"] {
        let source = source.replace(".owner = viewer", rule)
            + if rule.starts_with("exists") {
                "table roles:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\n"
            } else {
                ""
            };
        let module = lean::module(&source).unwrap();
        for payload in ["private", "another value"] {
            for viewer in ["alice", "bob"] {
                let mut rows: Vec<(String, serde_json::Value)> = vec![(
                    "records".into(),
                    json!({"id":"r","owner":"alice","title":"shared","secret":payload}),
                )];
                if rule.starts_with("exists") {
                    rows.push(("roles".into(), json!({"id":"grant","principal":"alice"})));
                }
                for operation in ["point", "scalar", "page", "total", "edit"] {
                    let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
                    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
                    let mut engine =
                        Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program))
                            .unwrap();
                    let seeded = rows
                        .iter()
                        .map(|(t, r)| {
                            (
                                t.clone(),
                                snapback4_core::wire::row_from_json(&engine.schema().tables[t], r)
                                    .unwrap(),
                            )
                        })
                        .collect::<Vec<_>>();
                    engine.seed(seeded).unwrap();
                    let args = if operation == "edit" {
                        json!({"id":"r","title":"changed"})
                    } else if matches!(operation, "point" | "scalar") {
                        json!({"id":"r"})
                    } else {
                        json!({})
                    };
                    let case = module
                        .case(
                            operation,
                            module.store(&rows).unwrap(),
                            viewer,
                            module.tag_args(operation, &args).unwrap(),
                            None,
                        )
                        .unwrap();
                    let modeled = lean::ask(&case).unwrap();
                    let decoded = engine.program(operation).unwrap();
                    let context = Context::new(
                        viewer,
                        args.as_object()
                            .unwrap()
                            .iter()
                            .map(|(name, value)| {
                                (
                                    name.clone(),
                                    snapback4_core::wire::from_json(&decoded.args[name], value)
                                        .unwrap(),
                                )
                            })
                            .collect(),
                    );
                    let actual = if operation == "edit" {
                        let outcome = engine.mutate(operation, None, context).unwrap();
                        let snapback4_core::WriteState::Sent { result, .. } = outcome.state else {
                            panic!("{outcome:?}")
                        };
                        assert_eq!(modeled["kind"], "committed", "{modeled}");
                        result
                    } else {
                        engine.query(operation, context).unwrap().data
                    };
                    let data = if operation == "edit" {
                        &modeled["result"]
                    } else {
                        &modeled["data"]
                    };
                    assert_eq!(
                        lean::engine_value(&actual),
                        lean::model_value(data),
                        "{rule} {viewer} {operation}: {modeled}"
                    );
                }
            }
        }
    }
}
