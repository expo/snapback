//! Wave 10 NA8: complete role probes, blind child writers, and mutable
//! read-through audience guidance. The recipes are the shipped guide blocks.
use snapback4_core::{Context, Engine, Value, WriteState, value::object};
use snapback4_lang::{Bound, compile, guide};
use std::collections::BTreeMap;

fn recipe(needle: &str) -> String {
    guide::quarry(guide::card("rule-recipes").unwrap())
        .into_iter()
        .find(|block| block.contains(needle))
        .unwrap_or_else(|| panic!("recipes card has no Quarry block containing {needle}"))
}

fn clean(source: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(
        bound.diagnostics.is_empty(),
        "{:#?}\n{source}",
        bound.diagnostics
    );
    bound
}

fn id(value: &str) -> Value {
    Value::Id(value.into())
}
fn text(value: &str) -> Value {
    Value::String(value.into())
}
fn context(viewer: &str, args: &[(&str, Value)]) -> Context {
    Context::new(
        viewer,
        args.iter()
            .map(|(name, value)| ((*name).into(), value.clone()))
            .collect(),
    )
}
fn bool_query(engine: &mut Engine, operation: &str, viewer: &str) -> bool {
    match engine
        .query(operation, Context::new(viewer, BTreeMap::new()))
        .unwrap()
        .data
    {
        Value::Bool(value) => value,
        value => panic!("{operation} returned {value:?}"),
    }
}

#[test]
fn composite_role_recipe_uses_full_probes_and_supports_two_roles() {
    let source = recipe("query canCoordinate():");
    let bound = clean(&source);
    let mut engine = Engine::memory(
        bound.schema,
        bound.programs.into_iter().map(|program| program.program),
    )
    .unwrap();
    engine
        .seed([
            (
                "roles".into(),
                object([
                    ("id", id("alice-coordinator")),
                    ("principal", id("alice")),
                    ("role", text("coordinator")),
                ]),
            ),
            (
                "roles".into(),
                object([
                    ("id", id("alice-commander")),
                    ("principal", id("alice")),
                    ("role", text("commander")),
                ]),
            ),
            (
                "roles".into(),
                object([
                    ("id", id("bob-coordinator")),
                    ("principal", id("bob")),
                    ("role", text("coordinator")),
                ]),
            ),
        ])
        .unwrap();

    assert!(bool_query(&mut engine, "canCoordinate", "alice"));
    assert!(bool_query(&mut engine, "canCommand", "alice"));
    assert!(bool_query(&mut engine, "canCoordinate", "bob"));
    assert!(!bool_query(&mut engine, "canCommand", "bob"));

    let partial = "table roles:\n  principal: principal\n  role: enum('coordinator', 'commander')\n  unique principal, role\n  public 'roles'\n  online only\nquery anyRole():\n  return exists roles[viewer]\n";
    let refused = compile(&[("schema.q".into(), partial.into())]);
    let diagnostic = refused
        .diagnostics
        .iter()
        .find(|diagnostic| diagnostic.code == "E_QUARRY_POSITIONAL_SCAN")
        .unwrap_or_else(|| {
            panic!(
                "bare composite-key prefix was admitted: {:#?}",
                refused.diagnostics
            )
        });
    assert!(
        diagnostic.message.contains("name the key columns")
            || diagnostic.message.contains("positional key"),
        "{diagnostic:#?}"
    );
}

