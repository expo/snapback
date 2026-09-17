//! Shared images, with schema-shaped rows small and arbitrary JSON maps in
//! B-trees. Both keep the same object serialization and logical heap charge.
use super::Value;
use crate::smallmap::SmallMap;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, ops::{Deref, DerefMut}, sync::Arc};

// @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — JSON keys are data-sized; only row columns have the schema bound.
pub type ObjectFields = SharedFields<SmallMap<String, Value>>;
pub type MapFields = SharedFields<BTreeMap<String, Value>>;
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct SharedFields<M>(Arc<M>);
impl<M> From<M> for SharedFields<M> { fn from(value: M) -> Self { Self(Arc::new(value)) } }
impl From<BTreeMap<String, Value>> for ObjectFields { fn from(value: BTreeMap<String, Value>) -> Self { value.into_iter().collect() } }
impl From<SmallMap<String, Value>> for MapFields { fn from(value: SmallMap<String, Value>) -> Self { value.into_iter().collect() } }
impl<M: FromIterator<(String, Value)>> FromIterator<(String, Value)> for SharedFields<M> {
    fn from_iter<T: IntoIterator<Item = (String, Value)>>(iter: T) -> Self { M::from_iter(iter).into() }
}
impl<M> Deref for SharedFields<M> { type Target = M; fn deref(&self) -> &M { &self.0 } }
impl<M: Clone> DerefMut for SharedFields<M> { fn deref_mut(&mut self) -> &mut M { Arc::make_mut(&mut self.0) } }
impl<M: Clone + IntoIterator> IntoIterator for SharedFields<M> {
    type Item = M::Item; type IntoIter = M::IntoIter;
    fn into_iter(self) -> Self::IntoIter { Arc::unwrap_or_clone(self.0).into_iter() }
}
impl<'a, M> IntoIterator for &'a SharedFields<M> where &'a M: IntoIterator {
    type Item = <&'a M as IntoIterator>::Item; type IntoIter = <&'a M as IntoIterator>::IntoIter;
    fn into_iter(self) -> Self::IntoIter { self.0.as_ref().into_iter() }
}
impl<'a, M: Clone> IntoIterator for &'a mut SharedFields<M> where &'a mut M: IntoIterator {
    type Item = <&'a mut M as IntoIterator>::Item; type IntoIter = <&'a mut M as IntoIterator>::IntoIter;
    fn into_iter(self) -> Self::IntoIter { Arc::make_mut(&mut self.0).into_iter() }
}
impl<M: Serialize> Serialize for SharedFields<M> {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> { self.0.as_ref().serialize(s) }
}
impl<'de, M: Deserialize<'de>> Deserialize<'de> for SharedFields<M> {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> { M::deserialize(d).map(Into::into) }
}
impl<M> SharedFields<M> { pub fn shares_image(&self, other: &Self) -> bool { Arc::ptr_eq(&self.0, &other.0) } }

/// A borrowed row or JSON object; inspecting either never copies the image.
#[derive(Clone, Copy)]
pub enum Fields<'a> { Row(&'a SmallMap<String, Value>), Map(&'a BTreeMap<String, Value>) }
impl<'a> Fields<'a> {
    pub fn get(self, key: &str) -> Option<&'a Value> { match self { Self::Row(m) => m.get(key), Self::Map(m) => m.get(key) } }
    pub fn contains_key(self, key: &str) -> bool { self.get(key).is_some() }
    pub fn len(self) -> usize { match self { Self::Row(m) => m.len(), Self::Map(m) => m.len() } }
    pub fn is_empty(self) -> bool { self.len() == 0 }
    pub fn iter(self) -> FieldIter<'a> {
        match self { Self::Row(m) => FieldIter::Row(m.iter()), Self::Map(m) => FieldIter::Map(m.iter()) }
    }
    pub fn keys(self) -> impl Iterator<Item = &'a String> { self.iter().map(|(k, _)| k) }
    pub fn values(self) -> impl Iterator<Item = &'a Value> { self.iter().map(|(_, v)| v) }
    /// Only for a schema-validated row/patch or program arguments.
    pub fn to_row(self) -> SmallMap<String, Value> { match self { Self::Row(m) => m.clone(), Self::Map(m) => m.iter().map(|(k, v)| (k.clone(), v.clone())).collect() } }
    pub fn to_map(self) -> BTreeMap<String, Value> { self.iter().map(|(k, v)| (k.clone(), v.clone())).collect() }
}

pub enum FieldIter<'a> { Row(crate::smallmap::Iter<'a, String, Value>), Map(std::collections::btree_map::Iter<'a, String, Value>) }
impl<'a> Iterator for FieldIter<'a> {
    type Item = (&'a String, &'a Value);
    fn next(&mut self) -> Option<Self::Item> { match self { Self::Row(iter) => iter.next(), Self::Map(iter) => iter.next() } }
    fn size_hint(&self) -> (usize, Option<usize>) { match self { Self::Row(iter) => iter.size_hint(), Self::Map(iter) => iter.size_hint() } }
}
impl DoubleEndedIterator for FieldIter<'_> {
    fn next_back(&mut self) -> Option<Self::Item> { match self { Self::Row(iter) => iter.next_back(), Self::Map(iter) => iter.next_back() } }
}
impl ExactSizeIterator for FieldIter<'_> {}
impl std::iter::FusedIterator for FieldIter<'_> {}
