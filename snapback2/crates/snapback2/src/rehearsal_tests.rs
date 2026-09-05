use super::*;
use snapback2_core::*;
use std::{collections::BTreeMap, net::TcpListener};

fn lit(v: Value) -> Expr {
    Expr::Literal(v)
}
fn text(s: &str) -> Expr {
    lit(Value::String(s.into()))
}
fn field(name: &str) -> Expr {
    Expr::Field {
        base: Box::new(Expr::Variable("r".into())),
        name: name.into(),
    }
}
fn program(name: &str, kind: ProgramKind, body: Vec<Stmt>) -> Program {
    Program {
        name: name.into(),
        kind,
        args: BTreeMap::new(),
        body,
        read_time_granularity_ms: (kind == ProgramKind::Query).then_some(1),
        result_page_site: None,
    }
}
fn sweep(table: &str, body: Vec<Stmt>) -> Stmt {
    Stmt::For {
        binding: "r".into(),
        domain: LoopDomain::Page(Scan {
            site: table.into(),
            table: table.into(),
            index: "byId".into(),
            prefix: vec![],
            order: Order::Asc,
            take: Bound::Literal(100),
            after: None,
            before: None,
            range: None,
            opaque_cursor: false,
            merge_site: None,
            provenance: KeyProvenance::Const,
        }),
        body,
    }
}
fn emit() -> Stmt {
    Stmt::Emit {
        effect: "delivery.notify".into(),
        payload: text("hello"),
    }
}
fn table(columns: BTreeMap<String, ColumnType>) -> Table {
    public_table(
        columns,
        BTreeMap::from([(
            "byId".into(),
            Index {
                columns: vec!["id".into()],
                unique: true,
            },
        )]),
    )
}
fn project(url: &str) -> ProjectJson {
    let items = table(BTreeMap::from([
        ("id".into(), ColumnType::Id),
        ("ok".into(), ColumnType::Bool),
        (
            "photo".into(),
            ColumnType::Optional(Box::new(ColumnType::Image { max: 1000 })),
        ),
    ]));
    let audit = table(BTreeMap::from([
        ("id".into(), ColumnType::Id),
        ("at".into(), ColumnType::Time),
    ]));
    let delete = Stmt::Delete {
        table: "items".into(),
        key: field("id"),
    };
    let record = Stmt::Insert {
        table: "audit".into(),
        row: Expr::Object(BTreeMap::from([
            ("id".into(), Expr::Input(Input::NewId)),
            ("at".into(), Expr::Input(Input::Now)),
        ])),
    };
    let mut attach = program(
        "attach",
        ProgramKind::Mutation,
        vec![Stmt::Update {
            table: "items".into(),
            key: lit(Value::Id("item-00000".into())),
            patch: Expr::Object(BTreeMap::from([(
                "photo".into(),
                Expr::Variable("photo".into()),
            )])),
        }],
    );
    attach
        .args
        .insert("photo".into(), ArgType::Image { max: 1000 });
    let cleanup = program(
        "cleanup",
        ProgramKind::Job,
        vec![
            sweep(
                "items",
                vec![
                    delete.clone(),
                    record,
                    emit(),
                    Stmt::Require {
                        condition: field("ok"),
                        code: "FIX_ROW".into(),
                    },
                ],
            ),
            sweep(
                "audit",
                vec![Stmt::Require {
                    condition: Expr::Binary {
                        op: BinaryOp::Eq,
                        left: Box::new(field("at")),
                        right: Box::new(Expr::Input(Input::Now)),
                    },
                    code: "CLOCK_MOVED".into(),
                }],
            ),
        ],
    );
    ProjectJson {
        version: 1,
        schema: Schema {
            tables: BTreeMap::from([("items".into(), items), ("audit".into(), audit)]),
            ..Schema::default()
        },
        auth: Auth::default(),
        programs: vec![
            attach,
            cleanup,
            program(
                "digest",
                ProgramKind::Job,
                vec![sweep("items", vec![emit()])],
            ),
            program(
                "clock",
                ProgramKind::Query,
                vec![Stmt::Return(Expr::Input(Input::ReadTime))],
            ),
            program(
                "mint",
                ProgramKind::Mutation,
                vec![Stmt::Return(Expr::Input(Input::NewId))],
            ),
        ],
        effects: vec![EffectDecl {
            name: "delivery.notify".into(),
            grants: vec![url.into()],
            source: format!(
                "async (payload, {{fetch}}) => fetch({url:?}, {{method:'POST',body:JSON.stringify(payload)}})"
            ),
            then: None,
        }],
    }
}
fn live(root: &Path, url: &str, count: usize, bad: Option<usize>) -> Runtime {
    let generation = Generation::certify(&project(url), Ceilings::default()).unwrap();
    let mut runtime =
        Runtime::open(Store::open(&root.join("live.sqlite")).unwrap(), generation).unwrap();
    runtime
        .seed(
            &(0..count)
                .map(|i| {
                    (
                        "items".into(),
                        object([
                            ("id", Value::Id(format!("item-{i:05}"))),
                            ("ok", Value::Bool(bad != Some(i))),
                            ("photo", Value::Null),
                        ]),
                    )
                })
                .collect::<Vec<_>>(),
        )
        .unwrap();
    runtime
}
fn scratch() -> Scratch {
    Scratch::new(&std::env::temp_dir().join("snapback2-rehearsal-tests")).unwrap()
}
fn attach_photo(runtime: &mut Runtime, root: &Path) -> (String, PathBuf) {
    let alice = Actor::user("alice").unwrap();
    let id = runtime.begin_asset(AssetKind::Image, &alice, 0).unwrap();
    runtime.reserve_asset_finalized_bytes(&id, 5).unwrap();
    runtime
        .mark_asset_ready(
            &id,
            &AssetReadyFacts {
                media_type: "image/png".into(),
                bytes: 5,
                width: 1,
                height: 1,
                duration: None,
            },
        )
        .unwrap();
    let asset = Value::Map(BTreeMap::from([
        ("id".into(), Value::String(id.clone())),
        ("width".into(), Value::Int(1)),
        ("height".into(), Value::Int(1)),
    ]));
    let attached = runtime
        .execute(
            "attach",
            Context::mutation(alice, BTreeMap::from([("photo".into(), asset)])),
        )
        .unwrap();
    assert!(
        matches!(attached.state, ExecutionState::Committed { .. }),
        "attach: {:?}",
        attached.state
    );
    let blobs = root.join("blobs");
    fs::create_dir_all(&blobs).unwrap();
    let path = blobs.join(&id);
    fs::write(&path, b"bytes").unwrap();
    (id, path)
}

