use super::*;

/// How many idle reader connections the pool retains. Checkout never waits:
/// an empty pool opens a fresh read-only connection on demand, and check-in
/// drops connections beyond this cap, so the pool itself has no blocking or
/// deadlock surface.
const READER_POOL_RETAINED: usize = 4;

/// Closed purposes for writable handles outside `LocalDatabase`'s primary
/// connection. Construction reconstructs the durable armed manifest, verifies
/// defensive mode, installs the same default-deny authorizer, and enters a
/// system-only token that cannot authorize application or journal DML.
pub(super) enum RegisteredSystemWriterPurposeV1 {
    DerivedForkLifecycle,
    DerivedForkEgressMarker,
    VectorIndex,
}

pub(super) struct RegisteredSystemWriterV1 {
    conn: Connection,
    _authority: write_authority::WriterAuthorityV1,
    _token: write_authority::GeneratedWriterTokenV1,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ForkWriterCoverageGapV1<'a> {
    schema_version: &'static str,
    stream_id: &'a str,
    expected_manifest_version: u64,
    expected_manifest_digest: &'a str,
    detected_at_ms: u64,
    reason: &'a str,
}

fn persist_fork_writer_coverage_gap(
    path: &Path,
    stream_id: &str,
    expected_manifest_version: u64,
    expected_manifest_digest: &str,
    detected_at_ms: u64,
    reason: &str,
) -> SnapbackResult<()> {
    let gap_path = path.with_file_name(crate::instance_fork::APP_ROW_COVERAGE_GAP_FILE);
    let body = serde_json::to_vec(&ForkWriterCoverageGapV1 {
        schema_version: "snapback.fork-app-row-coverage-gap.v1",
        stream_id,
        expected_manifest_version,
        expected_manifest_digest,
        detected_at_ms,
        reason,
    })
    .map_err(|error| {
        SnapbackError::error(
            crate::instance_fork::WRITER_COVERAGE_GAP_CODE,
            "instanceFork",
            format!("encode durable fork writer-coverage gap: {error}"),
        )
    })?;
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&gap_path)
    {
        Ok(mut file) => {
            file.write_all(&body).map_err(|error| {
                SnapbackError::error(
                    crate::instance_fork::WRITER_COVERAGE_GAP_CODE,
                    "instanceFork",
                    format!("write durable fork writer-coverage gap: {error}"),
                )
            })?;
            file.sync_all().map_err(|error| {
                SnapbackError::error(
                    crate::instance_fork::WRITER_COVERAGE_GAP_CODE,
                    "instanceFork",
                    format!("sync durable fork writer-coverage gap: {error}"),
                )
            })?;
            File::open(gap_path.parent().unwrap_or_else(|| Path::new(".")))
                .and_then(|directory| directory.sync_all())
                .map_err(|error| {
                    SnapbackError::error(
                        crate::instance_fork::WRITER_COVERAGE_GAP_CODE,
                        "instanceFork",
                        format!("sync fork writer-coverage gap directory: {error}"),
                    )
                })?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => {
            return Err(SnapbackError::error(
                crate::instance_fork::WRITER_COVERAGE_GAP_CODE,
                "instanceFork",
                format!("create durable fork writer-coverage gap: {error}"),
            ));
        }
    }
    Ok(())
}

fn writer_coverage_gap_error(
    reason: &str,
    stream_id: &str,
    expected_manifest_version: u64,
    expected_manifest_digest: &str,
) -> SnapbackError {
    SnapbackError::error(
        crate::instance_fork::WRITER_COVERAGE_GAP_CODE,
        "instanceFork",
        "registered writer coverage was discontinuous; recreate the fork",
    )
    .with_detail("reason", reason.to_owned())
    .with_detail("streamId", stream_id.to_owned())
    .with_detail("expectedManifestVersion", expected_manifest_version)
    .with_detail(
        "expectedManifestDigest",
        expected_manifest_digest.to_owned(),
    )
}

