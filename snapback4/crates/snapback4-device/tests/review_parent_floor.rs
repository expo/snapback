mod common;
use common::*;
use serde_json::json;
use snapback4_core::Value;
fn scenario<H: Host>(host: &mut H) {
    let source = "table parentsA:\n  public\n  sync public\ntable parentsB:\n  public\n  sync public\ntable alpha:\n  parent: parentsA\n  ordinal: sequence by parent\n  public\n  sync public\n  insert <- allow\ntable omega:\n  parent: parentsB\n  ordinal: sequence by parent\n  public\n  sync public\n  insert <- allow\nmutation add(parent: parentsB):\n  return insert omega { parent }\n";
    for other_floor in [2, 17, snapback4_core::value::I53_MAX] {
        for reverse in [false, true] {
            let source = if reverse {
                source
                    .replace("parentsA", "parentsTemp")
                    .replace("parentsB", "parentsA")
                    .replace("parentsTemp", "parentsB")
            } else {
                source.into()
            };
            let (mut e, backend) = compile(&source);
            e.load_trusted(["parentsA", "parentsB"].map(|table| (
                table.into(), snapback4_core::value::object([("id", id("p"))]),
            ))).unwrap();
            e.load_trusted([("alpha", "high", other_floor), ("omega", "low", 1)].map(
                |(t, n, o)| {
                    (
                        t.into(),
                        snapback4_core::value::object([
                            ("id", id(n)),
                            ("parent", id("p")),
                            ("ordinal", Value::Int(o)),
                        ]),
                    )
                },
            ))
            .unwrap();
            let name = format!("parent-types-{other_floor}-{reverse}");
            let mut d = host.open(&name, Some(backend)).unwrap();
            for (i, page) in snapshot_pages(&mut e, "alice", 100).iter().enumerate() {
                d.apply(page, i == 0).unwrap();
            }
            let p = d
                .predict(
                    "add",
                    "alice",
                    &json!({"parent":"p"}),
                    1000,
                    vec!["pending".into()],
                    0,
                )
                .unwrap();
            assert_eq!(
                p.result["ordinal"], 2,
                "equal ids in distinct parent tables must not share floors"
            );
            host.close(&name, d);
        }
    }
}
#[test]
fn parent_type_floor_memory() {
    scenario(&mut Memory::new());
}
#[test]
fn parent_type_floor_sqlite() {
    scenario(&mut Sqlite::new("parent-type-floor"));
}
