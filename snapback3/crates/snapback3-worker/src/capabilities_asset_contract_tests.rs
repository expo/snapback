use super::*;
use std::fs;

struct TemporaryProject(PathBuf);

impl TemporaryProject {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "snapback3-worker-compiled-assets-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(path.join("snapback")).unwrap();
        fs::write(
            path.join("snapback/schema.q"),
            r#"use identity

table publicMedia:
  photo: image <=50000000 ?
  oncePhoto: image <=50000000 once ?
  public
  insert <- allow

table privateMedia:
  owner: principal
  photo: image <=50000000
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- deny
  delete <- deny
"#,
        )
        .unwrap();
        fs::write(
            path.join("snapback/media.q"),
            r#"mutation attachPublic(rowId: id, photo: image <=50000000):
  row = insert publicMedia { id: rowId, photo, oncePhoto: null }
  return { id: row.id }

mutation attachOnce(rowId: id, photo: image <=50000000):
  row = insert publicMedia { id: rowId, photo: null, oncePhoto: photo }
  return { id: row.id }

mutation attachPrivate(rowId: id, photo: image <=50000000):
  row = insert privateMedia { id: rowId, owner: viewer, photo }
  return { id: row.id }
"#,
        )
        .unwrap();
        Self(path)
    }
}

impl Drop for TemporaryProject {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn compile_project(root: &PathBuf) -> ProjectJson {
    let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let compiler = workspace.join("packages/snapback3/dist/compiler.mjs");
    let mut child = Command::new("node")
        .arg(&compiler)
        .arg("--worker")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("bundled compiler starts");
    writeln!(
        child.stdin.as_mut().unwrap(),
        "{}",
        json!({"id":1,"op":"compile","root":root})
    )
    .unwrap();
    drop(child.stdin.take());
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let reply: Json = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(reply["ok"], true, "{reply}");
    let mut project = reply["project"].clone();
    project["version"] = json!(1);
    project["auth"] = project["schema"]["auth"].clone();
    serde_json::from_value(project).unwrap()
}

fn file_owner(database: &TemporaryStore, generation: snapback3_core::Generation) -> Owner {
    let capabilities = crate::project::RuntimeCapabilities::parse(Some("media")).unwrap();
    Owner {
        runtime: snapback3_core::Runtime::open(Store::open(&database.0).unwrap(), generation)
            .unwrap(),
        development: true,
        capabilities,
        connected_counts: BTreeMap::new(),
    }
}

fn attach(
    owner: &mut Owner,
    token: &str,
    manifest: &Json,
    op: &str,
    intent: &str,
    row_id: &str,
    id: &str,
) {
    let result = owner
        .call(
            "mutation",
            &json!({
                "token":token,"intent":intent,"op":op,
                "planHash":manifest["programs"][op]["planHash"],
                "schemaHash":manifest["schemaHash"],
                "args":{"rowId":row_id,"photo":{"id":id,"width":4,"height":3}}
            }),
        )
        .unwrap();
    assert_eq!(result["state"], "committed", "{result}");
}

fn begin(owner: &mut Owner, token: &str, bytes: u64) -> String {
    owner
        .call(
            "asset.begin",
            &json!({"token":token,"kind":"image","bytes":bytes}),
        )
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn reserve(owner: &mut Owner, token: &str, id: &str, bytes: u64) -> Json {
    owner
        .call(
            "asset.reserve",
            &json!({"token":token,"id":id,"bytes":bytes}),
        )
        .unwrap()
}

fn finalize(owner: &mut Owner, token: &str, id: &str, bytes: u64) {
    owner
        .call(
            "asset.finalize",
            &json!({
                "token":token,"id":id,
                "facts":{"type":"image/png","bytes":bytes,"width":4,"height":3}
            }),
        )
        .unwrap();
}

#[test]
fn compiled_asset_contract_reserves_before_publication_and_preserves_public_authority() {
    let project_root = TemporaryProject::new();
    let project = compile_project(&project_root.0);
    let capabilities = crate::project::RuntimeCapabilities::parse(Some("media")).unwrap();
    let generation = crate::project::certify(project, &capabilities).unwrap();
    let database = TemporaryStore::new("compiled-asset-contract");
    let mut owner = file_owner(&database, generation.clone());
    let alice = persona(&mut owner, "alice");
    let bob = persona(&mut owner, "bob");

    let id = begin(&mut owner, &alice, 10_000_000);
    let mut fillers = Vec::new();
    for _ in 0..5 {
        fillers.push(begin(&mut owner, &alice, 50_000_000));
    }
    assert_eq!(
        owner
            .call(
                "asset.reserve",
                &json!({"token":bob,"id":id,"bytes":18_000_000})
            )
            .unwrap_err()
            .code,
        "S3_ASSET_UNAVAILABLE",
        "only the authenticated creator can reserve finalized growth"
    );
    assert_eq!(
        owner
            .call(
                "asset.reserve",
                &json!({"token":alice,"id":id,"bytes":20_000_000})
            )
            .unwrap_err()
            .code,
        "S3_ASSET_TOO_LARGE",
        "finalized growth is quota-admitted before publication"
    );
    let admitted = json!({"id":id,"bytes":18_000_000});
    assert_eq!(reserve(&mut owner, &alice, &id, 18_000_000), admitted);
    drop(owner); // Model a committed reservation whose JSONL reply was lost.

    let mut owner = file_owner(&database, generation);
    assert_eq!(
        reserve(&mut owner, &alice, &id, 18_000_000),
        admitted,
        "the exact reservation survives owner reopen and retry"
    );
    assert_eq!(
        owner
            .call(
                "asset.reserve",
                &json!({"token":alice,"id":id,"bytes":18_000_001})
            )
            .unwrap_err()
            .code,
        "S3_ASSET_TYPE",
        "retry identity binds the finalized byte count"
    );
    finalize(&mut owner, &alice, &id, 18_000_000);
    assert_eq!(reserve(&mut owner, &alice, &id, 18_000_000), admitted);

    let manifest = owner.call("manifest", &json!({})).unwrap();
    attach(
        &mut owner,
        &alice,
        &manifest,
        "media.attachPublic",
        "attach-public",
        "public-row",
        &id,
    );
    let ledger = owner.runtime.store().asset(&id).unwrap().unwrap();
    assert_eq!(
        ledger.locator.as_ref().map(|value| value.table.as_str()),
        Some("publicMedia"),
        "{ledger:?}"
    );
    assert!(
        owner.runtime.generation().schema().tables["publicMedia"]
            .rules
            .read
            .is_public()
    );
    let public = owner
        .call("asset.delivery.public", &json!({"id":id}))
        .unwrap();
    assert_eq!(public["public"], true);
    assert_eq!(public["once"], false);
    assert_eq!(public["bytes"], 18_000_000);
    assert!(public.get("seq").is_none());
    assert!(public.get("token").is_none());

    for filler in fillers {
        owner
            .call("asset.discard", &json!({"token":alice,"id":filler}))
            .unwrap();
    }
    let reclaim = owner
        .call("asset.reclaim", &json!({"after":"","limit":32}))
        .unwrap();
    owner
        .call("asset.reclaim.finish", &json!({"ids":reclaim["ids"]}))
        .unwrap();

    let once = begin(&mut owner, &alice, 1_000);
    reserve(&mut owner, &alice, &once, 1_000);
    finalize(&mut owner, &alice, &once, 1_000);
    attach(
        &mut owner,
        &alice,
        &manifest,
        "media.attachOnce",
        "attach-once",
        "once-row",
        &once,
    );
    assert_eq!(
        owner
            .call("asset.delivery.public", &json!({"id":once}))
            .unwrap_err()
            .code,
        "S3_ASSET_UNAVAILABLE"
    );
    assert_eq!(
        owner
            .call("asset.delivery", &json!({"token":alice,"id":once}))
            .unwrap()["once"],
        true
    );

    let private = begin(&mut owner, &alice, 1_000);
    reserve(&mut owner, &alice, &private, 1_000);
    finalize(&mut owner, &alice, &private, 1_000);
    attach(
        &mut owner,
        &alice,
        &manifest,
        "media.attachPrivate",
        "attach-private",
        "private-row",
        &private,
    );
    for unavailable in ["missing", private.as_str()] {
        assert_eq!(
            owner
                .call("asset.delivery.public", &json!({"id":unavailable}))
                .unwrap_err()
                .code,
            "S3_ASSET_UNAVAILABLE"
        );
    }
    assert_eq!(
        owner
            .call("asset.delivery", &json!({"token":alice,"id":private}))
            .unwrap()["public"],
        false
    );

    let reclaiming = begin(&mut owner, &alice, 1_000);
    owner
        .call("asset.discard", &json!({"token":alice,"id":reclaiming}))
        .unwrap();
    assert_eq!(
        owner
            .call(
                "asset.reserve",
                &json!({"token":alice,"id":reclaiming,"bytes":1_000})
            )
            .unwrap_err()
            .code,
        "S3_ASSET_UNAVAILABLE"
    );
}
