//! Reviewed recovery actions and decision boundaries for every default `why` excerpt.
//! These facts supplement the definition pins. A code label alone cannot tell
//! a caller whether to retry, replace intent, change a declaration, or show no data.
pub(super) const ACTIONS: &[(&str, &[&str])] = &[
    ("E_DELIVERY_BINDING", &["drops that binding's debt", "does not retry the old report"]),
    ("E_DELIVERY_CLAUSE", &["immutable group and position columns, their unique key", "one reporter per tracked table", "Never reuse a deleted position"]),
    ("RUNS_FULL", &["merged runs free their slots before the count", "Replaying its write id returns that success"]),
