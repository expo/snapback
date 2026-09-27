use super::*;

fn install(conn: &Connection) -> Result<(), RuntimeError> {
    let tx = rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)?;
    install_in(&tx, true)?;
    Ok(tx.commit()?)
}
use std::{sync::{Arc, atomic::{AtomicBool, Ordering}, mpsc}, time::Duration};

#[test]
fn interrupted_installation_is_one_transaction_and_excludes_a_competing_installer() {
    let path = std::env::temp_dir().join(format!("snapback4-residency-install-{}.sqlite", std::process::id()));
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TABLE r (t INTEGER, id TEXT, data TEXT, PRIMARY KEY(t, id)); INSERT INTO r VALUES (1, 'a', 'é');").unwrap();
    let (reached, at_trigger) = mpsc::channel();
    let (resume, resumed) = mpsc::channel();
    let (retry, retried) = mpsc::channel();
    let other_path = path.clone();
    let competitor = std::thread::spawn(move || {
        at_trigger.recv_timeout(Duration::from_secs(10)).unwrap();
        let other = Connection::open(other_path).unwrap();
        other.busy_timeout(Duration::ZERO).unwrap();
        let visible: i64 = other.query_row("SELECT count(*) FROM sqlite_master WHERE name = '_device_residency'", [], |r| r.get(0)).unwrap();
        assert_eq!(visible, 0, "the counter table must not commit ahead of its triggers");
        let error = install(&other).unwrap_err();
        assert!(matches!(error, RuntimeError::Sql(ref e) if e.sqlite_error_code() == Some(rusqlite::ErrorCode::DatabaseBusy)), "{error}");
        resume.send(()).unwrap();
        retried.recv_timeout(Duration::from_secs(10)).unwrap();
        install(&other).unwrap();
        let counters: (i64, i64) = other.query_row("SELECT rows, bytes FROM _device_residency", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(counters, (1, 2));
        let triggers: i64 = other.query_row("SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'r'", [], |r| r.get(0)).unwrap();
        assert_eq!(triggers, 3);
    });
    let interrupted = Arc::new(AtomicBool::new(false));
    let flag = interrupted.clone();
    // This is the real installation, paused after backfill and interrupted at
    // its first trigger. No production fault switch or substitute SQL path.
    use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
    conn.authorizer(Some(move |ctx: AuthContext<'_>| {
        if matches!(ctx.action, AuthAction::CreateTrigger { trigger_name: "_device_residency_insert", .. }) {
            flag.store(true, Ordering::SeqCst);
            reached.send(()).unwrap();
            resumed.recv_timeout(Duration::from_secs(10)).unwrap();
            Authorization::Deny
        } else { Authorization::Allow }
    })).unwrap();
    assert!(install(&conn).is_err());
    conn.authorizer(None::<fn(AuthContext<'_>) -> Authorization>).unwrap();
    assert!(interrupted.load(Ordering::SeqCst));
    assert!(conn.is_autocommit(), "failed installation must roll back its transaction");
    let remnants: i64 = conn.query_row("SELECT count(*) FROM sqlite_master WHERE name LIKE '_device_residency%'", [], |r| r.get(0)).unwrap();
    assert_eq!(remnants, 0, "interruption must leave no committed partial installation");
    retry.send(()).unwrap();
    competitor.join().unwrap();
    drop(conn);
    std::fs::remove_file(path).unwrap();
}
