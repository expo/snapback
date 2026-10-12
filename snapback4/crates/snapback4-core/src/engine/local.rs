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

// @ref LLP 3000.025#3-proposed-rule — a query entry must not execute a server-only mutation under Cut::Cap.
pub fn require_query(program: &Program) -> Result<(), RuntimeError> {
    if program.kind != crate::ir::ProgramKind::Query {
        return Err(RuntimeError::UnknownOp(format!("{} is not a query; use its mutation, job or action entry", program.name)));
    }
    Ok(())
}

/// A query over the device's rows.
pub fn query(rows: &dyn Rows, schema: &Schema, program: &Program, context: Context, ceilings: Ceilings) -> Result<QueryOutcome, Refusal> {
    query_with_coverage(rows, schema, program, context, ceilings).0
}

/// Unknown means the server can establish a missing fact or presence; preserve it, and whether incompleteness is exclusively retained history, even after a require/unwrap refusal.
pub fn query_with_coverage(rows: &dyn Rows, schema: &Schema, program: &Program, context: Context, ceilings: Ceilings) -> (Result<QueryOutcome, Refusal>, bool, bool) {
    let (result, unknown, retained, _, _) = observe_query(rows, schema, program, context, ceilings, false);
    (result, unknown, retained)
}

pub fn query_with_components(rows: &dyn Rows, schema: &Schema, program: &Program, context: Context, ceilings: Ceilings) -> (Result<QueryOutcome, Refusal>, bool, bool, std::collections::BTreeMap<String, super::components::Coverage>) {
    let (result, unknown, retained, components, _) = observe_query(rows, schema, program, context, ceilings, true);
    (result, unknown, retained, components)
}

