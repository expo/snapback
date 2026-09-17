use snapback4_core::{Value, value::object};
pub const SOURCE: &str = include_str!("../fixtures/lane-domains.q");
pub const NOW: i64 = 29 * 3_600_000 + 100;
pub fn id(value: &str) -> Value { Value::Id(value.into()) }
pub fn seed(hours: i64, per_hour: i64, ranked: bool) -> Vec<(String, Value)> {
    let mut rows = Vec::new();
    for hour in 0..hours {
        for n in 0..per_hour {
            let post = format!("p{hour:05}-{n:04}");
            let at = hour * 3_600_000 + n * 1_000;
            rows.push(("posts".into(), object([("id", id(&post)), ("author", id(if n % 2 == 0 { "dev:alice" } else { "dev:bob" })), ("hourKey", Value::Int(hour)), ("at", Value::Int(at))])));
            if ranked {
                for like in 0..1 + (hour * 3 + n) % 5 {
                    rows.push(("likes".into(), object([("id", id(&format!("{post}-like{like}"))), ("postId", id(&post)), ("postHour", Value::Int(hour)), ("postAt", Value::Int(at))])));
                }
            }
        }
    }
    rows
}
pub fn oracle(hours: i64, per_hour: i64) -> Vec<String> {
    let mut rows = (0..hours).flat_map(|h| (0..per_hour).map(move |n| (1 + (h * 3 + n) % 5, h * 3_600_000 + n * 1_000, format!("p{h:05}-{n:04}")))).filter(|(_, at, _)| *at > NOW - 86_400_000).collect::<Vec<_>>();
    rows.sort_by(|a,b| {
        let key = |row: &(i64, i64, String)| (row.0, snapback4_core::schema::maintained_id(&[Value::Int(row.1.div_euclid(3_600_000)), Value::Int(row.1), id(&row.2)]));
        key(b).cmp(&key(a))
    });
    rows.into_iter().take(10).map(|(_,_,id)| id).collect()
}
