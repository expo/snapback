//! A mutation's durable result and the facts produced by its commit.
use super::*;

/// Owned facts for publication and the response, never a historical replay.
// @ref LLP 3000.009.001.000.001#3.4 — carry commit facts only after durable COMMIT.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DurablePublication {
    pub store_id: String,
    pub head: u64,
    pub generation: u64,
    pub preserved: Option<Vec<String>>,
}

#[derive(Clone, Debug)]
pub struct MutationAcknowledgement {
    pub outcome: MutationOutcome,
    pub publication: Option<DurablePublication>,
}
impl MutationAcknowledgement {
    fn unpublished(outcome: MutationOutcome) -> Self { Self { outcome, publication: None } }
}

fn committed_preservation(footprint: crate::revocation::Footprint, schema: &Schema) -> Option<Vec<String>> {
    // Match the persisted evidence reader's bounds and merge normalization.
    // Postgres does not persist footprints yet: its Rows default is unknown.
    if footprint.unknown || crate::value::canonical_json(&footprint).len() > 262144 { return None; }
    let mut normalized = crate::revocation::Footprint::default();
    normalized.merge(&footprint);
    (!normalized.unknown).then(|| normalized.preserved(schema))
}

impl Engine {
    /// Run a mutation. With an `op` id the write applies at most once: a
    /// replay returns the recorded outcome. The replay check comes before
    /// anything the current generation could refuse (an op renamed, an
    /// argument narrowed), so a write that applied under an earlier schema
    /// is never re-judged: its row is on the server, and the device that
    /// queued it must learn `sent`, not `failed`.
    pub fn mutate(&mut self, name: &str, op: Option<&str>, context: Context) -> Result<MutationOutcome, RuntimeError> {
        self.mutate_inner(name, op, context, false, None, None, std::time::Instant::now() + std::time::Duration::from_millis(100)).map(|ack| ack.outcome)
    }

    /// Commit-local publication facts, exposed only after physical COMMIT.
    pub fn mutate_acknowledged(&mut self, name: &str, op: Option<&str>, context: Context) -> Result<MutationAcknowledgement, RuntimeError> {
        self.mutate_inner(name, op, context, true, None, None, std::time::Instant::now() + std::time::Duration::from_millis(100))
    }

    /// Serving already performed unfenced replay-before-judgment. The final
    /// authority check and serial receipt check belong to this Program member.
    // @ref LLP 3000.009.001.000.001#31-authority-boundaries — a carried credential is not proof of current authority.
    pub fn mutate_authorized(&mut self, name: &str, op: Option<&str>, context: Context,
        digest: &str, sample: impl FnMut() -> crate::identity::ServiceSample,
        authorize: impl FnMut(crate::identity::RequestAuthority) -> Result<(), Refusal>,
    ) -> Result<MutationAcknowledgement, Refusal> {
        self.mutate_authorized_until(name,op,context,digest,sample,authorize,std::time::Instant::now() + std::time::Duration::from_millis(100))
    }
    pub(super) fn mutate_authorized_until(&mut self,name:&str,op:Option<&str>,context:Context,digest:&str,
        mut sample:impl FnMut()->crate::identity::ServiceSample,
        mut authorize:impl FnMut(crate::identity::RequestAuthority)->Result<(),Refusal>,deadline:std::time::Instant,
    )->Result<MutationAcknowledgement,Refusal> {
        crate::identity::request::require_digest(digest).map_err(|e| e.refusal())?;
        let mut refusal = None;
        let mut attempted=false;
        let result = self.mutate_inner(name, op, context, true, Some(&mut |tx,context: &mut Context| {
            let sampled=sample();
            if attempted {context.now=Some(context.now.unwrap_or(sampled.now).max(sampled.now));}
            attempted=true;
            let facts = tx.request_authority(digest, sampled)?;
            authorize(facts).map_err(|why| {
                // The RuntimeError unwinds the member frame. Preserve the exact
                // host refusal outside it, rather than converting its envelope.
                let error = RuntimeError::Auth(why.message.clone());
                refusal = Some(why);
                error
            })
        }), Some(digest), deadline);
        if let Some(why) = refusal { return Err(why); }
        result.map_err(|error| {
            let mut why = error.refusal();
            // A preflight miss followed by fence loss is still unsent intent.
            if op.is_some() && why.code == "E_STORE_OWNERSHIP" { why.retryable = true; }
            why
        })
    }

