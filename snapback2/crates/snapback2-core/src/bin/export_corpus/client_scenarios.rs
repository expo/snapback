use super::*;

pub(super) fn add_client_scenarios(cases: &mut Vec<CorpusCase>) {
    let schema = spike_schema();
    let thread = thread_program(3);
    let thread_context = query_context([("conversationId", id("c1"))]);

    let mut server = Fixture::new();
    let hydration = authoritative(&mut server.engine, &schema, &thread, thread_context.clone());
    cases.push(case_from_parts(
        "scenario-hydrate",
        "scenario",
        schema.clone(),
        thread.clone(),
        thread_context.clone(),
        hydration.receipt.clone(),
        Vec::new(),
        None,
        None,
    ));

    let changed_scan = Program {
        name: "threadSuccessor".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("conversationId".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: "programs.thread.0".to_owned(),
            table: "users".to_owned(),
            index: "byId".to_owned(),
            prefix: vec![var("conversationId")],
            order: Order::Desc,
            take: Bound::Literal(3),
            after: None,
            before: None,
            range: None,
            optional_cursor_args: Vec::new(),
            merge_site: None,
            provenance: KeyProvenance::Arg,
        }))],
    };
    cases.push(case_from_parts(
        "scenario-range-scan-identity",
        "scenario",
        schema.clone(),
        changed_scan,
        thread_context.clone(),
        hydration.receipt.clone(),
        Vec::new(),
        None,
        None,
    ));

    let send = PreludeStep {
        program: send_program(false),
        context: mutation_context(
            [
                ("conversationId", id("c1")),
                ("body", text("offline")),
                ("at", Value::Int(100)),
            ],
            ["local-send"],
        ),
        expected_state: "predicted".to_owned(),
    };
    cases.push(case_from_parts(
        "scenario-local-send",
        "scenario",
        schema.clone(),
        thread.clone(),
        thread_context.clone(),
        hydration.receipt.clone(),
        vec![send.clone()],
        None,
        None,
    ));

    let first_delete = PreludeStep {
        program: delete_message_program(),
        context: mutation_context([("id", id("message-00004"))], Vec::<String>::new()),
        expected_state: "predicted".to_owned(),
    };
    cases.push(case_from_parts(
        "scenario-delete-first",
        "scenario",
        schema.clone(),
        thread.clone(),
        thread_context.clone(),
        hydration.receipt.clone(),
        vec![send.clone(), first_delete.clone()],
        None,
        None,
    ));

    let second_delete = PreludeStep {
        program: delete_message_program(),
        context: mutation_context([("id", id("message-00003"))], Vec::<String>::new()),
        expected_state: "predicted".to_owned(),
    };
    cases.push(case_from_parts(
        "scenario-delete-second",
        "scenario",
        schema.clone(),
        thread.clone(),
        thread_context.clone(),
        hydration.receipt.clone(),
        vec![send, first_delete, second_delete],
        None,
        None,
    ));

    let move_message = Program {
        name: "moveMessage".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([("id".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Update {
            table: "messages".to_owned(),
            key: var("id"),
            patch: Expr::Object(BTreeMap::from([(
                "conversationId".to_owned(),
                Expr::Literal(id("c2")),
            )])),
        }],
    };
    let moved = ["message-00004", "message-00003"].map(|message_id| PreludeStep {
        program: move_message.clone(),
        context: mutation_context([("id", id(message_id))], Vec::<String>::new()),
        expected_state: "predicted".to_owned(),
    });
    cases.push(case_from_parts(
        "scenario-range-update-halo",
        "scenario",
        schema.clone(),
        thread.clone(),
        thread_context.clone(),
        hydration.receipt.clone(),
        moved.into_iter().collect(),
        None,
        None,
    ));

    export_corpus_constraints::add_incomplete_constraint_cases(cases);

    let mention_send = PreludeStep {
        program: send_program(false),
        context: mutation_context(
            [
                ("conversationId", id("c1")),
                ("body", text("hi @bob")),
                ("at", Value::Int(101)),
            ],
            ["local-mention"],
        ),
        expected_state: "predicted".to_owned(),
    };
    cases.push(case_from_parts(
        "scenario-first-mention",
        "scenario",
        schema.clone(),
        thread.clone(),
        thread_context.clone(),
        hydration.receipt.clone(),
        vec![mention_send.clone()],
        None,
        None,
    ));

    let leave = Program {
        name: "leaveConversation".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Delete {
            table: "memberships".to_owned(),
            key: Expr::Literal(id("m1")),
        }],
    };
    authoritative(
        &mut server.engine,
        &schema,
        &leave,
        mutation_context([], Vec::<String>::new()),
    );
    let revoked = authoritative(&mut server.engine, &schema, &thread, thread_context.clone());
    cases.push(case_from_parts(
        "scenario-revocation-rehydrate",
        "scenario",
        schema,
        thread,
        thread_context,
        hydration.receipt,
        vec![mention_send],
        Some(revoked.receipt),
        None,
    ));
}
