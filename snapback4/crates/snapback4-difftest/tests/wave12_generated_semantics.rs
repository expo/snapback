//! Deterministic source generation for Wave 12 language additions. Global
//! maintained values, search and maintained role audiences are outside the
//! full Lean fragment; rounded division is an engine/device control here and
//! remains covered by the shared random generator and Lean oracle elsewhere.

#[path = "../../snapback4-device/tests/common/mod.rs"]
mod device_common;

use device_common::{Host, Memory, Sqlite, compile, id, snapshot_pages, stream_page};
use serde_json::{Map, Value as Json};
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_device::{device::Device, store::DeviceStore};
use std::collections::BTreeMap;

const GENERATED_SOURCES: usize = 8;
const EXPECTED_OUTCOMES_PER_RUNTIME: usize = 14;
const EXPECTED_ROLE_OUTCOMES_PER_SOURCE: usize = 5;

#[derive(Clone, Debug)]
struct Entry {
    id: String,
    owner: String,
    score: i64,
    category: String,
    contact: String,
}

impl Entry {
    fn value(&self) -> Value {
        snapback4_core::value::object([
            ("id", id(&self.id)),
            ("owner", id(&self.owner)),
            ("score", Value::Int(self.score)),
            ("category", Value::String(self.category.clone())),
            ("contact", Value::String(self.contact.clone())),
        ])
    }
}

