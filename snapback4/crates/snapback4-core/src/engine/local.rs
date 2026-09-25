//! The interpreter on a device (LLP 2000.000 §7.2, §9): the same programs
//! the server runs, over the rows the device holds — its partition — where
//! delivered rows are readable as held; provisional images need current read
//! authority. Unknown authorization, unknown online-only facts and reads
//! past a horizon make the result `complete: false`. A mutation
//! predicts: its rows are written to the device's store for the host to
//! mark pending, and the server judges the write when it arrives.

use super::runner::Runner;
use super::validate::validate_device_inputs as validate_inputs;
use super::{Context, QueryOutcome};
use crate::error::{Refusal, RuntimeError};
use crate::ir::Program;
use crate::meter::{Ceilings, Cut, Meter};
use crate::rows::Rows;
use crate::schema::Schema;
use crate::value::Value;

/// A query over the device's rows.
pub fn query(rows: &dyn Rows, schema: &Schema, program: &Program, context: Context, ceilings: Ceilings) -> Result<QueryOutcome, Refusal> {
    query_with_coverage(rows, schema, program, context, ceilings).0
}

/// Unknown means the server can establish a missing fact or presence; preserve it, and whether incompleteness is exclusively retained history, even after a require/unwrap refusal.
pub fn query_with_coverage(rows: &dyn Rows, schema: &Schema, program: &Program, context: Context, ceilings: Ceilings) -> (Result<QueryOutcome, Refusal>, bool, bool) {
    let (result, unknown, retained, _) = observe_query(rows, schema, program, context, ceilings, false);
    (result, unknown, retained)
}

pub fn query_with_components(rows: &dyn Rows, schema: &Schema, program: &Program, context: Context, ceilings: Ceilings) -> (Result<QueryOutcome, Refusal>, bool, bool, std::collections::BTreeMap<String, super::components::Coverage>) {
    observe_query(rows, schema, program, context, ceilings, true)
}

fn observe_query(rows: &dyn Rows, schema: &Schema, program: &Program, mut context: Context, ceilings: Ceilings, components: bool) -> (Result<QueryOutcome, Refusal>, bool, bool, std::collections::BTreeMap<String, super::components::Coverage>) {
    if program.kind == crate::ir::ProgramKind::Action { return (Err(RuntimeError::UnknownOp("an action runs only through client.act".into()).refusal()), false, false, Default::default()); }
    if let Err(error) = validate_inputs(schema, program, &mut context.args) { return (Err(error.refusal()), false, false, Default::default()); }    let mut runner = Runner::new(rows, schema, context, Meter::new(ceilings, Cut::Cap), 0);
    runner.device = true;
    runner.component_observation = components;
    let result = (|| {
    let data = match runner.run(program) {
        Ok(data) => data,
        // A require/unwrap after an unheld card is no more authoritative
        // than a null card; the original query must be answered remotely.
        Err(_) if runner.query_unavailable => Value::Null,
        Err(error) => return Err(error.refusal()),
    };
    let capped = runner.meter.capped_at.is_some();
    let charged = runner.charge_output(&data);
    if !capped && runner.meter.capped_at.is_some() { runner.components.note(|frame| frame.capped = true); }
    charged?;
    let next = if runner.query_unavailable { None } else { runner.outcome_next_cursor()? };    Ok(QueryOutcome {
        unavailable: runner.query_unavailable,
        complete: runner.meter.capped_at.is_none() && runner.word_cut_at.is_none() && !runner.non_uniform && !runner.page_overflow && !runner.page_position_lost() && !runner.timeline_pending && !runner.beyond_horizon && !runner.presence_unknown,
        cut: runner.read_cut(),
        capped_at: runner.meter.capped_at.clone(),
        word_cut_at: runner.word_cut_at.clone(),
        next,
        data: if runner.query_unavailable { Value::Null } else { data },
        seq: 0,
        metered: runner.meter.used,
        tables: runner.read_tables.iter().cloned().collect(),
        next_expiry: runner.next_expiry,
    })
    })();
    let components = if result.as_ref().is_ok_and(|outcome| matches!(outcome.data, Value::Row(_))) { runner.component_coverage() } else { Default::default() };
    // @ref LLP 3000.007#20.22.1 — presence is server knowledge too; a resource or structural cut is not.
    (result, runner.missing_fact.is_some() || runner.presence_unknown, runner.only_retained_incomplete(), components)}

