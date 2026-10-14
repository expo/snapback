use snapback4_lang::{Diagnostic, compile};
const TABLE: &str = "table rows:\n  owner: principal\n  body: text <=80\n  unique owner\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  online only\n";
fn notes(body: &str) -> Vec<Diagnostic> {
    let b = compile(&[("schema.q".into(), format!("{TABLE}{body}"))]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b.notes
        .into_iter()
        .filter(|n| ["N_WRITE_DENIED", "N_LOOKUP_NEVER_VISIBLE"].contains(&n.code.as_str()))
        .collect()
}
#[test]
fn require_and_branch_contradictions_for_update_and_upsert() {
    for op in ["update", "upsert"] {
        let b = notes(&format!(
            "mutation change(owner: principal):\n  require owner != viewer else SELF\n  {op} rows[owner = owner] {{ body: 'x' }}\n"
        ));
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(b[0].code, "N_WRITE_DENIED");
        let b = notes(&format!(
            "mutation change(owner: principal):\n  if owner != viewer:\n    {op} rows[owner = owner] {{ body: 'x' }}\n"
        ));
        assert_eq!(b.len(), 1, "{b:?}");
    }
}
#[test]
fn nullable_point_lookup_dead_branch_is_proved() {
    let b = notes(
        "mutation change(owner: principal):\n  require owner != viewer else SELF\n  r = rows[owner = owner]\n  if r != null:\n    return r\n  return null\n",
    );
    assert_eq!(b.len(), 1, "{b:?}");
    assert_eq!(b[0].code, "N_LOOKUP_NEVER_VISIBLE");
}
#[test]
fn row_snapshots_and_scalar_aliases_preserve_the_gate() {
    let b = notes(
        "mutation change(row: rows):\n  r = rows[row] ! else NOT_FOUND\n  who = r.owner\n  require who != viewer else SELF\n  update rows[row] { body: 'x' }\n",
    );
    assert_eq!(b.len(), 1, "{b:?}");
}
#[test]
fn unknown_alternatives_and_invalidation_remain_quiet() {
    for body in [
        "mutation change(owner: principal):\n  require owner = viewer else SELF\n  update rows[owner = owner] { body: 'x' }\n",
        "mutation change(owner: principal, bypass: bool):\n  require owner != viewer or bypass else SELF\n  update rows[owner = owner] { body: 'x' }\n",
        "mutation change(owner: principal):\n  who = owner\n  require who != viewer else SELF\n  who = viewer\n  update rows[owner = who] { body: 'x' }\n",
        "mutation change(owner: principal):\n  require owner != viewer else SELF\n  insert rows { owner: viewer, body: 'new' }\n  update rows[owner = owner] { body: 'x' }\n",
        "job change(owner: principal):\n  for r in rows:\n    require owner != viewer else SELF\n    update rows[r.id] { body: 'x' }\n",
    ] {
        assert!(notes(body).is_empty(), "{body}: {:?}", notes(body));
    }
}
#[test]
fn named_images_and_replaced_new_values_are_checked() {
    let source = format!(
        "{}mutation change(owner: principal):\n  require owner != viewer else SELF\n  update rows[owner = owner] {{ body: 'x' }}\n",
        TABLE.replace(
            "update <- .owner = viewer",
            "update (old, next) <- old.owner = viewer and next.body = 'x'"
        )
    );
    let b = compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert!(b.notes.iter().any(|n| n.code == "N_WRITE_DENIED"));
    let b = compile(&[(
        "schema.q".into(),
        format!(
            "{}mutation change(owner: principal):\n  require owner != viewer else SELF\n  update rows[owner = owner] {{ owner: viewer }}\n",
            TABLE.replace(
                "update <- .owner = viewer",
                "update (old, next) <- next.owner = viewer"
            )
        ),
    )]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert!(
        b.notes.iter().all(|n| n.code != "N_WRITE_DENIED"),
        "{:?}",
        b.notes
    );
}
#[test]
fn nullable_snapshot_fields_never_prove_physical_row_values() {
    assert!(notes("mutation change(row: rows):\n  r = rows[row]\n  require r.owner = null else NOT_HIDDEN\n  update rows[row] { body: 'x' }\n").is_empty());
}
#[test]
fn notes_predict_the_actual_failed_update_and_null_lookup() {
    use snapback4_core::{Context, Engine, Value, WriteState};
    let source = format!(
        "{TABLE}mutation change(owner: principal):\n  require owner != viewer else SELF\n  update rows[owner = owner] {{ body: 'x' }}\nmutation inspect(owner: principal):\n  require owner != viewer else SELF\n  r = rows[owner = owner]\n  if r != null:\n    return 'hit'\n  return 'hidden'\n"
    );
    let b = compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert!(b.notes.iter().any(|n| n.code == "N_WRITE_DENIED"));
    assert!(b.notes.iter().any(|n| n.code == "N_LOOKUP_NEVER_VISIBLE"));
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed(vec![(
        "rows".into(),
        snapback4_core::value::object([
            ("id", Value::Id("r".into())),
            ("owner", Value::Id("alice".into())),
            ("body", Value::String("original".into())),
        ]),
    )])
    .unwrap();
    for viewer in ["bob", "carol", "service:ops"] {
        let c = Context::new(viewer, [("owner".into(), Value::Id("alice".into()))].into()).at(1000);
        assert!(
            matches!(e.mutate("change",None,c.clone()).unwrap().state,WriteState::Failed { why,.. } if why.code=="NOT_FOUND")
        );
        assert!(
            matches!(e.mutate("inspect",None,c).unwrap().state,WriteState::Sent { result:Value::String(s),.. } if s=="hidden")
        );
    }
    assert_eq!(
        e.store().rows("rows").unwrap()[0].field("body").unwrap(),
        &Value::String("original".into())
    );
}