fn break_registered_writer_coverage(
    conn: &Connection,
    path: Option<&Path>,
    stream_id: &str,
    expected_manifest_version: u64,
    expected_manifest_digest: &str,
    reason: &str,
    fork_evidence_present: bool,
) -> SnapbackResult<crate::commit_envelope::OperationCoverageManifestV1> {
    let detected_at_ms = now_millis();
    let sidecar = if fork_evidence_present {
        path.map(|path| {
            persist_fork_writer_coverage_gap(
                path,
                stream_id,
                expected_manifest_version,
                expected_manifest_digest,
                detected_at_ms,
                reason,
            )
        })
        .transpose()
    } else {
        Ok(None)
    };
    let durable_row = crate::operation_ledger::break_operation_coverage_continuity(
        conn,
        stream_id,
        expected_manifest_version,
        expected_manifest_digest,
        detected_at_ms,
        reason,
    );
    if sidecar.is_err() && durable_row.is_err() {
        return Err(writer_coverage_gap_error(
            reason,
            stream_id,
            expected_manifest_version,
            expected_manifest_digest,
        )
        .with_detail("durableGapRecord", "failed"));
    }
    Err(writer_coverage_gap_error(
        reason,
        stream_id,
        expected_manifest_version,
        expected_manifest_digest,
    ))
}

