use crate::ir::*;
use crate::schema::*;
use crate::value::Value;
use std::collections::BTreeMap;

pub fn spike_schema() -> Schema {
    let mut tables = BTreeMap::new();

    let membership_read = RuleExpr::Exists {
        table: "memberships".to_owned(),
        index: "byConvUser".to_owned(),
        key: vec![
            RuleTerm::Field("conversationId".to_owned()),
            RuleTerm::Viewer,
        ],
        provenance: KeyProvenance::Shape,
    };
    tables.insert(
        "memberships".to_owned(),
        Table {
            columns: columns([
                ("id", ColumnType::Id),
                ("conversationId", reference("conversations")),
                ("userId", reference("users")),
                ("lastReadAt", ColumnType::Time),
                ("activity", ColumnType::Time),
            ]),
            indexes: indexes([
                ("byId", &["id"], true),
                ("byConvUser", &["conversationId", "userId"], true),
                ("byUserActivity", &["userId", "activity"], false),
                ("byConversation", &["conversationId", "userId"], false),
            ]),
            rules: Rules {
                read: membership_read.clone(),
                insert: RuleExpr::Allow,
                update: RuleExpr::Eq(RuleTerm::Field("userId".to_owned()), RuleTerm::Viewer),
                delete: RuleExpr::Eq(RuleTerm::Field("userId".to_owned()), RuleTerm::Viewer),
            },
            constraints: vec![Constraint::Unique {
                index: "byConvUser".to_owned(),
            }],
        },
    );

    let membership_exists = || RuleExpr::Exists {
        table: "memberships".to_owned(),
        index: "byConvUser".to_owned(),
        key: vec![
            RuleTerm::Field("conversationId".to_owned()),
            RuleTerm::Viewer,
        ],
        provenance: KeyProvenance::Shape,
    };
    tables.insert(
        "messages".to_owned(),
        Table {
            columns: columns([
                ("id", ColumnType::Id),
                ("conversationId", reference("conversations")),
                ("authorId", reference("users")),
                ("body", ColumnType::Text { max: 256 }),
                ("at", ColumnType::Time),
            ]),
            indexes: indexes([
                ("byId", &["id"], true),
                ("byConvTime", &["conversationId", "at", "id"], false),
                ("byToken", &["body", "id"], false),
            ]),
            rules: Rules {
                read: membership_exists(),
                insert: RuleExpr::And(vec![
                    RuleExpr::Eq(RuleTerm::Field("authorId".to_owned()), RuleTerm::Viewer),
                    membership_exists(),
                ]),
                update: RuleExpr::Eq(RuleTerm::Field("authorId".to_owned()), RuleTerm::Viewer),
                delete: RuleExpr::Eq(RuleTerm::Field("authorId".to_owned()), RuleTerm::Viewer),
            },
            constraints: Vec::new(),
        },
    );

    tables.insert(
        "waitlist".to_owned(),
        Table {
            columns: columns([
                ("id", ColumnType::Id),
                ("resourceId", ColumnType::Id),
                ("ownerId", reference("users")),
            ]),
            indexes: indexes([
                ("byId", &["id"], true),
                ("byResource", &["resourceId", "id"], false),
            ]),
            rules: Rules {
                read: RuleExpr::Eq(RuleTerm::Field("ownerId".to_owned()), RuleTerm::Viewer),
                insert: RuleExpr::Allow,
                update: RuleExpr::Allow,
                delete: RuleExpr::Allow,
            },
            constraints: Vec::new(),
        },
    );

    tables.insert(
        "entitlements".to_owned(),
        Table {
            columns: columns([("id", ColumnType::Id), ("userId", reference("users"))]),
            indexes: indexes([("byId", &["id"], true), ("byUser", &["userId"], true)]),
            rules: Rules {
                read: RuleExpr::Deny,
                insert: RuleExpr::Allow,
                update: RuleExpr::Allow,
                delete: RuleExpr::Allow,
            },
            constraints: Vec::new(),
        },
    );
    tables.insert(
        "secretDocs".to_owned(),
        Table {
            columns: columns([
                ("id", ColumnType::Id),
                ("title", ColumnType::Text { max: 64 }),
            ]),
            indexes: indexes([("byId", &["id"], true)]),
            rules: Rules {
                read: RuleExpr::Exists {
                    table: "entitlements".to_owned(),
                    index: "byUser".to_owned(),
                    key: vec![RuleTerm::Viewer],
                    provenance: KeyProvenance::Viewer,
                },
                insert: RuleExpr::Allow,
                update: RuleExpr::Allow,
                delete: RuleExpr::Allow,
            },
            constraints: Vec::new(),
        },
    );

    for (name, table) in [
        ("users", users_table()),
        (
            "conversations",
            simple_table(columns([
                ("id", ColumnType::Id),
                ("title", ColumnType::Text { max: 64 }),
            ])),
        ),
        ("columns", ordered_parent_table("boardId")),
        ("cards", ordered_parent_table("columnId")),
        ("accounts", accounts_table()),
        ("expenses", expenses_table()),
        ("shares", shares_table()),
        ("unreads", unreads_table()),
        ("dmKeys", dm_keys_table()),
        ("cardCounts", aggregate_table(&["columnId"])),
        ("owed", aggregate_table(&["groupId", "userId"])),
        ("waitCounts", aggregate_table(&["resourceId"])),
    ] {
        tables.insert(name.to_owned(), table);
    }

    Schema {
        tables,
        maintains: vec![
            Maintain {
                kind: MaintainKind::Count,
                source: "cards".to_owned(),
                by: vec!["columnId".to_owned()],
                target: "cardCounts".to_owned(),
                readable: None,
            },
            Maintain {
                kind: MaintainKind::Sum {
                    of: "amount".to_owned(),
                },
                source: "shares".to_owned(),
                by: vec!["groupId".to_owned(), "userId".to_owned()],
                target: "owed".to_owned(),
                readable: None,
            },
            Maintain {
                kind: MaintainKind::Count,
                source: "waitlist".to_owned(),
                by: vec!["resourceId".to_owned()],
                target: "waitCounts".to_owned(),
                readable: Some(RuleExpr::Public {
                    reason: "resource owners disclose queue depth".to_owned(),
                }),
            },
        ],
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    }
}

