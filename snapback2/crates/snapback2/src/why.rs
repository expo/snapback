//! Human and JSON explanations for one authoritative query execution.
// @ref LLP 1002#8-why-trace-guide — explanations join row verdicts, rule inputs, and certified reads.

use crate::client;
use crate::owner;
use crate::project::{SourceSite, locate_root};
use crate::protocol::Refusal;
use crate::verbs;
use serde_json::{Map, Value as Json, json};
use snapback2_core::Certificate;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::process::ExitCode;

pub fn run(args: &[String]) -> ExitCode {
    let options = match verbs::parse_options(args, &["--as", "--project"], &["--json"]) {
        Ok(options) => options,
        Err(code) => return code,
    };
    let json_output = options.has("--json");
    let positional = options.positionals();
    if positional.len() < 2 || positional.len() > 3 {
        return usage();
    }
    let persona = match options.value("--as") {
        Some(persona) => persona,
        None => return usage(),
    };
    let arguments = match positional.get(2) {
        Some(value) => match serde_json::from_str(value) {
            Ok(value) => value,
            Err(error) => {
                return owner::print_refusal(
                    Refusal::input(
                        format!("invalid args JSON: {error}"),
                        "pass a JSON object such as '{}'",
                    ),
                    json_output,
                    2,
                );
            }
        },
        None => json!({}),
    };
    let root = match locate_root(options.value("--project").map(Path::new)) {
        Ok(root) => root,
        Err(error) => return owner::print_refusal(error, json_output, 2),
    };
    let attached = match owner::require_owner(&root) {
        Ok(owner) => owner,
        Err(error) => return owner::print_refusal(error, json_output, 1),
    };
    let response = match client::control(
        &attached,
        "POST",
        "/control/why",
        json!({ "op": positional[1], "args": arguments, "as": persona, "queryOnly": true }),
    ) {
        Ok(response) if response.status < 400 => response.body,
        Ok(response) => {
            println!("{}", response.body);
            return ExitCode::from(1);
        }
        Err(error) => return owner::print_refusal(error, json_output, 1),
    };
    let mut certificate = match read_certificate(&root, &positional[1]) {
        Ok(certificate) => certificate,
        Err(error) => return owner::print_refusal(error, json_output, 1),
    };
    let (Some(active_plan_hash), Some(active_schema_hash)) = (
        response.get("certificatePlanHash").and_then(Json::as_str),
        response.get("certificateSchemaHash").and_then(Json::as_str),
    ) else {
        return owner::print_refusal(
            why_stale("the owner did not identify the active operation certificate"),
            json_output,
            1,
        );
    };
    if certificate.certificate.plan_hash != active_plan_hash
        || certificate.certificate.schema_hash != active_schema_hash
    {
        certificate = match read_certificate(&root, &positional[1]) {
            Ok(certificate) => certificate,
            Err(error) => return owner::print_refusal(error, json_output, 1),
        };
        if certificate.certificate.plan_hash != active_plan_hash
            || certificate.certificate.schema_hash != active_schema_hash
        {
            return owner::print_refusal(
                why_stale(format!(
                    "the cached certificate for {} does not match the active owner operation",
                    positional[1]
                )),
                json_output,
                1,
            );
        }
    }
    let latest = client::control(&attached, "GET", "/control/trace", json!({}))
        .ok()
        .map(|response| response.body)
        .unwrap_or_else(|| json!({}));
    let output = enrich(&positional[1], response, latest, certificate.certificate);
    if json_output {
        println!("{}", serde_json::to_string(&output).unwrap_or_default());
    } else {
        print!(
            "{}",
            prose(&positional[1], persona, &output, &certificate.sources)
        );
    }
    ExitCode::SUCCESS
}

#[derive(Clone, serde::Deserialize)]
struct LocatedCertificate {
    #[serde(flatten)]
    certificate: Certificate,
    #[serde(default)]
    sources: BTreeMap<String, SourceSite>,
}

