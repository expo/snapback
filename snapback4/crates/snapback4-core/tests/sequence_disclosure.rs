mod paired_worlds;
#[path = "paired_worlds/sequences.rs"]
mod cases;
#[test]
fn sequence_worlds_compare_all_channels() {
    let mut failed = 0;
    for (n, pair) in cases::pairs().into_iter().enumerate() {
        if std::panic::catch_unwind(|| pair.assert_equal()).is_err() {
            eprintln!("pair {n}: {} by {}", pair.operations[0].name, pair.principal);
            failed += 1;
        }
    }
    assert_eq!(failed, 0, "pairs with differences");
}
#[test]
fn counter_reads_reserve_before_hidden_target_resolution() {
    for entries in 0..=3 { cases::boundary(entries).assert_equal(); }
}

#[test]
fn counter_read_boundary_at_default_ceilings_after_512_scratch_writes() {
    let mut pair = cases::boundary(16_384);
    pair.source.push_str("\ntable scratch:\n  n: int\n  public\n  insert <- allow\n  online only\n");
    for n in 0..31 { pair.source.push_str(&format!("  by ix{n}: n, id\n")); }
    pair.source.push_str("\nmutation burn(parent: parents, body: text <=40):\n");
    for n in 0..512 { pair.source.push_str(&format!("  insert scratch {{ id: 'scratch{n}', n: {n} }}\n")); }
    pair.source.push_str("  return upsert messages[parent = parent, body = body] { owner: 'alice' }\n");
    pair.operations[0].name = "burn".into();
    pair.assert_equal();
}

#[path = "paired_worlds/sequence_generated.rs"]
mod generated;
#[test]
fn generated_principals_rules_witnesses_and_targets() {
    let cases = generated::cases();
    eprintln!("generated equality cases: {} (legacy: 120)", cases.len());
    let mut failures = vec![];
    for case in cases {
        if std::panic::catch_unwind(|| case.pair.assert_equal()).is_err() { failures.push(case.label); }
    }
    assert!(failures.is_empty(), "{} failing cases: {failures:#?}", failures.len());
}
#[test]
fn generated_writes_after_512_scratch_inserts_at_default_ceilings() {
    for case in generated::boundary_cases() {
        case.pair.assert_equal();
        if case.label.starts_with("WitnessDependent/Witness/Witness/") && (case.label.contains("/Insert/") || case.label.contains("/Absent/")) {
            for world in 0..2 {
                let mut e = case.pair.engine(world);
                let op = &case.pair.operations[0];
                let out = e.mutate(&op.name, None, snapback4_core::Context::new(&op.principal, paired_worlds::inputs(&e, &op.name, &op.args)).at(paired_worlds::NOW).with_ids(["candidate".into()])).unwrap();
                let snapback4_core::WriteState::Failed { why, .. } = out.state else { panic!("{out:?}") };
                assert_eq!(why.code, "E_RULE", "an independent denial must precede deferred counter reservation");
            }
        }
    }
}

#[test]
fn generated_self_readable_allocations_and_hidden_cap_limit() {
    use generated::{Principal, ReadRule, Write};
    use paired_worlds::*;
    use serde_json::json;
    use snapback4_core::{Context, Value, WriteState};
    let mut controls = 0;
    for principal in [Principal::SelfReadable, Principal::Writer, Principal::InsertOnly] {
        for read in [ReadRule::Owner, ReadRule::Witness, ReadRule::Ordinal, ReadRule::Deny] {
            for cap in [false, true] {
                for op in [Write::Insert, Write::Absent] {
                    let who = principal.who();
                    let source = generated::schema(principal, read, false, cap);
                    let mut seeds: [Seed; 2] = [vec![], vec![]];
                    if read == ReadRule::Witness {
                        seeds[1].push(("grants".into(), json!({"id":"grant","parent":"p","who":who})));
                    } else {
                        seeds[1].push(generated::row("hidden", "carol", 5, "occupied"));
                    }
                    let mut pair = Pair::new(source, seeds, who, Operation::new(op.name(), json!({"parent":"p","body":"new","n":6}), who));
                    pair.trusted = true;
                    for world in 0..2 {
                        let readable = (read == ReadRule::Owner && principal != Principal::InsertOnly) || (read == ReadRule::Witness && world == 1);
                        let hidden_cap = cap && read == ReadRule::Owner && world == 1;
                        let mut e = pair.engine(world);
                        let op = &pair.operations[0];
                        let out = e.mutate(&op.name, None, Context::new(who, inputs(&e, &op.name, &op.args)).at(NOW).with_ids(["candidate".into()])).unwrap();
                        if readable && !hidden_cap {
                            let WriteState::Sent { result, .. } = out.state else { panic!("{principal:?}/{read:?}/cap={cap}/world={world}: {out:?}") };
                            assert_eq!(result.field("ordinal"), Ok(&Value::Int(if world == 1 && read == ReadRule::Owner { 6 } else { 1 })));
                        } else {
                            let WriteState::Failed { why, .. } = out.state else { panic!("{out:?}") };
                            assert_eq!(why.code, "E_RULE");
                            assert!(why.message.contains("sequence insert requires read authority independent of its ordinal"));
                            assert!(!why.message.contains("holds at most"));
                            assert!(!why.message.contains("occupied"));
                        }
                        controls += 1;
                    }
                }
            }
        }
    }
    assert_eq!(controls, 96);
    // With the accepted occupancy bit fixed, occupant identity, ordinal and
    // counter history must not create any further observable distinction.
    for principal in [Principal::SelfReadable, Principal::Writer] {
        for op in [Write::Insert, Write::Absent] {
            let who = principal.who();
            let mut pair = Pair::new(generated::schema(principal, ReadRule::Owner, false, true),
                [vec![generated::row("hidden-a", "carol", 1, "a")], vec![generated::row("hidden-b", "dave", 5, "b")]], who,
                Operation::new(op.name(), json!({"parent":"p","body":"new","n":6}), who))
                .query("one", json!({"parent":"p","n":1})).query("page", json!({"parent":"p","c":null}));
            pair.trusted = true;
            pair.assert_equal();
        }
    }
}

