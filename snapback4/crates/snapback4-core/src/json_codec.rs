//! One typed JSON family per direction. Text keeps declaration order (schema
//! and backend identities, cursor tokens), duplicate-field refusal and error
//! positions, without an intermediate tree on durable row loads. Already-parsed
//! dispatch values are consumed and rendered once, then freed before decode;
//! page commands deserialize directly from their original text.
//! Counting, bounded discovery keys and cursor hashing share one erased sink;
//! none adds a result-sized scratch buffer. Derives still define every type.
// @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — consolidate serde instantiations without changing canonical bytes.
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Error, Value};

pub fn from_text<'de, T: Deserialize<'de>>(text: &'de str) -> Result<T, Error> {
    serde_json::from_str(text)
}

// A typed derive skips unknown fields with IgnoredAny, which accepts out-of-range
// numbers, unpaired surrogates and deeper nesting than a JSON tree does. Validate
// the original command with deserialize_any, as the old tree entry point did,
// but discard values instead of allocating another page. This is JSON validation,
// not a second decoder for StreamPage or any other derived Snapback type.
pub fn validate_text(text: &str) -> Result<(), Error> {
    struct Checked;
    impl<'de> Deserialize<'de> for Checked {
        fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
            struct Visitor;
            impl<'de> serde::de::Visitor<'de> for Visitor {
                type Value = Checked;
                fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result { f.write_str("a JSON value") }
                fn visit_unit<E: serde::de::Error>(self) -> Result<Checked, E> { Ok(Checked) }
                fn visit_bool<E: serde::de::Error>(self, _: bool) -> Result<Checked, E> { Ok(Checked) }
                fn visit_i64<E: serde::de::Error>(self, _: i64) -> Result<Checked, E> { Ok(Checked) }
                fn visit_u64<E: serde::de::Error>(self, _: u64) -> Result<Checked, E> { Ok(Checked) }
                fn visit_f64<E: serde::de::Error>(self, _: f64) -> Result<Checked, E> { Ok(Checked) }
                fn visit_str<E: serde::de::Error>(self, _: &str) -> Result<Checked, E> { Ok(Checked) }
                fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut seq: A) -> Result<Checked, A::Error> {
                    while seq.next_element::<Checked>()?.is_some() {} Ok(Checked)
                }
                fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> Result<Checked, A::Error> {
                    while map.next_key::<Checked>()?.is_some() { map.next_value::<Checked>()?; } Ok(Checked)
                }
            }
            deserializer.deserialize_any(Visitor)
        }
    }
    from_text::<Checked>(text).map(|_| ())
}

pub fn from_value<T: DeserializeOwned>(value: Value) -> Result<T, Error> {
    let text = value.to_string();
    drop(value);
    from_owned_text(&text).map_err(argument_error)
}

// Owned trees have already been constructed, without the text parser's depth
// limit. Keep that contract only for these adapters; host text stays bounded.
#[cfg(not(target_arch = "wasm32"))]
fn from_owned_text<T: DeserializeOwned>(text: &str) -> Result<T, Error> {
    let mut reader = serde_json::Deserializer::from_str(text);
    reader.disable_recursion_limit();
    let value = T::deserialize(&mut reader)?;
    reader.end()?;
    Ok(value)
}

#[cfg(target_arch = "wasm32")]
fn from_owned_text<T: DeserializeOwned>(text: &str) -> Result<T, Error> { from_text(text) }

// A normalized tree has no source location. Keep from_value's error contract,
// rather than pointing into a newly rendered string the caller never sent.
fn argument_error(error: Error) -> Error {
    let message = error.to_string();
    let position = format!(" at line {} column {}", error.line(), error.column());
    <Error as serde::de::Error>::custom(message.strip_suffix(&position).unwrap_or(&message))
}

pub fn to_text<T: Serialize + ?Sized>(value: &T) -> Result<String, Error> {
    serde_json::to_string(value)
}

