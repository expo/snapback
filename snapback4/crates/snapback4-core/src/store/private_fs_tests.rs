use super::*;
use std::{os::fd::AsRawFd, process::Command};

#[test]
fn post_open_database_alias_retains_descriptor_and_posix_lock() {
    for renamed in [false, true] {
        let dir = std::env::temp_dir().join(format!(
            "snapback4-aux-race-{}-{renamed}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let database = dir.join("store.sqlite");
        let conn = rusqlite::Connection::open(&database).unwrap();
        conn.execute_batch("CREATE TABLE t(n); BEGIN IMMEDIATE")
            .unwrap();
        let before = fs::symlink_metadata(&database).unwrap();
        let target = owner_path(&database);
        if renamed {
            fs::rename(&database, &target).unwrap();
        } else {
            fs::hard_link(&database, &target).unwrap();
        }
        // Deterministically inject the descriptor a raced open returns.
        // An unlimited length isolates the inode/link checks from size.
        let file = File::open(&target).unwrap();
        let fd = file.as_raw_fd();
        assert!(checked_auxiliary(file, &database, Some(&before), u64::MAX).is_err());
        assert!(
            fs::metadata(format!("/dev/fd/{fd}")).is_ok(),
            "refusal must forget, never close"
        );
        let out = Command::new("python3")
            .args([
                "-c",
                r#"
import errno, fcntl, os, sys
f = os.open(sys.argv[1], os.O_RDWR)
try:
    fcntl.lockf(f, fcntl.LOCK_EX | fcntl.LOCK_NB, 1, 1073741825)
except OSError as error:
    if error.errno in (errno.EACCES, errno.EAGAIN):
        sys.exit(0)
    raise
sys.exit('SQLite reserved lock was dropped')
"#,
            ])
            .arg(&target)
            .output()
            .unwrap();
        assert!(out.status.success(), "{out:?}");
        conn.execute_batch("ROLLBACK").unwrap();
        drop(conn);
        // The refused descriptor intentionally lives until test-process exit.
        fs::remove_dir_all(dir).unwrap();
    }
}
