//! A branded Snapback executable with the Todo app artifacts baked in.
//!
//! This is one executable plus the platform runtime layout described by
//! LLP 0141 D6; it does not claim that Hermes is already one portable file.

const SCHEMA: &[u8] = include_bytes!("../demos/todo/snapback/generated/schema.manifest.json");
const FUNCTIONS: &[u8] = include_bytes!("../demos/todo/snapback/generated/functions.manifest.json");

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    snapback::embed::production_from_manifests(SCHEMA, FUNCTIONS)?
        .database(".snapback/embedded-todo.sqlite3")
        .bind("127.0.0.1", 4287)
        .ready_file(".snapback/embedded-todo.ready.json")
        .serve()
        .await
}
