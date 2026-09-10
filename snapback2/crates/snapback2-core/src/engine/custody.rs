//! Native delivery writes share the source transaction and lifecycle.
use super::runner_ops::RowChangeOrigin;
use super::*;
use crate::certificate::{Ceilings, Checker};
use crate::delivery::{self, Deliver};

fn seed_ceilings() -> Ceilings {
    // @ref LLP 1017#24-metering — seeds waive work ceilings, never heap.
    Ceilings {
        examined: u64::MAX,
        index_entries: u64::MAX,
        steps: u64::MAX,
        write_rows: u64::MAX,
        ..Ceilings::default()
    }
}

impl Engine {
    // @ref LLP 1019#3-what-writes-it — fixture seeds cannot bypass custody or
    // overfill the target cap on which bootstrap's installation estimate rests.
    pub(super) fn seed_custody(&mut self, table: &str, row: Value) -> Result<(), RuntimeError> {
        crate::assets::refuse_seed_assets(&self.schema, table, &row)?;
        let program = Program {
            name: "seed".into(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body: vec![Stmt::Upsert {
                table: table.into(),
                key: Expr::Literal(row.field("id")?.clone()),
                row: Expr::Literal(row),
            }],
        };
        let certificate = Checker::new(&self.schema, seed_ceilings())
            .check(&program)
            .map_err(|e| RuntimeError::Refusal(Box::new(e)))?;
        let execution = self.execute_seed(&program, &certificate, 0)?;
        match execution.state {
            ExecutionState::Committed { .. } => Ok(()),
            ExecutionState::Rejected { code, site, message, rewrite, .. } => {
                Err(RuntimeError::Refusal(Box::new(crate::CheckError {
                    code, site, message, rewrite: rewrite.unwrap_or_else(|| "fix the seed row".into()),
                })))
            }
            state => Err(RuntimeError::Input(format!(
                "seed did not commit: {state:?}"
            ))),
        }
    }
}

impl Runner<'_> {
    // @ref LLP 1019#3-what-writes-it — byRow seeks only delivered events, so
    // edits never consume an unbounded history; that log supplies incarnation.
    pub(super) fn deliver_row_change(
        &mut self,
        table: &str,
        old: Option<&Value>,
        new: Option<&Value>,
    ) -> Result<(), RuntimeError> {
        if self.rule_authority != RuleAuthority::StoreAuthoritative {
            return Ok(());
        }
        let Some(deliver) = self.schema.table(table).and_then(|t| t.deliver.clone()) else {
            return Ok(());
        };
        // Compare the same images fetch_id exposes: omitted optionals are null.
        let normalize = |image: &Value| {
            let mut image = image.clone();
            super::index::materialize_optional_fields(&mut image, &self.schema.tables[table]);
            image
        };
        let old = old.map(normalize);
        let new = new.map(normalize);
        if old == new { return Ok(()); }
        let content = new.as_ref().or(old.as_ref()).expect("row change");
        let id = content.field("id")?.as_str()?;
        // Rows with an empty audience have no event to remember their identity.
        // Keep only retired identities here; live incarnation is always the log's.
        let retired = format!("custody_retired:{}", digest(&(table, id)));
        self.step(4)?;
        let cap = delivery::group_cap(&self.schema.tables[&deliver.target], &deliver.prefix)
            .expect("validated deliver");
        let (target, index, prefix, limit, kind) = if old.is_none() {
            let target = &self.schema.tables[&deliver.target];
            let (index, _) =
                crate::cap::enforcement_index(target, &deliver.prefix).expect("validated index");
            (
                deliver.target.as_str(),
                index.as_str(),
                crate::cap::group_key(content, &deliver.prefix),
                u64::from(cap) + 1,
                "delivered",
            )
        } else {
            let key = format!("{}{}", delivery::AUDIENCE_META_PREFIX, deliver.log);
            let stored: Option<String> = self
                .tx
                .query_row("SELECT value FROM _meta WHERE key=?1", [&key], |r| r.get(0))
                .optional()?;
            let bound = stored
                .ok_or_else(|| RuntimeError::StoreVersion {
                    detail: format!("missing {key}"),
                })?
                .parse::<u32>()
                .map_err(|_| RuntimeError::StoreVersion {
                    detail: format!("unreadable {key}"),
                })?
                .max(cap);
            (
                deliver.log.as_str(),
                "byRow",
                vec![
                    content.field("id")?.clone(),
                    Value::String("delivered".into()),
                ],
                u64::from(bound),
                if new.is_none() { "removed" } else { "changed" },
            )
        };
        self.delivery_reserve = self.delivery_reserve.saturating_add(limit);
        let steps = limit.saturating_mul(20).saturating_add(4);
        self.delivery_step_reserve = self.delivery_step_reserve.saturating_add(steps);
        self.delivery_heap_reserve = self.delivery_heap_reserve.saturating_add(
            limit
                .saturating_mul(delivery::scratch_per_recipient(self.schema, &deliver))
                .saturating_add(steps.saturating_mul(crate::certificate::HEAP_BYTES_PER_STEP)),
        );
        let reserved_writes = self
            .delivery_write_reserves
            .entry(deliver.log.clone())
            .or_default();
        *reserved_writes = reserved_writes.saturating_add(limit);
        let certificate = self.certificate.expect("writes have a certificate");
        let writes: u64 = certificate
            .write_sites
            .iter()
            .filter(|w| w.table == deliver.log && w.kind == crate::WriteKind::Insert)
            .map(|w| w.max_rows)
            .fold(0u64, u64::saturating_add);
        if *reserved_writes > writes
            || !certificate.constraint_checks.contains(&format!("{target}:DeliverAudience({table})"))
            || (old.is_none() && !certificate.constraint_checks.contains(&format!("{}:DeliverIncarnation", deliver.log)))
            || !certificate.indexes_required.contains(&format!("{}.byRow", deliver.log))
            || !certificate
                .indexes_required
                .contains(&format!("{target}.{index}"))
            || self.delivery_step_reserve
                > certificate
                    .max_steps
                    .saturating_sub(certificate.derived_steps)
            || self.delivery_reserve > certificate.max_examined
            || self.delivery_reserve > certificate.max_index_entries
            || self.delivery_heap_reserve > certificate.max_heap_bytes
        {
            return Err(RuntimeError::TraceSubset(format!(
                "{} exceeds its full native reserve",
                deliver.line(None)
            )));
        }
        if old.is_none() {
            let exists: bool = self.tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM _meta WHERE key=?1)",
                [&retired],
                |r| r.get(0),
            )?;
            // A pre-existing custody log is also authority for a retired id,
            // including a bootstrapped log whose body is already absent. This
            // probe either finds one row and refuses, or reads zero rows before
            // the N+1 membership probe: its examined bound is max(1, N+1).
            let log = &self.schema.tables[&deliver.log];
            let prior = if exists {
                Vec::new()
            } else {
                scan_indexed(
                    self.tx,
                    &deliver.log,
                    "byRow",
                    log,
                    log.index("byRow").unwrap(),
                    &[
                        content.field("id")?.clone(),
                        Value::String("delivered".into()),
                    ],
                    None,
                    None,
                    None,
                    Order::Asc,
                    1,
                )?
            };
            self.trace.examined = self.trace.examined.saturating_add(prior.len() as u64);
            if !exists {
                self.trace.constraint_inputs.push(ConstraintTrace {
                    table: deliver.log.clone(), check: "DeliverIncarnation".into(),
                    index: "byRow".into(),
                    prefix: vec![content.field("id")?.clone(), Value::String("delivered".into())],
                    examined_ids: row_ids(&prior)?,
                });
            }
            if exists || !prior.is_empty() {
                return Err(RuntimeError::Refusal(Box::new(crate::CheckError {
                    code: "E_DELIVER_INCARNATION".into(),
                    site: Some(self.statement_site.clone()),
                    message: "a deleted delivered row cannot reuse its id".into(),
                    rewrite: delivery::incarnation_rewrite(self.schema, table),
                })));
            }
        }
        let definition = &self.schema.tables[target];
        let rows = scan_indexed(
            self.tx,
            target,
            index,
            definition,
            definition.index(index).unwrap(),
            &prefix,
            None,
            None,
            None,
            Order::Asc,
            limit as usize,
        )?;
        self.trace.examined = self.trace.examined.saturating_add(rows.len() as u64);
        self.trace.constraint_inputs.push(ConstraintTrace {
            table: target.into(), check: format!("DeliverAudience({table})"),
            index: index.into(), prefix: prefix.clone(), examined_ids: row_ids(&rows)?,
        });
        self.step(rows.len() as u64 * 5)?;
        if kind == "delivered" && rows.len() as u64 > u64::from(cap) {
            return Err(RuntimeError::TraceSubset(format!(
                "{} exceeds cap {cap}",
                deliver.line(None)
            )));
        }
        let mut recipients = BTreeMap::new();
        for row in rows {
            let recipient = row
                .field(if kind == "delivered" {
                    &deliver.principal
                } else {
                    "recipient"
                })?
                .as_str()?
                .to_owned();
            recipients.insert(recipient, row);
        }
        let audience = recipients.len() as i64;
        for (recipient, original) in recipients {
            let (incarnation, source) = if kind == "delivered" {
                (self.seq as i64, content.clone())
            } else {
                if original.field("audience")?.as_int()? != audience {
                    return Err(RuntimeError::TraceSubset(format!(
                        "{} audience exceeds its reserved history",
                        deliver.line(None)
                    )));
                }
                let mut source = original.as_object()?.clone();
                source.insert("id".into(), content.field("id")?.clone());
                (
                    original.field("incarnation")?.as_int()?,
                    Value::Row(source.into()),
                )
            };
            let event = delivery::event_row(
                &source,
                &deliver,
                &recipient,
                kind,
                incarnation,
                audience,
                self.seq as i64,
                self.delivery_ordinal,
                self.context.now.unwrap_or(0),
            )?;
            if new.is_some() {
                self.delivery_receipt(&deliver, content, if kind == "delivered" { &event } else { &original })?;
            }
            self.delivery_ordinal = self
                .delivery_ordinal
                .checked_add(1)
                .ok_or(RuntimeError::Fanout)?;
            self.step(15)?;
            validate_row(self.schema, &deliver.log, &event)?;
            self.tx.execute(
                "INSERT INTO rows(table_name,row_id,data) VALUES (?1,?2,?3)",
                params![
                    deliver.log,
                    event.field("id")?.as_str()?,
                    canonical_json(&event)
                ],
            )?;
            let work = reindex_row(self.tx, self.schema, &deliver.log, &event)?;
            self.finish_row_change(
                &deliver.log,
                None,
                Some(&event),
                work,
                RowChangeOrigin::Source,
            )?;
        }
        if new.is_none() {
            self.tx.execute(
                "INSERT OR IGNORE INTO _meta(key,value) VALUES (?1,'1')",
                [&retired],
            )?;
        }
        Ok(())
    }
}

