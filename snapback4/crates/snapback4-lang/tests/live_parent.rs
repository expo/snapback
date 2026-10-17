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
    assert!(visible(&mut e,"alice"));assert!(!visible(&mut e,"bob"));
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
    e.seed_delete("staff", "s").unwrap();
    assert!(!visible(&mut e, "carol"));
    assert!(visible(&mut e, "bob"));
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

#[test]
fn live_parent_deletion_cannot_cross_a_physical_child_lifetime() {
    let source = SOURCE.replace(
        "  update <- allow\n  sync",
        "  update <- allow\n  delete <- allow\n  sync",
    );
    let mut e = seeded(&source, "alice", false);
    let out = e
        .mutate(
            "removeProject",
            None,
            Context::new("alice", [("project".into(), Value::Id("p".into()))].into()),
        )
        .unwrap();
    assert!(
        matches!(out.state,WriteState::Failed{ref why,..} if why.code=="E_PARENT_HAS_CHILDREN"),
        "{out:?}"
    );
    assert!(visible(&mut e, "alice"));
    e.seed_delete("tasks", "c").unwrap();
    e.seed_delete("projects", "p").unwrap();
    let rows = [
        ("projects", json!({"id":"p","owner":"mallory"})),
        ("tasks", json!({"id":"c","project":"p","body":"private"})),
    ]
    .into_iter()
    .map(|(n, row)| {
        (
            n.into(),
            wire::row_from_json(&e.schema().tables[n], &row).unwrap(),
        )
    })
    .collect::<Vec<_>>();
    e.seed(rows).unwrap();
    assert!(visible(&mut e, "mallory"));
    assert!(!visible(&mut e, "alice"));
}

