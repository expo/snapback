//! Version-locked grammar, app facts, symbol help, refusal pairs, and recipes.
// @ref LLP 1002#8-why-trace-guide — guide bytes ship with the npm package, not the binary.

use crate::owner;
use crate::project::{CompilerWorker, locate_root};
use crate::protocol::Refusal;
use crate::verbs;
use serde_json::{Map, Value as Json, json};
use snapback2_core::{Ceilings, Generation, ProjectJson};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const RECIPES: &[&str] = &[
    "auth",
    "live-query",
    "effects",
    "offline",
    "personas",
    "operator",
    "job",
    "schedule",
    "quarry",
    "testing",
    "offline",
];

pub fn run(args: &[String]) -> ExitCode {
    let options = match verbs::parse_options(args, &["--project"], &["--json"]) {
        Ok(options) => options,
        Err(code) => return code,
    };
    let json_output = options.has("--json");
    let positional = options.positionals();
    if positional.len() > 2 {
        return usage();
    }
    let page = positional.get(1).copied().unwrap_or("grammar");
    let root = match guide_root() {
        Ok(root) => root,
        Err(error) => return owner::print_refusal(error, json_output, 2),
    };
    let content = if page == "grammar" {
        read_page(&root.join("grammar.md"))
    } else if page == "app" {
        app_page(&options)
    } else if RECIPES.contains(&page) {
        read_page(&root.join(format!("{page}.md")))
    } else if page.starts_with("E_") {
        refusal_page(&root, page)
    } else {
        symbol_page(&root, page)
    };
    match content {
        Ok(content) => {
            if json_output {
                println!("{}", json!({ "page": page, "content": content }));
            } else {
                print!("{content}");
                if !content.ends_with('\n') {
                    println!();
                }
            }
            ExitCode::SUCCESS
        }
        Err(mut error) => {
            if error.code == "E_GUIDE_UNKNOWN" {
                error.message = format!("{}; available: {}", error.message, available(&root));
            }
            owner::print_refusal(error, json_output, 1)
        }
    }
}

fn guide_root() -> Result<PathBuf, Refusal> {
    let candidates = [
        std::env::var_os("SNAPBACK2_GUIDE").map(PathBuf::from),
        std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(|parent| parent.join("guide"))),
        Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/snapback2/dist/guide")),
        Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/snapback2/guide")),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|path| path.join("grammar.md").is_file())
        .ok_or_else(|| {
            Refusal::owner(
                "E_OWNER_GUIDE",
                "the installed Snapback 2 guide was not found",
                "reinstall snapback2 or set SNAPBACK2_GUIDE to the shipped guide directory",
            )
        })
}

fn read_page(path: &Path) -> Result<String, Refusal> {
    fs::read_to_string(path).map_err(|error| {
        Refusal::owner(
            "E_OWNER_GUIDE",
            format!("cannot read {}: {error}", path.display()),
            "reinstall the snapback2 package",
        )
    })
}

