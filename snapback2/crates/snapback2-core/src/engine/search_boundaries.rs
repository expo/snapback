use super::*;
use crate::search_key::{IndexAtom, IndexComponent, SearchContract, WordPrefix};
use crate::{ClientStore, Generation, LocalState, ProjectJson, Runtime, Store};

fn generation(schema: Schema, programs: Vec<Program>) -> Generation {
    Generation::certify(
        &ProjectJson {
            version: 1,
            auth: Default::default(),
            schema,
            programs,
            effects: vec![],
        },
        Ceilings::default(),
    )
    .unwrap()
}

#[test]
fn same_term_coalesces_but_different_terms_reserve_and_deduplicate_overlap() {
    let (mut engine, programs) = fixture();
    conversation(&mut engine, "c1");
    for (id, body, at) in [("a", "cat dog", 3), ("b", "cat", 2), ("c", "dog", 1)] {
        engine
            .seed("messages", message(id, "c1", Some(body), None, at))
            .unwrap();
    }
    let mut p = program(&programs, "search.inConversation");
    let Stmt::Return(Expr::Scan(scan)) = &p.body[0] else {
        panic!("scan")
    };
    let mut scan = scan.clone();
    scan.after = None;
    scan.opaque_cursor = false;
    scan.merge_site = Some("union".into());
    scan.take = Bound::Literal(2);
    let mut lanes = Vec::new();
    for (site, term) in [("cats", "ca"), ("dogs", "do")] {
        let mut scan = scan.clone();
        scan.site = site.into();
        scan.prefix[1] = IndexKeyExpr::WordPrefix {
            source: Expr::Literal(Value::String(term.into())),
            contract: SearchContract::Unicode17,
            source_max: 2,
        };
        lanes.push(MergeLane {
            scan,
            source: None,
            binding: String::new(),
            setup: vec![],
        });
    }
    p.body = vec![Stmt::Return(Expr::Merge(Merge {
        site: "union".into(),
        lanes,
        held_search: None,
    }))];
    let cert = Checker::new(&engine.schema, Ceilings::default())
        .check(&p)
        .unwrap();
    assert!(!cert.merge_sites[0].uniform);
    let execution = query(&mut engine, &p, "").unwrap();
    assert_eq!(ids(&execution), ["a", "b"]);
    assert!(execution.trace.examined <= cert.max_examined);
    assert!(execution.trace.derived_steps <= cert.derived_steps);
    let Stmt::Return(Expr::Merge(merge)) = &mut p.body[0] else {
        unreachable!()
    };
    merge.lanes[1].scan.prefix[1] = IndexKeyExpr::WordPrefix {
        source: Expr::Literal(Value::String("CA".into())),
        contract: SearchContract::Unicode17,
        source_max: 2,
    };
    let shared = Checker::new(&engine.schema, Ceilings::default())
        .check(&p)
        .unwrap();
    assert!(shared.merge_sites[0].uniform);
    assert!(shared.max_index_entries < cert.max_index_entries);
    let same = query(&mut engine, &p, "").unwrap();
    assert_eq!(ids(&same), ["a", "b"]);
    assert_eq!(same.trace.ranges.len(), 1);
}

