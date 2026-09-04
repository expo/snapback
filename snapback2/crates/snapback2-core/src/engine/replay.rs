//! Atomic replay trace validation and terminal-response recording.
// @ref LLP 1012#7-writes-offline — the authoritative execution, trace compare,
// application commit, id-slice claim, and intent response share one transaction.

use super::*;
use crate::offline::{ReplayCommit, ReplayTrace, replay_mutation_response};

/// The mutation state a moved trace settles as: a state, not a refusal code.
pub const CONFLICT_CODE: &str = "conflict";

const SAVEPOINT: &str = "snapback2_client_replay";

impl Engine {
    pub(crate) fn execute_replay(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        context: Context,
        replay: &ReplayCommit,
    ) -> Result<Execution, RuntimeError> {
        validate_inputs(&self.schema, program, &context.args)?;
        match self.execute_with_kind_inner(program, certificate, context, None, None, Some(replay))
        {
            Ok(execution) => Ok(execution),
            Err(error) if program.kind == ProgramKind::Mutation && is_sqlite_constraint(&error) => {
                Ok(self.empty_execution(ExecutionState::Rejected {
                    code: "E_CONSTRAINT".to_owned(),
                    message: error.to_string(),
                })?)
            }
            Err(error) => Err(error),
        }
    }
}

pub(super) fn open_savepoint(transaction: &Transaction<'_>) -> Result<(), RuntimeError> {
    transaction.execute_batch(&format!("SAVEPOINT {SAVEPOINT}"))?;
    Ok(())
}

fn rollback_savepoint(transaction: &Transaction<'_>) -> Result<(), RuntimeError> {
    transaction.execute_batch(&format!("ROLLBACK TO {SAVEPOINT}; RELEASE {SAVEPOINT}"))?;
    Ok(())
}

/// What this execution actually read at a point. A hidden hit yields `null`
/// to the program exactly as an absence does, so it validates as one and the
/// hidden row's digest never influences a client-visible outcome.
fn observed_digest(point: &PointTrace) -> Option<&str> {
    if point.visible {
        point.digest.as_deref()
    } else {
        None
    }
}

/// The first traced point or verdict that no longer holds against what this
/// execution read, as the site that moved. Ranges are never compared.
///
/// `strict` is the committed path: a traced point or verdict this execution
/// did not evaluate is itself a mismatch. The rejected path is lenient — the
/// program stopped early, so only the reads it reached are compared.
pub(super) fn conflict_site(
    expected: &ReplayTrace,
    authoritative: &AuthoritativeTrace,
    strict: bool,
) -> Option<String> {
    for point in &expected.points {
        let current = authoritative.points.iter().find(|actual| {
            actual.table == point.table && actual.index == point.index && actual.key == point.key
        });
        match current {
            Some(actual) if observed_digest(actual) == point.digest.as_deref() => {}
            Some(actual) => return Some(actual.site.clone()),
            None if strict => return Some(format!("{}.{}", point.table, point.index)),
            None => {}
        }
    }
    for verdict in &expected.verdicts {
        let mut evaluated = authoritative
            .rule_inputs
            .iter()
            .filter(|actual| actual.rule_hash == verdict.rule_hash)
            .peekable();
        if evaluated.peek().is_none() {
            if strict {
                return Some(format!("rule:{}", verdict.rule_hash));
            }
            continue;
        }
        let holds = evaluated.any(|actual| {
            actual.pinned_inputs_digest == verdict.inputs_digest && actual.result == verdict.result
        });
        if !holds {
            return Some(format!("rule:{}", verdict.rule_hash));
        }
    }
    None
}

/// A program rejection under replay. The trace is compared first: a rejection
/// whose reads moved is the conflict the client should see, because its twin
/// passed the same program over the rows it held. Either way the terminal is
/// recorded and the mutation's writes are discarded in the same commit.
pub(super) fn settle_rejected(
    transaction: Transaction<'_>,
    principal: &str,
    replay: &ReplayCommit,
    trace: AuthoritativeTrace,
    receipt: ClosureReceipt,
    code: String,
    message: String,
    current_seq: u64,
) -> Result<Execution, RuntimeError> {
    rollback_savepoint(&transaction)?;
    let state = match conflict_site(&replay.trace, &trace, false) {
        Some(site) => ExecutionState::Rejected {
            code: CONFLICT_CODE.to_owned(),
            message: site,
        },
        None => ExecutionState::Rejected { code, message },
    };
    let execution = Execution {
        result: Value::Null,
        result_provenance: ResultProvenance::None,
        trace,
        receipt,
        state,
        seq: current_seq,
        next: None,
    };
    record_terminal(&transaction, principal, replay, &execution)?;
    transaction.commit()?;
    Ok(execution)
}

