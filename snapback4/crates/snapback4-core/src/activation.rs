//! Storage facts used by opening and activation policy.
// @ref LLP 3000.009.001.000#3.1 — selection and retirement policy remain in the engine.
use crate::{
    RuntimeError, Value, metadata::RestoredPopulation, release_history::DormantItem,
};

/// Exact stored backend captured before an opening repair releases its snapshot.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Backend(pub i64, pub String, pub String);

// Implementations capture facts in the caller's activation snapshot.
pub(crate) trait ActivationReader {
    fn opening_backend(&self) -> Result<Backend, RuntimeError>;
    fn check_selected_release(&self, expected: Option<u64>) -> Result<(), RuntimeError>;
    fn time_audience_clock(&self) -> Result<i64, RuntimeError>;
    fn opening_marker(&self, marker: crate::metadata::SchemaMarker) -> Result<Option<String>, RuntimeError>;
    fn previous_schema(&self) -> Result<Option<String>, RuntimeError>;
    fn live_sum_marker(&self) -> Result<Option<String>, RuntimeError>;
    fn activation_population(&self) -> Result<Option<String>, RuntimeError>;
    fn narrowed_retained(&self) -> Result<Option<String>, RuntimeError>;
    fn narrowed_restored(&self) -> Result<Option<String>, RuntimeError>;
    fn restored_population(
        &self,
        kind: RestoredPopulation,
        path: &str,
    ) -> Result<Option<String>, RuntimeError>;
    fn activation_inventory(&self) -> Result<Vec<DormantItem>, RuntimeError>;
    fn table_populated(&self, table: &str) -> Result<bool, RuntimeError>;
    /// Stop at the first surviving image, preserving streaming and decode order.
    fn any_table_image(
        &self,
        table: &str,
        survives: impl FnMut(&Value) -> bool,
    ) -> Result<bool, RuntimeError>;
    fn timeline_rebuild_exists(&self, table: &str, id: &str) -> Result<bool, RuntimeError>;
}

// Writes share the adapter's serialized activation transaction.
pub(crate) trait ActivationTransaction: ActivationReader {
    fn set_active_release(&self, release: u64) -> Result<(), RuntimeError>;
    fn mark_live_sum_candidates(&self) -> Result<(), RuntimeError>;
    fn mark_maintained_ids(&self) -> Result<(), RuntimeError>;
    fn set_audience_epoch(&self, table: &str, epoch: u64, now: i64) -> Result<(), RuntimeError>;
    fn clear_activation_metadata(&self) -> Result<(), RuntimeError>;
    fn clear_retired_table(&self, table: &str) -> Result<(), RuntimeError>;
    fn clear_retired_index(&self, table: &str, index: &str) -> Result<(), RuntimeError>;
}

// Preparation runs under the same fence as backend installation.
pub(crate) trait ActivationPreparation: crate::engine::release::ReleaseTransaction {
    fn check_selected_release(&self, expected: Option<u64>) -> Result<(), RuntimeError>;
    fn check_backend(&self, backend: &Backend) -> Result<(), RuntimeError>;
    fn activation_inventory(&self) -> Result<Vec<DormantItem>, RuntimeError>;
    fn enable_dormant(&self) -> Result<(), RuntimeError>;
    fn prepare_release_metadata(
        &self,
        native_digest: &str,
        restore: bool,
        visibility:Option<&crate::engine::release::VisibilityPolicy>,
    ) -> Result<(), RuntimeError>;
}

// Operator counts never require a write transaction.
pub(crate) trait TimelineWorkReader {
    fn timeline_work_count(&self, table: &str, state: &str) -> Result<u64, RuntimeError>;
}

#[cfg(test)]
pub(crate) mod test_cases {
    use super::*;

    /// A surviving first image must avoid decoding later corrupt images. Once
    /// retirement excludes it, the same corruption must be reported.
    pub fn streaming_retirement(tx: &impl ActivationReader) {
        let mut visited = 0;
        assert!(
            tx.any_table_image("items", |_| {
                visited += 1;
                true
            })
            .unwrap()
        );
        assert_eq!(visited, 1);
        assert!(tx.any_table_image("items", |_| false).is_err());
        assert!(
            !tx.any_table_image("absent", |_| panic!("no absent images"))
                .unwrap()
        );
    }

    pub fn retired_names(tx: &impl ActivationTransaction) {
        assert!(tx.table_populated("items").unwrap());
        assert!(tx.timeline_rebuild_exists("items", "a").unwrap());
        tx.clear_retired_table("absent").unwrap();
        assert!(tx.table_populated("items").unwrap());
        tx.clear_retired_table("items").unwrap();
        assert!(!tx.table_populated("items").unwrap());
        assert!(!tx.timeline_rebuild_exists("items", "a").unwrap());
    }
}

/// The exact opening capture is checked again after a writer-lock wait.
pub(crate) fn check_backend(actual: &Backend, expected: &Backend) -> Result<(), RuntimeError> {
    if actual != expected {
        return Err(RuntimeError::Generation("the stored backend changed while opening; retry open".into()));
    }
    Ok(())
}

pub(crate) fn check_selected(actual: Option<&str>, expected: Option<u64>) -> Result<(), RuntimeError> {
    if let Some(expected) = expected {
        if actual.and_then(|s| s.parse::<u64>().ok()) != Some(expected) {
            return Err(RuntimeError::Generation("the current release changed while starting; retry serve".into()));
        }
    }
    Ok(())
}

pub(crate) fn activation_hash(schema: &crate::Schema, programs: &std::collections::BTreeMap<String, crate::Program>, native: Option<&str>) -> String {
    match native {
        Some(native) => crate::value::digest(&(schema, programs, native)),
        None => crate::value::digest(&(schema, programs)),
    }
}

pub(crate) fn next_generation(previous: u64, changed: bool) -> Result<u64, RuntimeError> {
    if changed {
        previous.checked_add(1).filter(|n| *n <= i64::MAX as u64)
            .ok_or_else(|| RuntimeError::Generation("generation overflow".into()))
    } else { Ok(previous.max(1)) }
}


// @ref LLP 3000.009.001.000#9.1 — an identity must refuse exhaustion rather than reuse a saturated key.
pub(crate) fn next_catalog_number(previous: i64) -> Result<i64, RuntimeError> {
    previous.checked_add(1).ok_or_else(|| RuntimeError::Generation("catalog number exhausted".into()))
}

/// Parse before binding so malformed metadata cannot abort a Postgres transaction.
pub(crate) fn stored_generation(value: Option<&str>) -> Result<Option<i64>, RuntimeError> {
    value.map(|value| value.parse::<i64>().ok().filter(|n| *n > 0).ok_or_else(||
        RuntimeError::Structural { code: "E_STORE_GENERATION", message: "invalid stored generation metadata".into() }
    )).transpose()
}
