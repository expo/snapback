use super::*;
use snapback3_core::{
    BinaryOp, Bound, Channel, Context, Expr, Index, IndexKeyExpr, Input, KeyProvenance, LoopDomain,
    ProjectJson, Read, RuleExpr, RuleTerm, Scan, Schema, Stmt, Store, Value, object, public_table,
    search_key::IndexComponent,
    timers::{Schedule, Trigger},
};
use std::{
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

struct TemporaryStore(PathBuf);

impl TemporaryStore {
    fn new(label: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        Self(std::env::temp_dir().join(format!(
            "snapback3-worker-{label}-{}-{nonce}.sqlite",
            std::process::id()
        )))
    }
}

impl Drop for TemporaryStore {
    fn drop(&mut self) {
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", self.0.display()));
        }
    }
}

fn index() -> BTreeMap<String, Index> {
    BTreeMap::from([(
        "byId".into(),
        Index {
            components: vec![IndexComponent::Column("id".into())],
            unique: true,
        },
    )])
}

fn program(
    name: &str,
    kind: ProgramKind,
    args: impl IntoIterator<Item = (&'static str, ArgType)>,
    body: Vec<Stmt>,
) -> Program {
    Program {
        name: name.into(),
        kind,
        args: args
            .into_iter()
            .map(|(name, kind)| (name.to_owned(), kind))
            .collect(),
        read_time_granularity_ms: None,
        body,
    }
}

fn var(name: &str) -> Expr {
    Expr::Variable(name.into())
}

fn field(base: &str, name: &str) -> Expr {
    Expr::Field {
        base: Box::new(var(base)),
        name: name.into(),
    }
}

fn scan(table: &str) -> Expr {
    Expr::Scan(Scan {
        site: format!("{table}.all"),
        table: table.into(),
        index: "byId".into(),
        prefix: Vec::new(),
        take: Bound::Literal(100),
        order: snapback3_core::Order::Asc,
        after: None,
        before: None,
        range: None,
        opaque_cursor: false,
        merge_site: None,
        provenance: KeyProvenance::Const,
    })
}

fn owner(project: ProjectJson) -> Owner {
    let capabilities = crate::project::RuntimeCapabilities::parse(Some(
        "media,effects,jobs,schedules,channels,connected,clock",
    ))
    .unwrap();
    let generation = crate::project::certify(project, &capabilities).unwrap();
    Owner {
        runtime: snapback3_core::Runtime::open(Store::memory().unwrap(), generation).unwrap(),
        development: true,
        capabilities,
        connected_counts: BTreeMap::new(),
    }
}

fn persona(owner: &mut Owner, name: &str) -> String {
    owner
        .call("auth", &json!({"action":"persona","name":name}))
        .unwrap()["token"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn project(
    schema: Schema,
    programs: Vec<Program>,
    effects: Vec<snapback3_core::EffectDecl>,
) -> ProjectJson {
    ProjectJson {
        version: 1,
        auth: schema.auth.clone(),
        schema,
        programs,
        effects,
    }
}

#[test]
fn authenticated_asset_lifecycle_and_once_open_are_fail_closed() {
    let media = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            (
                "photo".into(),
                ColumnType::Image {
                    max: 1_000,
                    once: true,
                },
            ),
        ]),
        index(),
    );
    let insert = program(
        "media.insert",
        ProgramKind::Mutation,
        [
            ("rowId", ArgType::Id),
            ("photo", ArgType::Image { max: 1_000 }),
        ],
        vec![Stmt::Insert {
            table: "media".into(),
            row: Expr::Object(BTreeMap::from([
                ("id".into(), var("rowId")),
                ("photo".into(), var("photo")),
            ])),
        }],
    );
    let schema = Schema {
        tables: BTreeMap::from([("media".into(), media)]),
        ..Schema::default()
    };
    let mut owner = owner(project(schema, vec![insert], vec![]));
    let alice = persona(&mut owner, "alice");
    let bob = persona(&mut owner, "bob");

    assert_eq!(
        owner
            .call(
                "asset.begin",
                &json!({"token":"bad","kind":"image","bytes":50})
            )
            .unwrap_err()
            .code,
        "S3_AUTH"
    );
    let begun = owner
        .call(
            "asset.begin",
            &json!({"token":alice,"kind":"image","bytes":50}),
        )
        .unwrap();
    let id = begun["id"].as_str().unwrap().to_owned();
    assert_eq!(begun["maxBytes"], 1_000);
    assert_eq!(
        owner
            .call("asset.reserve", &json!({"token":bob,"id":id,"bytes":60}))
            .unwrap_err()
            .code,
        "S3_ASSET_UNAVAILABLE"
    );
    let reservation = json!({"id":id,"bytes":60});
    assert_eq!(
        owner
            .call("asset.reserve", &json!({"token":alice,"id":id,"bytes":60}))
            .unwrap(),
        reservation
    );
    assert_eq!(
        owner
            .call("asset.reserve", &json!({"token":alice,"id":id,"bytes":60}))
            .unwrap(),
        reservation,
        "a lost reservation reply is idempotently recoverable"
    );
    assert_eq!(
        owner
            .call("asset.reserve", &json!({"token":alice,"id":id,"bytes":61}))
            .unwrap_err()
            .code,
        "S3_ASSET_TYPE"
    );
    let facts = json!({"type":"image/png","bytes":60,"width":4,"height":3});
    assert_eq!(
        owner
            .call(
                "asset.finalize",
                &json!({"token":bob,"id":id,"facts":facts})
            )
            .unwrap_err()
            .code,
        "S3_ASSET_UNAVAILABLE"
    );
    let finalized = owner
        .call(
            "asset.finalize",
            &json!({"token":alice,"id":id,"facts":facts}),
        )
        .unwrap();
    assert_eq!(
        owner
            .call(
                "asset.finalize",
                &json!({"token":alice,"id":id,"facts":facts})
            )
            .unwrap(),
        finalized,
        "a lost finalize reply is idempotently recoverable"
    );
    assert_eq!(
        owner
            .call("asset.reserve", &json!({"token":alice,"id":id,"bytes":60}))
            .unwrap(),
        reservation,
        "a truthful ready row preserves reservation retry identity"
    );
    assert_eq!(
        owner
            .call("asset.status", &json!({"token":alice,"id":id}))
            .unwrap()["state"],
        "ready"
    );
    let manifest = owner.call("manifest", &json!({})).unwrap();
    let attached = owner
        .call(
            "mutation",
            &json!({
                "token":alice,"intent":"attach-media","op":"media.insert",
                "planHash":manifest["programs"]["media.insert"]["planHash"],
                "schemaHash":manifest["schemaHash"],
                "args":{"rowId":"row-1","photo":{"id":id,"width":4,"height":3}}
            }),
        )
        .unwrap();
    assert_eq!(attached["state"], "committed");
    assert!(
        owner
            .call("asset.status", &json!({"token":alice,"id":id}))
            .unwrap()
            .is_null()
    );
    assert_eq!(
        owner
            .call("asset.delivery.public", &json!({"id":id}))
            .unwrap_err()
            .code,
        "S3_ASSET_UNAVAILABLE",
        "a public row never makes a once asset anonymously deliverable"
    );
    assert_eq!(
        owner
            .call("asset.delivery", &json!({"token":alice,"id":id}))
            .unwrap()["once"],
        true
    );
    let before = owner.runtime.store().commit_seq().unwrap();
    let opened = owner
        .call("asset.open", &json!({"token":alice,"id":id}))
        .unwrap();
    assert_eq!(opened["seq"], before + 1);
    let spent_seq = owner.runtime.store().commit_seq().unwrap();
    assert_eq!(
        owner
            .call("asset.delivery", &json!({"token":alice,"id":id}))
            .unwrap_err()
            .code,
        "S3_ASSET_VIEWED",
        "HEAD authorizes the row before reporting the caller's spent state"
    );
    assert_eq!(
        owner.runtime.store().commit_seq().unwrap(),
        spent_seq,
        "HEAD never consumes or advances the data sequence"
    );
    assert_eq!(
        owner
            .call("asset.open", &json!({"token":alice,"id":id}))
            .unwrap_err()
            .code,
        "S3_ASSET_VIEWED",
        "a second concurrent owner turn cannot pass once authority"
    );
    assert!(
        owner
            .call("asset.open", &json!({"token":bob,"id":id}))
            .is_ok(),
        "once consumption is per authorized principal"
    );

    let ready_discarded = owner
        .call(
            "asset.begin",
            &json!({"token":alice,"kind":"image","bytes":10}),
        )
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let small_facts = json!({"type":"image/png","bytes":10,"width":2,"height":2});
    owner
        .call(
            "asset.finalize",
            &json!({"token":alice,"id":ready_discarded,"facts":small_facts}),
        )
        .unwrap();
    assert_eq!(
        owner
            .call(
                "asset.discard",
                &json!({"token":alice,"id":ready_discarded})
            )
            .unwrap()["discarded"],
        true
    );
    assert_eq!(
        owner
            .call(
                "asset.finalize",
                &json!({"token":alice,"id":ready_discarded,"facts":small_facts}),
            )
            .unwrap_err()
            .code,
        "S3_ASSET_UNAVAILABLE",
        "a reclaiming ready row cannot resurrect through a delayed finalize"
    );

    let mut abandoned = Vec::new();
    for _ in 0..20 {
        let id = owner
            .call(
                "asset.begin",
                &json!({"token":alice,"kind":"image","bytes":10}),
            )
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        owner
            .call("asset.discard", &json!({"token":alice,"id":id}))
            .unwrap();
        abandoned.push(id);
    }
    assert_eq!(
        owner
            .call(
                "asset.begin",
                &json!({"token":alice,"kind":"image","bytes":10})
            )
            .unwrap_err()
            .code,
        "S3_ASSET_TOO_LARGE",
        "discarded receiving rows retain their physical custody charge"
    );
    let reclaim = owner
        .call("asset.reclaim", &json!({"after":"","limit":32}))
        .unwrap();
    assert_eq!(reclaim["ids"].as_array().unwrap().len(), 21);
    let finished = owner
        .call("asset.reclaim.finish", &json!({"ids":reclaim["ids"]}))
        .unwrap();
    assert_eq!(finished["finished"], 21);
    assert_eq!(
        owner
            .call("asset.reclaim.finish", &json!({"ids":abandoned}))
            .unwrap()["finished"],
        0,
        "repeating physical confirmation is harmless"
    );
    assert!(
        owner
            .call(
                "asset.begin",
                &json!({"token":alice,"kind":"image","bytes":10})
            )
            .is_ok(),
        "confirmed physical deletion releases both slot and byte charge"
    );
    assert_eq!(
        asset_delivery_fault(RuntimeError::Serialization("corrupt asset row".into())).code,
        "S3_RUNTIME",
        "storage and invariant failures must never masquerade as a missing asset"
    );
}