impl Engine {
    pub(super) fn custody_certificate<'a>(
        &self,
        certificate: &'a Certificate,
        seed: bool,
    ) -> Result<std::borrow::Cow<'a, Certificate>, RuntimeError> {
        use std::borrow::Cow;
        if self.rule_authority == RuleAuthority::ReceiptOnly
            || !certificate.write_sites.iter().any(|w| {
                self.schema
                    .table(&w.table)
                    .is_some_and(|t| t.deliver.is_some())
            })
        {
            return Ok(Cow::Borrowed(certificate));
        }
        let mut bounds = BTreeMap::new();
        for (_, _, d) in delivery::declarations(&self.schema) {
            if let Some(bound) = delivery::audience_bound(&self.store, &d.log)? {
                bounds.insert(d.log.clone(), bound);
            }
        }
        let ceilings = if seed {
            seed_ceilings()
        } else {
            Ceilings::default()
        };
        certificate
            .with_delivery_audiences(&self.schema, &bounds, &ceilings)
            .map(Cow::Owned)
            .map_err(|e| RuntimeError::Refusal(Box::new(e)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authoritative_replay_derives_events_and_a_conflict_rolls_them_back() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../corpus/deliver-log-schema-identity.json"
        ))
        .unwrap();
        let schema: Schema = serde_json::from_value(fixture["schema"].clone()).unwrap();
        for conflict in [false, true] {
            let mut engine = Engine::memory(schema.clone()).unwrap();
            engine
                .seed(
                    "memberships",
                    object([
                        ("id", Value::Id("a".into())),
                        ("conversationId", Value::Id("c".into())),
                        ("principal", Value::Id("alice".into())),
                    ]),
                )
                .unwrap();
            let row = object([
                ("id", Value::Id("m".into())),
                ("conversationId", Value::Id("c".into())),
                ("authorId", Value::Id("alice".into())),
                ("body", Value::String("hello".into())),
            ]);
            let program = Program {
                name: "replay.send".into(),
                kind: ProgramKind::Mutation,
                args: BTreeMap::new(),
                read_time_granularity_ms: None,
                body: vec![Stmt::Insert {
                    table: "messages".into(),
                    row: Expr::Literal(row),
                }],
            };
            let certificate = Checker::new(&schema, Ceilings::default())
                .check(&program)
                .unwrap();
            let mut trace = crate::offline::ReplayTrace::default();
            if conflict {
                trace.points.push(crate::offline::ReplayTracePoint {
                    table: "messages".into(),
                    index: "byId".into(),
                    key: vec![Value::Id("m".into())],
                    digest: None,
                });
            }
            let replay = crate::offline::ReplayCommit {
                grant: "grant".into(),
                offset: 0,
                count: 1,
                intent: "grant:0".into(),
                request_digest: "d".repeat(64),
                trace,
                at: 5,
            };
            let execution = engine
                .execute_replay(
                    &program,
                    &certificate,
                    Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
                    &replay,
                )
                .unwrap();
            if conflict {
                assert!(
                    matches!(execution.state, ExecutionState::Rejected { ref code, .. } if code == "conflict"),
                    "{:?}",
                    execution.state
                );
                assert!(engine.rows("deliveries").unwrap().is_empty());
                assert!(engine.rows("messages").unwrap().is_empty());
            } else {
                assert!(matches!(execution.state, ExecutionState::Committed { .. }));
                assert_eq!(engine.rows("deliveries").unwrap().len(), 1);
                assert!(
                    engine
                        .store()
                        .stored_client_intent("alice", "grant:0")
                        .unwrap()
                        .is_some()
                );
            }
        }
    }
}

