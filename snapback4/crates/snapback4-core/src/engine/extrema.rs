//! Streaming scalar folds share the ordinary scan's authorization and meter.
use super::{Runner, ExpressionAccess};
use crate::{error::{MeterKind, RuntimeError}, ir::{Expr, Order}, meter::Cut, value::Value};

pub(in crate::engine) enum Aggregate<'a> {
    Total { value: i128, projection: Option<&'a Expr> },
    Extremum { value: Value, retained: u64, field: &'a str, max: bool, seek: bool },
}
impl<'a> Aggregate<'a> {
    pub(in crate::engine) fn total(projection: Option<&'a Expr>) -> Self { Self::Total { value: 0, projection } }
    pub(in crate::engine) fn is_zero(&self) -> bool { matches!(self, Self::Total { value: 0, .. }) }
    pub(in crate::engine) fn finish(self) -> Result<Value, RuntimeError> {
        match self { Self::Total { value, .. } => Value::int(value).map_err(Into::into), Self::Extremum { value, .. } => Ok(value) }
    }
    pub(in crate::engine) fn push(&mut self, runner: &mut Runner<'_>, row: &Value) -> Result<bool, RuntimeError> {
        match self {
            Self::Total { value, projection } => {
                let amount = if let Some(projection) = projection {
                    let prior = runner.env.insert("$filter".into(), row.clone());
                    let amount = runner.expr(projection);
                    match prior { Some(value) => { runner.env.insert("$filter".into(), value); }, None => { runner.env.remove("$filter"); } }
                    i128::from(amount?.as_int()?)
                } else { 1 };
                *value += amount;
                Ok(false)
            }
            Self::Extremum { value, retained, field, max, seek } => {
                runner.meter.step(1)?;
                let next = if *row == Value::Null { row } else { row.field(field)? };
                if *next == Value::Null { return Ok(false); }
                let replace = *value == Value::Null || if *max { next.total_cmp(value).is_gt() } else { next.total_cmp(value).is_lt() };
                if replace {
                    // The scan has released the decoded row's allowance.
                    // Reuse the old winner's reservation, including shared
                    // subtrees, admitting growth before changing the winner.
                    let bytes = next.expression_heap(ExpressionAccess(()));
                    let mark = runner.meter.mark();
                    runner.meter.heap(bytes.saturating_sub(*retained))?;
                    // Drop owned old bytes before cloning into their allowance.
                    *value = Value::Null;
                    *value = next.clone();
                    // Shrinking releases only the excess old reservation;
                    // failed growth leaves the previous winner charged.
                    runner.meter.release_row_heap(mark, retained.saturating_sub(bytes));
                    *retained = bytes;
                }
                Ok(*seek)
            }
        }
    }
}

impl Runner<'_> {
    // @ref LLP 3000.013#5.1 — an extremum is unavailable on a cut or unknown
    // domain; one locally held endpoint never proves domain completeness.
    pub(in crate::engine) fn extremum(&mut self, source: &Expr, field: &str, max: bool, domain: bool) -> Result<Value, RuntimeError> {
        let fold = |seek| Aggregate::Extremum { value: Value::Null, retained: 0, field, max, seek };
        let result = if domain {
            let Expr::Scan(scan) = source else { return Err(RuntimeError::Input("an extremum domain must be a scan".into())); };
            let seek = scan.orders_field(self.schema, field) && scan.order == if max { Order::Desc } else { Order::Asc };
            self.stream_aggregate(scan, fold(seek))
        } else {
            let inputs = crate::engine::components::Frame {
                beyond: self.beyond_horizon, unknown: self.missing_fact.is_some(),
                words: self.word_cut_at.is_some(), presence: self.presence_unknown,
                ..Default::default()
            };
            let outer = self.components.scalar.replace(inputs);
            let result = (|| {
                let rows = self.expr(source)?;
                let mut aggregate = fold(false);
                for row in rows.as_array()? { aggregate.push(self, row)?; }
                self.meter.require_uncapped()?;
                aggregate.finish()
            })();
            let mut coverage = self.components.scalar.take().expect("extremum coverage");
            // A bounded page intentionally selects just its requested rows.
            // Its continuation or per-row rule does not make their extremum
            // a cut domain. The query keeps both flags; actual cuts, missing
            // coverage and hidden rows are never converted into scalar data.
            coverage.overflow = false;
            coverage.non_uniform = false;
            self.components.scalar = outer;
            match result {
                Ok(_) if !coverage.coverage().complete => {
                    self.scalar_unavailable = true;
                    Err(RuntimeError::Prediction("min/max needs complete source coverage".into()))
                }
                result => result,
            }
        };
        if matches!(&result, Err(RuntimeError::Bound { kind: MeterKind::Steps, .. })) && self.meter.cut == Cut::Cap {
            self.meter.capped_at.get_or_insert((MeterKind::Steps, self.statement_site.clone()));
        }
        result
    }
}
