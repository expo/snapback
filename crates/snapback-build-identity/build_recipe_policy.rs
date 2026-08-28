//! Ship-profile build-recipe attestation policy.
//!
//! @ref LLP 0314.000#phase-1--ship-the-ship-profile-and-strip-it — 1c: the
//! recipe fact's authority is the build, not the ceremony. Cargo hands a build
//! script `PROFILE` but not the resolved `lto`/`codegen-units`/`incremental`/
//! `strip` tuple, so the stamp pairs the resolved profile with the recipe as
//! *declared* in the root manifest, and this policy refuses to stamp at all
//! when an ambient channel could have falsified that declaration.
//!
//! The module is compiled twice on purpose: `build.rs` includes it to make the
//! decision, and the leaf library includes it under `cfg(test)` so each
//! forbidden-channel class has a unit test that does not cost a fat-LTO build.
//! It deliberately lives outside `src/` so it stays out of the runtime
//! diagnostics registry's emitting-site inventory; a refusal here fails a
//! build, it is not a served diagnostic.

use std::path::Path;

/// The one profile whose bytes are manufactured for publication.
pub const PRODUCTION_PROFILE: &str = "production";

/// Stable marker for every refusal this policy raises.
pub const UNATTESTABLE_CODE: &str = "SNAPBACK_BUILD_RECIPE_UNATTESTABLE";

/// The optimization level the ship profile must resolve to. Cargo does not
/// take this one from the manifest — `[profile.release]` leaves it at Cargo's
/// release default — so the stamp asserts it against the `OPT_LEVEL` Cargo
/// actually resolved. Changing the profile's optimization level therefore has
/// to change this line too, in review, rather than sliding through unseen.
pub const SHIP_OPT_LEVEL: &str = "3";

/// Codegen knobs whose value the stamp asserts and which therefore may not be
/// reachable through any channel the build script cannot read back.
const GOVERNED_CODEGEN_FLAGS: [&str; 5] = [
    "lto",
    "strip",
    "codegen-units",
    "opt-level",
    "incremental",
];

/// The recipe as declared in the root manifest, plus the resolved facts Cargo
/// does report to a build script.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BuildRecipe {
    /// Resolved Cargo profile directory name (`debug`, `release`, `production`).
    pub profile: String,
    /// Cargo's coarse build-script `PROFILE` class (`debug` or `release`).
    /// A custom profile reports its inherited class here, not its own name,
    /// which is why `profile` above is derived from `OUT_DIR` instead.
    pub cargo_profile_class: String,
    /// Resolved `OPT_LEVEL`: observed from Cargo, not read from the manifest.
    pub opt_level: String,
    /// Declared `[profile.production]` values; `None` off the ship profile.
    pub lto: Option<String>,
    pub codegen_units: Option<u32>,
    pub incremental: Option<bool>,
    pub strip: Option<String>,
}

impl BuildRecipe {
    /// Canonical JSON for the native stamp. Written by hand so the identity
    /// leaf keeps no serialization dependency.
    pub fn to_json(&self) -> String {
        fn text(value: &Option<String>) -> String {
            match value {
                Some(value) => format!("\"{value}\""),
                None => "null".to_owned(),
            }
        }
        format!(
            concat!(
                "{{\"profile\":\"{}\",\"cargoProfileClass\":\"{}\",",
                "\"optLevel\":\"{}\",\"lto\":{},\"codegenUnits\":{},",
                "\"incremental\":{},\"strip\":{}}}"
            ),
            self.profile,
            self.cargo_profile_class,
            self.opt_level,
            text(&self.lto),
            self.codegen_units
                .map_or_else(|| "null".to_owned(), |units| units.to_string()),
            self.incremental
                .map_or_else(|| "null".to_owned(), |value| value.to_string()),
            text(&self.strip),
        )
    }
}

/// The declared `[profile.production]` recipe, resolved through `inherits`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeclaredRecipe {
    pub lto: String,
    pub codegen_units: u32,
    pub incremental: bool,
    pub strip: String,
}

fn refusal(detail: impl AsRef<str>) -> String {
    format!("{UNATTESTABLE_CODE}: {}", detail.as_ref())
}