fn read_certificate(root: &Path, op: &str) -> Result<LocatedCertificate, Refusal> {
    let path = root.join(".snapback/build/certificates.json");
    let bytes = fs::read(&path)
        .map_err(|error| why_stale(format!("cannot read {}: {error}", path.display())))?;
    let certificates: BTreeMap<String, LocatedCertificate> = serde_json::from_slice(&bytes)
        .map_err(|error| why_stale(format!("cannot parse {}: {error}", path.display())))?;
    certificates
        .get(op)
        .cloned()
        .ok_or_else(|| why_stale(format!("certificates.json is missing operation {op}")))
}

fn why_stale(message: impl Into<String>) -> Refusal {
    Refusal::owner("E_WHY_STALE", message,
        "run snapback2 dev --status --json; if a successor is refused, review status.refused and its migrationFile plan and project, then use its applyCommand for an intended migration or revert the refused edit; with no refused successor, skip that step; run snapback2 check to refresh the certificate cache and retry why (check does not install a successor)")
}

fn enrich(op: &str, response: Json, latest: Json, certificate: Certificate) -> Json {
    let system = response.get("principal").and_then(Json::as_str) == Some("system");
    let trace = response.get("trace").cloned().unwrap_or_else(|| json!({}));
    let mut verdicts = Vec::new();
    if let Some(ranges) = trace.get("ranges").and_then(Json::as_array) {
        for range in ranges {
            let visible = string_array(range, "visible_ids", "visibleIds");
            let returned = string_array(range, "returned_ids", "returnedIds");
            for id in string_array(range, "examined_ids", "examinedIds") {
                let admitted = visible.iter().any(|visible| visible == &id);
                verdicts.push(json!({
                    "row": id,
                    "site": range.get("site"),
                    "table": range.get("table"),
                    "verdict": if system { "system-visible" } else if admitted { "allow" } else { "deny" },
                    "cut": admitted && !returned.iter().any(|returned| returned == &id),
                }));
            }
        }
    }
    if let Some(points) = trace.get("points").and_then(Json::as_array) {
        for point in points {
            if point
                .get("examined")
                .and_then(Json::as_bool)
                .unwrap_or(false)
            {
                verdicts.push(json!({
                    "key": point.get("key"),
                    "site": point.get("site"),
                    "table": point.get("table"),
                    "verdict": if system { "system-visible" } else if point.get("visible").and_then(Json::as_bool).unwrap_or(false) { "allow" } else { "deny" },
                    "cut": false,
                }));
            }
        }
    }
    // @ref LLP 1002#8-why-trace-guide — denied-read details stay in local owner diagnostics.
    // In particular, never attach this existence-sensitive hint to execution_json.
    let diagnostics = verdicts
        .iter()
        .filter(|verdict| verdict["verdict"] == "deny")
        .map(|verdict| {
            let site = verdict["site"].clone();
            let diagnostic = json!({
                "code": "E_RULE",
                "family": "rule",
                "site": site,
                "table": verdict["table"],
                "message": "The table read rule denied this lookup. Reads inside mutations use the same viewer authority; write permission does not grant read permission.",
                "rewrite": "Inspect the table read rule for this persona. For group administration, admit the intended scoped roster audience and keep admin checks on writes; run snapback2 guide auth.",
                "guide": "auth",
            });
            (site.to_string(), diagnostic)
        })
        .collect::<BTreeMap<_, _>>()
        .into_values()
        .collect::<Vec<_>>();
    let invalidated = latest
        .get("invalidated")
        .and_then(Json::as_array)
        .cloned()
        .unwrap_or_default();
    let subscriptions = response
        .get("subscriptions")
        .and_then(Json::as_array)
        .into_iter()
        .flatten()
        .map(|subscription| {
            let id = subscription.get("id").and_then(Json::as_u64);
            json!({
                "id": id,
                "principal": subscription.get("principal"),
                "lastDeliverySeq": subscription.get("lastSeq").or_else(|| subscription.get("last_seq")),
                "latestTouched": id.is_some_and(|id| invalidated.iter().any(|value| value.as_u64() == Some(id))),
            })
        })
        .collect::<Vec<_>>();
    let mut output = Map::new();
    if system {
        output.insert("principal".to_owned(), json!("system"));
    }
    output.insert("op".to_owned(), Json::String(op.to_owned()));
    output.insert(
        "result".to_owned(),
        response.get("result").cloned().unwrap_or(Json::Null),
    );
    output.insert("rowVerdicts".to_owned(), Json::Array(verdicts));
    output.insert("diagnostics".to_owned(), Json::Array(diagnostics));
    output.insert(
        "ruleInputs".to_owned(),
        trace
            .get("rule_inputs")
            .or_else(|| trace.get("ruleInputs"))
            .cloned()
            .unwrap_or_else(|| json!([])),
    );
    // @ref LLP 1020#a4-check---cost — only recorded counters are measured; no allocator/closure measurement is inferred.
    let write_bound = certificate.write_sites.iter().fold(certificate.maintained_amplification, |n, w| n.saturating_add(w.max_rows));
    let writes = trace.get("writes").and_then(Json::as_object).map(|rows| rows.values().filter_map(Json::as_u64).fold(0u64, u64::saturating_add));
    let meters: Vec<_> = [
        ("examined", certificate.max_examined, trace.get("examined").cloned()),
        ("index entries", certificate.max_index_entries, None),
        ("probes", certificate.max_rule_probes, trace.get("rule_probes").cloned()),
        ("steps", certificate.max_steps, trace.get("steps").cloned()),
        ("derived scratch", certificate.derived_scratch_bytes, trace.get("derived_scratch_bytes").cloned()),
        ("writes", write_bound, writes.map(|n| json!(n))),
        ("heap peak", certificate.max_heap_bytes, None),
        ("output bytes", certificate.max_output_bytes, None),
        ("closure bytes", certificate.max_closure_bytes, None),
    ].into_iter().map(|(meter, bound, measured)| json!({"meter": meter, "certified": bound,
        "measured": measured.unwrap_or(json!("unavailable"))})).collect();
    output.insert("meters".into(), json!(meters));
    output.insert("readSites".to_owned(), json!(certificate.read_sites));
    output.insert("authoritativeTrace".to_owned(), trace);
    output.insert("subscriptions".to_owned(), Json::Array(subscriptions));
    Json::Object(output)
}