pub fn thread_program(take: u32) -> Program {
    let messages = Scan {
        site: "programs.thread.0".to_owned(),
        table: "messages".to_owned(),
        index: "byConvTime".to_owned(),
        prefix: vec![var("conversationId")],
        order: Order::Desc,
        take: Bound::Literal(take),
        after: None,
        before: None,
        range: None,
        provenance: KeyProvenance::Arg,
    };
    let mention_scan = Scan {
        site: "programs.thread.2".to_owned(),
        table: "users".to_owned(),
        index: "byHandle".to_owned(),
        prefix: vec![var("handle")],
        order: Order::Asc,
        take: Bound::Literal(1),
        after: None,
        before: None,
        range: None,
        provenance: KeyProvenance::Computed,
    };
    Program {
        name: "thread".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("conversationId".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "result".to_owned(),
                value: Expr::Array(Vec::new()),
            },
            Stmt::For {
                binding: "message".to_owned(),
                domain: LoopDomain::Page(messages),
                body: vec![
                    Stmt::Let {
                        name: "author".to_owned(),
                        value: Expr::Get(Read {
                            site: "programs.thread.1".to_owned(),
                            table: "users".to_owned(),
                            index: "byId".to_owned(),
                            key: vec![field(var("message"), "authorId")],
                            provenance: KeyProvenance::Shape,
                        }),
                    },
                    Stmt::Let {
                        name: "mentions".to_owned(),
                        value: Expr::Array(Vec::new()),
                    },
                    Stmt::For {
                        binding: "handle".to_owned(),
                        domain: LoopDomain::DerivedArray {
                            value: Expr::Builtin {
                                builtin: Builtin::MentionTokens,
                                args: vec![field(var("message"), "body")],
                            },
                            max: 85,
                            bound_source: "messages.body max 256 / min whitespace mention 3"
                                .to_owned(),
                        },
                        body: vec![Stmt::Push {
                            target: "mentions".to_owned(),
                            value: Expr::Scan(mention_scan.clone()),
                        }],
                    },
                    Stmt::Push {
                        target: "result".to_owned(),
                        value: obj([
                            ("message", var("message")),
                            ("author", var("author")),
                            ("mentions", var("mentions")),
                        ]),
                    },
                ],
            },
            Stmt::Return(var("result")),
        ],
    }
}

