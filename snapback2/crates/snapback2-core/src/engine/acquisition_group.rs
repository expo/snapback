//! Ordered native receipt packets share durability, never a Runner or rollback scope.
// @ref LLP 1018.008.007.002#10-receipt-groups-and-the-full-application-client —
// one logical commit, packet savepoints, and unchanged per-packet certification.
use super::*;
use crate::acquisition::{AcquisitionReceiptGroup, AcquisitionReceiptOutcome, AcquisitionReceiptPacket};
use crate::certificate::Ceilings;
use std::mem::size_of;
use std::time::{Duration, Instant};

impl Engine {
    pub(crate) fn acquire_receipt_group(&mut self, program: &Program, certificate: &Certificate,
        mut context: Context, content: &str, declaration: &crate::delivery::Deliver,
        packets: &[AcquisitionReceiptPacket], max_work: Duration,
    ) -> Result<AcquisitionReceiptGroup, RuntimeError> {
        let started = Instant::now();
        if packets.len() > 8 || packets.iter().enumerate().any(|(i, packet)|
            packet.id.is_empty() || packet.id.len() > 128 || packet.events.is_empty()
                || packet.events.len() > 50 || packets[..i].iter().any(|p| p.id == packet.id)) {
            return Err(RuntimeError::Input("receipt group requires at most eight distinct packets of one to fifty events".into()));
        }
        context.args = BTreeMap::from([("events".into(), Value::Array(vec![]))]);
        self.acquisition_context(program, certificate, &mut context)?;
        if crate::delivery::acknowledgement(&self.schema, program).is_none() {
            return Err(RuntimeError::TraceSubset("native receipt requires canonical acknowledgement".into()));
        }
        let certificate = self.custody_certificate(certificate, false)?;
        let next = MetadataBound::packet(&self.schema, &certificate);
        // The caller's packet strings remain alive beside the typed Runner inputs.
        // Price those inputs and their dispatch clone before constructing either.
        let inputs = packets.iter().fold(0u64, |bytes, p| bytes.saturating_add(
            (size_of::<AcquisitionReceiptPacket>() + p.id.capacity()
                + p.events.capacity() * size_of::<String>()) as u64
                + p.events.iter().map(|s| s.capacity() as u64).sum::<u64>()
        )).saturating_mul(3).saturating_add((packets.len() * 50 * size_of::<Value>() * 3) as u64);
        let context_heap = context.new_ids.iter().fold(
            (size_of::<Context>() + context.new_ids.capacity() * size_of::<String>()
                + context.viewer().len() + context.principal_kind.capacity()) as u64,
            |bytes, id| bytes.saturating_add(id.capacity() as u64),
        ).saturating_mul(2);
        // Fixed stack/container headers, the empty argument map and append
        // framing fit in this reserve; variable data is priced separately.
        let fixed = 4096u64.saturating_add(inputs).saturating_add(context_heap).saturating_add(
            (size_of::<CommitRecord>() + program.name.len() + context.viewer().len()
                + packets.len() * (size_of::<AcquisitionReceiptOutcome>() + 256)) as u64,
        );
        let current_seq = self.store.commit_seq()?;
        let mut record = CommitRecord { seq: current_seq.saturating_add(1), at: context.now.unwrap_or_else(unix_millis),
            program: program.name.clone(), principal: context.viewer().into(), kind: "receipt".into(), by: None,
            job: None, job_chunk: None, schedule: None, touched: Vec::new(), scope_touches: Vec::new(),
            writes: BTreeMap::new(), emits: 0 };
        let mut retained = MetadataBound::default();
        let mut outcomes = Vec::with_capacity(packets.len());
        let tx = self.store.conn.transaction()?;
        for packet in packets {
            if !outcomes.is_empty() && started.elapsed() >= max_work { break; }
            let pending = retained.plus(next);
            // Three structural copies cover reserve/reallocation overlap and the
            // incoming trace's containers. Append's three JSON buffers coexist;
            // allow their growth capacity too. Neither is a wire-length heap proxy.
            let heap = fixed.saturating_add(pending.heap.saturating_mul(3));
            let peak = heap.saturating_add(certificate.max_heap_bytes)
                .max(heap.saturating_add(pending.encoded.saturating_mul(2)));
            if peak > Ceilings::default().heap_bytes {
                if outcomes.is_empty() { return Err(group_bound()); }
                break;
            }
            record.touched.reserve_exact(next.touched);
            record.scope_touches.reserve_exact(next.scopes);
            let mut input = context.clone();
            input.args.insert("events".into(), Value::Array(packet.events.iter().cloned().map(Value::Id).collect()));
            tx.execute_batch("SAVEPOINT native_receipt_packet")?;
            let result = (|| {
                validate_inputs(&self.schema, program, &input.args)?;
                let mut runner = Runner::new(&tx, &self.schema, &self.hashes, &certificate, input,
                    &self.verdicts, &self.authority_absences, self.rule_authority, record.seq);
                runner.native_receipts(program, content, declaration)?;
                Ok::<_, RuntimeError>(runner.trace)
            })();
            let code = match result {
                Ok(trace) => {
                    tx.execute_batch("RELEASE native_receipt_packet")?;
                    if !trace.writes.is_empty() {
                        record.touched.extend(trace.touched);
                        record.scope_touches.extend(trace.scope_touches);
                        for (table, count) in trace.writes { *record.writes.entry(table).or_default() += count; }
                        record.emits += trace.emits.len() as u64;
                    }
                    // The next packet reserves its full maximum, but preceding
                    // packets retain only their actual moved keys and containers.
                    retained = MetadataBound::record(&record)?;
                    None
                }
                Err(error) => {
                    tx.execute_batch("ROLLBACK TO native_receipt_packet; RELEASE native_receipt_packet")?;
                    retained = MetadataBound::record(&record)?;
                    Some(error.code().to_owned())
                }
            };
            outcomes.push(AcquisitionReceiptOutcome { id: packet.id.clone(), code });
        }
        let commit = if record.writes.is_empty() { None } else {
            append_commit(&tx, &record)?;
            Some(record)
        };
        tx.commit()?;
        let seq = commit.as_ref().map_or(current_seq, |record| record.seq);
        Ok(AcquisitionReceiptGroup { outcomes, seq, commit })
    }
}

