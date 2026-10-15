//! A store written by the frozen 0.4.28 binary adopts digest-addressed
//! aggregate rows before the current engine serves it.
use rusqlite::Connection;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

const BASELINE_SOURCE: &str = r#"use personas alice
table groups:
  owner: principal
  immutable owner
  insert <- allow
  public
table entries:
  group: text <=256
  ownerGroup: groups
  amount: int
  immutable ownerGroup
  insert <- allow
  public
view totals: sum entries of .amount by .group
  public
table pointers:
  total: totals
  insert <- allow
  public
view pointerTotals: count pointers by .total
  public
table saved:
  target: pointerTotals
  insert <- allow
  public
mutation createGroup(id: id, owner: principal):
  insert groups {id, owner}
mutation add(group: text <=256, ownerGroup: groups, amount: int):
  insert entries {group, ownerGroup, amount}
mutation point(total: totals):
  insert pointers {total}
mutation save(target: pointerTotals):
  insert saved {target}
query total(group: text <=256):
  return totals[group]
"#;

const SOURCE: &str = r#"use personas alice
table groups:
  owner: principal
  immutable owner
  insert <- allow
  public
table entries:
  group: text <=256
  ownerGroup: groups
  amount: int
  immutable ownerGroup
  insert <- allow
  public
view totals: sum entries of .amount by .group
  public
view ownerTotals: count entries by .ownerGroup.owner
  public
table pointers:
  total: totals
  insert <- allow
  public
view pointerTotals: count pointers by .total
  public
table saved:
  target: pointerTotals
  insert <- allow
  public
mutation createGroup(id: id, owner: principal):
  insert groups {id, owner}
mutation add(group: text <=256, ownerGroup: groups, amount: int):
  insert entries {group, ownerGroup, amount}
mutation point(total: totals):
  insert pointers {total}
mutation save(target: pointerTotals):
  insert saved {target}
query total(group: text <=256):
  return totals[group]
"#;

const CHAIN_SOURCE: &str = r#"use personas alice
table links:
  previous: chain ?
  insert <- allow
  public
view chain: count links by .previous
  public
table saved:
  target: chain
  insert <- allow
  public
mutation add(previous: chain ?):
  insert links {previous}
mutation save(target: chain):
  insert saved {target}
query count(previous: chain ?):
  return chain[previous]
"#;

const GROUPING_BASELINE_SOURCE: &str = r#"use personas alice
table entries:
  n: int
  bucket: int
  insert <- allow
  public
view totals: count entries by .n
  public
mutation add(n: int, bucket: int):
  insert entries {n, bucket}
query total(n: int):
  return totals[n]
"#;

const GROUPING_SOURCE: &str = r#"use personas alice
table entries:
  n: int
  bucket: int
  insert <- allow
  public
view totals: count entries by .bucket
  public
mutation add(n: int, bucket: int):
  insert entries {n, bucket}
query total(bucket: int):
  return totals[bucket]
"#;

