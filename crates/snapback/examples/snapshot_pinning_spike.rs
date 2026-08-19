//! Reproducible OQ13 spike for LLP 0162/0165.
//!
//! The experiment deliberately holds one WAL read transaction open before
//! constructing the SQLite backup handle.  A concurrent writer then replaces
//! every logical row while the backup advances one page at a time.  The source
//! is scanned through the still-open transaction and compared with the copy;
//! the live head is scanned separately so a false "both saw current" pass is
//! impossible.
//!
//! @ref LLP 0162#open-questions — OQ13 asks whether backup can consume a held
//!   source snapshot and what WAL growth that choice retains.

use std::fs;
use std::path::Path;
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{Context, ensure};
use rusqlite::backup::{Backup, StepResult};
use rusqlite::{Connection, params};
use serde::Serialize;
use sha2::{Digest, Sha256};

const ROWS: usize = 4_096;
const PAYLOAD_BYTES: usize = 512;
const WRITER_BATCH_ROWS: usize = 32;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotPinningSpikeV1 {
    schema_version: &'static str,
    date: &'static str,
    source_revision: String,
    source_dirty: bool,
    runner: &'static str,
    sqlite_version: String,
    fixture: Fixture,
    result: ResultFacts,
    verdict: Verdict,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    rows: usize,
    payload_bytes: usize,
    writer_batch_rows: usize,
    page_size_bytes: u64,
    source_bytes_after_checkpoint: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResultFacts {
    pinned_version: u64,
    copied_version: u64,
    live_version_after_writer: u64,
    pinned_digest: String,
    copied_digest: String,
    live_digest_after_writer: String,
    backup_pages: u64,
    backup_steps: u64,
    backup_busy_steps: u64,
    backup_locked_steps: u64,
    backup_elapsed_ms: u128,
    writer_commits: u64,
    wal_bytes_before_writer: u64,
    wal_bytes_while_pinned: u64,
    wal_growth_bytes: u64,
    wal_growth_to_source_ratio: f64,
    passive_checkpoint_busy: u64,
    passive_checkpoint_log_frames: u64,
    passive_checkpointed_frames: u64,
    wal_bytes_after_release_and_truncate: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Verdict {
    backup_uses_held_source_snapshot: bool,
    concurrent_writers_make_progress: bool,
    wal_growth_has_intrinsic_database_size_bound: bool,
    contract_posture: &'static str,
    reason: &'static str,
}

fn main() -> anyhow::Result<()> {
    let report = run()?;
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}

fn run() -> anyhow::Result<SnapshotPinningSpikeV1> {
    let directory = tempfile::tempdir()?;
    let source_path = directory.path().join("source.sqlite3");
    let copy_path = directory.path().join("copy.sqlite3");
    let wal_path = directory.path().join("source.sqlite3-wal");

    let writer = Connection::open(&source_path)?;
    configure_source(&writer)?;
    seed(&writer)?;
    let _: (u64, u64, u64) = writer.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    })?;
    let page_size_bytes = pragma_u64(&writer, "page_size")?;
    let source_bytes_after_checkpoint = file_len(&source_path)?;
    drop(writer);

    let mut snapshot_connection = Connection::open(&source_path)?;
    configure_reader(&snapshot_connection)?;
    let snapshot = snapshot_connection.transaction()?;
    // Force the DEFERRED transaction to acquire its WAL end mark before the
    // writer is released. Merely calling `transaction()` is not a snapshot.
    let pinned_version: u64 = snapshot.query_row(
        "SELECT version FROM snapshot_meta WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    let pinned_digest = digest_rows(&snapshot)?;
    let wal_bytes_before_writer = file_len_or_zero(&wal_path)?;

    let start_writer = Arc::new(Barrier::new(2));
    let writer_barrier = start_writer.clone();
    let writer_path = source_path.clone();
    let writer_thread = thread::spawn(move || -> anyhow::Result<(u64, u64)> {
        let mut writer = Connection::open(writer_path)?;
        configure_source(&writer)?;
        writer_barrier.wait();
        let mut commits = 0_u64;
        for batch_start in (0..ROWS).step_by(WRITER_BATCH_ROWS) {
            let tx = writer.transaction()?;
            let batch_end = (batch_start + WRITER_BATCH_ROWS).min(ROWS);
            for id in batch_start..batch_end {
                tx.execute(
                    "UPDATE items SET payload = ?1 WHERE id = ?2",
                    params![payload('b', id), id as u64],
                )?;
            }
            tx.execute(
                "UPDATE snapshot_meta SET version = version + 1 WHERE singleton = 1",
                [],
            )?;
            tx.commit()?;
            commits += 1;
        }
        let version = writer.query_row(
            "SELECT version FROM snapshot_meta WHERE singleton = 1",
            [],
            |row| row.get(0),
        )?;
        Ok((commits, version))
    });

    let mut copy = Connection::open(&copy_path)?;
    let backup = Backup::new(&snapshot, &mut copy)?;
    let started = Instant::now();
    let mut backup_steps = 0_u64;
    let mut backup_busy_steps = 0_u64;
    let mut backup_locked_steps = 0_u64;
    start_writer.wait();
    let backup_pages = loop {
        match backup.step(1)? {
            StepResult::Done => {
                let progress = backup.progress();
                backup_steps += 1;
                break progress.pagecount.max(0) as u64;
            }
            StepResult::More => backup_steps += 1,
            StepResult::Busy => {
                backup_busy_steps += 1;
                thread::yield_now();
            }
            StepResult::Locked => {
                backup_locked_steps += 1;
                thread::yield_now();
            }
            _ => unreachable!("rusqlite 0.31 exposes only four backup step outcomes"),
        }
        // Deliberately yield between page copies so the writer exercises the
        // before/during/after interleaving instead of racing one monolithic
        // sqlite3_backup_step(-1).
        thread::sleep(Duration::from_micros(50));
    };
    let backup_elapsed_ms = started.elapsed().as_millis();
    drop(backup);

    let (writer_commits, live_version_after_writer) = writer_thread
        .join()
        .map_err(|_| anyhow::anyhow!("writer thread panicked"))??;
    let wal_bytes_while_pinned = file_len_or_zero(&wal_path)?;
    let wal_growth_bytes = wal_bytes_while_pinned.saturating_sub(wal_bytes_before_writer);
    let wal_growth_to_source_ratio = if source_bytes_after_checkpoint == 0 {
        0.0
    } else {
        wal_growth_bytes as f64 / source_bytes_after_checkpoint as f64
    };

    let (passive_checkpoint_busy, passive_checkpoint_log_frames, passive_checkpointed_frames) =
        Connection::open(&source_path)?.query_row("PRAGMA wal_checkpoint(PASSIVE)", [], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;

    // Both observations remain inside the read transaction that predated the
    // writer. This is the OQ13 equality, not a digest reconstructed later.
    let pinned_version_after_backup: u64 = snapshot.query_row(
        "SELECT version FROM snapshot_meta WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    let pinned_digest_after_backup = digest_rows(&snapshot)?;
    ensure!(pinned_version_after_backup == pinned_version);
    ensure!(pinned_digest_after_backup == pinned_digest);

    let copied_version: u64 = copy.query_row(
        "SELECT version FROM snapshot_meta WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    let copied_digest = digest_rows(&copy)?;
    ensure!(copied_version == pinned_version);
    ensure!(copied_digest == pinned_digest);

    let live = Connection::open(&source_path)?;
    let live_digest_after_writer = digest_rows(&live)?;
    ensure!(live_version_after_writer > pinned_version);
    ensure!(live_digest_after_writer != pinned_digest);

    snapshot.commit()?;
    drop(snapshot_connection);
    let checkpoint = Connection::open(&source_path)?;
    let _: (u64, u64, u64) =
        checkpoint.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;
    let wal_bytes_after_release_and_truncate = file_len_or_zero(&wal_path)?;
    ensure!(wal_bytes_after_release_and_truncate == 0);

    Ok(SnapshotPinningSpikeV1 {
        schema_version: "snapback.oq13-snapshot-pinning-spike.v1",
        date: "2026-08-03",
        source_revision: option_env!("SNAPBACK_BUILD_GIT_COMMIT")
            .unwrap_or("unknown")
            .to_owned(),
        source_dirty: matches!(option_env!("SNAPBACK_BUILD_GIT_DIRTY"), Some("true")),
        runner: "examples/snapshot_pinning_spike.rs",
        sqlite_version: rusqlite::version().to_owned(),
        fixture: Fixture {
            rows: ROWS,
            payload_bytes: PAYLOAD_BYTES,
            writer_batch_rows: WRITER_BATCH_ROWS,
            page_size_bytes,
            source_bytes_after_checkpoint,
        },
        result: ResultFacts {
            pinned_version,
            copied_version,
            live_version_after_writer,
            pinned_digest,
            copied_digest,
            live_digest_after_writer,
            backup_pages,
            backup_steps,
            backup_busy_steps,
            backup_locked_steps,
            backup_elapsed_ms,
            writer_commits,
            wal_bytes_before_writer,
            wal_bytes_while_pinned,
            wal_growth_bytes,
            wal_growth_to_source_ratio,
            passive_checkpoint_busy,
            passive_checkpoint_log_frames,
            passive_checkpointed_frames,
            wal_bytes_after_release_and_truncate,
        },
        verdict: Verdict {
            backup_uses_held_source_snapshot: true,
            concurrent_writers_make_progress: true,
            // SQLite supplies no database-size-derived ceiling: a held WAL
            // end mark retains every subsequently dirtied frame until the
            // snapshot releases. The experiment measures one workload point;
            // the product must impose its own byte/time budget.
            wal_growth_has_intrinsic_database_size_bound: false,
            contract_posture: "budgeted-pin-or-stable-refusal",
            reason: "backup and independent scan can share one held source snapshot, but WAL retention is proportional to concurrent write volume and duration; admission must preflight a finite budget and abort with a stable refusal before the budget is exceeded",
        },
    })
}

fn configure_source(connection: &Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = FULL;
         PRAGMA wal_autocheckpoint = 0;
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(())
}

fn configure_reader(connection: &Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "PRAGMA query_only = ON;
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(())
}

fn seed(connection: &Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        "CREATE TABLE items(id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
         CREATE TABLE snapshot_meta(singleton INTEGER PRIMARY KEY CHECK(singleton = 1), version INTEGER NOT NULL);
         INSERT INTO snapshot_meta(singleton, version) VALUES(1, 1);",
    )?;
    let mut statement = connection.prepare("INSERT INTO items(id, payload) VALUES(?1, ?2)")?;
    for id in 0..ROWS {
        statement.execute(params![id as u64, payload('a', id)])?;
    }
    Ok(())
}

fn payload(fill: char, id: usize) -> String {
    let prefix = format!("{fill}:{id:08}:");
    let remaining = PAYLOAD_BYTES.saturating_sub(prefix.len());
    format!("{prefix}{}", fill.to_string().repeat(remaining))
}

fn digest_rows(connection: &Connection) -> anyhow::Result<String> {
    let mut statement = connection.prepare("SELECT id, payload FROM items ORDER BY id")?;
    let mut rows = statement.query([])?;
    let mut digest = Sha256::new();
    digest.update(b"snapback:oq13-snapshot:v1\n");
    while let Some(row) = rows.next()? {
        let id: u64 = row.get(0)?;
        let payload: String = row.get(1)?;
        digest.update(id.to_be_bytes());
        digest.update((payload.len() as u64).to_be_bytes());
        digest.update(payload.as_bytes());
    }
    Ok(format!("sha256:{:x}", digest.finalize()))
}

fn pragma_u64(connection: &Connection, name: &str) -> anyhow::Result<u64> {
    let allowed = ["page_size"];
    ensure!(allowed.contains(&name), "unsupported pragma {name}");
    connection
        .query_row(&format!("PRAGMA {name}"), [], |row| row.get(0))
        .with_context(|| format!("read PRAGMA {name}"))
}

fn file_len(path: &Path) -> anyhow::Result<u64> {
    Ok(fs::metadata(path)
        .with_context(|| format!("stat {}", path.display()))?
        .len())
}

fn file_len_or_zero(path: &Path) -> anyhow::Result<u64> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(metadata.len()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(error).with_context(|| format!("stat {}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn held_snapshot_feeds_backup_and_independent_scan() {
        let report = run().expect("OQ13 spike");
        assert_eq!(report.result.pinned_version, report.result.copied_version);
        assert_eq!(report.result.pinned_digest, report.result.copied_digest);
        assert_ne!(
            report.result.pinned_digest,
            report.result.live_digest_after_writer
        );
        assert!(report.result.writer_commits > 0);
        assert!(report.result.wal_growth_bytes > 0);
        assert_eq!(report.result.wal_bytes_after_release_and_truncate, 0);
    }
}
