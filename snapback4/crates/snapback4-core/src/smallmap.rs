//! Ordered maps for small collections, stored contiguously in key order.
//! SmallMap/SmallSet are only for sizes bounded by authored schema or program
//! text (columns, tables, arguments, locals, merge lanes, program sites), or
//! a small fixed constant. Collections that grow with rows read or written,
//! groups held or left, principals, pages, requests or time stay BTreeMap/
//! BTreeSet, regardless of wasm byte cost. A runtime meter is not a bound on
//! vector shifts. Server-provided schema/program text is still program text.
//! Lookup is logarithmic; insertion shifts a suffix. Sorted input appends in
//! linear time, but unsorted construction is quadratic: large, randomly
//! mutated or range-scanned collections belong in a BTreeMap.
//! The seven-pair release measurement with `(String, Value)` crossed over
//! between 16 and 32 shuffled fields (1.07x BTreeMap at 32, 3.78x at 1024).
//! Sorted input was faster through 4096 fields. See `tests/smallmap.rs`'s
//! ignored `construction_crossover` measurement; these are workload figures,
//! not a capacity limit or an automatic representation switch.

// @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — small maps share a compact representation on every host without changing ordered JSON.
#[cfg(test)]
thread_local! { pub(crate) static SHIFTED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }

use serde::{Deserialize, Deserializer, Serialize, Serializer, de};
use std::{borrow::Borrow, fmt, marker::PhantomData, ops::Index};

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SmallMap<K, V>(Vec<(K, V)>);

impl<K, V> Default for SmallMap<K, V> { fn default() -> Self { Self::new() } }
impl<K, V> fmt::Debug for SmallMap<K, V> where K: fmt::Debug, V: fmt::Debug {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { f.debug_map().entries(self).finish() }
}

impl<K, V> SmallMap<K, V> {
    pub const fn new() -> Self { Self(Vec::new()) }
    pub fn len(&self) -> usize { self.0.len() }
    pub fn is_empty(&self) -> bool { self.0.is_empty() }
    pub fn clear(&mut self) { self.0.clear(); }
    pub fn iter(&self) -> Iter<'_, K, V> { Iter(self.0.iter()) }
    pub fn iter_mut(&mut self) -> IterMut<'_, K, V> { IterMut(self.0.iter_mut()) }
    pub fn keys(&self) -> impl DoubleEndedIterator<Item = &K> + ExactSizeIterator { self.0.iter().map(|(key, _)| key) }
    pub fn values(&self) -> impl DoubleEndedIterator<Item = &V> + ExactSizeIterator { self.0.iter().map(|(_, value)| value) }
    pub fn values_mut(&mut self) -> impl DoubleEndedIterator<Item = &mut V> + ExactSizeIterator { self.0.iter_mut().map(|(_, value)| value) }
    pub fn into_keys(self) -> impl DoubleEndedIterator<Item = K> + ExactSizeIterator { self.0.into_iter().map(|(key, _)| key) }
    pub fn into_values(self) -> impl DoubleEndedIterator<Item = V> + ExactSizeIterator { self.0.into_iter().map(|(_, value)| value) }
    pub fn first_key_value(&self) -> Option<(&K, &V)> { self.0.first().map(|(key, value)| (key, value)) }
    pub fn last_key_value(&self) -> Option<(&K, &V)> { self.0.last().map(|(key, value)| (key, value)) }
    pub fn retain(&mut self, mut f: impl FnMut(&K, &mut V) -> bool) { self.0.retain_mut(|(key, value)| f(key, value)); }

