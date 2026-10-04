// Run as an allocation submodule in the UNMODIFIED a8c20c40e9 engine/compiler.
// See README.md. This is fixture tooling, not an RP-generated legacy simulation.
use super::*;
#[test]
fn generate_predecessor() {
    let root = std::path::PathBuf::from(std::env::var("RP_FIXTURE_DIR").unwrap());
    let src = std::fs::read_to_string(root.join("schema.q")).unwrap();
    let b = bound(&src);
    assert_eq!(b.schema.operations["send"].predicts.as_deref(), Some("never"));
    assert!(!b.schema.required_capabilities().contains("receipt-derived-prediction-v1"));
    let mut e = Engine::new(snapback4_core::Store::open(&root.join("server.sqlite")).unwrap(),
        b.schema.clone(), b.programs.iter().map(|p| p.program.clone())).unwrap();
    seed(&mut e);
    send(&mut e, 1, NOW);
    let backend = snapback4_device::device::Backend { generation: e.generation(), schema: b.schema.public_projection(),
        programs: b.programs.into_iter().map(|p| p.program).collect() };
    std::fs::write(root.join("backend.json"), serde_json::to_vec(&backend).unwrap()).unwrap();
    fn prepare<S: DeviceStore>(e: &mut Engine, d: &mut Device<S>) {
        d.delivery(&json!({"viewer":"alice","action":"read","now":NOW})).unwrap();
        for (i, mut page) in snapshot_pages(e, "alice", 1000).into_iter().enumerate() {
            page.store_id = e.store().meta("store_id").unwrap();
            page.now = Some(NOW);
            d.apply(&page, i == 0).unwrap();
        }
        let debt = d.delivery(&json!({"viewer":"alice","action":"read","now":NOW})).unwrap();
        let state: serde_json::Value = serde_json::from_str(debt["value"].as_str().unwrap()).unwrap();
        assert!(state["groups"].as_object().unwrap().values().any(|g|g["owed"] == json!([[1,1]])), "{state}");
        let q = d.admit(queued("alice", 7)).unwrap();
        assert!(!q.predictable && q.predicted.is_empty());
        assert_eq!(d.queued().unwrap().len(), 1);
    }
    let mut mem = Device::open_store(snapback4_device::memory::MemoryStore::new(), Some(backend.clone())).unwrap();
    prepare(&mut e, &mut mem);
    std::fs::write(root.join("memory.json"), serde_json::to_vec(&mem.store().drain()).unwrap()).unwrap();
    let mut sqlite = Device::open(&root.join("device.sqlite"), Some(backend)).unwrap();
    prepare(&mut e, &mut sqlite);
    drop(sqlite);
    drop(e);
}
