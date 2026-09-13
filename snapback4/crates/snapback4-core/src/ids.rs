//! Ids: a time-ordered 128-bit form (LLP 3000 §7) that a device mints for
//! its own inserts and the engine mints for its own writes. 48 bits of
//! milliseconds, 80 bits of entropy, spelled as 26 Crockford base32 digits
//! so ids sort as text in the order they were minted.

const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Mint one id at `now_ms` with the caller's entropy state.
pub fn mint(now_ms: i64, state: &mut u64) -> String {
    let time = (now_ms.max(0) as u128) & ((1u128 << 48) - 1);
    let entropy = (u128::from(xorshift(state)) << 16) ^ u128::from(xorshift(state) & 0xFFFF);
    let value = (time << 80) | (entropy & ((1u128 << 80) - 1));
    encode(value)
}

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

/// Entropy for a process: the clock, the pid and the address of a stack slot.
#[cfg(not(target_arch = "wasm32"))]
pub fn seed() -> u64 {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(1);
    let local = 0u8;
    nanos ^ (std::process::id() as u64).rotate_left(32) ^ (&local as *const u8 as u64)
}

/// On the web there is no clock or pid to ask without the host: a counter
/// and a stack address, distinct per call; a device's ids take their
/// entropy from the host in any case (`Context::with_entropy`).
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
        let a = mint(1_000, &mut state);
        let b = mint(2_000, &mut state);
        let c = mint(2_000, &mut state);
        assert!(a < b);
        assert_ne!(b, c);
        assert_eq!(minted_at(&a), Some(1_000));
        assert_eq!(minted_at(&c), Some(2_000));
        assert_eq!(a.len(), 26);
    }
}
