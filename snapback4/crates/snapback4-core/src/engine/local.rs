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
    let mut runner = Runner::new(rows, schema, context, Meter::new(ceilings, Cut::Abort), 0);
    runner.device = true;
    let result = runner.run(program).and_then(|value| { runner.check_final_exists()?; Ok(value) });
    if runner.beyond_horizon {
        return Err(RuntimeError::Prediction("this device does not hold enough rows to judge the mutation".into()));
    }
    let result = result?;
    runner.charge_output(&result)?;
    Ok(Prediction { new_ids: runner.context.minted_ids.clone(), result, written: runner.written_tables.iter().cloned().collect(), read: runner.read_tables.iter().cloned().collect() })
}
