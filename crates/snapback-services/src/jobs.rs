//! Durable one-off background work — the first implementation slice of
//! LLP 0070's `durable-work-single-process-sqlite-v1` profile (the `runAfter`
//! case): transactional `ctx.jobs.enqueue` from mutations, a paved default
//! queue, `availableAt = now + delay`, fenced claims with append-only attempt
//! receipts, and a set-based injected-clock drain as the deterministic test
//! seam.
//!
//! Claim boundary (LLP 0070 §Non-goals): while LLP 0070 is Draft, nothing in
//! this module claims the `durable-work-single-process-sqlite-v1` tuple or any
//! durable-background-work capability class. The code exists to carry the
//! executable evidence the Draft needs; capability facts emitted anywhere must
//! say `experimental` and name the boundary.
//!
//! @ref LLP 0070#semantics — job identity/enqueue, state machine, claims and
//! fencing, and the jitter profile implemented here follow the RFC's §Semantics;
//! deliberate v1 narrowings are the RFC body's "First slice as shipped"
//! section (the 2026-07-31 amendment note, absorbed 2026-08-01).

pub(crate) use crate::storage::jobs::*;

#[cfg(test)]
use crate::diagnostic::Diagnostic;
#[cfg(test)]
use rusqlite::{Connection, params};
#[cfg(test)]
use serde_json::json;

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        create_jobs_infra(&conn).expect("jobs infra");
        conn
    }

    fn producer() -> JobProducer {
        JobProducer {
            mutation_id: "mut_test".into(),
            function: "reportIncident".into(),
            principal: Some("user_1".into()),
        }
    }

    fn enqueue(job_id: &str, available_at_ms: u64) -> BufferedJobEnqueue {
        BufferedJobEnqueue {
            job_id: job_id.into(),
            queue: JOBS_DEFAULT_QUEUE.into(),
            action: "notify".into(),
            args: json!({ "b": 2, "a": 1 }),
            idempotency_key: None,
            max_attempts: 1,
            available_at_ms,
            push_grant: None,
            rehearsal_provenance: None,
        }
    }

    #[test]
    fn canonical_args_sorts_keys_and_digests_stably() {
        let (bytes_a, digest_a) = canonical_args(&json!({ "b": 2, "a": 1 })).unwrap();
        let (bytes_b, digest_b) = canonical_args(&json!({ "a": 1, "b": 2 })).unwrap();
        assert_eq!(bytes_a, bytes_b);
        assert_eq!(bytes_a, "{\"a\":1,\"b\":2}");
        assert_eq!(digest_a, digest_b);
        let (_, different) = canonical_args(&json!({ "a": 1, "b": 3 })).unwrap();
        assert_ne!(digest_a, different);
    }

    #[test]
    fn retry_delay_is_deterministic_bounded_and_grows() {
        let first = retry_delay_ms("job_a", 1);
        assert_eq!(first, retry_delay_ms("job_a", 1));
        assert!(first >= JOBS_BACKOFF_BASE_MS);
        assert!(first <= JOBS_BACKOFF_BASE_MS + JOBS_JITTER_CEILING_MS);
        let seventh = retry_delay_ms("job_a", 7);
        assert!(seventh >= JOBS_BACKOFF_CAP_MS);
        assert!(seventh <= JOBS_BACKOFF_CAP_MS + JOBS_JITTER_CEILING_MS);
        // Distinct job identity shifts the jitter (same framing rule).
        assert_ne!(
            retry_delay_ms("job_a", 1) - JOBS_BACKOFF_BASE_MS,
            retry_delay_ms("job_b", 1) - JOBS_BACKOFF_BASE_MS,
            "jitter framing must include the canonical job id"
        );
    }

    #[test]
    fn deferred_push_grant_commits_and_claims_as_host_only_job_authority() {
        let conn = memory_conn();
        let mut job = enqueue("job_push", 0);
        job.push_grant = Some(crate::push::PushDeferredGrantV1 {
            producer_principal: "user_producer".into(),
            to: crate::push::PushAudienceReferenceV1 {
                audience: "eventGuests".into(),
                args: serde_json::Map::from_iter([("eventId".into(), json!("event_1"))]),
            },
            dedupe_key: "event:1:reminder".into(),
        });
        insert_enqueued_jobs_in_tx(&conn, &producer(), 1, &[job.clone()], 0)
            .expect("job and grant commit together");
        let stored: String = conn
            .query_row(
                "SELECT grant_json FROM _snapback_job_push_grants_v1 WHERE job_id = ?1",
                params![job.job_id],
                |row| row.get(0),
            )
            .expect("host-only grant row");
        assert!(!stored.contains("ExponentPushToken"));

        let mut ids = || "claim_push".to_owned();
        let claims = claim_due_jobs_in_tx(&conn, 0, 1, "forced-drain", &mut ids)
            .expect("claim deferred job");
        assert_eq!(claims.len(), 1);
        assert_eq!(claims[0].push_grant, job.push_grant);
    }

    #[test]
    fn claim_is_set_based_ordered_and_exactly_once() {
        let mut conn = memory_conn();
        let tx = conn.transaction().unwrap();
        insert_enqueued_jobs_in_tx(
            &tx,
            &producer(),
            7,
            &[
                enqueue("job_b", 100),
                enqueue("job_a", 100),
                enqueue("job_c", 200),
            ],
            50,
        )
        .unwrap();
        tx.commit().unwrap();

        let mut n = 0;
        let mut ids = move || {
            n += 1;
            format!("claim_{n}")
        };
        let tx = conn.transaction().unwrap();
        let claims =
            claim_due_jobs_in_tx(&tx, 150, JOBS_CLAIM_BATCH, "forced-drain", &mut ids).unwrap();
        tx.commit().unwrap();
        // Due set only, ordered by (available_at_ms, job_id bytes).
        assert_eq!(
            claims.iter().map(|c| c.job_id.as_str()).collect::<Vec<_>>(),
            vec!["job_a", "job_b"]
        );
        assert!(claims.iter().all(|c| c.fence == 1 && c.attempt == 1));

        // A second drain at the same instant claims nothing: attempts are fenced.
        let mut ids2 = || "claim_dup".to_owned();
        let tx = conn.transaction().unwrap();
        let again =
            claim_due_jobs_in_tx(&tx, 150, JOBS_CLAIM_BATCH, "forced-drain", &mut ids2).unwrap();
        tx.commit().unwrap();
        assert!(
            again.is_empty(),
            "claimed jobs must not be re-claimed under a live lease"
        );
    }

    #[test]
    fn stale_fence_cannot_publish_after_successor_claim() {
        let mut conn = memory_conn();
        let tx = conn.transaction().unwrap();
        let mut job = enqueue("job_x", 0);
        job.max_attempts = 3;
        insert_enqueued_jobs_in_tx(&tx, &producer(), 1, &[job], 0).unwrap();
        tx.commit().unwrap();

        let mut first_ids = || "claim_first".to_owned();
        let tx = conn.transaction().unwrap();
        let first = claim_due_jobs_in_tx(&tx, 0, JOBS_CLAIM_BATCH, "forced-drain", &mut first_ids)
            .unwrap()
            .remove(0);
        tx.commit().unwrap();

        // Lease expires; a successor drain re-claims with a greater fence and
        // terminally records the expired attempt.
        let mut second_ids = || "claim_second".to_owned();
        let tx = conn.transaction().unwrap();
        let second = claim_due_jobs_in_tx(
            &tx,
            JOBS_LEASE_MS + 1,
            JOBS_CLAIM_BATCH,
            "forced-drain",
            &mut second_ids,
        )
        .unwrap()
        .remove(0);
        tx.commit().unwrap();
        assert_eq!(second.attempt, 2);
        assert!(second.fence > first.fence);

        // The stale first claim publishes nothing.
        let tx = conn.transaction().unwrap();
        let disposition = finish_job_in_tx(
            &tx,
            &first,
            &JobAttemptOutcome::Succeeded,
            JOBS_LEASE_MS + 2,
        )
        .unwrap();
        tx.commit().unwrap();
        assert_eq!(disposition, JobFinishDisposition::StalePublication);
        let status = job_status_row(&conn, "job_x").unwrap().unwrap();
        assert_eq!(status.state, JobState::Claimed);

        // The successor publishes success.
        let tx = conn.transaction().unwrap();
        let disposition = finish_job_in_tx(
            &tx,
            &second,
            &JobAttemptOutcome::Succeeded,
            JOBS_LEASE_MS + 3,
        )
        .unwrap();
        tx.commit().unwrap();
        assert_eq!(disposition, JobFinishDisposition::Succeeded);
        let attempts = job_attempts(&conn, "job_x").unwrap();
        assert_eq!(attempts.len(), 2);
        assert_eq!(attempts[0].outcome.as_deref(), Some("lease_expired"));
        assert_eq!(attempts[1].outcome.as_deref(), Some("succeeded"));
    }

    // @ref LLP 0070#claims-and-fencing — a successor claim after process
    // restart must terminally receipt the expired attempt and advance its fence.
    #[test]
    fn file_backed_crash_reopen_expires_attempt_and_fences_successor() {
        let directory = tempfile::tempdir().expect("jobs fixture directory");
        let database_path = directory.path().join("jobs.sqlite");
        let first;

        {
            let mut conn = Connection::open(&database_path).expect("open file-backed sqlite");
            create_jobs_infra(&conn).expect("jobs infra");
            let tx = conn.transaction().unwrap();
            let mut job = enqueue("job_reopen", 100);
            job.max_attempts = 2;
            insert_enqueued_jobs_in_tx(&tx, &producer(), 7, &[job], 100).unwrap();
            tx.commit().unwrap();

            let mut first_ids = || "claim_before_crash".to_owned();
            let tx = conn.transaction().unwrap();
            first = claim_due_jobs_in_tx(
                &tx,
                100,
                JOBS_CLAIM_BATCH,
                "autonomous-worker",
                &mut first_ids,
            )
            .unwrap()
            .remove(0);
            tx.commit().unwrap();
            assert_eq!(first.attempt, 1);
            assert_eq!(first.fence, 1);

            // Model a process crash: close the only database connection while
            // attempt 1 remains claimed, with no finish publication.
        }

        let mut conn = Connection::open(&database_path).expect("reopen file-backed sqlite");
        create_jobs_infra(&conn).expect("idempotent jobs infra on reopen");

        let mut early_ids = || "claim_too_early".to_owned();
        let tx = conn.transaction().unwrap();
        let early = claim_due_jobs_in_tx(
            &tx,
            first.lease_expires_at_ms - 1,
            JOBS_CLAIM_BATCH,
            "autonomous-worker",
            &mut early_ids,
        )
        .unwrap();
        tx.commit().unwrap();
        assert!(
            early.is_empty(),
            "the persisted attempt keeps its live lease"
        );

        let mut second_ids = || "claim_after_reopen".to_owned();
        let tx = conn.transaction().unwrap();
        let second = claim_due_jobs_in_tx(
            &tx,
            first.lease_expires_at_ms,
            JOBS_CLAIM_BATCH,
            "autonomous-worker",
            &mut second_ids,
        )
        .unwrap()
        .remove(0);
        tx.commit().unwrap();
        assert_eq!(second.attempt, 2);
        assert_eq!(second.fence, first.fence + 1);
        assert_ne!(second.claim_id, first.claim_id);

        let attempts = job_attempts(&conn, "job_reopen").unwrap();
        assert_eq!(attempts.len(), 2);
        assert_eq!(attempts[0].attempt, 1);
        assert_eq!(attempts[0].fence, first.fence);
        assert_eq!(attempts[0].finished_at_ms, Some(first.lease_expires_at_ms));
        assert_eq!(attempts[0].outcome.as_deref(), Some("lease_expired"));
        assert_eq!(
            attempts[0].diagnostic_code.as_deref(),
            Some("SNAPBACK_JOB_LEASE_EXPIRED")
        );
        assert_eq!(attempts[1].attempt, 2);
        assert_eq!(attempts[1].fence, second.fence);
        assert_eq!(attempts[1].outcome, None);

        let status = job_status_row(&conn, "job_reopen").unwrap().unwrap();
        assert_eq!(status.state, JobState::Claimed);
        assert_eq!(status.attempt_count, 2);
        assert_eq!(status.max_attempts, 2);
        assert_eq!(status.state_version, 3);
        assert_eq!(status.terminal_at_ms, None);

        // The pre-crash holder has lost its fence even though its claim value
        // still exists in this test process.
        let tx = conn.transaction().unwrap();
        let stale = finish_job_in_tx(
            &tx,
            &first,
            &JobAttemptOutcome::Succeeded,
            first.lease_expires_at_ms + 1,
        )
        .unwrap();
        tx.commit().unwrap();
        assert_eq!(stale, JobFinishDisposition::StalePublication);

        let terminal_at_ms = first.lease_expires_at_ms + 2;
        let tx = conn.transaction().unwrap();
        let disposition =
            finish_job_in_tx(&tx, &second, &JobAttemptOutcome::Succeeded, terminal_at_ms).unwrap();
        tx.commit().unwrap();
        assert_eq!(disposition, JobFinishDisposition::Succeeded);

        let status = job_status_row(&conn, "job_reopen").unwrap().unwrap();
        assert_eq!(status.state, JobState::Succeeded);
        assert_eq!(status.attempt_count, 2);
        assert_eq!(status.state_version, 4);
        assert_eq!(status.terminal_at_ms, Some(terminal_at_ms));
        assert_eq!(status.last_error_code, None);

        let attempts = job_attempts(&conn, "job_reopen").unwrap();
        assert_eq!(attempts.len(), 2);
        assert_eq!(attempts[0].outcome.as_deref(), Some("lease_expired"));
        assert_eq!(
            attempts[0].diagnostic_code.as_deref(),
            Some("SNAPBACK_JOB_LEASE_EXPIRED")
        );
        assert_eq!(attempts[1].outcome.as_deref(), Some("succeeded"));
        assert_eq!(attempts[1].diagnostic_code, None);
    }

    #[test]
    fn failed_attempts_retry_with_deterministic_backoff_then_dead_letter() {
        let mut conn = memory_conn();
        let tx = conn.transaction().unwrap();
        let mut job = enqueue("job_r", 0);
        job.max_attempts = 2;
        insert_enqueued_jobs_in_tx(&tx, &producer(), 1, &[job], 0).unwrap();
        tx.commit().unwrap();

        let failure = JobAttemptOutcome::Failed(Diagnostic::error(
            "SNAPBACK_TEST_ACTION_FAILED",
            "jobs",
            "boom",
        ));

        let mut ids = || "c1".to_owned();
        let tx = conn.transaction().unwrap();
        let claim = claim_due_jobs_in_tx(&tx, 0, JOBS_CLAIM_BATCH, "forced-drain", &mut ids)
            .unwrap()
            .remove(0);
        let disposition = finish_job_in_tx(&tx, &claim, &failure, 10).unwrap();
        tx.commit().unwrap();
        let JobFinishDisposition::RetryPending { available_at_ms } = disposition else {
            panic!("first failure of two attempts must re-pend");
        };
        assert_eq!(available_at_ms, 10 + retry_delay_ms("job_r", 1));

        let mut ids = || "c2".to_owned();
        let tx = conn.transaction().unwrap();
        let claim = claim_due_jobs_in_tx(
            &tx,
            available_at_ms,
            JOBS_CLAIM_BATCH,
            "forced-drain",
            &mut ids,
        )
        .unwrap()
        .remove(0);
        assert_eq!(claim.attempt, 2);
        let disposition = finish_job_in_tx(&tx, &claim, &failure, available_at_ms + 5).unwrap();
        tx.commit().unwrap();
        assert_eq!(disposition, JobFinishDisposition::Dead);
        let status = job_status_row(&conn, "job_r").unwrap().unwrap();
        assert_eq!(status.state, JobState::Dead);
        assert_eq!(
            status.last_error_code.as_deref(),
            Some("SNAPBACK_TEST_ACTION_FAILED")
        );
        assert_eq!(job_attempts(&conn, "job_r").unwrap().len(), 2);
    }

    #[test]
    fn divergent_idempotency_key_reuse_fails_closed_in_the_insert_transaction() {
        let mut conn = memory_conn();
        let tx = conn.transaction().unwrap();
        let mut first = enqueue("job_1", 0);
        first.idempotency_key = Some("key".into());
        insert_enqueued_jobs_in_tx(&tx, &producer(), 1, &[first], 0).unwrap();
        tx.commit().unwrap();

        let tx = conn.transaction().unwrap();
        let mut divergent = enqueue("job_2", 0);
        divergent.idempotency_key = Some("key".into());
        divergent.args = json!({ "different": true });
        let error = insert_enqueued_jobs_in_tx(&tx, &producer(), 2, &[divergent], 1).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_JOB_IDEMPOTENCY_KEY_REUSED");

        let mut identical = enqueue("job_3", 0);
        identical.idempotency_key = Some("key".into());
        let error = insert_enqueued_jobs_in_tx(&tx, &producer(), 2, &[identical], 1).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_JOB_IDEMPOTENCY_KEY_RACED");
    }

    #[test]
    fn terminal_retention_sweep_is_bounded_and_keeps_only_idempotency_tombstones() {
        let conn = memory_conn();
        let mut keyed = enqueue("job_a", 0);
        keyed.args = json!({ "private": "terminal-payload" });
        keyed.idempotency_key = Some("stable-key".into());
        let (_, expected_args_digest) = canonical_args(&keyed.args).unwrap();
        let unkeyed = enqueue("job_b", 0);
        insert_enqueued_jobs_in_tx(&conn, &producer(), 1, &[keyed, unkeyed], 0).unwrap();

        let mut claim_number = 0;
        let mut claim_ids = || {
            claim_number += 1;
            format!("claim_{claim_number}")
        };
        let claims = claim_due_jobs_in_tx(&conn, 0, 2, "forced-drain", &mut claim_ids).unwrap();
        for claim in &claims {
            assert_eq!(
                finish_job_in_tx(&conn, claim, &JobAttemptOutcome::Succeeded, 10).unwrap(),
                JobFinishDisposition::Succeeded
            );
        }

        assert!(
            reap_terminal_jobs_in_tx(&conn, 10 + JOBS_TERMINAL_RETENTION_MS - 1, 1)
                .unwrap()
                .is_empty(),
            "terminal detail remains through the declared retention window"
        );
        assert_eq!(
            reap_terminal_jobs_in_tx(&conn, 10 + JOBS_TERMINAL_RETENTION_MS, 1).unwrap(),
            vec!["job_a"],
            "one sweep cannot exceed its explicit row bound"
        );
        assert!(job_status_row(&conn, "job_a").unwrap().is_none());
        assert!(job_attempts(&conn, "job_a").unwrap().is_empty());
        assert!(job_status_row(&conn, "job_b").unwrap().is_some());

        let tombstone =
            find_job_by_scoped_idempotency(&conn, JOBS_DEFAULT_QUEUE, "notify", "stable-key")
                .unwrap()
                .expect("keyed terminal job leaves its idempotency tombstone");
        assert_eq!(tombstone.job_id, "job_a");
        assert_eq!(tombstone.max_attempts, 1);
        assert_eq!(tombstone.args_digest, expected_args_digest);
        assert!(!tombstone.args_digest.contains("terminal-payload"));

        let mut identical = enqueue("job_retry", 0);
        identical.args = json!({ "private": "terminal-payload" });
        identical.idempotency_key = Some("stable-key".into());
        assert_eq!(
            insert_enqueued_jobs_in_tx(&conn, &producer(), 2, &[identical], 1)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_JOB_IDEMPOTENCY_KEY_RACED"
        );
        let mut divergent = enqueue("job_reuse", 0);
        divergent.args = json!({ "private": "different" });
        divergent.idempotency_key = Some("stable-key".into());
        assert_eq!(
            insert_enqueued_jobs_in_tx(&conn, &producer(), 2, &[divergent], 1)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_JOB_IDEMPOTENCY_KEY_REUSED"
        );

        assert_eq!(
            reap_terminal_jobs_in_tx(&conn, 10 + JOBS_TERMINAL_RETENTION_MS, 1).unwrap(),
            vec!["job_b"]
        );
        assert!(job_status_row(&conn, "job_b").unwrap().is_none());
        let tombstone_count: u64 = conn
            .query_row(
                "SELECT COUNT(*) FROM _snapback_job_idempotency_tombstones_v1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tombstone_count, 1, "unkeyed jobs leave no tombstone");
    }
}
