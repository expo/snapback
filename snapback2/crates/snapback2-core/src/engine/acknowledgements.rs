use super::*;
use super::runner_ops::RowChangeOrigin;
use crate::delivery;

impl Runner<'_> {
    // @ref LLP 1019#6-receipts-with-receipts — current recipient membership
    // is a private bounded probe, not a client claim or a read receipt.
    pub(super) fn acknowledge(&mut self, table: &str, old: &Value) -> Result<bool, RuntimeError> {
        if self.rule_authority == RuleAuthority::ReceiptOnly {
            self.missing_authority = true;
            self.authority_miss_serial += 1;
            return Ok(false);
        }
        if old.field("recipient")?.as_str()? != self.context.viewer() {
            return Err(RuntimeError::Rule { table: table.into(), effect: Effect::Update });
        }
        if old.field("received")? == &Value::Bool(true) { return Ok(false); }
        let (_, d, _) = delivery::owner(self.schema, table).expect("canonical acknowledgement");
        let target = &self.schema.tables[&d.target];
        let (index, definition) = crate::cap::enforcement_index(target, &d.prefix).unwrap();
        let log = self.env.get("original").ok_or_else(|| RuntimeError::TraceSubset("receipt has no delivery".into()))?;
        if log == &Value::Null || log.field("id")? != old.field("id")? {
            return Err(RuntimeError::Rule { table: table.into(), effect: Effect::Update });
        }
        let prefix = crate::cap::group_key(log, &d.prefix);
        let limit = u64::from(delivery::group_cap(target, &d.prefix).unwrap()) + 1;
        let certificate = self.certificate.unwrap();
        let check = format!("{}:DeliveryAcknowledgement", d.target);
        if !certificate.indexes_required.contains(&format!("{}.{index}", d.target))
            || !certificate.constraint_checks.contains(&check)
            || certificate.max_examined < limit || certificate.max_index_entries < limit {
            return Err(RuntimeError::TraceSubset("missing delivery acknowledgement reserve".into()));
        }
        let rows = scan_indexed(self.tx, &d.target, index, target, definition, &prefix,
            None, None, None, Order::Asc, limit as usize)?;
        self.trace.examined += rows.len() as u64;
        self.trace.constraint_inputs.push(ConstraintTrace { table: d.target.clone(), check: "DeliveryAcknowledgement".into(),
            index: index.clone(), prefix, examined_ids: row_ids(&rows)? });
        self.step(limit * 5)?;
        let mut member = false;
        for row in &rows {
            let Value::Id(principal) = row.field(&d.principal)? else {
                return Err(RuntimeError::Rule { table: d.target.clone(), effect: Effect::Read });
            };
            member |= principal == self.context.viewer();
        }
        if !member { return Err(RuntimeError::Rule { table: table.into(), effect: Effect::Update }); }
        Ok(true)
    }

    // False is initialized with custody; later body changes keep the copied
    // read-rule inputs current. Only acknowledge can change false to true.
    pub(super) fn delivery_receipt(&mut self, d: &delivery::Deliver, content: &Value, event: &Value) -> Result<(), RuntimeError> {
        let Some(table) = d.receipts_table() else { return Ok(()); };
        let id = event.field("id")?.as_str()?;
        let certificate = self.certificate.unwrap();
        let reserved = self.delivery_write_reserves.entry(table.clone()).or_default();
        *reserved += 1;
        if *reserved > certificate.write_sites.iter().filter(|w| w.table == table).map(|w| w.max_rows).sum::<u64>()
            || !certificate.constraint_checks.contains(&format!("{table}:DeliveryReceipt"))
            || !certificate.indexes_required.contains(&format!("{table}.byId")) {
            return Err(RuntimeError::TraceSubset("missing delivery receipt reserve".into()));
        }
        let old = self.fetch_id(&table, id)?;
        self.trace.examined += u64::from(old.is_some());
        self.trace.constraint_inputs.push(ConstraintTrace { table: table.clone(), check: "DeliveryReceipt".into(),
            index: "byId".into(), prefix: vec![Value::Id(id.into())], examined_ids: if old.is_some() { vec![id.into()] } else { vec![] } });
        self.step(5)?;
        let received = old.as_ref().is_some_and(|r| r.field("received").ok() == Some(&Value::Bool(true)));
        let seq = old.as_ref().and_then(|r| r.field("seq").ok()).and_then(|v| v.as_int().ok()).unwrap_or(self.seq as i64);
        let row = delivery::receipt_row(self.schema, content, event, &table, received, seq)?;
        if old.as_ref() == Some(&row) { return Ok(()); }
        validate_row(self.schema, &table, &row)?;
        self.tx.execute("INSERT INTO rows(table_name,row_id,data) VALUES (?1,?2,?3) ON CONFLICT(table_name,row_id) DO UPDATE SET data=excluded.data",
            params![table, id, canonical_json(&row)])?;
        let work = reindex_row(self.tx, self.schema, &table, &row)?;
        self.finish_row_change(&table, old.as_ref(), Some(&row), work, RowChangeOrigin::Source)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Ceilings, Checker};
    use crate::acquisition::AcquisitionReceiptPacket;
    use std::time::Duration;

    fn fixture() -> (Engine, Schema, delivery::Deliver) {
        let f: serde_json::Value = serde_json::from_str(include_str!("../../../../corpus/deliver-ack-missing-authority.json")).unwrap();
        let schema: Schema = serde_json::from_value(f["schema"].clone()).unwrap();
        let d = schema.tables["messages"].deliver.clone().unwrap();
        let mut engine = Engine::memory(schema.clone()).unwrap();
        engine.seed("memberships", crate::object([("id", Value::Id("member".into())),
            ("conversationId", Value::Id("c1".into())), ("principal", Value::Id("u1".into()))])).unwrap();
        for table in ["messages"] {
            for row in f["receipt"]["rows"].as_array().unwrap().iter().filter(|r| r["table"] == table) {
                engine.seed(table, serde_json::from_value(row["row"].clone()).unwrap()).unwrap();
            }
        }
        (engine, schema, d)
    }

    #[test]
    fn receipt_reserve_is_checked_before_the_private_read() {
        let (mut engine, schema, d) = fixture();
        let content = engine.rows("messages").unwrap().remove(0);
        let event = engine.rows("deliveries").unwrap().remove(0);
        let program = Program { name: "edit".into(), kind: ProgramKind::Mutation, args: BTreeMap::new(), read_time_granularity_ms: None,
            body: vec![Stmt::Update { table: "messages".into(), key: Expr::Literal(content.field("id").unwrap().clone()), patch: Expr::Literal(Value::Row(BTreeMap::new().into())) }] };
        let mut certificate = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
        certificate.write_sites.retain(|w| w.table != "deliveriesReceipts");
        // A read would fail JSON decoding; only the pre-read reserve refusal may fire.
        engine.store.conn.execute("UPDATE rows SET data='not JSON' WHERE table_name='deliveriesReceipts'", []).unwrap();
        let tx = engine.store.conn.transaction().unwrap();
        let hashes = hashes::PolicyHashes::new(&schema);
        let mut runner = Runner::new(&tx, &schema, &hashes, &certificate,
            Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new()), &[], &[], RuleAuthority::StoreAuthoritative, 9);
        let error = runner.delivery_receipt(&d, &content, &event).unwrap_err();
        assert!(matches!(error, RuntimeError::TraceSubset(_)), "{error:?}");
        assert_eq!(runner.trace.examined, 0);
        assert!(runner.trace.constraint_inputs.is_empty());
    }

    // @ref LLP 1001#native-owner-image-pipeline — a reused read still records
    // its exact current fingerprint; only the client export is omitted.
    #[test]
    fn native_acknowledgement_hands_off_the_exact_durable_commit_and_current_images() {
        let (mut engine, schema, d) = fixture();
        let receipt = engine.rows("deliveriesReceipts").unwrap().remove(0);
        let id = receipt.field("id").unwrap().clone();
        let program = delivery::ack_program("messages", &d);
        let certificate = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
        let context = |events| {
            let mut context = Context::mutation(Actor::user("u1").unwrap(), BTreeMap::from([
                ("events".into(), Value::Array(events)),
            ]));
            context.now = Some(10);
            context
        };
        let outcome = engine.acquire_receipts(&program, &certificate, context(vec![id.clone(), id.clone()]), "messages", &d).unwrap();
        let execution = outcome.execution;
        let commit = outcome.commit.expect("changed packet has a commit");
        let stored = engine.store.commits_since(commit.seq - 1, 1).unwrap().remove(0);
        assert_eq!(canonical_json(&commit), canonical_json(&stored));
        assert_eq!(execution.seq, commit.seq);
        assert_eq!(execution.trace.writes["deliveriesReceipts"], 1);
        assert_eq!(execution.trace.points.len(), 8);
        let points = execution.trace.points.iter().filter(|point| point.table == "deliveriesReceipts").collect::<Vec<_>>();
        assert_eq!(points.len(), 2);
        assert_ne!(points[0].digest, points[1].digest, "the update left a stale reusable receipt image");
        assert_eq!(points[0].digest.as_deref(), Some(crate::offline::row_digest(&receipt).as_str()));
        let first = execution.trace.rows.iter().find(|row| row.table == "deliveriesReceipts").unwrap();
        assert_eq!(first.row, receipt);
        assert!(execution.receipt.rows.is_empty() && execution.receipt.absences.is_empty()
            && execution.receipt.verdicts.is_empty() && execution.receipt.ranges.is_empty());
        assert!(execution.trace.constraint_inputs.iter().any(|input| input.check == "DeliveryAcknowledgement"));
        let retry = engine.acquire_receipts(&program, &certificate, context(vec![id]), "messages", &d).unwrap();
        assert!(retry.commit.is_none());
        assert_eq!(retry.execution.seq, commit.seq);
        assert!(retry.execution.trace.writes.is_empty());
        assert_eq!(engine.rows("deliveriesReceipts").unwrap()[0].field("seq").unwrap(), &Value::Int(commit.seq as i64));
    }

    fn failed_acknowledgement(failure: &str) {
        let (mut engine, schema, d) = fixture();
        let receipt = engine.rows("deliveriesReceipts").unwrap().remove(0);
        let edit = Program { name: "edit".into(), kind: ProgramKind::Mutation, args: BTreeMap::new(), read_time_granularity_ms: None,
            body: vec![Stmt::Update { table: "messages".into(), key: Expr::Literal(Value::Id("m".into())),
                patch: Expr::Literal(crate::object([("body", Value::String("changed".into()))])) }] };
        let certificate = Checker::new(&schema, Ceilings::default()).check(&edit).unwrap();
        engine.execute(&edit, &certificate, Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new())).unwrap();
        let event = engine.rows("deliveries").unwrap().into_iter().find(|r| r.field("kind").unwrap() == &Value::String("changed".into())).unwrap();
        if failure == "original" {
            let id = receipt.field("id").unwrap().as_str().unwrap();
            engine.store.conn.execute("DELETE FROM rows WHERE table_name='deliveries' AND row_id=?1", [id]).unwrap();
        } else if failure == "membership" {
            engine.store.conn.execute("DELETE FROM rows WHERE table_name='memberships'", []).unwrap();
        } else {
            let bad = crate::object([("id", Value::Id("member".into())), ("conversationId", Value::Id("c1".into()))]);
            engine.store.conn.execute("UPDATE rows SET data=?1 WHERE table_name='memberships'", [canonical_json(&bad)]).unwrap();
        }
        let program = delivery::ack_program("messages", &d);
        let certificate = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
        let replay = crate::offline::ReplayCommit { grant: "grant".into(), offset: 0, count: 51, intent: "grant:0".into(),
            request_digest: "d".repeat(64), trace: Default::default(), at: 1 };
        let before = engine.store.commit_seq().unwrap();
        let native = engine.acquire_receipts(&program, &certificate,
            Context::mutation(Actor::user("u1").unwrap(), BTreeMap::from([("events".into(),
                Value::Array(vec![event.field("id").unwrap().clone()]))])), "messages", &d).unwrap_err();
        assert_eq!(native.code(), if failure == "malformed" { "E_FIELD" } else { "E_RULE" });
        assert_eq!(engine.store.commit_seq().unwrap(), before);
        assert_eq!(engine.rows("deliveriesReceipts").unwrap()[0].field("received").unwrap(), &Value::Bool(false));
        let result = engine.execute_replay(&program, &certificate, Context::mutation(Actor::user("u1").unwrap(),
            BTreeMap::from([("events".into(), Value::Array(vec![event.field("id").unwrap().clone()]))])), &replay).unwrap();
        assert!(matches!(&result.state, ExecutionState::Rejected { code, .. } if code == if failure == "malformed" { "E_FIELD" } else { "E_RULE" }), "{result:?}");
        if failure == "original" { assert!(result.trace.points.iter().any(|p| p.table == "deliveries" && p.digest.is_none())); }
        else { assert!(result.trace.constraint_inputs.iter().any(|p| p.check == "DeliveryAcknowledgement")); }
        assert_eq!(engine.rows("deliveriesReceipts").unwrap()[0].field("received").unwrap(), &Value::Bool(false));
    }

    #[test]
    fn acknowledgement_missing_original_is_a_traced_rejection() { failed_acknowledgement("original"); }
    #[test]
    fn acknowledgement_failed_membership_probe_is_a_traced_rejection() { failed_acknowledgement("malformed"); }
    #[test]
    fn acknowledgement_departed_member_is_a_traced_rejection() { failed_acknowledgement("membership"); }

    #[test]
    fn acknowledgement_foreign_receipt_refuses_but_already_received_is_idempotent() {
        let (mut engine, schema, d) = fixture();
        let receipt = engine.rows("deliveriesReceipts").unwrap().remove(0);
        let program = delivery::ack_program("messages", &d);
        let certificate = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
        let tx = engine.store.conn.transaction().unwrap();
        let hashes = hashes::PolicyHashes::new(&schema);
        let mut runner = Runner::new(&tx, &schema, &hashes, &certificate,
            Context::mutation(Actor::user("other").unwrap(), BTreeMap::new()), &[], &[], RuleAuthority::StoreAuthoritative, 9);
        assert!(matches!(runner.acknowledge("deliveriesReceipts", &receipt), Err(RuntimeError::Rule { .. })));
        let mut received = receipt.as_object().unwrap().clone();
        received.insert("received".into(), Value::Bool(true));
        assert!(matches!(runner.acknowledge("deliveriesReceipts", &Value::Row(received.clone().into())), Err(RuntimeError::Rule { .. })));
        received.insert("recipient".into(), Value::Id("other".into()));
        assert!(!runner.acknowledge("deliveriesReceipts", &Value::Row(received.into())).unwrap());
        assert_eq!(runner.trace.examined, 0);
    }

    fn receipt_packets(ids: &[(&str, Vec<String>)]) -> Vec<AcquisitionReceiptPacket> {
        ids.iter().map(|(id, events)| AcquisitionReceiptPacket { id: (*id).into(), events: events.clone() }).collect()
    }

    fn group_context() -> Context {
        let mut context = Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new());
        context.now = Some(10);
        context
    }

    fn group_fixture(maintained: bool) -> (Engine, Schema, delivery::Deliver, BTreeMap<String, String>) {
        let (source, mut schema, d) = fixture();
        if maintained {
            let index = |columns: &[&str]| Index { components: columns.iter()
                .map(|name| IndexComponent::Column((*name).into())).collect(), unique: true };
            schema.tables.insert("receiptTotals".into(), public_table(BTreeMap::from([
                ("id".into(), ColumnType::Id), ("recipient".into(), ColumnType::Principal), ("value".into(), ColumnType::Int),
            ]), BTreeMap::from([("byId".into(), index(&["id"])), ("byValue".into(), index(&["value", "id"]))])));
            schema.maintains.push(Maintain { kind: MaintainKind::Sum { of: "seq".into() },
                source: "deliveriesReceipts".into(), by: vec!["recipient".into()], target: "receiptTotals".into(),
                readable: Some(RuleExpr::Allow) });
        }
        let mut engine = Engine::memory(schema.clone()).unwrap();
        engine.seed("memberships", source.rows("memberships").unwrap().remove(0)).unwrap();
        let mut body = source.rows("messages").unwrap().remove(0).as_object().unwrap().clone();
        for id in ["m", "m2", "m3", "dead"] {
            body.insert("id".into(), Value::Id(id.into()));
            engine.seed("messages", Value::Row(body.clone().into())).unwrap();
        }
        let ids = engine.rows("deliveriesReceipts").unwrap().iter().map(|row|
            (row.field("row").unwrap().as_str().unwrap().into(), row.field("id").unwrap().as_str().unwrap().into())).collect();
        (engine, schema, d, ids)
    }

    // @ref LLP 1018.008.007.002#10-receipt-groups-and-the-full-application-client —
    // rollback is per packet, including maintenance; publication is one exact record.
    #[test]
    fn native_receipt_group_orders_success_refusal_success_and_preserves_first_sequences() {
        for maintained in [false, true] {
            let (mut engine, schema, d, ids) = group_fixture(maintained);
            let delete = Program { name: "delete".into(), kind: ProgramKind::Mutation, args: BTreeMap::new(),
                read_time_granularity_ms: None, body: vec![Stmt::Delete { table: "messages".into(), key: Expr::Literal(Value::Id("dead".into())) }] };
            let cert = Checker::new(&schema, Ceilings::default()).check(&delete).unwrap();
            engine.execute(&delete, &cert, group_context()).unwrap();
            let removed = engine.rows("deliveries").unwrap().into_iter()
                .find(|row| row.field("kind").unwrap() == &Value::String("removed".into())).unwrap();
            let packets = receipt_packets(&[
                ("one", vec![ids["m"].clone(), ids["m"].clone()]),
                ("refused", vec![ids["m2"].clone(), ids["dead"].clone()]),
                ("three", vec![ids["m3"].clone()]),
                ("duplicate", vec![ids["m"].clone(), removed.field("id").unwrap().as_str().unwrap().into(), "absent".into()]),
            ]);
            let program = delivery::ack_program("messages", &d);
            let cert = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
            if maintained { assert!(cert.maintained_writes["receiptTotals"] > 0); }
            let before = engine.store.commit_seq().unwrap();
            let before_m2 = engine.rows("deliveriesReceipts").unwrap().into_iter()
                .find(|r| r.field("row").unwrap() == &Value::Id("m2".into())).unwrap();
            let group = engine.acquire_receipt_group(&program, &cert, group_context(), "messages", &d, &packets, Duration::MAX).unwrap();
            assert_eq!(group.outcomes.iter().map(|o| (o.id.as_str(), o.code.as_deref())).collect::<Vec<_>>(),
                vec![("one", None), ("refused", Some("E_RULE")), ("three", None), ("duplicate", None)]);
            assert_eq!(group.seq, before + 1);
            let commit = group.commit.unwrap();
            assert_eq!(commit.writes["deliveriesReceipts"], 2);
            assert_eq!(engine.store.commits_since(before, 10).unwrap(), vec![commit.clone()]);
            assert!(commit.touched.iter().filter(|key| key.table == "deliveriesReceipts").all(|key| key.row_id != ids["m2"]));
            let rows = engine.rows("deliveriesReceipts").unwrap();
            for body in ["m", "m3"] {
                let row = rows.iter().find(|r| r.field("row").unwrap() == &Value::Id(body.into())).unwrap();
                assert_eq!(row.field("received").unwrap(), &Value::Bool(true));
                assert_eq!(row.field("seq").unwrap(), &Value::Int(group.seq as i64));
            }
            assert!(rows.contains(&before_m2), "refused packet leaked a receipt/sequence mutation");
            if maintained {
                assert!(commit.writes["receiptTotals"] > 0);
                let sum = rows.iter().map(|r| r.field("seq").unwrap().as_int().unwrap()).sum::<i64>();
                assert_eq!(engine.rows("receiptTotals").unwrap()[0].field("value").unwrap(), &Value::Int(sum));
            }
            let retry = engine.acquire_receipt_group(&program, &cert, group_context(), "messages", &d, &packets, Duration::MAX).unwrap();
            assert_eq!(retry.seq, group.seq);
            assert!(retry.commit.is_none());
            assert_eq!(engine.rows("deliveriesReceipts").unwrap(), rows);
        }
    }

    #[test]
    fn native_receipt_group_yields_an_unattempted_suffix_and_resumes_with_fresh_authority() {
        let (mut engine, schema, d, ids) = group_fixture(false);
        let program = delivery::ack_program("messages", &d);
        let cert = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
        let packets = receipt_packets(&[("one", vec![ids["m"].clone()]), ("two", vec![ids["m2"].clone()])]);
        let first = engine.acquire_receipt_group(&program, &cert, group_context(), "messages", &d, &packets, Duration::ZERO).unwrap();
        assert_eq!(first.outcomes.len(), 1);
        assert_eq!(first.outcomes[0].id, "one");
        assert_eq!(first.commit.unwrap().writes["deliveriesReceipts"], 1);
        engine.store.conn.execute("DELETE FROM rows WHERE table_name='memberships'", []).unwrap();
        let departed = engine.acquire_receipt_group(&program, &cert, group_context(), "messages", &d, &packets[1..], Duration::MAX).unwrap();
        assert_eq!(departed.outcomes[0].code.as_deref(), Some("E_RULE"));
        assert_eq!(departed.seq, first.seq);
        assert!(departed.commit.is_none());
        engine.seed("memberships", object([("id", Value::Id("rejoined".into())),
            ("conversationId", Value::Id("c1".into())), ("principal", Value::Id("u1".into()))])).unwrap();
        let retry = engine.acquire_receipt_group(&program, &cert, group_context(), "messages", &d, &packets, Duration::MAX).unwrap();
        assert_eq!(retry.outcomes.len(), 2);
        assert!(retry.outcomes.iter().all(|o| o.code.is_none()));
        let rows = engine.rows("deliveriesReceipts").unwrap();
        assert_eq!(rows.iter().find(|r| r.field("row").unwrap() == &Value::Id("m".into())).unwrap().field("seq").unwrap(), &Value::Int(first.seq as i64));
        assert_eq!(rows.iter().find(|r| r.field("row").unwrap() == &Value::Id("m2".into())).unwrap().field("seq").unwrap(), &Value::Int(retry.seq as i64));
    }

    #[test]
    fn native_receipt_group_refuses_shape_and_retained_capacity_before_writing() {
        let (mut engine, schema, d, ids) = group_fixture(false);
        let program = delivery::ack_program("messages", &d);
        let cert = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
        let before = engine.store.commit_seq().unwrap();
        let mut id = String::with_capacity(Ceilings::default().heap_bytes as usize);
        id.push_str("one");
        let packet = AcquisitionReceiptPacket { id, events: vec![ids["m"].clone()] };
        let error = engine.acquire_receipt_group(&program, &cert, group_context(), "messages", &d, &[packet], Duration::MAX).unwrap_err();
        assert_eq!(error.code(), "E_BOUND", "short JSON is not a heap-capacity bound");
        for packets in [receipt_packets(&[("same", vec![ids["m"].clone()]), ("same", vec![ids["m2"].clone()])]),
            receipt_packets(&[("too-many-events", vec![ids["m"].clone(); 51])]),
            (0..9).map(|i| AcquisitionReceiptPacket { id: i.to_string(), events: vec![ids["m"].clone()] }).collect()] {
            assert_eq!(engine.acquire_receipt_group(&program, &cert, group_context(), "messages", &d, &packets, Duration::MAX).unwrap_err().code(), "E_INPUT");
        }
        assert_eq!(engine.store.commit_seq().unwrap(), before);
        assert!(engine.rows("deliveriesReceipts").unwrap().iter().all(|r| r.field("received").unwrap() == &Value::Bool(false)));
    }

    #[test]
    fn native_receipt_group_retains_a_resource_limited_suffix_for_a_later_request() {
        let (mut engine, schema, d, ids) = group_fixture(false);
        let program = delivery::ack_program("messages", &d);
        let cert = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
        let mut body = engine.rows("messages").unwrap().remove(0).as_object().unwrap().clone();
        let mut first_events = Vec::new();
        for i in 0..50 {
            let id = format!("bulk{i}");
            body.insert("id".into(), Value::Id(id.clone()));
            engine.seed("messages", Value::Row(body.clone().into())).unwrap();
            first_events.push(engine.rows("deliveriesReceipts").unwrap().into_iter()
                .find(|row| row.field("row").unwrap() == &Value::Id(id.clone())).unwrap()
                .field("id").unwrap().as_str().unwrap().to_owned());
        }
        let mut padded = String::with_capacity(2_250_000);
        padded.push_str("one");
        let packets = vec![AcquisitionReceiptPacket { id: padded, events: first_events },
            AcquisitionReceiptPacket { id: "two".into(), events: vec![ids["m2"].clone()] }];
        let first = engine.acquire_receipt_group(&program, &cert, group_context(), "messages", &d, &packets, Duration::MAX).unwrap();
        assert_eq!(first.outcomes.len(), 1);
        assert_eq!(first.outcomes[0].id, "one");
        assert_eq!(first.commit.unwrap().writes["deliveriesReceipts"], 50);
        let resumed = engine.acquire_receipt_group(&program, &cert, group_context(), "messages", &d, &packets[1..], Duration::MAX).unwrap();
        assert_eq!(resumed.outcomes[0].id, "two");
        assert!(resumed.outcomes[0].code.is_none());
        assert_eq!(resumed.seq, first.seq + 1);
    }

    #[test]
    fn native_receipt_group_publishes_nothing_when_the_combined_commit_fails() {
        let (mut engine, schema, d, ids) = group_fixture(true);
        let program = delivery::ack_program("messages", &d);
        let cert = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
        let packets = receipt_packets(&[("one", vec![ids["m"].clone()]), ("two", vec![ids["m2"].clone()])]);
        let before = engine.store.commit_seq().unwrap();
        let rows = engine.rows("deliveriesReceipts").unwrap();
        let totals = engine.rows("receiptTotals").unwrap();
        engine.store.conn.execute_batch("CREATE TRIGGER refuse_group BEFORE INSERT ON _commits WHEN NEW.kind='receipt' BEGIN SELECT RAISE(ABORT,'test commit failure'); END").unwrap();
        assert_eq!(engine.acquire_receipt_group(&program, &cert, group_context(), "messages", &d, &packets, Duration::MAX).unwrap_err().code(), "E_CONSTRAINT");
        assert_eq!(engine.store.commit_seq().unwrap(), before);
        assert_eq!(engine.rows("deliveriesReceipts").unwrap(), rows);
        assert_eq!(engine.rows("receiptTotals").unwrap(), totals);
        engine.store.conn.execute_batch("DROP TRIGGER refuse_group").unwrap();
        let retry = engine.acquire_receipt_group(&program, &cert, group_context(), "messages", &d, &packets, Duration::MAX).unwrap();
        assert_eq!(retry.seq, before + 1);
        assert_eq!(retry.commit.unwrap().writes["deliveriesReceipts"], 2);
    }

}
