//! SQLite WAL-lifetime mechanics shared with replication services.

use rusqlite::Connection;

use crate::diagnostic::{SnapbackError, SnapbackResult};

pub const ENV_TARGET: &str = "SNAPBACK_REPLICATION_TARGET";

fn replication_error(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "replication", message.into())
}

pub fn configured_from_env() -> bool {
    std::env::var(ENV_TARGET)
        .ok()
        .is_some_and(|value| !value.trim().is_empty())
}

/// Prevent a Snapback-owned connection from performing SQLite's close-time
/// WAL checkpoint/removal while the LTX runtime owns the journal lifecycle.
// @ref LLP 0188#2-integration-point-the-whole-instance-database — the kernel
//   configures every connection while the service remains the replication owner.
pub fn configure_connection_wal_lifetime(conn: &Connection) -> SnapbackResult<()> {
    let mut enabled = 1_i32;
    // SAFETY: `conn.handle()` is valid for the call, `main` is a static
    // NUL-terminated schema name, and SQLite's PERSIST_WAL file-control takes
    // an `int *` that it consumes before returning.
    let rc = unsafe {
        rusqlite::ffi::sqlite3_file_control(
            conn.handle(),
            c"main".as_ptr(),
            rusqlite::ffi::SQLITE_FCNTL_PERSIST_WAL,
            std::ptr::from_mut(&mut enabled).cast(),
        )
    };
    if rc != rusqlite::ffi::SQLITE_OK {
        return Err(replication_error(
            "SNAPBACK_REPLICATION_DATABASE_UNAVAILABLE",
            format!(
                "configure persistent WAL on Snapback connection: enable persistent WAL failed, sqlite code={rc}"
            ),
        ));
    }
    Ok(())
}
