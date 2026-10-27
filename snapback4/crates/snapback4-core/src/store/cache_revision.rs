//! Complete local SQLite commit observation and nonblocking snapshot validation.
// @ref LLP 3000.009.001.000.002#sqlite-snapshot-reuse — a stable commit interval binds the authority-pinned snapshot across readers.
use std::sync::{Arc, Mutex, OnceLock, Weak, atomic::{AtomicBool, Ordering}};
use super::*;

#[derive(Default)]
struct Stream { revision: u64, pending: usize }
struct Hooks { stream: Arc<Mutex<Stream>>, active: AtomicBool }
thread_local! { static COMMITTING: std::cell::RefCell<Option<Weak<Hooks>>> = const { std::cell::RefCell::new(None) }; }
impl Hooks {
    fn begin(self: &Arc<Self>) {
        COMMITTING.with(|slot| *slot.borrow_mut() = Some(Arc::downgrade(self)));
        let mut state = self.stream.lock().unwrap_or_else(|p| p.into_inner());
        if !self.active.swap(true, Ordering::AcqRel) { state.pending = state.pending.saturating_add(1); }
    }
    fn finish(&self, changed: bool) {
        let mut state = self.stream.lock().unwrap_or_else(|p| p.into_inner());
        if changed { state.revision = state.revision.saturating_add(1); }
        if self.active.swap(false, Ordering::AcqRel) { state.pending = state.pending.saturating_sub(1); }
    }
}
// SQLite calls this only after the WAL commit is visible and FULL's sync has
// completed. Callbacks on different connections can overlap; pending counts
// prevent one writer from publishing another writer's in-flight revision.
fn committed(wal: &rusqlite::hooks::Wal, frames: std::ffi::c_int) -> rusqlite::Result<()> {
    // SQLite invokes both hooks synchronously on the sqlite3_step caller's
    // thread. Our commit hook performs no SQL/reentrant calls, so its weak
    // thread-local handoff identifies this commit without unsafe driver access.
    if let Some(hooks) = COMMITTING.with(|slot| slot.borrow_mut().take()).and_then(|h| h.upgrade()) { hooks.finish(true); }
    if frames >= 1000 { let _ = wal.checkpoint(); }
    Ok(())
}

