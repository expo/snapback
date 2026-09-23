//! Kani proofs for the key encoding (`scripts/kani.sh`). Kani checks every
//! value within the bounds below, not a sample. Every harness here verified
//! on 2026-09-23 with Kani 0.68, the slowest in five minutes and under 12 GB.
//!
//! 1. **Bodies.** Text, ids and bytes share one body encoding (`escape`,
//!    `unescape`). Over *arbitrary* byte strings of up to two bytes, so that
//!    `0x00`, `0xFF` and every byte between are in play, the encoding
//!    preserves order and no body's encoding is a proper prefix of another's;
//!    `unescape` inverts `escape` whatever byte follows the body. Over every
//!    four-byte input, `unescape` accepts only bytes that `escape` writes,
//!    without panicking; `key::tests` runs every shorter input.
//! 2. **Integers.** Over every pair of `i64`, a one-component key orders as
//!    the integers do and decodes to itself.
//! 3. **Components.** Two keys of one kind order as the value model does and
//!    neither is a prefix of the other, for nulls, every `bool`, every `i64`
//!    and every byte string of up to two bytes. A key's first byte is its
//!    kind's tag whatever the payload, and the tags sort in the value model's
//!    kind order, which decides every pair of different kinds.
//!
//! **Out of reach, and tested instead.** Any symbolic UTF-8 string, even one
//! byte long, takes CBMC past 40 GB (it explores `from_utf8`'s validation),
//! so text and ids appear here only as literals: they encode as their tag
//! and then the body of layer 1, and `str` orders as its bytes. Harnesses for
//! `rows::scan_range` over a time index (a symbolic `at`, two one-byte ids)
//! ran for an hour on a 12-core host without a verdict. Scans are therefore
//! an exhaustive unit test over a small alphabet of text and boundary
//! integers (`key::tests::scans_hold_exactly_their_bounds`); their byte logic
//! does not depend on the kind, and layers 2 and 3 prove the kinds' order.
//!
//! **What keeps a proof small.** Each value's kind, and each heap payload's
//! length and capacity, is a literal; only contents are symbolic. `String`
//! and `Vec` carry `Value`'s discriminant in a niche of their capacity, so a
//! symbolic capacity, from growth or from a clone, is a symbolic kind. CBMC
//! then explores `Value::Row` and `Value::Map`, whose drop and comparison
//! code recurses through `BTreeMap`s, and the proof does not finish. A loop
//! variable is not folded either: kinds are passed as literals, never taken
//! from a loop. For the same reason `decode` is proved one component at a
//! time (layers 1 and 2), and its output is matched, never compared or
//! dropped. The loop between components is 30 lines: it reads a tag and
//! dispatches to a proved body parser, and none of its indexing can panic.

use super::*;

/// `N` arbitrary bytes. The length is a literal and only the contents are
/// symbolic: a symbolic length makes every slice and copy symbolic in size,
/// and CBMC's formula grows past 30 GB for these few lines.
fn body<const N: usize>() -> Vec<u8> {
    let bytes: [u8; N] = kani::any();
    bytes.to_vec()
}

fn escaped(body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    escape(body, &mut out);
    out
}

fn bodies<const A: usize, const B: usize>() {
    let (a, b) = (body::<A>(), body::<B>());
    let (ea, eb) = (escaped(&a), escaped(&b));
    assert_eq!(ea.cmp(&eb), a.cmp(&b));
    if a != b {
        assert!(!ea.starts_with(&eb) && !eb.starts_with(&ea));
    }
}

fn inverts<const N: usize, const REST: usize>() {
    let (body, rest) = (body::<N>(), body::<REST>());
    let mut bytes = escaped(&body);
    bytes.extend_from_slice(&rest);
    let Some((decoded, tail)) = unescape(&bytes) else { panic!("an escaped body decodes") };
    assert_eq!(decoded, body);
    assert_eq!(tail, rest.as_slice());
}

macro_rules! each_length {
    ($check:ident, $first:literal; $($n:literal),*) => { $( $check::<$first, $n>(); )* };
}

/// Cursors and acquisition boundaries decode bytes that crossed the wire.
fn accepts<const N: usize>() {
    let bytes = body::<N>();
    if let Some((decoded, rest)) = unescape(&bytes) {
        let mut again = escaped(&decoded);
        again.extend_from_slice(rest);
        assert_eq!(again, bytes);
    }
}

/// Every four-byte input; `key::tests` covers every shorter one. One length
/// per harness: several lengths in one harness took CBMC past 40 GB where
/// this one takes about 9 GB and four minutes.
#[kani::proof]
#[kani::unwind(8)]
fn unescape_accepts_only_what_escape_writes() {
    accepts::<4>();
}

#[kani::proof]
#[kani::unwind(10)]
fn bodies_keep_order_and_are_prefix_free() {
    each_length!(bodies, 0; 0, 1, 2);
    each_length!(bodies, 1; 0, 1, 2);
    each_length!(bodies, 2; 0, 1, 2);
}

#[kani::proof]
#[kani::unwind(12)]
fn unescape_inverts_escape_whatever_follows() {
    each_length!(inverts, 0; 0, 1);
    each_length!(inverts, 1; 0, 1);
    each_length!(inverts, 2; 0, 1);
}

