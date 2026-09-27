mod common;
#[path = "residency_open/mod.rs"]
mod opening;
use common::*;
use serde_json::{Value as Json, json};
use snapback4_device::{call::call, native::Device};

thread_local! {
    static STATEMENTS: std::cell::RefCell<Vec<(String, i32)>> = const { std::cell::RefCell::new(Vec::new()) };
}

fn report_without_row_reads(device: &mut Device) -> Json {
    use rusqlite::{hooks::{AuthAction, AuthContext, Authorization}, trace::{TraceEvent, TraceEventCodes}, StatementStatus};
    let row_reads = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let captured = row_reads.clone();
    device.store().conn().authorizer(Some(move |ctx: AuthContext<'_>| {
        if let AuthAction::Read { table_name: "r", column_name } = ctx.action {
            captured.lock().unwrap().push(column_name.to_owned());
        }
        Authorization::Allow
    })).unwrap();
    STATEMENTS.with(|statements| statements.borrow_mut().clear());
    device.store().conn().trace_v2(TraceEventCodes::SQLITE_TRACE_PROFILE, Some(|event| {
        if let TraceEvent::Profile(statement, _) = event {
            STATEMENTS.with(|statements| statements.borrow_mut().push((statement.sql().into_owned(), statement.get_status(StatementStatus::FullscanStep))));
        }
    }));
    let measured = report(device);
    device.store().conn().trace_v2(TraceEventCodes::empty(), None);
    device.store().conn().authorizer(None::<fn(AuthContext<'_>) -> Authorization>).unwrap();
    let statements = STATEMENTS.with(|statements| std::mem::take(&mut *statements.borrow_mut()));
    println!("residency statements: {statements:?}");
    assert!(!statements.is_empty(), "the real read must be traced");
    assert!(row_reads.lock().unwrap().is_empty(), "residency read the partition: {statements:?}");
    assert!(statements.iter().all(|(_, steps)| *steps == 0), "residency scanned rows: {statements:?}");
    measured
}

fn report(device: &mut Device) -> Json {
    let reply = call(device, json!({"op": "residency"}));
    assert!(reply.get("denied").is_none(), "{reply}");
    reply["ok"].clone()
}

fn check_rows(device: &mut Device) -> Json {
    let measured = report(device);
    for (name, _) in device.schema().visible_tables() {
        let rows = device.store().rows(name).unwrap();
        let bytes: usize = rows.iter().map(|r| snapback4_core::value::canonical_json(r).len()).sum();
        assert_eq!(measured["tables"][name], json!({"rows":rows.len(), "bytes":bytes}), "{name}");
    }
    assert_eq!(measured["totalBytesKind"], "sqlite-pages");
    let conn = device.store().conn();
    let pages: i64 = conn.query_row("PRAGMA page_count", [], |r| r.get(0)).unwrap();
    let page_size: i64 = conn.query_row("PRAGMA page_size", [], |r| r.get(0)).unwrap();
    assert_eq!(measured["totalBytes"], pages * page_size);
    assert!(measured.get("wasmHeapBytes").is_none());
    measured
}

#[test]
fn sqlite_residency_tracks_unicode_rollback_clear_and_other_owners() {
    let (mut server, backend) = server();
    let host = Sqlite::new("residency");
    let path = host.path("store");
    let mut device = Device::open(&path, Some(backend)).unwrap();
    assert_eq!(check_rows(&mut device)["tables"]["messages"]["rows"], 0);
    for (n, page) in snapshot_pages(&mut server, "dev:alice", 100).iter().enumerate() {
        device.apply(page, n == 0).unwrap();
    }
    let before = check_rows(&mut device);
    assert_eq!(before["tables"]["messages"]["rows"], 120);
    let mut other = Device::open(&path, None).unwrap();
    other.store().conn().execute_batch("BEGIN IMMEDIATE; UPDATE r SET data = replace(data, 'General', '🦀é'); SAVEPOINT discard; DELETE FROM r; ROLLBACK TO discard; RELEASE discard; COMMIT;").unwrap();
    let after = check_rows(&mut device);
    assert_eq!(after["tables"]["conversations"]["bytes"].as_u64().unwrap() + 1, before["tables"]["conversations"]["bytes"].as_u64().unwrap());
    assert_eq!(after["tables"], check_rows(&mut other)["tables"]);
    device.store().conn().execute_batch("BEGIN IMMEDIATE; DELETE FROM r; ROLLBACK").unwrap();
    assert_eq!(after["tables"], check_rows(&mut device)["tables"]);
    let cleared = call(&mut other, json!({"op":"clear_rows"}));
    assert!(cleared.get("denied").is_none(), "{cleared}");
    assert_eq!(check_rows(&mut device)["tables"]["messages"]["rows"], 0);
    // A second owner adopts a different catalog; the first must not report
    // counters through its obsolete schema even when both handles remain open.
    let mut next = other.backend();
    next.generation += 1;
    let table = next.schema.tables.remove("messages").unwrap();
    next.schema.tables.insert("widgets".into(), table);
    other.adopt(next).unwrap();
    let stale = call(&mut device, json!({"op":"residency"}));
    assert_eq!(stale["denied"]["code"], "E_GENERATION", "{stale}");
    let current = check_rows(&mut other);
    assert!(current["tables"].get("widgets").is_some());
    assert!(current["tables"].get("messages").is_none());
    drop(device); drop(other);
    check_rows(&mut Device::open(&path, None).unwrap());
}

#[cfg(unix)]
#[test]
fn shared_sidecar_lock_allows_device_commits_and_reopen() {
    use std::{fs::{self, OpenOptions}, os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt}};
    let (mut server, backend) = server();
    let host = Sqlite::new("residency-sidecar");
    let path = host.path("store");
    let sidecar = std::path::PathBuf::from(format!("{}-owner", path.display()));
    let lock = OpenOptions::new().read(true).write(true).create_new(true).mode(0o600).open(&sidecar).unwrap();
    lock.try_lock_shared().unwrap();
    // Darwin makes flock conflict with SQLite's fcntl locks on the same inode.
    // Keep this independent shared owner alive through initialization, durable
    // sync writes and reopening, so the regression also runs on macOS/iOS.
    let mut device = Device::open(&path, Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut server, "dev:alice", 100).iter().enumerate() {
        device.apply(page, n == 0).unwrap();
    }
    let expected = check_rows(&mut device);
    assert_eq!(expected["tables"]["messages"]["rows"], 120);
    let database = fs::metadata(&path).unwrap();
    let owner = fs::metadata(&sidecar).unwrap();
    assert_ne!((database.dev(), database.ino()), (owner.dev(), owner.ino()));
    assert_eq!(owner.permissions().mode() & 0o777, 0o600);
    drop(device);
    let mut reopened = Device::open(&path, None).unwrap();
    assert_eq!(check_rows(&mut reopened)["tables"], expected["tables"]);
    drop(reopened);
    drop(lock);
}

