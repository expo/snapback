//! Atomic replay trace validation and terminal-response recording.
// @ref LLP 1012#7-writes-offline — the authoritative execution, trace compare,
// application commit, id-slice claim, and intent response share one transaction.

use super::*;
use crate::operations::TerminalCommit;
use crate::offline::{ReplayCommit, ReplayTrace, replay_mutation_response, row_digest};

/// The mutation state a moved trace settles as: a state, not a refusal code.
pub const CONFLICT_CODE: &str = "conflict";

const SAVEPOINT: &str = "snapback3_client_replay";

impl Engine {
    pub(crate) fn execute_replay(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        context: Context,
        replay: &ReplayCommit,
    ) -> Result<Execution, RuntimeError> {
        self.execute_terminal(program, certificate, context, &TerminalCommit::from(replay))
    }

    pub(crate) fn execute_terminal(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        context: Context,
        replay: &TerminalCommit,
    ) -> Result<Execution, RuntimeError> {
        validate_inputs(&self.schema, program, &context.args)?;
        match self.execute_with_kind_inner(program, certificate, context, None, None, Some(replay))
        {
            Ok(execution) => Ok(execution),
            Err(error) if program.kind == ProgramKind::Mutation && is_sqlite_constraint(&error) => {
                Ok(self.empty_execution(ExecutionState::Rejected {
                    rewrite: error.rewrite(),
                    site: error.require_site(),
                    rule: error.require_code(),
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

/// What a replayed program left behind, taken out of its runner so the
/// transaction it borrowed can be settled.
pub(super) struct ReplayRun {
    attempted: Result<Flow, RuntimeError>,
    missing_authority: bool,
    trace: AuthoritativeTrace,
    receipt: ClosureReceipt,
    /// The rule inputs the trace compare may see: every verdict a rule check
    /// derived on a row this run disclosed (read, probed, or written), with
    /// those minted while a candidate turned out hidden left out.
    rule_inputs: Vec<RuleInputTrace>,
    conflict_current: Value,
}

/// Take the run out of its runner. A program that stopped early — a rejection,
/// or a read that needed authority this engine does not hold — has its writes
/// rolled back to the replay savepoint here. On the rejected path every traced
/// point the program did not reach is then read against the rows as they
/// stand, through its read rule, so the conflict compare covers the whole
/// trace whatever order the program's `require`s sit in.
pub(super) fn finish_run(
    mut runner: Runner<'_>,
    attempted: Result<Flow, RuntimeError>,
    replay: &TerminalCommit,
) -> Result<ReplayRun, RuntimeError> {
    let missing_authority = runner.missing_authority;
    if missing_authority {
        runner.assert_bounds()?;
        rollback_savepoint(runner.tx)?;
    } else if let Err(error) = &attempted
        && mutation_rejection_code(error).is_some()
    {
        rollback_savepoint(runner.tx)?;
        probe_unreached(&mut runner, &replay.trace)?;
    }
    if !missing_authority && attempted.is_ok() {
        runner.trace.observable_effects = observable_effects(&runner)?;
    }
    // Re-authorize after rollback: tentative grants or self-revocation cannot
    // disclose a row through a rejected mutation's conflict payload.
    let conflict_current = if let Err(RuntimeError::Conflict { current }) = &attempted {
        Runner::probe(runner.tx, runner.schema, runner.hashes, runner.context.clone(), runner.verdicts,
            runner.authority_absences, runner.rule_authority, runner.seq, None).expr(&Expr::Get(current.clone()))?
    } else { Value::Null };
    let rule_inputs = disclosed_rule_inputs(&runner);
    Ok(ReplayRun {
        attempted,
        missing_authority,
        conflict_current,
        trace: std::mem::take(&mut runner.trace),
        receipt: std::mem::take(&mut runner.receipt),
        rule_inputs,
    })
}

/// Only final read-authorized row identities are echo obligations. A fresh rule
/// runner has no verdicts or memos from temporary writes. Deletions use the
/// first preimage and unchanged rule dependencies: both its initial and final
/// read authorization must hold, not access granted by the mutation itself.
// @ref LLP 1012#7-writes-offline — private fanout is settled by the commit; the
// complete observable subset, including maintained rows, is the client's echo work.
fn observable_effects(
    runner: &Runner<'_>,
) -> Result<Option<Vec<crate::offline::MutationEffect>>, RuntimeError> {
    if runner.rule_authority != RuleAuthority::StoreAuthoritative {
        return Ok(None);
    }
    let Some(preimages) = &runner.replay_preimages else {
        return Ok(None);
    };
    let ceilings = crate::certificate::Ceilings::default();
    let max_writes: u64 = runner
        .certificate
        .expect("replay has a certificate")
        .write_sites
        .iter()
        .map(|site| site.max_rows)
        .sum();
    if preimages.len() as u64 > max_writes {
        return Ok(None);
    }
    let changed_tables: BTreeSet<_> = preimages.keys().map(|(table, _)| table.as_str()).collect();
    let mut effects = Vec::new();
    let (mut steps, mut probes, mut output_bytes) = (0u64, 0u64, 2u64);
    for ((table, id), before) in preimages {
        let after = runner.fetch_id(table, id)?;
        let removed = after.is_none();
        let Some(row) = after.as_ref().or(before.as_ref()) else {
            continue;
        };
        let Some(certificate) = runner
            .hashes
            .read_certificates
            .get(table)
            .and_then(Option::as_ref)
        else {
            return Ok(None);
        };
        // Never truncate a complete-set claim. Complex projection keeps the
        // successful intent explicit; it does not change the mutation outcome.
        if steps.saturating_add(certificate.max_steps) > ceilings.steps
            || probes.saturating_add(certificate.max_rule_probes) > ceilings.rule_probes
        {
            return Ok(None);
        }
        let mut probe = Runner::probe(
            runner.tx,
            runner.schema,
            runner.hashes,
            runner.context.clone(),
            &[],
            &[],
            RuleAuthority::StoreAuthoritative,
            runner.seq,
            Some(certificate),
        );
        let visible = match probe.check_rule(table, Effect::Read, None, row) {
            Ok(visible) => visible,
            Err(RuntimeError::Steps(_) | RuntimeError::TraceSubset(_)) => return Ok(None),
            Err(error) => return Err(error),
        };
        if probe.assert_rule_bounds().is_err() {
            return Ok(None);
        }
        steps = steps
            .saturating_add(probe.trace.steps)
            .saturating_add(probe.trace.derived_steps);
        probes = probes.saturating_add(probe.trace.rule_probes);
        if visible {
            // Reconstructing a deleted row against newly granted access could
            // reveal an identity that was never readable. Unchanged dependency
            // tables prove this same witness held before the transaction too.
            // Include negative and transitive probes; even an unrelated change
            // in an authority table conservatively keeps the terminal explicit.
            if removed
                && probe
                    .trace
                    .rule_inputs
                    .iter()
                    .any(|input| changed_tables.contains(input.table.as_str()))
            {
                return Ok(None);
            }
            let effect = crate::offline::MutationEffect {
                table: table.clone(),
                id: id.clone(),
                removed,
            };
            output_bytes = output_bytes.saturating_add(canonical_json(&effect).len() as u64 + 1);
            if output_bytes > ceilings.output_bytes {
                return Ok(None);
            }
            effects.push(effect);
        }
    }
    Ok(Some(effects))
}

/// The rule inputs a client-facing compare may see. A rule check on a
/// candidate that turned out hidden leaves its inputs in the authoritative
/// trace (`rollback_candidate` keeps them for metering and invalidation);
/// here they are dropped, exactly as the receipt dropped its verdicts, so the
/// compare knows only what a program read would have disclosed to this
/// principal.
// @ref LLP 1012#7-writes-offline — a verdict is re-derived through the rule
// on a disclosed row or not at all; raw existence never reaches the compare.
fn disclosed_rule_inputs(runner: &Runner<'_>) -> Vec<RuleInputTrace> {
    runner
        .trace
        .rule_inputs
        .iter()
        .enumerate()
        .filter(|(index, _)| {
            !runner
                .discarded_rule_inputs
                .iter()
                .any(|range| range.contains(index))
        })
        .map(|(_, input)| input.clone())
        .collect()
}

/// Settle a replayed mutation: the Partial and rejected states are recorded as
/// the intent's terminal with the writes already discarded; a run that reached
/// its end is validated and committed by [`settle_after_run`]. One commit
/// either way.
#[allow(clippy::too_many_arguments)]
pub(super) fn settle(
    transaction: Transaction<'_>,
    principal: &str,
    replay: &TerminalCommit,
    run: ReplayRun,
    program: &Program,
    kind: &str,
    commit_at: i64,
    current_seq: u64,
    seq: u64,
) -> Result<Execution, RuntimeError> {
    let ReplayRun {
        attempted,
        missing_authority,
        trace,
        receipt,
        rule_inputs,
        conflict_current,
    } = run;
    if missing_authority {
        // @ref LLP 1012#7-writes-offline — a rollback for missing authority
        // still settles through the ledger, never around it.
        let state = ExecutionState::Partial {
            reason: MISSING_AUTHORITY_LABEL.to_owned(),
        };
        return settle_early(
            transaction,
            principal,
            replay,
            trace,
            receipt,
            state,
            current_seq,
            Value::Null,
        );
    }
    let flow = match attempted {
        Ok(flow) => flow,
        Err(error) => {
            let Some(code) = mutation_rejection_code(&error).map(str::to_owned) else {
                return Err(error);
            };
            // A rejection whose reads moved is the conflict the client should
            // see, because its twin passed the same program over the rows it
            // held; the compare covers every traced point because `finish_run`
            // probed the ones the run did not reach, and every verdict those
            // reads and probes derived through a rule.
            let state = match conflict_site(&replay.trace, &trace.points, &rule_inputs, false) {
                Some(site) if code != "E_CONFLICT" => ExecutionState::Rejected {
                    rewrite: None,
                    site: None,
                    rule: None,
                    code: CONFLICT_CODE.to_owned(),
                    message: site,
                },
                _ => ExecutionState::Rejected {
                    rewrite: error.rewrite(),
                    site: error.require_site(),
                    rule: error.require_code(),
                    code,
                    message: error.to_string(),
                },
            };
            return settle_early(
                transaction,
                principal,
                replay,
                trace,
                receipt,
                state,
                current_seq,
                conflict_current,
            );
        }
    };
    let (result, result_provenance) = match flow {
        Flow::Return(value, provenance) => (value, provenance),
        _ => (Value::Null, ResultProvenance::None),
    };
    let execution = Execution {
        result,
        result_provenance,
        trace,
        receipt,
        state: ExecutionState::Committed { seq },
        seq,
        next: None,
    };
    settle_after_run(
        transaction,
        principal,
        replay,
        execution,
        &rule_inputs,
        program,
        kind,
        commit_at,
        current_seq,
    )
}

fn same_point(actual: &PointTrace, table: &str, index: &str, key: &[Value]) -> bool {
    actual.table == table && actual.index == index && actual.key == key
}

/// Read every traced point this run did not reach, against the rows as they
/// stand with the program's own writes rolled back. Each goes through the
/// table's read rule exactly as a program read would: a hidden hit validates
/// as an absence, and the rule inputs that check derives are the only way an
/// unreached verdict is re-derived — through the rule, as the replaying
/// principal, with a hidden candidate's inputs discarded. A verdict no rule
/// check of this run or of these probes derives is unverifiable: the digest
/// alone names no row, and reading one raw would tell a hidden row from an
/// absent one, so it is skipped rather than claimed a conflict.
fn probe_unreached(runner: &mut Runner<'_>, expected: &ReplayTrace) -> Result<(), RuntimeError> {
    let unread = expected
        .points
        .iter()
        .filter(|point| {
            !runner
                .trace
                .points
                .iter()
                .any(|actual| same_point(actual, &point.table, &point.index, &point.key))
        })
        .cloned()
        .collect::<Vec<_>>();
    for point in unread {
        let found = runner.lookup_raw(&point.table, &point.index, &point.key)?;
        let (examined, visible, digest) = match &found {
            Some(row) => {
                let checkpoint = runner.candidate_checkpoint();
                let visible = runner.check_rule(&point.table, Effect::Read, None, row)?;
                if !visible {
                    runner.rollback_candidate(checkpoint);
                }
                (true, visible, Some(row_digest(row)))
            }
            None => (false, false, None),
        };
        runner.trace.points.push(PointTrace {
            site: format!("{}.{}", point.table, point.index),
            table: point.table,
            index: point.index,
            key: point.key,
            examined,
            visible,
            digest,
        });
    }
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
/// A verdict is compared only against a rule input with the same rule hash
/// and inputs digest — one a rule check derived on a disclosed row; `strict`
/// is the committed path, where a traced point or verdict this execution did
/// not derive is itself a mismatch. The rejected path arrives with every
/// traced point probed (`finish_run`), so a point is always compared there,
/// and only a verdict no rule check derived is skipped.
pub(super) fn conflict_site(
    expected: &ReplayTrace,
    points: &[PointTrace],
    rule_inputs: &[RuleInputTrace],
    strict: bool,
) -> Option<String> {
    // Reads after our own writes observe a later image of the same key.
    let mut occurrences = BTreeMap::<String, usize>::new();
    for point in &expected.points {
        let offset = occurrences.entry(canonical_json(&(&point.table, &point.index, &point.key))).or_default();
        let current = points.iter().filter(|actual| same_point(actual, &point.table, &point.index, &point.key)).nth(*offset);
        *offset += 1;
        match current {
            Some(actual) if observed_digest(actual) == point.digest.as_deref() => {}
            Some(actual) => return Some(actual.site.clone()),
            None if strict => return Some(format!("{}.{}", point.table, point.index)),
            None => {}
        }
    }
    for verdict in &expected.verdicts {
        let mut derived = rule_inputs
            .iter()
            .filter(|actual| {
                actual.rule_hash == verdict.rule_hash
                    && actual.pinned_inputs_digest == verdict.inputs_digest
            })
            .peekable();
        if derived.peek().is_none() {
            if strict {
                return Some(format!("rule:{}", verdict.rule_hash));
            }
            continue;
        }
        if !derived.any(|actual| actual.result == verdict.result) {
            return Some(format!("rule:{}", verdict.rule_hash));
        }
    }
    None
}

/// A replayed program that stopped early. Its writes were already rolled back
/// to the replay savepoint; the terminal is recorded and the transaction
/// commits so the ledger row and the id-slice claim survive.
fn settle_early(
    transaction: Transaction<'_>,
    principal: &str,
    replay: &TerminalCommit,
    trace: AuthoritativeTrace,
    receipt: ClosureReceipt,
    state: ExecutionState,
    current_seq: u64,
    result: Value,
) -> Result<Execution, RuntimeError> {
    let execution = Execution {
        result,
        result_provenance: ResultProvenance::None,
        trace,
        receipt,
        state,
        seq: current_seq,
        next: None,
    };
    record_terminal(&transaction, principal, replay, &execution, None)?;
    transaction.commit()?;
    Ok(execution)
}

/// A program run that reached its end under replay: validate the trace inside
/// the open transaction, then either commit the writes with the commit record,
/// the id-slice claim, and the intent response, or roll the writes back and
/// record the conflict — one commit either way.
#[allow(clippy::too_many_arguments)]
fn settle_after_run(
    transaction: Transaction<'_>,
    principal: &str,
    replay: &TerminalCommit,
    mut execution: Execution,
    rule_inputs: &[RuleInputTrace],
    program: &Program,
    kind: &str,
    commit_at: i64,
    current_seq: u64,
) -> Result<Execution, RuntimeError> {
    if let Some(site) = conflict_site(&replay.trace, &execution.trace.points, rule_inputs, true) {
        rollback_savepoint(&transaction)?;
        execution.result = Value::Null;
        execution.result_provenance = ResultProvenance::None;
        execution.receipt = ClosureReceipt::default();
        execution.state = ExecutionState::Rejected {
            rewrite: None,
            site: None,
            rule: None,
            code: CONFLICT_CODE.to_owned(),
            message: site,
        };
        execution.seq = current_seq;
        execution.next = None;
        record_terminal(&transaction, principal, replay, &execution, None)?;
        transaction.commit()?;
        return Ok(execution);
    }
    // @ref LLP 1001#2-what-a-commit-records — data, outbox, and commit record are atomic.
    let record = CommitRecord {
        job: None,
        job_chunk: None,
        schedule: None,
        seq: execution.seq,
        at: commit_at,
        program: program.name.clone(),
        principal: principal.to_owned(),
        kind: kind.to_owned(),
        by: None,
        touched: execution.trace.touched.clone(),
        scope_touches: execution.trace.scope_touches.clone(),
        writes: execution.trace.writes.clone(),
        emits: execution.trace.emits.len() as u64,
    };
    append_commit(&transaction, &record)?;
    record_terminal(&transaction, principal, replay, &execution, Some(program))?;
    transaction.execute_batch(&format!("RELEASE {SAVEPOINT}"))?;
    transaction.commit()?;
    Ok(execution)
}

fn record_terminal(
    transaction: &Transaction<'_>,
    principal: &str,
    replay: &TerminalCommit,
    execution: &Execution,
    program: Option<&Program>,
) -> Result<(), RuntimeError> {
    let plan_hash = program.map(crate::value::digest);
    let identity = plan_hash
        .as_deref()
        .zip(execution.receipt.schema_hash.as_deref());
    let response = replay_mutation_response(execution, &replay.intent, identity);
    Store::record_terminal(transaction, principal, replay, &response, execution.seq)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::certificate::{Ceilings, Checker};
    use crate::offline::{ReplayTracePoint, ReplayTraceVerdict};
    use crate::programs::spike_schema;
    use serde_json::json;

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
                n2_suffix: None,
            }],
            ..AuthoritativeTrace::default()
        }
    }

    #[test]
    fn repeated_points_compare_each_occurrence_before_and_after_own_writes() {
        let expected = ReplayTrace { points: vec![expected_point(Some("a".repeat(64))), expected_point(Some("b".repeat(64)))], verdicts: vec![] };
        let points = vec![point("before", true, Some("a".repeat(64))), point("after", true, Some("b".repeat(64)))];
        assert_eq!(conflict_site(&expected, &points, &[], true), None);
        let mut changed = points.clone(); changed[1].digest = Some("c".repeat(64));
        assert_eq!(conflict_site(&expected, &changed, &[], true).as_deref(), Some("after"));
        assert_eq!(conflict_site(&expected, &points[..1], &[], false), None, "an early rejection never reached the second read");
        assert!(conflict_site(&expected, &points[..1], &[], true).is_some());
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
        assert_eq!(
            conflict_site(&expected, &actual.points, &actual.rule_inputs, true),
            None
        );
        expected.points[0].digest = Some("d".repeat(64));
        assert_eq!(
            conflict_site(&expected, &actual.points, &actual.rule_inputs, true).as_deref(),
            Some("messages.edit:1")
        );
        expected.points[0].digest = None;
        assert_eq!(
            conflict_site(&expected, &actual.points, &actual.rule_inputs, false).as_deref(),
            Some("messages.edit:1"),
            "a traced absence that now hits is a conflict on either path"
        );
        expected.points[0].digest = Some("a".repeat(64));
        expected.verdicts[0].result = false;
        assert!(
            conflict_site(&expected, &actual.points, &actual.rule_inputs, true)
                .unwrap()
                .starts_with("rule:")
        );
        assert!(
            conflict_site(&expected, &actual.points, &actual.rule_inputs, false)
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
        assert_eq!(
            conflict_site(&expected, &actual.points, &actual.rule_inputs, true),
            None
        );
        let seen = ReplayTrace {
            points: vec![expected_point(Some("a".repeat(64)))],
            verdicts: Vec::new(),
        };
        assert_eq!(
            conflict_site(&seen, &actual.points, &actual.rule_inputs, true).as_deref(),
            Some("messages.edit:1"),
            "a row the client once read that is now hidden has moved"
        );
    }

    /// A verdict is compared only against an input a rule check derived with
    /// the same rule hash *and* inputs digest; the rule having run for other
    /// inputs proves nothing about this one, and a discarded (hidden
    /// candidate) input is simply not in the compare set.
    #[test]
    fn verdicts_compare_only_against_inputs_a_rule_check_derived() {
        let actual = authoritative();
        let other_inputs = ReplayTrace {
            points: vec![expected_point(Some("a".repeat(64)))],
            verdicts: vec![ReplayTraceVerdict {
                rule_hash: "b".repeat(64),
                inputs_digest: "e".repeat(64),
                result: false,
            }],
        };
        assert_eq!(
            conflict_site(&other_inputs, &actual.points, &actual.rule_inputs, false),
            None,
            "the rule ran for other inputs only: unverifiable, not a conflict"
        );
        assert!(
            conflict_site(&other_inputs, &actual.points, &actual.rule_inputs, true)
                .unwrap()
                .starts_with("rule:")
        );
        let held = ReplayTrace {
            points: vec![expected_point(Some("a".repeat(64)))],
            verdicts: vec![ReplayTraceVerdict {
                rule_hash: "b".repeat(64),
                inputs_digest: "c".repeat(64),
                result: false,
            }],
        };
        assert!(
            conflict_site(&held, &actual.points, &actual.rule_inputs, false)
                .unwrap()
                .starts_with("rule:"),
            "a derived input with the other result is a conflict on either path"
        );
        assert_eq!(
            conflict_site(&held, &actual.points, &[], false),
            None,
            "an input a hidden candidate minted is not in the compare set"
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
            conflict_site(&expected, &actual.points, &actual.rule_inputs, true).as_deref(),
            Some("messages.byId")
        );
        assert_eq!(
            conflict_site(&expected, &actual.points, &actual.rule_inputs, false),
            None
        );
    }

    fn wait_row(id: &str, owner: &str) -> Value {
        object([
            ("id", Value::Id(id.to_owned())),
            ("resourceId", Value::Id("resource-1".to_owned())),
            ("ownerId", Value::Id(owner.to_owned())),
        ])
    }

    fn insert_row(table: &str, row: Value) -> Stmt {
        Stmt::Insert {
            table: table.to_owned(),
            row: Expr::Literal(row),
        }
    }

    fn delete_row(table: &str, id: &str) -> Stmt {
        Stmt::Delete {
            table: table.to_owned(),
            key: Expr::Literal(Value::Id(id.to_owned())),
        }
    }

    fn update_row(table: &str, id: &str, patch: Value) -> Stmt {
        Stmt::Update {
            table: table.to_owned(),
            key: Expr::Literal(Value::Id(id.to_owned())),
            patch: Expr::Literal(patch),
        }
    }

    /// Exercise the same atomic execution + persisted terminal as owner replay.
    fn effect_replay(engine: &mut Engine, body: Vec<Stmt>) -> serde_json::Value {
        let program = Program {
            name: "effects".to_owned(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body,
        };
        let certificate = Checker::new(&engine.schema, Ceilings::default())
            .check(&program)
            .unwrap();
        let replay = ReplayCommit {
            grant: "grant-1".to_owned(),
            offset: 0,
            count: 1,
            intent: "grant-1:0".to_owned(),
            request_digest: "d".repeat(64),
            trace: ReplayTrace::default(),
            at: 5,
        };
        let execution = engine
            .execute_replay(
                &program,
                &certificate,
                Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new()),
                &replay,
            )
            .unwrap();
        assert!(
            matches!(execution.state, ExecutionState::Committed { .. }),
            "{:?}",
            execution.state
        );
        let response = replay_mutation_response(
            &execution,
            &replay.intent,
            Some((&certificate.plan_hash, &certificate.schema_hash)),
        );
        let stored = engine
            .store()
            .stored_client_intent("u1", "grant-1:0")
            .unwrap()
            .unwrap();
        assert_eq!(
            stored.response, response,
            "dedup keeps the same observable set"
        );
        response
    }

    #[test]
    fn observable_effects_include_visible_fanout_and_maintains_without_hidden_addresses() {
        let mut engine = Engine::memory(spike_schema()).unwrap();
        let response = effect_replay(
            &mut engine,
            vec![
                insert_row("waitlist", wait_row("own", "u1")),
                insert_row("waitlist", wait_row("peer-secret-id", "u2")),
                update_row(
                    "waitlist",
                    "own",
                    object([("ownerId", Value::Id("u1".to_owned()))]),
                ),
            ],
        );
        let effects = response["effects"].as_array().unwrap();
        assert_eq!(
            effects.len(),
            2,
            "one source row and one maintained count, each once"
        );
        assert_eq!(effects[1], json!({"table":"waitlist", "id":"own"}));
        assert_eq!(effects[0]["table"], "waitCounts");
        assert!(!response.to_string().contains("peer-secret-id"));
        assert_eq!(
            engine
                .store()
                .conn
                .query_row(
                    "SELECT COUNT(*) FROM rows WHERE table_name = 'waitlist'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            2,
            "hidden fanout still commits"
        );
    }

    #[test]
    fn observable_effects_remove_visible_preimages_but_never_temporary_ownership() {
        let mut schema = spike_schema();
        schema.maintains.clear();
        let mut engine = Engine::memory(schema).unwrap();
        engine.seed("waitlist", wait_row("own", "u1")).unwrap();
        engine.seed("waitlist", wait_row("hidden", "u2")).unwrap();
        engine.seed("waitlist", wait_row("revoked", "u1")).unwrap();
        let response = effect_replay(
            &mut engine,
            vec![
                delete_row("waitlist", "own"),
                update_row(
                    "waitlist",
                    "hidden",
                    object([("ownerId", Value::Id("u1".to_owned()))]),
                ),
                delete_row("waitlist", "hidden"),
                update_row(
                    "waitlist",
                    "revoked",
                    object([("ownerId", Value::Id("u2".to_owned()))]),
                ),
                insert_row("waitlist", wait_row("ephemeral", "u1")),
                delete_row("waitlist", "ephemeral"),
            ],
        );
        assert_eq!(
            response["effects"],
            json!([{"table":"waitlist", "id":"own", "removed":true}])
        );
    }

    #[test]
    fn observable_effects_recheck_final_rule_dependencies_after_revocation() {
        let mut schema = spike_schema();
        schema.maintains.clear();
        schema.tables.get_mut("entitlements").unwrap().rules.read =
            RuleExpr::Eq(RuleTerm::Field("userId".to_owned()), RuleTerm::Viewer);
        for temporary in [false, true] {
            let mut engine = Engine::memory(schema.clone()).unwrap();
            engine
                .seed(
                    "secretDocs",
                    object([
                        ("id", Value::Id("hidden-doc".to_owned())),
                        ("title", Value::String("secret".to_owned())),
                    ]),
                )
                .unwrap();
            let grant = object([
                ("id", Value::Id("grant".to_owned())),
                ("userId", Value::Id("u1".to_owned())),
            ]);
            let mut body = Vec::new();
            if temporary {
                body.push(insert_row("entitlements", grant));
            } else {
                engine.seed("entitlements", grant).unwrap();
            }
            body.push(update_row(
                "secretDocs",
                "hidden-doc",
                object([("title", Value::String("changed".to_owned()))]),
            ));
            body.push(delete_row("secretDocs", "hidden-doc"));
            body.push(delete_row("entitlements", "grant"));
            let response = effect_replay(&mut engine, body);
            let expected = if temporary {
                json!([])
            } else {
                json!([{"table":"entitlements", "id":"grant", "removed":true}])
            };
            assert_eq!(response["effects"], expected, "temporary={temporary}");
            assert!(!response.to_string().contains("hidden-doc"));
        }
    }

    #[test]
    fn observable_effects_noop_is_complete_and_unbounded_projection_is_unknown() {
        let mut engine = Engine::memory(spike_schema()).unwrap();
        assert_eq!(effect_replay(&mut engine, vec![])["effects"], json!([]));
        let mut schema = spike_schema();
        schema.maintains.clear();
        let mut engine = Engine::memory(schema).unwrap();
        // An unavailable or over-budget projection must preserve a successful
        // write without advertising a truncated complete obligation set.
        engine
            .hashes
            .read_certificates
            .get_mut("waitlist")
            .unwrap()
            .as_mut()
            .unwrap()
            .max_steps = Ceilings::default().steps + 1;
        let response = effect_replay(
            &mut engine,
            vec![insert_row("waitlist", wait_row("own", "u1"))],
        );
        assert!(response.get("effects").is_none());
        assert_eq!(
            engine
                .store()
                .conn
                .query_row(
                    "SELECT COUNT(*) FROM rows WHERE table_name = 'waitlist'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
    }

    #[test]
    fn observable_effects_deleted_identity_needs_initial_and_final_rule_authority() {
        let mut schema = spike_schema();
        schema.maintains.clear();
        let doc = object([
            ("id", Value::Id("secret-deleted-id".to_owned())),
            ("title", Value::String("secret".to_owned())),
        ]);
        let grant = object([
            ("id", Value::Id("grant".to_owned())),
            ("userId", Value::Id("u1".to_owned())),
        ]);
        for grant_first in [false, true] {
            let mut engine = Engine::memory(schema.clone()).unwrap();
            engine.seed("secretDocs", doc.clone()).unwrap();
            let mut body = vec![
                delete_row("secretDocs", "secret-deleted-id"),
                insert_row("entitlements", grant.clone()),
            ];
            if grant_first {
                body.reverse();
            }
            let response = effect_replay(&mut engine, body);
            assert!(
                response.get("effects").is_none(),
                "new permanent access does not authorize a deleted preimage"
            );
            assert!(!response.to_string().contains("secret-deleted-id"));
        }
        let mut engine = Engine::memory(schema.clone()).unwrap();
        engine.seed("secretDocs", doc.clone()).unwrap();
        engine.seed("entitlements", grant.clone()).unwrap();
        let response = effect_replay(
            &mut engine,
            vec![delete_row("secretDocs", "secret-deleted-id")],
        );
        assert_eq!(
            response["effects"],
            json!([{"table":"secretDocs", "id":"secret-deleted-id", "removed":true}]),
            "an unchanged membership witness safely discloses the deletion"
        );
        let read = schema.tables["secretDocs"].rules.read.clone();
        schema.tables.get_mut("secretDocs").unwrap().rules.read = RuleExpr::Not(Box::new(read));
        let mut engine = Engine::memory(schema).unwrap();
        engine.seed("secretDocs", doc).unwrap();
        engine.seed("entitlements", grant).unwrap();
        let response = effect_replay(
            &mut engine,
            vec![
                delete_row("secretDocs", "secret-deleted-id"),
                delete_row("entitlements", "grant"),
            ],
        );
        assert!(
            response.get("effects").is_none(),
            "removing a blocker cannot authorize its newly readable deleted preimage"
        );
        assert!(!response.to_string().contains("secret-deleted-id"));
    }

    #[test]
    fn observable_effects_drop_preimages_at_the_memory_ceiling_without_refusing_deletion() {
        let mut schema = spike_schema();
        schema.maintains.clear();
        let docs = schema.tables.get_mut("secretDocs").unwrap();
        docs.rules.read = RuleExpr::Allow;
        docs.columns
            .insert("title".to_owned(), ColumnType::Text { max: 512 * 1024 });
        let mut engine = Engine::memory(schema).unwrap();
        let mut body = Vec::new();
        for index in 0..17 {
            let id = format!("doc-{index}");
            engine
                .seed(
                    "secretDocs",
                    object([
                        ("id", Value::Id(id.clone())),
                        ("title", Value::String("x".repeat(512 * 1024))),
                    ]),
                )
                .unwrap();
            body.push(delete_row("secretDocs", &id));
        }
        let response = effect_replay(&mut engine, body);
        assert!(
            response.get("effects").is_none(),
            "a partial projection is never complete"
        );
        assert_eq!(
            engine
                .store()
                .conn
                .query_row(
                    "SELECT COUNT(*) FROM rows WHERE table_name = 'secretDocs'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
    }

    /// A replayed insert whose rule needs a verdict this engine does not hold
    /// (receipt-only authority, empty receipt) rolls back as `partial` and is
    /// still settled through the ledger: the terminal is stored, the slice is
    /// spent, and nothing was written.
    #[test]
    fn missing_authority_settles_through_the_ledger_as_partial() {
        let mut schema = spike_schema();
        let hidden = schema.tables["secretDocs"].rules.read.clone();
        schema.tables.get_mut("secretDocs").unwrap().rules.insert = hidden;
        let program = Program {
            name: "stageSecret".to_owned(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body: vec![Stmt::Insert {
                table: "secretDocs".to_owned(),
                row: Expr::Literal(object([
                    ("id", Value::Id("doc2".to_owned())),
                    ("title", Value::String("Blocked".to_owned())),
                ])),
            }],
        };
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&program)
            .unwrap();
        let mut engine = Engine::memory(schema).unwrap();
        engine.install_receipt_authority(&ClosureReceipt::default());
        let replay = ReplayCommit {
            grant: "grant-1".to_owned(),
            offset: 0,
            count: 1,
            intent: "grant-1:0".to_owned(),
            request_digest: "d".repeat(64),
            trace: ReplayTrace::default(),
            at: 5,
        };
        let context = Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new());
        let execution = engine
            .execute_replay(&program, &certificate, context, &replay)
            .unwrap();
        assert_eq!(
            execution.state,
            ExecutionState::Partial {
                reason: MISSING_AUTHORITY_LABEL.to_owned()
            }
        );
        let stored = engine
            .store()
            .stored_client_intent("u1", "grant-1:0")
            .unwrap()
            .expect("the partial terminal is in the ledger");
        assert_eq!(stored.request_digest, "d".repeat(64));
        assert_eq!(
            stored.response,
            json!({ "state": "partial", "reason": "missing-authority", "intent": "grant-1:0" })
        );
        assert!(
            !engine
                .store()
                .replay_slice_is_unused("grant-1", "another", 0, 1)
                .unwrap(),
            "the slice is spent with the terminal"
        );
        let written: i64 = engine
            .store()
            .conn
            .query_row(
                "SELECT COUNT(*) FROM rows WHERE table_name = 'secretDocs'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(written, 0, "a partial replay writes nothing");
    }
}
