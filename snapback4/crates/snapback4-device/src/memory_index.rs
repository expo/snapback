//! Sorted index pages. Ordinary writes move at most 256 entries; ordered
//! acquisition fills pages instead of allocating/searching one tree node per key.
use super::compact_key::Key;
use std::{collections::BTreeMap, ops::Range, rc::Rc};
const PAGE: usize = 256;
type Entry = (Key, Rc<str>);
#[derive(Clone, Default)]
pub(super) struct Index { pages: BTreeMap<Key, Vec<Entry>> }
impl Index {
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
            result.pages.insert(floor, page);
        }
        result
    }
    fn floor(&self, key: &Key) -> Key {
        self.pages.range(..=key).next_back().map(|(key, _)| key.clone()).unwrap_or_else(|| Key::plain(&[]))
    }
    pub fn get(&self, key: &Key) -> Option<&Rc<str>> {
        let (_, page) = self.pages.range(..=key).next_back()?;
        page.binary_search_by(|(k, _)| k.cmp(key)).ok().map(|at| &page[at].1)
    }
    pub fn insert(&mut self, key: Key, value: Rc<str>) -> Option<Rc<str>> {
        let floor = self.floor(&key);
        let page = self.pages.entry(floor).or_insert_with(|| Vec::with_capacity(PAGE + 1));
        let result = match page.binary_search_by(|(k, _)| k.cmp(&key)) {
            Ok(at) => Some(std::mem::replace(&mut page[at].1, value)),
            Err(at) => { page.insert(at, (key, value)); None }
        };
        if page.len() > PAGE {
            let right = page.split_off(PAGE / 2);
            self.pages.insert(right[0].0.clone(), right);
        }
        result
    }
    pub fn remove(&mut self, key: &Key) -> Option<Rc<str>> {
        let floor = self.floor(key);
        let page = self.pages.get_mut(&floor)?;
        let at = page.binary_search_by(|(k, _)| k.cmp(key)).ok()?;
        let (_, value) = page.remove(at);
        if page.is_empty() { self.pages.remove(&floor); }
        Some(value)
    }
    pub fn range(&self, Range { start, end }: Range<Key>) -> impl DoubleEndedIterator<Item = (&Key, &Rc<str>)> {
        let floor = self.floor(&start);
        self.pages.range(floor..end.clone()).flat_map(|(_, page)| page.iter())
            .filter(move |(key, _)| key >= &start && key < &end).map(|(key, value)| (key, value))
    }
}
impl PartialEq for Index {
    fn eq(&self, other: &Self) -> bool {
        self.pages.values().flatten().eq(other.pages.values().flatten())
    }
}
impl Eq for Index {}

#[cfg(test)]
mod tests {
    use super::*;
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