fn string_array(value: &Json, snake: &str, camel: &str) -> Vec<String> {
    value
        .get(snake)
        .or_else(|| value.get(camel))
        .and_then(Json::as_array)
        .into_iter()
        .flatten()
        .filter_map(Json::as_str)
        .map(ToOwned::to_owned)
        .collect()
}

fn usage() -> ExitCode {
    eprintln!("usage: snapback2 why <query> [args-json] --as <persona> [--json]");
    ExitCode::from(2)
}

// @ref LLP 1002#diagnostics-say-the-fix — prose uses the active certificate's source snapshot, never the edited file.
fn prose(op: &str, persona: &str, output: &Json, sources: &BTreeMap<String, SourceSite>) -> String {
    let result = &output["result"];
    let state = result["state"].as_str().unwrap_or("unavailable");
    let rule = result["rule"].as_str();
    let mut text = format!(
        "{op} as {persona} — {state}{}\n",
        rule.map(|rule| format!(" ({rule})")).unwrap_or_default()
    );
    if let Some(meters) = output["meters"].as_array() {
        text.push_str(&format!("  {:<15} {:>10} {:>12}\n", "meter", "certified", "measured"));
        for meter in meters {
            let measured = meter["measured"].as_str().map(str::to_owned).unwrap_or_else(|| meter["measured"].to_string());
            text.push_str(&format!("  {:<15} {:>10} {:>12}\n", meter["meter"].as_str().unwrap_or("?"), meter["certified"].to_string(), measured));
        }
    }
    let trace = &output["authoritativeTrace"];
    let points = entries(&trace["points"]);
    let ranges = entries(&trace["ranges"]);
    if state == "denied" {
        let guards: Vec<_> = sources
            .iter()
            .filter(|(_, source)| source.requirement.as_deref() == rule && rule.is_some())
            .collect();
        // Codes identify a source only when every emitted Require agrees on one site.
        let guard = (guards.len() == 1).then(|| guards[0]);
        if let Some((site, source)) = guard {
            source_line(&mut text, site, Some(source));
        } else if !guards.is_empty() {
            text.push_str("  failed requirement source is ambiguous; executed reads follow\n");
        }
        // A lookup can precede its requirement through a local or helper argument.
        // Keep all executed reads; condition-local associations cannot prove completeness.
        for read in points.iter().chain(ranges.iter()) {
            if guard.is_none() {
                let site = read["site"].as_str().unwrap_or(op);
                source_line(&mut text, site, sources.get(site));
            }
            text.push_str(&format!(
                "    {}   {}   ({})\n",
                lookup(read), read_visibility(read), read["index"].as_str().unwrap_or("?")
            ));
        }
        if points.is_empty() && ranges.is_empty() {
            text.push_str("  no table reads executed\n");
        }
        return text;
    }
    for site in entries(&output["readSites"]) {
        let id = site["site"].as_str().unwrap_or(op);
        let reads: Vec<_> = points
            .iter()
            .chain(ranges.iter())
            .filter(|read| read["site"] == id)
            .collect();
        if reads.is_empty() {
            continue;
        }
        source_line(&mut text, id, sources.get(id));
        for read in reads {
            let point = read.get("examined").is_some();
            let examined = if point {
                usize::from(read["examined"] == true)
            } else {
                entries(&read["examined_ids"]).len()
            };
            let visible = if point {
                usize::from(read["visible"] == true)
            } else {
                entries(&read["visible_ids"]).len()
            };
            text.push_str(&format!(
                "    {}   {examined} {} examined, {visible} visible\n",
                lookup(read),
                if examined == 1 { "row" } else { "rows" }
            ));
            let index = read["index"].as_str().unwrap_or("?");
            if point {
                text.push_str(&format!("    point by {index} — complete\n"));
            } else {
                let order = if read["order"] == "Desc" {
                    "last"
                } else {
                    "first"
                };
                let stop = read["stop"].as_str().unwrap_or("unavailable");
                let state = match stop {
                    "Exhausted" => "complete",
                    "Limit" => "capped",
                    other => other,
                };
                text.push_str(&format!(
                    "    {order} {} by {index} — {state}\n",
                    read["take"]
                ));
            }
            let table = read["table"].as_str().unwrap_or("?");
            let rule = if persona == "system" {
                "system principal (rules bypassed)"
            } else {
                sources
                    .get(&format!("schema.tables.{table}.rules.read"))
                    .and_then(|source| source.text.as_deref())
                    .unwrap_or("read rule source unavailable")
            };
            text.push_str(&format!(
                "    {}: {rule}\n",
                if visible > 0 {
                    "admitted by"
                } else if examined > 0 {
                    "denied by"
                } else {
                    "read rule"
                }
            ));
        }
    }
    let mut subscriptions = Vec::new();
    for read in points
        .iter()
        .chain(ranges.iter())
        .chain(entries(&trace["rule_inputs"]).iter())
    {
        let entry = format!(
            "    {} {} [{}]\n",
            read["table"].as_str().unwrap_or("?"),
            read["index"].as_str().unwrap_or("?"),
            keys(read)
        );
        if !subscriptions.contains(&entry) {
            subscriptions.push(entry);
        }
    }
    for absence in entries(&trace["absences"]) {
        let read = json!({ "table": absence[0], "index": absence[1], "key": absence[2] });
        let entry = format!("    {} {} [{}]\n", read["table"].as_str().unwrap_or("?"), read["index"].as_str().unwrap_or("?"), keys(&read));
        if !subscriptions.contains(&entry) { subscriptions.push(entry); }
    }
    for input in entries(&trace["constraint_inputs"]) {
        let entry = format!("    {} (whole table; constraint input)\n", input["table"].as_str().unwrap_or("?"));
        if !subscriptions.contains(&entry) { subscriptions.push(entry); }
    }
    if !subscriptions.is_empty() {
        text.push_str("  subscriptions:\n");
        for subscription in subscriptions {
            text.push_str(&subscription);
        }
    }
    text
}

