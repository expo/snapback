use snapback2_core::*;
use std::collections::BTreeMap;

fn schema(rule_field: &str) -> Schema {
    let memberships = public_table(
        columns([
            ("id", ColumnType::Id),
            ("conversationId", ColumnType::Id),
            ("viewer", ColumnType::Principal),
        ]),
        indexes([
            ("byId", &["id"], true),
            ("byConvViewer", &["conversationId", "viewer"], true),
        ]),
    );
    let mut messages = public_table(
        columns([
            ("id", ColumnType::Id),
            ("conversationId", ColumnType::Id),
            ("authorId", ColumnType::Id),
            ("at", ColumnType::Time),
        ]),
        indexes([
            ("byId", &["id"], true),
            ("byConvTime", &["conversationId", "at", "id"], false),
        ]),
    );
    messages.rules.read = RuleExpr::Exists {
        table: "memberships".to_owned(),
        index: "byConvViewer".to_owned(),
        key: vec![RuleTerm::Field(rule_field.to_owned()), RuleTerm::Viewer],
        provenance: KeyProvenance::Shape,
    };
    Schema {
        tables: BTreeMap::from([
            ("memberships".to_owned(), memberships),
            ("messages".to_owned(), messages),
        ]),
        ..Schema::default()
    }
}

fn program(calls: usize) -> Program {
    let scan = Expr::Scan(scan(Expr::Literal(id("c1")), 50));
    repeated_scan_program(scan, calls)
}

fn scan(prefix: Expr, take: u32) -> Scan {
    Scan {
        site: "messages.list".to_owned(),
        table: "messages".to_owned(),
        index: "byConvTime".to_owned(),
        prefix: vec![prefix],
        order: Order::Desc,
        take: Bound::Literal(take),
        after: None,
        before: None,
        range: None,
        opaque_cursor: false,
        merge_site: None,
        provenance: KeyProvenance::Const,
    }
}

fn repeated_scan_program(scan: Expr, calls: usize) -> Program {
    let mut body = (1..calls)
        .map(|call| Stmt::Const {
            name: format!("page{call}"),
            value: scan.clone(),
        })
        .collect::<Vec<_>>();
    body.push(Stmt::Return(scan));
    Program {
        name: "messages.list".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        result_page_site: None,
        body,
    }
}

fn generation(rule_field: &str, calls: usize) -> Generation {
    certify(schema(rule_field), program(calls))
}