#[test]
fn rehearsal_isolates_network_blobs_commits_outbox_and_discards_copy() {
    let scratch = scratch();
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    server.set_nonblocking(true).unwrap();
    let url = format!("http://{}", server.local_addr().unwrap());
    let mut live = live(&scratch.0, &url, 205, None);
    let (asset_id, blob) = attach_photo(&mut live, &scratch.0);
    // An inherited queued job must not run in rehearsal either.
    let pending = live
        .enqueue_job("digest", BTreeMap::new(), OperatorId("test".into()))
        .unwrap();
    let before_seq = live.store().commit_seq().unwrap();
    let before_outbox = serde_json::to_value(live.store().outbox_counts().unwrap()).unwrap();
    let before_namespace = live.store().meta("id_namespace").unwrap();
    let before_high_water = live.store().meta("id_high_water").unwrap();
    let now = 10 * ASSET_RECLAIM_GRACE_MS;
    let snapshot = Snapshot::capture(&live, &scratch.0.join("copies"), now).unwrap();
    let copy = snapshot.directory.0.clone();
    let report = snapshot
        .run(Target::Declared("cleanup".into()), json!({}), "test".into())
        .unwrap();
    assert_eq!(report["dryRun"], true);
    assert_eq!(report["state"], "done", "{report}");
    assert_eq!(
        report["chunks"], 6,
        "all three chunks in each of two sweeps"
    );
    assert_eq!(report["rowsWritten"]["items"], 205);
    assert_eq!(report["rowsWritten"]["audit"], 205);
    assert_eq!(report["effectCount"], 205);
    assert_eq!(report["effects"].as_array().unwrap().len(), 100);
    assert_eq!(report["effectsTruncated"], true);
    assert_eq!(
        report["effects"][0],
        json!({"effect":"delivery.notify","payloadBytes":7})
    );
    assert_eq!(report["assetReleaseCount"], 1);
    assert_eq!(report["assetsReleased"][0]["id"], asset_id);
    assert_eq!(report["now"], now);
    // The five negatives, independently observed after the completed rehearsal.
    assert_eq!(
        server.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock,
        "effect reached the loopback grant"
    );
    assert_eq!(
        fs::read(&blob).unwrap(),
        b"bytes",
        "shared blob was changed/reclaimed"
    );
    assert_eq!(
        live.store().commit_seq().unwrap(),
        before_seq,
        "live commits moved"
    );
    assert_eq!(
        serde_json::to_value(live.store().outbox_counts().unwrap()).unwrap(),
        before_outbox,
        "live outbox grew"
    );
    assert!(!copy.exists(), "snapshot directory/WAL/SHM survived");
    assert_eq!(live.job_record(&pending).unwrap().chunks, 0);
    assert!(
        live.store()
            .asset(&asset_id)
            .unwrap()
            .unwrap()
            .locator
            .is_some()
    );
    assert_eq!(live.store().meta("id_namespace").unwrap(), before_namespace);
    assert_eq!(
        live.store().meta("id_high_water").unwrap(),
        before_high_water
    );
}

