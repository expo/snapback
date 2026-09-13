//! One order-preserving byte encoding for index keys, used by the SQLite
//! store on the server and (in week 3) by the IndexedDB store on a device,
//! so both hosts scan the same bytes in the same order: the value model's
//! total order (`Value::total_cmp`), with one tag byte per component and a
//! self-terminating body, so an encoded prefix is a byte prefix of every key
//! that extends it.

use crate::value::Value;
use std::cmp::Ordering;

const T_NULL: u8 = 0x01;
const T_FALSE: u8 = 0x02;
const T_TRUE: u8 = 0x03;
const T_INT: u8 = 0x04;
const T_STRING: u8 = 0x05;
const T_ID: u8 = 0x06;
const T_BYTES: u8 = 0x07;
/// Greater than any tag: the exclusive upper bound of a prefix range.
const T_END: u8 = 0xFF;

/// Encode a tuple of scalar components. Rows, arrays and maps are not index
/// components (the schema refuses them), so they encode as their canonical
/// JSON text to keep the function total.
pub fn encode(values: &[Value]) -> Vec<u8> {
    let mut out = Vec::with_capacity(values.len() * 12);
    for value in values {
        encode_one(value, &mut out);
    }
    out
}

fn encode_one(value: &Value, out: &mut Vec<u8>) {
    match value {
        Value::Null => out.push(T_NULL),
        Value::Bool(false) => out.push(T_FALSE),
        Value::Bool(true) => out.push(T_TRUE),
        Value::Int(int) => {
            out.push(T_INT);
            // Flip the sign bit so two's complement sorts as unsigned bytes.
            out.extend_from_slice(&((*int as u64) ^ (1 << 63)).to_be_bytes());
        }
        Value::String(text) => {
            out.push(T_STRING);
            escape(text.as_bytes(), out);
        }
        Value::Id(id) => {
            out.push(T_ID);
            escape(id.as_bytes(), out);
        }
        Value::Bytes(bytes) => {
            out.push(T_BYTES);
            escape(bytes, out);
        }
        other => {
            out.push(T_STRING);
            escape(crate::value::canonical_json(other).as_bytes(), out);
        }
    }
}

/// `0x00` inside a body becomes `0x00 0xFF`; the body ends with `0x00 0x00`.
/// A shorter string is therefore a prefix in bytes, then terminates earlier,
/// which preserves lexicographic order.
fn escape(bytes: &[u8], out: &mut Vec<u8>) {
    for byte in bytes {
        if *byte == 0 {
            out.extend_from_slice(&[0x00, 0xFF]);
        } else {
            out.push(*byte);
        }
    }
    out.extend_from_slice(&[0x00, 0x00]);
}

/// The exclusive upper bound of every key that extends `prefix`.
pub fn upper_bound(prefix: &[u8]) -> Vec<u8> {
    let mut out = prefix.to_vec();
    out.push(T_END);
    out
}

/// The range of every key whose next component is a string that starts
/// with `word`, after the encoded `base`: a word-prefix scan. The lower
/// bound is the string tag and the escaped body without its terminator, so
/// it is a byte prefix of `word` itself and of every longer word; a byte
/// `0xFF` never occurs in UTF-8 or in the escaping, so `lo ++ 0xFF` bounds
/// exactly those keys.
pub fn word_range(base: &[u8], word: &str) -> (Vec<u8>, Vec<u8>) {
    let mut lo = base.to_vec();
    lo.push(T_STRING);
    for byte in word.as_bytes() {
        if *byte == 0 {
            lo.extend_from_slice(&[0x00, 0xFF]);
        } else {
            lo.push(*byte);
        }
    }
    let hi = upper_bound(&lo);
    (lo, hi)
}

/// Decode the components back (needed for cursors minted from stored keys).
pub fn decode(mut bytes: &[u8]) -> Option<Vec<Value>> {
    let mut out = Vec::new();
    while let Some((&tag, rest)) = bytes.split_first() {
        bytes = rest;
        out.push(match tag {
            T_NULL => Value::Null,
            T_FALSE => Value::Bool(false),
            T_TRUE => Value::Bool(true),
            T_INT => {
                let (head, rest) = bytes.split_at_checked(8)?;
                bytes = rest;
                let raw = u64::from_be_bytes(head.try_into().ok()?) ^ (1 << 63);
                Value::Int(raw as i64)
            }
            T_STRING | T_ID | T_BYTES => {
                let (body, rest) = unescape(bytes)?;
                bytes = rest;
                match tag {
                    T_STRING => Value::String(String::from_utf8(body).ok()?),
                    T_ID => Value::Id(String::from_utf8(body).ok()?),
                    _ => Value::Bytes(body),
                }
            }
            _ => return None,
        });
    }
    Some(out)
}

fn unescape(bytes: &[u8]) -> Option<(Vec<u8>, &[u8])> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0 {
            match bytes.get(i + 1)? {
                0xFF => {
                    out.push(0);
                    i += 2;
                }
                0x00 => return Some((out, &bytes[i + 2..])),
                _ => return None,
            }
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    None
}

/// The encoding agrees with the value model's order on every pair.
pub fn agrees(left: &[Value], right: &[Value]) -> bool {
    let by_values = left.iter().zip(right).find_map(|(a, b)| match a.total_cmp(b) {
        Ordering::Equal => None,
        other => Some(other),
    }).unwrap_or_else(|| left.len().cmp(&right.len()));
    encode(left).cmp(&encode(right)) == by_values
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(items: &[Value]) -> Vec<Value> {
        items.to_vec()
    }

    #[test]
    fn order_matches_the_value_model() {
        let samples = [
            v(&[Value::Null]),
            v(&[Value::Bool(false)]),
            v(&[Value::Bool(true)]),
            v(&[Value::Int(-5)]),
            v(&[Value::Int(0)]),
            v(&[Value::Int(7)]),
            v(&[Value::Int(1 << 52)]),
            v(&[Value::String("".into())]),
            v(&[Value::String("a".into())]),
            v(&[Value::String("a\u{0}b".into())]),
            v(&[Value::String("ab".into())]),
            v(&[Value::String("b".into())]),
            v(&[Value::Id("a".into())]),
            v(&[Value::Id("a".into()), Value::Int(1)]),
            v(&[Value::Id("a".into()), Value::Int(2)]),
            v(&[Value::Id("b".into())]),
            v(&[Value::Bytes(vec![0, 1])]),
        ];
        for left in &samples {
            for right in &samples {
                assert!(agrees(left, right), "{left:?} vs {right:?}");
            }
        }
    }

    #[test]
    fn prefix_ranges_contain_exactly_their_extensions() {
        let prefix = encode(&[Value::Id("c1".into())]);
        let inside = encode(&[Value::Id("c1".into()), Value::Int(5), Value::Id("m".into())]);
        let outside = encode(&[Value::Id("c10".into()), Value::Int(5)]);
        assert!(inside.starts_with(&prefix));
        assert!(!outside.starts_with(&prefix));
        assert!(inside < upper_bound(&prefix));
        assert!(outside > upper_bound(&prefix));
    }

    #[test]
    fn round_trips() {
        let tuple = v(&[Value::Id("x\u{0}y".into()), Value::Int(-1), Value::Null, Value::Bool(true), Value::String("s".into()), Value::Bytes(vec![0, 0, 1])]);
        assert_eq!(decode(&encode(&tuple)), Some(tuple));
    }
}
