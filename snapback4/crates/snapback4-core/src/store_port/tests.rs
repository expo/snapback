use super::*;
use crate::{RuntimeError, ledger::{LedgerReader, LedgerTransaction}, revocation::{self, ChangeEvidence}};

#[test]
fn sqlite_asset_location_retains_paths_and_cleanup_policy_without_creating_files() {
    let store = AnyStore::memory().unwrap();
    let location = store.asset_location().unwrap();
    let AnyStore::Sqlite(sqlite) = &store else { panic!("SQLite fixture") };
    assert_eq!(location.directory(), sqlite.assets_dir());
    assert_eq!(location.path("asset-id"), sqlite.asset_path("asset-id"));
    assert_eq!(location.ephemeral(), sqlite.ephemeral_assets());
    assert!(location.ephemeral());
    assert!(!location.directory().exists());
}

#[test]
fn owning_handles_have_no_implicit_backend_access() {
    trait Ambiguous<A> { fn absent() {} }
    impl<T: ?Sized> Ambiguous<()> for T {}
    struct DerefEscape;
    impl<T: std::ops::Deref> Ambiguous<DerefEscape> for T {}
    let _ = <AnyStore as Ambiguous<_>>::absent;
    let _ = <AnyTx<'_> as Ambiguous<_>>::absent;
    let _ = <ReadSnapshot<'_> as Ambiguous<_>>::absent;
    let _ = <AnyInspection as Ambiguous<_>>::absent;
    let _ = <AnyPreparation<'_, '_> as Ambiguous<_>>::absent;
}

#[test]
fn enum_and_owned_snapshot_retain_the_bounded_evidence_contract() {
    let mut store = AnyStore::memory().unwrap();
    let tx = store.transaction().unwrap();
    let first = tx.next_seq().unwrap();
    tx.record_commit(first, 0, "test", "system", "test", &[], 0).unwrap();
    crate::rows::Rows::widen_change_evidence(&tx);
    let second = tx.next_seq().unwrap();
    tx.record_commit(second, 1, "test", "system", "test", &[], 0).unwrap();
    tx.commit().unwrap();
    let schema = crate::Schema::default();
    assert_eq!(store.preserved_between(&schema, 0, first), Some(vec![]));
    assert!(store.preserved_between(&schema, first, second).is_none());
    let snapshot = store.read_transaction().unwrap();
    assert_eq!(snapshot.preserved_between(&schema, 0, first), Some(vec![]));
    assert!(snapshot.preserved_between(&schema, first, second).is_none());
    assert!(snapshot.preserved_between(&schema, second, second + 1).is_none());
    assert_eq!(snapshot.optional_store_id().unwrap(), snapshot.store_identity().unwrap());
    assert_eq!(LedgerReader::commits_after(&snapshot, 0, 2).unwrap().iter().map(|r| r.0).collect::<Vec<_>>(), [first, second]);
    snapshot.rollback().unwrap();
    let tx = store.transaction().unwrap();
    assert!(revocation::preserved_between(&tx, &schema, first, second).is_none());
    tx.rollback().unwrap();
}

#[test]
fn unavailable_evidence_is_fallible_and_certifies_nothing() {
    struct Unavailable;
    impl ChangeEvidence for Unavailable {
        fn change_evidence(&self, _: u64, _: u64, _: impl FnMut(revocation::EvidenceRecord) -> Option<()>) -> Result<Option<()>, RuntimeError> {
            Err(RuntimeError::Structural { code: "E_STORE_UNSUPPORTED", message: "change-evidence is unavailable".into() })
        }
    }
    assert!(Unavailable.change_evidence(0, 1, |_| Some(())).is_err());
    assert!(revocation::footprint_between(&Unavailable, 0, 1).is_none());
    assert!(revocation::preserved_between(&Unavailable, &crate::Schema::default(), 0, 1).is_none());
}