#[test]
fn rehearsal_pins_clock_and_uses_disjoint_id_namespaces() {
    let scratch = scratch();
    let mut live = live(&scratch.0, "http://127.0.0.1:9", 0, None);
    let mut ids = Vec::new();
    for op in ["clock", "mint", "mint"] {
        let snapshot = Snapshot::capture(&live, &scratch.0.join("copies"), 123).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let report = snapshot
            .run(Target::Declared(op.into()), json!({}), "test".into())
            .unwrap();
        if op == "clock" {
            assert_eq!(report["result"]["data"], 123);
        } else {
            ids.push(report["result"]["data"].as_str().unwrap().to_owned());
        }
    }
    let production = live
        .execute_operator_at("mint", BTreeMap::new(), OperatorId("test".into()), 123)
        .unwrap();
    ids.push(production.result.as_str().unwrap().into());
    let namespaces = ids
        .iter()
        .map(|id| id.rsplit_once('-').unwrap().0)
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        namespaces.len(),
        3,
        "separate rehearsals and production have disjoint allocators"
    );
}

#[test]
fn rehearsal_parks_with_prior_chunks_and_rolls_back_effects_and_asset_releases() {
    let scratch = scratch();
    let mut live = live(&scratch.0, "http://127.0.0.1:9", 205, Some(0));
    let (id, _) = attach_photo(&mut live, &scratch.0);
    let report = Snapshot::capture(&live, &scratch.0.join("copies"), 1)
        .unwrap()
        .run(Target::Declared("cleanup".into()), json!({}), "test".into())
        .unwrap();
    assert_eq!(report["state"], "parked");
    assert_eq!(report["refusals"][0]["code"], "FIX_ROW");
    assert_eq!(report["chunks"], 0);
    assert_eq!(report["effectCount"], 0);
    assert_eq!(report["assetReleaseCount"], 0);
    assert!(live.store().asset(&id).unwrap().unwrap().locator.is_some());
    drop(live);
    let other = scratch.0.join("other");
    fs::create_dir(&other).unwrap();
    let live = self::live(&other, "http://127.0.0.1:9", 205, Some(150));
    let report = Snapshot::capture(&live, &scratch.0.join("copies"), 1)
        .unwrap()
        .run(Target::Declared("cleanup".into()), json!({}), "test".into())
        .unwrap();
    assert_eq!(report["chunks"], 1);
    assert_eq!(report["rowsWritten"]["items"], 100);
    assert_eq!(report["effectCount"], 100);
}

