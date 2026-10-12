use snapback4_lang::{compile, types::Ty};

const SOURCE: &str = r#"
table entries:
  owner: principal
  read <- allow
  online only
table moderators:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
view counts: count entries by .owner
  read <- .owner = viewer
  online only
view publicCounts: count entries by .owner
  read <- allow
  online only
view broadCounts: count entries by .owner
  read <- .owner = viewer or exists moderators[viewer]
  online only
view narrowCounts: count entries by .owner
  read <- .owner = viewer and exists moderators[viewer]
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
query stronger(owner: principal):
  require owner = viewer else NOT_ALLOWED
  return broadCounts[owner] + 1
query conjuncts(owner: principal):
  require owner = viewer else NOT_ALLOWED
  require exists moderators[viewer] else NOT_MODERATOR
  return narrowCounts[owner] + 1
"#,
    );
    assert_eq!(result(&bound, "bare"), &Ty::Int.optional());
    for name in [
        "own",
        "guarded",
        "surviving",
        "public",
        "stronger",
        "conjuncts",
    ] {
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

#[test]
fn authorization_facts_do_not_turn_job_guard_inputs_into_accumulators() {
    checked(
        r#"
table parents:
  expiresAt: time
  read <- allow
table children:
  parent: parents
  unique parent
job prune(periodStart: time, periodEnd: time):
  cutoff = periodEnd - 7d
  for parent in parents:
    if parent.expiresAt < cutoff:
      child = children[parent = parent.id]
      if child != null:
        delete children[child]
"#,
    );
}

#[test]
fn a_write_clears_probe_authorization_without_changing_assignment_revisions() {
    let bound = compile(&[(
        "schema.q".into(),
        format!(
            r#"{SOURCE}
mutation stale(owner: principal):
  require owner = viewer else NOT_ALLOWED
  require exists moderators[viewer] else NOT_MODERATOR
  delete moderators[viewer]
  return narrowCounts[owner] + 1
"#
        )
        .into(),
    )]);
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

#[test]
fn a_side_effecting_compound_guard_cannot_recreate_authorization() {
    let bound = compile(&[(
        "schema.q".into(),
        format!(
            r#"{SOURCE}
fn revoke():
  delete moderators[viewer]
  return true
mutation stale(owner: principal):
  require owner = viewer else NOT_ALLOWED
  require exists moderators[viewer] and revoke() else NOT_MODERATOR
  return narrowCounts[owner] + 1
"#
        )
        .into(),
    )]);
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

#[test]
fn a_job_is_system_only_outside_viewer_scopes() {
    let bound = compile(&[(
        "schema.q".into(),
        format!(
            r#"{SOURCE}
table profiles:
  principal: principal
  unique principal
  read <- allow
job inspect():
  for profile in profiles:
    systemValue = counts[profile.principal] + 1
    as profile.principal:
      otherValue = counts['dev:another'] + 1
"#
        )
        .into(),
    )]);
    let errors: Vec<_> = bound
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == "E_QUARRY_TYPE")
        .collect();
    assert_eq!(errors.len(), 1, "{:#?}", bound.diagnostics);
    assert!(errors[0].message.contains("int ?"), "{}", errors[0]);
}

#[test]
fn maintained_authorization_does_not_cross_viewer_boundaries() {
    let entering = compile(&[(
        "schema.q".into(),
        format!(
            r#"{SOURCE}
table profiles:
  principal: principal
  unique principal
  read <- allow
job inspect():
  for profile in profiles:
    require profile.principal = viewer else NOT_SYSTEM_PROFILE
    as profile.principal:
      entering = counts[profile.principal] + 1
"#
        )
        .into(),
    )]);
    let errors: Vec<_> = entering
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == "E_QUARRY_TYPE")
        .collect();
    assert_eq!(errors.len(), 1, "{:#?}", entering.diagnostics);
    assert!(
        errors.iter().all(|error| error.message.contains("int ?")),
        "{errors:#?}"
    );

    let exiting = compile(&[(
        "schema.q".into(),
        format!(
            r#"{SOURCE}
table profiles:
  principal: principal
  unique principal
  read <- allow
job inspect():
  for profile in profiles:
    key = profile.principal
    as profile.principal:
      key = profile.principal
      require key = viewer else NOT_PROFILE
      admitted = counts[key] + 1
    as 'dev:another':
      exiting = counts[key] + 1
"#
        )
        .into(),
    )]);
    let errors: Vec<_> = exiting
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == "E_QUARRY_TYPE")
        .collect();
    assert_eq!(errors.len(), 1, "{:#?}", exiting.diagnostics);
    assert!(errors[0].message.contains("int ?"), "{}", errors[0]);
}