/// A program run that reached its end under replay: validate the trace inside
/// the open transaction, then either commit the writes with the commit record,
/// the id-slice claim, and the intent response, or roll the writes back and
/// record the conflict — one commit either way.
#[allow(clippy::too_many_arguments)]
pub(super) fn settle_after_run(
    transaction: Transaction<'_>,
    principal: &str,
    replay: &ReplayCommit,
    mut execution: Execution,
    program: &Program,
    kind: &str,
    commit_at: i64,
    current_seq: u64,
) -> Result<Execution, RuntimeError> {
    if let Some(site) = conflict_site(&replay.trace, &execution.trace, true) {
        rollback_savepoint(&transaction)?;
        execution.result = Value::Null;
        execution.result_provenance = ResultProvenance::None;
        execution.receipt = ClosureReceipt::default();
        execution.state = ExecutionState::Rejected {
            code: CONFLICT_CODE.to_owned(),
            message: site,
        };
        execution.seq = current_seq;
        execution.next = None;
        record_terminal(&transaction, principal, replay, &execution)?;
        transaction.commit()?;
        return Ok(execution);
    }
    // @ref LLP 1001#2-what-a-commit-records — data, outbox, and commit record are atomic.
    let record = CommitRecord {
        seq: execution.seq,
        at: commit_at,
        program: program.name.clone(),
        principal: principal.to_owned(),
        kind: kind.to_owned(),
        touched: execution.trace.touched.clone(),
        writes: execution.trace.writes.clone(),
        emits: execution.trace.emits.len() as u64,
    };
    append_commit(&transaction, &record)?;
    record_terminal(&transaction, principal, replay, &execution)?;
    transaction.execute_batch(&format!("RELEASE {SAVEPOINT}"))?;
    transaction.commit()?;
    Ok(execution)
}

fn record_terminal(
    transaction: &Transaction<'_>,
    principal: &str,
    replay: &ReplayCommit,
    execution: &Execution,
) -> Result<(), RuntimeError> {
    let response = replay_mutation_response(execution, &replay.intent);
    Store::record_replay_terminal(transaction, principal, replay, &response, execution.seq)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::offline::{ReplayTracePoint, ReplayTraceVerdict};

    fn point(site: &str, visible: bool, digest: Option<String>) -> PointTrace {
        PointTrace {
            site: site.to_owned(),
            table: "messages".to_owned(),
            index: "byId".to_owned(),
            key: vec![Value::Id("message-1".to_owned())],
            examined: digest.is_some(),
            visible,
            digest,
        }
    }

    fn expected_point(digest: Option<String>) -> ReplayTracePoint {
        ReplayTracePoint {
            table: "messages".to_owned(),
            index: "byId".to_owned(),
            key: vec![Value::Id("message-1".to_owned())],
            digest,
        }
    }

    fn authoritative() -> AuthoritativeTrace {
        AuthoritativeTrace {
            points: vec![point("messages.edit:1", true, Some("a".repeat(64)))],
            rule_inputs: vec![RuleInputTrace {
                rule_hash: "b".repeat(64),
                table: "memberships".to_owned(),
                index: "byConversationPrincipal".to_owned(),
                key: Vec::new(),
                result: true,
                hidden: true,
                pinned_inputs_digest: "c".repeat(64),
            }],
            ranges: vec![TraceRange {
                site: "memberships.send".to_owned(),
                table: "memberships".to_owned(),
                index: "byConversationPrincipal".to_owned(),
                prefix: Vec::new(),
                order: Order::Asc,
                take: 50,
                after: None,
                before: None,
                gt: None,
                gte: None,
                lt: None,
                lte: None,
                rule_hash: String::new(),
                examined_ids: Vec::new(),
                visible_ids: Vec::new(),
                returned_ids: Vec::new(),
                stop: StopReason::Exhausted,
                absence: true,
                halo: None,
                n2_key: None,
            }],
            ..AuthoritativeTrace::default()
        }
    }

    #[test]
    fn trace_conflict_checks_points_and_verdicts_but_not_ranges() {
        let actual = authoritative();
        let mut expected = ReplayTrace {
            points: vec![expected_point(Some("a".repeat(64)))],
            verdicts: vec![ReplayTraceVerdict {
                rule_hash: "b".repeat(64),
                inputs_digest: "c".repeat(64),
                result: true,
            }],
        };
        assert_eq!(conflict_site(&expected, &actual, true), None);
        expected.points[0].digest = Some("d".repeat(64));
        assert_eq!(
            conflict_site(&expected, &actual, true).as_deref(),
            Some("messages.edit:1")
        );
        expected.points[0].digest = None;
        assert_eq!(
            conflict_site(&expected, &actual, false).as_deref(),
            Some("messages.edit:1"),
            "a traced absence that now hits is a conflict on either path"
        );
        expected.points[0].digest = Some("a".repeat(64));
        expected.verdicts[0].result = false;
        assert!(
            conflict_site(&expected, &actual, true)
                .unwrap()
                .starts_with("rule:")
        );
        assert!(
            conflict_site(&expected, &actual, false)
                .unwrap()
                .starts_with("rule:"),
            "an evaluated verdict that flipped conflicts even when the program was rejected"
        );
    }

    #[test]
    fn hidden_point_hits_validate_as_absences() {
        let mut actual = authoritative();
        actual.points = vec![point("messages.edit:1", false, Some("a".repeat(64)))];
        let expected = ReplayTrace {
            points: vec![expected_point(None)],
            verdicts: Vec::new(),
        };
        assert_eq!(conflict_site(&expected, &actual, true), None);
        let seen = ReplayTrace {
            points: vec![expected_point(Some("a".repeat(64)))],
            verdicts: Vec::new(),
        };
        assert_eq!(
            conflict_site(&seen, &actual, true).as_deref(),
            Some("messages.edit:1"),
            "a row the client once read that is now hidden has moved"
        );
    }

    #[test]
    fn unread_points_and_verdicts_conflict_only_on_the_committed_path() {
        let actual = AuthoritativeTrace::default();
        let expected = ReplayTrace {
            points: vec![expected_point(Some("a".repeat(64)))],
            verdicts: vec![ReplayTraceVerdict {
                rule_hash: "b".repeat(64),
                inputs_digest: "c".repeat(64),
                result: true,
            }],
        };
        assert_eq!(
            conflict_site(&expected, &actual, true).as_deref(),
            Some("messages.byId")
        );
        assert_eq!(conflict_site(&expected, &actual, false), None);
    }
}