fn app_page(options: &verbs::ParsedOptions<'_>) -> Result<String, Refusal> {
    let root = locate_root(options.value("--project").map(Path::new))?;
    let project: ProjectJson = serde_json::from_slice(
        &fs::read(root.join(".snapback/build/project.json")).map_err(|_| {
            Refusal::owner(
                "E_OWNER_BUILD_CACHE",
                "the app guide needs .snapback/build/project.json",
                "run snapback2 check, then snapback2 guide app",
            )
        })?,
    )
    .map_err(|error| {
        Refusal::owner(
            "E_OWNER_BUILD_CACHE",
            format!("cannot read the cached generation: {error}"),
            "rerun snapback2 check",
        )
    })?;
    let certificate_path = root.join(".snapback/build/certificates.json");
    let certificate_bytes = fs::read(&certificate_path).map_err(|error| {
        guide_stale(format!(
            "cannot read {}: {error}",
            certificate_path.display()
        ))
    })?;
    let certificates: Json = serde_json::from_slice(&certificate_bytes).map_err(|error| {
        guide_stale(format!(
            "cannot parse {}: {error}",
            certificate_path.display()
        ))
    })?;
    let missing_certificates = project
        .programs
        .iter()
        .filter(|program| certificates.get(&program.name).is_none())
        .map(|program| program.name.clone())
        .collect::<Vec<_>>();
    if !missing_certificates.is_empty() {
        return Err(guide_stale(format!(
            "certificates.json is missing operation(s): {}",
            missing_certificates.join(", ")
        )));
    }
    let generation = Generation::certify(&project, Ceilings::default())
        .map_err(|errors| {
            Refusal::owner(
                "E_OWNER_BUILD_CACHE",
                format!(
                    "cached generation no longer certifies: {} refusal(s)",
                    errors.len()
                ),
                "rerun snapback2 check",
            )
        })?
        .hash();
    let mut worker = CompilerWorker::spawn().map_err(|error| {
        guide_stale(format!(
            "cannot start compiler for seed facts: {}",
            error.message
        ))
    })?;
    let personas = worker
        .seed(&root)
        .map_err(|errors| {
            guide_stale(format!(
                "seed facts were refused: {}",
                errors
                    .iter()
                    .map(|error| format!("{}: {}", error.code, error.message))
                    .collect::<Vec<_>>()
                    .join("; ")
            ))
        })?
        .personas;
    let tables = project
        .schema
        .tables
        .iter()
        .map(|(name, table)| {
            (
                name.clone(),
                json!({
                    "columns": table.columns,
                    "indexes": table.indexes,
                    "rules": table.rules,
                    "constraints": table.constraints,
                }),
            )
        })
        .collect::<Map<_, _>>();
    let operations = project
        .programs
        .iter()
        .map(|program| {
            let certificate = certificates
                .get(&program.name)
                .expect("missing certificates refused above");
            (
                program.name.clone(),
                json!({
                    "kind": program.kind,
                    "args": program.args,
                    "readSites": certificate.get("read_sites").or_else(|| certificate.get("readSites")),
                    "writeSites": certificate.get("write_sites").or_else(|| certificate.get("writeSites")),
                    "bounds": {
                        "maxExamined": certificate.get("max_examined").or_else(|| certificate.get("maxExamined")),
                        "maxSteps": certificate.get("max_steps").or_else(|| certificate.get("maxSteps")),
                    },
                }),
            )
        })
        .collect::<Map<_, _>>();
    serde_json::to_string_pretty(&json!({
        "generation": generation,
        "tables": tables,
        "operations": operations,
        "channels": project.schema.channels,
        "personas": personas,
    }))
    .map(|text| format!("{text}\n"))
    .map_err(|error| {
        Refusal::owner(
            "E_OWNER_GUIDE",
            format!("cannot render app guide: {error}"),
            "rerun snapback2 check",
        )
    })
}

fn guide_stale(message: impl Into<String>) -> Refusal {
    Refusal::owner("E_GUIDE_STALE", message, "run snapback2 check")
}

fn refusal_page(root: &Path, code: &str) -> Result<String, Refusal> {
    let families = families(root)?;
    let Some(entry) = families
        .as_array()
        .into_iter()
        .flatten()
        .find(|entry| entry.get("code").and_then(Json::as_str) == Some(code))
    else {
        return Err(unknown(code));
    };
    let family = entry
        .get("family")
        .and_then(Json::as_str)
        .unwrap_or("unknown");
    let language = if matches!(family, "quarry" | "job" | "schedule") {
        "q"
    } else {
        "ts"
    };
    let wrong = refusal_example(
        entry
            .get("wrong")
            .and_then(Json::as_str)
            .unwrap_or_default(),
        language,
    );
    let right = refusal_example(
        entry
            .get("right")
            .and_then(Json::as_str)
            .unwrap_or_default(),
        language,
    );
    Ok(format!(
        "# {code}\n\nFamily: `{family}`\n\nWrong:\n{wrong}\n\nRight:\n{right}\n"
    ))
}

fn refusal_example(value: &str, language: &str) -> String {
    let value = value.trim();
    if value.starts_with("```") {
        value.to_owned()
    } else {
        format!("```{language}\n{value}\n```")
    }
}

