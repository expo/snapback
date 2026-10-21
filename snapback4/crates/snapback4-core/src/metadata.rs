//! Typed metadata families. Values stay textual so each caller retains its
//! existing missing/malformed-value policy.
// @ref LLP 3000.009.001.000#3.1 — adapters own keys; callers interpret facts.
use crate::RuntimeError;

#[derive(Clone, Copy)]
pub enum SchemaMarker {
    SchemaHash,
    LiveSumCandidates,
    MaintainedIds,
    CapCounts,
    TimePublications,
    ReadThroughShortened,
}

#[derive(Clone, Copy)]
pub(crate) enum RestoredPopulation {
    Rows,
    Column,
    Table,
}

/// Read access shared by store and transaction snapshots.
// P1: implement these metadata families for Postgres.
pub(crate) trait MetadataReader {
    fn store_identity(&self) -> Result<Option<String>, RuntimeError>;
    fn generation_value(&self) -> Result<Option<String>, RuntimeError>;
    fn release_value(&self) -> Result<Option<String>, RuntimeError>;
    fn release_native_digest(&self) -> Result<Option<String>, RuntimeError>;
    fn time_audience_clock_value(&self) -> Result<Option<String>, RuntimeError>;
    fn worker_status(&self, worker: Option<&str>) -> Result<Option<String>, RuntimeError>;
    fn release_revision_value(&self) -> Result<Option<String>, RuntimeError>;
    fn schema_marker(&self, marker: SchemaMarker) -> Result<Option<String>, RuntimeError>;
    fn worker_session_family(&self) -> Result<Option<String>, RuntimeError>;
    fn worker_session_revision(&self) -> Result<Option<String>, RuntimeError>;
    fn worker_family_revision(&self, family: &str) -> Result<Option<String>, RuntimeError>;
    fn deployment_environment(&self) -> Result<Option<String>, RuntimeError>;
    fn dev_value(&self, key: DevMetadata) -> Result<Option<String>, RuntimeError>;
}

#[derive(Clone, Copy)]
pub enum DevMetadata {
    Replay,
    SuppressedEffects,
    HoldSchedules,
}

// P1: implement metadata writes for Postgres.
pub(crate) trait MetadataWriter {
    fn set_dev_value(&self, key: DevMetadata, value: &str) -> Result<(), RuntimeError>;
    fn set_deployment_environment(&self, value: &str) -> Result<(), RuntimeError>;
    fn set_worker_status(&self, worker: Option<&str>, value: &str) -> Result<(), RuntimeError>;
}

#[cfg(test)]
pub(crate) mod test_cases {
    use super::*;

    pub fn raw_values_and_worker_fences(reader: &impl MetadataReader) {
        // The caller decides how to interpret malformed and missing values.
        assert_eq!(
            reader.generation_value().unwrap().as_deref(),
            Some("invalid")
        );
        assert_eq!(reader.release_value().unwrap(), None);
        assert_eq!(
            reader.worker_family_revision("named").unwrap().as_deref(),
            Some("2")
        );
        assert!(!crate::identity::supervisor_current(reader, "legacy", 2).unwrap());
        assert!(!crate::identity::supervisor_current(reader, "named", 1).unwrap());
        assert!(crate::identity::supervisor_current(reader, "named", 2).unwrap());
        assert!(crate::identity::supervisor_current(reader, "manual", 99).unwrap());
    }

    pub fn independent_families(handle: &(impl MetadataReader + MetadataWriter)) {
        handle.set_dev_value(DevMetadata::Replay, "true").unwrap();
        handle
            .set_dev_value(DevMetadata::HoldSchedules, "false")
            .unwrap();
        handle.set_deployment_environment("staging").unwrap();
        handle.set_worker_status(None, "legacy").unwrap();
        handle.set_worker_status(Some("named"), "ready").unwrap();
        assert_eq!(
            handle.dev_value(DevMetadata::Replay).unwrap().as_deref(),
            Some("true")
        );
        assert_eq!(
            handle
                .dev_value(DevMetadata::HoldSchedules)
                .unwrap()
                .as_deref(),
            Some("false")
        );
        assert_eq!(
            handle.deployment_environment().unwrap().as_deref(),
            Some("staging")
        );
        assert_eq!(
            handle.worker_status(None).unwrap().as_deref(),
            Some("legacy")
        );
        assert_eq!(
            handle.worker_status(Some("named")).unwrap().as_deref(),
            Some("ready")
        );
        assert_eq!(handle.worker_status(Some("absent")).unwrap(), None);
    }
}
