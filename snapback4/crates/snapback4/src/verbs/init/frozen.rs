//! A day-one headless client must keep its own handles and module boundary.
// @ref LLP 3000.037.000#9 — capture before editing; never overwrite historical evidence.
use std::{path::Path, io};
use serde_json::json;

pub(super) fn files(dir: &Path, sources: &[(String, String)]) -> io::Result<Vec<(&'static str, String)>> {
    if dir.join("v1").symlink_metadata().is_ok() { return Ok(Vec::new()); }
    let bound = snapback4_lang::compile(sources);
    if !bound.diagnostics.is_empty() { return Err(io::Error::other("cannot freeze an unchecked v1 client; fix current schema first")); }
    let mut files = Vec::new();
    fn push(files: &mut Vec<(&'static str,String)>, path: String, text: String) {
        if let Some((_,body))=files.iter_mut().find(|(name,_)|*name==path) { *body=text; }
        else { files.push((Box::leak(path.into_boxed_str()),text)); }
    }
    fn walk(root: &Path, relative: &Path, files: &mut Vec<(&'static str,String)>) -> io::Result<()> {
        let path = root.join(relative);
        if !path.exists() { return Ok(()); }
        if path.symlink_metadata()?.file_type().is_symlink() { return Err(io::Error::other(format!("frozen client refuses symlink {}", path.display()))); }
        if path.is_dir() {
            if matches!(path.file_name().and_then(|n|n.to_str()),Some("node_modules"|"dist"|"target"|".git")) { return Ok(()); }
            for entry in std::fs::read_dir(path)? { walk(root, &relative.join(entry?.file_name()),files)?; }
        } else if matches!(path.extension().and_then(|s|s.to_str()), Some("mjs"|"cjs"|"js"|"ts"|"tsx"|"jsx")) || path.file_name().is_some_and(|n|n=="package.json") {
            push(files,format!("v1/{}",relative.display()),std::fs::read_to_string(path)?);
        }
        Ok(())
    }
    // Save application modules, not node_modules, stores, credentials or build output.
    for path in ["scripts", "src", "app"] { walk(dir,Path::new(path),&mut files)?; }
    for entry in std::fs::read_dir(dir).into_iter().flatten() {
        let entry=entry?;
        if entry.path().is_file() && entry.path().extension().is_some_and(|e|matches!(e.to_str(),Some("mjs"|"js"|"ts"|"tsx"))) { walk(dir,Path::new(&entry.file_name()),&mut files)?; }
    }
    // Follow literal relative module imports beyond conventional source directories.
    // Runtime-computed paths remain application responsibilities, as in Node itself.
    let canonical_root=dir.canonicalize().unwrap_or_else(|_| std::env::current_dir().unwrap_or_default().join(dir));
    let mut index=0;
    while index<files.len() {
        let (saved,text)=&files[index];
        let source=dir.join(saved.strip_prefix("v1/").unwrap());
        let mut imports=Vec::new();
        let bytes=text.as_bytes();let mut cursor=0;
        while cursor<bytes.len() {
            let quote=bytes[cursor];
            if !matches!(quote,b'\''|b'"') {cursor+=1;continue;}
            let start=cursor+1;let mut end=start;
            while end<bytes.len() && bytes[end]!=quote {if bytes[end]==b'\\' {end+=1;}end+=1;}
            if end>=bytes.len() {break;}
            let before=text[..cursor].trim_end();
            let module=before.ends_with("from")||before.ends_with("import")||before.ends_with("import(")||before.ends_with("require(");
            if module {if let Some(value)=text.get(start..end) {if value.starts_with("./")||value.starts_with("../") {imports.push(value.to_owned());}}}
            cursor=end+1;
        }
        for import in imports {
            let path=source.parent().unwrap().join(import);
            if !path.exists() {continue;}
            let canonical=path.canonicalize()?;
            let relative=canonical.strip_prefix(&canonical_root).map_err(|_|io::Error::other("frozen relative import escapes the app; keep client modules inside the project"))?;
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
    let package: serde_json::Value = std::fs::read(dir.join("package.json")).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or_default();
    let command=package["scripts"]["client:calls"].as_str();
    let mut frozen=json!({"private":true,"type":"module","scripts":{"client:calls":"node .snapback4-frozen-run.mjs"}});
    if package["scripts"].is_object() { frozen["scripts"]=package["scripts"].clone(); }
    frozen["scripts"]["client:calls"]=json!("node .snapback4-frozen-run.mjs");
    if let Some(command)=command { frozen["scripts"]["client:calls:frozen"]=json!(command); }
    for group in ["dependencies","devDependencies"] { if package[group].is_object() { frozen[group]=package[group].clone(); } }
    push(&mut files,"v1/package.json".into(),super::pretty(&frozen));
    push(&mut files,"v1/.snapback4-frozen-run.mjs".into(),include_str!("frozen-run.mjs").into());
    Ok(files)
}
