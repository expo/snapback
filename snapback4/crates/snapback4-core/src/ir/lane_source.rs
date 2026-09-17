use super::{Expr, LaneSource, Scan};
use serde::{Deserialize, Deserializer};
use serde::de::{self, DeserializeSeed, IntoDeserializer, MapAccess, Visitor};
use std::fmt;

// @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — discriminate without a Content tree; nested values keep the original reader.
impl<'de> Deserialize<'de> for LaneSource {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(SourceVisitor)
    }
}

// Ask the derive for its field names without invoking its visitor. This keeps
// new Scan fields authoritative in one place, including for unknown-first maps.
#[derive(Debug)]
struct ScanFields(&'static [&'static str]);
impl fmt::Display for ScanFields {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result { f.write_str("Scan field discovery") }
}
impl std::error::Error for ScanFields {}
impl de::Error for ScanFields {
    fn custom<T: fmt::Display>(_: T) -> Self { Self(&[]) }
}
struct FieldNames;
impl<'de> Deserializer<'de> for FieldNames {
    type Error = ScanFields;
    fn deserialize_struct<V: Visitor<'de>>(self, _: &'static str, fields: &'static [&'static str], _: V) -> Result<V::Value, Self::Error> { Err(ScanFields(fields)) }
    fn deserialize_any<V: Visitor<'de>>(self, _: V) -> Result<V::Value, Self::Error> { Err(ScanFields(&[])) }
    serde::forward_to_deserialize_any! { bool i8 i16 i32 i64 u8 u16 u32 u64 f32 f64 char str string bytes byte_buf option unit unit_struct newtype_struct seq tuple tuple_struct map enum identifier ignored_any }
}

struct SourceVisitor;
impl<'de> Visitor<'de> for SourceVisitor {
    type Value = LaneSource;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result { f.write_str("a scan, range or list lane source object") }
    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<LaneSource, M::Error> {
        let fields = Scan::deserialize(FieldNames).unwrap_err().0;
        while let Some(key) = map.next_key::<String>()? {
            if matches!(key.as_str(), "start" | "end_exclusive" | "value" | "max") { return small(key, map); }
            if fields.contains(&key.as_str()) {
                return Scan::deserialize(de::value::MapAccessDeserializer::new(Replay { key: Some(key), map })).map(LaneSource::Scan);
            }
            map.next_value::<de::IgnoredAny>()?;
        }
        Err(de::Error::custom("missing scan, range or list lane source fields"))
    }
}

struct Replay<M> { key: Option<String>, map: M }
impl<'de, M: MapAccess<'de>> MapAccess<'de> for Replay<M> {
    type Error = M::Error;
    fn next_key_seed<K: DeserializeSeed<'de>>(&mut self, seed: K) -> Result<Option<K::Value>, Self::Error> {
        match self.key.take() {
            Some(key) => seed.deserialize(key.into_deserializer()).map(Some),
            None => self.map.next_key_seed(seed),
        }
    }
    fn next_value_seed<V: DeserializeSeed<'de>>(&mut self, seed: V) -> Result<V::Value, Self::Error> { self.map.next_value_seed(seed) }
}

fn small<'de, M: MapAccess<'de>>(first: String, mut map: M) -> Result<LaneSource, M::Error> {
    let (mut start, mut end, mut value): (Option<Expr>, Option<Expr>, Option<Expr>) = (None, None, None);
    let mut max: Option<Option<u64>> = None;
    let mut key = Some(first);
    while let Some(field) = key {
        match field.as_str() {
            "start" => {
                if start.is_some() { return Err(de::Error::duplicate_field("start")); }
                if value.is_some() { return Err(de::Error::custom("mixed range and list lane source fields")); }
                start = Some(map.next_value()?);
            }
            "end_exclusive" => {
                if end.is_some() { return Err(de::Error::duplicate_field("end_exclusive")); }
                if value.is_some() { return Err(de::Error::custom("mixed range and list lane source fields")); }
                end = Some(map.next_value()?);
            }
            "value" => {
                if value.is_some() { return Err(de::Error::duplicate_field("value")); }
                if start.is_some() || end.is_some() { return Err(de::Error::custom("mixed range and list lane source fields")); }
                value = Some(map.next_value()?);
            }
            "max" => {
                if max.is_some() { return Err(de::Error::duplicate_field("max")); }
                max = Some(map.next_value()?);
            }
            _ => { map.next_value::<de::IgnoredAny>()?; }
        }
        key = map.next_key()?;
    }
    if let Some(value) = value {
        let max = max.flatten().ok_or_else(|| de::Error::missing_field("max"))?;
        let max = u32::try_from(max).map_err(|_| de::Error::custom("list max exceeds u32"))?;
        Ok(LaneSource::List { value, max })
    } else {
        Ok(LaneSource::Range {
            start: start.ok_or_else(|| de::Error::missing_field("start"))?,
            end_exclusive: end.ok_or_else(|| de::Error::missing_field("end_exclusive"))?,
            max: max.flatten(),
        })
    }
}