#[test]
fn receipt_coverage_requires_issuing_q_same_meaning_and_own_pool() {
    let (mut engine, programs) = fixture();
    conversation(&mut engine, "c1");
    for i in 0..24 {
        engine
            .seed(
                "messages",
                message(&format!("m{i}"), "c1", Some("café"), None, i),
            )
            .unwrap();
    }
    let p = program(&programs, "search.inConversation");
    let cert = Checker::new(&engine.schema, Ceilings::default())
        .check(&p)
        .unwrap();
    let execution = query(&mut engine, &p, "CAFÉ").unwrap();
    let context = |term: &str| {
        Context::query(
            Actor::user("alice").unwrap(),
            BTreeMap::from([
                ("term".into(), Value::String(term.into())),
                ("c".into(), Value::Null),
                ("conversation".into(), Value::Id("c1".into())),
            ]),
        )
    };
    let mut local = ClientStore::hydrate(engine.schema.clone(), &execution.receipt).unwrap();
    assert_eq!(
        local
            .reexecute(&p, &cert, context("cafe\u{301}"))
            .unwrap()
            .0,
        LocalState::Fresh
    );
    assert!(matches!(
        local.reexecute(&p, &cert, context("ca")).unwrap().0,
        LocalState::Partial(_)
    ));
    let range = execution
        .receipt
        .ranges
        .iter()
        .find(|r| r.table == "messages")
        .unwrap();
    let mut no_issuer = p.clone();
    no_issuer.body.clear();
    assert!(
        crate::search_key::prepare_receipt_prefix(
            &engine.schema,
            &no_issuer,
            &range.site,
            &range.table,
            &range.index,
            &range.prefix
        )
        .is_err()
    );
    let mut excessive = range.prefix.clone();
    excessive[1] = IndexAtom::WordPrefix(WordPrefix {
        contract: SearchContract::Unicode17,
        source: "a".repeat(2001),
    });
    assert!(
        crate::search_key::prepare_receipt_prefix(
            &engine.schema,
            &p,
            &range.site,
            &range.table,
            &range.index,
            &excessive
        )
        .is_err()
    );
    let mut missing = execution.receipt.clone();
    let halo = range.halo.as_ref().unwrap();
    missing
        .rows
        .retain(|r| r.table != halo.table || r.id != halo.id);
    assert!(ClientStore::hydrate(engine.schema.clone(), &missing).is_err());
    let mut conflict = execution.receipt.clone();
    let mut duplicate = conflict.rows[0].clone();
    if let Value::Row(fields) = &mut duplicate.row {
        fields.insert("id".into(), Value::Id("wrong".into()));
    }
    conflict.rows.push(duplicate);
    assert!(ClientStore::hydrate(engine.schema.clone(), &conflict).is_err());
    // Content-only edits consume retained lookahead just like suffix changes.
    let mut local = ClientStore::hydrate(engine.schema.clone(), &execution.receipt).unwrap();
    for i in [23, 22] {
        let write = Program {
            name: "remove-match".into(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body: vec![Stmt::Update {
                table: "messages".into(),
                key: Expr::Literal(Value::Id(format!("m{i}"))),
                patch: Expr::Literal(object([("body", Value::String("dog".into()))])),
            }],
        };
        let wc = Checker::new(&engine.schema, Ceilings::default())
            .check(&write)
            .unwrap();
        assert_eq!(
            local
                .apply_mutation(
                    &write,
                    &wc,
                    Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new())
                )
                .unwrap()
                .0,
            LocalState::Predicted
        );
    }
    assert!(matches!(
        local.reexecute(&p, &cert, context("café")).unwrap().0,
        LocalState::Partial(_)
    ));
}