#[test]
fn whole_dormant_live_table_restores_manual_authority_from_current_parent() {
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
    let removed = format!(
        "{}mutation transfer(project: projects, owner: principal):\n  update projects[project] {{ owner }}\n",
        SOURCE.split("table tasks:").next().unwrap()
    );
    let b = build(&removed);
    e.adopt_release(
        b.schema,
        b.programs.into_iter().map(|p| p.program),
        &ReleaseActivation::new(3, Some(2)),
        false,
    )
    .unwrap();
    transfer(&mut e, "bob");
    let b = build(&manual());
    e.adopt_release(
        b.schema,
        b.programs.into_iter().map(|p| p.program),
        &ReleaseActivation::new(4, Some(3)),
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
fn unrelated_sequence_restoration_advances_its_counter_in_a_live_schema() {
    let source = format!(
        "{SOURCE}\ntable serialScopes:\n  public 'scopes'\n  online only\ntable serialRows:\n  scope: serialScopes\n  ordinal: sequence by scope\n  public 'serials'\n  insert <- allow\n  online only\nmutation nextSerial(scope: serialScopes):\n  return insert serialRows {{ scope }}\n"
    );
    let b = build(&source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let rows = [
        ("serialScopes", json!({"id":"s"})),
        ("serialRows", json!({"id":"r","scope":"s","ordinal":100})),
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
    let out = e
        .mutate(
            "nextSerial",
            None,
            Context::new("alice", [("scope".into(), Value::Id("s".into()))].into()),
        )
        .unwrap();
    assert!(
        matches!(out.state,WriteState::Sent{ref result,..} if result.field("ordinal").unwrap()==&Value::Int(101)),
        "{out:?}"
    );
}
#[test]
fn a_small_restore_ignores_large_unrelated_populations() {
    let source = format!("{SOURCE}\ntable unrelated:\n  public 'unrelated'\n  online only\n");
    let mut e = seeded(&source, "alice", false);
    let table = e.schema().tables["unrelated"].clone();
    {
        let tx = e.store_mut().transaction().unwrap();
        for n in 0..20_000 {
            let row = snapback4_core::value::object([("id", Value::Id(format!("u{n}")))]);
            tx.put("unrelated", &table, &row, None).unwrap();
        }
        tx.commit().unwrap();
    }
    let row = wire::row_from_json(
        &e.schema().tables["projects"],
        &json!({"id":"p","owner":"bob"}),
    )
    .unwrap();
    e.load_trusted([("projects".into(), row)]).unwrap();
    assert!(visible(&mut e, "bob"));
    assert!(!visible(&mut e, "alice"));
}
#[test]
fn captured_only_adoption_preserves_actual_small_row_compatibility() {
    let source = SOURCE
        .replace("read through live .project", "read through .project")
        .replace(
            "  owner: principal",
            "  owner: principal\n  immutable owner",
        )
        .replace("  body: text <=80", "  body: text <=300000");
    let mut e = seeded(&source, "alice", false);
    let b = build(&format!(
        "{source}\ntable unrelated:\n  public 'new'\n  online only\n"
    ));
    e.adopt(b.schema, b.programs.into_iter().map(|p| p.program))
        .unwrap();
    assert!(visible(&mut e, "alice"));
}

#[test]
fn published_manual_copy_recipe_adopts_live_and_back_without_changing_row_ids() {
    use snapback4_core::engine::release::ReleaseActivation;
    let blocks=snapback4_lang::guide::quarry(snapback4_lang::guide::card("rule-recipes").unwrap());
    let manual=blocks.iter().find(|s|s.contains("table rosterFolders:")).unwrap();
    let mut live=blocks.iter().find(|s|s.contains("table liveRosterFolders:")).unwrap().to_string();
    for (from,to) in [("liveDepartments","departments"),("liveDepartmentRoster","departmentRoster"),("liveRosterFolders","rosterFolders"),("liveRosterFiles","rosterFiles"),("addLiveRosterFile","addRosterFile"),("transferLiveRosterFolder","transferRosterFolder"),("liveRosterFile","rosterFile")] {live=live.replace(from,to);}
    let b=build(manual);let mut e=Engine::new_release(snapback4_core::Store::memory().unwrap(),b.schema,b.programs.into_iter().map(|p|p.program),1,None).unwrap();
    let rows=[("departments",json!({"id":"old","title":"Old"})),("departments",json!({"id":"new","title":"New"})),("departmentRoster",json!({"id":"a","department":"old","principal":"dev:alice"})),("departmentRoster",json!({"id":"b","department":"new","principal":"dev:bob"})),("rosterFolders",json!({"id":"p","department":"old"})),("rosterFiles",json!({"id":"c","folder":"p","department":"old","body":"private"}))].into_iter().map(|(n,row)|(n.into(),wire::row_from_json(&e.schema().tables[n],&row).unwrap())).collect::<Vec<_>>();e.seed(rows).unwrap();
    let b=build(&live);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();
    let out=e.mutate("transferRosterFolder",None,Context::new("service:ops",[("folder".into(),Value::Id("p".into())),("department".into(),Value::Id("new".into()))].into())).unwrap();assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");
    for (who,yes) in [("dev:alice",false),("dev:bob",true)] {let out=e.query("rosterFile",Context::new(who,[("file".into(),Value::Id("c".into()))].into())).unwrap();assert_eq!(out.data!=Value::Null,yes);if yes {assert!(out.data.field("department").is_err());}}
    let b=build(manual);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(3,Some(2)),false).unwrap();
    let out=e.query("rosterFile",Context::new("dev:bob",[("file".into(),Value::Id("c".into()))].into())).unwrap();assert_eq!(out.data.field("department").unwrap(),&Value::Id("new".into()));
    let out=e.query("rosterFile",Context::new("dev:alice",[("file".into(),Value::Id("c".into()))].into())).unwrap();assert_eq!(out.data,Value::Null);
}

#[test]
fn dormant_bad_manual_copy_cannot_silently_adopt_live() {
    use snapback4_core::engine::release::ReleaseActivation;
    let mut e=seeded(&manual(),"bob",true);
    let removed=format!("{}mutation transfer(project: projects, owner: principal):\n  update projects[project] {{ owner }}\n",SOURCE.split("table tasks:").next().unwrap());
    let b=build(&removed);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();
    let generation=e.generation();let b=build(SOURCE);let error=e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(3,Some(2)),false).unwrap_err();
    assert_eq!(error.code(),"E_READ_THROUGH_ADOPT");assert_eq!(e.generation(),generation);
}
#[test]
fn narrowed_live_provenance_survives_an_intermediate_manual_release() {
    use snapback4_core::engine::release::ReleaseActivation;
    let wide=SOURCE.replace("  body: text <=80","  owner: principal default 'alice'\n  status: enum('active', 'draft') default 'draft'\n  body: text <=80");
    let mut e=seeded(&wide,"alice",true);
    let narrow=wide.replace("enum('active', 'draft') default 'draft'","enum('active') default 'active'");
    let b=build(&narrow);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();transfer(&mut e,"bob");
    let manual_narrow=narrow.replace("read through live .project","read <- .owner = viewer");
    let b=build(&manual_narrow);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(3,Some(2)),false).unwrap();
    let manual_wide=wide.replace("read through live .project","read <- .owner = viewer");
    let b=build(&manual_wide);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(4,Some(3)),false).unwrap();assert!(!visible(&mut e,"alice"));assert!(visible(&mut e,"bob"));
}
#[test]
fn null_reference_cap_exemptions_survive_mixed_schema_restore() {
    let source=format!("{SOURCE}\ntable looseParents:\n  public 'parents'\n  online only\ntable looseRows:\n  parent: looseParents ? on delete set null\n  cap 1 by parent\n  public 'rows'\n  online only\n");
    let mut e=seeded(&source,"alice",false);
    let rows=[("looseParents",json!({"id":"a"})),("looseParents",json!({"id":"b"})),("looseRows",json!({"id":"a","parent":"a"})),("looseRows",json!({"id":"b","parent":"b"}))].into_iter().map(|(n,row)|(n.into(),wire::row_from_json(&e.schema().tables[n],&row).unwrap())).collect::<Vec<_>>();e.seed(rows).unwrap();e.seed_delete("looseParents","a").unwrap();e.seed_delete("looseParents","b").unwrap();
    let row=wire::row_from_json(&e.schema().tables["looseRows"],&json!({"id":"a","parent":null})).unwrap();e.load_trusted([("looseRows".into(),row)]).unwrap();
}
#[test]
fn bulk_restore_reserves_all_index_vectors_before_put() {
    use snapback4_core::schema::{Index,ColumnType,public_table};
    let b=build(SOURCE);let mut schema=b.schema;
    let mut table=public_table([("id".into(),ColumnType::Id),("body".into(),ColumnType::Bytes{max:900})].into(),[("byId".into(),Index::of(&["id"],true))].into());
    for n in 0..6000 {table.indexes.insert(format!("byBody{n}"),Index::of(&["body"],false));}
    schema.tables.insert("wideIndexes".into(),table.clone());let mut e=Engine::memory(schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let old=snapback4_core::value::object([("id",Value::Id("r".into())),("body",Value::Bytes(vec![0;900]))]);
    {let tx=e.store_mut().transaction().unwrap();tx.put("wideIndexes",&table,&old,None).unwrap();tx.commit().unwrap();}
    let mut bytes=vec![0;900];bytes[899]=1;let row=snapback4_core::value::object([("id",Value::Id("r".into())),("body",Value::Bytes(bytes))]);
    let error=e.load_trusted([("wideIndexes".into(),row)]).unwrap_err();assert_eq!(error.code(),"E_BOUND");
    let tx=e.store_mut().transaction().unwrap();assert_eq!(tx.get("wideIndexes","r").unwrap(),Some(old));tx.rollback().unwrap();
}
#[test]
fn unchanged_captured_policy_does_not_enumerate_its_population_on_restore() {
    let source=format!("{SOURCE}\ntable capturedParents:\n  owner: principal\n  immutable owner\n  read <- .owner = viewer\n  online only\ntable capturedRows:\n  parent: capturedParents\n  immutable parent\n  read through .parent\n  online only\n");
    let mut e=seeded(&source,"alice",false);let p=wire::row_from_json(&e.schema().tables["capturedParents"],&json!({"id":"r","owner":"alice"})).unwrap();e.seed([("capturedParents".into(),p.clone())]).unwrap();
    let table=e.schema().tables["capturedRows"].clone();
    {let tx=e.store_mut().transaction().unwrap();for n in 0..20_000 {let mut fields=std::collections::BTreeMap::from([("id".into(),Value::Id(format!("c{n}"))),("parent".into(),Value::Id("r".into())),("$parentDeadline".into(),Value::Null)]);for field in table.through.as_ref().unwrap().fields.keys() {fields.insert(field.clone(),Value::Id("alice".into()));}let mut row=Value::Row(fields.into());table.recompute_deadline(&mut row).unwrap();tx.put("capturedRows",&table,&row,None).unwrap();}tx.commit().unwrap();}
    e.load_trusted([("capturedParents".into(),p)]).unwrap();
    let changed=wire::row_from_json(&e.schema().tables["capturedParents"],&json!({"id":"r","owner":"bob"})).unwrap();assert!(e.load_trusted([("capturedParents".into(),changed)]).is_err());
}

#[test]
fn expiring_cap_uses_live_occupancy_during_mixed_schema_restore() {
    let source=format!("{SOURCE}\ntable expiringCapRows:\n  owner: principal\n  until: time\n  expire at .until\n  cap 1 by owner\n  public 'cap rows'\n  online only\n");let mut e=seeded(&source,"alice",false);let future=snapback4_core::now_ms()+60000;
    let rows=[json!({"id":"old","owner":"alice","until":0}),json!({"id":"current","owner":"alice","until":future})].into_iter().map(|row|("expiringCapRows".into(),wire::row_from_json(&e.schema().tables["expiringCapRows"],&row).unwrap())).collect::<Vec<_>>();e.seed(rows).unwrap();
    let row=wire::row_from_json(&e.schema().tables["expiringCapRows"],&json!({"id":"current","owner":"alice","until":future})).unwrap();e.load_trusted([("expiringCapRows".into(),row)]).unwrap();
    let row=wire::row_from_json(&e.schema().tables["expiringCapRows"],&json!({"id":"extra","owner":"alice","until":future})).unwrap();assert!(e.load_trusted([("expiringCapRows".into(),row)]).is_err());
}

#[test]
fn raw_live_rule_literals_obey_scalar_admission() {
    use snapback4_core::schema::{RuleExpr,RuleTerm};
    let mut schema=build(SOURCE).schema;let term=RuleTerm::Literal(Value::Array(vec![Value::Int(1)].into()));schema.tables.get_mut("projects").unwrap().rules.read=RuleExpr::Eq(term.clone(),term);
    assert!(snapback4_core::schema::live::validate(&schema).iter().any(|e|e.message.contains("direct scalar")));
}

#[test]
fn adoption_reserves_destination_index_sets_before_live_callback() {
    use snapback4_core::schema::{Index,ColumnType};
    let b=build(SOURCE);let mut schema=b.schema;schema.tables.get_mut("tasks").unwrap().columns.insert("blob".into(),ColumnType::Bytes{max:800});
    let mut e=Engine::memory(schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let rows=[("projects".into(),snapback4_core::value::object([("id",Value::Id("p".into())),("owner",Value::Id("alice".into()))])),("tasks".into(),snapback4_core::value::object([("id",Value::Id("c".into())),("project",Value::Id("p".into())),("body",Value::String("private".into())),("blob",Value::Bytes(vec![0;800]))]))];e.seed(rows).unwrap();let generation=e.generation();
    let mut next=e.schema().clone();for n in 0..6000 {next.tables.get_mut("tasks").unwrap().indexes.insert(format!("byBlob{n}"),Index::of(&["blob"],false));}
    let programs=e.programs().cloned().collect::<Vec<_>>();let error=e.adopt(next,programs).unwrap_err();assert_eq!(error.code(),"E_BOUND");assert_eq!(e.generation(),generation);assert!(visible(&mut e,"alice"));
}
#[test]
fn cap_restore_selects_a_plain_index_instead_of_word_entries() {
    use snapback4_core::schema::{Index,IndexComponent,ColumnType,Constraint,public_table};
    let b=build(SOURCE);let mut schema=b.schema;
    let mut table=public_table([("id".into(),ColumnType::Id),("owner".into(),ColumnType::Principal),("body".into(),ColumnType::Text{max:40})].into(),[("byId".into(),Index::of(&["id"],true)),("zOwner".into(),Index::of(&["owner","id"],false))].into());
    table.indexes.insert("aWords".into(),Index{components:vec![IndexComponent::Column("owner".into()),IndexComponent::WordPrefixes{fields:vec!["body".into()],contract:serde_json::Value::String(snapback4_core::words::CONTRACT.into())},IndexComponent::Column("id".into())],unique:false});table.constraints.push(Constraint::Cap{by:vec!["owner".into()],max:1});schema.tables.insert("wordCaps".into(),table);
    let mut e=Engine::memory(schema,b.programs.into_iter().map(|p|p.program)).unwrap();let row=snapback4_core::value::object([("id",Value::Id("r".into())),("owner",Value::Id("alice".into())),("body",Value::String("one two".into()))]);e.load_trusted([("wordCaps".into(),row)]).unwrap();
}
#[test]
fn dormant_live_cap_changes_restamp_current_authority_and_validate_occupancy() {
    use snapback4_core::engine::release::ReleaseActivation;
    let mut e=seeded(SOURCE,"alice",true);
    let removed=format!("{}mutation transfer(project: projects, owner: principal):\n  update projects[project] {{ owner }}\n",SOURCE.split("table tasks:").next().unwrap());
    let b=build(&removed);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();transfer(&mut e,"bob");
    let b=build(&SOURCE.replace("cap 2 by project","cap 3 by project"));e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(3,Some(2)),false).unwrap();assert!(!visible(&mut e,"alice"));assert!(visible(&mut e,"bob"));
    let row=wire::row_from_json(&e.schema().tables["tasks"],&json!({"id":"d","project":"p","body":"second"})).unwrap();e.seed([("tasks".into(),row)]).unwrap();let generation=e.generation();let b=build(&SOURCE.replace("cap 2 by project","cap 1 by project"));assert!(e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(4,Some(3)),false).is_err());assert_eq!(e.generation(),generation);assert!(visible(&mut e,"bob"));
}
#[test]
fn restored_live_provenance_cannot_become_historical_captured_authority() {
    use snapback4_core::engine::release::ReleaseActivation;
    let wide=SOURCE.replace("  body: text <=80","  owner: principal default 'alice'\n  status: enum('active', 'draft') default 'draft'\n  body: text <=80");let mut e=seeded(&wide,"alice",true);
    let narrow=wide.replace("enum('active', 'draft') default 'draft'","enum('active') default 'active'");let b=build(&narrow);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();transfer(&mut e,"bob");
    let b=build(&narrow.replace("read through live .project","read <- .owner = viewer"));e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(3,Some(2)),false).unwrap();
    let captured=wide.replace("read through live .project","read through .project").replace("  owner: principal\n  read", "  owner: principal\n  immutable owner\n  read");let b=build(&captured);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(4,Some(3)),false).unwrap();assert!(!visible(&mut e,"alice"));assert!(visible(&mut e,"bob"));
}
#[test]
fn raw_live_constraints_cannot_depend_on_mutable_engine_inputs() {
    use snapback4_core::schema::{Index,Constraint};
    for which in 0..3 {let mut schema=build(SOURCE).schema;let t=schema.tables.get_mut("tasks").unwrap();match which {
        0=>{t.indexes.insert("uniquePolicy".into(),Index::of(&["$project.owner"],true));},
        1=>{t.indexes.insert("capPolicy".into(),Index::of(&["$project.owner","id"],false));t.constraints.push(Constraint::Cap{by:vec!["$project.owner".into()],max:1});},
        _=>t.constraints.push(Constraint::Immutable{fields:vec!["$project.owner".into()]}),
    }assert!(snapback4_core::schema::validate(&schema).iter().any(|e|e.message.contains("authored cells")));}
}

