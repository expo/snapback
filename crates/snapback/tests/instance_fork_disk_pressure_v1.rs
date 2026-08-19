//! LLP 0185 Phase 3 item 8: real disk-pressure evidence. A fork copy that
//! runs out of space mid-materialization must fail closed — an error, no
//! bootable half-fork, and staging residue that `recover` reaps exactly.
//!
//! macOS-only: the fixture is a tiny RAM disk (`hdiutil attach ram://`),
//! which needs no privileges. On other hosts the publication crash matrix
//! (`AfterClone` cut) remains the interrupted-copy evidence.

#![cfg(target_os = "macos")]

use std::path::PathBuf;
use std::process::Command;

struct RamDisk {
    device: String,
    mount_point: PathBuf,
}

impl RamDisk {
    /// ~4 MB RAM disk mounted under a unique name; None when the host
    /// refuses (CI sandbox, missing tools) — the test then skips honestly.
    fn create() -> Option<RamDisk> {
        let attach = Command::new("hdiutil")
            .args(["attach", "-nomount", "ram://8192"])
            .output()
            .ok()?;
        if !attach.status.success() {
            return None;
        }
        let device = String::from_utf8_lossy(&attach.stdout).trim().to_owned();
        if device.is_empty() {
            return None;
        }
        let volume = format!("SnapForkPressure{}", std::process::id());
        let erase = Command::new("diskutil")
            .args(["erasevolume", "HFS+", &volume, &device])
            .output()
            .ok()?;
        let mount_point = PathBuf::from(format!("/Volumes/{volume}"));
        if !erase.status.success() || !mount_point.is_dir() {
            let _ = Command::new("hdiutil").args(["detach", &device]).output();
            return None;
        }
        Some(RamDisk {
            device,
            mount_point,
        })
    }
}

impl Drop for RamDisk {
    fn drop(&mut self) {
        let _ = Command::new("hdiutil")
            .args(["detach", "-force", &self.device])
            .output();
    }
}

#[test]
fn out_of_space_copy_fails_closed_and_recover_reaps_the_staging_residue() {
    let Some(disk) = RamDisk::create() else {
        println!(
            "{{\"schemaVersion\":\"snapback.test-capability-receipt.v1\",\
             \"suite\":\"instance-fork-disk-pressure-v1\",\
             \"capability\":\"unprivileged-macos-ram-disk\",\
             \"status\":\"skipped\",\"executedCount\":0,\
             \"reason\":\"ram-disk-mount-unavailable\"}}"
        );
        return;
    };
    let directory = tempfile::tempdir().expect("parent fixture");
    let source = directory.path().join("parent.sqlite3");
    let parent = snapback::storage::LocalDatabase::open(&source).expect("parent database");
    drop(parent);
    {
        // Grow the parent well past the ~4 MB volume.
        let conn = snapback_services::test_support::rusqlite::Connection::open(&source)
            .expect("open parent");
        conn.execute_batch("CREATE TABLE ballast(id INTEGER PRIMARY KEY, bytes BLOB)")
            .expect("ballast table");
        for row in 0..8 {
            conn.execute(
                "INSERT INTO ballast(id, bytes) VALUES(?1, zeroblob(1048576))",
                [row],
            )
            .expect("insert ballast");
        }
    }

    let fork_root = disk.mount_point.join("forks");
    std::fs::create_dir(&fork_root).expect("fork root on pressured volume");
    let destination = fork_root.join("fork-pressure");
    let error = snapback::instance_fork::publish(
        &source,
        &destination,
        "pressure-app",
        "pressure-parent",
        42,
        None,
    )
    .expect_err("an out-of-space copy must fail, not truncate");
    // SQLite surfaces the full volume through the backup/mint path; the
    // exact code varies (disk I/O error vs database-full), but it is an
    // error — never a silently short fork.
    eprintln!("disk-pressure refusal: {}", error.diagnostic.code);

    assert!(
        !destination.exists(),
        "no half-published fork directory appears at the destination"
    );
    let staging_dirs = || {
        std::fs::read_dir(&fork_root)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .filter(|entry| {
                        entry
                            .file_name()
                            .to_string_lossy()
                            .starts_with(".fork-pressure.staging-")
                    })
                    .count()
            })
            .unwrap_or(0)
    };
    // Whatever staging residue the failure left is exactly what recover
    // reaps; afterwards the volume holds no fork state at all.
    snapback::instance_fork::recover(&fork_root, &destination).expect("recover after pressure");
    assert_eq!(staging_dirs(), 0, "recover reaps the interrupted staging");
    assert!(!destination.exists());

    // The pressured volume never damaged the parent.
    let conn = snapback_services::test_support::rusqlite::Connection::open(&source)
        .expect("reopen parent");
    let rows: u64 = conn
        .query_row("SELECT COUNT(*) FROM ballast", [], |row| row.get(0))
        .expect("parent intact");
    assert_eq!(rows, 8);
    println!(
        "{{\"schemaVersion\":\"snapback.test-capability-receipt.v1\",\
         \"suite\":\"instance-fork-disk-pressure-v1\",\
         \"capability\":\"unprivileged-macos-ram-disk\",\
         \"status\":\"executed\",\"executedCount\":1,\"reason\":null}}"
    );
}