#[test]
fn derived_successor_is_atomic_across_batches_and_replaces_policy_hashes() {
    let (engine, programs) = fixture();
    let next = engine.schema.clone();
    let mut before = next.clone();
    before
        .tables
        .get_mut("messages")
        .unwrap()
        .indexes
        .remove("byConversationWords");
    let mut runtime =
        Runtime::open(Store::memory().unwrap(), generation(before.clone(), vec![])).unwrap();
    let rows = (0..260)
        .map(|i| {
            (
                "messages".into(),
                message(&format!("m{i:03}"), "c1", Some("cat"), None, i),
            )
        })
        .collect::<Vec<_>>();
    runtime.seed(&rows).unwrap();
    let old = runtime.generation().hash();
    runtime.engine.store.conn.execute_batch("CREATE TRIGGER fail_search BEFORE INSERT ON _search_postings WHEN NEW.row_id='m200' BEGIN SELECT RAISE(ABORT,'search rebuild fault'); END;").unwrap();
    assert!(
        runtime
            .apply_successor(generation(next.clone(), vec![]))
            .is_err()
    );
    assert_eq!(runtime.generation().hash(), old);
    assert_eq!(
        runtime
            .engine
            .store
            .conn
            .query_row("SELECT count(*) FROM _search_nodes", [], |r| r
                .get::<_, u64>(0))
            .unwrap(),
        0
    );
    assert_eq!(runtime.engine.rows("messages").unwrap().len(), 260);
    runtime
        .engine
        .store
        .conn
        .execute_batch("DROP TRIGGER fail_search")
        .unwrap();
    runtime
        .apply_successor(generation(next.clone(), programs.clone()))
        .unwrap();
    assert!(
        search_index::resolve(
            &runtime.engine.store.conn,
            "messages",
            "byConversationWords",
            Some("ca")
        )
        .unwrap()
        .is_some()
    );
    conversation(&mut runtime.engine, "c1");
    let p = program(&programs, "search.inConversation");
    assert_eq!(
        ids(&query(&mut runtime.engine, &p, "ca").unwrap()).len(),
        20
    );
    let mut denied = next;
    denied.tables.get_mut("messages").unwrap().rules.read = RuleExpr::Deny;
    // The formerly held global plan cannot cross a policy replacement.
    runtime
        .apply_successor(generation(denied, vec![p.clone()]))
        .unwrap();
    assert!(ids(&query(&mut runtime.engine, &p, "ca").unwrap()).is_empty());
}

#[test]
fn identity_width_and_seed_failures_leave_source_and_dictionary_unchanged() {
    let (mut engine, _) = fixture();
    for s in [
        "a".repeat(135),
        "𐐀".repeat(33) + "abc",
        "\"".repeat(67) + "a",
    ] {
        assert!(crate::value::identity_fits(&s), "{s:?}");
    }
    for s in ["a".repeat(136), "𐐀".repeat(34), "\"".repeat(68)] {
        assert!(!crate::value::identity_fits(&s));
        assert!(Actor::user(&s).is_err());
        assert!(
            engine
                .seed("messages", message(&s, "c1", Some("cat"), None, 1))
                .is_err()
        );
        assert!(validate_arg_value(&ArgType::Id, &Value::Id(s.clone()), "arg").is_err());
        let cursor = crate::cursor::CursorPosition {
            table: "messages".into(),
            index: "byConversationWords".into(),
            order: Order::Asc,
            suffix: vec![crate::cursor::CursorColumn {
                name: "id".into(),
                kind: ColumnType::Id,
            }],
            values: vec![Value::Id(s.clone())],
        };
        assert!(crate::cursor::encode_cursor(&engine.schema, &cursor).is_err());
        let p = Program {
            name: "mint".into(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body: vec![Stmt::Return(Expr::Input(Input::NewId))],
        };
        let cert = Checker::new(&engine.schema, Ceilings::default())
            .check(&p)
            .unwrap();
        let mut context = Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new());
        context.new_ids.push_back(s);
        assert!(engine.execute(&p, &cert, context).is_err());
    }
    engine.store.conn.execute_batch("CREATE TRIGGER seed_fault BEFORE INSERT ON _search_postings BEGIN SELECT RAISE(ABORT,'fault'); END;").unwrap();
    assert!(
        engine
            .seed("messages", message("a", "c1", Some("cat"), None, 1))
            .is_err()
    );
    assert!(engine.rows("messages").unwrap().is_empty());
    assert_eq!(
        engine
            .store
            .conn
            .query_row("SELECT count(*) FROM _search_nodes", [], |r| r
                .get::<_, u64>(0))
            .unwrap(),
        0
    );
    engine
        .store
        .conn
        .execute_batch("DROP TRIGGER seed_fault")
        .unwrap();
    // Old stores cannot evade the new identity allowance through unchanged columns.
    let invalid = message(&"a".repeat(136), "c1", Some("cat"), None, 1);
    engine
        .store
        .conn
        .execute(
            "INSERT INTO rows(table_name,row_id,data) VALUES ('messages',?1,?2)",
            params![
                invalid.field("id").unwrap().as_str().unwrap(),
                canonical_json(&invalid)
            ],
        )
        .unwrap();
    assert!(
        crate::successor::validate_stored_rows(
            &engine.store.conn,
            &engine.schema,
            &engine.schema,
            &BTreeSet::new(),
            &Default::default()
        )
        .unwrap()
        .is_some()
    );
}