pub fn send_program(with_unread: bool) -> Program {
    let name = if with_unread {
        "sendMaintainedUnread"
    } else {
        "send"
    };
    let mut body = vec![
        Stmt::Require {
            condition: Expr::Exists(Read {
                site: format!("programs.{name}.0"),
                table: "memberships".to_owned(),
                index: "byConvUser".to_owned(),
                key: vec![var("conversationId"), Expr::Input(Input::Viewer)],
                provenance: KeyProvenance::Shape,
            }),
            code: "NOT_MEMBER".to_owned(),
        },
        Stmt::Const {
            name: "messageId".to_owned(),
            value: Expr::Input(Input::NewId),
        },
        Stmt::Insert {
            table: "messages".to_owned(),
            row: obj([
                ("id", var("messageId")),
                ("conversationId", var("conversationId")),
                ("authorId", Expr::Input(Input::Viewer)),
                ("body", var("body")),
                ("at", var("at")),
            ]),
        },
    ];
    if with_unread {
        body.push(Stmt::For {
            binding: "member".to_owned(),
            domain: LoopDomain::Page(Scan {
                site: format!("programs.{name}.2"),
                table: "memberships".to_owned(),
                index: "byConversation".to_owned(),
                prefix: vec![var("conversationId")],
                order: Order::Asc,
                take: Bound::Literal(256),
                after: None,
                before: None,
                range: None,
                provenance: KeyProvenance::Arg,
            }),
            body: vec![
                Stmt::Let {
                    name: "unread".to_owned(),
                    value: Expr::Get(Read {
                        site: format!("programs.{name}.3"),
                        table: "unreads".to_owned(),
                        index: "byConvUser".to_owned(),
                        key: vec![var("conversationId"), field(var("member"), "userId")],
                        provenance: KeyProvenance::Shape,
                    }),
                },
                Stmt::If {
                    condition: Expr::Binary {
                        op: BinaryOp::Eq,
                        left: Box::new(var("unread")),
                        right: Box::new(Expr::Literal(Value::Null)),
                    },
                    then_body: vec![Stmt::Insert {
                        table: "unreads".to_owned(),
                        row: obj([
                            (
                                "id",
                                Expr::Builtin {
                                    builtin: Builtin::Concat,
                                    args: vec![
                                        var("conversationId"),
                                        field(var("member"), "userId"),
                                    ],
                                },
                            ),
                            ("conversationId", var("conversationId")),
                            ("userId", field(var("member"), "userId")),
                            ("value", Expr::Literal(Value::Int(1))),
                        ]),
                    }],
                    else_body: vec![Stmt::Update {
                        table: "unreads".to_owned(),
                        key: field(var("unread"), "id"),
                        patch: obj([(
                            "value",
                            Expr::Binary {
                                op: BinaryOp::Add,
                                left: Box::new(field(var("unread"), "value")),
                                right: Box::new(Expr::Literal(Value::Int(1))),
                            },
                        )]),
                    }],
                },
            ],
        });
    }
    body.push(Stmt::Return(var("messageId")));
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("conversationId".to_owned(), ArgType::Scalar),
            ("body".to_owned(), ArgType::Scalar),
            ("at".to_owned(), ArgType::Scalar),
        ]),
        read_time_granularity_ms: None,
        body,
    }
}

pub fn mark_read_program() -> Program {
    Program {
        name: "markRead".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("membershipId".to_owned(), ArgType::Scalar),
            ("at".to_owned(), ArgType::Scalar),
        ]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Update {
                table: "memberships".to_owned(),
                key: var("membershipId"),
                patch: obj([("lastReadAt", var("at"))]),
            },
            Stmt::Return(Expr::Literal(Value::Bool(true))),
        ],
    }
}