fn entries(value: &Json) -> &[Json] {
    value.as_array().map(Vec::as_slice).unwrap_or(&[])
}

fn read_visibility(read: &Json) -> &'static str {
    if read.get("examined").is_some() {
        if read["visible"] == true {
            "present"
        } else if read["examined"] == true {
            "hidden"
        } else {
            "absent"
        }
    } else if entries(&read["visible_ids"]).is_empty() {
        "no visible rows"
    } else {
        "visible rows"
    }
}

fn source_line(text: &mut String, id: &str, source: Option<&SourceSite>) {
    let source = source.map(|source| source.r#use.as_deref().unwrap_or(source));
    match source {
        Some(source) => {
            let file = Path::new(&source.file)
                .file_name()
                .and_then(|file| file.to_str())
                .unwrap_or(&source.file);
            text.push_str(&format!(
                "  {file}:{}   {}\n",
                source.line,
                source.text.as_deref().unwrap_or(id)
            ));
        }
        None => text.push_str(&format!("  {id}\n")),
    }
}

fn lookup(read: &Json) -> String {
    format!("{}[{}]", read["table"].as_str().unwrap_or("?"), keys(read))
}

fn keys(read: &Json) -> String {
    entries(read.get("key").unwrap_or(&read["prefix"]))
        .iter()
        .map(value_text)
        .collect::<Vec<_>>()
        .join(", ")
}

fn value_text(value: &Json) -> String {
    if let Some(scalar) = value.get("Scalar") {
        return value_text(scalar);
    }
    if value == "Null" || value.is_null() {
        return "null".to_owned();
    }
    for tag in ["Id", "String", "Int", "Bool"] {
        if let Some(value) = value.get(tag) {
            return value
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| value.to_string());
        }
    }
    value.to_string()
}