/// What a mutation predicts on the device: its result, and the tables it
/// wrote through the store. A refusal is the caller's to show; the host
/// rolls its transaction back.
#[derive(Clone, Debug)]
pub struct Prediction {
    pub new_ids: Vec<String>,
    pub result: Value,
    pub written: Vec<String>,
    pub read: Vec<String>,
}

pub fn predict(rows: &dyn Rows, schema: &Schema, program: &Program, mut context: Context, ceilings: Ceilings) -> Result<Prediction, RuntimeError> {
    if program.kind == crate::ir::ProgramKind::Action { return Err(RuntimeError::UnknownOp("an action cannot predict; call client.act".into())); }
    validate_inputs(schema, program, &mut context.args)?;
    if let Some(fact) = schema.operations.get(&program.name) && fact.predicts.as_deref() == Some("never") {
        let reason = fact.sites.iter().find(|site| site.class == crate::schema::SiteClass::Server).map(|site| format!("site {}: {}", site.site, site.reason)).unwrap_or_else(|| program.name.clone());
        return Err(RuntimeError::Prediction(format!("{reason}; queued without a predicted row")));
    }
    // Classification metadata is advisory. Even an edge no-op queues as a
    // whole mutation; no actual transition hook would run for that case.
    if !schema.timelines.is_empty() && crate::ir::write_tables(program).iter().any(|(table, _)| schema.timelines.iter().any(|t| &t.edges[0] == table)) {
        return Err(RuntimeError::Prediction("timeline follow/unfollow/refollow requires online-only slot accounting".into()));
    }
    let mut runner = Runner::new(rows, schema, context, Meter::new(ceilings, Cut::Abort), 0);
    runner.device = true;
    runner.device_allowance = Some(Meter::new(ceilings, Cut::Abort));
    let result = runner.run(program).and_then(|value| {
        runner.check_final_exists()?;
        Ok(value)
    });
    // Unknown input can select a branch the server will never execute. Its
    // exhaustion cannot refuse the write; a cut with known inputs still can.
    if matches!(&result, Err(RuntimeError::Bound { .. })) && !runner.charged_untaken && runner.missing_fact.is_none() {
        return Err(result.unwrap_err());
    }
    if runner.beyond_horizon {
        return Err(RuntimeError::Prediction(runner.missing_fact.clone().unwrap_or_else(|| format!("{}: this device cannot establish a read needed to predict", program.name))));
    }
    // @ref LLP 3000.007#19.1 — a meter cut after paying an untaken presence arm is the prediction's, not the write's: the server may skip that arm and succeed, so the write queues without a row.
    let counterfactual = |error: RuntimeError, charged: bool| match error {
        RuntimeError::Bound { .. } if charged => RuntimeError::Prediction(format!("{error}; the prediction paid an untaken presence arm the server may skip; queued without a predicted row")),
        other => other,
    };
    let result = result.map_err(|error| counterfactual(error, runner.charged_untaken))?;
    let charged = runner.charged_untaken;
    runner.charge_output(&result).map_err(|error| counterfactual(error, charged))?;
    Ok(Prediction { new_ids: runner.context.minted_ids.clone(), result, written: runner.written_tables.iter().cloned().collect(), read: runner.read_tables.iter().cloned().collect() })
}

