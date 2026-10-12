//! LLP 3000.040: bounded ints, calendar months and years, monthly schedules
//! and whole-table caps at `check`, in the generated types, in the schema
//! wire and in evolution.
use snapback4_core::schema::{ColumnType, Schedule};
use snapback4_core::successor::{Change, classify};
use snapback4_lang::{Bound, Diagnostic, compile};

fn bound(source: &str) -> Bound {
    compile(&[("schema.q".into(), source.into())])
}

fn clean(source: &str) -> Bound {
    let b = bound(source);
    assert!(b.diagnostics.is_empty(), "{source}\n{:#?}", b.diagnostics);
    b
}

fn first(source: &str, code: &str) -> Diagnostic {
    let b = bound(source);
    b.diagnostics.iter().find(|d| d.code == code && d.cascade_of.is_none()).unwrap_or_else(|| panic!("{code}: {:#?}", b.diagnostics)).clone()
}

const REVIEWS: &str = "table reviews:\n  author: principal\n  stars: int 1..5\n  helpful: int 0.. default 0\n  delta: int -10..10 ?\n  budget: int ..1000 ?\n  scores: [int 0..100] <=8\n  read <- .author = viewer\n  insert <- .author = viewer\n  online only\n";

#[test]
fn bounded_columns_and_arguments_bind_print_and_emit() {
    let b = clean(&format!("{REVIEWS}mutation rate(stars: int 1..5, scores: [int 0..100] <=8, d: int -10..10 ?):\n  return insert reviews {{ author: viewer, stars, scores, delta: d }}\n"));
    let columns = &b.schema.tables["reviews"].columns;
    assert_eq!(columns["stars"], ColumnType::IntRange { min: Some(1), max: Some(5) });
    assert_eq!(columns["helpful"].to_string(), "int 0..");
    assert_eq!(columns["delta"].to_string(), "int -10..10 ?");
    assert_eq!(columns["budget"].to_string(), "int ..1000 ?");
    assert_eq!(columns["scores"].to_string(), "[int 0..100] <=8");
    let ts = snapback4_lang::emit::typescript(&b);
    for line in ["    /** int 1..5 */\n    stars: number;", "    /** int -10..10 ? */\n    delta: number | null;", "    /** [int 0..100] <=8 */\n    scores: number[];"] {
        assert!(ts.contains(line), "{line}\n{ts}");
    }
    assert!(ts.contains("Bounds: d: int -10..10 ?; scores: [int 0..100] <=8; stars: int 1..5."), "{ts}");
    assert!(!ts.contains("/** int */"));
    // The capability is recorded; a schema without bounds keeps its bytes.
    assert!(b.schema.required_capabilities().contains("int-range"));
    let plain = clean("table t:\n  n: int\n  public\n  online only\n");
    assert!(plain.schema.required_capabilities().is_empty());
    let text = serde_json::to_string(&b.schema).unwrap();
    let decoded: snapback4_core::schema::Schema = serde_json::from_str(&text).unwrap();
    assert_eq!(decoded.tables["reviews"].columns, b.schema.tables["reviews"].columns);
}

#[test]
fn constants_defaults_and_helpers_meet_the_bound_at_check() {
    let d = first(&format!("{REVIEWS}mutation bad():\n  return insert reviews {{ author: viewer, stars: 9, scores: [] }}\n"), "E_QUARRY_TYPE");
    assert_eq!(d.message, "reviews.stars is int 1..5; 9 is outside it");
    let d = first(&format!("{REVIEWS}mutation bad():\n  return insert reviews {{ author: viewer, stars: 3, scores: [], delta: -11 }}\n"), "E_QUARRY_TYPE");
    assert!(d.message.contains("-11"), "{d:#?}");
    clean(&format!("{REVIEWS}mutation good():\n  return insert reviews {{ author: viewer, stars: 5, scores: [], delta: -10 }}\n"));
    let d = first("table t:\n  n: int 1..5 default 0\n  public\n  online only\n", "E_QUARRY_TYPE");
    assert!(d.message.contains("default for n"), "{d:#?}");
    clean("table t:\n  n: int 1..5 default 5\n  public\n  online only\n");
    let d = first("fn rating(x: int 1..5): x\nquery q(n: int):\n  return rating(n)\n", "E_QUARRY_TYPE");
    assert!(d.message.starts_with("rating's parameter x cannot be int 1..5"), "{d:#?}");
    assert_eq!(d.rewrite, "declare `x: int` and bound the operation's argument or the stored column as int 1..5");
    clean("fn rating(x: int): x\nquery q(n: int 1..5):\n  return rating(n)\n");
}