pub fn observe_query(rows: &dyn Rows, schema: &Schema, program: &Program, mut context: Context, ceilings: Ceilings, components: bool) -> (Result<QueryOutcome, Refusal>, bool, bool, std::collections::BTreeMap<String, super::components::Coverage>, super::components::Provenance) {
    if let Err(error) = require_query(program) { return (Err(error.refusal()), false, false, Default::default(), Default::default()); }
    if let Err(error) = validate_inputs(schema, program, &mut context.args) { return (Err(error.refusal()), false, false, Default::default(), Default::default()); }
    context.row_provenance |= schema.tables.values().any(|t| t.leave == crate::schema::LeavePolicy::DeliveredHistory);
    let meter = if let Some(spent) = context.read_spent {
        match Meter::resume(ceilings, spent) {
            Ok(meter) => meter,
            Err(error) => return (Err(error.refusal()), false, false, Default::default(), Default::default()),
        }
    } else { Meter::new(ceilings, Cut::Cap) };
    let mut runner = Runner::new(rows, schema, context, meter, 0);
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
    // @ref LLP 3000.016#2.2 — withheld work keeps its execution charges, but discarded data is not published output.
    let data = if runner.query_unavailable { Value::Null } else { data };
    let capped = runner.meter.capped_at.is_some();
    let charged = runner.charge_output(&data);
    if !capped && runner.meter.capped_at.is_some() { runner.components.note(|frame| frame.capped = true); }
    charged?;
    let next = if runner.query_unavailable { None } else { runner.outcome_next_cursor()? };    Ok(QueryOutcome { decoration_expiry: runner.decoration_expiry, search_rows: runner.search_rows.take(), search_scopes: None,
            #[cfg(feature = "sqlite")] delivery: None,
            #[cfg(feature = "sqlite")] delivery_meter: None, ephemeral: None,
        unavailable: runner.query_unavailable,
        complete: runner.meter.capped_at.is_none() && runner.word_cut_at.is_none() && !runner.non_uniform && !runner.page_overflow && !runner.value_source_incomplete && !runner.page_position_lost() && !runner.timeline_pending && !runner.beyond_horizon && !runner.presence_unknown,
        cut: runner.read_cut(),
        capped_at: runner.meter.capped_at.clone(),
        word_cut_at: runner.word_cut_at.clone(),
        next,
        data,
        seq: 0,
        metered: runner.meter.used,
        tables: runner.read_tables.iter().cloned().collect(),
        next_expiry: runner.next_expiry.get(),
        // A device never knows presence, so it names nothing to follow.
    })
    })();
    let components = if result.as_ref().is_ok_and(|outcome| matches!(outcome.data, Value::Row(_))) { runner.component_coverage() } else { Default::default() };
    // @ref LLP 3000.007#20.22.1 — presence is server knowledge too; a resource or structural cut is not.
    (result, runner.missing_fact.is_some() || runner.presence_unknown, runner.only_retained_incomplete() && (!schema.operations.get(&program.name).is_some_and(|f| f.search_decoration) || runner.retained_seen), components, runner.components.provenance())}

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
    // @ref LLP 3000.022#14.3 — compiler facts are required for receipt prediction.
    // Missing classification (legacy/raw IR callers) conservatively keeps custody.
    if !schema.receipts.is_empty() && !schema.operations.get(&program.name).is_some_and(|fact| matches!(fact.predicts.as_deref(), Some("eligible" | "never"))) {
        return Err(RuntimeError::Prediction("receipt mutation has no compiler classification".into()));
    }
    if let Some(reason) = schema.prediction_reservation_refusal(program) {
        return Err(RuntimeError::Prediction(reason.into()));
    }
    // Runtime custody is independent of advisory prediction classification.
    if schema.receipts.iter().any(|f| program.name == f.delivered || program.name == f.seen || program.name == f.compact) {
        return Err(RuntimeError::Prediction("receipt reports need server settlement".into()));
    }
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
        if runner.receipt_allocation { runner.charge_output(&value)?; }
        Ok(value)
    });
    if matches!(result, Err(RuntimeError::AuthorizationBudget { .. })) {
        return Err(RuntimeError::Prediction("authorization work allowance exhausted; queued without a prediction".into()));
    }
    // @ref LLP 3000.015#2 — a provisional ordinal is not server evidence.
    // Any refusal after consuming one may change with the server's assignment,
    // including constraints, postconditions and a selected branch's refusal.
    // The host rolls back all predicted rows and retains the intent.
    // Receipt dependencies are classified before evaluation (LLP 3000.022 §14.3).
    if runner.receipt_allocation && result.is_err() {
        return Err(RuntimeError::Prediction("receipt allocation preceded a refusal; queue the write for server settlement (guide writes)".into()));
    }
    if runner.reservation_deferred && matches!(result, Err(RuntimeError::Bound { .. })) {
        return Err(RuntimeError::Prediction("deferred maintenance reservation exhausted; queue for server settlement".into()));
    }
    // @ref LLP 3000.007#20.5 — a refusal after an insert this device could not prove may not be
    // the server's (it can refuse that insert first): the write queues and the server's verdict stands.
    if runner.unproved_write && result.as_ref().is_err_and(|error| error.is_refusal() && !matches!(error, RuntimeError::Prediction(_))) {
        return Err(RuntimeError::Prediction("refusal after an unproved insert".into()));
    }
    if runner.provisional_sequence_read && result.is_err() {
        return Err(RuntimeError::Prediction("a refusal depends on a provisional sequence; queue the write for the server (guide writes)".into()));
    }
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
    if !runner.receipt_allocation {
        let charged = runner.charged_untaken;
        runner.charge_output(&result).map_err(|error| counterfactual(error, charged))?;
    }
    Ok(Prediction { new_ids: runner.context.minted_ids.clone(), result, written: runner.written_tables.iter().cloned().collect(), read: runner.read_tables.iter().cloned().collect() })
}

/// A native read over the device's rows (LLP 3000.005 §9): the app's module,
/// the same one the server runs, over what the device holds, with the
/// device's words — a page at the horizon or an online-only table is
/// `complete: false`; unknown coverage is what the host falls back on.
#[cfg(feature = "wasm-host")]
pub fn native_query(rows: &dyn Rows, schema: &Schema, module: &super::native::Module, program: &Program, context: Context, ceilings: Ceilings) -> (Result<QueryOutcome, Refusal>, bool, bool) {
    let (result, unknown, retained, _) = native_observation(rows, schema, module, program, context, ceilings);
    (result, unknown, retained)
}

