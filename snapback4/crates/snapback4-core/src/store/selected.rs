//! Decode only search-head inputs from the stored tagged row; skipped payload
//! never allocates a Value. The declared row reservation precedes this decoder.
use crate::{Value, RuntimeError};
use serde::de::{DeserializeSeed, MapAccess, Visitor, IgnoredAny};

pub(super) fn decode(json: &str, fields: &[String]) -> Result<Value, RuntimeError> {
    let mut decoder = serde_json::Deserializer::from_str(json);
    let value = Row(fields).deserialize(&mut decoder).map_err(|e|RuntimeError::Store(e.to_string()))?;
    decoder.end().map_err(|e|RuntimeError::Store(e.to_string()))?;
    Ok(value)
}
struct Row<'a>(&'a [String]);
impl<'de> DeserializeSeed<'de> for Row<'_> {
    type Value = Value;
    fn deserialize<D: serde::Deserializer<'de>>(self, d: D) -> Result<Value,D::Error> { d.deserialize_map(self) }
}
impl<'de> Visitor<'de> for Row<'_> {
    type Value = Value;
    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result { f.write_str("a tagged row") }
    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Value,M::Error> {
        if map.next_key::<String>()?.as_deref() != Some("Row") { return Err(serde::de::Error::custom("expected Row")); }
        let row = map.next_value_seed(Fields(self.0))?;
        if map.next_key::<IgnoredAny>()?.is_some() { return Err(serde::de::Error::custom("extra row tag")); }
        Ok(row)
    }
}
struct Fields<'a>(&'a [String]);
impl<'de> DeserializeSeed<'de> for Fields<'_> {
    type Value = Value;
    fn deserialize<D: serde::Deserializer<'de>>(self, d: D) -> Result<Value,D::Error> { d.deserialize_map(self) }
}
impl<'de> Visitor<'de> for Fields<'_> {
    type Value = Value;
    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result { f.write_str("row fields") }
    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Value,M::Error> {
        let mut row = std::collections::BTreeMap::new();
        while let Some(name) = map.next_key::<String>()? {
            if self.0.contains(&name) { row.insert(name, map.next_value::<Value>()?); }
            else { map.next_value::<IgnoredAny>()?; }
        }
        Ok(Value::Row(row.into()))
    }
}