/// Cargo lays a build script's `OUT_DIR` down as
/// `<target>/[<triple>/]<profile>/build/<pkg>-<hash>/out`, so the profile
/// *name* is recoverable there even though `PROFILE` collapses every custom
/// profile onto `debug`/`release`.
pub fn profile_directory_name(out_dir: &str) -> Option<String> {
    let package_build_dir = Path::new(out_dir).parent()?;
    let build_dir = package_build_dir.parent()?;
    if build_dir.file_name()?.to_str()? != "build" {
        return None;
    }
    Some(build_dir.parent()?.file_name()?.to_str()?.to_owned())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TomlValue<'a> {
    Text(&'a str),
    Integer(u32),
    Boolean(bool),
}

/// A deliberately small, strict reader for the flat `[profile.*]` tables this
/// repository declares. Anything it does not understand is a refusal, never a
/// silent default: an unattested knob must not be reported as attested.
fn profile_table<'a>(
    manifest: &'a str,
    profile: &str,
) -> Result<Option<Vec<(&'a str, TomlValue<'a>)>>, String> {
    let header = format!("[profile.{profile}]");
    let nested_prefix = format!("[profile.{profile}.");
    let mut inside = false;
    let mut seen = false;
    let mut entries: Vec<(&str, TomlValue<'_>)> = Vec::new();
    for raw in manifest.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') {
            if line.starts_with(&nested_prefix) {
                return Err(refusal(format!(
                    "root Cargo.toml declares the nested table {line}; the ship \
                     profile must be one flat declaration so the stamp can \
                     name the whole recipe"
                )));
            }
            inside = line == header;
            seen |= inside;
            continue;
        }
        if !inside {
            continue;
        }
        let (key, value) = line.split_once('=').ok_or_else(|| {
            refusal(format!("root Cargo.toml [profile.{profile}] has an unreadable line: {line}"))
        })?;
        let key = key.trim();
        let value = value.trim();
        let parsed = if let Some(text) = value.strip_prefix('"').and_then(|rest| rest.strip_suffix('"')) {
            if text.contains('\\') || text.contains('"') {
                return Err(refusal(format!(
                    "root Cargo.toml [profile.{profile}] {key} uses an escaped string"
                )));
            }
            TomlValue::Text(text)
        } else if value == "true" {
            TomlValue::Boolean(true)
        } else if value == "false" {
            TomlValue::Boolean(false)
        } else if let Ok(number) = value.parse::<u32>() {
            TomlValue::Integer(number)
        } else {
            return Err(refusal(format!(
                "root Cargo.toml [profile.{profile}] {key} has a value this stamp \
                 cannot read: {value}"
            )));
        };
        entries.push((key, parsed));
    }
    Ok(seen.then_some(entries))
}

/// Resolve one declared key through the `inherits` chain, refusing when no
/// table declares it. Cargo's own defaults are intentionally not consulted:
/// deleting a declaration must break the attestation, not quietly re-shape it.
fn declared<'a>(
    tables: &[(String, Vec<(&'a str, TomlValue<'a>)>)],
    key: &str,
) -> Option<TomlValue<'a>> {
    tables
        .iter()
        .find_map(|(_, entries)| entries.iter().rev().find(|(name, _)| *name == key))
        .map(|(_, value)| *value)
}

