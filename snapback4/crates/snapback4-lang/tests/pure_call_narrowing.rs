use snapback4_core::{Context, Engine, Value, wire};
use snapback4_lang::{Bound, compile};
use std::collections::BTreeMap;

const WINDOWS: &str = include_str!("../../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.3/astra/source/snapback/windows.q");
const TABLE: &str = "table conversations:\n  disappearing: text\n  public\n";

fn bound(source: &str) -> Bound {
    compile(&[("schema.q".into(), source.into()), ("windows.q".into(), WINDOWS.into())])
}
fn checked(source: &str) -> Bound {
    let bound = bound(source);
    assert!(bound.diagnostics.is_empty(), "{source}\n{:?}", bound.diagnostics);
    bound
}
fn refused(source: &str) {
    let bound = bound(source);
    let error = bound.diagnostics.iter().find(|d| d.code == "E_QUARRY_TYPE")
        .unwrap_or_else(|| panic!("{source}\n{:?}", bound.diagnostics));
    assert!(error.message.contains("present numbers"), "{error:?}");
    assert!(error.rewrite.contains("bind the optional call once"), "{error:?}");
}

#[test]
fn builders_exact_ttl_expression_and_nested_calls_compile_and_run() {
    for call in ["windows.ttl(c.disappearing)", "identity(windows.ttl(c.disappearing))"] {
        let source = format!("{TABLE}fn identity(value: int ?): value\nquery run(id: conversations):\n  c = conversations[id] ! else NOT_FOUND\n  return {{ expiresAt: now + {call} if {call} != null else null }}\n");
        let b = checked(&source);
        let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        for (id, setting, expected) in [("on", "24h", Value::Int(180_100)), ("off", "never", Value::Null)] {
            let row = wire::row_from_json(&engine.schema().tables["conversations"], &serde_json::json!({"id": id, "disappearing": setting})).unwrap();
            engine.load(vec![("conversations".into(), row)]).unwrap();
            let result = engine.query("run", Context::new("alice", BTreeMap::from([("id".into(), Value::Id(id.into()))])).at(100)).unwrap();
            assert!(result.complete);
            assert_eq!(result.data.field("expiresAt").unwrap(), &expected, "{call}");
        }
    }
}

#[test]
fn call_facts_follow_branch_scope_and_surviving_guards() {
    for body in [
        "return windows.ttl(setting) + 1 if windows.ttl(setting) != null else null",
        "return windows.ttl('24h') + 1 if windows.ttl('24h') != null else null",
        "require windows.ttl(setting) != null else ABSENT\n  return windows.ttl(setting) + 1",
        "if windows.ttl(setting) = null:\n    return null\n  return windows.ttl(setting) + 1",
        "return windows.ttl(setting) != null and windows.ttl(setting) + 1 > 0",
        "if windows.ttl(setting) != null:\n    return windows.ttl(setting) + 1\n  return null",
    ] {
        checked(&format!("query run(setting: text):\n  {body}\n"));
    }
    checked("fn fixed(): 1 if true else null\nquery run():\n  return fixed() + 1 if fixed() != null else null\n");
    refused("query run(setting: text):\n  if windows.ttl(setting) != null:\n    n = windows.ttl(setting) + 1\n  return windows.ttl(setting) + 1\n");
    refused("query run(a: text, b: text):\n  return windows.ttl(b) + 1 if windows.ttl(a) != null else null\n");
}

#[test]
fn read_effect_clock_and_unstable_arguments_keep_the_bind_once_rewrite() {
    for helper in [
        "fn storedSetting(key: conversations): conversations[key].disappearing\nfn optional(key: conversations):\n  value = storedSetting(key)\n  return 1 if value != null else null\n",
        "fn optional(key: conversations):\n  value = now\n  return 1 if value > 0 else null\n",
        "fn optional(key: conversations):\n  row = update conversations[key] { disappearing: 'never' }\n  return 1 if true else null\n",
        "effect notify\nfn optional(key: conversations):\n  emit notify { key }\n  return 1 if true else null\n",
    ] {
        refused(&format!("{TABLE}{helper}mutation run(key: conversations):\n  return optional(key) + 1 if optional(key) != null else null\n"));
    }
    refused(&format!("{TABLE}query run(key: conversations):\n  return windows.ttl(conversations[key].disappearing ?? 'never') + 1 if windows.ttl(conversations[key].disappearing ?? 'never') != null else null\n"));
    for (helper, arg) in [
        ("fn optional(c: conversations ?): 1 if c != null else null", "conversations[key]"),
        ("fn optional(setting: text ?): windows.ttl(setting ?? 'never')", "conversations[key].disappearing"),
    ] {
        refused(&format!("{TABLE}{helper}\nquery run(key: conversations):\n  return optional({arg}) + 1 if optional({arg}) != null else null\n"));
    }
    refused("fn optional(t: time): 1 if t > 0 else null\nquery run():\n  return optional(now) + 1 if optional(now) != null else null\n");
}

#[test]
fn reassignment_and_loop_carries_invalidate_every_argument_dependency() {
    for body in [
        "s = '24h'\n  require windows.ttl(s) != null else ABSENT\n  s = 'never'\n  return windows.ttl(s) + 1",
        "s = 1\n  require number(s) != null else ABSENT\n  total = 0\n  for i in [1, 2]:\n    total = total + number(s)\n    s = 0\n  return total",
        "s = '24h'\n  other = '24h'\n  require pair(s, other) != null else ABSENT\n  other = 'never'\n  return pair(s, other) + 1",
    ] {
        refused(&format!("fn number(n: int): 1 if n > 0 else null\nfn pair(a: text, b: text): 1 if a = b else null\nquery run():\n  {body}\n"));
    }
}
