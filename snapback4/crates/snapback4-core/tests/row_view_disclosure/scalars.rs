//! Scalar oracle is independent of RowKey::matches and the interpreter's ordering.
use super::*;
pub fn visit(mut run: impl FnMut(String, Pair, Vec<Json>, Vec<i64>)) -> usize {
    let mut count = 0;
    for (kind, values) in [
        ("int", vec![json!(-1), json!(0), json!(1)]),
        ("text <=100", vec![json!("a"), json!("m"), json!("z")]),
        ("time", vec![json!(1), json!(2), json!(3)]),
        ("bool", vec![json!(false), json!(true)]),
    ] {
        for op in ["=", "!=", "<", "<=", ">", ">="] {
            let source = cases::SOURCE
                .replace("readUpTo: int default 0", &format!("readUpTo: {kind}"))
                .replace("readUpTo: int", &format!("readUpTo: {kind}"))
                .replace("ordinal: int", &format!("ordinal: {kind}"))
                .replace(" and .ordinal > m.joinedAt", "")
                .replace(".ordinal > m.readUpTo", &format!(".ordinal {op} m.readUpTo"))
                .replace("  expire at .until\n", "");
            let mut member = cases::member("scalar-member", "alice", 0);
            member.1["readUpTo"] = values[0].clone();
            let mut seed = vec![member];
            for (i, value) in values.iter().enumerate() {
                let mut message = cases::message(&format!("m{i}"), 1, false);
                message.1["ordinal"] = value.clone();
                seed.push(message);
            }
            let ranks = (0..values.len()).chain((0..values.len()).rev()).collect::<Vec<_>>();
            let marks = ranks.iter().map(|&r| values[r].clone()).collect();
            let expected = ranks.iter().map(|&mark| (0..values.len()).filter(|&row| match op {
                "=" => row == mark, "!=" => row != mark,
                "<" => row < mark, "<=" => row <= mark,
                ">" => row > mark, ">=" => row >= mark, _ => unreachable!(),
            }).count() as i64).collect();
            let pair = Pair::new(source, [seed.clone(), seed], "alice",
                Operation::new("mark", json!({"member":"scalar-member","readUpTo":values[0]}), "alice"))
                .query("unreadFor", json!({"member":"scalar-member"}));
            run(format!("{kind}/{op}"), pair, marks, expected);
            count += 1;
        }
    }
    count
}
