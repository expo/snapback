//! Trusted fixture admission shares the ordinary validator and atomic writer.
use super::*;

impl Runtime {
    /// Admit an operator-supplied seed under explicit administrative budgets.
    /// This does not change certification or execution limits for public operations.
    // @ref LLP 2000#13-first-implementation-choices — fixture import has a separate bounded operator budget.
    pub fn seed_with_ceilings(
        &mut self,
        rows: &[(String, Value)],
        ceilings: Ceilings,
    ) -> Result<u64, RuntimeError> {
        let (program, certificate) =
            seed_program_with_ceilings(&self.generation.schema, rows, ceilings)?;
        self.engine
            .execute_seed(&program, &certificate, unix_millis())
            .map(|execution| execution.seq)
    }
}

pub(super) fn seed_program(
    schema: &Schema,
    rows: &[(String, Value)],
) -> Result<(Program, Certificate), RuntimeError> {
    let ceilings = Ceilings {
        write_rows: u64::MAX,
        // @ref LLP 1017#24-metering — seeds reserve cap work but waive these ceilings.
        examined: u64::MAX,
        index_entries: u64::MAX,
        steps: u64::MAX,
        ..Ceilings::default()
    };
    seed_program_with_ceilings(schema, rows, ceilings)
}

fn seed_program_with_ceilings(
    schema: &Schema,
    rows: &[(String, Value)],
    ceilings: Ceilings,
) -> Result<(Program, Certificate), RuntimeError> {
    for (table_name, row) in rows {
        crate::assets::refuse_seed_assets(schema, table_name, row)?;
    }
    let program = Program {
        name: "seed".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: rows
            .iter()
            .map(|(table, row)| {
                let id = row
                    .field("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)?;
                Ok(Stmt::Upsert {
                    table: table.clone(),
                    key: Expr::Literal(Value::Id(id)),
                    row: Expr::Literal(row.clone()),
                })
            })
            .chain(std::iter::once(Ok(Stmt::Return(Expr::Literal(
                Value::Null,
            )))))
            .collect::<Result<Vec<_>, RuntimeError>>()?,
    };
    let certificate = Checker::new(schema, ceilings)
        .check(&program)
        .map_err(|error| {
            // Seed E_ARGS_* refusals describe invalid supplied row values, not schema structure.
            if error.code.starts_with("E_ARGS_") {
                RuntimeError::Input(error.to_string())
            } else {
                RuntimeError::Schema(error.to_string())
            }
        })?;
    Ok((program, certificate))
}