/// Reconstruct one process-owned writable connection's coverage authority.
/// The manifest, monotonic continuity row, active stream, and both derived-
/// fork receipt carriers must agree before the authorizer can be installed.
/// Any contradiction is durably irreversible before the connection refuses.
///
/// @ref LLP 0165#derived-fork-authorizer-backed-net-diff--2026-08-06 — every
/// registered writer joins the same continuous fork-point-to-head boundary.
pub(super) fn registered_writer_coverage_manifest(
    conn: &Connection,
    path: Option<&Path>,
) -> SnapbackResult<Option<crate::commit_envelope::OperationCoverageManifestV1>> {
    let gap_file_present = path.is_some_and(|path| {
        path.with_file_name(crate::instance_fork::APP_ROW_COVERAGE_GAP_FILE)
            .exists()
    });
    let database_receipt = conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key=?1",
            [crate::instance_fork::APP_ROW_COVERAGE_META_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let file_receipt = match path.map(|path| {
        fs::read(path.with_file_name(crate::instance_fork::APP_ROW_COVERAGE_RECEIPT_FILE))
    }) {
        Some(Ok(body)) => Some(body),
        Some(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => None,
        Some(Err(error)) => {
            return Err(SnapbackError::error(
                crate::instance_fork::WRITER_COVERAGE_GAP_CODE,
                "instanceFork",
                format!("read fork writer-coverage receipt: {error}"),
            ));
        }
        None => None,
    };
    let fork_evidence_present = database_receipt.is_some() || file_receipt.is_some();
    let receipt = match (database_receipt.as_deref(), file_receipt.as_deref()) {
        (None, None) => None,
        (Some(database), Some(file)) => {
            let database: crate::instance_fork::ForkAppRowCoverageReceiptV1 =
                serde_json::from_str(database).map_err(|_| {
                    SnapbackError::error(
                        crate::instance_fork::WRITER_COVERAGE_GAP_CODE,
                        "instanceFork",
                        "database writer-coverage receipt is malformed",
                    )
                })?;
            let file: crate::instance_fork::ForkAppRowCoverageReceiptV1 =
                serde_json::from_slice(file).map_err(|_| {
                    SnapbackError::error(
                        crate::instance_fork::WRITER_COVERAGE_GAP_CODE,
                        "instanceFork",
                        "file writer-coverage receipt is malformed",
                    )
                })?;
            if database != file {
                return break_registered_writer_coverage(
                    conn,
                    path,
                    &database.data_version_stream,
                    database.manifest_version,
                    &database.manifest_digest,
                    "fork-coverage-receipts-disagree",
                    true,
                )
                .map(Some);
            }
            Some(database)
        }
        (Some(database), None) => {
            let receipt: crate::instance_fork::ForkAppRowCoverageReceiptV1 =
                serde_json::from_str(database).map_err(|_| {
                    SnapbackError::error(
                        crate::instance_fork::WRITER_COVERAGE_GAP_CODE,
                        "instanceFork",
                        "sole database writer-coverage receipt is malformed",
                    )
                })?;
            return break_registered_writer_coverage(
                conn,
                path,
                &receipt.data_version_stream,
                receipt.manifest_version,
                &receipt.manifest_digest,
                "fork-coverage-file-missing",
                true,
            )
            .map(Some);
        }
        (None, Some(file)) => {
            let receipt: crate::instance_fork::ForkAppRowCoverageReceiptV1 =
                serde_json::from_slice(file).map_err(|_| {
                    SnapbackError::error(
                        crate::instance_fork::WRITER_COVERAGE_GAP_CODE,
                        "instanceFork",
                        "sole file writer-coverage receipt is malformed",
                    )
                })?;
            return break_registered_writer_coverage(
                conn,
                path,
                &receipt.data_version_stream,
                receipt.manifest_version,
                &receipt.manifest_digest,
                "fork-coverage-database-receipt-missing",
                true,
            )
            .map(Some);
        }
    };

    let current_stream = crate::seed_identity::strict_current_data_version_stream(conn)?;
    let expected_stream = receipt
        .as_ref()
        .map(|receipt| receipt.data_version_stream.as_str())
        .or(current_stream.as_deref());
    let Some(expected_stream) = expected_stream else {
        return Ok(None);
    };
    let manifest = current_stream
        .as_deref()
        .filter(|stream| *stream == expected_stream)
        .map(|stream| crate::operation_ledger::active_coverage_manifest(conn, stream))
        .transpose()?
        .flatten();
    let continuity = crate::operation_ledger::operation_coverage_continuity(conn, expected_stream)?;
    let expectation = receipt
        .as_ref()
        .map(|receipt| (receipt.manifest_version, receipt.manifest_digest.as_str()))
        .or_else(|| {
            continuity.as_ref().map(|continuity| {
                (
                    continuity.expected_manifest_version,
                    continuity.expected_coverage_digest.as_str(),
                )
            })
        })
        .or_else(|| {
            manifest
                .as_ref()
                .map(|manifest| (manifest.manifest_version, manifest.coverage_digest.as_str()))
        });
    let Some((expected_version, expected_digest)) = expectation else {
        return Ok(None);
    };
    let valid = !gap_file_present
        && current_stream.as_deref() == Some(expected_stream)
        && manifest.as_ref().is_some_and(|manifest| {
            manifest.manifest_version == expected_version
                && manifest.coverage_digest == expected_digest
        })
        && continuity.as_ref().is_some_and(|continuity| {
            continuity.state == "continuous"
                && continuity.expected_manifest_version == expected_version
                && continuity.expected_coverage_digest == expected_digest
        })
        && receipt.as_ref().is_none_or(|receipt| {
            manifest.as_ref().is_some_and(|manifest| {
                receipt.covered_lanes == manifest.covered_lanes
                    && receipt.writer_choke_points == manifest.writer_choke_points
            })
        });
    if !valid {
        let reason = if gap_file_present {
            "durable-coverage-gap-already-recorded"
        } else if current_stream.as_deref() != Some(expected_stream) {
            "active-stream-mismatch"
        } else if continuity
            .as_ref()
            .is_some_and(|value| value.state == "broken")
        {
            "coverage-continuity-broken"
        } else if manifest.is_none() {
            "active-manifest-missing"
        } else {
            "coverage-manifest-or-continuity-mismatch"
        };
        return break_registered_writer_coverage(
            conn,
            path,
            expected_stream,
            expected_version,
            expected_digest,
            reason,
            fork_evidence_present,
        )
        .map(Some);
    }
    Ok(manifest)
}

impl RegisteredSystemWriterV1 {
    #[cfg(test)]
    pub(super) fn execute_for_authorizer_test(&self, sql: &str) -> rusqlite::Result<usize> {
        self.conn.execute(sql, [])
    }

    #[cfg(test)]
    pub(super) fn defensive_mode_for_authorizer_test(&self) -> rusqlite::Result<bool> {
        self.conn
            .db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_DEFENSIVE)
    }
}

pub(super) fn open_registered_system_writer_v1(
    path: &Path,
    purpose: RegisteredSystemWriterPurposeV1,
) -> SnapbackResult<RegisteredSystemWriterV1> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    if crate::replication::configured_from_env() {
        crate::replication::configure_connection_wal_lifetime(&conn)?;
        conn.execute_batch("PRAGMA wal_autocheckpoint = 0;")?;
    }
    let authority = write_authority::WriterAuthorityV1::default();
    if let Some(schema) = active_schema_manifest_from_connection(&conn)? {
        authority.set_schema(&schema)?;
    }
    let manifest = registered_writer_coverage_manifest(&conn, Some(path))?;
    authority.set_manifest(manifest)?;
    authority.install(&conn)?;
    let lane = match purpose {
        RegisteredSystemWriterPurposeV1::DerivedForkLifecycle => {
            write_authority::LocalWriterLaneV1::BranchRegistry
        }
        RegisteredSystemWriterPurposeV1::DerivedForkEgressMarker => {
            write_authority::LocalWriterLaneV1::AdminControl
        }
        RegisteredSystemWriterPurposeV1::VectorIndex => {
            write_authority::LocalWriterLaneV1::VectorIndex
        }
    };
    let token = authority.enter(lane)?;
    Ok(RegisteredSystemWriterV1 {
        conn,
        _authority: authority,
        _token: token,
    })
}