#[test]
fn a_total_of_bounded_values_is_an_unbounded_int() {
    let b = clean("table votes:\n  owner: principal\n  weight: int 1..5\n  read <- .owner = viewer\n  online only\nview weights: sum votes of .weight by .owner\n  read <- .owner = viewer\n");
    let target = &b.schema.tables["weights"];
    assert_eq!(target.columns["value"], ColumnType::Int, "{target:#?}");
}

#[test]
fn calendar_builtins_are_typed() {
    clean("table t:\n  at: time\n  public\n  online only\nquery q(m: int):\n  return { a: month(now), b: year(now), c: monthStart(m), d: yearStart(2026), e: monthStart(month(now) + 1) - monthStart(month(now)) }\n");
    let d = first("query q(n: int):\n  return month(n)\n", "E_QUARRY_TYPE");
    assert_eq!(d.message, "month needs a required time, got int");
    let d = first("query q():\n  return monthStart(now)\n", "E_QUARRY_TYPE");
    assert!(d.message.starts_with("monthStart takes a month number (an int), got time"), "{d:#?}");
    let d = first("query q():\n  return yearStart(now)\n", "E_QUARRY_TYPE");
    assert!(d.message.starts_with("yearStart takes a year number"), "{d:#?}");
    assert!(!bound("query q():\n  return month(now, 8h)\n").diagnostics.is_empty());
    // Keys and views accept month and year; offsets do not.
    let b = clean("table checkins:\n  person: principal\n  at: time\n  unique person, month(at)\n  read <- .person = viewer\n  insert <- .person = viewer\n  online only\nview perYear: count checkins by .person, year(.at)\n  read <- .person = viewer\n");
    assert!(b.schema.required_capabilities().contains("calendar-month"));
    assert!(!bound("table checkins:\n  person: principal\n  at: time\n  unique person, month(at, 8h)\n  public\n  online only\n").diagnostics.is_empty());
    assert!(!clean("table checkins:\n  person: principal\n  at: time\n  unique person, day(at)\n  public\n  online only\n").schema.required_capabilities().contains("calendar-month"));
}

fn schedule(period: &str) -> Result<Schedule, Vec<Diagnostic>> {
    let source = format!("table ticks:\n  start: time\n  end: time\n  public\njob tick(periodStart: time, periodEnd: time):\n  for row in ticks:\n    update ticks[row.id] {{ start: periodStart, end: periodEnd }}\nschedule s every {period}: tick\n");
    let b = bound(&source);
    if b.diagnostics.is_empty() { Ok(b.schema.schedules[0].clone()) } else { Err(b.diagnostics) }
}

