use super::*;
use snapback4_core::schema::{public_table, ColumnType, Audience, Sync};
use std::{time::Instant, cmp::Ordering};
thread_local! { static COMPARISONS: Cell<usize> = const { Cell::new(0) }; }
// Identical String ordering and serialization; only test builds count Ord.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub(crate) struct CountedKey(String);
impl From<String> for CountedKey { fn from(value: String) -> Self { Self(value) } }
impl std::borrow::Borrow<str> for CountedKey { fn borrow(&self) -> &str { &self.0 } }
impl CountedKey { pub(crate) fn as_str(&self) -> &str { &self.0 } }
impl Ord for CountedKey {
    fn cmp(&self, other: &Self) -> Ordering { COMPARISONS.with(|count| count.set(count.get() + 1)); self.0.cmp(&other.0) }
}
impl PartialOrd for CountedKey { fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.cmp(other)) } }
fn exercise<S: DeviceStore>(mut store: S, host: &str) {
    let mut table = public_table(SmallMap::from([("id".into(), ColumnType::Id), ("group".into(), ColumnType::Id)]), SmallMap::from([("byId".into(), Index::of(&["id"], true))]));
    table.sync = Some(Sync { audience: Audience::Target { table: "members".into(), prefix: vec!["group".into()], principal: "principal".into() }, horizon: None }); table.leave = LeavePolicy::DeliveredHistory;
    let schema = Schema { tables: [("rows".into(), table)].into(), ..Schema::default() };
    for shuffled in [false, true] {
        let mut samples = [Vec::new(), Vec::new()]; let mut comparisons = [0, 0];
        for trial in 0..7 { for index in if trial % 2 == 0 { [0, 1] } else { [1, 0] } {
            let n = [1000, 8000][index]; let mut keys: Vec<_> = (0..n).rev().collect(); let mut seed = 7_u64;
            if shuffled { for i in (1..n).rev() { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; keys.swap(i, seed as usize % (i+1)); } }
            let input: Vec<_> = keys.into_iter().map(|i| StreamEvent { table: "rows".into(), kind: "scope".into(), id: String::new(), data: Some(serde_json::json!([format!("g{i:05}")])) }).collect();
            let tx = store.transaction().unwrap(); tx.set_meta(GROUPS, "{}").unwrap(); COMPARISONS.with(|count| count.set(0)); let started = Instant::now();
            events(&tx, &schema, &input, &wire::HeldGroups::new(), false).unwrap(); samples[index].push(started.elapsed().as_secs_f64()); comparisons[index] = COMPARISONS.with(|count| count.get());
            let groups = load(&tx, GROUPS).unwrap(); assert_eq!(groups["rows"].len(), n); assert!(groups["rows"].values().all(|m| *m == Membership::Left));
            events(&tx, &schema, &[], &[("rows".into(), vec![vec![serde_json::json!("g00000")]])].into(), false).unwrap();
            assert!(!is_left(&load(&tx, GROUPS).unwrap(), "rows", "[\"g00000\"]")); tx.commit().unwrap();
        } }
        for sample in &mut samples { sample.sort_by(f64::total_cmp); } let ratio = samples[1][3]/samples[0][3];
        println!("history host={host} shuffled={shuffled} groups=1000/8000 ms={:.3}/{:.3} ratio={ratio:.3}", samples[0][3]*1000., samples[1][3]*1000.);
        println!("history comparisons host={host} shuffled={shuffled} n1000={} n8000={} ratio={:.3}", comparisons[0], comparisons[1], comparisons[1] as f64/comparisons[0] as f64);
        assert!(comparisons[1] < 16 * comparisons[0], "8x groups must not cause quadratic comparison work");
    }
    let tx = store.transaction().unwrap(); let groups = load(&tx, GROUPS).unwrap();
    assert_eq!(std::any::type_name_of_val(&groups["rows"]), std::any::type_name::<BTreeMap<CountedKey, Membership>>(), "durable group history is data-sized");
}
#[test]
fn history_groups_scale_in_reverse_and_shuffled_order() {
    exercise(crate::memory::MemoryStore::default(), "memory");
    exercise(snapback4_core::store::Store::memory().unwrap(), "sqlite");
}