/// Atomically replace the exact derived-fork lineage row through the
/// registered lifecycle lane. The service supplies typed lineage intent and
/// never receives the writable connection or transaction.
///
/// @ref LLP 0225#3-transaction-and-commit-boundaries--who-may-commit-what —
/// the storage kernel is the sole canonical-store transaction authority.
pub fn renew_derived_fork_lineage_v1(
    path: &Path,
    lineage: &crate::instance_fork::DerivedForkLineageV1,
    checkpoint_first: bool,
) -> SnapbackResult<()> {
    let writer = open_registered_system_writer_v1(
        path,
        RegisteredSystemWriterPurposeV1::DerivedForkLifecycle,
    )?;
    if checkpoint_first && !crate::replication::configured_from_env() {
        writer.conn.execute_batch("PRAGMA wal_checkpoint(FULL);")?;
    }
    let lineage_json = serde_json::to_string(lineage).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_FORK_LINEAGE_INVALID",
            "instanceFork",
            error.to_string(),
        )
    })?;
    let tx = writer.conn.unchecked_transaction()?;
    let changed = tx.execute(
        "UPDATE _snapback_meta SET value=?2 WHERE key=?1",
        params!["instance_fork_lineage_v1", lineage_json],
    )?;
    if changed != 1 {
        return Err(SnapbackError::error(
            "SNAPBACK_FORK_EVIDENCE_INCOMPLETE",
            "instanceFork",
            "renewal lineage update did not affect exactly one fork row",
        )
        .with_details(json!({ "updatedRows": changed })));
    }
    tx.commit()?;
    Ok(())
}

/// Persist one bounded derived-fork egress-denial marker through its exact
/// registered system lane.
pub fn record_derived_fork_egress_attempt_v1(
    path: &Path,
    family: &str,
    now_ms: u64,
) -> SnapbackResult<()> {
    let writer = open_registered_system_writer_v1(
        path,
        RegisteredSystemWriterPurposeV1::DerivedForkEgressMarker,
    )?;
    writer.conn.execute(
        "INSERT INTO _snapback_fork_egress_attempts_v1(
           family,attempts,first_attempt_at_ms,last_attempt_at_ms
         ) VALUES(?1,1,?2,?2)
         ON CONFLICT(family) DO UPDATE SET
           attempts=MIN(attempts + 1, 9223372036854775807),
           last_attempt_at_ms=excluded.last_attempt_at_ms",
        params![family, now_ms],
    )?;
    Ok(())
}

/// Test-support probe for the connection-local authorizer. It exposes only a
/// denial verdict, never the registered writer or its SQLite handle.
#[cfg(any(test, feature = "test-support"))]
pub fn registered_vector_writer_denies_sql_for_test(
    path: &Path,
    sql: &str,
) -> SnapbackResult<bool> {
    let writer =
        open_registered_system_writer_v1(path, RegisteredSystemWriterPurposeV1::VectorIndex)?;
    Ok(matches!(
        writer.conn.execute(sql, []),
        Err(rusqlite::Error::SqliteFailure(failure, _))
            if failure.code == rusqlite::ErrorCode::AuthorizationForStatementDenied
    ))
}