#[derive(Clone, Debug)]
struct Generated {
    seed: u64,
    source: String,
    role_source: String,
    count_domain: String,
    role: &'static str,
    categories: [&'static str; 3],
    search_prefix: &'static str,
    viewer: &'static str,
    granted: bool,
    valid_email: &'static str,
    invalid_email: &'static str,
    entries: Vec<Entry>,
}

#[derive(Clone, Debug)]
enum Expected {
    Data(Value),
    Refusal(&'static str),
}

#[derive(Default, Debug)]
struct Counts {
    server: usize,
    device: usize,
    snapshot_pages: usize,
    stream_pages: usize,
}

fn source(seed: u64) -> Generated {
    let (categories, search_prefix) = if seed % 2 == 0 {
        (["coffee-shop", "book_store", "museum"], "cof")
    } else {
        (["tea-house", "art_gallery", "planetarium"], "tea")
    };
    let role = if seed % 3 == 0 { "finance" } else { "auditor" };
    let viewer = ["alice", "bob", "carol"][(seed as usize) % 3];
    let granted = seed % 4 < 2;
    let population = (seed as usize) % 5;
    let count_domain = if seed % 2 == 0 {
        "entries[owner] by byOwner".to_owned()
    } else {
        "entries where .owner = owner".to_owned()
    };
    let valid_email = [
        "a@example.com",
        "first.last+tag@sub.example",
        "x@localhost",
        "team_member@example-domain.com",
    ][(seed as usize) % 4];
    let invalid_email = [
        "a..b@example.com",
        ".a@example.com",
        "a@-example.com",
        "a@example..com",
        "a@пример.рф",
        "a@@example.com",
    ][(seed as usize) % 6];
    let owners = ["alice", "bob", "carol"];
    let entries = (0..population)
        .map(|i| Entry {
            id: format!("e{seed}-{i}"),
            owner: owners[(i + seed as usize) % owners.len()].to_owned(),
            score: (i as i64 + 1) * if (seed + i as u64) % 2 == 0 { 3 } else { -2 },
            category: categories[i % categories.len()].to_owned(),
            contact: format!("entry{i}@example.com"),
        })
        .collect();
    let source = format!(
        r#"
table entries:
  owner: principal
  score: int
  category: enum('{category0}', '{category1}', '{category2}')
  contact: text 3..254 format email
  by byOwner: owner, id
  search category
  public 'generated Wave 12 semantics'
  insert <- allow
  delete <- allow
  sync public
view total: count entries
mutation add(id: id, owner: principal, score: int, category: enum('{category0}', '{category1}', '{category2}'), contact: text 3..254 format email):
  return insert entries {{ id, owner, score, category, contact }}
mutation addUnchecked(id: id, owner: principal, score: int, category: enum('{category0}', '{category1}', '{category2}'), contact: text 3..254):
  return insert entries {{ id, owner, score, category, contact }}
mutation removeEntry(id: entries):
  delete entries[id]
  return null
query totalEntries():
  return total
query stats(owner: principal):
  n = count({count_domain})
  require n > 0 else EMPTY
  return {{ low: min({count_domain}, .score), high: max({count_domain}, .score), sum: sum({count_domain}, .score) }}
query email(value: text 3..254 format email):
  return value
query search(q: text <=40, c: cursor ?):
  return entries matching q first 20 by .id after c
query rounded(value: decimal 2, numerator: int, denominator: int):
  return {{ preserved: divide(value, 2, 'half-even'), scaled: divide(numerator, denominator, 2, 'half-even') }}
query divideZero(numerator: int, denominator: int):
  return divide(numerator, denominator, 2, 'half-even')
mutation freshCount(owner: principal, victim: entries):
  delete entries[victim]
  n = count({count_domain})
  require n > 0 else EMPTY
  return min({count_domain}, .score) + 1
"#,
        category0 = categories[0],
        category1 = categories[1],
        category2 = categories[2]
    );
    // A role-gated maintained view is deliberately online-only: inheriting
    // `sync public` would disclose every group and the compiler refuses that
    // audience conflict. This family therefore runs on the real server while
    // the public source above runs through both complete device stores.
    let role_source = format!(
        r#"
table entries:
  owner: principal
  public
  online only
table staff:
  principal: principal
  role: enum('{role}')
  unique principal, role
  read <- .principal = viewer
  delete <- allow
  online only
view privateTotal: count entries
  read <- exists staff[principal = viewer, role = '{role}']
  online only
view totals: count entries by .owner
  read <- exists staff[principal = viewer, role = '{role}']
  online only
query privateEntries():
  return privateTotal
query rawRole(owner: principal):
  return totals[owner]
query guardedRole(owner: principal):
  require exists staff[principal = viewer, role = '{role}'] else NOT_FINANCE
  return totals[owner] + 1
mutation freshRole(owner: principal, grant: staff):
  delete staff[grant]
  require exists staff[principal = viewer, role = '{role}'] else NOT_FINANCE
  return totals[owner] + 1
"#
    );
    Generated {
        seed,
        source,
        role_source,
        count_domain,
        role,
        categories,
        search_prefix,
        viewer,
        granted,
        valid_email,
        invalid_email,
        entries,
    }
}

fn json_args(pairs: &[(&str, Value)]) -> Json {
    Json::Object(
        pairs
            .iter()
            .map(|(name, value)| ((*name).to_owned(), snapback4_core::wire::to_json(value)))
            .collect::<Map<_, _>>(),
    )
}

fn core_args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs
        .iter()
        .map(|(name, value)| ((*name).to_owned(), value.clone()))
        .collect()
}

fn assert_server(
    engine: &mut Engine,
    viewer: &str,
    name: &str,
    args: &[(&str, Value)],
    expected: &Expected,
    label: &str,
    counts: &mut Counts,
) {
    counts.server += 1;
    match (
        engine.query(name, Context::new(viewer, core_args(args))),
        expected,
    ) {
        (Ok(out), Expected::Data(value)) => {
            assert!(
                !out.unavailable && out.complete && out.cut.is_none(),
                "server incomplete/unknown {label}: {out:?}"
            );
            assert_eq!(&out.data, value, "server {label}");
        }
        (Err(error), Expected::Refusal(code)) => {
            assert_eq!(&error.code, code, "server {label}: {error:?}")
        }
        (actual, expected) => panic!("server {label}: expected {expected:?}, got {actual:?}"),
    }
}

fn assert_device<S: DeviceStore>(
    device: &mut Device<S>,
    viewer: &str,
    name: &str,
    args: &[(&str, Value)],
    expected: &Expected,
    label: &str,
    counts: &mut Counts,
) {
    counts.device += 1;
    let (actual, unknown, _) = device.query_with_coverage(name, viewer, &json_args(args), 10);
    assert!(
        !unknown,
        "device reported unknown instead of an outcome for {label}"
    );
    match (actual, expected) {
        (Ok(out), Expected::Data(value)) => {
            assert!(
                !out.unavailable && out.complete && out.cut.is_none(),
                "device incomplete/unknown {label}: {out:?}"
            );
            assert_eq!(&out.data, value, "device {label}");
        }
        (Err(error), Expected::Refusal(code)) => {
            assert_eq!(&error.code, code, "device {label}: {error:?}")
        }
        (actual, expected) => panic!("device {label}: expected {expected:?}, got {actual:?}"),
    }
}

fn rows_for(entries: &[Entry], expected_category: &str) -> Value {
    let mut rows = entries
        .iter()
        .filter(|entry| entry.category == expected_category)
        .collect::<Vec<_>>();
    rows.sort_by(|a, b| a.id.cmp(&b.id));
    Value::Array(rows.into_iter().map(Entry::value).collect())
}

fn stats_for(entries: &[Entry], owner: &str) -> Expected {
    let scores = entries
        .iter()
        .filter(|entry| entry.owner == owner)
        .map(|entry| entry.score)
        .collect::<Vec<_>>();
    if scores.is_empty() {
        return Expected::Refusal("EMPTY");
    }
    Expected::Data(snapback4_core::value::object([
        ("low", Value::Int(*scores.iter().min().unwrap())),
        ("high", Value::Int(*scores.iter().max().unwrap())),
        ("sum", Value::Int(scores.iter().sum())),
    ]))
}

fn role_value(granted: bool, count: usize) -> Expected {
    Expected::Data(if granted {
        Value::Int(count as i64)
    } else {
        Value::Null
    })
}

fn guarded_value(granted: bool, count: usize) -> Expected {
    if granted {
        Expected::Data(Value::Int(count as i64 + 1))
    } else {
        Expected::Refusal("NOT_FINANCE")
    }
}

fn seed_entries(engine: &mut Engine, generated: &Generated) {
    engine
        .seed(
            generated
                .entries
                .iter()
                .map(|entry| ("entries".to_owned(), entry.value()))
                .collect::<Vec<_>>(),
        )
        .unwrap();
}

fn seed_role_engine(engine: &mut Engine, generated: &Generated) {
    let mut rows = generated
        .entries
        .iter()
        .map(|entry| {
            (
                "entries".to_owned(),
                snapback4_core::value::object([("id", id(&entry.id)), ("owner", id(&entry.owner))]),
            )
        })
        .collect::<Vec<_>>();
    if generated.granted {
        rows.push((
            "staff".to_owned(),
            snapback4_core::value::object([
                ("id", id(&format!("grant-{}", generated.seed))),
                ("principal", id(generated.viewer)),
                ("role", Value::String(generated.role.to_owned())),
            ]),
        ));
    }
    engine.seed(rows).unwrap();
}

fn check_runtime<H: Host>(host: &mut H, generated: &Generated) -> Counts {
    let (mut server, backend) = compile(&generated.source);
    seed_entries(&mut server, generated);
    let store = format!("wave12-generated-{}-{}", host.label(), generated.seed);
    let mut device = host.open(&store, Some(backend)).unwrap();
    let pages = snapshot_pages(&mut server, generated.viewer, 2);
    assert!(!pages.is_empty());
    for (index, page) in pages.iter().enumerate() {
        device.apply(page, index == 0).unwrap();
    }
    let mut counts = Counts {
        snapshot_pages: pages.len(),
        ..Counts::default()
    };

    let focus = generated
        .entries
        .first()
        .map_or(generated.viewer, |entry| entry.owner.as_str());
    let total = Expected::Data(Value::Int(generated.entries.len() as i64));
    let focus_stats = stats_for(&generated.entries, focus);
    let missing_stats = stats_for(&generated.entries, "nobody");
    let valid_email = Expected::Data(Value::String(generated.valid_email.to_owned()));
    let invalid_email = Expected::Refusal("E_INPUT");
    let search = Expected::Data(rows_for(&generated.entries, generated.categories[0]));
    let no_search = Expected::Data(Value::Array(vec![]));
    let (decimal, numerator, denominator, preserved, scaled) = [
        (5, 101, 2, 2, 5050),
        (-5, -1, 8, -2, -12),
        (7, 3, 8, 4, 38),
        (-7, -3, 8, -4, -38),
    ][generated.seed as usize % 4];
    let rounded = Expected::Data(snapback4_core::value::object([
        ("preserved", Value::Int(preserved)),
        ("scaled", Value::Int(scaled)),
    ]));
    let divide_zero = Expected::Refusal("E_DIV_ZERO");

    let checks = [
        ("totalEntries", vec![], total),
        ("stats", vec![("owner", id(focus))], focus_stats),
        ("stats", vec![("owner", id("nobody"))], missing_stats),
        (
            "email",
            vec![("value", Value::String(generated.valid_email.to_owned()))],
            valid_email,
        ),
        (
            "email",
            vec![("value", Value::String(generated.invalid_email.to_owned()))],
            invalid_email,
        ),
        (
            "search",
            vec![
                ("q", Value::String(generated.search_prefix.to_owned())),
                ("c", Value::Null),
            ],
            search,
        ),
        (
            "search",
            vec![("q", Value::String("unmatched".into())), ("c", Value::Null)],
            no_search,
        ),
        (
            "rounded",
            vec![
                ("value", Value::Int(decimal)),
                ("numerator", Value::Int(numerator)),
                ("denominator", Value::Int(denominator)),
            ],
            rounded,
        ),
        (
            "divideZero",
            vec![("numerator", Value::Int(1)), ("denominator", Value::Int(0))],
            divide_zero,
        ),
    ];
    for (index, (name, args, expected)) in checks.iter().enumerate() {
        let label = format!("seed {} check {index} {name}", generated.seed);
        assert_server(
            &mut server,
            generated.viewer,
            name,
            args,
            expected,
            &label,
            &mut counts,
        );
        assert_device(
            &mut device,
            generated.viewer,
            name,
            args,
            expected,
            &label,
            &mut counts,
        );
    }

    let invalid = [
        ("id", id(&format!("invalid-{}", generated.seed))),
        ("owner", id(generated.viewer)),
        ("score", Value::Int(0)),
        (
            "category",
            Value::String(generated.categories[0].to_owned()),
        ),
        ("contact", Value::String(generated.invalid_email.to_owned())),
    ];
    counts.server += 1;
    let failed = server
        .mutate(
            "addUnchecked",
            None,
            Context::new(generated.viewer, core_args(&invalid)),
        )
        .unwrap();
    assert!(
        matches!(failed.state, WriteState::Failed { ref why, .. } if why.code == "E_CONSTRAINT"),
        "server invalid email mutation seed {}: {failed:?}",
        generated.seed
    );
    counts.device += 1;
    let predicted = device
        .predict(
            "addUnchecked",
            generated.viewer,
            &json_args(&invalid),
            10,
            vec![],
            1,
        )
        .unwrap_err();
    assert_eq!(
        predicted.code(),
        "E_CONSTRAINT",
        "device invalid email mutation seed {}",
        generated.seed
    );

    let extra = Entry {
        id: format!("z{}", generated.seed),
        owner: generated.viewer.to_owned(),
        score: 11 + generated.seed as i64,
        category: generated.categories[0].to_owned(),
        contact: format!("stream{}@example.com", generated.seed),
    };
    let add = [
        ("id", id(&extra.id)),
        ("owner", id(&extra.owner)),
        ("score", Value::Int(extra.score)),
        ("category", Value::String(extra.category.clone())),
        ("contact", Value::String(extra.contact.clone())),
    ];
    let watermark = pages.last().unwrap().watermark;
    counts.server += 1;
    let sent = server
        .mutate("add", None, Context::new(generated.viewer, core_args(&add)))
        .unwrap();
    assert!(
        matches!(sent.state, WriteState::Sent { .. }),
        "server streamed insert seed {}: {sent:?}",
        generated.seed
    );
    device
        .apply(
            &stream_page(&mut server, generated.viewer, watermark),
            false,
        )
        .unwrap();
    counts.stream_pages += 1;

    let mut after = generated.entries.clone();
    after.push(extra);
    let post = [
        (
            "totalEntries",
            vec![],
            Expected::Data(Value::Int(after.len() as i64)),
        ),
        (
            "stats",
            vec![("owner", id(generated.viewer))],
            stats_for(&after, generated.viewer),
        ),
        (
            "search",
            vec![
                ("q", Value::String(generated.search_prefix.to_owned())),
                ("c", Value::Null),
            ],
            Expected::Data(rows_for(&after, generated.categories[0])),
        ),
    ];
    for (index, (name, args, expected)) in post.iter().enumerate() {
        let label = format!("seed {} post-stream {index} {name}", generated.seed);
        assert_server(
            &mut server,
            generated.viewer,
            name,
            args,
            expected,
            &label,
            &mut counts,
        );
        assert_device(
            &mut device,
            generated.viewer,
            name,
            args,
            expected,
            &label,
            &mut counts,
        );
    }

    host.close(&store, device);
    let mut reopened = host.open(&store, None).unwrap();
    assert_device(
        &mut reopened,
        generated.viewer,
        "totalEntries",
        &[],
        &Expected::Data(Value::Int(after.len() as i64)),
        &format!("seed {} reopen global", generated.seed),
        &mut counts,
    );
    host.close(&store, reopened);
    counts
}

fn check_role_server(generated: &Generated) -> Counts {
    let (mut server, _) = compile(&generated.role_source);
    seed_role_engine(&mut server, generated);
    let focus = generated
        .entries
        .first()
        .map_or(generated.viewer, |entry| entry.owner.as_str());
    let focus_count = generated
        .entries
        .iter()
        .filter(|entry| entry.owner == focus)
        .count();
    let checks = [
        (
            "privateEntries",
            vec![],
            role_value(generated.granted, generated.entries.len()),
        ),
        (
            "rawRole",
            vec![("owner", id(focus))],
            role_value(generated.granted, focus_count),
        ),
        (
            "rawRole",
            vec![("owner", id("nobody"))],
            role_value(generated.granted, 0),
        ),
        (
            "guardedRole",
            vec![("owner", id(focus))],
            guarded_value(generated.granted, focus_count),
        ),
        (
            "guardedRole",
            vec![("owner", id("nobody"))],
            guarded_value(generated.granted, 0),
        ),
    ];
    let mut counts = Counts::default();
    for (index, (name, args, expected)) in checks.iter().enumerate() {
        assert_server(
            &mut server,
            generated.viewer,
            name,
            args,
            expected,
            &format!("seed {} role check {index} {name}", generated.seed),
            &mut counts,
        );
    }
    assert_eq!(counts.server, EXPECTED_ROLE_OUTCOMES_PER_SOURCE);
    counts
}

fn assert_narrowing_sources(generated: &Generated) {
    let stale_count = format!(
        r#"{}
mutation staleCount(owner: principal, victim: entries):
  n = count({domain})
  delete entries[victim]
  require n > 0 else EMPTY
  return min({domain}, .score) + 1
"#,
        generated.source,
        domain = generated.count_domain
    );
    let stale_role = format!(
        r#"{}
mutation staleRole(owner: principal, grant: staff):
  require exists staff[principal = viewer, role = '{role}'] else NOT_FINANCE
  delete staff[grant]
  return totals[owner] + 1
"#,
        generated.role_source,
        role = generated.role
    );
    for (name, source) in [("count", stale_count), ("role", stale_role)] {
        let bound = snapback4_lang::compile(&[(format!("stale-{name}.q"), source)]);
        assert_eq!(
            bound
                .diagnostics
                .iter()
                .map(|diagnostic| diagnostic.code.as_str())
                .collect::<Vec<_>>(),
            ["E_QUARRY_TYPE"],
            "seed {} stale {name}: {:#?}",
            generated.seed,
            bound.diagnostics
        );
        assert!(
            bound.diagnostics[0].message.contains("int ?"),
            "seed {} stale {name}: {:#?}",
            generated.seed,
            bound.diagnostics
        );
    }
    for (name, source) in [
        ("count", generated.source.clone()),
        ("role", generated.role_source.clone()),
    ] {
        let fresh = snapback4_lang::compile(&[(format!("fresh-{name}.q"), source)]);
        assert!(
            fresh.diagnostics.is_empty(),
            "seed {} fresh {name}: {:#?}",
            generated.seed,
            fresh.diagnostics
        );
    }
}

#[test]
fn generated_sources_cover_wave12_semantics_on_server_and_both_devices() {
    let generated = (0..GENERATED_SOURCES as u64)
        .map(source)
        .collect::<Vec<_>>();
    for case in &generated {
        assert_narrowing_sources(case);
    }

    let mut memory = Memory::new();
    let mut sqlite = Sqlite::new("wave12-generated-semantics");
    let role_counts =
        generated
            .iter()
            .map(check_role_server)
            .fold(Counts::default(), |mut total, count| {
                total.server += count.server;
                total
            });
    let memory_counts = generated
        .iter()
        .map(|case| check_runtime(&mut memory, case))
        .fold(Counts::default(), |mut total, count| {
            total.server += count.server;
            total.device += count.device;
            total.snapshot_pages += count.snapshot_pages;
            total.stream_pages += count.stream_pages;
            total
        });
    let sqlite_counts = generated
        .iter()
        .map(|case| check_runtime(&mut sqlite, case))
        .fold(Counts::default(), |mut total, count| {
            total.server += count.server;
            total.device += count.device;
            total.snapshot_pages += count.snapshot_pages;
            total.stream_pages += count.stream_pages;
            total
        });
    let expected = GENERATED_SOURCES * EXPECTED_OUTCOMES_PER_RUNTIME;
    assert_eq!(
        (memory_counts.server, memory_counts.device),
        (expected, expected),
        "{memory_counts:?}"
    );
    assert_eq!(
        (sqlite_counts.server, sqlite_counts.device),
        (expected, expected),
        "{sqlite_counts:?}"
    );
    assert_eq!(
        role_counts.server,
        GENERATED_SOURCES * EXPECTED_ROLE_OUTCOMES_PER_SOURCE
    );
    assert_eq!(
        (memory_counts.stream_pages, sqlite_counts.stream_pages),
        (GENERATED_SOURCES, GENERATED_SOURCES)
    );
    assert!(
        memory_counts.snapshot_pages >= GENERATED_SOURCES
            && sqlite_counts.snapshot_pages >= GENERATED_SOURCES
    );
    eprintln!(
        "wave12 generated: public_sources={GENERATED_SOURCES}, role_sources={GENERATED_SOURCES}, stale_negative={}, fresh_controls={}, server_outcomes={}, memory_outcomes={}, sqlite_outcomes={}, memory_snapshot_pages={}, sqlite_snapshot_pages={}, stream_pages={}",
        GENERATED_SOURCES * 2,
        GENERATED_SOURCES * 2,
        memory_counts.server + sqlite_counts.server + role_counts.server,
        memory_counts.device,
        sqlite_counts.device,
        memory_counts.snapshot_pages,
        sqlite_counts.snapshot_pages,
        memory_counts.stream_pages + sqlite_counts.stream_pages
    );
}