#[test]
fn blind_writer_recipe_checks_the_parent_without_reading_it() {
    let source = recipe("mutation addLetter(application:");
    let bound = clean(&source);
    let mut engine = Engine::memory(
        bound.schema,
        bound.programs.into_iter().map(|program| program.program),
    )
    .unwrap();
    engine
        .seed([
            (
                "counselors".into(),
                object([("id", id("counselor")), ("principal", id("carol"))]),
            ),
            (
                "applications".into(),
                object([
                    ("id", id("application")),
                    ("student", id("alice")),
                    ("college", text("Example University")),
                ]),
            ),
        ])
        .unwrap();

    let sent = engine
        .mutate(
            "addLetter",
            None,
            context(
                "bob",
                &[
                    ("application", id("application")),
                    ("body", text("Bob recommends Alice.")),
                ],
            )
            .with_ids(["letter".into()]),
        )
        .unwrap();
    assert!(
        matches!(sent.state, WriteState::Sent { .. }),
        "a blind recommender should write: {sent:?}"
    );

    for (viewer, application, row_id) in [
        ("alice", "application", "own-letter"),
        ("bob", "missing", "missing-letter"),
    ] {
        let refused = engine
            .mutate(
                "addLetter",
                None,
                context(
                    viewer,
                    &[("application", id(application)), ("body", text("No."))],
                )
                .with_ids([row_id.into()]),
            )
            .unwrap();
        assert!(
            matches!(&refused.state, WriteState::Failed { why, .. } if why.code == "E_RULE"),
            "{viewer}/{application}: {refused:?}"
        );
    }

    let read = |engine: &mut Engine, viewer| {
        engine
            .query(
                "lettersFor",
                context(
                    viewer,
                    &[("application", id("application")), ("c", Value::Null)],
                ),
            )
            .unwrap()
            .data
            .as_array()
            .unwrap()
            .len()
    };
    assert_eq!(read(&mut engine, "bob"), 1, "the author reads the letter");
    assert_eq!(
        read(&mut engine, "carol"),
        1,
        "a counselor reads the letter"
    );
    assert_eq!(
        read(&mut engine, "alice"),
        0,
        "the student cannot read recommendation letters"
    );
}

#[test]
fn timed_disclosure_recipe_separates_read_lifetime_from_write_deadline() {
    let source = recipe("mutation submit(event:");
    let bound = clean(&source);
    let submissions = &bound.schema.tables["submissions"];
    assert_eq!(submissions.not_before.as_deref(), Some("opensAt"));
    assert_eq!(submissions.expire.as_deref(), Some("expiresAt"));
    assert_eq!(
        submissions.opening_index().map(|(name, _)| name),
        Some("byOpening")
    );
    assert!(
        bound
            .schema
            .required_capabilities()
            .contains("time-audiences-v1")
    );
    assert!(source.contains("require now < e.submitUntil else SUBMISSIONS_CLOSED"));
    assert!(source.contains("not before .opensAt"));
    assert!(source.contains("expire at .expiresAt"));
}

#[test]
fn mutable_read_through_diagnostic_explains_both_audience_histories() {
    let source = "table dispatchers:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable franchisees:\n  principal: principal\n  territory: text 1..40\n  unique principal\n  read <- .principal = viewer\n  online only\ntable leads:\n  customer: principal\n  territory: text 1..40\n  immutable customer\n  read <- .customer = viewer or exists franchisees[principal = viewer, territory = .territory] or exists dispatchers[viewer]\n  online only\ntable followUps:\n  lead: leads\n  immutable lead\n  read through .lead\n  online only\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    let diagnostic = bound
        .diagnostics
        .iter()
        .find(|diagnostic| {
            diagnostic.code == "E_READ_THROUGH" && diagnostic.message.contains("leads.territory")
        })
        .unwrap_or_else(|| panic!("missing mutable-parent refusal: {:#?}", bound.diagnostics));
    for phrase in [
        "freezes this audience input",
        "copy it into a required immutable audience column",
        "check `.copy = .lead.territory`",
        "probe the live parent",
    ] {
        assert!(
            diagnostic.message.contains(phrase),
            "missing {phrase}: {diagnostic:#?}"
        );
    }
    assert_eq!(
        diagnostic.rewrite, "immutable territory  -- on table leads",
        "the primary executable repair stays pasteable"
    );
    clean(&source.replace(
        "  immutable customer\n",
        "  immutable customer, territory\n",
    ));

    let code = guide::explain_code("E_READ_THROUGH").unwrap();
    assert!(
        code.contains("copy immutable audience columns onto the child")
            && code.contains("probe the live parent"),
        "{code}"
    );
}
