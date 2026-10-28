//! Pure compiler reuse within a single release command; never a release verdict cache.
use crate::Bound;
use std::cell::RefCell;
type Sources = Vec<(String, String)>;
#[derive(Default)]
struct Cache { enabled: bool, entries: Vec<(Sources, Bound)>, bytes: usize }
thread_local! { static CACHE: RefCell<Cache> = RefCell::default(); }
pub struct Scope;
impl Scope {
    pub fn new() -> Self {
        CACHE.with(|cache| *cache.borrow_mut() = Cache { enabled: true, ..Cache::default() });
        Self
    }
}
impl Drop for Scope {
    fn drop(&mut self) { CACHE.with(|cache| *cache.borrow_mut() = Cache::default()); }
}
// @ref LLP 3000.000.000#5-hot-activation-and-ownership — reread current source and repeat all live admission; reuse only pure compilation.
pub fn compile(sources: &[(String, String)]) -> Bound {
    if let Some(bound) = CACHE.with(|cache| {
        let cache=cache.borrow();
        cache.enabled.then(||cache.entries.iter().find(|(key,_)|key==sources).map(|(_,bound)|bound.clone())).flatten()
    }) { return bound; }
    let started=snapback4_core::replay_profile::start();
    let bound=crate::compile(sources);
    if let Some(started)=started {snapback4_core::replay_profile::record(serde_json::json!({"phase":"release.compile","seconds":started.elapsed().as_secs_f64()}));}
    CACHE.with(|cache| {
        let mut cache=cache.borrow_mut();
        let bytes=sources.iter().map(|(name,text)|name.len()+text.len()).sum::<usize>();
        if cache.enabled && bytes<=8*1024*1024 {
            if cache.entries.len()>=16 || cache.bytes+bytes>8*1024*1024 {cache.entries.clear();cache.bytes=0;}
            cache.entries.push((sources.to_vec(),bound.clone()));cache.bytes+=bytes;
        }
    });
    bound
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn complete_bytes_names_and_scope_control_reuse_and_owned_results() {
        let sources=vec![("release.q".into(),"query alive():\n  return true\n".into())];
        let scope=Scope::new();
        let mut first=compile(&sources);
        assert!(first.diagnostics.is_empty());
        first.programs.clear();
        assert_eq!(compile(&sources).programs.len(),1,"a caller cannot mutate the reused result");
        let changed=vec![("release.q".into(),"query alive():\n  return absentName\n".into())];
        assert!(!compile(&changed).diagnostics.is_empty(),"an edited retained file must be revalidated");
        let renamed=vec![("other.q".into(),changed[0].1.clone())];
        let diagnostics=compile(&renamed).diagnostics;
        assert!(diagnostics.iter().all(|d|d.to_string().contains("other.q")),"diagnostic file identity belongs to the input key");
        drop(scope);
        CACHE.with(|cache|assert!(!cache.borrow().enabled && cache.borrow().entries.is_empty()));
        compile(&sources);
        CACHE.with(|cache|assert!(cache.borrow().entries.is_empty(),"serving outside a command scope retains nothing"));
    }
}