fn certify(schema: Schema, program: Program) -> Generation {
    Generation::certify(
        &ProjectJson {
            version: 1,
            schema,
            programs: vec![program],
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap()
}

// @ref LLP 1001#3-read-and-write-states-no-silent-states — hoisted scans certify their reserve; hidden runs keep the ceiling.
#[test]
fn hoisted_list_certifies_reserve() {
    let generation = generation("conversationId", 1);
    let (_, certificate) = &generation.programs()["messages.list"];
    assert_eq!(certificate.max_examined, 52);
    assert_eq!(certificate.max_index_entries, 52);
    assert_eq!(certificate.max_rule_probes, 1);
    assert_eq!(certificate.max_steps, 263);
    assert!(certificate.read_sites[0].hoist);
}

#[test]
fn nonuniform_list_certifies_ceiling() {
    let generation = generation("authorId", 1);
    let (_, certificate) = &generation.programs()["messages.list"];
    assert_eq!(certificate.max_examined, 10_240);
    assert_eq!(certificate.max_index_entries, 10_240);
    assert_eq!(certificate.max_rule_probes, 10_240);
    assert_eq!(certificate.max_steps, 51_203);
    assert!(!certificate.read_sites[0].hoist);
}

#[test]
fn hoisted_reserve_serves_full_pages_and_charges_one_candidate_on_denial() {
    for (calls, take) in [(1, 50), (2, 50), (2, 1)] {
        let generation = certify(
            schema("conversationId"),
            repeated_scan_program(Expr::Scan(scan(Expr::Literal(id("c1")), take)), calls),
        );
        let (program, certificate) = &generation.programs()["messages.list"];
        assert_eq!(certificate.max_examined, calls as u64 * u64::from(take + 2));
        assert_eq!(certificate.read_sites[0].max_calls, calls as u64);
        let mut engine = seeded_engine(&generation, id("c1"), 60);
        for (viewer, allowed) in [("u1", true), ("outsider", false)] {
            let execution = engine
                .execute(
                    program,
                    certificate,
                    Context::query(Actor::user(viewer).unwrap(), BTreeMap::new()),
                )
                .unwrap();
            let Value::Array(rows) = &execution.result else {
                panic!("expected a page: {:?}", execution.result);
            };
            assert_eq!(rows.len(), if allowed { take as usize } else { 0 });
            assert_eq!(
                execution.trace.examined,
                calls as u64 * if allowed { u64::from(take + 2) } else { 1 },
            );
            // Allowed calls share a verdict; denial rolls back the candidate memo.
            assert_eq!(
                execution.trace.rule_probes,
                if allowed { 1 } else { calls as u64 }
            );
            assert_eq!(execution.trace.ranges.len(), calls);
            assert!(certificate.max_steps >= execution.trace.steps);
            for range in &execution.trace.ranges {
                assert_eq!(
                    range.returned_ids.len(),
                    if allowed { take as usize } else { 0 }
                );
                assert_eq!(
                    range.examined_ids.len(),
                    if allowed { (take + 2) as usize } else { 1 }
                );
                assert_eq!(range.halo.is_some(), allowed);
                assert_eq!(range.n2_key.is_some(), allowed);
                assert_eq!(
                    range.stop,
                    if allowed {
                        StopReason::Limit
                    } else {
                        StopReason::Exhausted
                    }
                );
            }
        }
    }
}

// @ref LLP 1001#3-read-and-write-states-no-silent-states — prefix expression
// work survives reserve synthesis even without the old protected-scan padding.
#[test]
fn complex_uniform_prefix_executes_within_its_own_step_certificate() {
    let mut schema = schema("conversationId");
    for table in ["messages", "memberships"] {
        schema
            .tables
            .get_mut(table)
            .unwrap()
            .columns
            .insert("conversationId".to_owned(), ColumnType::Int);
    }
    let prefix = (0..10).fold(Expr::Variable("scope".to_owned()), |left, _| Expr::Binary {
        op: BinaryOp::Add,
        left: Box::new(left),
        right: Box::new(Expr::Literal(Value::Int(0))),
    });
    let mut program = repeated_scan_program(Expr::Scan(scan(prefix, 1)), 1);
    program.args.insert("scope".to_owned(), ArgType::Int);
    let generation = certify(schema, program);
    let (program, certificate) = &generation.programs()["messages.list"];
    assert!(certificate.read_sites[0].hoist);
    assert_eq!(certificate.max_examined, 3);
    assert_eq!(certificate.max_steps, 21 + 3 * 5 + 2);
    let execution = seeded_engine(&generation, Value::Int(1), 8)
        .execute(
            program,
            certificate,
            Context::query(
                Actor::user("u1").unwrap(),
                BTreeMap::from([("scope".to_owned(), Value::Int(1))]),
            ),
        )
        .unwrap();
    assert_eq!(execution.result.as_array().unwrap().len(), 1);
    assert_eq!(execution.trace.examined, 3);
    assert!(certificate.max_steps >= execution.trace.steps);
}

fn protected_point_field(field: &str) -> Expr {
    Expr::Field {
        base: Box::new(Expr::Get(Read {
            site: "messages.point".to_owned(),
            table: "messages".to_owned(),
            index: "byId".to_owned(),
            key: vec![Expr::Literal(id("m00"))],
            provenance: KeyProvenance::Const,
        })),
        name: field.to_owned(),
    }
}

#[test]
fn scan_prefix_keeps_nested_protected_point_read_work() {
    let generation = certify(
        schema("conversationId"),
        repeated_scan_program(
            Expr::Scan(scan(protected_point_field("conversationId"), 1)),
            1,
        ),
    );
    let (program, certificate) = &generation.programs()["messages.list"];
    assert_eq!(certificate.max_examined, 3 + 1);
    assert_eq!(certificate.max_index_entries, 3 + 1);
    assert_eq!(certificate.max_rule_probes, 2);
    assert_eq!(certificate.read_sites.len(), 2);
    let execution = seeded_engine(&generation, id("c1"), 8)
        .execute(
            program,
            certificate,
            Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert_eq!(execution.result.as_array().unwrap().len(), 1);
    assert_eq!(execution.trace.examined, 4);
    assert_eq!(execution.trace.points.len(), 1);
    assert!(certificate.max_steps >= execution.trace.steps);
}

#[test]
fn point_read_keys_keep_nested_protected_get_work() {
    for exists in [false, true] {
        let read = Read {
            site: "messages.outer".to_owned(),
            table: "messages".to_owned(),
            index: "byId".to_owned(),
            key: vec![protected_point_field("id")],
            provenance: KeyProvenance::Shape,
        };
        let generation = certify(
            schema("conversationId"),
            repeated_scan_program(
                if exists {
                    Expr::Exists(read)
                } else {
                    Expr::Get(read)
                },
                1,
            ),
        );
        let (program, certificate) = &generation.programs()["messages.list"];
        assert_eq!(certificate.max_examined, 2);
        assert_eq!(certificate.max_index_entries, 2);
        assert_eq!(certificate.max_rule_probes, 2);
        assert_eq!(certificate.read_sites.len(), 2);
        let execution = seeded_engine(&generation, id("c1"), 1)
            .execute(
                program,
                certificate,
                Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
            )
            .unwrap();
        if exists {
            assert_eq!(execution.result, Value::Bool(true));
        } else {
            assert_eq!(execution.result.field("id").unwrap(), &id("m00"));
        }
        assert_eq!(execution.trace.examined, 2);
        assert_eq!(execution.trace.points.len(), 2);
        assert!(certificate.max_steps >= execution.trace.steps);
    }
}

#[test]
fn uniform_fetch_clamp_preserves_exhaustion_halo_and_n2_boundaries() {
    let generation = certify(
        schema("conversationId"),
        repeated_scan_program(Expr::Scan(scan(Expr::Literal(id("c1")), 1)), 2),
    );
    let (program, certificate) = &generation.programs()["messages.list"];
    for count in [0, 1, 2, 3, 8] {
        let execution = seeded_engine(&generation, id("c1"), count)
            .execute(
                program,
                certificate,
                Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
            )
            .unwrap();
        assert_eq!(execution.trace.ranges.len(), 2);
        for range in &execution.trace.ranges {
            assert_eq!(range.returned_ids.len(), count.min(1) as usize);
            assert_eq!(range.examined_ids.len(), count.min(3) as usize);
            assert_eq!(range.halo.is_some(), count >= 2);
            assert_eq!(range.n2_key.is_some(), count >= 3);
            assert_eq!(
                range.stop,
                if count <= 1 {
                    StopReason::Exhausted
                } else {
                    StopReason::Limit
                }
            );
        }
    }
}

fn seeded_engine(generation: &Generation, conversation: Value, count: i64) -> Engine {
    let mut engine = Engine::memory(generation.schema().clone()).unwrap();
    engine
        .seed(
            "memberships",
            object([
                ("id", id("member")),
                ("conversationId", conversation.clone()),
                ("viewer", id("u1")),
            ]),
        )
        .unwrap();
    for at in 0..count {
        engine
            .seed(
                "messages",
                object([
                    ("id", id(format!("m{at:02}"))),
                    ("conversationId", conversation.clone()),
                    ("authorId", id("u1")),
                    ("at", Value::Int(at)),
                ]),
            )
            .unwrap();
    }
    engine
}

fn columns<const N: usize>(columns: [(&str, ColumnType); N]) -> BTreeMap<String, ColumnType> {
    columns
        .into_iter()
        .map(|(name, kind)| (name.to_owned(), kind))
        .collect()
}

fn indexes<const N: usize>(indexes: [(&str, &[&str], bool); N]) -> BTreeMap<String, Index> {
    indexes
        .into_iter()
        .map(|(name, columns, unique)| {
            (
                name.to_owned(),
                Index {
                    columns: columns.iter().map(|name| (*name).to_owned()).collect(),
                    unique,
                },
            )
        })
        .collect()
}

fn id(value: impl Into<String>) -> Value {
    Value::Id(value.into())
}

// @ref LLP 1001#3-read-and-write-states-no-silent-states — a non-uniform scan nested
// in a uniform scan's key keeps the whole program on the ceiling (LLP 1017 §1: the
// scan summary must merge the inherited flag, never overwrite it).
#[test]
fn nested_nonuniform_scan_in_a_key_keeps_the_ceiling() {
    let memberships = public_table(
        columns([
            ("id", ColumnType::Id),
            ("conversationId", ColumnType::Id),
            ("viewer", ColumnType::Principal),
        ]),
        indexes([
            ("byId", &["id"], true),
            ("byConvViewer", &["conversationId", "viewer"], true),
        ]),
    );
    let mut posts = public_table(
        columns([
            ("id", ColumnType::Id),
            ("authorId", ColumnType::Id),
            ("bucket", ColumnType::Int),
        ]),
        indexes([
            ("byId", &["id"], true),
            ("byBucket", &["bucket", "id"], false),
        ]),
    );
    // The rule reads authorId, which the byBucket prefix does not pin: non-uniform.
    posts.rules.read = RuleExpr::Exists {
        table: "memberships".to_owned(),
        index: "byConvViewer".to_owned(),
        key: vec![RuleTerm::Field("authorId".to_owned()), RuleTerm::Viewer],
        provenance: KeyProvenance::Shape,
    };
    let tallies = public_table(
        columns([("id", ColumnType::Id), ("bucket", ColumnType::Int)]),
        indexes([
            ("byId", &["id"], true),
            ("byBucket", &["bucket", "id"], false),
        ]),
    );
    let schema = Schema {
        tables: BTreeMap::from([
            ("memberships".to_owned(), memberships),
            ("posts".to_owned(), posts),
            ("tallies".to_owned(), tallies),
        ]),
        ..Schema::default()
    };
    let inner = Scan {
        site: "tallies.list.posts".to_owned(),
        table: "posts".to_owned(),
        index: "byBucket".to_owned(),
        prefix: vec![Expr::Literal(Value::int(1).unwrap())],
        order: Order::Asc,
        take: Bound::Literal(5),
        after: None,
        before: None,
        range: None,
        opaque_cursor: false,
        merge_site: None,
        provenance: KeyProvenance::Const,
    };
    let outer = Scan {
        site: "tallies.list".to_owned(),
        table: "tallies".to_owned(),
        index: "byBucket".to_owned(),
        prefix: vec![Expr::Builtin {
            builtin: Builtin::Count,
            args: vec![Expr::Scan(inner)],
        }],
        order: Order::Asc,
        take: Bound::Literal(10),
        after: None,
        before: None,
        range: None,
        opaque_cursor: false,
        merge_site: None,
        provenance: KeyProvenance::Shape,
    };
    let program = Program {
        name: "tallies.list".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![Stmt::Return(Expr::Scan(outer))],
    };
    let project = ProjectJson {
        version: 1,
        schema,
        programs: vec![program],
        effects: Vec::new(),
        auth: Auth::default(),
    };
    match Generation::certify(&project, Ceilings::default()) {
        Ok(generation) => {
            // The outer scan is public (uniform); the nested scan is not. The program
            // must certify the examined ceiling, not the outer scan's reserve.
            let (_, certificate) = &generation.programs()["tallies.list"];
            assert_eq!(certificate.max_examined, 10_240);
            assert_eq!(certificate.max_rule_probes, 10_240);
        }
        Err(errors) => {
            // A structural refusal of the count-as-key is also a closed door; it must
            // be the structural family, never a silent certificate at the reserve.
            assert!(
                errors.iter().any(|(_, error)| error.code == "E_STRUCTURAL_COUNT"),
                "unexpected refusal: {errors:?}"
            );
        }
    }
}
