use super::*;
use snapback_kernel::instance_fork::DerivedForkRuntimeExt as _;

#[cfg(feature = "services-owner")]
#[test]
fn json_publication_hides_the_final_path_until_synced_temp_is_complete() {
    let directory = tempfile::tempdir().unwrap();
    let published = directory.path().join("identity.json");
    let expected = AppRootIdentityV1 {
        schema_version: "snapback.fork-app-identity.v1".to_owned(),
        canonical_app_root: directory.path().display().to_string(),
        app_id: "app-a".to_owned(),
    };
    let expected_in_hook = expected.clone();
    let published_in_hook = published.clone();
    let hook_ran = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let hook_ran_in_hook = hook_ran.clone();
    install_json_before_rename_hook(move |temporary, final_path| {
        assert_eq!(final_path, published_in_hook);
        assert!(
            !final_path.exists(),
            "first publication must not expose the final name before rename"
        );
        let staged: AppRootIdentityV1 =
            serde_json::from_slice(&fs::read(temporary).unwrap()).unwrap();
        assert_eq!(staged, expected_in_hook);
        hook_ran_in_hook.store(true, std::sync::atomic::Ordering::SeqCst);
    });

    write_json_sync(&published, &expected).unwrap();

    assert!(hook_ran.load(std::sync::atomic::Ordering::SeqCst));
    let recorded: AppRootIdentityV1 =
        serde_json::from_slice(&fs::read(&published).unwrap()).unwrap();
    assert_eq!(recorded, expected);
}

#[cfg(feature = "services-owner")]
#[test]
fn concurrent_app_root_identity_first_publication_is_idempotent() {
    const WRITERS: usize = 32;
    let directory = tempfile::tempdir().unwrap();
    let app_root = directory.path().join("app");
    fs::create_dir(&app_root).unwrap();
    let canonical_app_root = fs::canonicalize(&app_root).unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(WRITERS));

    std::thread::scope(|scope| {
        let handles = (0..WRITERS)
            .map(|_| {
                let app_root = app_root.clone();
                let barrier = barrier.clone();
                scope.spawn(move || {
                    barrier.wait();
                    ensure_expected_app(&app_root, "app-a")
                })
            })
            .collect::<Vec<_>>();
        for handle in handles {
            let expected = handle.join().unwrap().unwrap();
            assert_eq!(expected.canonical_app_root(), canonical_app_root);
            assert_eq!(expected.app_id(), "app-a");
        }
    });

    let identity = app_root.join(".snapback").join(APP_ROOT_IDENTITY_FILE);
    let recorded: AppRootIdentityV1 = serde_json::from_slice(&fs::read(identity).unwrap()).unwrap();
    assert_eq!(recorded.app_id, "app-a");
    assert_eq!(
        recorded.canonical_app_root,
        canonical_app_root.display().to_string()
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn concurrent_same_id_first_writers_compare_and_publish_one_identity() {
    let directory = tempfile::tempdir().unwrap();
    let app_root = directory.path().join("app");
    fs::create_dir(&app_root).unwrap();
    let install_barrier = std::sync::Arc::new(std::sync::Barrier::new(2));

    let outcomes = std::thread::scope(|scope| {
        let handles = (0..2)
            .map(|_| {
                let app_root = app_root.clone();
                let install_barrier = install_barrier.clone();
                scope.spawn(move || {
                    install_json_before_rename_hook(move |_temporary, _published| {
                        install_barrier.wait();
                    });
                    ensure_expected_app(&app_root, "app-a")
                })
            })
            .collect::<Vec<_>>();
        handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>()
    });

    assert!(outcomes.into_iter().all(|outcome| outcome.is_ok()));
    let identity_directory = app_root.join(".snapback");
    let mut files = fs::read_dir(&identity_directory)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect::<Vec<_>>();
    files.sort();
    assert_eq!(files, [std::ffi::OsString::from(APP_ROOT_IDENTITY_FILE)]);
    let recorded: AppRootIdentityV1 =
        serde_json::from_slice(&fs::read(identity_directory.join(APP_ROOT_IDENTITY_FILE)).unwrap())
            .unwrap();
    assert_eq!(recorded.app_id, "app-a");
}

#[cfg(feature = "services-owner")]
#[test]
fn conflicting_first_writers_accept_one_identity_before_mint_or_launch() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let app_root = directory.path().join("app");
    fs::create_dir(&app_root).unwrap();
    let install_barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let mint_attempts = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let launch_attempts = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));

    let outcomes = std::thread::scope(|scope| {
        let handles = ["app-a", "app-b"]
            .into_iter()
            .map(|app_id| {
                let app_root = app_root.clone();
                let source = source.clone();
                let destination = directory.path().join(format!("fork-{app_id}"));
                let install_barrier = install_barrier.clone();
                let mint_attempts = mint_attempts.clone();
                let launch_attempts = launch_attempts.clone();
                scope.spawn(move || -> SnapbackResult<String> {
                    install_json_before_rename_hook(move |_temporary, _published| {
                        install_barrier.wait();
                    });
                    let expected = ensure_expected_app(&app_root, app_id)?;
                    mint_attempts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    publish_managed(
                        &source,
                        &destination,
                        &expected,
                        "parent",
                        100,
                        200_000,
                        false,
                    )?;
                    // This is the exact production ordering boundary: CLI
                    // launch follows a successful mint, so a refusal above
                    // cannot reach either counter.
                    launch_attempts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Ok(app_id.to_owned())
                })
            })
            .collect::<Vec<_>>();
        handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>()
    });

    let accepted = outcomes
        .iter()
        .filter_map(|outcome| outcome.as_ref().ok())
        .collect::<Vec<_>>();
    assert_eq!(accepted.len(), 1);
    let refusal = outcomes
        .iter()
        .find_map(|outcome| outcome.as_ref().err())
        .expect("the losing first writer refuses");
    assert_eq!(refusal.diagnostic.code, APP_BINDING_MISMATCH_CODE);
    assert_eq!(mint_attempts.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert_eq!(launch_attempts.load(std::sync::atomic::Ordering::SeqCst), 1);

    let identity = app_root.join(".snapback").join(APP_ROOT_IDENTITY_FILE);
    let recorded: AppRootIdentityV1 = serde_json::from_slice(&fs::read(identity).unwrap()).unwrap();
    assert_eq!(recorded.app_id, accepted[0].as_str());
    assert!(
        directory
            .path()
            .join(format!("fork-{}", accepted[0]))
            .is_dir()
    );
    assert!(
        !directory
            .path()
            .join(format!(
                "fork-{}",
                refusal.diagnostic.details["expectedAppId"]
                    .as_str()
                    .unwrap()
            ))
            .exists()
    );
}

fn managed_expected(root: &Path) -> ExpectedForkAppV1 {
    ensure_expected_app(root, "app-a").unwrap()
}

fn managed_expected_for(destination: &Path) -> ExpectedForkAppV1 {
    managed_expected(destination.parent().expect("managed destination parent"))
}

fn app_row_schema() -> crate::manifest::SchemaManifest {
    // @ref LLP 0264#d2-v1-default-write-posture-by-policy-kind — this
    // ordinary writable fixture declares its pre-existing public posture.
    crate::manifest::SchemaManifest {
        tables: vec![crate::manifest::TableManifest {
            name: "items".to_owned(),
            fields: vec![
                crate::manifest::FieldManifest {
                    name: "title".to_owned(),
                    field_type: crate::manifest::FieldType::String,
                    optional: false,
                },
                crate::manifest::FieldManifest {
                    name: "rank".to_owned(),
                    field_type: crate::manifest::FieldType::Integer,
                    optional: true,
                },
            ],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: Some(crate::manifest::TableVisibilityV1::PublicRead),
            history: None,
        }],
        ..crate::manifest::SchemaManifest::default()
    }
}

fn app_row_source_database(directory: &Path) -> PathBuf {
    let path = directory.join("app.sqlite3");
    let mut db = crate::storage::LocalDatabase::open(&path).unwrap();
    db.schema_seed().apply_schema(app_row_schema()).unwrap();
    db.mutation_writes()
        .commit_buffered_writes(
            &crate::manifest::HandlerInput::default(),
            vec![
                crate::storage::BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: "update-me".to_owned(),
                    values: serde_json::Map::from_iter([("title".to_owned(), json!("before"))]),
                },
                crate::storage::BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: "delete-me".to_owned(),
                    values: serde_json::Map::from_iter([("title".to_owned(), json!("doomed"))]),
                },
                crate::storage::BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: "revert-me".to_owned(),
                    values: serde_json::Map::from_iter([("title".to_owned(), json!("original"))]),
                },
            ],
            Vec::new(),
            Value::Null,
        )
        .unwrap();
    drop(db);
    path
}

fn publish_armed_app_row_fork(
    source: &Path,
    destination: &Path,
) -> (ForkMintReceiptV1, ForkAppRowCoverageReceiptV1, PathBuf) {
    let now_ms = wall_clock_now_ms();
    let mint = publish_managed_with_base(
        source,
        destination,
        &managed_expected_for(destination),
        "parent-a",
        now_ms,
        now_ms + 60_000,
        false,
        true,
    )
    .unwrap();
    let database = destination.join(&mint.database_file);
    let coverage = arm_derived_fork_app_row_coverage(&database, None, now_ms + 1).unwrap();
    (mint, coverage, database)
}

fn source_database(directory: &Path) -> PathBuf {
    let path = directory.join("app.sqlite3");
    let db = crate::storage::LocalDatabase::open(&path).unwrap();
    drop(db);
    path
}

#[cfg(feature = "services-owner")]
#[test]
fn custody_sweep_fails_for_unknown_owned_table() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute("CREATE TABLE _snapback_future_authority(id TEXT)", [])
        .unwrap();
    let error = audit_connection(&conn).unwrap_err();
    assert_eq!(error.diagnostic.code, "SNAPBACK_FORK_CUSTODY_UNCLASSIFIED");
    assert_eq!(
        error.diagnostic.details["table"],
        "_snapback_future_authority"
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn fresh_runtime_schema_is_fully_classified() {
    let directory = tempfile::tempdir().unwrap();
    let path = source_database(directory.path());
    let conn = Connection::open(path).unwrap();
    let classified = audit_connection(&conn).unwrap();
    assert!(!classified.is_empty());
    assert_eq!(
        TABLE_CUSTODY
            .iter()
            .map(|rule| rule.name)
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        TABLE_CUSTODY.len(),
        "table custody entries are unique"
    );
    assert_eq!(
        SIDECAR_CUSTODY.len(),
        10,
        "the Phase 5 asset tree and LLP 0163 operation-detail keyring are both classified"
    );
    assert!(SIDECAR_CUSTODY.iter().any(|rule| {
        rule.name == "*.operation-detail-keyring.json"
            && rule.disposition == CustodyDisposition::Rotate
    }));
    assert_eq!(
        SIDECAR_CUSTODY
            .iter()
            .map(|rule| rule.name)
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        SIDECAR_CUSTODY.len(),
        "sidecar custody conventions are unique"
    );
}

fn blob_digest(bytes: &[u8]) -> String {
    use sha2::Digest as _;
    let mut hasher = sha2::Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn asset_bearing_parent(directory: &Path, blob_bytes: &[u8]) -> PathBuf {
    let source = source_database(directory);
    let conn = Connection::open(&source).unwrap();
    conn.execute(
        "INSERT INTO _snapback_asset_records_v1(
           asset_id,app_id,intent_id,owner_principal,availability,
           lifecycle_generation,record_json,updated_at_ms
         ) VALUES('asset-a','app-a','intent-a','user-a','ready',1,'{}',1)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO _snapback_asset_blobs_v1(
           blob_id,app_id,store,physical_key,digest_algorithm,digest,
           canonicalization_policy,byte_length,reference_count,record_json,updated_at_ms
         ) VALUES('blob-a','app-a','local-fs','blob-a-key','sha256',?1,'none',?2,1,'{}',1)",
        params![blob_digest(blob_bytes), blob_bytes.len() as u64],
    )
    .unwrap();
    drop(conn);
    let blobs = directory.join("assets").join("blobs");
    fs::create_dir_all(&blobs).unwrap();
    fs::write(blobs.join("blob-a-key"), blob_bytes).unwrap();
    source
}

#[cfg(feature = "services-owner")]
#[test]
fn asset_bearing_source_forks_with_same_cut_private_custody() {
    let directory = tempfile::tempdir().unwrap();
    let bytes = b"asset bytes under fork custody";
    let source = asset_bearing_parent(directory.path(), bytes);
    let destination = directory.path().join("fork");
    publish(&source, &destination, "app-a", "parent-a", 42, None).unwrap();

    let fork_blob = destination.join("assets").join("blobs").join("blob-a-key");
    assert_eq!(
        fs::read(&fork_blob).unwrap(),
        bytes,
        "byte-identical private copy"
    );
    let conn = Connection::open(destination.join("app.sqlite3")).unwrap();
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM _snapback_asset_blobs_v1", [], |row| {
            row.get::<_, u64>(0)
        })
        .unwrap(),
        1,
        "the metadata cut copies with its blobs"
    );
    drop(conn);

    // Custody independence both ways: deleting the parent blob leaves the
    // fork's copy intact, and rewriting the fork's copy never touches the
    // parent store.
    let parent_blob = directory
        .path()
        .join("assets")
        .join("blobs")
        .join("blob-a-key");
    fs::remove_file(&parent_blob).unwrap();
    assert_eq!(fs::read(&fork_blob).unwrap(), bytes);
    fs::write(&fork_blob, b"fork-local rewrite").unwrap();
    assert!(!parent_blob.exists());
}

#[cfg(feature = "services-owner")]
#[test]
fn torn_or_unclassified_asset_cuts_refuse_before_publication() {
    // A blob the metadata names but the parent store lost: refuse, and
    // recovery leaves no staging residue or bootable half-fork.
    let missing = tempfile::tempdir().unwrap();
    let source = asset_bearing_parent(missing.path(), b"gone");
    fs::remove_file(missing.path().join("assets/blobs/blob-a-key")).unwrap();
    let destination = missing.path().join("fork");
    let error = publish(&source, &destination, "app-a", "parent-a", 42, None).unwrap_err();
    assert_eq!(error.diagnostic.code, ASSET_CUT_INCOMPLETE_CODE);
    assert_eq!(error.diagnostic.details["physicalKey"], "blob-a-key");
    assert!(
        fs::read_dir(missing.path()).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".fork.staging-")
        }),
        "an ordinary publication error removes its credential-bearing staging directory"
    );
    recover(missing.path(), &destination).unwrap();
    assert!(!destination.exists(), "no metadata-only fork survives");

    // Bytes that no longer match the recorded digest: refuse with both
    // digests named.
    let tampered = tempfile::tempdir().unwrap();
    let source = asset_bearing_parent(tampered.path(), b"original bytes");
    fs::write(
        tampered.path().join("assets/blobs/blob-a-key"),
        b"tampered bytes!",
    )
    .unwrap();
    let error = publish(
        &source,
        &tampered.path().join("fork"),
        "app-a",
        "parent-a",
        42,
        None,
    )
    .unwrap_err();
    assert_eq!(error.diagnostic.code, ASSET_CUT_INCOMPLETE_CODE);
    assert!(error.diagnostic.details["observedDigest"].is_string());

    // Unknown store and unknown digest algorithm both fail closed.
    for (column, value) in [("store", "s3-compatible"), ("digest_algorithm", "blake3")] {
        let unknown = tempfile::tempdir().unwrap();
        let source = asset_bearing_parent(unknown.path(), b"payload");
        let conn = Connection::open(&source).unwrap();
        conn.execute(
            &format!("UPDATE _snapback_asset_blobs_v1 SET {column}=?1"),
            [value],
        )
        .unwrap();
        drop(conn);
        let error = publish(
            &source,
            &unknown.path().join("fork"),
            "app-a",
            "parent-a",
            42,
            None,
        )
        .unwrap_err();
        assert_eq!(
            error.diagnostic.code, ASSET_CUT_UNSUPPORTED_CODE,
            "{column}"
        );
    }
}