    fn position<Q: Ord + ?Sized>(&self, key: &Q) -> Result<usize, usize> where K: Borrow<Q> {
        self.0.binary_search_by(|(candidate, _)| candidate.borrow().cmp(key))
    }
    pub fn get<Q: Ord + ?Sized>(&self, key: &Q) -> Option<&V> where K: Borrow<Q> {
        self.position(key).ok().map(|index| &self.0[index].1)
    }
    pub fn get_key_value<Q: Ord + ?Sized>(&self, key: &Q) -> Option<(&K, &V)> where K: Borrow<Q> {
        self.position(key).ok().map(|index| { let (key, value) = &self.0[index]; (key, value) })
    }
    pub fn get_mut<Q: Ord + ?Sized>(&mut self, key: &Q) -> Option<&mut V> where K: Borrow<Q> {
        self.position(key).ok().map(|index| &mut self.0[index].1)
    }
    pub fn contains_key<Q: Ord + ?Sized>(&self, key: &Q) -> bool where K: Borrow<Q> { self.position(key).is_ok() }
    pub fn remove<Q: Ord + ?Sized>(&mut self, key: &Q) -> Option<V> where K: Borrow<Q> {
        self.position(key).ok().map(|index| {
            #[cfg(test)]
            SHIFTED.with(|count| count.set(count.get() + self.0.len() - index - 1));
            self.0.remove(index).1
        })
    }
}

impl<K: Ord, V> SmallMap<K, V> {
    pub fn insert(&mut self, key: K, value: V) -> Option<V> {
        self.insert_pair(key, value, false)
    }
    fn insert_pair(&mut self, key: K, value: V, replace_key: bool) -> Option<V> {
        if self.0.last().is_none_or(|(last, _)| last < &key) {
            self.0.push((key, value));
            return None;
        }
        match self.position(&key) {
            Ok(index) => {
                if replace_key { self.0[index].0 = key; }
                Some(std::mem::replace(&mut self.0[index].1, value))
            }
            Err(index) => {
                #[cfg(test)]
                SHIFTED.with(|count| count.set(count.get() + self.0.len() - index));
                self.0.insert(index, (key, value)); None
            }
        }
    }
    pub fn entry(&mut self, key: K) -> Entry<'_, K, V> {
        let index = self.position(&key);
        Entry { map: self, key, index }
    }
}

pub struct Entry<'a, K, V> { map: &'a mut SmallMap<K, V>, key: K, index: Result<usize, usize> }
impl<'a, K, V> Entry<'a, K, V> {
    pub fn or_insert(self, value: V) -> &'a mut V { self.or_insert_with(|| value) }
    pub fn or_default(self) -> &'a mut V where V: Default { self.or_insert_with(V::default) }
    pub fn or_insert_with(self, f: impl FnOnce() -> V) -> &'a mut V {
        let index = match self.index {
            Ok(index) => index,
            Err(index) => {
                #[cfg(test)]
                SHIFTED.with(|count| count.set(count.get() + self.map.0.len() - index));
                self.map.0.insert(index, (self.key, f())); index
            }
        };
        &mut self.map.0[index].1
    }
    pub fn and_modify(self, f: impl FnOnce(&mut V)) -> Self {
        if let Ok(index) = self.index { f(&mut self.map.0[index].1); }
        self
    }
}

impl<K: Ord, V> Extend<(K, V)> for SmallMap<K, V> {
    fn extend<I: IntoIterator<Item = (K, V)>>(&mut self, iter: I) { for (key, value) in iter { self.insert(key, value); } }
}
impl<K: Ord, V> FromIterator<(K, V)> for SmallMap<K, V> {
    fn from_iter<I: IntoIterator<Item = (K, V)>>(iter: I) -> Self {
        let mut map = Self::new();
        // BTreeMap's bulk constructor keeps the last equal key as well as
        // its value; insert/extend/deserialize keep the original key.
        for (key, value) in iter { map.insert_pair(key, value, true); }
        map
    }
}
impl<K: Ord, V> From<std::collections::BTreeMap<K, V>> for SmallMap<K, V> {
    fn from(map: std::collections::BTreeMap<K, V>) -> Self { Self(map.into_iter().collect()) }
}
impl<K: Ord, V, const N: usize> From<[(K, V); N]> for SmallMap<K, V> {
    fn from(entries: [(K, V); N]) -> Self { entries.into_iter().collect() }
}
impl<K, V, Q: Ord + ?Sized> Index<&Q> for SmallMap<K, V> where K: Borrow<Q> {
    type Output = V;
    fn index(&self, key: &Q) -> &V { self.get(key).expect("no entry found for key") }
}
impl<K, V> IntoIterator for SmallMap<K, V> {
    type Item = (K, V);
    type IntoIter = std::vec::IntoIter<(K, V)>;
    fn into_iter(self) -> Self::IntoIter { self.0.into_iter() }
}
impl<'a, K, V> IntoIterator for &'a SmallMap<K, V> {
    type Item = (&'a K, &'a V);
    type IntoIter = Iter<'a, K, V>;
    fn into_iter(self) -> Self::IntoIter { self.iter() }
}
impl<'a, K, V> IntoIterator for &'a mut SmallMap<K, V> {
    type Item = (&'a K, &'a mut V);
    type IntoIter = IterMut<'a, K, V>;
    fn into_iter(self) -> Self::IntoIter { self.iter_mut() }
}