#[cfg(test)]
#[test]
fn a_retained_delivery_log_refuses_reuse_without_a_retired_metadata_record() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../corpus/deliver-log-schema-identity.json"
    ))
    .unwrap();
    let schema: Schema = serde_json::from_value(fixture["schema"].clone()).unwrap();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    engine
        .seed(
            "memberships",
            object([
                ("id", Value::Id("a".into())),
                ("conversationId", Value::Id("c".into())),
                ("principal", Value::Id("alice".into())),
            ]),
        )
        .unwrap();
    let row = object([
        ("id", Value::Id("m".into())),
        ("conversationId", Value::Id("c".into())),
        ("authorId", Value::Id("alice".into())),
        ("body", Value::String("hello".into())),
    ]);
    engine.seed("messages", row.clone()).unwrap();
    // Model a retained bootstrap history from before native writes existed.
    let tx = engine.store.conn.transaction().unwrap();
    tx.execute("DELETE FROM rows WHERE table_name='messages'", [])
        .unwrap();
    delete_index_row(&tx, "messages", "m").unwrap();
    tx.commit().unwrap();
    assert_eq!(
        engine.seed("messages", row).unwrap_err().code(),
        delivery::INCARNATION
    );
    assert!(engine.rows("messages").unwrap().is_empty());
    assert_eq!(engine.rows("deliveries").unwrap().len(), 1);
}

