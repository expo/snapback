//! Serial programs over one fenced transaction; no speculative executor.
use super::{
    Engine,
    committer::{Committer, Kind, Member, Pending, Resolution, outcome::Failure},
    mutation::{ProgramHost, program_attempt},
    program::Invocation,
};
use crate::{Refusal, RuntimeError, engine::MutationAcknowledgement};
use std::{sync::Arc, time::Instant};
type Outcome = Result<MutationAcknowledgement, Refusal>;
type ProgramResolution = Resolution<Outcome, Option<(u64, Option<super::DurablePublication>)>>;
type Attempt = Result<Vec<(usize, ProgramResolution)>, (Failure, Option<Refusal>)>;
#[cfg(test)]
#[path = "program_batch_fault.rs"]
pub(super) mod fault;

impl Engine {
    // @ref LLP 3000.009.001.000.002#3.2 — serial members see predecessors' provisional rows and receipts; hooks wait for physical durability.
    pub fn invoke_program_batch(&mut self, batch: &mut [Invocation]) -> Vec<Outcome> {
        assert!(batch.len() <= 32, "bounded program batch");
        let mut results = vec![None; batch.len()];
        let mut start = 0;
        while start < batch.len() {
            if !batch[start].eligible(self) {
                results[start] = Some(self.invoke_program(&mut batch[start]));
                start += 1;
                continue;
            }
            let end = (start + 1..batch.len())
                .find(|&i| !batch[i].eligible(self))
                .unwrap_or(batch.len());
            let mut indices: Vec<usize> = Vec::new();
            let mut aliases = Vec::new();
            for i in start..end {
                if let Err(why) = batch[i].bind(self) {
                    results[i] = Some(Err(why));
                    continue;
                }
                if let Some(value) = batch[i].cached() {
                    results[i] = Some(value);
                    continue;
                }
                if let Some(&original) = indices
                    .iter()
                    .find(|&&j| Arc::ptr_eq(&batch[j].identity, &batch[i].identity))
                {
                    aliases.push((i, original));
                } else {
                    indices.push(i);
                }
            }
            if indices.len() == 1 {
                let i = indices[0];
                results[i] = Some(self.invoke_program(&mut batch[i]));
            } else if !indices.is_empty() {
                self.program_group(batch, &indices, &mut results);
            }
            for (alias, original) in aliases {
                results[alias] = results[original].clone();
            }
            start = end;
        }
        results.into_iter().map(Option::unwrap).collect()
    }

    fn finish_programs(
        &mut self,
        batch: &[Invocation],
        values: Vec<(usize, ProgramResolution)>,
        results: &mut [Option<Outcome>],
    ) {
        for (i, resolution) in values {
            let value = Committer::finish(self, resolution, |engine, data, mut ack| {
                if let Some((entropy, publication)) = data {
                    engine.entropy = entropy;
                    if let Ok(ack) = ack.as_mut() {
                        ack.publication = publication;
                    }
                }
                Ok(ack)
            })
            .map_err(|error| error.refusal())
            .and_then(|value| value);
            results[i] = Some(batch[i].remember(value));
        }
    }
    fn program_group(
        &mut self,
        batch: &mut [Invocation],
        indices: &[usize],
        results: &mut [Option<Outcome>],
    ) {
        let failure = match self.program_group_attempt(batch, indices, false) {
            Ok(values) => {
                self.finish_programs(batch, values, results);
                return;
            }
            Err(failure) => failure,
        };
        let (failure, named_refusal) = failure;
        let why = failure.refusal(named_refusal);
        if !failure.aborted {
            for &i in indices {
                results[i] = Some(batch[i].remember(Err(why.clone())));
            }
            return;
        }
        // No continuation/result from the aborted physical transaction survives.
        // A fallback gets one attempt, never recursively starts another retry loop.
        let mut remaining = Vec::new();
        for &i in indices {
            if failure.member == Some(i) || Instant::now() >= batch[i].deadline {
                results[i] = Some(batch[i].remember(Err(why.clone())));
            } else {
                remaining.push(i);
            }
        }
        if failure.member.is_some() {
            self.program_named_fallback(batch, remaining, results, why);
        } else {
            for i in remaining {
                if Instant::now() >= batch[i].deadline {
                    results[i] = Some(batch[i].remember(Err(why.clone())));
                } else {
                    self.program_fallback(batch, &[i], results);
                }
            }
        }
    }
    fn program_named_fallback(
        &mut self,
        batch: &mut [Invocation],
        mut remaining: Vec<usize>,
        results: &mut [Option<Outcome>],
        mut why: Refusal,
    ) {
        // Each named abort removes a member. This loop is bounded by N and
        // every survivor's original deadline, even when several members fail
        // at different store boundaries. A solo failure never starts another loop.
        while !remaining.is_empty() {
            remaining.retain(|&i| {
                if Instant::now() >= batch[i].deadline {
                    results[i] = Some(batch[i].remember(Err(why.clone())));
                    false
                } else {
                    true
                }
            });
            if remaining.is_empty() {
                return;
            }
            match self.program_group_attempt(batch, &remaining, true) {
                Ok(values) => {
                    self.finish_programs(batch, values, results);
                    return;
                }
                Err((failure, named)) => {
                    why = failure.refusal(named);
                    if !failure.aborted {
                        for i in remaining {
                            results[i] = Some(batch[i].remember(Err(why.clone())));
                        }
                        return;
                    }
                    if let Some(failed) = failure.member {
                        results[failed] = Some(batch[failed].remember(Err(why.clone())));
                        remaining.retain(|&i| i != failed);
                    } else {
                        for i in remaining {
                            if Instant::now() >= batch[i].deadline {
                                results[i] = Some(batch[i].remember(Err(why.clone())));
                            } else {
                                self.program_fallback(batch, &[i], results);
                            }
                        }
                        return;
                    }
                }
            }
        }
    }
    fn program_fallback(
        &mut self,
        batch: &mut [Invocation],
        indices: &[usize],
        results: &mut [Option<Outcome>],
    ) {
        if indices.is_empty() {
            return;
        }
        match self.program_group_attempt(batch, indices, true) {
            Ok(values) => self.finish_programs(batch, values, results),
            Err((failure, named)) => {
                let why = failure.refusal(named);
                for &i in indices {
                    results[i] = Some(batch[i].remember(Err(why.clone())));
                }
            }
        }
    }

