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

}