pub fn inbox_program(maintained: bool) -> Program {
    let name = if maintained {
        "inboxMaintained"
    } else {
        "inboxCountCapped"
    };
    let memberships = Scan {
        site: format!("programs.{name}.0"),
        table: "memberships".to_owned(),
        index: "byUserActivity".to_owned(),
        prefix: vec![Expr::Input(Input::Viewer)],
        order: Order::Desc,
        take: Bound::Literal(50),
        after: None,
        before: None,
        range: None,
        provenance: KeyProvenance::Viewer,
    };
    let unread = if maintained {
        Expr::Get(Read {
            site: format!("programs.{name}.2"),
            table: "unreads".to_owned(),
            index: "byConvUser".to_owned(),
            key: vec![
                field(var("membership"), "conversationId"),
                Expr::Input(Input::Viewer),
            ],
            provenance: KeyProvenance::Shape,
        })
    } else {
        Expr::Builtin {
            builtin: Builtin::CountCapped,
            args: vec![Expr::Scan(Scan {
                site: format!("programs.{name}.2"),
                table: "messages".to_owned(),
                index: "byConvTime".to_owned(),
                prefix: vec![field(var("membership"), "conversationId")],
                order: Order::Asc,
                take: Bound::Literal(100),
                after: Some(Box::new(field(var("membership"), "lastReadAt"))),
                before: None,
                range: None,
                provenance: KeyProvenance::Shape,
            })],
        }
    };
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "result".to_owned(),
                value: Expr::Array(Vec::new()),
            },
            Stmt::For {
                binding: "membership".to_owned(),
                domain: LoopDomain::Page(memberships),
                body: vec![Stmt::Push {
                    target: "result".to_owned(),
                    value: obj([
                        (
                            "latest",
                            Expr::Scan(Scan {
                                site: format!("programs.{name}.1"),
                                table: "messages".to_owned(),
                                index: "byConvTime".to_owned(),
                                prefix: vec![field(var("membership"), "conversationId")],
                                order: Order::Desc,
                                take: Bound::Literal(1),
                                after: None,
                                before: None,
                                range: None,
                                provenance: KeyProvenance::Shape,
                            }),
                        ),
                        ("unread", unread.clone()),
                    ]),
                }],
            },
            Stmt::Return(var("result")),
        ],
    }
}

pub fn start_dm_program() -> Program {
    Program {
        name: "startDm".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("lo".to_owned(), ArgType::Scalar),
            ("hi".to_owned(), ArgType::Scalar),
        ]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "existing".to_owned(),
                value: Expr::Get(Read {
                    site: "programs.startDm.0".to_owned(),
                    table: "dmKeys".to_owned(),
                    index: "byPair".to_owned(),
                    key: vec![var("lo"), var("hi")],
                    provenance: KeyProvenance::Arg,
                }),
            },
            Stmt::If {
                condition: Expr::Binary {
                    op: BinaryOp::Eq,
                    left: Box::new(var("existing")),
                    right: Box::new(Expr::Literal(Value::Null)),
                },
                then_body: vec![
                    Stmt::Let {
                        name: "conversationId".to_owned(),
                        value: Expr::Input(Input::NewId),
                    },
                    Stmt::Let {
                        name: "dmId".to_owned(),
                        value: Expr::Input(Input::NewId),
                    },
                    Stmt::Let {
                        name: "loMembershipId".to_owned(),
                        value: Expr::Input(Input::NewId),
                    },
                    Stmt::Let {
                        name: "hiMembershipId".to_owned(),
                        value: Expr::Input(Input::NewId),
                    },
                    Stmt::Insert {
                        table: "conversations".to_owned(),
                        row: obj([
                            ("id", var("conversationId")),
                            ("title", Expr::Literal(Value::String("DM".to_owned()))),
                        ]),
                    },
                    Stmt::Insert {
                        table: "dmKeys".to_owned(),
                        row: obj([
                            ("id", var("dmId")),
                            ("lo", var("lo")),
                            ("hi", var("hi")),
                            ("conversationId", var("conversationId")),
                        ]),
                    },
                    Stmt::Insert {
                        table: "memberships".to_owned(),
                        row: obj([
                            ("id", var("loMembershipId")),
                            ("conversationId", var("conversationId")),
                            ("userId", var("lo")),
                            ("lastReadAt", Expr::Literal(Value::Int(0))),
                            ("activity", Expr::Literal(Value::Int(0))),
                        ]),
                    },
                    Stmt::Insert {
                        table: "memberships".to_owned(),
                        row: obj([
                            ("id", var("hiMembershipId")),
                            ("conversationId", var("conversationId")),
                            ("userId", var("hi")),
                            ("lastReadAt", Expr::Literal(Value::Int(0))),
                            ("activity", Expr::Literal(Value::Int(0))),
                        ]),
                    },
                    Stmt::Return(var("conversationId")),
                ],
                else_body: vec![Stmt::Return(field(var("existing"), "conversationId"))],
            },
        ],
    }
}