struct Temp(PathBuf);
impl Temp {
    fn new(source: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "snapback4-maintained-id-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(path.join("snapback")).unwrap();
        fs::write(path.join("snapback/schema.q"), source).unwrap();
        Self(path)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn aggregate_id(store: &Path) -> String {
    Connection::open(store)
        .unwrap()
        .query_row(
            "SELECT r.id FROM r JOIN _catalog c ON c.num=r.t WHERE c.name='totals'",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
#[ignore = "requires frozen 0.4.28 binary via SNAPBACK4_BASELINE_BIN"]
fn a_0_4_28_store_rebuilds_legacy_aggregate_ids_and_fences_old_devices() {
    let baseline = PathBuf::from(
        std::env::var_os("SNAPBACK4_BASELINE_BIN")
            .expect("set SNAPBACK4_BASELINE_BIN to the frozen 0.4.28 snapback4 binary"),
    );
    assert!(
        baseline.is_file(),
        "SNAPBACK4_BASELINE_BIN is not a file: {}",
        baseline.display()
    );
    let version = Command::new(&baseline).arg("--version").output().unwrap();
    assert!(version.status.success());
    assert!(
        String::from_utf8_lossy(&version.stdout).contains("0.4.28"),
        "unexpected baseline: {:?}",
        version
    );

    let dir = Temp::new(BASELINE_SOURCE);
    let group_id = "g";
    let created = Command::new(&baseline)
        .current_dir(&dir.0)
        .args([
            "run",
            "createGroup",
            &serde_json::json!({"id": group_id, "owner": "alice"}).to_string(),
            "--as",
            "alice",
            "--now",
            "1",
            "--json",
        ])
        .output()
        .unwrap();
    assert!(created.status.success(), "{}", String::from_utf8_lossy(&created.stderr));
    let group = "x".repeat(200);
    let args = serde_json::json!({"group": group, "ownerGroup": group_id, "amount": 7}).to_string();
    let written = Command::new(&baseline)
        .current_dir(&dir.0)
        .args(["run", "add", &args, "--as", "alice", "--now", "1", "--json"])
        .output()
        .unwrap();
    assert!(
        written.status.success(),
        "{}",
        String::from_utf8_lossy(&written.stderr)
    );
    let store = dir.0.join(".snapback4/store.sqlite");
    let legacy = aggregate_id(&store);
    assert!(
        !snapback4_core::value::identity_fits(&legacy),
        "the frozen binary must have written the oversized legacy address"
    );
    let small_group = "small";
    let legacy_small = snapback4_core::value::canonical_json(&[
        snapback4_core::Value::String(small_group.into()),
    ]);
    let legacy_pointer_total = snapback4_core::value::canonical_json(&[
        snapback4_core::Value::Id(legacy_small.clone()),
    ]);
    for (operation, args) in [
        ("add", serde_json::json!({"group": small_group, "ownerGroup": group_id, "amount": 3})),
        ("point", serde_json::json!({"total": legacy_small})),
        ("save", serde_json::json!({"target": legacy_pointer_total})),
    ] {
        let output = Command::new(&baseline).current_dir(&dir.0)
            .args(["run", operation, &args.to_string(), "--as", "alice", "--now", "1", "--json"])
            .output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    }
    let before: u64 = Connection::open(&store)
        .unwrap()
        .query_row(
            "SELECT value FROM _meta WHERE key='generation'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap()
        .parse()
        .unwrap();

    // Adding this path records ownerGroup.owner on entries. Adoption must
    // capture it without rebuilding totals before the legacy id maps have
    // translated pointers and saved.
    fs::write(dir.0.join("snapback/schema.q"), SOURCE).unwrap();

    let opened = Command::new(env!("CARGO_BIN_EXE_snapback4"))
        .current_dir(&dir.0)
        .args([
            "run",
            "total",
            &serde_json::json!({"group": group}).to_string(),
            "--as",
            "alice",
            "--now",
            "2",
            "--json",
        ])
        .output()
        .unwrap();
    assert!(
        opened.status.success(),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&opened.stdout),
        String::from_utf8_lossy(&opened.stderr)
    );
    let answer: serde_json::Value = serde_json::from_slice(&opened.stdout).unwrap();
    assert_eq!(answer["data"], 7, "{answer}");

    let digest = aggregate_id(&store);
    assert_eq!(digest.len(), 64);
    assert_ne!(digest, legacy);
    let conn = Connection::open(&store).unwrap();
    let (after, marker): (u64, String) = (
        conn.query_row(
            "SELECT value FROM _meta WHERE key='generation'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap()
        .parse()
        .unwrap(),
        conn.query_row(
            "SELECT value FROM _meta WHERE key=?1",
            [snapback4_core::schema::MAINTAINED_ID_META],
            |row| row.get(0),
        )
        .unwrap(),
    );
    assert!(
        after > before,
        "identity adoption must publish a new device generation"
    );
    assert_eq!(marker, snapback4_core::schema::MAINTAINED_ID_VERSION);
    let small_digest = snapback4_core::schema::maintained_id(&[snapback4_core::Value::String(small_group.into())]);
    let pointer: String = conn.query_row(
        "SELECT r.data FROM r JOIN _catalog c ON c.num=r.t WHERE c.name='pointers'",
        [], |row| row.get(0),
    ).unwrap();
    let pointer: snapback4_core::Value = serde_json::from_str(&pointer).unwrap();
    assert_eq!(pointer.field("total").unwrap(), &snapback4_core::Value::Id(small_digest.clone()), "adoption rewrites surviving references before replacing their aggregate targets");
    let pointer_total_digest = snapback4_core::schema::maintained_id(&[
        snapback4_core::Value::Id(small_digest),
    ]);
    let saved: String = conn.query_row(
        "SELECT r.data FROM r JOIN _catalog c ON c.num=r.t WHERE c.name='saved'",
        [], |row| row.get(0),
    ).unwrap();
    let saved: snapback4_core::Value = serde_json::from_str(&saved).unwrap();
    assert_eq!(saved.field("target").unwrap(), &snapback4_core::Value::Id(pointer_total_digest.clone()), "adoption resolves aggregate-reference dependencies before rewriting transitive references");
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM r JOIN _catalog c ON c.num=r.t WHERE c.name='pointerTotals' AND r.id=?1",
        [&pointer_total_digest], |row| row.get(0),
    ).unwrap();
    assert_eq!(count, 1, "the transitive reference must address the rebuilt aggregate row");

    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let required =
        snapback4_core::device_protocol::compatibility(&bound.schema.public_projection());
    assert!(
        required
            .capabilities
            .contains(&"maintained-id-sha256-v1".to_owned())
    );
    let mut old = snapback4_core::device_protocol::DeviceEngine::current();
    old.version = "0.4.28".into();
    old.capabilities
        .retain(|capability| capability != "maintained-id-sha256-v1");
    let refusal = snapback4_core::device_protocol::check(Some(&old), &required).unwrap_err();
    assert_eq!(refusal.code, "E_DEVICE_VERSION");
    assert!(
        refusal.message.contains("maintained-id-sha256-v1"),
        "{refusal:?}"
    );
}

#[test]
#[ignore = "requires frozen 0.4.28 binary via SNAPBACK4_BASELINE_BIN"]
fn a_0_4_28_store_adopts_an_acyclic_same_target_reference_chain() {
    let baseline = PathBuf::from(
        std::env::var_os("SNAPBACK4_BASELINE_BIN")
            .expect("set SNAPBACK4_BASELINE_BIN to the frozen 0.4.28 snapback4 binary"),
    );
    assert!(baseline.is_file(), "SNAPBACK4_BASELINE_BIN is not a file: {}", baseline.display());
    let dir = Temp::new(CHAIN_SOURCE);
    let legacy_root = snapback4_core::value::canonical_json(&[snapback4_core::Value::Null]);
    let legacy_next = snapback4_core::value::canonical_json(&[
        snapback4_core::Value::Id(legacy_root.clone()),
    ]);
    for (operation, args) in [
        ("add", serde_json::json!({"previous": null})),
        ("add", serde_json::json!({"previous": legacy_root})),
        ("save", serde_json::json!({"target": legacy_next})),
    ] {
        let output = Command::new(&baseline)
            .current_dir(&dir.0)
            .args(["run", operation, &args.to_string(), "--as", "alice", "--now", "1", "--json"])
            .output()
            .unwrap();
        assert!(output.status.success(), "{operation}: {}", String::from_utf8_lossy(&output.stderr));
    }

    let root = snapback4_core::schema::maintained_id(&[snapback4_core::Value::Null]);
    let next = snapback4_core::schema::maintained_id(&[
        snapback4_core::Value::Id(root.clone()),
    ]);
    let opened = Command::new(env!("CARGO_BIN_EXE_snapback4"))
        .current_dir(&dir.0)
        .args([
            "run",
            "count",
            &serde_json::json!({"previous": root}).to_string(),
            "--as",
            "alice",
            "--now",
            "2",
            "--json",
        ])
        .output()
        .unwrap();
    assert!(opened.status.success(), "stdout={} stderr={}", String::from_utf8_lossy(&opened.stdout), String::from_utf8_lossy(&opened.stderr));
    let answer: serde_json::Value = serde_json::from_slice(&opened.stdout).unwrap();
    assert_eq!(answer["data"], 1, "{answer}");

    let store = dir.0.join(".snapback4/store.sqlite");
    let saved: String = Connection::open(&store).unwrap().query_row(
        "SELECT r.data FROM r JOIN _catalog c ON c.num=r.t WHERE c.name='saved'",
        [],
        |row| row.get(0),
    ).unwrap();
    let saved: snapback4_core::Value = serde_json::from_str(&saved).unwrap();
    assert_eq!(saved.field("target").unwrap(), &snapback4_core::Value::Id(next));
}

#[test]
#[ignore = "requires frozen 0.4.28 binary via SNAPBACK4_BASELINE_BIN"]
fn a_0_4_28_store_can_change_grouping_while_adopting_digest_ids() {
    let baseline = PathBuf::from(
        std::env::var_os("SNAPBACK4_BASELINE_BIN")
            .expect("set SNAPBACK4_BASELINE_BIN to the frozen 0.4.28 snapback4 binary"),
    );
    assert!(baseline.is_file(), "SNAPBACK4_BASELINE_BIN is not a file: {}", baseline.display());
    let dir = Temp::new(GROUPING_BASELINE_SOURCE);
    for (n, bucket) in [(1, 7), (2, 7)] {
        let output = Command::new(&baseline)
            .current_dir(&dir.0)
            .args([
                "run", "add", &serde_json::json!({"n": n, "bucket": bucket}).to_string(),
                "--as", "alice", "--now", "1", "--json",
            ])
            .output()
            .unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    }
    fs::write(dir.0.join("snapback/schema.q"), GROUPING_SOURCE).unwrap();

    let opened = Command::new(env!("CARGO_BIN_EXE_snapback4"))
        .current_dir(&dir.0)
        .args([
            "run", "total", &serde_json::json!({"bucket": 7}).to_string(),
            "--as", "alice", "--now", "2", "--json",
        ])
        .output()
        .unwrap();
    assert!(opened.status.success(), "stdout={} stderr={}",
        String::from_utf8_lossy(&opened.stdout), String::from_utf8_lossy(&opened.stderr));
    let answer: serde_json::Value = serde_json::from_slice(&opened.stdout).unwrap();
    assert_eq!(answer["data"], 2, "{answer}");

    let store = dir.0.join(".snapback4/store.sqlite");
    let conn = Connection::open(store).unwrap();
    let ids: Vec<String> = {
        let mut statement = conn.prepare(
            "SELECT r.id FROM r JOIN _catalog c ON c.num=r.t WHERE c.name='totals' ORDER BY r.id"
        ).unwrap();
        statement.query_map([], |row| row.get(0)).unwrap().collect::<Result<_, _>>().unwrap()
    };
    assert_eq!(ids.len(), 1);
    assert_eq!(ids[0], snapback4_core::schema::maintained_id(&[snapback4_core::Value::Int(7)]));
    let marker: String = conn.query_row(
        "SELECT value FROM _meta WHERE key=?1",
        [snapback4_core::schema::MAINTAINED_ID_META],
        |row| row.get(0),
    ).unwrap();
    assert_eq!(marker, snapback4_core::schema::MAINTAINED_ID_VERSION);
}
