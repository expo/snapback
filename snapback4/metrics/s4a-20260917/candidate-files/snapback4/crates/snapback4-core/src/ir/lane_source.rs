// Like the other derived IR structs, LaneSource skips unknown values through
// IgnoredAny. It does not validate their number range, surrogate pairing or
// nesting depth; the old untagged Content buffer did so only as a side effect.
// validate_text is a separate boundary policy, not a stored-program open pass.
use super::{Expr, LaneSource, Scan};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde::de::{self, DeserializeSeed, IntoDeserializer, MapAccess, Visitor};
use std::fmt;

// @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — discriminate without a Content tree; nested values keep the original reader.
impl<'de> Deserialize<'de> for LaneSource {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        if !deserializer.is_human_readable() {
            #[derive(Deserialize)]
            enum Tagged { Scan(Scan), Range { start: Expr, end_exclusive: Expr, max: Option<u64> }, List { value: Expr, max: u32 } }
            return Ok(match Tagged::deserialize(deserializer)? {
                Tagged::Scan(scan) => Self::Scan(scan),
                Tagged::Range { start, end_exclusive, max } => Self::Range { start, end_exclusive, max },
                Tagged::List { value, max } => Self::List { value, max },
            });
        }
        let fields = checked_fields(Scan::deserialize(FieldNames).map(|_| ())).map_err(de::Error::custom)?;
        deserializer.deserialize_map(SourceVisitor { fields })
    }
}

impl Serialize for LaneSource {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        #[serde(untagged)]
        enum Text<'a> { Scan(&'a Scan), Range { start: &'a Expr, end_exclusive: &'a Expr, max: &'a Option<u64> }, List { value: &'a Expr, max: u32 } }
        #[derive(Serialize)]
        enum Tagged<'a> { Scan(&'a Scan), Range { start: &'a Expr, end_exclusive: &'a Expr, max: &'a Option<u64> }, List { value: &'a Expr, max: u32 } }
        if serializer.is_human_readable() {
            match self {
                Self::Scan(scan) => Text::Scan(scan),
                Self::Range { start, end_exclusive, max } => Text::Range { start, end_exclusive, max },
                Self::List { value, max } => Text::List { value, max: *max },
            }.serialize(serializer)
        } else {
            match self {
                Self::Scan(scan) => Tagged::Scan(scan),
                Self::Range { start, end_exclusive, max } => Tagged::Range { start, end_exclusive, max },
                Self::List { value, max } => Tagged::List { value, max: *max },
            }.serialize(serializer)
        }
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

const SMALL_FIELDS: &[&str] = &["start", "end_exclusive", "value", "max"];
const MIXED: &str = "mixed scan and range/list lane source fields";
fn checked_fields(probe: Result<(), ScanFields>) -> Result<&'static [&'static str], &'static str> {
    let fields = match probe {
        Ok(()) => return Err("Scan field discovery unexpectedly succeeded"),
        Err(ScanFields([])) => return Err("Scan field discovery returned no fields"),
        Err(ScanFields(fields)) => fields,
    };
    if fields.iter().any(|field| SMALL_FIELDS.contains(field)) { return Err("Scan fields overlap range/list lane source fields"); }
    Ok(fields)
}

struct SourceVisitor { fields: &'static [&'static str] }
impl<'de> Visitor<'de> for SourceVisitor {
    type Value = LaneSource;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result { f.write_str("a scan, range or list lane source object") }
    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<LaneSource, M::Error> {
        let fields = self.fields;
        while let Some(key) = map.next_key::<String>()? {
            if SMALL_FIELDS.contains(&key.as_str()) { return small(key, map, fields); }
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
        let key = match self.key.take() { Some(key) => Some(key), None => self.map.next_key::<String>()? };
        match key {
            Some(key) if SMALL_FIELDS.contains(&key.as_str()) => Err(de::Error::custom(MIXED)),
            Some(key) => seed.deserialize(key.into_deserializer()).map(Some),
            None => Ok(None),
        }
    }
    fn next_value_seed<V: DeserializeSeed<'de>>(&mut self, seed: V) -> Result<V::Value, Self::Error> { self.map.next_value_seed(seed) }
}

fn small<'de, M: MapAccess<'de>>(first: String, mut map: M, fields: &[&str]) -> Result<LaneSource, M::Error> {
    let (mut start, mut end, mut value): (Option<Expr>, Option<Expr>, Option<Expr>) = (None, None, None);
    let mut max: Option<Option<u64>> = None;
    let mut key = Some(first);
    while let Some(field) = key {
        if fields.contains(&field.as_str()) { return Err(de::Error::custom(MIXED)); }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_derive_fields_are_nonempty_and_disjoint_from_domain_discriminators() {
        let fields = checked_fields(Scan::deserialize(FieldNames).map(|_| ())).unwrap();
        assert!(!fields.is_empty());
        for field in SMALL_FIELDS { assert!(!fields.contains(field), "{field}"); }
    }

    #[test]
    fn unsupported_discovery_refuses_instead_of_panicking() {
        assert_eq!(checked_fields(Ok(())), Err("Scan field discovery unexpectedly succeeded"));
        assert_eq!(checked_fields(Err(ScanFields(&[]))), Err("Scan field discovery returned no fields"));
        for field in SMALL_FIELDS {
            let fields = match *field {
                "start" => &["start"][..], "end_exclusive" => &["end_exclusive"][..],
                "value" => &["value"][..], _ => &["max"][..],
            };
            assert_eq!(checked_fields(Err(ScanFields(fields))), Err("Scan fields overlap range/list lane source fields"));
        }
    }

    #[test]
    fn discovery_includes_derive_renames_and_aliases() {
        #[derive(Deserialize)]
        struct Renamed { #[serde(rename = "renamed", alias = "max")] _field: bool }
        let probe = Renamed::deserialize(FieldNames).map(|_| ());
        assert_eq!(probe.unwrap_err().0, &["max", "renamed"]);
        assert_eq!(checked_fields(Renamed::deserialize(FieldNames).map(|_| ())), Err("Scan fields overlap range/list lane source fields"));
    }
}
