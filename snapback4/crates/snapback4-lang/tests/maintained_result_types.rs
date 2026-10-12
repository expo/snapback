use snapback4_lang::{compile, types::Ty};

const SOURCE: &str = r#"
table entries:
  owner: principal
  read <- allow
  online only
view counts: count entries by .owner
  read <- .owner = viewer
  online only
view publicCounts: count entries by .owner
  read <- allow
  online only
"#;

fn checked(programs: &str) -> snapback4_lang::Bound {
    let bound = compile(&[("schema.q".into(), format!("{SOURCE}{programs}").into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    bound
}

fn result<'a>(bound: &'a snapback4_lang::Bound, name: &str) -> &'a Ty {
    &bound
        .programs
        .iter()
        .find(|program| program.program.name == name)
        .unwrap()
        .result
}

#[test]
fn private_maintained_points_are_optional_until_the_key_or_guard_proves_authority() {
    let bound = checked(
        r#"
query bare(owner: principal):
  return counts[owner]
query own():
  return counts[viewer]
query guarded(owner: principal):
  require owner = viewer else NOT_ALLOWED
  return counts[owner] + 1
query surviving(owner: principal):
  if owner != viewer:
    return 0
  return counts[owner] + 1
query public(owner: principal):
  return publicCounts[owner]
"#,
    );
    assert_eq!(result(&bound, "bare"), &Ty::Int.optional());
    for name in ["own", "guarded", "surviving", "public"] {
        assert_eq!(result(&bound, name), &Ty::Int, "{name}");
    }
}

#[test]
fn optional_maintained_values_require_explicit_null_handling_before_arithmetic() {
    let invalid = compile(&[(
        "schema.q".into(),
        format!("{SOURCE}query bad(owner: principal):\n  return counts[owner] + 1\n").into(),
    )]);
    let error = invalid
        .diagnostics
        .iter()
        .find(|diagnostic| diagnostic.code == "E_QUARRY_TYPE")
        .expect("optional arithmetic refusal");
    assert!(
        error.message.contains("present") && error.message.contains("int ?"),
        "{error}"
    );
    assert!(error.rewrite.contains("counts[owner] ?? 0"), "{error}");

    let handled = checked(
        r#"
query defaulted(owner: principal):
  return (counts[owner] ?? 0) + 1
query refused(owner: principal):
  return (counts[owner] ! else NOT_ALLOWED) + 1
"#,
    );
    assert_eq!(result(&handled, "defaulted"), &Ty::Int);
    assert_eq!(result(&handled, "refused"), &Ty::Int);
}

#[test]
fn rebinding_an_authorized_key_drops_the_required_result_fact() {
    let source = format!(
        r#"{SOURCE}
query stale(owner: principal, next: principal):
  key = owner
  require key = viewer else NOT_ALLOWED
  key = next
  return counts[key] + 1
"#
    );
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(
        bound
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "E_QUARRY_TYPE"
                && diagnostic.message.contains("int ?")),
        "{:#?}",
        bound.diagnostics
    );
}