    fn program_group_attempt(
        &mut self,
        batch: &mut [Invocation],
        indices: &[usize],
        fallback: bool,
    ) -> Attempt {
        let Engine {
            store,
            schema,
            programs,
            entropy,
            minter,
            presence,
            ceilings,
            store_id,
            generation,
            dev_effects,
            #[cfg(feature = "evaluation-support")]
            evaluation_precharge,
            ..
        } = self;
        let mut host = ProgramHost {
            schema,
            programs,
            entropy: *entropy,
            minter,
            presence: presence.clone(),
            ceilings: *ceilings,
            store_id,
            generation: *generation,
            dev_effects: *dev_effects,
            #[cfg(feature = "evaluation-support")]
            evaluation_precharge: *evaluation_precharge,
        };
        let deadline = fallback.then(|| indices.iter().map(|&i| batch[i].deadline).min().unwrap());
        let first = &batch[indices[0]];
        #[cfg(any(test, feature = "test-support"))]
        let _attribution = first
            .attribution
            .clone()
            .map(crate::round_trips::Handle::enter);
        let physical = Committer::open_program_before(
            store,
            first.authority.as_ref().map(|a| a.digest.as_str()),
            &first.context.viewer,
            first.id.as_deref(),
            fallback.then_some(first.deadline),
        );
        let tx = physical.map_err(|error| {
            (
                Failure {
                    error,
                    aborted: false,
                    member: None,
                },
                None,
            )
        })?;
        if indices.len() > 1 {
            if let Err(error) = tx.enable_group_tail() {
                return Err((Failure::rollback(tx, error, None), None));
            }
        }
        #[cfg(any(test, feature = "test-support"))]
        drop(_attribution);
        let mut pending = Vec::new();
        for &i in indices {
            #[cfg(test)]
            let _member = fault::enter(i);
            #[cfg(test)]
            if let Err(error) = fault::check(fault::Point::BeforeMember, i) {
                return Err((Failure::rollback(tx, error, Some(i)), None));
            }
            let invocation = &mut batch[i];
            #[cfg(any(test, feature = "test-support"))]
            let _attribution = invocation
                .attribution
                .clone()
                .map(crate::round_trips::Handle::enter);
            let mut budget_error = None;
            let budget = if fallback {
                match tx.bound_program_attempt(invocation.deadline) {
                    Ok(budget) => Some(budget),
                    Err(error) => {
                        budget_error = Some(error);
                        None
                    }
                }
            } else {
                None
            };
            if let Some(error) = budget_error {
                drop(budget);
                return Err((Failure::rollback(tx, error, Some(i)), None));
            }
            let mut context = invocation.context.clone();
            context.generation = host.generation;
            context.now = Some(context.now.unwrap_or_else(crate::now_ms));
            context.new_ids = invocation
                .minted
                .iter()
                .cloned()
                .chain(
                    invocation
                        .context
                        .new_ids
                        .iter()
                        .skip(invocation.minted.len())
                        .cloned(),
                )
                .collect();
            let raw = context.wire_args.take().unwrap_or_else(|| {
                serde_json::Value::Object(crate::wire::map_to_json(&context.args))
            });
            let refused = std::cell::RefCell::new(None);
            let authorized = invocation.authority.is_some();
            let rerun = !invocation.attempts.is_empty();
            if rerun && invocation.context.now.is_none() {
                context.now = Some(crate::now_ms().max(context.now.unwrap_or(0)));
            }
            let mut check = |member: &super::committer::MemberTx<'_, '_>,
                             context: &mut super::Context| {
                let auth = invocation.authority.as_mut().unwrap();
                let sampled = (auth.sample)();
                if rerun {
                    context.now = Some(context.now.unwrap_or(sampled.now).max(sampled.now));
                }
                let facts = member.request_authority(&auth.digest, sampled)?;
                (auth.check)(facts).map_err(|why| {
                    let error = RuntimeError::Auth(why.message.clone());
                    *refused.borrow_mut() = Some(why);
                    error
                })
            };
            let mut authority = if authorized {
                Some(
                    &mut check
                        as &mut dyn FnMut(
                            &super::committer::MemberTx<'_, '_>,
                            &mut super::Context,
                        ) -> Result<(), RuntimeError>,
                )
            } else {
                None
            };
            let mut scope = invocation.scope.take();
            let mut transcript = super::program_transcript::Attempt::default();
            let mut value = None;
            let mut run = || {
                if value.is_some() {
                    return;
                }
                value = Some(Committer::execute_program(
                    &tx,
                    Member::new(Kind::Program, |member| {
                        if authority.is_none() {
                            super::validate::write_identity(
                                &context.viewer,
                                invocation.id.as_deref(),
                            )?;
                        }
                        program_attempt(
                            &host,
                            member,
                            &invocation.name,
                            invocation.id.as_deref(),
                            context.clone(),
                            true,
                            &raw,
                            &mut authority,
                            &mut invocation.minted,
                            &mut transcript,
                        )
                        .map(|d| d.map(|(outcome, data)| Pending::new(Ok(outcome), data)))
                    }),
                    |error| {
                        Pending::new(
                            Err(refused
                                .borrow_mut()
                                .take()
                                .unwrap_or_else(|| error.refusal())),
                            None,
                        )
                    },
                ));
            };
            if let Some(scope) = scope.as_mut() {
                scope(&mut run);
            } else {
                run();
            }
            invocation.scope = scope;
            invocation.attempts.push(transcript);
            drop(budget);
            match value.unwrap() {
                Ok(disposition) => {
                    #[cfg(test)]
                    if let Err(error) = fault::check(fault::Point::AfterMember, i) {
                        return Err((Failure::rollback(tx, error, Some(i)), None));
                    }
                    let resolution = Committer::resolution(disposition);
                    if let Some((entropy, _)) = &resolution.pending.data {
                        host.entropy = *entropy;
                    }
                    pending.push((i, resolution));
                    continue;
                }
                Err(error) => {
                    return Err((
                        Failure::rollback(tx, error, Some(i)),
                        refused.borrow_mut().take(),
                    ));
                }
            }
        }
        #[cfg(any(test, feature = "test-support"))]
        let _attribution = batch[indices[0]]
            .attribution
            .clone()
            .map(crate::round_trips::Handle::enter);
        #[cfg(test)]
        if let Err(error) = fault::check(fault::Point::BeforeTail, usize::MAX) {
            return Err((Failure::rollback(tx, error, None), None));
        }
        if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            return Err((
                Failure::rollback(
                    tx,
                    RuntimeError::Store("program invocation's remaining deadline elapsed".into()),
                    None,
                ),
                None,
            ));
        }
        let prepared: Result<(), RuntimeError> = (|| {
            // Shared tail work uses the earliest survivor, after each member's
            // statements have used that member's own original deadline.
            let _budget = deadline.map(|d| tx.bound_program_attempt(d)).transpose()?;
            tx.prepare_program_commit()
        })();
        if let Err(error) = prepared {
            return Err((Failure::rollback(tx, error, None), None));
        }
        #[cfg(test)]
        for point in [fault::Point::AfterTail, fault::Point::BeforeCommit] {
            if let Err(error) = fault::check(point, usize::MAX) {
                return Err((Failure::rollback(tx, error, None), None));
            }
        }
        if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            return Err((
                Failure::rollback(
                    tx,
                    RuntimeError::Store("program invocation's remaining deadline elapsed".into()),
                    None,
                ),
                None,
            ));
        }
        tx.commit_program().map_err(|failure| (failure, None))?;
        #[cfg(test)]
        if let Err(error) = fault::check(fault::Point::AfterCommit, usize::MAX) {
            return Err((Failure::commit(error), None));
        }
        Ok(pending)
    }
}

#[cfg(test)]
#[path = "../store/program_batch_tests.rs"]
pub(super) mod tests;
