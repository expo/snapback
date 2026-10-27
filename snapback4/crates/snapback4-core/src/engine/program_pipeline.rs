//! The committer owns interpretation and release; slots own final-flight I/O.
// @ref LLP 3000.009.001.000.000.002#3.6 — pending state is chained, never installed until ordered release.
use super::committer::overlay::RowKey;
use crate::{Value, receipts::ReceiptRecord};
use std::collections::BTreeMap;
#[derive(Default, Clone)]
pub(crate) struct Chain {
    pub images: BTreeMap<RowKey, Value>,
    pub receipts: BTreeMap<(String, String), ReceiptRecord>,
    pub entropy: u64,
    #[cfg(feature = "postgres")]
    pub head: Option<super::postgres::group_commit::Head>,
    #[cfg(feature = "postgres")]
    pub ticket: Option<i64>,
}
#[cfg(feature = "postgres")]
mod lane {
    use super::*;
    use crate::engine::{
        committer::outcome::Failure,
        postgres::read_grant::{FlightGuard, Published},
        program::Invocation,
        program_batch::{Outcome, ProgramResolution},
    };
    use crate::{Engine, RuntimeError, store_port::AnyStore};
    use std::{collections::VecDeque, sync::mpsc, thread};
    type Job = Box<dyn FnOnce() + Send>;
    struct Driver {
        sender: Option<mpsc::Sender<Job>>,
        worker: Option<thread::JoinHandle<()>>,
    }
    impl Driver {
        fn new(slot: usize) -> Self {
            let (sender, receiver) = mpsc::channel::<Job>();
            let worker = thread::Builder::new()
                .name(format!("sb4-pg-slot-{slot}"))
                .spawn(move || {
                    while let Ok(job) = receiver.recv() {
                        job();
                    }
                })
                .expect("writer slot thread");
            Self {
                sender: Some(sender),
                worker: Some(worker),
            }
        }
        fn send(&self, job: Job) {
            self.sender
                .as_ref()
                .unwrap()
                .send(job)
                .unwrap_or_else(|_| panic!("writer slot stopped"));
        }
    }
    impl Drop for Driver {
        fn drop(&mut self) {
            self.sender.take();
            if let Some(worker) = self.worker.take() {
                let _ = worker.join();
            }
        }
    }
    struct Finished {
        store: AnyStore,
        result: Result<Option<Published>, Failure>,
        #[cfg(any(test, feature = "test-support"))]
        timing: crate::round_trips::CommitTiming,
        #[cfg(test)]
        confirmed: std::time::Instant,
    }
    type Finish = Box<dyn FnOnce(&mut Engine, Vec<Outcome>) + Send>;
    struct Flight {
        batch: Vec<Invocation>,
        durability: Option<(
            std::sync::Arc<super::super::postgres::early_release::Durability>,
            u64,
        )>,
        values: Vec<(usize, ProgramResolution)>,
        chain: Chain,
        receiver: mpsc::Receiver<Finished>,
        slot: usize,
        gate: Option<FlightGuard>,
        finish: Finish,
    }
    impl Flight {
        fn bind_publication(&mut self, engine: &Engine) {
            let head = self.chain.head.as_ref().unwrap();
            for (_, resolution) in &mut self.values {
                if let Ok(ack) = &mut resolution.pending.value {
                    if ack.publication.is_none() && resolution.pending.data.is_none() {
                        ack.publication = Some(super::super::mutation::DurablePublication {
                            store_id: engine.store_id.clone(),
                            head: head.seq as u64,
                            generation: engine.generation,
                            preserved: None,
                        });
                    }
                }
            }
        }
    }
    pub(in crate::engine) struct Lane {
        spare: Option<(AnyStore, usize)>,
        active_slot: usize,
        drivers: Vec<Driver>,
        placeholder: Option<AnyStore>,
        active: bool,
        pub paused: bool,
        recovery_after: Option<std::time::Instant>,
        recovery_delay: std::time::Duration,
        completion_notify: Option<std::sync::Arc<dyn Fn() + Send + Sync>>,
        recovery_allowed: Option<std::sync::Arc<dyn Fn() -> bool + Send + Sync>>,
        #[cfg(test)]
        pub hook: Option<super::super::postgres::writer_slot::Hook>,
        #[cfg(test)]
        next_ordinal: usize,
        flights: VecDeque<Flight>,
    }
    impl Lane {
        pub fn set_completion_notify(&mut self, notify: std::sync::Arc<dyn Fn() + Send + Sync>) {self.completion_notify=Some(notify);}
        pub fn new() -> Self {
            Self {
                spare: None,
                active_slot: 0,
                drivers: Vec::new(),
                placeholder: None,
                active: true,
                paused: false,
                recovery_after: None,
                recovery_delay: std::time::Duration::from_millis(10),
                completion_notify: None,
                recovery_allowed: None,
                #[cfg(test)]
                hook: None,
                #[cfg(test)]
                next_ordinal: 0,
                flights: VecDeque::new(),
            }
        }
        // @ref LLP 3000.009.001.000.000.002#8.1 — physical writer sessions and constant protocol code are ready before ingress.
        pub fn prepare(&mut self, engine: &mut Engine) -> Result<(), RuntimeError> {
            if !matches!(engine.store, AnyStore::Postgres(_)) || self.spare.is_some() { return Ok(()); }
            let mut spare = engine.store.pipeline_slot()?;
            engine.store.prepare_pipeline_writer()?;
            spare.prepare_pipeline_writer()?;
            self.spare = Some((spare, 1));
            self.drivers = (0..2).map(Driver::new).collect();
            self.placeholder = Some(AnyStore::memory()?);
            Ok(())
        }
        #[cfg(test)]
        fn prepared_calls(store: &mut AnyStore) -> u64 {
            let store = store.test_postgres_handle_mut().store.get_mut();
            let calls = store.calls.get();
            store.prepare_batch_protocol().unwrap();
            assert_eq!(store.calls.get(), calls, "constant protocol code must already be prepared");
            calls
        }
        pub fn set_recovery_guard(&mut self, allowed: std::sync::Arc<dyn Fn() -> bool + Send + Sync>) {
            self.recovery_allowed = Some(allowed);
        }
        pub fn len(&self) -> usize {
            self.flights.len()
        }
        pub fn empty(&self) -> bool {
            self.flights.is_empty()
        }
        pub fn close_uncertain(&self, engine: &Engine) {
            // A depth-two dispatch can leave the engine's empty placeholder
            // installed. Flights retain the same store-shared epoch and G6.
            let durability = engine.store.durability().or_else(|| {
                self.flights.iter().find_map(|f| f.durability.as_ref().map(|(d, _)| d.clone()))
            });
            if let Some(d) = durability {
                d.break_history();
                return;
            }
            if let Some(grant) = engine
                .store
                .read_grant()
                .filter(|g| g.configured.load(std::sync::atomic::Ordering::Acquire))
            {
                grant.close_uncertain();
            }
            // At depth two the engine temporarily holds its empty placeholder;
            // the dispatched flights still retain the same gate's custody.
            for flight in &self.flights {
                if let Some(gate) = &flight.gate {
                    gate.close_uncertain();
                }
            }
        }
        pub fn eligible(engine: &Engine, batch: &[Invocation], chained: bool, plans: &mut super::super::program_batch::Plans) -> bool {
            !batch.iter().enumerate().any(|(n, i)| {
                batch[..n]
                    .iter()
                    .any(|j| std::sync::Arc::ptr_eq(&i.identity, &j.identity))
            }) && matches!(engine.store, AnyStore::Postgres(_))
                && (batch.len() > 1 || (chained && batch.len() == 1))
                && batch.iter().enumerate().all(|(n,i)| {
                    i.eligible(engine)
                        && i.cached().is_none()
                        && i.bind(engine).is_ok()
                        && super::super::program_batch::bounded_plan(plans,n,engine,batch).is_some()
                })
                && !engine
                    .schema
                    .tables
                    .values()
                    .any(|t| t.not_before.is_some())
        }
        #[cfg(test)]
        pub fn start(&mut self, engine: &mut Engine, batch: Vec<Invocation>, finish: Finish) {
            let mut plans: super::super::program_batch::Plans = (0..batch.len()).map(|_|None).collect();
            for i in 0..batch.len() { super::super::program_batch::bounded_plan(&mut plans,i,engine,&batch); }
            self.start_planned(engine,batch,plans,finish);
        }
        pub fn start_planned(&mut self, engine: &mut Engine, mut batch: Vec<Invocation>, mut plans: super::super::program_batch::Plans, finish: Finish) {
            if self.empty() { self.recover_idle_durability(engine); }
            if self.paused {
                finish(
                    engine,
                    batch
                        .iter()
                        .map(|_| {
                            Err(RuntimeError::StoreOwnership(
                                "pipeline recovery requires fenced reopen".into(),
                            )
                            .refusal())
                        })
                        .collect(),
                );
                return;
            }
            assert!(self.active && self.len() < 2);
            if self.spare.is_none() && self.empty() {
                if self.prepare(engine).is_err() {
                    let out = engine.invoke_program_batch_planned(&mut batch, &mut plans);
                    finish(engine, out);
                    return;
                }
            }
            if self.empty() {
                // Every previous final is drained at this point. Either slot
                // may have lost its transport; reconnect without re-seeding.
                let refreshed = engine.store.refresh_pipeline_writer().and_then(|()| {
                    if let Some((spare, _)) = &mut self.spare {
                        spare.refresh_pipeline_writer()?;
                    }
                    Ok(())
                });
                if let Err(error) = refreshed {
                    finish(engine, batch.iter().map(|_| Err(error.refusal())).collect());
                    return;
                }
                if let Some((spare, _)) = &mut self.spare {
                    spare.sync_pipeline_slot(&engine.store);
                }
            }
            let chain = self
                .flights
                .back()
                .map(|f| f.chain.clone())
                .unwrap_or_else(|| Chain {
                    entropy: engine.entropy,
                    ..Default::default()
                });
            let indices: Vec<_> = (0..batch.len()).collect();
            let mut staged = None;
            let values =
                engine.program_group_staged(&mut batch, &indices, false,
                    plans.into_iter().map(|p|p.unwrap()).collect(), Some(&chain), &mut staged);
            let values = match values {
                Ok(values) => values,
                Err(failure) => {
                    if !failure.0.aborted
                        && matches!(&failure.0.error, RuntimeError::CommitOutcomeUnknown(_))
                    {
                        self.close_uncertain(engine);
                    }
                    // start admits at most one predecessor. Retain its original
                    // terminal outcome, even if its callers recover successfully.
                    let predecessor_aborted = self.poll(engine, true);
                    debug_assert!(self.empty());
                    if self.paused {
                        finish(
                            engine,
                            batch
                                .iter()
                                .map(|_| {
                                    Err(RuntimeError::StoreOwnership(
                                        "pipeline drain failed".into(),
                                    )
                                    .refusal())
                                })
                                .collect(),
                        );
                        return;
                    }
                    let mut results = vec![None; batch.len()];
                    if predecessor_aborted && failure.0.may_rerun() {
                        engine.program_cascade_fallback(&mut batch, &indices, &mut results);
                    } else {
                        engine.program_recover(&mut batch, &indices, &mut results, failure);
                    }
                    finish(engine, results.into_iter().map(Option::unwrap).collect());
                    return;
                }
            };
            let frozen = staged.expect("staged Postgres batch");
            #[cfg(test)]
            let frozen = {
                let mut frozen = frozen;
                frozen.hook = self.hook.clone();
                frozen.ordinal = self.next_ordinal;
                self.next_ordinal += 1;
                frozen
            };
            let entropy = values
                .iter()
                .rev()
                .find_map(|(_, v)| v.pending.data.as_ref().map(|d| d.0))
                .unwrap_or(chain.entropy);
            let chain = frozen.chain(entropy);
            let gate = match engine
                .store
                .read_grant()
                .filter(|g| g.configured.load(std::sync::atomic::Ordering::Acquire))
                .map(|g| g.begin_flight())
                .transpose()
            {
                Ok(g) => g,
                Err(error) => {
                    // This attempt has no final message. Resume only to roll it back.
                    let ticket = frozen.ticket;
                    let rollback = engine.store.abort_suspended(frozen);
                    if rollback.is_err() {
                        self.close_uncertain(engine);
                    }
                    self.drain(engine);
                    let error = if let Err(rollback) = rollback {
                        if engine.store.drain_program_tickets(&[ticket]).is_err() {
                            self.paused = true;
                            let _ = engine.store.fence_pipeline_terminal();
                        }
                        RuntimeError::CommitOutcomeUnknown(format!(
                            "undispatched gate rollback unacknowledged: {rollback}"
                        ))
                    } else {
                        error
                    };
                    finish(
                        engine,
                        batch
                            .iter()
                            .map(|i| i.remember(Err(error.refusal())))
                            .collect(),
                    );
                    return;
                }
            };
            let dispatch_guard = batch[0].final_dispatch.clone();
            let mut intent = Some((batch, values, frozen, gate, finish, chain));
            let mut dispatch = || {
                let (batch, values, frozen, gate, finish, chain) = intent.take().unwrap();
                self.schedule(engine, batch, values, frozen, gate, finish, chain);
            };
            let permitted = if let Some(guard) = dispatch_guard {
                guard(&mut dispatch)
            } else {
                dispatch();
                Ok(())
            };
            drop(dispatch);
            if let Err(error) = permitted {
                let (batch, _, frozen, gate, finish, _) = intent.take().unwrap();
                let rollback = engine.store.abort_suspended(frozen);
                let unknown = rollback.is_err();
                if let Some(gate) = gate {
                    gate.resolve(None, unknown);
                }
                self.drain(engine);
                if unknown {
                    self.paused = true;
                    self.close_uncertain(engine);
                    let _ = engine.store.fence_pipeline_terminal();
                }
                let why = rollback
                    .err()
                    .map(|e| {
                        RuntimeError::CommitOutcomeUnknown(format!(
                            "undispatched rollback unacknowledged: {e}"
                        ))
                    })
                    .unwrap_or(error)
                    .refusal();
                finish(
                    engine,
                    batch.iter().map(|i| i.remember(Err(why.clone()))).collect(),
                );
            }
        }
        fn schedule(
            &mut self,
            engine: &mut Engine,
            batch: Vec<Invocation>,
            values: Vec<(usize, ProgramResolution)>,
            frozen: super::super::postgres::writer_slot::Suspended,
            gate: Option<FlightGuard>,
            finish: Finish,
            chain: Chain,
        ) {
            #[cfg(test)]
            let dispatched = std::time::Instant::now();
            #[cfg(test)]
            let n = batch.len();
            let durability = engine.store.durability().map(|d| (d, frozen.release_epoch));
            let slot = self.active_slot;
            let (replacement, next_slot) = self.spare.take().unwrap_or_else(|| {
                self.active = false;
                (self.placeholder.take().unwrap(), 0)
            });
            self.active_slot = next_slot;
            let mut store = std::mem::replace(&mut engine.store, replacement);
            let (send, receiver) = mpsc::sync_channel(1);
            #[cfg(any(test, feature = "test-support"))]
            let attribution = batch[0].attribution.clone();
            let notify=self.completion_notify.clone();
            self.drivers[slot].send(Box::new(move || {
                #[cfg(any(test, feature = "test-support"))]
                let _attribution = attribution.map(crate::round_trips::Handle::enter);
                #[cfg(any(test, feature = "test-support"))]
                let before = crate::round_trips::commit_timing();
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    store.finish_suspended(frozen)
                }))
                .unwrap_or_else(|_| {
                    Err(Failure {
                        error: RuntimeError::CommitOutcomeUnknown("writer slot panicked".into()),
                        aborted: false,
                        member: None,
                    })
                });
                #[cfg(any(test, feature = "test-support"))]
                let timing = {
                    let after = crate::round_trips::commit_timing();
                    crate::round_trips::CommitTiming {
                        attempts: after.attempts - before.attempts,
                        nanos: after.nanos - before.nanos,
                    }
                };
                #[cfg(test)]
                crate::engine::wf_profile::record("final", dispatched.elapsed(), 0, n);
                let _ = send.send(Finished {
                    #[cfg(test)]
                    confirmed: std::time::Instant::now(),
                    store,
                    result,
                    #[cfg(any(test, feature = "test-support"))]
                    timing,
                });
                if let Some(notify)=notify {notify();}
            }));
            self.flights.push_back(Flight {
                batch,
                durability,
                values,
                chain,
                receiver,
                slot,
                gate,
                finish,
            });
        }
        fn restore(&mut self, engine: &mut Engine, store: AnyStore, slot: usize) {
            if self.active {
                self.spare = Some((store, slot));
            } else {
                self.placeholder = Some(std::mem::replace(&mut engine.store, store));
                self.active = true;
                self.active_slot = slot;
            }
        }
        /// Whether the oldest original transaction affirmatively aborted.
        pub fn poll(&mut self, engine: &mut Engine, wait: bool) -> bool {
            let Some(front) = self.flights.front() else {
                return false;
            };
            let result = if wait {
                front.receiver.recv().ok()
            } else {
                match front.receiver.try_recv() {
                    Ok(v) => Some(v),
                    Err(mpsc::TryRecvError::Empty) => return false,
                    Err(_) => None,
                }
            };
            let mut flight = self.flights.pop_front().unwrap();
            let Finished {
                store,
                result,
                #[cfg(any(test, feature = "test-support"))]
                timing,
                #[cfg(test)]
                confirmed,
            } = result.expect("slot always returns custody");
            #[cfg(any(test, feature = "test-support"))]
            crate::round_trips::add_commit_timing(timing);
            #[cfg(test)]
            {crate::engine::wf_profile::record("done_to_poll", confirmed.elapsed(), 0, flight.batch.len());crate::engine::wf_profile::confirmed(confirmed);}
            #[cfg(test)]
            let _profile = crate::engine::wf_profile::Scope::new("release_callbacks", flight.batch.len());
            self.restore(engine, store, flight.slot);
            let result = result.and_then(|value| {
                if let Some((d, epoch)) = &flight.durability {
                    d.release_batch(*epoch, flight.chain.head.as_ref().unwrap())
                        .map_err(|error| Failure {
                            error,
                            aborted: false,
                            member: None,
                        })?;
                }
                Ok(value)
            });
            let known_abort;
            if result.is_err() {
                if result.as_ref().err().is_some_and(|f| !f.aborted)
                    && let Some((d, _)) = &flight.durability
                {
                    if !d.broken() {
                        d.break_history();
                    }
                }
                let broken = engine.store.durability().filter(|d| d.broken());
                // @ref LLP 3000.009.001.000.000.002#4.2 — resolve every dispatched successor before fresh facts, a barrier or a rerun.
                let mut resolved = vec![(flight, result)];
                while let Some(next) = self.flights.pop_front() {
                    let Finished {
                        store,
                        result,
                        #[cfg(any(test, feature = "test-support"))]
                        timing,
                        #[cfg(test)]
                        confirmed: _,
                    } = next.receiver.recv().expect("slot terminal result");
                    #[cfg(any(test, feature = "test-support"))]
                    crate::round_trips::add_commit_timing(timing);
                    self.restore(engine, store, next.slot);
                    resolved.push((next, result));
                }
                let tickets = resolved
                    .iter()
                    .rev()
                    .filter_map(|(f, r)| {
                        r.as_ref().err().filter(|e| !e.aborted).and(f.chain.ticket)
                    })
                    .collect::<Vec<_>>();
                let drained =
                    tickets.is_empty() || engine.store.drain_program_tickets(&tickets).is_ok();
                if !drained {
                    self.paused = true;
                    let _ = engine.store.fence_pipeline_terminal();
                }
                if broken.is_some() && drained {
                    // A lost connection is classified only after its backend
                    // ended. This uses a surviving/reconnected writer, never
                    // asks an in-progress xid to stand in for an abort witness.
                    for (flight, outcome) in &mut resolved {
                        if let Err(failure) = outcome {
                            if !failure.aborted
                                && engine
                                    .store
                                    .data_transaction_status(
                                        &flight.chain.head.as_ref().unwrap().xid,
                                    )
                                    .ok()
                                    .flatten()
                                    .as_deref()
                                    == Some("aborted")
                            {
                                failure.aborted = true;
                                failure.error = RuntimeError::Store(
                                    "data transaction provably aborted after drainage".into(),
                                );
                            }
                        }
                    }
                }
                if broken.is_some() {
                    // Every above-D caller dispatched in the discarded epoch
                    // stays unknown even if its marker arrived during drainage.
                    for (_, outcome) in &mut resolved {
                        if outcome.is_ok() {
                            *outcome = Err(Failure {
                                error: RuntimeError::CommitOutcomeUnknown(
                                    "epoch ended before ordered release".into(),
                                ),
                                aborted: false,
                                member: None,
                            });
                        }
                    }
                }
                // Counted closures are settled together before any recovery attempt.
                for (flight, result) in &mut resolved {
                    if let Some(gate) = flight.gate.take() {
                        gate.resolve(
                            result.as_ref().ok().cloned().flatten(),
                            result.as_ref().err().is_some_and(|f| !f.aborted),
                        );
                    }
                }
                if broken.is_some() && drained {
                    self.recover_idle_durability(engine);
                }
                let lower_known = resolved[0].1.as_ref().err().is_some_and(|f| f.aborted);
                let lower_unknown = resolved[0].1.as_ref().err().is_some_and(|f| !f.aborted);
                // Classify after E release and drained xid checks. Committed but
                // uncertified data never becomes a predecessor-abort witness.
                known_abort = lower_known;
                for (ordinal, (mut flight, result)) in resolved.into_iter().enumerate() {
                    let mut results = vec![None; flight.batch.len()];
                    let indices: Vec<_> = (0..flight.batch.len()).collect();
                    match result {
                        Ok(_) => {
                            flight.bind_publication(engine);
                            engine.finish_programs(&flight.batch, flight.values, &mut results)
                        }
                        Err(failure)
                            if ordinal > 0 && lower_known && failure.may_rerun() && drained && !self.paused =>
                        {
                            // Innocent conditional facts are discarded. One fresh whole
                            // batch fallback preserves deadlines and the original order.
                            engine.program_cascade_fallback(&mut flight.batch, &indices, &mut results);
                        }
                        Err(failure) if drained && !self.paused && !(ordinal > 0 && lower_unknown) => engine
                            .program_recover(
                                &mut flight.batch,
                                &indices,
                                &mut results,
                                (failure, None),
                            ),
                        Err(failure) => {
                            for (i, invocation) in flight.batch.iter().enumerate() {
                                results[i] =
                                    Some(invocation.remember(Err(failure.error.refusal())));
                            }
                        }
                    }
                    (flight.finish)(engine, results.into_iter().map(Option::unwrap).collect());
                }
            } else {
                known_abort = false;
                if let Some(gate) = flight.gate.take() {
                    gate.resolve(result.ok().flatten(), false);
                }
                let mut results = vec![None; flight.batch.len()];
                flight.bind_publication(engine);
                engine.finish_programs(&flight.batch, flight.values, &mut results);
                (flight.finish)(engine, results.into_iter().map(Option::unwrap).collect());
            }
            known_abort
        }
        fn recover_idle_durability(&mut self, engine: &mut Engine) {
            // A failed drain/terminal fence still requires reacquisition. Only
            // a drained E recovery failure arms this retry state.
            if !self.empty() || (self.paused && self.recovery_after.is_none()) {
                return;
            }
            let Some(gate) = engine.store.durability() else { return; };
            // @ref LLP 3000.009.001.000.000.002#3.9 — retry failed/superseded recovery in the current epoch, bounded by backoff and live ownership.
            // The watchdog can latch loss independently of blocked SQL. An
            // already dispatched uncancellable certificate keeps its outcome;
            // loss prevents the next attempt and never reopens queue admission.
            if self.recovery_allowed.as_ref().is_some_and(|allowed| !allowed()) {
                self.paused = true;
                self.recovery_after = None;
                return;
            }
            if self.recovery_after.is_some_and(|at| std::time::Instant::now() < at) {
                return;
            }
            let result = engine.store.refresh_pipeline_writer().and_then(|()| {
                if let Some((spare, _)) = &mut self.spare { spare.refresh_pipeline_writer()?; }
                Ok(())
            }).and_then(|()| {
                if gate.broken() { engine.store.recover_durability() } else { Ok(()) }
            });
            match result {
                Ok(()) => {
                    self.paused = false;
                    self.recovery_after = None;
                    self.recovery_delay = std::time::Duration::from_millis(10);
                }
                Err(_) => {
                    if !gate.broken() { gate.break_history(); }
                    self.paused = true;
                    self.recovery_after = Some(std::time::Instant::now() + self.recovery_delay);
                    self.recovery_delay = (self.recovery_delay * 2).min(std::time::Duration::from_millis(250));
                }
            }
        }
        pub fn drain(&mut self, engine: &mut Engine) {
            while !self.empty() {
                self.poll(engine, true);
            }
            self.recover_idle_durability(engine);
        }
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        #[ignore = "private Postgres"]
        fn g72_queue_preparation_warms_both_writers_without_a_data_commit() {
            let mut engine = crate::engine::program_batch::tests::fixture(true);
            let seq = engine.seq().unwrap();
            let mut lane = Lane::new();
            lane.prepare(&mut engine).unwrap();
            assert!(lane.empty());
            Lane::prepared_calls(&mut engine.store);
            Lane::prepared_calls(&mut lane.spare.as_mut().unwrap().0);
            assert_eq!(engine.seq().unwrap(), seq);
            lane.prepare(&mut engine).unwrap();
            assert_eq!(lane.drivers.len(), 2);
        }
    }
}
#[cfg(feature = "postgres")]
pub(in crate::engine) use lane::Lane;
