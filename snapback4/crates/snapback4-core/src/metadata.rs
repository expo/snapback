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

pub(crate) trait MetadataWriter {
    fn set_dev_value(&self, key: DevMetadata, value: &str) -> Result<(), RuntimeError>;
    fn set_deployment_environment(&self, value: &str) -> Result<(), RuntimeError>;
    fn set_worker_status(&self, worker: Option<&str>, value: &str) -> Result<(), RuntimeError>;
}

pub(crate) fn dev_key(key: DevMetadata) -> &'static str {
    match key {
        DevMetadata::Replay => "dev:replay",
        DevMetadata::SuppressedEffects => "dev:suppressed-effects",
        DevMetadata::HoldSchedules => "dev:hold-schedules",
    }
}

pub(crate) fn worker_status_key(worker: Option<&str>) -> String {
    worker.map_or_else(
        || "worker:status".into(),
        |name| format!("worker:status:{name}"),
    )
}

pub(crate) fn schema_key(marker: SchemaMarker) -> &'static str {
    match marker {
        SchemaMarker::SchemaHash => "schema_hash",
        SchemaMarker::LiveSumCandidates => "live_sum_candidates",
        SchemaMarker::MaintainedIds => crate::schema::MAINTAINED_ID_META,
        SchemaMarker::CapCounts => "cap_counts_schema",
        SchemaMarker::TimePublications => crate::store::time_audience::PUBLICATION_STATE_KEY,
        SchemaMarker::ReadThroughShortened => "read_through_shortened",
    }
}

// @ref LLP 3000.009.001.000#9.1 — validate admission, never stored values or legacy keys.
pub(crate) fn validate_value(value: &str) -> Result<(), RuntimeError> {
    if value.contains('\0') {
        return Err(RuntimeError::Input(
            "metadata text cannot contain U+0000".into(),
        ));
    }
    Ok(())
}
pub(crate) fn validate_new_key(key: &str) -> Result<(), RuntimeError> {
    if key.contains('\0') {
        return Err(RuntimeError::Input(
            "new metadata keys cannot contain U+0000".into(),
        ));
    }
    Ok(())
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

    pub fn missing(reader: &impl MetadataReader) {
        assert_eq!(reader.store_identity().unwrap(), None);
        assert_eq!(reader.generation_value().unwrap(), None);
        assert_eq!(reader.release_value().unwrap(), None);
        assert_eq!(reader.release_revision_value().unwrap(), None);
        assert_eq!(reader.release_native_digest().unwrap(), None);
        assert_eq!(reader.time_audience_clock_value().unwrap(), None);
        assert_eq!(reader.worker_session_family().unwrap(), None);
        assert_eq!(reader.worker_session_revision().unwrap(), None);
        assert_eq!(reader.worker_family_revision("absent").unwrap(), None);
        assert_eq!(reader.worker_status(Some("absent")).unwrap(), None);
        assert_eq!(reader.worker_status(None).unwrap(), None);
        assert_eq!(reader.deployment_environment().unwrap(), None);
        for key in [
            DevMetadata::Replay,
            DevMetadata::SuppressedEffects,
            DevMetadata::HoldSchedules,
        ] {
            assert_eq!(reader.dev_value(key).unwrap(), None);
        }
        for marker in [
            SchemaMarker::LiveSumCandidates,
            SchemaMarker::MaintainedIds,
            SchemaMarker::CapCounts,
            SchemaMarker::TimePublications,
            SchemaMarker::ReadThroughShortened,
        ] {
            assert_eq!(reader.schema_marker(marker).unwrap(), None);
        }
    }

    pub fn admission(handle: &(impl MetadataReader + MetadataWriter)) {
        for value in [
            "",
            "malformed",
            "-9223372036854775808",
            "9223372036854775807",
            "é日本語",
        ] {
            handle
                .set_dev_value(DevMetadata::SuppressedEffects, value)
                .unwrap();
            assert_eq!(
                handle
                    .dev_value(DevMetadata::SuppressedEffects)
                    .unwrap()
                    .as_deref(),
                Some(value)
            );
        }
        assert_eq!(
            handle
                .set_deployment_environment("bad\0value")
                .unwrap_err()
                .code(),
            "E_INPUT"
        );
        assert_eq!(
            handle
                .set_dev_value(DevMetadata::Replay, "bad\0value")
                .unwrap_err()
                .code(),
            "E_INPUT"
        );
        assert_eq!(
            handle
                .set_worker_status(Some("new\0key"), "ready")
                .unwrap_err()
                .code(),
            "E_INPUT"
        );
        assert_eq!(
            handle
                .set_worker_status(None, "bad\0value")
                .unwrap_err()
                .code(),
            "E_INPUT"
        );
        assert_eq!(handle.worker_status(Some("new\0key")).unwrap(), None);
    }

    pub fn advance(
        handle: &(impl MetadataReader + MetadataWriter),
        expected: Option<&str>,
        next: &str,
    ) {
        assert_eq!(
            handle.worker_status(Some("race")).unwrap().as_deref(),
            expected
        );
        handle.set_worker_status(Some("race"), next).unwrap();
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
