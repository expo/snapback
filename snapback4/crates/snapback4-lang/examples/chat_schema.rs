//! Prints the compiled chat backend as `GET /schema` sends it, for the
//! client package's tests: `cargo run -p snapback4-lang --example chat_schema`.

fn main() {
    let source = include_str!("../../../apps/chat/snapback/schema.q");
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), source.to_owned())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let programs: Vec<serde_json::Value> = bound.programs.iter().map(|p| serde_json::to_value(&p.program).unwrap()).collect();
    println!("{}", serde_json::to_string_pretty(&serde_json::json!({ "generation": 1, "schema": bound.schema, "programs": programs })).unwrap());
}