pub struct Iter<'a, K, V>(std::slice::Iter<'a, (K, V)>);
impl<K, V> Clone for Iter<'_, K, V> { fn clone(&self) -> Self { Self(self.0.clone()) } }
impl<'a, K, V> Iterator for Iter<'a, K, V> {
    type Item = (&'a K, &'a V);
    fn next(&mut self) -> Option<Self::Item> { self.0.next().map(|(key, value)| (key, value)) }
    fn size_hint(&self) -> (usize, Option<usize>) { self.0.size_hint() }
}
impl<K, V> DoubleEndedIterator for Iter<'_, K, V> {
    fn next_back(&mut self) -> Option<Self::Item> { self.0.next_back().map(|(key, value)| (key, value)) }
}
impl<K, V> ExactSizeIterator for Iter<'_, K, V> {}
impl<K, V> std::iter::FusedIterator for Iter<'_, K, V> {}

pub struct IterMut<'a, K, V>(std::slice::IterMut<'a, (K, V)>);
impl<'a, K, V> Iterator for IterMut<'a, K, V> {
    type Item = (&'a K, &'a mut V);
    fn next(&mut self) -> Option<Self::Item> { self.0.next().map(|(key, value)| (&*key, value)) }
    fn size_hint(&self) -> (usize, Option<usize>) { self.0.size_hint() }
}
impl<K, V> DoubleEndedIterator for IterMut<'_, K, V> {
    fn next_back(&mut self) -> Option<Self::Item> { self.0.next_back().map(|(key, value)| (&*key, value)) }
}
impl<K, V> ExactSizeIterator for IterMut<'_, K, V> {}
impl<K, V> std::iter::FusedIterator for IterMut<'_, K, V> {}

