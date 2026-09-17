use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

pub fn serialize<S: Serializer>(value: &Value, serializer: S) -> Result<S::Ok, S::Error> {
    if serializer.is_human_readable() { value.serialize(serializer) }
    else { serializer.serialize_str(&crate::json_codec::to_text(value).map_err(serde::ser::Error::custom)?) }
}
pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Value, D::Error> {
    if deserializer.is_human_readable() { Value::deserialize(deserializer) }
    else { crate::json_codec::from_text(&String::deserialize(deserializer)?).map_err(serde::de::Error::custom) }
}
