//! Opt-in generated types for a frontend spanning an explicit saved release.
// @ref LLP 3000.000.000.000#3-generated-compatibility — configuration survives check/dev regeneration.
use crate::project::Project;
use snapback4_lang::Bound;
use std::io;

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Configuration { baseline: String, since_release: u64 }

pub(crate) fn typescript(project: &Project, bound: &Bound) -> io::Result<String> {
    let path = project.root.join("snapback/client-compatibility.json");
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(snapback4_lang::emit::typescript(bound)),
        Err(error) => return Err(error),
    };
    let bad = |message: String| io::Error::new(io::ErrorKind::InvalidInput, format!("client-compatibility.json: {message}; guide deploy"));
    let config: Configuration = serde_json::from_str(&text).map_err(|e| bad(e.to_string()))?;
    if config.since_release == 0 { return Err(bad("since_release must be a positive release label".into())); }
    let path = project.root.join(&config.baseline);
    let mut paths = if path.is_dir() {
        std::fs::read_dir(&path)?.map(|entry| entry.map(|entry| entry.path())).collect::<io::Result<Vec<_>>>()?
            .into_iter().filter(|path| path.is_file() && path.extension().is_some_and(|extension| extension == "q")).collect::<Vec<_>>()
    } else { vec![path.clone()] };
    paths.sort_by_key(|path| (path.file_name().is_none_or(|name| name != "schema.q"), path.clone()));
    if paths.is_empty() { return Err(bad("baseline directory has no Quarry .q sources".into())); }
    let sources = paths.into_iter().map(|path| {
        let name = path.file_name().and_then(|name| name.to_str()).filter(|name| name.ends_with(".q"))
            .ok_or_else(|| bad("baseline sources need their original UTF-8 .q file names".into()))?;
        let text = std::fs::read_to_string(&path).map_err(|e| bad(format!("baseline {}: {e}", path.display())))?;
        Ok((name.to_owned(), text))
    }).collect::<io::Result<Vec<_>>>()?;
    let baseline = snapback4_lang::compile(&sources);
    if !baseline.diagnostics.is_empty() { return Err(bad(format!("saved baseline does not compile: {:?}", baseline.diagnostics))); }
    Ok(snapback4_lang::emit::typescript_spanning(bound, &baseline, config.since_release))
}
