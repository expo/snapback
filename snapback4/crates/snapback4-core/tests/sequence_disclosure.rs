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
                for op in [Write::Insert, Write::Absent, Write::Upsert] {
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
                            assert_eq!(why.code, if op.name == "put" && !readable { "NOT_FOUND" } else { "E_RULE" });
                            if why.code == "E_RULE" { assert!(why.message.contains("sequence insert requires read authority independent of its ordinal")); }
                            assert!(!why.message.contains("holds at most"));
                            assert!(!why.message.contains("occupied"));
                        }
                        controls += 1;
                    }
                }
            }
        }
    }
    assert_eq!(controls, 144);
    // With the accepted occupancy bit fixed, occupant identity, ordinal and
    // counter history must not create any further observable distinction.
    for principal in [Principal::SelfReadable, Principal::Writer] {
        for op in [Write::Insert, Write::Absent, Write::Upsert] {
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

#[path = "paired_worlds/sequence_round5.rs"]
mod round5;
#[test]
fn generated_round5_compounds_caps_shapes_and_allowed_writes() {
    let cases = round5::cases();
    eprintln!("round5 generated equality cases: {}", cases.len());
    assert_eq!(cases.len(), 300);
    let mut failed = vec![];
    for case in cases {
        if std::panic::catch_unwind(|| {
            case.pair.assert_equal();
            if case.label.ends_with("/Update") || case.label.ends_with("/Delete") {
                for world in 0..2 {
                    let mut e = case.pair.engine(world);
                    let op = &case.pair.operations[0];
                    let out = e.mutate(&op.name, None, snapback4_core::Context::new("alice", paired_worlds::inputs(&e, &op.name, &op.args))).unwrap();
                    assert!(matches!(out.state, snapback4_core::WriteState::Sent { .. }), "allowed owned write must succeed: {out:?}");
                }
            }
        }).is_err() { failed.push(case.label); }
    }
    assert!(failed.is_empty(), "{} failing cases: {failed:?}", failed.len());
}
#[test]
fn cap_order_cannot_change_refusal_after_8191_point_reads() {
    for reads in [8191, 8190, 0] {
        for op in [generated::Write::Insert, generated::Write::Absent, generated::Write::Upsert] {
            let pair = round5::cap_boundary(reads, op);
            pair.assert_equal();
            for world in 0..2 {
                let mut e = pair.engine(world);
                let out = e.mutate("burn", None, snapback4_core::Context::new("alice", paired_worlds::inputs(&e, "burn", &pair.operations[0].args))).unwrap();
                let snapback4_core::WriteState::Failed { why, .. } = out.state else { panic!("{out:?}") };
                assert_eq!(why.code, if reads > 8190 { "E_BOUND" } else { "E_RULE" });
            }
        }
    }
}
#[test]
fn compound_page_reserves_before_discovery_at_default_probe_ceiling() {
    for ordinary in [false, true] {
        for reads in [4096, 4095, 4094, 0] {
            for take in [1, 3] {
                for hidden in [1, 3] {
                    round5::page_boundary(ordinary, reads, take, hidden).assert_equal();
                }
            }
        }
    }
}

#[test]
fn descending_and_ascending_pages_ignore_middle_and_high_hidden_ordinals() {
    use paired_worlds::*;
    use serde_json::json;
    for compound in [false, true] {
        for direction in ["first", "last"] {
            for take in [1, 2] {
                for middle in [false, true] {
                    for ceiling in [None, Some(1)] {
                        let mut source = generated::schema(generated::Principal::SelfReadable, generated::ReadRule::Owner, false, false)
                            .replace("first 1 by .ordinal", &format!("{direction} {take} by .ordinal"));
                        if compound { source = source.replace(".owner = viewer", round5::COMPOUND).replace("sync to .owner", "online only"); }
                        let mut visible = vec![generated::row("own", "alice", 1, "own")];
                        if middle { visible.push(generated::row("own3", "alice", 3, "own3")); }
                        let mut hidden = visible.clone();
                        hidden.push(generated::row("hidden", "bob", 2, "hidden"));
                        let mut pair = Pair::new(source, [visible, hidden], "alice", Operation::new("edit", json!({"parent":"p","body":"probe","n":9}), "alice"))
                            .query("page", json!({"parent":"p","c":null})).query("one", json!({"parent":"p","n":9}));
                        pair.trusted = true;
                        pair.ceilings = ceiling.map(|examined| snapback4_core::Ceilings { examined, ..Default::default() });
                        pair.assert_equal();
                        if !middle {
                            for world in 0..2 {
                                let mut e = pair.engine(world);
                                let page = e.query("page", snapback4_core::Context::new("alice", inputs(&e, "page", &json!({"parent":"p","c":null})))).unwrap();
                                assert_eq!(page.data.as_array().unwrap().len(), 1);
                                assert_eq!(page.metered.examined, 1, "{direction} prepays the same allowance");
                                assert!(page.capped_at.is_none());
                            }
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn underfilled_and_full_caps_disclose_only_unreadable_occupancy() {
    use paired_worlds::*;
    use serde_json::json;
    for cap in [2, 4, 8] {
        for compound in [false, true] {
            for op in [generated::Write::Insert, generated::Write::Absent, generated::Write::Upsert] {
                let mut source = generated::schema(generated::Principal::SelfReadable, generated::ReadRule::Owner, false, true)
                    .replace("cap 1 by parent", &format!("cap {cap} by parent"));
                if compound { source = source.replace(".owner = viewer", round5::COMPOUND).replace("sync to .owner", "online only"); }
                let seed = |count| (1..=count).map(|n| generated::row(&format!("hidden{n}"), "bob", n, &format!("hidden{n}"))).collect();
                let mut pair = Pair::new(source, [seed(1), seed(cap)], "alice", Operation::new(op.name(), json!({"parent":"p","body":"fresh","n":99}), "alice"))
                    .query("page", json!({"parent":"p","c":null})).query("one", json!({"parent":"p","n":99}));
                pair.trusted = true;
                pair.assert_equal();
                for world in 0..2 {
                    let mut e = pair.engine(world);
                    let outcome = e.mutate(op.name(), None, snapback4_core::Context::new("alice", inputs(&e, op.name(), &pair.operations[0].args))).unwrap();
                    let snapback4_core::WriteState::Failed { why, .. } = outcome.state else { panic!("{outcome:?}") };
                    assert_eq!(why.code, "E_RULE");
                }
            }
        }
    }
}

#[test]
fn denied_compound_insert_reserves_whole_rule_before_any_witness() {
    use snapback4_core::{Context, WriteState};
    for readable in [false, true] {
        for (reads, ceiling) in [(0, Some(1)), (8191, None)] {
            let case = generated::compound_write_case("and-denied", "insert", true, readable, reads, ceiling);
            case.pair.assert_equal();
            for world in 0..2 {
                let mut e = case.pair.engine(world);
                let args = paired_worlds::inputs(&e, "probe", &serde_json::json!({"parent":"p"}));
                let out = e.mutate("probe", None, Context::new("alice", args).at(paired_worlds::NOW).with_ids(["new".into()])).unwrap();
                let WriteState::Failed { why, .. } = out.state else { panic!("{}: {out:?}", case.label) };
                assert_eq!(why.code, "E_BOUND", "{}", case.label);
                assert_eq!(out.metered.rule_probes, reads as u64 + 2, "reserve both probes before either witness");
            }
        }
    }
}

#[test]
fn generated_compound_write_rules_at_probe_boundaries() {
    let cases = generated::compound_write_cases();
    assert_eq!(cases.len(), 504);
    let mut failed = vec![];
    for case in cases {
        if std::panic::catch_unwind(|| case.pair.assert_equal()).is_err() { failed.push(case.label); }
    }
    assert!(failed.is_empty(), "compound write pairs with differences: {failed:?}");
}

#[test]
fn walk_bound_pages_are_identical_beyond_the_limit_in_both_directions() {
    use paired_worlds::*;
    use generated::{Principal, ReadRule};
    use serde_json::json;
    use snapback4_core::{Ceilings, Context};
    for descending in [false, true] {
        let source = generated::schema(Principal::SelfReadable, ReadRule::Owner, false, false)
            .replace("first 1 by .ordinal", if descending { "last 1 by .ordinal" } else { "first 1 by .ordinal" });
        let own = generated::row("own", "alice", if descending { 1 } else { 9000 }, "own");
        let seeds = [8193, 8201].map(|count| (2..=count + 1)
            .map(|n| generated::row(&format!("h{n}"), "bob", n, &format!("h{n}")))
            .chain([own.clone()]).collect());
        let mut pair = Pair::new(source, seeds, "alice", Operation::new("add", json!({}), "alice"));
        pair.trusted = true;
        // A full allowance is prepaid even with only one logical examined unit.
        pair.ceilings = Some(Ceilings { examined: 1, ..Default::default() });
        let pages = [0, 1].map(|world| {
            let mut e = pair.engine(world);
            let page = e.query("page", Context::new("alice", inputs(&e, "page", &json!({"parent":"p","c":null})))).unwrap();
            assert!(page.data.as_array().unwrap().is_empty());
            assert!(page.next.is_none());
            assert!(!page.complete);
            assert_eq!(page.metered.examined, 1);
            assert!(page.capped_at.is_none(), "the physical stop is not a population-dependent logical cut");
            serde_json::to_value(page).unwrap()
        });
        assert_eq!(pages[0], pages[1]);
    }
}

#[test]
fn grok_allowed_compound_insert_does_not_reserve_paid_probes_again() {
    use snapback4_core::{Context, WriteState};
    for (reads, ceiling) in [(0, Some(5)), (0, Some(6)), (8187, None)] {
        let case = generated::compound_write_case("or-public-allowed", "insert", true, true, reads, ceiling);
        case.pair.assert_equal();
        for world in 0..2 {
            let mut e = case.pair.engine(world);
            let args = paired_worlds::inputs(&e, "probe", &serde_json::json!({"parent":"p"}));
            let out = e.mutate("probe", None, Context::new("alice", args).at(paired_worlds::NOW).with_ids(["new".into()])).unwrap();
            let WriteState::Sent { result, .. } = out.state else { panic!("{}: {out:?}", case.label) };
            assert_eq!(result.field("ordinal"), Ok(&snapback4_core::Value::Int(1)));
            assert_eq!(out.metered.rule_probes, reads as u64 + 2, "both witnesses are prepaid exactly once");
        }
    }
}

#[path = "paired_worlds/sequence_round7.rs"]
mod round7;
#[test]
fn generated_expiring_witness_predicates_compare_next_expiry() {
    for (label, pair) in round7::expiry_cases() {
        assert!(std::panic::catch_unwind(|| pair.assert_equal()).is_ok(), "{label}");
        if label.starts_with("row-lifetime/") {
            let mut engine = pair.engine(0);
            assert_eq!(engine.query("one", snapback4_core::Context::new("alice", Default::default()).at(1000)).unwrap().next_expiry, Some(7000));
        }
    }
}

#[test]
fn succeeded_authorization_keeps_only_a_decisive_expiry() {
    use snapback4_core::{Context, Value};
    let second = "exists otherGrants[parent = .parent, who = viewer]";
    for (rule, owner, expected) in [
        (round7::ADMIN.to_string(), "bob", Some(2000)),
        (format!("{} and {second}", round7::ADMIN), "bob", Some(2000)),
        (format!("{} or {second}", round7::ADMIN), "bob", Some(8000)),
        (format!("{} or .owner = viewer", round7::ADMIN), "alice", None),
        (format!("not not {}", round7::ADMIN), "bob", Some(2000)),
    ] {
        let pair = round7::expiry_pair(&rule, false, "admin", [Some(2000); 2], owner);
        let mut e = pair.engine(0);
        for query in ["one", "page", "reverse"] {
            let out = e.query(query, Context::new("alice", Default::default()).at(1000)).unwrap();
            assert_eq!(out.next_expiry, expected, "{rule}/{query}");
            if let Some(deadline) = expected {
                let out = e.query(query, Context::new("alice", Default::default()).at(deadline)).unwrap();
                assert!(out.data == Value::Null || out.data == Value::Array(vec![]), "{rule}/{query}: {out:?}");
            }
        }
    }
}

#[test]
fn generated_expiring_cap_populations_compare_refusals_and_meters() {
    for pair in round7::cap_cases().into_iter().chain(round7::nested_cap_cases()) { pair.assert_equal(); }
}

#[test]
fn walk_limit_is_exactly_8192_candidates_in_both_directions() {
    use paired_worlds::*;
    use generated::{Principal, ReadRule};
    use serde_json::json;
    use snapback4_core::Context;
    for descending in [false, true] {
        for count in [8191, 8192, 8193] {
            let source = generated::schema(Principal::SelfReadable, ReadRule::Owner, false, false)
                .replace("first 1 by .ordinal", if descending { "last 1 by .ordinal" } else { "first 1 by .ordinal" });
            let own = generated::row("own", "alice", if descending { 1 } else { 9000 }, "own");
            let seed: Seed = (2..=count + 1).map(|n| generated::row(&format!("h{n}"), "bob", n, &format!("h{n}"))).chain([own]).collect();
            let mut pair = Pair::new(source, [seed.clone(), seed], "alice", Operation::new("unused", json!({}), "alice"));
            pair.trusted = true;
            let mut e = pair.engine(0);
            let page = e.query("page", Context::new("alice", inputs(&e, "page", &json!({"parent":"p","c":null}))).at(NOW)).unwrap();
            assert_eq!(page.data.as_array().unwrap().len(), usize::from(count == 8191), "descending={descending} hidden={count}");
            if count >= 8192 { assert!(page.next.is_none()); }
        }
    }
}

#[test]
fn existential_alternatives_and_correlations_use_the_complete_timeline() {
    use snapback4_core::{Context, Value};
    let a = round7::ADMIN;
    for rule in [a.to_string(), format!("{a} or not {a}"), format!("not ({a} and not {a})"), format!("not not {a}")] {
        for permanent in [false, true] {
            let mut pair = round7::expiry_pair(&rule, false, "admin", [Some(2000), Some(3000)], "bob");
            pair.source = pair.source.replacen("unique parent, who", "by byParentWho: parent, who", 1);
            for seed in &mut pair.seeds {
                seed.push(("grants".into(), serde_json::json!({"id":"later","parent":"p","who":"alice","kind":"admin","until":if permanent { None } else { Some(8000) }})));
            }
            pair.assert_equal();
            let tautology = rule.contains(" or ") || rule.contains(" and ");
            for world in 0..2 {
                let mut engine = pair.engine(world);
                for now in [1000, 2000, 3000, 7999, 8000] {
                    for query in ["one", "page", "reverse"] {
                        let out = engine.query(query, Context::new("alice", Default::default()).at(now)).unwrap();
                        let readable = permanent || tautology || now < 8000;
                        assert_eq!(out.data != Value::Null && out.data != Value::Array(vec![]), readable, "{rule}/{permanent}/{now}/{query}");
                        assert_eq!(out.next_expiry, if !permanent && !tautology && now < 8000 { Some(8000) } else { None }, "{rule}/{permanent}/{now}/{query}");
                    }
                }
            }
        }
    }
}

#[test]
fn repeated_authorization_scopes_share_one_request_allowance() {
    use snapback4_core::{Context, WriteState};
    for alternating in [false, true] {
        let mut case = generated::compound_write_case("or-public-allowed", "insert", true, true, if alternating {4096} else {8192}, None);
        if alternating {
            // Alternating points cannot reuse the single-entry cache: all
            // their actual fetches still share the request-wide allowance.
            case.pair.source = case.pair.source.replace("    seen = burnRows[id = 'burn']", "    seen = burnRows[id = 'burn']\n    other = burnRows[id = 'other']");
            for seed in &mut case.pair.seeds { seed.push(("burnRows".into(), serde_json::json!({"id":"other","parent":"p"}))); }
        }
        case.pair.assert_equal();
        for world in 0..2 {
            let mut e = case.pair.engine(world);
            let args = paired_worlds::inputs(&e, "probe", &serde_json::json!({"parent":"p"}));
            let out = e.mutate("probe", None, Context::new("alice", args).at(paired_worlds::NOW)).unwrap();
            let WriteState::Failed { why, .. } = out.state else { panic!("{out:?}") };
            assert_eq!(why.code, if alternating { "E_RULE" } else { "E_BOUND" });
            if alternating { assert!(out.metered.rule_probes <= 8192, "physical refusal precedes logical exhaustion"); }
            else { assert!(out.metered.rule_probes > 8192, "unchanged points still pay every logical probe"); }
        }
    }
}

#[path = "paired_worlds/sequence_landing.rs"]
mod landing;
