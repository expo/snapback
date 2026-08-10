//! Shared canonical JSON and identity shapes used across owner boundaries.
//!
//! The resumable-query engine re-exports this surface for compatibility, while
//! kernel and contract callers depend directly on this leaf.
//!
//! @ref LLP 0225#1-ownership-map — shared contract/types are the canonical
//!   downward dependency for the kernel and domain services.

use std::cmp::Ordering;

use serde_json::Value;
use sha2::{Digest as _, Sha256};

/// A value the 0A contract refuses at mint time: the subscription simply
/// gets no token (`resume` absent), never a wrong digest (LLP 0091 §0A.2).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MintRefusal {
    NonFiniteNumber,
    UnsafeInteger,
    RowIdMissing,
    RowIdDuplicate,
}

// ---------------------------------------------------------------------------
// RFC 8785 (JCS) canonicalization
// ---------------------------------------------------------------------------

/// ECMAScript `Number::toString` for a finite double — the RFC 8785 number
/// serialization. Rust's `Display` already yields the shortest round-trip
/// digits without an exponent; this reformats them under the ECMAScript
/// thresholds (decimal for 1e-6 ≤ |x| < 1e21, exponent form outside).
pub(crate) fn ecma_number_string(value: f64) -> Result<String, MintRefusal> {
    if !value.is_finite() {
        return Err(MintRefusal::NonFiniteNumber);
    }
    if value == 0.0 {
        // Negative zero serializes as "0" (JCS; matches `canonicalValue`).
        return Ok("0".to_owned());
    }
    let negative = value < 0.0;
    let magnitude = format!("{}", value.abs());
    let (int_part, frac_part) = match magnitude.split_once('.') {
        Some((int_part, frac_part)) => (int_part, frac_part),
        None => (magnitude.as_str(), ""),
    };
    let all: String = format!("{int_part}{frac_part}");
    let first = all
        .find(|c: char| c != '0')
        .expect("nonzero float has a nonzero digit");
    let last = all.rfind(|c: char| c != '0').expect("nonzero digit exists");
    let digits = &all[first..=last];
    // value = 0.digits × 10^n
    let n = int_part.len() as i64 - first as i64;
    let k = digits.len() as i64;
    let mut out = String::new();
    if negative {
        out.push('-');
    }
    if k <= n && n <= 21 {
        out.push_str(digits);
        for _ in 0..(n - k) {
            out.push('0');
        }
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        for _ in 0..(-n) {
            out.push('0');
        }
        out.push_str(digits);
    } else {
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        let exponent = n - 1;
        if exponent >= 0 {
            out.push('+');
        }
        out.push_str(&exponent.to_string());
    }
    Ok(out)
}

pub(crate) fn jcs_escape_into(out: &mut String, s: &str) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Compare strings by UTF-16 code units — RFC 8785's member-name ordering.
/// (Rust's native `str` ordering is by Unicode scalar value, which sorts
/// supplementary-plane characters *after* U+E000..U+FFFF; UTF-16 code-unit
/// order sorts their surrogates before, so the two orders differ exactly
/// where JCS says they must not.)
pub(crate) fn cmp_utf16(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

pub(crate) fn jcs_into(out: &mut String, value: &Value) -> Result<(), MintRefusal> {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::Number(number) => {
            if let Some(unsigned) = number.as_u64() {
                if unsigned > 9_007_199_254_740_991 {
                    return Err(MintRefusal::UnsafeInteger);
                }
                out.push_str(&unsigned.to_string());
            } else if let Some(signed) = number.as_i64() {
                if signed < -9_007_199_254_740_991 {
                    return Err(MintRefusal::UnsafeInteger);
                }
                out.push_str(&signed.to_string());
            } else if let Some(float) = number.as_f64() {
                // Integral doubles in the (2^53-1, 1e21) band serialize as
                // full decimal digits indistinguishable from lossy big
                // integers on the JS arm, so BOTH arms refuse the band —
                // the cross-language sharpening of LLP 0091 §0A.2's
                // ">2^53-1 integer" refusal (at and above 1e21 the ES
                // exponent form is canonical and unambiguously a double).
                if float.fract() == 0.0
                    && float.abs() > 9_007_199_254_740_991.0
                    && float.abs() < 1e21
                {
                    return Err(MintRefusal::UnsafeInteger);
                }
                out.push_str(&ecma_number_string(float)?);
            } else {
                return Err(MintRefusal::NonFiniteNumber);
            }
        }
        Value::String(s) => jcs_escape_into(out, s),
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                jcs_into(out, item)?;
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|a, b| cmp_utf16(a, b));
            out.push('{');
            for (index, key) in keys.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                jcs_escape_into(out, key);
                out.push(':');
                jcs_into(out, &map[key.as_str()])?;
            }
            out.push('}');
        }
    }
    Ok(())
}

/// RFC 8785 canonical serialization (LLP 0091 §0A.2). Lone surrogates cannot
/// occur in a Rust `String`, so that mint-refusal arm is structurally
/// discharged on this side; the JS arm must refuse them explicitly.
pub fn jcs(value: &Value) -> Result<String, MintRefusal> {
    let mut out = String::new();
    jcs_into(&mut out, value)?;
    Ok(out)
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

pub fn sha256_identity(value: &Value) -> Result<String, MintRefusal> {
    Ok(format!(
        "sha256:{}",
        hex(&Sha256::digest(jcs(value)?.as_bytes()))
    ))
}
