//! Index tails share a row's encoded id. The ordering is still the complete
//! core key, byte for byte; no index, tie breaker or cursor component is lost.
use std::{cmp::Ordering, rc::Rc};
type Tail = Rc<Box<[u8]>>;

#[derive(Clone, Debug)]
pub(super) struct Key {
    head: Box<[u8]>,
    tail: Option<Tail>,
}
impl Key {
    pub fn plain(bytes: &[u8]) -> Self { Self { head: bytes.into(), tail: None } }
    pub fn packed(mut bytes: Vec<u8>, tails: &(Tail, Tail)) -> Self {
        let tail = if bytes.ends_with(&tails.1) { &tails.1 } else { &tails.0 };
        debug_assert!(bytes.ends_with(tail));
        bytes.truncate(bytes.len() - tail.len());
        Self { head: bytes.into_boxed_slice(), tail: Some(tail.clone()) }
    }
    pub fn tails(id: &str) -> (Tail, Tail) {
        let one = snapback4_core::key::encode(&[snapback4_core::value::Value::Id(id.into())]);
        let mut two = one.clone(); two.extend_from_slice(&one);
        (Rc::new(one.into_boxed_slice()), Rc::new(two.into_boxed_slice()))
    }
    fn suffix(&self) -> &[u8] { self.tail.as_ref().map_or(&[], |tail| tail.as_ref().as_ref()) }
    pub fn len(&self) -> usize { self.head.len() + self.suffix().len() }
    pub fn bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(self.head.len() + self.suffix().len());
        bytes.extend_from_slice(&self.head); bytes.extend_from_slice(self.suffix()); bytes
    }
}
impl Ord for Key {
    fn cmp(&self, other: &Self) -> Ordering {
        let (mut a, mut b) = (self.head.as_ref(), other.head.as_ref());
        let (mut at, mut bt) = (Some(self.suffix()), Some(other.suffix()));
        loop {
            if a.is_empty() { if let Some(tail) = at.take() { a = tail; } }
            if b.is_empty() { if let Some(tail) = bt.take() { b = tail; } }
            if a.is_empty() || b.is_empty() { return a.len().cmp(&b.len()); }
            let n = a.len().min(b.len());
            let order = a[..n].cmp(&b[..n]);
            if order != Ordering::Equal { return order; }
            a = &a[n..]; b = &b[n..];
        }
    }
}
impl PartialOrd for Key { fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.cmp(other)) } }
impl PartialEq for Key { fn eq(&self, other: &Self) -> bool { self.cmp(other) == Ordering::Equal } }
impl Eq for Key {}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn split_keys_order_exactly_like_complete_bytes() {
        let mut values = Vec::new();
        for id in ["", "a", "a\0", "a\0z", "é", "zz"] {
            let tails = Key::tails(id);
            for prefix in [vec![], vec![0], vec![5, 255], vec![255; 30]] {
                for tail in [&tails.0, &tails.1] {
                    let mut full = prefix.clone(); full.extend_from_slice(tail);
                    let packed = Key::packed(full.clone(), &tails);
                    assert_eq!(packed.bytes(), full);
                    values.push((full.clone(), packed)); values.push((full.clone(),Key::plain(&full)));
                }
            }
        }
        for (a,pa) in &values { for (b,pb) in &values { assert_eq!(a.cmp(b),pa.cmp(pb)); } }
    }
}