pub fn board_view_program() -> Program {
    nested_board_program(false)
}

pub fn board_summary_program() -> Program {
    nested_board_program(true)
}

fn nested_board_program(summary: bool) -> Program {
    let name = if summary { "boardSummary" } else { "boardView" };
    let child = if summary {
        Expr::Get(Read {
            site: format!("programs.{name}.1"),
            table: "cardCounts".to_owned(),
            index: "byGroup".to_owned(),
            key: vec![field(var("column"), "id")],
            provenance: KeyProvenance::Shape,
        })
    } else {
        Expr::Scan(Scan {
            site: format!("programs.{name}.1"),
            table: "cards".to_owned(),
            index: "byParentOrder".to_owned(),
            prefix: vec![field(var("column"), "id")],
            order: Order::Asc,
            take: Bound::Literal(50),
            after: None,
            before: None,
            range: None,
            provenance: KeyProvenance::Shape,
        })
    };
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("boardId".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "result".to_owned(),
                value: Expr::Array(Vec::new()),
            },
            Stmt::For {
                binding: "column".to_owned(),
                domain: LoopDomain::Page(Scan {
                    site: format!("programs.{name}.0"),
                    table: "columns".to_owned(),
                    index: "byParentOrder".to_owned(),
                    prefix: vec![var("boardId")],
                    order: Order::Asc,
                    take: Bound::Literal(20),
                    after: None,
                    before: None,
                    range: None,
                    provenance: KeyProvenance::Arg,
                }),
                body: vec![Stmt::Push {
                    target: "result".to_owned(),
                    value: obj([("column", var("column")), ("child", child)]),
                }],
            },
            Stmt::Return(var("result")),
        ],
    }
}

pub fn ledger_program() -> Program {
    Program {
        name: "ledger".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("groupId".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: "programs.ledger.0".to_owned(),
            table: "owed".to_owned(),
            index: "byGroup".to_owned(),
            prefix: vec![var("groupId")],
            order: Order::Asc,
            take: Bound::Literal(50),
            after: None,
            before: None,
            range: None,
            provenance: KeyProvenance::Arg,
        }))],
    }
}

pub fn add_expense_program() -> Program {
    Program {
        name: "addExpense".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("groupId".to_owned(), ArgType::Scalar),
            ("amount".to_owned(), ArgType::Scalar),
            ("recipients".to_owned(), ArgType::List { of: None, max: 50 }),
        ]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "expenseId".to_owned(),
                value: Expr::Input(Input::NewId),
            },
            Stmt::Insert {
                table: "expenses".to_owned(),
                row: obj([
                    ("id", var("expenseId")),
                    ("groupId", var("groupId")),
                    ("amount", var("amount")),
                    ("payerId", Expr::Input(Input::Viewer)),
                ]),
            },
            Stmt::For {
                binding: "recipient".to_owned(),
                domain: LoopDomain::ArgList {
                    name: "recipients".to_owned(),
                    max: 50,
                },
                body: vec![
                    Stmt::Let {
                        name: "shareId".to_owned(),
                        value: Expr::Input(Input::NewId),
                    },
                    Stmt::Insert {
                        table: "shares".to_owned(),
                        row: obj([
                            ("id", var("shareId")),
                            ("expenseId", var("expenseId")),
                            ("groupId", var("groupId")),
                            ("userId", var("recipient")),
                            (
                                "amount",
                                Expr::Builtin {
                                    builtin: Builtin::DeterministicShare,
                                    args: vec![var("amount"), var("recipients"), var("recipient")],
                                },
                            ),
                        ]),
                    },
                ],
            },
            Stmt::Return(var("expenseId")),
        ],
    }
}

pub fn ancestors_program() -> Program {
    Program {
        name: "ancestors".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("accountId".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "result".to_owned(),
                value: Expr::Array(Vec::new()),
            },
            Stmt::For {
                binding: "account".to_owned(),
                domain: LoopDomain::Recurse(Recurse {
                    site: "programs.ancestors.0".to_owned(),
                    table: "accounts".to_owned(),
                    index: "byId".to_owned(),
                    seed: Box::new(var("accountId")),
                    next_field: "parentId".to_owned(),
                    depth: 8,
                    fanout: 1,
                    provenance: KeyProvenance::Shape,
                }),
                body: vec![Stmt::Push {
                    target: "result".to_owned(),
                    value: var("account"),
                }],
            },
            Stmt::Return(var("result")),
        ],
    }
}

