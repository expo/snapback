//! Invocation-local reuse of a pure compiler result, never campaign evidence.
// @ref LLP 3000.036.004.000.000#exact-compilation-reuse — exact source bytes and filenames within one executable invocation.
use crate::Bound;
use std::cell::RefCell;
type Entry = (Vec<(String, String)>, Bound);
thread_local! { static CURRENT: RefCell<Option<Option<Entry>>> = const { RefCell::new(None) }; }
/// Opt-in for a CLI pipeline that repeatedly validates the same captured bytes.
/// Threads and nested scopes have independent slots; drop discards this slot.
#[doc(hidden)]
pub struct CompilationReuse(Option<Option<Entry>>);
impl CompilationReuse {
    pub fn new() -> Self { Self(CURRENT.with(|slot| slot.replace(Some(None)))) }
}
impl Drop for CompilationReuse {
    fn drop(&mut self) { CURRENT.with(|slot| { slot.replace(self.0.take()); }); }
}
pub(crate) fn get(sources: &[(String, String)]) -> Option<Bound> {
    CURRENT.with(|slot| slot.borrow().as_ref()?.as_ref().filter(|(key, _)| key == sources).map(|(_, bound)| bound.clone()))
}
pub(crate) fn put(sources: &[(String, String)], bound: &Bound) {
    CURRENT.with(|slot| {
        if let Some(entry) = slot.borrow_mut().as_mut() {
            // Representation bound only: oversized inputs simply compile again.
            *entry = (sources.iter().map(|(file, text)| file.len().saturating_add(text.len())).sum::<usize>() <= 512 * 1024)
                .then(|| (sources.to_vec(), bound.clone()));
        }
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_keys_and_independent_owned_results() {
        let source = vec![("schema.q".into(), "query alive():\n  return true\n".into())];
        assert!(get(&source).is_none());
        let _scope = CompilationReuse::new();
        let mut first = crate::compile(&source);
        assert!(get(&source).is_some());
        first.programs.clear();
        assert_eq!(crate::compile(&source).programs.len(), 1, "caller edits cannot change the immutable cached result");
        let renamed = vec![("other.q".into(), source[0].1.clone())];
        assert!(get(&renamed).is_none());
        let changed = vec![("schema.q".into(), "query broken():\n  return missing\n".into())];
        assert!(get(&changed).is_none());
        assert!(!crate::compile(&changed).diagnostics.is_empty());
        assert!(get(&source).is_none(), "one current entry, no stale hit");
        assert!(crate::compile(&source).diagnostics.is_empty());
        let mut repeated = source.clone(); repeated.push(source[0].clone());
        assert!(get(&repeated).is_none(), "document multiplicity is an input");
    }
    #[test]
    fn scopes_threads_and_oversized_inputs_do_not_share_entries() {
        let source = vec![("schema.q".into(), "query q():\n  return true\n".into())];
        {
            let _outer = CompilationReuse::new(); crate::compile(&source);
            { let _inner = CompilationReuse::new(); assert!(get(&source).is_none()); }
            assert!(get(&source).is_some());
            std::thread::scope(|scope| { scope.spawn(|| assert!(get(&source).is_none())).join().unwrap(); });
            let oversized = vec![("schema.q".into(), " ".repeat(512 * 1024 + 1))];
            put(&oversized, &crate::compile(&source)); assert!(get(&oversized).is_none());
        }
        assert!(get(&source).is_none(), "drop removes all reuse across invocations");
    }
}