#[test]
fn calendar_schedules_parse_anchor_at_the_epoch_and_keep_fixed_bytes() {
    let day = 86_400_000;
    let monthly = schedule("1 month at day 1 09:00").unwrap();
    assert_eq!((monthly.months, monthly.every_ms, monthly.offset_ms), (1, 0, 9 * 3_600_000));
    assert_eq!(monthly.describe(), "every 1 month at day 1 09:00 UTC");
    assert_eq!(schedule("3 months").unwrap().months, 3);
    assert_eq!(schedule("1 year").unwrap().months, 12);
    assert_eq!(schedule("2 years at day 15 00:30").unwrap().describe(), "every 2 years at day 15 00:30 UTC");
    assert_eq!(schedule("1 month at 06:00").unwrap().offset_ms, 6 * 3_600_000);
    // Boundaries: 2026-10-01T09:00Z is a boundary; just before it, the previous one.
    let oct = 1_790_812_800_000 + 9 * 3_600_000;
    let nov = 1_793_491_200_000 + 9 * 3_600_000;
    let sep = 1_788_220_800_000 + 9 * 3_600_000;
    assert_eq!(monthly.boundary(oct), oct);
    assert_eq!(monthly.boundary(oct - 1), sep);
    assert_eq!(monthly.boundary(nov - 1), oct);
    assert_eq!((monthly.previous(oct), monthly.next(oct)), (sep, nov));
    assert_eq!(monthly.periods_between(sep, nov), 2);
    // The anchor is 1970-01: quarters start in January, April, July, October.
    let quarterly = schedule("3 months").unwrap();
    let start = quarterly.boundary(1_791_676_800_000); // 2026-10-11
    assert_eq!(start, 1_790_812_800_000); // 2026-10-01
    assert_eq!(quarterly.next(start), 1_798_761_600_000); // 2027-01-01
    let yearly = schedule("1 year").unwrap();
    assert_eq!(yearly.boundary(1_791_676_800_000), 1_767_225_600_000); // 2026-01-01
    assert_eq!(yearly.boundary(-1), -365 * day); // 1969-01-01
    // Days that not every month has, and a day on a fixed period, refuse.
    for bad in ["1 month at day 29 09:00", "1 month at day 0 09:00", "0 months", "1201 months", "101 years", "1d at day 1 09:00"] {
        let diagnostics = schedule(bad).unwrap_err();
        assert_eq!(diagnostics[0].code, "E_QUARRY_SYNTAX", "{bad}: {diagnostics:#?}");
    }
    let refusal = &schedule("1 month at day 31 09:00").unwrap_err()[0];
    assert!(refusal.rewrite.contains("month(periodEnd + 1d) != month(periodEnd)") || refusal.rewrite.contains("day 28"), "{refusal:#?}");
    // A fixed schedule's serialized bytes carry no calendar field.
    let fixed = schedule("1d at 08:00").unwrap();
    assert!(!serde_json::to_string(&fixed).unwrap().contains("months"));
    assert!(serde_json::to_string(&monthly).unwrap().contains("\"months\":1"));
    assert!(fixed.valid() && monthly.valid());
    assert!(!Schedule { every_ms: 60_000, ..monthly.clone() }.valid());
    assert!(!Schedule { offset_ms: 28 * day as u64, ..monthly.clone() }.valid());
}

#[test]
fn bound_and_cap_changes_classify_by_what_stored_rows_can_violate() {
    let schema = |column: &str, cap: &str| clean(&format!("table t:\n  n: {column}\n  public\n  {cap}\n  online only\n")).schema;
    let change = |from: &snapback4_core::schema::Schema, to: &snapback4_core::schema::Schema| snapback4_core::successor::worst(&classify(from, to));
    let none = "insert <- allow";
    for (from, to, expected) in [
        ("int", "int 1..5", Change::Narrowing),
        ("int 1..5", "int", Change::Additive),
        ("int 1..5", "int 0..9", Change::Additive),
        ("int 1..5", "int 2..5", Change::Narrowing),
        ("int 1..", "int 0..", Change::Additive),
        ("int 1..", "int 1..9", Change::Narrowing),
        ("int ..9", "int 0..9", Change::Narrowing),
        ("[int 1..5] <=3", "[int 0..9] <=4", Change::Additive),
        ("[int 0..9] <=3", "[int 1..5] <=3", Change::Narrowing),
        ("int 1..5", "text", Change::Destructive),
    ] {
        assert_eq!(change(&schema(from, none), &schema(to, none)), expected, "{from} -> {to}");
    }
    assert_eq!(change(&schema("int", "cap 5"), &schema("int", "cap 9")), Change::Additive);
    assert_eq!(change(&schema("int", "cap 9"), &schema("int", "cap 5")), Change::Narrowing);
    assert_eq!(change(&schema("int", none), &schema("int", "cap 5")), Change::Narrowing);
}
