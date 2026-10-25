//! Bounded facts, private parallel interpretation and revision-ordered merge.
use super::{
    closure::Closure,
    overlay::{Access, Base, Image, Overlay, RowKey},
    reads::ReadSet,
};
use crate::{
    RuntimeError, Value,
    engine::{
        mutation::{Execution, ProgramHost, execute_body},
        program::Invocation,
    },
    store_port::{
        AnyTx,
        batch::{Facts, Request},
    },
};
use std::collections::BTreeMap;

pub(in crate::engine) struct Prepared {
    pub execution: Execution,
    pub writes: BTreeMap<RowKey, Image>,
    pub reads: ReadSet,
    pub changes: crate::revocation::Recorder,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn take_rejects_uncovered_spans_and_unsupported_read_kinds() {
        let mut kinds = vec![ReadSet::default(); 4];
        kinds[0]
            .spans
            .insert(("t".into(), "ix".into(), vec![], vec![255]));
        kinds[1].authority.insert("credential".into());
        kinds[2].receipts.insert(("alice".into(), "op".into()));
        kinds[3].unsupported = true;
        let mut rejected = 0;
        for reads in kinds {
            let p = Prepared {
                reads,
                writes: Default::default(),
                changes: Default::default(),
                execution: Execution {
                    ran: Ok(Value::Null),
                    metered: Default::default(),
                    tables: vec![],
                    events: vec![],
                    action_tables: Default::default(),
                    outbox: vec![],
                    rows_written: 0,
                    read_tables: Default::default(),
                    entropy: 0,
                    minted: vec![],
                },
            };
            let mut wave = Wave {
                base: Default::default(),
                accepted: Default::default(),
                images: Default::default(),
                facts: vec![],
                prepared: vec![Some(p)],
            };
            let (prepared, rerun) = wave.take(0);
            rejected += usize::from(prepared.is_none() && rerun);
        }
        assert_eq!(
            rejected, 4,
            "uncovered spans and unsupported dependencies must rerun after predecessors"
        );
    }
}
pub(in crate::engine) struct Wave {
    pub base: Base,
    pub accepted: BTreeMap<RowKey, Value>,
    pub images: BTreeMap<RowKey, Image>,
    pub facts: Vec<Facts>,
    prepared: Vec<Option<Prepared>>,
}
impl Wave {
    pub fn prepare_chained(
        tx: &AnyTx<'_>, host: &ProgramHost<'_>, batch: &[Invocation], indices: &[usize],
        chain: Option<&super::super::program_pipeline::Chain>,
    ) -> Result<Option<Self>, RuntimeError> {
        let Some(plans) = indices
            .iter()
            .map(|&i| {
                Closure::new(
                    host.schema,
                    host.programs.get(&batch[i].name)?,
                    &batch[i].context,
                    host.generation,
                )
            })
            .collect::<Option<Vec<_>>>()
        else {
            return Ok(None);
        };
        let requests = indices
            .iter()
            .map(|&i| Request {
                digest: batch[i].authority.as_ref().map(|a| a.digest.clone()),
                principal: batch[i].context.viewer.clone(),
                id: batch[i].id.clone(),
            })
            .collect::<Vec<_>>();
        if requests.iter().any(|r| {
            r.digest.as_deref().is_some_and(|v| v.contains('\0'))
                || r.principal.contains('\0')
                || r.id.as_deref().is_some_and(|v| v.contains('\0'))
        }) {
            return Ok(None);
        }
        let mut roots = Vec::new();
        for plan in &plans {
            for root in &plan.roots {
                if root
                    .key
                    .iter()
                    .any(|k| k.as_str().is_ok_and(|s| s.contains('\0')))
                {
                    return Ok(None);
                }
                if !roots.contains(root) {
                    roots.push(root.clone());
                }
            }
        }
        // @ref LLP 3000.009.001.000.002#3.3 — bounded fact collection must be admitted before decoding; exceeding this optimization budget takes the serial path.
        const FACT_BYTES: u64 = 32 << 20;
        let declared_bytes = |accesses: &[Access]| {
            accesses.iter().fold(0u64, |bytes, access| {
                bytes.saturating_add(crate::rows::disclosed::decode_reservation(
                    &host.schema.tables[&access.table],
                ))
            })
        };
        let root_bytes = declared_bytes(&roots);
        if root_bytes > FACT_BYTES {
            return Ok(None);
        }
        #[cfg(test)]
        crate::engine::program_batch::fault::check(
            crate::engine::program_batch::fault::Point::BeforeFacts,
            usize::MAX,
        )?;
        let mut base = Base::default();
        #[cfg(test)]
        crate::engine::program_batch::fault::check(
            crate::engine::program_batch::fault::Point::BeforeLevel,
            0,
        )?;
        let mut facts = tx.batch_facts(&requests, &roots, host.schema, &mut base)?;
        if let Some(chain) = chain {
            base.fold(&chain.images);
            for (fact, request) in facts.iter_mut().zip(&requests) {
                if let Some(id) = &request.id {
                    if let Some(receipt) = chain.receipts.get(&(request.principal.clone(), id.clone())) {
                        fact.receipt = Some(((request.principal.clone(), id.clone()), Some(receipt.clone())));
                    }
                }
            }
            tx.chain_head(chain)?;
        }
        #[cfg(test)]
        crate::engine::program_batch::fault::check(
            crate::engine::program_batch::fault::Point::AfterFacts,
            usize::MAX,
        )?;
        if facts.iter().any(|f| {
            f.authority
                .as_ref()
                .is_some_and(|(_, a)| !crate::identity::facts::ordinary(a))
        }) {
            return Ok(None);
        }

        #[cfg(test)]
        crate::engine::program_batch::fault::check(
            crate::engine::program_batch::fault::Point::AfterLevel,
            0,
        )?;
        let mut probes: Vec<Access> = Vec::new();
        for plan in &plans {
            let Some(accesses) = plan.probes(host.schema, &base) else {
                return Ok(None);
            };
            for access in accesses {
                if !base.contains(&access) && !probes.contains(&access) {
                    probes.push(access);
                }
            }
        }
        if root_bytes.saturating_add(declared_bytes(&probes)) > FACT_BYTES {
            return Ok(None);
        }
        #[cfg(test)]
        crate::engine::program_batch::fault::check(
            crate::engine::program_batch::fault::Point::BeforeLevel,
            1,
        )?;
        tx.batch_level(&probes, host.schema, &mut base)?;
        if let Some(chain) = chain { base.fold(&chain.images); }
        #[cfg(test)]
        crate::engine::program_batch::fault::check(
            crate::engine::program_batch::fault::Point::AfterLevel,
            1,
        )?;
        let mut counts = BTreeMap::new();
        for plan in &plans {
            for key in &plan.writes {
                *counts.entry(key).or_insert(0) += 1;
            }
        }
        let empty = BTreeMap::new();
        let mut jobs = Vec::with_capacity(indices.len());
        let mut prepared = (0..indices.len()).map(|_| None).collect::<Vec<_>>();
        for (n, &i) in indices.iter().enumerate() {
            // Hot targets stay ordered; independent targets can still read
            // predecessors and must pass recorded validation at merge.
            if plans[n].writes.iter().any(|k| counts[k] > 1) {
                continue;
            }
            let invocation = &batch[i];
            let program = &host.programs[&invocation.name];
            let mut context = invocation.context.clone();
            crate::engine::validate::validate_inputs(host.schema, program, &mut context.args)?;
            context.now = Some(context.now.unwrap_or_else(crate::now_ms));
            context.generation = host.generation;
            context.entropy = host.entropy;
            context.minter = host.minter.clone();
            jobs.push((n, program, context));
        }
        // The pool sees immutable facts/IR and owned contexts, never the
        // transaction, invocations, authority callbacks or another overlay.
        let first_seq = if jobs.is_empty() { 0 } else { tx.next_seq()? };
        let attempts = super::parallel::map(jobs, |(n, program, context)| {
            let overlay = Overlay::new(&base, &empty);
            let execution = execute_body(host, &overlay, context, program, first_seq + n as u64);
            (
                n,
                Prepared {
                    execution,
                    writes: overlay.writes.into_inner(),
                    reads: overlay.reads.into_inner(),
                    changes: overlay.changes.into_inner(),
                },
            )
        });
        for (n, attempt) in attempts {
            if attempt.reads.unsupported
                || attempt
                    .execution
                    .ran
                    .as_ref()
                    .is_err_and(|error| !error.is_refusal())
            {
                return Ok(None);
            }
            prepared[n] = Some(attempt);
        }
        Ok(Some(Self {
            base,
            accepted: Default::default(),
            images: Default::default(),
            facts,
            prepared,
        }))
    }
    pub fn take(&mut self, n: usize) -> (Option<Prepared>, bool) {
        let prepared = self.prepared[n].take();
        // @ref LLP 3000.009.001.000.002#3.3 — accept only selector-covered unique-index spans and row dependencies; unsupported dependencies re-execute after predecessors.
        if prepared.as_ref().is_some_and(|p| {
            // Exhaustive: adding a read kind requires deciding its validation.
            let ReadSet {
                rows: _,
                spans,
                authority,
                receipts,
                unsupported,
            } = &p.reads;
            *unsupported || spans.iter().any(|(table, index, lo, hi)| !self.base.covers_span(table, index, lo, hi))
                || !authority.is_empty() || !receipts.is_empty()
        }) {
            return (None, true);
        }
        // Index keys and populations are fixed by the selector. Every probe's
        // returned image, even a hidden one, therefore conflicts by row identity.
        let conflict = prepared.as_ref().is_some_and(|p| {
            p.reads
                .rows
                .iter()
                .any(|key| self.accepted.contains_key(key))
        });
        if conflict {
            (None, true)
        } else {
            (prepared, false)
        }
    }
    pub fn accept(&mut self, images: Vec<Image>) {
        for image in images {
            let key = image.key();
            self.accepted.insert(key.clone(), image.new.clone());
            self.images
                .entry(key)
                .and_modify(|old| old.new = image.new.clone())
                .or_insert(image);
        }
    }
}