#[cfg(not(feature = "services-owner"))]
#[test]
fn scrub_mints_non_promotable_identity_and_payload_free_marker() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let mut parent = Connection::open(&source).unwrap();
    crate::proof_checkpoint::ensure_checkpoint_erasure_infra(&parent)
        .expect("initialize exercised checkpoint/erasure custody");
    crate::operation_detail::install(&parent, Some(&source))
        .expect("install parent operation detail custody");
    let tx = parent.transaction().unwrap();
    crate::operation_detail::seal_in(
        &tx,
        "operation-detail:test:fork-parent",
        &format!("sha256:{}", "a".repeat(64)),
        &json!({ "secret": "parent-only" }),
    )
    .expect("seal parent protected detail");
    tx.execute_batch(
        "INSERT INTO _snapback_operation_pending_v1(
           stream_id,originator_class,operation_id,lane,audience,epoch_id,lifecycle_json
         ) VALUES('parent-stream','host','parent-op','migration','parent-audience','parent-epoch','{}');
         INSERT INTO _snapback_operation_terminal_supplements_v1(
           stream_id,originator_class,operation_id,lane,audience,epoch_id,
           terminal_at_ms,supplement_json
         ) VALUES('parent-stream','host','parent-op','migration','parent-audience','parent-epoch',1,'{}');
         INSERT INTO _snapback_operation_purges_v1(
           purge_id,selector_class,selector_digest,settlement_count,operation_count,
           operation_keys_digest,recorded_at_ms
         ) VALUES('parent-purge','all','parent-selector',1,1,'parent-operations',1);
         INSERT INTO _snapback_protected_record_erasure_v1(
           erasure_id,operation_id,qualified_table,row_id,state,receipt_json,updated_at_ms
         ) VALUES('parent-erasure','parent-erasure-op','notes','row-a','complete','{}',1);
         UPDATE _snapback_protected_erasure_generation_v1 SET generation=7 WHERE id=1;",
    )
    .unwrap();
    tx.commit().unwrap();
    drop(parent);
    let parent_operation_detail_key = fs::read(crate::operation_detail::keyring_path(&source))
        .expect("parent operation detail key");
    let destination = directory.path().join("fork");
    let receipt = publish(&source, &destination, "app-a", "parent-a", 42, None).unwrap();
    assert!(!receipt.lineage.promotable);
    for rule in SIDECAR_CUSTODY {
        assert_eq!(
            receipt.custody[&format!("sidecar:{}", rule.name)],
            rule.disposition
        );
    }
    for (table, disposition) in [
        ("_snapback_operation_pending_v1", CustodyDisposition::Scrub),
        ("_snapback_operation_purges_v1", CustodyDisposition::Scrub),
        (
            "_snapback_operation_terminal_supplements_v1",
            CustodyDisposition::Scrub,
        ),
        (
            "_snapback_protected_record_erasure_v1",
            CustodyDisposition::Scrub,
        ),
        (
            "_snapback_protected_erasure_generation_v1",
            CustodyDisposition::Rotate,
        ),
    ] {
        assert_eq!(receipt.custody[table], disposition, "{table}");
    }
    let database = destination.join("app.sqlite3");
    let child_operation_detail_key = fs::read(crate::operation_detail::keyring_path(&database))
        .expect("child operation detail key");
    assert_ne!(
        parent_operation_detail_key, child_operation_detail_key,
        "derived forks rotate protected-detail custody rather than copying the parent key"
    );
    let runtime = inspect_boot(&database).unwrap().unwrap();
    let error = runtime.deny(EgressFamily::Fetch, 43);
    assert_eq!(error.diagnostic.code, "SNAPBACK_FORK_EGRESS_DENIED");
    let conn = Connection::open(&database).unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM _snapback_operation_protected_detail_v1",
            [],
            |row| row.get::<_, u64>(0),
        )
        .unwrap(),
        0,
        "parent ciphertext is scrubbed before the derived fork becomes bootable"
    );
    for table in [
        "_snapback_operation_pending_v1",
        "_snapback_operation_purges_v1",
        "_snapback_operation_terminal_supplements_v1",
        "_snapback_protected_record_erasure_v1",
    ] {
        let count = conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get::<_, u64>(0)
            })
            .unwrap();
        assert_eq!(count, 0, "parent authority survived in {table}");
    }
    assert_eq!(
        conn.query_row(
            "SELECT generation FROM _snapback_protected_erasure_generation_v1 WHERE id=1",
            [],
            |row| row.get::<_, u64>(0),
        )
        .unwrap(),
        0,
        "the child must start with a fresh protected-erasure fence generation"
    );
    let row: (String, u64) = conn
        .query_row(
            "SELECT family,attempts FROM _snapback_fork_egress_attempts_v1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(row, ("fetch".to_owned(), 1));
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('_snapback_fork_egress_attempts_v1')",
            [],
            |row| row.get::<_, u64>(0)
        )
        .unwrap(),
        4
    );
    drop(conn);
    let mut served = crate::local::LocalSnapback::open(&database).unwrap();
    assert!(served.is_derived_fork());
    assert_eq!(
        served
            .claim_due_cron_runs(44)
            .err()
            .unwrap()
            .diagnostic
            .code,
        "SNAPBACK_FORK_EGRESS_DENIED"
    );
    assert_eq!(
        served
            .claim_due_jobs(
                45,
                1,
                "fork-test",
                crate::local::DiagnosticBoundary::Standalone,
            )
            .err()
            .unwrap()
            .diagnostic
            .code,
        "SNAPBACK_FORK_EGRESS_DENIED"
    );
    let parent = Connection::open(&source).unwrap();
    for table in [
        "_snapback_operation_pending_v1",
        "_snapback_operation_purges_v1",
        "_snapback_operation_terminal_supplements_v1",
        "_snapback_protected_record_erasure_v1",
        "_snapback_operation_protected_detail_v1",
    ] {
        let count = parent
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get::<_, u64>(0)
            })
            .unwrap();
        assert_eq!(count, 1, "fork publication mutated parent table {table}");
    }
    assert_eq!(
        parent
            .query_row(
                "SELECT generation FROM _snapback_protected_erasure_generation_v1 WHERE id=1",
                [],
                |row| row.get::<_, u64>(0),
            )
            .unwrap(),
        7,
        "fork publication mutated the parent erasure generation"
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn derived_fork_keeps_its_pinned_copy_when_parent_writes_after_publication() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let parent = Connection::open(&source).unwrap();
    parent
        .execute_batch(
            "CREATE TABLE notes(id TEXT PRIMARY KEY, body TEXT NOT NULL);
             INSERT INTO notes(id,body) VALUES('before','fork point');",
        )
        .unwrap();

    let destination = directory.path().join("fork");
    publish(&source, &destination, "app-a", "parent-a", 42, None).unwrap();

    parent
        .execute(
            "UPDATE notes SET body='parent advanced' WHERE id='before'",
            [],
        )
        .unwrap();
    parent
        .execute(
            "INSERT INTO notes(id,body) VALUES('after','parent only')",
            [],
        )
        .unwrap();

    let fork = Connection::open(destination.join("app.sqlite3")).unwrap();
    assert_eq!(
        fork.query_row("SELECT body FROM notes WHERE id='before'", [], |row| {
            row.get::<_, String>(0)
        })
        .unwrap(),
        "fork point"
    );
    assert_eq!(
        fork.query_row("SELECT COUNT(*) FROM notes WHERE id='after'", [], |row| {
            row.get::<_, u64>(0)
        })
        .unwrap(),
        0,
        "a derived deployment is a copied instance, not a view of parent head"
    );
    assert_eq!(
        parent
            .query_row("SELECT body FROM notes WHERE id='before'", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
        "parent advanced"
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn parent_commits_after_the_fork_point_are_invisible_to_the_published_fork() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let parent = Connection::open(&source).unwrap();
    parent
        .execute_batch(
            "CREATE TABLE notes(id TEXT PRIMARY KEY, body TEXT NOT NULL);
             INSERT INTO notes(id,body) VALUES('kept','fork point');
             INSERT INTO notes(id,body) VALUES('mutated','fork point');
             INSERT INTO notes(id,body) VALUES('doomed','fork point');",
        )
        .unwrap();

    let destination = directory.path().join("fork");
    let receipt = publish_managed(
        &source,
        &destination,
        &managed_expected_for(&destination),
        "parent-a",
        100,
        200_000,
        false,
    )
    .unwrap();
    assert_eq!(receipt.lineage.fork_point_version, 0);

    // Every kind of committed parent progress after the fork point:
    // update, insert, delete, new schema, and journal/version advance.
    parent
        .execute_batch(
            "UPDATE notes SET body='parent advanced' WHERE id='mutated';
             DELETE FROM notes WHERE id='doomed';
             INSERT INTO notes(id,body) VALUES('after','parent only');
             CREATE TABLE post_fork_table(id TEXT PRIMARY KEY);
             UPDATE _snapback_version SET version=7 WHERE id=1;
             INSERT INTO _snapback_changes(version,table_name,row_id,op,row_json,changed_at_ms)
             VALUES(7,'notes','after','insert','{\"_id\":\"after\"}',150);",
        )
        .unwrap();

    let database = destination.join("app.sqlite3");
    let fork = Connection::open(&database).unwrap();
    let body = |id: &str| {
        fork.query_row("SELECT body FROM notes WHERE id=?1", [id], |row| {
            row.get::<_, String>(0)
        })
    };
    assert_eq!(body("kept").unwrap(), "fork point");
    assert_eq!(body("mutated").unwrap(), "fork point");
    assert_eq!(body("doomed").unwrap(), "fork point");
    assert_eq!(
        fork.query_row("SELECT COUNT(*) FROM notes WHERE id='after'", [], |row| {
            row.get::<_, u64>(0)
        })
        .unwrap(),
        0,
        "a derived deployment is a pinned copy, not a view of parent head"
    );
    assert!(!table_exists(&fork, "post_fork_table").unwrap());
    assert_eq!(
        fork.query_row(
            "SELECT version FROM _snapback_version WHERE id=1",
            [],
            |row| { row.get::<_, u64>(0) }
        )
        .unwrap(),
        receipt.lineage.fork_point_version,
        "parent version advance never moves the fork's committed head"
    );
    drop(fork);
    let diff = diff_receipt(&database).unwrap();
    assert!(
        diff.rows.is_empty(),
        "post-fork parent journal entries never attribute into the fork diff"
    );
    assert_eq!(
        diff.observed_head_version,
        receipt.lineage.fork_point_version
    );
}

#[cfg(not(feature = "services-owner"))]
#[test]
fn parent_credential_and_cursor_corpus_is_refused_by_minted_fork() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let parent_admin = "sbat_parent_must_not_survive";
    crate::secure_file::write_owner_only(
        &crate::admin::admin_token_sibling(&source),
        format!("{parent_admin}\n").as_bytes(),
    )
    .unwrap();
    let parent_auth_keyring = crate::auth::keyring::AuthKeyringStore::file_for_database(&source);
    parent_auth_keyring
        .load_or_mint_initial(1_000, &crate::auth::crypto::OsRandom)
        .unwrap();
    let parent_auth_bytes = fs::read(crate::auth::keyring::AuthKeyringStore::keyring_path(
        &source,
    ))
    .unwrap();

    let parent_resume_path = directory
        .path()
        .join(crate::rqs_contract::RESUME_KEYRING_FILE_NAME);
    let mut parent_resume = crate::rqs::ResumeKeyring::load_or_create(parent_resume_path, 1_000);
    let (parent_resume_key_id, parent_resume_key) = parent_resume.active(1_000).unwrap();
    let parent_resume_body = crate::rqs::ResumeTokenBody {
        app: "app-a".to_owned(),
        generation: "generation-a".to_owned(),
        version_stream: "parent-stream".to_owned(),
        version: 1,
        query_artifact: "query-a".to_owned(),
        args_hash: "sha256:args".to_owned(),
        digest_kind: "rows".to_owned(),
        content_digest: "sha256:rows".to_owned(),
        issued_at: 1_000,
        auth_partition: None,
    };
    let parent_resume_token = crate::rqs::mint_token_wire(
        parent_resume_key.as_ref(),
        &parent_resume_key_id,
        &parent_resume_body,
    );
    let (search_generation, search_root) = parent_resume
        .search_cursor_materials(1_000)
        .into_iter()
        .next()
        .unwrap();
    let parent_search_cursor = crate::search::cursor::mint(
        &search_root,
        &crate::search::types::SearchCursorV1 {
            format_version: 1,
            app_id: "app-a".to_owned(),
            database_id: "parent-a".to_owned(),
            target_profile_id: "local-dev-sqlite-ibex".to_owned(),
            stream_epoch: "parent-stream".to_owned(),
            semantic_version: "v1".to_owned(),
            physical_generation: 1,
            query_core_hash: "sha256:q".to_owned(),
            limit: 10,
            authority_instance: "parent-auth".to_owned(),
            owner_subject: None,
            release_policy_digest: "sha256:p".to_owned(),
            score: 100,
            row_id: "row-a".to_owned(),
            row_id_direction: "asc".to_owned(),
            key_generation: search_generation,
            issued_at: 1_000,
            expires_at: 121_000,
            membership_resource: None,
            membership_declaration: None,
            membership_roles: None,
            authorization_incarnation: None,
            authorization_epoch: None,
        },
    )
    .unwrap();

    let parent_asset_token;
    let parent_authorization;
    let parent_data_stream;
    {
        let mut conn = Connection::open(&source).unwrap();
        conn.execute_batch(
            "CREATE TABLE _auth_sessions(id TEXT PRIMARY KEY, token_hash TEXT);
             CREATE TABLE _auth_agent_credentials(id TEXT PRIMARY KEY, token_hash TEXT);
             CREATE TABLE _auth_grants(id TEXT PRIMARY KEY, subject TEXT, revoked_at_ms INTEGER);
             CREATE TABLE _auth_grant_tokens(id TEXT PRIMARY KEY, grant_id TEXT, token_hash TEXT);
             INSERT INTO _auth_sessions VALUES('session-a','parent-session-token-hash');
             INSERT INTO _auth_agent_credentials VALUES('agent-a','parent-agent-token-hash');
             -- One live and one already-revoked grant: neither class of
             -- parent authority — current, stale, or revoked — may exist
             -- in the fork at all, so revocation cannot be undone by
             -- forking (LLP 0185 Phase 3 item 2).
             INSERT INTO _auth_grants VALUES('grant-live','agent-a',NULL);
             INSERT INTO _auth_grants VALUES('grant-revoked','agent-a',900);
             INSERT INTO _auth_grant_tokens VALUES('gtok-live','grant-live','live-hash');
             INSERT INTO _auth_grant_tokens VALUES('gtok-revoked','grant-revoked','revoked-hash');",
        )
        .unwrap();
        let tx = conn.transaction().unwrap();
        crate::assets::create_infra(&tx).unwrap();
        let key = crate::assets::active_signing_key(&tx, 1_000).unwrap();
        parent_asset_token =
            crate::assets::mint_signed_url_token(&key, "asset-a", "original", "user-a", 1, 10_000);
        parent_authorization = crate::storage::auth_stream::rotate_authorization_version_in(&tx)
            .unwrap()
            .incarnation;
        parent_data_stream =
            crate::storage::auth_invalidation::rotate_data_version_stream_in(&tx).unwrap();
        tx.commit().unwrap();
    }

    let destination = directory.path().join("fork");
    let receipt = publish(&source, &destination, "app-a", "parent-a", 2_000, None).unwrap();
    assert_ne!(
        receipt.authorization_stream_incarnation,
        parent_authorization
    );
    assert_ne!(receipt.data_version_stream, parent_data_stream);
    let database = destination.join("app.sqlite3");
    let conn = Connection::open(&database).unwrap();
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM _auth_sessions", [], |row| row
            .get::<_, u64>(0))
            .unwrap(),
        0,
        "parent session bearer hash is absent"
    );
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM _auth_agent_credentials", [], |row| {
            row.get::<_, u64>(0)
        })
        .unwrap(),
        0,
        "parent agent credential hash is absent"
    );
    for table in ["_auth_grants", "_auth_grant_tokens"] {
        assert_eq!(
            conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get::<_, u64>(0)
            })
            .unwrap(),
            0,
            "{table}: live, stale, and revoked parent grant authority is all absent"
        );
    }
    let child_admin = fs::read_to_string(crate::admin::admin_token_sibling(&database)).unwrap();
    assert_ne!(child_admin.trim(), parent_admin);
    let child_auth_bytes = fs::read(crate::auth::keyring::AuthKeyringStore::keyring_path(
        &database,
    ))
    .unwrap();
    assert_ne!(child_auth_bytes, parent_auth_bytes);
    let child_resume = crate::rqs::ResumeKeyring::load_or_create(
        destination.join(crate::rqs_contract::RESUME_KEYRING_FILE_NAME),
        2_000,
    );
    assert!(
        crate::rqs::decode_and_verify(
            &parent_resume_token,
            &child_resume,
            2_000,
            crate::rqs::RESUME_TOKEN_MAX_AGE_MS,
        )
        .is_err(),
        "parent resume token must not verify under the fork keyring"
    );
    assert!(
        crate::search::cursor::decode(
            &parent_search_cursor,
            &child_resume.search_cursor_materials(2_000),
            "app-a",
            "local-dev-sqlite-ibex",
            2_000,
        )
        .is_err(),
        "parent search cursor must not decrypt under the fork keyring"
    );
    let tx = conn.unchecked_transaction().unwrap();
    assert!(matches!(
        crate::assets::validate_signed_url_token(
            &tx,
            &parent_asset_token,
            "asset-a",
            "original",
            1,
            2_000,
        )
        .unwrap(),
        crate::assets::SignedTokenOutcome::Invalid
    ));
}

