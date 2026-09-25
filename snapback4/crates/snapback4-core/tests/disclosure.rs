#[path = "disclosure/cases.rs"]
mod cases;
#[path = "disclosure/mod.rs"]
mod disclosure;
fn check_pairs(pairs: impl IntoIterator<Item = disclosure::Pair>) {
    let mut failed = 0;
    for (n, pair) in pairs.into_iter().enumerate() {
        if std::panic::catch_unwind(|| pair.assert_equal()).is_err() {
            eprintln!("pair {n}: {}", pair.operations[0].name);
            failed += 1;
        }
    }
    assert_eq!(failed, 0, "pairs with differences");
}
#[test]
fn written_by_payload_channels() {
    check_pairs(cases::payload_pairs());
}
#[test]
fn written_by_hidden_existence_and_owner_channels() {
    check_pairs(cases::hidden_pairs());
}
#[test]
fn following_private_inputs() {
    for compat in [false, true] {
        for private in ["at: time", "removed: bool default false"] {
            let pair = cases::following(private, compat);
            let b = snapback4_lang::compile(&[("pair.q".into(), pair.source.clone())]);
            if b.diagnostics.is_empty() {
                pair.assert_equal();
                panic!("private timeline input admitted");
            }
            assert!(
                b.diagnostics
                    .iter()
                    .any(|d| d.code == "E_FIELD_AUTHORITY"
                        && d.rewrite.contains("readable by audience")),
                "{:?}",
                b.diagnostics
            );
            let public = pair.source.replace(
                "written by .authorId",
                "written by .authorId readable by audience",
            );
            assert!(
                snapback4_lang::compile(&[("pair.q".into(), public)])
                    .diagnostics
                    .is_empty()
            );
        }
    }
}

#[test]
fn successful_writes_refresh_and_delete_private_images() {
    check_pairs(cases::delivery_pairs());
}
#[test]
fn private_maintained_aggregate_and_recorded_inputs_are_refused() {
    for pair in cases::derivations() {
        let b = snapback4_lang::compile(&[("schema.q".into(), pair.source.clone())]);
        if b.diagnostics.is_empty() {
            pair.assert_equal();
            panic!("private derivation admitted");
        }
        assert!(
            b.diagnostics
                .iter()
                .any(|d| d.code == "E_FIELD_AUTHORITY" && !d.rewrite.is_empty()),
            "{:?}",
            b.diagnostics
        );
        let public = pair.source.replace(
            "written by .owner",
            "written by .owner readable by audience",
        );
        let b = snapback4_lang::compile(&[("schema.q".into(), public)]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    }
}

#[test]
fn following_with_an_unmapped_private_field_preserves_every_channel() {
    cases::safe_following().assert_equal();
}

#[test]
fn following_filter_cannot_use_a_private_immutable_field() {
    let mut pair = cases::following("at: time", false);
    pair.source = pair
        .source
        .replace("at: time default 0 written by .authorId", "at: time")
        .replacen(
            "parentId: posts ?",
            "parentId: posts ? default null written by .authorId",
            1,
        );
    for (world, seed) in pair.seeds.iter_mut().enumerate() {
        seed[0].1["at"] = serde_json::json!(5);
        seed[0].1["parentId"] = if world == 0 {
            serde_json::Value::Null
        } else {
            serde_json::json!("p")
        };
    }
    let b = snapback4_lang::compile(&[("schema.q".into(), pair.source.clone())]);
    if b.diagnostics.is_empty() {
        pair.assert_equal();
        panic!("private predicate admitted");
    }
    assert!(
        b.diagnostics.iter().any(|d| d.code == "E_FIELD_AUTHORITY"
            && d.message.contains("timeline")
            && d.rewrite.contains("readable by audience")),
        "{:?}",
        b.diagnostics
    );
    let public = pair.source.replace(
        "written by .authorId",
        "written by .authorId readable by audience",
    );
    assert!(
        snapback4_lang::compile(&[("schema.q".into(), public)])
            .diagnostics
            .is_empty()
    );
}

#[test]
fn scoped_private_table_reads_remain_available() {
    let source = cases::RECORDS
        .replace("read <- allow", "read <- .reader = viewer")
        .replace("sync public", "sync to .reader")
        .replace(
            "records after c first 1 by .id",
            "records[reader = viewer] after c first 1 by .id",
        )
        .replace("records first 20", "records[reader = viewer] first 20");
    cases::records(
        source,
        [
            cases::seed(serde_json::json!(0)),
            cases::seed(serde_json::json!(10)),
        ],
        "noop",
        "target",
    )
    .assert_equal();
}

#[test]
fn cursors_cover_multiple_pages_without_private_keys() {
    let mut seeds = [
        cases::seed(serde_json::json!(0)),
        cases::seed(serde_json::json!(10)),
    ];
    for seed in &mut seeds {
        for id in ["a", "z"] {
            seed.push((
                "records".into(),
                serde_json::json!({"id":id,"owner":"bob","secret":3}),
            ));
        }
    }
    cases::records(cases::RECORDS.into(), seeds, "noop", "target").assert_equal();
}

#[test]
fn named_transition_cannot_turn_an_ordinary_patch_into_a_private_value_oracle() {
    let source = cases::RECORDS
        .replace(
            "update <- deny",
            "update (old, next) <- next.secret = next.label",
        )
        .replace("{ label: 1 }", "{ label: 0 }");
    cases::records(
        source,
        [
            cases::seed(serde_json::json!(0)),
            cases::seed(serde_json::json!(10)),
        ],
        "refresh",
        "target",
    )
    .assert_equal();
}

#[test]
fn ordinary_patch_does_not_meter_another_owners_retained_private_payload() {
    cases::ordinary_patch().assert_equal();
}

#[test]
fn unchanged_private_self_comparisons_keep_ordinary_writes_available() {
    use snapback4_core::{Context, WriteState};
    for predicate in [
        "next.secret = old.secret",
        "next.secret >= old.secret",
        "old.secret = old.secret",
    ] {
        let source = cases::RECORDS.replace(
            "update <- deny",
            &format!("update (old, next) <- {predicate}"),
        );
        let pair = cases::records(
            source,
            [
                cases::seed(serde_json::json!(0)),
                cases::seed(serde_json::json!(10)),
            ],
            "refresh",
            "target",
        );
        pair.assert_equal();
        let mut engine = pair.engine(0);
        let args = disclosure::inputs(&engine, "refresh", &serde_json::json!({"id":"target"}));
        let out = engine
            .mutate(
                "refresh",
                None,
                Context::new("alice", args).at(disclosure::NOW),
            )
            .unwrap();
        assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
    }
    let source = cases::RECORDS
        .replace(
            "update <- deny",
            "update (old, next) <- next.secret = next.label",
        )
        .replace("{ label: 1 }", "{ label: 0 }");
    let pair = cases::records(
        source,
        [
            cases::seed(serde_json::json!(0)),
            cases::seed(serde_json::json!(10)),
        ],
        "refresh",
        "target",
    );
    let mut e = pair.engine(0);
    let args = disclosure::inputs(&e, "refresh", &serde_json::json!({"id":"target"}));
    let out = e
        .mutate(
            "refresh",
            None,
            Context::new("bob", args).at(disclosure::NOW),
        )
        .unwrap();
    assert!(
        matches!(out.state, WriteState::Sent { .. }),
        "the owner may test their field: {out:?}"
    );
}
