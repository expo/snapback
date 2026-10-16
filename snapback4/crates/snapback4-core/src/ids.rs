//! Ids: a time-ordered 128-bit form (LLP 3000 §7) that a device mints for
//! its own inserts and the engine mints for its own writes. 48 bits of
//! milliseconds, 80 bits of entropy, spelled as 26 Crockford base32 digits
//! so ids sort as text in mint order within one live context.

const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// One live minting context. Clones share the stream, including failed writes
/// and transaction retries; a new context starts with independent OS/Web Crypto
/// entropy. This state is not a capability and is not persisted across restarts.
#[derive(Clone, Debug, Default)]
pub struct Mint(std::sync::Arc<std::sync::Mutex<Option<u128>>>);

/// Monotonic ULID mode. Clock rollback retains the greatest observed timestamp;
/// equal timestamps increment the 80-bit suffix, refusing instead of wrapping.
/// Signed host samples before the Unix epoch normalize to zero, as before.
// @ref LLP 3000.000.001#2-contract — order belongs to one live minting context
pub fn mint(now_ms: i64, state: &mut Mint) -> Result<String, crate::RuntimeError> {
    let now_ms = now_ms.max(0);
    if now_ms > (1_i64 << 48) - 1 {
        return Err(crate::RuntimeError::Input("id time must be from 0 through 2^48-1 milliseconds".into()));
    }
    let mut last = state.0.lock().map_err(|_| crate::RuntimeError::Store("id mint context poisoned".into()))?;
    let time = now_ms as u128;
    let value = match *last {
        Some(previous) if time <= previous >> 80 => {
            if previous & ((1_u128 << 80) - 1) == (1_u128 << 80) - 1 {
                return Err(crate::RuntimeError::Input("id mint exhausted 80-bit entropy within one logical millisecond; advance the clock".into()));
            }
            previous + 1
        }
        _ => {
            let mut bytes = [0_u8; 16];
            getrandom::fill(&mut bytes[6..])
                .map_err(|e| crate::RuntimeError::Store(format!("entropy: {e}")))?;
            (time << 80) | u128::from_be_bytes(bytes)
        }
    };
    *last = Some(value);
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

/// The logical millisecond encoded by an id in the minted form. Clock
/// rollback retains the context's high-water mark rather than wall time.
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

/// Web bookkeeping has no host clock or pid. Minting uses its separate
/// context and Web Crypto, never this seed.
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
        let mut state = Mint::default();
        let a = mint(1_000, &mut state).unwrap();
        let b = mint(2_000, &mut state).unwrap();
        let c = mint(2_000, &mut state).unwrap();
        assert!(a < b);
        assert!(b < c);
        assert_eq!(minted_at(&a), Some(1_000));
        assert_eq!(minted_at(&c), Some(2_000));
        assert_eq!(a.len(), 26);
    }

    #[test]
    fn same_millisecond_burst_and_clock_rollback_are_strictly_ordered() {
        let mut state = Mint::default();
        let mut previous = mint(2_000, &mut state).unwrap();
        let mut clone = state.clone();
        for i in 0..1_000 {
            let next = mint(if i % 2 == 0 { 2_000 } else { 1_000 }, &mut clone).unwrap();
            assert!(previous < next);
            assert_eq!(minted_at(&next), Some(2_000));
            previous = next;
        }
        let next = mint(2_001, &mut state).unwrap();
        assert!(previous < next);
        assert_eq!(minted_at(&next), Some(2_001));
    }

    #[test]
    fn overflow_refuses_without_wrapping_or_changing_state() {
        let mut state = Mint::default();
        let maximum = (42_u128 << 80) | ((1_u128 << 80) - 1);
        *state.0.lock().unwrap() = Some(maximum);
        for now in [42, 41] {
            assert!(mint(now, &mut state).is_err());
            assert_eq!(*state.0.lock().unwrap(), Some(maximum));
        }
        assert!(encode(maximum) < mint(43, &mut state).unwrap());
    }

    #[test]
    fn invalid_timestamps_refuse_without_changing_state() {
        let mut state = Mint::default();
        for now in [1_i64 << 48, i64::MAX] { assert!(mint(now, &mut state).is_err()); }
        assert!(state.0.lock().unwrap().is_none());
        assert_eq!(minted_at(&mint((1_i64 << 48) - 1, &mut state).unwrap()), Some((1_i64 << 48) - 1));
    }

    #[test]
    fn negative_host_clocks_normalize_before_monotonic_comparison() {
        let mut state = Mint::default();
        let mut previous = mint(i64::MIN, &mut state).unwrap();
        assert_eq!(minted_at(&previous), Some(0));
        for now in [-100, -1, 0] {
            let next = mint(now, &mut state).unwrap();
            assert!(previous < next);
            assert_eq!(minted_at(&next), Some(0));
            previous = next;
        }
        let positive = mint(1, &mut state).unwrap();
        assert!(previous < positive);
        let backdated = mint(i64::MIN, &mut state).unwrap();
        assert!(positive < backdated);
        assert_eq!(minted_at(&backdated), Some(1));
    }

    #[test]
    fn advanced_timestamps_start_with_independent_crypto_entropy() {
        let a = mint(1_000, &mut Mint::default()).unwrap();
        let b = mint(2_000, &mut Mint::default()).unwrap();
        let bits = a.bytes().fold(0u128, |v, b| {
            (v << 5) | ALPHABET.iter().position(|x| *x == b).unwrap() as u128
        });
        let mut recovered = (bits >> 16) as u64;
        xorshift(&mut recovered);
        let predicted = (u128::from(xorshift(&mut recovered)) << 16)
            | u128::from(xorshift(&mut recovered) & 0xffff);
        assert_ne!(b, encode((2_000u128 << 80) | predicted));
        assert_ne!(mint(1_000, &mut Mint::default()).unwrap(), a);
    }
}