#[test]
fn content_scope_and_authority_changes_invalidate_all_interested_consumers() {
    let (engine, programs) = fixture();
    let schema = engine.schema.clone();
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(schema, programs.clone()),
    )
    .unwrap();
    conversation(&mut runtime.engine, "c1");
    conversation(&mut runtime.engine, "c2");
    runtime
        .engine
        .seed("messages", message("a", "c1", Some("cat"), None, 1))
        .unwrap();
    let ctx = |c: &str, t: &str| {
        Context::query(
            Actor::user("alice").unwrap(),
            BTreeMap::from([
                ("term".into(), Value::String(t.into())),
                ("c".into(), Value::Null),
                ("conversation".into(), Value::Id(c.into())),
            ]),
        )
    };
    let (cat, _) = runtime
        .subscribe("search.inConversation", ctx("c1", "ca"))
        .unwrap();
    let (dog, _) = runtime
        .subscribe("search.inConversation", ctx("c1", "do"))
        .unwrap();
    let (second_cat, _) = runtime
        .subscribe("search.inConversation", ctx("c1", "CA"))
        .unwrap();
    let (other, _) = runtime
        .subscribe("search.inConversation", ctx("c2", "ca"))
        .unwrap();
    write(
        &mut runtime.engine,
        Stmt::Update {
            table: "messages".into(),
            key: Expr::Literal(Value::Id("a".into())),
            patch: Expr::Literal(object([("body", Value::String("dog".into()))])),
        },
    );
    let commit = runtime
        .store()
        .commits_since(0, 100)
        .unwrap()
        .pop()
        .unwrap();
    let invalid = runtime.invalidated(&commit);
    assert!(invalid.contains(&cat) && invalid.contains(&dog));
    assert!(!invalid.contains(&other));
    write(
        &mut runtime.engine,
        Stmt::Update {
            table: "messages".into(),
            key: Expr::Literal(Value::Id("a".into())),
            patch: Expr::Literal(object([("conversation", Value::Id("c2".into()))])),
        },
    );
    let commit = runtime
        .store()
        .commits_since(0, 100)
        .unwrap()
        .pop()
        .unwrap();
    assert!(runtime.invalidated(&commit).contains(&other));
    write(
        &mut runtime.engine,
        Stmt::Delete {
            table: "memberships".into(),
            key: Expr::Literal(Value::Id("membership-c1".into())),
        },
    );
    let commit = runtime
        .store()
        .commits_since(0, 100)
        .unwrap()
        .pop()
        .unwrap();
    let invalid = runtime.invalidated(&commit);
    assert!(invalid.contains(&cat) && invalid.contains(&second_cat));
}

#[test]
fn multiple_derived_indexes_collect_reverse_membership_without_retokenizing_old_rows() {
    let (engine, _) = fixture();
    let mut schema = engine.schema.clone();
    let mut extra = schema.tables["messages"].indexes["byConversationWords"].clone();
    extra.components[1] = IndexComponent::WordPrefixes {
        fields: vec!["caption".into()],
        contract: SearchContract::Unicode17,
    };
    schema
        .tables
        .get_mut("messages")
        .unwrap()
        .indexes
        .insert("captionWords".into(), extra);
    let mut engine = Engine::memory(schema).unwrap();
    write(
        &mut engine,
        Stmt::Insert {
            table: "messages".into(),
            row: Expr::Literal(message("a", "c1", Some("cat cat"), Some("cat"), 1)),
        },
    );
    write(
        &mut engine,
        Stmt::Delete {
            table: "messages".into(),
            key: Expr::Literal(Value::Id("a".into())),
        },
    );
    for table in ["_search_nodes", "_search_postings"] {
        assert_eq!(
            engine
                .store
                .conn
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, u64>(0))
                .unwrap(),
            0
        );
    }
}

