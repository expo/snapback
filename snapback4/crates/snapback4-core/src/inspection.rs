//! Plain inspection records and catalog access shared by inspection policy.
// @ref LLP 3000.009.001.000#32-the-rule — only adapters touch inspection connections.
pub type InspectionResult<T> = Result<T, (&'static str, String)>;
pub const PRIVATE: &str = "_snapback_sql_";
pub const CATALOG_HINT: &str = "`\\dt` lists tables; `\\d messages` describes one";

// P1: implement catalog inspection for the Postgres read-only role.
pub trait InspectionCatalog {
    fn active_schema_record(&self) -> InspectionResult<(i64, String)>;
    fn inspection_row_count(&self, name: &str, limit: u64) -> InspectionResult<u64>;
    fn inspection_provenance(&self) -> InspectionResult<Option<(i64, String)>>;
    fn inspection_adopted(&self) -> InspectionResult<bool>;
}

#[derive(Clone, Copy)]
pub enum WorkRecordKind {
    Action,
    Mutation,
    Effect,
    ActionStep,
}
pub struct HandlerFailure {
    pub kind: &'static str,
    pub id: String,
    pub name: String,
    pub state: String,
    pub attempts: i64,
    pub error: String,
}
pub struct CommitClockRecord {
    pub at: i64,
    pub touched: Option<Vec<u8>>,
    pub length: Option<i64>,
}

/// Shared visibility policy for generated inspection views and catalog output.
pub fn internal(name: &str) -> bool {
    name.starts_with('_')
        || matches!(name.to_ascii_lowercase().as_str(), "r" | "i")
        || name.to_ascii_lowercase().starts_with("sqlite_")
}

/// Interpret an unclassified query failure above the physical adapter.
pub fn query_error(schema: &crate::schema::Schema, message: String) -> (&'static str, String) {
    // SQLite identifiers are case-insensitive, including diagnostic spellings.
    let folded = message.to_ascii_lowercase();
    if let Some(m) = schema
        .maintains
        .iter()
        .find(|m| m.private.is_some() && folded.contains(&m.target.to_ascii_lowercase()))
    {
        (
            "E_MAINTAINED_COLUMN_PRIVATE",
            format!(
                "{} is engine-maintained; read its parent column (guide maintains)",
                m.label()
            ),
        )
    } else {
        ("E_INPUT", format!("SQL: {message}"))
    }
}

/// Object rows must retain every output column at both preparation points.
pub fn check_output_names(columns: &[String], object_rows: bool) -> InspectionResult<()> {
    if object_rows {
        let mut names = std::collections::BTreeSet::new();
        if columns
            .iter()
            .any(|name| !names.insert(name.to_ascii_lowercase()))
        {
            return Err((
                "E_INPUT",
                "--json-objects needs unique output names; alias duplicate columns".into(),
            ));
        }
    }
    Ok(())
}