#[path = "capabilities_asset_contract_tests.rs"]
mod asset_contract;

#[test]
fn effect_settlement_and_then_are_idempotent_after_a_lost_reply() {
    let logs = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("outboxId".into(), ColumnType::Id),
            ("effect".into(), ColumnType::Text { max: 100 }),
            ("providerId".into(), ColumnType::Text { max: 100 }),
        ]),
        index(),
    );
    let emit = program(
        "messages.notify",
        ProgramKind::Mutation,
        [],
        vec![Stmt::Emit {
            effect: "push.send".into(),
            payload: Expr::Literal(Value::String("hello".into())),
        }],
    );
    let then = program(
        "notifications.record",
        ProgramKind::Mutation,
        [
            ("outboxId", ArgType::Id),
            (
                "effect",
                ArgType::Text {
                    min: 1,
                    max: 100,
                    format: None,
                },
            ),
            ("result", ArgType::Json { max_bytes: 1_000 }),
        ],
        vec![Stmt::Insert {
            table: "logs".into(),
            row: Expr::Object(BTreeMap::from([
                ("id".into(), var("outboxId")),
                ("outboxId".into(), var("outboxId")),
                ("effect".into(), var("effect")),
                ("providerId".into(), field("result", "providerId")),
            ])),
        }],
    );
    let read = program(
        "logs.all",
        ProgramKind::Query,
        [],
        vec![Stmt::Return(scan("logs"))],
    );
    let schema = Schema {
        tables: BTreeMap::from([("logs".into(), logs)]),
        effects: vec!["push.send".into()],
        ..Schema::default()
    };
    let mut owner = owner(project(
        schema,
        vec![emit, then, read],
        vec![snapback3_core::EffectDecl {
            name: "push.send".into(),
            grants: vec![],
            source: "async payload => ({ providerId: 'p1' })".into(),
            then: Some("notifications.record".into()),
        }],
    ));
    let alice = persona(&mut owner, "alice");
    let manifest = owner.call("manifest", &json!({})).unwrap();
    assert!(manifest["programs"].get("notifications.record").is_none());
    assert_eq!(
        owner
            .call(
                "mutation",
                &json!({
                    "token":alice,"intent":"guessed-effect-then","op":"notifications.record",
                    "planHash":manifest["systemOperations"]["notifications.record"]["planHash"],
                    "schemaHash":manifest["schemaHash"],
                    "args":{"outboxId":"guessed","effect":"push.send","result":{"providerId":"p"}}
                }),
            )
            .unwrap_err()
            .code,
        "S3_OPERATION_KIND"
    );
    owner
        .call(
            "operator.run",
            &json!({"by":"operator","op":"messages.notify","args":{}}),
        )
        .unwrap();
    let claim = owner.call("effect.claim", &json!({})).unwrap();
    assert_eq!(claim["claim"]["row"]["payload"], "hello");
    let id = claim["claim"]["row"]["id"].as_str().unwrap().to_owned();
    let result = json!({"providerId":"provider-1"});
    let request = json!({"id":id,"state":"sent","result":result});
    let first = owner.call("effect.settle", &request).unwrap();
    assert_eq!(first["row"]["state"], "sent");
    let seq = first["seq"].as_u64().unwrap();
    let repeated = owner.call("effect.settle", &request).unwrap();
    assert_eq!(repeated["seq"], seq);

    owner
        .call(
            "operator.run",
            &json!({"by":"operator","op":"messages.notify","args":{}}),
        )
        .unwrap();
    let pending_claim = owner.call("effect.claim", &json!({})).unwrap();
    let pending_id = pending_claim["claim"]["row"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    owner
        .runtime
        .store()
        .outbox_settle(&pending_id, "then_pending", Some(&result), None, None)
        .unwrap();
    let recovered = owner.call("effect.claim", &json!({})).unwrap();
    assert_eq!(recovered["recoveredThen"]["state"], "sent");
    assert_eq!(
        recovered["seq"],
        owner.runtime.store().commit_seq().unwrap(),
        "a recovered then publishes its committed sequence"
    );
    let execution = owner
        .runtime
        .execute(
            "logs.all",
            Context::query(Actor::user("reader").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    let Value::Array(rows) = execution.result else {
        panic!("expected log rows")
    };
    assert_eq!(
        rows.len(),
        2,
        "each then runs exactly once across reply loss and recovery"
    );
}

#[test]
fn effect_cleanup_claim_more_and_operator_recovery_are_bounded() {
    let emit = |name: &str, effect: &str| {
        program(
            name,
            ProgramKind::Mutation,
            [],
            vec![Stmt::Emit {
                effect: effect.into(),
                payload: Expr::Literal(Value::String("small".into())),
            }],
        )
    };
    let schema = Schema {
        effects: vec!["gone.effect".into(), "kept.effect".into()],
        ..Schema::default()
    };
    let kept = snapback3_core::EffectDecl {
        name: "kept.effect".into(),
        grants: vec![],
        source: "async () => null".into(),
        then: None,
    };
    let mut owner = owner(project(
        schema,
        vec![
            emit("emit.gone", "gone.effect"),
            emit("emit.kept", "kept.effect"),
        ],
        vec![
            snapback3_core::EffectDecl {
                name: "gone.effect".into(),
                grants: vec![],
                source: "async () => null".into(),
                then: None,
            },
            kept.clone(),
        ],
    ));
    for _ in 0..65 {
        owner
            .call(
                "operator.run",
                &json!({"by":"operator","op":"emit.gone","args":{}}),
            )
            .unwrap();
    }
    for _ in 0..2 {
        owner
            .call(
                "operator.run",
                &json!({"by":"operator","op":"emit.kept","args":{}}),
            )
            .unwrap();
    }
    let successor = project(
        Schema {
            effects: vec!["kept.effect".into()],
            ..Schema::default()
        },
        vec![emit("emit.kept", "kept.effect")],
        vec![kept],
    );
    owner
        .call("project", &json!({"project":successor}))
        .unwrap();

    let first = owner.call("effect.claim", &json!({})).unwrap();
    assert_eq!(first["failed"].as_array().unwrap().len(), 64);
    assert_eq!(first["claim"]["row"]["effect"], "kept.effect");
    assert_eq!(first["more"], true);
    let second = owner.call("effect.claim", &json!({})).unwrap();
    assert_eq!(second["failed"].as_array().unwrap().len(), 1);
    assert_eq!(second["claim"]["row"]["effect"], "kept.effect");
    assert_eq!(second["more"], false);

    assert_eq!(
        owner.call("effect.recover", &json!({})).unwrap()["recovered"],
        2
    );
    let page = owner
        .call(
            "effect.list",
            &json!({"state":"sent_unknown","after":"","limit":1}),
        )
        .unwrap();
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert!(page["items"][0].get("payload").is_none());
    assert!(page["items"][0].get("result").is_none());
    let next = page["next"].as_str().unwrap();
    let tail = owner
        .call(
            "effect.list",
            &json!({"state":"sent_unknown","after":next,"limit":1}),
        )
        .unwrap();
    assert_eq!(tail["items"].as_array().unwrap().len(), 1);
    assert!(tail["next"].is_null());
}

#[test]
fn background_turn_fires_expiry_and_advances_a_job_without_a_client() {
    let items = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            (
                "at".into(),
                ColumnType::Optional(Box::new(ColumnType::Time)),
            ),
            ("n".into(), ColumnType::Int),
        ]),
        index(),
    );
    let logs = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("item".into(), ColumnType::Id),
        ]),
        index(),
    );
    let purge = program(
        "admin.purge",
        ProgramKind::Mutation,
        [("id", ArgType::Id)],
        vec![
            Stmt::Insert {
                table: "logs".into(),
                row: Expr::Object(BTreeMap::from([
                    ("id".into(), Expr::Input(Input::NewId)),
                    ("item".into(), var("id")),
                ])),
            },
            Stmt::Delete {
                table: "items".into(),
                key: var("id"),
            },
        ],
    );
    let fill = program(
        "admin.fill",
        ProgramKind::Job,
        [],
        vec![Stmt::For {
            binding: "row".into(),
            domain: LoopDomain::Page(Scan {
                site: "fill.items".into(),
                table: "items".into(),
                index: "byId".into(),
                prefix: Vec::<IndexKeyExpr>::new(),
                take: Bound::Literal(100),
                order: snapback3_core::Order::Asc,
                after: None,
                before: None,
                range: None,
                opaque_cursor: false,
                merge_site: None,
                provenance: KeyProvenance::Const,
            }),
            body: vec![Stmt::Update {
                table: "items".into(),
                key: field("row", "id"),
                patch: Expr::Object(BTreeMap::from([(
                    "n".into(),
                    Expr::Binary {
                        op: BinaryOp::Add,
                        left: Box::new(field("row", "n")),
                        right: Box::new(Expr::Literal(Value::Int(1))),
                    },
                )])),
            }],
        }],
    );
    let binding = program(
        "admin._timerBinding_expire",
        ProgramKind::Query,
        [("id", ArgType::Id)],
        vec![Stmt::Return(Expr::Object(BTreeMap::from([
            ("enabled".into(), Expr::Literal(Value::Bool(true))),
            (
                "args".into(),
                Expr::Object(BTreeMap::from([("id".into(), var("id"))])),
            ),
        ])))],
    );
    let mut read_items = program(
        "items.all",
        ProgramKind::Query,
        [],
        vec![Stmt::Return(scan("items"))],
    );
    read_items.read_time_granularity_ms = Some(1_000);
    let read_logs = program(
        "logs.all",
        ProgramKind::Query,
        [],
        vec![Stmt::Return(scan("logs"))],
    );
    let schema = Schema {
        tables: BTreeMap::from([("items".into(), items), ("logs".into(), logs)]),
        schedules: vec![Schedule {
            name: "expire".into(),
            trigger: Trigger::Row {
                table: "items".into(),
                column: "at".into(),
            },
            target: "admin.purge".into(),
            binding: "admin._timerBinding_expire".into(),
            site: "test:1:1".into(),
        }],
        ..Schema::default()
    };
    let mut owner = owner(project(
        schema,
        vec![purge, fill, binding, read_items, read_logs],
        vec![],
    ));
    let manifest = owner.call("manifest", &json!({})).unwrap();
    assert!(manifest["programs"].get("admin.fill").is_none());
    assert!(manifest["programs"].get("admin.purge").is_none());
    assert_eq!(manifest["jobs"]["admin.fill"]["kind"], "job");
    assert_eq!(
        manifest["systemOperations"]["admin.purge"]["kind"],
        "mutation"
    );
    assert_eq!(
        manifest["clockQueries"]["items.all"]["granularityMs"],
        1_000
    );
    assert_eq!(
        owner
            .call("job.status", &json!({"by":"operator","id":"missing-job"}))
            .unwrap_err()
            .code,
        "S3_JOB_UNKNOWN"
    );
    let alice = persona(&mut owner, "alice");
    assert_eq!(
        owner
            .call(
                "mutation",
                &json!({
                    "token":alice,"intent":"guessed-schedule-target","op":"admin.purge",
                    "planHash":manifest["systemOperations"]["admin.purge"]["planHash"],
                    "schemaHash":manifest["schemaHash"],"args":{"id":"live"}
                }),
            )
            .unwrap_err()
            .code,
        "S3_OPERATION_KIND"
    );
    assert_eq!(
        owner
            .call(
                "mutation",
                &json!({
                    "token":alice,"intent":"guessed-job","op":"admin.fill",
                    "planHash":manifest["jobs"]["admin.fill"]["planHash"],
                    "schemaHash":manifest["schemaHash"],"args":{}
                }),
            )
            .unwrap_err()
            .code,
        "S3_OPERATION_KIND"
    );
    assert_eq!(
        owner
            .call(
                "query",
                &json!({"token":alice,"op":"admin._timerBinding_expire","args":{"id":"live"}}),
            )
            .unwrap_err()
            .code,
        "S3_OPERATION_UNKNOWN"
    );
    let read = owner
        .call(
            "read",
            &json!({"token":alice,"queries":[{
                "key":"binding","op":"admin._timerBinding_expire","args":{"id":"live"}
            }]}),
        )
        .unwrap();
    assert_eq!(
        read["resources"][0]["error"]["code"],
        "S3_OPERATION_UNKNOWN"
    );
    assert_eq!(
        owner
            .call(
                "acquire",
                &json!({"token":alice,"chains":[{
                    "key":"binding","op":"admin._timerBinding_expire",
                    "args":{"id":null},"cursor":"id"
                }]}),
            )
            .unwrap_err()
            .code,
        "S3_OPERATION_UNKNOWN"
    );
    let mut rows = (0..65)
        .map(|number| {
            (
                "items".into(),
                object([
                    ("id", Value::Id(format!("expired-{number:03}"))),
                    ("at", Value::Int(5)),
                    ("n", Value::Int(0)),
                ]),
            )
        })
        .collect::<Vec<_>>();
    rows.extend((0..201).map(|number| {
        (
            "items".into(),
            object([
                ("id", Value::Id(format!("live-{number:03}"))),
                ("at", Value::Null),
                ("n", Value::Int(0)),
            ]),
        )
    }));
    owner.runtime.seed(&rows).unwrap();
    let enqueued = owner
        .call(
            "job.enqueue",
            &json!({"by":"operator","op":"admin.fill","args":{}}),
        )
        .unwrap();
    let recovered = owner
        .call("job.recover", &json!({"by":"operator","limit":1}))
        .unwrap();
    assert_eq!(recovered["jobs"][0]["id"], enqueued["id"]);
    assert_eq!(recovered["jobs"][0]["name"], "admin.fill");
    assert!(recovered["jobs"][0].get("args").is_none());
    assert!(
        owner
            .call("job.recover", &json!({"by":"different-operator","limit":1}))
            .unwrap()["jobs"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        owner
            .call("job.recover", &json!({"by":"operator","limit":65}))
            .unwrap_err()
            .code,
        "S3_INPUT"
    );
    let first = owner.call("background.turn", &json!({})).unwrap();
    assert_eq!(first["timers"].as_array().unwrap().len(), 64);
    assert!(first["job"].is_null(), "timer backlog has priority");
    let second = owner.call("background.turn", &json!({})).unwrap();
    assert_eq!(second["timers"].as_array().unwrap().len(), 1);
    assert_eq!(second["job"]["job"]["state"], "running");
    let third = owner.call("background.turn", &json!({})).unwrap();
    assert!(third["timers"].as_array().unwrap().is_empty());
    assert_eq!(third["job"]["job"]["state"], "running");
    let fourth = owner.call("background.turn", &json!({})).unwrap();
    assert_eq!(fourth["job"]["job"]["state"], "done");

    let query = |owner: &mut Owner, name: &str| {
        let mut context = Context::query(Actor::user("reader").unwrap(), BTreeMap::new());
        context.read_time = Some(10);
        owner.runtime.execute(name, context).unwrap().result
    };
    let Value::Array(items) = query(&mut owner, "items.all") else {
        panic!("items")
    };
    assert_eq!(items.len(), 100, "the query itself remains page-bounded");
    assert!(items.iter().all(|row| row.field("n") == Ok(&Value::Int(1))));
    let Value::Array(logs) = query(&mut owner, "logs.all") else {
        panic!("logs")
    };
    assert_eq!(logs.len(), 65);
}