#[test]
fn dormant_captured_to_live_requires_current_copy_agreement() {
    use snapback4_core::engine::release::ReleaseActivation;
    let captured=SOURCE.replace("read through live .project","read through .project").replace("  owner: principal\n  read","  owner: principal\n  immutable owner\n  read");
    for changed in [false,true] {let mut e=seeded(&captured,"alice",true);
        let removed=format!("{}mutation transfer(project: projects, owner: principal):\n  update projects[project] {{ owner }}\n",SOURCE.split("table tasks:").next().unwrap());let b=build(&removed);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();if changed {transfer(&mut e,"bob");}
        let generation=e.generation();let b=build(SOURCE);let out=e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(3,Some(2)),false);
        if changed {assert_eq!(out.unwrap_err().code(),"E_READ_THROUGH_ADOPT");assert_eq!(e.generation(),generation);}else{out.unwrap();transfer(&mut e,"bob");assert!(!visible(&mut e,"alice"));assert!(visible(&mut e,"bob"));}
    }
}

#[test]
fn empty_live_edge_does_not_reprice_an_unrelated_captured_population() {
    let captured=SOURCE.replace("read through live .project","read through .project").replace("  owner: principal\n  read","  owner: principal\n  immutable owner\n  read").replace("  body: text <=80","  body: text <=300000");let mut e=seeded(&captured,"alice",false);
    let independent="\ntable independentParents:\n  owner: principal\n  read <- .owner = viewer\n  online only\ntable independentChildren:\n  parent: independentParents\n  immutable parent\n  cap 1 by parent\n  read through live .parent\n  online only\n";
    let b=build(&format!("{captured}{independent}"));e.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();assert!(visible(&mut e,"alice"));
}