fn group_bound() -> RuntimeError {
    RuntimeError::Refusal(Box::new(crate::CheckError { code: "E_BOUND".into(), site: None,
        message: "receipt group metadata and active certified packet exceed the heap ceiling".into(),
        rewrite: "reduce packet/input capacity or the acknowledgement's indexed write footprint".into() }))
}

#[derive(Clone, Copy, Default)]
struct MetadataBound { heap: u64, encoded: u64, touched: usize, scopes: usize }

impl MetadataBound {
    fn record(record: &CommitRecord) -> Result<Self, RuntimeError> {
        let key_heap = |key: &[Value]| key.iter().map(Value::heap_bytes).sum::<u64>();
        let heap = (record.touched.capacity() * size_of::<TouchedKey>()
            + record.scope_touches.capacity() * size_of::<crate::store::ScopeTouch>()) as u64
            + record.touched.iter().map(|key| (key.table.capacity() + key.index.capacity()
                + key.row_id.capacity() + key.key.capacity() * size_of::<Value>()) as u64 + key_heap(&key.key)).sum::<u64>()
            + record.scope_touches.iter().map(|key| (key.table.capacity() + key.index.capacity()
                + key.prefix.capacity() * size_of::<Value>()) as u64 + key_heap(&key.prefix)).sum::<u64>()
            + record.writes.keys().map(|table| 256 + table.capacity() as u64).sum::<u64>();
        // Count the three eventual append buffers without constructing any of
        // them while the packet trace is alive. Tuple framing over-reserves four
        // bytes relative to the three separately serialized append parameters.
        struct Bytes(u64);
        impl std::io::Write for Bytes {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.0 = self.0.saturating_add(bytes.len() as u64);
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
        }
        let mut bytes = Bytes(0);
        serde_json::to_writer(&mut bytes, &(&record.touched, &record.scope_touches, &record.writes))
            .map_err(|error| RuntimeError::Serialization(error.to_string()))?;
        Ok(Self { heap, encoded: bytes.0, touched: record.touched.len(), scopes: record.scope_touches.len() })
    }

    fn plus(self, rhs: Self) -> Self {
        Self { heap: self.heap.saturating_add(rhs.heap), encoded: self.encoded.saturating_add(rhs.encoded),
            touched: self.touched.saturating_add(rhs.touched), scopes: self.scopes.saturating_add(rhs.scopes) }
    }

    fn packet(schema: &Schema, certificate: &Certificate) -> Self {
        let mut result = Self::default();
        // The containment check derives exactly these direct and maintained
        // counts. System writes have a writes entry but no application key image.
        for (table, count) in certificate.write_sites.iter().map(|w| (w.table.as_str(), w.max_rows))
            .chain(certificate.maintained_writes.iter().map(|(table, count)| (table.as_str(), *count))) {
            result.heap = result.heap.saturating_add(256 + table.len() as u64);
            result.encoded = result.encoded.saturating_add(32 + 6 * table.len() as u64);
            let Some(definition) = schema.table(table) else { continue; };
            let count = count.saturating_mul(2); // before and after each physical change
            let identity = crate::bounds::declared_identity_max(schema, table);
            let indexes = definition.indexes.iter().map(|(name, index)| (name.as_str(), Some(index)))
                .chain(definition.indexes.is_empty().then_some(("", None)));
            for (name, index) in indexes {
                let scope = index.and_then(Index::derived_offset);
                let columns = index.map_or(&[][..], |index| &index.components[..scope.unwrap_or(index.components.len())]);
                let mut heap = (size_of::<TouchedKey>() + table.len() + name.len()
                    + columns.len() * size_of::<Value>() * 2) as u64;
                let mut encoded = 128u64.saturating_add(6 * (table.len() + name.len()) as u64);
                if scope.is_none() { heap = heap.saturating_add(identity); encoded = encoded.saturating_add(identity.saturating_mul(6)); }
                for column in columns.iter().filter_map(IndexComponent::column) {
                    let width = crate::bounds::declared_column_value_max(schema, table, column).unwrap_or(u64::MAX);
                    // JSON index keys can contain nested maps/arrays. Their node,
                    // key and vector allocation is bounded separately from text.
                    let mut kind = &definition.columns[column];
                    while let ColumnType::Optional(inner) = kind { kind = inner; }
                    heap = heap.saturating_add(width.saturating_mul(if matches!(kind, ColumnType::Json { .. }) { 16 } else { 2 }));
                    encoded = encoded.saturating_add(width.saturating_mul(6).saturating_add(2));
                }
                result.heap = result.heap.saturating_add(count.saturating_mul(heap));
                result.encoded = result.encoded.saturating_add(count.saturating_mul(encoded));
                if scope.is_some() { result.scopes = result.scopes.saturating_add(count as usize); }
                else { result.touched = result.touched.saturating_add(count as usize); }
            }
        }
        result
    }
}
