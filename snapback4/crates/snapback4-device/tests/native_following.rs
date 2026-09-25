//! A guest query with an empty Quarry body must still withhold unavailable cards.
mod common;

use common::{Host, Memory, Sqlite, args, id, snapshot_pages};
use serde_json::json;
use sha2::{Digest, Sha256};
use snapback4_core::{Context, Value, WriteState};
use std::{path::PathBuf, sync::OnceLock};

fn module() -> &'static [u8] {
    static MODULE: OnceLock<Vec<u8>> = OnceLock::new();
    MODULE.get_or_init(|| {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let target = root.join("target/native-fixture");
        let output = std::process::Command::new("cargo")
            .args(["build", "--release", "--quiet", "--target", "wasm32-unknown-unknown", "--manifest-path"])
            .arg(root.join("native-fixtures/following/Cargo.toml"))
            .arg("--target-dir").arg(&target)
            .env_remove("CARGO_TARGET_DIR").output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        std::fs::read(target.join("wasm32-unknown-unknown/release/sb4_fixture_following.wasm")).unwrap()
    })
}

fn reads<H: Host>(mut host: H) {
    let base = include_str!("../../snapback4-lang/tests/fixtures/following-view.q");
    let digest: String = Sha256::digest(module()).iter().map(|b| format!("{b:02x}")).collect();
    for (n, sync) in ["sync public", "sync public last 3 by .at", "online only"].iter().enumerate() {
        let source = base.replacen("sync public", sync, 1)
            + "\nquery native_cards(postId: posts, c: text <=2000 ?): native\nquery native_large(postId: posts, c: text <=2000 ?): native\n";
        let (mut server, backend) = common::compile(&source);
        assert!(backend.programs.iter().find(|p| p.name == "native_cards").unwrap().body.is_empty());
        server.install_native(module()).unwrap();
        for i in 0..5 {
            let write = server.mutate("post", None, Context::new("alice", args(&[
                ("postId", id(&format!("p{i}"))), ("parentId", Value::Null),
            ])).at(i + 1)).unwrap();
            assert!(matches!(write.state, WriteState::Sent { .. }));
        }
        let mut device = host.open(&format!("alice-{n}"), Some(backend.clone())).unwrap();
        for (i, page) in snapshot_pages(&mut server, "alice", 37).iter().enumerate() {
            device.apply(page, i == 0).unwrap();
        }
        device.install_native(module(), &digest, backend.generation).unwrap();
        for post in ["p0", "p4"] {
            let withheld = *sync == "online only" || (*sync != "sync public" && post == "p0");
            let (answer, unknown, _) = device.query_with_coverage("native_cards", "alice", &json!({"postId":post,"c":null}), 10);
            let answer = answer.unwrap();
            assert_eq!(answer.unavailable, withheld, "{sync} {post}: {answer:?}");
            assert_eq!(unknown, withheld);
            assert!(answer.tables.contains(&"posts".into()) && answer.tables.contains(&"feedFeed".into()));
            if withheld {
                assert_eq!(answer.data, Value::Null);
                assert!(answer.next.is_none());
            } else {
                assert!(answer.complete);
                assert_eq!(answer.data.field("original").unwrap().field("id").unwrap().as_str().unwrap(), post);
            }
            let wire = snapback4_device::call::call(&mut device, json!({
                "op":"query", "name":"native_cards", "viewer":"alice", "args":{"postId":post,"c":null}, "now":10
            }));
            if withheld {
                assert_eq!(wire["ok"]["loading"], true, "{wire}");
                assert!(wire["ok"].get("data").is_none() && wire["ok"].get("next").is_none());
            }
            let remote = server.query("native_cards", Context::new("alice", args(&[("postId", id(post)), ("c", Value::Null)]))).unwrap();
            assert!(remote.complete && !remote.unavailable);
            assert_eq!(remote.data.field("original").unwrap().field("id").unwrap().as_str().unwrap(), post);
            let large = device.query("native_large", "alice", &json!({"postId":post,"c":null}), 10);
            if withheld {
                let large = large.unwrap();
                assert!(large.unavailable && large.next.is_none());
                assert_eq!(large.data, Value::Null);
                assert!(large.metered.output_bytes < 100);
            } else {
                assert_eq!(large.unwrap_err().code, "E_BOUND", "known native output remains bounded");
            }
        }
    }
}

#[test]
fn native_following_memory() { reads(Memory::new()); }

#[test]
fn native_following_sqlite() { reads(Sqlite::new("native-following")); }