#[test]
fn old_large_store_upgrades_once_and_reports_without_a_partition_scan() {
    let (_, backend) = server();
    let host = Sqlite::new("residency-upgrade");
    let path = host.path("store");
    let device = Device::open(&path, Some(backend)).unwrap();
    device.store().conn().execute_batch("DROP TRIGGER _device_residency_insert; DROP TRIGGER _device_residency_delete; DROP TRIGGER _device_residency_update; DROP TABLE _device_residency;").unwrap();
    let tx = device.store().conn().unchecked_transaction().unwrap();
    let t: i64 = tx.query_row("SELECT num FROM _catalog WHERE name = 'messages'", [], |r| r.get(0)).unwrap();
    for n in 0..20_000 {
        tx.execute("INSERT INTO r VALUES (?1, ?2, ?3)", rusqlite::params![t, n.to_string(), "{\"Object\":{\"body\":{\"String\":\"é🦀\"}}}"]).unwrap();
    }
    tx.commit().unwrap(); drop(device);
    let mut device = Device::open(&path, None).unwrap();
    // No row images are decoded and the report is independent of row count.
    let expected = report_without_row_reads(&mut device);
    assert_eq!(expected["tables"]["messages"]["rows"], 20_000);
    let size = "{\"Object\":{\"body\":{\"String\":\"é🦀\"}}}".len() * 20_000;
    assert_eq!(expected["tables"]["messages"]["bytes"], size);
    drop(device);
    assert_eq!(report_without_row_reads(&mut Device::open(&path, None).unwrap())["tables"], expected["tables"]);
}

#[test]
fn incomplete_counter_installation_is_rebuilt_before_the_next_read_or_write() {
    for missing in ["all", "insert", "delete", "update"] {
        let (mut server, backend) = server();
        let host = Sqlite::new(&format!("residency-partial-{missing}"));
        let path = host.path("store");
        let mut device = Device::open(&path, Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut server, "dev:alice", 100).iter().enumerate() {
            device.apply(page, n == 0).unwrap();
        }
        let expected = check_rows(&mut device);
        // The durable state an incorrectly split installation would leave at
        // a crash: the counter table exists, but not every trigger does.
        for trigger in ["insert", "delete", "update"] {
            if missing == "all" || missing == trigger {
                device.store().conn().execute_batch(&format!("DROP TRIGGER _device_residency_{trigger}")).unwrap();
            }
        }
        device.store().conn().execute("UPDATE _device_residency SET rows = 999, bytes = 1", []).unwrap();
        drop(device);
        let mut device = Device::open(&path, None).unwrap();
        assert_eq!(check_rows(&mut device)["tables"], expected["tables"], "missing {missing}");
        // All three repaired triggers must maintain subsequent changes, not
        // merely return the correct backfilled snapshot once.
        device.store().conn().execute_batch("INSERT INTO r SELECT t, 'extra', data FROM r WHERE id = 'msg000';").unwrap();
        assert_eq!(check_rows(&mut device)["tables"]["messages"]["rows"], 121);
        device.store().conn().execute_batch("UPDATE r SET data = replace(data, 'General', '🦀é')").unwrap();
        check_rows(&mut device);
        device.store().conn().execute_batch("DELETE FROM r WHERE id = 'extra'").unwrap();
        assert_eq!(check_rows(&mut device)["tables"]["messages"]["rows"], 120);
        let repaired = check_rows(&mut device);
        drop(device);
        assert_eq!(report_without_row_reads(&mut Device::open(&path, None).unwrap())["tables"], repaired["tables"]);
    }
}

