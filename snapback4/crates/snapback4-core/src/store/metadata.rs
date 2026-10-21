//! SQLite metadata key ownership for the typed server families.
use super::*;
use crate::metadata::{
    DevMetadata, MetadataReader, MetadataWriter, SchemaMarker, dev_key, schema_key,
    validate_new_key, validate_value, worker_status_key,
};

// Public typed methods serve host callers; the access traits used by shared
// policy remain crate-private. Generic metadata access is adapter-internal.
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
                let key = $key;
                validate_value(value)?;
                if key.contains('\0') && self.meta(&key)?.is_none() { validate_new_key(&key)?; }
                self.set_meta(&key, value)
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
        crate::metadata::test_cases::admission(&store);
        let tx = store.transaction().unwrap();
        crate::metadata::test_cases::raw_values_and_worker_fences(&tx);
        crate::metadata::test_cases::independent_families(&tx);
        crate::metadata::test_cases::admission(&tx);
        tx.set_dev_value(DevMetadata::Replay, "rolled back")
            .unwrap();
        tx.rollback().unwrap();
        assert_eq!(
            store.dev_value(DevMetadata::Replay).unwrap().as_deref(),
            Some("true")
        );
    }
    #[test]
    fn metadata_missing_and_legacy_nul_values() {
        let store = Store::memory().unwrap();
        store.conn().execute("DELETE FROM _meta", []).unwrap();
        crate::metadata::test_cases::missing(&store);
        store
            .set_meta("worker:status:old\0key", "old\0value")
            .unwrap();
        assert_eq!(
            store.worker_status(Some("old\0key")).unwrap().as_deref(),
            Some("old\0value")
        );
        store
            .set_worker_status(Some("old\0key"), "updated")
            .unwrap();
        assert_eq!(
            store.worker_status(Some("old\0key")).unwrap().as_deref(),
            Some("updated")
        );
    }

    #[test]
    fn metadata_writers_observe_predecessor_under_contention() {
        use crate::store::test_race::FenceRace;
        use std::sync::Arc;
        let dir = std::env::temp_dir().join(format!("sb4-metadata-{:x}", crate::ids::seed()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("store.sqlite");
        let mut holder = Store::open(&path).unwrap();
        let mut contender = Store::open(&path).unwrap();
        let race = Arc::new(FenceRace::sqlite());
        std::thread::scope(|scope| {
            let race = &race;
            let other = scope.spawn(move || {
                race.install_sqlite_busy_handler(contender.conn());
                let tx = contender
                    .transaction_with_begin_hook(true, || race.after_begin(false))
                    .unwrap();
                crate::metadata::test_cases::advance(&tx, Some("first"), "second");
                tx.commit().unwrap();
            });
            let tx = holder
                .transaction_with_begin_hook(true, || race.after_begin(true))
                .unwrap();
            race.after_fence(true).unwrap();
            crate::metadata::test_cases::advance(&tx, None, "first");
            tx.commit().unwrap();
            other.join().unwrap();
        });
        assert_eq!(
            holder.worker_status(Some("race")).unwrap().as_deref(),
            Some("second")
        );
        drop(holder);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn metadata_statement_error_discards_the_writer() {
        let mut store = Store::memory().unwrap();
        store.conn().execute_batch("CREATE TRIGGER refuse_metadata BEFORE INSERT ON _meta WHEN NEW.key = 'deployment_environment' BEGIN SELECT RAISE(ABORT, 'fixture refusal'); END").unwrap();
        let tx = store.transaction().unwrap();
        tx.set_worker_status(None, "discard").unwrap();
        assert!(tx.set_deployment_environment("refused").is_err());
        // Adapter errors are terminal for the caller; discard the entire writer.
        tx.rollback().unwrap();
        assert_eq!(store.worker_status(None).unwrap(), None);
    }
}
