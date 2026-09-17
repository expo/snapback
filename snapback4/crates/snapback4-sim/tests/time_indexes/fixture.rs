use snapback4_core::{Value, value::object};
pub const SOURCE: &str = include_str!("../fixtures/time-indexes.q");
pub const TIMES: [i64; 9] = [-7_200_001, -1, 0, 1_799_999, 1_800_000, 7_200_000, 8_999_999, 9_000_000, 16_200_000];
pub fn seed() -> Vec<(String, Value)> {
    TIMES.iter().enumerate().map(|(n, at)| ("events".into(), object([("id", Value::Id(format!("e{n}"))), ("principal", Value::Id("dev:alice".into())), ("at", Value::Int(*at))]))).collect()
}
pub fn oracle(start: i64, end: i64) -> Vec<String> {
    TIMES.iter().enumerate().filter(|(_, at)| { let bucket = (**at - 1_800_000).div_euclid(7_200_000); bucket >= start && bucket < end }).map(|(n, _)| format!("e{n}")).collect()
}
