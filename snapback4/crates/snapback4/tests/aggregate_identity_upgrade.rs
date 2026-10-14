//! A store written by the frozen 0.4.28 binary adopts digest-addressed
//! aggregate rows before the current engine serves it.
use rusqlite::Connection;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

const SOURCE: &str = r#"use personas alice
table entries:
  group: text <=256
  amount: int
  insert <- allow
  public
view totals: sum entries of .amount by .group
  public
mutation add(group: text <=256, amount: int):
  insert entries {group, amount}
query total(group: text <=256):
  return totals[group]
"#;

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "snapback4-maintained-id-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(path.join("snapback")).unwrap();
        fs::write(path.join("snapback/schema.q"), SOURCE).unwrap();
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

    let dir = Temp::new();
    let group = "x".repeat(200);
    let args = serde_json::json!({"group": group, "amount": 7}).to_string();
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
