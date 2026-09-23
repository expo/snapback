//! One wire fence for engine semantics an older decoder must not ignore.
//! Constraint is strictly parsed by 0.2.33, unlike Schema's optional fields.
use super::*;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::BTreeSet;

// Private remote derive: the schema has one wire field list, and callers
// cannot accidentally invoke an unchecked inherent Schema::deserialize.
#[derive(Serialize, Deserialize)]
#[serde(remote = "Schema")]
struct Wire {
    tables: BTreeMap<String, Table>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    timelines: Vec<timeline::Timeline>,
    #[serde(default)]
    maintains: Vec<Maintain>,
    #[serde(default, skip_serializing_if = "Auth::is_default")]
    auth: Auth,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    effects: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    schedules: Vec<Schedule>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    operations: BTreeMap<String, Execution>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    unique_refusals: BTreeMap<String, BTreeMap<String, UniqueRefusal>>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    action_specs: BTreeMap<String, ActionSpec>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    effect_specs: BTreeMap<String, WorkSpec>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    routes: BTreeMap<String, RouteSpec>,
}

// Add a capability and its schema predicate here in one line. This is both
// the derivation and the decoder's allowlist; authors never declare it.
const CAPABILITIES: &[(&str, fn(&Schema) -> bool)] = &[
    ("recorded-attribution", |s| s.tables.values().any(|t| !t.recorded.is_empty())),
    ("timeline", |s| !s.timelines.is_empty()),
];

impl Schema {
    pub fn required_capabilities(&self) -> BTreeSet<String> {
        CAPABILITIES.iter().filter(|(_, needs)| needs(self)).map(|(name, _)| (*name).into()).collect()
    }
}

impl Serialize for Schema {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let required = self.required_capabilities();
        // The derive's field order, omissions and bytes are unchanged for
        // ordinary schemas, including the serialized conformance corpus.
        if required.is_empty() { return Wire::serialize(self, serializer); }
        let mut wire = self.clone();
        let mut carrier = wire.tables.first_entry().ok_or_else(||
            serde::ser::Error::custom("E_SCHEMA_CAPABILITY: required capabilities need a table carrier"))?;
        carrier.get_mut().constraints.push(Constraint::Capabilities(required));
        Wire::serialize(&wire, serializer)
    }
}

impl<'de> Deserialize<'de> for Schema {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // The private remote derive uses the ordinary
        // streaming serde codec. No JSON-value or content-buffer replay.
        let mut schema = Wire::deserialize(deserializer)?;
        let mut declared = BTreeSet::new();
        let mut carriers = 0;
        for table in schema.tables.values_mut() {
            table.constraints.retain(|constraint| {
                if let Constraint::Capabilities(names) = constraint {
                    carriers += 1;
                    declared.extend(names.iter().cloned());
                    false
                } else { true }
            });
        }
        for name in &declared {
            if !CAPABILITIES.iter().any(|(known, _)| name == known) {
                return Err(serde::de::Error::custom(format!("E_SCHEMA_CAPABILITY: unsupported engine capability {name}; upgrade the engine/device")));
            }
        }
        let required = schema.required_capabilities();
        if declared != required || carriers != usize::from(!required.is_empty()) {
            return Err(serde::de::Error::custom(format!("E_SCHEMA_CAPABILITY: schema requires {required:?}, but declares {declared:?} in {carriers} carriers")));
        }
        Ok(schema)
    }
}