#[test]
fn rehearsal_reports_admission_refusals_and_cleans_up_failed_open() {
    let scratch = scratch();
    let live = live(&scratch.0, "http://127.0.0.1:9", 1, None);
    let unknown = program(
        "bad",
        ProgramKind::Mutation,
        vec![Stmt::Emit {
            effect: "missing".into(),
            payload: text("no"),
        }],
    );
    let report = Snapshot::capture(&live, &scratch.0.join("copies"), 1)
        .unwrap()
        .run(
            Target::Adhoc {
                program: unknown,
                source: "mutation bad: emit missing {}".into(),
            },
            json!({}),
            "test".into(),
        )
        .unwrap();
    assert_eq!(report["state"], "refused");
    assert!(
        report["refusals"][0]["message"]
            .as_str()
            .unwrap()
            .contains("E_EFFECT_UNKNOWN")
    );
    assert_eq!(report["effectCount"], 0);
    let snapshot = Snapshot::capture(&live, &scratch.0.join("copies"), 1).unwrap();
    let path = snapshot.directory.0.clone();
    fs::write(path.join("store.sqlite"), b"invalid sqlite").unwrap();
    let error = snapshot
        .run(Target::Declared("clock".into()), json!({}), "test".into())
        .unwrap_err();
    assert_eq!(error.code, "E_REHEARSAL");
    assert_eq!(error.family, "operator");
    assert_eq!(error.site.as_deref(), Some("run --dry-run"));
    assert_eq!(error.guide, "job");
    assert!(error.rewrite.is_some());
    assert!(!path.exists());
}

#[test]
#[ignore = "LLP 1016 measurement, opt-in via measure.mjs --administrative"]
fn measure_rehearsal_digest_and_100mb_overhead() {
    let scratch = scratch();
    let mut live = live(&scratch.0, "http://127.0.0.1:9", 1000, None);
    let id = live
        .enqueue_job("digest", BTreeMap::new(), OperatorId("measure".into()))
        .unwrap();
    let start = Instant::now();
    loop {
        if live.run_chunk_at(&id, 1).unwrap().job.state == "done" {
            break;
        }
    }
    let digest = start.elapsed().as_secs_f64();
    assert_eq!(live.store().outbox_counts().unwrap().queued, 1000);
    println!(
        "J3_METRIC {}",
        json!({"metric":"digest_1000_profiles_s","seconds":digest,"budgetSeconds":5,"ok":true,"profiles":1000,"effects":1000,"method":"real certified 100-row sweep over 1000 synthetic profile rows (items), one outbox emission each; no I/O delivery"})
    );
    // 100 MiB of real SQLite pages, not a sparse file. No production data or blobs.
    drop(live);
    let conn = rusqlite::Connection::open(scratch.0.join("live.sqlite")).unwrap();
    conn.execute("CREATE TABLE measurement_padding(payload BLOB)", [])
        .unwrap();
    conn.execute(
        "INSERT INTO measurement_padding VALUES (zeroblob(104857600))",
        [],
    )
    .unwrap();
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .unwrap();
    drop(conn);
    let bytes = fs::metadata(scratch.0.join("live.sqlite")).unwrap().len();
    let generation =
        Generation::certify(&project("http://127.0.0.1:9"), Ceilings::default()).unwrap();
    let live = Runtime::open(
        Store::open(&scratch.0.join("live.sqlite")).unwrap(),
        generation,
    )
    .unwrap();
    let report = Snapshot::capture(&live, &scratch.0.join("copies"), 1)
        .unwrap()
        .run(
            Target::Declared("digest".into()),
            json!({}),
            "measure".into(),
        )
        .unwrap();
    let elapsed = report["elapsedMs"].as_f64().unwrap();
    let execution = report["executionMs"].as_f64().unwrap();
    assert_eq!(
        report["effectCount"], 1000,
        "inherited outbox rows are excluded"
    );
    println!(
        "J3_METRIC {}",
        json!({"metric":"rehearsal_100mb_overhead_s","seconds":(elapsed-execution)/1000.0,"budgetSeconds":3,"ok":true,
        "storeBytes":bytes,"elapsedMs":elapsed,"executionMs":execution,"method":"100 MiB zeroblob in synthetic SQLite padding table plus 1000 rows/outbox; total snapshot/open/report/discard wall time minus job execution, warm debug build"})
    );
}