#[test]
fn live_to_captured_adoption_prepays_word_index_fanout() {
    use snapback4_core::schema::{Index,IndexComponent,Constraint};
    let mut e=seeded(&SOURCE.replace("text <=80","text <=8000"),"alice",false);
    let generation=e.generation();let mut next=e.schema().clone();
    next.tables.get_mut("projects").unwrap().constraints.push(Constraint::Immutable{fields:vec!["owner".into()]});
    let t=next.tables.get_mut("tasks").unwrap();t.through.as_mut().unwrap().live=None;
    for n in 0..4 {t.indexes.insert(format!("words{n}"),Index{components:vec![IndexComponent::WordPrefixes{fields:vec!["body".into()],contract:serde_json::Value::String(snapback4_core::words::CONTRACT.into())},IndexComponent::Column("id".into())],unique:false});}
    let programs=e.programs().cloned().collect::<Vec<_>>();assert_eq!(e.adopt(next,programs).unwrap_err().code(),"E_BOUND");
    assert_eq!(e.generation(),generation);assert!(visible(&mut e,"alice"));transfer(&mut e,"bob");assert!(visible(&mut e,"bob"));
}

#[test]
fn seed_prepays_source_index_vectors_before_ordinary_upsert() {
    use snapback4_core::schema::{Index,ColumnType,public_table};
    let b=build(SOURCE);let mut schema=b.schema;let mut t=public_table([("id".into(),ColumnType::Id),("body".into(),ColumnType::Bytes{max:900})].into(),[("byId".into(),Index::of(&["id"],true))].into());
    for n in 0..10_000 {t.indexes.insert(format!("byBody{n}"),Index::of(&["body"],false));}
    schema.tables.insert("wideIndexes".into(),t);let mut e=Engine::memory(schema,b.programs.into_iter().map(|p|p.program)).unwrap();let seq=e.seq().unwrap();
    let row=snapback4_core::value::object([("id",Value::Id("r".into())),("body",Value::Bytes(vec![0;900]))]);assert_eq!(e.seed([("wideIndexes".into(),row)]).unwrap_err().code(),"E_BOUND");assert_eq!(e.seq().unwrap(),seq);
    let tx=e.store_mut().transaction().unwrap();assert!(tx.get("wideIndexes","r").unwrap().is_none());tx.rollback().unwrap();
}
#[test]
fn column_only_live_provenance_survives_manual_transfer() {
    use snapback4_core::engine::release::ReleaseActivation;
    let mut e=seeded(SOURCE,"alice",true);let b=build(&manual());e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();
    let rows=[("projects".into(),snapback4_core::value::object([("id",Value::Id("p".into())),("owner",Value::Id("bob".into()))])),("tasks".into(),snapback4_core::value::object([("id",Value::Id("c".into())),("owner",Value::Id("bob".into()))]))];e.seed(rows).unwrap();
    let captured=SOURCE.replace("read through live .project","read through .project").replace("  owner: principal\n  read","  owner: principal\n  immutable owner\n  read");let b=build(&captured);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(3,Some(2)),false).unwrap();assert!(!visible(&mut e,"alice"));assert!(visible(&mut e,"bob"));
}
#[test]
fn dormant_live_columns_do_not_exempt_a_manual_copy_from_forward_agreement() {
    use snapback4_core::engine::release::ReleaseActivation;
    let mut e=seeded(SOURCE,"alice",true);let b=build(&manual());e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();transfer(&mut e,"bob");
    let b=build(SOURCE);assert_eq!(e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(3,Some(2)),false).unwrap_err().code(),"E_READ_THROUGH_ADOPT");assert_eq!(e.generation(),2);assert!(visible(&mut e,"alice"));
}
#[test]
fn narrowed_live_reverse_restoration_admits_current_parent_before_fetch() {
    use snapback4_core::engine::release::ReleaseActivation;
    let wide=SOURCE.replace("  body: text <=80","  owner: principal default 'alice'\n  status: enum('active', 'draft') default 'draft'\n  body: text <=80");let mut e=seeded(&wide,"alice",true);let narrow=wide.replace("enum('active', 'draft') default 'draft'","enum('active') default 'active'");let b=build(&narrow);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();
    let manual=narrow.replace("read through live .project","read <- .owner = viewer").replace("table projects:\n","table projects:\n  payload: text <=21000000 default ''\n");let b=build(&manual);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(3,Some(2)),false).unwrap();
    let row=snapback4_core::value::object([("id",Value::Id("p".into())),("payload",Value::String("x".repeat(20*1024*1024)))]);e.seed([("projects".into(),row)]).unwrap();
    let b=build(&manual.replace("enum('active') default 'active'","enum('active', 'draft') default 'draft'"));assert_eq!(e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(4,Some(3)),false).unwrap_err().code(),"E_BOUND");assert_eq!(e.generation(),3);
}

