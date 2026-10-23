//! Private-host intent observations over executed writes. Never wire input.
// @ref LLP 3000.036.004#151-every-executed-write — committed traces, not net images, identify effective writes.
use super::*;
use crate::schema::RuleExpr;
use std::sync::{Arc, Mutex};

pub type FixtureRows = std::collections::BTreeMap<String,Vec<Value>>;
#[derive(Clone)]
pub struct ConcretePredicate(pub Arc<dyn Fn(&FixtureRows,&Value,&str,i64)->Option<bool> + Send + Sync>);
impl std::fmt::Debug for ConcretePredicate {fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result{f.write_str("concrete fixture predicate")}}
#[derive(Clone, Debug)]
pub struct Intent {
    /// Private derived contracts may compare the actual old/next pair once.
    pub paired: bool,
    pub concrete: Option<ConcretePredicate>,
    pub site: String,
    pub table: String,
    pub effects: Vec<Effect>,
    pub column: Option<String>,
    pub policy: RuleExpr,
}
#[derive(Clone, Debug)]
pub struct Observation {
    pub site: String,
    pub table: String,
    pub effect: Effect,
    pub old: Option<Value>,
    pub next: Option<Value>,
    /// None means unavailable/unknown; it can never establish a violation.
    pub allowed: Option<bool>,
}
#[derive(Clone, Debug)]
pub struct Trace {
    pub(crate) intents: Arc<Vec<Intent>>,
    pub(crate) observations: Arc<Mutex<Vec<Observation>>>,
}
impl Trace {
    pub fn new(intents: Vec<Intent>) -> Self { Self { intents: Arc::new(intents), observations: Arc::default() } }
    pub fn take(&self) -> Vec<Observation> { std::mem::take(&mut *self.observations.lock().expect("fixture trace lock")) }
}
impl Context {
    pub fn with_fixture_trace(mut self, trace: Trace) -> Self { self.fixture_trace = Some(trace); self }
}
impl Runner<'_> {
    pub(super) fn fixture_write(&self, table: &str, effect: Effect, old: Option<&Value>, next: Option<&Value>) {
        let Some(trace) = self.context.fixture_trace.as_ref() else { return; };
        for intent in trace.intents.iter().filter(|i| i.table == table && i.effects.contains(&effect)) {
            if effect == Effect::Update && intent.column.as_ref().is_some_and(|c|old.and_then(|r|r.field(c).ok()) == next.and_then(|r|r.field(c).ok())) { continue; }
            let judge = |image: &Value| self.fixture_judgment(&intent.policy, old, image).ok().and_then(|v| match v {
                rules::Verdict::Readable => Some(true), rules::Verdict::Denied => Some(false), rules::Verdict::Unknown => None,
            });
            let allowed = if let Some(predicate)=&intent.concrete {
                // Private fixture inspection, bounded and independent of the
                // application's logical meter. Overlay the pending write:
                // fixture_write runs immediately before the store put/remove.
                let snapshot=self.fixture_snapshot();
                snapshot.ok().and_then(|before|{
                    let now=self.context.now.unwrap_or(0);
                    let a=old.map(|row|(predicate.0)(&before,row,&self.context.viewer,now));
                    let mut after=before;
                    let rows=after.entry(table.into()).or_default();
                    let id=next.or(old).and_then(|r|r.field("id").ok());
                    rows.retain(|r|r.field("id").ok()!=id);
                    if let Some(row)=next{rows.push(row.clone());}
                    let b=next.map(|row|(predicate.0)(&after,row,&self.context.viewer,now));
                    match (a,b){(Some(Some(false)),_)|(_,Some(Some(false)))=>Some(false),(Some(None),_)|(_,Some(None))=>None,_=>Some(true)}
                })
            } else if intent.paired {
                match (old,next){(Some(_),Some(next))=>judge(next),_=>None}
            } else { match (old, next) {
                (Some(old), Some(next)) => match (judge(old), judge(next)) {
                    (Some(false), _) | (_, Some(false)) => Some(false),
                    (Some(true), Some(true)) => Some(true), _ => None,
                },
                (_, Some(row)) | (Some(row), _) => judge(row),
                _ => None,
            }};
            trace.observations.lock().expect("fixture trace lock").push(Observation {site:intent.site.clone(),table:table.into(),effect,old:old.cloned(),next:next.cloned(),allowed});
        }
    }
}