/// Read the ship recipe out of the root manifest, following `inherits`.
pub fn parse_declared_recipe(manifest: &str) -> Result<DeclaredRecipe, String> {
    let mut tables: Vec<(String, Vec<(&str, TomlValue<'_>)>)> = Vec::new();
    let mut profile = PRODUCTION_PROFILE.to_owned();
    loop {
        let entries = profile_table(manifest, &profile)?.ok_or_else(|| {
            refusal(format!("root Cargo.toml declares no [profile.{profile}] table"))
        })?;
        let inherits = entries
            .iter()
            .rev()
            .find(|(key, _)| *key == "inherits")
            .map(|(_, value)| *value);
        tables.push((profile.clone(), entries));
        match inherits {
            Some(TomlValue::Text(parent)) => {
                if tables.iter().any(|(name, _)| name == parent) {
                    return Err(refusal(format!(
                        "root Cargo.toml [profile.*] inherits chain cycles at {parent}"
                    )));
                }
                if parent == "release" || parent == "dev" {
                    // Cargo's two built-in roots end the chain.
                    if parent == "dev" {
                        return Err(refusal(
                            "the ship profile must inherit release, not dev",
                        ));
                    }
                    if profile_table(manifest, parent)?.is_none() {
                        break;
                    }
                }
                profile = parent.to_owned();
            }
            Some(_) => {
                return Err(refusal("root Cargo.toml [profile.*] inherits is not a string"));
            }
            None => break,
        }
    }

    let text = |key: &str| -> Result<String, String> {
        match declared(&tables, key) {
            Some(TomlValue::Text(value)) => Ok(value.to_owned()),
            Some(_) => Err(refusal(format!("[profile.production] {key} must be a string"))),
            None => Err(refusal(format!(
                "[profile.production] does not declare {key}; the stamp may not \
                 report a value the manifest does not state"
            ))),
        }
    };
    let lto = match declared(&tables, "lto") {
        // Cargo accepts `lto = true` as a spelling of fat LTO.
        Some(TomlValue::Boolean(true)) => "fat".to_owned(),
        Some(TomlValue::Boolean(false)) => "false".to_owned(),
        _ => text("lto")?,
    };
    let codegen_units = match declared(&tables, "codegen-units") {
        Some(TomlValue::Integer(units)) => units,
        Some(_) => return Err(refusal("[profile.production] codegen-units must be an integer")),
        None => {
            return Err(refusal(
                "[profile.production] does not declare codegen-units; the stamp may \
                 not report a value the manifest does not state",
            ));
        }
    };
    let incremental = match declared(&tables, "incremental") {
        Some(TomlValue::Boolean(value)) => value,
        Some(_) => return Err(refusal("[profile.production] incremental must be a boolean")),
        None => {
            return Err(refusal(
                "[profile.production] does not declare incremental; the stamp may \
                 not report a value the manifest does not state",
            ));
        }
    };
    Ok(DeclaredRecipe {
        lto,
        codegen_units,
        incremental,
        strip: text("strip")?,
    })
}

fn codegen_flag_key(token: &str) -> Option<&str> {
    let rest = token
        .strip_prefix("-C")
        .or_else(|| token.strip_prefix("--codegen="))
        .or_else(|| token.strip_prefix("--codegen"))?;
    let rest = rest.trim_start_matches(['=', ' ']);
    Some(rest.split('=').next().unwrap_or(rest).trim())
}

/// Refuse rustflags that reach any governed knob, whatever set them —
/// `RUSTFLAGS`, `[build] rustflags`, a target table, or `cargo --config`, all
/// of which Cargo resolves into `CARGO_ENCODED_RUSTFLAGS` before a build
/// script runs.
pub fn rustflags_refusal(name: &str, flags: &str) -> Option<String> {
    let tokens: Vec<&str> = flags
        .split(['\u{1f}', ' ', '\t', '\n'])
        .filter(|token| !token.is_empty())
        .collect();
    for (index, token) in tokens.iter().enumerate() {
        let key = match codegen_flag_key(token) {
            Some(key) if !key.is_empty() => key.to_owned(),
            // `-C lto=fat` splits the knob into the following token.
            Some(_) => tokens
                .get(index + 1)
                .map(|next| next.split('=').next().unwrap_or(next).trim().to_owned())
                .unwrap_or_default(),
            None => continue,
        };
        if GOVERNED_CODEGEN_FLAGS.contains(&key.as_str()) {
            return Some(refusal(format!(
                "{name} carries -C {key}, which reaches a knob the ship-recipe \
                 stamp asserts from the manifest"
            )));
        }
    }
    None
}

/// Every environment channel that can re-shape the ship profile behind the
/// manifest's back.
pub fn environment_refusal<'a>(
    variables: impl IntoIterator<Item = (&'a str, &'a str)>,
) -> Option<String> {
    for (name, value) in variables {
        if value.is_empty() {
            continue;
        }
        if name.starts_with("CARGO_PROFILE_") {
            return Some(refusal(format!(
                "{name} is set; a profile override in the environment would make \
                 the manifest's declared recipe a fiction"
            )));
        }
        // `CARGO_INCREMENTAL=0` cannot falsify a declaration of
        // `incremental = false`; it restates it. Swatinem/rust-cache exports
        // exactly that in the Linux packaging workflow, and refusing it would
        // make the ship build unbuildable in its own CI for no gain.
        if name == "CARGO_INCREMENTAL" && value != "0" {
            return Some(refusal(format!(
                "CARGO_INCREMENTAL={value} would override the incremental value \
                 the ship profile declares"
            )));
        }
        if matches!(
            name,
            "RUSTC_WRAPPER"
                | "RUSTC_WORKSPACE_WRAPPER"
                | "CARGO_BUILD_RUSTC_WRAPPER"
                | "CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER"
        ) {
            return Some(refusal(format!(
                "{name} is set; a rustc wrapper may add codegen flags this stamp \
                 cannot read back"
            )));
        }
        if matches!(
            name,
            "RUSTFLAGS" | "CARGO_ENCODED_RUSTFLAGS" | "CARGO_BUILD_RUSTFLAGS"
        ) || (name.starts_with("CARGO_TARGET_") && name.ends_with("_RUSTFLAGS"))
        {
            if let Some(message) = rustflags_refusal(name, value) {
                return Some(message);
            }
        }
    }
    None
}

/// The invoking `cargo` command line. `--config` can rewrite a profile table
/// without leaving a trace in the environment, and `cargo rustc -- -C …`
/// appends codegen flags after every config layer, so the ship build is
/// admitted only in its one plain shape.
pub fn cargo_invocation_refusal(argv: &[String]) -> Option<String> {
    if argv.is_empty() {
        return Some(refusal(
            "the invoking cargo command line could not be read, so --config and \
             trailing rustc flags cannot be excluded",
        ));
    }
    let subcommand = argv[1..].iter().find(|argument| {
        matches!(
            argument.as_str(),
            "build" | "rustc" | "run" | "test" | "bench" | "check" | "clippy" | "install"
        )
    });
    match subcommand.map(|value| value.as_str()) {
        Some("build") => {}
        Some(other) => {
            return Some(refusal(format!(
                "the ship profile is manufactured by `cargo build` only; observed \
                 `cargo {other}`"
            )));
        }
        None => {
            return Some(refusal(
                "the invoking cargo command line names no recognized subcommand",
            ));
        }
    }
    for argument in &argv[1..] {
        if argument == "--config" || argument.starts_with("--config=") {
            return Some(refusal(
                "cargo --config can rewrite [profile.production] without touching \
                 the manifest or the environment",
            ));
        }
        if argument.starts_with("-Z") || argument == "--unstable-options" {
            return Some(refusal(format!(
                "cargo was invoked with the unstable flag {argument}"
            )));
        }
        if argument == "--" {
            return Some(refusal(
                "cargo was given trailing arguments, which can append codegen \
                 flags after every config layer",
            ));
        }
    }
    None
}

/// Ambient Cargo configuration is discovered from the invocation directory
/// upward plus `CARGO_HOME`, and none of it is visible in the resolved profile
/// a build script can read. Refuse when a discovered file reaches the recipe.
pub fn cargo_config_refusal(path: &str, contents: &str) -> Option<String> {
    let mut section = String::new();
    for raw in contents.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(header) = line.strip_prefix('[').and_then(|rest| rest.strip_suffix(']')) {
            section = header.trim().to_owned();
            if section == "profile" || section.starts_with("profile.") {
                return Some(refusal(format!(
                    "{path} declares [{section}]; ambient Cargo configuration may \
                     not re-shape the ship profile"
                )));
            }
            continue;
        }
        let Some((key, _)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim().trim_matches('"');
        let qualified = if section.is_empty() {
            key.to_owned()
        } else {
            format!("{section}.{key}")
        };
        if qualified.starts_with("profile.")
            || qualified.ends_with(".rustflags")
            || qualified == "rustflags"
            || matches!(
                qualified.as_str(),
                "build.rustc"
                    | "build.rustc-wrapper"
                    | "build.rustc-workspace-wrapper"
                    | "build.incremental"
            )
        {
            return Some(refusal(format!(
                "{path} sets {qualified}; ambient Cargo configuration may not \
                 re-shape the ship profile"
            )));
        }
    }
    None
}

/// The whole 1c decision for one build, expressed over already-collected
/// inputs so every forbidden channel is unit-testable without a fat-LTO build.
pub struct StampInputs<'a> {
    pub out_dir: &'a str,
    pub cargo_profile_class: &'a str,
    pub opt_level: &'a str,
    pub root_manifest: &'a str,
    pub environment: Vec<(String, String)>,
    pub cargo_argv: Vec<String>,
    pub discovered_config_files: Vec<(String, String)>,
    pub expected_opt_level: &'a str,
}

