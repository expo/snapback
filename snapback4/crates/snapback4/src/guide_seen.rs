//! Disposable reading history contains hashes, never schema or account contents.
// @ref LLP 3000.037.000#8-wave-32-builder-reading-and-waiting-tok1 — repeated reads emit only new complete blocks.
use std::{collections::BTreeSet, path::Path};
use sha2::{Digest, Sha256};

pub fn render(name: &str, text: &str, force: bool) -> String {
    let Ok(cwd) = std::env::current_dir() else { return text.into(); };
    let Some(root) = cwd.ancestors().find(|p| p.join("snapback").is_dir() || std::fs::read(p.join("package.json")).ok().and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok()).is_some_and(|package| ["dependencies", "devDependencies"].iter().any(|key| package[*key]["snapback4"].is_string()))) else { return text.into(); };
    render_in(root, name, text, force)
}
pub(crate) fn render_in(root: &Path, name: &str, text: &str, force: bool) -> String {
    let path = root.join(".snapback4/guide-seen.json");
    let mut seen: BTreeSet<String> = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let blocks = snapback4_lang::guide::reading_blocks(text);
    let mut new = Vec::new(); let mut already = 0;
    for block in &blocks {
        let hash = format!("{:x}", Sha256::digest(block.as_bytes()));
        if seen.insert(hash) { new.push(block.as_str()); } else { already += 1; }
    }
    // A lost concurrent history update merely reprints text; it cannot hide new content.
    let write = || -> std::io::Result<()> {
        std::fs::create_dir_all(path.parent().unwrap())?;
        let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
        std::fs::write(&tmp, serde_json::to_vec(&seen)?)?;
        std::fs::rename(&tmp, &path)
    };
    if write().is_err() || force || already == 0 { return text.into(); }
    format!("already shown: {name}, {already} blocks; new: {} blocks (snapback4 guide {name} --repeat forces this read; --full the reference)\n\n{}", new.len(), new.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wave32_muse_019_028_repeated_sections_keep_changed_recipe_and_force() {
        let root = std::env::temp_dir().join(format!("tok1-history-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let first = "# Uploads\n\nOwn bytes.\n\n```js\nawait upload(bytes);\n\nawait place();\n```\n";
        assert_eq!(render_in(&root,"uploads",first,false), first);
        assert!(render_in(&root,"uploads",first,false).contains("new: 0 blocks"));
        let changed = first.replace("place()", "placeCopy()");
        let delta = render_in(&root,"uploads",&changed,false);
        assert!(delta.contains("```js\nawait upload(bytes);\n\nawait placeCopy();\n```"));
        assert_eq!(render_in(&root,"uploads",&changed,true), changed);
        std::fs::remove_dir_all(root).unwrap();
    }
}