#[cfg(not(feature = "services-owner"))]
#[test]
fn host_op_gate_denies_every_egress_family_and_names_unclassified_ops() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let destination = directory.path().join("fork");
    publish(&source, &destination, "app-a", "parent-a", 42, None).unwrap();
    let database = destination.join("app.sqlite3");
    let fork = crate::local::LocalSnapback::open(&database).unwrap();

    // The plan's egress families that flow through the shared host-op
    // gate: HTTP fetch, external effects, push delivery, action streams,
    // and job enqueue all refuse at the same mediation point.
    for (op, family) in [
        ("host.fetch", "fetch"),
        ("action.externalEffectBegin", "fetch"),
        ("push.send", "push_send"),
        ("action.streamOpen", "stream_open"),
        ("action.streamRead", "stream_read"),
        ("action.streamCancel", "stream_cancel"),
        ("jobs.enqueue", "jobs_enqueue"),
    ] {
        let error = fork.deny_derived_fork_host_op(op, 43).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_FORK_EGRESS_DENIED", "{op}");
        assert_eq!(error.diagnostic.details["family"], family, "{op}");
        assert_eq!(error.diagnostic.details["hostOp"], op);
    }
    // The future-family rule: an op this build has never heard of fails
    // closed and the diagnostic names the exact op, not just the bucket.
    let error = fork
        .deny_derived_fork_host_op("future.networkDial", 44)
        .unwrap_err();
    assert_eq!(error.diagnostic.code, "SNAPBACK_FORK_EGRESS_DENIED");
    assert_eq!(
        error.diagnostic.details["family"],
        "unclassified_host_operation"
    );
    assert_eq!(error.diagnostic.details["hostOp"], "future.networkDial");
    // Local-only ops stay admitted on a fork.
    fork.deny_derived_fork_host_op("db.query", 45).unwrap();
    fork.deny_derived_fork_host_op("runtime.now", 45).unwrap();
    fork.deny_derived_fork_host_op("mutation.settlement", 45)
        .unwrap();
    fork.deny_derived_fork_host_op("authority.list", 45)
        .unwrap();
    fork.deny_derived_fork_host_op("authority.myRole", 45)
        .unwrap();
    drop(fork);
    // Every refusal above left a durable, payload-free marker.
    let conn = Connection::open(&database).unwrap();
    let marker_families: u64 = conn
        .query_row(
            "SELECT COUNT(*) FROM _snapback_fork_egress_attempts_v1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(marker_families, 7, "one marker row per denied family");

    // The same gate is inert on an ordinary (non-fork) instance.
    let plain = crate::local::LocalSnapback::open(&source).unwrap();
    plain.deny_derived_fork_host_op("host.fetch", 46).unwrap();
}

#[cfg(not(feature = "services-owner"))]
#[test]
fn manual_cron_and_asset_provider_paths_deny_on_a_fork() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let destination = directory.path().join("fork");
    publish(&source, &destination, "app-a", "parent-a", 42, None).unwrap();
    let mut fork = crate::local::LocalSnapback::open_with_asset_store_backend_for_test(
        destination.join("app.sqlite3"),
        crate::assets_store::AssetStoreBackend::S3,
    )
    .unwrap();
    let manual_cron = match fork.claim_manual_cron_run("any-job", 43) {
        Ok(_) => panic!("a fork must never claim a manual cron run"),
        Err(error) => error,
    };
    assert_eq!(
        manual_cron.diagnostic.code, "SNAPBACK_FORK_EGRESS_DENIED",
        "a manual cron drain is the same egress family as the scheduler"
    );
    // Inherited provider configuration cannot turn a fork into an
    // outbound asset client: the provider-adapter selection point itself
    // refuses before any store is constructed.
    let denied = match snapback_engine::test_support::asset_store_obj(&fork) {
        Ok(_) => panic!("a fork must never construct a provider asset store"),
        Err(error) => error,
    };
    assert_eq!(denied.diagnostic.code, "SNAPBACK_FORK_EGRESS_DENIED");
    assert_eq!(denied.diagnostic.details["family"], "asset_provider");
}

#[cfg(not(feature = "services-owner"))]
#[test]
fn every_deny_all_family_has_one_bounded_payload_free_row() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let destination = directory.path().join("fork");
    publish(&source, &destination, "app-a", "parent-a", 42, None).unwrap();
    let runtime = inspect_boot(&destination.join("app.sqlite3"))
        .unwrap()
        .unwrap();
    let families = EgressFamily::ALL;
    for family in families {
        assert_eq!(
            runtime.deny(family, 43).diagnostic.code,
            "SNAPBACK_FORK_EGRESS_DENIED"
        );
    }
    let conn = Connection::open(&runtime.database_path).unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM _snapback_fork_egress_attempts_v1",
            [],
            |row| row.get::<_, usize>(0),
        )
        .unwrap(),
        families.len()
    );
    let total: u64 = conn
        .query_row(
            "SELECT SUM(attempts) FROM _snapback_fork_egress_attempts_v1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(total, families.len() as u64);
    assert_eq!(
        EgressFamily::for_derived_host_op("future.networkDial"),
        Some(EgressFamily::UnclassifiedHostOperation)
    );
    assert_eq!(EgressFamily::for_derived_host_op("db.query"), None);
    assert_eq!(
        EgressFamily::for_derived_host_op("permissions.allowsRole"),
        None
    );
    assert_eq!(EgressFamily::for_derived_host_op("authority.list"), None);
    assert_eq!(EgressFamily::for_derived_host_op("authority.myRole"), None);
}

#[cfg(not(feature = "services-owner"))]
#[tokio::test]
async fn direct_telemetry_export_route_refuses_before_export_read() {
    use axum::body::{Body, to_bytes};
    use axum::http::Request;
    use std::collections::BTreeSet;
    use std::time::Duration;
    use tower::ServiceExt as _;

    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let destination = directory.path().join("fork");
    publish(&source, &destination, "app-a", "parent-a", 42, None).unwrap();
    let database = destination.join("app.sqlite3");
    let snapback = crate::local::LocalSnapback::open(&database).unwrap();
    let (state, operator) = crate::admin::AppState::try_from_snapback_with_secret_read_operator(
        snapback,
        crate::admin::ServerContext::detached(),
    )
    .expect("fork secret read app state");
    let lease = operator
        .mint(crate::admin_secret_read::SecretReadLeaseRequest {
            scopes: BTreeSet::from([crate::admin_secret_read::SecretReadScope::TelemetryExport]),
            ttl: Duration::from_secs(60),
            row_budget: 100,
            byte_budget: 1024 * 1024,
        })
        .unwrap();
    let response = crate::server::app(state)
        .oneshot(
            Request::builder()
                .uri("/_snapback/api/telemetry/export?kind=log")
                .header(
                    crate::admin_secret_read::SECRET_READ_LEASE_HEADER,
                    lease.bearer(),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::FORBIDDEN);
    let body = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["diagnostic"]["code"], "SNAPBACK_FORK_EGRESS_DENIED");
}

#[cfg(not(feature = "services-owner"))]
#[tokio::test]
async fn push_receipt_maintenance_refuses_on_a_ledger_bearing_fork_before_provider_io() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let destination = directory.path().join("fork");
    publish(&source, &destination, "app-a", "parent-a", 42, None).unwrap();
    let database = destination.join("app.sqlite3");
    let mut snapback = crate::local::LocalSnapback::open(&database).unwrap();
    // A declared ledger is what arms receipt polling at all; the fork
    // gate must still refuse before any provider I/O happens.
    let declaration = crate::push::PushSeamDeclarationV1 {
        app_scope: crate::push::PushAppScopeV1 {
            eas_project_id: "eas-fork".into(),
            application_id: "com.example.fork".into(),
            environment: "test".into(),
        },
        registry: crate::push::PushRegistryDeclarationV1 {
            idle_retention_ms: 86_400_000,
        },
        audiences: std::collections::BTreeMap::from([(
            "everyone".to_owned(),
            crate::push::PushAudienceDeclarationV1 {
                resolve: crate::push::PushAudienceResolverV1::ExplicitPrincipals {
                    principals_arg: "principals".into(),
                    max_items: 10,
                },
                authorize: crate::push::PushAudienceAuthorizeV1::System,
            },
        )]),
        uses: Vec::new(),
        ledger: Some(crate::push::PushLedgerDeclarationV1 {
            retention_ms: 2_592_000_000,
        }),
    };
    snapback_engine::test_support::auth_database_mut(&mut snapback)
        .activate_current_auth_catalog()
        .unwrap();
    snapback_engine::test_support::auth_database_mut(&mut snapback)
        .activate_push_registry_for_test(declaration)
        .unwrap();
    let (state, _operator) = crate::admin::AppState::try_from_snapback_with_secret_read_operator(
        snapback,
        crate::admin::ServerContext::detached(),
    )
    .expect("fork push app state");
    let error = crate::server::drive_push_maintenance_once(
        &state.snapback,
        crate::contract_types::ServerProfile::Test,
        43,
    )
    .await
    .unwrap_err();
    assert_eq!(error.diagnostic.code, "SNAPBACK_FORK_EGRESS_DENIED");
    assert_eq!(error.diagnostic.details["family"], "push_receipt");
    drop(state);
    let conn = Connection::open(&database).unwrap();
    let marker: (String, u64) = conn
        .query_row(
            "SELECT family, attempts FROM _snapback_fork_egress_attempts_v1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(marker, ("push_receipt".to_owned(), 1));
}

