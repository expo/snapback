use super::*;
use crate::ir::*;
use crate::schema::*;
use crate::value::Value;

pub(super) struct EvaluatedScan {
    pub(super) prefix: Vec<crate::search_key::IndexAtom>,
    pub(super) logical: Vec<crate::search_key::LogicalIndexAtom>,
    pub(super) physical: Vec<Value>,
    pub(super) empty: bool,
    pub(super) after: Option<Value>,
    pub(super) before: Option<Value>,
    pub(super) range: Option<EvaluatedRange>,
    pub(super) take: usize,
}
use super::runner::{Runner, TrackedValue};

impl Runner<'_> {
    // Validate the selected scope before its page or lane discovery opens. The
    // argument decoder already rejected malformed tokens before any execution.
    pub(super) fn validate_scan_cursor(&self, scan: &Scan) -> Result<(), RuntimeError> {
        if !scan.opaque_cursor {
            return Ok(());
        }
        if scan.before.is_some() {
            return Err(RuntimeError::Input(
                "opaque cursors may be used only with after".into(),
            ));
        }
        let value = match scan.after.as_deref() {
            Some(Expr::Variable(name)) => self.env.get(name),
            Some(Expr::Literal(value)) => Some(value),
            _ => None,
        }
        .ok_or_else(|| {
            RuntimeError::Input(
                "opaque cursor expression must derive from an operation argument".into(),
            )
        })?;
        if value == &Value::Null {
            return Ok(());
        }
        let Value::String(token) = value else {
            return Err(RuntimeError::Input(
                "opaque cursor value must be a string or null".into(),
            ));
        };
        let table = self.schema.table(&scan.table).expect("certified table");
        let index = table.index(&scan.index).expect("certified index");
        let suffix = index
            .suffix_columns(scan.prefix.len())
            .ok_or_else(|| {
                RuntimeError::Input("search must equality-bind its derived component".into())
            })?
            .iter()
            .map(|name| crate::cursor::CursorColumn {
                name: name.clone(),
                kind: table.columns[name].clone(),
            })
            .collect::<Vec<_>>();
        decode_cursor_for(
            self.schema,
            token,
            &scan.table,
            &scan.index,
            scan.order,
            &suffix,
        )
        .map(|_| ())
        .map_err(|error| RuntimeError::Input(error.to_string()))
    }

    pub(super) fn evaluate_scan(&mut self, scan: &Scan) -> Result<EvaluatedScan, RuntimeError> {
        self.validate_scan_cursor(scan)?;
        let (prefix, logical, physical, empty) = self.search_prefix(scan)?;
        let mut after = scan
            .after
            .as_deref()
            .map(|value| self.expr(value))
            .transpose()?;
        if after == Some(Value::Null) && scan.opaque_cursor {
            after = None;
        }
        let before = scan
            .before
            .as_deref()
            .map(|value| self.expr(value))
            .transpose()?;
        let evaluated_range = scan
            .range
            .as_ref()
            .map(|range| self.eval_range(range))
            .transpose()?;
        let table = self
            .schema
            .table(&scan.table)
            .ok_or_else(|| RuntimeError::Schema(format!("missing table {}", scan.table)))?;
        let index = table.index(&scan.index).ok_or_else(|| {
            RuntimeError::Schema(format!("missing index {}.{}", scan.table, scan.index))
        })?;
        if scan.opaque_cursor {
            let suffix = index
                .suffix_columns(scan.prefix.len())
                .ok_or_else(|| {
                    RuntimeError::Input("search must equality-bind its derived component".into())
                })?
                .iter()
                .map(|name| {
                    table
                        .columns
                        .get(name)
                        .cloned()
                        .map(|kind| crate::cursor::CursorColumn {
                            name: name.clone(),
                            kind,
                        })
                })
                .collect::<Option<Vec<_>>>()
                .ok_or_else(|| RuntimeError::Schema("missing cursor index column".to_owned()))?;
            after = match after {
                Some(Value::String(token)) => Some(Value::Array(
                    decode_cursor_for(
                        self.schema,
                        &token,
                        &scan.table,
                        &scan.index,
                        scan.order,
                        &suffix,
                    )
                    .map_err(|error| RuntimeError::Input(error.to_string()))?,
                )),
                None => None,
                Some(_) => {
                    return Err(RuntimeError::Input(
                        "opaque cursor value must be a string or null".to_owned(),
                    ));
                }
            };
        }
        let take = match &scan.take {
            Bound::Literal(value) => *value as usize,
            Bound::Arg { name, max } => {
                let value = self
                    .context
                    .args
                    .get(name)
                    .ok_or_else(|| RuntimeError::Input(format!("missing take arg {name}")))?
                    .as_int()?;
                if value < 0 || value > *max as i64 {
                    return Err(RuntimeError::Fanout);
                }
                value as usize
            }
        };
        // Physical encoders operate on admitted slots; a target's generated
        // intrinsic address and Ref columns have schema-derived identity domains.
        crate::cap::validate_key_identities(self.schema, &scan.table, &scan.index, 0, &physical)?;
        for bound in [&after, &before].into_iter().flatten() {
            let values = match bound {
                Value::Array(values) => values.as_slice(),
                value => std::slice::from_ref(value),
            };
            crate::cap::validate_key_identities(
                self.schema,
                &scan.table,
                &scan.index,
                scan.prefix.len(),
                values,
            )?;
        }
        if let Some(range) = &evaluated_range {
            for bound in [&range.gt, &range.gte, &range.lt, &range.lte]
                .into_iter()
                .flatten()
            {
                crate::cap::validate_key_identities(
                    self.schema,
                    &scan.table,
                    &scan.index,
                    scan.prefix.len(),
                    std::slice::from_ref(bound),
                )?;
            }
        }
        Ok(EvaluatedScan {
            prefix,
            logical,
            physical,
            empty,
            after,
            before,
            range: evaluated_range,
            take,
        })
    }

    pub(super) fn scan_tracked(&mut self, scan: &Scan) -> Result<Vec<TrackedValue>, RuntimeError> {
        let EvaluatedScan {
            prefix,
            physical,
            empty,
            logical: _,
            after,
            before,
            range: evaluated_range,
            take,
        } = self.evaluate_scan(scan)?;
        let table = self.schema.table(&scan.table).expect("evaluated table");
        let index = table.index(&scan.index).expect("evaluated index");
        let read_site = self
            .certificate
            .expect("ordinary scans have a certificate")
            .read_sites
            .iter()
            .find(|site| site.site == scan.site)
            .cloned()
            .ok_or_else(|| {
                RuntimeError::TraceSubset(format!("undeclared read site {}", scan.site))
            })?;
        // @ref LLP 1016#d1--the-system-principal-is-the-stores-owner — owner ranges never filter or spend rule probes; ordinary trace bounds still apply.
        let system = self.context.viewer.is_system();
        let uniform = system || read_site.hoist;
        let always_visible = system
            || (read_site.hoist && read_site.decided_true)
            || matches!(table.rules.read, RuleExpr::Public { .. } | RuleExpr::Allow);
        let certificate = self.certificate.expect("ordinary scans have a certificate");
        let remaining_examined = certificate.max_examined.saturating_sub(self.trace.examined);
        let remaining_rule_probes = certificate
            .max_rule_probes
            .saturating_sub(self.trace.rule_probes);
        let candidate_limit = if always_visible || read_site.rule_probes_per_candidate == 0 {
            remaining_examined
        } else if uniform {
            if remaining_rule_probes < read_site.rule_probes_per_candidate {
                0
            } else {
                remaining_examined
            }
        } else {
            remaining_examined
                .min(remaining_rule_probes.saturating_div(read_site.rule_probes_per_candidate))
        };
        let candidate_limit = usize::try_from(candidate_limit).unwrap_or(usize::MAX);
        let fetch_limit = if always_visible || uniform {
            candidate_limit.min(take.saturating_add(2))
        } else {
            candidate_limit
        };
        // @ref LLP 1017#32-the-rule — test capacity, including probe starvation, not returned rows.
        if read_site.complete && fetch_limit < take.saturating_add(2) {
            return Err(RuntimeError::TraceSubset(format!(
                "complete loop at {} was budget-cut",
                scan.site
            )));
        }
        // @ref LLP 1001#3-read-and-write-states-no-silent-states — uniformly false ranges halt after one determination.
        // A hoisted rule has one verdict for the entire prefix. Probe one
        // candidate first so a uniformly false range can terminate without
        // fetching or charging the hidden population row by row.
        let mut uniform_result = always_visible.then_some(true);
        let mut uniform_false_row = None;
        let mut uniform_empty = empty;
        if !empty && uniform && !always_visible && fetch_limit > 0 {
            let mut probe = scan_indexed(
                self.tx,
                &scan.table,
                &scan.index,
                table,
                index,
                &physical,
                after.as_ref(),
                before.as_ref(),
                evaluated_range.as_ref(),
                scan.order,
                1,
            )?;
            if let Some(mut row) = probe.pop() {
                materialize_optional_fields(&mut row, table);
                let checkpoint = self.candidate_checkpoint();
                let allowed = self.check_rule(&scan.table, Effect::Read, None, &row)?;
                uniform_result = Some(allowed);
                if !allowed {
                    // The candidate and its rule inputs remain authoritative
                    // trace only; the viewer gets the same absence as empty.
                    self.rollback_candidate(checkpoint);
                    uniform_false_row = Some(row);
                }
            } else {
                uniform_empty = true;
            }
        }
        let mut rows = if uniform_false_row.is_some() || uniform_empty {
            Vec::new()
        } else {
            scan_indexed(
                self.tx,
                &scan.table,
                &scan.index,
                table,
                index,
                &physical,
                after.as_ref(),
                before.as_ref(),
                evaluated_range.as_ref(),
                scan.order,
                fetch_limit,
            )?
        };
        for row in &mut rows {
            materialize_optional_fields(row, table);
        }
        let fetched = rows.len();
        let uniformly_false = uniform_false_row.is_some();
        let mut examined_ids = uniform_false_row
            .into_iter()
            .map(|row| row.field("id")?.as_str().map(ToOwned::to_owned))
            .collect::<Result<Vec<_>, _>>()?;
        let mut visible = Vec::new();
        for row in rows {
            let visible_target = if uniform {
                take.saturating_add(2)
            } else {
                take
            };
            if visible.len() >= visible_target {
                break;
            }
            let checkpoint = self.candidate_checkpoint();
            let allowed = match uniform_result {
                Some(allowed) => allowed,
                None => {
                    let allowed = self.check_rule(&scan.table, Effect::Read, None, &row)?;
                    if uniform {
                        uniform_result = Some(allowed);
                    }
                    allowed
                }
            };
            if !allowed {
                // A rule probe keyed by a hidden candidate is authoritative trace,
                // never a receipt artifact: even a public absence would reveal the row.
                self.rollback_candidate(checkpoint);
            }
            examined_ids.push(row.field("id")?.as_str()?.to_owned());
            if allowed {
                visible.push(row);
            }
        }
        let source_exhausted = uniformly_false
            || uniform_empty
            || (examined_ids.len() == fetched && fetched < fetch_limit);
        let stop = if (uniform && visible.len() <= take && source_exhausted)
            || (!uniform && visible.len() < take && source_exhausted)
        {
            StopReason::Exhausted
        } else {
            StopReason::Limit
        };
        self.trace.examined += examined_ids.len() as u64;
        let halo_row = uniform.then(|| visible.get(take)).flatten();
        let n2_row = uniform.then(|| visible.get(take + 1)).flatten();
        let n2_suffix = n2_row.map(|row| index_values(row, index)[prefix.len()..].to_vec());
        let visible_ids = visible
            .iter()
            .map(|row| {
                row.field("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let returned_ids = visible_ids.iter().take(take).cloned().collect::<Vec<_>>();
        for row in visible.iter().take(take).chain(halo_row) {
            self.record_row(&scan.table, row.field("id")?.as_str()?, row, true);
        }
        let halo = halo_row.map(|row| RowRef {
            table: scan.table.clone(),
            id: row
                .field("id")
                .and_then(Value::as_str)
                .expect("validated row id")
                .to_owned(),
        });
        // Move the visible result only after borrowing the halo for its receipt.
        visible.truncate(take);
        let returned = visible;
        let rule_hash = self.hashes.table(&scan.table, Effect::Read).to_owned();
        let evaluated_take = u32::try_from(take).map_err(|_| RuntimeError::Fanout)?;
        let range = TraceRange {
            site: scan.site.clone(),
            table: scan.table.clone(),
            index: scan.index.clone(),
            prefix: prefix.clone(),
            order: scan.order,
            take: evaluated_take,
            after: after.clone(),
            before: before.clone(),
            gt: evaluated_range.as_ref().and_then(|range| range.gt.clone()),
            gte: evaluated_range.as_ref().and_then(|range| range.gte.clone()),
            lt: evaluated_range.as_ref().and_then(|range| range.lt.clone()),
            lte: evaluated_range.as_ref().and_then(|range| range.lte.clone()),
            rule_hash: rule_hash.clone(),
            examined_ids,
            visible_ids,
            returned_ids: returned_ids.clone(),
            stop,
            absence: returned.is_empty(),
            halo: halo.clone(),
            n2_suffix: n2_suffix.clone(),
        };
        self.trace.ranges.push(range);
        // Only a certified-uniform range can carry an extent. A uniformly false,
        // exhausted range carries the same visible absence as a physically empty one.
        if uniform && (uniform_result != Some(false) || stop == StopReason::Exhausted) {
            self.receipt.ranges.push(ReceiptRange {
                site: scan.site.clone(),
                table: scan.table.clone(),
                index: scan.index.clone(),
                prefix,
                order: scan.order,
                take: evaluated_take,
                after,
                before,
                gt: evaluated_range.as_ref().and_then(|range| range.gt.clone()),
                gte: evaluated_range.as_ref().and_then(|range| range.gte.clone()),
                lt: evaluated_range.as_ref().and_then(|range| range.lt.clone()),
                lte: evaluated_range.and_then(|range| range.lte),
                rule_hash,
                row_ids: returned_ids.clone(),
                stop,
                absence: returned.is_empty(),
                halo,
                n2_suffix,
            });
        }
        Ok(returned
            .into_iter()
            .zip(returned_ids)
            .map(|(value, id)| TrackedValue {
                value,
                provenance: ResultProvenance::Row {
                    table: scan.table.clone(),
                    id,
                },
            })
            .collect())
    }
}
