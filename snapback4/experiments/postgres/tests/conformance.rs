use snapback4_core::{
    Engine, Value, WriteState,
    engine::postgres::{PostgresEngine, WriteMode},
    meter::Ceilings,
};
use snapback4_postgres_evaluation::*;
use std::sync::{Arc, Barrier};

#[test]
fn fixture_compiles() {
    compiled();
}

fn pair(label: &str, rooms: usize, items: usize) -> (String, PostgresEngine, Engine) {
    let (schema, programs) = compiled();
    let name = namespace(label);
    let mut pg = PostgresEngine::create(connect(), &name, schema.clone(), programs.clone()).unwrap();
    let mut sqlite = Engine::memory(schema, programs).unwrap();
    let rows = fixture(rooms, items);
    assert_eq!(pg.seed_at(rows.clone(), 10).unwrap(), sqlite.seed_at(rows, 10).unwrap());
    (name, pg, sqlite)
}

fn counts(name: &str) -> Vec<i64> {
    let mut client = connect();
    let row = client.query_one(&format!("SELECT (SELECT count(*) FROM {name}.r), (SELECT count(*) FROM {name}.i), (SELECT count(*) FROM {name}._commits), (SELECT count(*) FROM {name}._log), (SELECT count(*) FROM {name}._outbox), (SELECT count(*) FROM {name}._ops), (SELECT seq FROM {name}._head)"), &[]).unwrap();
    (0..7).map(|i| row.get(i)).collect()
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn real_quarry_queries_mutations_cursors_rules_defaults_maintains_and_receipts_match_sqlite() {
    let (name, mut pg, mut sqlite) = pair("equivalence", 2, 45);
    for viewer in ["alice", "bob", "stranger"] {
        let mut cursor = Value::Null;
        for _ in 0..4 {
            let ctx = context(viewer, &[("room", id("r000")), ("c", cursor)]);
            let expected = sqlite.query("page", ctx.clone());
            let actual = pg.query("page", ctx);
            assert_eq!(actual, expected, "page for {viewer}");
            cursor = actual.unwrap().next.map(string).unwrap_or(Value::Null);
            if cursor == Value::Null {
                break;
            }
        }
        assert_eq!(pg.query("inbox", context(viewer, &[])), sqlite.query("inbox", context(viewer, &[])));
    }
    let writes = [
        ("add", "alice", vec![("room", id("r000")), ("title", string("new")), ("amount", Value::Int(71)), ("fail", Value::Bool(false))]),
        (
            "add",
            "alice",
            vec![("room", id("r000")), ("title", string("rollback")), ("amount", Value::Int(999)), ("fail", Value::Bool(true))],
        ),
        ("revise", "bob", vec![("itemId", id("r000-i0000")), ("title", string("denied")), ("amount", Value::Int(99))]),
        ("revise", "alice", vec![("itemId", id("r000-i0000")), ("title", string("renamed")), ("amount", Value::Int(-3))]),
        ("remove", "alice", vec![("itemId", id("r000-i0001"))]),
        (
            "add",
            "stranger",
            vec![("room", id("r000")), ("title", string("renamed")), ("amount", Value::Int(123)), ("fail", Value::Bool(false))],
        ),
    ];
    for (n, (program, viewer, args)) in writes.into_iter().enumerate() {
        let op = format!("op-{n}");
        let ctx = context(viewer, &args).with_ids([format!("new-{n}")]);
        assert_eq!(pg.mutate(program, Some(&op), ctx.clone()).unwrap(), sqlite.mutate(program, Some(&op), ctx.clone()).unwrap());
        // Same operation and arguments replay only the receipt, never old data.
        assert_eq!(
            pg.mutate(program, Some(&op), ctx.clone()).unwrap(),
            sqlite.mutate(program, Some(&op), ctx).unwrap()
        );
        // Both stores compare the binding before looking up the current program.
        assert_eq!(sqlite.mutate("unknown", Some(&op), context(viewer, &[])).unwrap_err().code(), "E_ID_REUSED");
        assert_eq!(pg.mutate("unknown", Some(&op), context(viewer, &[])).unwrap_err().code(), "E_ID_REUSED");
        assert_eq!(pg.query("inbox", context("alice", &[])), sqlite.query("inbox", context("alice", &[])));
    }
    pg.set_ceilings(Ceilings { examined: 2, ..Ceilings::default() });
    sqlite.set_ceilings(Ceilings { examined: 2, ..Ceilings::default() });
    let ctx = context("alice", &[("room", id("r000")), ("c", Value::Null)]);
    let capped = pg.query("page", ctx.clone()).unwrap();
    assert_eq!(capped, sqlite.query("page", ctx).unwrap());
    assert!(!capped.complete);
    drop(pg);
    let mut reopened = PostgresEngine::open(connect(), &name).unwrap();
    let replay = reopened.mutate("add", Some("op-0"), context("alice", &[
        ("room", id("r000")), ("title", string("new")), ("amount", Value::Int(71)), ("fail", Value::Bool(false)),
    ])).unwrap();
    assert!(replay.replayed);
    assert!(matches!(replay.state, WriteState::Sent { result: Value::Null, .. }));
    assert_eq!(reopened.mutate("removedProgram", Some("op-0"), context("alice", &[])).unwrap_err().code(), "E_ID_REUSED");
    sqlite.set_ceilings(Ceilings::default());
    assert_eq!(reopened.query("inbox", context("alice", &[])).unwrap().data, sqlite.query("inbox", context("alice", &[])).unwrap().data);
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn receipt_bindings_match_sqlite_before_lookup_and_validation() {
    let (name, mut pg, mut sqlite) = pair("receipt_binding", 0, 0);
    let original: serde_json::Value = serde_json::from_str(r#"{"nested":{"a":1,"b":2},"ordered":[1,2]}"#).unwrap();
    let reordered: serde_json::Value = serde_json::from_str(r#"{"ordered":[1,2],"nested":{"b":2,"a":1}}"#).unwrap();
    let changed_array: serde_json::Value = serde_json::from_str(r#"{"nested":{"a":1,"b":2},"ordered":[2,1]}"#).unwrap();
    let first_context = context("alice", &[("slot", id("c0"))]).with_wire_args(original.clone());
    let pg_first = pg.mutate("increment", Some("bound-op"), first_context.clone()).unwrap();
    let sqlite_first = sqlite.mutate("increment", Some("bound-op"), first_context).unwrap();
    assert_eq!(pg_first, sqlite_first);
    assert!(!pg_first.replayed);

    let mut admin = connect();
    let stored_before: (String, String, String, i64) = admin.query_one(
        &format!("SELECT outcome,name,args_digest,at FROM {name}._ops WHERE principal = 'alice' AND id = 'bound-op'"), &[],
    ).map(|row| (row.get(0), row.get(1), row.get(2), row.get(3))).unwrap();
    assert_eq!(stored_before.1, "increment");
    assert_eq!(stored_before.2, snapback4_core::store::payload_digest(&original));
    assert_eq!(stored_before.3, 1_000);
    let receipt: serde_json::Value = serde_json::from_str(&stored_before.0).unwrap();
    assert_eq!(receipt.get("replayed"), Some(&serde_json::Value::Bool(true)));
    for hidden in ["result", "current"] { assert!(receipt.get(hidden).is_none(), "stored receipt exposed {hidden}"); }
    assert!(receipt.get("why").and_then(|why| why.get("detail")).is_none());

    // The decoded arguments are now invalid, but identical raw input must
    // replay before validation. Recursive object order is immaterial.
    let invalid_but_identical = context("alice", &[]).with_wire_args(reordered.clone());
    for outcome in [
        pg.mutate("increment", Some("bound-op"), invalid_but_identical.clone()).unwrap(),
        sqlite.mutate("increment", Some("bound-op"), invalid_but_identical).unwrap(),
    ] {
        assert!(outcome.replayed);
        assert!(matches!(outcome.state, WriteState::Sent { result: Value::Null, .. }));
    }

    for raw in [changed_array, serde_json::json!({"different": true})] {
        let changed = context("alice", &[]).with_wire_args(raw);
        let pg_error = pg.mutate("increment", Some("bound-op"), changed.clone()).unwrap_err().refusal();
        let sqlite_error = sqlite.mutate("increment", Some("bound-op"), changed).unwrap_err().refusal();
        for error in [pg_error, sqlite_error] {
            assert_eq!((error.code.as_str(), error.family.as_str()), ("E_ID_REUSED", "input"));
        }
    }
    let same_raw = context("alice", &[]).with_wire_args(reordered);
    for other in ["add", "unknown"] {
        let pg_error = pg.mutate(other, Some("bound-op"), same_raw.clone()).unwrap_err().refusal();
        let sqlite_error = sqlite.mutate(other, Some("bound-op"), same_raw.clone()).unwrap_err().refusal();
        for error in [pg_error, sqlite_error] {
            assert_eq!((error.code.as_str(), error.family.as_str()), ("E_ID_REUSED", "input"));
        }
    }

    let stored_after: (String, String, String, i64) = admin.query_one(
        &format!("SELECT outcome,name,args_digest,at FROM {name}._ops WHERE principal = 'alice' AND id = 'bound-op'"), &[],
    ).map(|row| (row.get(0), row.get(1), row.get(2), row.get(3))).unwrap();
    assert_eq!(stored_after, stored_before, "a mismatching retry replaced the authoritative receipt");
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn rollback_covers_rows_indexes_maintains_log_head_outbox_and_receipt() {
    let (name, mut pg, _) = pair("atomic", 1, 2);
    let before = counts(&name);
    let ctx =
        context("alice", &[("room", id("r000")), ("title", string("abort")), ("amount", Value::Int(123)), ("fail", Value::Bool(true))])
            .with_ids(["aborted".into()]);
    let failed = pg.mutate("add", Some("refusal"), ctx.clone()).unwrap();
    assert!(matches!(failed.state, WriteState::Failed { .. }));
    let after = counts(&name);
    for i in [0, 1, 2, 3, 4, 6] {
        assert_eq!(after[i], before[i], "state component {i}");
    }
    assert_eq!(after[5], before[5] + 1, "only the refusal receipt survives");
    let before = after;
    // Cause a late database failure AFTER rows, log and effect were written.
    // The engine must not classify it as an application refusal and commit it.
    let mut admin = connect();
    admin.batch_execute(&format!("ALTER TABLE {name}._ops ADD CONSTRAINT fail_receipt CHECK (id <> 'fail-late')")).unwrap();
    let mut ctx = ctx;
    ctx.args.insert("fail".into(), Value::Bool(false));
    assert!(pg.mutate("add", Some("fail-late"), ctx.clone()).is_err());
    assert_eq!(counts(&name), before, "late database failure rolls back the whole transaction");
    admin.batch_execute(&format!("ALTER TABLE {name}._ops DROP CONSTRAINT fail_receipt")).unwrap();
    sent(&pg.mutate("add", Some("fail-late"), ctx).unwrap());
    let after = counts(&name);
    assert_eq!(after[2], before[2] + 1);
    assert_eq!(after[4], before[4] + 1);
    assert_eq!(after[5], before[5] + 1);
    assert_eq!(after[6], before[6] + 1);
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn snapshot_stream_membership_revoke_rejoin_and_whole_commit_paging_match_sqlite() {
    let (_, mut pg, mut sqlite) = pair("sync", 2, 25);
    for viewer in ["alice", "bob", "stranger"] {
        let mut after = None;
        loop {
            let actual = pg.snapshot_page(viewer, after.clone(), 7, 1_000).unwrap();
            let (events, seq, next, held) =
                sqlite.snapshot_page_with_groups_at(viewer, after.as_ref().map(|c| c.encode()).as_deref(), 7, 1_000).unwrap();
            assert_eq!((actual.events, actual.watermark, actual.next.as_ref().map(|c| c.encode()), actual.held), (events, seq, next, held));
            after = actual.next;
            if after.is_none() {
                break;
            }
        }
    }
    let start = 1;
    for (n, (program, viewer, args)) in [
        ("leave", "bob", vec![("room", id("r000"))]),
        ("revise", "alice", vec![("itemId", id("r000-i0000")), ("title", string("while-absent")), ("amount", Value::Int(9))]),
        ("join", "alice", vec![("room", id("r000")), ("principal", id("bob"))]),
        ("leave", "bob", vec![("room", id("r001"))]),
    ]
    .into_iter()
    .enumerate()
    {
        let ctx = context(viewer, &args).with_ids([format!("join-{n}")]);
        assert_eq!(pg.mutate(program, None, ctx.clone()).unwrap(), sqlite.mutate(program, None, ctx.clone()).unwrap());
        for watermark in [0, start, start + n as u64] {
            for limit in [1, 7, 1_000] {
                let actual = pg.stream("bob", watermark, limit, 1_000).unwrap();
                let expected = sqlite.stream_at("bob", watermark, limit, 1_000).unwrap();
                assert_eq!(serde_json::to_value(actual).unwrap(), serde_json::to_value(expected).unwrap());
            }
        }
    }
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes() {
    for mode in [WriteMode::Serialized, WriteMode::Serializable] {
        let (name, mut pg, _) = pair("concurrent", 0, 0);
        let barrier = Arc::new(Barrier::new(4));
        let handles: Vec<_> = (0..4)
            .map(|writer| {
                let name = name.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let mut pg = PostgresEngine::open(connect(), &name).unwrap();
                    pg.set_write_mode(mode);
                    barrier.wait();
                    let mut sequences = Vec::new();
                    for n in 0..16 {
                        let ctx = context("alice", &[("slot", id("c0"))]);
                        let outcome = pg.mutate("increment", Some(&format!("writer-{writer}-{n}")), ctx).unwrap();
                        sequences.push(sent(&outcome));
                    }
                    for _ in 0..3 {
                        sent(&pg.mutate("increment", Some("shared-op"), context("alice", &[("slot", id("c0"))])).unwrap());
                    }
                    (sequences, pg.stats().transaction_retries)
                })
            })
            .collect();
        let mut sequences = Vec::new();
        let mut retries = 0;
        for h in handles {
            let (seqs, r) = h.join().unwrap();
            sequences.extend(seqs);
            retries += r;
        }
        sequences.sort();
        sequences.dedup();
        assert_eq!(sequences.len(), 64);
        let row = pg.query("counter", context("alice", &[("slot", id("c0"))])).unwrap();
        assert_eq!(row.data.field("value").unwrap(), &Value::Int(65));
        let counts = counts(&name);
        assert_eq!(counts[2], 66);
        assert_eq!(counts[5], 65);
        assert_eq!(counts[6], 66);
        println!("{mode:?}: 65 increments, no lost updates, {retries} transaction retries");
    }
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn concurrent_mismatching_receipts_admit_one_binding_and_replay_only_its_arguments() {
    let (name, _, _) = pair("receipt_race", 0, 0);
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = (0..2).map(|writer| {
        let name = name.clone();
        let barrier = barrier.clone();
        std::thread::spawn(move || {
            let slot = format!("c{writer}");
            let raw = serde_json::json!({"slot": slot});
            let mut pg = PostgresEngine::open(connect(), &name).unwrap();
            pg.set_write_mode(WriteMode::Serializable);
            barrier.wait();
            let result = match pg.mutate("increment", Some("raced-binding"),
                context("alice", &[("slot", id(&slot))]).with_wire_args(raw.clone())) {
                Ok(outcome) => Ok((outcome.replayed, sent(&outcome))),
                Err(error) => Err(error.code().to_owned()),
            };
            (slot, raw, result)
        })
    }).collect();
    let results: Vec<_> = handles.into_iter().map(|handle| handle.join().unwrap()).collect();
    let winners: Vec<_> = results.iter().filter(|(_, _, result)| result.is_ok()).collect();
    let losers: Vec<_> = results.iter().filter(|(_, _, result)| result.is_err()).collect();
    assert_eq!((winners.len(), losers.len()), (1, 1));
    assert_eq!(winners[0].2, Ok((false, 2)), "the authoritative admission is fresh");
    assert_eq!(losers[0].2, Err("E_ID_REUSED".into()));

    let mut reopened = PostgresEngine::open(connect(), &name).unwrap();
    let winner = winners[0];
    let winner_replay = reopened.mutate("increment", Some("raced-binding"),
        context("alice", &[("slot", id(&winner.0))]).with_wire_args(winner.1.clone())).unwrap();
    assert!(winner_replay.replayed);
    let loser = losers[0];
    assert_eq!(reopened.mutate("increment", Some("raced-binding"),
        context("alice", &[("slot", id(&loser.0))]).with_wire_args(loser.1.clone())).unwrap_err().code(), "E_ID_REUSED");
    for (slot, expected) in [(&winner.0, 1), (&loser.0, 0)] {
        let row = reopened.query("counter", context("alice", &[("slot", id(slot))])).unwrap();
        assert_eq!(row.data.field("value").unwrap(), &Value::Int(expected));
    }
    assert_eq!(counts(&name)[5], 1, "the losing binding cannot replace the receipt");
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn version_one_and_two_evaluation_stores_are_refused_instead_of_being_adopted() {
    let (schema, programs) = compiled();
    let name = namespace("receipt_version");
    drop(PostgresEngine::create(connect(), &name, schema, programs).unwrap());
    let mut admin = connect();
    for version in ["snapback4-postgres-evaluation-1", "snapback4-postgres-evaluation-2"] {
        admin.execute(&format!("UPDATE {name}._backend SET version = '{version}' WHERE singleton"), &[]).unwrap();
        let error = match PostgresEngine::open(connect(), &name) {
            Ok(_) => panic!("old evaluation store {version} opened"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("not this Postgres evaluation store version"));
    }
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn existing_or_unsafe_namespace_is_never_overwritten_and_unsupported_backends_refuse() {
    let (name, _, _) = pair("safety", 1, 1);
    let before = counts(&name);
    let (schema, programs) = compiled();
    assert!(PostgresEngine::create(connect(), &name, schema.clone(), programs.clone()).is_err());
    assert!(PostgresEngine::create(connect(), "public; drop schema public", schema.clone(), programs.clone()).is_err());
    let mut native = programs.clone();
    native[0].native = true;
    assert!(PostgresEngine::create(connect(), &namespace("native"), schema, native).is_err());
    assert_eq!(counts(&name), before);
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn readers_observe_matching_rows_and_watermarks_while_a_writer_commits() {
    let (name, mut reader, _) = pair("snapshots", 0, 0);
    let barrier = Arc::new(Barrier::new(2));
    let gate = barrier.clone();
    let writer = std::thread::spawn(move || {
        let mut writer = PostgresEngine::open(connect(), &name).unwrap();
        gate.wait();
        for _ in 0..100 {
            sent(&writer.mutate("increment", None, context("alice", &[("slot", id("c0"))])).unwrap());
        }
    });
    barrier.wait();
    for _ in 0..100 {
        let row = reader.query("counter", context("alice", &[("slot", id("c0"))])).unwrap();
        assert_eq!(row.data.field("value").unwrap(), &Value::Int(row.seq as i64 - 1));
        let snapshot = reader.snapshot_page("alice", None, 100, 1_000).unwrap();
        let counter = snapshot.events.iter().find(|e| e.table == "counters" && e.id == "c0").unwrap();
        assert_eq!(counter.data.as_ref().unwrap().field("value").unwrap(), &Value::Int(snapshot.watermark as i64 - 1));
    }
    writer.join().unwrap();
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn racing_refused_operations_replay_one_receipt_without_advancing_head() {
    let (name, _, _) = pair("refusal_race", 1, 1);
    let before = counts(&name);
    let barrier = Arc::new(Barrier::new(4));
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let name = name.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut pg = PostgresEngine::open(connect(), &name).unwrap();
                pg.set_write_mode(WriteMode::Serializable);
                barrier.wait();
                pg.mutate(
                    "add",
                    Some("same-refused-op"),
                    context(
                        "alice",
                        &[("room", id("r000")), ("title", string("refused")), ("amount", Value::Int(5)), ("fail", Value::Bool(true))],
                    ),
                )
                .unwrap()
            })
        })
        .collect();
    let mut originals = 0;
    for handle in handles {
        let outcome = handle.join().unwrap();
        assert!(matches!(outcome.state, WriteState::Failed { .. }));
        originals += usize::from(!outcome.replayed);
    }
    assert_eq!(originals, 1);
    let after = counts(&name);
    for i in [0, 1, 2, 3, 4, 6] {
        assert_eq!(after[i], before[i]);
    }
    assert_eq!(after[5], before[5] + 1);
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn wide_index_key_has_the_same_portable_refusal_on_both_stores() {
    let source = "table wide:\n  key: text <=8192\n  unique byKey: key\n  read <- allow\n  insert <- allow\n  online only\nmutation add(key: text <=8192):\n  return insert wide { key }\nquery get(rowId: wide):\n  return wide[rowId]\n";
    let refused = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(refused.diagnostics.iter().any(|d| d.code == "E_INDEX_KEY_BYTES"));
    // Serialized corpus/raw core callers can bypass the Quarry binder. Keep
    // the original 6,000-byte counterexample on that trust boundary too.
    let mut bound = snapback4_lang::compile(&[("schema.q".into(), source.replace("8192", "100"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound.schema.tables.get_mut("wide").unwrap().columns.insert("key".into(), snapback4_core::schema::ColumnType::Text { max: 8192 });
    let mut programs: Vec<_> = bound.programs.into_iter().map(|p| p.program).collect();
    programs.iter_mut().find(|p| p.name == "add").unwrap().args.insert("key".into(), snapback4_core::ir::ArgType::Text { min: 0, max: 8192, format: None });
    let name = namespace("wide_index");
    let mut pg = PostgresEngine::create(connect(), &name, bound.schema.clone(), programs.clone()).unwrap();
    let mut sqlite = Engine::memory(bound.schema, programs).unwrap();
    let mut seed = 123_u64;
    let key: String = (0..6_000).map(|_| {
        seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17;
        (33 + seed % 94) as u8 as char
    }).collect();
    let ctx = context("alice", &[("key", string(key))]).with_ids(["wide-row".into()]);
    let actual = pg.mutate("add", Some("wide-op"), ctx.clone()).unwrap();
    assert_eq!(actual, sqlite.mutate("add", Some("wide-op"), ctx).unwrap());
    let WriteState::Failed { why, .. } = actual.state else { panic!("oversized key admitted") };
    assert_eq!(why.code, "E_INDEX_KEY_BYTES");
    assert_eq!(counts(&name), vec![0, 0, 0, 0, 0, 1, 0], "only the typed refusal receipt remains");
    assert!(pg.replay("alice", "wide-op").unwrap().is_some());
}

#[path = "conformance/prefetch.rs"]
mod prefetch;
