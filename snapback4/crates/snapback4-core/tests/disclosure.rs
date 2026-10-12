#[path = "disclosure/generated.rs"]
mod generated;
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
fn generated_schema_matrix() {
    let mut failed = Vec::new();
    let filter = std::env::var("DISCLOSURE_FILTER").unwrap_or_default();
    let mut selected = 0;
    let count = generated::visit(|case| {
        if !case.label.contains(&filter) { return; }
        selected += 1;
        if std::panic::catch_unwind(|| {
            case.pair.assert_equal();
            if case.predicts {
                let mut e = case.pair.engine(0);
                let op = &case.pair.operations[0];
                let args = disclosure::inputs(&e,&op.name,&op.args);
                let out = e.mutate(&op.name,None,snapback4_core::Context::new(&op.principal,args).at(disclosure::NOW)).unwrap();
                assert!(matches!(out.state,snapback4_core::WriteState::Sent { .. }), "positive prediction control must commit on server: {out:?}");
            }
        }).is_err() {
            eprintln!("generated difference: {}",case.label);
            failed.push(case.label);
        }
    });
    assert!(selected > 0, "empty generation filter: {filter}");
    eprintln!("generated core pairs: {count}; differences: {}", failed.len());
    assert!(failed.is_empty(), "{} generated pairs differ: {failed:?}", failed.len());
}

#[test]
fn default_ceiling_membership_boundary() {
    use snapback4_core::{Context, Ceilings, WriteState};
    let mut pair = generated::membership_pair();
    fn run(pair: &disclosure::Pair, n: u64) -> snapback4_core::MutationOutcome {
        let mut e = pair.engine(0);
        let args = disclosure::inputs(&e,"mark",&serde_json::json!({"id":"note","n":n}));
        e.mutate("mark",None,Context::new("alice",args).at(disclosure::NOW)).unwrap()
    }
    let stride = run(&pair,1).metered.steps - run(&pair,0).metered.steps;
    // Generate padding too: two-step require statements align the loop's
    // three-step stride with the exact default ceiling, without raising it.
    for _ in 0..stride {
        let base = run(&pair,0).metered.steps;
        if (Ceilings::default().steps-base) % stride == 0 { break; }
        pair.source = pair.source.replace("  return true", "  require true else PAD\n  return true");
    }
    let base = run(&pair,0).metered.steps;
    let n = (Ceilings::default().steps-base)/stride;
    let at = run(&pair,n);
    assert!(matches!(at.state, WriteState::Sent { .. }));
    assert_eq!(at.metered.steps, Ceilings::default().steps);
    let over = run(&pair,n+1);
    assert!(!matches!(over.state, WriteState::Sent { .. }), "{over:?}");
    assert!(over.reply(None).to_string().contains("E_BOUND"));
    eprintln!("default boundary: n={n}, base={base}, stride={stride}; sent={}, refused={}",at.metered.steps,over.metered.steps);
    for n in [n,n+1] {
        pair.operations[0].args["n"] = serde_json::json!(n);
        pair.assert_equal();
    }
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

#[test]
fn generated_private_rule_admission() {
    let mut count = 0;
    for declaration in generated::type_declarations() {
        let source = generated::program(&declaration);
        let b = snapback4_lang::compile(&[("schema.q".into(),source.clone())]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        for (field, authority) in &b.schema.tables["records"].written_by {
            if authority.audience { continue; }
            for effect in ["read", "insert", "update", "delete"] {
                let old = match effect { "read" => "  public\n  insert", "insert" => "insert <- allow", "update" => "update <- allow", _ => "delete <- deny" };
                let replacement = if effect == "read" { format!("  read <- .{field} = .{field}\n  insert") }
                    else { format!("{effect} <- .{field} = .{field}") };
                let program = source.replacen(old,&replacement,1);
                let b = snapback4_lang::compile(&[("schema.q".into(),program)]);
                assert!(b.diagnostics.iter().any(|d|d.code == "E_FIELD_AUTHORITY"),"{declaration}/{effect}/{field}: {:?}",b.diagnostics);
                count += 1;
            }
            for arm in ["exists", "created"] {
                let ty = &b.schema.tables["records"].columns[field];
                let program = source.replace("insert <- allow",&format!("insert <- {arm} guesses[tag = 0, value = .{field}]"))
                    + &format!("\ntable guesses:\n  tag: int\n  value: {ty}\n  unique tag\n  public\n  sync public\n");
                let b = snapback4_lang::compile(&[("schema.q".into(),program)]);
                assert!(b.diagnostics.iter().any(|d|d.code == "E_FIELD_AUTHORITY"),"{declaration}/{arm}/{field}: {:?}",b.diagnostics);
                count += 1;
            }
        }
    }
    // Float is not a Quarry column in this checkout. Do not silently claim it
    // was exercised as an integer, or expand the language as a harness fix.
    let b = snapback4_lang::compile(&[("schema.q".into(),generated::program("float default 0"))]);
    assert!(!b.diagnostics.is_empty());
    eprintln!("generated admission cases: {count}; float field unsupported");
}

#[test]
fn following_repost_timestamp_requires_audience_visibility() {
    for compat in [false,true] {
        let pair = cases::safe_following_for(compat);
        let source = pair.source.replace("  postId: posts on delete keep\n  at: time", "  postId: posts on delete keep\n  at: time default 0 written by .actorId");
        assert_ne!(source,pair.source);
        let b = snapback4_lang::compile(&[("reposts.q".into(),source.clone())]);
        assert!(b.diagnostics.iter().any(|d|d.code=="E_FIELD_AUTHORITY" && d.message.contains("timeline")),"{compat}: {:?}",b.diagnostics);
        let source = source.replace("written by .actorId","written by .actorId readable by audience");
        assert!(snapback4_lang::compile(&[("reposts.q".into(),source)]).diagnostics.is_empty());
    }
}

#[path = "disclosure/materialization.rs"]
mod materialization;

#[test]
fn non_integer_ordered_transition_spellings_are_refused() {
    for declaration in ["decimal 2 default 0", "decimal 2 ? default null", "money USD 2 default 0", "money USD 2 ? default null", "text <=20 default ''", "text <=20 ? default null"] {
        for op in [">=", ">", "<=", "<"] {
            let source = generated::program(declaration).replace("update <- allow",&format!("update (old, next) <- next.secret {op} old.secret"));
            let b = snapback4_lang::compile(&[("schema.q".into(),source)]);
            assert!(b.diagnostics.iter().any(|d|d.code=="E_QUARRY_TYPE" && d.message.contains("ordered transition")),"{declaration}/{op}: {:?}",b.diagnostics);
        }
    }
}