pub fn mention_scan_program() -> Program {
    Program {
        name: "mentionScan".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("handle".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: "programs.mentionScan.0".to_owned(),
            table: "users".to_owned(),
            index: "byHandle".to_owned(),
            prefix: vec![Expr::Builtin {
                builtin: Builtin::Concat,
                args: vec![Expr::Literal(Value::String(String::new())), var("handle")],
            }],
            order: Order::Asc,
            take: Bound::Literal(20),
            after: None,
            before: None,
            range: None,
            provenance: KeyProvenance::Computed,
        }))],
    }
}

pub fn nested_expenses_program() -> Program {
    Program {
        name: "expensesByShares".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("groupId".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::For {
            binding: "expense".to_owned(),
            domain: LoopDomain::Page(Scan {
                site: "programs.expensesByShares.0".to_owned(),
                table: "expenses".to_owned(),
                index: "byGroup".to_owned(),
                prefix: vec![var("groupId")],
                order: Order::Asc,
                take: Bound::Literal(500),
                after: None,
                before: None,
                range: None,
                provenance: KeyProvenance::Arg,
            }),
            body: vec![Stmt::Let {
                name: "shares".to_owned(),
                value: Expr::Scan(Scan {
                    site: "programs.expensesByShares.1".to_owned(),
                    table: "shares".to_owned(),
                    index: "byExpense".to_owned(),
                    prefix: vec![field(var("expense"), "id")],
                    order: Order::Asc,
                    take: Bound::Literal(50),
                    after: None,
                    before: None,
                    range: None,
                    provenance: KeyProvenance::Shape,
                }),
            }],
        }],
    }
}

pub fn helper_wrapped_scan_program() -> Program {
    fn helper() -> Scan {
        Scan {
            site: "programs.helperWrappedScan.0".to_owned(),
            table: "cards".to_owned(),
            index: "byParentOrder".to_owned(),
            prefix: vec![var("columnId")],
            order: Order::Asc,
            take: Bound::Literal(37),
            after: None,
            before: None,
            range: None,
            provenance: KeyProvenance::Arg,
        }
    }
    Program {
        name: "helperWrappedScan".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("columnId".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(helper()))],
    }
}

pub fn structural_waitlist_count_program() -> Program {
    Program {
        name: "waitlistDepth".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("resourceId".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Builtin {
            builtin: Builtin::Count,
            args: vec![Expr::Scan(Scan {
                site: "programs.waitlistDepth.0".to_owned(),
                table: "waitlist".to_owned(),
                index: "byResource".to_owned(),
                prefix: vec![var("resourceId")],
                order: Order::Asc,
                take: Bound::Literal(100),
                after: None,
                before: None,
                range: None,
                provenance: KeyProvenance::Arg,
            })],
        })],
    }
}

pub fn maintained_waitlist_count_program() -> Program {
    Program {
        name: "maintainedWaitlistDepth".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("resourceId".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(Read {
            site: "programs.maintainedWaitlistDepth.0".to_owned(),
            table: "waitCounts".to_owned(),
            index: "byGroup".to_owned(),
            key: vec![var("resourceId")],
            provenance: KeyProvenance::Arg,
        }))],
    }
}

pub fn hidden_rule_program() -> Program {
    Program {
        name: "hiddenRuleDocument".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("id".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(Read {
            site: "programs.hiddenRuleDocument.0".to_owned(),
            table: "secretDocs".to_owned(),
            index: "byId".to_owned(),
            key: vec![var("id")],
            provenance: KeyProvenance::Arg,
        }))],
    }
}

