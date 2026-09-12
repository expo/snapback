//! Prints key-encoding vectors as JSON so the TypeScript port is held to the
//! same bytes: `cargo run -p snapback4-core --example key_vectors`.

use snapback4_core::key;
use snapback4_core::value::Value;

fn main() {
    let cases: Vec<(&str, Vec<Value>)> = vec![
        ("null", vec![Value::Null]),
        ("false", vec![Value::Bool(false)]),
        ("true", vec![Value::Bool(true)]),
        ("int 0", vec![Value::Int(0)]),
        ("int -1", vec![Value::Int(-1)]),
        ("int 7", vec![Value::Int(7)]),
        ("int 2^52", vec![Value::Int(1 << 52)]),
        ("int min", vec![Value::Int(-((1i64 << 53) - 1))]),
        ("string empty", vec![Value::String(String::new())]),
        ("string a", vec![Value::String("a".into())]),
        ("string with nul", vec![Value::String("a\u{0}b".into())]),
        ("string unicode", vec![Value::String("héllo ✓".into())]),
        ("id a", vec![Value::Id("a".into())]),
        ("bytes", vec![Value::Bytes(vec![0, 1, 255])]),
        ("tuple", vec![Value::Id("c1".into()), Value::Int(1_700_000_000_000), Value::Id("M1".into())]),
        ("tuple with null", vec![Value::Id("c1".into()), Value::Null, Value::Id("x".into())]),
    ];
    let mut out = Vec::new();
    for (name, values) in cases {
        let encoded = key::encode(&values);
        let hex: String = encoded.iter().map(|b| format!("{b:02x}")).collect();
        let upper: String = key::upper_bound(&encoded).iter().map(|b| format!("{b:02x}")).collect();
        let plain: Vec<serde_json::Value> = values.iter().map(snapback4_core::wire::to_json).collect();
        let kinds: Vec<&str> = values.iter().map(Value::kind).collect();
        out.push(serde_json::json!({ "name": name, "values": plain, "kinds": kinds, "hex": hex, "upper": upper }));
    }
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}
