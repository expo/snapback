//! Live authority is a whole rule maintained atomically, never application code.
use serde_json::json;
use snapback4_core::{Context, Engine, Value, WriteState, wire};
use snapback4_lang::compile;
const SOURCE: &str = include_str!("fixtures/live-parent.q");
fn build(source: &str) -> snapback4_lang::Bound {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn engine() -> Engine {
    let b = build(SOURCE);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let rows = [
        ("projects", json!({"id":"p","owner":"alice"})),
        ("tasks", json!({"id":"c","project":"p","body":"private"})),
    ]
    .into_iter()
    .map(|(t, row)| {
        (
            t.into(),
            wire::row_from_json(&e.schema().tables[t], &row).unwrap(),
        )
    })
    .collect::<Vec<_>>();
    e.seed(rows).unwrap();
    e
}
#[test]
fn whole_rule_moves_existing_rows_and_failure_rolls_everything_back() {
    let mut e = engine();
    let args = [
        ("project".into(), Value::Id("p".into())),
        ("owner".into(), Value::Id("bob".into())),
    ]
    .into();
    let fail = e
        .mutate("transferAndFail", None, Context::new("alice", args))
        .unwrap();
    assert!(matches!(fail.state, WriteState::Failed { .. }), "{fail:?}");
    let args = [
        ("project".into(), Value::Id("p".into())),
        ("owner".into(), Value::Id("bob".into())),
    ]
    .into();
    let ok = e
        .mutate("transfer", None, Context::new("alice", args))
        .unwrap();
    assert!(matches!(ok.state, WriteState::Sent { .. }), "{ok:?}");
    for (who, count) in [("alice", 0), ("bob", 1)] {
        let out = e
            .query(
                "all",
                Context::new(who, [("project".into(), Value::Id("p".into()))].into()),
            )
            .unwrap();
        let text = serde_json::to_string(&out).unwrap();
        if count == 0 {
            assert!(!text.contains("private"), "{text}");
        } else {
            assert!(text.contains("private"), "{text}");
        }
        assert!(!text.contains("$project.owner"), "{text}");
    }
}
#[test]
fn unsupported_shapes_refuse_with_live_diagnostic() {
    for source in [
        SOURCE.replace("  cap 2 by project\n", ""),
        SOURCE.replace("  immutable project\n", ""),
        SOURCE.replace(
            "  sync\nmutation transfer",
            "  sync last 2 by .id\nmutation transfer",
        ),
        SOURCE.replace(
            "  body: text <=80",
            "  body: text <=80\n  until: time\n  expire at .until",
        ),
    ] {
        let b = compile(&[("schema.q".into(), source)]);
        assert!(
            b.diagnostics.iter().any(|d| d.code == "E_READ_THROUGH"),
            "{:?}",
            b.diagnostics
        );
    }
}

fn manual() -> String {
    SOURCE.replace("  body: text <=80","  owner: principal\n  body: text <=80").replace("read through live .project","read <- .owner = viewer").replace("return insert tasks { project, body }","p = projects[project] ! else NOT_FOUND\n  return insert tasks { project, body, owner: p.owner }")
}
fn seeded(source: &str, owner: &str, release: bool) -> Engine {
    let b = build(source);
    let mut e = if release {
        Engine::new_release(
            snapback4_core::Store::memory().unwrap(),
            b.schema,
            b.programs.into_iter().map(|p| p.program),
            1,
            None,
        )
        .unwrap()
    } else {
        Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
    };
    let rows = [
        ("projects", json!({"id":"p","owner":"alice"})),
        (
            "tasks",
            json!({"id":"c","project":"p","owner":owner,"body":"private"}),
        ),
    ]
    .into_iter()
    .map(|(t, mut row)| {
        if !e.schema().tables[t].columns.contains_key("owner") {
            row.as_object_mut().unwrap().remove("owner");
        }
        (
            t.into(),
            wire::row_from_json(&e.schema().tables[t], &row).unwrap(),
        )
    })
    .collect::<Vec<_>>();
    e.seed(rows).unwrap();
    e
}
fn visible(e: &mut Engine, who: &str) -> bool {
    let out = e
        .query(
            "all",
            Context::new(who, [("project".into(), Value::Id("p".into()))].into()),
        )
        .unwrap();
    serde_json::to_string(&out.data)
        .unwrap()
        .contains("private")
}
fn transfer(e: &mut Engine, to: &str) {
    let out = e
        .mutate(
            "transfer",
            None,
            Context::new(
                "alice",
                [
                    ("project".into(), Value::Id("p".into())),
                    ("owner".into(), Value::Id(to.into())),
                ]
                .into(),
            ),
        )
        .unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
}
#[test]
fn manual_adoption_and_reverse_release_reconcile_dormant_cells() {
    use snapback4_core::engine::release::ReleaseActivation;
    let mut e = seeded(&manual(), "alice", true);
    let b = build(SOURCE);
    e.adopt_release(
        b.schema,
        b.programs.into_iter().map(|p| p.program),
        &ReleaseActivation::new(2, Some(1)),
        false,
    )
    .unwrap();
    transfer(&mut e, "bob");
    assert!(!visible(&mut e, "alice"));
    assert!(visible(&mut e, "bob"));
    let b = build(&manual());
    e.adopt_release(
        b.schema,
        b.programs.into_iter().map(|p| p.program),
        &ReleaseActivation::new(3, Some(2)),
        false,
    )
    .unwrap();
    assert!(!visible(&mut e, "alice"));
    assert!(visible(&mut e, "bob"));
    let arrays: i64 = e
        .store()
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM _meta WHERE key LIKE 'activation_%_restored_ids:%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(arrays, 0);
}
#[test]
fn disagreeing_copy_adoption_is_atomic() {
    let mut e = seeded(&manual(), "bob", false);
    let generation = e.generation();
    let b = build(SOURCE);
    let error = e
        .adopt(b.schema, b.programs.into_iter().map(|p| p.program))
        .unwrap_err();
    assert!(error.to_string().contains("correspondence"), "{error:?}");
    assert_eq!(e.generation(), generation);
    assert!(visible(&mut e, "bob"));
    assert!(!visible(&mut e, "alice"));
}
#[test]
fn hidden_child_population_cannot_change_parent_write_meter_or_event_count() {
    let mut results = Vec::new();
    for count in 0..=2 {
        let mut e = engine();
        if count == 0 {
            e.seed_delete("tasks", "c").unwrap();
        }
        if count == 2 {
            let r = wire::row_from_json(
                &e.schema().tables["tasks"],
                &json!({"id":"d","project":"p","body":"a longer secret"}),
            )
            .unwrap();
            e.seed([("tasks".into(), r)]).unwrap();
        }
        let out = e
            .mutate(
                "transfer",
                None,
                Context::new(
                    "blind-writer",
                    [
                        ("project".into(), Value::Id("p".into())),
                        ("owner".into(), Value::Id("bob".into())),
                    ]
                    .into(),
                ),
            )
            .unwrap();
        assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
        results.push((out.metered, out.events, out.tables));
    }
    assert!(results.windows(2).all(|p| p[0] == p[1]), "{results:?}");
}
#[test]
fn trusted_parent_restore_updates_off_input_children_and_bulk_input_is_bounded() {
    let mut e = engine();
    let parent = wire::row_from_json(
        &e.schema().tables["projects"],
        &json!({"id":"p","owner":"bob"}),
    )
    .unwrap();
    e.load_trusted([("projects".into(), parent)]).unwrap();
    assert!(!visible(&mut e, "alice"));
    assert!(visible(&mut e, "bob"));
    let before = e.generation();
    let many = (0..20_000).map(|n| {
        (
            "projects".into(),
            snapback4_core::value::object([
                ("id", Value::Id(format!("p{n}"))),
                ("owner", Value::Id("mallory".into())),
            ]),
        )
    });
    assert!(e.load_trusted(many).is_err());
    assert_eq!(e.generation(), before);
    assert!(visible(&mut e, "bob"));
}
#[test]
fn fixed_budget_cut_rolls_back_the_parent_and_all_copies() {
    let mut e = engine();
    let mut c = e.ceilings();
    c.rows_written = 1;
    e.set_ceilings(c);
    let out = e
        .mutate(
            "transfer",
            None,
            Context::new(
                "alice",
                [
                    ("project".into(), Value::Id("p".into())),
                    ("owner".into(), Value::Id("bob".into())),
                ]
                .into(),
            ),
        )
        .unwrap();
    assert!(
        matches!(out.state,WriteState::Failed{ref why,..} if why.code=="E_BOUND"),
        "{out:?}"
    );
    e.set_ceilings(Default::default());
    assert!(visible(&mut e, "alice"));
    assert!(!visible(&mut e, "bob"));
}

#[test]
fn own_write_reads_and_parent_pinned_denials_use_current_authority() {
    let mut e = engine();
    let out = e
        .mutate(
            "transferAndRead",
            None,
            Context::new(
                "alice",
                [
                    ("project".into(), Value::Id("p".into())),
                    ("owner".into(), Value::Id("bob".into())),
                    ("task".into(), Value::Id("c".into())),
                ]
                .into(),
            ),
        )
        .unwrap();
    assert!(
        matches!(
            out.state,
            WriteState::Sent {
                result: Value::Null,
                ..
            }
        ),
        "{out:?}"
    );
    let out = e
        .query(
            "all",
            Context::new("alice", [("project".into(), Value::Id("p".into()))].into()),
        )
        .unwrap();
    assert!(
        out.complete && out.data.as_array().unwrap().is_empty(),
        "{out:?}"
    );
    assert!(out.tables.contains(&"projects".into()));
}
#[test]
fn raw_schema_cannot_forge_live_caps_indexes_or_whole_rules_and_old_engines_refuse() {
    let b = build(SOURCE);
    for which in 0..4 {
        let mut schema = b.schema.clone();
        let child = schema.tables.get_mut("tasks").unwrap();
        match which {
            0 => child.through.as_mut().unwrap().live = Some(99),
            1 => {
                child.indexes.remove("$liveChildren");
            }
            2 => child.rules.read = snapback4_core::schema::RuleExpr::Allow,
            _ => child.through.as_mut().unwrap().fields.clear(),
        }
        assert!(!snapback4_core::schema::validate(&schema).is_empty());
    }
    let required = snapback4_core::device_protocol::compatibility(&b.schema);
    let mut engine = snapback4_core::device_protocol::DeviceEngine::current();
    assert!(snapback4_core::device_protocol::check(Some(&engine), &required).is_ok());
    engine.capabilities.retain(|c| c != "live-parent-copy-v1");
    assert_eq!(
        snapback4_core::device_protocol::check(Some(&engine), &required)
            .unwrap_err()
            .code,
        "E_DEVICE_VERSION"
    );
    let costly = build(&SOURCE.replace("cap 2 by project", "cap 2000 by project"));
    assert!(costly.notes.iter().any(|n| n.code == "N_LIVE_PARENT_COST"));
}
#[test]
fn complete_or_parent_rule_and_extra_probe_equalities_stay_live_online() {
    let source = SOURCE
        .replace(
            "  owner: principal",
            "  owner: principal\n  support: principal",
        )
        .replace(
            "read <- .owner = viewer",
            "read <- .owner = viewer or .support = viewer or exists staff[viewer, role = 'head']",
        )
        .replace("  sync\n", "  online only\n");
    let source = format!(
        "table staff:\n  principal: principal\n  role: enum('head', 'other')\n  unique principal\n  read <- .principal = viewer\n  online only\n{source}"
    );
    let b = build(&source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let rows = [
        ("staff", json!({"id":"s","principal":"carol","role":"head"})),
        (
            "projects",
            json!({"id":"p","owner":"alice","support":"bob"}),
        ),
        ("tasks", json!({"id":"c","project":"p","body":"private"})),
    ]
    .into_iter()
    .map(|(t, row)| {
        (
            t.into(),
            wire::row_from_json(&e.schema().tables[t], &row).unwrap(),
        )
    })
    .collect::<Vec<_>>();
    e.seed(rows).unwrap();
    for who in ["alice", "bob", "carol"] {
        assert!(visible(&mut e, who));
    }
    assert!(!visible(&mut e, "dave"));
    transfer(&mut e, "dave");
    assert!(!visible(&mut e, "alice"));
    for who in ["bob", "carol", "dave"] {
        assert!(visible(&mut e, who));
    }
    let bad = source.replace(
        "  role: enum('head', 'other')",
        "  role: enum('head', 'other')\n  until: time ?\n  expire at .until",
    );
    assert!(
        compile(&[("schema.q".into(), bad)])
            .diagnostics
            .iter()
            .any(|d| d.code == "E_READ_THROUGH")
    );
}
#[test]
fn dormant_narrowed_live_rows_restamp_after_a_parent_move() {
    use snapback4_core::engine::release::ReleaseActivation;
    let wide = SOURCE.replace(
        "  body: text <=80",
        "  status: enum('active', 'draft') default 'draft'\n  body: text <=80",
    );
    let b = build(&wide);
    let mut e = Engine::new_release(
        snapback4_core::Store::memory().unwrap(),
        b.schema,
        b.programs.into_iter().map(|p| p.program),
        1,
        None,
    )
    .unwrap();
    let rows = [
        ("projects", json!({"id":"p","owner":"alice"})),
        (
            "tasks",
            json!({"id":"c","project":"p","status":"draft","body":"private"}),
        ),
    ]
    .into_iter()
    .map(|(t, row)| {
        (
            t.into(),
            wire::row_from_json(&e.schema().tables[t], &row).unwrap(),
        )
    })
    .collect::<Vec<_>>();
    e.seed(rows).unwrap();
    let narrow = wide.replace(
        "enum('active', 'draft') default 'draft'",
        "enum('active') default 'active'",
    );
    let b = build(&narrow);
    e.adopt_release(
        b.schema,
        b.programs.into_iter().map(|p| p.program),
        &ReleaseActivation::new(2, Some(1)),
        false,
    )
    .unwrap();
    assert!(!visible(&mut e, "alice"));
    transfer(&mut e, "bob");
    let b = build(&wide);
    e.adopt_release(
        b.schema,
        b.programs.into_iter().map(|p| p.program),
        &ReleaseActivation::new(3, Some(2)),
        false,
    )
    .unwrap();
    assert!(!visible(&mut e, "alice"));
    assert!(visible(&mut e, "bob"));
}

#[test]
fn bulk_duplicate_images_replace_indexes_and_cap_failures_roll_back() {
    let mut e = engine();
    let rows = [
        ("projects", json!({"id":"p","owner":"bob"})),
        ("projects", json!({"id":"p","owner":"carol"})),
    ]
    .into_iter()
    .map(|(n, row)| {
        (
            n.into(),
            wire::row_from_json(&e.schema().tables[n], &row).unwrap(),
        )
    })
    .collect::<Vec<_>>();
    e.load_trusted(rows).unwrap();
    assert!(!visible(&mut e, "alice"));
    assert!(!visible(&mut e, "bob"));
    assert!(visible(&mut e, "carol"));
    let rows = [
        ("projects", json!({"id":"p","owner":"mallory"})),
        ("tasks", json!({"id":"d","project":"p","body":"second"})),
        ("tasks", json!({"id":"e","project":"p","body":"third"})),
    ]
    .into_iter()
    .map(|(n, row)| {
        (
            n.into(),
            wire::row_from_json(&e.schema().tables[n], &row).unwrap(),
        )
    })
    .collect::<Vec<_>>();
    assert!(e.load_trusted(rows).is_err());
    assert!(visible(&mut e, "carol"));
    assert!(!visible(&mut e, "mallory"));
}