#[cfg(feature = "services-owner")]
#[test]
fn boot_refuses_staging_and_incomplete_local_evidence() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    File::create(directory.path().join(STAGING_SENTINEL)).unwrap();
    assert_eq!(
        inspect_boot(&source).unwrap_err().diagnostic.code,
        "SNAPBACK_FORK_PUBLICATION_PARTIAL"
    );
    fs::remove_file(directory.path().join(STAGING_SENTINEL)).unwrap();
    let conn = Connection::open(&source).unwrap();
    conn.execute(
        "INSERT INTO _snapback_meta(key,value) VALUES(?1,?2)",
        params![
            LINEAGE_META_KEY,
            serde_json::to_string(&DerivedForkLineageV1 {
                format_version: 1,
                fork_id: Uuid::now_v7().to_string(),
                parent_instance_id: "parent-a".to_owned(),
                app_id: "app-a".to_owned(),
                created_at_ms: 1,
                fork_point_version: 0,
                expires_at_ms: None,
                promotable: false,
            })
            .unwrap()
        ],
    )
    .unwrap();
    assert_eq!(
        inspect_boot(&source).unwrap_err().diagnostic.code,
        "SNAPBACK_FORK_EVIDENCE_INCOMPLETE"
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn boot_refuses_each_missing_minted_sidecar() {
    for sidecar in ["admin", "auth", "resume", "operation-detail"] {
        let directory = tempfile::tempdir().unwrap();
        let source = source_database(directory.path());
        let destination = directory.path().join("fork");
        publish(&source, &destination, "app-a", "parent-a", 42, None).unwrap();
        let database = destination.join("app.sqlite3");
        let path = match sidecar {
            "admin" => snapback_auth::auth::admin_token::admin_token_sibling(&database),
            "auth" => crate::auth::keyring::AuthKeyringStore::keyring_path(&database),
            "resume" => destination.join(crate::rqs_contract::RESUME_KEYRING_FILE_NAME),
            "operation-detail" => crate::operation_detail::keyring_path(&database),
            _ => unreachable!(),
        };
        fs::remove_file(path).unwrap();
        assert_eq!(
            inspect_boot(&database).unwrap_err().diagnostic.code,
            "SNAPBACK_FORK_SIDECAR_MISSING",
            "{sidecar}"
        );
    }
}

#[cfg(feature = "services-owner")]
#[test]
fn boot_refuses_at_injected_finite_expiry_but_lifecycle_evidence_remains_readable() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let root = directory.path().join("forks");
    fs::create_dir(&root).unwrap();
    let destination = root.join("fork-a");
    let receipt = publish_managed(
        &source,
        &destination,
        &managed_expected(&root),
        "parent-a",
        100,
        200,
        false,
    )
    .unwrap();

    assert!(
        inspect_boot_at(&destination.join("app.sqlite3"), 199)
            .unwrap()
            .is_some()
    );
    let error = inspect_boot_at(&destination.join("app.sqlite3"), 200).unwrap_err();
    assert_eq!(error.diagnostic.code, SERVER_EXPIRED_CODE);
    assert_eq!(error.diagnostic.details["forkId"], receipt.lineage.fork_id);
    assert_eq!(
        managed_target(&root, &receipt.lineage.fork_id, &managed_expected(&root))
            .unwrap()
            .entry
            .lineage,
        receipt.lineage
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn malformed_sidecar_and_resource_limit_placeholder_have_stable_codes() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let destination = directory.path().join("fork");
    publish(&source, &destination, "app-a", "parent-a", 42, None).unwrap();
    let database = destination.join("app.sqlite3");
    fs::write(
        snapback_auth::auth::admin_token::admin_token_sibling(&database),
        b"not-a-token",
    )
    .unwrap();
    assert_eq!(
        inspect_boot_at(&database, 42).unwrap_err().diagnostic.code,
        "SNAPBACK_FORK_SIDECAR_MALFORMED"
    );
    assert_eq!(
        resource_limit_refusal("fork-count", "fork-count limit reached")
            .diagnostic
            .code,
        RESOURCE_LIMIT_REFUSED_CODE
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn managed_lifecycle_copies_only_explicit_secrets_diffs_and_reaps_by_clock() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    crate::secure_file::write_owner_only(
        &crate::local::config_path_for_database(&source),
        br#"{"formatVersion":1,"entries":{}}"#,
    )
    .unwrap();
    let root = directory.path().join("forks");
    fs::create_dir(&root).unwrap();
    assert_eq!(
        publish_managed(
            &source,
            &root.join("fork-invalid"),
            &managed_expected(&root),
            "parent-a",
            90,
            90,
            false,
        )
        .unwrap_err()
        .diagnostic
        .code,
        "SNAPBACK_FORK_TTL_INVALID"
    );
    let scrubbed_destination = root.join("fork-scrubbed");
    let scrubbed = publish_managed(
        &source,
        &scrubbed_destination,
        &managed_expected(&root),
        "parent-a",
        90,
        190,
        false,
    )
    .unwrap();
    assert_eq!(
        scrubbed.custody["sidecar:*.config.json"],
        CustodyDisposition::Scrub
    );
    assert!(
        !crate::local::config_path_for_database(&scrubbed_destination.join("app.sqlite3")).exists()
    );
    drop_managed(&root, &scrubbed.lineage.fork_id, &managed_expected(&root)).unwrap();

    let destination = root.join("fork-a");
    let receipt = publish_managed(
        &source,
        &destination,
        &managed_expected(&root),
        "parent-a",
        100,
        200,
        true,
    )
    .unwrap();
    assert_eq!(receipt.lineage.fork_point_version, 0);
    assert_eq!(receipt.lineage.expires_at_ms, Some(200));
    assert_eq!(
        receipt.custody["sidecar:*.config.json"],
        CustodyDisposition::Copy
    );
    let database = destination.join("app.sqlite3");
    assert_eq!(
        fs::read(crate::local::config_path_for_database(&database)).unwrap(),
        br#"{"formatVersion":1,"entries":{}}"#
    );
    let ready = destination.join("fork.ready.json");
    fs::write(&ready, b"{}").unwrap();
    let outside_ready = directory.path().join("outside.ready.json");
    assert_eq!(
        record_managed_runtime(
            &root,
            &receipt.lineage.fork_id,
            &outside_ready,
            &managed_expected(&root),
        )
        .unwrap_err()
        .diagnostic
        .code,
        "SNAPBACK_FORK_READY_INVALID"
    );
    record_managed_runtime(
        &root,
        &receipt.lineage.fork_id,
        &ready,
        &managed_expected(&root),
    )
    .unwrap();
    assert_eq!(
        list_managed(&root, &managed_expected(&root)).unwrap().len(),
        1
    );
    assert!(
        expired_managed(&root, &managed_expected(&root), 199)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        expired_managed(&root, &managed_expected(&root), 200)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        managed_entry(&root, "../../escape", &managed_expected(&root))
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_FORK_ID_INVALID"
    );

    let conn = Connection::open(&database).unwrap();
    conn.execute("UPDATE _snapback_version SET version=1 WHERE id=1", [])
        .unwrap();
    conn.execute(
        "INSERT INTO _snapback_changes(version,table_name,row_id,op,row_json,changed_at_ms)
         VALUES(1,'todos','todo-a','insert','{\"_id\":\"todo-a\"}',150)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO _snapback_changes(version,table_name,row_id,op,row_json,changed_at_ms)
         VALUES(1,'_snapback_internal','hidden','insert','{}',150)",
        [],
    )
    .unwrap();
    drop(conn);
    let diff = diff_receipt(&database).unwrap();
    assert_eq!(diff.rows.len(), 1);
    assert_eq!(diff.table_counts["todos"], 1);
    assert!(diff.omissions.iter().any(|item| item.contains("auth")));

    drop_managed(&root, &receipt.lineage.fork_id, &managed_expected(&root)).unwrap();
    assert!(
        list_managed(&root, &managed_expected(&root))
            .unwrap()
            .is_empty()
    );
    assert!(!destination.exists());
}

#[cfg(feature = "services-owner")]
#[test]
fn managed_registry_cannot_redirect_reads_or_deletion_without_local_evidence() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let root = directory.path().join("forks");
    fs::create_dir(&root).unwrap();
    let destination = root.join("fork-a");
    let receipt = publish_managed(
        &source,
        &destination,
        &managed_expected(&root),
        "parent-a",
        100,
        200,
        false,
    )
    .unwrap();
    let registry = registry_path(&root, &receipt.lineage.fork_id);
    let original: ForkRegistryEntryV1 =
        serde_json::from_slice(&fs::read(&registry).unwrap()).unwrap();

    let mut traversal = original.clone();
    traversal.database_file = "../outside.sqlite3".to_owned();
    write_json_sync(&registry, &traversal).unwrap();
    assert_eq!(
        managed_target(&root, &receipt.lineage.fork_id, &managed_expected(&root))
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_FORK_REGISTRY_INVALID"
    );

    let victim = root.join("victim");
    fs::create_dir(&victim).unwrap();
    fs::write(victim.join("keep"), b"do not delete").unwrap();
    let mut redirected = original.clone();
    redirected.destination = "victim".to_owned();
    redirected.database_file = "keep".to_owned();
    write_json_sync(&registry, &redirected).unwrap();
    assert_eq!(
        drop_managed(&root, &receipt.lineage.fork_id, &managed_expected(&root))
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_FORK_EVIDENCE_MISMATCH"
    );
    assert!(victim.join("keep").is_file());
    assert!(destination.is_dir());

    let mut wrong_lineage = original;
    wrong_lineage.lineage.fork_id = Uuid::now_v7().to_string();
    write_json_sync(&registry, &wrong_lineage).unwrap();
    assert_eq!(
        managed_target(&root, &receipt.lineage.fork_id, &managed_expected(&root))
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_FORK_REGISTRY_INVALID"
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn managed_registry_ready_file_must_remain_an_exact_direct_child() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let root = directory.path().join("forks");
    fs::create_dir(&root).unwrap();
    let destination = root.join("fork-a");
    let receipt = publish_managed(
        &source,
        &destination,
        &managed_expected(&root),
        "parent-a",
        100,
        200,
        false,
    )
    .unwrap();
    let registry = registry_path(&root, &receipt.lineage.fork_id);
    let mut entry: ForkRegistryEntryV1 =
        serde_json::from_slice(&fs::read(&registry).unwrap()).unwrap();
    entry.ready_file = Some(
        directory
            .path()
            .join("outside.ready.json")
            .display()
            .to_string(),
    );
    write_json_sync(&registry, &entry).unwrap();
    assert_eq!(
        managed_target(&root, &receipt.lineage.fork_id, &managed_expected(&root))
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_FORK_READY_INVALID"
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn missing_registered_destination_is_reported_as_stale_registry_state() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let root = directory.path().join("forks");
    fs::create_dir(&root).unwrap();
    let destination = root.join("fork-a");
    let receipt = publish_managed(
        &source,
        &destination,
        &managed_expected(&root),
        "parent-a",
        100,
        200,
        false,
    )
    .unwrap();
    fs::remove_dir_all(&destination).unwrap();
    assert_eq!(
        managed_target(&root, &receipt.lineage.fork_id, &managed_expected(&root))
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_FORK_REGISTRY_STALE"
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn copied_history_drops_parent_operation_identity_when_ledgers_are_scrubbed() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let conn = Connection::open(&source).unwrap();
    conn.execute(
        "INSERT INTO _snapback_history_policies_v1(table_name,retain_ms,max_rows)
         VALUES('todos',1000,10)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO _snapback_record_history_v1(
           version,table_name,row_id,op,row_json,changed_at_ms,operation_id
         ) VALUES(0,'todos','todo-a','insert','{}',1,'parent-operation')",
        [],
    )
    .unwrap();
    drop(conn);

    let destination = directory.path().join("fork");
    publish(&source, &destination, "app-a", "parent-a", 42, None).unwrap();
    let child = Connection::open(destination.join("app.sqlite3")).unwrap();
    let operation_id: Option<String> = child
        .query_row(
            "SELECT operation_id FROM _snapback_record_history_v1 WHERE row_id='todo-a'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(operation_id, None);
    assert_eq!(
        child
            .query_row(
                "SELECT COUNT(*) FROM _snapback_commit_envelopes_v1",
                [],
                |row| { row.get::<_, u64>(0) }
            )
            .unwrap(),
        0
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn diff_is_one_snapshot_and_refuses_a_retention_gap() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let destination = directory.path().join("fork");
    publish(&source, &destination, "app-a", "parent-a", 42, None).unwrap();
    let database = destination.join("app.sqlite3");

    let concurrent_database = database.clone();
    install_diff_after_header_hook(move || {
        let writer = Connection::open(concurrent_database).unwrap();
        writer
            .execute("UPDATE _snapback_version SET version=1 WHERE id=1", [])
            .unwrap();
        writer
            .execute(
                "INSERT INTO _snapback_changes(
                   version,table_name,row_id,op,row_json,changed_at_ms
                 ) VALUES(1,'todos','todo-a','insert','{}',43)",
                [],
            )
            .unwrap();
    });
    let pinned = diff_receipt(&database).unwrap();
    assert_eq!(pinned.observed_head_version, 0);
    assert!(pinned.rows.is_empty());

    let conn = Connection::open(&database).unwrap();
    conn.execute(
        "INSERT INTO _snapback_meta(key,value) VALUES('retention_floor','1')
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [],
    )
    .unwrap();
    drop(conn);
    assert_eq!(
        diff_receipt(&database).unwrap_err().diagnostic.code,
        "SNAPBACK_FORK_DIFF_RETENTION_GAP"
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn concurrent_drops_of_one_fork_settle_idempotently() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let root = directory.path().join("forks");
    fs::create_dir(&root).unwrap();
    // Several rounds to vary the interleaving; each round races four
    // cleanup actors on the same fork.
    for round in 0..4 {
        let destination = root.join(format!("fork-{round}"));
        let receipt = publish_managed(
            &source,
            &destination,
            &managed_expected(&root),
            "parent-a",
            100,
            200_000,
            false,
        )
        .unwrap();
        let outcomes = std::thread::scope(|scope| {
            let expected = managed_expected(&root);
            let handles = (0..4)
                .map(|_| {
                    let root = root.clone();
                    let fork_id = receipt.lineage.fork_id.clone();
                    let expected = expected.clone();
                    scope.spawn(move || drop_managed(&root, &fork_id, &expected))
                })
                .collect::<Vec<_>>();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect::<Vec<_>>()
        });
        let mut wins = 0;
        for outcome in outcomes {
            match outcome {
                Ok(_) => wins += 1,
                Err(error) => assert_eq!(
                    error.diagnostic.code, "SNAPBACK_FORK_NOT_FOUND",
                    "a losing cleanup actor observes complete absence, never a torn teardown"
                ),
            }
        }
        assert_eq!(
            wins, 1,
            "round {round}: exactly one actor performs the teardown"
        );
        assert!(
            !destination.exists(),
            "round {round}: fork directory is gone"
        );
        assert!(
            !registry_path(&root, &receipt.lineage.fork_id).exists(),
            "round {round}: registry entry is gone"
        );
    }
}

#[cfg(feature = "services-owner")]
#[test]
fn stale_registry_entries_clear_only_after_their_directory_is_gone() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let root = directory.path().join("forks");
    fs::create_dir(&root).unwrap();
    let destination = root.join("fork-a");
    let receipt = publish_managed(
        &source,
        &destination,
        &managed_expected(&root),
        "parent-a",
        100,
        200_000,
        false,
    )
    .unwrap();

    // While the fork directory exists the entry is not stale; clearing
    // must refuse rather than orphan a live fork's bookkeeping.
    assert_eq!(
        clear_stale_registry_entry(&root, &receipt.lineage.fork_id, &managed_expected(&root),)
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_FORK_EVIDENCE_MISMATCH"
    );

    fs::remove_dir_all(&destination).unwrap();
    assert_eq!(
        managed_registry_ids(&root).unwrap(),
        vec![receipt.lineage.fork_id.clone()],
        "id enumeration keeps working over a stale entry"
    );
    clear_stale_registry_entry(&root, &receipt.lineage.fork_id, &managed_expected(&root)).unwrap();
    assert!(managed_registry_ids(&root).unwrap().is_empty());
    assert_eq!(
        clear_stale_registry_entry(&root, &receipt.lineage.fork_id, &managed_expected(&root),)
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_FORK_NOT_FOUND"
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn renewal_moves_every_expiry_carrier_and_never_shortens_clears_or_resurrects() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let root = directory.path().join("forks");
    fs::create_dir(&root).unwrap();
    let destination = root.join("fork-a");
    let receipt = publish_managed(
        &source,
        &destination,
        &managed_expected(&root),
        "parent-a",
        100,
        200_000,
        false,
    )
    .unwrap();
    let fork_id = receipt.lineage.fork_id.clone();
    let database = destination.join("app.sqlite3");

    // Boot refuses at the original expiry before renewal.
    assert_eq!(
        inspect_boot_at(&database, 250_000)
            .unwrap_err()
            .diagnostic
            .code,
        SERVER_EXPIRED_CODE
    );

    let renewed = renew_managed(&root, &fork_id, &managed_expected(&root), 150, 299_850).unwrap();
    assert_eq!(renewed.schema_version, "snapback.fork-renew.v1");
    assert_eq!(renewed.previous_expires_at_ms, 200_000);
    assert_eq!(renewed.expires_at_ms, 300_000);
    assert_eq!(renewed.created_at_ms, 100);
    assert_eq!(renewed.max_lifetime_ms, MANAGED_FORK_MAX_LIFETIME_MS);

    // Every carrier agrees and the moved expiry is real boot authority.
    let target = managed_target(&root, &fork_id, &managed_expected(&root)).unwrap();
    assert_eq!(target.entry.lineage.expires_at_ms, Some(300_000));
    assert_eq!(target.receipt.lineage.expires_at_ms, Some(300_000));
    assert!(inspect_boot_at(&database, 250_000).unwrap().is_some());
    assert!(
        expired_managed(&root, &managed_expected(&root), 200_000)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        expired_managed(&root, &managed_expected(&root), 300_000)
            .unwrap()
            .len(),
        1
    );
    let durable: ForkRenewReceiptV1 =
        serde_json::from_slice(&fs::read(destination.join(RENEW_RECEIPT_FILE)).unwrap()).unwrap();
    assert_eq!(durable, renewed);

    // Shortening or holding the expiry is refused outright.
    assert_eq!(
        renew_managed(&root, &fork_id, &managed_expected(&root), 200, 100_000)
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_FORK_TTL_INVALID"
    );
    // The configured maximum binds creation through every renewal.
    let over_limit = renew_managed(
        &root,
        &fork_id,
        &managed_expected(&root),
        200,
        MANAGED_FORK_MAX_LIFETIME_MS,
    )
    .unwrap_err();
    assert_eq!(over_limit.diagnostic.code, RESOURCE_LIMIT_REFUSED_CODE);
    assert_eq!(
        over_limit.diagnostic.details["resource"],
        "renewal-lifetime"
    );
    assert_eq!(
        over_limit.diagnostic.details["maxLifetimeMs"],
        MANAGED_FORK_MAX_LIFETIME_MS
    );
    // Overflow and unknown identity stay in the named vocabulary.
    assert_eq!(
        renew_managed(&root, &fork_id, &managed_expected(&root), 200, u64::MAX)
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_FORK_TTL_INVALID"
    );
    assert_eq!(
        renew_managed(
            &root,
            &Uuid::now_v7().to_string(),
            &managed_expected(&root),
            200,
            1_000,
        )
        .unwrap_err()
        .diagnostic
        .code,
        "SNAPBACK_FORK_NOT_FOUND"
    );
    // An already-expired fork is never resurrected.
    assert_eq!(
        renew_managed(&root, &fork_id, &managed_expected(&root), 300_000, 1_000)
            .unwrap_err()
            .diagnostic
            .code,
        RENEW_EXPIRED_CODE
    );
    // After every refusal the carriers still hold the last good expiry.
    assert_eq!(
        managed_target(&root, &fork_id, &managed_expected(&root))
            .unwrap()
            .entry
            .lineage
            .expires_at_ms,
        Some(300_000)
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn renewal_crash_matrix_recovers_to_one_consistent_expiry() {
    let cuts = [
        (RenewCut::AfterSentinelWrite, 200_000),
        (RenewCut::AfterIntentWrite, 300_000),
        (RenewCut::AfterDatabaseUpdate, 300_000),
        (RenewCut::AfterReceiptRewrite, 300_000),
        (RenewCut::AfterRegistryRewrite, 300_000),
        (RenewCut::AfterRenewReceipt, 300_000),
        (RenewCut::AfterIntentRemoval, 300_000),
    ];
    for (cut, expected_expiry) in cuts {
        let directory = tempfile::tempdir().unwrap();
        let source = source_database(directory.path());
        let root = directory.path().join("forks");
        fs::create_dir(&root).unwrap();
        let destination = root.join("fork-a");
        let receipt = publish_managed(
            &source,
            &destination,
            &managed_expected(&root),
            "parent-a",
            100,
            200_000,
            false,
        )
        .unwrap();
        let fork_id = receipt.lineage.fork_id.clone();
        let database = destination.join("app.sqlite3");

        let error = renew_managed_with_cut(
            &root,
            &fork_id,
            &managed_expected(&root),
            150,
            299_850,
            Some(cut),
        )
        .unwrap_err();
        assert_eq!(
            error.diagnostic.code, "SNAPBACK_FORK_TEST_CRASH_CUT",
            "{cut:?}"
        );
        // The torn window fails closed for serving.
        assert_eq!(
            inspect_boot_at(&database, 151).unwrap_err().diagnostic.code,
            "SNAPBACK_FORK_PUBLICATION_PARTIAL",
            "{cut:?}"
        );

        recover(&root, &destination).unwrap();
        assert!(
            !destination.join(STAGING_SENTINEL).exists()
                && !destination.join(RENEW_INTENT_FILE).exists(),
            "{cut:?}: recovery leaves no renewal residue"
        );
        let target = managed_target(&root, &fork_id, &managed_expected(&root)).unwrap();
        assert_eq!(
            target.entry.lineage.expires_at_ms,
            Some(expected_expiry),
            "{cut:?}: every carrier recovers to one deterministic expiry"
        );
        assert_eq!(target.receipt.lineage.expires_at_ms, Some(expected_expiry));
        assert!(
            inspect_boot_at(&database, 151).unwrap().is_some(),
            "{cut:?}"
        );
        let receipt_exists = destination.join(RENEW_RECEIPT_FILE).exists();
        assert_eq!(
            receipt_exists,
            expected_expiry == 300_000,
            "{cut:?}: a completed renewal has its receipt, an undone one does not"
        );
    }
}

#[cfg(feature = "services-owner")]
#[test]
fn creation_limits_refuse_deterministically_with_observed_usage() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let root = directory.path().join("forks");
    fs::create_dir(&root).unwrap();
    publish_managed(
        &source,
        &root.join("fork-a"),
        &managed_expected(&root),
        "parent-a",
        100,
        200_000,
        false,
    )
    .unwrap();

    let generous = ForkResourceLimits::default();
    let usage = enforce_creation_limits(&root, &source, &generous, false).unwrap();
    assert_eq!(usage.fork_count, 1);
    assert!(usage.existing_bytes > 0);
    assert!(usage.estimated_fork_bytes > 0);

    // Excessive fork count.
    let error = enforce_creation_limits(
        &root,
        &source,
        &ForkResourceLimits {
            max_forks: 1,
            ..generous
        },
        false,
    )
    .unwrap_err();
    assert_eq!(error.diagnostic.code, RESOURCE_LIMIT_REFUSED_CODE);
    assert_eq!(error.diagnostic.details["resource"], "fork-count");
    assert_eq!(error.diagnostic.details["currentForkCount"], 1);

    // Oversized parent.
    let error = enforce_creation_limits(
        &root,
        &source,
        &ForkResourceLimits {
            max_fork_bytes: 1,
            ..generous
        },
        false,
    )
    .unwrap_err();
    assert_eq!(error.diagnostic.code, RESOURCE_LIMIT_REFUSED_CODE);
    assert_eq!(error.diagnostic.details["resource"], "fork-bytes");
    assert!(error.diagnostic.details["estimatedBytes"].as_u64().unwrap() > 1);

    // Total-byte budget exhaustion counts what is already on disk.
    let error = enforce_creation_limits(
        &root,
        &source,
        &ForkResourceLimits {
            max_total_bytes: usage.existing_bytes,
            ..generous
        },
        false,
    )
    .unwrap_err();
    assert_eq!(error.diagnostic.code, RESOURCE_LIMIT_REFUSED_CODE);
    assert_eq!(error.diagnostic.details["resource"], "total-bytes");
    assert_eq!(
        error.diagnostic.details["existingBytes"],
        usage.existing_bytes
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn same_app_id_distinct_app_roots_cannot_select_or_mutate_each_others_forks() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let fork_root = directory.path().join("shared-forks");
    let app_a_root = directory.path().join("worktree-a");
    let app_b_root = directory.path().join("worktree-b");
    fs::create_dir(&fork_root).unwrap();
    fs::create_dir(&app_a_root).unwrap();
    fs::create_dir(&app_b_root).unwrap();
    let app_a = ensure_expected_app(&app_a_root, "same-app").unwrap();
    let app_b = ensure_expected_app(&app_b_root, "same-app").unwrap();
    let destination_a = fork_root.join("fork-a");
    let destination_b = fork_root.join("fork-b");
    let fork_a = publish_managed_with_base(
        &source,
        &destination_a,
        &app_a,
        "parent-a",
        100,
        200_000,
        false,
        true,
    )
    .unwrap();
    let fork_b = publish_managed_with_base(
        &source,
        &destination_b,
        &app_b,
        "parent-b",
        100,
        200_000,
        false,
        true,
    )
    .unwrap();

    for (fork_id, wrong) in [
        (&fork_a.lineage.fork_id, &app_b),
        (&fork_b.lineage.fork_id, &app_a),
    ] {
        assert_eq!(
            managed_target(&fork_root, fork_id, wrong)
                .unwrap_err()
                .diagnostic
                .code,
            APP_BINDING_MISMATCH_CODE
        );
        assert_eq!(
            renew_managed(&fork_root, fork_id, wrong, 150, 1_000)
                .unwrap_err()
                .diagnostic
                .code,
            APP_BINDING_MISMATCH_CODE
        );
        assert_eq!(
            drop_managed(&fork_root, fork_id, wrong)
                .unwrap_err()
                .diagnostic
                .code,
            APP_BINDING_MISMATCH_CODE
        );
    }
    assert_eq!(
        recover_bound(&fork_root, &destination_a, &app_b)
            .unwrap_err()
            .diagnostic
            .code,
        APP_BINDING_MISMATCH_CODE
    );
    assert!(destination_a.is_dir() && destination_b.is_dir());

    let registry = registry_path(&fork_root, &fork_a.lineage.fork_id);
    let mut legacy: ForkRegistryEntryV1 =
        serde_json::from_slice(&fs::read(&registry).unwrap()).unwrap();
    legacy.app_root = None;
    write_json_sync(&registry, &legacy).unwrap();
    assert_eq!(
        managed_target(&fork_root, &fork_a.lineage.fork_id, &app_a)
            .unwrap_err()
            .diagnostic
            .code,
        APP_BINDING_REQUIRED_CODE,
        "legacy registry entries never inherit selection authority"
    );
}

fn race_two_creation_admissions(
    root: &Path,
    source: &Path,
    expected: &ExpectedForkAppV1,
    limits: ForkResourceLimits,
) -> Vec<Result<(), SnapbackError>> {
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    std::thread::scope(|scope| {
        let handles = (0..2)
            .map(|index| {
                let root = root.to_path_buf();
                let source = source.to_path_buf();
                let expected = expected.clone();
                let barrier = barrier.clone();
                scope.spawn(move || {
                    barrier.wait();
                    let admission = admit_creation(&root, &source, &limits, false)?;
                    publish_managed_with_base(
                        &source,
                        &root.join(format!("fork-{index}")),
                        &expected,
                        "parent",
                        100,
                        200_000,
                        false,
                        false,
                    )?;
                    drop(admission);
                    Ok(())
                })
            })
            .collect::<Vec<_>>();
        handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect()
    })
}

#[cfg(unix)]
#[cfg(feature = "services-owner")]
#[test]
fn root_wide_admission_deadline_is_stable_and_releases_cleanly() {
    use std::os::fd::AsRawFd as _;

    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let root = directory.path().join("forks");
    let registry = root.join(REGISTRY_DIRECTORY);
    fs::create_dir_all(&registry).unwrap();
    let holder = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(registry.join("root.admission-lock"))
        .unwrap();
    assert_eq!(
        unsafe { libc::flock(holder.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
        0
    );

    let refusal = match admit_creation_with_timeout(
        &root,
        &source,
        &ForkResourceLimits::default(),
        false,
        Duration::ZERO,
    ) {
        Ok(_) => panic!("a held admission lock must refuse at the test deadline"),
        Err(error) => error,
    };
    assert_eq!(refusal.diagnostic.code, ADMISSION_TIMEOUT_CODE);
    assert_eq!(refusal.diagnostic.details["timeoutMs"], 0);

    drop(holder);
    admit_creation_with_timeout(
        &root,
        &source,
        &ForkResourceLimits::default(),
        false,
        Duration::ZERO,
    )
    .expect("an uncontended first attempt succeeds even at a zero test deadline");
}

#[cfg(feature = "services-owner")]
#[test]
fn root_wide_admission_is_atomic_at_count_and_total_byte_boundaries() {
    for boundary in ["fork-count", "total-bytes"] {
        let directory = tempfile::tempdir().unwrap();
        let source = source_database(directory.path());
        let root = directory.path().join("forks");
        let app_root = directory.path().join("app");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&app_root).unwrap();
        let expected = ensure_expected_app(&app_root, "app-a").unwrap();
        let initial =
            enforce_creation_limits(&root, &source, &ForkResourceLimits::default(), false).unwrap();
        let limits = if boundary == "fork-count" {
            ForkResourceLimits {
                max_forks: 1,
                ..ForkResourceLimits::default()
            }
        } else {
            ForkResourceLimits {
                max_forks: 2,
                max_total_bytes: initial
                    .existing_bytes
                    .saturating_add(initial.estimated_fork_bytes),
                ..ForkResourceLimits::default()
            }
        };
        let outcomes = race_two_creation_admissions(&root, &source, &expected, limits);
        assert_eq!(outcomes.iter().filter(|outcome| outcome.is_ok()).count(), 1);
        let refusal = outcomes
            .iter()
            .find_map(|outcome| outcome.as_ref().err())
            .expect("one racing create is refused");
        assert_eq!(refusal.diagnostic.code, RESOURCE_LIMIT_REFUSED_CODE);
        assert_eq!(refusal.diagnostic.details["resource"], boundary);
        assert_eq!(managed_registry_ids(&root).unwrap().len(), 1);
    }
}

#[cfg(feature = "services-owner")]
#[test]
fn create_shares_the_maximum_fork_lifetime_with_renewal() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let over = publish_managed(
        &source,
        &directory.path().join("fork-over"),
        &managed_expected(directory.path()),
        "parent-a",
        100,
        100 + MANAGED_FORK_MAX_LIFETIME_MS + 1,
        false,
    )
    .unwrap_err();
    assert_eq!(over.diagnostic.code, RESOURCE_LIMIT_REFUSED_CODE);
    assert_eq!(over.diagnostic.details["resource"], "fork-lifetime");
    assert!(
        !directory.path().join("fork-over").exists(),
        "a lifetime refusal leaves no staging residue"
    );
    // Exactly at the bound is admitted.
    publish_managed(
        &source,
        &directory.path().join("fork-at-bound"),
        &managed_expected(directory.path()),
        "parent-a",
        100,
        100 + MANAGED_FORK_MAX_LIFETIME_MS,
        false,
    )
    .unwrap();
}

#[cfg(feature = "services-owner")]
#[test]
fn diff_work_limit_refuses_retained_history_exhaustion() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let destination = directory.path().join("fork");
    publish(&source, &destination, "app-a", "parent-a", 42, None).unwrap();
    let database = destination.join("app.sqlite3");
    let conn = Connection::open(&database).unwrap();
    conn.execute("UPDATE _snapback_version SET version=6 WHERE id=1", [])
        .unwrap();
    for index in 1..=6 {
        conn.execute(
            "INSERT INTO _snapback_changes(version,table_name,row_id,op,row_json,changed_at_ms)
             VALUES(?1,'todos',?2,'insert','{}',100)",
            params![index, format!("todo-{index}")],
        )
        .unwrap();
    }
    drop(conn);

    let error = diff_receipt_bounded(&database, 5).unwrap_err();
    assert_eq!(error.diagnostic.code, RESOURCE_LIMIT_REFUSED_CODE);
    assert_eq!(error.diagnostic.details["resource"], "diff-work");
    assert_eq!(error.diagnostic.details["journalRows"], 6);
    assert_eq!(error.diagnostic.details["limitRows"], 5);

    let receipt = diff_receipt_bounded(&database, 6).unwrap();
    assert_eq!(receipt.rows.len(), 6, "at the bound the receipt is exact");
    assert_eq!(receipt.schema_version, "snapback.fork-journal-diff.v3");
    assert_eq!(receipt.attribution, "absent-v1");
    assert_eq!(receipt.base.version_boundary, "exclusive");
    assert_eq!(receipt.head.version_boundary, "inclusive");
    assert_eq!(
        receipt.base.data_version_stream,
        receipt.head.data_version_stream
    );
    assert_eq!(
        receipt.receipt_digest,
        journal_diff_receipt_digest(&receipt).unwrap()
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn diff_receipt_v3_digests_are_domain_separated_canonical_and_bind_every_fact() {
    let boundary = |version, version_boundary: &str| ForkDiffCommitBoundaryV1 {
        data_version_stream: "data-stream-fixed".to_owned(),
        commit_version: version,
        version_boundary: version_boundary.to_owned(),
    };
    let mut journal = ForkDiffReceiptV3 {
        schema_version: "snapback.fork-journal-diff.v3".to_owned(),
        fork_id: "01900000-0000-7000-8000-000000000001".to_owned(),
        app_id: "app-a".to_owned(),
        parent_instance_id: "parent-a".to_owned(),
        fork_point_version: 7,
        observed_head_version: 9,
        base: boundary(7, "exclusive"),
        head: boundary(9, "inclusive"),
        attribution: "absent-v1".to_owned(),
        rows: vec![ForkDiffRowV1 {
            version: 9,
            table: "items".to_owned(),
            row_id: "item-1".to_owned(),
            operation: "insert".to_owned(),
            post_image: Some(json!({"_id":"item-1","title":"fixed"})),
        }],
        table_counts: BTreeMap::from([("items".to_owned(), 1)]),
        coverage: vec!["committed app-row journal entries in (base, head]".to_owned()],
        omissions: vec!["auth and credential state".to_owned()],
        receipt_digest: String::new(),
    };
    journal.receipt_digest = journal_diff_receipt_digest(&journal).unwrap();
    assert_eq!(
        journal.receipt_digest,
        "sha256:788ecf814cff3327e1c667cef6fbd06534e4d4f75769fb5884a75071575936f0"
    );

    let mut net = ForkNetDiffReceiptV3 {
        schema_version: "snapback.fork-net-diff.v3".to_owned(),
        fork_id: journal.fork_id.clone(),
        app_id: journal.app_id.clone(),
        parent_instance_id: journal.parent_instance_id.clone(),
        fork_point_version: 7,
        observed_head_version: 9,
        base: boundary(7, "exclusive"),
        head: boundary(9, "inclusive"),
        substrate: "retained-base-v1".to_owned(),
        completeness: "journal-enumerated-v1".to_owned(),
        journal_consistency: "journal-cross-check-verified".to_owned(),
        writer_coverage: ForkNetDiffWriterCoverageV1 {
            coverage_window: "unverified".to_owned(),
            manifest_digest: None,
            covered_lanes: Vec::new(),
            uncovered_lanes: vec!["migration".to_owned()],
        },
        attribution: "absent-v1".to_owned(),
        rows: vec![ForkNetDiffRowV1 {
            table: "items".to_owned(),
            row_id: "item-1".to_owned(),
            operation: "insert".to_owned(),
            pre_image: None,
            post_image: Some(json!({"_id":"item-1","title":"fixed"})),
        }],
        table_counts: BTreeMap::from([("items".to_owned(), 1)]),
        domains: BTreeMap::from([("appRows".to_owned(), "net-covered".to_owned())]),
        receipt_digest: String::new(),
    };
    net.receipt_digest = net_diff_receipt_digest(&net).unwrap();
    assert_eq!(
        net.receipt_digest,
        "sha256:25134fd6816f2c6d6cfb952d6f49cef1dad9aafa436ff1f63f4b85f8c399dba6"
    );
    assert_ne!(
        journal.receipt_digest, net.receipt_digest,
        "the two receipt domains cannot collide on similar facts"
    );

    for (receipt, domain) in [
        (
            serde_json::to_value(&journal).unwrap(),
            b"snapback:fork-journal-diff-receipt:v3\n" as &'static [u8],
        ),
        (
            serde_json::to_value(&net).unwrap(),
            b"snapback:fork-net-diff-receipt:v3\n" as &'static [u8],
        ),
    ] {
        let original = fork_diff_receipt_digest(&receipt, domain).unwrap();
        for field in receipt.as_object().unwrap().keys() {
            if field == "receiptDigest" {
                continue;
            }
            let mut tampered = receipt.clone();
            let value = tampered.get_mut(field).unwrap();
            match value {
                Value::String(value) => value.push_str("-tampered"),
                Value::Number(_) => *value = json!(9_999_999),
                Value::Array(value) => value.push(Value::Null),
                Value::Object(value) => {
                    value.insert("tampered".to_owned(), Value::Bool(true));
                }
                Value::Bool(value) => *value = !*value,
                Value::Null => *value = Value::Bool(true),
            }
            assert_ne!(
                fork_diff_receipt_digest(&tampered, domain).unwrap(),
                original,
                "top-level receipt fact {field} is digest-bound"
            );
        }
    }
}

fn journal_write(conn: &Connection, version: u64, table: &str, row_id: &str, op: &str) {
    conn.execute(
        "INSERT INTO _snapback_changes(version,table_name,row_id,op,row_json,changed_at_ms)
         VALUES(?1,?2,?3,?4,'{}',100)",
        params![version, table, row_id, op],
    )
    .unwrap();
}

#[cfg(feature = "services-owner")]
#[test]
fn net_diff_oracle_covers_the_mutation_corpus_and_verifies_the_journal() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let parent = Connection::open(&source).unwrap();
    parent
        .execute_batch(
            "CREATE TABLE notes(_id TEXT PRIMARY KEY, body TEXT NOT NULL);
             CREATE TABLE tags(_id TEXT PRIMARY KEY, label TEXT NOT NULL);
             INSERT INTO notes VALUES('n-upd','before'),('n-del','doomed'),('n-revert','original'),('n-kept','stable');
             INSERT INTO tags VALUES('t-kept','stable');",
        )
        .unwrap();
    drop(parent);
    let root = directory.path().join("forks");
    fs::create_dir(&root).unwrap();
    let destination = root.join("fork-a");
    let receipt = publish_managed_with_base(
        &source,
        &destination,
        &managed_expected(&root),
        "parent-a",
        100,
        200_000,
        false,
        true,
    )
    .unwrap();
    assert!(destination.join(BASE_SNAPSHOT_FILE).is_file());
    let database = destination.join("app.sqlite3");

    // Multi-commit, multi-table fork workload including a revert and an
    // insert+delete that both net to nothing, plus a schema divergence.
    let fork = Connection::open(&database).unwrap();
    fork.execute_batch(
        "INSERT INTO notes VALUES('n-new','fork row');
         INSERT INTO notes VALUES('n-ephemeral','gone by head');
         UPDATE notes SET body='after' WHERE _id='n-upd';
         UPDATE notes SET body='changed' WHERE _id='n-revert';
         DELETE FROM notes WHERE _id='n-del';
         DELETE FROM notes WHERE _id='n-ephemeral';
         UPDATE notes SET body='original' WHERE _id='n-revert';
         INSERT INTO tags VALUES('t-new','fork tag');
         CREATE TABLE fork_only(_id TEXT PRIMARY KEY, note TEXT);
         INSERT INTO fork_only VALUES('f-1','schema divergence');
         UPDATE _snapback_version SET version=3 WHERE id=1;",
    )
    .unwrap();
    for (version, table, row_id, op) in [
        (1, "notes", "n-new", "insert"),
        (1, "notes", "n-ephemeral", "insert"),
        (2, "notes", "n-upd", "update"),
        (2, "notes", "n-revert", "update"),
        (2, "notes", "n-del", "delete"),
        (3, "notes", "n-ephemeral", "delete"),
        (3, "notes", "n-revert", "update"),
        (3, "tags", "t-new", "insert"),
        (3, "fork_only", "f-1", "insert"),
    ] {
        journal_write(&fork, version, table, row_id, op);
    }
    drop(fork);

    let net = net_diff_receipt(&database, FORK_DIFF_MAX_ROWS).unwrap();
    assert_eq!(net.schema_version, "snapback.fork-net-diff.v3");
    assert_eq!(net.substrate, "retained-base-v1");
    assert_eq!(net.completeness, "journal-enumerated-v1");
    assert_eq!(net.journal_consistency, "journal-cross-check-verified");
    assert_eq!(net.attribution, "absent-v1");
    assert_eq!(net.writer_coverage.coverage_window, "unverified");
    assert_eq!(net.writer_coverage.manifest_digest, None);
    assert!(net.writer_coverage.covered_lanes.is_empty());
    assert_eq!(
        net.writer_coverage.uncovered_lanes,
        fork_app_row_all_lanes()
    );
    assert_eq!(net.fork_point_version, receipt.lineage.fork_point_version);
    assert_eq!(net.observed_head_version, 3);
    let summary = net
        .rows
        .iter()
        .map(|row| {
            (
                row.table.as_str(),
                row.row_id.as_str(),
                row.operation.as_str(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        summary,
        vec![
            ("fork_only", "f-1", "insert"),
            ("notes", "n-del", "delete"),
            ("notes", "n-new", "insert"),
            ("notes", "n-upd", "update"),
            ("tags", "t-new", "insert"),
        ],
        "reverts and insert+delete pairs net to nothing; everything else nets exactly"
    );
    let update = net.rows.iter().find(|row| row.row_id == "n-upd").unwrap();
    assert_eq!(update.pre_image.as_ref().unwrap()["body"], "before");
    assert_eq!(update.post_image.as_ref().unwrap()["body"], "after");
    let delete = net.rows.iter().find(|row| row.row_id == "n-del").unwrap();
    assert_eq!(delete.pre_image.as_ref().unwrap()["body"], "doomed");
    assert!(delete.post_image.is_none());
    assert_eq!(net.table_counts["notes"], 3);
    assert_eq!(net.domains["appRows"], "net-covered");
    assert_eq!(net.domains["auth"], "omitted");

    // A sibling no-op fork of the same parent nets to nothing.
    let sibling = root.join("fork-b");
    publish_managed_with_base(
        &source,
        &sibling,
        &managed_expected(&root),
        "parent-a",
        100,
        200_000,
        false,
        true,
    )
    .unwrap();
    let sibling_net = net_diff_receipt(&sibling.join("app.sqlite3"), FORK_DIFF_MAX_ROWS).unwrap();
    assert!(
        sibling_net.rows.is_empty(),
        "a no-op workload nets to zero rows"
    );
    assert_eq!(
        sibling_net.journal_consistency,
        "journal-cross-check-verified"
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn net_diff_streaming_limits_refuse_unchanged_revert_heavy_and_byte_heavy_work() {
    let directory = tempfile::tempdir().unwrap();

    // Six materialized rows across base+head exceed a five-row scan limit
    // even though all three logical rows are unchanged and the net is empty.
    let unchanged_source = app_row_source_database(directory.path());
    let unchanged = directory.path().join("fork-unchanged-limit");
    publish_managed_with_base(
        &unchanged_source,
        &unchanged,
        &managed_expected_for(&unchanged),
        "parent-a",
        100,
        200_000,
        false,
        true,
    )
    .unwrap();
    let error = net_diff_receipt_with_limits(
        &unchanged.join("app.sqlite3"),
        NetDiffWorkLimitsV1 {
            max_journal_rows: 100,
            max_scanned_rows: 5,
            max_bytes: u64::MAX,
            max_output_rows: 100,
        },
    )
    .unwrap_err();
    assert_eq!(error.diagnostic.code, RESOURCE_LIMIT_REFUSED_CODE);
    assert_eq!(error.diagnostic.details["limitKind"], "scanned-rows");
    assert_eq!(error.diagnostic.details["scannedRows"], 6);
    assert!(
        !unchanged.join("fork-net-diff-receipt.json").exists(),
        "a scan refusal leaves no receipt residue"
    );

    // A long journal that returns a plain table to its exact base value
    // must be bounded while streaming, before folding can erase the work.
    let revert_parent = directory.path().join("revert-source");
    fs::create_dir(&revert_parent).unwrap();
    let revert_source = source_database(&revert_parent);
    let source_conn = Connection::open(&revert_source).unwrap();
    source_conn
        .execute_batch(
            "CREATE TABLE notes(_id TEXT PRIMARY KEY, body TEXT NOT NULL);
             INSERT INTO notes VALUES('same','base');",
        )
        .unwrap();
    drop(source_conn);
    let revert = directory.path().join("fork-revert-heavy");
    publish_managed_with_base(
        &revert_source,
        &revert,
        &managed_expected_for(&revert),
        "parent-a",
        100,
        200_000,
        false,
        true,
    )
    .unwrap();
    let conn = Connection::open(revert.join("app.sqlite3")).unwrap();
    let tx = conn.unchecked_transaction().unwrap();
    for version in 1..=6u64 {
        let body = if version == 6 {
            "base".to_owned()
        } else {
            format!("temporary-{version}")
        };
        tx.execute("UPDATE notes SET body=?1 WHERE _id='same'", [&body])
            .unwrap();
        tx.execute(
            "INSERT INTO _snapback_changes(
                 version,table_name,row_id,op,row_json,changed_at_ms
             ) VALUES(?1,'notes','same','update',?2,100)",
            params![version, json!({"_id":"same","body":body}).to_string()],
        )
        .unwrap();
    }
    tx.execute("UPDATE _snapback_version SET version=6 WHERE id=1", [])
        .unwrap();
    tx.commit().unwrap();
    drop(conn);
    let error = net_diff_receipt_with_limits(
        &revert.join("app.sqlite3"),
        NetDiffWorkLimitsV1 {
            max_journal_rows: 5,
            max_scanned_rows: 100,
            max_bytes: u64::MAX,
            max_output_rows: 100,
        },
    )
    .unwrap_err();
    assert_eq!(error.diagnostic.code, RESOURCE_LIMIT_REFUSED_CODE);
    assert_eq!(error.diagnostic.details["limitKind"], "journal-rows");
    assert_eq!(error.diagnostic.details["journalRows"], 6);

    let error = net_diff_receipt_with_limits(
        &revert.join("app.sqlite3"),
        NetDiffWorkLimitsV1 {
            max_journal_rows: 100,
            max_scanned_rows: 100,
            max_bytes: 32,
            max_output_rows: 100,
        },
    )
    .unwrap_err();
    assert_eq!(error.diagnostic.code, RESOURCE_LIMIT_REFUSED_CODE);
    assert_eq!(error.diagnostic.details["limitKind"], "bytes");
    assert_eq!(error.diagnostic.details["phase"], "journal");
    assert!(error.diagnostic.details["observedBytes"].as_u64().unwrap() > 32);
}

#[cfg(feature = "services-owner")]
#[test]
fn net_diff_scan_preflights_huge_text_blob_and_vector_before_owned_decode() {
    let limits = NetDiffWorkLimitsV1 {
        max_journal_rows: u64::MAX,
        max_scanned_rows: u64::MAX,
        max_bytes: FORK_DIFF_MAX_BYTES,
        max_output_rows: u64::MAX,
    };
    let huge = FORK_DIFF_MAX_BYTES.saturating_add(1);

    for (name, declaration, value_sql) in [
        (
            "huge_text",
            "payload TEXT NOT NULL",
            "CAST(zeroblob(?1) AS TEXT)",
        ),
        ("huge_blob", "payload BLOB NOT NULL", "zeroblob(?1)"),
    ] {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            &format!("CREATE TABLE {name}(_id TEXT PRIMARY KEY,{declaration})"),
            [],
        )
        .unwrap();
        conn.execute(
            &format!("INSERT INTO {name} VALUES('oversized',{value_sql})"),
            [huge],
        )
        .unwrap();
        let mut work = NetDiffWorkV1::default();
        let error = read_app_table_rows(&conn, name, None, &mut work, limits, "head-scan")
            .expect_err("one SQLite value larger than the byte budget must preflight-refuse");
        assert_eq!(error.diagnostic.code, RESOURCE_LIMIT_REFUSED_CODE, "{name}");
        assert_eq!(error.diagnostic.details["phase"], "head-scan", "{name}");
        assert_eq!(error.diagnostic.details["limitKind"], "bytes", "{name}");
        assert_eq!(error.diagnostic.details["scannedRows"], 1, "{name}");
        assert!(
            error.diagnostic.details["observedBytes"]
                .as_u64()
                .is_some_and(|bytes| bytes > FORK_DIFF_MAX_BYTES),
            "{name} is refused from borrowed SQLite lengths before text/hex expansion"
        );
    }

    let dimensions = 256u32;
    let vector_manifest = crate::manifest::TableManifest {
        name: "vectors".to_owned(),
        fields: vec![crate::manifest::FieldManifest {
            name: "embedding".to_owned(),
            field_type: crate::manifest::FieldType::Vector { dimensions },
            optional: false,
        }],
        indexes: Vec::new(),
        syncable: true,
        permission_backing: false,
        permission_fields: None,
        search_indexes: Vec::new(),
        vector_indexes: Vec::new(),
        search_live_limits: None,
        membership: None,
        authority_profile: None,
        asset_sharing: None,
        visibility: None,
        history: None,
    };
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE vectors(
           _id TEXT PRIMARY KEY,
           _version INTEGER NOT NULL,
           _createdAt INTEGER NOT NULL,
           _updatedAt INTEGER NOT NULL,
           embedding BLOB NOT NULL
         );",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO vectors VALUES('vector-row',1,1,1,zeroblob(?1))",
        [(dimensions as usize) * std::mem::size_of::<f64>()],
    )
    .unwrap();
    let mut work = NetDiffWorkV1::default();
    let error = read_app_table_rows(
        &conn,
        "vectors",
        Some(&vector_manifest),
        &mut work,
        NetDiffWorkLimitsV1 {
            max_bytes: 1_024,
            ..limits
        },
        "head-scan",
    )
    .expect_err("vector Value-array expansion must be charged before decoding");
    assert_eq!(error.diagnostic.code, RESOURCE_LIMIT_REFUSED_CODE);
    assert_eq!(error.diagnostic.details["phase"], "head-scan");
    assert_eq!(error.diagnostic.details["limitKind"], "bytes");
}

#[cfg(feature = "services-owner")]
#[test]
fn net_diff_authorizer_backed_app_row_corpus_and_runtime_negative() {
    let directory = tempfile::tempdir().unwrap();
    let source = app_row_source_database(directory.path());
    let destination = directory.path().join("fork-armed");
    let (mint, coverage, database) = publish_armed_app_row_fork(&source, &destination);

    assert_eq!(coverage.fork_point_version, mint.lineage.fork_point_version);
    assert_eq!(
        coverage.activation_head_version,
        mint.lineage.fork_point_version
    );
    assert_eq!(coverage.covered_lanes, fork_app_row_covered_lanes());
    assert_eq!(coverage.uncovered_lanes, fork_app_row_uncovered_lanes());
    assert_eq!(
        coverage.writer_choke_points,
        fork_app_row_writer_choke_points()
    );

    let mut fork = crate::storage::LocalDatabase::open(&database).unwrap();
    assert!(
        !fork
            .operation_lane_covered(crate::operation_ledger::ORDINARY_MUTATION_LANE_V1)
            .unwrap()
            && !fork
                .operation_lane_covered(crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1,)
                .unwrap(),
        "fork journal authority must not imply LLP 0163 operation-envelope coverage"
    );
    let denied = fork
        .execute_out_of_seam_app_sql_for_test(
            "INSERT INTO items(_id,_version,_createdAt,_updatedAt,title) \
             VALUES('raw-bypass',2,102,102,'must be denied')",
        )
        .expect_err("fork authorizer must deny direct app-table SQL");
    assert!(matches!(
        denied,
        rusqlite::Error::SqliteFailure(failure, _)
            if failure.code == rusqlite::ErrorCode::AuthorizationForStatementDenied
    ));

    fork.mutation_writes()
        .commit_buffered_writes(
            &crate::manifest::HandlerInput::default(),
            vec![
                crate::storage::BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: "inserted".to_owned(),
                    values: serde_json::Map::from_iter([("title".to_owned(), json!("new"))]),
                },
                crate::storage::BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: "ephemeral".to_owned(),
                    values: serde_json::Map::from_iter([(
                        "title".to_owned(),
                        json!("gone by head"),
                    )]),
                },
                crate::storage::BufferedWrite::Patch {
                    table: "items".to_owned(),
                    id: "update-me".to_owned(),
                    values: serde_json::Map::from_iter([("title".to_owned(), json!("after"))]),
                },
                crate::storage::BufferedWrite::Patch {
                    table: "items".to_owned(),
                    id: "revert-me".to_owned(),
                    values: serde_json::Map::from_iter([("title".to_owned(), json!("changed"))]),
                },
                crate::storage::BufferedWrite::Delete {
                    table: "items".to_owned(),
                    id: "delete-me".to_owned(),
                },
            ],
            Vec::new(),
            Value::Null,
        )
        .unwrap();
    fork.mutation_writes()
        .commit_buffered_writes(
            &crate::manifest::HandlerInput::default(),
            vec![
                crate::storage::BufferedWrite::Delete {
                    table: "items".to_owned(),
                    id: "ephemeral".to_owned(),
                },
                crate::storage::BufferedWrite::Patch {
                    table: "items".to_owned(),
                    id: "revert-me".to_owned(),
                    values: serde_json::Map::from_iter([("title".to_owned(), json!("original"))]),
                },
            ],
            Vec::new(),
            Value::Null,
        )
        .unwrap();
    drop(fork);

    let net = net_diff_receipt(&database, FORK_DIFF_MAX_ROWS).unwrap();
    assert_eq!(net.schema_version, "snapback.fork-net-diff.v3");
    assert_eq!(
        net.completeness,
        "registered-connection-defensive-app-rows-v1"
    );
    assert_eq!(net.journal_consistency, "journal-cross-check-verified");
    assert_eq!(net.attribution, "absent-v1");
    assert_eq!(
        net.writer_coverage.coverage_window,
        "fork-point-to-observed-head-verified"
    );
    assert_eq!(
        net.writer_coverage.manifest_digest.as_deref(),
        Some(coverage.manifest_digest.as_str())
    );
    assert_eq!(
        net.writer_coverage.covered_lanes,
        fork_app_row_covered_lanes()
    );
    assert_eq!(
        net.writer_coverage.uncovered_lanes,
        fork_app_row_uncovered_lanes()
    );
    assert_eq!(net.domains["appRows"], "net-covered");
    assert_eq!(net.domains["schema"], "omitted");
    assert_eq!(
        net.rows
            .iter()
            .map(|row| (row.row_id.as_str(), row.operation.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("delete-me", "delete"),
            ("inserted", "insert"),
            ("revert-me", "update"),
            ("update-me", "update"),
        ]
    );
    let reverted = net
        .rows
        .iter()
        .find(|row| row.row_id == "revert-me")
        .unwrap();
    assert_eq!(reverted.pre_image.as_ref().unwrap()["title"], "original");
    assert_eq!(reverted.post_image.as_ref().unwrap()["title"], "original");
    assert_ne!(
        reverted.pre_image.as_ref().unwrap()["_version"],
        reverted.post_image.as_ref().unwrap()["_version"],
        "generated writes retain system-field evidence even after content reverts"
    );

    let conn = Connection::open(&database).unwrap();
    conn.execute(
        "INSERT INTO _snapback_meta(key,value) VALUES('retention_floor','2') \
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [],
    )
    .unwrap();
    drop(conn);
    let retention_gap = net_diff_receipt(&database, FORK_DIFF_MAX_ROWS).unwrap();
    assert_eq!(retention_gap.completeness, "journal-enumerated-v1");
    assert_eq!(
        retention_gap.journal_consistency,
        "journal-cross-check-unavailable-retention-gap"
    );
    assert_eq!(
        retention_gap.writer_coverage.coverage_window,
        "fork-point-to-observed-head-verified"
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn armed_derived_fork_maintenance_sweep_prunes_the_change_journal() {
    let directory = tempfile::tempdir().unwrap();
    let source = app_row_source_database(directory.path());
    let destination = directory.path().join("fork-armed-prune");
    let (_, _, database) = publish_armed_app_row_fork(&source, &destination);
    let mut fork = crate::storage::LocalDatabase::open(&database).unwrap();
    for index in 0..3 {
        fork.mutation_writes()
            .commit_buffered_writes(
                &crate::manifest::HandlerInput::default(),
                vec![crate::storage::BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: format!("maintenance-{index}"),
                    values: serde_json::Map::from_iter([(
                        "title".to_owned(),
                        json!(format!("maintenance row {index}")),
                    )]),
                }],
                Vec::new(),
                Value::Null,
            )
            .unwrap();
    }
    let before = fork.versions_read().change_journal_len().unwrap();
    let deleted = fork
        .versions_read()
        .prune_change_journal(wall_clock_now_ms().saturating_add(1_000), 0, 0)
        .expect("armed maintenance writer prunes through its registered token");
    let after = fork.versions_read().change_journal_len().unwrap();
    assert!(
        deleted > 0,
        "the maintenance sweep must remove retained rows"
    );
    assert_eq!(after, before - deleted);
    assert!(
        fork.versions_read().journal_floor_version().unwrap() > 0,
        "the same armed sweep advances the monotonic retention floor"
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn net_diff_armed_path_refuses_bypass_tampered_base_and_coverage_fact() {
    let directory = tempfile::tempdir().unwrap();
    let source = app_row_source_database(directory.path());

    let bypass = directory.path().join("fork-bypass");
    let (_, _, bypass_database) = publish_armed_app_row_fork(&source, &bypass);
    let mut covered = crate::storage::LocalDatabase::open(&bypass_database).unwrap();
    covered
        .mutation_writes()
        .commit_buffered_writes(
            &crate::manifest::HandlerInput::default(),
            vec![crate::storage::BufferedWrite::Insert {
                table: "items".to_owned(),
                id: "borrowed-journal".to_owned(),
                values: serde_json::Map::from_iter([("title".to_owned(), json!("journaled"))]),
            }],
            Vec::new(),
            Value::Null,
        )
        .unwrap();
    drop(covered);
    let conn = Connection::open(&bypass_database).unwrap();
    conn.execute(
        "UPDATE items SET title='out-of-band' WHERE _id='borrowed-journal'",
        [],
    )
    .unwrap();
    assert!(
        PathBuf::from(format!("{}-wal", bypass_database.display())).is_file(),
        "the raw second-connection mutation is resident in the WAL"
    );
    let mismatch = net_diff_receipt(&bypass_database, FORK_DIFF_MAX_ROWS).unwrap_err();
    drop(conn);
    assert_eq!(mismatch.diagnostic.code, DIFF_ORACLE_MISMATCH_CODE);
    assert_eq!(mismatch.diagnostic.details["rowId"], "borrowed-journal");
    assert_eq!(
        mismatch.diagnostic.details["reason"],
        "journal-head-postimage-mismatch"
    );

    let unexplained = directory.path().join("fork-bypass-unexplained");
    let (_, _, unexplained_database) = publish_armed_app_row_fork(&source, &unexplained);
    let conn = Connection::open(&unexplained_database).unwrap();
    conn.execute(
        "INSERT INTO items(_id,_version,_createdAt,_updatedAt,title) \
         VALUES('smuggled',2,102,102,'no journal entry')",
        [],
    )
    .unwrap();
    drop(conn);
    let mismatch = net_diff_receipt(&unexplained_database, FORK_DIFF_MAX_ROWS).unwrap_err();
    assert_eq!(mismatch.diagnostic.code, DIFF_ORACLE_MISMATCH_CODE);
    assert_eq!(mismatch.diagnostic.details["rowId"], "smuggled");

    let tampered_base = directory.path().join("fork-tampered-base");
    let (_, _, tampered_base_database) = publish_armed_app_row_fork(&source, &tampered_base);
    let base_conn = Connection::open(tampered_base.join(BASE_SNAPSHOT_FILE)).unwrap();
    base_conn
        .execute(
            "INSERT INTO items(_id,_version,_createdAt,_updatedAt,title) \
             VALUES('tamper',2,102,102,'rewrite history')",
            [],
        )
        .unwrap();
    drop(base_conn);
    assert_eq!(
        net_diff_receipt(&tampered_base_database, FORK_DIFF_MAX_ROWS)
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_FORK_EVIDENCE_MISMATCH"
    );

    let tampered_coverage = directory.path().join("fork-tampered-coverage");
    let (_, mut coverage, tampered_coverage_database) =
        publish_armed_app_row_fork(&source, &tampered_coverage);
    coverage.profile = "forged-profile".to_owned();
    write_json_sync(
        &tampered_coverage.join(APP_ROW_COVERAGE_RECEIPT_FILE),
        &coverage,
    )
    .unwrap();
    assert_eq!(
        net_diff_receipt(&tampered_coverage_database, FORK_DIFF_MAX_ROWS)
            .unwrap_err()
            .diagnostic
            .code,
        WRITER_COVERAGE_INVALID_CODE
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn net_diff_matching_journal_forgery_is_outside_the_registered_connection_class() {
    let directory = tempfile::tempdir().unwrap();
    let source = app_row_source_database(directory.path());
    let destination = directory.path().join("fork-matching-forgery");
    let (_, _, database) = publish_armed_app_row_fork(&source, &destination);

    // This deliberately bypasses LocalDatabase and its registered,
    // defensive connection factory. With no OS/file boundary, a same-user
    // writer can forge both the app B-tree and the corroborating journal.
    // The narrowed completeness spelling must describe that boundary; the
    // oracle is tamper evidence, not a MAC over SQLite pages.
    let conn = Connection::open(&database).unwrap();
    let current: u64 = conn
        .query_row(
            "SELECT version FROM _snapback_version WHERE id=1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let forged = current + 1;
    let post_image = json!({
        "_createdAt": 500,
        "_id": "matching-forgery",
        "_updatedAt": 500,
        "_version": forged,
        "rank": null,
        "title": "coordinated raw write"
    });
    let tx = conn.unchecked_transaction().unwrap();
    tx.execute(
        "INSERT INTO items(_id,_version,_createdAt,_updatedAt,title)
         VALUES('matching-forgery',?1,500,500,'coordinated raw write')",
        [forged],
    )
    .unwrap();
    tx.execute(
        "UPDATE _snapback_version SET version=?1 WHERE id=1",
        [forged],
    )
    .unwrap();
    tx.execute(
        "INSERT INTO _snapback_changes(
             version,table_name,row_id,op,row_json,changed_at_ms
         ) VALUES(?1,'items','matching-forgery','insert',?2,500)",
        params![forged, serde_json::to_string(&post_image).unwrap()],
    )
    .unwrap();
    tx.commit().unwrap();
    drop(conn);

    let receipt = net_diff_receipt(&database, FORK_DIFF_MAX_ROWS).unwrap();
    assert_eq!(
        receipt.completeness, "registered-connection-defensive-app-rows-v1",
        "the class is intentionally scoped to registered process connections"
    );
    assert_eq!(receipt.journal_consistency, "journal-cross-check-verified");
    assert!(
        receipt
            .rows
            .iter()
            .any(|row| row.row_id == "matching-forgery")
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn registered_manifest_gap_and_exact_restore_cannot_reearn_completeness() {
    let directory = tempfile::tempdir().unwrap();
    let source = app_row_source_database(directory.path());
    let destination = directory.path().join("fork-registered-gap");
    let (_, _, database) = publish_armed_app_row_fork(&source, &destination);

    let denied = crate::storage::registered_vector_writer_denies_sql_for_test(
        &database,
        "DELETE FROM _snapback_operation_coverage_v1",
    )
    .expect("probe armed registered writer");
    assert!(
        denied,
        "registered writer cannot delete the active manifest"
    );

    // Reproduce the reviewer's formerly successful sequence beyond the
    // newly denied first statement by simulating the old gap through an
    // explicitly out-of-class raw connection. The next registered factory
    // must refuse instead of returning an unarmed writer, and it must
    // durably poison the whole-window claim before returning that refusal.
    let raw = Connection::open(&database).unwrap();
    let saved_manifest = raw
        .query_row(
            "SELECT manifest_version,stream_id,manifest_json,coverage_digest,activated_at_ms
               FROM _snapback_operation_coverage_v1
              ORDER BY manifest_version DESC LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get::<_, u64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, u64>(4)?,
                ))
            },
        )
        .unwrap();
    raw.execute("DELETE FROM _snapback_operation_coverage_v1", [])
        .unwrap();
    drop(raw);

    let error =
        match crate::storage::registered_vector_writer_denies_sql_for_test(&database, "SELECT 1") {
            Ok(_) => panic!("coverage evidence must not admit an unarmed registered writer"),
            Err(error) => error,
        };
    assert_eq!(error.diagnostic.code, WRITER_COVERAGE_GAP_CODE);
    assert!(destination.join(APP_ROW_COVERAGE_GAP_FILE).is_file());

    // Even if an out-of-class writer now performs the exact matching
    // app/version/journal forgery and restores the byte-identical manifest,
    // the irreversible gap evidence prevents the upgraded class from
    // being awarded again.
    let raw = Connection::open(&database).unwrap();
    let current: u64 = raw
        .query_row(
            "SELECT version FROM _snapback_version WHERE id=1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let forged = current + 1;
    let post_image = json!({
        "_createdAt": 700,
        "_id": "registered-gap-forgery",
        "_updatedAt": 700,
        "_version": forged,
        "rank": null,
        "title": "must never regain completeness"
    });
    let tx = raw.unchecked_transaction().unwrap();
    tx.execute(
        "INSERT INTO items(_id,_version,_createdAt,_updatedAt,title)
         VALUES('registered-gap-forgery',?1,700,700,'must never regain completeness')",
        [forged],
    )
    .unwrap();
    tx.execute(
        "UPDATE _snapback_version SET version=?1 WHERE id=1",
        [forged],
    )
    .unwrap();
    tx.execute(
        "INSERT INTO _snapback_changes(
           version,table_name,row_id,op,row_json,changed_at_ms
         ) VALUES(?1,'items','registered-gap-forgery','insert',?2,700)",
        params![forged, serde_json::to_string(&post_image).unwrap()],
    )
    .unwrap();
    tx.execute(
        "INSERT INTO _snapback_operation_coverage_v1(
           manifest_version,stream_id,manifest_json,coverage_digest,activated_at_ms
         ) VALUES(?1,?2,?3,?4,?5)",
        params![
            saved_manifest.0,
            saved_manifest.1,
            saved_manifest.2,
            saved_manifest.3,
            saved_manifest.4,
        ],
    )
    .unwrap();
    tx.commit().unwrap();
    drop(raw);

    let error = net_diff_receipt(&database, FORK_DIFF_MAX_ROWS)
        .expect_err("a restored manifest cannot erase a registered-writer coverage gap");
    assert_eq!(error.diagnostic.code, WRITER_COVERAGE_GAP_CODE);
}

#[cfg(feature = "services-owner")]
#[test]
fn net_diff_refuses_a_direct_head_database_page_mutation() {
    use std::io::{Read as _, Seek as _, SeekFrom, Write as _};

    let directory = tempfile::tempdir().unwrap();
    let source = app_row_source_database(directory.path());
    let destination = directory.path().join("fork-direct-file-mutation");
    let (_, _, database) = publish_armed_app_row_fork(&source, &destination);
    let mut file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&database)
        .unwrap();
    file.seek(SeekFrom::Start(100)).unwrap();
    let mut page_type = [0u8; 1];
    file.read_exact(&mut page_type).unwrap();
    page_type[0] ^= 0xff;
    file.seek(SeekFrom::Start(100)).unwrap();
    file.write_all(&page_type).unwrap();
    file.sync_all().unwrap();
    drop(file);

    assert!(
        net_diff_receipt(&database, FORK_DIFF_MAX_ROWS).is_err(),
        "a directly corrupted head file must not produce a receipt"
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn net_diff_refuses_a_direct_wal_header_mutation() {
    use std::io::{Read as _, Seek as _, SeekFrom, Write as _};

    let directory = tempfile::tempdir().unwrap();
    let source = app_row_source_database(directory.path());
    let destination = directory.path().join("fork-direct-wal-mutation");
    let (_, _, database) = publish_armed_app_row_fork(&source, &destination);

    let writer = Connection::open(&database).unwrap();
    writer
        .execute_batch("PRAGMA wal_autocheckpoint=0;")
        .unwrap();
    writer
        .execute(
            "INSERT INTO _snapback_meta(key,value) VALUES('wal-byte-fixture','1')",
            [],
        )
        .unwrap();
    let wal_path = PathBuf::from(format!("{}-wal", database.display()));
    assert!(
        wal_path.is_file(),
        "the committed fixture must remain in WAL"
    );
    let mut wal = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&wal_path)
        .unwrap();
    wal.seek(SeekFrom::Start(0)).unwrap();
    let mut magic = [0u8; 1];
    wal.read_exact(&mut magic).unwrap();
    magic[0] ^= 0xff;
    wal.seek(SeekFrom::Start(0)).unwrap();
    wal.write_all(&magic).unwrap();
    wal.sync_all().unwrap();
    drop(wal);

    assert!(
        net_diff_receipt(&database, FORK_DIFF_MAX_ROWS).is_err(),
        "a directly corrupted WAL must not produce a receipt"
    );
    drop(writer);
}

#[cfg(feature = "services-owner")]
#[test]
fn net_diff_unarmed_and_armed_late_never_upgrade() {
    let directory = tempfile::tempdir().unwrap();
    let source = app_row_source_database(directory.path());
    let destination = directory.path().join("fork-late");
    let now_ms = wall_clock_now_ms();
    let mint = publish_managed_with_base(
        &source,
        &destination,
        &managed_expected_for(&destination),
        "parent-a",
        now_ms,
        now_ms + 60_000,
        false,
        true,
    )
    .unwrap();
    let database = destination.join(&mint.database_file);
    let mut fork = crate::storage::LocalDatabase::open(&database).unwrap();
    fork.mutation_writes()
        .commit_buffered_writes(
            &crate::manifest::HandlerInput::default(),
            vec![crate::storage::BufferedWrite::Insert {
                table: "items".to_owned(),
                id: "before-arm".to_owned(),
                values: serde_json::Map::from_iter([(
                    "title".to_owned(),
                    json!("already written"),
                )]),
            }],
            Vec::new(),
            Value::Null,
        )
        .unwrap();
    drop(fork);

    assert_eq!(
        arm_derived_fork_app_row_coverage(&database, None, now_ms + 2)
            .unwrap_err()
            .diagnostic
            .code,
        WRITER_COVERAGE_INVALID_CODE
    );
    let mut late = crate::storage::LocalDatabase::open(&database).unwrap();
    late.activate_derived_fork_app_row_journal_coverage(now_ms + 3)
        .unwrap();
    drop(late);

    let net = net_diff_receipt(&database, FORK_DIFF_MAX_ROWS).unwrap();
    assert_eq!(net.completeness, "journal-enumerated-v1");
    assert_eq!(net.writer_coverage.coverage_window, "unverified");
    assert_eq!(net.writer_coverage.manifest_digest, None);
    assert_eq!(
        net.writer_coverage.uncovered_lanes,
        fork_app_row_all_lanes()
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn net_diff_refuses_without_base_catches_a_lying_journal_and_a_tampered_base() {
    let directory = tempfile::tempdir().unwrap();
    let source = source_database(directory.path());
    let parent = Connection::open(&source).unwrap();
    parent
        .execute_batch("CREATE TABLE notes(_id TEXT PRIMARY KEY, body TEXT NOT NULL)")
        .unwrap();
    drop(parent);
    let root = directory.path().join("forks");
    fs::create_dir(&root).unwrap();

    // Without a retained base the exact diff refuses by name.
    let bare = root.join("fork-bare");
    publish_managed(
        &source,
        &bare,
        &managed_expected(&root),
        "parent-a",
        100,
        200_000,
        false,
    )
    .unwrap();
    assert_eq!(
        net_diff_receipt(&bare.join("app.sqlite3"), FORK_DIFF_MAX_ROWS)
            .unwrap_err()
            .diagnostic
            .code,
        NET_DIFF_UNAVAILABLE_CODE
    );

    // A privileged write outside the journal is exactly what the oracle
    // must expose: the base/head net shows a change the journal never
    // recorded, so the receipt refuses rather than lending it cover.
    let lying = root.join("fork-lying");
    publish_managed_with_base(
        &source,
        &lying,
        &managed_expected(&root),
        "parent-a",
        100,
        200_000,
        false,
        true,
    )
    .unwrap();
    let database = lying.join("app.sqlite3");
    let conn = Connection::open(&database).unwrap();
    conn.execute(
        "INSERT INTO notes VALUES('smuggled','no journal entry')",
        [],
    )
    .unwrap();
    drop(conn);
    let mismatch = net_diff_receipt(&database, FORK_DIFF_MAX_ROWS).unwrap_err();
    assert_eq!(mismatch.diagnostic.code, DIFF_ORACLE_MISMATCH_CODE);
    assert_eq!(mismatch.diagnostic.details["table"], "notes");
    assert_eq!(mismatch.diagnostic.details["rowId"], "smuggled");

    // A tampered base snapshot fails its digest binding.
    let tampered = root.join("fork-tampered");
    publish_managed_with_base(
        &source,
        &tampered,
        &managed_expected(&root),
        "parent-a",
        100,
        200_000,
        false,
        true,
    )
    .unwrap();
    let base_conn = Connection::open(tampered.join(BASE_SNAPSHOT_FILE)).unwrap();
    base_conn
        .execute("INSERT INTO notes VALUES('tamper','rewrite history')", [])
        .unwrap();
    drop(base_conn);
    assert_eq!(
        net_diff_receipt(&tampered.join("app.sqlite3"), FORK_DIFF_MAX_ROWS)
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_FORK_EVIDENCE_MISMATCH"
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn reap_clock_refuses_values_outside_the_portable_range() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("forks");
    fs::create_dir(&root).unwrap();
    assert_eq!(
        expired_managed(
            &root,
            &managed_expected(&root),
            crate::manifest::PORTABLE_TIMESTAMP_MAX_MS + 1,
        )
        .unwrap_err()
        .diagnostic
        .code,
        "SNAPBACK_FORK_REAP_CLOCK_INVALID"
    );
}

#[cfg(feature = "services-owner")]
#[test]
fn publication_crash_matrix_recovers_to_absent_or_bootable_without_registry() {
    let cuts = [
        PublicationCut::AfterSentinelWrite,
        PublicationCut::AfterSentinelDirectorySync,
        PublicationCut::AfterClone,
        PublicationCut::AfterAdminSidecar,
        PublicationCut::AfterAuthSidecar,
        PublicationCut::AfterResumeSidecar,
        PublicationCut::AfterDatabaseMint,
        PublicationCut::AfterMintReceipt,
        PublicationCut::AfterSqliteDatabaseSync,
        PublicationCut::AfterSqliteWalSync,
        PublicationCut::AfterSqliteShmSync,
        PublicationCut::AfterSqliteJournalSync,
        PublicationCut::AfterSqliteSync,
        PublicationCut::AfterAssetCopy,
        PublicationCut::AfterStagingDirectorySync,
        PublicationCut::AfterRegistryIntent,
        PublicationCut::AfterRename,
        PublicationCut::AfterParentDirectorySync,
        PublicationCut::AfterRegistryFinalize,
        PublicationCut::AfterSentinelUnlink,
        PublicationCut::AfterPublishedDirectorySync,
    ];
    for (index, cut) in cuts.into_iter().enumerate() {
        let directory = tempfile::tempdir().unwrap();
        // Asset-bearing so every cut also covers the private blob-tree
        // staging (2026-08-05 review: the matrix had no asset cuts).
        let source = asset_bearing_parent(directory.path(), b"crash matrix blob");
        let destination = directory.path().join("fork");
        let error = publish(&source, &destination, "app-a", "parent-a", 42, Some(cut)).unwrap_err();
        assert_eq!(
            error.diagnostic.code, "SNAPBACK_FORK_TEST_CRASH_CUT",
            "{cut:?}"
        );
        let registry = directory.path().join(REGISTRY_DIRECTORY);
        let _ = fs::remove_dir_all(&registry);
        let _ = fs::remove_file(&registry);
        match index % 3 {
            0 => {} // absent
            1 => {
                fs::create_dir(&registry).unwrap();
                fs::write(registry.join("stale.json"), b"not registry json").unwrap();
            }
            _ => {
                File::create(&registry).unwrap(); // unavailable as a directory
            }
        }
        recover(directory.path(), &destination).unwrap();
        if destination.exists() {
            assert!(
                inspect_boot(&destination.join("app.sqlite3"))
                    .unwrap()
                    .is_some(),
                "{cut:?}"
            );
        }
    }
}
