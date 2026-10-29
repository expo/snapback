//! Disposable reading history contains hashes, never schema or account contents.
// @ref LLP 3000.037.000#8-wave-32-builder-reading-and-waiting-tok1 — repeated reads emit only new complete blocks.
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, path::Path};

pub fn render(name: &str, text: &str, force: bool) -> String {
    let Ok(cwd) = std::env::current_dir() else {
        return text.into();
    };
    let Some(root) = cwd.ancestors().find(|p| {
        p.join("snapback").is_dir()
            || std::fs::read(p.join("package.json"))
                .ok()
                .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
                .is_some_and(|package| {
                    ["dependencies", "devDependencies"]
                        .iter()
                        .any(|key| package[*key]["snapback4"].is_string())
                })
    }) else {
        return text.into();
    };
    render_in(root, name, text, force)
}
pub(crate) fn render_in(root: &Path, name: &str, text: &str, force: bool) -> String {
    let path = root.join(".snapback4/guide-seen.json");
    let mut seen: BTreeSet<String> = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let shared = name.starts_with("api ") && text.starts_with("# This app's client usage\n");
    let mut new = Vec::new();
    let mut already = 0;
    let entries = keyed_blocks(name, text, shared);
    let mut carried = None;
    for (hash, block, operation) in &entries {
        let known = if shared {
            seen.contains(hash)
        } else {
            !seen.insert(hash.clone())
        };
        if known {
            already += 1;
            continue;
        }
        // A new call or changed fact keeps its operation heading even when
        // that heading was seen in another wiring card.
        if shared && let Some(heading) = operation {
            if carried != Some(heading) {
                if block != heading {
                    new.push(heading.as_str());
                }
                carried = Some(heading);
            }
        }
        new.push(block.as_str());
    }
    let mut shown = if force || already == 0 {
        text.to_owned()
    } else {
        let delta = format!(
            "already shown: {name}, {already} blocks; new: {} blocks (snapback4 guide {name} --repeat forces this read; --full the reference)\n\n{}",
            new.len(),
            new.join("\n")
        );
        if shared {
            snapback4_lang::guide::bounded_default(name, &delta)
        } else {
            delta
        }
    };
    if shared {
        // Record only blocks actually emitted after the delta's byte budget.
        // A clipped tail remains unseen and is available on the next lookup.
        let mut visible: BTreeSet<_> = keyed_blocks(name, &shown, true)
            .into_iter()
            .map(|(hash, _, _)| hash)
            .collect();
        let has_new_fact = entries
            .iter()
            .any(|(hash, block, _)| !seen.contains(hash) && !block.starts_with('#'));
        let shows_new_fact = entries.iter().any(|(hash, block, _)| {
            !seen.contains(hash) && !block.starts_with('#') && visible.contains(hash)
        });
        if has_new_fact && !shows_new_fact && text.len() <= snapback4_lang::guide::FULL_BYTES {
            // A single large new block can fit the selection but not its delta
            // prefix. Reprint that bounded selection instead of starving it.
            shown = text.to_owned();
            visible = keyed_blocks(name, &shown, true)
                .into_iter()
                .map(|(hash, _, _)| hash)
                .collect();
        }
        seen.extend(
            entries
                .iter()
                .filter(|(hash, _, _)| visible.contains(hash))
                .map(|(hash, _, _)| hash.clone()),
        );
    }
    // A lost concurrent history update merely reprints text; it cannot hide new content.
    let write = || -> std::io::Result<()> {
        std::fs::create_dir_all(path.parent().unwrap())?;
        let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
        std::fs::write(&tmp, serde_json::to_vec(&seen)?)?;
        std::fs::rename(&tmp, &path)
    };
    if write().is_err() { text.into() } else { shown }
}

// @ref LLP 3000.037.000#18-bounded-package-reference-and-wiring-lookups-tok6 — share facts across app wiring cards, retaining operation identity and hash-only history.
fn keyed_blocks(name: &str, text: &str, shared: bool) -> Vec<(String, String, Option<String>)> {
    let namespace = if shared {
        "api checked app usage"
    } else {
        name
    };
    let mut operation = None;
    snapback4_lang::guide::reading_blocks(text)
        .into_iter()
        .map(|block| {
            if shared && block.starts_with("## ") {
                operation = ["## query ", "## mutation ", "## action "]
                    .iter()
                    .any(|prefix| block.starts_with(prefix))
                    .then(|| block.clone());
            }
            let hash = if shared {
                format!(
                    "{:x}",
                    Sha256::digest(
                        format!(
                            "{namespace}\0{}\0{block}",
                            operation.as_deref().unwrap_or("")
                        )
                        .as_bytes()
                    )
                )
            } else {
                format!(
                    "{:x}",
                    Sha256::digest(format!("{namespace}\0{block}").as_bytes())
                )
            };
            (hash, block, operation.clone())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wave32_muse_019_028_repeated_sections_keep_changed_recipe_and_force() {
        let root = std::env::temp_dir().join(format!("tok1-history-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let first =
            "# Uploads\n\nOwn bytes.\n\n```js\nawait upload(bytes);\n\nawait place();\n```\n";
        assert_eq!(render_in(&root, "uploads", first, false), first);
        assert!(render_in(&root, "uploads", first, false).contains("new: 0 blocks"));
        assert_eq!(
            render_in(&root, "another-card", first, false),
            first,
            "a first card read keeps shared context"
        );
        let changed = first.replace("place()", "placeCopy()");
        let delta = render_in(&root, "uploads", &changed, false);
        assert!(delta.contains("```js\nawait upload(bytes);\n\nawait placeCopy();\n```"));
        assert_eq!(render_in(&root, "uploads", &changed, true), changed);
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod app_tests {
    use super::*;
    #[test]
    fn app_facts_keep_operation_identity_and_never_mark_a_clipped_tail_seen() {
        let root = std::env::temp_dir().join(format!("tok6-history-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let first = "# This app's client usage\n\n## query a\n\nArgs: {}.\n\nPlain: client.query(api.a, {}).\n\n## query b\n\nArgs: {}.\n\nPlain: client.query(api.b, {}).\n";
        assert_eq!(
            render_in(&root, "api client", first, false),
            first,
            "the first lookup is complete, including identical shapes of different operations"
        );
        let react = first
            .replace(
                "Plain: client.query(api.a, {}).",
                "React: useQuery(api.a, {}).",
            )
            .replace(
                "Plain: client.query(api.b, {}).",
                "React: useQuery(api.b, {}).",
            );
        let delta = render_in(&root, "api react", &react, false);
        assert!(!delta.contains("Args: {}."));
        assert!(
            delta.contains("## query a\n\nReact:") && delta.contains("## query b\n\nReact:"),
            "{delta}"
        );
        let long = format!(
            "# This app's client usage\n\n## query a\n\n{}\n\n{}\n\nTail: not yet emitted.\n",
            "changed ".repeat(500),
            "late ".repeat(770)
        );
        let clipped = render_in(&root, "api client", &long, false);
        assert!(clipped.len() < snapback4_lang::guide::FULL_BYTES);
        assert!(!clipped.contains("Tail: not yet emitted."));
        {
            assert!(
                render_in(&root, "api client", &long, false).contains("Tail: not yet emitted.")
            );
        }
        let single = format!(
            "# This app's client usage\n\n## query a\n\n{}\n",
            "oversized ".repeat(790)
        );
        assert_eq!(
            render_in(&root, "api client", &single, false),
            single,
            "a fitting fact is never starved by the delta prefix"
        );
        assert_eq!(render_in(&root, "api react", &react, true), react);
        std::fs::remove_dir_all(root).unwrap();
    }
}
