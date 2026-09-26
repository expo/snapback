use super::*;
use snapback4_core::{
    engine::ephemeral::Layered,
    rows::{Bounds, Dir, MemoryRows},
    schema::{Index, Table},
};
fn row(id_: &str) -> Value {
    object([
        ("id", id(id_)),
        ("roomId", id("r")),
        ("principal", id("alice")),
        ("payload", Value::String("".into())),
        ("$deadline", Value::Int(5000)),
    ])
}
#[test]
fn routes_reads_and_drop_guard_undoes_durable_write_and_store_error() {
    let schema = bind(SOURCE).schema;
    let memory = MemoryRows::new();
    let durable = MemoryRows::new();
    let room = object([("id", id("r")), ("title", Value::String("Room".into()))]);
    durable
        .put("rooms", &schema.tables["rooms"], &room, None)
        .unwrap();
    for fault in [false, true] {
        let failing = Broken;
        let layer = Layered::new(
            if fault { &failing } else { &durable },
            &memory,
            &schema,
            true,
        );
        layer
            .put("typing", &schema.tables["typing"], &row("t"), None)
            .unwrap();
        assert!(layer.get("typing", "t").unwrap().is_some());
        if fault {
            assert!(layer.get("rooms", "r").is_err());
        } else {
            assert_eq!(layer.get("rooms", "r").unwrap(), Some(room.clone()));
            assert!(
                layer
                    .put("rooms", &schema.tables["rooms"], &room, Some(&room))
                    .is_err()
            );
            assert!(layer.set_sequence("rooms", "r", 1).is_err());
            assert!(layer.effect_once("x", "x").is_err());
        }
        drop(layer);
        assert!(memory.rows("typing").is_empty());
        assert_eq!(durable.rows("rooms"), vec![room.clone()]);
    }
}
#[test]
fn drop_guard_restores_updates_deletes_and_panics() {
    let schema = bind(SOURCE).schema;
    let memory = MemoryRows::new();
    let durable = MemoryRows::new();
    let old = row("t");
    memory
        .put("typing", &schema.tables["typing"], &old, None)
        .unwrap();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let layer = Layered::new(&durable, &memory, &schema, true);
        layer
            .delete("typing", &schema.tables["typing"], &old)
            .unwrap();
        layer
            .put("typing", &schema.tables["typing"], &row("other"), None)
            .unwrap();
        panic!("simulated program panic");
    }));
    assert!(result.is_err());
    assert_eq!(memory.rows("typing"), vec![old]);
}
struct Broken;
impl Rows for Broken {
    fn get(&self, _: &str, _: &str) -> Result<Option<Value>, RuntimeError> {
        Err(RuntimeError::Store("injected read failure".into()))
    }
    fn lookup(
        &self,
        _: &str,
        _: &str,
        _: &Index,
        _: &[Value],
    ) -> Result<Option<Value>, RuntimeError> {
        self.get("", "")
    }
    fn scan(
        &self,
        _: &str,
        _: &str,
        _: &[Value],
        _: &Bounds,
        _: Dir,
        _: usize,
    ) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        Err(RuntimeError::Store("injected scan failure".into()))
    }
    fn count_prefix(&self, _: &str, _: &str, _: &[Value], _: u64) -> Result<u64, RuntimeError> {
        Err(RuntimeError::Store("injected count failure".into()))
    }
    fn put(&self, _: &str, _: &Table, _: &Value, _: Option<&Value>) -> Result<u64, RuntimeError> {
        unreachable!()
    }
    fn delete(&self, _: &str, _: &Table, _: &Value) -> Result<u64, RuntimeError> {
        unreachable!()
    }
}
