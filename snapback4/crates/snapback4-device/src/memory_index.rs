//! Sorted index pages. Ordinary writes move at most 256 entries within a page;
//! a split moves directory descriptors. Acquisition fills pages in order.
// @ref LLP 3000.007#20.4 — compact indexes retain full ordering and atomic publication.
use super::compact_key::Key;
use std::{ops::Range, rc::Rc};
const PAGE: usize = 256;
type Entry = (Key, Rc<str>);
#[derive(Clone, Default)]
pub(super) struct Index { pages: Vec<(Key, Vec<Entry>)>, pending: Vec<Entry> }
impl Index {
    pub fn push_unsorted(&mut self, key: Key, id: Rc<str>) { self.pending.push((key, id)); }
    pub fn finish(&mut self) {
        if !self.pending.is_empty() {
            debug_assert!(self.pages.is_empty());
            *self = Self::from_entries(std::mem::take(&mut self.pending));
        }
    }
    pub fn from_entries(mut entries: Vec<Entry>) -> Self {
        entries.sort_unstable_by(|a, b| a.0.cmp(&b.0));
        entries.dedup_by(|a, b| a.0 == b.0);
        let mut result = Self::default();
        let mut entries = entries.into_iter();
        while let Some(first) = entries.next() {
            let floor = first.0.clone();
            let mut page = Vec::with_capacity(PAGE + 1);
            page.push(first);
            page.extend(entries.by_ref().take(PAGE - 1));
            result.pages.push((floor, page));
        }
        result
    }
    fn floor(&self, key: &Key) -> usize {
        self.pages.partition_point(|(floor, _)| floor <= key).saturating_sub(1)
    }
    pub fn get(&self, key: &Key) -> Option<&Rc<str>> {
        let (_, page) = self.pages.get(self.floor(key))?;
        page.binary_search_by(|(k, _)| k.cmp(key)).ok().map(|at| &page[at].1)
    }
    pub fn insert(&mut self, key: Key, value: Rc<str>) -> Option<Rc<str>> {
        let floor = self.floor(&key);
        if self.pages.is_empty() { self.pages.push((Key::plain(&[]), Vec::with_capacity(PAGE + 1))); }
        // Keep the first floor valid when a smaller key arrives after a bulk build.
        if key < self.pages[floor].0 { self.pages[floor].0 = key.clone(); }
        let page = &mut self.pages[floor].1;
        let result = match page.binary_search_by(|(k, _)| k.cmp(&key)) {
            Ok(at) => Some(std::mem::replace(&mut page[at].1, value)),
            Err(at) => { page.insert(at, (key, value)); None }
        };
        if page.len() > PAGE {
            let right = page.split_off(PAGE / 2);
            self.pages.insert(floor + 1, (right[0].0.clone(), right));
        }
        result
    }
    pub fn remove(&mut self, key: &Key) -> Option<Rc<str>> {
        let floor = self.floor(key);
        let (_, page) = self.pages.get_mut(floor)?;
        let at = page.binary_search_by(|(k, _)| k.cmp(key)).ok()?;
        let (_, value) = page.remove(at);
        if page.is_empty() { self.pages.remove(floor); }
        Some(value)
    }
    pub fn range(&self, Range { start, end }: Range<Key>) -> impl DoubleEndedIterator<Item = (&Key, &Rc<str>)> {
        let floor = self.floor(&start);
        let upper = self.pages.partition_point(|(floor, _)| floor < &end).max(floor);
        self.pages[floor..upper].iter().flat_map(|(_, page)| page.iter())
            .filter(move |(key, _)| key >= &start && key < &end).map(|(key, value)| (key, value))
    }
}
impl PartialEq for Index {
    fn eq(&self, other: &Self) -> bool {
        self.pending == other.pending && self.pages.iter().flat_map(|(_, p)| p).eq(other.pages.iter().flat_map(|(_, p)| p))
    }
}
impl Eq for Index {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    #[test]
    fn bulk_pages_accept_smaller_keys_and_remove_to_empty() {
        let mut index = Index::default();
        let mut tree = BTreeMap::new();
        for n in (100..1200u32).rev() {
            let key = Key::plain(&n.to_be_bytes()); let value: Rc<str> = n.to_string().into();
            index.push_unsorted(key.clone(), value.clone()); tree.insert(key, value);
        }
        index.finish();
        for n in 0..100u32 {
            let key = Key::plain(&n.to_be_bytes()); let value: Rc<str> = n.to_string().into();
            assert_eq!(index.insert(key.clone(), value.clone()), tree.insert(key, value));
        }
        for n in 0..1200u32 {
            let range = Key::plain(&n.to_be_bytes())..Key::plain(&1201u32.to_be_bytes());
            assert!(index.range(range.clone()).eq(tree.range(range.clone())));
            assert!(index.range(range.clone()).rev().eq(tree.range(range).rev()));
            let key = Key::plain(&n.to_be_bytes());
            assert_eq!(index.remove(&key), tree.remove(&key));
        }
        assert!(index.get(&Key::plain(&[])).is_none());
        assert_eq!(index.range(Key::plain(&[])..Key::plain(&[255])).count(), 0);
    }
    #[test]
    fn pages_match_a_tree_through_splits_updates_deletes_and_ranges() {
        let mut pages = Index::default(); let mut tree = BTreeMap::new();
        for n in 0..4000u32 {
            let id = format!("{}", n % 911);
            let key = Key::plain(&(n.wrapping_mul(977) % 3203).to_be_bytes());
            let value: Rc<str> = id.into();
            assert_eq!(pages.insert(key.clone(), value.clone()), tree.insert(key, value));
        }
        for n in 0..3203u32 {
            let key = Key::plain(&n.to_be_bytes());
            assert_eq!(pages.get(&key), tree.get(&key));
            if n % 3 == 0 { assert_eq!(pages.remove(&key), tree.remove(&key)); }
        }
        for start in (0..3300u32).step_by(113) {
            let range = Key::plain(&start.to_be_bytes())..Key::plain(&(start+187).to_be_bytes());
            assert!(pages.range(range.clone()).eq(tree.range(range.clone())));
            assert!(pages.range(range.clone()).rev().eq(tree.range(range).rev()));
        }
    }
}