impl<K: Serialize, V: Serialize> Serialize for SmallMap<K, V> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> { serializer.collect_map(self) }
}
impl<'de, K: Ord + Deserialize<'de>, V: Deserialize<'de>> Deserialize<'de> for SmallMap<K, V> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Visitor<K, V>(PhantomData<(K, V)>);
        impl<'de, K: Ord + Deserialize<'de>, V: Deserialize<'de>> de::Visitor<'de> for Visitor<K, V> {
            type Value = SmallMap<K, V>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result { f.write_str("a map") }
            fn visit_map<A: de::MapAccess<'de>>(self, mut input: A) -> Result<Self::Value, A::Error> {
                let mut map = SmallMap::new();
                while let Some((key, value)) = input.next_entry()? { map.insert(key, value); }
                Ok(map)
            }
        }
        deserializer.deserialize_map(Visitor(PhantomData))
    }
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SmallSet<K>(SmallMap<K, ()>);
impl<K> Default for SmallSet<K> { fn default() -> Self { Self::new() } }
impl<K: fmt::Debug> fmt::Debug for SmallSet<K> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { f.debug_set().entries(self.iter()).finish() }
}
impl<K> SmallSet<K> {
    pub const fn new() -> Self { Self(SmallMap::new()) }
    pub fn len(&self) -> usize { self.0.len() }
    pub fn is_empty(&self) -> bool { self.0.is_empty() }
    pub fn clear(&mut self) { self.0.clear(); }
    pub fn iter(&self) -> impl DoubleEndedIterator<Item = &K> + ExactSizeIterator { self.0.keys() }
    pub fn first(&self) -> Option<&K> { self.0.first_key_value().map(|(key, _)| key) }
    pub fn last(&self) -> Option<&K> { self.0.last_key_value().map(|(key, _)| key) }
    pub fn contains<Q: Ord + ?Sized>(&self, key: &Q) -> bool where K: Borrow<Q> { self.0.contains_key(key) }
    pub fn remove<Q: Ord + ?Sized>(&mut self, key: &Q) -> bool where K: Borrow<Q> { self.0.remove(key).is_some() }
    pub fn retain(&mut self, mut f: impl FnMut(&K) -> bool) { self.0.retain(|key, _| f(key)); }
}
impl<K: Ord> SmallSet<K> {
    pub fn insert(&mut self, key: K) -> bool { self.0.insert(key, ()).is_none() }
    pub fn is_subset(&self, other: &Self) -> bool { self.iter().all(|key| other.contains(key)) }
    pub fn is_disjoint(&self, other: &Self) -> bool { self.iter().all(|key| !other.contains(key)) }
    pub fn difference<'a>(&'a self, other: &'a Self) -> impl Iterator<Item = &'a K> { self.iter().filter(|key| !other.contains(*key)) }
    pub fn intersection<'a>(&'a self, other: &'a Self) -> impl Iterator<Item = &'a K> { self.iter().filter(|key| other.contains(*key)) }
    pub fn union<'a>(&'a self, other: &'a Self) -> impl Iterator<Item = &'a K> {
        let (mut left, mut right) = (self.iter().peekable(), other.iter().peekable());
        std::iter::from_fn(move || match (left.peek(), right.peek()) {
            (Some(a), Some(b)) => match a.cmp(b) {
                std::cmp::Ordering::Less => left.next(),
                std::cmp::Ordering::Greater => right.next(),
                std::cmp::Ordering::Equal => { right.next(); left.next() }
            },
            (Some(_), None) => left.next(),
            (None, _) => right.next(),
        })
    }
}
impl<K: Ord> Extend<K> for SmallSet<K> { fn extend<I: IntoIterator<Item = K>>(&mut self, iter: I) { for key in iter { self.insert(key); } } }
impl<K: Ord> FromIterator<K> for SmallSet<K> {
    fn from_iter<I: IntoIterator<Item = K>>(iter: I) -> Self { Self(iter.into_iter().map(|key| (key, ())).collect()) }
}
impl<K: Ord, const N: usize> From<[K; N]> for SmallSet<K> { fn from(keys: [K; N]) -> Self { keys.into_iter().collect() } }
impl<K> IntoIterator for SmallSet<K> {
    type Item = K;
    type IntoIter = std::iter::Map<std::vec::IntoIter<(K, ())>, fn((K, ())) -> K>;
    fn into_iter(self) -> Self::IntoIter { self.0.into_iter().map(|(key, _)| key) }
}
impl<'a, K> IntoIterator for &'a SmallSet<K> {
    type Item = &'a K;
    type IntoIter = std::iter::Map<Iter<'a, K, ()>, fn((&'a K, &'a ())) -> &'a K>;
    fn into_iter(self) -> Self::IntoIter { self.0.iter().map(|(key, _)| key) }
}
impl<K: Serialize> Serialize for SmallSet<K> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> { serializer.collect_seq(self.iter()) }
}
impl<'de, K: Ord + Deserialize<'de>> Deserialize<'de> for SmallSet<K> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Visitor<K>(PhantomData<K>);
        impl<'de, K: Ord + Deserialize<'de>> de::Visitor<'de> for Visitor<K> {
            type Value = SmallSet<K>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result { f.write_str("a sequence") }
            fn visit_seq<A: de::SeqAccess<'de>>(self, mut input: A) -> Result<Self::Value, A::Error> {
                let mut set = SmallSet::new();
                while let Some(key) = input.next_element()? { set.insert(key); }
                Ok(set)
            }
        }
        deserializer.deserialize_seq(Visitor(PhantomData))
    }
}