#[cfg(feature = "wasm-host")]
pub fn native_observation(rows: &dyn Rows, schema: &Schema, module: &super::native::Module, program: &Program, mut context: Context, ceilings: Ceilings) -> (Result<QueryOutcome, Refusal>, bool, bool, super::components::Provenance) {
    if let Err(error) = require_query(program) { return (Err(error.refusal()), false, false, Default::default()); }
    if let Err(error) = validate_inputs(schema, program, &mut context.args) {
        return (Err(error.refusal()), false, false, Default::default());
    }
    let args = context.args.clone();
    let now = context.now.unwrap_or(0);
    context.row_provenance |= schema.tables.values().any(|t| t.leave == crate::schema::LeavePolicy::DeliveredHistory);
    let mut runner = Runner::new(rows, schema, context, Meter::new(ceilings, Cut::Cap), 0);
    runner.device = true;
    let (value, mut runner) = super::native::run_read(module, runner, &program.name, &args, now);
    let result = (|| {
        let data = match value {
            Ok(data) => data,
            Err(_) if runner.query_unavailable => Value::Null,
            Err(error) => return Err(error.refusal()),
        };
        let data = if runner.query_unavailable { Value::Null } else { data };
        runner.charge_output(&data)?;
        Ok(QueryOutcome { decoration_expiry: runner.decoration_expiry, search_rows: runner.search_rows.take(), search_scopes: None,
            #[cfg(feature = "sqlite")] delivery: None,
            #[cfg(feature = "sqlite")] delivery_meter: None, ephemeral: None,
            unavailable: runner.query_unavailable,
            complete: runner.meter.capped_at.is_none() && runner.word_cut_at.is_none() && !runner.non_uniform && !runner.page_position_lost() && !runner.timeline_pending && !runner.beyond_horizon,
            cut: runner.read_cut(),
            capped_at: runner.meter.capped_at.clone(),
            word_cut_at: runner.word_cut_at.clone(),
            next: None,
            data,
            seq: 0,
            metered: runner.meter.used,
            tables: runner.read_tables.iter().cloned().collect(),
            next_expiry: runner.next_expiry.get(),
        })
    })();
    (result, runner.missing_fact.is_some() || runner.presence_unknown, runner.only_retained_incomplete(), runner.components.provenance())
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
        let Some(allowance) = self.device_allowance.take() else { return work(self) };
        let (caller, entered) = self.enter_device_work(allowance);
        let result = entered.and_then(|_| work(self));
        self.leave_device_work(caller, result.as_ref().err())?;
        result
    }

    // Shared by every device_work instantiation (wasm size): swap in the
    // device allowance and charge its step; returns the caller's meter.
    #[inline(never)]
    fn enter_device_work(&mut self, mut meter: Meter) -> (Meter, Result<(), RuntimeError>) {
        std::mem::swap(&mut self.meter, &mut meter);
        self.device_work_active = true;
        let step = self.meter.step(1);
        (meter, step)
    }

    /// Restore the caller's meter; an exhausted allowance cannot refuse the write.
    #[inline(never)]
    fn leave_device_work(&mut self, mut caller: Meter, error: Option<&RuntimeError>) -> Result<(), RuntimeError> {
        self.device_work_active = false;
        std::mem::swap(&mut self.meter, &mut caller);
        self.device_allowance = Some(caller);
        match error {
            Some(RuntimeError::Bound { .. }) => Err(RuntimeError::Prediction("device authority allowance exhausted; queued without a predicted row".into())),
            _ => Ok(()),
        }
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

/// Internal coordinator projection over already selected device images. The
/// device delivery fence binds those images; ordinary point reads authorize
/// every decoration. No source rescan or extra read allowance is introduced.
pub fn decorate_search(rows: &dyn Rows, schema: &Schema, program: &Program, context: Context,
    values: Vec<Value>, spent: crate::meter::Metered) -> Result<(Value, crate::meter::Metered, Option<i64>), RuntimeError> {
    if !schema.operations.get(&program.name).is_some_and(|f| f.search_decoration) {
        return Err(RuntimeError::Input("query has no lifted search projection".into()));
    }
    let meter = Meter::resume(Ceilings::default(), spent)?;
    let mut runner = Runner::new(rows, schema, context, meter, 0);
    runner.device = true;
    let data = runner.decorate_search_values(program, values)?;
    runner.charge_output(&data)?;
    Ok((data, runner.meter.used, runner.decoration_expiry))
}
