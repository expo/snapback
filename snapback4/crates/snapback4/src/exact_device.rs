//! Mounted Exact apps carry their actual wasm engine stamp, not the npm pin.
// @ref LLP 3000.001.000#build-stamp — inspect the bytes mounted by app.json.
use std::{fs, path::{Path, PathBuf}};
use snapback4_core::{Schema, device_protocol::{self, DeviceEngine}};
fn leb(bytes: &[u8], at: &mut usize) -> Option<usize> {
    let mut n = 0usize;
    for shift in (0..35).step_by(7) { let b = *bytes.get(*at)?; *at += 1; n |= ((b & 127) as usize) << shift; if b & 128 == 0 { return Some(n); } }
    None
}
pub fn stamp(bytes: &[u8]) -> Option<DeviceEngine> {
    if bytes.get(..8)? != b"\0asm\x01\0\0\0" { return None; }
    let mut at = 8; let mut found = None;
    while at < bytes.len() {
        let kind = bytes[at]; at += 1;
        let size = leb(bytes, &mut at)?; let end = at.checked_add(size)?;
        let section = bytes.get(at..end)?;
        if kind == 0 {
            let mut pos = 0; let len = leb(section, &mut pos)?;
            let name = section.get(pos..pos.checked_add(len)?)?; pos += len;
            if name == b"snapback4.engine" {
                if found.is_some() { return None; }
                let engine: DeviceEngine = serde_json::from_slice(&section[pos..]).ok()?;
                // The crate emits canonical JSON. Reject alternate lexical forms
                // (duplicates, floats, unknown fields, lossy UTF-8) on every preflight.
                if serde_json::to_vec(&engine).ok()? != section[pos..] { return None; }
                found = Some(engine);
            }
        }
        at = end;
    }
    found
}
fn apps(root: &Path) -> Vec<PathBuf> {
    let mut roots = vec![root.to_owned()];
    if let Ok(entries) = fs::read_dir(root) {
        roots.extend(entries.flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir()) && e.file_name() != "node_modules" && !e.file_name().to_string_lossy().starts_with('.')).map(|e| e.path()));
    }
    roots
}
pub fn inspect(root: &Path, schema: &Schema) -> Vec<Result<String, String>> {
    let required = device_protocol::compatibility(&schema.public_projection());
    apps(root).into_iter().filter_map(|app| {
        let config: serde_json::Value = serde_json::from_slice(&fs::read(app.join("app.json")).ok()?).ok()?;
        let mount = config.pointer("/typescript/sources/backend").and_then(serde_json::Value::as_str)?;
        let resolve = |path: PathBuf| path.canonicalize().ok().or_else(|| Some(path.parent()?.canonicalize().ok()?.join(path.file_name()?)));
        let mounted = resolve(app.join(mount))?;
        if mounted != resolve(root.join("snapback/generated"))? { return None; }
        let wasm = app.join("assets/snapback4.wasm");
        let device = fs::read(&wasm).ok().and_then(|bytes| stamp(&bytes));
        Some(device_protocol::check(device.as_ref(), &required)
            .map(|_| format!("device    {} engine {} compatible (server {}, floor {})", wasm.display(), device.as_ref().unwrap().version, required.server_version, required.minimum_version))
            .map_err(|why| format!("{}: {} [{}]", why.code, why.message, wasm.display())))
    }).collect()
}
pub fn check(root: &Path, schema: &Schema, json: bool) -> bool {
    for result in inspect(root, schema) {
        if let Err(error) = result {
            if json { println!("{}", serde_json::json!({ "ok": false, "denied": { "code": "E_DEVICE_VERSION", "message": error } })); }
            else { eprintln!("{error}"); }
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn unstamped_corrupt_and_duplicate_stamps_are_unknown() {
        assert!(stamp(b"not wasm").is_none()); assert!(stamp(b"\0asm\x01\0\0\0").is_none());
        assert!(stamp(b"\0asm\x01\0\0\0\0\x80").is_none());
        let wrap = |text: &[u8]| {
            let mut bytes = b"\0asm\x01\0\0\0\0".to_vec();
            let name = b"snapback4.engine"; let size = text.len() + name.len() + 1;
            assert!(size < 128); bytes.push(size as u8); bytes.push(name.len() as u8);
            bytes.extend(name); bytes.extend(text); bytes
        };
        let good = br#"{"format":1,"version":"0.4.25","capabilities":[]}"#;
        assert!(stamp(&wrap(good)).is_some());
        for bad in [br#"{"format":0,"format":1,"version":"0.4.25","capabilities":[]}"#.as_slice(),
            br#"{"format":1.0,"version":"0.4.25","capabilities":[]}"#.as_slice(),
            br#"{"format":1,"version":"0.4.25","capabilities":[],"extra":1}"#.as_slice()] {
            assert!(stamp(&wrap(bad)).is_none());
        }
        let mut bom = vec![0xef, 0xbb, 0xbf]; bom.extend_from_slice(good);
        assert!(stamp(&wrap(&bom)).is_none());
        let mut invalid = good.to_vec(); invalid[23] = 0xff;
        assert!(stamp(&wrap(&invalid)).is_none());
        let once = wrap(good); let mut twice = once.clone(); twice.extend_from_slice(&once[8..]);
        assert!(stamp(&twice).is_none());
    }
}
