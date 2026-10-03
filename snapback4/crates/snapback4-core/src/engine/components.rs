//! Coverage observations for device components and streaming scalars.
//! Never reset the interpreter's flags:
//! scans consult earlier cuts while running, even in a cursor-free program.
use super::runner::Runner;
use crate::{error::{MeterKind, RuntimeError}, ir::{Expr, Program}, schema::Component, value::Value};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Coverage {
    pub complete: bool,
    pub unknown: bool,
    pub retained: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub speculative: bool,
}

/// Read provenance, independent of the returned value's shape.
// @ref LLP 3000.007#6.5 — placeholder recovery needs read facts, including through projections and presence wrappers.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Provenance { pub speculative: bool }

// Constructed only from the successful expression evaluations below.
pub(super) struct EvaluatedFields(BTreeMap<String,Value>);
impl EvaluatedFields { pub(super) fn into_value(self) -> Value { Value::Row(self.0.into()) } }

#[derive(Clone, Default)]
pub(super) struct Frame {
    pub beyond: bool,
    pub unknown: bool,
    pub retained: bool,
    pub non_uniform: bool,
    pub overflow: bool,
    pub words: bool,
    pub presence: bool,
    pub capped: bool,
    pub pending: bool,
    pub speculative: bool,
}
impl Frame {
    pub(super) fn coverage(&self) -> Coverage {
        let other = self.pending || self.unknown || self.non_uniform || self.overflow || self.words || self.presence || self.capped;
        // @ref LLP 3000.007#20.22.1 — presence is server knowledge: a component that waited on it is unknown, not merely incomplete.
        Coverage { complete: !other && !self.beyond, unknown: self.unknown || self.presence, retained: self.retained && !other, speculative: self.speculative }
    }
}

#[derive(Default)]
pub(super) struct Frames {
    pub plan: Vec<Component>,
    pub frames: Vec<Frame>,
    pub shared: Frame,
    pub active: Option<usize>,
    pub depth: usize,
    /// The innermost streaming scalar observes its own reads independently
    /// of the enclosing page. An unavailable inner scalar unwinds its parent.
    pub scalar: Option<Frame>,
}
impl Frames {
    pub fn note(&mut self, note: impl Fn(&mut Frame)) {
        if let Some(scalar) = &mut self.scalar { note(scalar); }
        note(match self.active { Some(index) => &mut self.frames[index], None => &mut self.shared });
    }
    pub fn provenance(&self) -> Provenance {
        // Observe even without a composition plan, and preserve facts on refusal.
        let mut facts = Provenance { speculative: self.shared.speculative };
        for frame in &self.frames {
            facts.speculative |= frame.speculative;
        }
        facts
    }
}

// @ref LLP 3000.001#proposed-composition-of-retained-and-authoritative-reads — mirror coverage events in the active frame; global flags, first diagnostic, page state and the one meter remain untouched.
impl Runner<'_> {
    pub(super) fn prepare_components(&mut self, program: &Program) {
        self.components = Frames::default();
        if self.component_observation && self.device && !program.native && let Some(fact) = self.schema.operations.get(&program.name).filter(|fact| !fact.held && !fact.components.is_empty()) {
            self.components = Frames { plan: fact.components.clone(), frames: vec![Frame::default(); fact.components.len()], ..Frames::default() };
        }
    }

    pub(super) fn begin_component(&mut self, index: usize) -> (Option<usize>, bool, bool) {
        let top = !self.components.plan.is_empty() && self.components.depth == 0;
        self.components.depth += 1;
        let previous = self.components.active;
        if top { self.components.active = self.components.plan.iter().position(|component| component.statements.contains(&index)); }
        (previous, self.meter.capped_at.is_some(), top)
    }

    pub(super) fn end_component(&mut self, previous: Option<usize>, capped: bool) {
        self.components.depth -= 1;
        if self.meter.capped_at.is_some() && !capped { self.components.note(|frame| frame.capped = true); }
        self.components.active = previous;
    }

    pub(super) fn component_record(&mut self, fields: &BTreeMap<String, Expr>, expr: &Expr) -> Result<Value, RuntimeError> {
        // The ordinary Object expression's exact evaluation order and charges.
        self.meter.step(1)?;
        self.read_presence_value(expr)?;
        let mut values = BTreeMap::new();
        for (field, expr) in fields {
            let previous = self.components.active;
            self.components.active = self.components.plan.iter().position(|component| &component.field == field);
            let capped = self.meter.capped_at.is_some();
            let result = self.expr(expr);
            if !capped && self.meter.capped_at.is_some() { self.components.note(|frame| frame.capped = true); }
            self.components.active = previous;
            values.insert(field.clone(), result?);
        }
        self.component_object(EvaluatedFields(values))
    }

    pub(super) fn component_coverage(&self) -> BTreeMap<String, Coverage> {
        if !self.components.shared.coverage().complete || self.page_position_lost() { return BTreeMap::new(); }
        crate::small_map::collect(self.components.plan.iter().zip(&self.components.frames).map(|(plan, frame)| (plan.field.clone(), frame.coverage())))
    }

    pub(super) fn read_charge(&mut self, kind: MeterKind, amount: u64) -> Result<bool, RuntimeError> {
        let charged = self.meter.charge(kind, amount)?;
        if !charged { self.read_cuts += 1; self.components.note(|frame| frame.capped = true); }
        Ok(charged)
    }

    pub(super) fn read_capped(&mut self) -> bool {
        let capped = self.meter.capped_at.is_some();
        if capped { self.read_cuts += 1; self.components.note(|frame| frame.capped = true); }
        capped
    }

    pub(super) fn retained_group(&mut self, table: &str, index: &str, prefix: &[Value]) -> Result<bool, RuntimeError> {
        let retained = self.device_work(|runner| runner.tx.retained_group(table, index, prefix))?;
        if retained { self.retained_seen = true; self.components.note(|frame| frame.retained = true); }
        Ok(retained)
    }

    pub(super) fn retained_row(&mut self, table: &str, row: &Value) -> Result<bool, RuntimeError> {
        let retained = self.device_work(|runner| runner.tx.retained_row(table, row))?;
        self.retained_seen |= retained;
        Ok(retained)
    }
}
