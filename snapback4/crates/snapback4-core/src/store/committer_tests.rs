//! SQLite witnesses for the member boundary, independent of engine producers.
use super::*;
use crate::rows::Rows;

#[test]
fn two_members_keep_the_first_on_second_rollback_drop_or_error() {
    for mode in ["rollback", "drop", "error"] {
        let mut store = AnyStore::memory().unwrap();
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
                // Keep a released nonzero counter across the next member.
                member.set_sequence("parents", "kept", 7)?;
                member.complete(1)
            }),
        )
        .unwrap();
        assert!(matches!(
            first,
            Disposition {
                end: Frame::Complete,
                value: 1
            }
        ));
        assert!(
            !tx.conn().is_autocommit(),
            "RELEASE is not a physical commit"
        );
        tx.changes.borrow_mut().widen();
        assert!(tx.change_footprint().unknown);
        let second = Committer::execute(
            &tx,
            Member::new(Kind::Engine, |member| {
                assert!(!member.change_footprint().unknown);
                assert_eq!(member.meta("kept")?.as_deref(), Some("first"));
                member.set_meta("kept", "overwritten")?;
                member.set_meta("discarded", "second")?;
                member.pin_time_audience_clock(20)?;
                member.set_sequence("parents", "p", 100)?;
                member.set_sequence("parents", "kept", 100)?;
                // Leave an inner frame open: member rollback must discard it too.
                member.savepoint("job_chunk")?;
                member.set_meta("inner_discarded", "second")?;
                match mode {
                    "rollback" => member.rollback(2),
                    "drop" => {
                        drop(member);
                        Ok(Disposition {
                            end: Frame::Abort,
                            value: 2,
                        })
                    }
                    _ => Err(RuntimeError::Store("body failed".into())),
                }
            }),
        );
        if mode == "error" {
            assert!(second.is_err());
        } else {
            assert!(matches!(
                second.unwrap(),
                Disposition {
                    end: Frame::Abort,
                    value: 2
                }
            ));
        }
        assert!(!tx.conn().is_autocommit());
        assert_eq!(tx.sequence_value("parents", "p").unwrap(), 0);
        assert_eq!(tx.sequence_value("parents", "kept").unwrap(), 7);
        // The counter released by member 1 survives member 2's rollback.
        // Inner frame rollbacks above separately exercise lazy-table repair.
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
        let mut store = AnyStore::memory().unwrap();
        let result = Committer::run(
            &mut store,
            Member::new(Kind::Direct, |tx| {
                tx.pin_time_audience_clock(30)?;
                tx.set_meta("discarded", "body")?;
                match mode {
                    "rollback" => tx.rollback(7),
                    "drop" => tx.abort(7),
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
fn failed_abort_keeps_the_rollback_cause_and_runs_no_continuation() {
    for code in [rusqlite::ffi::SQLITE_BUSY, rusqlite::ffi::SQLITE_IOERR] {
        for explicit in [false, true] {
            let failure = || {
                rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(code),
                    Some("injected member rollback failure".into()),
                )
            };
            let expected = RuntimeError::Sql(failure());
            let mut store = AnyStore::memory().unwrap();
            let mut continued = false;
            let error = Committer::run_with(
                &mut store,
                |store| {
                    Committer::run_pending(
                        store,
                        Member::new(Kind::Engine, |tx| {
                            tx.set_meta("failed_abort", "discard")?;
                            tx.pin_time_audience_clock(30)?;
                            tx.rollback_failure.set(Some(RuntimeError::Sql(failure())));
                            if explicit {
                                tx.rollback(Pending::value(7))
                            } else {
                                tx.abort(Pending::value(7))
                            }
                        }),
                    )
                },
                |_, (), value| {
                    continued = true;
                    Ok(value)
                },
            )
            .unwrap_err();
            assert!(matches!(&error, RuntimeError::Sql(source)
                if source.sqlite_error().unwrap().extended_code == code));
            assert!(
                std::error::Error::source(&error)
                    .unwrap()
                    .is::<rusqlite::Error>()
            );
            assert_eq!(error.to_string(), expected.to_string());
            assert_eq!(error.refusal(), expected.refusal());
            assert_eq!(error.is_busy(), code == rusqlite::ffi::SQLITE_BUSY);
            assert!(!continued);
            assert!(store.conn().is_autocommit());
            assert_eq!(store.meta("failed_abort").unwrap(), None);
            assert_eq!(store.meta("time_audience_clock").unwrap(), None);
        }
    }
}

#[test]
fn acknowledgement_and_follow_on_writer_run_after_physical_commit() {
    let mut store = AnyStore::memory().unwrap();
    let value = Committer::run_with(
        &mut store,
        |store| {
            Committer::run_pending(
                store,
                Member::new(Kind::Engine, |tx| {
                    tx.set_meta("first", "committed")?;
                    tx.complete(Pending::new(7, String::from("first")))
                }),
            )
        },
        |store, key, value| {
            assert!(store.conn().is_autocommit());
            assert_eq!(store.meta(&key)?.as_deref(), Some("committed"));
            // A follow-on publication is submitted only after the first COMMIT.
            Committer::run(
                store,
                Member::new(Kind::Publication, |tx| {
                    assert_eq!(tx.meta(&key)?.as_deref(), Some("committed"));
                    tx.set_meta("second", "committed")?;
                    tx.complete(())
                }),
            )?;
            Ok(value)
        },
    )
    .unwrap();
    assert_eq!(value, 7);
    assert_eq!(store.meta("second").unwrap().as_deref(), Some("committed"));
}

#[test]
fn failed_physical_commit_has_no_acknowledgement_or_hook() {
    let mut store = AnyStore::memory().unwrap();
    store
        .conn()
        .execute_batch(
            "PRAGMA foreign_keys = ON;
        CREATE TABLE parent(id INTEGER PRIMARY KEY);
        CREATE TABLE child(id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER fail_commit AFTER INSERT ON _meta WHEN NEW.key = 'deferred_child'
        BEGIN INSERT INTO child VALUES (1); END;",
        )
        .unwrap();
    let hooked = Cell::new(false);
    let released = Cell::new(false);
    let result = Committer::run_with(
        &mut store,
        |store| {
            Committer::run_pending(
                store,
                Member::new(Kind::Engine, |tx| {
                    tx.pin_time_audience_clock(40)?;
                    tx.set_meta("deferred_child", "1")?;
                    let complete = tx.complete(Pending::value(()))?;
                    released.set(true);
                    Ok(complete) // Only physical COMMIT refuses.
                }),
            )
        },
        |_, (), ()| {
            hooked.set(true);
            Ok(())
        },
    );
    assert!(released.get(), "the member savepoint release must succeed");
    assert!(
        matches!(result, Err(RuntimeError::Sql(ref error)) if error.to_string().contains("FOREIGN KEY constraint failed"))
    );
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

#[test]
fn contradictory_dispositions_are_rejected_before_commit() {
    for end in [Frame::Complete, Frame::Abort] {
        let mut store = AnyStore::memory().unwrap();
        let result = Committer::run(
            &mut store,
            Member::new(Kind::Engine, |tx| {
                tx.set_meta("contradiction", "must not survive")?;
                if end == Frame::Complete {
                    drop(tx);
                } else {
                    tx.complete(())?;
                }
                // Only this child test module can forge a private disposition.
                Ok(Disposition { end, value: () })
            }),
        );
        assert!(
            matches!(result, Err(RuntimeError::Store(ref message)) if message == "member disposition contradicts its frame")
        );
        assert!(store.conn().is_autocommit());
        assert_eq!(store.meta("contradiction").unwrap(), None);
    }
}

#[test]
fn facade_has_no_owner_connection_or_physical_control() {
    // An implemented Deref/AsRef makes the type parameter ambiguous, failing
    // compilation. Inherent escape methods shadow the marker fallback below
    // and also fail the typed assignments. This checks the actual facade.
    trait Ambiguous<A> {
        fn absent() {}
    }
    impl<T: ?Sized> Ambiguous<()> for T {}
    struct DerefEscape;
    impl<T: std::ops::Deref> Ambiguous<DerefEscape> for T {}
    struct RefEscape;
    impl<'a, T: AsRef<AnyTx<'a>>> Ambiguous<RefEscape> for T {}
    struct BorrowEscape;
    impl<'a, T: std::borrow::Borrow<AnyTx<'a>>> Ambiguous<BorrowEscape> for T {}
    let _ = <MemberTx<'_, '_> as Ambiguous<_>>::absent;

    struct Missing;
    trait Escapes {
        fn conn(&self) -> Missing {
            Missing
        }
        fn abandon(&self) -> Missing {
            Missing
        }
        fn commit(&self) -> Missing {
            Missing
        }
    }
    impl Escapes for MemberTx<'_, '_> {}
    let mut store = AnyStore::memory().unwrap();
    Committer::run(
        &mut store,
        Member::new(Kind::Direct, |tx| {
            let _: Missing = tx.conn();
            let _: Missing = tx.abandon();
            let _: Missing = tx.commit();
            for name in ["member", "member; COMMIT", "program; ROLLBACK", "other"] {
                assert!(tx.savepoint(name).is_err());
                assert!(tx.release(name).is_err());
                assert!(tx.rollback_to(name).is_err());
            }
            tx.complete(())
        }),
    )
    .unwrap();
}

#[test]
fn two_committed_continuations_run_in_submission_order_despite_failure() {
    fn member(
        id: u8,
    ) -> Member<impl FnOnce(MemberTx<'_, '_>) -> MemberResult<Pending<u8, String>>> {
        Member::new(Kind::Engine, move |tx| {
            tx.set_meta(&id.to_string(), "durable")?;
            tx.complete(Pending::new(id, format!("member {id}")))
        })
    }
    let mut store = AnyStore::memory().unwrap();
    let mut seen = Vec::new();
    let results =
        Committer::run_batch_with(&mut store, [member(1), member(2)], |store, data, id| {
            assert!(store.conn().is_autocommit());
            assert_eq!(store.meta("1")?.as_deref(), Some("durable"));
            assert_eq!(store.meta("2")?.as_deref(), Some("durable"));
            seen.push(data);
            if id == 1 {
                Err(RuntimeError::Store("follow-up failed".into()))
            } else {
                Ok(id)
            }
        })
        .unwrap();
    assert_eq!(seen, ["member 1", "member 2"]);
    assert!(
        matches!(&results[0], Err(RuntimeError::Continuation(source)) if source.to_string() == "E_STORE: follow-up failed")
    );
    assert_eq!(results[1].as_ref().unwrap(), &2);
    assert_eq!(store.meta("1").unwrap().as_deref(), Some("durable"));
}

#[test]
fn normal_abort_runs_no_continuation() {
    let mut store = AnyStore::memory().unwrap();
    let mut ran = false;
    let value = Committer::run_with(
        &mut store,
        |store| {
            Committer::run_pending(
                store,
                Member::new(Kind::Direct, |tx| {
                    tx.set_meta("aborted", "discard")?;
                    tx.abort(Pending::new(7, String::from("unused")))
                }),
            )
        },
        |_, _, value| {
            ran = true;
            Ok(value)
        },
    )
    .unwrap();
    assert_eq!(value, 7);
    assert!(!ran);
    assert_eq!(store.meta("aborted").unwrap(), None);
}

#[test]
fn continuation_failure_keeps_the_original_error_policy_and_durable_writes() {
    let mut store = AnyStore::memory().unwrap();
    let expected = RuntimeError::TimeAudiencePending;
    let result = Committer::run_with(
        &mut store,
        |store| {
            Committer::run_pending(
                store,
                Member::new(Kind::Engine, |tx| {
                    tx.set_meta("durable", "yes")?;
                    tx.complete(Pending::value(()))
                }),
            )
        },
        |_, (), ()| Err(RuntimeError::TimeAudiencePending),
    );
    let error = result.unwrap_err();
    assert!(matches!(error, RuntimeError::Continuation(_)));
    assert!(matches!(error.underlying(), RuntimeError::TimeAudiencePending));
    assert_eq!(error.to_string(), expected.to_string());
    assert_eq!(error.refusal(), expected.refusal());
    assert_eq!(error.is_refusal(), expected.is_refusal());
    assert_eq!(error.is_busy(), expected.is_busy());
    assert_eq!(store.meta("durable").unwrap().as_deref(), Some("yes"));
}

#[test]
fn variant_classification_strips_nested_continuation_wrappers() {
    let error = RuntimeError::Continuation(Box::new(RuntimeError::Continuation(Box::new(
        RuntimeError::Generation("changed during follow-up".into()),
    ))));
    assert!(
        matches!(error.underlying(), RuntimeError::Generation(message)
        if message == "changed during follow-up")
    );
    let error = RuntimeError::Continuation(Box::new(RuntimeError::Sql(
        rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY), None),
    )));
    assert!(matches!(error.underlying(), RuntimeError::Sql(_)));
    assert!(error.is_busy());
    assert!(matches!(error, RuntimeError::Continuation(_)));
}

#[test]
fn failed_batch_commit_runs_neither_continuation() {
    let mut store = AnyStore::memory().unwrap();
    store
        .conn()
        .execute_batch(
            "PRAGMA foreign_keys = ON;
        CREATE TABLE parent(id INTEGER PRIMARY KEY);
        CREATE TABLE child(id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER fail_batch_commit AFTER INSERT ON _meta WHEN NEW.key = '2'
        BEGIN INSERT INTO child VALUES (1); END;",
        )
        .unwrap();
    let members = [1, 2].map(|id| {
        Member::new(Kind::Engine, move |tx| {
            tx.set_meta(&id.to_string(), "provisional")?;
            tx.complete(Pending::new(id, String::from("must not run")))
        })
    });
    let mut ran = Vec::new();
    let result = Committer::run_batch_with(&mut store, members, |_, data, id| {
        ran.push(data);
        Ok(id)
    });
    assert!(
        matches!(result, Err(RuntimeError::Sql(ref error)) if error.to_string().contains("FOREIGN KEY constraint failed"))
    );
    assert!(ran.is_empty());
    assert!(store.conn().is_autocommit());
    assert_eq!(store.meta("1").unwrap(), None);
    assert_eq!(store.meta("2").unwrap(), None);
}
