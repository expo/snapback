//! SQLite metadata key ownership; generic access stays public for host migration.
use super::*;
use crate::metadata::{DevMetadata, MetadataReader, MetadataWriter, SchemaMarker};

fn dev_key(key: DevMetadata) -> &'static str {
    match key {
        DevMetadata::Replay => "dev:replay",
        DevMetadata::SuppressedEffects => "dev:suppressed-effects",
        DevMetadata::HoldSchedules => "dev:hold-schedules",
    }
}

fn worker_status_key(worker: Option<&str>) -> String {
    worker.map_or_else(
        || "worker:status".into(),
        |name| format!("worker:status:{name}"),
    )
}

fn schema_key(marker: SchemaMarker) -> &'static str {
    match marker {
        SchemaMarker::LiveSumCandidates => "live_sum_candidates",
        SchemaMarker::MaintainedIds => crate::schema::MAINTAINED_ID_META,
        SchemaMarker::CapCounts => "cap_counts_schema",
        SchemaMarker::TimePublications => super::time_audience::PUBLICATION_STATE_KEY,
        SchemaMarker::ReadThroughShortened => "read_through_shortened",
    }
}

// Public store/transaction methods let the host migrate independently, while
// the access traits used by shared policy remain crate-private.
macro_rules! metadata_reader {
    ($handle:ty; $($name:ident($($arg:ident: $kind:ty),*) => $key:expr;)*) => {
        impl MetadataReader for $handle {
            $(fn $name(&self, $($arg: $kind),*) -> Result<Option<String>, RuntimeError> {
                self.meta(&$key)
            })*
        }
        impl $handle {
            $(pub fn $name(&self, $($arg: $kind),*) -> Result<Option<String>, RuntimeError> {
                <Self as MetadataReader>::$name(self, $($arg),*)
            })*
        }
    };
}
macro_rules! metadata_readers {
    ($($methods:tt)*) => {
        metadata_reader!(Store; $($methods)*);
        metadata_reader!(Tx<'_>; $($methods)*);
    };
}
metadata_readers! {
    store_identity() => "store_id";
    generation_value() => "generation";
    release_value() => "release";
    release_revision_value() => "release_revision";
    release_native_digest() => "release_native_digest";
    time_audience_clock_value() => super::time_audience::CLOCK_KEY;
    schema_marker(marker: SchemaMarker) => schema_key(marker);
    worker_session_family() => "worker:session-family";
    worker_session_revision() => "worker:session-revision";
    worker_family_revision(family: &str) => format!("worker:family:{family}");
    worker_status(worker: Option<&str>) => worker_status_key(worker);
    deployment_environment() => "deployment_environment";
    dev_value(key: DevMetadata) => dev_key(key);
}

macro_rules! metadata_writer {
    ($handle:ty; $($name:ident($($arg:ident: $kind:ty),*) => $key:expr;)*) => {
        impl MetadataWriter for $handle {
            $(fn $name(&self, $($arg: $kind,)* value: &str) -> Result<(), RuntimeError> {
                self.set_meta(&$key, value)
            })*
        }
        impl $handle {
            $(pub fn $name(&self, $($arg: $kind,)* value: &str) -> Result<(), RuntimeError> {
                <Self as MetadataWriter>::$name(self, $($arg,)* value)
            })*
        }
    };
}
macro_rules! metadata_writers {
    ($($methods:tt)*) => {
        metadata_writer!(Store; $($methods)*);
        metadata_writer!(Tx<'_>; $($methods)*);
    };
}
metadata_writers! {
    set_dev_value(key: DevMetadata) => dev_key(key);
    set_deployment_environment() => "deployment_environment";
    set_worker_status(worker: Option<&str>) => worker_status_key(worker);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_cases_on_store_and_transaction() {
        let mut store = Store::memory().unwrap();
        for (key, value) in [
            ("generation", "invalid"),
            ("worker:session-family", "legacy"),
            ("worker:session-revision", "invalid"),
            ("worker:family:named", "2"),
        ] {
            store.set_meta(key, value).unwrap();
        }
        // The fixture deliberately installs a malformed generation; capture it
        // as this owner's identity before opening its transaction snapshot.
        store.identity = crate::store::activation::identity(store.conn()).unwrap();
        crate::metadata::test_cases::raw_values_and_worker_fences(&store);
        crate::metadata::test_cases::independent_families(&store);
        let tx = store.transaction().unwrap();
        crate::metadata::test_cases::raw_values_and_worker_fences(&tx);
        crate::metadata::test_cases::independent_families(&tx);
        tx.set_dev_value(DevMetadata::Replay, "rolled back")
            .unwrap();
        tx.rollback().unwrap();
        assert_eq!(
            store.dev_value(DevMetadata::Replay).unwrap().as_deref(),
            Some("true")
        );
    }
}
