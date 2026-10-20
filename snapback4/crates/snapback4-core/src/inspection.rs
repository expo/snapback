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