pub fn evaluate(inputs: &StampInputs<'_>) -> Result<BuildRecipe, String> {
    let profile = profile_directory_name(inputs.out_dir).ok_or_else(|| {
        refusal(format!(
            "OUT_DIR does not name a Cargo profile directory: {}",
            inputs.out_dir
        ))
    })?;
    let base = BuildRecipe {
        profile: profile.clone(),
        cargo_profile_class: inputs.cargo_profile_class.to_owned(),
        opt_level: inputs.opt_level.to_owned(),
        lto: None,
        codegen_units: None,
        incremental: None,
        strip: None,
    };
    if profile != PRODUCTION_PROFILE {
        // Off the ship profile the stamp reports only what Cargo resolved.
        // Nothing downstream may treat that as an attested recipe.
        return Ok(base);
    }

    if let Some(message) = environment_refusal(
        inputs
            .environment
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_str())),
    ) {
        return Err(message);
    }
    if let Some(message) = cargo_invocation_refusal(&inputs.cargo_argv) {
        return Err(message);
    }
    for (path, contents) in &inputs.discovered_config_files {
        if let Some(message) = cargo_config_refusal(path, contents) {
            return Err(message);
        }
    }
    if inputs.opt_level != inputs.expected_opt_level {
        return Err(refusal(format!(
            "Cargo resolved OPT_LEVEL={} for the ship profile; the attested \
             recipe expects {}",
            inputs.opt_level, inputs.expected_opt_level
        )));
    }
    let declared = parse_declared_recipe(inputs.root_manifest)?;
    Ok(BuildRecipe {
        lto: Some(declared.lto),
        codegen_units: Some(declared.codegen_units),
        incremental: Some(declared.incremental),
        strip: Some(declared.strip),
        ..base
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHIP_MANIFEST: &str = r#"
[workspace.lints]

[profile.release]
incremental = true

# a comment inside the ship recipe
[profile.production]
inherits = "release"
incremental = false
lto = "fat"
codegen-units = 1
strip = "symbols"
"#;

    fn production_inputs() -> StampInputs<'static> {
        StampInputs {
            out_dir: "/w/target/production/build/snapback-build-identity-abc/out",
            cargo_profile_class: "release",
            opt_level: SHIP_OPT_LEVEL,
            root_manifest: SHIP_MANIFEST,
            environment: Vec::new(),
            cargo_argv: vec![
                "/toolchain/bin/cargo".to_owned(),
                "build".to_owned(),
                "--profile".to_owned(),
                "production".to_owned(),
                "--bin".to_owned(),
                "snapback".to_owned(),
            ],
            discovered_config_files: Vec::new(),
            expected_opt_level: SHIP_OPT_LEVEL,
        }
    }

    fn with_env(name: &str, value: &str) -> StampInputs<'static> {
        let mut inputs = production_inputs();
        inputs.environment = vec![(name.to_owned(), value.to_owned())];
        inputs
    }

    fn refusal_of(inputs: &StampInputs<'_>) -> String {
        let error = evaluate(inputs).expect_err("the policy must refuse this build");
        assert!(error.starts_with(UNATTESTABLE_CODE), "{error}");
        error
    }

    #[test]
    fn profile_name_comes_from_out_dir_because_cargo_collapses_it() {
        assert_eq!(
            profile_directory_name("/w/target/production/build/x-1/out").as_deref(),
            Some("production"),
        );
        assert_eq!(
            profile_directory_name("/w/target/aarch64-apple-darwin/production/build/x-1/out")
                .as_deref(),
            Some("production"),
        );
        assert_eq!(profile_directory_name("/w/target/release/build/x-1/out").as_deref(), Some("release"));
        assert_eq!(profile_directory_name("/w/out").as_deref(), None);
    }

    #[test]
    fn the_ship_build_stamps_the_declared_recipe() {
        let recipe = evaluate(&production_inputs()).expect("the plain ship build is attestable");
        assert_eq!(recipe.profile, PRODUCTION_PROFILE);
        assert_eq!(recipe.cargo_profile_class, "release");
        assert_eq!(recipe.lto.as_deref(), Some("fat"));
        assert_eq!(recipe.codegen_units, Some(1));
        assert_eq!(recipe.incremental, Some(false));
        assert_eq!(recipe.strip.as_deref(), Some("symbols"));
        assert_eq!(
            recipe.to_json(),
            "{\"profile\":\"production\",\"cargoProfileClass\":\"release\",\
             \"optLevel\":\"3\",\"lto\":\"fat\",\"codegenUnits\":1,\
             \"incremental\":false,\"strip\":\"symbols\"}",
        );
    }

    // The negative case the whole phase exists for: an ordinary release build
    // is not the ship build, and must not carry a recipe anyone can read as one.
    #[test]
    fn an_ordinary_release_build_carries_no_attested_recipe() {
        let mut inputs = production_inputs();
        inputs.out_dir = "/w/target/release/build/snapback-build-identity-abc/out";
        let recipe = evaluate(&inputs).expect("ordinary release builds still stamp their profile");
        assert_eq!(recipe.profile, "release");
        assert_eq!(recipe.lto, None);
        assert_eq!(recipe.codegen_units, None);
        assert_eq!(recipe.incremental, None);
        assert_eq!(recipe.strip, None);
        assert!(recipe.to_json().contains("\"lto\":null"));
    }

    #[test]
    fn a_debug_build_carries_no_attested_recipe() {
        let mut inputs = production_inputs();
        inputs.out_dir = "/w/target/debug/build/snapback-build-identity-abc/out";
        inputs.cargo_profile_class = "debug";
        inputs.opt_level = "0";
        let recipe = evaluate(&inputs).expect("debug builds still stamp their profile");
        assert_eq!(recipe.profile, "debug");
        assert_eq!(recipe.strip, None);
    }

    #[test]
    fn cargo_profile_environment_overrides_are_refused() {
        for name in [
            "CARGO_PROFILE_PRODUCTION_STRIP",
            "CARGO_PROFILE_PRODUCTION_LTO",
            "CARGO_PROFILE_PRODUCTION_CODEGEN_UNITS",
            "CARGO_PROFILE_PRODUCTION_INCREMENTAL",
            // production inherits release, so the inherited base falsifies too
            "CARGO_PROFILE_RELEASE_LTO",
        ] {
            let error = refusal_of(&with_env(name, "off"));
            assert!(error.contains(name), "{error}");
        }
    }

    #[test]
    fn cargo_incremental_is_refused() {
        let error = refusal_of(&with_env("CARGO_INCREMENTAL", "1"));
        assert!(error.contains("CARGO_INCREMENTAL"), "{error}");
    }

    // The Linux packaging workflow's Rust cache action exports this, and it
    // restates rather than contradicts the declared recipe.
    #[test]
    fn cargo_incremental_zero_is_admitted() {
        assert!(evaluate(&with_env("CARGO_INCREMENTAL", "0")).is_ok());
    }

    #[test]
    fn rustflags_reaching_a_governed_knob_are_refused() {
        for (name, value) in [
            ("RUSTFLAGS", "-C lto=off"),
            ("RUSTFLAGS", "-Cstrip=none"),
            ("CARGO_ENCODED_RUSTFLAGS", "-C\u{1f}codegen-units=16"),
            ("CARGO_ENCODED_RUSTFLAGS", "-Cincremental=/tmp/inc"),
            ("CARGO_BUILD_RUSTFLAGS", "--codegen opt-level=z"),
            ("CARGO_TARGET_AARCH64_APPLE_DARWIN_RUSTFLAGS", "-C lto=thin"),
        ] {
            let error = refusal_of(&with_env(name, value));
            assert!(error.contains(name), "{error}");
        }
    }

    #[test]
    fn rustflags_that_reach_no_governed_knob_are_admitted() {
        let inputs = with_env("RUSTFLAGS", "-C target-cpu=native -D warnings");
        assert!(evaluate(&inputs).is_ok());
    }

    #[test]
    fn rustc_wrappers_are_refused() {
        for name in [
            "RUSTC_WRAPPER",
            "RUSTC_WORKSPACE_WRAPPER",
            "CARGO_BUILD_RUSTC_WRAPPER",
            "CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER",
        ] {
            let error = refusal_of(&with_env(name, "/usr/bin/sccache"));
            assert!(error.contains(name), "{error}");
        }
    }

    #[test]
    fn cargo_config_flags_and_trailing_rustc_flags_are_refused() {
        let cases: [(Vec<&str>, &str); 4] = [
            (
                vec!["cargo", "build", "--config", "profile.production.strip=false"],
                "--config",
            ),
            (
                vec!["cargo", "build", "--config=profile.production.lto=false"],
                "--config",
            ),
            (
                vec!["cargo", "rustc", "--profile", "production", "--", "-C", "lto=off"],
                "cargo rustc",
            ),
            (vec!["cargo", "build", "-Zunstable-options"], "-Zunstable-options"),
        ];
        for (argv, needle) in cases {
            let mut inputs = production_inputs();
            inputs.cargo_argv = argv.iter().map(|value| (*value).to_owned()).collect();
            let error = refusal_of(&inputs);
            assert!(error.contains(needle), "{error}");
        }
    }

    #[test]
    fn an_unreadable_cargo_command_line_fails_closed() {
        let mut inputs = production_inputs();
        inputs.cargo_argv = Vec::new();
        refusal_of(&inputs);
    }

    #[test]
    fn ambient_cargo_configuration_is_refused() {
        for contents in [
            "[profile.production]\nstrip = false\n",
            "[profile.release]\nlto = false\n",
            "[build]\nrustflags = [\"-C\", \"lto=off\"]\n",
            "[build]\nrustc-wrapper = \"/usr/bin/sccache\"\n",
            "[build]\nincremental = true\n",
            "[target.aarch64-apple-darwin]\nrustflags = [\"-Cstrip=none\"]\n",
        ] {
            let mut inputs = production_inputs();
            inputs.discovered_config_files =
                vec![("/home/ci/.cargo/config.toml".to_owned(), contents.to_owned())];
            let error = refusal_of(&inputs);
            assert!(error.contains("/home/ci/.cargo/config.toml"), "{error}");
        }
    }

    #[test]
    fn ambient_cargo_configuration_that_avoids_the_recipe_is_admitted() {
        let mut inputs = production_inputs();
        inputs.discovered_config_files = vec![(
            "/home/ci/.cargo/config.toml".to_owned(),
            "[net]\ngit-fetch-with-cli = true\n".to_owned(),
        )];
        assert!(evaluate(&inputs).is_ok());
    }

    #[test]
    fn a_resolved_opt_level_that_drifts_from_the_attested_one_is_refused() {
        let mut inputs = production_inputs();
        inputs.opt_level = "z";
        let error = refusal_of(&inputs);
        assert!(error.contains("OPT_LEVEL=z"), "{error}");
    }

    #[test]
    fn an_undeclared_knob_is_refused_rather_than_defaulted() {
        let mut inputs = production_inputs();
        inputs.root_manifest = "[profile.release]\nincremental = true\n\n\
                                [profile.production]\ninherits = \"release\"\n\
                                lto = \"fat\"\ncodegen-units = 1\nincremental = false\n";
        let error = refusal_of(&inputs);
        assert!(error.contains("strip"), "{error}");
    }

    #[test]
    fn a_nested_ship_profile_table_is_refused() {
        let mut inputs = production_inputs();
        inputs.root_manifest = format!(
            "{SHIP_MANIFEST}\n[profile.production.package.snapback]\nopt-level = 1\n"
        )
        .leak();
        let error = refusal_of(&inputs);
        assert!(error.contains("profile.production.package"), "{error}");
    }

    #[test]
    fn the_declared_recipe_follows_inherits() {
        let declared = parse_declared_recipe(SHIP_MANIFEST).expect("the ship recipe parses");
        assert_eq!(
            declared,
            DeclaredRecipe {
                lto: "fat".to_owned(),
                codegen_units: 1,
                incremental: false,
                strip: "symbols".to_owned(),
            },
        );
        let inherited = parse_declared_recipe(
            "[profile.release]\nincremental = true\nlto = true\ncodegen-units = 1\n\
             strip = \"symbols\"\n\n[profile.production]\ninherits = \"release\"\n\
             incremental = false\n",
        )
        .expect("inherited values resolve");
        assert_eq!(inherited.lto, "fat");
        assert!(!inherited.incremental);
    }
}