pub(super) struct Revision { hooks: Arc<Hooks>, wal: bool }
impl Revision {
    pub fn new(conn: &Connection) -> Result<Self, RuntimeError> {
        static FILES: OnceLock<Mutex<BTreeMap<PathBuf, Weak<Mutex<Stream>>>>> = OnceLock::new();
        let path = conn.path().filter(|s| !s.is_empty()).and_then(|s| std::fs::canonicalize(s).ok());
        let stream = if let Some(path) = path {
            let mut files = FILES.get_or_init(Default::default).lock().unwrap_or_else(|p| p.into_inner());
            files.retain(|_, v| v.strong_count() != 0);
            let stream = files.get(&path).and_then(Weak::upgrade).unwrap_or_else(|| Arc::new(Mutex::new(Stream::default())));
            files.insert(path, Arc::downgrade(&stream)); stream
        } else { Arc::new(Mutex::new(Stream::default())) };
        let wal = conn.query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))? == "wal";
        let hooks = Arc::new(Hooks { stream, active: AtomicBool::new(false) });
        let before = hooks.clone();
        conn.commit_hook(Some(move || { before.begin(); false }))?;
        let rollback = hooks.clone();
        conn.rollback_hook(Some(move || { if rollback.active.load(Ordering::Acquire) { rollback.finish(false); } }))?;
        conn.wal_hook(Some(committed));
        Ok(Self { hooks, wal })
    }
    pub fn finish_if_active(&self) {
        if self.hooks.active.load(Ordering::Acquire) { self.hooks.finish(false); }
    }
    pub fn reader(&self) -> Self { Self { hooks: Arc::new(Hooks { stream: self.hooks.stream.clone(), active: AtomicBool::new(false) }), wal: self.wal } }
    pub fn sample(&self) -> Option<i64> {
        let s = self.hooks.stream.lock().unwrap_or_else(|p| p.into_inner());
        (s.pending == 0 && s.revision < i64::MAX as u64).then_some(s.revision as i64)
    }
    pub fn snapshot(&self, before: Option<i64>) -> Option<i64> {
        before.filter(|v| self.sample() == Some(*v))
    }
}
impl Store {
    pub(crate) fn cached_revision(&self) -> Option<i64> { self.cache_revision.sample() }
    pub(crate) fn cache_scope(&self) -> Option<i64> {
        (self.server && self.cache_owned && self.ownership.is_some() && self.cache_revision.wal).then_some(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (PathBuf, Store) {
        let dir = std::env::temp_dir().join(format!("sqw-revision-{}-{:x}", std::process::id(), crate::ids::seed()));
        std::fs::create_dir(&dir).unwrap();
        let mut store = Store::open(&dir.join("store.sqlite")).unwrap();
        let owner = crate::private_fs::owner_file(&dir.join("store.sqlite")).unwrap();
        owner.try_lock().unwrap();
        store.retain_exclusive_ownership(Arc::new(owner)).unwrap();
        (dir, store)
    }
    fn token(store: &Store) -> i64 {
        let before = store.cache_revision.sample();
        let sql = store.conn.unchecked_transaction().unwrap();
        sql.query_row("SELECT value FROM _meta WHERE key='version'", [], |_| Ok(())).unwrap();
        let token = store.cache_revision.snapshot(before).unwrap();
        sql.rollback().unwrap(); token
    }
    #[test]
    fn sqlite_revision_tracks_authority_only_raw_and_auxiliary_commits() {
        let (dir, mut store) = fixture();
        let reader = store.reader().unwrap();
        let first = token(&reader);
        assert_eq!(first, token(&reader));
        store.set_meta("worker:session-revision", "1").unwrap();
        let second = token(&reader);
        assert_ne!(first, second);
        let own = token(&store);
        store.set_meta("worker:session-revision", "2").unwrap();
        assert_ne!(own, token(&store));
        let aux = Store::open(&dir.join("store.sqlite")).unwrap();
        let prior = token(&reader);
        aux.set_meta("worker:session-revision", "3").unwrap();
        assert_ne!(prior, token(&reader));
        // An explicit write transaction can COMMIT without emitting WAL frames.
        // Its adapter completion must retire the precommit observation too.
        let before_noop = reader.cache_revision.sample();
        let tx = store.transaction().unwrap(); tx.commit().unwrap();
        assert_eq!(reader.cache_revision.sample(), before_noop);
        let a = reader.cache_scope().unwrap();
        assert_eq!(a, store.reader().unwrap().cache_scope().unwrap());
        assert!(aux.cache_scope().is_none());
        drop((aux, reader, store)); std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn sqlite_revision_held_snapshot_and_precommit_gap_cannot_reuse_after_commit() {
        let (dir, store) = fixture();
        let reader = store.reader().unwrap();
        let before = reader.cache_revision.sample();
        let tx = reader.conn.unchecked_transaction().unwrap();
        tx.query_row("SELECT value FROM _meta WHERE key='version'", [], |_| Ok(())).unwrap();
        assert!(reader.cache_revision.snapshot(before).is_some());
        store.set_meta("worker:session-revision", "1").unwrap();
        // A snapshot pinned before the commit cannot borrow its new revision.
        assert!(reader.cache_revision.snapshot(before).is_none());
        tx.rollback().unwrap();
        assert_ne!(before, Some(token(&reader)));
        // A hook announced but not yet synced blocks every reader's token.
        store.cache_revision.hooks.begin();
        assert!(reader.cache_revision.sample().is_none());
        store.cache_revision.hooks.finish(true);
        assert!(reader.cache_revision.sample().is_some());
        drop((reader, store)); std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn sqlite_revision_reader_completion_cannot_retire_either_overlapping_writer() {
        let (dir, store) = fixture();
        let mut reader = store.reader().unwrap();
        let peer = Arc::new(Hooks { stream: store.cache_revision.hooks.stream.clone(), active: AtomicBool::new(false) });
        let read = reader.read_transaction().unwrap();
        store.cache_revision.hooks.begin(); peer.begin();
        read.commit().unwrap();
        assert!(reader.cache_revision.sample().is_none());
        store.cache_revision.hooks.finish(true);
        assert!(reader.cache_revision.sample().is_none());
        peer.finish(true);
        assert!(reader.cache_revision.sample().is_some());
        drop((reader, store)); std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn sqlite_revision_saturation_disables_reuse() {
        let (dir, store) = fixture();
        store.cache_revision.hooks.stream.lock().unwrap().revision = u64::MAX;
        assert!(store.cache_revision.sample().is_none());
        store.set_meta("worker:session-revision", "1").unwrap();
        assert_eq!(store.cache_revision.hooks.stream.lock().unwrap().revision, u64::MAX);
        drop(store); std::fs::remove_dir_all(dir).unwrap();
    }
}
