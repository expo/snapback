//! A day-one headless client must keep its own handles and module boundary.
// @ref LLP 3000.037.000#9 — capture before editing; never overwrite historical evidence.
use std::{path::Path, io};
use serde_json::json;

pub(super) fn files(dir: &Path, sources: &[(String, String)]) -> io::Result<Vec<(&'static str, String)>> {
    if dir.join("v1").symlink_metadata().is_ok() { return Ok(Vec::new()); }
    let bound = snapback4_lang::compile(sources);
    if !bound.diagnostics.is_empty() { return Err(io::Error::new(io::ErrorKind::InvalidData,"cannot freeze an unchecked v1 client; fix current schema first")); }
    let mut files = Vec::new();
    fn push(files: &mut Vec<(&'static str,String)>, path: String, text: String) {
        if let Some((_,body))=files.iter_mut().find(|(name,_)|*name==path) { *body=text; }
        else { files.push((Box::leak(path.into_boxed_str()),text)); }
    }
    fn walk(root: &Path, relative: &Path, files: &mut Vec<(&'static str,String)>) -> io::Result<()> {
        let path = root.join(relative);
        if !path.exists() { return Ok(()); }
        if path.symlink_metadata()?.file_type().is_symlink() { return Err(io::Error::other(format!("frozen client refuses symlink {}", path.display()))); }
        let root_path=root.canonicalize()?;
        let canonical=path.canonicalize()?;
        let relative=canonical.strip_prefix(&root_path).map_err(|_|io::Error::other("frozen script entry escapes the app; keep client modules inside the project"))?;
        if path.is_dir() {
            if matches!(path.file_name().and_then(|n|n.to_str()),Some("node_modules"|"dist"|"target"|".git")) { return Ok(()); }
            for entry in std::fs::read_dir(path)? { walk(root, &relative.join(entry?.file_name()),files)?; }
        } else if matches!(path.extension().and_then(|s|s.to_str()), Some("mjs"|"cjs"|"js"|"ts"|"mts"|"cts"|"tsx"|"jsx")) || path.file_name().is_some_and(|n|n=="package.json") {
            push(files,format!("v1/{}",relative.display()),std::fs::read_to_string(path)?);
        }
        Ok(())
    }
    // Freeze executable application script entries and their imports. UI build
    // assets, node_modules, stores and credentials are outside this capture.
    let package: serde_json::Value = std::fs::read(dir.join("package.json")).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or_else(||json!({}));
    // Script entries can live outside scripts/src/app (for example tools/calls.mjs).
    if let Some(scripts)=package["scripts"].as_object() {
        for command in scripts.values().filter_map(|v|v.as_str()) {
            for word in command_words(command)? {
                let path=Path::new(&word);
                if path.is_absolute() {continue;}
                if matches!(path.extension().and_then(|s|s.to_str()),Some("mjs"|"cjs"|"js"|"ts"|"mts"|"cts"|"tsx"|"jsx")) && dir.join(path).is_file() {
                    walk(dir,path,&mut files)?;
                }
            }
        }
    }
    // Follow literal relative module imports beyond conventional source directories.
    // Runtime-computed paths remain application responsibilities, as in Node itself.
    let canonical_root=dir.canonicalize().unwrap_or_else(|_| std::env::current_dir().unwrap_or_default().join(dir));
    let mut index=0;
    while index<files.len() {
        let (saved,text)=&files[index];
        let source=dir.join(saved.strip_prefix("v1/").unwrap());
        let imports=if source.extension().and_then(|e|e.to_str()).is_some_and(|e|matches!(e,"mjs"|"cjs"|"js"|"ts"|"mts"|"cts"|"tsx"|"jsx")) {
            crate::worker_graph::imports(text,&source).map_err(std::io::Error::other)?
        } else {Vec::new()};
        // Node owns import/require resolution, including CJS package main/index
        // and package scope metadata. Resolution reads files; it executes no imports.
        let output=std::process::Command::new(crate::project::node())
            .args(["--experimental-import-meta-resolve","--input-type=module","-e",include_str!("../../worker_graph.mjs")])
            .arg(&canonical_root).arg(source.canonicalize()?)
            .args(imports.iter().map(|item|serde_json::to_string(item).unwrap()))
            .env_remove("NODE_OPTIONS").env_remove("NODE_PATH").output()?;
        if !output.status.success() {return Err(io::Error::other(format!("frozen client dependency resolution: {}",String::from_utf8_lossy(&output.stderr))));}
        let graph:serde_json::Value=serde_json::from_slice(&output.stdout).map_err(io::Error::other)?;
        for path in graph["files"].as_array().ok_or_else(||io::Error::other("frozen module resolver returned no files"))?.iter().filter_map(|p|p.as_str()) {
            let path=Path::new(path);let canonical=path.canonicalize()?;
            let relative=canonical.strip_prefix(&canonical_root).map_err(|_|io::Error::other("frozen relative import escapes the app"))?;
            let saved=format!("v1/{}",relative.display());
            if files.iter().any(|(name,_)|*name==saved) {continue;}
            if path.symlink_metadata()?.file_type().is_symlink() {return Err(io::Error::other("frozen module imports must not use symlinks"));}
            if path.is_file() {push(&mut files,saved,std::fs::read_to_string(path)?);}
        }
        index+=1;
    }
    for (name,text) in sources { push(&mut files,format!("v1/snapback/{name}"),text.clone()); }
    push(&mut files,"v1/snapback/generated/api.ts".into(),snapback4_lang::emit::typescript(&bound));
    push(&mut files,"v1/snapback/generated/package.json".into(),"{\"type\":\"module\"}\n".into());
    let command=package["scripts"]["client:calls"].as_str();
    // The outer packet is ESM. Preserve a non-ESM application's original root
    // package scope too, so ordinary .js require helpers keep their Node meaning.
    let original_scope=command.is_some() && package["type"] != "module";
    if original_scope {
        for (name,_) in &mut files {
            *name=Box::leak(format!("v1/.source/{}",name.strip_prefix("v1/").unwrap()).into_boxed_str());
        }
        push(&mut files,"v1/.source/package.json".into(),super::pretty(&package));
        push(&mut files,"v1/snapback/generated/api.ts".into(),snapback4_lang::emit::typescript(&bound));
        push(&mut files,"v1/snapback/generated/package.json".into(),"{\"type\":\"module\"}\n".into());
    }
    let mut frozen=package.clone();
    frozen["private"]=json!(true);frozen["type"]=json!("module");
    if !frozen["scripts"].is_object() {frozen["scripts"]=json!({});}
    if original_scope { frozen["scripts"]=json!({}); }
    else if package["scripts"].is_object() { frozen["scripts"]=package["scripts"].clone(); }
    frozen["scripts"]["client:calls"]=json!("node .snapback4-frozen-run.mjs");
    if let Some(command)=command { frozen["scripts"]["client:calls:frozen"]=json!(if original_scope { "npm --prefix .source run --silent client:calls" } else { command }); }
    for group in ["dependencies","devDependencies"] { if package[group].is_object() { frozen[group]=package[group].clone(); } }
    push(&mut files,"v1/package.json".into(),super::pretty(&frozen));
    push(&mut files,"v1/.snapback4-frozen-run.mjs".into(),include_str!("frozen-run.mjs").into());
    Ok(files)
}

/// Shell words are inspected, never executed; quoted paths keep their spaces.
fn command_words(command: &str) -> io::Result<Vec<String>> {
    let mut words=Vec::new();let mut word=String::new();let mut quote=None;let mut chars=command.chars();
    while let Some(ch)=chars.next() {
        match (quote,ch) {
            (Some('\''),'\'')|(Some('"'),'"')=>quote=None,
            (None,'\''| '"')=>quote=Some(ch),
            (Some('\''),_)=>word.push(ch),
            (_, '\\')=>{if let Some(next)=chars.next(){word.push(next);}},
            (None,c) if c.is_whitespace() || matches!(c,';'|'&'|'|')=>{if !word.is_empty(){words.push(std::mem::take(&mut word));}},
            _=>word.push(ch),
        }
    }
    if quote.is_some() {return Err(io::Error::other("cannot freeze malformed quoted package script"));}
    if !word.is_empty(){words.push(word);}Ok(words)
}
