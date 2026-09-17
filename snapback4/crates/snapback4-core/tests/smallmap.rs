use snapback4_core::smallmap::{SmallMap, SmallSet};
use std::collections::{BTreeMap, BTreeSet};

fn next(seed: &mut u64) -> u64 { *seed ^= *seed << 13; *seed ^= *seed >> 7; *seed ^= *seed << 17; *seed }

#[test]
fn seeded_operations_match_btree() {
    let mut seed = 0x6e624eb7d4a91f03;
    let (mut small, mut tree) = (SmallMap::new(), BTreeMap::new());
    for _ in 0..20_000 {
        let key = (next(&mut seed) % 129) as i32 - 64;
        let value = next(&mut seed) as i64;
        match next(&mut seed) % 11 {
            0 => assert_eq!(small.insert(key, value), tree.insert(key, value)),
            1 => assert_eq!(small.remove(&key), tree.remove(&key)),
            2 => assert_eq!(small.get(&key), tree.get(&key)),
            3 => { *small.entry(key).or_default() = value; *tree.entry(key).or_default() = value; }
            4 => { small.entry(key).or_insert(value); tree.entry(key).or_insert(value); }
            5 => { small.entry(key).or_insert_with(|| value); tree.entry(key).or_insert_with(|| value); }
            6 => {
                small.retain(|k, v| { *v = v.wrapping_add(1); k % 7 != key % 7 });
                tree.retain(|k, v| { *v = v.wrapping_add(1); k % 7 != key % 7 });
            }
            7 => { let entries = [(key, value), (key - 1, 5), (key, 7)]; small.extend(entries); tree.extend(entries); }
            8 => {
                if let Some(v) = small.get_mut(&key) { *v = value; }
                if let Some(v) = tree.get_mut(&key) { *v = value; }
            }
            9 => {
                small.entry(key).and_modify(|v| *v = v.wrapping_add(value)).or_insert(value);
                tree.entry(key).and_modify(|v| *v = v.wrapping_add(value)).or_insert(value);
            }
            _ => {
                let entries = [(key, value), (key - 1, 5), (key, 7), (key + 1, 9)];
                small = entries.into_iter().collect(); tree = entries.into_iter().collect();
            }
        }
        assert_eq!(small.len(), tree.len());
        assert_eq!(small.is_empty(), tree.is_empty());
        assert_eq!(small.contains_key(&key), tree.contains_key(&key));
        assert_eq!(small.first_key_value(), tree.first_key_value());
        assert_eq!(small.last_key_value(), tree.last_key_value());
        assert!(small.iter().eq(tree.iter()));
        assert!(small.iter().rev().eq(tree.iter().rev()));
        assert!(small.keys().eq(tree.keys()));
        assert!(small.values().eq(tree.values()));
        assert!(small.clone().into_iter().eq(tree.clone()));
    }
    for ((_, a), (_, b)) in (&mut small).into_iter().zip(&mut tree) { *a = a.wrapping_add(5); *b = b.wrapping_add(5); }
    for (a, b) in small.values_mut().zip(tree.values_mut()) { *a = a.wrapping_add(3); *b = b.wrapping_add(3); }
    assert!((&small).into_iter().eq(&tree));
}

#[test]
fn serde_sorts_and_last_duplicate_wins() {
    let input = r#"{"z":0,"a":1,"z":2,"β":3,"a":4,"":5}"#;
    let small: SmallMap<String, i64> = serde_json::from_str(input).unwrap();
    let tree: BTreeMap<String, i64> = serde_json::from_str(input).unwrap();
    let encoded = serde_json::to_string(&small).unwrap();
    assert_eq!(encoded, serde_json::to_string(&tree).unwrap());
    assert_eq!(small, serde_json::from_str(&encoded).unwrap());
    assert_eq!(small.get("a"), Some(&4));
    assert_eq!(small["z"], 2);
    for invalid in ["[]", "null", r#"{"a":"bad"}"#] {
        assert!(serde_json::from_str::<SmallMap<String, i64>>(invalid).is_err());
        assert!(serde_json::from_str::<BTreeMap<String, i64>>(invalid).is_err());
    }
}