#[cfg(test)]
#[test]
fn prose_keeps_capped_visible_counts_and_falls_back_to_the_site_id() {
    let output = json!({
        "result": { "state": "capped" },
        "readSites": [{ "site": "posts.all.0" }],
        "authoritativeTrace": { "ranges": [{
            "site": "posts.all.0", "table": "posts", "index": "byTime", "prefix": [],
            "examined_ids": ["1", "2", "3"], "visible_ids": ["1", "2"], "returned_ids": ["1"],
            "order": "Asc", "take": 1, "stop": "Limit"
        }] }
    });
    assert_eq!(
        prose("posts.all", "alice", &output, &BTreeMap::new()),
        concat!(
            "posts.all as alice — capped\n",
            "  posts.all.0\n",
            "    posts[]   3 rows examined, 2 visible\n",
            "    first 1 by byTime — capped\n",
            "    admitted by: read rule source unavailable\n",
            "  subscriptions:\n",
            "    posts byTime []\n",
        )
    );
}

#[cfg(test)]
#[test]
fn denied_range_fallback_reports_visibility_without_claiming_absence() {
    for (visible, status) in [
        (json!(["1"]), "visible rows"),
        (json!([]), "no visible rows"),
    ] {
        let output = json!({
            "result": { "state": "denied", "rule": "FORBIDDEN" },
            "authoritativeTrace": { "ranges": [{
                "site": "posts.all.0", "table": "posts", "index": "byTime", "prefix": [],
                "examined_ids": ["1"], "visible_ids": visible,
                "order": "Asc", "take": 50, "stop": "Exhausted"
            }] }
        });
        assert_eq!(
            prose("posts.all", "alice", &output, &BTreeMap::new()),
            format!(
                "posts.all as alice — denied (FORBIDDEN)\n  posts.all.0\n    posts[]   {status}   (byTime)\n"
            )
        );
    }
}

// @ref LLP 1020#a4-check---cost — a counter the trace does not carry is `unavailable`, never inferred.
#[cfg(test)]
#[test]
fn meters_mark_a_missing_writes_map_unavailable_and_sum_a_present_one() {
    use snapback2_core::{Ceilings, Checker, spike_schema, thread_program};
    let certificate = Checker::new(&spike_schema(), Ceilings::default()).check(&thread_program(20)).unwrap();
    let meter = |output: &Json, name: &str| output["meters"].as_array().unwrap().iter().find(|m| m["meter"] == name).unwrap()["measured"].clone();
    let without = enrich("messages.thread", json!({ "trace": { "examined": 3, "steps": 9 } }), json!({}), certificate.clone());
    assert_eq!(meter(&without, "writes"), "unavailable");
    assert_eq!(meter(&without, "examined"), 3);
    assert_eq!(meter(&without, "probes"), "unavailable");
    assert_eq!(meter(&without, "heap peak"), "unavailable");
    let with = enrich("messages.thread", json!({ "trace": { "writes": { "messages": 2, "_outbox": 3 } } }), json!({}), certificate);
    assert_eq!(meter(&with, "writes"), 5);
}
