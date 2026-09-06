// @ref LLP 1010#a5-the-merged-feed — one cursor per distinct prefix; heap heads establish the true suffix top-N.
use super::runner::{Runner, TrackedValue};
use super::scan::EvaluatedScan;
use super::*;
use crate::ir::*;
use crate::schema::*;
use crate::value::{Value, canonical_json};
use std::cmp::Ordering;
use std::collections::BTreeSet;

struct Lane {
    scan: Scan,
    input: EvaluatedScan,
    uniform: bool,
    allowed: Option<bool>,
    probes: u64,
    exhausted: bool,
    examined: Vec<String>,
    visible: Vec<Value>,
    returned: Vec<Value>,
}

struct Head {
    lane: usize,
    row: Value,
    key: Value,
}

impl Runner<'_> {
    pub(super) fn merge_tracked(
        &mut self,
        merge: &Merge,
    ) -> Result<Vec<TrackedValue>, RuntimeError> {
        for lane in &merge.lanes {
            self.validate_scan_cursor(&lane.scan)?;
        }
        let mut lanes = Vec::new();
        let mut prefixes = BTreeSet::new();
        for lane in &merge.lanes {
            let source = match &lane.source {
                Some(source) => self
                    .scan_tracked(source)?
                    .into_iter()
                    .map(|v| v.value)
                    .collect(),
                None => vec![Value::Null],
            };
            let previous = self.env.get(&lane.binding).cloned();
            for row in source {
                if lane.source.is_some() {
                    self.env.insert(lane.binding.clone(), row);
                }
                let env = (!lane.setup.is_empty()).then(|| {
                    (
                        self.env.clone(),
                        self.env_provenance.clone(),
                        self.consts.clone(),
                    )
                });
                self.statements(&lane.setup)?;
                let input = self.evaluate_scan(&lane.scan)?;
                if let Some((values, provenance, consts)) = env {
                    self.env = values;
                    self.env_provenance = provenance;
                    self.consts = consts;
                }
                if !prefixes.insert(canonical_json(&(
                    &input.prefix,
                    &input.after,
                    &input.before,
                    input.range.as_ref().map(|r| (&r.gt, &r.gte, &r.lt, &r.lte)),
                ))) {
                    continue;
                }
                let read = self
                    .certificate
                    .unwrap()
                    .read_sites
                    .iter()
                    .find(|s| s.site == lane.scan.site)
                    .ok_or_else(|| {
                        RuntimeError::TraceSubset(format!(
                            "undeclared merge lane {}",
                            lane.scan.site
                        ))
                    })?;
                let table = self.schema.table(&lane.scan.table).expect("checked table");
                let public = self.context.viewer.is_system()
                    || matches!(table.rules.read, RuleExpr::Allow | RuleExpr::Public { .. });
                lanes.push(Lane {
                    scan: lane.scan.clone(),
                    input,
                    uniform: public || read.hoist,
                    allowed: public.then_some(true),
                    probes: read.rule_probes_per_candidate,
                    exhausted: false,
                    examined: Vec::new(),
                    visible: Vec::new(),
                    returned: Vec::new(),
                });
            }
            if let Some(value) = previous {
                self.env.insert(lane.binding.clone(), value);
            } else {
                self.env.remove(&lane.binding);
            }
        }
        // The first distinct lane supplies the evaluated take; all descriptors share
        // its bound, whose maximum the certificate prices from the first static lane.
        let take = lanes
            .first()
            .map_or(merge.take() as usize, |lane| lane.input.take);
        let tx = self.tx;
        let schema = self.schema;
        let mut statements = lanes
            .iter()
            .map(|lane| {
                let table = schema.table(&lane.scan.table).expect("checked table");
                let index = table.index(&lane.scan.index).expect("checked index");
                index::prepare_scan_indexed(
                    tx,
                    &lane.scan.table,
                    &lane.scan.index,
                    table,
                    index,
                    &lane.input.prefix,
                    lane.input.after.as_ref(),
                    lane.input.before.as_ref(),
                    lane.input.range.as_ref(),
                    lane.scan.order,
                    self.certificate.unwrap().max_examined as usize,
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        // Statements live in their own stable vector; Rows borrows each statement once.
        let mut cursors = statements
            .iter_mut()
            .map(|statement| statement.raw_query())
            .collect::<Vec<_>>();
        let mut heap = Vec::new();
        for (i, lane) in lanes.iter_mut().enumerate() {
            if let Some(head) = self.merge_head(i, lane, &mut cursors[i])? {
                self.heap_push(&mut heap, head, lane.scan.order)?;
            }
        }
        let order = merge.lanes[0].scan.order;
        let mut seen = BTreeSet::new();
        let mut returned = Vec::new();
        while !heap.is_empty() && seen.len() < take.saturating_add(2) {
            let head = self.heap_pop(&mut heap, order)?;
            self.step(1)?;
            if seen.insert(head.row.field("id")?.as_str()?.to_owned()) && returned.len() < take {
                lanes[head.lane].returned.push(head.row.clone());
                returned.push(head.row);
            }
            if let Some(next) =
                self.merge_head(head.lane, &mut lanes[head.lane], &mut cursors[head.lane])?
            {
                self.heap_push(&mut heap, next, order)?;
            }
        }
        let page = self
            .certificate
            .unwrap()
            .result_pages
            .values()
            .find(|page| page.merge && page.site == merge.site);
        let last_returned_suffix = page
            .and_then(|page| {
                returned.last().map(|row| {
                    page.suffix
                        .iter()
                        .map(|column| row.field(&column.name).cloned())
                        .collect::<Result<Vec<_>, _>>()
                })
            })
            .transpose()?;
        self.trace.merges.push(MergeTrace {
            site: merge.site.clone(),
            deduplicated_union_len: seen.len() as u64,
            last_returned_suffix,
        });
        for lane in lanes {
            self.record_merge_lane(lane)?;
        }
        returned
            .into_iter()
            .map(|value| {
                Ok(TrackedValue {
                    provenance: ResultProvenance::Row {
                        table: merge.table().to_owned(),
                        id: value.field("id")?.as_str()?.to_owned(),
                    },
                    value,
                })
            })
            .collect()
    }

    fn merge_head(
        &mut self,
        lane_id: usize,
        lane: &mut Lane,
        rows: &mut rusqlite::Rows<'_>,
    ) -> Result<Option<Head>, RuntimeError> {
        let certificate = self.certificate.unwrap();
        loop {
            if lane.exhausted {
                return Ok(None);
            }
            if self.trace.examined >= certificate.max_examined
                || (lane.allowed.is_none()
                    && certificate
                        .max_rule_probes
                        .saturating_sub(self.trace.rule_probes)
                        < lane.probes)
            {
                return Ok(None);
            }
            self.step(1)?;
            let Some(record) = rows.next()? else {
                lane.exhausted = true;
                return Ok(None);
            };
            let data: String = record.get(0)?;
            let mut row: Value =
                serde_json::from_str(&data).map_err(|e| RuntimeError::Schema(e.to_string()))?;
            let table = self.schema.table(&lane.scan.table).expect("checked table");
            materialize_optional_fields(&mut row, table);
            self.trace.examined += 1;
            lane.examined.push(row.field("id")?.as_str()?.to_owned());
            let checkpoint = self.candidate_checkpoint();
            let allowed = match lane.allowed {
                Some(allowed) => allowed,
                None => self.check_rule(&lane.scan.table, Effect::Read, None, &row)?,
            };
            if lane.uniform {
                lane.allowed = Some(allowed);
            }
            if !allowed {
                self.rollback_candidate(checkpoint);
                if lane.uniform {
                    lane.exhausted = true;
                    return Ok(None);
                }
                continue;
            }
            let index = table.index(&lane.scan.index).expect("checked index");
            let key = Value::Array(index_values(&row, index)[lane.input.prefix.len()..].to_vec());
            lane.visible.push(row.clone());
            return Ok(Some(Head {
                lane: lane_id,
                row,
                key,
            }));
        }
    }

    fn heap_before(&mut self, a: &Head, b: &Head, order: Order) -> Result<bool, RuntimeError> {
        self.step(1)?;
        let comparison = a.key.total_cmp(&b.key);
        Ok(if order == Order::Asc {
            comparison == Ordering::Less
        } else {
            comparison == Ordering::Greater
        })
    }
    fn heap_push(
        &mut self,
        heap: &mut Vec<Head>,
        head: Head,
        order: Order,
    ) -> Result<(), RuntimeError> {
        heap.push(head);
        let mut i = heap.len() - 1;
        while i > 0 {
            let parent = (i - 1) / 2;
            if !self.heap_before(&heap[i], &heap[parent], order)? {
                break;
            }
            heap.swap(i, parent);
            i = parent;
        }
        Ok(())
    }
    fn heap_pop(&mut self, heap: &mut Vec<Head>, order: Order) -> Result<Head, RuntimeError> {
        let head = heap.swap_remove(0);
        let mut i = 0;
        while 2 * i + 1 < heap.len() {
            let mut child = 2 * i + 1;
            if child + 1 < heap.len() && self.heap_before(&heap[child + 1], &heap[child], order)? {
                child += 1;
            }
            if !self.heap_before(&heap[child], &heap[i], order)? {
                break;
            }
            heap.swap(i, child);
            i = child;
        }
        Ok(head)
    }

    fn record_merge_lane(&mut self, lane: Lane) -> Result<(), RuntimeError> {
        let scan = lane.scan;
        let table = self.schema.table(&scan.table).expect("checked table");
        let index = table.index(&scan.index).expect("checked index");
        let visible_ids = row_ids(&lane.visible)?;
        let returned_ids = row_ids(&lane.returned)?;
        let end = returned_ids
            .last()
            .and_then(|last| visible_ids.iter().rposition(|id| id == last))
            .map_or(0, |position| position + 1);
        let remaining = &lane.visible[end..];
        // The halo may start on an id-duplicate emitted by another lane.
        let halo = remaining.first().map(|row| RowRecord {
            table: scan.table.clone(),
            id: row.field("id").unwrap().as_str().unwrap().to_owned(),
            row: row.clone(),
        });
        let n2_key = remaining.get(1).map(|row| index_values(row, index));
        let stop = if lane.exhausted && remaining.is_empty() {
            StopReason::Exhausted
        } else {
            StopReason::Limit
        };
        // Keep the bounded lookahead as well as each head: after one local deletion
        // the replay must still distinguish a full page from an exhausted stream.
        for row in &lane.visible {
            self.record_row(&scan.table, row.field("id")?.as_str()?, row, true);
        }
        let input = lane.input;
        let range = TraceRange {
            site: scan.site,
            table: scan.table,
            index: scan.index,
            prefix: input.prefix,
            order: scan.order,
            take: input.take as u32,
            after: input.after,
            before: input.before,
            gt: input.range.as_ref().and_then(|r| r.gt.clone()),
            gte: input.range.as_ref().and_then(|r| r.gte.clone()),
            lt: input.range.as_ref().and_then(|r| r.lt.clone()),
            lte: input.range.as_ref().and_then(|r| r.lte.clone()),
            rule_hash: self.schema.rule_hash(&table.rules.read),
            examined_ids: lane.examined,
            visible_ids,
            returned_ids: returned_ids.clone(),
            stop,
            absence: returned_ids.is_empty(),
            halo,
            n2_key,
        };
        if lane.uniform {
            self.receipt.ranges.push(ReceiptRange {
                site: range.site.clone(),
                table: range.table.clone(),
                index: range.index.clone(),
                prefix: range.prefix.clone(),
                order: range.order,
                take: range.take,
                after: range.after.clone(),
                before: range.before.clone(),
                gt: range.gt.clone(),
                gte: range.gte.clone(),
                lt: range.lt.clone(),
                lte: range.lte.clone(),
                rule_hash: range.rule_hash.clone(),
                row_ids: returned_ids,
                stop,
                absence: range.absence,
                halo: range.halo.clone(),
                n2_key: range.n2_key.clone(),
            });
        }
        self.trace.ranges.push(range);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Ceilings, Checker, object};

    #[test]
    fn system_merge_reads_denied_and_nonuniform_tables_without_rule_probes() {
        for read in [
            RuleExpr::Deny,
            RuleExpr::Eq(
                RuleTerm::Field("at".into()),
                RuleTerm::Literal(Value::Int(1)),
            ),
        ] {
            let frozen: serde_json::Value = serde_json::from_str(include_str!(
                "../../../../corpus/merge-runtime-overlap-deduped.json"
            ))
            .unwrap();
            let mut schema: Schema = serde_json::from_value(frozen["schema"].clone()).unwrap();
            let uniform = matches!(read, RuleExpr::Deny);
            schema.tables.get_mut("posts").unwrap().rules.read = read;
            let mut program: Program = serde_json::from_value(frozen["program"].clone()).unwrap();
            let Stmt::Return(Expr::Merge(merge)) = &mut program.body[0] else {
                unreachable!()
            };

            for lane in &mut merge.lanes {
                lane.scan.opaque_cursor = true;
                lane.scan.after = Some(Box::new(Expr::Variable("c".into())));
            }
            program
                .args
                .insert("c".into(), ArgType::Optional(Box::new(ArgType::Cursor)));
            let certificate = Checker::new(&schema, Ceilings::default())
                .check(&program)
                .unwrap();
            assert_eq!(
                certificate.completeness,
                if uniform {
                    crate::certificate::Completeness::Page
                } else {
                    crate::certificate::Completeness::Capped
                }
            );
            assert!(
                certificate
                    .read_sites
                    .iter()
                    .all(|site| site.hoist == uniform)
            );
            let mut engine = Engine::memory(schema).unwrap();
            let receipt: ClosureReceipt =
                serde_json::from_value(frozen["receipt"].clone()).unwrap();
            for row in receipt.rows {
                engine.seed(&row.table, row.row).unwrap();
            }
            let mut context = Context::system();
            context.args.insert("c".into(), Value::Null);
            let result = engine.execute(&program, &certificate, context).unwrap();
            assert_eq!(
                row_ids(result.result.as_array().unwrap()).unwrap(),
                ["a1", "a3"]
            );
            assert_eq!(result.state, ExecutionState::Complete);
            assert_eq!(result.next, None);
            assert_eq!(result.trace.rule_probes, 0);
        }
    }

    #[test]
    fn overlapping_lanes_record_remainder_after_last_returned_id() {
        let frozen: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../corpus/merge-runtime-overlap-deduped.json"
        ))
        .unwrap();
        let schema: Schema = serde_json::from_value(frozen["schema"].clone()).unwrap();
        let program: Program = serde_json::from_value(frozen["program"].clone()).unwrap();
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&program)
            .unwrap();
        let Stmt::Return(Expr::Merge(merge)) = &program.body[0] else {
            unreachable!()
        };
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        let tx = connection.transaction().unwrap();
        let mut runner = Runner::new(
            &tx,
            &schema,
            &certificate,
            Context::query(Actor::new("u1", "user").unwrap(), Default::default()),
            &[],
            &[],
            RuleAuthority::StoreAuthoritative,
            0,
        );
        let rows: Vec<_> = ["a", "b", "c"]
            .into_iter()
            .map(|id| {
                object([
                    ("id", Value::Id(id.into())),
                    ("author", Value::Id("u1".into())),
                    ("at", Value::Int(1)),
                ])
            })
            .collect();
        // Inject equal-prefix lanes directly, bypassing prefixes.insert. The heap's
        // id-dedupe can skip a visible prefix before this lane wins a later row.
        for (lane, returned) in [
            (0, vec![rows[0].clone(), rows[2].clone()]),
            (1, vec![rows[1].clone()]),
        ] {
            let scan = merge.lanes[lane].scan.clone();
            let input = runner.evaluate_scan(&scan).unwrap();
            runner
                .record_merge_lane(Lane {
                    scan,
                    input,
                    uniform: true,
                    allowed: Some(true),
                    probes: 0,
                    exhausted: true,
                    examined: vec!["a".into(), "b".into(), "c".into()],
                    visible: rows.clone(),
                    returned,
                })
                .unwrap();
        }
        let ranges = &runner.receipt.ranges;
        assert_eq!(ranges[0].stop, StopReason::Exhausted);
        assert!(ranges[0].halo.is_none());
        assert!(ranges[0].n2_key.is_none());
        assert_eq!(ranges[1].stop, StopReason::Limit);
        assert_eq!(ranges[1].halo.as_ref().unwrap().id, "c");
        assert!(ranges[1].n2_key.is_none());
        runner.trace.merges.push(MergeTrace {
            site: merge.site.clone(),
            deduplicated_union_len: 3,
            last_returned_suffix: None,
        });
        // The second lane still has a (globally duplicate) halo: conservatively capped.
        assert_eq!(
            query_state(&runner.trace, &certificate, false),
            ExecutionState::Capped
        );
    }
}