/// The decoded values are matched, not compared or dropped: their kind is
/// read from bytes, so `==` and drop would bring in the recursive kinds.
#[kani::proof]
#[kani::unwind(12)]
fn integers_keep_order_and_decode() {
    let (a, b): (i64, i64) = (kani::any(), kani::any());
    let (ea, eb) = (encode(&[Value::Int(a)]), encode(&[Value::Int(b)]));
    assert_eq!(ea.cmp(&eb), a.cmp(&b));
    let decoded = decode(&ea);
    assert!(matches!(decoded.as_deref(), Some([Value::Int(x)]) if *x == a));
    std::mem::forget(decoded);
}

// ---- components ----

/// A scalar of the given kind with a symbolic payload of `N` bytes where the
/// kind has one. `kind` must be a literal where this is called.
fn scalar<const N: usize>(kind: u8) -> Value {
    match kind {
        0 => Value::Null,
        1 => Value::Bool(kani::any()),
        2 => Value::Int(kani::any()),
        _ => Value::Bytes(body::<N>()),
    }
}

/// Calls `$check::<A, B>($args)` for every pair of lengths up to two.
macro_rules! lengths {
    ($check:ident($($arg:expr),*)) => {
        $check::<0, 0>($($arg),*);
        $check::<0, 1>($($arg),*);
        $check::<0, 2>($($arg),*);
        $check::<1, 0>($($arg),*);
        $check::<1, 1>($($arg),*);
        $check::<1, 2>($($arg),*);
        $check::<2, 0>($($arg),*);
        $check::<2, 1>($($arg),*);
        $check::<2, 2>($($arg),*);
    };
}

/// Two values of one kind: byte order is the value model's order, and
/// neither encoding is a proper prefix of the other's.
fn same_kind<const A: usize, const B: usize>(kind: u8) {
    let (a, b) = (scalar::<A>(kind), scalar::<B>(kind));
    let (ea, eb) = (encode(std::slice::from_ref(&a)), encode(std::slice::from_ref(&b)));
    assert_eq!(ea.cmp(&eb), a.total_cmp(&b));
    if a != b {
        assert!(!ea.starts_with(&eb) && !eb.starts_with(&ea));
    }
}

/// Across kinds, order is decided before any payload byte: a key's first
/// byte is its kind's tag whatever the payload, and the tags sort in the
/// value model's kind order (`tags_sort_in_kind_order`). Two byte strings
/// whose first bytes differ are ordered by them, and neither is a prefix of
/// the other, so every pair of different kinds follows.
fn first_byte_is_the_tag<const N: usize>(kind: u8, tag: u8) {
    let value = scalar::<N>(kind);
    let tag = match value {
        Value::Bool(true) => T_TRUE,
        _ => tag,
    };
    assert_eq!(encode(std::slice::from_ref(&value))[0], tag);
}

#[kani::proof]
#[kani::unwind(12)]
fn nulls_bools_and_ints_lead_with_their_tags() {
    first_byte_is_the_tag::<0>(0, T_NULL);
    first_byte_is_the_tag::<0>(1, T_FALSE);
    first_byte_is_the_tag::<0>(2, T_INT);
}

/// One heap payload per harness: several in one harness took CBMC past
/// 40 GB. Empty payloads are covered by `tags_sort_in_kind_order`.
#[kani::proof]
#[kani::unwind(12)]
fn bytes_lead_with_their_tag() {
    first_byte_is_the_tag::<2>(5, T_BYTES);
}

#[kani::proof]
#[kani::unwind(12)]
fn tags_sort_in_kind_order() {
    // Written out, not looped: an index CBMC cannot fold is a symbolic kind.
    let adjacent = |low: Value, high: Value, low_tag: u8, high_tag: u8| {
        assert!(low_tag < high_tag);
        assert_eq!(low.total_cmp(&high), Ordering::Less);
        assert_eq!(encode(std::slice::from_ref(&low))[0], low_tag);
        assert_eq!(encode(std::slice::from_ref(&high))[0], high_tag);
    };
    adjacent(Value::Null, Value::Bool(false), T_NULL, T_FALSE);
    adjacent(Value::Bool(false), Value::Bool(true), T_FALSE, T_TRUE);
    adjacent(Value::Bool(true), Value::Int(0), T_TRUE, T_INT);
    adjacent(Value::Int(0), Value::String(String::new()), T_INT, T_STRING);
    adjacent(Value::String(String::new()), Value::Id(String::new()), T_STRING, T_ID);
    adjacent(Value::Id(String::new()), Value::Bytes(Vec::new()), T_ID, T_BYTES);
}

#[kani::proof]
#[kani::unwind(12)]
fn nulls_and_bools_order_and_are_prefix_free() {
    same_kind::<0, 0>(0);
    same_kind::<0, 0>(1);
}

#[kani::proof]
#[kani::unwind(12)]
fn ints_order_and_are_prefix_free() {
    same_kind::<0, 0>(2);
}

#[kani::proof]
#[kani::unwind(12)]
fn bytes_order_and_are_prefix_free() {
    lengths!(same_kind(5));
}
