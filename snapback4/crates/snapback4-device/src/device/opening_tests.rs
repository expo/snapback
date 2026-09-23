//! Transaction-boundary injection complements the real host overlap witness.
use super::*;
use crate::memory::MemoryStore;
use std::rc::Rc;

type Metadata = BTreeMap<String, Option<String>>;
fn evidence<S: DeviceStore>(store: &S) -> Metadata {
    [BACKEND, GENERATION, WATERMARK, deferred::CURSOR, deferred::IMAGES_AT].into_iter()
        .map(|key| (key.to_owned(), store.meta(key).unwrap())).collect()
}

// Inject after open has read metadata, immediately before the real store's
// checked installation. Both checks run on the same handle, so SQLite's
// activation guard cannot substitute for the metadata comparison under test.
struct BeforeInstall<S> { store: S, replacement: Backend, observed: Rc<RefCell<Option<(Metadata, Metadata)>>> }
impl<S: DeviceStore> DeviceStore for BeforeInstall<S> {
    type Tx<'a> = S::Tx<'a> where Self: 'a;
    fn install(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool) -> Result<(), RuntimeError> {
        self.install_checked(schema, metadata, reset, &BTreeMap::new())
    }
    fn install_checked(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool, expected: &Metadata) -> Result<(), RuntimeError> {
        let replacement = BTreeMap::from([
            (BACKEND.to_owned(), encoded(&self.replacement)?),
            (GENERATION.to_owned(), self.replacement.generation.to_string()),
        ]);
        self.store.install(&self.replacement.schema, &replacement, false)?;
        let tx = self.store.transaction()?;
        for (key, value) in [(WATERMARK, "17"), (deferred::CURSOR, "18"), (deferred::IMAGES_AT, "20")] { tx.set_meta(key, value)?; }
        tx.commit()?;
        let before = evidence(&self.store);
        let result = self.store.install_checked(schema, metadata, reset, expected);
        *self.observed.borrow_mut() = Some((before, evidence(&self.store)));
        result
    }
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> { self.store.meta(key) }
    fn set_meta(&mut self, key: &str, value: &str) -> Result<(), RuntimeError> { self.store.set_meta(key, value) }
    fn transaction(&mut self) -> Result<Self::Tx<'_>, RuntimeError> { self.store.transaction() }
}

fn interleaving<S: DeviceStore>(mut store: S, kept: bool, explicit: bool) {
    let backend = Backend { generation: 1, schema: Schema::default(), programs: vec![] };
    if kept { store = Device::open_store(store, Some(backend.clone())).unwrap().store; }
    let observed = Rc::new(RefCell::new(None));
    let wrapped = BeforeInstall { store, replacement: Backend { generation: 2, ..backend.clone() }, observed: observed.clone() };
    let opened = if explicit { Device::open_store(wrapped, Some(backend)) }
        else if kept { Device::open_store(wrapped, None) } else { Device::open_store_initial(wrapped, backend) };
    assert!(matches!(opened, Err(RuntimeError::Generation(_))), "an expired opening observation must refuse");
    let (before, after) = observed.borrow_mut().take().unwrap();
    assert_eq!(before, after, "the refused installation must leave the winning backend and cuts intact");
}

#[test]
fn first_install_checks_absence_memory() { interleaving(MemoryStore::new(), false, false); }

#[cfg(feature = "native")]
#[test]
fn first_install_checks_absence_sqlite() { publication_tests::with_sqlite(|s| interleaving(s, false, false)); }

#[test]
fn kept_open_checks_its_backend_memory() { interleaving(MemoryStore::new(), true, false); }

#[cfg(feature = "native")]
#[test]
fn kept_open_checks_its_backend_sqlite() { publication_tests::with_sqlite(|s| interleaving(s, true, false)); }

#[test]
fn explicit_open_checks_its_backend_memory() { interleaving(MemoryStore::new(), true, true); }

#[cfg(feature = "native")]
#[test]
fn explicit_open_checks_its_backend_sqlite() { publication_tests::with_sqlite(|s| interleaving(s, true, true)); }

#[test]
fn first_install_envelope_is_not_a_legacy_backend() {
    let text = r#"{"initial_backend":{"generation":1,"schema":{"tables":{}},"programs":[]}}"#;
    assert!(snapback4_core::json_codec::from_text::<Backend>(text).is_err(), "older modules must refuse before installation");
    let opening = crate::opening::Opening::parse(Some(text)).unwrap();
    let device = opening.open(MemoryStore::new()).unwrap();
    assert_eq!(device.generation, 1);
}
