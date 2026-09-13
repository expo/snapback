//! Ids: a time-ordered 128-bit form (LLP 3000 §7) that a device mints for
//! its own inserts and the engine mints for its own writes. 48 bits of
//! milliseconds, 80 bits of entropy, spelled as 26 Crockford base32 digits
//! so ids sort as text in the order they were minted.

const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Every new id uses OS entropy, or Web Crypto in a browser. Prediction
/// replay reuses the ids recorded at admission; it never regenerates them.
// @ref LLP 3000#7-decisions-during-execution — all minted ids carry fresh cryptographic entropy
pub fn mint(now_ms: i64, _state: &mut u64) -> Result<String, crate::RuntimeError> {
    let time = (now_ms.max(0) as u128) & ((1u128 << 48) - 1);
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes[6..])
        .map_err(|e| crate::RuntimeError::Store(format!("entropy: {e}")))?;
    let entropy = u128::from_be_bytes(bytes);
    let value = (time << 80) | (entropy & ((1u128 << 80) - 1));
    Ok(encode(value))
}

#[cfg(test)]
fn xorshift(state: &mut u64) -> u64 {
    let mut x = *state;
    if x == 0 {
        x = 0x9E37_79B9_7F4A_7C15;
    }
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    *state = x;
    x
}

fn encode(mut value: u128) -> String {
    let mut out = [b'0'; 26];
    for slot in out.iter_mut().rev() {
        *slot = ALPHABET[(value & 31) as usize];
        value >>= 5;
    }
    String::from_utf8(out.to_vec()).expect("ascii")
}

/// The millisecond an id was minted at, when it has the minted form.
pub fn minted_at(id: &str) -> Option<i64> {
    if id.len() != 26 {
        return None;
    }
    let mut value: u128 = 0;
    for byte in id.bytes() {
        let digit = ALPHABET.iter().position(|c| *c == byte.to_ascii_uppercase())? as u128;
        value = (value << 5) | digit;
    }
    Some((value >> 80) as i64)
}

/// A process seed for deterministic evaluator bookkeeping, never id entropy.
#[cfg(not(target_arch = "wasm32"))]
pub fn seed() -> u64 {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(1);
    let local = 0u8;
    nanos ^ (std::process::id() as u64).rotate_left(32) ^ (&local as *const u8 as u64)
}

/// Web bookkeeping has no host clock or pid. Minting ignores this seed
/// and asks Web Crypto for fresh bytes.
#[cfg(target_arch = "wasm32")]
pub fn seed() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static CALLS: AtomicU64 = AtomicU64::new(0x9E37_79B9_7F4A_7C15);
    let local = 0u8;
    CALLS.fetch_add(0x9E37_79B9_7F4A_7C15, Ordering::Relaxed) ^ (&local as *const u8 as u64).rotate_left(17)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_sort_by_time_and_carry_it() {
        let mut state = 7;
        let a = mint(1_000, &mut state).unwrap();
        let b = mint(2_000, &mut state).unwrap();
        let c = mint(2_000, &mut state).unwrap();
        assert!(a < b);
        assert_ne!(b, c);
        assert_eq!(minted_at(&a), Some(1_000));
        assert_eq!(minted_at(&c), Some(2_000));
        assert_eq!(a.len(), 26);
    }

    #[test]
    fn observing_an_id_does_not_predict_the_next() {
        let a = mint(1_000, &mut 7).unwrap();
        let b = mint(2_000, &mut 7).unwrap();
        let bits = a.bytes().fold(0u128, |v, b| {
            (v << 5) | ALPHABET.iter().position(|x| *x == b).unwrap() as u128
        });
        let mut recovered = (bits >> 16) as u64;
        xorshift(&mut recovered);
        let predicted = (u128::from(xorshift(&mut recovered)) << 16)
            | u128::from(xorshift(&mut recovered) & 0xffff);
        assert_ne!(b, encode((2_000u128 << 80) | predicted));
        assert_ne!(mint(1_000, &mut 7).unwrap(), a);
    }
}
