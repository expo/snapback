// Temporary attribution only; installed by instrument.py, absent from shipped code.
use std::{cell::RefCell, collections::BTreeMap, time::Instant};
#[derive(Default)]
struct State { stack: Vec<&'static str>, at: Option<Instant>, ns: BTreeMap<&'static str, u128>, calls: BTreeMap<&'static str, u64> }
thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }
fn tick(s: &mut State, now: Instant) {
    if let Some(at) = s.at { *s.ns.entry(s.stack.last().copied().unwrap_or("other")).or_default() += now.duration_since(at).as_nanos(); }
    s.at = Some(now);
}
pub struct Guard;
pub fn enter(name: &'static str) -> Guard {
    STATE.with_borrow_mut(|s| { tick(s, Instant::now()); s.stack.push(name); *s.calls.entry(name).or_default() += 1; }); Guard
}
impl Drop for Guard { fn drop(&mut self) { STATE.with_borrow_mut(|s| { tick(s, Instant::now()); s.stack.pop(); }); } }
pub fn reset() { STATE.with_borrow_mut(|s| *s = State { at: Some(Instant::now()), ..State::default() }); }
pub fn report() -> serde_json::Value { STATE.with_borrow_mut(|s| { tick(s, Instant::now()); serde_json::json!({"ns":s.ns,"calls":s.calls}) }) }