/// Serialize into one allocation whose requested capacity is the exact encoded
/// length. The bounded writer makes a stale preflight fail instead of growing
/// the buffer beyond the caller's prepaid allocation.
pub fn to_text_preallocated<T: Serialize + ?Sized>(value: &T, bytes: usize) -> Result<String, Error> {
    struct ExactBuffer {
        bytes: Vec<u8>,
        limit: usize,
    }
    impl std::io::Write for ExactBuffer {
        fn write(&mut self, input: &[u8]) -> std::io::Result<usize> {
            if input.len() > self.limit.saturating_sub(self.bytes.len()) {
                return Err(std::io::Error::new(std::io::ErrorKind::WriteZero, "JSON exceeded its prepaid length"));
            }
            self.bytes.extend_from_slice(input);
            Ok(input.len())
        }
        fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
    }

    let mut out = ExactBuffer { bytes: Vec::with_capacity(bytes), limit: bytes };
    to_sink(&mut out, value)?;
    if out.bytes.len() != bytes {
        return Err(<Error as serde::ser::Error>::custom("JSON did not fill its prepaid length"));
    }
    Ok(String::from_utf8(out.bytes).expect("serde_json always writes UTF-8"))
}

pub fn to_value<T: Serialize + ?Sized>(value: &T) -> Result<Value, Error> {
    from_owned_text(&to_text(value)?)
}

pub fn from_slice<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, Error> {
    let text = std::str::from_utf8(bytes).map_err(|e| <Error as serde::de::Error>::custom(e))?;
    from_text(text)
}

pub fn to_vec<T: Serialize + ?Sized>(value: &T) -> Result<Vec<u8>, Error> {
    to_text(value).map(String::into_bytes)
}

/// Serialize into prepaid capacity with the same Vec writer as to_text.
pub fn to_buffer<T: Serialize + ?Sized>(buffer: &mut Vec<u8>, value: &T) -> Result<(), Error> {
    serde_json::to_writer(buffer, value)
}

/// Serialize into a caller's writer (a counting sink prices an image without a buffer).
pub fn to_writer<W: std::io::Write, T: Serialize + ?Sized>(writer: W, value: &T) -> Result<(), Error> {
    serde_json::to_writer(writer, value)
}

/// Erase only the allocation-free/bounded sink, so counting, exact-capacity
/// discovery keys and cursor hashing share one serializer instantiation.
// @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — one bounded sink family, no additional decoded representations.
pub fn to_sink<T: Serialize + ?Sized>(writer: &mut dyn std::io::Write, value: &T) -> Result<(), Error> {
    serde_json::to_writer(writer, value)
}

/// The meter's exact tagged byte count, without a second result-sized value.
pub fn value_bytes(value: &crate::value::Value) -> Result<u64, Error> {
    struct Counter(u64);
    impl std::io::Write for Counter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> { self.0 = self.0.saturating_add(bytes.len() as u64); Ok(bytes.len()) }
        fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
    }
    let mut count = Counter(0);
    to_sink(&mut count, value)?;
    Ok(count.0)
}

#[cfg(test)]
mod sink_tests {
    use super::*;
    #[test]
    fn shared_sink_preserves_escaped_bytes_and_prepaid_refusals() {
        let value = crate::value::Value::String("line\n\"\\é".into());
        let expected = to_text(&value).unwrap();
        let bytes = value_bytes(&value).unwrap() as usize;
        assert_eq!(bytes, expected.len());
        assert_eq!(to_text_preallocated(&value, bytes).unwrap(), expected);
        assert!(to_text_preallocated(&value, bytes - 1).unwrap_err().to_string().contains("exceeded"));
        assert!(to_text_preallocated(&value, bytes + 1).unwrap_err().to_string().contains("did not fill"));
        struct Failed;
        impl std::io::Write for Failed {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> { Err(std::io::Error::other("sink refused")) }
            fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
        }
        assert!(to_sink(&mut Failed, &value).unwrap_err().to_string().contains("sink refused"));
    }
}
