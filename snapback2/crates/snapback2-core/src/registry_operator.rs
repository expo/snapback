use super::*;

/// Control-plane ledger attribution, a validated operator name today and a token id later.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OperatorId(pub String);

impl Runtime {
    /// Execute a declared program as the store owner; caller authenticates the control seat.
    // @ref LLP 1016#d6--the-operator-seat-ad-hoc-programs-and-rehearsal — public Context cannot represent system authority.
    pub fn execute_operator(
        &mut self,
        op: &str,
        args: BTreeMap<String, Value>,
        by: OperatorId,
    ) -> Result<Execution, RuntimeError> {
        self.execute_operator_at(op, args, by, unix_millis())
    }

    /// The serving owner supplies its pinned development clock.
    pub fn execute_operator_at(
        &mut self,
        op: &str,
        args: BTreeMap<String, Value>,
        by: OperatorId,
        now: i64,
    ) -> Result<Execution, RuntimeError> {
        let (program, certificate) = self
            .generation
            .programs
            .get(op)
            .cloned()
            .ok_or_else(|| RuntimeError::OpUnknown(op.to_owned()))?;
        self.run_operator(&program, &certificate, args, by, now)
    }

    /// A bounded, query-only adapter for the owner's `data` verb.
    pub fn read_operator(
        &mut self,
        program: &Program,
        args: BTreeMap<String, Value>,
        by: OperatorId,
        now: i64,
    ) -> Result<Execution, RuntimeError> {
        if program.kind != ProgramKind::Query {
            return Err(RuntimeError::Input(
                "operator data adapter requires a query".to_owned(),
            ));
        }
        let certificate = Checker::new(&self.generation.schema, Ceilings::default())
            .check(program)
            .map_err(|error| RuntimeError::Schema(error.to_string()))?;
        self.run_operator(program, &certificate, args, by, now)
    }

    fn run_operator(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        args: BTreeMap<String, Value>,
        by: OperatorId,
        now: i64,
    ) -> Result<Execution, RuntimeError> {
        self.executions = self.executions.saturating_add(1);
        let ids = if program.kind == ProgramKind::Mutation {
            self.reserve_new_ids()?
        } else {
            VecDeque::new()
        };
        self.engine
            .execute_operator(program, certificate, args, by.0, now, ids)
    }
}