fn symbol_page(root: &Path, symbol: &str) -> Result<String, Refusal> {
    let declarations = declarations_path(root);
    let text = fs::read_to_string(&declarations).map_err(|error| {
        Refusal::owner(
            "E_OWNER_GUIDE",
            format!("cannot read {}: {error}", declarations.display()),
            "reinstall the snapback2 package",
        )
    })?;
    let lines: Vec<_> = text.lines().collect();
    for (index, line) in lines.iter().enumerate() {
        if declares(line, symbol) {
            let mut start = index;
            while start > 0
                && (lines[start - 1].trim_start().starts_with('*')
                    || lines[start - 1].trim_start().starts_with("/**")
                    || lines[start - 1].trim().is_empty())
            {
                start -= 1;
                if lines[start].trim_start().starts_with("/**") {
                    break;
                }
            }
            let mut end = index + 1;
            let mut depth = bracket_delta(line);
            while end < lines.len() && (depth > 0 || !lines[end - 1].trim_end().ends_with(';')) {
                depth += bracket_delta(lines[end]);
                end += 1;
            }
            let excerpt = lines[start..end].join("\n");
            return Ok(format!("# `{symbol}`\n\n```ts\n{excerpt}\n```\n"));
        }
    }
    Err(unknown(symbol))
}

fn declarations_path(root: &Path) -> PathBuf {
    let beside = root.parent().map(|parent| parent.join("index.d.ts"));
    if let Some(path) = beside.filter(|path| path.is_file()) {
        path
    } else {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/compiler/lib.d.ts")
    }
}

fn declares(line: &str, symbol: &str) -> bool {
    let line = line.trim();
    [
        format!("export function {symbol}"),
        format!("export const {symbol}"),
        format!("export type {symbol}"),
        format!("export interface {symbol}"),
        format!("export class {symbol}"),
    ]
    .iter()
    .any(|prefix| line.starts_with(prefix))
}

fn bracket_delta(line: &str) -> i32 {
    line.bytes().fold(0, |depth, byte| match byte {
        b'{' | b'(' | b'[' => depth + 1,
        b'}' | b')' | b']' => depth - 1,
        _ => depth,
    })
}

fn families(root: &Path) -> Result<Json, Refusal> {
    let generated = root.join("families.json");
    let source = root.join("families.source.json");
    let path = if generated.is_file() {
        generated
    } else {
        source
    };
    serde_json::from_slice(&fs::read(&path).map_err(|error| {
        Refusal::owner(
            "E_OWNER_GUIDE",
            format!("cannot read {}: {error}", path.display()),
            "reinstall the snapback2 package",
        )
    })?)
    .map_err(|error| {
        Refusal::owner(
            "E_OWNER_GUIDE",
            format!("invalid refusal family guide: {error}"),
            "reinstall the snapback2 package",
        )
    })
}

fn available(root: &Path) -> String {
    let mut pages = BTreeSet::from(["app".to_owned(), "grammar".to_owned()]);
    pages.extend(RECIPES.iter().map(|page| (*page).to_owned()));
    if let Ok(families) = families(root) {
        pages.extend(
            families
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|entry| entry.get("code").and_then(Json::as_str))
                .map(ToOwned::to_owned),
        );
    }
    if let Ok(declarations) = fs::read_to_string(declarations_path(root)) {
        for line in declarations.lines().map(str::trim) {
            for prefix in [
                "export function ",
                "export const ",
                "export type ",
                "export interface ",
                "export class ",
            ] {
                if let Some(rest) = line.strip_prefix(prefix) {
                    if let Some(name) = rest
                        .split(|character: char| {
                            !character.is_ascii_alphanumeric()
                                && character != '_'
                                && character != '$'
                        })
                        .next()
                        .filter(|name| !name.is_empty())
                    {
                        pages.insert(name.to_owned());
                    }
                }
            }
        }
    }
    pages.into_iter().collect::<Vec<_>>().join(", ")
}

fn unknown(page: &str) -> Refusal {
    Refusal::new(
        "E_GUIDE_UNKNOWN",
        "input",
        format!("unknown guide page {page}"),
        "run snapback2 guide grammar, quarry, app, a symbol, an E_CODE, or a listed recipe",
        "input/guide",
    )
}

fn usage() -> ExitCode {
    eprintln!(
        "usage: snapback2 guide [grammar|quarry|typescript|app|<symbol>|<E_CODE>|<recipe>] [--json]"
    );
    ExitCode::from(2)
}