#[cfg(unix)]
#[test]
fn removed_sidecar_leaves_live_native_device_usable_documented_boundary() {
    let (_, backend) = server();
    let host = Sqlite::new("residency-unlinked-owner");
    let path = host.path("store");
    let mut first = Device::open(&path, Some(backend)).unwrap();
    std::fs::remove_file(snapback4_core::private_fs::owner_path(&path)).unwrap();
    // @ref LLP 3000.019#3.4 — removal does not revoke an already-open native device.
    check_rows(&mut first);
    let mut second = Device::open(&path, None).unwrap();
    check_rows(&mut second);
    let cleared = call(&mut second, json!({"op":"clear_rows"}));
    assert!(cleared.get("denied").is_none(), "{cleared}");
    let cleared = call(&mut first, json!({"op":"clear_rows"}));
    assert!(cleared.get("denied").is_none(), "{cleared}");
}

#[test]
fn legacy_counters_stay_temporary_until_adoption_and_follow_other_owners() {
    let (mut server, backend) = server();
    let host = Sqlite::new("residency-legacy");
    let path = host.path("store");
    let mut device = Device::open(&path, Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut server, "dev:alice", 100).iter().enumerate() {
        device.apply(page, n == 0).unwrap();
    }
    let expected = check_rows(&mut device);
    device.store().conn().execute_batch("DROP TRIGGER _device_residency_insert; DROP TRIGGER _device_residency_delete; DROP TRIGGER _device_residency_update; DROP TABLE _device_residency;").unwrap();
    drop(device);
    let before = std::fs::read(&path).unwrap();
    let mut device = Device::open(&path, None).unwrap();
    assert_eq!(report_without_row_reads(&mut device)["tables"], expected["tables"]);
    let mut future = device.backend();
    future.schema.tables.values_mut().next().unwrap().constraints.push(snapback4_core::schema::Constraint::Capabilities(["future-residency-test".into()].into()));
    let refused = call(&mut device, json!({"op":"adopt", "backend":future}));
    assert_eq!(refused["denied"]["code"], "E_SCHEMA_CAPABILITY", "{refused}");
    drop(device);
    assert_eq!(std::fs::read(&path).unwrap(), before, "open, inspection and refused adoption preserve legacy bytes");

    let mut device = Device::open(&path, None).unwrap();
    let other = Device::open(&path, None).unwrap();
    other.store().conn().execute_batch("INSERT INTO r SELECT t, 'extra', data FROM r WHERE id = 'msg000';").unwrap();
    assert_eq!(check_rows(&mut device)["tables"]["messages"]["rows"], 121);
    // Refresh only after a peer commit, never on each subsequent inspection.
    assert_eq!(report_without_row_reads(&mut device)["tables"]["messages"]["rows"], 121);
    device.store().conn().execute_batch("DELETE FROM r WHERE id = 'extra';").unwrap();
    assert_eq!(report_without_row_reads(&mut device)["tables"]["messages"]["rows"], 120);
    let durable: i64 = device.store().conn().query_row("SELECT count(*) FROM main.sqlite_master WHERE name = '_device_residency'", [], |r| r.get(0)).unwrap();
    assert_eq!(durable, 0);
    drop(other);
    let mut next = device.backend(); next.generation += 1;
    device.adopt(next).unwrap();
    let durable: i64 = device.store().conn().query_row("SELECT count(*) FROM main.sqlite_master WHERE name = '_device_residency'", [], |r| r.get(0)).unwrap();
    assert_eq!(durable, 1, "successful adoption installs durable counters");
    let temporary: i64 = device.store().conn().query_row("SELECT count(*) FROM temp.sqlite_master WHERE name LIKE '_device_residency%'", [], |r| r.get(0)).unwrap();
    assert_eq!(temporary, 0, "promotion removes temp triggers as well as their table");
    device.store().conn().execute_batch("INSERT INTO r VALUES ((SELECT num FROM _catalog WHERE name = 'messages'), 'after', '{\"Row\":{}}');").unwrap();
    check_rows(&mut device); // A leftover temp trigger would count this twice.
}
