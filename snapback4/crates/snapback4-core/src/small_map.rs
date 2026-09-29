//! Construction for small field/plan maps. Data-sized stores keep their own
//! bulk construction paths. The representation and ordered iteration remain
//! BTreeMap; only the temporary sorting machinery is avoided.
// @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — eliminate sort instantiations without replacing maps or changing serialized bytes.
use std::collections::BTreeMap;

pub fn collect<K: Ord, V>(entries: impl IntoIterator<Item = (K, V)>) -> BTreeMap<K, V> {
    let mut map = BTreeMap::new();
    for (key, value) in entries { map.insert(key, value); }
    map
}

pub fn try_collect<K: Ord, V, E>(entries: impl IntoIterator<Item = Result<(K, V), E>>) -> Result<BTreeMap<K, V>, E> {
    let mut map = BTreeMap::new();
    for entry in entries { let (key, value) = entry?; map.insert(key, value); }
    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn construction_keeps_order_duplicates_and_canonical_bytes() {
        for count in [0, 1, 8, 64, 1024] {
            let entries: Vec<_> = (0..count).rev().map(|i| (format!("k{}", i % 37), i)).collect();
            let baseline: BTreeMap<_, _> = entries.clone().into_iter().collect();
            let actual = collect(entries.clone());
            assert_eq!(actual, baseline);
            assert_eq!(crate::json_codec::to_vec(&actual).unwrap(), crate::json_codec::to_vec(&baseline).unwrap());
            assert_eq!(try_collect(entries.into_iter().map(Ok::<_, &str>)).unwrap(), baseline);
        }
    }

    #[test]
    fn fallible_construction_keeps_first_error_and_stops_consuming() {
        let mut input = [Ok(("z", 1)), Ok(("a", 2)), Err("first"), Err("later")].into_iter();
        assert_eq!(try_collect(input.by_ref()), Err("first"));
        assert_eq!(input.next(), Some(Err("later")));
    }
}
