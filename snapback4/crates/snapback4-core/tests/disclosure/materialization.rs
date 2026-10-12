use snapback4_core::{Engine, Context, WriteState, wire};
use serde_json::json;
const SOURCE: &str = r#"
table records:
  owner: principal
  secret: text <=1000000 default '' written by .owner
  extra: int ?
  title: text <=20 default 'public'
  by byWords: words(title), id
  public
  insert <- allow
  sync public
view activity:
  records { id, title, extra }
mutation make(id: id, secret: text <=1000000):
  insert records { id, owner: viewer, secret }
query planned():
  return activity first 20
query search():
  return records matching 'public' first 20
query counted():
  return count(records)
"#;

#[test]
fn omitted_ordinary_field_twenty_authorized_large_private_rows() {
    for disk in [false,true] {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../target/r5-ordinary-{}-{disk}",std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut observations = Vec::new();
        for world in 0..2 {
            let b = crate::generated::runtime_compile(&[("schema.q".into(),SOURCE.into())]);
            assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
            let programs: Vec<_> = b.programs.into_iter().map(|p|p.program).collect();
            let mut e = if disk { Engine::new(snapback4_core::Store::open(&dir.join(format!("{world}.sqlite"))).unwrap(),b.schema,programs).unwrap() }
                else { Engine::memory(b.schema,programs).unwrap() };
            for n in 0..20 {
                let args = json!({"id":format!("row-{n:02}"),"secret":"x".repeat(world*1_000_000)});
                let p = e.programs().find(|p|p.name=="make").unwrap();
                let args = p.args.iter().map(|(k,t)|(k.clone(),wire::from_json(t,&args[k]).unwrap())).collect();
                let r = e.mutate("make",None,Context::new("bob",args).at(1000)).unwrap();
                assert!(matches!(r.state,WriteState::Sent{..}),"{r:?}");
            }
            let mut reads = Vec::new();
            for name in ["planned","search","counted"] {
                let r = e.query(name,Context::new("alice",Default::default()).at(1000)).unwrap();
                assert!(r.complete && r.cut.is_none(),"disk={disk},world={world},{name}: {r:?}");
                let data = wire::to_json(&r.data);
                if name=="counted" { assert_eq!(data,json!(20)); }
                else {
                    assert_eq!(data.as_array().unwrap().len(),20);
                    for row in data.as_array().unwrap() { assert_eq!(row["extra"],json!(null)); assert!(row.get("secret").is_none()); }
                }
                eprintln!("ordinary disk={disk} world={world} {name}: heap={}, examined={}",r.metered.heap_bytes,r.metered.examined);
                reads.push(serde_json::to_value(r).unwrap());
            }
            observations.push(reads);
        }
        assert_eq!(observations[0],observations[1]);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