    pub(super) fn mutate_inner(&mut self, name: &str, op: Option<&str>, mut context: Context, publication_requested: bool, mut authority: Option<&mut dyn FnMut(&super::committer::MemberTx<'_, '_>, &mut Context) -> Result<(), RuntimeError>>, digest: Option<&str>, deadline: std::time::Instant) -> Result<MutationAcknowledgement, RuntimeError> {
        if authority.is_none() { validate::write_identity(&context.viewer, op)?; }
        context.generation = self.generation;
        let dynamic_time=context.now.is_none();
        let requested = context.now.unwrap_or_else(crate::now_ms);
        context.now = Some(self.advance_time_audience(requested)?);
        let wire_args = if op.is_some() { context.wire_args.take().unwrap_or_else(|| {
                serde_json::Value::Object(crate::wire::map_to_json(&context.args))
            }) } else { serde_json::Value::Null };
        if authority.is_none() && let Some(op) = op
            && let Some(outcome) = self.replay_mutation(&context.viewer, op, name, &wire_args)?
        {
            return Ok(MutationAcknowledgement::unpublished(outcome));
        }
        // An existing durable receipt owns its id even after conversion to ephemeral.
        if self.schema.operations.get(name).is_some_and(|f| f.ephemeral) {
            if authority.is_some() { return Err(RuntimeError::Generation("the operation became ephemeral; retry through current admission".into())); }
            self.require_non_media_ephemeral(&context.viewer,op)?;
            self.schema.check_delivery(name, context.delivery_fingerprint.as_deref())?;
            let viewer=context.viewer.clone();
            return match self.mutate_ephemeral(name, context) {
                Ok(out) => Ok(MutationOutcome { receipt_only: false, state: WriteState::Sent { seq: out.seq, result: out.result }, metered: out.metered, tables: out.ephemeral.tables, events: 0, replayed: false }),
                Err(error) if error.is_refusal() => Ok(MutationOutcome { receipt_only: false, state: WriteState::Failed { why: seat_refusal(&self.schema,&error,&viewer), current: None }, metered: Metered::default(), tables: Vec::new(), events: 0, replayed: false }),
                Err(error) => Err(error),
            }.map(MutationAcknowledgement::unpublished);
        }
        let Engine { store, schema, programs, entropy, minter, presence, ceilings, store_id, generation, dev_effects,
            #[cfg(feature = "evaluation-support")] evaluation_precharge, .. } = self;
        let host = ProgramHost { schema, programs, entropy: *entropy, minter, presence: presence.clone(), ceilings: *ceilings,
            store_id, generation: *generation, dev_effects: *dev_effects,
            #[cfg(feature = "evaluation-support")] evaluation_precharge: *evaluation_precharge };
        let mut minted = Vec::new();
        let mut attempts = Vec::new();
        let original = context;
        let mut attempted=false;
        let resolution = Committer::run_program_until(store, digest, &original.viewer, op, deadline, |tx| {
            let mut context = original.clone();
            if attempted && dynamic_time {context.now=Some(crate::now_ms().max(context.now.unwrap_or(0)));}
            attempted=true;
            context.new_ids = minted.iter().cloned().chain(original.new_ids.iter().skip(minted.len()).cloned()).collect();
            let mut attempt=super::program_transcript::Attempt::default();
            let result=program_attempt(&host, tx, name, op, context, publication_requested, &wire_args, &mut authority, &mut minted,&mut attempt)
                .map(|d| d.map(|(outcome, data)| Pending::new(outcome, data)));
            attempts.push(attempt);result
        })?;
        Committer::finish(self, resolution, |engine, data, mut ack| {
            if let Some((entropy, publication)) = data { engine.entropy = entropy; ack.publication = publication; }
            Ok(ack)
        })

    }

}

#[cfg(test)]
#[path = "../store/publication_tests.rs"]
pub(crate) mod tests;

pub(super) struct ProgramHost<'a> {
    pub schema: &'a Schema,
    pub programs: &'a BTreeMap<String, Program>,
    pub entropy: u64,
    pub minter: &'a crate::ids::Mint,
    pub presence: Option<std::sync::Arc<dyn Presence>>,
    pub ceilings: Ceilings,
    pub store_id: &'a str,
    pub generation: u64,
    pub dev_effects: bool,
    #[cfg(feature = "evaluation-support")]
    pub evaluation_precharge: Metered,
}
type AuthorityCheck<'a> = Option<&'a mut dyn FnMut(&super::committer::MemberTx<'_, '_>, &mut Context) -> Result<(), RuntimeError>>;

pub(super) fn program_attempt<'m, 's>(host: &ProgramHost<'_>, tx: super::committer::MemberTx<'m, 's>,
    name: &str, op: Option<&str>, mut context: Context, publication_requested: bool,
    wire_args: &serde_json::Value, authority: &mut AuthorityCheck<'_>, minted: &mut Vec<String>, attempt:&mut super::program_transcript::Attempt,
) -> Result<super::committer::Disposition<(MutationAcknowledgement, Option<(u64, Option<DurablePublication>)>)>, RuntimeError> {
            if let Some(check) = authority.as_mut() { check(&tx,&mut context)?; validate::write_identity(&context.viewer, op)?; }
            // @ref LLP 3000.009.001.000.001#35-each-command-keeps-its-own-place — a later command observes a receipt committed during the head-lock wait.
            if let Some(op) = op
                && let Some(outcome) = tx.replay_bound(&context.viewer, op, name, &wire_args)?
            {
                // Applied between the check above and this transaction.
                let outcome = MutationOutcome::from_receipt(&outcome)?;
                return tx.rollback((MutationAcknowledgement::unpublished(outcome), None));
            }
            if let Some(op)=op{tx.require_placement(&context.viewer,op,name,&wire_args)?;}
            context.now = Some(tx.pin_writer_time(host.schema, context.now.unwrap_or(0))?);
            host.schema.check_delivery(name, context.delivery_fingerprint.as_deref())?;
            let program = host.programs.get(name).ok_or_else(|| RuntimeError::UnknownOp(name.to_owned()))?.clone();
            if program.kind == ProgramKind::Query {
                return Err(RuntimeError::UnknownOp(format!("{name} is a query, not a mutation")));
            }
            if program.kind == ProgramKind::Action {
                return Err(RuntimeError::UnknownOp(format!("{name} is an action: call it with client.act")));
            }
            if program.kind == ProgramKind::Job {
                return Err(RuntimeError::UnknownOp(format!("{name} is a job: a schedule fires it, or `snapback4 run {name}` does; no caller can")));
            }
            if let Err(error) = validate::validate_inputs(host.schema, &program, &mut context.args) {
                return tx.abort((MutationAcknowledgement::unpublished(MutationOutcome { receipt_only: false, state: WriteState::Failed { why: error.refusal(), current: None }, metered: Metered::default(), tables: Vec::new(), events: 0, replayed: false }), None));
            }
            if context.presence.is_none() {
                context.presence = host.presence.clone();
            }
            attempt.observe(&mut context);
            context.entropy = host.entropy;
            context.minter = host.minter.clone();
            let ceilings = host.ceilings;
            let viewer = context.viewer.clone();
            let now = context.now.unwrap_or(0);
            // An `image`/`video` argument names an upload by id; the program
            // reads the facts the server established (`clip.duration`), so
            // they are put in place before it runs. An id that is not the
            // writer's own upload stays as sent and the write refuses it.
            for (name, kind) in &program.args {
                let inner = match kind {
                    crate::ir::ArgType::Optional(inner) => inner.as_ref(),
                    other => other,
                };
                if !matches!(inner, crate::ir::ArgType::Image { .. } | crate::ir::ArgType::Video { .. } | crate::ir::ArgType::File { .. }) {
                    continue;
                }
                let Some(id) = asset_id(context.args.get(name)).map(str::to_owned) else { continue;
                };
                if let Some(asset) = tx.asset(&id)?
                    && (asset.owner == viewer || context.is_system())
                {
                    // @ref LLP 3000.038#3 — a file argument never reads an image's facts, nor an image argument a file's.
                    if (asset.kind == AssetKind::File) != matches!(inner, crate::ir::ArgType::File { .. }) {
                        let wanted = if matches!(inner, crate::ir::ArgType::File { .. }) { "a file" } else { "an image or video" };
                        let error = RuntimeError::Asset { code: "E_ASSET_TYPE", message: format!("{name} takes {wanted} and {id} is {}; upload it as {wanted}", asset.kind.word()) };
                        return tx.abort((MutationAcknowledgement::unpublished(MutationOutcome { receipt_only: false, state: WriteState::Failed { why: error.refusal(), current: None }, metered: Metered::default(), tables: Vec::new(), events: 0, replayed: false }), None));
                    }
                    context.args.insert(name.clone(), asset.column_value());
                }
            }
            tx.savepoint("program")?;
            let mut runner = Runner::new(&tx, host.schema, context, Meter::new(ceilings, Cut::Abort), tx.next_seq()?);
            #[cfg(feature = "evaluation-support")]
            { runner.meter.used = host.evaluation_precharge; }
            let ran = runner.run(&program).and_then(|value| {
                runner.charge_output(&value)?;
                Ok(value)
            });
            // Commit-end expiry can cascade or clear rows that an `after insert`
            // witness names. Final obligations therefore inspect the actual
            // provisional commit state, after every retirement action.
            let ran = ran.and_then(|value| runner.retire_expired_births().map(|_| value))
                .and_then(|value| runner.check_final_exists().map(|_| value));
            let metered = runner.meter.used;
            let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
            let events: Vec<Event> = runner.events.take();
            let action_tables = std::mem::take(&mut runner.action_tables);
            let outbox = std::mem::take(&mut runner.outbox);
            let rows_written = runner.rows_written;
            let mut read_tables = runner.read_tables.clone();
            let entropy = runner.context.entropy;
            *minted = runner.context.minted_ids.clone();
            attempt.minted = runner.context.minted_ids.clone();
            drop(runner);
            let outcome = match ran {
                Ok(result) => {
                    tx.release("program")?;
                    // @ref LLP 3000.019#4 — P7 reports keep at-most-once custody.
                    // @ref LLP 3000.022#6 — a covered report keeps only a receipt at the committed head.
                    let receipt_only = rows_written == 0 && outbox.is_empty()
                        && host.schema.delivery.iter().any(|binding| binding.mutation == name);
                    let seq = tx.next_seq()? - u64::from(receipt_only);
                    read_tables.extend(tables.iter().cloned());
                    if !receipt_only {
                        tx.record_commit(seq, now, (name, &viewer, program.kind.word()), &tables, rows_written)?;
                        tx.append(seq, &events)?;
                        tx.record_effects(&outbox, seq, now, host.dev_effects, host.schema)?;
                    }
                    MutationOutcome { receipt_only, state: WriteState::Sent { seq, result }, metered, tables, events: partition::disclosed_event_count(host.schema, &events, &action_tables), replayed: false }
                }
                Err(error @ RuntimeError::StoreUnsupported { .. }) => {
                    tx.rollback(())?;
                    return Err(error);
                }
                Err(error) if error.is_refusal() => {
                    tx.rollback_to("program")?;
                    let current = match &error {
                        RuntimeError::Conflict { current } => {
                            let mut probe = Runner::new(&tx, host.schema, Context::new(viewer.clone(), BTreeMap::new()).at(now), Meter::new(Ceilings::default(), Cut::Cap), 0);
                            let value = probe.get(current).ok();
                            value
                        }
                        _ => None,
                    };
                    let why=seat_refusal(host.schema,&error,&viewer);
                    MutationOutcome { receipt_only: false, state: WriteState::Failed { why, current }, metered, tables: Vec::new(), events: 0, replayed: false }
                }
                Err(error) => {
                    tx.rollback(())?;
                    return Err(error);
                }
            };
            if let Some(op) = op {
                let seq = match &outcome.state {
                    WriteState::Sent { seq, .. } => *seq,
                    WriteState::Failed { .. } => tx.next_seq()? - 1,
                };
                tx.record_applied(&viewer, op, seq, &serde_json::to_string(&outcome.receipt(Some(op))).map_err(|e| RuntimeError::Store(e.to_string()))?)?;
                tx.bind_applied(&viewer, op, name, &wire_args, now)?;
            }
            let publication = match outcome.state {
                WriteState::Sent { seq, .. } if publication_requested => Some(DurablePublication {
                    store_id: host.store_id.to_owned(), head: seq, generation: host.generation,
                    preserved: if outcome.receipt_only {
                        Some(crate::revocation::Footprint::default().preserved(host.schema))
                    } else { committed_preservation(tx.change_footprint(), host.schema) },
                }),
                _ => None,
            };
            tx.complete((MutationAcknowledgement::unpublished(outcome), Some((entropy, publication))))
}