#[test]
fn reverse_live_authority_reconciles_before_destination_narrowing() {
    use snapback4_core::engine::release::ReleaseActivation;
    let parent="table parents:\n  category: enum('red', 'blue')\n  read <- .category = 'blue'\n  update <- allow\n  online only\n";
    let tail="mutation change(parent: parents):\n  update parents[parent] { category: 'blue' }\nquery one(child: children):\n  return children[child]\n";
    let child="table children:\n  parent: parents\n  category: enum('red', 'blue')\n  status: enum('active', 'draft') default 'draft'\n  immutable parent\n  cap 1 by parent\n  read <- .category = 'blue'\n  online only\n";
    let manual=format!("{parent}{child}{tail}");let live=format!("{parent}{}{tail}",child.replace("  category: enum('red', 'blue')\n","").replace("read <- .category = 'blue'","read through live .parent"));
    for already_narrowed in [false,true] {
        let b=build(&manual);let mut e=Engine::new_release(snapback4_core::Store::memory().unwrap(),b.schema,b.programs.into_iter().map(|p|p.program),1,None).unwrap();
        let rows=[("parents",json!({"id":"p","category":"red"})),("children",json!({"id":"c","parent":"p","category":"red"}))].into_iter().map(|(n,row)|(n.into(),wire::row_from_json(&e.schema().tables[n],&row).unwrap())).collect::<Vec<_>>();e.seed(rows).unwrap();
        let b=build(&live);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();let mut current_generation=2;
        if already_narrowed {let b=build(&live.replace("enum('active', 'draft') default 'draft'","enum('active') default 'active'"));e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(3,Some(2)),false).unwrap();current_generation=3;}
        let out=e.mutate("change",None,Context::new("operator",[("parent".into(),Value::Id("p".into()))].into())).unwrap();assert!(matches!(out.state,WriteState::Sent{..}));
        let target=format!("{parent}{}{tail}",child.replace("category: enum('red', 'blue')","category: enum('blue')"));let b=build(&target);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(current_generation+1,Some(current_generation)),false).unwrap();
        let out=e.query("one",Context::new("operator",[("child".into(),Value::Id("c".into()))].into())).unwrap();assert_ne!(out.data,Value::Null,"already_narrowed={already_narrowed}");assert_eq!(out.data.field("category").unwrap(),&Value::String("blue".into()));
    }
}

