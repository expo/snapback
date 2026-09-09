//! LLP 1016 closing round: blob isolation through the owner's real `BlobStore`. Photos are
//! uploaded over `/api/upload` and attached by a mutation, so their bytes live where the
//! asset sweep and reclamation look (`owner.rs` opens the store, `writer_assets.rs` sweeps,
//! `asset_gc.rs` deletes); a `--dry-run` job releases every one on the copy; the live blob
//! directory is unchanged by content digest, the assets still deliver, and the owner's own
//! reclamation sweep past the grace period reclaims nothing — while the same job run for
//! real makes that sweep delete the bytes, so the witness is the real path, not a stub.
use super::*;
use image::{ExtendedColorType, ImageEncoder, RgbImage};
use snapback2_core::ASSET_RECLAIM_GRACE_MS;
use std::collections::BTreeMap;

fn png(seed: u32) -> Vec<u8> {
    let image = RgbImage::from_fn(4, 4, |x, y| {
        image::Rgb([(x + seed) as u8, (y * 7) as u8, (seed * 13) as u8])
    });
    let mut bytes = Vec::new();
    image::codecs::png::PngEncoder::new(&mut bytes)
        .write_image(image.as_raw(), 4, 4, ExtendedColorType::Rgb8)
        .unwrap();
    bytes
}

/// Every file under the owner's blob directory with the digest of its contents.
fn blob_digests(root: &Path) -> BTreeMap<String, String> {
    fs::read_dir(root.join(".snapback/blobs"))
        .unwrap()
        .map(|entry| {
            let entry = entry.unwrap();
            (
                entry.file_name().to_string_lossy().into_owned(),
                snapback2_core::digest(&fs::read(entry.path()).unwrap()),
            )
        })
        .collect()
}

fn delivered(port: u16, id: &str) -> u16 {
    owner_wire::request_bytes(
        port,
        "GET",
        &format!("/api/asset/{id}"),
        &[("X-Snapback-As", "alice")],
        "application/json",
        &[],
    )
    .status
}

fn advance_clock_past_grace(port: u16, secret: &str) {
    let r = request(
        port,
        "POST",
        "/control/clock",
        &[("X-Snapback-Control", secret)],
        json!({ "advanceMs": ASSET_RECLAIM_GRACE_MS + 1_000 }),
    );
    assert_eq!(r.status, 200, "{}", r.body);
}