#[test]
fn equal_keys_preserve_the_btree_representative() {
    // Ord/Eq may ignore part of the key; iteration still exposes that part.
    #[derive(Clone, Debug)]
    struct Key(u8, &'static str);
    impl PartialEq for Key { fn eq(&self, other: &Self) -> bool { self.0 == other.0 } }
    impl Eq for Key {}
    impl PartialOrd for Key { fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> { Some(self.cmp(other)) } }
    impl Ord for Key { fn cmp(&self, other: &Self) -> std::cmp::Ordering { self.0.cmp(&other.0) } }
    let entries = [(Key(2, "first"), 1), (Key(1, "only"), 2), (Key(2, "last"), 3)];
    let small: SmallMap<_, _> = entries.clone().into_iter().collect();
    let tree: BTreeMap<_, _> = entries.clone().into_iter().collect();
    assert_eq!(small.last_key_value().unwrap().0.1, tree.last_key_value().unwrap().0.1);
    let (mut small, mut tree) = (SmallMap::new(), BTreeMap::new());
    small.extend(entries.clone()); tree.extend(entries.clone());
    assert_eq!(small.last_key_value().unwrap().0.1, tree.last_key_value().unwrap().0.1);
    let small: SmallSet<_> = entries.clone().map(|(key, _)| key).into();
    let tree: BTreeSet<_> = entries.map(|(key, _)| key).into();
    assert_eq!(small.last().unwrap().1, tree.last().unwrap().1);
}

#[test]
fn sets_match_order_and_serde() {
    let mut seed = 7;
    let (mut small, mut tree) = (SmallSet::new(), BTreeSet::new());
    for _ in 0..2000 {
        let key = next(&mut seed) % 111;
        if next(&mut seed) % 2 == 0 { assert_eq!(small.insert(key), tree.insert(key)); }
        else { assert_eq!(small.remove(&key), tree.remove(&key)); }
        assert_eq!(small.contains(&key), tree.contains(&key));
        assert!(small.iter().eq(tree.iter()));
        assert_eq!(serde_json::to_string(&small).unwrap(), serde_json::to_string(&tree).unwrap());
    }
    let copy: SmallSet<u64> = serde_json::from_str("[8,2,8,1]").unwrap();
    assert_eq!(copy.into_iter().collect::<Vec<_>>(), vec![1, 2, 8]);
}

#[test]
fn ordering_hash_and_set_algebra_match_btree() {
    use std::hash::{Hash, Hasher, DefaultHasher};
    fn hash(value: &impl Hash) -> u64 { let mut hash = DefaultHasher::new(); value.hash(&mut hash); hash.finish() }
    let mut seed = 23;
    for _ in 0..1000 {
        let entries: Vec<_> = (0..12).map(|_| (next(&mut seed) % 16, next(&mut seed) % 100)).collect();
        let small: SmallMap<_, _> = entries.clone().into_iter().collect();
        let tree: BTreeMap<_, _> = entries.into_iter().collect();
        let small_other: SmallMap<_, _> = [(next(&mut seed) % 16, next(&mut seed) % 100)].into();
        let tree_other: BTreeMap<_, _> = small_other.clone().into_iter().collect();
        assert_eq!(small.cmp(&small_other), tree.cmp(&tree_other));
        assert_eq!(small.partial_cmp(&small_other), tree.partial_cmp(&tree_other));
        assert_eq!(hash(&small), hash(&tree));
        let a: SmallSet<_> = small.into_keys().collect();
        let b: SmallSet<_> = small_other.into_keys().collect();
        let ta: BTreeSet<_> = tree.into_keys().collect();
        let tb: BTreeSet<_> = tree_other.into_keys().collect();
        assert!(a.union(&b).eq(ta.union(&tb)));
        assert!(a.intersection(&b).eq(ta.intersection(&tb)));
        assert!(a.difference(&b).eq(ta.difference(&tb)));
        assert_eq!(a.is_subset(&b), ta.is_subset(&tb));
        assert_eq!(a.is_disjoint(&b), ta.is_disjoint(&tb));
        assert_eq!(hash(&a), hash(&ta));
    }
}

#[test]
fn row_images_keep_sharing_order_and_meter_charges() {
    use snapback4_core::value::{Value, object};
    let Value::Row(original) = object([("b", Value::Int(2)), ("a", Value::Int(1))]) else { unreachable!() };
    // Row images are runtime values; authored columns do not justify vector insertion.
    fn tree_fields<T: std::ops::Deref<Target = BTreeMap<String, Value>>>(_: &T) {}
    tree_fields(&original);
    let mut changed = original.clone();
    assert!(original.shares_image(&changed));
    changed.insert("a".into(), Value::Int(3));
    assert!(!original.shares_image(&changed));
    assert_eq!(original["a"], Value::Int(1));
    assert_eq!(Value::Row(original.clone()).heap_bytes(), 202);
    assert_eq!(Value::Row(original.clone()).clone_heap_bytes(), 0);
    assert!(Value::Row(original).total_cmp(&Value::Row(changed)).is_lt());
}

#[test]
#[ignore = "explicit map crossover measurement; use --release --ignored --nocapture"]
fn construction_crossover() {
    use std::{hint::black_box, time::Instant};
    use snapback4_core::ir::ArgType;
    for n in [8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096] {
        let mut seed = 7;
        let sorted: Vec<_> = (0..n).map(|n| (format!("field{n:05}"), ArgType::Text { max: n as u32 + 1, min: 0, format: None })).collect();
        let mut shuffled = sorted.clone();
        for i in (1..n).rev() { shuffled.swap(i, next(&mut seed) as usize % (i + 1)); }
        for (order, entries) in [("sorted", &sorted), ("shuffled", &shuffled)] {
            let repeats = (32_768 / n).max(8);
            let (mut small, mut tree) = (Vec::new(), Vec::new());
            for trial in 0..7 {
                for small_first in [trial % 2 == 0, trial % 2 != 0] {
                    let start = Instant::now();
                    for _ in 0..repeats {
                        if small_first { black_box(entries.iter().cloned().collect::<SmallMap<_, _>>()); }
                        else { black_box(entries.iter().cloned().collect::<BTreeMap<_, _>>()); }
                    }
                    let ns = start.elapsed().as_nanos() as f64 / repeats as f64;
                    if small_first { small.push(ns); } else { tree.push(ns); }
                }
            }
            small.sort_by(f64::total_cmp); tree.sort_by(f64::total_cmp);
            println!("MAP n={n} order={order} pairs=7 repeats={repeats} small_ns={:.0} btree_ns={:.0} ratio={:.3}", small[3], tree[3], small[3] / tree[3]);
        }
    }
}

#[path = "support/program_scale.rs"]
mod program_scale;

#[test]
fn dynamic_json_keys_stay_in_btrees() {
    use snapback4_core::{Value, wire};
    let source = serde_json::Value::Object((0..8192).rev().map(|i| (format!("key{i:05}"), serde_json::json!(i))).collect());
    let Value::Map(original) = wire::untyped(&source).unwrap() else { panic!("map") };
    let mut changed = original.clone(); assert!(original.shares_image(&changed));
    changed.insert("key00000".into(), Value::Int(-1));
    assert!(!original.shares_image(&changed)); assert_eq!(original["key00000"], Value::Int(0));
    assert_eq!(wire::to_json(&Value::Map(original.clone())), source);
    assert_eq!(std::any::type_name_of_val(&*original), std::any::type_name::<BTreeMap<String, Value>>(), "JSON object keys come from data");
}
