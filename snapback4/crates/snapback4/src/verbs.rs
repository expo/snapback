//! The verbs that do not serve: `check`, `run`, `types`, `why`, `doctor`,
//! `init`, `data`, `test`. Each prints one honest answer and exits with it.

use crate::project::{Project, persona_principal};
use snapback4_core::engine::rules::scan_visibility;
use snapback4_core::ir::{self, ProgramKind};
use snapback4_core::schema::Audience;
use snapback4_core::{Context, WriteState, wire};
use snapback4_lang::Bound;
use serde_json::{Value as Json, json};
use std::collections::BTreeMap;
use std::path::Path;
use std::time::Instant;

mod fix;
mod init;
mod sql;
mod work_records;
pub mod witness;
pub use init::init;
pub(crate) use init::without_design_references;
pub use sql::sql;
mod residency;
mod test_fixture;
mod test_cases;
/// A fixture directory's case file: not a table's rows.
pub(crate) const CASES_FILE: &str = test_cases::FILE;
mod adoption;
mod package_versions;
#[cfg(test)]
mod hand_tests;
mod latency;
mod run_admission;
pub(crate) mod run_forward;
mod run_refusal;

#[derive(Clone)]
pub struct Options {
    pub positionals: Vec<String>,
    pub flags: BTreeMap<String, String>,
    pub json: bool,
}

pub fn parse(args: &[String]) -> Options {
    let mut positionals = Vec::new();
    let mut flags = BTreeMap::new();
    let mut json = false;
    let mut iter = args.iter().skip(1).peekable();
    while let Some(arg) = iter.next() {
        if arg == "-h" { flags.insert("help".into(), String::new()); continue; }
        if arg == "--" { positionals.extend(iter.cloned()); break; }
        if arg == "--json" || arg == "--json-objects" {
            json = true;
            if arg == "--json-objects" { flags.insert("json-objects".into(), String::new()); }
        } else if let Some(flag) = arg.strip_prefix("--") {
            // A switch takes no value; any other flag takes the next token
            // unless that token is itself a flag.
