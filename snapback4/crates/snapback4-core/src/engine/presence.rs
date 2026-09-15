//! Grace belongs to effect admission, never to predicted rows.
use super::runner::Runner;
use crate::{error::RuntimeError, ir::Expr, value::Value};
use std::collections::BTreeMap;

pub(super) type Dependencies = BTreeMap<String, i64>;
pub(crate) type Emission = (String, String, Value, Dependencies);

#[derive(Default)]
pub(super) struct EffectPresence {
    pub enabled: bool,
    pub reads: Dependencies,
    pub guard: Dependencies,
    pub variables: BTreeMap<String, Dependencies>,
}

fn bytes(deps: &Dependencies) -> u64 { deps.keys().map(|key| key.len() as u64 + 64).sum() }

impl Runner<'_> {
    pub(super) fn prepare_effect_presence(&mut self, name: &str) {
        self.effect_presence.enabled = !self.device && self.context.presence.is_some()
            && self.schema.operations.get(name).is_some_and(|fact| fact.connected_effects_only);
    }

    // @ref LLP 3000.007#19.1 — the effects-only proof permits live presence decisions with durable grace dependencies; devices retain their original interpreter path.
    pub(super) fn grace_read(&mut self, principal: &str, deadline: i64) -> Result<(), RuntimeError> {
        self.meter.heap(principal.len() as u64 + 64)?;
        self.effect_presence.reads.insert(principal.into(), deadline);
        Ok(())
    }

    pub(super) fn read_presence_value(&mut self, expr: &Expr) -> Result<(), RuntimeError> {
        if !self.effect_presence.enabled { return Ok(()); }
        // Include borrowed field/scalar fast paths, which do not call expr
        // on their root variable. Values themselves stay untouched.
        let name = match expr {
            Expr::Variable(name) => Some(name),
            Expr::Field { base, .. } => return self.read_presence_value(base),
            Expr::Builtin { args, .. } => {
                for arg in args { self.read_presence_value(arg)?; }
                None
            }
            _ => None,
        };
        if let Some(deps) = name.and_then(|name| self.effect_presence.variables.get(name)) {
            self.meter.heap(bytes(deps))?;
            self.effect_presence.reads.extend(deps.clone());
        }
        Ok(())
    }

    pub(super) fn emission_presence(&mut self) -> Result<Dependencies, RuntimeError> {
        self.meter.heap(bytes(&self.effect_presence.reads) + bytes(&self.effect_presence.guard))?;
        let mut deps = self.effect_presence.guard.clone();
        deps.extend(self.effect_presence.reads.clone());
        Ok(deps)
    }

    pub(super) fn bind_effect_value(&mut self, name: &str, value: Value) -> Result<(), RuntimeError> {
        let deps = self.emission_presence()?;
        self.env.insert(name.into(), value);
        if deps.is_empty() { self.effect_presence.variables.remove(name); }
        else {
            self.meter.heap(name.len() as u64 + 64)?;
            self.effect_presence.variables.insert(name.into(), deps);
        }
        Ok(())
    }

    pub(super) fn enter_presence_guard(&mut self) -> Result<Dependencies, RuntimeError> {
        let deps = self.emission_presence()?;
        Ok(std::mem::replace(&mut self.effect_presence.guard, deps))
    }

    pub(super) fn push_presence_value(&mut self, name: &str) -> Result<(), RuntimeError> {
        let deps = self.emission_presence()?;
        if !deps.is_empty() {
            self.meter.heap(name.len() as u64 + 64)?;
            self.effect_presence.variables.entry(name.into()).or_default().extend(deps);
        }
        Ok(())
    }
}
