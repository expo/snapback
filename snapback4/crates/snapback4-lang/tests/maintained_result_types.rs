use snapback4_core::{Engine, JobState, Value, value::object};
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
fn readable_absence_is_not_raw_absence_for_a_maintained_rule_witness() {
    let tables = r#"
table hiddenBans:
  principal: principal
  unique principal
  read <- deny
  online only
table readableBans:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
table hiddenParents:
  owner: principal
  immutable owner
  read <- .owner = viewer
  online only
table inheritedChildren:
  parent: hiddenParents
  immutable parent
  read through .parent
  online only
view hiddenUnbannedCounts: count entries by .owner
  read <- not exists hiddenBans[viewer]
  online only
view readableUnbannedCounts: count entries by .owner
  read <- not exists readableBans[viewer]
  online only
view hiddenBannedCounts: count entries by .owner
  read <- exists hiddenBans[viewer]
  online only
view hiddenDoubleBannedCounts: count entries by .owner
  read <- not not exists hiddenBans[viewer]
  online only
view hiddenCompositeCounts: count entries by .owner
  read <- .owner = viewer and not exists hiddenBans[viewer]
  online only
view hiddenEitherCounts: count entries by .owner
  read <- .owner = viewer or not exists hiddenBans[viewer]
  online only
view inheritedAbsenceCounts: count entries by .owner
  read <- not exists inheritedChildren['child']
  online only
view publicGateCounts: count entries by .owner
  read <- allow
  online only
view presentGateCounts: count entries by .owner
  read <- exists publicGateCounts[viewer]
  online only
view absentGateCounts: count entries by .owner
  read <- not exists publicGateCounts[viewer]
  online only
"#;
    for (name, guard, view) in [
        ("hidden", "not exists hiddenBans[viewer]", "hiddenUnbannedCounts"),
        ("composite", "owner = viewer and not exists hiddenBans[viewer]", "hiddenCompositeCounts"),
        ("either", "owner = viewer or not exists hiddenBans[viewer]", "hiddenEitherCounts"),
        ("inherited", "not exists inheritedChildren['child']", "inheritedAbsenceCounts"),
    ] {
        let hidden = compile(&[(
            "schema.q".into(),
            format!(
                "{SOURCE}{tables}query {name}(owner: principal):\n  require {guard} else BANNED\n  return {view}[owner] + 1\n"
            )
            .into(),
        )]);
        assert!(
            hidden.diagnostics.iter().any(|diagnostic| diagnostic.code == "E_QUARRY_TYPE"
                && diagnostic.message.contains("int ?")),
            "{name}: {:#?}",
            hidden.diagnostics
        );
    }

    let readable = compile(&[(
        "schema.q".into(),
        format!(
            "{SOURCE}{tables}query readable(owner: principal):\n  require not exists readableBans[viewer] else BANNED\n  return readableUnbannedCounts[owner] + 1\nquery positive(owner: principal):\n  require exists hiddenBans[viewer] else NOT_BANNED\n  return hiddenBannedCounts[owner] + 1\nquery doublePositive(owner: principal):\n  require exists hiddenBans[viewer] else NOT_BANNED\n  return hiddenDoubleBannedCounts[owner] + 1\nquery maintainedPresent(owner: principal):\n  require exists publicGateCounts[viewer] else NO_STORED_GROUP\n  return presentGateCounts[owner] + 1\nquery maintainedAbsent(owner: principal):\n  require not exists publicGateCounts[viewer] else STORED_GROUP\n  return absentGateCounts[owner] + 1\n"
        )
        .into(),
    )]);
    assert!(readable.diagnostics.is_empty(), "{:#?}", readable.diagnostics);
    // Program `exists` on a maintained target tests stored-row presence: its
    // authorized synthetic zero is null and therefore false, matching the raw
    // witness domain used by another table rule.
    for name in ["readable", "positive", "doublePositive", "maintainedPresent", "maintainedAbsent"] {
        assert_eq!(result(&readable, name), &Ty::Int, "{name}");
    }

    let polarity = checked(&format!(r#"{tables}
query nestedPositive(owner: principal):
  require not not exists hiddenBans[viewer] else NOT_BANNED
  return hiddenBannedCounts[owner] + 1
query nestedNegative(owner: principal):
  require not not not exists readableBans[viewer] else BANNED
  return readableUnbannedCounts[owner] + 1
query opposite(owner: principal):
  require exists readableBans[viewer] else NOT_BANNED
  return readableUnbannedCounts[owner]
query joined(owner: principal, banned: bool):
  if banned:
    require exists readableBans[viewer] else NOT_BANNED
  else:
    require not exists readableBans[viewer] else BANNED
  return readableUnbannedCounts[owner]
"#));
    assert_eq!(result(&polarity, "nestedPositive"), &Ty::Int);
    assert_eq!(result(&polarity, "nestedNegative"), &Ty::Int);
    assert_eq!(result(&polarity, "opposite"), &Ty::Int.optional());
    assert_eq!(result(&polarity, "joined"), &Ty::Int.optional());

    for (name, parameters, body) in [
        ("oppositeArithmetic", "owner: principal",
            "  require exists readableBans[viewer] else NOT_BANNED\n  return readableUnbannedCounts[owner] + 1"),
        ("joinedArithmetic", "owner: principal, banned: bool",
            "  if banned:\n    require exists readableBans[viewer] else NOT_BANNED\n  else:\n    require not exists readableBans[viewer] else BANNED\n  return readableUnbannedCounts[owner] + 1"),
    ] {
        let invalid = compile(&[("schema.q".into(),
            format!("{SOURCE}{tables}query {name}({parameters}):\n{body}\n").into())]);
        assert!(invalid.diagnostics.iter().any(|diagnostic| diagnostic.code == "E_QUARRY_TYPE"
            && diagnostic.message.contains("int ?")), "{name}: {:#?}", invalid.diagnostics);
    }
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
fn loop_transfer_edges_carry_revoked_authorization_to_their_destinations() {
    for (name, body) in [
        (
            "breakRevoked",
            "  for i in range(0, 2):\n    if i = 0:\n      delete moderators[viewer]\n      break\n  return narrowCounts[owner] + 1",
        ),
        (
            "continueRevoked",
            "  for i in range(0, 2):\n    if i = 0:\n      delete moderators[viewer]\n      continue\n    value = narrowCounts[owner] + 1\n  return 0",
        ),
    ] {
        let bound = compile(&[(
            "schema.q".into(),
            format!(
                "{SOURCE}mutation {name}(owner: principal):\n  require owner = viewer else NOT_ALLOWED\n  require exists moderators[viewer] else NOT_MODERATOR\n{body}\n"
            )
            .into(),
        )]);
        assert!(
            bound.diagnostics.iter().any(|diagnostic| diagnostic.code == "E_QUARRY_TYPE"
                && diagnostic.message.contains("int ?")),
            "{name}: {:#?}",
            bound.diagnostics
        );
    }

    checked(
        r#"
query stableBreak(owner: principal):
  require owner = viewer else NOT_ALLOWED
  require exists moderators[viewer] else NOT_MODERATOR
  for i in range(0, 2):
    if i = 0:
      break
  return narrowCounts[owner] + 1
query stableContinue(owner: principal):
  require owner = viewer else NOT_ALLOWED
  require exists moderators[viewer] else NOT_MODERATOR
  for i in range(0, 2):
    if i = 0:
      continue
  return narrowCounts[owner] + 1
"#,
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

#[test]
fn shadowed_loop_locals_cannot_hide_revoked_authorization() {
    let guarded = r#"
table grants:
  owner: principal
  unique owner
  read <- allow
  delete <- allow
  online only
view grantedCounts: count entries by .owner
  read <- exists grants[.owner]
  online only
"#;
    for (name, loop_body) in [
        (
            "fallthrough",
            "  for key in [other]:\n    delete grants[owner]",
        ),
        (
            "breakEdge",
            "  for key in [other]:\n    delete grants[owner]\n    break",
        ),
        (
            "continueEdge",
            "  for key in [other]:\n    delete grants[owner]\n    continue",
        ),
        (
            "nestedShadow",
            "  for key in [other]:\n    for key in [other]:\n      delete grants[owner]",
        ),
    ] {
        let bound = compile(&[(
            "schema.q".into(),
            format!(
                "{SOURCE}{guarded}mutation {name}(owner: principal, other: principal):\n  key = owner\n  require exists grants[key] else NOT_ALLOWED\n{loop_body}\n  return grantedCounts[key] + 1\n"
            )
            .into(),
        )]);
        assert!(
            bound.diagnostics.iter().any(|diagnostic| diagnostic.code == "E_QUARRY_TYPE"
                && diagnostic.message.contains("int ?")),
            "{name}: {:#?}",
            bound.diagnostics
        );
    }

    let controls = checked(&format!(
        r#"{guarded}
query stableShadow(owner: principal, other: principal):
  key = owner
  require exists grants[key] else NOT_ALLOWED
  for key in [other]:
    observed = key
  return grantedCounts[key] + 1
query stableNestedShadow(owner: principal, other: principal):
  key = owner
  require exists grants[key] else NOT_ALLOWED
  for key in [other]:
    for key in [other]:
      observed = key
  return grantedCounts[key] + 1
"#
    ));
    assert_eq!(result(&controls, "stableShadow"), &Ty::Int);
    assert_eq!(result(&controls, "stableNestedShadow"), &Ty::Int);
}

#[test]
fn lexical_names_never_become_authored_rule_constants_after_substitution() {
    let schema = r#"
table boolEntries:
  flag: bool
  read <- allow
  online only
view trueTotals: count boolEntries by .flag
  read <- .flag
  online only
table stateEntries:
  state: enum('visible', 'hidden')
  read <- allow
  online only
view stateTotals: count stateEntries by .state
  read <- .state = 'visible'
  online only
"#;
    for name in ["allow", "public", "deny"] {
        for (shape, body) in [
            ("argument", format!("query bad{name}({name}: bool):\n  return trueTotals[{name}] + 1\n")),
            ("alias", format!("query bad{name}Alias(key: bool):\n  {name} = key\n  return trueTotals[{name}] + 1\n")),
            ("loop", format!("query bad{name}Loop():\n  for {name} in [false]:\n    value = trueTotals[{name}] + 1\n  return 0\n")),
        ] {
            let bound = compile(&[("schema.q".into(), format!("{schema}{body}").into())]);
            assert!(
                bound.diagnostics.iter().any(|diagnostic| diagnostic.code == "E_QUARRY_TYPE"
                    && diagnostic.message.contains("int ?")),
                "{name} {shape}: {:#?}",
                bound.diagnostics
            );
        }
    }
    let enum_collision = compile(&[(
        "schema.q".into(),
        format!(
            "{schema}query enumCollision(visible: enum('visible', 'hidden')):\n  return stateTotals[visible] + 1\n"
        )
        .into(),
    )]);
    assert!(
        enum_collision
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "E_QUARRY_TYPE"
                && diagnostic.message.contains("int ?")),
        "{:#?}",
        enum_collision.diagnostics
    );

    let guarded = compile(&[(
        "schema.q".into(),
        format!(
            r#"{schema}
query guardedAllow(allow: bool):
  require allow else NOT_ALLOWED
  return trueTotals[allow] + 1
query guardedPublic(public: bool):
  require public else NOT_ALLOWED
  return trueTotals[public] + 1
query guardedDeny(deny: bool):
  require deny else NOT_ALLOWED
  return trueTotals[deny] + 1
query guardedEnum(visible: enum('visible', 'hidden')):
  require visible = 'visible' else NOT_ALLOWED
  return stateTotals[visible] + 1
"#
        )
        .into(),
    )]);
    assert!(guarded.diagnostics.is_empty(), "{:#?}", guarded.diagnostics);
    for name in ["guardedAllow", "guardedPublic", "guardedDeny", "guardedEnum"] {
        assert_eq!(result(&guarded, name), &Ty::Int, "{name}");
    }

    for name in ["true", "false", "viewer"] {
        let bound = compile(&[(
            "schema.q".into(),
            format!("{schema}query reserved({name}: bool):\n  return trueTotals[{name}]\n").into(),
        )]);
        assert!(
            bound.diagnostics.iter().any(|diagnostic| diagnostic.code == "E_QUARRY_RESERVED"),
            "{name}: {:#?}",
            bound.diagnostics
        );
    }
}

#[test]
fn maintained_target_fields_never_borrow_a_projection_focal() {
    let schema = r#"
table measurements:
  owner: principal
  value: int
  category: int
  read <- allow
  online only
view zeroCounts: count measurements by .owner
  read <- .value = 0
  online only
view ownerOrZeroCounts: count measurements by .owner
  read <- .owner = viewer or .value = 0
  online only
view ownerAndZeroCounts: count measurements by .owner
  read <- .owner = viewer and .value = 0
  online only
view ownerCategoryCounts: count measurements by .owner, .category
  read <- .owner = viewer and .category = 0
  online only
"#;
    for (name, view, guard) in [
        ("unresolved", "zeroCounts[.owner]", ".value = 0"),
        (
            "unresolvedAnd",
            "ownerAndZeroCounts[.owner]",
            ".owner = viewer and .value = 0",
        ),
    ] {
        let bound = compile(&[(
            "schema.q".into(),
            format!("{schema}query {name}():\n  return measurements first 1 by .id {{ result: {view} + 1 if {guard} else 0 }}\n").into(),
        )]);
        assert!(
            bound
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "E_QUARRY_TYPE"
                    && diagnostic.message.contains("int ?")),
            "{name}: {:#?}",
            bound.diagnostics
        );
    }

    let controls = compile(&[(
        "schema.q".into(),
        format!(r#"{schema}
query soundOr():
  return measurements first 1 by .id {{ result: ownerOrZeroCounts[.owner] + 1 if .owner = viewer else 0 }}
query soundAnd():
  return measurements first 1 by .id {{ result: ownerCategoryCounts[.owner, .category] + 1 if .owner = viewer and .category = 0 else 0 }}
"#).into(),
    )]);
    assert!(
        controls.diagnostics.is_empty(),
        "{:#?}",
        controls.diagnostics
    );
}

const INHERITED_MAINTAIN: &str = r#"
table parents:
  expiresAt: time
  immutable expiresAt
  read <- deny
  delete <- allow
  expire at .expiresAt
  online only
table children:
  parent: parents
  immutable parent
  read through .parent
  online only
view childCounts: count children by .parent
  online only
table work:
  marker: bool
  read <- allow
  online only
view directCounts: count work by .marker
  read <- deny
  online only
"#;

#[test]
fn system_jobs_need_a_live_read_through_parent_for_required_totals() {
    for (name, body) in [
        ("missing", "value = childCounts['gone'] + 1"),
        ("expired", "value = childCounts['expired'] + 1"),
        (
            "stale",
            "require exists parents['live'] else MISSING\n    delete parents['live']\n    value = childCounts['live'] + 1",
        ),
    ] {
        let bound = compile(&[(
            "schema.q".into(),
            format!("{INHERITED_MAINTAIN}job {name}():\n  for item in work:\n    {body}\n").into(),
        )]);
        assert!(
            bound
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "E_QUARRY_TYPE"
                    && diagnostic.message.contains("int ?")),
            "{name}: {:#?}",
            bound.diagnostics
        );
    }
    let stale_loop = compile(&[(
        "schema.q".into(),
        format!("{INHERITED_MAINTAIN}job staleLoopRow():\n  for parent in parents:\n    delete parents[parent.id]\n    value = childCounts[parent.id] + 1\n").into(),
    )]);
    assert!(
        stale_loop.diagnostics.iter().any(|diagnostic| diagnostic.code == "E_QUARRY_TYPE"
            && diagnostic.message.contains("int ?")),
        "{:#?}",
        stale_loop.diagnostics
    );

    let controls = compile(&[(
        "schema.q".into(),
        format!(
            r#"{INHERITED_MAINTAIN}
job liveParent():
  for item in work:
    require exists parents['live'] else MISSING
    value = childCounts['live'] + 1
job liveParentLoop():
  for parent in parents:
    value = childCounts[parent.id] + 1
job directView():
  for item in work:
    value = directCounts[true] + 1
job handledMissing():
  for item in work:
    value = (childCounts['gone'] ?? 0) + 1
job guardedMissing():
  for item in work:
    require exists parents['gone'] else MISSING
    value = childCounts['gone'] + 1
job guardedExpired():
  for item in work:
    require exists parents['expired'] else MISSING
    value = childCounts['expired'] + 1
"#
        )
        .into(),
    )]);
    assert!(
        controls.diagnostics.is_empty(),
        "{:#?}",
        controls.diagnostics
    );

    let mut engine = Engine::memory(
        controls.schema,
        controls.programs.into_iter().map(|program| program.program),
    )
    .unwrap();
    engine
        .seed_at(
            [
                (
                    "parents".into(),
                    object([
                        ("id", Value::Id("live".into())),
                        ("expiresAt", Value::Int(100)),
                    ]),
                ),
                (
                    "parents".into(),
                    object([
                        ("id", Value::Id("expired".into())),
                        ("expiresAt", Value::Int(5)),
                    ]),
                ),
                (
                    "children".into(),
                    object([
                        ("id", Value::Id("child".into())),
                        ("parent", Value::Id("live".into())),
                    ]),
                ),
                (
                    "work".into(),
                    object([
                        ("id", Value::Id("work".into())),
                        ("marker", Value::Bool(true)),
                    ]),
                ),
            ],
            0,
        )
        .unwrap();
    for name in [
        "liveParent",
        "liveParentLoop",
        "directView",
        "handledMissing",
    ] {
        let run = engine.run_job(name, Default::default(), 10).unwrap();
        assert_eq!(run.state, JobState::Done, "{name}: {run:?}");
    }
    for name in ["guardedMissing", "guardedExpired"] {
        let run = engine.run_job(name, Default::default(), 10).unwrap();
        assert_eq!(run.state, JobState::Parked, "{name}: {run:?}");
        assert!(
            run.error
                .as_deref()
                .is_some_and(|error| error.starts_with("MISSING")),
            "{name}: {run:?}"
        );
    }
}