#[test]
fn mixed_captured_and_live_cells_keep_independent_origin_after_narrowed_restore() {
    use snapback4_core::engine::release::ReleaseActivation;
    let wide=SOURCE.replace("  body: text <=80","  owner: principal default 'alice'\n  status: enum('active', 'draft') default 'draft'\n  body: text <=80");
    let captured=wide.replace("read through live .project","read through .project").replace("  owner: principal\n  read","  owner: principal\n  immutable owner\n  read");
    for changed_captured_parent in [false,true] {
        let mut e=seeded(&captured,"alice",true);
        let narrow=wide.replace("enum('active', 'draft') default 'draft'","enum('active') default 'active'");let b=build(&narrow);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();
        let rows=[("projects",json!({"id":"p2","owner":"bob"})),("tasks",json!({"id":"c2","project":"p2","owner":"bob","status":"active","body":"private"}))].into_iter().map(|(n,row)|(n.into(),wire::row_from_json(&e.schema().tables[n],&row).unwrap())).collect::<Vec<_>>();e.seed(rows).unwrap();
        let manual=wide.replace("read through live .project","read <- .owner = viewer");let b=build(&manual);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(3,Some(2)),false).unwrap();
        {let tx=e.store_mut().transaction().unwrap();let flags:Vec<(String,i64)>=tx.conn().prepare("SELECT id,live_source FROM _dormant_values WHERE column_name='$project.owner' ORDER BY id").unwrap().query_map([],|r|Ok((r.get(0)?,r.get(1)?))).unwrap().collect::<Result<_,_>>().unwrap();assert_eq!(flags,vec![("c".into(),0),("c2".into(),1)]);tx.rollback().unwrap();}
        let mut rows=vec![("projects".into(),snapback4_core::value::object([("id",Value::Id("p2".into())),("owner",Value::Id("carol".into()))])),("tasks".into(),snapback4_core::value::object([("id",Value::Id("c2".into())),("owner",Value::Id("carol".into()))]))];if changed_captured_parent {rows.push(("projects".into(),snapback4_core::value::object([("id",Value::Id("p".into())),("owner",Value::Id("dave".into()))])));}e.seed(rows).unwrap();
        let b=build(&captured);let out=e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(4,Some(3)),false);
        if changed_captured_parent {assert_eq!(out.unwrap_err().code(),"E_ADOPT");assert_eq!(e.generation(),3);}else{out.unwrap();for (who,yes) in [("alice",false),("bob",false),("carol",true)] {let out=e.query("one",Context::new(who,[("task".into(),Value::Id("c2".into()))].into())).unwrap();assert_eq!(out.data!=Value::Null,yes);}assert!(visible(&mut e,"alice"));}
    }
}
#[test]
fn captured_only_store_adopts_live_after_dormant_cell_format_upgrade() {
    use snapback4_core::engine::release::ReleaseActivation;
    let mut e=seeded(&manual(),"alice",true);
    {let tx=e.store_mut().transaction().unwrap();tx.conn().execute_batch("ALTER TABLE _dormant_values DROP COLUMN live_source").unwrap();tx.commit().unwrap();}
    let b=build(SOURCE);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();transfer(&mut e,"bob");
    let b=build(&manual());e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(3,Some(2)),false).unwrap();assert!(!visible(&mut e,"alice"));assert!(visible(&mut e,"bob"));
}