/// A native read over the device's rows (LLP 3000.005 §9): the app's module,
/// the same one the server runs, over what the device holds, with the
/// device's words — a page at the horizon or an online-only table is
/// `complete: false`; unknown coverage is what the host falls back on.
#[cfg(feature = "wasm-host")]
pub fn native_query(rows: &dyn Rows, schema: &Schema, module: &super::native::Module, program: &Program, mut context: Context, ceilings: Ceilings) -> (Result<QueryOutcome, Refusal>, bool, bool) {
    if let Err(error) = validate_inputs(schema, program, &mut context.args) {
        return (Err(error.refusal()), false, false);
    }
    let args = context.args.clone();
    let now = context.now.unwrap_or(0);
    let mut runner = Runner::new(rows, schema, context, Meter::new(ceilings, Cut::Cap), 0);
    runner.device = true;
    let (value, mut runner) = super::native::run_read(module, runner, &program.name, &args, now);
    let result = (|| {
        let data = match value {
            Ok(data) => data,
            Err(_) if runner.query_unavailable => Value::Null,
            Err(error) => return Err(error.refusal()),
        };
        runner.charge_output(&data)?;
        Ok(QueryOutcome {
            unavailable: runner.query_unavailable,
            complete: runner.meter.capped_at.is_none() && runner.word_cut_at.is_none() && !runner.non_uniform && !runner.page_position_lost() && !runner.timeline_pending && !runner.beyond_horizon,
            cut: runner.read_cut(),
            capped_at: runner.meter.capped_at.clone(),
            word_cut_at: runner.word_cut_at.clone(),
            next: None,
            data: if runner.query_unavailable { Value::Null } else { data },
            seq: 0,
            metered: runner.meter.used,
            tables: runner.read_tables.iter().cloned().collect(),
            next_expiry: runner.next_expiry,
        })
    })();
    (result, runner.missing_fact.is_some() || runner.presence_unknown, runner.only_retained_incomplete())
}


impl Runner<'_> {
    // @ref LLP 3000.016#2.2 — a missing Following card withholds the whole query, including its continuation.
    pub(super) fn withhold_unheld_card(&mut self, table: &str) {
        if self.schema.timelines.iter().any(|timeline| table == timeline.posts[0] || table == timeline.reposts[0]) {
            self.query_unavailable = true;
        }
    }

    // @ref LLP 3000.007.003#3.2 — device-only authority work may prevent
    // prediction, but cannot spend the server-equivalent mutation budget.
    pub(super) fn device_work<T>(&mut self, work: impl FnOnce(&mut Self) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        let Some(mut allowance) = self.device_allowance.take() else { return work(self) };
        std::mem::swap(&mut self.meter, &mut allowance);
        self.device_work_active = true;
        let result = self.meter.step(1).and_then(|_| work(self));
        self.device_work_active = false;
        std::mem::swap(&mut self.meter, &mut allowance);
        self.device_allowance = Some(allowance);
        result.map_err(|error| match error {
            RuntimeError::Bound { .. } => RuntimeError::Prediction("device authority allowance exhausted; queued without a predicted row".into()),
            other => other,
        })
    }

    // @ref LLP 3000.007#18.2 — retained history suppresses fallback only when no independent unknown or incomplete reason remains.
    fn only_retained_incomplete(&self) -> bool {
        self.missing_fact.is_none() && self.meter.capped_at.is_none() && self.word_cut_at.is_none() && !self.non_uniform && !self.page_overflow && !self.page_position_lost() && !self.timeline_pending && !self.presence_unknown
    }

    // @ref LLP 3000.007#6.2 — preserve the first undecidable site's evaluated key.
    pub(crate) fn unknown_fact(&mut self, table: &str, index: &str, key: &[Value], site: &str) {
        self.beyond_horizon = true;
        self.components.note(|frame| { frame.beyond = true; frame.unknown = true; });
        if self.missing_fact.is_none() {
            let key = crate::wire::to_json(&Value::Array(key.to_vec()));
            self.missing_fact = Some(format!("site {site}: this device cannot establish {table} by {index} at key {key}; the row or its absence is past the acquired horizon or online only"));
        }
    }
}
