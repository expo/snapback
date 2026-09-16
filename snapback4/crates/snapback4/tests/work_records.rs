use snapback4_core::{Context, Engine, Store, Value, identity, engine::actions::ActionSettled};
use serde_json::json;
use std::{collections::BTreeMap, path::PathBuf, process::Command};

const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
const SOURCE: &str = "use identity\neffect notify\naction invite(message: text <=100)\nmutation answer(n: int):\n  emit notify { n }\n  return n\n";

struct Fixture(PathBuf);
impl Drop for Fixture { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }

#[test]
fn why_work_ids_report_metadata_and_only_print_values_on_request() {
    for release in [false, true] {
        let root = std::env::temp_dir().join(format!("sb4-why-{}-{}", std::process::id(), release));
        let f = Fixture(root.clone());
        std::fs::create_dir_all(root.join("snapback")).unwrap();
        std::fs::write(root.join("snapback/schema.q"), SOURCE).unwrap();
        let deployment = root.join("release");
        let path = if release {
            let out = Command::new(BIN).args(["deploy", deployment.to_str().unwrap()]).current_dir(&root).output().unwrap();
            assert!(out.status.success(), "{out:?}");
            deployment.join("store.sqlite")
        } else { root.join(".snapback4/store.sqlite") };
        let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = if release { Engine::attach_release(Store::open(&path).unwrap(), 1).unwrap() }
            else { Engine::new(Store::open(&path).unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap() };
        let session = identity::custom_session(engine.store(), "member:alice", "member", 100, 1).unwrap();
        engine.request_action("invite", "request-id", Context::new(&session.principal, BTreeMap::from([("message".into(), Value::String("private-argument".into()))])).with_session(&session.token).at(110)).unwrap();
        let claim = engine.claim_actions("service:worker", None, 1, 10_000, 10, 120).unwrap().remove(0);
        engine.settle_action("request-id", "service:worker", &claim.session.token, ActionSettled::Done(json!("private-result")), 130).unwrap();
        engine.mutate("answer", Some("mutation-id"), Context::new(&session.principal, BTreeMap::from([("n".into(), Value::Int(987654))])).at(140)).unwrap();
        let effect = engine.claim_effects("service:worker", None, 1, 10_000, 150).unwrap().remove(0);
        engine.settle_effect(&effect.id, "service:worker", snapback4_core::Settled::Done { result: Some(Value::String("private-effect-result".into())) }, 160).unwrap();
        drop(engine);
        for (id, kind, secret) in [("request-id", "action", "private-result"), ("mutation-id", "mutation", "987654"), (effect.id.as_str(), "effect", "private-effect-result")] {
            let explain = |values: bool| {
                let mut command = Command::new(BIN);
                command.current_dir(&root).args(["why", id]);
                if release { command.args(["--release", deployment.to_str().unwrap()]); }
                if values { command.arg("--values"); }
                let out = command.output().unwrap();
                assert!(out.status.success(), "{out:?}");
                String::from_utf8(out.stdout).unwrap()
            };
            let metadata = explain(false);
            assert!(metadata.starts_with(&format!("{kind} {id}")), "{metadata}");
            for field in ["operation:", "principal:", "admitted at:", "binding:", "state:", "attempts:", "lease until:", "last error:", "settled at:", "arguments:", "result:"] { assert!(metadata.contains(field), "{metadata}"); }
            assert!(!metadata.contains(secret), "{metadata}");
            assert!(!metadata.contains("private-argument"), "{metadata}");
            assert!(!metadata.contains(&session.token), "tokens are never inspectable");
            if kind == "action" { assert!(metadata.contains("generation 0")); assert!(metadata.contains("settled at: 130")); }
            if kind == "mutation" { assert!(metadata.contains("commit sequence: 1")); }
            if kind == "effect" { assert!(metadata.contains("settled at: 160")); }
            if kind == "mutation" {
                let values = explain(true);
                assert!(values.contains("arguments: not recorded"), "{values}");
                assert!(values.contains("result: not recorded"), "{values}");
                assert!(!values.contains(secret), "{values}");
            } else {
                assert!(metadata.contains("sha256"), "{metadata}");
                assert!(explain(true).contains(secret));
            }
        }
        drop(f);
    }
}