#[test]
fn bundled_compiler_project_runs_effect_then_and_recovers_after_restart() {
    let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let compiler = workspace.join("packages/snapback3/dist/compiler.mjs");
    let fixture = workspace.join("packages/compiler/fixtures/quarry-chat");
    let mut child = Command::new("node")
        .arg(&compiler)
        .arg("--worker")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("bundled compiler starts");
    {
        let input = child.stdin.as_mut().unwrap();
        writeln!(input, "{}", json!({"id":1,"op":"compile","root":fixture})).unwrap();
        writeln!(input, "{}", json!({"id":2,"op":"seed","root":fixture})).unwrap();
    }
    drop(child.stdin.take());
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let replies = String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Json>(line).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(replies.len(), 2);
    assert_eq!(replies[0]["ok"], true);
    assert_eq!(replies[1]["ok"], true);
    let mut project_json = replies[0]["project"].clone();
    let project_object = project_json.as_object_mut().unwrap();
    project_object.insert("version".into(), json!(1));
    project_object.insert(
        "auth".into(),
        replies[0]["project"]["schema"]["auth"].clone(),
    );
    let project: ProjectJson = serde_json::from_value(project_json).unwrap();
    let seed = replies[1]["seed"].clone();
    let then_op = project.effects[0].then.clone().unwrap();
    let timer_target = project.schema.schedules[0].target.clone();

    let capabilities = crate::project::RuntimeCapabilities::parse(Some(
        "media,effects,jobs,schedules,channels,connected,clock",
    ))
    .unwrap();
    let generation = crate::project::certify(project, &capabilities).unwrap();
    let database = TemporaryStore::new("compiler-restart");
    let mut owner = Owner {
        runtime: snapback3_core::Runtime::open(
            Store::open(&database.0).unwrap(),
            generation.clone(),
        )
        .unwrap(),
        development: true,
        capabilities: capabilities.clone(),
        connected_counts: BTreeMap::new(),
    };
    crate::project::seed(&mut owner.runtime, &seed).unwrap();
    let alice = persona(&mut owner, "alice");
    let manifest = owner.call("manifest", &json!({})).unwrap();
    for (intent, op) in [
        ("guess-compiled-then", then_op.as_str()),
        ("guess-compiled-timer", timer_target.as_str()),
    ] {
        assert_eq!(
            owner
                .call(
                    "mutation",
                    &json!({
                        "token":alice,"intent":intent,"op":op,
                        "planHash":manifest["systemOperations"][op]["planHash"],
                        "schemaHash":manifest["schemaHash"],"args":{}
                    }),
                )
                .unwrap_err()
                .code,
            "S3_OPERATION_KIND"
        );
    }

    let send = |owner: &mut Owner, intent: &str| {
        owner
                .call(
                    "mutation",
                    &json!({
                        "token":alice,"intent":intent,"op":"messages.send",
                        "planHash":manifest["programs"]["messages.send"]["planHash"],
                        "schemaHash":manifest["schemaHash"],
                        "args":{"conversationId":"conversation-1","recipientId":"profile-bob","body":intent}
                    }),
                )
                .unwrap()
    };
    send(&mut owner, "compiled-send-1");
    let first = owner.call("effect.claim", &json!({})).unwrap();
    assert_eq!(first["claim"]["declaration"]["then"], then_op);
    let first_id = first["claim"]["row"]["id"].as_str().unwrap().to_owned();
    let settlement = json!({"id":first_id,"state":"sent","result":{"providerId":"p-1"}});
    let settled = owner.call("effect.settle", &settlement).unwrap();
    let settled_seq = settled["seq"].clone();
    assert_eq!(
        owner.call("effect.settle", &settlement).unwrap()["seq"],
        settled_seq
    );

    send(&mut owner, "compiled-send-2");
    let second = owner.call("effect.claim", &json!({})).unwrap();
    let second_id = second["claim"]["row"]["id"].as_str().unwrap().to_owned();
    owner
        .runtime
        .store()
        .outbox_settle(
            &second_id,
            "then_pending",
            Some(&json!({"providerId":"p-2"})),
            None,
            None,
        )
        .unwrap();
    drop(owner);

    let mut restarted = Owner {
        runtime: snapback3_core::Runtime::open(Store::open(&database.0).unwrap(), generation)
            .unwrap(),
        development: true,
        capabilities,
        connected_counts: BTreeMap::new(),
    };
    let recovered = restarted.call("effect.claim", &json!({})).unwrap();
    assert_eq!(recovered["recoveredThen"]["id"], second_id);
    assert_eq!(recovered["recoveredThen"]["state"], "sent");
    assert_eq!(
        recovered["seq"],
        restarted.runtime.store().commit_seq().unwrap(),
        "recovery reports the committed then sequence"
    );
    let rows = restarted
        .runtime
        .read_rule_verdicts(
            "notifications",
            Context::query(Actor::user("reader").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert_eq!(
        rows.len(),
        3,
        "seed plus two provider settlements, without replay"
    );
}

#[test]
fn connected_snapshot_and_channel_policy_use_authenticated_core_context() {
    let presence = program(
        "presence.get",
        ProgramKind::Query,
        [("principal", ArgType::Principal)],
        vec![Stmt::Return(Expr::Get(Read {
            site: "presence.get".into(),
            table: snapback3_core::CONNECTED_TABLE.into(),
            index: snapback3_core::CONNECTED_INDEX.into(),
            key: vec![var("principal")],
            provenance: KeyProvenance::Arg,
        }))],
    );
    let memberships = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("chatId".into(), ColumnType::Id),
            ("principal".into(), ColumnType::Principal),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    components: vec![IndexComponent::Column("id".into())],
                    unique: true,
                },
            ),
            (
                "byChatPrincipal".into(),
                Index {
                    components: vec![
                        IndexComponent::Column("chatId".into()),
                        IndexComponent::Column("principal".into()),
                    ],
                    unique: true,
                },
            ),
        ]),
    );
    let membership_rule = RuleExpr::Exists {
        table: "memberships".into(),
        index: "byChatPrincipal".into(),
        key: vec![RuleTerm::Field("chatId".into()), RuleTerm::Viewer],
        provenance: KeyProvenance::Shape,
    };
    let schema = Schema {
        tables: BTreeMap::from([("memberships".into(), memberships)]),
        channels: BTreeMap::from([(
            "typing".into(),
            Channel {
                args: BTreeMap::from([("chatId".into(), ArgType::Id)]),
                value: BTreeMap::from([("typing".into(), ArgType::Bool)]),
                publish: membership_rule.clone(),
                subscribe: membership_rule,
                ttl_ms: 1_000,
            },
        )]),
        ..Schema::default()
    };
    let mut owner = owner(project(schema, vec![presence], vec![]));
    let alice = persona(&mut owner, "alice");
    let bob = persona(&mut owner, "bob");
    owner
        .runtime
        .seed(&[(
            "memberships".into(),
            object([
                ("id", Value::Id("membership-alice".into())),
                ("chatId", Value::Id("chat-1".into())),
                ("principal", Value::Id("dev:alice".into())),
            ]),
        )])
        .unwrap();
    let changed = owner
        .call("presence.replace", &json!({"counts":{"dev:alice":2}}))
        .unwrap();
    assert_eq!(changed["changed"], json!(["dev:alice"]));
    let result = owner
        .call(
            "query",
            &json!({"token":alice,"op":"presence.get","args":{"principal":"dev:alice"}}),
        )
        .unwrap();
    assert_eq!(
        result["data"]["value"], 2,
        "the connected query runs through the worker"
    );
    let admitted = owner
        .call(
            "channel.admit",
            &json!({"token":alice,"name":"typing","side":"subscribe","args":{"chatId":"chat-1"}}),
        )
        .unwrap();
    assert_eq!(admitted["verdict"]["admitted"], true);
    assert_eq!(admitted["args"]["chatId"], "chat-1");
    let publish = owner
            .call(
                "channel.admit",
                &json!({"token":alice,"name":"typing","side":"publish","args":{"chatId":"chat-1"},"value":{"typing":true}}),
            )
            .unwrap();
    assert_eq!(publish["value"], json!({"typing":true}));
    for side in ["subscribe", "publish"] {
        let denied = owner
            .call(
                "channel.admit",
                &json!({"token":bob,"name":"typing","side":side,"args":{"chatId":"chat-1"},
                        "value":(side == "publish").then_some(json!({"typing":true}))}),
            )
            .unwrap();
        assert_eq!(denied["verdict"]["admitted"], false);
    }
    assert_eq!(
        owner
            .call(
                "channel.admit",
                &json!({"token":"bad","name":"typing","side":"publish","args":{"chatId":"chat-1"}})
            )
            .unwrap_err()
            .code,
        "S3_AUTH"
    );
}