#[cfg(test)]
#[test]
fn custody_storage_fault_does_not_settle_replay_or_then_as_a_program_refusal() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!("../../../../corpus/deliver-log-schema-identity.json")).unwrap();
    let schema: Schema = serde_json::from_value(fixture["schema"].clone()).unwrap();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    engine.store.conn.execute("UPDATE _meta SET value='broken' WHERE key='custody_audience:deliveries'", []).unwrap();
    engine.store.conn.execute("INSERT INTO _outbox(id,seq,effect,payload,state,attempts,next_at,created_at,updated_at) VALUES ('pending',1,'effect',?1,'then_pending',0,0,0,0)", [canonical_json(&Value::Null)]).unwrap();
    let program = Program { name: "remove".into(), kind: ProgramKind::Mutation, args: BTreeMap::new(), read_time_granularity_ms: None, body: vec![Stmt::Delete { table: "messages".into(), key: Expr::Literal(Value::Id("m".into())) }] };
    let certificate = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
    let replay = crate::offline::ReplayCommit { grant: "grant".into(), offset: 0, count: 1, intent: "grant:0".into(), request_digest: "d".repeat(64), trace: Default::default(), at: 1 };
    let error = engine.execute_replay(&program, &certificate, Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()), &replay).unwrap_err();
    assert_eq!(error.code(), "E_STORE_VERSION");
    assert!(engine.store.stored_client_intent("alice", "grant:0").unwrap().is_none());
    assert!(engine.store.replay_slice_is_unused("grant", "another", 0, 1).unwrap());
    let error = engine.execute_then(&program, &certificate, BTreeMap::new(), 1, None, VecDeque::new(), "pending").unwrap_err();
    assert_eq!(error.code(), "E_STORE_VERSION");
    assert_eq!(engine.store.outbox_get("pending").unwrap().unwrap().state, "then_pending");
}