pub fn delete_message_program() -> Program {
    Program {
        name: "deleteMessage".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([("id".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Delete {
            table: "messages".to_owned(),
            key: var("id"),
        }],
    }
}

fn columns<const N: usize>(values: [(&str, ColumnType); N]) -> BTreeMap<String, ColumnType> {
    values
        .into_iter()
        .map(|(name, kind)| (name.to_owned(), kind))
        .collect()
}

fn indexes<const N: usize>(values: [(&str, &[&str], bool); N]) -> BTreeMap<String, Index> {
    values
        .into_iter()
        .map(|(name, columns, unique)| {
            (
                name.to_owned(),
                Index {
                    columns: columns.iter().map(|column| (*column).to_owned()).collect(),
                    unique,
                },
            )
        })
        .collect()
}

fn reference(table: &str) -> ColumnType {
    ColumnType::Ref {
        table: table.to_owned(),
    }
}

fn simple_table(columns: BTreeMap<String, ColumnType>) -> Table {
    public_table(columns, indexes([("byId", &["id"], true)]))
}

fn users_table() -> Table {
    public_table(
        columns([
            ("id", ColumnType::Id),
            ("handle", ColumnType::Text { max: 32 }),
        ]),
        indexes([("byId", &["id"], true), ("byHandle", &["handle"], true)]),
    )
}

fn ordered_parent_table(parent: &str) -> Table {
    public_table(
        columns([
            ("id", ColumnType::Id),
            (parent, ColumnType::Id),
            ("order", ColumnType::Int),
            ("title", ColumnType::Text { max: 64 }),
        ]),
        indexes([
            ("byId", &["id"], true),
            ("byParentOrder", &[parent, "order", "id"], false),
        ]),
    )
}

fn accounts_table() -> Table {
    public_table(
        columns([
            ("id", ColumnType::Id),
            ("groupId", ColumnType::Id),
            ("parentId", ColumnType::Id),
            ("name", ColumnType::Text { max: 64 }),
        ]),
        indexes([
            ("byId", &["id"], true),
            ("byGroup", &["groupId", "id"], false),
        ]),
    )
}

fn expenses_table() -> Table {
    public_table(
        columns([
            ("id", ColumnType::Id),
            ("groupId", ColumnType::Id),
            ("amount", ColumnType::Int),
            ("payerId", reference("users")),
        ]),
        indexes([
            ("byId", &["id"], true),
            ("byGroup", &["groupId", "id"], false),
        ]),
    )
}

fn shares_table() -> Table {
    public_table(
        columns([
            ("id", ColumnType::Id),
            ("expenseId", reference("expenses")),
            ("groupId", ColumnType::Id),
            ("userId", reference("users")),
            ("amount", ColumnType::Int),
        ]),
        indexes([
            ("byId", &["id"], true),
            ("byExpense", &["expenseId", "id"], false),
            ("byGroupUser", &["groupId", "userId", "id"], false),
        ]),
    )
}

fn unreads_table() -> Table {
    public_table(
        columns([
            ("id", ColumnType::Id),
            ("conversationId", reference("conversations")),
            ("userId", reference("users")),
            ("value", ColumnType::Int),
        ]),
        indexes([
            ("byId", &["id"], true),
            ("byConvUser", &["conversationId", "userId"], true),
        ]),
    )
}

fn dm_keys_table() -> Table {
    let mut table = public_table(
        columns([
            ("id", ColumnType::Id),
            ("lo", reference("users")),
            ("hi", reference("users")),
            ("conversationId", reference("conversations")),
        ]),
        indexes([("byId", &["id"], true), ("byPair", &["lo", "hi"], true)]),
    );
    table.constraints.push(Constraint::Unique {
        index: "byPair".to_owned(),
    });
    table
}

fn aggregate_table(groups: &[&str]) -> Table {
    let mut column_map = BTreeMap::from([
        ("id".to_owned(), ColumnType::Id),
        ("value".to_owned(), ColumnType::Int),
    ]);
    for group in groups {
        column_map.insert((*group).to_owned(), ColumnType::Id);
    }
    let mut group_columns: Vec<_> = groups.iter().map(|group| (*group).to_owned()).collect();
    let indexes = BTreeMap::from([
        (
            "byId".to_owned(),
            Index {
                columns: vec!["id".to_owned()],
                unique: true,
            },
        ),
        (
            "byGroup".to_owned(),
            Index {
                columns: group_columns.clone(),
                unique: true,
            },
        ),
    ]);
    group_columns.clear();
    public_table(column_map, indexes)
}

fn obj<const N: usize>(entries: [(&str, Expr); N]) -> Expr {
    Expr::Object(
        entries
            .into_iter()
            .map(|(name, value)| (name.to_owned(), value))
            .collect(),
    )
}