/// A pool of read-only WAL connections for the lock-free read lane.
///
/// @ref LLP 0003#database-model — queries run read-only against a WAL reader
/// pool and need not take the write lock at all.
pub struct ReaderPool {
    path: PathBuf,
    idle: Mutex<Vec<Connection>>,
    closing: AtomicBool,
    replication_checkpoint_owner: bool,
}

impl ReaderPool {
    pub(super) fn new(path: PathBuf, replication_checkpoint_owner: bool) -> Self {
        Self {
            path,
            idle: Mutex::new(Vec::new()),
            closing: AtomicBool::new(false),
            replication_checkpoint_owner,
        }
    }

    pub fn close_for_shutdown(&self) -> Vec<String> {
        self.closing.store(true, AtomicOrdering::Release);
        let connections = {
            let mut idle = self
                .idle
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            idle.drain(..).collect::<Vec<_>>()
        };
        connections
            .into_iter()
            .enumerate()
            .filter_map(|(index, conn)| {
                conn.close().err().map(|(_conn, error)| {
                    format!("failed to close idle reader {index} for shutdown: {error}")
                })
            })
            .collect()
    }

    fn checkout(&self) -> SnapbackResult<PooledReader<'_>> {
        crate::exec_guard::debug_assert_off_async_worker("a reader-pool checkout");
        let pooled = self
            .idle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .pop();
        let conn = match pooled {
            Some(conn) => conn,
            None => self.open_reader()?,
        };
        Ok(PooledReader {
            pool: self,
            conn: Some(conn),
        })
    }

    /// Execute one operation inside a kernel-owned read transaction. The
    /// callback receives only the typed read carrier; neither the pooled
    /// connection nor its transaction can escape this boundary.
    pub fn with_pinned_read<T>(
        &self,
        schema: &SchemaManifest,
        read: impl FnOnce(DbRead<'_>) -> SnapbackResult<T>,
    ) -> SnapbackResult<T> {
        let reader = self.checkout()?;
        let tx = reader.connection().unchecked_transaction()?;
        current_version_on(&tx)?;
        let output = read(DbRead::pinned(&tx, schema))?;
        tx.commit()?;
        Ok(output)
    }

    fn open_reader(&self) -> SnapbackResult<Connection> {
        let conn = Connection::open_with_flags(
            &self.path,
            OpenFlags::SQLITE_OPEN_READ_ONLY
                | OpenFlags::SQLITE_OPEN_URI
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.execute_batch(
            "
            PRAGMA query_only = ON;
            PRAGMA busy_timeout = 5000;
            ",
        )?;
        if self.replication_checkpoint_owner {
            crate::replication::configure_connection_wal_lifetime(&conn)?;
            conn.execute_batch("PRAGMA wal_autocheckpoint = 0;")?;
        }
        Ok(conn)
    }

    /// Quarantine one exact vector generation after its pooled read snapshot
    /// has been released. This connection is intentionally write-capable but
    /// exposes no application read or write surface.
    pub fn quarantine_vector_generation(
        &self,
        identity: &crate::vector::sqlite::VectorGenerationIdentity,
    ) -> SnapbackResult<bool> {
        // This is the only production second writable connection for a
        // LocalDatabase. It reconstructs a connection-local authority/token
        // rather than borrowing the primary connection's active token state.
        let writer = open_registered_system_writer_v1(
            &self.path,
            RegisteredSystemWriterPurposeV1::VectorIndex,
        )?;
        crate::vector::sqlite::quarantine_generation_on(
            &writer.conn,
            identity,
            "same-snapshot vector release recheck failed",
        )
    }

    fn check_in(&self, conn: Connection) {
        let mut idle = self
            .idle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if self.closing.load(AtomicOrdering::Acquire) {
            drop(idle);
            let _ = conn.close();
            return;
        }
        if idle.len() < READER_POOL_RETAINED {
            idle.push(conn);
        }
    }
}

/// A checked-out reader connection; returns to the pool on drop.
struct PooledReader<'a> {
    pool: &'a ReaderPool,
    conn: Option<Connection>,
}

impl PooledReader<'_> {
    fn connection(&self) -> &Connection {
        self.conn.as_ref().expect("pooled reader connection")
    }
}

impl Drop for PooledReader<'_> {
    fn drop(&mut self) {
        if let Some(conn) = self.conn.take() {
            self.pool.check_in(conn);
        }
    }
}