#[test]
fn generated_first_ordinal_page_at_examined_ceiling_one() {
    for mut case in generated::cases().into_iter().filter(|case| case.label.contains("/Owner/Following/Position/") && case.label.ends_with("own=true")) {
        case.pair.ceilings = Some(snapback4_core::Ceilings { examined: 1, ..Default::default() });
        case.pair.assert_equal();
        for world in 0..2 {
            let mut e = case.pair.engine(world);
            let page = e.query("page", snapback4_core::Context::new(&case.pair.principal, paired_worlds::inputs(&e, "page", &serde_json::json!({"parent":"p","c":null})))).unwrap();
            assert_eq!(page.metered.examined, 1);
            assert!(page.capped_at.is_none());
            assert_eq!(page.data.as_array().unwrap().len(), 1);
        }
    }
}

#[test]
fn hidden_ordinal_prefix_has_a_separate_internal_walk_limit() {
    use paired_worlds::*;
    use generated::{Principal, ReadRule};
    let hidden = (1..=8193).map(|n| generated::row(&format!("h{n}"), "bob", n, &format!("h{n}"))).chain([generated::row("own", "alice", 8194, "own")]).collect();
    let mut pair = Pair::new(generated::schema(Principal::SelfReadable, ReadRule::Owner, false, false), [vec![], hidden], "alice", Operation::new("add", serde_json::json!({}), "alice"));
    pair.trusted = true;
    pair.ceilings = Some(snapback4_core::Ceilings { examined: 1, ..Default::default() });
    let mut e = pair.engine(1);
    let page = e.query("page", snapback4_core::Context::new("alice", inputs(&e, "page", &serde_json::json!({"parent":"p","c":null})))).unwrap();
    assert!(page.data.as_array().unwrap().is_empty(), "the internal walk must stop before own ordinal 8194");
    assert!(!page.complete);
    assert!(page.next.is_none(), "a hidden key cannot become a continuation");
}

#[test]
fn denied_witness_ordinary_integer_control() {
    for mut case in generated::cases().into_iter().filter(|case| case.label.starts_with("WitnessDependent/Witness/Witness/") && case.label.ends_with("own=false")) {
        case.pair.source = case.pair.source.replace("ordinal: sequence by parent", "ordinal: int default 0");
        case.pair.assert_equal();
        generated::at_default_boundary(&mut case);
        case.pair.assert_equal();
    }
}

#[test]
fn generated_owned_hidden_and_fresh_sequence_addresses_at_boundaries() {
    let cases = generated::address_cases();
    assert_eq!(cases.len(), 30);
    for case in cases {
        case.pair.assert_equal();
        for world in 0..2 {
            let mut e = case.pair.engine(world);
            let op = &case.pair.operations[0];
            let reply = e.mutate(&op.name, None, snapback4_core::Context::new(&op.principal, paired_worlds::inputs(&e, &op.name, &op.args)).at(paired_worlds::NOW).with_ids(["candidate".into()])).unwrap();
            let snapback4_core::WriteState::Failed { why, .. } = reply.state else { panic!("{reply:?}") };
            let expected = if case.pair.ceilings.is_some_and(|c| c.index_entries == 0) { "E_BOUND" } else if op.args["n"] == 1 { "E_RULE" } else { "NOT_FOUND" };
            assert_eq!(why.code, expected, "{}", case.label);
        }
    }
}