#[test]
fn reverse_manual_correspondence_cannot_rewrite_immutable_parent_binding() {
    use snapback4_core::engine::release::ReleaseActivation;
    let source="table projects:\n  owner: projects\n  read <- exists access[.owner, viewer]\n  online only\ntable access:\n  project: projects\n  principal: principal\n  unique project, principal\n  read <- .principal = viewer\n  online only\ntable tasks:\n  project: projects\n  status: enum('active', 'draft') default 'draft'\n  immutable project\n  cap 2 by project\n  read through live .project\n  online only\nquery one(task: tasks):\n  return tasks[task]\n";
    for dormant in [false,true] {
        let b=build(source);let mut e=Engine::new_release(snapback4_core::Store::memory().unwrap(),b.schema,b.programs.into_iter().map(|p|p.program),1,None).unwrap();
        let rows=[("projects",json!({"id":"q","owner":"q"})),("projects",json!({"id":"p","owner":"q"})),("access",json!({"id":"a","project":"q","principal":"alice"})),("tasks",json!({"id":"c","project":"p"}))].into_iter().map(|(n,row)|(n.into(),wire::row_from_json(&e.schema().tables[n],&row).unwrap())).collect::<Vec<_>>();e.seed(rows).unwrap();let mut generation=1;
        if dormant {let b=build(&source.replace("enum('active', 'draft') default 'draft'","enum('active') default 'active'"));e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();generation=2;}
        let b=build(&source.replace("read through live .project","read <- exists access[.project, viewer]"));let error=e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(generation+1,Some(generation)),false).unwrap_err();assert_eq!(error.code(),"E_READ_THROUGH_ADOPT");assert!(error.to_string().contains("immutable parent binding"));assert_eq!(e.generation(),generation);
        let out=e.query("one",Context::new("alice",[("task".into(),Value::Id("c".into()))].into())).unwrap();if dormant {assert_eq!(out.data,Value::Null);}else{assert_eq!(out.data.field("project").unwrap(),&Value::Id("p".into()));}
    }
}

#[test]
fn reverse_manual_adoption_reserves_destination_index_sets() {
    use snapback4_core::schema::{Index,ColumnType};
    let b=build(SOURCE);let mut schema=b.schema;schema.tables.get_mut("tasks").unwrap().columns.insert("blob".into(),ColumnType::Bytes{max:800});let mut e=Engine::memory(schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let rows=[("projects".into(),snapback4_core::value::object([("id",Value::Id("p".into())),("owner",Value::Id("alice".into()))])),("tasks".into(),snapback4_core::value::object([("id",Value::Id("c".into())),("project",Value::Id("p".into())),("body",Value::String("private".into())),("blob",Value::Bytes(vec![0;800]))]))];e.seed(rows).unwrap();let generation=e.generation();
    let b=build(&manual());let mut next=b.schema;let t=next.tables.get_mut("tasks").unwrap();t.columns.insert("blob".into(),ColumnType::Bytes{max:800});for n in 0..6000 {t.indexes.insert(format!("byBlob{n}"),Index::of(&["blob"],false));}
    assert_eq!(e.adopt(next,b.programs.into_iter().map(|p|p.program)).unwrap_err().code(),"E_BOUND");assert_eq!(e.generation(),generation);assert!(visible(&mut e,"alice"));transfer(&mut e,"bob");assert!(visible(&mut e,"bob"));
}

#[test]
fn dormant_live_cells_require_immediate_manual_agreement_for_captured_adoption() {
    use snapback4_core::engine::release::ReleaseActivation;
    let captured=SOURCE.replace("read through live .project","read through .project").replace("  owner: principal\n  read","  owner: principal\n  immutable owner\n  read");
    for narrowed in [false,true] {
        let live=SOURCE.replace("  body: text <=80","  status: enum('active', 'draft') default 'draft'\n  body: text <=80");let mut e=seeded(&live,"alice",true);
        let manual=manual().replace("  body: text <=80","  status: enum('active', 'draft') default 'draft'\n  body: text <=80");let b=build(&manual);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();
        let mut generation=2;
        if narrowed {let b=build(&manual.replace("enum('active', 'draft') default 'draft'","enum('active') default 'active'"));e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(3,Some(2)),false).unwrap();generation=3;}
        transfer(&mut e,"bob");let b=build(&captured);let err=e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(generation+1,Some(generation)),false).unwrap_err();assert_eq!(err.code(),"E_READ_THROUGH_ADOPT","narrowed={narrowed}: {err}");assert_eq!(e.generation(),generation);
    }
}

#[test]
fn narrowed_manual_source_does_not_become_live_from_column_shape() {
    use snapback4_core::engine::release::ReleaseActivation;
    let wide=SOURCE.replace("  body: text <=80","  status: enum('active', 'draft') default 'draft'\n  body: text <=80");let mut e=seeded(&wide,"alice",true);
    let manual=manual().replace("  body: text <=80","  status: enum('active', 'draft') default 'draft'\n  body: text <=80");let b=build(&manual);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();
    let captured=wide.replace("read through live .project","read through .project").replace("  owner: principal\n  read","  owner: principal\n  immutable owner\n  read");let b=build(&captured.replace("enum('active', 'draft') default 'draft'","enum('active') default 'active'"));e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(3,Some(2)),false).unwrap();
    {let tx=e.store_mut().transaction().unwrap();let source:String=tx.conn().query_row("SELECT definition FROM _dormant_narrow_rows WHERE id='c'",[],|r|r.get(0)).unwrap();let old:snapback4_core::schema::Table=serde_json::from_str(&source).unwrap();assert!(old.through.is_none());tx.rollback().unwrap();}
    // Reintroduce mutable parent writes while the row remains dormant.
    let b=build(&manual.replace("enum('active', 'draft') default 'draft'","enum('active') default 'active'"));e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(4,Some(3)),false).unwrap();transfer(&mut e,"bob");
    let b=build(&captured);assert_eq!(e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(5,Some(4)),false).unwrap_err().code(),"E_READ_THROUGH_ADOPT");assert_eq!(e.generation(),4);
}

