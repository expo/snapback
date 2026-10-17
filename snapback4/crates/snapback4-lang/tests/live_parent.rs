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