#[test]
fn pooled_images_preserve_independent_trace_and_receipt_first_observations() {
    let mut membership = row_membership::RowMembership::default();
    let mut trace = Vec::new();
    let mut receipt = Vec::new();
    let old = message("a", "c1", Some("old"), None, 1);
    let new = message("a", "c1", Some("new"), None, 1);
    membership.record(&mut trace, &mut receipt, "messages", "a", &old, false);
    membership.record(&mut trace, &mut receipt, "messages", "a", &new, true);
    membership.record(&mut trace, &mut receipt, "messages", "a", &old, true);
    assert_eq!(trace[0].row, old);
    assert_eq!(receipt[0].row, new);
    let (Value::Row(t), Value::Row(r)) = (&trace[0].row, &receipt[0].row) else {
        unreachable!()
    };
    assert!(!t.shares_image(r));
    membership.remove_receipt(&trace, "messages", "a");
    receipt.clear();
    membership.record(&mut trace, &mut receipt, "messages", "a", &old, true);
    let (Value::Row(t), Value::Row(r)) = (&trace[0].row, &receipt[0].row) else {
        unreachable!()
    };
    assert!(t.shares_image(r));
}

#[test]
fn reset_seed_clears_native_indexes_atomically_when_row_ids_are_reused() {
    let (mut engine, programs) = fixture();
    conversation(&mut engine, "c1");
    engine
        .seed("messages", message("a", "c1", Some("cat"), None, 1))
        .unwrap();
    let mut p = Program {
        name: "seed.search".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Insert {
                table: "messages".into(),
                row: Expr::Literal(message("a", "c1", Some("dog"), None, 2)),
            },
            Stmt::Require {
                site: None,
                condition: Expr::Literal(Value::Bool(false)),
                code: "ROLLBACK".into(),
            },
        ],
    };
    let cert = Checker::new(&engine.schema, Ceilings::default())
        .check(&p)
        .unwrap();
    assert!(
        engine
            .reset_and_execute(&p, &cert, Context::system(), Some("seed"))
            .is_err()
    );
    assert!(
        search_index::resolve(
            &engine.store.conn,
            "messages",
            "byConversationWords",
            Some("ca")
        )
        .unwrap()
        .is_some()
    );
    assert!(
        search_index::resolve(
            &engine.store.conn,
            "messages",
            "byConversationWords",
            Some("do")
        )
        .unwrap()
        .is_none()
    );
    p.body.pop();
    let cert = Checker::new(&engine.schema, Ceilings::default())
        .check(&p)
        .unwrap();
    engine
        .reset_and_execute(&p, &cert, Context::system(), Some("seed"))
        .unwrap();
    assert!(
        search_index::resolve(
            &engine.store.conn,
            "messages",
            "byConversationWords",
            Some("ca")
        )
        .unwrap()
        .is_none()
    );
    assert!(
        search_index::resolve(
            &engine.store.conn,
            "messages",
            "byConversationWords",
            Some("do")
        )
        .unwrap()
        .is_some()
    );
    conversation(&mut engine, "c1");
    let query_program = program(&programs, "search.inConversation");
    assert!(ids(&query(&mut engine, &query_program, "ca").unwrap()).is_empty());
    assert_eq!(
        ids(&query(&mut engine, &query_program, "do").unwrap()),
        ["a"]
    );
}
