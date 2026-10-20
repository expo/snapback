//! SQLite witnesses for the member boundary, independent of engine producers.
use super::*;
use crate::rows::Rows;

#[test]
fn two_members_keep_the_first_on_second_rollback_drop_or_error() {
    for mode in ["rollback", "drop", "error"] {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        let first = Committer::execute(
            &tx,
            Member::new(Kind::Program, |member| {
                member.set_meta("kept", "first")?;
                member.pin_time_audience_clock(10)?;
                // Exercise all existing nested frame names, including lazy
                // sequence-table creation that must be invalidated on rollback.
                for name in ["program", "job_chunk", "timeline_chunk", "seed_sequences"] {
                    member.savepoint(name)?;
                    member.set_meta("nested_discard", name)?;
                    member.set_sequence("parents", "p", 99)?;
                    member.rollback_to(name)?;
                    assert_eq!(member.meta("nested_discard")?, None);
                    assert_eq!(member.sequence_value("parents", "p")?, 0);
                    member.savepoint(name)?;
                    member.set_meta(name, "kept")?;
                    member.release(name)?;
                }
                member.commit(1)
            }),
        )
        .unwrap();
        assert!(matches!(first, Disposition::Complete(1)));
        assert!(
            !tx.conn().is_autocommit(),
            "RELEASE is not a physical commit"
        );
        let second = Committer::execute(
            &tx,
            Member::new(Kind::Engine, |member| {
                assert!(!member.changes.borrow().footprint().unknown);
                assert_eq!(member.meta("kept")?.as_deref(), Some("first"));
                member.set_meta("kept", "overwritten")?;
                member.set_meta("discarded", "second")?;
                member.pin_time_audience_clock(20)?;
                member.set_sequence("parents", "p", 100)?;
                // Leave an inner frame open: member rollback must discard it too.
                member.savepoint("job_chunk")?;
                member.set_meta("inner_discarded", "second")?;
                match mode {
                    "rollback" => member.rollback(2),
                    "drop" => {
                        drop(member);
                        Ok(Disposition::Abort(2))
                    }
                    _ => Err(RuntimeError::Store("body failed".into())),
                }
            }),
        );
        if mode == "error" {
            assert!(second.is_err());
        } else {
            assert!(matches!(second.unwrap(), Disposition::Abort(2)));
        }
        assert!(!tx.conn().is_autocommit());
        assert_eq!(tx.sequence_value("parents", "p").unwrap(), 0);
        // A lazy sequence table created by the aborted member is gone;
        // the next use must recreate it rather than trust a stale cache.
        tx.set_sequence("parents", "p", 7).unwrap();
        tx.commit().unwrap();
        assert_eq!(store.meta("kept").unwrap().as_deref(), Some("first"));
        assert_eq!(
            store.meta("time_audience_clock").unwrap().as_deref(),
            Some("10")
        );
        for key in ["discarded", "inner_discarded", "nested_discard"] {
            assert_eq!(store.meta(key).unwrap(), None, "{mode}: {key}");
        }
        for key in ["program", "job_chunk", "timeline_chunk", "seed_sequences"] {
            assert_eq!(store.meta(key).unwrap().as_deref(), Some("kept"));
        }
    }
}

#[test]
fn normal_abort_and_error_discard_pins_and_metadata_in_the_solo_driver() {
    for mode in ["rollback", "drop", "error"] {
        let mut store = Store::memory().unwrap();
        let result = Committer::run(
            &mut store,
            Member::new(Kind::Direct, |tx| {
                tx.pin_time_audience_clock(30)?;
                tx.set_meta("discarded", "body")?;
                match mode {
                    "rollback" => tx.rollback(7),
                    "drop" => Ok(tx.abort(7)),
                    _ => Err(RuntimeError::Store("body failed".into())),
                }
            }),
        );
        assert_eq!(result.is_ok(), mode != "error");
        assert!(store.conn().is_autocommit());
        assert_eq!(store.meta("time_audience_clock").unwrap(), None);
        assert_eq!(store.meta("discarded").unwrap(), None);
    }
}

#[test]
fn acknowledgement_and_follow_on_writer_run_after_physical_commit() {
    let mut store = Store::memory().unwrap();
    let committed = Committer::run_committed(
        &mut store,
        Member::new(Kind::Engine, |tx| {
            tx.set_meta("first", "committed")?;
            tx.commit(7)
        }),
    )
    .unwrap();
    let value = committed
        .after_commit(|value| {
            assert!(store.conn().is_autocommit());
            assert_eq!(store.meta("first").unwrap().as_deref(), Some("committed"));
            // The sweep's follow-on publication also opens another transaction.
            Committer::run(
                &mut store,
                Member::new(Kind::Publication, |tx| {
                    tx.set_meta("second", "committed")?;
                    tx.commit(())
                }),
            )
            .unwrap();
            value
        })
        .into_inner();
    assert_eq!(value, 7);
    assert_eq!(store.meta("second").unwrap().as_deref(), Some("committed"));
}

#[test]
fn failed_physical_commit_has_no_acknowledgement_or_hook() {
    let mut store = Store::memory().unwrap();
    store
        .conn()
        .execute_batch(
            "PRAGMA foreign_keys = ON;
        CREATE TABLE parent(id INTEGER PRIMARY KEY);
        CREATE TABLE child(id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);",
        )
        .unwrap();
    let hooked = Cell::new(false);
    let released = Cell::new(false);
    let result = Committer::run_committed(
        &mut store,
        Member::new(Kind::Engine, |tx| {
            tx.pin_time_audience_clock(40)?;
            tx.conn().execute("INSERT INTO child VALUES (1)", [])?;
            let complete = tx.commit(())?;
            released.set(true);
            Ok(complete) // Only the physical COMMIT refuses.
        }),
    )
    .map(|committed| committed.after_commit(|()| hooked.set(true)));
    assert!(released.get(), "the member savepoint release must succeed");
    assert!(result.is_err());
    assert!(!hooked.get());
    assert!(store.conn().is_autocommit());
    assert_eq!(store.meta("time_audience_clock").unwrap(), None);
    assert_eq!(
        store
            .conn()
            .query_row("SELECT COUNT(*) FROM child", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
}