#[test]
fn rehearsal_releases_never_reach_the_owners_blob_store_or_its_reclamation_sweep() {
    let root = temp_root();
    fs::create_dir_all(root.join("snapback")).unwrap();
    fs::write(
        root.join("snapback/schema.q"),
        "table items:\n  n: int\n  photo: image <=5000000 ?\n  public\n  insert <- allow\n  update <- allow\n  delete <- allow\n",
    )
    .unwrap();
    fs::write(
        root.join("snapback/admin.q"),
        "mutation attach(id: items, photo: image <=5000000):\n  update items[id] { photo }\n  return true\n\njob release():\n  chunk p in items first 100 by byId:\n    delete items[p.id]\n",
    )
    .unwrap();
    let rows = (0..3)
        .map(|i| json!({"id":format!("item-{i:03}"),"n":i,"photo":null}))
        .collect::<Vec<_>>();
    fs::write(
        root.join("snapback/seed.ts"),
        format!(
            "import {{seed}} from 'snapback2';\nexport default seed({{ personas: ['alice'], rows: {{ items: {} }} }});",
            json!(rows)
        ),
    )
    .unwrap();
    let compiler = compiler(&root);
    let mut owner = ChildGuard::spawn(env!("CARGO_BIN_EXE_snapback2"), &compiler, &root);
    let port: u16 = owner
        .ready_line()
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap()
        .parse()
        .unwrap();
    let record: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = record["secret"].as_str().unwrap().to_owned();
    let control = |path: &str, body: Value| {
        request(port, "POST", path, &[("X-Snapback-Control", &secret)], body)
    };

    // Three photos through the real upload path, attached to three rows by a mutation.
    let mut ids = Vec::new();
    for i in 0..3_u32 {
        let uploaded = owner_wire::request_bytes(
            port,
            "POST",
            "/api/upload",
            &[("X-Snapback-As", "alice")],
            "image/png",
            &png(i),
        );
        assert_eq!(
            uploaded.status,
            200,
            "{}",
            String::from_utf8_lossy(&uploaded.body_bytes)
        );
        let attached = request(
            port,
            "POST",
            "/api/mutation",
            &[("X-Snapback-As", "alice")],
            json!({"op":"admin.attach","args":{"id":format!("item-{i:03}"),"photo":uploaded.body}}),
        );
        assert_eq!(attached.body["state"], "committed", "{}", attached.body);
        ids.push(uploaded.body["id"].as_str().unwrap().to_owned());
    }
    let before = blob_digests(&root);
    assert_eq!(before.len(), 3, "{before:?}");
    for id in &ids {
        assert!(
            before.contains_key(id),
            "{id} is not in the owner's blob store"
        );
        assert_eq!(delivered(port, id), 200);
    }
    let seq = status(port, &secret)["seq"].clone();

    // The rehearsal releases all three on its copy and reports them.
    let receipt = control(
        "/control/job",
        json!({"name":"admin.release","dryRun":true}),
    );
    assert_eq!(receipt.status, 200, "{}", receipt.body);
    let receipt = receipt.body;
    assert_eq!(receipt["dryRun"], true);
    assert_eq!(receipt["state"], "done", "{receipt}");
    assert_eq!(receipt["rowsWritten"]["items"], 3);
    assert_eq!(receipt["assetReleaseCount"], 3, "{receipt}");
    let released = receipt["assetsReleased"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["id"].as_str().unwrap().to_owned())
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(released, ids.iter().cloned().collect());
    assert_eq!(receipt["copyDiscarded"], true);

    // Nothing reached production: the blob store is byte-identical, the assets still
    // deliver, the ledger seq did not move, and the owner's own reclamation sweep — run
    // by the clock advance, past the reclaim grace — finds nothing to reclaim.
    assert_eq!(
        blob_digests(&root),
        before,
        "the rehearsal touched the owner's blob store"
    );
    assert_eq!(
        status(port, &secret)["seq"],
        seq,
        "the rehearsal committed to the live store"
    );
    advance_clock_past_grace(port, &secret);
    assert_eq!(
        blob_digests(&root),
        before,
        "the sweep reclaimed a rehearsal release"
    );
    for id in &ids {
        assert_eq!(delivered(port, id), 200, "{id} no longer delivers");
    }
    assert_eq!(
        fs::read_dir(root.join(".snapback/rehearsals"))
            .unwrap()
            .count(),
        0,
        "the rehearsal copy survived"
    );

    // The positive control: the same job run for real releases the photos on the live
    // store, and the same sweep then deletes their bytes — so the sweep above was real.
    let queued = control("/control/job", json!({"name":"admin.release"}));
    assert_eq!(queued.status, 200, "{}", queued.body);
    let id = queued.body["id"].as_str().unwrap().to_owned();
    wait_for(Duration::from_secs(10), || {
        let r = request(
            port,
            "GET",
            &format!("/control/job/{id}"),
            &[("X-Snapback-Control", &secret)],
            json!({}),
        );
        (r.body["state"] == "done").then_some(())
    });
    advance_clock_past_grace(port, &secret);
    assert!(
        blob_digests(&root).is_empty(),
        "the real release was not reclaimed: {:?}",
        blob_digests(&root)
    );
    for id in &ids {
        assert_ne!(
            delivered(port, id),
            200,
            "{id} still delivers after reclamation"
        );
    }
    stop_owner(port, &secret, &mut owner, "rehearsal blob isolation");
    fs::remove_dir_all(root).unwrap();
}
