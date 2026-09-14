//! The interpreter on a device (LLP 2000.000 §7.2, §9): the same programs
//! the server runs, over the rows the device holds — its partition — with
//! the device's three words: a synced table's rows are readable as held, an
//! online-only table's are not here, and a page at the horizon may continue
//! on the server; each of the last two is `complete: false`. A mutation
//! predicts: its rows are written to the device's store for the host to
//! mark pending, and the server judges the write when it arrives.

use super::runner::Runner;
use super::validate::validate_inputs;
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

/// Preserve coverage even when a require/unwrap refused after a missing row.
pub fn query_with_coverage(rows: &dyn Rows, schema: &Schema, program: &Program, mut context: Context, ceilings: Ceilings) -> (Result<QueryOutcome, Refusal>, bool) {
    if let Err(error) = validate_inputs(schema, program, &mut context.args) { return (Err(error.refusal()), false); }
    let mut runner = Runner::new(rows, schema, context, Meter::new(ceilings, Cut::Cap), 0);
    runner.device = true;
    let result = (|| {
    let data = runner.run(program)?;
    runner.charge_output(&data)?;
    let next = runner.next_cursor()?;
    Ok(QueryOutcome {
        complete: runner.meter.capped_at.is_none() && !runner.non_uniform && !runner.page_overflow && !runner.beyond_horizon && !runner.presence_unknown,
        capped_at: runner.meter.capped_at.clone(),
        next,
        data,
        seq: 0,
        metered: runner.meter.used,
        tables: runner.read_tables.iter().cloned().collect(),
        next_expiry: runner.next_expiry,
    })
    })();
    (result, runner.beyond_horizon)
}

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
    validate_inputs(schema, program, &mut context.args)?;
    if let Some(fact) = schema.operations.get(&program.name) && fact.predicts.as_deref() == Some("never") {
        let reason = fact.sites.iter().find(|site| site.class == crate::schema::SiteClass::Server).map(|site| format!("site {}: {}", site.site, site.reason)).unwrap_or_else(|| program.name.clone());
        return Err(RuntimeError::Prediction(format!("{reason}; queued without a predicted row")));
    }
    let mut runner = Runner::new(rows, schema, context, Meter::new(ceilings, Cut::Abort), 0);
    runner.device = true;
    let result = runner.run(program).and_then(|value| { runner.check_final_exists()?; Ok(value) });
    if runner.beyond_horizon {
        return Err(RuntimeError::Prediction(runner.missing_fact.clone().unwrap_or_else(|| format!("{}: this device cannot establish a read needed to predict", program.name))));
    }
    let result = result?;
    runner.charge_output(&result)?;
    Ok(Prediction { new_ids: runner.context.minted_ids.clone(), result, written: runner.written_tables.iter().cloned().collect(), read: runner.read_tables.iter().cloned().collect() })
}

/// A native read over the device's rows (LLP 3000.005 §9): the app's module,
/// the same one the server runs, over what the device holds, with the
/// device's words — a page at the horizon or an online-only table is
/// `complete: false`, and the second is the coverage the host falls back on.
#[cfg(feature = "wasm-host")]
pub fn native_query(rows: &dyn Rows, schema: &Schema, module: &super::native::Module, program: &Program, mut context: Context, ceilings: Ceilings) -> (Result<QueryOutcome, Refusal>, bool) {
    if let Err(error) = validate_inputs(schema, program, &mut context.args) {
        return (Err(error.refusal()), false);
    }
    let args = context.args.clone();
    let now = context.now.unwrap_or(0);
    let mut runner = Runner::new(rows, schema, context, Meter::new(ceilings, Cut::Cap), 0);
    runner.device = true;
    let (value, mut runner) = super::native::run_read(module, runner, &program.name, &args, now);
    let result = (|| {
        let data = value?;
        runner.charge_output(&data)?;
        Ok(QueryOutcome {
            complete: runner.meter.capped_at.is_none() && !runner.non_uniform && !runner.beyond_horizon,
            capped_at: runner.meter.capped_at.clone(),
            next: None,
            data,
            seq: 0,
            metered: runner.meter.used,
            tables: runner.read_tables.iter().cloned().collect(),
            next_expiry: runner.next_expiry,
        })
    })();
    (result, runner.beyond_horizon)
}


impl Runner<'_> {
    // @ref LLP 3000.007#6-2 — preserve the first undecidable site's evaluated key.
    pub(crate) fn unknown_fact(&mut self, table: &str, index: &str, key: &[Value], site: &str) {
        self.beyond_horizon = true;
        if self.missing_fact.is_none() {
            let key = crate::wire::to_json(&Value::Array(key.to_vec()));
            self.missing_fact = Some(format!("site {site}: this device cannot establish {table} by {index} at key {key}; the row or its absence is past the acquired horizon or online only"));
        }
    }
}