#[test]
fn live_policy_reference_does_not_bind_a_retired_audience_lifetime() {
    use snapback4_core::engine::release::ReleaseActivation;
    let source="table departments:\n  owner: principal\n  read <- .owner = viewer\n  online only\ntable projects:\n  department: departments\n  read <- exists members[.department, viewer]\n  online only\ntable members:\n  department: departments\n  principal: principal\n  unique department, principal\n  read <- .principal = viewer\n  online only\ntable tasks:\n  project: projects\n  status: enum('active', 'draft') default 'draft'\n  immutable project\n  cap 2 by project\n  read through live .project\n  online only\nquery one(task: tasks):\n  return tasks[task]\n";
    let b=build(source);let mut e=Engine::new_release(snapback4_core::Store::memory().unwrap(),b.schema,b.programs.into_iter().map(|p|p.program),1,None).unwrap();
    let rows=[("departments",json!({"id":"a","owner":"alice"})),("departments",json!({"id":"b","owner":"bob"})),("projects",json!({"id":"p","department":"a"})),("members",json!({"id":"ma","department":"a","principal":"alice"})),("members",json!({"id":"mb","department":"b","principal":"bob"})),("tasks",json!({"id":"c","project":"p"}))].into_iter().map(|(n,row)|(n.into(),wire::row_from_json(&e.schema().tables[n],&row).unwrap())).collect::<Vec<_>>();e.seed(rows).unwrap();
    let b=build(&source.replace("enum('active', 'draft') default 'draft'","enum('active') default 'active'"));e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();
    e.seed([("projects".into(),snapback4_core::value::object([("id",Value::Id("p".into())),("department",Value::Id("b".into()))]))]).unwrap();
    {let table=e.schema().tables["departments"].clone();let tx=e.store_mut().transaction().unwrap();let row=tx.get("departments","a").unwrap().unwrap();tx.delete("departments",&table,&row).unwrap();tx.commit().unwrap();}
    let b=build(source);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(3,Some(2)),false).unwrap();for (who,yes) in [("alice",false),("bob",true)] {let out=e.query("one",Context::new(who,[("task".into(),Value::Id("c".into()))].into())).unwrap();assert_eq!(out.data!=Value::Null,yes);}
}

#[test]
fn unused_live_cell_does_not_replace_a_captured_rows_own_audience() {
    use snapback4_core::engine::release::ReleaseActivation;
    let wide=SOURCE.replace("  sync\n","  online only\n").replace("  body: text <=80","  status: enum('active', 'draft') default 'draft'\n  body: text <=80").replace("  owner: principal\n  read","  owner: principal\n  label: enum('visible', 'hidden') default 'visible'\n  read");
    let both=wide.replace("read <- .owner = viewer","read <- .owner = viewer and .label = 'visible'");
    let captured=wide.replace("read through live .project","read through .project").replace("  owner: principal\n","  owner: principal\n  immutable owner\n");
    let narrow=captured.replace("enum('active', 'draft') default 'draft'","enum('active') default 'active'");
    for changed_owner in [false,true] {
        let mut e=seeded(&both,"alice",true);let b=build(&captured);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();
        let b=build(&narrow);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(3,Some(2)),false).unwrap();
        let manual=manual().replace("  sync\n","  online only\n").replace("  body: text <=80","  status: enum('active') default 'active'\n  body: text <=80").replace("  owner: principal\n  read","  owner: principal\n  label: enum('visible', 'hidden') default 'visible'\n  read");let b=build(&manual);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(4,Some(3)),false).unwrap();
        let owner=if changed_owner {"bob"} else {"alice"};e.seed([("projects".into(),snapback4_core::value::object([("id",Value::Id("p".into())),("owner",Value::Id(owner.into())),("label",Value::String("hidden".into()))]))]).unwrap();
        let target=captured.replace("read <- .owner = viewer","read <- .owner = viewer and .label = 'hidden'").replace("  label: enum('visible', 'hidden') default 'visible'","  label: enum('visible', 'hidden') default 'visible'\n  immutable label");let b=build(&target);let out=e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(5,Some(4)),false);
        // Captured-definition changes retain their existing explicit bridge refusal.
        assert_eq!(out.unwrap_err().code(),"E_ADOPT");assert_eq!(e.generation(),4);
    }
}

#[test]
fn captured_only_narrowed_rollback_keeps_actual_image_admission() {
    use snapback4_core::engine::release::ReleaseActivation;
    let captured=SOURCE.replace("read through live .project","read through .project").replace("  owner: principal\n  read","  owner: principal\n  immutable owner\n  read").replace("  body: text <=80","  status: enum('active', 'draft') default 'draft'\n  body: text <=300000");
    let independent="\ntable independentParents:\n  owner: principal\n  read <- .owner = viewer\n  online only\ntable independentChildren:\n  parent: independentParents\n  immutable parent\n  cap 1 by parent\n  read through live .parent\n  online only\n";
    for extra in ["",independent] {
        let mut e=seeded(&captured,"alice",true);let narrow=format!("{}{extra}",captured.replace("enum('active', 'draft') default 'draft'","enum('active') default 'active'"));let b=build(&narrow);e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(2,Some(1)),false).unwrap();assert!(!visible(&mut e,"alice"));
        let b=build(&format!("{captured}{extra}"));e.adopt_release(b.schema,b.programs.into_iter().map(|p|p.program),&ReleaseActivation::new(3,Some(2)),false).unwrap();assert!(visible(&mut e,"alice"));
    }
}
